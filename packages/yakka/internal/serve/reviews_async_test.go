package serve

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
)

func blockingReviewServer(t *testing.T, calls *atomic.Int32, started chan<- struct{}, release <-chan struct{}) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		answer, _ := json.Marshal(map[string]any{"outcomes": []any{}, "findings": []any{}, "limitations": []any{}, "coverage": "complete"})
		response, _ := json.Marshal(map[string]any{"model": "claude-haiku-5-5", "content": []any{map[string]any{"type": "text", "text": string(answer)}}, "usage": map[string]any{"input_tokens": 80, "output_tokens": 20}})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
}

func asyncReviewServer(t *testing.T, endpoint string, wait time.Duration) *Server {
	t.Helper()
	s := New(Config{
		Data:        t.TempDir(),
		ReviewToken: "fixture-only",
		Keys:        []KeyPair{{Tenant: "a", Key: "ka"}, {Tenant: "b", Key: "kb"}},
	}, Options{DisableWorker: true, ReviewEndpoint: endpoint, PollInterval: time.Hour, ReviewWait: wait})
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestReviewRESTAsyncAcceptedThenPolledByID(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	fake := blockingReviewServer(t, &calls, started, release)
	defer fake.Close()
	s := asyncReviewServer(t, fake.URL, 0)
	h := s.Handler()

	code, body := reviewPost(t, s, "ka", reviewHTTPBody(t, "repo-a"))
	if code != http.StatusAccepted {
		t.Fatalf("POST=%d %s", code, body)
	}
	var accepted review.Receipt
	if err := json.Unmarshal([]byte(body), &accepted); err != nil || accepted.ID == "" || accepted.Status != review.StatusRunning {
		t.Fatalf("accepted=%s", body)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	code, body = do(t, h, "GET", "/v1/reviews/"+accepted.ID, "ka", "")
	if code != 200 || !strings.Contains(body, `"status":"running"`) || strings.Contains(body, `"payload"`) {
		t.Fatalf("in-flight GET=%d %s", code, body)
	}
	code, body = do(t, h, "GET", "/v1/reviews/"+accepted.ID+"?detail=full", "ka", "")
	if code != 200 || !strings.Contains(body, `"payload"`) {
		t.Fatalf("in-flight full GET=%d %s", code, body)
	}
	close(release)
	final := pollReview(t, h, "ka", accepted.ID)
	if final.ID != accepted.ID || final.Status != "ok" || final.CostUSD <= 0 || len(final.Attempts) == 0 || final.Attempts[0].InputTokens == 0 {
		t.Fatalf("final=%+v", final)
	}
}

func TestReviewRESTClientDisconnectDoesNotCancelAttempt(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	fake := blockingReviewServer(t, &calls, started, release)
	defer fake.Close()
	s := asyncReviewServer(t, fake.URL, 0)
	h := s.Handler()

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/v1/reviews", strings.NewReader(reviewHTTPBody(t, "repo-a"))).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer ka")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		h.ServeHTTP(rec, req)
		close(done)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	// The Cloudflare edge idle timeout cancels the request context mid-attempt.
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("POST did not return after disconnect")
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST=%d %s", rec.Code, rec.Body.String())
	}
	var accepted review.Receipt
	if err := json.Unmarshal(rec.Body.Bytes(), &accepted); err != nil || accepted.ID == "" {
		t.Fatalf("accepted=%s", rec.Body.String())
	}
	close(release)
	final := pollReview(t, h, "ka", accepted.ID)
	if final.Status != "ok" || final.CostUSD <= 0 {
		t.Fatalf("disconnect lost the result: %+v", final)
	}
}

func TestReviewRESTInFlightDuplicateReturnsSameIDAndSpendsOnce(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	fake := blockingReviewServer(t, &calls, started, release)
	defer fake.Close()
	s := asyncReviewServer(t, fake.URL, 0)
	h := s.Handler()

	body := reviewHTTPBody(t, "repo-a")
	code, first := reviewPost(t, s, "ka", body)
	if code != http.StatusAccepted {
		t.Fatalf("first POST=%d %s", code, first)
	}
	var accepted review.Receipt
	if err := json.Unmarshal([]byte(first), &accepted); err != nil || accepted.ID == "" {
		t.Fatalf("accepted=%s", first)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	code, second := reviewPost(t, s, "ka", body)
	var duplicate review.Receipt
	if code != http.StatusAccepted || json.Unmarshal([]byte(second), &duplicate) != nil ||
		duplicate.ID != accepted.ID || duplicate.Status != review.StatusRunning || calls.Load() != 1 {
		t.Fatalf("duplicate POST=%d %s calls=%d", code, second, calls.Load())
	}
	close(release)
	final := pollReview(t, h, "ka", accepted.ID)
	if final.Status != "ok" || calls.Load() != 1 {
		t.Fatalf("final=%+v calls=%d", final, calls.Load())
	}
	code, third := reviewPost(t, s, "ka", body)
	var cached review.Receipt
	if code != 200 || json.Unmarshal([]byte(third), &cached) != nil || cached.Status != "skipped_duplicate" ||
		cached.Cached == nil || !*cached.Cached || cached.OriginalReviewID != accepted.ID || calls.Load() != 1 {
		t.Fatalf("cached POST=%d %s calls=%d", code, third, calls.Load())
	}
}

func TestReviewRESTGetByIDTenantIsolationAndMissing(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	fake := blockingReviewServer(t, &calls, started, release)
	defer fake.Close()
	s := asyncReviewServer(t, fake.URL, 0)
	h := s.Handler()

	code, body := reviewPost(t, s, "ka", reviewHTTPBody(t, "repo-a"))
	if code != http.StatusAccepted {
		t.Fatalf("POST=%d %s", code, body)
	}
	var accepted review.Receipt
	if err := json.Unmarshal([]byte(body), &accepted); err != nil || accepted.ID == "" {
		t.Fatalf("accepted=%s", body)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	if code, body := do(t, h, "GET", "/v1/reviews/"+accepted.ID, "kb", ""); code != http.StatusNotFound || !strings.Contains(body, "review not found") {
		t.Fatalf("foreign tenant GET=%d %s", code, body)
	}
	if code, _ := do(t, h, "GET", "/v1/reviews/does-not-exist", "ka", ""); code != http.StatusNotFound {
		t.Fatalf("missing GET=%d", code)
	}
	close(release)
	pollReview(t, h, "ka", accepted.ID)
	if code, _ := do(t, h, "GET", "/v1/reviews/"+accepted.ID, "kb", ""); code != http.StatusNotFound {
		t.Fatalf("foreign tenant terminal GET=%d", code)
	}
}

func TestReviewMCPTimeoutPathReturnsInFlightIDWithoutCancelling(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	fake := blockingReviewServer(t, &calls, started, release)
	defer fake.Close()
	s := asyncReviewServer(t, fake.URL, 50*time.Millisecond)
	if s.mcpTool("review_change") == nil {
		t.Fatal("review_change not registered")
	}
	h := s.Handler()

	diff := "diff --git a/pkg/a.go b/pkg/a.go\nindex 1111111..2222222 100644\n--- a/pkg/a.go\n+++ b/pkg/a.go\n@@ -1 +1 @@\n-old code\n+new code\n"
	hash := sha256Hex([]byte(diff))
	capture := map[string]any{"repo_id": "repo-a", "mode": "uncommitted", "view": "combined", "head": strings.Repeat("b", 40), "diff": diff, "diff_sha256": hash, "complete": true}
	args := map[string]any{"mode": "uncommitted", "view": "combined", "kind": "adhoc", "build_models": []any{map[string]any{"id": "unknown"}}, "_local": map[string]any{"change": capture}}
	callBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "review_change", "arguments": args}})
	req := httptest.NewRequest(http.MethodPost, "/v1/mcp", strings.NewReader(string(callBody)))
	req.Header.Set("Authorization", "Bearer ka")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "timeout after") {
		t.Fatalf("MCP status=%d body=%s", rec.Code, rec.Body.String())
	}
	var rpc struct {
		Result review.Receipt `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &rpc); err != nil || rpc.Result.ID == "" || rpc.Result.Status != review.StatusRunning {
		t.Fatalf("MCP receipt=%s", rec.Body.String())
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	// The budget did not cancel the detached attempt; it finalizes on its own.
	close(release)
	final := pollReview(t, h, "ka", rpc.Result.ID)
	if final.Status != "ok" {
		t.Fatalf("detached MCP review did not finish: %+v", final)
	}
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
