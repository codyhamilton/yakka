package serve

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func contentRequest(t *testing.T, h http.Handler, key, repo, path, hash string) *httptest.ResponseRecorder {
	t.Helper()
	u := "/v1/analytics/content?repo_id=" + repo + "&path=" + path + "&hash=" + hash
	req := httptest.NewRequest("GET", u, nil)
	req.Header.Set("Authorization", "Bearer "+key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func contentSessionRequest(t *testing.T, h http.Handler, tenant, repo, path, hash string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/v1/analytics/content?tenant="+tenant+"&repo_id="+repo+"&path="+path+"&hash="+hash, nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func contentFixture(t *testing.T, ts *tenantState, repo, path, content, verdict string) string {
	t.Helper()
	body := []byte(content)
	hash := keys.ContentHash(body)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "session", RepoID: repo, Path: path, ContentHash: hash, TS: 1}, nil)
	if err := ts.t.WritePending(hash, body); err != nil {
		t.Fatal(err)
	}
	if verdict != "pending" {
		if err := ts.t.Promote(context.Background(), hash, store.Screen{Verdict: verdict}); err != nil {
			t.Fatal(err)
		}
	}
	return hash
}

func TestAnalyticsContentExactIdentityAndStates(t *testing.T) {
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}, {"b", "kb"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { _ = s.Close() })
	a, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	path := "docs/plans/p/DESIGN.md"
	content := "# complete body\n"
	hash := contentFixture(t, a, "repo", path, content, "pass")
	pass := contentRequest(t, s.Handler(), "ka", "repo", path, hash)
	if pass.Code != 200 || pass.Body.String() != content || pass.Header().Get("Content-Type") != "text/plain; charset=utf-8" ||
		pass.Header().Get("X-Content-Type-Options") != "nosniff" || pass.Header().Get("Cache-Control") != "private, no-store" ||
		pass.Header().Get("X-Yakka-Screen-Verdict") != "pass" {
		t.Fatalf("pass response: status=%d headers=%v body=%q", pass.Code, pass.Header(), pass.Body.String())
	}
	if got := contentRequest(t, s.Handler(), "kb", "repo", path, hash); got.Code != 404 || got.Body.String() != `{"error":"not found"}`+"\n" {
		t.Fatalf("tenant isolation: %d %s", got.Code, got.Body.String())
	}
	if got := contentRequest(t, s.Handler(), "ka", "other-repo", path, hash); got.Code != 404 {
		t.Fatalf("wrong repo identity: %d %s", got.Code, got.Body.String())
	}
	if got := contentRequest(t, s.Handler(), "ka", "repo", "docs/plans/p/IMPLEMENTATION.md", hash); got.Code != 404 {
		t.Fatalf("unstored kind: %d %s", got.Code, got.Body.String())
	}

	unscreenedHash := contentFixture(t, a, "repo", "docs/plans/p/reports/r.md", "report", "unscreened")
	unscreened := contentRequest(t, s.Handler(), "ka", "repo", "docs/plans/p/reports/r.md", unscreenedHash)
	if unscreened.Code != 200 || unscreened.Header().Get("X-Yakka-Screen-Verdict") != "unscreened" {
		t.Fatalf("unscreened state: %d %v", unscreened.Code, unscreened.Header())
	}

	rejectedPath := "docs/plans/p/reports/rejected.md"
	rejectedHash := contentFixture(t, a, "repo", rejectedPath, "screen rejected", "fail")
	rejected := contentRequest(t, s.Handler(), "ka", "repo", rejectedPath, rejectedHash)
	var rejectedBody map[string]any
	_ = json.Unmarshal(rejected.Body.Bytes(), &rejectedBody)
	if rejected.Code != 404 || rejectedBody["reason"] != "removed_by_screen" || strings.Contains(rejected.Body.String(), "screen rejected") {
		t.Fatalf("rejected state: %d %s", rejected.Code, rejected.Body.String())
	}

	pendingHash := contentFixture(t, a, "repo", "docs/plans/p/briefs/b.md", "pending", "pending")
	pending := contentRequest(t, s.Handler(), "ka", "repo", "docs/plans/p/briefs/b.md", pendingHash)
	var pendingBody map[string]any
	_ = json.Unmarshal(pending.Body.Bytes(), &pendingBody)
	if pending.Code != 404 || pendingBody["reason"] != "pending" || strings.Contains(pending.Body.String(), "pending content") {
		t.Fatalf("pending state: %d %s", pending.Code, pending.Body.String())
	}

	missingPath := "docs/plans/p/briefs/missing.md"
	missingHash := keys.ContentHash([]byte("never stored"))
	qadd(t, a, store.FactRow{Type: "artifact_version", RepoID: "repo", Path: missingPath, ContentHash: missingHash, TS: 1}, nil)
	missing := contentRequest(t, s.Handler(), "ka", "repo", missingPath, missingHash)
	var missingBody map[string]any
	_ = json.Unmarshal(missing.Body.Bytes(), &missingBody)
	if missing.Code != 404 || missingBody["reason"] != "not_stored" {
		t.Fatalf("not stored state: %d %s", missing.Code, missing.Body.String())
	}

	removedPath := "docs/plans/p/reports/removed.md"
	removedHash := contentFixture(t, a, "repo", removedPath, "screened out", "pass")
	if err := a.t.DropBlob(context.Background(), removedHash, store.Rejection{Stage: "screen", Path: removedPath}); err != nil {
		t.Fatal(err)
	}
	removed := contentRequest(t, s.Handler(), "ka", "repo", removedPath, removedHash)
	var removedBody map[string]any
	_ = json.Unmarshal(removed.Body.Bytes(), &removedBody)
	if removed.Code != 404 || removedBody["reason"] != "removed_by_screen" {
		t.Fatalf("removed state: %d %s", removed.Code, removed.Body.String())
	}
}

func TestAnalyticsContentReadScopes(t *testing.T) {
	gh := mockGitHub(t, 420, "content-reader", []mockEmail{{Email: "reader@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tenant := remoteCreateTenant(t, h, origin, sess, "content")
	_, readToken := remoteIssueToken(t, h, origin, sess, tenant, TokenScopeRead, "1d")
	ts, err := s.tenant(tenant)
	if err != nil {
		t.Fatal(err)
	}
	path := "docs/plans/p/DESIGN.md"
	body := "reader-visible"
	hash := contentFixture(t, ts, tenant, path, body, "pass")
	if got := contentRequest(t, h, readToken, tenant, path, hash); got.Code != 200 || got.Body.String() != body {
		t.Fatalf("read bearer: %d %s", got.Code, got.Body.String())
	}
	if got := contentSessionRequest(t, h, tenant, tenant, path, hash, sess); got.Code != 200 || got.Body.String() != body {
		t.Fatalf("session: %d %s", got.Code, got.Body.String())
	}
}

func TestAnalyticsContentOversizeRefusesWholeBody(t *testing.T) {
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { _ = s.Close() })
	a, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	content := make([]byte, analyticsContentLimit+1)
	hash := keys.ContentHash(content)
	path := "docs/plans/p/DESIGN.md"
	qadd(t, a, store.FactRow{Type: "artifact_version", RepoID: "repo", Path: path, ContentHash: hash, TS: 1}, nil)
	blobDir := filepath.Join(a.t.Dir(), "blobs", hash[:2])
	if err := os.MkdirAll(blobDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blobDir, hash), content, 0o600); err != nil {
		t.Fatal(err)
	}
	resp := contentRequest(t, s.Handler(), "ka", "repo", path, hash)
	var body map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &body)
	if resp.Code != http.StatusRequestEntityTooLarge || body["code"] != "content_too_large" || body["size_bytes"] != float64(analyticsContentLimit+1) || body["limit_bytes"] != float64(analyticsContentLimit) || len(resp.Body.Bytes()) > 1024 {
		t.Fatalf("oversize response: status=%d body=%d bytes json=%v", resp.Code, resp.Body.Len(), body)
	}
}

func TestAnalyticsContentIntegrityAndUnavailableStates(t *testing.T) {
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { _ = s.Close() })
	a, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	path := "docs/plans/p/DESIGN.md"
	hash := contentFixture(t, a, "repo", path, "original", "pass")
	// A body mismatch must not return any bytes.
	if err := os.WriteFile(filepath.Join(a.t.Dir(), "blobs", hash[:2], hash), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	mismatch := contentRequest(t, s.Handler(), "ka", "repo", path, hash)
	if mismatch.Code != 500 || !strings.Contains(mismatch.Body.String(), `"code":"content_integrity"`) || strings.Contains(mismatch.Body.String(), "tampered") {
		t.Fatalf("integrity refusal: %d %s", mismatch.Code, mismatch.Body.String())
	}
}
