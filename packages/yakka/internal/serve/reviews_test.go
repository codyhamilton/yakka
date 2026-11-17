package serve

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
)

func reviewHTTPBody(t *testing.T, repo string) string {
	t.Helper()
	diff := "diff --git a/pkg/a.go b/pkg/a.go\nindex 1111111..2222222 100644\n--- a/pkg/a.go\n+++ b/pkg/a.go\n@@ -1 +1 @@\n-old code\n+new code\n"
	h := sha256.Sum256([]byte(diff))
	b, err := json.Marshal(review.Request{Capture: review.Capture{RepoID: repo, Mode: "range", View: "combined", Base: strings.Repeat("a", 40), Head: strings.Repeat("b", 40), Diff: diff, DiffSHA256: hex.EncodeToString(h[:]), Complete: true}, Kind: "adhoc", BuildModels: []review.BuildModel{{ID: "unknown"}}})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestReviewRESTRoutesAuthTenantAndReceipt(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid provider request")
		}
		if body["model"] != "claude-haiku-5-5" || body["output_config"].(map[string]any)["effort"] != "high" {
			t.Errorf("provider settings=%#v", body)
		}
		answer, _ := json.Marshal(map[string]any{"outcomes": []any{}, "findings": []any{}, "limitations": []any{}, "coverage": "complete"})
		response, _ := json.Marshal(map[string]any{"model": "claude-haiku-5-5", "content": []any{map[string]any{"type": "text", "text": string(answer)}}, "usage": map[string]any{"input_tokens": 80, "output_tokens": 20}})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	defer fake.Close()
	dir := t.TempDir()
	s := New(Config{Data: dir, Keys: []KeyPair{{Tenant: "a", Key: "ka"}, {Tenant: "b", Key: "kb"}}, ReviewToken: "credential-sentinel"}, Options{DisableWorker: true, ReviewEndpoint: fake.URL, PollInterval: time.Hour})
	defer s.Close()
	h := s.Handler()
	if code, _ := do(t, h, "POST", "/v1/reviews", "", reviewHTTPBody(t, "repo-a")); code != 401 {
		t.Fatalf("missing bearer status=%d", code)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/reviews", strings.NewReader(reviewHTTPBody(t, "repo-a")))
	req.Header.Set("Authorization", "Bearer ka")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"ok"`) || strings.Contains(rec.Body.String(), "new code") {
		t.Fatalf("POST status=%d body=%s", rec.Code, rec.Body.String())
	}
	var posted review.Receipt
	if err := json.Unmarshal(rec.Body.Bytes(), &posted); err != nil || posted.ID == "" {
		t.Fatalf("receipt id: %v %s", err, rec.Body.String())
	}
	code, body := do(t, h, "GET", "/v1/reviews?repo_id=repo-a&kind=adhoc&status=ok&effort=high&profile=shadow&limit=10", "ka", "")
	if code != 200 || !strings.Contains(body, `"reviews":[{`) || strings.Contains(body, `"payload"`) {
		t.Fatalf("receipt GET=%d %s", code, body)
	}
	var listed struct {
		Reviews []map[string]any `json:"reviews"`
	}
	if err := json.Unmarshal([]byte(body), &listed); err != nil || len(listed.Reviews) != 1 {
		t.Fatalf("listed reviews: %v %s", err, body)
	}
	if listed.Reviews[0]["id"] != posted.ID || listed.Reviews[0]["review_id"] != posted.ID {
		t.Fatalf("listed id=%v review_id=%v want %s", listed.Reviews[0]["id"], listed.Reviews[0]["review_id"], posted.ID)
	}
	code, body = do(t, h, "GET", "/v1/reviews?repo_id=repo-a&detail=full", "ka", "")
	if code != 200 || !strings.Contains(body, `"payload"`) {
		t.Fatalf("full GET=%d %s", code, body)
	}
	code, body = do(t, h, "GET", "/v1/reviews?repo_id=repo-a", "kb", "")
	if code != 200 || !strings.Contains(body, `"reviews":[]`) {
		t.Fatalf("tenant isolation=%d %s", code, body)
	}
}

func TestReviewRESTRejectsMalformedAndBodyLimit(t *testing.T) {
	s, _ := newServer(t, true)
	h := s.Handler()
	for _, tc := range []struct {
		body   string
		status int
	}{{"{", 400}, {strings.Repeat("x", review.MaxReviewBody+10), 413}} {
		req := httptest.NewRequest(http.MethodPost, "/v1/reviews", strings.NewReader(tc.body))
		req.Header.Set("Authorization", "Bearer ka")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("status=%d body=%s want=%d", rec.Code, rec.Body.String(), tc.status)
		}
	}
}

func TestReviewRESTReadTokenCanReadButCannotPost(t *testing.T) {
	gh := mockGitHub(t, 91, "review-reader", []mockEmail{{Email: "reader@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tenant := remoteCreateTenant(t, h, origin, sess, "review")
	_, readToken := remoteIssueToken(t, h, origin, sess, tenant, TokenScopeRead, "1d")
	s.cfg.ReviewToken = "secret"
	if code, body := do(t, h, "POST", "/v1/reviews", readToken, reviewHTTPBody(t, "repo-a")); code != 403 || !strings.Contains(body, "read_write scope required") {
		t.Fatalf("read token POST=%d %s", code, body)
	}
	if code, body := do(t, h, "GET", "/v1/reviews?repo_id=repo-a", readToken, ""); code != 200 || !strings.Contains(body, `"reviews":[]`) {
		t.Fatalf("read token GET=%d %s", code, body)
	}
}

func reviewPost(t *testing.T, s *Server, key, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/reviews", strings.NewReader(body))
	req.Host = "127.0.0.1:8770"
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func TestReviewRESTUnavailableWithoutToken(t *testing.T) {
	s := New(Config{Addr: "0.0.0.0:8770", Data: t.TempDir(), Keys: []KeyPair{{Tenant: "a", Key: "ka"}}}, Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })
	code, body := reviewPost(t, s, "ka", reviewHTTPBody(t, "repo-a"))
	var receipt review.Receipt
	if code != 200 || json.Unmarshal([]byte(body), &receipt) != nil ||
		receipt.Status != "unavailable" || receipt.Reason != "CLAUDE_API_TOKEN" {
		t.Fatalf("token-less POST=%d %s", code, body)
	}
}

func TestReviewRESTUnavailableInLocalMode(t *testing.T) {
	s := New(Config{Addr: "127.0.0.1:8770", Data: t.TempDir(), ReviewToken: "secret"}, Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })
	code, body := reviewPost(t, s, "", reviewHTTPBody(t, "repo-a"))
	var receipt review.Receipt
	if code != 200 || json.Unmarshal([]byte(body), &receipt) != nil ||
		receipt.Status != "unavailable" || receipt.Reason != "authenticated remote mode required" {
		t.Fatalf("local POST=%d %s", code, body)
	}
}

func TestReviewEnvironmentConfigValidation(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	unset, err := ConfigFromEnv(env(map[string]string{"CLAUDE_API_TOKEN": "private-value"}))
	if err != nil || unset.ReviewToken != "private-value" || unset.ReviewModel != "" || unset.EffectiveReviewModel() != review.LiveModel {
		t.Fatalf("unset model: config=%+v err=%v", unset, err)
	}
	// YAKKA_REVIEW_MODEL is optional; effort, cap and repo allowlist are still ignored and
	// an invalid cap does not fail startup.
	withOptional := map[string]string{
		"CLAUDE_API_TOKEN":     "private-value",
		"YAKKA_REVIEW_MODEL":   "optional-env-model",
		"YAKKA_REVIEW_EFFORT":  "high",
		"YAKKA_REVIEW_USD_CAP": "zero",
		"YAKKA_REVIEW_REPOS":   "not-qualified",
	}
	c, err := ConfigFromEnv(env(withOptional))
	if err != nil || c.ReviewToken != "private-value" {
		t.Fatalf("optional model: config=%+v err=%v", c, err)
	}
	if c.ReviewModel != "optional-env-model" || c.EffectiveReviewModel() != "optional-env-model" {
		t.Fatalf("optional model not applied: %+v", c)
	}
}
