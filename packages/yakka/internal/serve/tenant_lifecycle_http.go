package serve

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// Lifecycle UI gate constants. The dedicated header and its fixed value are
// required in addition to the exact API Origin and the owner browser session.
const (
	tenantLifecycleUIHeader = "X-Yakka-UI"
	tenantLifecycleUIValue  = "tenant-lifecycle"

	tenantLifecycleUIMessage = "Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf. Open the profile UI."
)

// handleTenantLifecycleRoute accepts only POST /v1/tenants/<id>/reset and
// DELETE /v1/tenants/<id>. Every other method gets 405 with Allow and every
// other subpath gets 404.
//
// Only the human owner may reset or delete a tenant. Agents must not perform or
// attempt this on a user's behalf. Open the profile UI.
func (s *Server) handleTenantLifecycleRoute(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/v1/tenants/")
	if rest == "" || rest == r.URL.Path {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if id, isReset := strings.CutSuffix(rest, "/reset"); isReset {
		if id == "" || strings.Contains(id, "/") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		s.handleTenantLifecycle(w, r, id, lifecycleOpReset)
		return
	}
	if strings.Contains(rest, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", http.MethodDelete)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	s.handleTenantLifecycle(w, r, rest, lifecycleOpDelete)
}

// handleTenantLifecycle applies the lifecycle gate in contract order. Each
// refusal is a no-op: nothing opens storage, takes a lifecycle lock, writes a
// journal, spends, changes selection or performs destructive work.
func (s *Server) handleTenantLifecycle(w http.ResponseWriter, r *http.Request, tenant, op string) {
	// Any Authorization header is a key/token credential. It is rejected before
	// cookie fallback, even beside a valid owner cookie and valid UI headers.
	if _, supplied := r.Header["Authorization"]; supplied {
		writeTenantLifecycleUIRefusal(w)
		return
	}
	// These routes are remote-only; local/keyless mode has no owner browser session.
	if !s.cfg.Remote() {
		writeTenantLifecycleUIRefusal(w)
		return
	}
	sess := sessionFromContext(r.Context())
	if sess == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error":   "session_required",
			"message": "sign in at " + s.publicOrigin() + "/login",
		})
		return
	}
	if !s.lifecycleUIRequest(r) {
		writeTenantLifecycleUIRefusal(w)
		return
	}
	if !isJSONRequest(r) {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "json_required"})
		return
	}
	// Existence and ownership come from registry metadata only; never lazy-open
	// storage for an absent or malformed id.
	if !s.registry.tenantRegistered(tenant) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant_not_found"})
		return
	}
	if !s.registry.ownsTenant(sess.GitHubID, tenant) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "tenant_owner_required"})
		return
	}
	if !confirmedTenantID(r, tenant) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant_confirmation_mismatch"})
		return
	}
	if _, ok := s.registry.TenantLifecycle(tenant); !ok {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "legacy_tenant_cleanup_unsupported"})
		return
	}

	var err error
	if op == lifecycleOpReset {
		err = s.ResetTenant(r.Context(), sess.GitHubID, tenant)
	} else {
		err = s.DeleteTenant(r.Context(), sess.GitHubID, tenant)
	}
	writeTenantLifecycleResult(w, err)
}

// lifecycleUIRequest requires the exact configured public API Origin, a present
// Sec-Fetch-Site of same-origin, and the fixed lifecycle UI header. It does not
// reuse the broader Pages/configured CORS allow-list.
func (s *Server) lifecycleUIRequest(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || origin == "null" || origin != s.publicOrigin() {
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	return r.Header.Get(tenantLifecycleUIHeader) == tenantLifecycleUIValue
}

func isJSONRequest(r *http.Request) bool {
	mt, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
	return strings.EqualFold(strings.TrimSpace(mt), "application/json")
}

// confirmedTenantID requires a nonempty string confirm_tenant_id exactly equal
// to the immutable path id. Malformed JSON, missing or wrong-type fields and a
// mismatch all return false.
func confirmedTenantID(r *http.Request, tenant string) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		return false
	}
	var confirmation struct {
		ConfirmTenantID string `json:"confirm_tenant_id"`
	}
	if err := json.Unmarshal(body, &confirmation); err != nil {
		return false
	}
	return confirmation.ConfirmTenantID != "" && confirmation.ConfirmTenantID == tenant
}

func writeTenantLifecycleUIRefusal(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]string{
		"error":   "tenant_lifecycle_ui_only",
		"message": tenantLifecycleUIMessage,
	})
}

// writeTenantLifecycleResult maps engine outcomes. Success is 204 with no body
// only after the engine's residual proof; a timeout or fault never succeeds.
func writeTenantLifecycleResult(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, ErrTenantLifecycleBusy), errors.Is(err, ErrTenantLifecycleConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "tenant_busy"})
	case errors.Is(err, ErrLegacyTenantCleanupUnsupported):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "legacy_tenant_cleanup_unsupported"})
	case errors.Is(err, ErrTenantNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant_not_found"})
	case errors.Is(err, ErrTenantOwnerRequired):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "tenant_owner_required"})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "tenant_cleanup_incomplete"})
	}
}
