//go:build plan29harness

package serve

// Plan 29 phase 1: the one real-Go, cookie-session, two-tenant browser fixture.
// It is test-only. It starts a real Server in remote auth mode, seeds two owned
// tenants through the store, and exposes loopback control routes so a Node
// browser harness can install the real session cookie and select a tenant.
//
// Run through packages/yakka-analytics/tests/plan29/harness.mjs. The test prints
// PLAN29_HARNESS_ORIGIN and PLAN29_HARNESS_READY, then blocks until stdin closes
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
	"syscall"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestPlan29Harness(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve harness file path")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
	dataRoot := filepath.Join(repoRoot, ".scratch", "plan29-harness", strconv.Itoa(os.Getpid()))
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("reset data root: %v", err)
	}
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatalf("create data root: %v", err)
	}
	defer os.RemoveAll(dataRoot)

	gh := mockGitHub(t, 2901, "plan29-owner", []mockEmail{{Email: "plan29@example.com", Verified: true}})
	t.Cleanup(gh.Close)

	s := New(Config{
		Addr:                    "0.0.0.0:8770",
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

	a := remoteCreateTenant(t, h, origin, sess, "plan29-a")
	b := remoteCreateTenant(t, h, origin, sess, "plan29-b")

	ctx := context.Background()
	facts := seedPlan29Tenant(t, s, ctx, a)
	// plan29-b stays empty: it is the fresh-tenant case.

	owned := map[string]bool{a: true, b: true}
	names := map[string]string{a: "plan29-a", b: "plan29-b"}
	byName := map[string]string{"plan29-a": a, "plan29-b": b}

	mux := http.NewServeMux()
	mux.HandleFunc("/__plan29/session", func(w http.ResponseWriter, r *http.Request) {
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
	mux.HandleFunc("/__plan29/fixture", func(w http.ResponseWriter, r *http.Request) {
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
			"counts": map[string]int{"facts": facts},
		})
	})
	mux.Handle("/", h)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: mux}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	fmt.Printf("PLAN29_HARNESS_ORIGIN=http://%s\n", ln.Addr().String())
	fmt.Println("PLAN29_HARNESS_READY")

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, os.Interrupt)
	// A wrapper that pipes stdin can stop the harness by closing it. `go test`
	// runs the compiled binary on a character device, so ignore that EOF and
	// stay up until signalled.
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

// seedPlan29Tenant writes the deterministic population the phase-1 browser
// fixture needs and returns the appended fact count. It copies the minimal
// seeding patterns from analyticsfixture.Create.
func seedPlan29Tenant(t *testing.T, s *Server, ctx context.Context, id string) int {
	t.Helper()
	ts, err := s.tenant(id)
	if err != nil {
		t.Fatalf("tenant %s: %v", id, err)
	}
	base := float64(time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Unix())
	rows := []store.FactRow{}
	mk := func(rowID string, r store.FactRow) {
		raw, _ := json.Marshal(map[string]any{"type": r.Type, "id": rowID, "source": "plan29harness"})
		sum := sha256.Sum256(raw)
		r.Raw = raw
		r.RowHash = hex.EncodeToString(sum[:])
		r.Source = "plan29harness"
		rows = append(rows, r)
	}

	price := 0.10
	// sess-alpha: repo-a/plan-a. Priced usage with an empty raw repo, a commit.
	mk("alpha-usage", store.FactRow{Type: "hook_event", ConversationID: "sess-alpha", Harness: "harness-a",
		Event: "usage", NormEvent: "usage", Model: "model-a", TokIn: 12, TokOut: 8,
		CostReported: &price, TS: base + 5000})
	mk("alpha-commit", store.FactRow{Type: "commit", ConversationID: "sess-alpha", Harness: "harness-a",
		Event: "commit", RepoID: "repo-a", TS: base + 4000})
	// sess-beta: repo-b; associated with plan-a and plan-b through its artifacts.
	mk("beta-usage", store.FactRow{Type: "hook_event", ConversationID: "sess-beta", Harness: "harness-b",
		Event: "usage", NormEvent: "usage", Model: "model-b", TokIn: 20, TokOut: 5, TS: base + 5100})
	// sess-gamma: repo-c/plan-b; tool lanes for Read and Bash.
	mk("gamma-read", store.FactRow{Type: "hook_event", ConversationID: "sess-gamma", Harness: "harness-c",
		Event: "tool_call", NormEvent: "tool_call", Tool: "Read", RepoID: "repo-c", TS: base + 3000})
	mk("gamma-bash", store.FactRow{Type: "hook_event", ConversationID: "sess-gamma", Harness: "harness-c",
		Event: "tool_call", NormEvent: "tool_call", Tool: "Bash", RepoID: "repo-c", TS: base + 3100})

	artifacts := []struct{ id, plan, kind, repo, conv, path string }{
		{"plan-a-design", "plan-a", "design", "repo-a", "sess-alpha", "docs/plans/plan-a/DESIGN.md"},
		{"plan-a-brief", "plan-a", "brief", "repo-b", "sess-beta", "docs/plans/plan-a/briefs/01-task.md"},
		{"plan-a-report", "plan-a", "report", "repo-a", "sess-alpha", "docs/plans/plan-a/reports/01-task.md"},
		{"plan-b-design", "plan-b", "design", "repo-c", "sess-gamma", "docs/plans/plan-b/DESIGN.md"},
		{"plan-b-brief", "plan-b", "brief", "repo-b", "sess-beta", "docs/plans/plan-b/briefs/01-task.md"},
		{"plan-b-report", "plan-b", "report", "repo-c", "sess-gamma", "docs/plans/plan-b/reports/01-task.md"},
	}
	scores := []store.Score{
		{Check: "quality", Result: 0.8, Scorer: "legacy-scorer"},
		{Check: "clarity", Result: 0.7, Scorer: "legacy-scorer"},
		{Check: "legacy-check", Result: 0.6, Scorer: "legacy-scorer"},
	}
	for i, a := range artifacts {
		body := []byte(fmt.Sprintf("plan29 fixture %s body for %s\n", a.kind, a.plan))
		hash := keys.ContentHash(body)
		mk(a.id, store.FactRow{Type: "artifact_version", ConversationID: a.conv, Harness: "harness-a",
			Event: "artifact_version", RepoID: a.repo, Path: a.path, ContentHash: hash, TS: base + 6000 + float64(i)})
		if err := ts.t.WritePending(hash, body); err != nil {
			t.Fatalf("write pending %s: %v", a.id, err)
		}
		if err := ts.t.Promote(ctx, hash, store.Screen{Verdict: "pass", Scorer: "legacy-scorer"}); err != nil {
			t.Fatalf("promote %s: %v", a.id, err)
		}
		if err := ts.t.AppendScores(ctx, hash, scores); err != nil {
			t.Fatalf("scores %s: %v", a.id, err)
		}
	}

	if _, err := ts.t.Append(ctx, rows); err != nil {
		t.Fatalf("append facts: %v", err)
	}
	for _, r := range []store.Rejection{
		{Stage: "precheck", FactType: "artifact_version", Path: "docs/plans/plan-a/DESIGN.md", Reason: "plan29 precheck"},
		{Stage: "screen", FactType: "artifact_version", Path: "docs/plans/plan-a/DESIGN.md", Reason: "plan29 screen"},
	} {
		if err := ts.t.AppendRejection(ctx, r); err != nil {
			t.Fatalf("append rejection: %v", err)
		}
	}
	count, err := ts.t.FactCount(ctx)
	if err != nil {
		t.Fatalf("fact count: %v", err)
	}
	return count
}
