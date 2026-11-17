package serve

import (
	"encoding/base64"
	"net/http"
	"sort"
	"strconv"
)

func (s *Server) analyticsActivity(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	f, ok := s.parseFilter(w, r, ts, filterOpts{})
	if !ok {
		return
	}
	q := r.URL.Query()
	ignored := []string{}
	for _, name := range []string{"norm_event", "event", "tool", "model", "source"} {
		if len(q[name]) > 0 {
			ignored = append(ignored, name)
		}
	}
	sort.Strings(ignored)
	if q.Get("mode") == "probe" {
		raw := q.Get("after")
		var after int64
		if raw != "" {
			b, e := base64.RawURLEncoding.DecodeString(raw)
			if e != nil {
				errCodeJSON(w, 400, "cursor mismatch", "invalid receive watermark", nil)
				return
			}
			after, e = strconv.ParseInt(string(b), 10, 64)
			if e != nil {
				errCodeJSON(w, 400, "cursor mismatch", "invalid receive watermark", nil)
				return
			}
		}
		counts, mark, err := ts.t.ActivityProbe(r.Context(), after, f)
		if err != nil {
			readFailed(w)
			return
		}
		writeJSON(w, 200, map[string]any{"mode": "probe", "counts": counts, "watermark": base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(mark, 10))), "ignored_filters": ignored})
		return
	}
	if q.Get("mode") != "" && q.Get("mode") != "list" {
		errJSON(w, 400, "mode must be list or probe")
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	filter := canonFilter(q) + "|cohort=" + q.Get("cohort")
	var afterTS *float64
	afterType, afterID := "", ""
	if cur != nil {
		if cur.Route != "activity" || cur.Filter != filter || cur.From != f.From.UnixNano() || cur.To != f.To.UnixNano() || len(cur.Key) != 2 {
			errJSON(w, 400, "cursor mismatch")
			return
		}
		afterTS = &cur.TS
		afterType, afterID = cur.Key[0], cur.Key[1]
	}
	rows, more, total, err := ts.t.ActivityPage(r.Context(), f, afterTS, afterType, afterID, limit)
	if err != nil {
		readFailed(w)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, x := range rows {
		out = append(out, map[string]any{"event_time": rfc(x.EventTime), "type": x.Type, "identity": x.Identity, "conversation_id": x.ConversationID, "repo_id": x.RepoID, "path": x.Path, "harness": x.Harness, "kind": x.Kind, "plan": x.Plan, "stage": x.Stage})
	}
	result := map[string]any{"mode": "list", "rows": out, "population": map[string]any{"grain": "activity", "unit": "typed_observation", "scope_n": total, "cohort_n": total, "eligible_n": total, "returned_n": len(out), "missing_by_reason": map[string]int{}}}
	if len(ignored) > 0 {
		result["ignored_filters"] = ignored
	}
	if more && len(rows) > 0 {
		last := rows[len(rows)-1]
		result["next"] = (cursor{Route: "activity", Filter: filter, From: f.From.UnixNano(), To: f.To.UnixNano(), TS: last.EventTime, Key: []string{last.Type, last.Identity}}).encode()
	}
	writeJSON(w, 200, result)
}
