package serve

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

type meTenants struct {
	Tenants []TenantInfo `json:"tenants"`
}

func getTenants(t *testing.T, s *Server, origin string, sess []*http.Cookie) []TenantInfo {
	t.Helper()
	code, body, _ := doWithCookies(t, s.Handler(), "GET", "/v1/me", origin, "", sess)
	var me meTenants
	if code != 200 || json.Unmarshal([]byte(body), &me) != nil {
		t.Fatalf("me: %d %s", code, body)
	}
	return me.Tenants
}

func TestFirstLoginCreatesDefaultTenant(t *testing.T) {
	gh := mockGitHub(t, 40, "newbie", []mockEmail{{Email: "n@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := remoteTestConfig(t, dir, gh.URL)
	origin := "https://collector.example"
	sess := loginRemote(t, s.Handler(), origin)

	got := getTenants(t, s, origin, sess)
	if len(got) != 1 || got[0].Name != DefaultTenantName || !tenantRE.MatchString(got[0].ID) || got[0].ID == DefaultTenantName {
		t.Fatalf("want one generated-ID tenant named default, got %+v", got)
	}

	// A second sign-in must not add another one, and the default survives a restart.
	sess = loginRemote(t, s.Handler(), origin)
	s.Close()
	s2 := remoteTestConfig(t, dir, gh.URL)
	sess = loginRemote(t, s2.Handler(), origin)
	again := getTenants(t, s2, origin, sess)
	if len(again) != 1 || again[0] != got[0] {
		t.Fatalf("after re-login: %+v, was %+v", again, got)
	}
}

func TestBackfillDefaultTenantForExistingUser(t *testing.T) {
	r, err := OpenRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// A user who already owns a tenant keeps exactly that tenant.
	id, ok, err := r.CreateTenant("work", 5)
	if err != nil || !ok {
		t.Fatal(err)
	}
	if created, err := r.EnsureDefaultTenant(5); err != nil || created {
		t.Fatalf("existing owner got a default: created=%v err=%v", created, err)
	}
	if got := r.tenantsOwnedBy(5); len(got) != 1 || got[0].ID != id {
		t.Fatalf("%+v", got)
	}
	if created, err := r.EnsureDefaultTenant(6); err != nil || !created {
		t.Fatalf("new owner: created=%v err=%v", created, err)
	}
}

func TestTenantNamesUniquePerOwnerOnly(t *testing.T) {
	r, err := OpenRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a, ok, _ := r.CreateTenant("team", 1)
	if !ok {
		t.Fatal("first create")
	}
	if _, ok, _ := r.CreateTenant("team", 1); ok {
		t.Fatal("same owner, same name must be refused")
	}
	b, ok, _ := r.CreateTenant("team", 2)
	if !ok || a == b {
		t.Fatalf("another owner may reuse the name with a distinct ID: ok=%v %q %q", ok, a, b)
	}
	if r.TenantName(a) != "team" || r.TenantName("legacy-id") != "legacy-id" {
		t.Fatal("TenantName fallback to ID")
	}
	if r.ownsTenant(2, a) || !r.ownsTenant(2, b) {
		t.Fatal("ownership follows the ID, not the name")
	}
}

func TestTokenListCarriesTenantName(t *testing.T) {
	gh := mockGitHub(t, 41, "namer", []mockEmail{{Email: "nm@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "Pretty Name")
	remoteIssueToken(t, h, origin, sess, tid, TokenScopeRead, "1d")
	code, body, _ := doWithCookies(t, h, "GET", "/v1/tokens", origin, "", sess)
	if code != 200 || !strings.Contains(body, `"tenant":"`+tid+`"`) || !strings.Contains(body, `"tenant_name":"Pretty Name"`) {
		t.Fatalf("%d %s", code, body)
	}
	if code, _, _ := doWithCookies(t, h, "POST", "/v1/tenants", origin, `{"name":"  "}`, sess); code != 400 {
		t.Fatalf("blank name: %d", code)
	}
}
