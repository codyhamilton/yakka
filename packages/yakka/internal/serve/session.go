package serve

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	sessionCookieName  = "workflow_session"
	oauthStateCookie   = "workflow_oauth_state"
	oauthReturnCookie  = "workflow_oauth_return"
	adminEmail         = "codyh@ctzns.net"
	sessionLifetime    = 14 * 24 * time.Hour
	oauthStateLifetime = 10 * time.Minute

	// Production API origin. GitHub's registered callback is the Pages page, not this origin.
	apiProductionOrigin = "https://api.yakka.build"
	pagesOAuthCallback  = "https://yakka.build/oauth/callback"
	pagesOrigin         = "https://yakka.build"
	pagesWWWOrigin      = "https://www.yakka.build"
)

type sessionContextKey struct{}

// Session is the authenticated GitHub identity attached to a request.
type Session struct {
	ID             string
	GitHubID       int64
	GitHubLogin    string
	VerifiedEmails []string
}

type authResult struct {
	tenant string
	scope  string
	status authStatus
	msg    string
}

type authStatus int

const (
	authOK           authStatus = 0
	authUnauthorized authStatus = 1
	authForbidden    authStatus = 2
)

func sessionFromContext(ctx context.Context) *Session {
	s, _ := ctx.Value(sessionContextKey{}).(*Session)
	return s
}

func isAdmin(rec SessionRecord) bool {
	for _, e := range rec.VerifiedEmails {
		if e == adminEmail {
			return true
		}
	}
	return false
}

func emailDomain(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 0 || at == len(email)-1 {
		return ""
	}
	return email[at+1:]
}

func admittedByPolicy(rec SessionRecord, policy DomainPolicy) bool {
	if isAdmin(rec) {
		return true
	}
	if policy.Mode == PolicyEveryone {
		return true
	}
	for _, email := range rec.VerifiedEmails {
		dom := emailDomain(email)
		for _, allowed := range policy.Domains {
			if strings.EqualFold(allowed, dom) {
				return true
			}
		}
	}
	return false
}

func newSessionID() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func (r *Registry) tenantsOwnedBy(githubID int64) []TenantInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	want := fmt.Sprintf("%d", githubID)
	out := []TenantInfo{}
	for id, owner := range r.owners {
		if owner == want {
			out = append(out, TenantInfo{ID: id, Name: r.tenantNameLocked(id)})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (r *Registry) ownsTenant(githubID int64, tenant string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.owners[tenant] == fmt.Sprintf("%d", githubID)
}

func (s *Server) publicOrigin() string {
	if s.cfg.PublicURL != "" {
		return strings.TrimSuffix(s.cfg.PublicURL, "/")
	}
	return ""
}

// githubRedirectURI is the GitHub redirect_uri. YAKKA_PUBLIC_URL is the API origin
// (device exchange, Secure cookies, the 401 login hint). When that origin is the
// production API, GitHub still returns the browser to the Pages callback.
func (s *Server) githubRedirectURI() string {
	if s.publicOrigin() == apiProductionOrigin {
		return pagesOAuthCallback
	}
	if s.publicOrigin() == "" {
		return "/oauth/callback"
	}
	return s.publicOrigin() + "/oauth/callback"
}

// originAllowedRemote is the remote allow-list for state-changing Origin checks and
// credentialed CORS: the public API origin, the two Pages origins, and YAKKA_SERVE_CORS_ORIGINS.
func (s *Server) originAllowedRemote(origin string) bool {
	if origin == "" || origin == "null" {
		return false
	}
	if origin == s.publicOrigin() || origin == pagesOrigin || origin == pagesWWWOrigin {
		return true
	}
	for _, o := range s.cfg.CORSOrigins {
		if o == origin {
			return true
		}
	}
	return false
}

func (s *Server) sessionCookieSecure() bool {
	u, err := url.Parse(s.cfg.PublicURL)
	return err == nil && u.Scheme == "https"
}

func (s *Server) setSessionCookie(w http.ResponseWriter, id string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.sessionCookieSecure(),
		Expires:  expires.UTC(),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.sessionCookieSecure(),
		MaxAge:   -1,
	})
}

func (s *Server) allowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	if s.cfg.Local() {
		u, err := url.Parse(origin)
		return err == nil && (u.Scheme == "http" || u.Scheme == "https") && loopbackHost(u.Hostname())
	}
	if s.cfg.Remote() {
		return s.originAllowedRemote(origin)
	}
	return origin == s.publicOrigin()
}

func (s *Server) originGuard(h http.HandlerFunc) http.HandlerFunc {
	return s.originGuardContentTypes(h, "application/json")
}

// originGuardJSONOrForm allows JSON (API clients) or form POST (device page navigation) with the same Origin check.
func (s *Server) originGuardJSONOrForm(h http.HandlerFunc) http.HandlerFunc {
	return s.originGuardContentTypes(h, "application/json", "application/x-www-form-urlencoded")
}

func (s *Server) originGuardContentTypes(h http.HandlerFunc, allowed ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mt, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
		mt = strings.TrimSpace(mt)
		ok := false
		for _, a := range allowed {
			if strings.EqualFold(mt, a) {
				ok = true
				break
			}
		}
		if !ok {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		if !s.allowedOrigin(r.Header.Get("Origin")) {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		h(w, r)
	}
}

func (s *Server) withSession(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.Remote() {
			h.ServeHTTP(w, r)
			return
		}
		ctx := r.Context()
		c, err := r.Cookie(sessionCookieName)
		if err != nil || c.Value == "" {
			h.ServeHTTP(w, r)
			return
		}
		rec, ok := s.registry.GetSession(c.Value, time.Now())
		if !ok {
			s.clearSessionCookie(w)
			h.ServeHTTP(w, r)
			return
		}
		if !admittedByPolicy(rec, s.registry.Policy()) {
			s.registry.DeleteSession(c.Value)
			s.clearSessionCookie(w)
			h.ServeHTTP(w, r)
			return
		}
		ctx = context.WithValue(ctx, sessionContextKey{}, &Session{
			ID:             c.Value,
			GitHubID:       rec.GitHubID,
			GitHubLogin:    rec.GitHubLogin,
			VerifiedEmails: rec.VerifiedEmails,
		})
		h.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) sessionOnly(h func(w http.ResponseWriter, r *http.Request, sess *Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		sess := sessionFromContext(r.Context())
		if sess == nil {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		h(w, r, sess)
	}
}

func (s *Server) authorizeRequest(r *http.Request) authResult {
	if s.cfg.Local() {
		return authResult{tenant: LocalTenant, status: authOK}
	}
	if tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		now := time.Now()
		var tenant, scope string
		var okTenant bool
		if s.cfg.Remote() {
			tenant, scope, okTenant = s.registry.resolveBearer(tok, now)
		} else {
			tenant, okTenant = s.tenantForKey(tok)
			if okTenant {
				scope = TokenScopeReadWrite
			}
		}
		if !okTenant {
			return authResult{status: authUnauthorized, msg: "unauthorized"}
		}
		if q := r.URL.Query().Get("tenant"); q != "" && q != tenant {
			return authResult{status: authUnauthorized, msg: "unauthorized"}
		}
		return authResult{tenant: tenant, scope: scope, status: authOK}
	}
	if !s.cfg.Remote() {
		return authResult{status: authUnauthorized, msg: "unauthorized: this service requires a key; run yakka login"}
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/ingest" {
		return authResult{status: authUnauthorized, msg: s.remoteUnauthorizedMsg()}
	}
	sess := sessionFromContext(r.Context())
	if sess == nil {
		return authResult{status: authUnauthorized, msg: s.remoteUnauthorizedMsg()}
	}
	tenant := r.URL.Query().Get("tenant")
	if tenant == "" || !s.registry.ownsTenant(sess.GitHubID, tenant) {
		return authResult{status: authForbidden}
	}
	return authResult{tenant: tenant, status: authOK}
}

func (s *Server) remoteUnauthorizedMsg() string {
	login := s.publicOrigin() + "/login"
	// The production API does not embed the site. Sign-in is the Pages /login page.
	if s.publicOrigin() == apiProductionOrigin {
		login = pagesOrigin + "/login"
	}
	return "unauthorized: this service requires a token; sign in at " + login
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, sess *Session) {
	writeJSON(w, 200, map[string]any{
		"github_id":    sess.GitHubID,
		"github_login": sess.GitHubLogin,
		"admin":        isAdmin(SessionRecord{VerifiedEmails: sess.VerifiedEmails}),
		"tenants":      s.registry.tenantsOwnedBy(sess.GitHubID),
	})
}

func (s *Server) handleAdminPolicy(w http.ResponseWriter, r *http.Request, sess *Session) {
	if !isAdmin(SessionRecord{VerifiedEmails: sess.VerifiedEmails}) {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	var body DomainPolicy
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	if body.Mode != PolicyEveryone && body.Mode != PolicyAllowList {
		writeJSON(w, 400, map[string]string{"error": "invalid mode"})
		return
	}
	if err := s.registry.SetPolicy(body); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if err := s.registry.Persist(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "persist failed"})
		return
	}
	writeJSON(w, 200, body)
}
