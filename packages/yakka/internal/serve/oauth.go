package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type githubOAuth struct {
	authorizeURL string
	tokenURL     string
	apiBase      string
	clientID     string
	clientSecret string
	httpClient   *http.Client
}

func (s *Server) githubOAuth() *githubOAuth {
	base := strings.TrimSuffix(s.opts.GitHubHTTPBase, "/")
	g := &githubOAuth{
		clientID:     s.cfg.GitHubOAuthClientID,
		clientSecret: s.cfg.GitHubOAuthClientSecret,
		httpClient:   http.DefaultClient,
	}
	if base == "" {
		g.authorizeURL = "https://github.com/login/oauth/authorize"
		g.tokenURL = "https://github.com/login/oauth/access_token"
		g.apiBase = "https://api.github.com"
		return g
	}
	g.authorizeURL = base + "/login/oauth/authorize"
	g.tokenURL = base + "/login/oauth/access_token"
	g.apiBase = base + "/api"
	return g
}

func (s *Server) oauthLogin(w http.ResponseWriter, r *http.Request) {
	g := s.githubOAuth()
	state, err := newSessionID()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "state failed"})
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.sessionCookieSecure(),
		Expires:  time.Now().Add(oauthStateLifetime).UTC(),
	})
	redirectAfter := oauthReturnPath(r.URL.Query().Get("return"))
	http.SetCookie(w, &http.Cookie{
		Name:     oauthReturnCookie,
		Value:    redirectAfter,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.sessionCookieSecure(),
		Expires:  time.Now().Add(oauthStateLifetime).UTC(),
	})
	q := url.Values{
		"client_id":    {g.clientID},
		"redirect_uri": {s.githubRedirectURI()},
		"scope":        {"read:user user:email"},
		"state":        {state},
	}
	http.Redirect(w, r, g.authorizeURL+"?"+q.Encode(), http.StatusFound)
}

func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	fail := func(status int, errStr string) {
		writeJSON(w, status, map[string]any{"ok": false, "error": errStr})
	}
	stateCookie, err := r.Cookie(oauthStateCookie)
	if err != nil || stateCookie.Value == "" || r.URL.Query().Get("state") != stateCookie.Value {
		fail(http.StatusUnauthorized, "unauthorized")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oauthStateCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: s.sessionCookieSecure(), MaxAge: -1,
	})
	code := r.URL.Query().Get("code")
	if code == "" {
		fail(http.StatusUnauthorized, "unauthorized")
		return
	}
	g := s.githubOAuth()
	access, err := g.exchangeCode(r.Context(), code, s.githubRedirectURI())
	if err != nil {
		fail(http.StatusUnauthorized, "unauthorized")
		return
	}
	user, emails, err := g.fetchIdentity(r.Context(), access)
	if err != nil {
		fail(http.StatusUnauthorized, "unauthorized")
		return
	}
	verified := filterVerifiedEmails(emails)
	rec := SessionRecord{
		GitHubID:       user.ID,
		GitHubLogin:    user.Login,
		VerifiedEmails: verified,
		ExpiresAt:      time.Now().Add(sessionLifetime).UTC(),
	}
	if !admittedByPolicy(rec, s.registry.Policy()) {
		fail(http.StatusForbidden, "denied")
		return
	}
	// A user always has somewhere to put data; this also backfills users who signed up before defaults existed.
	if _, err := s.registry.EnsureDefaultTenant(user.ID); err != nil {
		fail(http.StatusInternalServerError, "tenant setup failed")
		return
	}
	sid, err := newSessionID()
	if err != nil {
		fail(http.StatusUnauthorized, "unauthorized")
		return
	}
	s.registry.PutSession(sid, rec)
	if err := s.registry.Persist(); err != nil {
		fail(http.StatusInternalServerError, "persist failed")
		return
	}
	s.setSessionCookie(w, sid, rec.ExpiresAt)
	dest := "/"
	if ret, err := r.Cookie(oauthReturnCookie); err == nil {
		dest = oauthReturnPath(ret.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: oauthReturnCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: s.sessionCookieSecure(), MaxAge: -1,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "return": dest})
}

// oauthReturnPath is a same-origin path safe to store in the return cookie and
// to pass to http.Redirect. A value that is not a path, or that contains a
// byte net/http would drop from a cookie (backslash, controls), is "/".
// Dropping those bytes would otherwise turn a leading slash into a
// protocol-relative URL.
func oauthReturnPath(ret string) string {
	const fallback = "/"
	if ret == "" || cookieOctets(ret) != ret {
		return fallback
	}
	u, err := url.Parse(ret)
	if err != nil || u.IsAbs() || u.Host != "" {
		return fallback
	}
	if !strings.HasPrefix(u.Path, "/") || strings.HasPrefix(u.Path, "//") || strings.Contains(u.Path, "\\") {
		return fallback
	}
	return ret
}

// cookieOctets is the subset net/http will keep in a cookie value.
func cookieOctets(v string) string {
	buf := make([]byte, 0, len(v))
	for i := 0; i < len(v); i++ {
		b := v[i]
		if b >= 0x20 && b < 0x7f && b != '"' && b != ';' && b != '\\' {
			buf = append(buf, b)
		}
	}
	return string(buf)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookieName); err == nil && c.Value != "" {
		s.registry.DeleteSession(c.Value)
		_ = s.registry.Persist()
	}
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

type ghUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
}

type ghEmail struct {
	Email    string `json:"email"`
	Verified bool   `json:"verified"`
}

func filterVerifiedEmails(in []ghEmail) []string {
	var out []string
	for _, e := range in {
		if e.Verified && e.Email != "" {
			out = append(out, e.Email)
		}
	}
	return out
}

func (g *githubOAuth) exchangeCode(ctx context.Context, code, redirectURI string) (string, error) {
	body := url.Values{
		"client_id":     {g.clientID},
		"client_secret": {g.clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.tokenURL, strings.NewReader(body.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token exchange: %s", resp.Status)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("empty access token")
	}
	return tok.AccessToken, nil
}

func (g *githubOAuth) fetchIdentity(ctx context.Context, access string) (ghUser, []ghEmail, error) {
	var user ghUser
	if err := g.getJSON(ctx, g.apiBase+"/user", access, &user); err != nil {
		return ghUser{}, nil, err
	}
	var emails []ghEmail
	if err := g.getJSON(ctx, g.apiBase+"/user/emails", access, &emails); err != nil {
		return ghUser{}, nil, err
	}
	return user, emails, nil
}

func (g *githubOAuth) getJSON(ctx context.Context, url string, access string, dest any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return fmt.Errorf("github api %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(resp.Body).Decode(dest)
}
