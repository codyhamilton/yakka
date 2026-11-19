package serve

// TestAnalyticsPageSet and TestAnalyticsPageSetSmoke consume the request shapes recorded from the
// shipped workspace boards (testdata/browser-request-shapes.json, written by 13-01). Each entry is
// the exact method, path and query the browser sent for one board state, including the all-history
// states, so the smoke can no longer rot against the deleted Overview/Usage pages.
//
// TestAnalyticsPageSetSmoke is ungated: it parses and validates the committed record, asserts its
// pinned request count and SHA-256, generates the deterministic committed fixture ledger
// (internal/analyticsfixture) into a temporary directory, and requires every recorded request to
// return HTTP 200 or a documented capability refusal (HTTP 400 naming an unsupported dimension,
// field, mode, check or scorer). The record was captured against the deterministic first-party
// stub, whose advertised capability set is a superset of the Go server's, so a shape the Go server
// explicitly refuses is the documented capability-degradation path, not rot. The smoke asserts the
// exact served/refusal split and fails on any 5xx, unexpected 4xx, or refusal that does not name a
// capability. Requests run at most four at a time, the concurrency the p95 contract was measured at.
//
// TestAnalyticsPageSet is the opt-in profiler and is skipped unless YAKKA_PAGESET_PROFILE=fixture.
// It selects the same committed fixture, classifies the full record, then times only the served
// cases (one discarded warm-up plus pagesetRuns-1 samples); documented capability refusals are
// excluded from timing. It reports the record's exact case count and the maximum p95 over the
// served cases, and fails any case whose p95 exceeds the unchanged 500 ms contract (CONTRACTS.md
// 12). EXPLAIN output is logged for the
// slowest requests where it still applies; all-history requests have no explicit from/to window and
// are reported as skipped rather than guessed. The fixture is test-only; a temporary copy is
// generated under TMPDIR and removed with the test.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/analyticsfixture"

	_ "modernc.org/sqlite"
)

const (
	pagesetRecordPath     = "testdata/browser-request-shapes.json"
	pagesetRecordRequests = 75
	pagesetRecordServed   = 61
	pagesetRecordRefusals = 14
	pagesetRecordSHA256   = "420015134d2d3ee8861ee97e449a06e7bed3268d30492e34cdcd0b74012a5c2c"
	pagesetFixtureTenant  = "fixture-tenant"
	pagesetRuns           = 5
	pagesetConc           = 4
	pagesetSlowN          = 8
	pagesetP95MS          = 500.0
	pagesetProfileEnv     = "YAKKA_PAGESET_PROFILE"
)

type recordedRequest struct {
	Method string      `json:"method"`
	Path   string      `json:"path"`
	Query  [][2]string `json:"query"`
}

type recordedScenario struct {
	Label    string            `json:"label"`
	Route    string            `json:"route"`
	Requests []recordedRequest `json:"requests"`
}

type recordedShapes struct {
	Version   int                `json:"version"`
	Note      string             `json:"note"`
	Scenarios []recordedScenario `json:"scenarios"`
}

type pageRequest struct {
	Name string
	Path string
}

func (r recordedRequest) urlPath() string {
	v := url.Values{}
	for _, kv := range r.Query {
		v.Add(kv[0], kv[1])
	}
	if len(v) == 0 {
		return r.Path
	}
	return r.Path + "?" + v.Encode()
}

// loadPagesetRecord reads the committed browser record with a strict parser, verifies the pinned
// digest and request count, and validates every entry before any request is issued.
func loadPagesetRecord(t *testing.T) recordedShapes {
	t.Helper()
	b, err := os.ReadFile(pagesetRecordPath)
	if err != nil {
		t.Fatalf("read committed browser record: %v", err)
	}
	sum := sha256.Sum256(b)
	if got := hex.EncodeToString(sum[:]); got != pagesetRecordSHA256 {
		t.Fatalf("browser record digest %s, want %s", got, pagesetRecordSHA256)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var rec recordedShapes
	if err := dec.Decode(&rec); err != nil {
		t.Fatalf("parse committed browser record: %v", err)
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		t.Fatalf("browser record has trailing data: %v", err)
	}
	if rec.Version != 1 {
		t.Fatalf("browser record version %d, want 1", rec.Version)
	}
	if len(rec.Scenarios) == 0 {
		t.Fatal("browser record has no scenarios")
	}
	total, allHistory := 0, 0
	for _, s := range rec.Scenarios {
		if s.Label == "" || !strings.HasPrefix(s.Route, "/b/") {
			t.Fatalf("scenario %q has bad label or route %q", s.Label, s.Route)
		}
		if len(s.Requests) == 0 {
			t.Fatalf("scenario %q has no requests", s.Label)
		}
		for _, r := range s.Requests {
			if r.Method != http.MethodGet {
				t.Fatalf("%s: method %q, want GET", s.Label, r.Method)
			}
			if !strings.HasPrefix(r.Path, "/v1/analytics/") {
				t.Fatalf("%s: path %q is not an analytics route", s.Label, r.Path)
			}
			for _, kv := range r.Query {
				if kv[0] == "" {
					t.Fatalf("%s: empty query key", s.Label)
				}
				if kv[0] == "all" && kv[1] == "1" {
					allHistory++
				}
			}
			total++
		}
	}
	if total != pagesetRecordRequests {
		t.Fatalf("browser record has %d requests, want pinned %d", total, pagesetRecordRequests)
	}
	if allHistory == 0 {
		t.Fatal("browser record has no canonical all=1 request")
	}
	t.Logf("browser record: %d scenarios, %d requests, %d all=1", len(rec.Scenarios), total, allHistory)
	return rec
}

func pagesetCases(rec recordedShapes) []pageRequest {
	var out []pageRequest
	for _, s := range rec.Scenarios {
		for i, r := range s.Requests {
			out = append(out, pageRequest{
				Name: fmt.Sprintf("%s#%d", s.Label, i),
				Path: r.urlPath(),
			})
		}
	}
	return out
}

// pagesetFixtureServer generates the deterministic committed fixture into a temporary directory and
// returns a handler whose only tenant is fixture-tenant, the tenant the recorded shapes name.
func pagesetFixtureServer(t *testing.T) *benchHarness {
	t.Helper()
	data := t.TempDir()
	dst := filepath.Join(data, pagesetFixtureTenant)
	if _, err := analyticsfixture.Create(context.Background(), dst); err != nil {
		t.Fatalf("generate analytics fixture: %v", err)
	}
	s := New(Config{Data: data, Keys: []KeyPair{{pagesetFixtureTenant, benchKey}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant(pagesetFixtureTenant)
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

type pagesetResult struct {
	name string
	path string
	d    time.Duration
	code int
	body string
}

// pagesetCapabilityRefusal reports whether a response is the documented capability-degradation
// path: HTTP 400 whose error names an unsupported dimension, field, mode, check or scorer (or an
// unknown check/scorer, which the score routes use). Any other status, or a 400 whose message does
// not name a capability, is a failure rather than a refusal.
func pagesetCapabilityRefusal(status int, body string) bool {
	if status != http.StatusBadRequest {
		return false
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return false
	}
	msg := strings.ToLower(payload.Error)
	if strings.Contains(msg, "unsupported") {
		for _, cap := range []string{"dimension", "field", "mode", "check", "scorer"} {
			if strings.Contains(msg, cap) {
				return true
			}
		}
	}
	if strings.Contains(msg, "unknown") {
		for _, cap := range []string{"check", "scorer"} {
			if strings.Contains(msg, cap) {
				return true
			}
		}
	}
	return false
}

// pagesetClassify issues the full recorded set once and separates served (200) cases from
// documented capability refusals. It fails on any 5xx, unexpected 4xx, or unnamed refusal. The
// served slice preserves record order.
func pagesetClassify(t *testing.T, h *benchHarness, reqs []pageRequest) (served []pageRequest, refused int) {
	t.Helper()
	for _, r := range pagesetRunOnce(t, h, reqs) {
		switch {
		case r.code == http.StatusOK:
			served = append(served, pageRequest{Name: r.name, Path: r.path})
		case pagesetCapabilityRefusal(r.code, r.body):
			refused++
		default:
			t.Errorf("%s %s: status %d: %s", r.name, r.path, r.code, r.body)
		}
	}
	return served, refused
}

// pagesetRunOnce issues every request with the p95 contract's concurrency of 4.
func pagesetRunOnce(t *testing.T, h *benchHarness, reqs []pageRequest) []pagesetResult {
	res := make([]pagesetResult, len(reqs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, pagesetConc)
	for i := range reqs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			code, body := do(t, h.h, http.MethodGet, reqs[i].Path, benchKey, "")
			res[i] = pagesetResult{reqs[i].Name, reqs[i].Path, time.Since(start), code, body}
		}(i)
	}
	wg.Wait()
	return res
}

type pagesetTiming struct {
	name, path string
	status     int
	p95, max   time.Duration
	samples    int
	body       string
}

// pagesetMeasure times each case pagesetRuns times, discards the first run and ranks by p95.
// Cases are keyed by their recorded position, so duplicate request paths stay distinct cases.
func pagesetMeasure(t *testing.T, h *benchHarness, reqs []pageRequest) []pagesetTiming {
	times := make([][]time.Duration, len(reqs))
	status := make([]int, len(reqs))
	bodies := make([]string, len(reqs))
	for run := 0; run < pagesetRuns; run++ {
		for i, r := range pagesetRunOnce(t, h, reqs) {
			if run == 0 {
				continue
			}
			times[i] = append(times[i], r.d)
			status[i] = r.code
			bodies[i] = r.body
		}
	}
	out := make([]pagesetTiming, 0, len(reqs))
	for i := range reqs {
		sort.Slice(times[i], func(a, b int) bool { return times[i][a] < times[i][b] })
		out = append(out, pagesetTiming{
			name: reqs[i].Name, path: reqs[i].Path, status: status[i],
			p95: nearestRank(times[i], 0.95), max: times[i][len(times[i])-1],
			samples: len(times[i]), body: bodies[i],
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].p95 != out[j].p95 {
			return out[i].p95 > out[j].p95
		}
		return out[i].name < out[j].name
	})
	return out
}

func pagesetMS(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

// TestAnalyticsPageSet is the opt-in profiler (skipped unless YAKKA_PAGESET_PROFILE=fixture).
func TestAnalyticsPageSet(t *testing.T) {
	if os.Getenv(pagesetProfileEnv) != "fixture" {
		t.Skip("set YAKKA_PAGESET_PROFILE=fixture to profile the recorded page request shapes")
	}
	rec := loadPagesetRecord(t)
	all := pagesetCases(rec)
	if len(all) != pagesetRecordRequests {
		t.Fatalf("record has %d cases, want the recorded request count %d", len(all), pagesetRecordRequests)
	}
	h := pagesetFixtureServer(t)
	served, refused := pagesetClassify(t, h, all)
	if len(served)+refused != len(all) {
		t.Fatalf("classified %d served + %d refused, want %d recorded cases", len(served), refused, len(all))
	}
	timings := pagesetMeasure(t, h, served)
	if len(timings) != len(served) {
		t.Fatalf("profiled %d cases, want %d served cases", len(timings), len(served))
	}
	t.Logf("page request-set profile: %d recorded cases across %d scenarios; %d served cases timed, %d documented capability refusals excluded; %d timed runs each, concurrency %d, bound p95<=%.0fms, fixture %s",
		len(all), len(rec.Scenarios), len(served), refused, pagesetRuns-1, pagesetConc, pagesetP95MS, pagesetFixtureTenant)

	maxP95 := 0.0
	for _, tm := range timings {
		ms := pagesetMS(tm.p95)
		if ms > maxP95 {
			maxP95 = ms
		}
		t.Logf("%-24s p95=%7.1fms max=%7.1fms status=%d %s",
			tm.name, ms, pagesetMS(tm.max), tm.status, tm.path)
		if tm.status != 200 {
			t.Errorf("%s returned %d: %s", tm.name, tm.status, tm.body)
		}
		if ms > pagesetP95MS {
			t.Errorf("%s p95 %.1f ms over %.0f ms", tm.name, ms, pagesetP95MS)
		}
	}
	t.Logf("max p95 %.1f ms across %d cases (bound %.0f ms)", maxP95, len(timings), pagesetP95MS)

	n := pagesetSlowN
	if n > len(timings) {
		n = len(timings)
	}
	for i := 0; i < n; i++ {
		tm := timings[i]
		if !pagesetExplainable(tm.path) {
			t.Logf("plan %s: skipped (no explicit from/to window or route)", tm.path)
			continue
		}
		plan, err := pagesetExplain(h.db, tm.path)
		if err != nil {
			t.Errorf("explain %s: %v", tm.name, err)
			continue
		}
		t.Logf("plan %s:\n  %s", tm.path, strings.Join(plan, "\n  "))
	}
}

// TestAnalyticsPageSetSmoke is the ungated self-test: on the deterministic committed fixture it
// requires every recorded request to return 200 or a documented capability refusal and asserts the
// exact served/refusal split, so the record cannot rot unnoticed.
func TestAnalyticsPageSetSmoke(t *testing.T) {
	rec := loadPagesetRecord(t)
	reqs := pagesetCases(rec)
	if len(reqs) != pagesetRecordRequests {
		t.Fatalf("built %d cases, want the recorded request count %d", len(reqs), pagesetRecordRequests)
	}
	h := pagesetFixtureServer(t)
	served, refused := pagesetClassify(t, h, reqs)
	if len(served) != pagesetRecordServed || refused != pagesetRecordRefusals {
		t.Errorf("200/refusal split = %d/%d, want %d/%d over %d recorded requests",
			len(served), refused, pagesetRecordServed, pagesetRecordRefusals, len(reqs))
	}
	t.Logf("browser record smoke: %d requests across %d scenarios = %d served (200) + %d documented capability refusals (400)",
		len(reqs), len(rec.Scenarios), len(served), refused)
}

func pagesetExplainable(path string) bool {
	u, err := url.Parse(path)
	if err != nil {
		return false
	}
	if u.Query().Get("from") == "" || u.Query().Get("to") == "" {
		return false
	}
	return strings.HasSuffix(u.Path, "/query") || strings.HasSuffix(u.Path, "/summary")
}

// The EXPLAIN helpers reproduce, for the slowest requests only, the SQL the store runs so its plan
// can be read. They mirror query.go's measureDef.source (interior rollup hours plus the two base-row
// edge hours), usage.go's usageRowsWhere CTE and the rollup path of analytics.go's Summary.

type pagesetDef struct {
	table, pred, distinct, rollup, rollupType string
	rollupCols                                []string
	weighted                                  bool
}

func pagesetDefOf(name string) (pagesetDef, bool) {
	switch name {
	case "hook_events":
		return pagesetDef{table: "facts", pred: "type='hook_event'", rollup: "hook_events_hourly", rollupType: "hook_event",
			rollupCols: []string{"harness", "repo_id", "norm_event", "event", "tool", "conversation_id"}, weighted: true}, true
	case "conversations":
		return pagesetDef{table: "facts", distinct: "conversation_id", rollup: "conversations_hourly",
			rollupCols: []string{"harness", "repo_id", "model", "conversation_id"}}, true
	case "artifact_versions":
		return pagesetDef{table: "facts", pred: "type='artifact_version'"}, true
	case "distinct_content":
		return pagesetDef{table: "facts", pred: "type='artifact_version'", distinct: "content_hash"}, true
	case "commits":
		return pagesetDef{table: "facts", pred: "type='commit'"}, true
	}
	return pagesetDef{}, false
}

var pagesetIsUsage = map[string]bool{
	"model_calls": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true,
	"tokens_cache_write": true, "tokens_reasoning": true, "cost_usd": true, "unpriced_calls": true,
}

var pagesetFactCol = map[string]string{
	"harness": "harness", "repo_id": "repo_id", "norm_event": "norm_event", "event": "event",
	"tool": "tool", "conversation_id": "conversation_id", "model": "model", "kind": "kind",
	"plan": "plan", "source": "source",
}

func (d pagesetDef) agg() string {
	if d.distinct != "" {
		return "count(DISTINCT " + d.distinct + ")"
	}
	if d.weighted {
		return "coalesce(sum(w),0)"
	}
	return "count(*)"
}

func (d pagesetDef) source(from, to int64) string {
	if d.rollup == "" {
		return d.table
	}
	hF := from - from%3600
	hT := to - to%3600
	proj := func(te, w string) string {
		var b strings.Builder
		if d.rollupType != "" {
			b.WriteString("'" + d.rollupType + "' AS type, ")
		}
		b.WriteString(te + " AS ts, " + strings.Join(d.rollupCols, ", "))
		if d.weighted {
			b.WriteString(", " + w + " AS w")
		}
		return b.String()
	}
	base := func(lo, hi int64) string {
		p := ""
		if d.pred != "" {
			p = d.pred + " AND "
		}
		return fmt.Sprintf("SELECT %s FROM facts WHERE %sts >= %d AND ts <= %d", proj("ts", "1"), p, lo, hi)
	}
	if hF == hT {
		return "(" + base(from, to) + ")"
	}
	b1 := fmt.Sprintf("SELECT %s FROM facts WHERE %sts >= %d AND ts < %d",
		proj("ts", "1"), pagesetPred(d.pred), from, hF+3600)
	b2 := fmt.Sprintf("SELECT %s FROM facts WHERE %sts >= %d AND ts <= %d",
		proj("ts", "1"), pagesetPred(d.pred), hT, to)
	roll := fmt.Sprintf("SELECT %s FROM %s WHERE hour > %d AND hour < %d", proj("hour", "n"), d.rollup, hF, hT)
	return "(" + b1 + " UNION ALL " + b2 + " UNION ALL " + roll + ")"
}

func pagesetPred(pred string) string {
	if pred == "" {
		return ""
	}
	return pred + " AND "
}

func pagesetBucketExpr(bucket string) string {
	switch bucket {
	case "hour":
		return "strftime('%Y-%m-%dT%H:00:00', ts, 'unixepoch') || 'Z'"
	case "day":
		return "strftime('%Y-%m-%dT00:00:00', ts, 'unixepoch') || 'Z'"
	case "week":
		return "date(ts, 'unixepoch', 'weekday 0', '-6 days') || 'T00:00:00Z'"
	case "month":
		return "strftime('%Y-%m-01T00:00:00', ts, 'unixepoch') || 'Z'"
	}
	return "''"
}

func pagesetQueryExplain(d pagesetDef, dims []string, bucket string, from, to int64) string {
	src := d.source(from, to)
	where := fmt.Sprintf("ts >= %d AND ts <= %d", from, to)
	var sel, grp []string
	for i, dim := range dims {
		var e string
		switch dim {
		case "hour_of_day":
			e = "strftime('%H', ts, 'unixepoch')"
		case "weekday":
			e = "strftime('%w', ts, 'unixepoch')"
		default:
			e = pagesetFactCol[dim]
		}
		al := fmt.Sprintf("k%d", i)
		sel = append(sel, e+" AS "+al)
		grp = append(grp, al)
	}
	if bucket != "" && bucket != "none" {
		sel = append(sel, pagesetBucketExpr(bucket)+" AS t")
		grp = append(grp, "t")
	}
	sel = append(sel, d.agg()+" AS v")
	query := "SELECT " + strings.Join(sel, ", ") + " FROM " + src + " WHERE " + where
	if len(grp) > 0 {
		query += " GROUP BY " + strings.Join(grp, ", ")
	}
	return query
}

func pagesetUsageExplain(from, to int64) string {
	mid := "CASE WHEN harness = 'claude' THEN json_extract(raw, '$.backfill.ref') END"
	where := fmt.Sprintf("ts >= %d AND ts <= %d", from, to)
	return "WITH usage_u AS (SELECT *, " + mid + " AS _mid FROM facts WHERE type = 'hook_event' AND norm_event = 'usage' AND " + where + "), " +
		"kept AS (SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY conversation_id, _mid ORDER BY tok_out DESC, row_hash ASC) AS _rn FROM usage_u) WHERE _mid IS NULL OR _mid = '' OR _rn = 1) " +
		"SELECT count(*) FROM kept"
}

func pagesetSummaryExplain(from, to int64) string {
	hF := from - from%3600
	hT := to - to%3600
	if hF == hT {
		return fmt.Sprintf("SELECT count(*) FROM facts WHERE type='hook_event' AND ts >= %d AND ts <= %d", from, to)
	}
	return fmt.Sprintf("SELECT COALESCE(SUM(n),0) FROM ("+
		"SELECT n FROM hook_events_hourly WHERE hour > %d AND hour < %d "+
		"UNION ALL SELECT count(*) FROM facts WHERE type='hook_event' AND ts >= %d AND ts < %d "+
		"UNION ALL SELECT count(*) FROM facts WHERE type='hook_event' AND ts >= %d AND ts <= %d)",
		hF, hT, from, hF+3600, hT, to)
}

type pagesetStmt struct {
	label, sql string
}

func pagesetExplain(db *sql.DB, path string) ([]string, error) {
	u, err := url.Parse(path)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	from, err := time.Parse(time.RFC3339, q.Get("from"))
	if err != nil {
		return nil, err
	}
	to, err := time.Parse(time.RFC3339, q.Get("to"))
	if err != nil {
		return nil, err
	}
	f, tt := from.Unix(), to.Unix()
	var stmts []pagesetStmt
	switch {
	case strings.HasSuffix(u.Path, "/summary"):
		// Summary runs several statements; the two dominant ones are shown. The rollup/edge union
		// answers the classification question; the usage CTE is the same base-row dedupe the usage
		// queries run.
		stmts = append(stmts,
			pagesetStmt{"summary.hook_events", pagesetSummaryExplain(f, tt)},
			pagesetStmt{"summary.usage", pagesetUsageExplain(f, tt)})
	case pagesetIsUsage[q.Get("measure")]:
		stmts = append(stmts, pagesetStmt{"usage", pagesetUsageExplain(f, tt)})
	default:
		def, ok := pagesetDefOf(q.Get("measure"))
		if !ok {
			return nil, fmt.Errorf("no definition for measure %q", q.Get("measure"))
		}
		stmts = append(stmts, pagesetStmt{"query", pagesetQueryExplain(def, q["dim"], q.Get("bucket"), f, tt)})
	}
	var out []string
	for _, st := range stmts {
		rows, err := db.Query("EXPLAIN QUERY PLAN " + st.sql)
		if err != nil {
			return nil, fmt.Errorf("%v: %s", err, st.sql)
		}
		for rows.Next() {
			var id, parent, notused int
			var detail string
			if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, st.label+": "+strings.TrimSpace(detail))
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}
