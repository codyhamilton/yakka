package serve

import (
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const analyticsContentLimit int64 = 16 * 1024 * 1024

func (s *Server) analyticsContent(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	repo, path, hash := q.Get("repo_id"), q.Get("path"), q.Get("hash")
	if repo == "" || path == "" || len(hash) != 64 {
		errCodeJSON(w, http.StatusBadRequest, "content_identity_required", "repo_id, path and a 64-hex hash are required", nil)
		return
	}
	if strings.ToLower(hash) != hash {
		errCodeJSON(w, http.StatusBadRequest, "content_identity_invalid", "hash must be lowercase hexadecimal", nil)
		return
	}
	if _, err := hex.DecodeString(hash); err != nil {
		errCodeJSON(w, http.StatusBadRequest, "content_identity_invalid", "hash must be lowercase hexadecimal", nil)
		return
	}
	referenced, err := ts.t.ArtifactContentReferenced(r.Context(), repo, path, hash)
	if err != nil {
		readFailed(w)
		return
	}
	if !referenced {
		// A hash known only at another path or in another tenant is deliberately indistinguishable.
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if keys.Kind(path) == "" {
		contentUnavailable(w, "not_stored")
		return
	}
	state, err := ts.t.ArtifactContentStatus(r.Context(), hash)
	if err != nil {
		readFailed(w)
		return
	}
	if state.Pending {
		contentUnavailable(w, "pending")
		return
	}
	if !state.BlobExists {
		if state.ScreenStage || (state.ScreenVerdict != "" && state.ScreenVerdict != "pass" && state.ScreenVerdict != "unscreened") {
			contentUnavailable(w, "removed_by_screen")
		} else {
			contentUnavailable(w, "not_stored")
		}
		return
	}
	body, size, err := ts.t.ReadBlobBounded(r.Context(), hash, analyticsContentLimit)
	if err != nil {
		if err == store.ErrContentTooLarge {
			errCodeJSON(w, http.StatusRequestEntityTooLarge, "content_too_large", "content exceeds the advertised byte budget", map[string]any{"size_bytes": size, "limit_bytes": analyticsContentLimit})
			return
		}
		if r.Context().Err() != nil {
			return
		}
		readFailed(w)
		return
	}
	actual := keys.ContentHash(body)
	if subtle.ConstantTimeCompare([]byte(actual), []byte(hash)) != 1 {
		errCodeJSON(w, http.StatusInternalServerError, "content_integrity", "stored content hash does not match its identity", nil)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Yakka-Screen-Verdict", state.ScreenVerdict)
	if state.ScreenVerdict == "" {
		w.Header().Set("X-Yakka-Screen-Verdict", "unknown")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func contentUnavailable(w http.ResponseWriter, reason string) {
	errCodeJSON(w, http.StatusNotFound, "content_unavailable", "artifact content is unavailable", map[string]any{"reason": reason})
}
