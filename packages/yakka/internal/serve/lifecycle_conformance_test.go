package serve

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func conformanceLifecycleRequest(origin string, sess []*http.Cookie, method, tenant, action string) *http.Request {
	path := "/v1/tenants/" + tenant
	if action == "reset" {
		path += "/reset"
	}
	body := `{"confirm_tenant_id":"` + tenant + `"}`
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Origin", origin)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set(tenantLifecycleUIHeader, tenantLifecycleUIValue)
	req.Header.Set("Content-Type", "application/json")
	for _, c := range sess {
		req.AddCookie(c)
	}
	return req
}

// TestLifecycleConformanceResetDeleteThroughHTTP drives reset and delete through
// the owner HTTP routes and proves the complete-disposal contract end to end.
func TestLifecycleConformanceResetDeleteThroughHTTP(t *testing.T) {
	tg := newLifecycleHTTPTarget(t, Options{})
	s, h, dir := tg.s, tg.h, tg.dir
	other, ok, err := s.registry.CreateTenant("other", tg.ownerID)
	if err != nil || !ok {
		t.Fatalf("create other: ok=%v err=%v", ok, err)
	}
	otherTok, err := s.registry.CreateToken(other, TokenScopeRead, "other", time.Now().Add(time.Hour), tg.ownerID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	seedTenantAssets(t, s, other)
	seedTenantReservations(t, s, map[string]float64{tg.tenant: 1.25, other: 2.5})
	seedReviewRows(t, s, tg.tenant, []store.FactRow{
		reviewTestRow("conf-a", "conf-a", 10, nil),
		reviewTestRow("conf-b", "conf-b", 20, nil),
	})
	before := lifecycleRecord(t, s, tg.tenant)
	beforeTotal, _ := reservationSpent(t, s)
	otherDigest := digestTree(t, filepath.Join(dir, other))

	first := reviewPage(t, s, "/v1/reviews?limit=1", tg.key)
	if first.Complete || first.NextCursor == nil {
		t.Fatalf("fixture cursor: complete=%v cursor=%v", first.Complete, first.NextCursor)
	}
	stale := *first.NextCursor

	reset := func(tenant string) *httptest.ResponseRecorder {
		req := tg.validLifecycleRequest(http.MethodPost, tenant, "reset")
		req.AddCookie(tg.owner[0])
		return tg.send(req)
	}
	del := func(tenant string) *httptest.ResponseRecorder {
		req := tg.validLifecycleRequest(http.MethodDelete, tenant, "")
		req.AddCookie(tg.owner[0])
		return tg.send(req)
	}
	rec := reset(tg.tenant)
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("reset = %d %s", rec.Code, rec.Body.String())
	}
	after := lifecycleRecord(t, s, tg.tenant)
	if after.State != lifecycleStateActive || after.Operation != "" ||
		after.Generation == before.Generation || after.Marker != before.Marker ||
		s.registry.TenantName(tg.tenant) != "owned" || !s.registry.ownsTenant(tg.ownerID, tg.tenant) {
		t.Fatalf("reset identity/generation: before=%+v after=%+v", before, after)
	}
	if _, err := os.Stat(filepath.Join(dir, tg.tenant)); !os.IsNotExist(err) {
		t.Fatalf("reset left the directory: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, lifecycleTrashName, tg.tenant)); !os.IsNotExist(err) {
		t.Fatalf("reset left quarantine: %v", err)
	}
	if s.cachedTenant(tg.tenant) != nil {
		t.Fatal("reset kept a cached tenant state")
	}
	for _, tok := range s.registry.ListAllTokens() {
		if tok.Tenant == tg.tenant {
			t.Fatalf("reset left token: %+v", tok)
		}
	}
	if s.grants.tenantResidue(tg.tenant) {
		t.Fatal("reset left a device grant")
	}
	if s.reviewReservations.TenantResidue(tg.tenant) || !s.reviewReservations.TenantResidue(other) {
		t.Fatal("reset claim/spend attribution is wrong")
	}
	afterTotal, attributed := reservationSpent(t, s)
	if afterTotal != beforeTotal {
		t.Fatalf("provider-wide exposure changed: %v -> %v", beforeTotal, afterTotal)
	}
	for _, tenant := range attributed {
		if tenant == tg.tenant {
			t.Fatalf("reset left attributed spend: %v", attributed)
		}
	}
	if got := digestTree(t, filepath.Join(dir, other)); got != otherDigest {
		t.Fatal("reset changed the other tenant's bytes")
	}
	if code, _ := do(t, h, "GET", "/v1/whoami", tg.key, ""); code != 401 {
		t.Fatalf("old key still authorizes after reset: %d", code)
	}

	// A post-reset lazy admission opens an empty store; a pre-reset cursor fails.
	fresh, err := s.registry.CreateToken(tg.tenant, TokenScopeRead, "fresh", time.Now().Add(time.Hour), tg.ownerID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if code, body := do(t, h, "GET", "/v1/reviews", fresh.Plaintext, ""); code != 200 || !strings.Contains(body, `"reviews":[]`) {
		t.Fatalf("post-reset admission = %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(dir, tg.tenant)); err != nil {
		t.Fatalf("lazy admission did not open an empty store: %v", err)
	}
	ts, err := s.tenant(tg.tenant)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := ts.t.FactCount(context.Background()); err != nil || n != 0 {
		t.Fatalf("reset store not empty: facts=%d err=%v", n, err)
	}
	if rows, err := ts.t.ReviewUsageRecords(context.Background()); err != nil || len(rows) != 0 {
		t.Fatalf("reset store usage=%d err=%v", len(rows), err)
	}
	if rows, err := ts.t.ReviewRecords(context.Background(), store.ReviewRecordFilter{}); err != nil || len(rows) != 0 {
		t.Fatalf("reset store reviews=%d err=%v", len(rows), err)
	}
	if code, body := do(t, h, "GET", "/v1/reviews?limit=1&cursor="+url.QueryEscape(stale), fresh.Plaintext, ""); code != 400 {
		t.Fatalf("pre-reset cursor after reset = %d %s, want 400", code, body)
	}

	// A repeated confirmed reset erases the then-current assets again.
	seedTenantAssets(t, s, tg.tenant)
	firstResetGeneration := after.Generation
	if rec := reset(tg.tenant); rec.Code != http.StatusNoContent {
		t.Fatalf("second reset = %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, tg.tenant)); !os.IsNotExist(err) {
		t.Fatalf("second reset left assets: %v", err)
	}
	if again := lifecycleRecord(t, s, tg.tenant); again.Generation == firstResetGeneration || again.State != lifecycleStateActive {
		t.Fatalf("second reset generation: %+v", again)
	}

	if rec := del(tg.tenant); rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body.String())
	}
	if s.registry.tenantRegistered(tg.tenant) || s.registry.ownsTenant(tg.ownerID, tg.tenant) {
		t.Fatal("deleted tenant still registered/owned")
	}
	if _, ok := s.registry.TenantLifecycle(tg.tenant); ok {
		t.Fatal("deleted tenant still has lifecycle metadata")
	}
	if _, err := os.Stat(filepath.Join(dir, tg.tenant)); !os.IsNotExist(err) {
		t.Fatalf("delete left the directory: %v", err)
	}
	if rec := del(tg.tenant); rec.Code != http.StatusNotFound {
		t.Fatalf("repeat delete = %d %s", rec.Code, rec.Body.String())
	}
	// A later admission refuses without recreating the deleted directory.
	if _, err := s.tenant(tg.tenant); !errors.Is(err, ErrTenantNotFound) {
		t.Fatalf("deleted tenant admission = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, tg.tenant)); !os.IsNotExist(err) {
		t.Fatalf("refused admission recreated the directory: %v", err)
	}

	if rec := del(other); rec.Code != http.StatusNoContent {
		t.Fatalf("delete other = %d %s", rec.Code, rec.Body.String())
	}
	if rec := del(other); rec.Code != http.StatusNotFound {
		t.Fatalf("repeat delete other = %d %s", rec.Code, rec.Body.String())
	}
	if code, body := do(t, h, "GET", "/v1/whoami", otherTok.Plaintext, ""); code != 401 {
		t.Fatalf("deleted other key still authorizes: %d %s", code, body)
	}
	if _, ok := s.registry.GetSession("sess-owner", time.Now()); !ok {
		t.Fatal("lifecycle cleared the user-global session")
	}
}

// TestLifecycleConformanceRefusalsNoEffects exercises the HTTP refusal matrix;
// every refusal must leave the store, tokens, grants, claims and spend unchanged.
func TestLifecycleConformanceRefusalsNoEffects(t *testing.T) {
	tg := newLifecycleHTTPTarget(t, Options{})
	owner := func(req *http.Request) { req.AddCookie(tg.owner[0]) }
	cases := []struct {
		name    string
		request func() *http.Request
		status  int
		code    string
	}{
		{"bearer key", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			req.Header.Set("Authorization", "Bearer "+tg.key)
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"bearer plus owner cookie and UI headers", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Authorization", "Bearer "+tg.key)
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"expired key plus owner cookie", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Authorization", "Bearer "+tg.expiredKey)
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"non-owner", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			req.AddCookie(tg.stranger[0])
			return req
		}, 403, "tenant_owner_required"},
		{"admin non-owner", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			req.AddCookie(tg.admin[0])
			return req
		}, 403, "tenant_owner_required"},
		{"Pages origin", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Origin", pagesOrigin)
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"configured CORS origin", func() *http.Request {
			tg.s.cfg.CORSOrigins = []string{"https://allowed.example"}
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Origin", "https://allowed.example")
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"same-site fetch", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Sec-Fetch-Site", "same-site")
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"cross-site fetch", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Sec-Fetch-Site", "cross-site")
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"absent Origin", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Del("Origin")
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"null Origin", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Origin", "null")
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"missing UI header", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Del(tenantLifecycleUIHeader)
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"wrong UI header", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set(tenantLifecycleUIHeader, "something-else")
			return req
		}, 403, "tenant_lifecycle_ui_only"},
		{"missing session", func() *http.Request {
			return tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
		}, 401, "session_required"},
		{"non-JSON", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			req.Header.Set("Content-Type", "text/plain")
			return req
		}, 415, "json_required"},
		{"malformed confirmation", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			setLifecycleBody(req, "{")
			return req
		}, 400, "tenant_confirmation_mismatch"},
		{"missing confirmation", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			setLifecycleBody(req, "{}")
			return req
		}, 400, "tenant_confirmation_mismatch"},
		{"wrong-type confirmation", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			setLifecycleBody(req, `{"confirm_tenant_id":5}`)
			return req
		}, 400, "tenant_confirmation_mismatch"},
		{"mismatched confirmation", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			owner(req)
			setLifecycleBody(req, `{"confirm_tenant_id":"somebody-else"}`)
			return req
		}, 400, "tenant_confirmation_mismatch"},
		{"absent id", func() *http.Request {
			req := tg.validLifecycleRequest(http.MethodDelete, "t-absent", "")
			owner(req)
			return req
		}, 404, "tenant_not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant)
			rec := tg.send(tc.request())
			assertLifecycleError(t, rec, tc.status, tc.code, "")
			if got := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant); got != before {
				t.Fatal("refusal changed store, tokens, grants, claims or spend")
			}
		})
	}

	// Legacy tenants without a trustworthy marker refuse before effects.
	dir := t.TempDir()
	legacy := `{"version":1,"policy":{"mode":"everyone"},"sessions":{},"owners":{"t-legacy":"777"},"names":{"t-legacy":"old"},"token_hashes":[]}`
	if err := os.WriteFile(filepath.Join(dir, registryFileName), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	ls := New(lifecycleConfig(dir, "http://127.0.0.1:1"), Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = ls.Close() })
	lsess := putLifecycleSession(t, ls, "sess-legacy", 777)
	req := conformanceLifecycleRequest("https://collector.example", lsess, http.MethodDelete, "t-legacy", "")
	rec := httptest.NewRecorder()
	ls.Handler().ServeHTTP(rec, req)
	assertLifecycleError(t, rec, 409, "legacy_tenant_cleanup_unsupported", "")
	if _, err := os.Stat(filepath.Join(dir, "t-legacy")); !os.IsNotExist(err) {
		t.Fatalf("legacy refusal opened storage: %v", err)
	}

	// Local keyless mode is refused for both operations. A non-JSON POST must
	// reach the lifecycle route's own local-mode refusal instead of being
	// answered 415 by localGuard's generic content-type check.
	localDir := t.TempDir()
	ls = New(Config{Data: localDir}, Options{DisableWorker: true})
	t.Cleanup(func() { _ = ls.Close() })
	for _, tc := range []struct{ name, method, path string }{
		{"reset", http.MethodPost, "/v1/tenants/local/reset"},
		{"delete", http.MethodDelete, "/v1/tenants/local"},
	} {
		t.Run("local "+tc.name, func(t *testing.T) {
			before := lifecycleStateDigest(t, ls, localDir, "local")
			req := httptest.NewRequest(tc.method, "http://127.0.0.1:8770"+tc.path, strings.NewReader("not json"))
			req.Header.Set("Content-Type", "text/plain")
			rec := httptest.NewRecorder()
			ls.Handler().ServeHTTP(rec, req)
			assertLifecycleError(t, rec, 403, "tenant_lifecycle_ui_only", tenantLifecycleUIMessage)
			if got := lifecycleStateDigest(t, ls, localDir, "local"); got != before {
				t.Fatal("local refusal changed store, tokens, grants, claims or spend")
			}
		})
	}
}

// TestLifecycleConformanceCrashRestartExactlyOnce stops the reset at every
// injected stage, restarts, and proves no premature success, no operation
// switch, exactly-once anonymous spend transfer and an untouched other tenant.
func TestLifecycleConformanceCrashRestartExactlyOnce(t *testing.T) {
	stages := []string{"after-begin", "after-stop", "after-quiesce", "after-tokens", "after-claims", "after-close", "after-rename", "after-erase"}
	for _, stage := range stages {
		t.Run(stage, func(t *testing.T) {
			gh := mockGitHub(t, 9300, "crash-owner", []mockEmail{{Email: "crash@example.com", Verified: true}})
			t.Cleanup(gh.Close)
			dir := t.TempDir()
			fault := func(at string) error {
				if at == stage {
					return errors.New("injected fault")
				}
				return nil
			}
			s1 := newLifecycleServer(dir, gh.URL, Options{LifecycleFault: fault})
			h := s1.Handler()
			origin := "https://collector.example"
			sess := loginRemote(t, h, origin)
			a := remoteCreateTenant(t, h, origin, sess, "a")
			other := remoteCreateTenant(t, h, origin, sess, "other")
			_, otherTok := remoteIssueToken(t, h, origin, sess, other, TokenScopeRead, "1d")
			seedTenantAssets(t, s1, a)
			seedTenantAssets(t, s1, other)
			seedTenantReservations(t, s1, map[string]float64{a: 1.5, other: 2.5})
			approveGrant(t, s1, "crash-a", a)
			before := lifecycleRecord(t, s1, a)
			beforeTotal, _ := reservationSpent(t, s1)

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, conformanceLifecycleRequest(origin, sess, http.MethodPost, a, "reset"))
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("faulted reset = %d %s, want 503", rec.Code, rec.Body.String())
			}
			if mid := lifecycleRecord(t, s1, a); mid.State != lifecycleStateResetting || mid.Operation != lifecycleOpReset {
				t.Fatalf("journal after fault: %+v", mid)
			}
			switchRec := httptest.NewRecorder()
			h.ServeHTTP(switchRec, conformanceLifecycleRequest(origin, sess, http.MethodDelete, a, ""))
			if switchRec.Code != http.StatusConflict || !strings.Contains(switchRec.Body.String(), "tenant_busy") {
				t.Fatalf("operation switch = %d %s", switchRec.Code, switchRec.Body.String())
			}
			if err := s1.Close(); err != nil {
				t.Fatal(err)
			}
			// SQLite checkpoints on close, so fix the other tenant's byte digest
			// after shutdown and before the resume.
			otherDigest := digestTree(t, filepath.Join(dir, other))

			s2 := newLifecycleServer(dir, gh.URL, Options{})
			after := lifecycleRecord(t, s2, a)
			if after.State != lifecycleStateActive || after.Operation != "" ||
				after.Generation == before.Generation || after.Marker != before.Marker {
				t.Fatalf("resume did not finish the reset: %+v", after)
			}
			if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
				t.Fatalf("resume left the directory: %v", err)
			}
			total2, attributed := reservationSpent(t, s2)
			if total2 != beforeTotal {
				t.Fatalf("resume changed provider-wide exposure: %v -> %v", beforeTotal, total2)
			}
			for _, tenant := range attributed {
				if tenant == a {
					t.Fatalf("resume left attributed spend: %v", attributed)
				}
			}
			if got := digestTree(t, filepath.Join(dir, other)); got != otherDigest {
				t.Fatal("resume changed the other tenant's bytes")
			}
			if code, body := do(t, s2.Handler(), "GET", "/v1/whoami", otherTok, ""); code != 200 || !strings.Contains(body, `"tenant":"`+other+`"`) {
				t.Fatalf("other tenant auth broke: %d %s", code, body)
			}
			if err := s2.Close(); err != nil {
				t.Fatal(err)
			}

			// A second restart must not transfer the same spend again.
			s3 := newLifecycleServer(dir, gh.URL, Options{})
			defer s3.Close()
			if total3, _ := reservationSpent(t, s3); total3 != beforeTotal {
				t.Fatalf("second resume double-counted spend: %v -> %v", beforeTotal, total3)
			}
			if got := digestTree(t, filepath.Join(dir, other)); got != otherDigest {
				t.Fatal("second resume changed the other tenant's bytes")
			}
			if code, body := do(t, s3.Handler(), "GET", "/v1/whoami", otherTok, ""); code != 200 || !strings.Contains(body, `"tenant":"`+other+`"`) {
				t.Fatalf("other tenant auth broke after second restart: %d %s", code, body)
			}
		})
	}
}

// TestLifecycleConformanceBusyPreservesOtherTenant holds the target in cleanup
// and proves concurrent target work is refused while the other tenant is
// byte-equivalent and usable.
func TestLifecycleConformanceBusyPreservesOtherTenant(t *testing.T) {
	gh := mockGitHub(t, 9400, "busy-owner", []mockEmail{{Email: "busy@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	reached := make(chan struct{})
	release := make(chan struct{})
	fault := func(stage string) error {
		if stage == "after-begin" {
			close(reached)
			<-release
		}
		return nil
	}
	s := newLifecycleServer(dir, gh.URL, Options{LifecycleFault: fault})
	t.Cleanup(func() { _ = s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")
	other := remoteCreateTenant(t, h, origin, sess, "other")
	_, aTok := remoteIssueToken(t, h, origin, sess, a, TokenScopeReadWrite, "1d")
	_, otherTok := remoteIssueToken(t, h, origin, sess, other, TokenScopeRead, "1d")
	seedTenantAssets(t, s, a)
	seedTenantAssets(t, s, other)
	seedTenantReservations(t, s, map[string]float64{a: 1.5, other: 2.5})
	approveGrant(t, s, "busy-a", a)
	seedReviewRows(t, s, a, []store.FactRow{reviewTestRow("busy-1", "busy-1", 10, nil), reviewTestRow("busy-2", "busy-2", 20, nil)})
	first := reviewPage(t, s, "/v1/reviews?limit=1", aTok)
	if first.Complete || first.NextCursor == nil {
		t.Fatalf("busy fixture cursor: complete=%v", first.Complete)
	}
	otherDigest := digestTree(t, filepath.Join(dir, other))
	before := lifecycleRecord(t, s, a)

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, conformanceLifecycleRequest(origin, sess, http.MethodPost, a, "reset"))
		done <- rec
	}()
	<-reached

	for _, tc := range []struct {
		name, method, path, body string
		key                      string
		cookies                  bool
		origin                   bool
	}{
		{"ingest", "POST", "/v1/ingest", artBody("# busy\n"), aTok, false, true},
		{"reviews", "GET", "/v1/reviews?repo_id=r", "", aTok, false, false},
		{"cursor read", "GET", "/v1/reviews?limit=1&cursor=" + url.QueryEscape(*first.NextCursor), "", aTok, false, false},
		{"token", "POST", "/v1/tokens", `{"tenant":"` + a + `","scope":"read","lifetime":"1d"}`, "", true, true},
		{"device redeem", "POST", "/v1/device/token", `{"device_code":"busy-a"}`, "", true, true},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if tc.origin {
			req.Header.Set("Origin", origin)
		}
		if tc.key != "" {
			req.Header.Set("Authorization", "Bearer "+tc.key)
		}
		if tc.cookies {
			for _, c := range sess {
				req.AddCookie(c)
			}
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "tenant_busy") {
			t.Fatalf("%s during cleanup = %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}
	select {
	case rec := <-done:
		t.Fatalf("cleanup returned early: %d %s", rec.Code, rec.Body.String())
	default:
	}
	if got := digestTree(t, filepath.Join(dir, other)); got != otherDigest {
		t.Fatal("busy target changed the other tenant's bytes")
	}
	if code, body := do(t, h, "GET", "/v1/whoami", otherTok, ""); code != 200 || !strings.Contains(body, `"tenant":"`+other+`"`) {
		t.Fatalf("other tenant unusable during cleanup: %d %s", code, body)
	}

	close(release)
	if rec := <-done; rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("reset after release = %d %s", rec.Code, rec.Body.String())
	}
	if after := lifecycleRecord(t, s, a); after.Generation == before.Generation {
		t.Fatal("reset did not advance the generation")
	}
	if got := digestTree(t, filepath.Join(dir, other)); got != otherDigest {
		t.Fatal("reset changed the other tenant's bytes")
	}
	if code, body := do(t, h, "GET", "/v1/whoami", otherTok, ""); code != 200 || !strings.Contains(body, `"tenant":"`+other+`"`) {
		t.Fatalf("other tenant unusable after cleanup: %d %s", code, body)
	}
}
