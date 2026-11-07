package serve

import (
	"net/http"
)

func (s *Server) analyticsScoreSeries(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	kind := q.Get("kind")
	if kind == "" {
		errJSON(w, 400, "kind required")
		return
	}
	if !validKind(kind) {
		badKind(w)
		return
	}
	bucket := q.Get("bucket")
	if bucket == "" {
		errJSON(w, 400, "bucket required")
		return
	}
	if bucket != "day" && bucket != "week" && bucket != "month" {
		errJSON(w, 400, "bucket must be day, week, or month")
		return
	}
	f, ok := parseFilter(w, r, filterOpts{weeks: bucket == "week"})
	if !ok {
		return
	}
	if bucketSpan(f.From, f.To, bucket, f.TZ) > maxBuckets {
		errJSON(w, 400, "range too wide")
		return
	}
	checks, err := ts.t.ScoreSeries(r.Context(), f, kind, bucket)
	if err != nil {
		readFailed(w)
		return
	}
	outChecks := []map[string]any{}
	for _, c := range checks {
		pts := make([]map[string]any, len(c.Points))
		for i, p := range c.Points {
			pts[i] = map[string]any{
				"t": p.T, "n": p.N,
				"p25": p.P25, "median": p.Median, "p75": p.P75,
			}
		}
		outChecks = append(outChecks, map[string]any{"name": c.Name, "points": pts})
	}
	resp := map[string]any{"kind": kind, "bucket": bucket, "checks": outChecks}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}
