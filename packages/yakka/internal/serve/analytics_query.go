package serve

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// The measure × dimension matrix and the bucket units, served verbatim (DESIGN.md plan 12).
func (s *Server) analyticsSchema(w http.ResponseWriter, r *http.Request, _ string, _ *tenantState) {
	measures := []map[string]any{}
	for _, m := range store.Measures() {
		measures = append(measures, map[string]any{"name": m.Name, "unit": m.Unit, "dims": m.Dims})
	}
	writeJSON(w, 200, map[string]any{"measures": measures, "buckets": store.Buckets})
}

var queryBuckets = func() map[string]bool {
	m := map[string]bool{}
	for _, b := range store.Buckets {
		m[b] = true
	}
	return m
}()

func knownMeasure(name string) bool {
	for _, m := range store.Measures() {
		if m.Name == name {
			return true
		}
	}
	return false
}

// analyticsQuery answers one measure × dimensions × bucket × top-N question.
func (s *Server) analyticsQuery(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	measure := q.Get("measure")
	if measure == "" {
		errJSON(w, 400, "measure required")
		return
	}
	if !knownMeasure(measure) {
		errJSON(w, 400, "unknown measure "+measure)
		return
	}
	dims := q["dim"]
	allActionDims := len(dims) > 0
	for _, d := range dims {
		if !store.IsActionDimension(d) {
			allActionDims = false
		}
	}
	if allActionDims && len(dims) > 3 {
		errJSON(w, 400, "at most three action dims")
		return
	}
	if !allActionDims && len(dims) > 2 {
		errJSON(w, 400, "at most two dim")
		return
	}
	bucket := q.Get("bucket")
	if bucket == "" {
		bucket = "none"
	}
	if !queryBuckets[bucket] {
		errJSON(w, 400, "unknown bucket "+bucket)
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
		top = n
	}
	f, ok := parseFilter(w, r, filterOpts{query: true})
	if !ok {
		return
	}
	if bucket != "none" && bucketSpan(f.From, f.To, bucket, f.TZ) > maxBuckets {
		errJSON(w, 400, "range too wide")
		return
	}
	res, err := ts.t.Query(r.Context(), f, store.QueryParams{Measure: measure, Dims: dims, Bucket: bucket, Top: top,
		ActionKinds: q["action_kind"], ActionPlans: q["action_plan"], ActionPhases: q["action_phase"],
		ActionSubjects: q["action_subject"], ActionPRs: q["action_pr"], ActionSources: q["action_source"]})
	if err != nil {
		switch {
		case errors.Is(err, store.ErrUnsupported):
			errJSON(w, 400, strings.TrimSuffix(err.Error(), ": "+store.ErrUnsupported.Error()))
		case err.Error() == "measure not available":
			errJSON(w, 400, "measure not available")
		default:
			readFailed(w)
		}
		return
	}
	rows := make([]map[string]any, 0, len(res.Rows))
	for _, row := range res.Rows {
		m := map[string]any{"k": nz(row.K), "v": row.V}
		if row.T != "" {
			m["t"] = row.T
		}
		rows = append(rows, m)
	}
	out := map[string]any{"measure": res.Measure, "bucket": res.Bucket, "dims": nz(res.Dims), "rows": rows}
	if len(res.Ignored) > 0 {
		out["ignored_filters"] = res.Ignored
	}
	if ts.t.CompactionState() != "complete" {
		out["partial"] = true
	}
	if res.Truncated {
		out["truncated"] = true
	}
	writeJSON(w, 200, out)
}

// bucketSpan counts the buckets a window touches for a unit; the caller caps it at maxBuckets.
// Bucket boundaries follow the filter's location so the count matches the t the store emits.
func bucketSpan(from, to time.Time, bucket string, loc *time.Location) int {
	if loc == nil {
		loc = time.UTC
	}
	a, b := from.In(loc), to.In(loc)
	switch bucket {
	case "hour":
		return int(b.Sub(a).Hours()) + 1
	case "day":
		ad := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, loc)
		bd := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, loc)
		return int(bd.Sub(ad).Hours()/24) + 1
	case "week":
		ad := mondayOf(a, loc)
		bd := mondayOf(b, loc)
		return int(bd.Sub(ad).Hours()/24)/7 + 1
	case "month":
		am := time.Date(a.Year(), a.Month(), 1, 0, 0, 0, 0, loc)
		bm := time.Date(b.Year(), b.Month(), 1, 0, 0, 0, 0, loc)
		return (bm.Year()-am.Year())*12 + int(bm.Month()-am.Month()) + 1
	}
	return 0
}

func mondayOf(t time.Time, loc *time.Location) time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}
