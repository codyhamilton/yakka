package serve

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
)

// isolationFixture is the Phase 2 synthetic-trial fixture: two fresh ownership-
// marked tenants created through the authenticated routes, each with its own
// wk_ key and a tenant-qualified review allowlist, plus a deterministic fake
// provider. No live provider is contacted.
type isolationFixture struct {
	t                       *testing.T
	s                       *Server
	h                       http.Handler
	origin                  string
	sess                    []*http.Cookie
	realTenant, synthTenant string
	realKey, synthKey       string
}

func newIsolationFixture(t *testing.T) *isolationFixture {
	t.Helper()
	gh := mockGitHub(t, 9001, "isolation-owner", []mockEmail{{Email: "isolation@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Error("invalid provider request")
		}
		answer, _ := json.Marshal(map[string]any{
			"outcomes": []any{},
			"findings": []any{map[string]any{
				"id": "synthetic-finding", "severity": "high", "lens": "correctness",
				"title": "synthetic isolating finding", "path": "unsupported",
				"line_start": 0, "line_end": 0, "evidence": "synthetic evidence",
				"criterion_ids": []any{}, "confidence": 0.9, "rationale": "synthetic rationale",
			}},
			"limitations": []any{},
			"coverage":    "complete",
		})
		response, _ := json.Marshal(map[string]any{
			"model":   "claude-haiku-5-5",
			"content": []any{map[string]any{"type": "text", "text": string(answer)}},
			"usage":   map[string]any{"input_tokens": 80, "output_tokens": 20},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	t.Cleanup(fake.Close)

	s := New(Config{
		Addr:                    "0.0.0.0:8770",
		Data:                    t.TempDir(),
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "cid",
		GitHubOAuthClientSecret: "csec",
		ReviewToken:             "fixture-only",
		ReviewModel:             "claude-haiku-5-5",
		ReviewUSDCap:            2,
	}, Options{DisableWorker: true, GitHubHTTPBase: gh.URL, ReviewEndpoint: fake.URL, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	realTenant := remoteCreateTenant(t, h, origin, sess, "real-work")
	synthTenant := remoteCreateTenant(t, h, origin, sess, "shadow-trial")
	_, realKey := remoteIssueToken(t, h, origin, sess, realTenant, TokenScopeReadWrite, "1d")
	_, synthKey := remoteIssueToken(t, h, origin, sess, synthTenant, TokenScopeReadWrite, "1d")
	// The YAKKA_REVIEW_REPOS-equivalent allowlist selects both tenants explicitly.
	s.cfg.ReviewRepositories = map[string]bool{realTenant + "/repo-a": true, synthTenant + "/repo-a": true}
	return &isolationFixture{t: t, s: s, h: h, origin: origin, sess: sess,
		realTenant: realTenant, synthTenant: synthTenant, realKey: realKey, synthKey: synthKey}
}

func isolationReviewBody(t *testing.T, repo string, tags []string, store bool) string {
	t.Helper()
	diff := "diff --git a/pkg/a.go b/pkg/a.go\nindex 1111111..2222222 100644\n--- a/pkg/a.go\n+++ b/pkg/a.go\n@@ -1 +1 @@\n-old code\n+new code\n"
	sum := sha256.Sum256([]byte(diff))
	req := review.Request{
		Capture: review.Capture{RepoID: repo, Mode: "range", View: "combined",
			Base: strings.Repeat("a", 40), Head: strings.Repeat("b", 40), Diff: diff,
			DiffSHA256: hex.EncodeToString(sum[:]), Complete: true},
		Kind: "adhoc", BuildModels: []review.BuildModel{{ID: "unknown"}}, Tags: tags, Store: &store,
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func isolationArtifactBody(marker string) string {
	content := "# synthetic isolation\n" + marker + "\n"
	b, _ := json.Marshal(map[string]any{"facts": []any{map[string]any{
		"id": "iso#0", "type": "artifact_version", "conversation_id": "iso-conv", "harness": "iso",
		"event": "write", "ts": float64(time.Now().Unix()), "repo_id": "repo-a",
		"path": "docs/plans/iso/DESIGN.md", "content": content,
		"content_hash": keys.ContentHash([]byte(content)), "source": "worktree",
	}}})
	return string(b)
}

func (f *isolationFixture) get(path, key string) string {
	f.t.Helper()
	code, body := do(f.t, f.h, "GET", path, key, "")
	if code != 200 {
		f.t.Fatalf("GET %s = %d %s", path, code, body)
	}
	return body
}

func (f *isolationFixture) postJSON(path, key, body string) (int, string) {
	f.t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func (f *isolationFixture) sessionGet(path string) string {
	f.t.Helper()
	code, body, _ := doWithCookies(f.t, f.h, "GET", path, "", "", f.sess)
	if code != 200 {
		f.t.Fatalf("session GET %s = %d %s", path, code, body)
	}
	return body
}

func reviewConvsFrom(t *testing.T, body string) []string {
	t.Helper()
	var page reviewPageResponse
	if err := json.Unmarshal([]byte(body), &page); err != nil {
		t.Fatalf("decode reviews %s: %v", body, err)
	}
	return reviewConvs(page)
}

// TestSyntheticTenantIsolationStoredActivity proves a stored synthetic review,
// its tags, findings, usage/spend, search and analytics never enter the
// real-work tenant's keyed or session-selected reads.
func TestSyntheticTenantIsolationStoredActivity(t *testing.T) {
	f := newIsolationFixture(t)
	now := time.Now().UTC()
	window := "from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) +
		"&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	summaryPath := "/v1/analytics/summary?" + window
	realReviewsBefore := f.get("/v1/reviews?repo_id=repo-a&detail=full", f.realKey)
	realSearchBefore := f.get("/v1/search?q=isolationmarker", f.realKey)
	realSummaryBefore := f.get(summaryPath, f.realKey)

	code, body := f.postJSON("/v1/reviews", f.synthKey, isolationReviewBody(t, "repo-a", []string{"trial:iso"}, true))
	if code != 200 {
		t.Fatalf("stored synthetic review: %d %s", code, body)
	}
	var receipt review.Receipt
	if err := json.Unmarshal([]byte(body), &receipt); err != nil || receipt.ID == "" || receipt.Status != "ok" {
		t.Fatalf("synthetic receipt %s: %v", body, err)
	}

	if got := reviewConvsFrom(t, f.get("/v1/reviews?repo_id=repo-a&tag=trial:iso", f.synthKey)); len(got) != 1 {
		t.Fatalf("synthetic tag filter saw %v, want its own review", got)
	}
	if got := reviewConvsFrom(t, f.get("/v1/reviews?repo_id=repo-a&tag=trial:iso", f.realKey)); len(got) != 0 {
		t.Fatalf("real-work key saw synthetic reviews: %v", got)
	}
	if got := reviewConvsFrom(t, f.sessionGet("/v1/reviews?tenant="+f.realTenant+"&repo_id=repo-a&detail=full")); len(got) != 0 {
		t.Fatalf("real-work session saw synthetic reviews: %v", got)
	}
	if got := reviewConvsFrom(t, f.sessionGet("/v1/reviews?tenant="+f.synthTenant+"&repo_id=repo-a&tag=trial:iso")); len(got) != 1 {
		t.Fatalf("shared owner selecting the synthetic tenant saw %v, want its own review", got)
	}
	if !strings.Contains(f.get("/v1/reviews?repo_id=repo-a&detail=full", f.synthKey), "synthetic isolating finding") {
		t.Fatal("synthetic tenant did not see its own finding")
	}
	if body := f.get("/v1/reviews?repo_id=repo-a&detail=full", f.realKey); body != realReviewsBefore || strings.Contains(body, receipt.ID) {
		t.Fatalf("real-work reviews changed: before=%s after=%s", realReviewsBefore, body)
	}

	// The provider-wide cap is operational only; no response exposes another
	// tenant's spend, and the real-work tenant's review-spend measure is zero.
	realTS, err := f.s.tenant(f.realTenant)
	if err != nil {
		t.Fatal(err)
	}
	if spend, err := realTS.t.ReviewSpend(context.Background()); err != nil || spend != 0 {
		t.Fatalf("real-work review spend = %v err=%v", spend, err)
	}
	synthTS, err := f.s.tenant(f.synthTenant)
	if err != nil {
		t.Fatal(err)
	}
	if rows, err := synthTS.t.ReviewUsageRecords(context.Background()); err != nil || len(rows) != 0 {
		t.Fatalf("stored review wrote review_usage: %d err=%v", len(rows), err)
	}
	if body := f.get(summaryPath, f.realKey); body != realSummaryBefore || strings.Contains(body, receipt.ID) {
		t.Fatalf("real-work analytics changed: before=%s after=%s", realSummaryBefore, body)
	}

	// Search isolation: a synthetic artifact is indexed only in its own tenant.
	if code, body := f.postJSON("/v1/ingest", f.synthKey, isolationArtifactBody("isolationmarker")); code != 200 {
		t.Fatalf("synthetic ingest: %d %s", code, body)
	}
	f.s.StartWorker()
	deadline := time.Now().Add(5 * time.Second)
	for {
		code, body := do(t, f.h, "GET", "/v1/search?q=isolationmarker", f.synthKey, "")
		if code == 200 && !strings.Contains(body, `"hits":[]`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("synthetic search never indexed: %d %s", code, body)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if body := f.get("/v1/search?q=isolationmarker", f.realKey); body != realSearchBefore {
		t.Fatalf("real-work search changed: before=%s after=%s", realSearchBefore, body)
	}
	var synthSummary map[string]any
	if err := json.Unmarshal([]byte(f.get(summaryPath, f.synthKey)), &synthSummary); err != nil || synthSummary["artifact_versions"] == float64(0) {
		t.Fatalf("synthetic analytics did not see its activity: %v", synthSummary)
	}
	if body := f.get(summaryPath, f.realKey); body != realSummaryBefore {
		t.Fatalf("real-work analytics changed after synthetic ingest: before=%s after=%s", realSummaryBefore, body)
	}
}

// TestSyntheticTenantIsolationUnpersistedActivity repeats the isolation checks
// for a store=false call that reaches the provider under the synthetic key.
func TestSyntheticTenantIsolationUnpersistedActivity(t *testing.T) {
	f := newIsolationFixture(t)
	realReviewsBefore := f.get("/v1/reviews?repo_id=repo-a&detail=full", f.realKey)

	code, body := f.postJSON("/v1/reviews", f.synthKey, isolationReviewBody(t, "repo-a", []string{"trial:iso"}, false))
	if code != 200 {
		t.Fatalf("unpersisted synthetic review: %d %s", code, body)
	}
	var receipt review.Receipt
	if err := json.Unmarshal([]byte(body), &receipt); err != nil || receipt.Status != "ok" || receipt.Result == nil {
		t.Fatalf("unpersisted receipt %s: %v", body, err)
	}

	// Neither tenant lists it as a review row; only the synthetic tenant holds
	// the content-free usage fact and its spend.
	if got := reviewConvsFrom(t, f.get("/v1/reviews?repo_id=repo-a&detail=full", f.synthKey)); len(got) != 0 {
		t.Fatalf("store=false wrote a review row: %v", got)
	}
	if got := reviewConvsFrom(t, f.sessionGet("/v1/reviews?tenant="+f.realTenant+"&repo_id=repo-a&detail=full")); len(got) != 0 {
		t.Fatalf("real-work session saw synthetic unpersisted activity: %v", got)
	}
	if body := f.get("/v1/reviews?repo_id=repo-a&detail=full", f.realKey); body != realReviewsBefore {
		t.Fatalf("real-work reviews changed: before=%s after=%s", realReviewsBefore, body)
	}

	synthTS, err := f.s.tenant(f.synthTenant)
	if err != nil {
		t.Fatal(err)
	}
	usage, err := synthTS.t.ReviewUsageRecords(context.Background())
	if err != nil || len(usage) != 1 || usage[0].UsageID == "" {
		t.Fatalf("synthetic usage fact = %+v err=%v", usage, err)
	}
	if spend, err := synthTS.t.ReviewSpend(context.Background()); err != nil || spend <= 0 {
		t.Fatalf("synthetic review spend = %v err=%v", spend, err)
	}
	realTS, err := f.s.tenant(f.realTenant)
	if err != nil {
		t.Fatal(err)
	}
	if realUsage, err := realTS.t.ReviewUsageRecords(context.Background()); err != nil || len(realUsage) != 0 {
		t.Fatalf("real-work usage leaked: %+v err=%v", realUsage, err)
	}
	if spend, err := realTS.t.ReviewSpend(context.Background()); err != nil || spend != 0 {
		t.Fatalf("real-work spend leaked: %v err=%v", spend, err)
	}

	total, attributed := reservationSpent(t, f.s)
	if total <= 0 {
		t.Fatalf("provider-wide exposure not recorded: %v", total)
	}
	for _, tenant := range attributed {
		if tenant == f.realTenant {
			t.Fatalf("synthetic spend attributed to real work: %v", attributed)
		}
	}
	if body := f.get("/v1/reviews?repo_id=repo-a&detail=full", f.realKey); strings.Contains(body, usage[0].UsageID) {
		t.Fatalf("real-work response exposed synthetic identity: %s", body)
	}
}
