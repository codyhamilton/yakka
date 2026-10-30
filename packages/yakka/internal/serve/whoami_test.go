package serve

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

type whoamiResp struct {
	Tenant    string `json:"tenant"`
	Scope     string `json:"scope"`
	ExpiresAt int64  `json:"expires_at"`
}

func getWhoami(t *testing.T, code int, body string, wantCode int) whoamiResp {
	t.Helper()
	if code != wantCode {
		t.Fatalf("whoami: %d %s (want %d)", code, body, wantCode)
	}
	var r whoamiResp
	if wantCode == 200 {
		if err := json.Unmarshal([]byte(body), &r); err != nil {
			t.Fatal(err)
		}
	}
	return r
}

func TestWhoamiRemote(t *testing.T) {
	gh := mockGitHub(t, 21, "who", []mockEmail{{Email: "who@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "who")
	exp := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	_, rw := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, exp)
	_, ro := remoteIssueToken(t, h, origin, sess, tid, TokenScopeRead, exp)

	code, body := do(t, h, "GET", "/v1/whoami", rw, "")
	if r := getWhoami(t, code, body, 200); r.Tenant != tid || r.Scope != TokenScopeReadWrite || r.ExpiresAt != exp.Unix() {
		t.Fatalf("read_write whoami: %s", body)
	}
	code, body = do(t, h, "GET", "/v1/whoami", ro, "")
	if r := getWhoami(t, code, body, 200); r.Tenant != tid || r.Scope != TokenScopeRead {
		t.Fatalf("read whoami: %s", body)
	}

	code, body = do(t, h, "GET", "/v1/whoami", "", "")
	getWhoami(t, code, body, 401)
	code, body = do(t, h, "GET", "/v1/whoami", "wk_notreal", "")
	getWhoami(t, code, body, 401)

	// A browser session cookie is not a credential for whoami.
	code, body, _ = doWithCookies(t, h, "GET", "/v1/whoami", origin, "", sess)
	getWhoami(t, code, body, 401)

	// whoami never opens the tenant.
	s.mu.Lock()
	n := len(s.tenants)
	s.mu.Unlock()
	if n != 0 {
		t.Fatalf("whoami opened %d tenants", n)
	}
}

func TestWhoamiLocalAndKeyed(t *testing.T) {
	local := New(Config{Data: t.TempDir()}, Options{DisableWorker: true})
	t.Cleanup(func() { local.Close() })
	req := httptest.NewRequest("GET", "http://127.0.0.1:8770/v1/whoami", nil)
	rec := httptest.NewRecorder()
	local.Handler().ServeHTTP(rec, req)
	if r := getWhoami(t, rec.Code, rec.Body.String(), 200); r.Tenant != LocalTenant || r.Scope != TokenScopeReadWrite || r.ExpiresAt != 0 {
		t.Fatalf("local whoami: %s", rec.Body.String())
	}

	s, _ := newServer(t, true)
	h := s.Handler()
	code, body := do(t, h, "GET", "/v1/whoami", "ka", "")
	if r := getWhoami(t, code, body, 200); r.Tenant != "a" || r.Scope != TokenScopeReadWrite || r.ExpiresAt != 0 {
		t.Fatalf("keyed whoami: %s", body)
	}
	code, body = do(t, h, "GET", "/v1/whoami", "nope", "")
	getWhoami(t, code, body, 401)
	code, body = do(t, h, "GET", "/v1/whoami", "", "")
	getWhoami(t, code, body, 401)
}
