package serve

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"

	_ "modernc.org/sqlite"
)

// The design's performance bound (DESIGN.md plan 12, "Performance bound"): times every analytics
// route, measure, dimension pair and in-cap bucket against a copy of a ledger and fails any case
// whose p95 is over YAKKA_BENCH_P95_MS. It uses the committed synthetic fixture by default; when
// YAKKA_BENCH_DIR is set, only ledger.db and its -wal/-shm siblings are copied into a temp dir.
// This file lives
// in package serve rather than store because it drives HTTP routes, and store cannot import serve.

const (
	benchKey     = "bench-key"
	benchTenant  = "bench"
	benchDefRuns = 3
	benchDefP95  = 500.0
	benchLiveEnv = "YAKKA_BENCH_ALLOW_LIVE"
)

// TestAnalyticsBench uses the fixture unless YAKKA_BENCH_DIR names an additional real-corpus source;
// YAKKA_BENCH_OUT writes the table; YAKKA_BENCH_RUNS sets timed runs per case (default 3,
// after one discarded warm-up); YAKKA_BENCH_FILTER is a case-name substring; YAKKA_BENCH_P95_MS
// is the bound (default 500).
func TestAnalyticsBench(t *testing.T) {
	src := os.Getenv("YAKKA_BENCH_DIR")
	fixture := src == ""
	if fixture {
		src = benchFixtureSource(t)
	}
	if !fixture {
		if err := benchLiveRefused(src); err != nil {
			t.Fatal(err)
		}
	}
	h := openBenchCopy(t, src)
	to := benchMaxTS(t, h.db)
	if to.IsZero() {
		t.Skip("ledger has no facts")
	}
	cases := buildBenchCases(t, h, to)
	r := &benchRunner{
		h:      h.h,
		key:    benchKey,
		cases:  cases,
		runs:   benchEnvInt("YAKKA_BENCH_RUNS", benchDefRuns, 1),
		filter: os.Getenv("YAKKA_BENCH_FILTER"),
		p95ms:  benchEnvFloat("YAKKA_BENCH_P95_MS", benchDefP95),
	}
	out := r.run()
	table := out.table()
	t.Log("\n" + table)
	for _, c := range out.failed {
		t.Errorf("case %s: status %d (want 200)", c.name, c.status)
	}
	for _, c := range out.over {
		t.Errorf("case %s: p95 %.1f ms over %.0f ms", c.name, c.p95ms(), r.p95ms)
	}
	if p := os.Getenv("YAKKA_BENCH_OUT"); p != "" {
		if err := os.WriteFile(p, []byte(table+"\n"), 0o644); err != nil {
			t.Fatalf("write YAKKA_BENCH_OUT: %v", err)
		}
	}
	t.Logf("benchmark: %d cases, %s elapsed", len(out.cases), out.elapsed.Round(time.Millisecond))
	if len(out.failed) > 0 || len(out.over) > 0 {
		t.Fatalf("%d/%d cases failed the bound; %d returned non-200", len(out.over), len(out.cases), len(out.failed))
	}
}

func benchEnvInt(name string, def, min int) int {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < min {
		return def
	}
	return n
}

func benchEnvFloat(name string, def float64) float64 {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}

// benchLiveRefused refuses a source under the live ledger unless the operator opts in. The copy is
// still made; the guard is a reminder that the live ledger is not the benchmark's target.
func benchLiveRefused(dir string) error {
	if os.Getenv(benchLiveEnv) == "1" {
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	live := filepath.Join(home, ".local", "share", "yakka")
	d := filepath.Clean(dir)
	if d == live || strings.HasPrefix(d, live+string(filepath.Separator)) {
		return fmt.Errorf("YAKKA_BENCH_DIR %s is under the live ledger %s; set %s=1 to proceed (a copy is still made)", dir, live, benchLiveEnv)
	}
	return nil
}

type benchHarness struct {
	srv *Server
	h   http.Handler
	ts  *tenantState
	db  *sql.DB
}

// openBenchCopy copies the source ledger into a private temp tenant, opens that copy, and returns a
// handler for it. The source is only read (never opened), so no migration or WAL write touches it.
func openBenchCopy(t *testing.T, srcDir string) *benchHarness {
	t.Helper()
	data := t.TempDir()
	dst := filepath.Join(data, benchTenant)
	if err := os.MkdirAll(dst, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ledger.db", "ledger.db-wal", "ledger.db-shm"} {
		srcPath := filepath.Join(srcDir, name)
		fi, err := os.Stat(srcPath)
		if errors.Is(err, os.ErrNotExist) {
			if name == "ledger.db" {
				t.Fatalf("no ledger.db in %s", srcDir)
			}
			continue
		}
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		if fi.Size() == 0 {
			continue
		}
		b, err := os.ReadFile(srcPath)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if err := os.WriteFile(filepath.Join(dst, name), b, 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	s := New(Config{Data: data, Keys: []KeyPair{{benchTenant, benchKey}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant(benchTenant)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dst, "ledger.db")+
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return &benchHarness{srv: s, h: s.Handler(), ts: ts, db: db}
}

func benchMaxTS(t *testing.T, db *sql.DB) time.Time {
	t.Helper()
	var mx sql.NullFloat64
	if err := db.QueryRow(`SELECT MAX(ts) FROM facts`).Scan(&mx); err != nil {
		t.Fatalf("max ts: %v", err)
	}
	if !mx.Valid {
		return time.Time{}
	}
	return time.Unix(int64(mx.Float64), 0).UTC()
}

// benchTopConversations reads the ids of the conversations with the most facts in [from, to] from
// the copy, most first.
func benchTopConversations(t *testing.T, db *sql.DB, from, to time.Time, n int) []string {
	t.Helper()
	rows, err := db.Query(`SELECT conversation_id FROM facts WHERE ts>=? AND ts<=? AND conversation_id<>''
		GROUP BY conversation_id ORDER BY COUNT(*) DESC, conversation_id ASC LIMIT ?`,
		float64(from.Unix()), float64(to.Unix()), n)
	if err != nil {
		t.Fatalf("top conversations: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("top conversations scan: %v", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("top conversations rows: %v", err)
	}
	return out
}

type benchMeasure struct {
	name string
	dims []string
}

// benchSchema reads the measure x dimension matrix from GET /v1/analytics/schema (never hard-coded).
func benchSchema(t *testing.T, h *benchHarness) []benchMeasure {
	t.Helper()
	code, body := do(t, h.h, http.MethodGet, "/v1/analytics/schema", benchKey, "")
	if code != 200 {
		t.Fatalf("schema: %d %s", code, body)
	}
	var sc struct {
		Measures []struct {
			Name string   `json:"name"`
			Dims []string `json:"dims"`
		} `json:"measures"`
	}
	if err := json.Unmarshal([]byte(body), &sc); err != nil {
		t.Fatalf("schema json: %v", err)
	}
	if len(sc.Measures) == 0 {
		t.Fatal("schema returned no measures")
	}
	out := make([]benchMeasure, 0, len(sc.Measures))
	for _, m := range sc.Measures {
		out = append(out, benchMeasure{name: m.Name, dims: m.Dims})
	}
	return out
}

type benchPreset struct {
	name string
	from time.Time
	to   time.Time
	all  bool
}

// benchPresets are the four relative windows back from the copy's max ts, plus all time.
func benchPresets(to time.Time) []benchPreset {
	return []benchPreset{
		{name: "24h", from: to.Add(-24 * time.Hour), to: to},
		{name: "7d", from: to.Add(-7 * 24 * time.Hour), to: to},
		{name: "30d", from: to.Add(-30 * 24 * time.Hour), to: to},
		{name: "90d", from: to.Add(-90 * 24 * time.Hour), to: to},
		{name: "all", from: minAnalyticsTime, to: to, all: true},
	}
}

func (p benchPreset) filter() string {
	if p.all {
		return "all=1&to=" + p.to.UTC().Format(time.RFC3339)
	}
	return "from=" + p.from.UTC().Format(time.RFC3339) + "&to=" + p.to.UTC().Format(time.RFC3339)
}

type benchCase struct {
	name string
	path string
}

// buildBenchCases enumerates every case the design names: each route per preset, the
// schema once, each measure at 0/1/2 dims per preset, and each in-cap bucket at 0 dims and the
// first dim per preset.
func buildBenchCases(t *testing.T, h *benchHarness, to time.Time) []benchCase {
	t.Helper()
	schema := benchSchema(t, h)
	presets := benchPresets(to)
	var cases []benchCase
	add := func(name, path string) { cases = append(cases, benchCase{name: name, path: path}) }

	for _, p := range presets {
		win := p.filter()
		add("facets/"+p.name, "/v1/analytics/facets?"+win)
		add("summary/"+p.name, "/v1/analytics/summary?"+win)
		add("series/"+p.name, "/v1/analytics/series?metric=hook_events&bucket=day&group=none&"+win)
		add("scores/"+p.name, "/v1/analytics/scores?kind=design&"+win)
		add("executions/"+p.name, "/v1/analytics/executions?"+win)
		add("executions/shape/"+p.name, "/v1/analytics/executions?shape=complete&"+win)
		add("executions/shape-bucket/"+p.name, "/v1/analytics/executions?shape=complete&bucket=day&"+win)
		add("conversations/"+p.name, "/v1/analytics/conversations?"+win)
		add("explore/"+p.name, "/v1/analytics/explore?"+win)
		add("distribution/cost/"+p.name, "/v1/analytics/distribution?measure=cost_usd&grain=call&"+win)
		add("distribution/tokens/"+p.name, "/v1/analytics/distribution?measure=tokens_in&grain=call&"+win)
		add("score-series/"+p.name, "/v1/analytics/score-series?kind=design&bucket=day&"+win)
		convWin := "from=" + p.from.UTC().Format(time.RFC3339) + "&to=" + p.to.UTC().Format(time.RFC3339)
		for i, id := range benchTopConversations(t, h.db, p.from, p.to, 3) {
			q := url.Values{"id": []string{id}}
			add(fmt.Sprintf("conversation/conv#%d/%s", i+1, p.name), "/v1/analytics/conversation?"+q.Encode()+"&"+convWin)
		}
	}
	add("schema", "/v1/analytics/schema")

	for _, p := range presets {
		win := p.filter()
		for _, m := range schema {
			for _, dims := range dimCombos(m.dims) {
				add(queryCaseName(m.name, dims, "none", p.name), "/v1/analytics/query?"+queryParams(m.name, dims, "none", win))
				if p.all {
					add(queryCaseName(m.name, dims, "auto", p.name), "/v1/analytics/query?"+queryParams(m.name, dims, "auto", win))
				}
			}
		}
	}

	for _, p := range presets {
		win := p.filter()
		for _, b := range store.Buckets {
			if b == "none" || bucketSpan(p.from, p.to, b, nil) > maxBuckets {
				continue
			}
			for _, m := range schema {
				if len(m.dims) == 0 {
					continue
				}
				for _, dims := range [][]string{{}, {m.dims[0]}} {
					add(queryCaseName(m.name, dims, b, p.name), "/v1/analytics/query?"+queryParams(m.name, dims, b, win))
				}
			}
		}
	}
	return cases
}

func queryParams(measure string, dims []string, bucket, win string) string {
	v := url.Values{}
	v.Set("measure", measure)
	for _, d := range dims {
		v.Add("dim", d)
	}
	v.Set("bucket", bucket)
	return v.Encode() + "&" + win
}

func queryCaseName(measure string, dims []string, bucket, preset string) string {
	return "query/" + measure + "/dims=" + dimsKey(dims) + "/bucket=" + bucket + "/" + preset
}

func dimsKey(dims []string) string {
	if len(dims) == 0 {
		return "none"
	}
	return strings.Join(dims, "+")
}

func dimCombos(dims []string) [][]string {
	out := [][]string{nil}
	for i := range dims {
		out = append(out, []string{dims[i]})
	}
	for i := 0; i < len(dims); i++ {
		for j := i + 1; j < len(dims); j++ {
			out = append(out, []string{dims[i], dims[j]})
		}
	}
	return out
}

type benchCaseResult struct {
	name   string
	status int
	runs   int
	p95    time.Duration
	rows   int
}

func (c benchCaseResult) p95ms() float64 { return float64(c.p95) / float64(time.Millisecond) }

type benchOutcome struct {
	cases   []benchCaseResult
	failed  []benchCaseResult
	over    []benchCaseResult
	elapsed time.Duration
}

func (o benchOutcome) table() string {
	var b strings.Builder
	b.WriteString("case\tstatus\truns\tp95_ms\trows\n")
	for _, c := range o.cases {
		fmt.Fprintf(&b, "%s\t%d\t%d\t%.1f\t%d\n", c.name, c.status, c.runs, c.p95ms(), c.rows)
	}
	return b.String()
}

type benchRunner struct {
	h      http.Handler
	key    string
	cases  []benchCase
	runs   int
	filter string
	p95ms  float64
}

func (r *benchRunner) run() benchOutcome {
	var o benchOutcome
	start := time.Now()
	for _, c := range r.cases {
		if r.filter != "" && !strings.Contains(c.name, r.filter) {
			continue
		}
		r.once(c.path) // one discarded warm-up
		times := make([]time.Duration, 0, r.runs)
		status, rows := 0, 0
		for i := 0; i < r.runs; i++ {
			d, st, rw := r.once(c.path)
			times = append(times, d)
			status, rows = st, rw
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		res := benchCaseResult{name: c.name, status: status, runs: r.runs, p95: nearestRank(times, 0.95), rows: rows}
		o.cases = append(o.cases, res)
		if status != 200 {
			o.failed = append(o.failed, res)
		}
		if res.p95ms() > r.p95ms {
			o.over = append(o.over, res)
		}
	}
	o.elapsed = time.Since(start)
	return o
}

func (r *benchRunner) once(p string) (time.Duration, int, int) {
	req := httptest.NewRequest(http.MethodGet, p, nil)
	req.Header.Set("Authorization", "Bearer "+r.key)
	rec := httptest.NewRecorder()
	start := time.Now()
	r.h.ServeHTTP(rec, req)
	body, _ := io.ReadAll(rec.Body)
	elapsed := time.Since(start)
	return elapsed, rec.Code, benchRowCount(body)
}

// nearestRank is the p-quantile by nearest rank; for the small default N it is the largest sample.
func nearestRank(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// benchRowCount counts the result rows in a response body: rows, then events, then series points.
func benchRowCount(body []byte) int {
	var m map[string]any
	if json.Unmarshal(body, &m) != nil {
		return 0
	}
	if v, ok := m["rows"].([]any); ok {
		return len(v)
	}
	if v, ok := m["events"].([]any); ok {
		return len(v)
	}
	if v, ok := m["series"].([]any); ok {
		n := 0
		for _, e := range v {
			if em, ok := e.(map[string]any); ok {
				if pts, ok := em["points"].([]any); ok {
					n += len(pts)
				}
			}
		}
		return n
	}
	return 0
}

// TestAnalyticsBenchSmoke is the ungated self-test: it builds a small synthetic tenant, runs every
// case, and asserts full coverage and that every case is 200, then checks the over-bound path.
func TestAnalyticsBenchSmoke(t *testing.T) {
	src := benchFixtureSource(t)
	h := openBenchCopy(t, src)
	to := benchMaxTS(t, h.db)
	if to.IsZero() {
		t.Fatal("fixture has no facts")
	}
	cases := buildBenchCases(t, h, to)

	schema := benchSchema(t, h)
	names := map[string]bool{}
	for _, c := range cases {
		names[c.name] = true
	}
	for _, route := range []string{"facets", "summary", "series", "scores", "executions", "conversations", "explore", "distribution", "score-series"} {
		found := false
		for _, c := range cases {
			if strings.HasPrefix(c.name, route+"/") {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("no case for route %s", route)
		}
	}
	for _, p := range benchPresets(to) {
		found := false
		for _, c := range cases {
			if strings.HasSuffix(c.name, "/"+p.name) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("no case for preset %s", p.name)
		}
	}
	for _, m := range schema {
		for _, dims := range dimCombos(m.dims) {
			if want := queryCaseName(m.name, dims, "none", "24h"); !names[want] {
				t.Errorf("missing case %s", want)
			}
		}
	}

	r := &benchRunner{h: h.h, key: benchKey, cases: cases, runs: 1, p95ms: benchDefP95}
	out := r.run()
	for _, c := range out.cases {
		if c.status != 200 {
			t.Errorf("case %s returned %d", c.name, c.status)
		}
	}
	if len(out.failed) != 0 {
		t.Errorf("%d cases were non-200", len(out.failed))
	}

	// A zero bound must report failures, proving the over-bound path.
	r2 := &benchRunner{h: h.h, key: benchKey, cases: cases, runs: 1, p95ms: 0, filter: "facets/"}
	out2 := r2.run()
	if len(out2.over) == 0 {
		t.Error("p95=0 reported no over-bound cases")
	}
}

// TestAnalyticsBenchCopyIsNonMutating asserts a run leaves the source ledger.db bytes and mtime
// untouched.
func TestAnalyticsBenchCopyIsNonMutating(t *testing.T) {
	src := benchFixtureSource(t)
	dbPath := filepath.Join(src, "ledger.db")
	before := benchFileDigest(t, dbPath)
	h := openBenchCopy(t, src)
	to := benchMaxTS(t, h.db)
	if to.IsZero() {
		t.Fatal("fixture has no facts")
	}
	cases := buildBenchCases(t, h, to)
	if len(cases) > 8 {
		cases = cases[:8]
	}
	r := &benchRunner{h: h.h, key: benchKey, cases: cases, runs: 1, p95ms: benchDefP95}
	r.run()
	after := benchFileDigest(t, dbPath)
	if before != after {
		t.Errorf("source ledger.db changed: before=%+v after=%+v", before, after)
	}
}

type benchFileState struct {
	size int64
	mod  time.Time
	hash string
}

func benchFileDigest(t *testing.T, path string) benchFileState {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(b)
	return benchFileState{size: fi.Size(), mod: fi.ModTime(), hash: hex.EncodeToString(sum[:])}
}

// benchFixtureSource builds a small synthetic tenant (a few hundred hook, usage, artifact and
// commit facts across harnesses) and returns its directory for openBenchCopy.
func benchFixtureSource(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	tn, err := store.Open(filepath.Join(dir, benchTenant), store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC().Truncate(time.Minute)
	harnesses := []string{"claude", "codex", "opencode", "cursor"}
	events := []string{"PreToolUse", "PostToolUse", "Stop"}
	tools := []string{"Read", "Bash", "Edit"}
	models := []string{"claude-sonnet-5-5", "kimi-k2.5", "gpt-5"}
	conv := func(i int) string { return fmt.Sprintf("conv-%d", i) }
	n := 0
	next := func() int { n++; return n }
	var rows []store.FactRow
	for i := 0; i < 120; i++ {
		at := base.Add(-time.Duration(i) * 3 * time.Hour)
		raw, _ := json.Marshal(map[string]any{"n": next()})
		rows = append(rows, store.FactRow{
			RowHash: keys.ContentHash(raw), Type: "hook_event", ConversationID: conv(i%6 + 1),
			Harness: harnesses[i%len(harnesses)], Event: events[i%len(events)], NormEvent: "tool_post",
			Tool: tools[i%len(tools)], Model: models[i%len(models)], RepoID: fmt.Sprintf("r%d", i%3),
			TS: float64(at.Unix()), Raw: raw,
		})
	}
	for i := 0; i < 40; i++ {
		at := base.Add(-time.Duration(i) * 7 * time.Hour)
		raw, _ := json.Marshal(map[string]any{"backfill": map[string]any{"ref": fmt.Sprintf("m%d", i)}})
		cp := float64(i) * 0.01
		rows = append(rows, store.FactRow{
			RowHash: keys.ContentHash(raw), Type: "hook_event", ConversationID: conv(i%6 + 1),
			Harness: harnesses[i%len(harnesses)], Event: "transcript.assistant_message", NormEvent: "usage",
			Model: models[i%len(models)], RepoID: fmt.Sprintf("r%d", i%3), TS: float64(at.Unix()), Raw: raw,
			TokIn: int64(i * 100), TokOut: int64(i * 10), TokCacheRead: int64(i), TokCacheWrite: int64(i * 2),
			TokReasoning: int64(i), CostReported: &cp,
		})
	}
	for i := 0; i < 30; i++ {
		at := base.Add(-time.Duration(i) * 11 * time.Hour)
		content := fmt.Sprintf("content-%d", i)
		raw, _ := json.Marshal(map[string]any{"n": next(), "path": "docs/plans/12-x/DESIGN.md", "source": "worktree"})
		rows = append(rows, store.FactRow{
			RowHash: keys.ContentHash(raw), Type: "artifact_version", ConversationID: conv(i%6 + 1),
			Harness: harnesses[i%len(harnesses)], Event: "design", RepoID: fmt.Sprintf("r%d", i%3),
			TS: float64(at.Unix()), Path: "docs/plans/12-x/DESIGN.md",
			ContentHash: keys.ContentHash([]byte(content)), Source: "worktree", Raw: raw,
		})
	}
	for i := 0; i < 10; i++ {
		at := base.Add(-time.Duration(i) * 19 * time.Hour)
		raw, _ := json.Marshal(map[string]any{"n": next()})
		rows = append(rows, store.FactRow{
			RowHash: keys.ContentHash(raw), Type: "commit", ConversationID: conv(i%6 + 1),
			Harness: harnesses[i%len(harnesses)], Event: "commit", RepoID: fmt.Sprintf("r%d", i%3),
			TS: float64(at.Unix()), Raw: raw,
		})
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		tn.Close()
		t.Fatal(err)
	}
	if err := tn.Close(); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, benchTenant)
}
