//go:build plan30harness

package serve

// Plan 30 phase 1: the one real-Go, cookie-session, two-tenant browser fixture
// for the real-Chromium acceptance proof. It is test-only. It starts a real
// Server in remote auth mode, seeds the exact retained-record arithmetic from
// the binding brief, verifies that arithmetic against the store before it
// prints ready, and exposes loopback control routes a Node harness uses to
// install the real session cookie, delay one tenant's reads, occupy its
// analytics slots and append one real fact.
//
// Run through packages/yakka-analytics/tests/plan30/harness.mjs. The test prints
// PLAN30_HARNESS_ORIGIN and PLAN30_HARNESS_READY, then blocks until stdin closes
// or it is signalled. It never prints the session cookie, tokens or row dumps.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const (
	plan30MarkerA = "plan30-a-only"
	plan30MarkerB = "plan30-b-only"
)

// plan30Expected is the fixture manifest. Browser assertions read these values
// from /__plan30/fixture; nothing is duplicated as a literal.
type plan30Counts struct {
	Events     int64 `json:"events"`
	Rejections int64 `json:"rejections"`
	Rows       int64 `json:"rows"`
}

type plan30TenantExpected struct {
	Total        plan30Counts `json:"total"`
	Window30d    plan30Counts `json:"window30d"`
	Activity30d  int64        `json:"activity30d"`
	ActivityAll  int64        `json:"activityAll"`
	RepoA        plan30Counts `json:"repoA"`
	RepoB        plan30Counts `json:"repoB"`
	KindBrief    plan30Counts `json:"kindBrief"`
	KindDesign   plan30Counts `json:"kindDesign"`
	RepoABrief   plan30Counts `json:"repoABrief"`
	Conversation plan30Counts `json:"conversation"`
	Empty2020    plan30Counts `json:"empty2020"`
}

type plan30TenantBExpected struct {
	Window30d           plan30Counts `json:"window30d"`
	Activity30d         int64        `json:"activity30d"`
	AfterAppend         plan30Counts `json:"afterAppend"`
	ActivityAfterAppend int64        `json:"activityAfterAppend"`
}

type plan30Expected struct {
	A plan30TenantExpected  `json:"a"`
	B plan30TenantBExpected `json:"b"`
}

type plan30SeedResult struct {
	Expected plan30TenantExpected
}

func TestPlan30Harness(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve harness file path")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
	dataRoot := filepath.Join(repoRoot, ".scratch", "plan30-harness", strconv.Itoa(os.Getpid()))
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("reset data root: %v", err)
	}
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatalf("create data root: %v", err)
	}
	defer os.RemoveAll(dataRoot)

	gh := mockGitHub(t, 3001, "plan30-owner", []mockEmail{{Email: "plan30@example.com", Verified: true}})
	t.Cleanup(gh.Close)

	s := New(Config{
		Addr:                    "0.0.0.0:8780",
		Data:                    dataRoot,
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "cid",
		GitHubOAuthClientSecret: "csec",
	}, Options{DisableWorker: true, GitHubHTTPBase: gh.URL, PollInterval: time.Hour})
	defer s.Close()

	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	if len(sess) == 0 || sess[0].Value == "" {
		t.Fatal("no fixture session cookie")
	}
	cookieName, cookieValue := sess[0].Name, sess[0].Value

	// Names sort before the automatic "default" tenant, so a link with no URL
	// tenant and no remembered tenant resolves to A, not "default".
	a := remoteCreateTenant(t, h, origin, sess, "a-plan30")
	b := remoteCreateTenant(t, h, origin, sess, "b-plan30")

	now := time.Now().UTC()
	ctx := context.Background()
	seedA := seedPlan30TenantA(t, filepath.Join(dataRoot, a), ctx, now)
	seedB := seedPlan30TenantB(t, filepath.Join(dataRoot, b), ctx, now)

	owned := map[string]bool{a: true, b: true}
	names := map[string]string{a: "a-plan30", b: "b-plan30"}
	byName := map[string]string{"a-plan30": a, "b-plan30": b, "a": a, "b": b}

	// Per-tenant real handler delay, set through the control route only.
	var delayMu sync.Mutex
	delays := map[string]time.Duration{}

	// Held analytics slots per tenant. on=1 fills every token, on=0 drains.
	var holdMu sync.Mutex
	held := map[string]bool{}

	appendMu := sync.Mutex{}
	appended := 0

	mux := http.NewServeMux()
	mux.HandleFunc("/__plan30/session", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		tenant := r.URL.Query().Get("tenant")
		if id, ok := byName[tenant]; ok {
			tenant = id
		}
		if !owned[tenant] {
			http.Error(w, "unknown tenant", http.StatusNotFound)
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name: cookieName, Value: cookieValue, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	// A second real session with the server administrator's verified email. The
	// ordinary fixture session stays a non-admin so the 403 exception is also
	// provable; the browser harness swaps this cookie in only for the admin
	// footprint read.
	mux.HandleFunc("/__plan30/admin-session", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		id, err := newSessionID()
		if err != nil {
			http.Error(w, "session id failed", http.StatusInternalServerError)
			return
		}
		s.registry.PutSession(id, SessionRecord{
			GitHubID: 3001, GitHubLogin: "plan30-owner",
			VerifiedEmails: []string{adminEmail},
			ExpiresAt:      time.Now().Add(sessionLifetime).UTC(),
		})
		http.SetCookie(w, &http.Cookie{
			Name: cookieName, Value: id, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__plan30/fixture", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tenants": []map[string]string{
				{"id": a, "name": names[a]},
				{"id": b, "name": names[b]},
			},
			"markers": map[string]string{"a": plan30MarkerA, "b": plan30MarkerB},
			"foreign": "0f0f0f0f-0000-4000-8000-000000000000",
			"expected": map[string]any{
				"a": seedA.Expected,
				"b": plan30TenantBExpected{Window30d: seedB.Expected.Window30d, Activity30d: seedB.Expected.Activity30d,
					AfterAppend: plan30Counts{Events: 4, Rejections: 1, Rows: 5}, ActivityAfterAppend: 3},
			},
		})
	})
	mux.HandleFunc("/__plan30/delay", func(w http.ResponseWriter, r *http.Request) {
		tenant := r.URL.Query().Get("tenant")
		if id, ok := byName[tenant]; ok {
			tenant = id
		}
		if !owned[tenant] {
			http.Error(w, "unknown tenant", http.StatusNotFound)
			return
		}
		ms, err := strconv.Atoi(r.URL.Query().Get("ms"))
		if err != nil || ms < 0 || ms > 60000 {
			http.Error(w, "bad ms", http.StatusBadRequest)
			return
		}
		delayMu.Lock()
		if ms == 0 {
			delete(delays, tenant)
		} else {
			delays[tenant] = time.Duration(ms) * time.Millisecond
		}
		delayMu.Unlock()
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__plan30/hold", func(w http.ResponseWriter, r *http.Request) {
		tenant := r.URL.Query().Get("tenant")
		if id, ok := byName[tenant]; ok {
			tenant = id
		}
		if !owned[tenant] {
			http.Error(w, "unknown tenant", http.StatusNotFound)
			return
		}
		ts, err := s.tenant(tenant)
		if err != nil {
			http.Error(w, "tenant unavailable", http.StatusServiceUnavailable)
			return
		}
		on := r.URL.Query().Get("on") == "1"
		holdMu.Lock()
		defer holdMu.Unlock()
		if on && !held[tenant] {
			for i := 0; i < analyticsHeavyConcurrency; i++ {
				select {
				case ts.analyticsSlots <- struct{}{}:
				default:
				}
			}
			held[tenant] = true
		} else if !on && held[tenant] {
			for i := 0; i < analyticsHeavyConcurrency; i++ {
				select {
				case <-ts.analyticsSlots:
				default:
				}
			}
			held[tenant] = false
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__plan30/append", func(w http.ResponseWriter, r *http.Request) {
		tenant := r.URL.Query().Get("tenant")
		if id, ok := byName[tenant]; ok {
			tenant = id
		}
		if tenant != b {
			http.Error(w, "append is tenant B only", http.StatusBadRequest)
			return
		}
		ts, err := s.tenant(tenant)
		if err != nil {
			http.Error(w, "tenant unavailable", http.StatusServiceUnavailable)
			return
		}
		appendMu.Lock()
		appended++
		n := appended
		appendMu.Unlock()
		row := plan30Fact(fmt.Sprintf("b-appended-%d", n), store.FactRow{
			Type: "hook_event", ConversationID: plan30MarkerB, Harness: "h1", Event: "usage",
			NormEvent: "usage", Model: "model-b", RepoID: plan30MarkerB, TS: float64(time.Now().Unix()),
		})
		if _, err := ts.t.Append(ctxOf(r), []store.FactRow{row}); err != nil {
			http.Error(w, "append failed", http.StatusInternalServerError)
			return
		}
		count, err := ts.t.FactCount(ctxOf(r))
		if err != nil {
			http.Error(w, "count failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{"facts": count})
	})

	// Delay only the wrapped app handler, never the control routes.
	app := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenant := r.URL.Query().Get("tenant")
		delayMu.Lock()
		delay := delays[tenant]
		delayMu.Unlock()
		if delay > 0 {
			time.Sleep(delay)
		}
		h.ServeHTTP(w, r)
	})
	mux.Handle("/", app)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: mux}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	fmt.Printf("PLAN30_HARNESS_ORIGIN=http://%s\n", ln.Addr().String())
	fmt.Println("PLAN30_HARNESS_READY")

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, os.Interrupt)
	stdinDone := make(chan struct{})
	if info, err := os.Stdin.Stat(); err == nil && info.Mode()&os.ModeNamedPipe != 0 {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			close(stdinDone)
		}()
	}
	select {
	case <-stdinDone:
	case <-sigs:
	case err := <-serveErr:
		t.Fatalf("serve: %v", err)
	}
	signal.Stop(sigs)

	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}

func ctxOf(_ *http.Request) context.Context { return context.Background() }

func plan30Fact(id string, r store.FactRow) store.FactRow {
	raw, _ := json.Marshal(map[string]any{"type": r.Type, "id": id, "source": "plan30harness"})
	sum := sha256.Sum256(raw)
	r.Raw = raw
	r.RowHash = hex.EncodeToString(sum[:])
	if r.Source == "" {
		r.Source = "plan30harness"
	}
	return r
}

func plan30Window(now time.Time) (time.Time, time.Time) {
	return now.Add(-30 * 24 * time.Hour), now
}

func plan30CountsFor(t *testing.T, ctx context.Context, tenant *store.Tenant, f store.AnalyticsFilter) plan30Counts {
	t.Helper()
	counts, err := tenant.EventCounts(ctx, f)
	if err != nil {
		t.Fatalf("event counts: %v", err)
	}
	return plan30Counts{Events: counts.Matched.Events, Rejections: counts.Matched.Rejections, Rows: counts.Matched.Rows}
}

func plan30ActivityTotal(t *testing.T, ctx context.Context, tenant *store.Tenant, f store.AnalyticsFilter) int64 {
	t.Helper()
	_, _, total, err := tenant.ActivityPage(ctx, f, nil, "", "", 500)
	if err != nil {
		t.Fatalf("activity page: %v", err)
	}
	return int64(total)
}

func seedPlan30TenantA(t *testing.T, dir string, ctx context.Context, now time.Time) plan30SeedResult {
	t.Helper()
	ts, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatalf("open tenant A: %v", err)
	}
	defer ts.Close()

	windowStart := now.Add(-20 * 24 * time.Hour)
	windowSpan := 19 * 24 * time.Hour
	win := func(i, n int) float64 {
		return float64(windowStart.Add(time.Duration(float64(windowSpan) * float64(i) / float64(n))).Unix())
	}
	old := func(i int) float64 {
		return float64(now.Add(-time.Duration(46*24+i) * time.Hour).Unix())
	}

	rows := make([]store.FactRow, 0, 12480)
	add := func(id string, r store.FactRow) { rows = append(rows, plan30Fact(id, r)) }

	sessionsA := []string{"s1", "s2", "s3"}
	sessionsB := []string{"s4", "s5", "s6"}
	for i := 0; i < 4000; i++ {
		tool := "Read"
		if i%2 == 1 {
			tool = "Bash"
		}
		add(fmt.Sprintf("a-tool-%d", i), store.FactRow{
			Type: "hook_event", ConversationID: sessionsA[i%3], Harness: "h1", Event: "tool_call",
			NormEvent: "tool_call", Tool: tool, RepoID: "repo-a", TS: win(i, 4000),
		})
	}
	for i := 0; i < 4000; i++ {
		add(fmt.Sprintf("a-usage-%d", i), store.FactRow{
			Type: "hook_event", ConversationID: sessionsB[i%3], Harness: "h1", Event: "usage",
			NormEvent: "usage", Model: "model-b", RepoID: "repo-b", TS: win(i, 4000),
		})
	}
	for i := 0; i < 200; i++ {
		add(fmt.Sprintf("a-session-action-%d", i), store.FactRow{
			Type: "session_action", ConversationID: sessionsA[i%3], Harness: "h1", Event: "session_action",
			RepoID: "repo-a", TS: win(i, 200),
		})
	}
	for i := 0; i < 200; i++ {
		add(fmt.Sprintf("a-session-action-b-%d", i), store.FactRow{
			Type: "session_action", ConversationID: sessionsB[i%3], Harness: "h1", Event: "session_action",
			RepoID: "repo-b", TS: win(i, 200),
		})
	}
	// The marker conversation stays out of the fact population so the marker
	// appears only in rejections 1 and 4; N1 binds 16 in-window observations,
	// which needs six session starts, not seven.
	briefs := []struct{ conv, path string }{
		{"s1", "docs/plans/plan-a/briefs/01.md"},
		{"s2", "docs/plans/plan-a/briefs/02.md"},
	}
	for i, x := range briefs {
		add(fmt.Sprintf("a-brief-%d", i), store.FactRow{
			Type: "artifact_version", ConversationID: x.conv, Harness: "h1", Event: "artifact_version",
			RepoID: "repo-a", Path: x.path, ContentHash: keys.ContentHash([]byte(fmt.Sprintf("plan30 brief %d", i))),
			TS: win(100+i, 200),
		})
	}
	designs := []struct{ conv, path string }{
		{"s4", "docs/plans/plan-b/DESIGN.md"},
		{"s5", "docs/plans/plan-b/DESIGN.md"},
	}
	for i, x := range designs {
		add(fmt.Sprintf("a-design-%d", i), store.FactRow{
			Type: "artifact_version", ConversationID: x.conv, Harness: "h1", Event: "artifact_version",
			RepoID: "repo-b", Path: x.path, ContentHash: keys.ContentHash([]byte(fmt.Sprintf("plan30 design %d", i))),
			TS: win(110+i, 200),
		})
	}
	for i := 0; i < 2; i++ {
		add(fmt.Sprintf("a-commit-%d", i), store.FactRow{
			Type: "commit", ConversationID: "s1", Harness: "h1", Event: "commit", RepoID: "repo-a",
			TS: win(150+i, 200),
		})
	}
	for i := 0; i < 4074; i++ {
		conv := "old-1"
		if i%2 == 1 {
			conv = "old-2"
		}
		add(fmt.Sprintf("a-old-%d", i), store.FactRow{
			Type: "hook_event", ConversationID: conv, Harness: "h1", Event: "usage",
			NormEvent: "usage", Model: "model-old", RepoID: "repo-c", TS: old(i),
		})
	}

	const batch = 2000
	for start := 0; start < len(rows); start += batch {
		end := start + batch
		if end > len(rows) {
			end = len(rows)
		}
		if _, err := ts.Append(ctx, rows[start:end]); err != nil {
			t.Fatalf("append facts A: %v", err)
		}
	}

	type rej struct {
		conv, path, stage string
		at                time.Time
	}
	rejs := []rej{
		{plan30MarkerA, "docs/plans/plan-a/briefs/01.md", "screen", now.Add(-10 * 24 * time.Hour)},
		{"s2", "docs/plans/plan-a/reports/01.md", "precheck", now.Add(-8 * 24 * time.Hour)},
		{"", "docs/plans/plan-b/briefs/02.md", "screen", now.Add(-6 * 24 * time.Hour)},
		{plan30MarkerA, "docs/plans/plan-a/briefs/03.md", "screen", now.Add(-3 * 24 * time.Hour)},
		{"old-1", "docs/plans/plan-a/reports/09.md", "screen", now.Add(-60 * 24 * time.Hour)},
		{"old-2", "docs/plans/plan-a/briefs/09.md", "precheck", now.Add(-61 * 24 * time.Hour)},
		{"old-1", "docs/plans/plan-b/reports/09.md", "screen", now.Add(-62 * 24 * time.Hour)},
		{"", "docs/plans/plan-b/briefs/09.md", "screen", now.Add(-63 * 24 * time.Hour)},
		{"old-2", "docs/plans/plan-a/reports/10.md", "precheck", now.Add(-64 * 24 * time.Hour)},
	}
	for _, r := range rejs {
		if err := ts.AppendRejection(ctx, store.Rejection{
			Stage: r.stage, FactType: "artifact_version", ConversationID: r.conv, Path: r.path, Reason: "plan30 fixture",
		}); err != nil {
			t.Fatalf("append rejection A: %v", err)
		}
	}
	// AppendRejection stamps at=now; rewrite the seeded instant through Raw.
	db := ts.Raw()
	if db == nil {
		t.Fatal("tenant A raw writer unavailable")
	}
	for _, r := range rejs {
		res, err := db.Exec(`UPDATE rejections SET at=? WHERE path=? AND stage=? AND conversation_id=?`,
			r.at.UnixNano(), r.path, r.stage, r.conv)
		if err != nil {
			t.Fatalf("rewrite rejection %s: %v", r.path, err)
		}
		if n, _ := res.RowsAffected(); n != 1 {
			t.Fatalf("rewrite rejection %s: affected %d rows", r.path, n)
		}
	}

	from, to := plan30Window(now)
	windowFact := store.AnalyticsFilter{From: from, To: to}
	allFact := store.AnalyticsFilter{From: time.Unix(0, 0).UTC(), To: now.Add(24 * time.Hour)}
	total := plan30CountsFor(t, ctx, ts, allFact)
	if total.Events != 12480 || total.Rejections != 9 || total.Rows != 12489 {
		t.Fatalf("tenant A total mismatch: %+v", total)
	}
	window := plan30CountsFor(t, ctx, ts, windowFact)
	if window.Events != 8406 || window.Rejections != 4 || window.Rows != 8410 {
		t.Fatalf("tenant A window mismatch: %+v", window)
	}
	repoA := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{From: from, To: to, Repos: []string{"repo-a"}})
	repoB := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{From: from, To: to, Repos: []string{"repo-b"}})
	brief := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{From: from, To: to, Kinds: []string{"brief"}})
	design := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{From: from, To: to, Kinds: []string{"design"}})
	repoABrief := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{From: from, To: to, Repos: []string{"repo-a"}, Kinds: []string{"brief"}})
	conv := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{From: from, To: to, ConversationIDs: []string{plan30MarkerA}})
	if repoA.Events != 4204 || repoA.Rejections != 0 {
		t.Fatalf("tenant A repo-a mismatch: %+v", repoA)
	}
	if repoB.Events != 4202 || repoB.Rejections != 0 {
		t.Fatalf("tenant A repo-b mismatch: %+v", repoB)
	}
	if brief.Events != 2 || design.Events != 2 || repoABrief.Events != 2 {
		t.Fatalf("tenant A kind mismatch: brief=%+v design=%+v repoABrief=%+v", brief, design, repoABrief)
	}
	if conv.Events != 0 || conv.Rejections != 2 || conv.Rows != 2 {
		t.Fatalf("tenant A conversation mismatch: %+v", conv)
	}
	activityWindow := plan30ActivityTotal(t, ctx, ts, windowFact)
	activityAll := plan30ActivityTotal(t, ctx, ts, allFact)
	if activityWindow != 16 || activityAll != 23 {
		t.Fatalf("tenant A activity mismatch: window=%d all=%d", activityWindow, activityAll)
	}
	empty2020 := plan30CountsFor(t, ctx, ts, store.AnalyticsFilter{
		From: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), To: time.Date(2020, 12, 31, 23, 59, 59, 0, time.UTC),
	})
	if empty2020.Events != 0 || empty2020.Rejections != 0 {
		t.Fatalf("tenant A empty 2020 mismatch: %+v", empty2020)
	}

	return plan30SeedResult{Expected: plan30TenantExpected{
		Total: total, Window30d: window, Activity30d: activityWindow, ActivityAll: activityAll,
		RepoA: repoA, RepoB: repoB, KindBrief: brief, KindDesign: design, RepoABrief: repoABrief,
		Conversation: conv, Empty2020: empty2020,
	}}
}

func seedPlan30TenantB(t *testing.T, dir string, ctx context.Context, now time.Time) plan30SeedResult {
	t.Helper()
	ts, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatalf("open tenant B: %v", err)
	}
	defer ts.Close()

	inWindow := func(i int) float64 {
		return float64(now.Add(-time.Duration(5+i) * 24 * time.Hour).Unix())
	}
	rows := []store.FactRow{
		plan30Fact("b-usage", store.FactRow{
			Type: "hook_event", ConversationID: plan30MarkerB, Harness: "h1", Event: "usage",
			NormEvent: "usage", Model: "model-b", RepoID: plan30MarkerB, TS: inWindow(0),
		}),
		plan30Fact("b-design", store.FactRow{
			Type: "artifact_version", ConversationID: plan30MarkerB, Harness: "h1", Event: "artifact_version",
			RepoID: plan30MarkerB, Path: "docs/plans/plan30-b-only/DESIGN.md",
			ContentHash: keys.ContentHash([]byte("plan30 b design")), TS: inWindow(1),
		}),
		plan30Fact("b-commit", store.FactRow{
			Type: "commit", ConversationID: plan30MarkerB, Harness: "h1", Event: "commit", RepoID: plan30MarkerB,
			TS: inWindow(2),
		}),
	}
	if _, err := ts.Append(ctx, rows); err != nil {
		t.Fatalf("append facts B: %v", err)
	}
	if err := ts.AppendRejection(ctx, store.Rejection{
		Stage: "screen", FactType: "artifact_version", ConversationID: plan30MarkerB,
		Path: "docs/plans/plan30-b-only/reports/01.md", Reason: "plan30 fixture",
	}); err != nil {
		t.Fatalf("append rejection B: %v", err)
	}
	db := ts.Raw()
	if db == nil {
		t.Fatal("tenant B raw writer unavailable")
	}
	res, err := db.Exec(`UPDATE rejections SET at=? WHERE path=?`, now.Add(-2*24*time.Hour).UnixNano(),
		"docs/plans/plan30-b-only/reports/01.md")
	if err != nil {
		t.Fatalf("rewrite rejection B: %v", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		t.Fatalf("rewrite rejection B: affected %d rows", n)
	}

	from, to := plan30Window(now)
	windowFact := store.AnalyticsFilter{From: from, To: to}
	window := plan30CountsFor(t, ctx, ts, windowFact)
	if window.Events != 3 || window.Rejections != 1 || window.Rows != 4 {
		t.Fatalf("tenant B window mismatch: %+v", window)
	}
	activity := plan30ActivityTotal(t, ctx, ts, windowFact)
	if activity != 3 {
		t.Fatalf("tenant B activity mismatch: %d", activity)
	}
	return plan30SeedResult{Expected: plan30TenantExpected{Window30d: window, Activity30d: activity}}
}
