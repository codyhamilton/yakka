package serve

import (
	"net/http"
	"time"
)

// eventCountsQueryKeys is the complete request vocabulary for event-counts. Every other key is
// refused with unsupported_filter rather than silently ignored.
var eventCountsQueryKeys = map[string]bool{
	"tenant": true, "from": true, "to": true, "all": true, "tz": true, "cohort": true, "exclude": true,
	"repo_id": true, "harness": true, "kind": true, "plan": true, "norm_event": true, "event": true,
	"tool": true, "model": true, "source": true, "conversation_id": true,
}

func (s *Server) analyticsEventCounts(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	for key := range r.URL.Query() {
		if !eventCountsQueryKeys[key] {
			errCodeJSON(w, http.StatusBadRequest, "unsupported_filter", "unsupported filter", map[string]any{"reason": key})
			return
		}
	}
	f, ok := s.parseFilter(w, r, ts, filterOpts{route: "event-counts"})
	if !ok {
		return
	}
	counts, err := ts.t.EventCounts(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"matched": map[string]int64{
			"events": counts.Matched.Events, "rejections": counts.Matched.Rejections, "rows": counts.Matched.Rows,
		},
		"tenant_total": map[string]int64{
			"events": counts.TenantTotal.Events, "rejections": counts.TenantTotal.Rejections, "rows": counts.TenantTotal.Rows,
		},
		"checked_at": counts.CheckedAt.UTC().Format(time.RFC3339),
		"unit":       "retained_record",
	})
}
