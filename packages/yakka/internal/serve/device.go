package serve

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

// deviceSite maps the public API origin to the site that serves /device.
func (s *Server) deviceSite() string {
	o := s.publicOrigin()
	if o == "https://api.yakka.build" {
		return "https://yakka.build"
	}
	return o
}

func deviceMethodPost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return false
	}
	return true
}

func (s *Server) handleDeviceCodeRoute(w http.ResponseWriter, r *http.Request) {
	if !deviceMethodPost(w, r) {
		return
	}
	s.grants.sweep()
	// Body is empty or a JSON object; anything else is rejected. host, when a string, is the
	// device's name for itself and becomes the default token name.
	var host string
	if raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<10)); len(strings.TrimSpace(string(raw))) > 0 {
		var v map[string]any
		if json.Unmarshal(raw, &v) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid body"})
			return
		}
		if h, ok := v["host"].(string); ok {
			host = cleanHost(h)
		}
	}
	s.handleDeviceCode(w, r, host)
}

// handleDeviceCode issues a grant, subject to the limits in device_limits.go.
func (s *Server) handleDeviceCode(w http.ResponseWriter, r *http.Request, host string) {
	deviceCode, err := generateDeviceCode()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
	}
	userCode, err := s.grants.create(deviceCode, deviceClientIP(r), host)
	if errors.Is(err, errDeviceRateLimited) {
		writeJSON(w, 429, map[string]string{"error": "rate_limited"})
		return
	}
	if errors.Is(err, errDeviceBusy) {
		writeJSON(w, 503, map[string]string{"error": "busy"})
		return
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "internal error"})
		return
	}
	site := s.deviceSite()
	writeJSON(w, 200, map[string]any{
		"device_code":               deviceCode,
		"user_code":                 userCode,
		"verification_uri":          site + "/device",
		"verification_uri_complete": site + "/device?user_code=" + userCode,
		"expires_in":                int(deviceGrantTTL / time.Second),
		"interval":                  int(deviceBaseInterval / time.Second),
	})
}

type deviceAuthorizeFields struct {
	RedirectURI string
	State       string
	UserCode    string
	Action      string
	Tenant      string
	Scope       string
	Lifetime    string
	Name        string
	ExpiresAt   string // refused: a token's expiry is chosen by lifetime, never by date
}

func readDeviceAuthorizeFields(r *http.Request) (deviceAuthorizeFields, error) {
	mt, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
	mt = strings.TrimSpace(mt)
	if strings.EqualFold(mt, "application/x-www-form-urlencoded") {
		if err := r.ParseForm(); err != nil {
			return deviceAuthorizeFields{}, err
		}
		return deviceAuthorizeFields{
			RedirectURI: r.FormValue("redirect_uri"),
			State:       r.FormValue("state"),
			UserCode:    r.FormValue("user_code"),
			Action:      r.FormValue("action"),
			Tenant:      r.FormValue("tenant"),
			Scope:       r.FormValue("scope"),
			Lifetime:    r.FormValue("lifetime"),
			Name:        r.FormValue("name"),
			ExpiresAt:   r.FormValue("expires_at"),
		}, nil
	}
	var body struct {
		RedirectURI string `json:"redirect_uri"`
		State       string `json:"state"`
		UserCode    string `json:"user_code"`
		Action      string `json:"action"`
		Tenant      string `json:"tenant"`
		Scope       string `json:"scope"`
		Lifetime    string `json:"lifetime"`
		Name        string `json:"name"`
		ExpiresAt   string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return deviceAuthorizeFields{}, err
	}
	return deviceAuthorizeFields{
		RedirectURI: body.RedirectURI, State: body.State, UserCode: body.UserCode, Action: body.Action,
		Tenant: body.Tenant, Scope: body.Scope, Lifetime: body.Lifetime, Name: body.Name, ExpiresAt: body.ExpiresAt,
	}, nil
}

func (s *Server) handleDeviceAuthorize(w http.ResponseWriter, r *http.Request, sess *Session) {
	body, err := readDeviceAuthorizeFields(r)
	if err != nil || body.UserCode == "" {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	if body.RedirectURI != "" || body.State != "" {
		writeJSON(w, 400, map[string]string{"error": "redirect_uri and state are not accepted"})
		return
	}
	if body.ExpiresAt != "" {
		writeJSON(w, 400, map[string]string{"error": "expires_at is not accepted; send lifetime"})
		return
	}
	if body.Action != "" && body.Action != "deny" {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	deny := body.Action == "deny"
	var exp time.Time
	var name string
	if !deny {
		if body.Tenant == "" || body.Scope == "" {
			writeJSON(w, 400, map[string]string{"error": "invalid body"})
			return
		}
		var ok bool
		if exp, ok = tokenExpiry(body.Lifetime, s.grants.now()); !ok {
			writeJSON(w, 400, map[string]string{"error": "invalid lifetime"})
			return
		}
		name = strings.TrimSpace(body.Name)
		if name != "" && !validTokenName(name) {
			writeJSON(w, 400, map[string]string{"error": "invalid token name"})
			return
		}
	}
	var verr error
	found, blocked, _ := s.grants.decide(sess.ID, body.UserCode, func(gr *deviceGrant) error {
		if deny {
			gr.status = grantDenied
			return nil
		}
		if verr = s.registry.ValidateGrant(body.Tenant, body.Scope, exp, sess.GitHubID, s.grants.now()); verr != nil {
			return verr
		}
		if name == "" {
			name = gr.host
		}
		if name == "" {
			name = defaultTokenName
		}
		gr.status, gr.tenant, gr.scope, gr.name, gr.expiresAt, gr.githubID = grantApproved, body.Tenant, body.Scope, name, exp.UTC(), sess.GitHubID
		return nil
	})
	if blocked {
		writeJSON(w, 429, map[string]string{"error": "rate_limited"})
		return
	}
	if !found {
		writeJSON(w, 404, map[string]string{"error": "unknown_code"})
		return
	}
	if verr != nil {
		if verr.Error() == "forbidden tenant" {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		writeJSON(w, 400, map[string]string{"error": verr.Error()})
		return
	}
	if deny {
		writeJSON(w, 200, map[string]bool{"denied": true})
		return
	}
	writeJSON(w, 200, map[string]bool{"approved": true})
}

func (s *Server) handleDeviceTokenRoute(w http.ResponseWriter, r *http.Request) {
	if !deviceMethodPost(w, r) {
		return
	}
	var body struct {
		DeviceCode string `json:"device_code"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil || body.DeviceCode == "" {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	res, gr := s.grants.poll(body.DeviceCode)
	switch res {
	case pollUnknown:
		writeJSON(w, 400, map[string]string{"error": "expired_token"})
	case pollSlowDown:
		writeJSON(w, 400, map[string]string{"error": "slow_down"})
	case pollPending:
		writeJSON(w, 400, map[string]string{"error": "authorization_pending"})
	case pollDenied:
		writeJSON(w, 400, map[string]string{"error": "access_denied"})
	case pollApproved:
		s.redeemDeviceGrant(w, gr)
	}
}

// redeemDeviceGrant mints the token for an approved grant that poll has already dropped, so a
// concurrent second poll sees expired_token. A persist failure therefore loses the grant and the
// token; the user runs login again.
func (s *Server) redeemDeviceGrant(w http.ResponseWriter, gr deviceGrant) {
	created, err := s.registry.CreateToken(gr.tenant, gr.scope, gr.name, gr.expiresAt, gr.githubID, s.grants.now())
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "access_denied"})
		return
	}
	if err := s.registry.Persist(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "persist failed"})
		return
	}
	writeJSON(w, 200, map[string]string{
		"token":      created.Plaintext,
		"name":       created.Record.Name,
		"endpoint":   s.publicOrigin(),
		"tenant":     created.Record.Tenant,
		"scope":      created.Record.Scope,
		"expires_at": created.Record.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleDeviceAuthorizeRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	if rejectBearer(w, r) {
		return
	}
	s.originGuardJSONOrForm(s.sessionOnly(s.handleDeviceAuthorize))(w, r)
}

// handleDeviceGrant tells the signed-in user which host asked for a code, so the approval page can
// show it and prefill the token name. It counts an unknown code against the same per-session limit
// as authorize, and changes nothing.
func (s *Server) handleDeviceGrant(w http.ResponseWriter, r *http.Request, sess *Session) {
	code := r.URL.Query().Get("user_code")
	if code == "" {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	var host string
	found, blocked, _ := s.grants.decide(sess.ID, code, func(gr *deviceGrant) error {
		host = gr.host
		return nil
	})
	if blocked {
		writeJSON(w, 429, map[string]string{"error": "rate_limited"})
		return
	}
	if !found {
		writeJSON(w, 404, map[string]string{"error": "unknown_code"})
		return
	}
	writeJSON(w, 200, map[string]string{"host": host})
}
