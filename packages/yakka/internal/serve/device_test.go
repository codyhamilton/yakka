package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

type deviceEnv struct {
	t      *testing.T
	s      *Server
	h      http.Handler
	origin string
	sess   []*http.Cookie
	dir    string
	clock  time.Time
}

func (e *deviceEnv) advance(d time.Duration) { e.clock = e.clock.Add(d) }

func newDeviceEnv(t *testing.T) *deviceEnv {
	gh := mockGitHub(t, 30, "devuser", []mockEmail{{Email: "dev@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := remoteTestConfig(t, dir, gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	// Register the tenant under a fixed ID so the request literals below stay readable.
	s.registry.mu.Lock()
	s.registry.owners["devt"], s.registry.names["devt"] = "30", "Dev tenant"
	s.registry.mu.Unlock()
	e := &deviceEnv{t: t, s: s, h: h, origin: origin, sess: sess, dir: dir, clock: time.Now()}
	s.grants.now = func() time.Time { return e.clock }
	return e
}

type codeResp struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

func (e *deviceEnv) requestCode() codeResp {
	e.t.Helper()
	code, body, _ := doWithCookies(e.t, e.h, "POST", "/v1/device/code", "", "", nil)
	if code != 200 {
		e.t.Fatalf("device code: %d %s", code, body)
	}
	var r codeResp
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		e.t.Fatal(err)
	}
	return r
}

func (e *deviceEnv) poll(deviceCode string) (int, string) {
	e.t.Helper()
	code, body, _ := doWithCookies(e.t, e.h, "POST", "/v1/device/token", "", `{"device_code":"`+deviceCode+`"}`, nil)
	return code, body
}

func (e *deviceEnv) authorize(body string) (int, string) {
	e.t.Helper()
	code, b, _ := doWithCookies(e.t, e.h, "POST", "/v1/device/authorize", e.origin, body, e.sess)
	return code, b
}

func (e *deviceEnv) approveBody(userCode string) string {
	return `{"user_code":"` + userCode + `","tenant":"devt","scope":"read_write","lifetime":"1d"}`
}

// requestCodeFrom asks for a device code, reporting host as the device's name.
func (e *deviceEnv) requestCodeFrom(host string) codeResp {
	e.t.Helper()
	payload, _ := json.Marshal(map[string]string{"host": host})
	code, body, _ := doWithCookies(e.t, e.h, "POST", "/v1/device/code", "", string(payload), nil)
	if code != 200 {
		e.t.Fatalf("device code: %d %s", code, body)
	}
	var r codeResp
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		e.t.Fatal(err)
	}
	return r
}

// redeem approves cr with body and polls once for the token response.
func (e *deviceEnv) redeem(cr codeResp, body string) map[string]any {
	e.t.Helper()
	if c, b := e.authorize(body); c != 200 {
		e.t.Fatalf("authorize: %d %s", c, b)
	}
	e.advance(6 * time.Second)
	c, b := e.poll(cr.DeviceCode)
	if c != 200 {
		e.t.Fatalf("token: %d %s", c, b)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(b), &m); err != nil {
		e.t.Fatal(err)
	}
	return m
}

func wantErr(t *testing.T, label string, code int, body string, wantCode int, wantErr string) {
	t.Helper()
	if code != wantCode || !strings.Contains(body, `"error":"`+wantErr+`"`) {
		t.Fatalf("%s: got %d %s, want %d %s", label, code, body, wantCode, wantErr)
	}
}

func TestDeviceGrantFlow(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	if len(cr.DeviceCode) != 43 {
		t.Fatalf("device_code length: %d", len(cr.DeviceCode))
	}
	if !regexp.MustCompile(`^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$`).MatchString(cr.UserCode) {
		t.Fatalf("user_code: %q", cr.UserCode)
	}
	if cr.VerificationURI != e.origin+"/device" || cr.VerificationURIComplete != e.origin+"/device?user_code="+cr.UserCode {
		t.Fatalf("verification uris: %+v", cr)
	}
	if cr.ExpiresIn != 600 || cr.Interval != 5 {
		t.Fatalf("expires_in/interval: %+v", cr)
	}
	c, b := e.poll(cr.DeviceCode)
	wantErr(t, "pending", c, b, 400, "authorization_pending")

	c, b = e.authorize(e.approveBody(cr.UserCode))
	if c != 200 || !strings.Contains(b, `"approved":true`) {
		t.Fatalf("authorize: %d %s", c, b)
	}
	e.advance(6 * time.Second)
	c, b = e.poll(cr.DeviceCode)
	if c != 200 {
		t.Fatalf("token: %d %s", c, b)
	}
	var tr struct {
		Token, Endpoint, Tenant, Scope string
		ExpiresAt                      string `json:"expires_at"`
	}
	if err := json.Unmarshal([]byte(b), &tr); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tr.Token, "wk_") || tr.Tenant != "devt" || tr.Scope != "read_write" || tr.Endpoint != e.origin {
		t.Fatalf("token body: %s", b)
	}
	if exp, err := time.Parse(time.RFC3339, tr.ExpiresAt); err != nil || !exp.Equal(e.clock.Add(-6*time.Second).Add(24*time.Hour).Truncate(time.Second)) && exp.Sub(e.clock) > 24*time.Hour {
		t.Fatalf("expires_at: %q", tr.ExpiresAt)
	}
	if c, b := do(t, e.h, "GET", "/v1/analytics/summary?tenant=devt", tr.Token, ""); c != 200 {
		t.Fatalf("summary with minted token: %d %s", c, b)
	}
	e.advance(6 * time.Second)
	c, b = e.poll(cr.DeviceCode)
	wantErr(t, "second redeem", c, b, 400, "expired_token")
}

func TestDeviceGrantSiteMapping(t *testing.T) {
	dir := t.TempDir()
	for origin, site := range map[string]string{
		"https://api.yakka.build": "https://yakka.build",
		"https://collector.other": "https://collector.other",
	} {
		s := New(Config{Addr: "0.0.0.0:8770", Data: dir, PublicURL: origin, GitHubOAuthClientID: "c", GitHubOAuthClientSecret: "s"}, Options{DisableWorker: true})
		t.Cleanup(func() { s.Close() })
		code, body, _ := doWithCookies(t, s.Handler(), "POST", "/v1/device/code", "", "{}", nil)
		if code != 200 {
			t.Fatalf("%s: %d %s", origin, code, body)
		}
		var r codeResp
		_ = json.Unmarshal([]byte(body), &r)
		if r.VerificationURI != site+"/device" || r.VerificationURIComplete != site+"/device?user_code="+r.UserCode {
			t.Fatalf("%s: %+v", origin, r)
		}
	}
}

func TestDeviceGrantUserCodeNormalisation(t *testing.T) {
	e := newDeviceEnv(t)
	for _, mod := range []func(string) string{
		strings.ToLower,
		func(s string) string { return strings.ReplaceAll(s, "-", "") },
		func(s string) string { return " " + strings.ReplaceAll(s, "-", " ") + " " },
	} {
		cr := e.requestCode()
		c, b := e.authorize(e.approveBody(mod(cr.UserCode)))
		if c != 200 {
			t.Fatalf("authorize %q: %d %s", mod(cr.UserCode), c, b)
		}
	}
}

func TestDeviceGrantDeny(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	c, b := e.authorize(`{"user_code":"` + cr.UserCode + `","action":"deny"}`)
	if c != 200 || !strings.Contains(b, `"denied":true`) {
		t.Fatalf("deny: %d %s", c, b)
	}
	c, b = e.authorize(e.approveBody(cr.UserCode))
	wantErr(t, "approve decided", c, b, 404, "unknown_code")
	c, b = e.poll(cr.DeviceCode)
	wantErr(t, "poll denied", c, b, 400, "access_denied")
	e.advance(6 * time.Second)
	c, b = e.poll(cr.DeviceCode)
	wantErr(t, "poll after drop", c, b, 400, "expired_token")
	c, b = e.authorize(`{"user_code":"` + cr.UserCode + `","action":"deny"}`)
	wantErr(t, "authorize dropped", c, b, 404, "unknown_code")
}

func TestDeviceGrantSlowDown(t *testing.T) {
	// Two grants, because each slow_down grows the interval: after one it is 10 s.
	e := newDeviceEnv(t)
	for _, tc := range []struct {
		gap  time.Duration
		want string
	}{{6 * time.Second, "slow_down"}, {11 * time.Second, "authorization_pending"}} {
		cr := e.requestCode()
		c, b := e.poll(cr.DeviceCode)
		wantErr(t, "first", c, b, 400, "authorization_pending")
		e.advance(2 * time.Second)
		c, b = e.poll(cr.DeviceCode)
		wantErr(t, "too soon", c, b, 400, "slow_down")
		e.advance(tc.gap)
		c, b = e.poll(cr.DeviceCode)
		wantErr(t, tc.gap.String(), c, b, 400, tc.want)
	}
}

func TestDeviceGrantExpiry(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	e.advance(601 * time.Second)
	c, b := e.poll(cr.DeviceCode)
	wantErr(t, "poll expired", c, b, 400, "expired_token")
	c, b = e.authorize(e.approveBody(cr.UserCode))
	wantErr(t, "authorize expired", c, b, 404, "unknown_code")
}

func TestDeviceGrantExpiryPassesBeforePoll(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	c, b := e.authorize(e.approveBody(cr.UserCode))
	if c != 200 {
		t.Fatalf("authorize: %d %s", c, b)
	}
	// A lifetime is at least a day, so shorten the approved grant's token expiry directly.
	e.s.grants.mu.Lock()
	for _, gr := range e.s.grants.byHash {
		gr.expiresAt = e.clock.Add(time.Minute)
	}
	e.s.grants.mu.Unlock()
	e.advance(2 * time.Minute)
	c, b = e.poll(cr.DeviceCode)
	wantErr(t, "poll after expiry", c, b, 400, "access_denied")
	e.advance(6 * time.Second)
	c, b = e.poll(cr.DeviceCode)
	wantErr(t, "dropped", c, b, 400, "expired_token")
}

func TestDeviceAuthorizeGuards(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	good := e.approveBody(cr.UserCode)

	req := httptest.NewRequest("POST", "/v1/device/authorize", strings.NewReader(good))
	req.Header.Set("Authorization", "Bearer wk_x")
	req.Header.Set("Origin", e.origin)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("bearer: %d", rec.Code)
	}
	if c, _, _ := doWithCookies(t, e.h, "POST", "/v1/device/authorize", "https://evil.example", good, e.sess); c != 403 {
		t.Fatalf("foreign origin: %d", c)
	}
	req = httptest.NewRequest("POST", "/v1/device/authorize", strings.NewReader(good))
	req.Header.Set("Origin", e.origin)
	req.Header.Set("Content-Type", "text/plain")
	for _, ck := range e.sess {
		req.AddCookie(ck)
	}
	rec = httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("content type: %d", rec.Code)
	}

	pre := `{"user_code":"` + cr.UserCode + `",`
	cases := []struct {
		name string
		body string
		want int
	}{
		{"foreign tenant", pre + `"tenant":"other","scope":"read","lifetime":"1d"}`, 403},
		{"bad scope", pre + `"tenant":"devt","scope":"admin","lifetime":"1d"}`, 400},
		{"unknown lifetime", pre + `"tenant":"devt","scope":"read","lifetime":"2y"}`, 400},
		{"expires_at", pre + `"tenant":"devt","scope":"read","expires_at":"2099-01-01T00:00:00Z"}`, 400},
		{"expires_at with lifetime", pre + `"tenant":"devt","scope":"read","lifetime":"1d","expires_at":"2099-01-01T00:00:00Z"}`, 400},
		{"long name", pre + `"tenant":"devt","scope":"read","lifetime":"1d","name":"` + strings.Repeat("n", 65) + `"}`, 400},
		{"control name", pre + `"tenant":"devt","scope":"read","lifetime":"1d","name":"a\u0007b"}`, 400},
		{"redirect_uri", pre + `"redirect_uri":"http://127.0.0.1:1/cb","tenant":"devt","scope":"read","lifetime":"1d"}`, 400},
		{"state", pre + `"state":"s","tenant":"devt","scope":"read","lifetime":"1d"}`, 400},
		{"unknown code", `{"user_code":"BBBB-BBBB","tenant":"devt","scope":"read","lifetime":"1d"}`, 404},
	}
	for _, tc := range cases {
		if c, b := e.authorize(tc.body); c != tc.want {
			t.Fatalf("%s: %d %s, want %d", tc.name, c, b, tc.want)
		}
	}
	if c, b := e.authorize(good); c != 200 {
		t.Fatalf("approve after failed validation: %d %s", c, b)
	}
}

func TestDeviceExchangeRemoved(t *testing.T) {
	e := newDeviceEnv(t)
	c, b, _ := doWithCookies(t, e.h, "POST", "/v1/device/exchange", "", `{"code":"x","state":"y","redirect_uri":"http://127.0.0.1:1/cb"}`, nil)
	if c != 404 {
		t.Fatalf("exchange: %d %s", c, b)
	}
}

func TestDeviceRoutesLocalOnlyAbsent(t *testing.T) {
	s, _ := newServer(t, true)
	for _, p := range []string{"/v1/device/code", "/v1/device/authorize", "/v1/device/token"} {
		if c, b := do(t, s.Handler(), "POST", p, "", "{}"); c != 404 {
			t.Fatalf("%s: %d %s", p, c, b)
		}
	}
}

func TestDeviceNoPlaintextAtRest(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	if c, b := e.authorize(e.approveBody(cr.UserCode)); c != 200 {
		t.Fatalf("authorize: %d %s", c, b)
	}
	c, b := e.poll(cr.DeviceCode)
	if c != 200 {
		t.Fatalf("token: %d %s", c, b)
	}
	var tr struct{ Token string }
	_ = json.Unmarshal([]byte(b), &tr)
	raw, err := os.ReadFile(filepath.Join(e.dir, registryFileName))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "device_codes") || strings.Contains(string(raw), tr.Token) || strings.Contains(string(raw), cr.DeviceCode) {
		t.Fatalf("registry.json holds device or token plaintext:\n%s", raw)
	}
}

func TestRegistryLegacyDeviceCodes(t *testing.T) {
	dir := t.TempDir()
	plain := "wk_legacyplain"
	now := time.Now()
	doc := map[string]any{
		"version": 1,
		"policy":  map[string]any{"mode": "everyone"},
		"owners":  map[string]string{"devt": "30"},
		"token_hashes": []TokenHashRecord{{ID: "tok1", Tenant: "devt", Scope: "read", Hash: hashTokenPlaintext(plain), GitHubID: 30,
			ExpiresAt: now.Add(time.Hour), CreatedAt: now}},
		"device_codes": []map[string]any{{"code_hash": "00", "token_id": "tok1", "token_plaintext": plain,
			"redirect_uri": "http://127.0.0.1:1/cb", "state": "s", "expires_at": now.Add(time.Hour)}},
	}
	b, _ := json.Marshal(doc)
	if err := os.WriteFile(filepath.Join(dir, registryFileName), b, 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := OpenRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, ok := r.resolveBearer(plain, now); ok {
		t.Fatal("token referenced by a legacy device code still resolves")
	}
	if err := r.Persist(); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, registryFileName))
	if strings.Contains(string(raw), "device_codes") || strings.Contains(string(raw), plain) {
		t.Fatalf("legacy field survived persist:\n%s", raw)
	}
}

func TestValidateGrant(t *testing.T) {
	r, err := OpenRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, ok, err := r.CreateTenant("acme", 7)
	if err != nil || !ok {
		t.Fatal("claim", err)
	}
	now := time.Now()
	future := now.Add(time.Hour)
	cases := []struct {
		tenant, scope string
		exp           time.Time
		gh            int64
	}{
		{id, "read", future, 7},
		{id, "bogus", future, 7},
		{id, "read", now, 7},
		{id, "read", future, 8},
		{"nope", "read_write", future, 7},
	}
	for _, c := range cases {
		verr := r.ValidateGrant(c.tenant, c.scope, c.exp, c.gh, now)
		_, cerr := r.CreateToken(c.tenant, c.scope, "laptop", c.exp, c.gh, now)
		if (verr == nil) != (cerr == nil) || (verr != nil && verr.Error() != cerr.Error()) {
			t.Fatalf("%+v: ValidateGrant=%v CreateToken=%v", c, verr, cerr)
		}
	}
	if err := r.ValidateGrant(id, "bogus", future, 7, now); err == nil || err.Error() != "invalid scope" {
		t.Fatalf("scope: %v", err)
	}
}

func TestTokenExpiry(t *testing.T) {
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	for name, days := range map[string]int{"": 90, "1d": 1, "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365} {
		got, ok := tokenExpiry(name, now)
		if !ok || !got.Equal(now.AddDate(0, 0, days)) {
			t.Fatalf("%q: %v %v", name, got, ok)
		}
	}
	for _, bad := range []string{"2y", "1D", "90d", "3 m", "0"} {
		if _, ok := tokenExpiry(bad, now); ok {
			t.Fatalf("%q accepted", bad)
		}
	}
}

func TestDeviceLifetimeDefaultsToThreeMonths(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCode()
	m := e.redeem(cr, `{"user_code":"`+cr.UserCode+`","tenant":"devt","scope":"read"}`)
	exp, err := time.Parse(time.RFC3339, m["expires_at"].(string))
	if err != nil {
		t.Fatal(err)
	}
	want := e.clock.Add(-6 * time.Second).Add(90 * 24 * time.Hour)
	if d := exp.Sub(want); d < -time.Minute || d > time.Minute {
		t.Fatalf("default expiry %v, want about %v", exp, want)
	}
}

func TestDeviceTokenNameDefaultsToHost(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCodeFrom("  build-box\x07 ")
	if m := e.redeem(cr, e.approveBody(cr.UserCode)); m["name"] != "build-box" {
		t.Fatalf("name from host: %v", m["name"])
	}
	// No host and no name falls back to "token".
	cr = e.requestCode()
	if m := e.redeem(cr, e.approveBody(cr.UserCode)); m["name"] != defaultTokenName {
		t.Fatalf("fallback name: %v", m["name"])
	}
	// A name chosen on the page wins over the host.
	cr = e.requestCodeFrom("build-box")
	body := `{"user_code":"` + cr.UserCode + `","tenant":"devt","scope":"read","lifetime":"1w","name":" ci runner "}`
	m := e.redeem(cr, body)
	if m["name"] != "ci runner" {
		t.Fatalf("chosen name: %v", m["name"])
	}
	// The name is stored with the token and listed.
	code, list, _ := doWithCookies(t, e.h, "GET", "/v1/tokens", e.origin, "", e.sess)
	if code != 200 || !strings.Contains(list, `"name":"ci runner"`) || !strings.Contains(list, `"name":"build-box"`) {
		t.Fatalf("list: %d %s", code, list)
	}
}

func TestDeviceHostIsCapped(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCodeFrom(strings.Repeat("h", 200))
	m := e.redeem(cr, e.approveBody(cr.UserCode))
	if n, _ := m["name"].(string); len(n) != 64 {
		t.Fatalf("name length %d", len(n))
	}
}

func TestDeviceGrantLookup(t *testing.T) {
	e := newDeviceEnv(t)
	cr := e.requestCodeFrom("laptop")
	get := func(code string) (int, string) {
		c, b, _ := doWithCookies(t, e.h, "GET", "/v1/device/grant?user_code="+code, "", "", e.sess)
		return c, b
	}
	if c, b := get(cr.UserCode); c != 200 || !strings.Contains(b, `"host":"laptop"`) {
		t.Fatalf("lookup: %d %s", c, b)
	}
	if c, b := get(strings.ToLower(strings.ReplaceAll(cr.UserCode, "-", ""))); c != 200 || !strings.Contains(b, `"host":"laptop"`) {
		t.Fatalf("normalised lookup: %d %s", c, b)
	}
	if c, _ := get("BBBB-BBBB"); c != 404 {
		t.Fatalf("unknown: %d", c)
	}
	if c, _ := get(""); c != 400 {
		t.Fatalf("empty: %d", c)
	}
	// The lookup needs a session.
	if c, _, _ := doWithCookies(t, e.h, "GET", "/v1/device/grant?user_code="+cr.UserCode, "", "", nil); c != 401 {
		t.Fatalf("no session: %d", c)
	}
	// The lookup is read-only: the grant can still be approved.
	if c, b := e.authorize(e.approveBody(cr.UserCode)); c != 200 {
		t.Fatalf("approve after lookup: %d %s", c, b)
	}
}

func TestCreateTokenLifetimeAndName(t *testing.T) {
	gh := mockGitHub(t, 31, "tokuser", []mockEmail{{Email: "tk@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "tk")
	post := func(body string) (int, string) {
		c, b, _ := doWithCookies(t, h, "POST", "/v1/tokens", origin, body, sess)
		return c, b
	}
	pre := `{"tenant":"` + tid + `","scope":"read"`
	if c, b := post(pre + `}`); c != 201 || !strings.Contains(b, `"name":"token"`) {
		t.Fatalf("defaults: %d %s", c, b)
	}
	if c, b := post(pre + `,"lifetime":"1y","name":"laptop"}`); c != 201 || !strings.Contains(b, `"name":"laptop"`) {
		t.Fatalf("named: %d %s", c, b)
	}
	for _, body := range []string{
		pre + `,"expires_at":"2099-01-01T00:00:00Z"}`,
		pre + `,"lifetime":"forever"}`,
		pre + `,"name":"` + strings.Repeat("n", 65) + `"}`,
	} {
		if c, b := post(body); c != 400 {
			t.Fatalf("%s: %d %s", body, c, b)
		}
	}
}
