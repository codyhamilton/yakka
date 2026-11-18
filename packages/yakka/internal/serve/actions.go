package serve

import (
	"net/http"
	"strconv"
)

func (s *Server) actions(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	limit := 100
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 500 {
			writeJSON(w, 400, map[string]string{"error": "limit must be between 1 and 500"})
			return
		}
		limit = n
	}
	var maxConfidence *float64
	if raw := q.Get("max_confidence"); raw != "" {
		n, err := strconv.ParseFloat(raw, 64)
		if err != nil || n < 0 || n > 1 {
			writeJSON(w, 400, map[string]string{"error": "max_confidence must be between 0 and 1"})
			return
		}
		maxConfidence = &n
	}
	rows, pending, err := ts.t.ActionRows(r.Context(), q.Get("conversation_id"), q.Get("plan"), q.Get("kind"), q.Get("status"), q.Get("source"), maxConfidence, limit)
	if err != nil {
		readFailed(w)
		return
	}
	resp := map[string]any{"actions": rows}
	if q.Has("conversation_id") {
		resp["pending"] = pending
	}
	writeJSON(w, 200, resp)
}
