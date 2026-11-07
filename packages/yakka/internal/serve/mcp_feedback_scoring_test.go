package serve

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// scoringFeedbackCall ingests content at path, then calls artifact_feedback with the file's
// current hash injected as the client would, and returns the answer text.
func scoringFeedbackCall(t *testing.T, s *Server, path, content string) string {
	t.Helper()
	h := s.Handler()
	if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBodyAt(path, content)); code != 200 {
		t.Fatalf("ingest %s: %d %s", path, code, body)
	}
	return scoringFeedbackAnswer(t, s, path, content)
}

// scoringFeedbackAnswer calls artifact_feedback for content already on the service.
func scoringFeedbackAnswer(t *testing.T, s *Server, path, content string) string {
	t.Helper()
	h := s.Handler()
	toolList := mcpDecode(t, mcpRequest(t, h, "ka", `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	decl := toolList[2].(map[string]any)["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	local := map[string]any{
		"_v": 1, "_rev": decl["rev"],
		"resolved_path": map[string]any{"path": "/work/" + path},
		"file":          map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte(content))},
		"git":           map[string]any{"repo_id": "r", "rel_path": path},
		"queue":         map[string]any{"pending": []any{}, "rejected": []any{}},
		"drain":         map[string]any{"running": false},
	}
	result := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("artifact_feedback", map[string]any{"path": path, "_local": local}), nil))["result"].(map[string]any)
	return result["content"].([]any)[0].(map[string]any)["text"].(string)
}

func TestFeedbackScoringValue(t *testing.T) {
	now := time.Unix(1700000100, 0)
	recent := now.Add(-5 * time.Second)
	window := now.Add(-feedbackPendingWindow)
	old := now.Add(-31 * time.Second)
	for _, tc := range []struct {
		name                 string
		configured, screened bool
		received             time.Time
		want                 string
	}{
		{"off without a scorer or checks", false, false, recent, "off"},
		{"off even when a screen is recorded", false, true, old, "off"},
		{"pending under the window with no screen", true, false, recent, "pending"},
		{"on once the screen is recorded", true, true, recent, "on"},
		{"on after the window with no screen", true, false, old, "on"},
		{"on exactly at the window edge", true, false, window, "on"},
	} {
		if got := feedbackScoring(tc.configured, tc.screened, tc.received, now); got != tc.want {
			t.Errorf("%s: feedbackScoring = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestMCPArtifactFeedbackScoringOffWithoutScorer(t *testing.T) {
	s := feedbackServer(t)
	// Checks alone do not make scoring on: the screen step is what scores.
	s.opts.Checks = &scorer.Checks{}
	h := s.Handler()
	const path = "docs/plans/x/DESIGN.md"
	if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBodyAt(path, "off")); code != 200 {
		t.Fatalf("ingest: %d %s", code, body)
	}
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	if err := ts.t.Promote(context.Background(), keys.ContentHash([]byte("off")), store.Screen{Verdict: "unscreened", Scorer: "none"}); err != nil {
		t.Fatal(err)
	}
	got := scoringFeedbackAnswer(t, s, path, "off")
	for _, line := range []string{
		"state: delivered",
		"screen: unscreened (no scorer on the service)",
		"scoring: off; scoring is not configured on the service, and stored content is scored by an admin rescore once it is",
	} {
		if !strings.Contains(got, line) {
			t.Errorf("feedback missing %q:\n%s", line, got)
		}
	}
	if strings.Contains(got, "scoring: on") || strings.Contains(got, "scoring: pending") {
		t.Errorf("scoring reported on without a scorer:\n%s", got)
	}
}

func TestMCPArtifactFeedbackScoringOnWaitsForScreen(t *testing.T) {
	s := feedbackServer(t)
	s.opts.ScreenStep = func(context.Context, *store.Tenant, string) error { return nil }
	s.opts.Checks = &scorer.Checks{}
	const path = "docs/plans/x/DESIGN.md"
	const content = "screened after a wait"
	hash := keys.ContentHash([]byte(content))
	h := s.Handler()
	if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBodyAt(path, content)); code != 200 {
		t.Fatalf("ingest: %d %s", code, body)
	}
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		_ = ts.t.Promote(context.Background(), hash, store.Screen{Verdict: "pass", Scorer: "jev-1"}, store.Score{Check: "clarity", Result: .6})
	}()
	started := time.Now()
	got := scoringFeedbackAnswer(t, s, path, content)
	if elapsed := time.Since(started); elapsed < 150*time.Millisecond || elapsed >= feedbackScreenWait {
		t.Fatalf("screen wait elapsed %s, want a bounded wait ended by the screen", elapsed)
	}
	for _, line := range []string{"state: delivered", "screen: pass by jev-1", "scoring: on", "clarity 0.60"} {
		if !strings.Contains(got, line) {
			t.Errorf("feedback missing %q:\n%s", line, got)
		}
	}
	if strings.Contains(got, "scoring: pending") {
		t.Errorf("screened version still reported pending:\n%s", got)
	}
}

func TestMCPArtifactFeedbackScoringPendingAfterScreenWait(t *testing.T) {
	if feedbackScreenWait != 10*time.Second {
		t.Fatalf("default screen wait = %s, want 10s", feedbackScreenWait)
	}
	previous := feedbackScreenWait
	feedbackScreenWait = 300 * time.Millisecond
	t.Cleanup(func() { feedbackScreenWait = previous })
	s := feedbackServer(t)
	s.opts.ScreenStep = func(context.Context, *store.Tenant, string) error { return nil }
	s.opts.Checks = &scorer.Checks{}
	const path = "docs/plans/x/DESIGN.md"
	started := time.Now()
	got := scoringFeedbackCall(t, s, path, "not yet screened")
	if elapsed := time.Since(started); elapsed < 250*time.Millisecond {
		t.Fatalf("pending answer did not wait for the screen: %s", elapsed)
	}
	for _, line := range []string{
		"state: delivered",
		"screen: awaiting screen",
		"scoring: pending; the screen has not run yet, so call again in a few seconds",
	} {
		if !strings.Contains(got, line) {
			t.Errorf("feedback missing %q:\n%s", line, got)
		}
	}
	if strings.Contains(got, "scoring: on") || strings.Contains(got, "scoring: off") {
		t.Errorf("pending answer reported a settled scoring value:\n%s", got)
	}
}
