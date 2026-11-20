package serve

// Retained-history workload harness for Plan 29 Phase 2. It replays the committed request shapes
// against either the deterministic synthetic retained workload or an explicit prepared-ledger
// copy, records workload characteristics, query plans, alone and four-in-flight p95, and proves
// that a cancelled request releases its reader. Nothing here changes product query code or the
// one-second analytics deadline.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
	retainedProfileEnv   = "YAKKA_RETAINED_PROFILE"
	retainedShapeEnv     = "YAKKA_RETAINED_SHAPE"
	retainedRunsEnv      = "YAKKA_RETAINED_RUNS"
	retainedLedgerEnv    = "YAKKA_RETAINED_LEDGER"
	retainedOutEnv       = "YAKKA_RETAINED_OUT"
	retainedRebuildEnv   = "YAKKA_RETAINED_REBUILD"
	retainedRecordPath   = "testdata/retained-request-shapes.json"
	retainedOutPath      = "testdata/retained-workload.json"
	retainedRuns         = 20
	retainedP95MS        = 500.0
	retainedLoadInFlight = 4
)

type retainedShape struct {
	Label   string `json:"label"`
	Path    string `json:"path"`
	Expect  string `json:"expect"`
	RowsEq  int    `json:"rows_eq"`
	MinRows int    `json:"min_rows"`
	Oracle  string `json:"oracle"`
}

type retainedShapeRecord struct {
	Version  int             `json:"version"`
	Note     string          `json:"note"`
	FrozenTo string          `json:"frozen_to"`
	Shapes   []retainedShape `json:"shapes"`
}

type retainedHarness struct {
	*benchHarness
	summary   analyticsfixture.RetainedSummary
	synthetic bool
	source    string
	copyMS    float64
	genMS     float64
	openMS    float64
}

type retainedTiming struct {
	status int
	rows   int
	times  []time.Duration
}

func (x retainedTiming) p95() float64 {
	sort.Slice(x.times, func(i, j int) bool { return x.times[i] < x.times[j] })
	return float64(nearestRank(x.times, 0.95)) / float64(time.Millisecond)
}

func (x retainedTiming) maxMS() float64 {
	var max time.Duration
	for _, d := range x.times {
		if d > max {
			max = d
		}
	}
	return float64(max) / float64(time.Millisecond)
}

type retainedShapeResult struct {
	Label          string  `json:"label"`
	Path           string  `json:"path"`
	Expect         string  `json:"expect"`
	Oracle         string  `json:"oracle"`
	AloneStatus    int     `json:"alone_status"`
	AloneRows      int     `json:"alone_rows"`
	AloneP95MS     float64 `json:"alone_p95_ms"`
	AloneMaxMS     float64 `json:"alone_max_ms"`
	LoadStatus     int     `json:"load_status"`
	LoadRows       int     `json:"load_rows"`
	LoadP95MS      float64 `json:"load_p95_ms"`
	LoadMaxMS      float64 `json:"load_max_ms"`
	Classification string  `json:"classification"`
}

type retainedCancelResult struct {
	Attempts           int     `json:"attempts"`
	DeadlineMS         float64 `json:"deadline_ms"`
	Status             int     `json:"status"`
	ElapsedMS          float64 `json:"elapsed_ms"`
	ContextCanceled    bool    `json:"context_canceled"`
	ReaderReleased     bool    `json:"reader_released"`
	FollowingStatus    int     `json:"following_status"`
	FollowingRows      int     `json:"following_rows"`
	FollowingSucceeded bool    `json:"following_succeeded"`
}

type retainedExplainLine struct {
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

type retainedRecord struct {
	Version      int                              `json:"version"`
	Phase        string                           `json:"phase"`
	Source       string                           `json:"source"`
	Runs         int                              `json:"runs"`
	Workload     analyticsfixture.RetainedSummary `json:"workload"`
	CopyMS       float64                          `json:"copy_ms"`
	GenerateMS   float64                          `json:"generate_ms"`
	OpenMS       float64                          `json:"open_ms"`
	Shapes       []retainedShapeResult            `json:"shapes"`
	Cancellation retainedCancelResult             `json:"cancellation"`
	Explain      []retainedExplainLine            `json:"explain"`
}

func retainedWorktree(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Clean(filepath.Join(wd, "..", "..", "..", ".."))
}

func retainedScratch(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(retainedWorktree(t), ".scratch", "plan29-phase2")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func loadRetainedShapes(t *testing.T) retainedShapeRecord {
	t.Helper()
	b, err := os.ReadFile(retainedRecordPath)
	if err != nil {
		t.Fatal(err)
	}
	var rec retainedShapeRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		t.Fatalf("retained shape record: %v", err)
	}
	if rec.Version != 1 || len(rec.Shapes) == 0 {
		t.Fatalf("retained shape record version %d with %d shapes", rec.Version, len(rec.Shapes))
	}
	seen := map[string]bool{}
	for _, s := range rec.Shapes {
		if s.Label == "" || s.Path == "" || s.Expect == "" || s.Oracle == "" {
			t.Fatalf("incomplete retained shape: %+v", s)
		}
		if seen[s.Label] {
			t.Fatalf("duplicate retained shape label %q", s.Label)
		}
		seen[s.Label] = true
		if s.Expect != "rows" && s.Expect != "rows_eq" && s.Expect != "refusal" {
			t.Fatalf("retained shape %s has unknown expect %q", s.Label, s.Expect)
		}
	}
	return rec
}

func openRetainedHarness(t *testing.T) *retainedHarness {
	t.Helper()
	scratch := retainedScratch(t)
	if src := os.Getenv(retainedLedgerEnv); src != "" {
		if strings.Contains(strings.ToLower(src), "plan28") {
			t.Fatalf("%s refuses a Plan 28 trial path", retainedLedgerEnv)
		}
		dataRoot := filepath.Join(scratch, "ledger-copy")
		dst := filepath.Join(dataRoot, benchTenant)
		copyMS := copyRetainedLedger(t, src, dst)
		h, openMS := newRetainedServer(t, dataRoot)
		return &retainedHarness{
			benchHarness: h, summary: retainedLedgerSummary(t, h.db), synthetic: false,
			source: "prepared-copy", copyMS: copyMS, openMS: openMS,
		}
	}
	dataRoot := filepath.Join(scratch, "synthetic")
	if os.Getenv(retainedRebuildEnv) == "1" {
		if err := os.RemoveAll(dataRoot); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(dataRoot, benchTenant)
	start := time.Now()
	summary, err := analyticsfixture.CreateRetained(context.Background(), dir)
	if err != nil {
		t.Fatalf("CreateRetained: %v", err)
	}
	genMS := float64(time.Since(start)) / float64(time.Millisecond)
	h, openMS := newRetainedServer(t, dataRoot)
	return &retainedHarness{
		benchHarness: h, summary: summary, synthetic: true,
		source: "synthetic", genMS: genMS, openMS: openMS,
	}
}

func copyRetainedLedger(t *testing.T, srcDir, dstDir string) float64 {
	t.Helper()
	start := time.Now()
	if err := os.RemoveAll(dstDir); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dstDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ledger.db", "ledger.db-wal", "ledger.db-shm"} {
		src := filepath.Join(srcDir, name)
		fi, err := os.Stat(src)
		if os.IsNotExist(err) {
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
		in, err := os.Open(src)
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		out, err := os.Create(filepath.Join(dstDir, name))
		if err != nil {
			in.Close()
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := io.Copy(out, in); err != nil {
			in.Close()
			out.Close()
			t.Fatalf("copy %s: %v", name, err)
		}
		in.Close()
		if err := out.Close(); err != nil {
			t.Fatalf("close %s: %v", name, err)
		}
	}
	return float64(time.Since(start)) / float64(time.Millisecond)
}

func newRetainedServer(t *testing.T, dataRoot string) (*benchHarness, float64) {
	t.Helper()
	s := New(Config{Data: dataRoot, Keys: []KeyPair{{benchTenant, benchKey}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	start := time.Now()
	ts, err := s.tenant(benchTenant)
	if err != nil {
		t.Fatal(err)
	}
	openMS := float64(time.Since(start)) / float64(time.Millisecond)
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dataRoot, benchTenant, "ledger.db")+
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return &benchHarness{srv: s, h: s.Handler(), ts: ts, db: db}, openMS
}

// retainedLedgerSummary derives the same oracle fields from a prepared copy without trusting the
// synthetic generator.
func retainedLedgerSummary(t *testing.T, db *sql.DB) analyticsfixture.RetainedSummary {
	t.Helper()
	var s analyticsfixture.RetainedSummary
	s.Version = analyticsfixture.RetainedVersion
	s.Seed = "prepared-ledger"
	q := func(dst any, query string, args ...any) {
		if err := db.QueryRow(query, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	q(&s.Generated.Facts, `SELECT COUNT(*) FROM facts`)
	q(&s.Generated.HookEvents, `SELECT COUNT(*) FROM facts WHERE type='hook_event'`)
	q(&s.Generated.UsageCalls, `SELECT COUNT(*) FROM facts WHERE norm_event='usage'`)
	q(&s.Generated.ArtifactVersions, `SELECT COUNT(*) FROM facts WHERE type='artifact_version'`)
	q(&s.Generated.Commits, `SELECT COUNT(*) FROM facts WHERE type='commit'`)
	q(&s.Generated.Sessions, `SELECT COUNT(DISTINCT conversation_id) FROM facts`)
	q(&s.Generated.PlanIdentities, `SELECT COUNT(*) FROM (SELECT repo_id,plan FROM facts WHERE type='artifact_version' AND plan<>'' GROUP BY repo_id,plan)`)
	q(&s.Generated.ArtifactFiles, `SELECT COUNT(*) FROM (SELECT repo_id,path FROM facts WHERE type='artifact_version' GROUP BY repo_id,path)`)
	q(&s.Generated.PlanSessionAssociations, `SELECT COUNT(*) FROM (SELECT DISTINCT a.repo_id,a.plan,s.conversation_id FROM facts a JOIN facts s ON s.conversation_id=a.conversation_id WHERE a.type='artifact_version' AND a.plan<>'')`)
	q(&s.Generated.HarnessModelGroups, `SELECT COUNT(*) FROM (SELECT DISTINCT harness,model FROM facts WHERE norm_event='usage')`)
	q(&s.Generated.Scores, `SELECT COUNT(*) FROM scores`)
	q(&s.Generated.ScoredContent, `SELECT COUNT(DISTINCT content_hash) FROM scores`)
	q(&s.Generated.Checks, `SELECT COUNT(DISTINCT check_name) FROM scores`)
	q(&s.Oracle.MinFactTS, `SELECT COALESCE(CAST(MIN(ts) AS INTEGER),0) FROM facts`)
	q(&s.Oracle.MaxFactTS, `SELECT COALESCE(CAST(MAX(ts) AS INTEGER),0) FROM facts`)
	q(&s.Oracle.LatestUsageTS, `SELECT COALESCE(CAST(MAX(ts) AS INTEGER),0) FROM facts WHERE norm_event='usage'`)
	var maxPlanRepo, maxPlan string
	var maxSessions int
	if err := db.QueryRow(`SELECT repo_id,plan,COUNT(DISTINCT conversation_id) n FROM facts WHERE type='artifact_version' AND plan<>'' GROUP BY repo_id,plan ORDER BY n DESC,repo_id ASC,plan ASC LIMIT 1`).Scan(&maxPlanRepo, &maxPlan, &maxSessions); err == nil {
		s.Oracle.MaxSessionsPerPlan, s.Oracle.MaxSessionsPlanRepo, s.Oracle.MaxSessionsPlan = maxSessions, maxPlanRepo, maxPlan
	}
	var maxSess string
	var maxPlans int
	if err := db.QueryRow(`SELECT conversation_id,COUNT(DISTINCT repo_id||char(1)||plan) n FROM facts WHERE type='artifact_version' AND plan<>'' GROUP BY conversation_id ORDER BY n DESC,conversation_id ASC LIMIT 1`).Scan(&maxSess, &maxPlans); err == nil {
		s.Oracle.MaxPlansPerSession, s.Oracle.MaxPlansSession = maxPlans, maxSess
	}
	s.Oracle.HarnessModelGroups = s.Generated.HarnessModelGroups
	s.Oracle.ScoredContent = s.Generated.ScoredContent
	s.Oracle.Scores = s.Generated.Scores
	s.Oracle.ShapeOracle = map[string]int{
		"plan_population":      s.Generated.PlanIdentities,
		"plan_associations":    s.Generated.PlanSessionAssociations,
		"plan_detail_sessions": s.Oracle.MaxSessionsPerPlan,
		"session_plans":        s.Oracle.MaxPlansPerSession,
		"usage_groups":         s.Generated.HarnessModelGroups,
		"scored_content":       s.Generated.ScoredContent,
		"artifact_files":       s.Generated.ArtifactFiles,
		"sessions":             s.Generated.Sessions,
		"usage_calls":          s.Generated.UsageCalls,
	}
	return s
}

func retainedRowCount(body string) int {
	var m map[string]any
	if json.Unmarshal([]byte(body), &m) != nil {
		return 0
	}
	for _, key := range []string{"rows", "events", "groups"} {
		if v, ok := m[key].([]any); ok {
			return len(v)
		}
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

func validateRetainedShape(t *testing.T, shape retainedShape, status int, body string, rows int, summary analyticsfixture.RetainedSummary) {
	t.Helper()
	switch shape.Expect {
	case "rows":
		want := shape.MinRows
		if want < 1 {
			want = 1
		}
		if rows < want {
			t.Errorf("%s: %d rows, want at least %d (oracle %s)", shape.Label, rows, want, shape.Oracle)
		}
	case "rows_eq":
		if rows != shape.RowsEq {
			t.Errorf("%s: %d rows, want exactly %d", shape.Label, rows, shape.RowsEq)
		}
	case "refusal":
		if !pagesetCapabilityRefusal(status, body) {
			t.Errorf("%s: status %d is not a documented capability refusal: %s", shape.Label, status, body)
		}
	}
	switch shape.Oracle {
	case "plan_population":
		if n := summary.Generated.PlanIdentities; n > 0 && rows > n {
			t.Errorf("%s: %d rows exceeds the %d plan identities", shape.Label, rows, n)
		}
	case "usage_groups":
		if n := summary.Generated.HarnessModelGroups; n > 0 && shape.Label != "cost-treemap-harness-model" && rows > n*4 {
			t.Errorf("%s: %d rows exceeds four times the %d harness/model groups", shape.Label, rows, n)
		}
	case "sessions":
		if n := summary.Generated.Sessions; n > 0 && rows > n {
			t.Errorf("%s: %d rows exceeds the %d sessions", shape.Label, rows, n)
		}
	case "scored_content":
		if n := summary.Generated.ScoredContent; n > 0 && rows > n {
			t.Errorf("%s: %d rows exceeds the %d scored content hashes", shape.Label, rows, n)
		}
	}
}

// TestAnalyticsRetainedWorkloadSmoke is the ungated synthetic-scale replay. It records pre-fix
// query failures (500/503) instead of treating them as empty data, and fails a 400 for a supported
// shape or a 200 whose row count disagrees with the oracle.
func TestAnalyticsRetainedWorkloadSmoke(t *testing.T) {
	h := openRetainedHarness(t)
	rec := loadRetainedShapes(t)
	filter := os.Getenv(retainedShapeEnv)
	failures := 0
	for _, shape := range rec.Shapes {
		if filter != "" && !strings.Contains(shape.Label, filter) {
			continue
		}
		status, body := do(t, h.h, http.MethodGet, shape.Path, benchKey, "")
		rows := retainedRowCount(body)
		switch {
		case status == http.StatusOK:
			validateRetainedShape(t, shape, status, body, rows, h.summary)
		case status == http.StatusInternalServerError || status == http.StatusServiceUnavailable:
			failures++
			t.Logf("%s: recorded pre-fix query failure status=%d rows=%d", shape.Label, status, rows)
		case shape.Expect == "refusal" && pagesetCapabilityRefusal(status, body):
			t.Logf("%s: documented capability refusal status=%d", shape.Label, status)
		case status == http.StatusBadRequest:
			t.Errorf("%s: 400 for a supported shape: %s", shape.Label, body)
		default:
			t.Errorf("%s: unexpected status %d: %s", shape.Label, status, body)
		}
	}
	t.Logf("retained smoke: %d shapes, %d recorded pre-fix query failures, source=%s", len(rec.Shapes), failures, h.source)
	if h.synthetic {
		validateRetainedMixedAttribution(t, h)
	}
}

func validateRetainedMixedAttribution(t *testing.T, h *retainedHarness) {
	t.Helper()
	to := time.Unix(h.summary.Oracle.MaxFactTS, 0).UTC().Format(time.RFC3339)
	path := "/v1/analytics/entities?grain=plan&limit=500&sort=last_ts%3Adesc&all=1&to=" + to
	status, body := do(t, h.h, http.MethodGet, path, benchKey, "")
	if status != 200 {
		t.Logf("mixed attribution: plan list status=%d; oracle not compared", status)
		return
	}
	var out struct {
		Rows []struct {
			ID struct {
				RepoID string `json:"repo_id"`
				Plan   string `json:"plan"`
			} `json:"id"`
			M struct {
				AssociatedCostUSD *float64 `json:"associated_cost_usd"`
				UnpricedCalls     int      `json:"unpriced_calls"`
			} `json:"m"`
		} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("mixed attribution plan list: %v", err)
	}
	found := false
	for _, row := range out.Rows {
		if row.ID.RepoID != h.summary.Oracle.MixedRepoID || row.ID.Plan != h.summary.Oracle.MixedPlan {
			continue
		}
		found = true
		if row.M.AssociatedCostUSD == nil {
			t.Fatalf("mixed plan %s/%s has null associated cost", row.ID.RepoID, row.ID.Plan)
		}
		if diff := *row.M.AssociatedCostUSD - h.summary.Oracle.MixedPlanAssociatedCostUSD; diff > 1e-9 || diff < -1e-9 {
			t.Errorf("mixed plan associated cost = %.12f, oracle %.12f", *row.M.AssociatedCostUSD, h.summary.Oracle.MixedPlanAssociatedCostUSD)
		}
	}
	if !found {
		t.Errorf("mixed plan %s/%s absent from the 500-row plan list", h.summary.Oracle.MixedRepoID, h.summary.Oracle.MixedPlan)
	}
	var events int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM facts WHERE conversation_id=? AND norm_event='usage' AND repo_id='' AND cost_reported IS NULL`, h.summary.Oracle.MixedSession).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events == 0 {
		t.Errorf("mixed session %s has no priced usage call with empty raw repo_id", h.summary.Oracle.MixedSession)
	}
}

func retainedSample(t *testing.T, h http.Handler, path string) (time.Duration, int, int) {
	start := time.Now()
	status, body := do(t, h, http.MethodGet, path, benchKey, "")
	return time.Since(start), status, retainedRowCount(body)
}

func retainedTimingFor(t *testing.T, h http.Handler, path string, runs int) retainedTiming {
	out := retainedTiming{times: make([]time.Duration, 0, runs)}
	retainedSample(t, h, path) // discarded warm-up
	for i := 0; i < runs; i++ {
		d, status, rows := retainedSample(t, h, path)
		out.times = append(out.times, d)
		out.status, out.rows = status, rows
	}
	return out
}

// retainedLoadSample issues the measured shape together with three board streams, four requests
// in flight, the concurrency the p95 contract was measured at. It returns the measured shape's
// timing even when another in-flight request is the one that times out.
func retainedLoadSample(t *testing.T, h http.Handler, path string, load []string) (time.Duration, int, int) {
	var wg sync.WaitGroup
	var d time.Duration
	var status, rows int
	wg.Add(1)
	go func() {
		defer wg.Done()
		d, status, rows = retainedSample(t, h, path)
	}()
	for _, p := range load {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			retainedSample(t, h, p)
		}(p)
	}
	wg.Wait()
	return d, status, rows
}

func retainedLoadPaths(all []retainedShape, exclude string) []string {
	wanted := map[string]bool{
		"conversation-dist-cost-model":          true,
		"session-scatter-cost-commits-unpriced": true,
		"workflow-activity-list":                true,
		"cost-treemap-harness-model":            true,
		"plan-list-sort-last-ts":                true,
	}
	var out []string
	for _, s := range all {
		if s.Label == exclude || !wanted[s.Label] {
			continue
		}
		out = append(out, s.Path)
		if len(out) == retainedLoadInFlight-1 {
			break
		}
	}
	return out
}

func retainedTimingLoad(t *testing.T, h http.Handler, path string, load []string, runs int) retainedTiming {
	out := retainedTiming{times: make([]time.Duration, 0, runs)}
	retainedLoadSample(t, h, path, load)
	for i := 0; i < runs; i++ {
		d, status, rows := retainedLoadSample(t, h, path, load)
		out.times = append(out.times, d)
		out.status, out.rows = status, rows
	}
	return out
}

func retainedClassify(status int, rows int, shape retainedShape) string {
	switch {
	case status == http.StatusOK && rows >= max(1, shape.MinRows):
		return "served"
	case status == http.StatusOK:
		return "empty"
	case status == http.StatusServiceUnavailable:
		return "query_failure"
	case status == http.StatusInternalServerError:
		return "query_failure"
	case status == http.StatusBadRequest:
		return "unsupported"
	default:
		return "error"
	}
}

func TestAnalyticsRetainedWorkload(t *testing.T) {
	if os.Getenv(retainedProfileEnv) != "1" {
		t.Skip("set YAKKA_RETAINED_PROFILE=1 to run the retained-history measurement")
	}
	runs := benchEnvInt(retainedRunsEnv, retainedRuns, 1)
	h := openRetainedHarness(t)
	rec := loadRetainedShapes(t)
	filter := os.Getenv(retainedShapeEnv)
	results := make([]retainedShapeResult, 0, len(rec.Shapes))
	for _, shape := range rec.Shapes {
		if filter != "" && !strings.Contains(shape.Label, filter) {
			continue
		}
		alone := retainedTimingFor(t, h.h, shape.Path, runs)
		load := retainedTimingLoad(t, h.h, shape.Path, retainedLoadPaths(rec.Shapes, shape.Label), runs)
		res := retainedShapeResult{
			Label: shape.Label, Path: shape.Path, Expect: shape.Expect, Oracle: shape.Oracle,
			AloneStatus: alone.status, AloneRows: alone.rows, AloneP95MS: alone.p95(), AloneMaxMS: alone.maxMS(),
			LoadStatus: load.status, LoadRows: load.rows, LoadP95MS: load.p95(), LoadMaxMS: load.maxMS(),
			Classification: retainedClassify(alone.status, alone.rows, shape),
		}
		results = append(results, res)
		t.Logf("%-42s alone: status=%d rows=%d p95=%7.1fms max=%7.1fms | load: status=%d rows=%d p95=%7.1fms max=%7.1fms",
			res.Label, res.AloneStatus, res.AloneRows, res.AloneP95MS, res.AloneMaxMS,
			res.LoadStatus, res.LoadRows, res.LoadP95MS, res.LoadMaxMS)
		if res.AloneStatus != 200 {
			t.Errorf("%s alone returned %d (%s)", res.Label, res.AloneStatus, res.Classification)
		}
		if res.LoadStatus != 200 {
			t.Errorf("%s under load returned %d", res.Label, res.LoadStatus)
		}
		if res.AloneP95MS > retainedP95MS {
			t.Errorf("%s alone p95 %.1f ms over %.0f ms", res.Label, res.AloneP95MS, retainedP95MS)
		}
		if res.LoadP95MS > retainedP95MS {
			t.Errorf("%s under load p95 %.1f ms over %.0f ms", res.Label, res.LoadP95MS, retainedP95MS)
		}
	}
	cancel := retainedCancellation(t, h)
	explain := retainedExplain(t, h, rec)
	record := retainedRecord{
		Version: 1, Phase: "phase 2 verified", Source: h.source, Runs: runs, Workload: h.summary,
		CopyMS: h.copyMS, GenerateMS: h.genMS, OpenMS: h.openMS,
		Shapes: results, Cancellation: cancel, Explain: explain,
	}
	retainedWriteRecord(t, record)
	t.Logf("retained measurement: source=%s copy=%.1fms generate=%.1fms open=%.1fms runs=%d shapes=%d",
		h.source, h.copyMS, h.genMS, h.openMS, runs, len(results))
}

func retainedWriteRecord(t *testing.T, rec retainedRecord) {
	t.Helper()
	path := os.Getenv(retainedOutEnv)
	if path == "" {
		path = retainedOutPath
	}
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// retainedCancellation drives a supported heavy shape under progressively shorter client
// deadlines derived from the unchanged one-second budget, then proves the reader and heavy-read
// slot were released by running an ordinary request and a direct reader query.
func retainedCancellation(t *testing.T, h *retainedHarness) retainedCancelResult {
	t.Helper()
	to := time.Unix(h.summary.Oracle.MaxFactTS, 0).UTC().Format(time.RFC3339)
	heavy := "/v1/analytics/entities?grain=plan&limit=100&sort=associated_cost_usd%3Adesc&all=1&to=" + to
	ordinary := "/v1/analytics/entity?grain=plan&repo_id=" + h.summary.Oracle.MixedRepoID + "&plan=" + h.summary.Oracle.MixedPlan +
		"&collection=events&limit=4&all=1&to=" + to
	if h.summary.Oracle.MixedRepoID == "" {
		ordinary = "/v1/analytics/query?measure=cost_usd&bucket=none&dim=harness&top=100&all=1&to=" + to
	}
	res := retainedCancelResult{}
	for _, deadline := range []time.Duration{200 * time.Millisecond, 100 * time.Millisecond, 50 * time.Millisecond, 20 * time.Millisecond, 5 * time.Millisecond, time.Millisecond} {
		res.Attempts++
		ctx, cancel := context.WithTimeout(context.Background(), deadline)
		req := httptest.NewRequest(http.MethodGet, heavy, nil).WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+benchKey)
		rec := httptest.NewRecorder()
		start := time.Now()
		h.h.ServeHTTP(rec, req)
		elapsed := time.Since(start)
		canceled := ctx.Err() == context.DeadlineExceeded
		cancel()
		if canceled {
			res.DeadlineMS = float64(deadline) / float64(time.Millisecond)
			res.Status = 0
			res.ElapsedMS = float64(elapsed) / float64(time.Millisecond)
			res.ContextCanceled = true
			break
		}
	}
	// An ordinary request after cancellation proves the reader and slot were returned.
	status, body := do(t, h.h, http.MethodGet, ordinary, benchKey, "")
	res.FollowingStatus, res.FollowingRows = status, retainedRowCount(body)
	res.FollowingSucceeded = status == http.StatusOK
	var one int
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := h.db.QueryRowContext(ctx, "SELECT 1").Scan(&one)
	cancel()
	res.ReaderReleased = err == nil && one == 1
	if !res.ContextCanceled {
		t.Errorf("retained cancellation: heavy shape finished before any deadline; no cancellation observed")
	}
	if !res.FollowingSucceeded {
		t.Errorf("retained cancellation: following ordinary request returned %d: %s", status, body)
	}
	if !res.ReaderReleased {
		t.Errorf("retained cancellation: reader was not released: %v", err)
	}
	t.Logf("retained cancellation: deadline=%0.1fms status=%d elapsed=%0.1fms context_canceled=%v following=%d reader_released=%v",
		res.DeadlineMS, res.Status, res.ElapsedMS, res.ContextCanceled, res.FollowingStatus, res.ReaderReleased)
	return res
}

func retainedExplain(t *testing.T, h *retainedHarness, rec retainedShapeRecord) []retainedExplainLine {
	t.Helper()
	from, to := h.summary.Oracle.MinFactTS, h.summary.Oracle.MaxFactTS
	if from == 0 {
		from = retainedWindowFrom(h.summary.Oracle.LatestUsageTS)
	}
	stmts := []struct {
		label string
		sql   string
		args  []any
	}{
		{
			label: "plan_population_and_association",
			sql: `SELECT repo_id,plan,COUNT(DISTINCT path),COUNT(DISTINCT content_hash),COUNT(DISTINCT conversation_id),MIN(ts),MAX(ts)
				FROM facts WHERE type='artifact_version' AND plan<>'' AND ts>=? AND ts<=? GROUP BY repo_id,plan`,
			args: []any{from, to},
		},
		{
			label: "plan_session_ids",
			sql: `SELECT DISTINCT s.conversation_id FROM facts s WHERE s.ts>=? AND s.ts<=? AND EXISTS (
				SELECT 1 FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=? AND a.conversation_id=s.conversation_id)
				ORDER BY s.conversation_id`,
			args: []any{from, to, h.summary.Oracle.MaxSessionsPlanRepo, h.summary.Oracle.MaxSessionsPlan},
		},
		{
			label: "session_provenance",
			sql: `SELECT conversation_id,COALESCE(NULLIF(harness,''),'unknown'),COUNT(*) FROM facts
				WHERE conversation_id IN ('sess-00000','sess-00001','sess-00002','sess-00003','sess-00004','sess-00005')
				GROUP BY conversation_id,COALESCE(NULLIF(harness,''),'unknown')`,
		},
		{
			label: "usage_dedupe",
			sql:   retainedUsageExplainSQL(from, to),
			args:  []any{from, to},
		},
		{
			label: "conversation_distribution",
			sql:   retainedDistributionExplainSQL(from, to),
			args:  []any{from, to},
		},
		{
			label: "artifact_band_population",
			sql: `SELECT repo_id,path,COUNT(DISTINCT content_hash),COUNT(DISTINCT conversation_id),MIN(ts),MAX(ts)
				FROM facts WHERE type='artifact_version' AND ts>=? AND ts<=? GROUP BY repo_id,path ORDER BY MAX(ts) DESC LIMIT 500`,
			args: []any{from, to},
		},
		{
			label: "artifact_latest_scores",
			sql: `WITH hashes AS (SELECT DISTINCT content_hash FROM facts WHERE type='artifact_version' AND content_hash!='' AND kind='design'),
				latest AS (SELECT s.content_hash,s.check_name,s.scorer,s.result,ROW_NUMBER() OVER(PARTITION BY s.content_hash,s.check_name ORDER BY s.id DESC) rn
				FROM scores s JOIN hashes h USING(content_hash))
				SELECT content_hash,check_name,COALESCE(scorer,''),result FROM latest WHERE rn=1 ORDER BY check_name,scorer,content_hash`,
		},
	}
	out := []retainedExplainLine{}
	for _, st := range stmts {
		rows, err := h.db.Query("EXPLAIN QUERY PLAN "+st.sql, st.args...)
		if err != nil {
			t.Errorf("explain %s: %v", st.label, err)
			continue
		}
		n := 0
		for rows.Next() {
			var id, parent, notused int
			var detail string
			if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
				rows.Close()
				t.Errorf("explain %s scan: %v", st.label, err)
				break
			}
			if n < 20 {
				out = append(out, retainedExplainLine{Label: st.label, Detail: strings.TrimSpace(detail)})
			}
			n++
		}
		if err := rows.Err(); err != nil {
			t.Errorf("explain %s rows: %v", st.label, err)
		}
		rows.Close()
	}
	return out
}

func retainedWindowFrom(ts int64) int64 {
	if ts == 0 {
		return 0
	}
	return ts - 400*24*3600
}

func retainedUsageCTE(from, to int64) string {
	mid := "CASE WHEN harness = 'claude' THEN json_extract(raw, '$.backfill.ref') END"
	return fmt.Sprintf("WITH usage_u AS (SELECT row_hash,harness,repo_id,model,conversation_id,ts,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported,%s AS _mid FROM facts WHERE type='hook_event' AND norm_event='usage' AND ts>=%d AND ts<=%d), kept AS (SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY conversation_id,_mid ORDER BY tok_out DESC,row_hash ASC) AS _rn FROM usage_u) WHERE _mid IS NULL OR _mid='' OR _rn=1) ", mid, from, to)
}

func retainedUsageExplainSQL(from, to int64) string {
	return retainedUsageCTE(from, to) + "SELECT COUNT(*) FROM kept"
}

func retainedDistributionExplainSQL(from, to int64) string {
	return retainedUsageCTE(from, to) + "SELECT conversation_id,COUNT(*),COALESCE(SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)),0) FROM kept GROUP BY conversation_id"
}
