package serve

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func do(t *testing.T, h http.Handler, method, url, key, body string) (int, string) {
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func newServer(t *testing.T, disable bool) (*Server, string) {
	dir := t.TempDir()
	s := New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}, {"b", "kb"}}}, Options{DisableWorker: disable, PollInterval: 50 * time.Millisecond})
	t.Cleanup(func() { s.Close() })
	return s, dir
}

func artBody(content string) string {
	b, _ := json.Marshal(map[string]any{"facts": []any{map[string]any{"id": "q#0", "type": "artifact_version", "conversation_id": "c", "harness": "h",
		"event": "w", "ts": 1, "repo_id": "r", "path": "docs/plans/01-x/DESIGN.md", "content": content, "content_hash": keys.ContentHash([]byte(content)), "source": "worktree"}}})
	return string(b)
}

func TestPending(t *testing.T) {
	s, dir := newServer(t, true)
	h := s.Handler()
	content := "# hello\n"
	hash := keys.ContentHash([]byte(content))
	if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBody(content)); code != 200 || !strings.Contains(body, `"accepted"`) {
		t.Fatal(code, body)
	}
	got, err := os.ReadFile(filepath.Join(dir, "a", "pending", hash))
	if err != nil || string(got) != content {
		t.Fatalf("pending: %v %q", err, got)
	}
	if _, err := os.Stat(filepath.Join(dir, "a", "blobs", hash[:2], hash)); err == nil {
		t.Fatal("blob present while worker disabled")
	}
	if _, body := do(t, h, "GET", "/v1/health", "", ""); !strings.Contains(body, `"pending":1`) {
		t.Fatal(body)
	}
	s.StartWorker()
	deadline := time.Now().Add(5 * time.Second)
	for {
		code, body := do(t, h, "GET", "/v1/artifacts?repo_id=r&path=docs/plans/01-x/DESIGN.md", "ka", "")
		if code == 200 && strings.Contains(body, `"verdict":"unscreened"`) {
			if !strings.Contains(body, `"kind":"design"`) || !strings.Contains(body, `"scores":[]`) {
				t.Fatal(body)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("never promoted", code, body)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, err := os.Stat(filepath.Join(dir, "a", "blobs", hash[:2], hash)); err != nil {
		t.Fatal(err)
	}
	if ents, _ := os.ReadDir(filepath.Join(dir, "a", "pending")); len(ents) != 0 {
		t.Fatal("pending not empty")
	}
	if code, _ := do(t, h, "GET", "/v1/artifacts?repo_id=r&path=docs/plans/01-x/DESIGN.md", "kb", ""); code != 404 {
		t.Fatal("tenant b saw a's artifact:", code)
	}
}

func TestPendingLeftoverOnOpen(t *testing.T) {
	dir := t.TempDir()
	s := New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	do(t, s.Handler(), "POST", "/v1/ingest", "ka", artBody("left\n"))
	s.Close()
	s = New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}}}, Options{PollInterval: time.Hour})
	defer s.Close()
	do(t, s.Handler(), "GET", "/v1/health", "", "") // no tenant open yet
	do(t, s.Handler(), "GET", "/v1/artifacts?repo_id=r&path=p", "ka", "")
	h := keys.ContentHash([]byte("left\n"))
	for i := 0; i < 200; i++ {
		if _, err := os.Stat(filepath.Join(dir, "a", "blobs", h[:2], h)); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("leftover pending not processed on open")
}

func TestHTTPErrors(t *testing.T) {
	s, _ := newServer(t, true)
	h := s.Handler()
	cases := []struct {
		m, u, k, b string
		want       int
	}{
		{"POST", "/v1/ingest", "", `{"facts":[]}`, 401},
		{"POST", "/v1/ingest", "wrong", `{"facts":[]}`, 401},
		{"POST", "/v1/ingest", "ka", `nope`, 400},
		{"POST", "/v1/ingest", "ka", `{"x":1}`, 400},
		{"POST", "/v1/ingest", "ka", `{"facts":[]}`, 200},
		{"GET", "/v1/ingest", "ka", ``, 405},
		{"POST", "/v1/artifacts", "ka", ``, 405},
		{"GET", "/v1/artifacts?repo_id=r", "ka", ``, 400},
		{"GET", "/v1/artifacts?repo_id=r&path=p", "ka", ``, 404},
		{"POST", "/v1/ingest", "ka", `{"facts":["` + strings.Repeat("x", 17<<20) + `"]}`, 413},
	}
	for _, c := range cases {
		if code, body := do(t, h, c.m, c.u, c.k, c.b); code != c.want {
			t.Errorf("%s %s: %d want %d (%.80s)", c.m, c.u, code, c.want, body)
		}
	}
	if _, body := do(t, h, "POST", "/v1/ingest", "ka", `{"facts":[]}`); !bytes.Contains([]byte(body), []byte(`"results":[]`)) {
		t.Fatal(body)
	}
}

func TestParseKeys(t *testing.T) {
	if kp, err := ParseKeys(" "); kp != nil || err != nil {
		t.Fatal("empty keys must be local mode", kp, err)
	}
	for _, bad := range []string{"a", "a=", "=k", "a=k,b=k", "a=k,a=j", "-x=k", "a b=k"} {
		if _, err := ParseKeys(bad); err == nil {
			t.Errorf("%q accepted", bad)
		} else if strings.Contains(err.Error(), "=k") && bad != "" && strings.Contains(err.Error(), "k,") {
			t.Errorf("error leaks key: %v", err)
		}
	}
	if kp, err := ParseKeys("a=ka,b.c-d=kb"); err != nil || len(kp) != 2 {
		t.Fatal(kp, err)
	}
}

func TestLocalModeConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	oauth := map[string]string{
		"GITHUB_OAUTH_CLIENT_ID": "id", "GITHUB_OAUTH_CLIENT_SECRET": "sec", "YAKKA_PUBLIC_URL": "https://collector.example",
	}
	for _, addr := range []string{"", "127.0.0.1:0", "localhost:8770", "[::1]:8770", "127.0.0.2:1"} {
		m := map[string]string{"YAKKA_SERVE_ADDR": addr, "YAKKA_SERVE_DATA": "/d"}
		for k, v := range oauth {
			m[k] = v
		}
		c, err := ConfigFromEnv(env(m))
		if err != nil || !c.Local() || c.Remote() {
			t.Errorf("%q: local=%v remote=%v err=%v", addr, c.Local(), c.Remote(), err)
		}
	}
	for _, addr := range []string{"0.0.0.0:8770", ":8770", "[::]:8770", "192.168.1.5:8770", "example.com:80"} {
		if _, err := ConfigFromEnv(env(map[string]string{"YAKKA_SERVE_ADDR": addr, "YAKKA_SERVE_DATA": "/d"})); err == nil {
			t.Errorf("%q: non-loopback bind without OAuth accepted", addr)
		}
	}
	if _, err := ConfigFromEnv(env(map[string]string{
		"YAKKA_SERVE_ADDR": "0.0.0.0:8770", "YAKKA_SERVE_DATA": "/d",
		"GITHUB_OAUTH_CLIENT_ID": "id", "GITHUB_OAUTH_CLIENT_SECRET": "sec", "YAKKA_PUBLIC_URL": "https://collector.example",
	})); err != nil {
		t.Fatal("remote bind with OAuth:", err)
	}
	if _, err := ConfigFromEnv(env(map[string]string{"YAKKA_SERVE_ADDR": "127.0.0.1:0", "YAKKA_SERVE_DATA": "/d", "YAKKA_SERVE_KEYS": "a=ka"})); err == nil || !strings.Contains(err.Error(), "YAKKA_SERVE_KEYS") {
		t.Fatal("YAKKA_SERVE_KEYS must refuse:", err)
	}
}

func TestRemoteConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	c, err := ConfigFromEnv(env(map[string]string{
		"YAKKA_SERVE_ADDR": "0.0.0.0:8770", "YAKKA_SERVE_DATA": "/d",
		"GITHUB_OAUTH_CLIENT_ID": "cid", "GITHUB_OAUTH_CLIENT_SECRET": "csec", "YAKKA_PUBLIC_URL": "https://wf.example",
	}))
	if err != nil || !c.Remote() || c.Local() {
		t.Fatalf("remote: local=%v remote=%v err=%v", c.Local(), c.Remote(), err)
	}
	if c.PublicURL != "https://wf.example" || c.GitHubOAuthClientID != "cid" {
		t.Fatal(c)
	}
}

func TestRegistry(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		Addr:                    "0.0.0.0:8770",
		Data:                    dir,
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "id",
		GitHubOAuthClientSecret: "sec",
	}
	if !cfg.Remote() {
		t.Fatal("expected remote config")
	}
	s := New(cfg, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	path := filepath.Join(dir, registryFileName)
	if _, err := os.Stat(path); err != nil {
		t.Fatal("registry file:", err)
	}
	if p := s.registry.Policy(); p.Mode != PolicyEveryone {
		t.Fatal(p)
	}
	exp := time.Now().Add(24 * time.Hour).UTC()
	s.registry.PutSession("sess1", SessionRecord{GitHubID: 1, GitHubLogin: "u", VerifiedEmails: []string{"u@example.com"}, ExpiresAt: exp})
	if rec, ok := s.registry.GetSession("sess1", time.Now()); !ok || rec.GitHubLogin != "u" {
		t.Fatal(rec, ok)
	}
	if err := s.registry.SetPolicy(DomainPolicy{Mode: PolicyAllowList, Domains: []string{"example.com"}}); err != nil {
		t.Fatal(err)
	}
	s.Close()
	b, _ := os.ReadFile(path)
	if !strings.Contains(string(b), "allow_list") {
		t.Fatal(string(b))
	}
}

func TestLocalModeHTTP(t *testing.T) {
	dir := t.TempDir()
	s := New(Config{Data: dir}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	req := func(method, host, ctype, auth, body string) int {
		r := httptest.NewRequest(method, "http://"+host+"/v1/ingest", strings.NewReader(body))
		if ctype != "" {
			r.Header.Set("Content-Type", ctype)
		}
		if auth != "" {
			r.Header.Set("Authorization", auth)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	cases := []struct {
		host, ctype, auth string
		want              int
	}{
		{"127.0.0.1:8770", "application/json", "", 200},
		{"localhost:8770", "application/json; charset=utf-8", "", 200},
		{"[::1]:8770", "application/json", "Bearer anything", 200},
		{"127.0.0.1:8770", "text/plain", "", 415},
		{"127.0.0.1:8770", "", "", 415},
		{"evil.example:8770", "application/json", "", 403},
	}
	for _, c := range cases {
		if got := req("POST", c.host, c.ctype, c.auth, artBody("# local\n")); got != c.want {
			t.Errorf("%+v: got %d", c, got)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, LocalTenant, "pending")); err != nil {
		t.Fatal("local tenant not used:", err)
	}
}

func TestKeyRequiredMessage(t *testing.T) {
	s, _ := newServer(t, true)
	if code, body := do(t, s.Handler(), "POST", "/v1/ingest", "", `{"facts":[]}`); code != 401 || !strings.Contains(body, "requires a key") {
		t.Fatal(code, body)
	}
	if code, body := do(t, s.Handler(), "POST", "/v1/ingest", "wrong", `{"facts":[]}`); code != 401 || strings.Contains(body, "requires a key") {
		t.Fatal(code, body)
	}
}

// Close must not wait out a scorer call in flight: the worker's context is cancelled.
func TestCloseCancelsInFlightScreen(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{}, 1)
	step := func(ctx context.Context, _ *store.Tenant, _ string) error {
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(30 * time.Second):
			return nil
		}
	}
	s := New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}}}, Options{PollInterval: 20 * time.Millisecond, ScreenStep: step})
	content := "# d\n"
	body := `{"facts":[{"id":"q#0","type":"artifact_version","conversation_id":"c","harness":"h","event":"w","ts":1,"repo_id":"r","path":"docs/plans/01-x/DESIGN.md","content":"# d\n","content_hash":"` + keys.ContentHash([]byte(content)) + `","source":"worktree"}]}`
	if code, b := do(t, s.Handler(), "POST", "/v1/ingest", "ka", body); code != 200 {
		t.Fatal(code, b)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("screen step never ran")
	}
	t0 := time.Now()
	s.Close()
	if d := time.Since(t0); d > 5*time.Second {
		t.Fatalf("Close took %v with a screen in flight", d)
	}
}

// A screen error that is not "unreachable" repeats for the same input. It must be retried a
// bounded number of times, then end in a rejection the artifact read shows.
func TestPermanentScreenErrorIsBounded(t *testing.T) {
	dir := t.TempDir()
	var calls atomic.Int64
	step := func(ctx context.Context, _ *store.Tenant, _ string) error {
		calls.Add(1)
		return errors.New("scorer: HTTP 400")
	}
	s := New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}}}, Options{PollInterval: 10 * time.Millisecond, ScreenBackoff: 5 * time.Millisecond, ScreenStep: step})
	t.Cleanup(func() { s.Close() })
	if code, b := do(t, s.Handler(), "POST", "/v1/ingest", "ka", artBody("# d\n")); code != 200 {
		t.Fatal(code, b)
	}
	time.Sleep(time.Second)
	if n := calls.Load(); n > maxScreenAttempts+2 {
		t.Fatalf("screen step called %d times in 1s, want at most %d", n, maxScreenAttempts+2)
	}
	_, body := do(t, s.Handler(), "GET", "/v1/artifacts?repo_id=r&path=docs/plans/01-x/DESIGN.md", "ka", "")
	if !strings.Contains(body, `"stage":"screen"`) || !strings.Contains(body, "screen error") {
		t.Fatalf("no screen rejection in read: %s", body)
	}
	if ents, _ := os.ReadDir(filepath.Join(dir, "a", "pending")); len(ents) != 0 {
		t.Fatal("pending not cleared")
	}
}

func corsReq(h http.Handler, method, path, origin, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:8770"+path, nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if key != "" {
		r.Header.Set("Authorization", "Bearer "+key)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func assertCORS(t *testing.T, w *httptest.ResponseRecorder, origin string) {
	t.Helper()
	hd := w.Header()
	if hd.Get("Access-Control-Allow-Origin") != origin ||
		hd.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" ||
		hd.Get("Access-Control-Allow-Methods") != "GET, OPTIONS" ||
		!strings.Contains(strings.Join(hd.Values("Vary"), ","), "Origin") {
		t.Errorf("origin %q: headers %v", origin, hd)
	}
	if hd.Get("Access-Control-Allow-Credentials") != "" {
		t.Error("credentials header set")
	}
}

func assertNoCORS(t *testing.T, w *httptest.ResponseRecorder, what string) {
	t.Helper()
	for k := range w.Header() {
		if strings.HasPrefix(k, "Access-Control-") {
			t.Errorf("%s: unexpected %s", what, k)
		}
	}
}

func TestCORSLocalMode(t *testing.T) {
	s := New(Config{Data: t.TempDir()}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	for _, o := range []string{"http://127.0.0.1:5173", "http://localhost:4000", "http://[::1]:9000"} {
		w := corsReq(h, "GET", "/v1/health", o, "")
		if w.Code != 200 {
			t.Fatal(o, w.Code)
		}
		assertCORS(t, w, o)
		w = corsReq(h, "OPTIONS", "/v1/artifacts", o, "")
		if w.Code != 204 || w.Body.Len() != 0 {
			t.Fatal(o, w.Code, w.Body.String())
		}
		assertCORS(t, w, o)
	}
	for _, o := range []string{"https://evil.example", "null", "", "http://localhost.evil.example", "ftp://127.0.0.1"} {
		assertNoCORS(t, corsReq(h, "GET", "/v1/health", o, ""), "GET "+o)
	}
	// A disallowed OPTIONS keeps today's answer.
	w := corsReq(h, "OPTIONS", "/v1/artifacts", "https://evil.example", "")
	if w.Code != 405 {
		t.Error(w.Code)
	}
	assertNoCORS(t, w, "evil OPTIONS")
}

func TestCORSKeyedMode(t *testing.T) {
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}, CORSOrigins: []string{"https://wf.pages.dev"}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	w := corsReq(h, "GET", "/v1/checks", "https://wf.pages.dev", "ka")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	assertCORS(t, w, "https://wf.pages.dev")
	w = corsReq(h, "OPTIONS", "/v1/artifacts", "https://wf.pages.dev", "")
	if w.Code != 204 {
		t.Fatal(w.Code)
	}
	assertCORS(t, w, "https://wf.pages.dev")
	for _, o := range []string{"https://other.pages.dev", "http://127.0.0.1:5173", "https://wf.pages.dev.evil.example", "null"} {
		assertNoCORS(t, corsReq(h, "GET", "/v1/checks", o, "ka"), o)
		w := corsReq(h, "OPTIONS", "/v1/artifacts", o, "")
		assertNoCORS(t, w, "OPTIONS "+o)
		if w.Code == 204 {
			t.Error("OPTIONS answered for", o)
		}
	}
	s2 := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s2.Close() })
	assertNoCORS(t, corsReq(s2.Handler(), "GET", "/v1/checks", "https://wf.pages.dev", "ka"), "no CORSOrigins")
}

func remoteTestConfig(t *testing.T, dir string, ghBase string) *Server {
	cfg := Config{
		Addr:                    "0.0.0.0:8770",
		Data:                    dir,
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "cid",
		GitHubOAuthClientSecret: "csec",
	}
	if !cfg.Remote() {
		t.Fatal("expected remote config")
	}
	s := New(cfg, Options{DisableWorker: true, GitHubHTTPBase: ghBase})
	t.Cleanup(func() { s.Close() })
	return s
}

type mockEmail struct {
	Email    string `json:"email"`
	Verified bool   `json:"verified"`
}

func mockGitHub(t *testing.T, userID int64, login string, emails []mockEmail) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/login/oauth/authorize", func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		redir := r.URL.Query().Get("redirect_uri")
		http.Redirect(w, r, redir+"?code=mockcode&state="+url.QueryEscape(state), http.StatusFound)
	})
	mux.HandleFunc("/login/oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"access_token": "mock-access", "token_type": "bearer"})
	})
	mux.HandleFunc("/api/user", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"id": userID, "login": login})
	})
	mux.HandleFunc("/api/user/emails", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, emails)
	})
	return httptest.NewServer(mux)
}

func doWithCookies(t *testing.T, h http.Handler, method, path, origin, body string, cookies []*http.Cookie) (int, string, []*http.Cookie) {
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rdr)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String(), rec.Result().Cookies()
}

func loginRemote(t *testing.T, h http.Handler, origin string) []*http.Cookie {
	code, _, cookies := doWithCookies(t, h, "GET", "/oauth/login", "", "", nil)
	if code != http.StatusFound {
		t.Fatalf("oauth login: %d", code)
	}
	var state string
	for _, c := range cookies {
		if c.Name == oauthStateCookie {
			state = c.Value
		}
	}
	if state == "" {
		t.Fatal("no oauth state cookie")
	}
	code, body, cookies := doWithCookies(t, h, "GET", "/oauth/callback?code=mockcode&state="+url.QueryEscape(state), "", "", cookies)
	if code != http.StatusOK || !strings.Contains(body, `"ok":true`) {
		t.Fatalf("oauth callback: %d %s", code, body)
	}
	for _, c := range cookies {
		if c.Name == sessionCookieName && c.Value != "" {
			return []*http.Cookie{c}
		}
	}
	t.Fatalf("no session cookie after login: %v", cookies)
	return nil
}

func TestOAuthSessionRemoteAuth(t *testing.T) {
	gh := mockGitHub(t, 42, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := remoteTestConfig(t, dir, gh.URL)
	h := s.Handler()
	origin := "https://collector.example"

	if code, body := do(t, h, "GET", "/v1/analytics/summary", "", ""); code != 401 || !strings.Contains(body, "sign in at https://collector.example/login") {
		t.Fatalf("remote summary without session: %d %s", code, body)
	}
	if code, body := do(t, h, "POST", "/v1/ingest", "", `{"facts":[]}`); code != 401 {
		t.Fatalf("ingest without bearer: %d %s", code, body)
	}

	s.registry.SetPolicy(DomainPolicy{Mode: PolicyAllowList, Domains: []string{"other.example"}})
	sess := loginRemote(t, h, origin)
	code, body, _ := doWithCookies(t, h, "GET", "/v1/me", origin, "", sess)
	if code != 200 || !strings.Contains(body, `"admin":true`) {
		t.Fatalf("/v1/me admin: %d %s", code, body)
	}

	gh2 := mockGitHub(t, 99, "stranger", []mockEmail{{Email: "x@denied.example", Verified: true}})
	t.Cleanup(gh2.Close)
	s2 := remoteTestConfig(t, t.TempDir(), gh2.URL)
	s2.registry.SetPolicy(DomainPolicy{Mode: PolicyAllowList, Domains: []string{"other.example"}})
	h2 := s2.Handler()
	code, _, cookies := doWithCookies(t, h2, "GET", "/oauth/login", "", "", nil)
	if code != http.StatusFound {
		t.Fatal(code)
	}
	var state string
	for _, c := range cookies {
		if c.Name == oauthStateCookie {
			state = c.Value
		}
	}
	req := httptest.NewRequest("GET", "/oauth/callback?code=mockcode&state="+url.QueryEscape(state), nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h2.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied callback: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Location") != "" {
		t.Fatal("denied callback redirected")
	}
	if !strings.Contains(rec.Body.String(), `"error":"denied"`) {
		t.Fatalf("denied login body: %s", rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName && c.Value != "" {
			t.Fatal("denied login set session cookie")
		}
	}
}

func oauthFinish(t *testing.T, h http.Handler, loginPath string, mutate func([]*http.Cookie)) string {
	t.Helper()
	code, _, cookies := doWithCookies(t, h, "GET", loginPath, "", "", nil)
	if code != http.StatusFound {
		t.Fatalf("oauth login %s: %d", loginPath, code)
	}
	var state string
	for _, c := range cookies {
		if c.Name == oauthStateCookie {
			state = c.Value
		}
	}
	if state == "" {
		t.Fatal("no oauth state cookie")
	}
	if mutate != nil {
		mutate(cookies)
	}
	req := httptest.NewRequest("GET", "/oauth/callback?code=mockcode&state="+url.QueryEscape(state), nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("oauth callback: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Location") != "" {
		t.Fatal("oauth callback redirected")
	}
	var body struct {
		OK     bool   `json:"ok"`
		Return string `json:"return"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || !body.OK {
		t.Fatalf("oauth callback json: %s", rec.Body.String())
	}
	return body.Return
}

func TestOAuthReturnStaysOnOrigin(t *testing.T) {
	gh := mockGitHub(t, 42, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()

	deviceReturn := "/device?state=abc&redirect_uri=http://127.0.0.1:9/callback"
	cases := []struct {
		raw  string
		want string
	}{
		{raw: "", want: "/"},
		{raw: "/profile", want: "/profile"},
		{raw: deviceReturn, want: deviceReturn},
		{raw: "//evil.example", want: "/"},
		{raw: "https://evil.example/phish", want: "/"},
		{raw: "/\\/evil.example", want: "/"},
		{raw: "/\t/evil.example", want: "/"},
		{raw: "/\\evil.example", want: "/"},
	}
	for _, tc := range cases {
		path := "/oauth/login"
		if tc.raw != "" {
			path += "?return=" + url.QueryEscape(tc.raw)
		}
		if loc := oauthFinish(t, h, path, nil); loc != tc.want {
			t.Errorf("return %q: location %q, want %q", tc.raw, loc, tc.want)
		}
	}
	loc := oauthFinish(t, h, "/oauth/login", func(cookies []*http.Cookie) {
		for _, c := range cookies {
			if c.Name == "workflow_oauth_return" {
				c.Value = "//evil.example/phish"
			}
		}
	})
	if loc != "/" {
		t.Fatalf("forged return cookie: location %q", loc)
	}
}

func TestProductionGitHubCallbackIsPages(t *testing.T) {
	gh := mockGitHub(t, 42, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	cfg := Config{
		Addr:                    "0.0.0.0:8770",
		Data:                    t.TempDir(),
		PublicURL:               "https://api.yakka.build",
		GitHubOAuthClientID:     "cid",
		GitHubOAuthClientSecret: "csec",
	}
	s := New(cfg, Options{DisableWorker: true, GitHubHTTPBase: gh.URL})
	t.Cleanup(func() { s.Close() })
	req := httptest.NewRequest("GET", "/oauth/login", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatal(rec.Code)
	}
	u, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if u.Query().Get("redirect_uri") != "https://yakka.build/oauth/callback" {
		t.Fatalf("redirect_uri %q", u.Query().Get("redirect_uri"))
	}
	code, body := do(t, s.Handler(), "GET", "/v1/analytics/summary", "", "")
	if code != 401 || !strings.Contains(body, "sign in at https://yakka.build/login") || strings.Contains(body, "api.yakka.build/login") {
		t.Fatalf("production login hint: %d %s", code, body)
	}
	other := remoteTestConfig(t, t.TempDir(), gh.URL)
	req = httptest.NewRequest("GET", "/oauth/login", nil)
	rec = httptest.NewRecorder()
	other.Handler().ServeHTTP(rec, req)
	u, err = url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if u.Query().Get("redirect_uri") != "https://collector.example/oauth/callback" {
		t.Fatalf("test redirect_uri %q", u.Query().Get("redirect_uri"))
	}
}

func TestRemoteSiteOriginAndCORS(t *testing.T) {
	gh := mockGitHub(t, 42, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	for _, origin := range []string{"https://yakka.build", "https://www.yakka.build", "https://collector.example"} {
		w := corsReq(h, "OPTIONS", "/v1/me", origin, "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("%s OPTIONS %d", origin, w.Code)
		}
		if w.Header().Get("Access-Control-Allow-Origin") != origin ||
			w.Header().Get("Access-Control-Allow-Credentials") != "true" ||
			w.Header().Get("Access-Control-Allow-Methods") != "GET, POST, PUT, OPTIONS" {
			t.Fatalf("%s headers %v", origin, w.Header())
		}
		req := httptest.NewRequest("POST", "/logout", strings.NewReader("{}"))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("%s logout %d %s", origin, rec.Code, rec.Body.String())
		}
	}
	req := httptest.NewRequest("POST", "/logout", strings.NewReader("{}"))
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("evil origin %d", rec.Code)
	}
}

func TestRemoteSessionIngestAndTenant(t *testing.T) {
	gh := mockGitHub(t, 7, "u", []mockEmail{{Email: "u@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)

	if code, _, _ := doWithCookies(t, h, "POST", "/v1/ingest", origin, `{"facts":[]}`, sess); code != 401 {
		t.Fatalf("session ingest: %d", code)
	}
	if code, body, _ := doWithCookies(t, h, "GET", "/v1/analytics/summary", origin, "", sess); code != 403 || !strings.Contains(body, "no such tenant") {
		t.Fatalf("summary without tenant: %d %s", code, body)
	}
	s.registry.mu.Lock()
	s.registry.owners["mine"] = "7"
	s.registry.mu.Unlock()
	if code, _, _ := doWithCookies(t, h, "GET", "/v1/analytics/summary?tenant=mine", origin, "", sess); code != 200 {
		t.Fatalf("summary with owned tenant: %d", code)
	}
}

func TestRemotePolicyAdmin(t *testing.T) {
	gh := mockGitHub(t, 1, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	admin := loginRemote(t, h, origin)

	body := `{"mode":"allow_list","domains":["allowed.example"]}`
	if code, _, _ := doWithCookies(t, h, "PUT", "/v1/admin/policy", origin, body, admin); code != 200 {
		t.Fatalf("admin policy put: %d", code)
	}
	if code, _, _ := doWithCookies(t, h, "PUT", "/v1/admin/policy", origin, body, nil); code != 401 {
		t.Fatalf("policy without session: %d", code)
	}

	ghUser := mockGitHub(t, 2, "member", []mockEmail{{Email: "member@allowed.example", Verified: true}})
	t.Cleanup(ghUser.Close)
	s2 := remoteTestConfig(t, t.TempDir(), ghUser.URL)
	h2 := s2.Handler()
	member := loginRemote(t, h2, origin)
	if code, _, _ := doWithCookies(t, h2, "PUT", "/v1/admin/policy", origin, body, member); code != 403 {
		t.Fatalf("non-admin policy: %d", code)
	}

	ghMember2 := mockGitHub(t, 3, "member2", []mockEmail{{Email: "member@allowed.example", Verified: true}})
	t.Cleanup(ghMember2.Close)
	s3 := remoteTestConfig(t, t.TempDir(), ghMember2.URL)
	h3 := s3.Handler()
	s3.registry.SetPolicy(DomainPolicy{Mode: PolicyAllowList, Domains: []string{"allowed.example"}})
	deniedSess := loginRemote(t, h3, origin)
	s3.registry.SetPolicy(DomainPolicy{Mode: PolicyAllowList, Domains: []string{"other.example"}})
	code, _, _ := doWithCookies(t, h3, "GET", "/v1/me", origin, "", deniedSess)
	if code != 401 {
		t.Fatalf("policy change should clear session: %d", code)
	}
}

func TestLoopbackUnchangedWithOAuthEnv(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		Addr:                    "127.0.0.1:8770",
		Data:                    dir,
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "id",
		GitHubOAuthClientSecret: "sec",
	}
	if !cfg.Local() {
		t.Fatal("loopback with oauth env must be local")
	}
	s := New(cfg, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	req := httptest.NewRequest("GET", "http://127.0.0.1:8770/v1/analytics/summary", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("loopback summary: %d %s", rec.Code, rec.Body.String())
	}
	req2 := httptest.NewRequest("GET", "http://127.0.0.1:8770/", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 && rec2.Code != 404 {
		t.Fatalf("/ on loopback: %d", rec2.Code)
	}
}

// remoteCreateTenant creates a tenant called name and returns its generated ID.
func remoteCreateTenant(t *testing.T, h http.Handler, origin string, sess []*http.Cookie, name string) string {
	code, body, _ := doWithCookies(t, h, "POST", "/v1/tenants", origin, `{"name":"`+name+`"}`, sess)
	var resp TenantInfo
	if code != 201 || json.Unmarshal([]byte(body), &resp) != nil || resp.Name != name || !tenantRE.MatchString(resp.ID) {
		t.Fatalf("create tenant %q: %d %s", name, code, body)
	}
	return resp.ID
}

func remoteIssueToken(t *testing.T, h http.Handler, origin string, sess []*http.Cookie, tenant, scope, lifetime string) (id, plain string) {
	payload := `{"tenant":"` + tenant + `","scope":"` + scope + `","lifetime":"` + lifetime + `"}`
	code, body, _ := doWithCookies(t, h, "POST", "/v1/tokens", origin, payload, sess)
	if code != 201 {
		t.Fatalf("issue token: %d %s", code, body)
	}
	var resp struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(resp.Token, "wk_") {
		t.Fatalf("token prefix: %q", resp.Token)
	}
	return resp.ID, resp.Token
}

func TestRegistryTenantCreate(t *testing.T) {
	gh := mockGitHub(t, 10, "owner", []mockEmail{{Email: "owner@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)

	remoteCreateTenant(t, h, origin, sess, "acme")
	if code, _, _ := doWithCookies(t, h, "POST", "/v1/tenants", origin, `{"name":"acme"}`, sess); code != 409 {
		t.Fatalf("duplicate tenant: %d", code)
	}
	if code, _, _ := doWithCookies(t, h, "POST", "/v1/tenants", origin, `{"name":"beta"}`, nil); code != 401 {
		t.Fatalf("tenant without session: %d", code)
	}
	if code, _ := do(t, h, "POST", "/v1/tenants", "wk_notreal", `{"name":"gamma"}`); code != 401 {
		t.Fatalf("bearer tenant create: %d", code)
	}
}

func TestTokenBearerIngestScopes(t *testing.T) {
	gh := mockGitHub(t, 11, "writer", []mockEmail{{Email: "w@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := remoteTestConfig(t, dir, gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "t1")
	_, rwTok := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, "1d")
	_, roTok := remoteIssueToken(t, h, origin, sess, tid, TokenScopeRead, "1d")

	if code, body := do(t, h, "POST", "/v1/ingest", rwTok, `{"facts":[]}`); code != 200 {
		t.Fatalf("read_write ingest: %d %s", code, body)
	}
	if code, body := do(t, h, "GET", "/v1/analytics/summary?tenant="+tid, rwTok, ""); code != 200 {
		t.Fatalf("read_write summary: %d %s", code, body)
	}
	if code, body := do(t, h, "POST", "/v1/ingest", roTok, `{"facts":[]}`); code != 403 || !strings.Contains(body, "read-only token") {
		t.Fatalf("read ingest: %d %s", code, body)
	}
	if code, body := do(t, h, "GET", "/v1/analytics/summary?tenant="+tid, roTok, ""); code != 200 {
		t.Fatalf("read summary: %d %s", code, body)
	}
	if code, body := do(t, h, "GET", "/v1/analytics/summary?tenant=other", rwTok, ""); code != 401 || !strings.Contains(body, `"unauthorized"`) {
		t.Fatalf("tenant mismatch: %d %s", code, body)
	}
}

func TestTokenRevokeAndExpiry(t *testing.T) {
	gh := mockGitHub(t, 12, "u12", []mockEmail{{Email: "u12@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "rev")
	id, tok := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, "1d")

	if code, _, _ := doWithCookies(t, h, "POST", "/v1/tokens/"+id+"/revoke", origin, "{}", sess); code != 204 {
		t.Fatalf("revoke: %d", code)
	}
	if code, body := do(t, h, "POST", "/v1/ingest", tok, `{"facts":[]}`); code != 401 {
		t.Fatalf("ingest after revoke: %d %s", code, body)
	}
	if code, _, _ := doWithCookies(t, h, "POST", "/v1/tokens/"+id+"/revoke", origin, "{}", sess); code != 204 {
		t.Fatalf("second revoke: %d", code)
	}

	_, expTok := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, "1d")
	s.registry.mu.Lock()
	for i := range s.registry.tokenHashes {
		if s.registry.tokenHashes[i].Hash == hashTokenPlaintext(expTok) {
			s.registry.tokenHashes[i].ExpiresAt = time.Now().Add(-time.Minute)
		}
	}
	s.registry.mu.Unlock()
	if code, body := do(t, h, "POST", "/v1/ingest", expTok, `{"facts":[]}`); code != 401 {
		t.Fatalf("ingest after expiry: %d %s", code, body)
	}
}

func TestTokenListAndBearerReject(t *testing.T) {
	gh := mockGitHub(t, 13, "u13", []mockEmail{{Email: "u13@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "listme")
	remoteIssueToken(t, h, origin, sess, tid, TokenScopeRead, "1d")

	code, body, _ := doWithCookies(t, h, "GET", "/v1/tokens", origin, "", sess)
	if code != 200 || strings.Contains(body, `"token":`) || !strings.Contains(body, `"scope":"read"`) {
		t.Fatalf("owner list: %d %s", code, body)
	}
	if code, _ := do(t, h, "GET", "/v1/tokens", "wk_notreal", ""); code != 401 {
		t.Fatalf("bearer list: %d", code)
	}
}

func TestTokenAdminListRevoke(t *testing.T) {
	ghUser := mockGitHub(t, 20, "member", []mockEmail{{Email: "member@allowed.example", Verified: true}})
	t.Cleanup(ghUser.Close)
	dir := t.TempDir()
	sUser := remoteTestConfig(t, dir, ghUser.URL)
	hUser := sUser.Handler()
	origin := "https://collector.example"
	member := loginRemote(t, hUser, origin)
	tid := remoteCreateTenant(t, hUser, origin, member, "shared")
	id, tok := remoteIssueToken(t, hUser, origin, member, tid, TokenScopeReadWrite, "1d")

	ghAdmin := mockGitHub(t, 1, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(ghAdmin.Close)
	sAdmin := remoteTestConfig(t, dir, ghAdmin.URL)
	hAdmin := sAdmin.Handler()
	admin := loginRemote(t, hAdmin, origin)

	code, body, _ := doWithCookies(t, hAdmin, "GET", "/v1/admin/tokens", origin, "", admin)
	if code != 200 || !strings.Contains(body, `"github_id":20`) || strings.Contains(body, `"token":`) {
		t.Fatalf("admin list: %d %s", code, body)
	}
	if code, _, _ := doWithCookies(t, hAdmin, "GET", "/v1/admin/tokens", origin, "", member); code != 403 {
		t.Fatalf("non-admin list: %d", code)
	}
	if code, _, _ := doWithCookies(t, hAdmin, "POST", "/v1/tokens/"+id+"/revoke", origin, "{}", admin); code != 204 {
		t.Fatalf("admin revoke: %d", code)
	}
	if code, body := do(t, hAdmin, "POST", "/v1/ingest", tok, `{"facts":[]}`); code != 401 {
		t.Fatalf("ingest after admin revoke: %d %s", code, body)
	}
}

func TestTokenPolicyDoesNotRevoke(t *testing.T) {
	gh := mockGitHub(t, 14, "pol", []mockEmail{{Email: "pol@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "polt")
	_, tok := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, "1d")

	body := `{"mode":"allow_list","domains":["other.example"]}`
	if code, _, _ := doWithCookies(t, h, "PUT", "/v1/admin/policy", origin, body, sess); code != 403 {
		// member is not admin — use pre-set policy tighten via registry
	}
	s.registry.SetPolicy(DomainPolicy{Mode: PolicyAllowList, Domains: []string{"other.example"}})
	if err := s.registry.Persist(); err != nil {
		t.Fatal(err)
	}
	if code, body := do(t, h, "POST", "/v1/ingest", tok, `{"facts":[]}`); code != 200 {
		t.Fatalf("ingest after policy tighten: %d %s", code, body)
	}
}

func TestRegistryRestartLoad(t *testing.T) {
	gh := mockGitHub(t, 15, "rst", []mockEmail{{Email: "rst@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s1 := remoteTestConfig(t, dir, gh.URL)
	h1 := s1.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h1, origin)
	tid := remoteCreateTenant(t, h1, origin, sess, "persist")
	id, tok := remoteIssueToken(t, h1, origin, sess, tid, TokenScopeReadWrite, "1d")
	s1.Close()

	s2 := remoteTestConfig(t, dir, gh.URL)
	if code, body := do(t, s2.Handler(), "POST", "/v1/ingest", tok, `{"facts":[]}`); code != 200 {
		t.Fatalf("ingest after restart: %d %s", code, body)
	}
	if code, _, _ := doWithCookies(t, s2.Handler(), "POST", "/v1/tokens/"+id+"/revoke", origin, "{}", sess); code != 204 {
		t.Fatalf("revoke after restart: %d", code)
	}
	if code, body := do(t, s2.Handler(), "POST", "/v1/ingest", tok, `{"facts":[]}`); code != 401 {
		t.Fatalf("ingest after restart revoke: %d %s", code, body)
	}
}

func TestBearerTenantSessionSummary(t *testing.T) {
	gh := mockGitHub(t, 16, "sum", []mockEmail{{Email: "sum@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "owned")

	if code, body, _ := doWithCookies(t, h, "GET", "/v1/analytics/summary?tenant="+tid, origin, "", sess); code != 200 {
		t.Fatalf("owned summary: %d %s", code, body)
	}
	if code, body, _ := doWithCookies(t, h, "GET", "/v1/analytics/summary?tenant=else", origin, "", sess); code != 403 || !strings.Contains(body, "no such tenant") {
		t.Fatalf("unowned summary: %d %s", code, body)
	}
}

func TestCORSConfig(t *testing.T) {
	env := map[string]string{"YAKKA_SERVE_DATA": "/d", "YAKKA_SERVE_ADDR": "127.0.0.1:8770", "YAKKA_SERVE_CORS_ORIGINS": " https://a.example, ,https://b.example"}
	c, err := ConfigFromEnv(func(k string) string { return env[k] })
	if err != nil || len(c.CORSOrigins) != 2 || c.CORSOrigins[0] != "https://a.example" || c.CORSOrigins[1] != "https://b.example" {
		t.Fatal(c.CORSOrigins, err)
	}
	delete(env, "YAKKA_SERVE_CORS_ORIGINS")
	if c, _ := ConfigFromEnv(func(k string) string { return env[k] }); len(c.CORSOrigins) != 0 {
		t.Fatal(c.CORSOrigins)
	}
}
