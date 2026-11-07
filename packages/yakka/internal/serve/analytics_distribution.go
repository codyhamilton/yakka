package serve

import (
	"net/http"
	"strconv"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

var distributionMeasures = map[string]bool{
	"cost_usd": true, "tokens_in": true, "tokens_out": true,
	"tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true,
}

func (s *Server) analyticsDistribution(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	measure := q.Get("measure")
	if measure == "" {
		errJSON(w, 400, "measure required")
		return
	}
	if !distributionMeasures[measure] {
		errJSON(w, 400, "unknown measure "+measure)
		return
	}
	grain := q.Get("grain")
	if grain == "" {
		grain = "call"
	}
	if grain != "call" && grain != "conversation" {
		errJSON(w, 400, "unknown grain "+grain)
		return
	}
	dim := q.Get("dim")
	if dim != "" && dim != "model" {
		errJSON(w, 400, "unsupported dimension "+dim+" for "+measure)
		return
	}
	top := 20
	if v := q.Get("top"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			errJSON(w, 400, "top must be an integer")
			return
		}
		if n > 100 {
			errJSON(w, 400, "top must be at most 100")
			return
		}
		if n > 0 {
			top = n
		}
	}
	f, ok := parseFilter(w, r, filterOpts{})
	if !ok {
		return
	}
	res, err := ts.t.Distribution(r.Context(), f, store.DistributionParams{
		Measure: measure, Grain: grain, Dim: dim, Top: top,
	})
	if err != nil {
		readFailed(w)
		return
	}
	out := map[string]any{"measure": measure, "grain": grain, "rows": distRowsJSON(res.Rows)}
	if dim != "" {
		out["dim"] = dim
	}
	if res.Truncated {
		out["truncated"] = true
	}
	if len(res.IgnoredFilters) > 0 {
		out["ignored_filters"] = res.IgnoredFilters
	}
	addAnalyticsPartial(out, ts)
	writeJSON(w, 200, out)
}

func distRowsJSON(rows []store.DistributionRow) []map[string]any {
	out := make([]map[string]any, len(rows))
	for i, row := range rows {
		bins := make([]map[string]any, len(row.Bins))
		for j, b := range row.Bins {
			m := map[string]any{"lo": b.Lo, "n": b.N}
			if b.Hi != nil {
				m["hi"] = *b.Hi
			}
			bins[j] = m
		}
		out[i] = map[string]any{
			"k": row.K, "n": row.N, "unpriced": row.Unpriced,
			"min": row.Min, "p25": row.P25, "median": row.Median,
			"p75": row.P75, "p95": row.P95, "max": row.Max, "bins": bins,
		}
	}
	return out
}
