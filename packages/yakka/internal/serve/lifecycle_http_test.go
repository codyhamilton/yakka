package serve

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func putLifecycleSession(t *testing.T, s *Server, id string, githubID int64, emails ...string) []*http.Cookie {
	t.Helper()
	s.registry.PutSession(id, SessionRecord{
		GitHubID:       githubID,
		GitHubLogin:    fmt.Sprintf("user-%d", githubID),
		VerifiedEmails: emails,
		ExpiresAt:      time.Now().Add(time.Hour),
	})
	return []*http.Cookie{{Name: sessionCookieName, Value: id}}
}

type lifecycleHTTPTarget struct {
	s               *Server
	h               http.Handler
	dir, origin     string
	ownerID         int64
	tenant, key     string
	expiredKey      string
	owner           []*http.Cookie
	stranger, admin []*http.Cookie
}

func newLifecycleHTTPTarget(t *testing.T, opts Options) *lifecycleHTTPTarget {
	t.Helper()
	dir := t.TempDir()
	opts.DisableWorker = true
	if opts.PollInterval == 0 {
		opts.PollInterval = time.Hour
	}
	s := New(lifecycleConfig(dir, "http://127.0.0.1:1"), opts)
	t.Cleanup(func() { _ = s.Close() })
	ownerID := int64(700)
	tenant, ok, err := s.registry.CreateTenant("owned", ownerID)
	if err != nil || !ok {
		t.Fatalf("create tenant: ok=%v err=%v", ok, err)
	}
	seedTenantAssets(t, s, tenant)
	seedTenantReservations(t, s, map[string]float64{tenant: 1.25})
	tok, err := s.registry.CreateToken(tenant, TokenScopeReadWrite, "lifecycle", time.Now().Add(time.Hour), ownerID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	expired, err := s.registry.CreateToken(tenant, TokenScopeRead, "expired", time.Now().Add(time.Hour), ownerID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	s.registry.mu.Lock()
	for i := range s.registry.tokenHashes {
		if s.registry.tokenHashes[i].ID == expired.Record.ID {
			s.registry.tokenHashes[i].ExpiresAt = time.Now().Add(-time.Hour)
		}
	}
	s.registry.mu.Unlock()
	approveGrant(t, s, "device-"+tenant, tenant)

	target := &lifecycleHTTPTarget{
		s: s, h: s.Handler(), dir: dir, origin: "https://collector.example",
		ownerID: ownerID, tenant: tenant, key: tok.Plaintext, expiredKey: expired.Plaintext,
	}
	target.owner = putLifecycleSession(t, s, "sess-owner", ownerID)
	target.stranger = putLifecycleSession(t, s, "sess-stranger", 701)
	target.admin = putLifecycleSession(t, s, "sess-admin", 702, adminEmail)
	if err := s.registry.Persist(); err != nil {
		t.Fatal(err)
	}
	return target
}

// validLifecycleRequest builds a request that satisfies every gate. Tests mutate
// one part to exercise a refusal.
func (tg *lifecycleHTTPTarget) validLifecycleRequest(method, tenant, action string) *http.Request {
	path := "/v1/tenants/" + tenant
	if action == "reset" {
		path += "/reset"
	}
	body := `{"confirm_tenant_id":"` + tenant + `"}`
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Origin", tg.origin)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set(tenantLifecycleUIHeader, tenantLifecycleUIValue)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func (tg *lifecycleHTTPTarget) send(req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	tg.h.ServeHTTP(rec, req)
	return rec
}

func setLifecycleBody(req *http.Request, body string) {
	req.Body = io.NopCloser(strings.NewReader(body))
	req.ContentLength = int64(len(body))
}

func lifecycleStateDigest(t *testing.T, s *Server, dir, tenant string) string {
	t.Helper()
	h := sha256.New()
	tp := filepath.Join(dir, tenant)
	if _, err := os.Stat(tp); err == nil {
		io.WriteString(h, digestTree(t, tp))
	} else {
		io.WriteString(h, "absent")
	}
	if b, err := os.ReadFile(s.registry.RegistryPath()); err == nil {
		h.Write(b)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "review-reservations.json")); err == nil {
		h.Write(b)
	}
	fmt.Fprintf(h, "|grant=%v", s.grants.tenantResidue(tenant))
	rec, ok := s.registry.TenantLifecycle(tenant)
	fmt.Fprintf(h, "|lifecycle=%v:%+v", ok, rec)
	return hex.EncodeToString(h.Sum(nil))
}

func assertLifecycleError(t *testing.T, rec *httptest.ResponseRecorder, status int, code, message string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status=%d body=%s want=%d", rec.Code, rec.Body.String(), status)
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("error json: %s", rec.Body.String())
	}
	if body.Error != code {
		t.Fatalf("error=%q want=%q body=%s", body.Error, code, rec.Body.String())
	}
	if message != "" && body.Message != message {
		t.Fatalf("message=%q want=%q", body.Message, message)
	}
}

func TestLifecycleHTTPRefusalsAreNoOps(t *testing.T) {
	tg := newLifecycleHTTPTarget(t, Options{})
	owner := func(req *http.Request) { req.AddCookie(tg.owner[0]) }

	cases := []struct {
		name    string
		request func() *http.Request
		status  int
		code    string
		message string
	}{
		{
			name: "bearer key",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				req.Header.Set("Authorization", "Bearer "+tg.key)
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only", message: tenantLifecycleUIMessage,
		},
		{
			name: "bearer plus owner cookie and UI headers",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Authorization", "Bearer "+tg.key)
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only", message: tenantLifecycleUIMessage,
		},
		{
			name: "invalid key plus owner cookie",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Authorization", "Bearer wk_not-a-real-key")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "expired key plus owner cookie",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Authorization", "Bearer "+tg.expiredKey)
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "non-owner",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				req.AddCookie(tg.stranger[0])
				return req
			},
			status: 403, code: "tenant_owner_required",
		},
		{
			name: "admin non-owner",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				req.AddCookie(tg.admin[0])
				return req
			},
			status: 403, code: "tenant_owner_required",
		},
		{
			name: "selected tenant query does not authorize",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				req.URL.RawQuery = "tenant=" + tg.tenant
				req.AddCookie(tg.stranger[0])
				return req
			},
			status: 403, code: "tenant_owner_required",
		},
		{
			name: "display name is not an id",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, "owned", "")
				req.AddCookie(tg.owner[0])
				return req
			},
			status: 404, code: "tenant_not_found",
		},
		{
			name: "Pages origin",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Origin", pagesOrigin)
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "configured CORS origin",
			request: func() *http.Request {
				tg.s.cfg.CORSOrigins = []string{"https://allowed.example"}
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Origin", "https://allowed.example")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "same-site fetch",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Sec-Fetch-Site", "same-site")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "cross-site fetch",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Sec-Fetch-Site", "cross-site")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "absent Origin",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Del("Origin")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "null Origin",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Origin", "null")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "missing UI header",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Del(tenantLifecycleUIHeader)
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "wrong UI header",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set(tenantLifecycleUIHeader, "something-else")
				return req
			},
			status: 403, code: "tenant_lifecycle_ui_only",
		},
		{
			name: "missing session",
			request: func() *http.Request {
				return tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
			},
			status: 401, code: "session_required", message: "sign in at https://collector.example/login",
		},
		{
			name: "non-JSON content type",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				req.Header.Set("Content-Type", "text/plain")
				return req
			},
			status: 415, code: "json_required",
		},
		{
			name: "malformed confirmation",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				setLifecycleBody(req, "{")
				return req
			},
			status: 400, code: "tenant_confirmation_mismatch",
		},
		{
			name: "missing confirmation",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				setLifecycleBody(req, "{}")
				return req
			},
			status: 400, code: "tenant_confirmation_mismatch",
		},
		{
			name: "wrong-type confirmation",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				setLifecycleBody(req, `{"confirm_tenant_id":5}`)
				return req
			},
			status: 400, code: "tenant_confirmation_mismatch",
		},
		{
			name: "mismatched confirmation",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				owner(req)
				setLifecycleBody(req, `{"confirm_tenant_id":"somebody-else"}`)
				return req
			},
			status: 400, code: "tenant_confirmation_mismatch",
		},
		{
			name: "method not allowed on delete path",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodPost, tg.tenant, "")
				owner(req)
				return req
			},
			status: 405,
		},
		{
			name: "method not allowed on reset path",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodGet, tg.tenant, "reset")
				owner(req)
				return req
			},
			status: 405,
		},
		{
			name: "other subpath",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
				req.URL.Path = "/v1/tenants/" + tg.tenant + "/other"
				owner(req)
				return req
			},
			status: 404,
		},
		{
			name: "absent id",
			request: func() *http.Request {
				req := tg.validLifecycleRequest(http.MethodDelete, "t-absent", "")
				owner(req)
				return req
			},
			status: 404, code: "tenant_not_found",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant)
			rec := tg.send(tc.request())
			if got := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant); got != before {
				t.Fatal("refusal changed tenant, registry, grant, claim or spend state")
			}
			if tc.code == "" {
				if rec.Code != tc.status {
					t.Fatalf("status=%d body=%s want=%d", rec.Code, rec.Body.String(), tc.status)
				}
			} else {
				assertLifecycleError(t, rec, tc.status, tc.code, tc.message)
			}
			if tc.name == "method not allowed on delete path" && rec.Header().Get("Allow") != http.MethodDelete {
				t.Fatalf("Allow=%q want DELETE", rec.Header().Get("Allow"))
			}
			if tc.name == "method not allowed on reset path" && rec.Header().Get("Allow") != http.MethodPost {
				t.Fatalf("Allow=%q want POST", rec.Header().Get("Allow"))
			}
		})
	}

	if _, err := os.Stat(filepath.Join(tg.dir, "t-absent")); !os.IsNotExist(err) {
		t.Fatalf("absent id opened storage: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tg.dir, "owned")); !os.IsNotExist(err) {
		t.Fatalf("display name opened storage: %v", err)
	}
}

func TestLifecycleHTTPGuessedMCPToolsAreUnknown(t *testing.T) {
	tg := newLifecycleHTTPTarget(t, Options{})
	before := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant)
	for _, name := range []string{"reset_tenant", "delete_tenant"} {
		rec := mcpRequest(t, tg.h, tg.key, mcpCallBody(name, map[string]any{"confirm_tenant_id": tg.tenant}), nil)
		reply := mcpDecode(t, rec)
		errObj, ok := reply["error"].(map[string]any)
		if !ok || errObj["code"] != float64(-32602) || errObj["message"] != "unknown tool" {
			t.Fatalf("%s: %#v", name, reply)
		}
	}
	if got := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant); got != before {
		t.Fatal("guessed MCP lifecycle tool had effects")
	}
}

func TestLifecycleHTTPLocalModeRefused(t *testing.T) {
	s := New(Config{Data: t.TempDir()}, Options{DisableWorker: true})
	t.Cleanup(func() { _ = s.Close() })
	h := s.Handler()
	req := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1:8770/v1/tenants/local", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	assertLifecycleError(t, rec, 403, "tenant_lifecycle_ui_only", tenantLifecycleUIMessage)

	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8770/v1/tenants/local/reset", strings.NewReader(`{"confirm_tenant_id":"local"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	assertLifecycleError(t, rec, 403, "tenant_lifecycle_ui_only", tenantLifecycleUIMessage)
}

func TestLifecycleHTTPLegacyTenantRefused(t *testing.T) {
	dir := t.TempDir()
	doc := `{"version":1,"policy":{"mode":"everyone"},"sessions":{},"owners":{"t-legacy":"204"},"names":{"t-legacy":"old"},"token_hashes":[]}`
	if err := os.WriteFile(filepath.Join(dir, registryFileName), []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	s := New(lifecycleConfig(dir, "http://127.0.0.1:1"), Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })
	sess := putLifecycleSession(t, s, "sess-legacy", 204)
	if err := s.registry.Persist(); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	req := httptest.NewRequest(http.MethodDelete, "/v1/tenants/t-legacy", strings.NewReader(`{"confirm_tenant_id":"t-legacy"}`))
	req.Header.Set("Origin", "https://collector.example")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set(tenantLifecycleUIHeader, tenantLifecycleUIValue)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess[0])
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	assertLifecycleError(t, rec, 409, "legacy_tenant_cleanup_unsupported", "")
	if _, err := os.Stat(filepath.Join(dir, "t-legacy")); !os.IsNotExist(err) {
		t.Fatalf("legacy refusal opened storage: %v", err)
	}
}

func TestLifecycleHTTPResetAndDeleteSucceed(t *testing.T) {
	dir := t.TempDir()
	s := New(lifecycleConfig(dir, "http://127.0.0.1:1"), Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	owner := int64(800)
	a, ok, err := s.registry.CreateTenant("a", owner)
	if err != nil || !ok {
		t.Fatalf("create a: %v", err)
	}
	b, ok, err := s.registry.CreateTenant("b", owner)
	if err != nil || !ok {
		t.Fatalf("create b: %v", err)
	}
	sess := putLifecycleSession(t, s, "sess-owner", owner)
	tokA, err := s.registry.CreateToken(a, TokenScopeReadWrite, "a", time.Now().Add(time.Hour), owner, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.registry.CreateToken(b, TokenScopeRead, "b", time.Now().Add(time.Hour), owner, time.Now()); err != nil {
		t.Fatal(err)
	}
	seedTenantAssets(t, s, a)
	seedTenantAssets(t, s, b)
	seedTenantReservations(t, s, map[string]float64{a: 1.5, b: 2.5})
	approveGrant(t, s, "device-a", a)
	if err := s.registry.Persist(); err != nil {
		t.Fatal(err)
	}
	beforeA := lifecycleRecord(t, s, a)
	beforeTotal, _ := reservationSpent(t, s)
	bDigest := digestTree(t, filepath.Join(dir, b))

	reset := func(tenant string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/tenants/"+tenant+"/reset", strings.NewReader(`{"confirm_tenant_id":"`+tenant+`"}`))
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set(tenantLifecycleUIHeader, tenantLifecycleUIValue)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(sess[0])
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	del := func(tenant string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/v1/tenants/"+tenant, strings.NewReader(`{"confirm_tenant_id":"`+tenant+`"}`))
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set(tenantLifecycleUIHeader, tenantLifecycleUIValue)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(sess[0])
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := reset(a)
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("reset a: %d %s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatalf("reset changed cookies: %v", rec.Result().Cookies())
	}
	if _, ok := s.registry.GetSession("sess-owner", time.Now()); !ok {
		t.Fatal("reset cleared the user session")
	}
	afterA := lifecycleRecord(t, s, a)
	if afterA.State != lifecycleStateActive || afterA.Operation != "" || afterA.Generation == beforeA.Generation ||
		afterA.Marker != beforeA.Marker || s.registry.TenantName(a) != "a" || !s.registry.ownsTenant(owner, a) {
		t.Fatalf("reset identity/generation: before=%+v after=%+v", beforeA, afterA)
	}
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("reset left tenant directory: %v", err)
	}
	for _, rec := range s.registry.ListAllTokens() {
		if rec.Tenant == a {
			t.Fatalf("reset left token: %+v", rec)
		}
	}
	if s.grants.tenantResidue(a) {
		t.Fatal("reset left device grant")
	}
	if s.reviewReservations.TenantResidue(a) || !s.reviewReservations.TenantResidue(b) {
		t.Fatal("reset claim/spend attribution is wrong")
	}
	afterTotal, attributed := reservationSpent(t, s)
	if afterTotal != beforeTotal {
		t.Fatalf("provider-wide spend changed: %v -> %v", beforeTotal, afterTotal)
	}
	for _, tenant := range attributed {
		if tenant == a {
			t.Fatalf("reset left attributed spend: %v", attributed)
		}
	}
	if got := digestTree(t, filepath.Join(dir, b)); got != bDigest {
		t.Fatal("other tenant's bytes changed")
	}
	if code, _ := do(t, h, "GET", "/v1/whoami", tokA.Plaintext, ""); code != 401 {
		t.Fatalf("old token still authorizes after reset: %d", code)
	}

	// A repeated confirmed reset wipes the tenant's then-current assets again.
	seedTenantAssets(t, s, a)
	firstResetGeneration := afterA.Generation
	if rec := reset(a); rec.Code != http.StatusNoContent {
		t.Fatalf("second reset: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("second reset left assets: %v", err)
	}
	if again := lifecycleRecord(t, s, a); again.Generation == firstResetGeneration || again.State != lifecycleStateActive {
		t.Fatalf("second reset generation: %+v", again)
	}

	if rec := del(b); rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("delete b: %d %s", rec.Code, rec.Body.String())
	}
	if s.registry.tenantRegistered(b) {
		t.Fatal("deleted tenant still registered")
	}
	if _, ok := s.registry.TenantLifecycle(b); ok {
		t.Fatal("deleted tenant still has lifecycle record")
	}
	if _, err := os.Stat(filepath.Join(dir, b)); !os.IsNotExist(err) {
		t.Fatalf("delete left directory: %v", err)
	}
	for _, rec := range s.registry.ListAllTokens() {
		if rec.Tenant == b {
			t.Fatalf("delete left token: %+v", rec)
		}
	}
	if rec := del(b); rec.Code != http.StatusNotFound {
		t.Fatalf("repeat delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec := del(a); rec.Code != http.StatusNoContent {
		t.Fatalf("delete a: %d %s", rec.Code, rec.Body.String())
	}
	if rec := del(a); rec.Code != http.StatusNotFound {
		t.Fatalf("repeat delete a: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := s.registry.GetSession("sess-owner", time.Now()); !ok {
		t.Fatal("delete cleared the user session")
	}
}

func TestLifecycleHTTPFaultAndBusy(t *testing.T) {
	t.Run("timeout never returns 204", func(t *testing.T) {
		tg := newLifecycleHTTPTarget(t, Options{LifecycleFault: func(stage string) error {
			if stage == "after-begin" {
				return context.DeadlineExceeded
			}
			return nil
		}})
		req := tg.validLifecycleRequest(http.MethodPost, tg.tenant, "reset")
		req.AddCookie(tg.owner[0])
		rec := tg.send(req)
		assertLifecycleError(t, rec, 503, "tenant_cleanup_incomplete", "")
		if rec.Code == http.StatusNoContent {
			t.Fatal("timeout reported success")
		}
		if got := lifecycleRecord(t, tg.s, tg.tenant); got.State != lifecycleStateResetting || got.Operation != lifecycleOpReset {
			t.Fatalf("journal not retained for resume: %+v", got)
		}
	})

	t.Run("busy lifecycle", func(t *testing.T) {
		tg := newLifecycleHTTPTarget(t, Options{})
		if err := tg.s.registry.BeginTenantReset(tg.ownerID, tg.tenant); err != nil {
			t.Fatal(err)
		}
		req := tg.validLifecycleRequest(http.MethodDelete, tg.tenant, "")
		req.AddCookie(tg.owner[0])
		rec := tg.send(req)
		assertLifecycleError(t, rec, 409, "tenant_busy", "")
	})
}
