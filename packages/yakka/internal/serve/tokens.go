package serve

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode"
)

func (s *Server) handleCreateTenant(w http.ResponseWriter, r *http.Request, sess *Session) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if !validTenantName(name) {
		writeJSON(w, 400, map[string]string{"error": "invalid tenant name"})
		return
	}
	id, ok, err := s.registry.CreateTenant(name, sess.GitHubID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "create failed"})
		return
	}
	if !ok {
		writeJSON(w, 409, map[string]string{"error": "you already have a tenant with that name"})
		return
	}
	if err := s.registry.Persist(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "persist failed"})
		return
	}
	writeJSON(w, 201, TenantInfo{ID: id, Name: name})
}

// validTenantName accepts a display name: 1 to 64 characters, no control characters.
func validTenantName(name string) bool {
	if name == "" || len([]rune(name)) > 64 {
		return false
	}
	for _, c := range name {
		if unicode.IsControl(c) {
			return false
		}
	}
	return true
}

func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request, sess *Session) {
	var body struct {
		Tenant    string `json:"tenant"`
		Scope     string `json:"scope"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	if body.Tenant == "" || body.Scope == "" || body.ExpiresAt == "" {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	exp, err := time.Parse(time.RFC3339, body.ExpiresAt)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid expires_at"})
		return
	}
	now := time.Now()
	created, err := s.registry.CreateToken(body.Tenant, body.Scope, exp, sess.GitHubID, now)
	if err != nil {
		if err.Error() == "forbidden tenant" {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if err := s.registry.Persist(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "persist failed"})
		return
	}
	rec := created.Record
	writeJSON(w, 201, map[string]any{
		"id":         rec.ID,
		"token":      created.Plaintext,
		"tenant":     rec.Tenant,
		"scope":      rec.Scope,
		"expires_at": rec.ExpiresAt.Format(time.RFC3339),
	})
}

func (s *Server) tokenListItem(rec TokenHashRecord) map[string]any {
	return map[string]any{
		"id":          rec.ID,
		"tenant":      rec.Tenant,
		"tenant_name": s.registry.TenantName(rec.Tenant),
		"scope":       rec.Scope,
		"expires_at":  rec.ExpiresAt.Format(time.RFC3339),
		"revoked":     rec.Revoked,
		"created_at":  rec.CreatedAt.Format(time.RFC3339),
	}
}

func (s *Server) handleListTokens(w http.ResponseWriter, r *http.Request, sess *Session) {
	recs := s.registry.ListTokensForOwner(sess.GitHubID)
	out := make([]map[string]any, len(recs))
	for i, rec := range recs {
		out[i] = s.tokenListItem(rec)
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleAdminListTokens(w http.ResponseWriter, r *http.Request, sess *Session) {
	if !isAdmin(SessionRecord{VerifiedEmails: sess.VerifiedEmails}) {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	recs := s.registry.ListAllTokens()
	out := make([]map[string]any, len(recs))
	for i, rec := range recs {
		item := s.tokenListItem(rec)
		item["github_id"] = rec.GitHubID
		out[i] = item
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleRevokeToken(w http.ResponseWriter, r *http.Request, sess *Session, tokenID string) {
	rec, ok := s.registry.TokenByID(tokenID)
	if !ok {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	admin := isAdmin(SessionRecord{VerifiedEmails: sess.VerifiedEmails})
	if !admin && !s.registry.ownsTenant(sess.GitHubID, rec.Tenant) {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	found, already := s.registry.RevokeToken(tokenID)
	if !found {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	if !already {
		if err := s.registry.Persist(); err != nil {
			writeJSON(w, 500, map[string]string{"error": "persist failed"})
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func rejectBearer(w http.ResponseWriter, r *http.Request) bool {
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return true
	}
	return false
}

func (s *Server) handleTenantsRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	if rejectBearer(w, r) {
		return
	}
	s.originGuard(s.sessionOnly(s.handleCreateTenant))(w, r)
}

func (s *Server) handleTokensRoute(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		if rejectBearer(w, r) {
			return
		}
		s.originGuard(s.sessionOnly(s.handleCreateToken))(w, r)
	case http.MethodGet:
		s.sessionOnly(s.handleListTokens)(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleTokensSubpath(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/v1/tokens/")
	if !strings.HasSuffix(rest, "/revoke") {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	id := strings.TrimSuffix(rest, "/revoke")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	if rejectBearer(w, r) {
		return
	}
	s.originGuard(s.sessionOnly(func(w http.ResponseWriter, r *http.Request, sess *Session) {
		s.handleRevokeToken(w, r, sess, id)
	}))(w, r)
}
