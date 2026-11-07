package serve

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
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
	writeJSON(w, 200, map[string]any{
		"measures": measures, "buckets": store.Buckets,
		"resolutions": map[string]any{"auto": true, "year": true, "multi_year_steps": []int{2, 5, 10, 20, 50, 100, 200, 500, 1000}},
		"budgets": map[string]any{"max_cells": 20000, "deadline_s": analyticsDeadline.Seconds(), "top_max": maxLimit,
			"page_max": maxLimit, "explore_page_max": exploreCap, "heavy_read_concurrency": analyticsHeavyConcurrency,
			"time_range": map[string]string{"min": minAnalyticsTime.Format(time.RFC3339Nano), "max": maxAnalyticsTime.Format(time.RFC3339Nano)}},
	})
}

var queryBuckets = func() map[string]bool {
	m := map[string]bool{}
	for _, b := range store.Buckets {
		m[b] = true
	}
	return m
}()

var privateYearBucket = regexp.MustCompile(`^year:(2|5|10|20|50|100|200|500|1000)$`)

func knownMeasure(name string) bool {
	for _, m := range store.Measures() {
		if m.Name == name {
			return true
		}
	}
	return false
}

// analyticsQuery answers one measure × 0..2 dims × bucket × top-N question.
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
	if len(dims) > 2 {
		errJSON(w, 400, "at most two dim")
		return
	}
	bucket := q.Get("bucket")
	requestedBucket := bucket
	if bucket == "" {
		bucket = "none"
		requestedBucket = "none"
	}
	if !queryBuckets[bucket] && bucket != "year" && !privateYearBucket.MatchString(bucket) {
		if bucket != "auto" {
			errJSON(w, 400, "unknown bucket "+bucket)
			return
		}
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
	cellBudget := 20000
	if v := q.Get("max_cells"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			errJSON(w, 400, "max_cells must be a positive integer")
			return
		}
		cellBudget = min(n, cellBudget)
	}
	f, ok := parseFilter(w, r, filterOpts{query: true})
	if !ok {
		return
	}
	auto := bucket == "auto"
	if auto {
		bucket = resolveAutoBucket(f.From, f.To, f.TZ, cellBudget)
	}
	var res store.QueryResult
	var err error
	for {
		res, err = ts.t.Query(r.Context(), f, store.QueryParams{Measure: measure, Dims: dims, Bucket: bucket, Top: top})
		if err != nil || !auto || (!res.Truncated && len(res.Rows) <= cellBudget) || distinctSeries(res.Rows) > cellBudget {
			break
		}
		next, _ := nextBucket(bucket)
		if next == "none" {
			break
		}
		bucket = next
	}
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
	if res.Truncated || len(res.Rows) > cellBudget {
		next, step := nextBucket(bucket)
		if bucket == "none" || distinctSeries(res.Rows) > cellBudget {
			errCodeJSON(w, 400, "too_many_series", "query exceeds the series budget", map[string]any{"max_cells": cellBudget, "suggested_top": max(1, top/2)})
		} else {
			errCodeJSON(w, 400, "too_many_cells", "query exceeds the cell budget", map[string]any{"max_cells": cellBudget, "suggested_bucket": next, "suggested_bucket_step": step})
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
	step := bucketStep(bucket)
	out := map[string]any{"measure": res.Measure, "bucket": res.Bucket, "requested_bucket": requestedBucket,
		"bucket_step": step, "coarsened": requestedBucket == "auto" && res.Bucket != "hour",
		"cells": len(rows), "max_cells": cellBudget, "dims": nz(res.Dims), "rows": rows,
		"window": map[string]any{"requested": map[string]string{"from": f.From.Format(time.RFC3339Nano), "to": f.To.Format(time.RFC3339Nano)},
			"effective": map[string]string{"from": f.From.Format(time.RFC3339Nano), "to": f.To.Format(time.RFC3339Nano)}, "clipped": false}}
	if len(res.Ignored) > 0 {
		out["ignored_filters"] = res.Ignored
	}
	addAnalyticsPartial(out, ts)
	if res.Truncated {
		out["truncated"] = true
	}
	writeJSON(w, 200, out)
}

func distinctSeries(rows []store.QueryRow) int {
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		key, _ := json.Marshal(row.K)
		seen[string(key)] = struct{}{}
	}
	return len(seen)
}

func resolveAutoBucket(from, to time.Time, loc *time.Location, budget int) string {
	for _, bucket := range []string{"hour", "day", "week", "month"} {
		if bucketSpan(from, to, bucket, loc) <= budget {
			return bucket
		}
	}
	if bucketSpan(from, to, "year", loc) <= budget {
		return "year"
	}
	for _, step := range []int{2, 5, 10, 20, 50, 100, 200, 500, 1000} {
		bucket := fmt.Sprintf("year:%d", step)
		if bucketSpan(from, to, bucket, loc) <= budget {
			return bucket
		}
	}
	return "year:1000"
}

func nextBucket(bucket string) (string, int) {
	switch bucket {
	case "hour":
		return "day", 1
	case "day":
		return "week", 1
	case "week":
		return "month", 1
	case "month":
		return "year", 1
	case "year":
		return "year:2", 2
	default:
		if n := bucketStep(bucket); n >= 2 && n < 1000 {
			for _, step := range []int{2, 5, 10, 20, 50, 100, 200, 500, 1000} {
				if step > n {
					return fmt.Sprintf("year:%d", step), step
				}
			}
		}
		return "none", 1
	}
}

func bucketStep(bucket string) int {
	if strings.HasPrefix(bucket, "year:") {
		n, _ := strconv.Atoi(strings.TrimPrefix(bucket, "year:"))
		return n
	}
	return 1
}

// bucketSpan counts calendar buckets using civil and Unix arithmetic so multi-century
// intervals do not overflow time.Duration.
// Bucket boundaries follow the filter's location so the count matches the t the store emits.
func bucketSpan(from, to time.Time, bucket string, loc *time.Location) int {
	if loc == nil {
		loc = time.UTC
	}
	a, b := from.In(loc), to.In(loc)
	switch bucket {
	case "hour":
		return int((b.Unix()-a.Unix())/3600) + 1
	case "day":
		return civilDayOrdinal(b) - civilDayOrdinal(a) + 1
	case "week":
		return (civilDayOrdinal(mondayOf(b, loc))-civilDayOrdinal(mondayOf(a, loc)))/7 + 1
	case "month":
		am := time.Date(a.Year(), a.Month(), 1, 0, 0, 0, 0, loc)
		bm := time.Date(b.Year(), b.Month(), 1, 0, 0, 0, 0, loc)
		return (bm.Year()-am.Year())*12 + int(bm.Month()-am.Month()) + 1
	case "year":
		return b.Year() - a.Year() + 1
	default:
		if n := bucketStep(bucket); n >= 2 {
			return b.Year()/n - a.Year()/n + 1
		}
	}
	return 0
}

func civilDayOrdinal(t time.Time) int {
	return int(time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).Unix() / 86400)
}

func mondayOf(t time.Time, loc *time.Location) time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}
