// Package serve is the HTTP service of design 3: per-tenant auth, ingest, advisory artifact reads
// and the pending-content worker.
package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const maxBody = 16 << 20

var tenantRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// Config is the server configuration.
type Config struct {
	Addr, Data              string
	Keys                    []KeyPair
	PublicURL               string
	GitHubOAuthClientID     string
	GitHubOAuthClientSecret string
	// CORSOrigins are the exact origins allowed to read a keyed server from a browser. Local mode
	// ignores it and allows loopback origins.
	CORSOrigins []string
}

// KeyPair maps one key to one tenant.
type KeyPair struct{ Tenant, Key string }

// LocalTenant is the one tenant of local mode.
const LocalTenant = "local"

// Local reports local mode: loopback bind (OAuth env ignored) or keyless non-remote config. Every
// local request is LocalTenant and bearer tokens are ignored.
func (c Config) Local() bool {
	if c.Addr != "" && loopbackBind(c.Addr) {
		return true
	}
	if len(c.Keys) > 0 {
		return false
	}
	return !c.Remote()
}

// Remote reports collector mode: non-loopback bind with GitHub OAuth env configured.
func (c Config) Remote() bool {
	if c.Addr == "" || loopbackBind(c.Addr) {
		return false
	}
	return c.GitHubOAuthClientID != "" && c.GitHubOAuthClientSecret != "" && c.PublicURL != ""
}

// ConfigFromEnv reads serve configuration from the environment. Loopback binds are always local
// mode. A non-loopback bind requires GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and
// YAKKA_PUBLIC_URL. YAKKA_SERVE_KEYS must be empty.
func ConfigFromEnv(getenv func(string) string) (Config, error) {
	if strings.TrimSpace(getenv("YAKKA_SERVE_KEYS")) != "" {
		return Config{}, fmt.Errorf("YAKKA_SERVE_KEYS is set; keyed startup via environment is no longer supported")
	}
	c := Config{Addr: getenv("YAKKA_SERVE_ADDR"), Data: getenv("YAKKA_SERVE_DATA")}
	if c.Addr == "" {
		c.Addr = "127.0.0.1:8770"
	}
	if c.Data == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return c, errors.New("YAKKA_SERVE_DATA unset and no home directory")
		}
		c.Data = filepath.Join(home, ".local/share/yakka/serve")
	}
	for _, o := range strings.Split(getenv("YAKKA_SERVE_CORS_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	if loopbackBind(c.Addr) {
		return c, nil
	}
	id := strings.TrimSpace(getenv("GITHUB_OAUTH_CLIENT_ID"))
	secret := strings.TrimSpace(getenv("GITHUB_OAUTH_CLIENT_SECRET"))
	pub := strings.TrimSpace(getenv("YAKKA_PUBLIC_URL"))
	if id == "" || secret == "" || pub == "" {
		return c, fmt.Errorf("non-loopback YAKKA_SERVE_ADDR requires GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and YAKKA_PUBLIC_URL")
	}
	if err := validatePublicURL(pub); err != nil {
		return c, err
	}
	c.GitHubOAuthClientID = id
	c.GitHubOAuthClientSecret = secret
	c.PublicURL = pub
	return c, nil
}

func validatePublicURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("YAKKA_PUBLIC_URL: %w", err)
	}
	if u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("YAKKA_PUBLIC_URL must be an https origin with no path (got %q)", raw)
	}
	if u.Path != "" && u.Path != "/" {
		return fmt.Errorf("YAKKA_PUBLIC_URL must be an https origin with no path (got %q)", raw)
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("YAKKA_PUBLIC_URL must be an https origin with no path (got %q)", raw)
	}
	return nil
}

// loopbackBind reports whether addr binds only a loopback interface.
func loopbackBind(addr string) bool {
	h, _, err := net.SplitHostPort(addr)
	return err == nil && loopbackHost(h)
}

// loopbackHost reports whether h is localhost or a loopback IP.
func loopbackHost(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// ParseKeys parses "tenant=key[,tenant=key…]". An empty string is no keys (local mode). Errors name
// the problem, never a key.
func ParseKeys(s string) ([]KeyPair, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var out []KeyPair
	seenKey := map[string]string{}
	seenTenant := map[string]bool{}
	for i, part := range strings.Split(s, ",") {
		t, k, ok := strings.Cut(part, "=")
		if !ok || k == "" {
			return nil, fmt.Errorf("YAKKA_SERVE_KEYS entry %d is not tenant=key", i+1)
		}
		if !tenantRE.MatchString(t) {
			return nil, fmt.Errorf("YAKKA_SERVE_KEYS entry %d has an invalid tenant name", i+1)
		}
		if o, dup := seenKey[k]; dup {
			return nil, fmt.Errorf("YAKKA_SERVE_KEYS gives one key to two tenants (%q and %q)", o, t)
		}
		if seenTenant[t] {
			return nil, fmt.Errorf("YAKKA_SERVE_KEYS names tenant %q twice", t)
		}
		seenKey[k], seenTenant[t] = t, true
		out = append(out, KeyPair{t, k})
	}
	return out, nil
}

// Preflight refuses to start serve on a data directory that compaction has locked. For every
// tenant directory holding ledger.db it probes the shared lock (taking and releasing it); a locked
// tenant returns an error naming it and telling the operator to wait for or stop compaction.
func Preflight(dataDir string) error {
	ents, err := os.ReadDir(dataDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(dataDir, e.Name())
		if _, err := os.Stat(filepath.Join(dir, "ledger.db")); err != nil {
			continue
		}
		if err := store.TrySharedLock(dir); err != nil {
			if errors.Is(err, store.ErrLocked) {
				return fmt.Errorf("yakka serve: tenant %q is locked by compaction; wait for or stop `yakka ledger compact` to finish", e.Name())
			}
			return err
		}
	}
	return nil
}

// Options tunes a Server.
type Options struct {
	Version        string
	DisableWorker  bool          // tests: leave pending/ alone
	PollInterval   time.Duration // default 3s
	GroupWindow    time.Duration
	ScreenStep     ScreenFunc     // default: promote as unscreened
	Checks         *scorer.Checks // loaded checks for /v1/checks; nil = none loaded
	ScreenBackoff  time.Duration  // first wait after an unreachable scorer; default 5s, doubles to 5 min
	GitHubHTTPBase string         // tests: mock GitHub authorize/token/api base URL
}

// ScreenFunc is the screen step applied to one pending hash. Phase 3 replaces it.
type ScreenFunc func(ctx context.Context, t *store.Tenant, hash string) error

func unscreened(ctx context.Context, t *store.Tenant, hash string) error {
	return t.Promote(ctx, hash, store.Screen{Verdict: "unscreened"})
}

type tenantState struct {
	t       *store.Tenant
	wake    chan struct{}
	started bool
	gaps    atomic.Int64            // screen gaps counted at worker start
	fails   map[string]*hashFailure // worker-only: pending hashes whose screen step keeps failing
	rescore rescoreState            // the admin rescore job
}

// hashFailure is the in-memory retry state of one pending hash. A restart forgets it, which gives
// the hash another bounded run of attempts.
type hashFailure struct {
	attempts int
	next     time.Time
}

// Server is the HTTP service.
type Server struct {
	cfg      Config
	opts     Options
	screen   ScreenFunc
	registry *Registry
	grants   *deviceGrants

	mu      sync.Mutex
	tenants map[string]*tenantState
	closed  bool
	stop    chan struct{}
	ctx     context.Context // cancelled by Close, so an in-flight screen does not hold up shutdown
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// New builds a Server.
func New(cfg Config, opts Options) *Server {
	if opts.PollInterval <= 0 {
		opts.PollInterval = 3 * time.Second
	}
	if opts.ScreenBackoff <= 0 {
		opts.ScreenBackoff = 5 * time.Second
	}
	if opts.Version == "" {
		opts.Version = "dev"
	}
	reg, err := OpenRegistry(cfg.Data)
	if err != nil {
		panic("serve: registry: " + err.Error())
	}
	s := &Server{cfg: cfg, opts: opts, registry: reg, grants: newDeviceGrants(), tenants: map[string]*tenantState{}, stop: make(chan struct{}), screen: opts.ScreenStep}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	if s.screen == nil {
		s.screen = unscreened
	}
	if cfg.Remote() {
		if err := reg.Persist(); err != nil {
			panic("serve: registry: " + err.Error())
		}
	}
	return s
}

// SetWorkerEnabled is not offered after start; use Options.DisableWorker. StartWorker starts the
// worker for every open tenant and any opened later (tests that began disabled).
func (s *Server) StartWorker() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.opts.DisableWorker = false
	for _, ts := range s.tenants {
		s.startWorkerLocked(ts)
	}
}

func (s *Server) startWorkerLocked(ts *tenantState) {
	if s.opts.DisableWorker || ts.started {
		return
	}
	ts.started = true
	s.wg.Add(1)
	go s.worker(ts)
}

const maxBackoff = 5 * time.Minute

const maxScreenAttempts = 5

func (s *Server) worker(ts *tenantState) {
	defer s.wg.Done()
	tick := time.NewTicker(s.opts.PollInterval)
	defer tick.Stop()
	reconciled := false
	var backoff time.Duration
	for {
		unreachable := false
		if !reconciled {
			var done bool
			done, unreachable = s.reconcile(ts)
			reconciled = done
		}
		if !unreachable {
			unreachable = s.drainPending(ts)
		}
		if unreachable {
			if backoff == 0 {
				backoff = s.opts.ScreenBackoff
			} else if backoff *= 2; backoff > maxBackoff {
				backoff = maxBackoff
			}
			select { // wakes are ignored while backing off
			case <-s.stop:
				return
			case <-time.After(backoff):
			}
			continue
		}
		backoff = 0
		select {
		case <-s.stop:
			return
		case <-ts.wake:
		case <-tick.C:
		}
	}
}

// reconcile runs once per tenant start: it counts screen gaps (content the ledger knows of that
// the store lost) and screens blobs that were promoted without a screens row (a crash between the
// two). done is false when the scorer was unreachable and the blobs need another try.
func (s *Server) reconcile(ts *tenantState) (done, unreachable bool) {
	ctx := s.ctx
	if n, err := ts.t.ScreenGaps(ctx); err == nil {
		ts.gaps.Store(int64(n))
	}
	blobs, err := ts.t.UnscreenedBlobs(ctx)
	if err != nil {
		return false, false
	}
	for _, h := range blobs {
		if err := s.screen(ctx, ts.t, h); err != nil {
			fmt.Fprintf(os.Stderr, "yakka serve: unscreened blob %s: %v\n", h, err)
			if errors.Is(err, scorer.ErrUnreachable) {
				return false, true
			}
		}
	}
	return true, false
}

// drainPending applies the screen step to everything pending, in order. A failure leaves the file
// pending; the next wake or poll retries it. It reports whether the scorer was unreachable, which
// ends the pass.
func (s *Server) drainPending(ts *tenantState) (unreachable bool) {
	hashes, err := ts.t.PendingHashes()
	if err != nil {
		return false
	}
	for _, h := range hashes {
		if s.ctx.Err() != nil {
			return false
		}
		if f := ts.fails[h]; f != nil && time.Now().Before(f.next) {
			continue
		}
		err := s.screen(s.ctx, ts.t, h)
		if err == nil {
			delete(ts.fails, h)
			continue
		}
		fmt.Fprintf(os.Stderr, "yakka serve: pending %s: %v\n", h, err)
		if errors.Is(err, scorer.ErrUnreachable) {
			return true
		}
		if s.ctx.Err() != nil {
			return false
		}
		s.noteFailure(ts, h, err)
	}
	return false
}

// noteFailure counts a non-unreachable screen failure. It backs the hash off exponentially, and
// after maxScreenAttempts it rejects the content at stage "screen" so the reads show an answer.
func (s *Server) noteFailure(ts *tenantState, h string, cause error) {
	if ts.fails == nil {
		ts.fails = map[string]*hashFailure{}
	}
	f := ts.fails[h]
	if f == nil {
		f = &hashFailure{}
		ts.fails[h] = f
	}
	f.attempts++
	if f.attempts < maxScreenAttempts {
		wait := s.opts.ScreenBackoff << (f.attempts - 1)
		if wait > maxBackoff || wait <= 0 {
			wait = maxBackoff
		}
		f.next = time.Now().Add(wait)
		return
	}
	reason := "screen error: " + shortCause(cause)
	r := store.Rejection{Stage: "screen", Pattern: "screen_error", Reason: reason, FactType: "artifact_version", ContentHash: h}
	if ci, err := ts.t.ContentFacts(s.ctx, h); err == nil {
		r.Path, r.ConversationID = ci.LatestPath, ci.ConversationID
	}
	if err := ts.t.DropPending(s.ctx, h, r); err != nil {
		fmt.Fprintf(os.Stderr, "yakka serve: pending %s: cannot record rejection: %v\n", h, err)
		f.next = time.Now().Add(maxBackoff) // keep it pending, but do not spin on the write
		return
	}
	delete(ts.fails, h)
}

func shortCause(err error) string {
	m := strings.Join(strings.Fields(err.Error()), " ")
	if r := []rune(m); len(r) > 120 {
		m = string(r[:120]) + "..."
	}
	return m
}

func (s *Server) tenant(name string) (*tenantState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, store.ErrClosed
	}
	if ts, ok := s.tenants[name]; ok {
		return ts, nil
	}
	t, err := store.Open(filepath.Join(s.cfg.Data, name), store.Options{GroupWindow: s.opts.GroupWindow})
	if err != nil {
		return nil, err
	}
	ts := &tenantState{t: t, wake: make(chan struct{}, 1)}
	s.tenants[name] = ts
	s.startWorkerLocked(ts) // the worker's first pass handles leftover pending files
	return ts, nil
}

// Close stops workers and closes every tenant.
func (s *Server) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	close(s.stop)
	s.cancel()
	s.mu.Unlock()
	s.wg.Wait()
	var first error
	for _, ts := range s.tenants {
		if err := ts.t.Close(); err != nil && first == nil {
			first = err
		}
	}
	if s.registry != nil {
		if err := s.registry.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// Handler returns the HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", s.method(http.MethodGet, s.health))
	mux.HandleFunc("/v1/whoami", s.method(http.MethodGet, s.whoami))
	mux.HandleFunc("/v1/ingest", s.method(http.MethodPost, s.auth(s.ingest)))
	mux.HandleFunc("/v1/artifacts", s.method(http.MethodGet, s.auth(s.artifacts)))
	mux.HandleFunc("/v1/checks", s.method(http.MethodGet, s.auth(s.checks)))
	mux.HandleFunc("/v1/baselines", s.method(http.MethodGet, s.auth(s.baselines)))
	mux.HandleFunc("/v1/search", s.method(http.MethodGet, s.auth(s.search)))
	mux.HandleFunc("/v1/analytics/facets", s.method(http.MethodGet, s.auth(s.analyticsFacets)))
	mux.HandleFunc("/v1/analytics/summary", s.method(http.MethodGet, s.auth(s.analyticsSummary)))
	mux.HandleFunc("/v1/analytics/series", s.method(http.MethodGet, s.auth(s.analyticsSeries)))
	mux.HandleFunc("/v1/analytics/scores", s.method(http.MethodGet, s.auth(s.analyticsScores)))
	mux.HandleFunc("/v1/analytics/executions", s.method(http.MethodGet, s.auth(s.analyticsExecutions)))
	mux.HandleFunc("/v1/analytics/conversations", s.method(http.MethodGet, s.auth(s.analyticsConversations)))
	mux.HandleFunc("/v1/analytics/conversation", s.method(http.MethodGet, s.auth(s.analyticsConversation)))
	mux.HandleFunc("/v1/analytics/explore", s.method(http.MethodGet, s.auth(s.analyticsExplore)))
	mux.HandleFunc("/v1/analytics/schema", s.method(http.MethodGet, s.auth(s.analyticsSchema)))
	mux.HandleFunc("/v1/analytics/query", s.method(http.MethodGet, s.auth(s.analyticsQuery)))
	mux.HandleFunc("/v1/analytics/distribution", s.method(http.MethodGet, s.auth(s.analyticsDistribution)))
	mux.HandleFunc("/v1/analytics/score-series", s.method(http.MethodGet, s.auth(s.analyticsScoreSeries)))
	mux.HandleFunc("/v1/me", s.method(http.MethodGet, s.sessionOnly(s.handleMe)))
	mux.HandleFunc("/v1/tenants", s.handleTenantsRoute)
	mux.HandleFunc("/v1/tokens", s.handleTokensRoute)
	mux.HandleFunc("/v1/tokens/", s.handleTokensSubpath)
	mux.HandleFunc("/v1/admin/tokens", s.method(http.MethodGet, s.sessionOnly(s.handleAdminListTokens)))
	mux.HandleFunc("/v1/admin/policy", s.method(http.MethodPut, s.originGuard(s.sessionOnly(s.handleAdminPolicy))))
	mux.HandleFunc("/v1/admin/status", s.method(http.MethodGet, s.sessionOnly(s.adminOnly(s.handleAdminStatus))))
	mux.HandleFunc("/v1/admin/rescore", s.method(http.MethodPost, s.originGuard(s.sessionOnly(s.adminOnly(s.handleAdminRescore)))))
	if s.cfg.Remote() {
		mux.HandleFunc("/v1/device/code", s.handleDeviceCodeRoute)
		mux.HandleFunc("/v1/device/authorize", s.handleDeviceAuthorizeRoute)
		mux.HandleFunc("/v1/device/grant", s.method(http.MethodGet, s.sessionOnly(s.handleDeviceGrant)))
		mux.HandleFunc("/v1/device/token", s.handleDeviceTokenRoute)
	}
	mux.HandleFunc("/oauth/login", s.method(http.MethodGet, s.oauthLogin))
	mux.HandleFunc("/oauth/callback", s.method(http.MethodGet, s.oauthCallback))
	mux.HandleFunc("/logout", s.method(http.MethodPost, s.originGuard(s.logout)))
	mux.HandleFunc("/", siteHandler(siteFS))
	h := s.withSession(s.cors(mux))
	if s.cfg.Local() {
		return localGuard(h)
	}
	return h
}

// cors lets a browser on an allowed origin read the API. Local mode allows loopback origins
// for GET and OPTIONS only, without credentials. Keyed mode does the same for exact
// YAKKA_SERVE_CORS_ORIGINS entries. Remote collector mode allows the Pages origins and
// configured CORS origins with credentials, including POST and PUT preflight.
func (s *Server) cors(h http.Handler) http.Handler {
	type decision struct {
		ok, credentials bool
	}
	allowed := func(origin string) decision {
		if origin == "" || origin == "null" {
			return decision{}
		}
		if s.cfg.Local() {
			u, err := url.Parse(origin)
			ok := err == nil && (u.Scheme == "http" || u.Scheme == "https") && loopbackHost(u.Hostname())
			return decision{ok: ok}
		}
		if s.cfg.Remote() {
			return decision{ok: s.originAllowedRemote(origin), credentials: true}
		}
		for _, o := range s.cfg.CORSOrigins {
			if o == origin {
				return decision{ok: true}
			}
		}
		return decision{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			d := allowed(origin)
			if d.ok {
				hd := w.Header()
				hd.Set("Access-Control-Allow-Origin", origin)
				hd.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				if d.credentials {
					hd.Set("Access-Control-Allow-Credentials", "true")
					hd.Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
				} else {
					hd.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				}
				hd.Add("Vary", "Origin")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
		}
		h.ServeHTTP(w, r)
	})
}

// localGuard keeps browsers out of a keyless service. A Host that is not loopback is refused, which
// stops DNS rebinding, and a POST must be JSON, which a cross-origin page cannot send without a
// preflight. The service answers a preflight only for GET (see cors), so a POST preflight fails.
func localGuard(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if hh, _, err := net.SplitHostPort(host); err == nil {
			host = hh
		}
		if !loopbackHost(host) {
			writeJSON(w, 403, map[string]string{"error": "local mode accepts only loopback hosts"})
			return
		}
		if r.Method == http.MethodPost {
			mt, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
			if !strings.EqualFold(strings.TrimSpace(mt), "application/json") {
				writeJSON(w, 415, map[string]string{"error": "content type must be application/json"})
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) method(m string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != m {
			w.Header().Set("Allow", m)
			writeJSON(w, 405, map[string]string{"error": "method not allowed"})
			return
		}
		h(w, r)
	}
}

type tenantHandler func(w http.ResponseWriter, r *http.Request, name string, ts *tenantState)

func (s *Server) auth(h tenantHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		res := s.authorizeRequest(r)
		if res.status == authForbidden {
			writeJSON(w, 403, map[string]string{"error": "no such tenant"})
			return
		}
		if res.status != authOK {
			msg := res.msg
			if msg == "" {
				msg = "unauthorized"
			}
			writeJSON(w, 401, map[string]string{"error": msg})
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v1/ingest" && res.scope == TokenScopeRead {
			writeJSON(w, 403, map[string]string{"error": "read-only token"})
			return
		}
		name := res.tenant
		ts, err := s.tenant(name)
		if err != nil {
			if errors.Is(err, store.ErrLocked) {
				writeJSON(w, 503, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, 503, map[string]string{"error": "tenant unavailable"})
			return
		}
		h(w, r, name, ts)
	}
}

// whoami answers which tenant and scope a bearer token is bound to, so `yakka sync` can confirm its
// target before sending anything. It uses only the bearer branch of authorizeRequest: no cookie
// session, and it never opens the tenant, so a locked tenant cannot turn it into a 503. Local
// mode needs no token and always answers the local tenant; a keyed-mode key and local mode answer
// read_write with expires_at 0.
func (s *Server) whoami(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Local() {
		writeJSON(w, 200, map[string]any{"tenant": LocalTenant, "scope": TokenScopeReadWrite, "expires_at": 0})
		return
	}
	tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	var tenant, scope string
	var expires int64
	if s.cfg.Remote() {
		var exp time.Time
		tenant, scope, exp, ok = s.registry.resolveBearerExpiry(tok, time.Now())
		expires = exp.Unix()
	} else {
		tenant, ok = s.tenantForKey(tok)
		scope = TokenScopeReadWrite
	}
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, 200, map[string]any{"tenant": tenant, "scope": scope, "expires_at": expires})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	var list []*tenantState
	for _, ts := range s.tenants {
		list = append(list, ts)
	}
	s.mu.Unlock()
	n, gaps := 0, 0
	open := map[string]string{}
	for _, ts := range list {
		open[ts.t.Dir()] = ts.t.CompactionState()
		gaps += int(ts.gaps.Load())
		if h, err := ts.t.PendingHashes(); err == nil {
			n += len(h)
		}
	}
	compaction := "complete"
	if ents, err := os.ReadDir(s.cfg.Data); err == nil {
		for _, e := range ents {
			if !e.IsDir() {
				continue
			}
			dir := filepath.Join(s.cfg.Data, e.Name())
			if _, err := os.Stat(filepath.Join(dir, "ledger.db")); err != nil {
				continue
			}
			state, ok := open[dir]
			if !ok {
				state = store.CompactionStateOf(dir)
			}
			if state != "complete" {
				compaction = "required"
				break
			}
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true, "version": s.opts.Version, "pending": n, "screen_gaps": gaps, "compaction": compaction})
}

func (s *Server) ingest(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req struct {
		Facts *[]json.RawMessage `json:"facts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeJSON(w, 413, map[string]string{"error": "request too large"})
			return
		}
		writeJSON(w, 400, map[string]string{"error": "body is not a facts batch"})
		return
	}
	if req.Facts == nil {
		writeJSON(w, 400, map[string]string{"error": "body is not a facts batch"})
		return
	}
	res, err := ingest.Ingest(r.Context(), ts.t, *req.Facts)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "ingest failed"})
		return
	}
	if res == nil {
		res = []ingest.Result{}
	}
	select {
	case ts.wake <- struct{}{}:
	default:
	}
	writeJSON(w, 200, map[string]any{"results": res})
}

func (s *Server) artifacts(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	repo, path := r.URL.Query().Get("repo_id"), r.URL.Query().Get("path")
	if repo == "" || path == "" {
		writeJSON(w, 400, map[string]string{"error": "repo_id and path are required"})
		return
	}
	a, err := ts.t.Artifact(r.Context(), repo, path)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "read failed"})
		return
	}
	if a == nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	var screen any
	if sc := a.Latest.Screen; sc != nil {
		screen = map[string]any{"verdict": sc.Verdict, "scorer": sc.Scorer, "at": sc.At.UTC().Format(time.RFC3339)}
	}
	var rejection any
	if rj := a.Latest.Rejection; rj != nil {
		rejection = map[string]any{"stage": rj.Stage, "reason": rj.Reason, "at": rj.At.UTC().Format(time.RFC3339)}
	}
	scores := []map[string]any{}
	for _, sc := range a.Latest.Scores {
		scores = append(scores, map[string]any{"check": sc.Check, "score": sc.Score})
	}
	writeJSON(w, 200, map[string]any{"repo_id": a.RepoID, "path": a.Path, "kind": keys.Kind(a.Path), "versions": a.Versions,
		"latest": map[string]any{"content_hash": a.Latest.ContentHash, "received_at": a.Latest.ReceivedAt.UTC().Format(time.RFC3339),
			"conversation_id": a.Latest.ConversationID, "source": a.Latest.Source, "screen": screen, "scores": scores, "rejection": rejection}})
}
