package serve

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// analyticsEntities exposes the Phase 4 session and time entities only. Later grains are absent
// from both this handler and /schema until their complete contracts are implemented.
func (s *Server) analyticsEntities(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	grain := q.Get("grain")
	switch grain {
	case "session":
		s.analyticsSessionEntities(w, r, ts)
	case "time":
		s.analyticsTimeEntities(w, r, ts)
	default:
		errJSON(w, 400, "grain must be session or time")
	}
}

func (s *Server) analyticsSessionEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = "list"
	}
	if mode == "scatter" {
		s.analyticsSessionScatter(w, r, ts)
		return
	}
	if mode == "aggregate" {
		s.analyticsSessionAggregate(w, r, ts)
		return
	}
	if mode != "list" {
		errJSON(w, 400, "unsupported session mode")
		return
	}
	sortSpec := q.Get("sort")
	if sortSpec == "" {
		sortSpec = "last_ts:desc"
	}
	sortParts := strings.Split(sortSpec, ":")
	if len(sortParts) != 2 || (sortParts[1] != "asc" && sortParts[1] != "desc") {
		errJSON(w, 400, "sort must be <measure>:asc|desc")
		return
	}
	sortBy, desc := sortParts[0], sortParts[1] == "desc"
	if !store.SessionSortMeasure(sortBy) {
		errJSON(w, 400, "unsupported session sort "+sortBy)
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	f, ok := parseFilter(w, r, filterOpts{route: "entities:session", cur: cur})
	if !ok {
		return
	}
	if len(r.URL.RawQuery) > 8192 {
		errJSON(w, 400, "session predicate exceeds the 8 KiB URL budget")
		return
	}
	ranges, err := parseSessionRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	f.SessionRanges = ranges
	if cur != nil && (cur.Route != "entities:session" || cur.Filter != canonFilter(q)) {
		errJSON(w, 400, "cursor mismatch")
		return
	}
	count, err := ts.t.ConversationCount(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	var sc *store.ConvCursor
	if cur != nil {
		sc = &store.ConvCursor{TS: cur.TS, ConversationID: firstKey(cur.Key)}
	}
	page, more, err := ts.t.SessionEntitiesPage(r.Context(), f, sortBy, desc, sc, limit)
	if err != nil {
		readFailed(w)
		return
	}
	ids := make([]string, len(page))
	for i := range page {
		ids[i] = page[i].ID
	}
	prov, err := ts.t.SessionProvenanceFor(r.Context(), ids)
	if err != nil {
		readFailed(w)
		return
	}
	rows := make([]map[string]any, 0, len(page))
	for _, row := range page {
		p := prov[row.ID]
		m := make(map[string]any, len(row.Measures))
		for k, v := range row.Measures {
			m[k] = v
		}
		var cost any = row.Measures["cost_usd"]
		lower := row.Measures["unpriced_calls"] > 0
		if row.Measures["model_calls"] > 0 && row.Measures["unpriced_calls"] == row.Measures["model_calls"] {
			cost = nil
		}
		m["cost_usd"] = cost
		l := map[string]any{"harness": p.Harness, "harnesses": p.Harnesses, "harness_mixed": p.HarnessMixed, "session_repo": p.Repo, "repos": p.Repos,
			"repo_attribution": p.RepoAttribution, "session_model": p.Model, "models": p.ModelShares}
		flags := map[string]any{}
		if lower {
			flags["cost_lower_bound"] = true
		}
		rows = append(rows, map[string]any{"id": row.ID, "m": m, "l": l, "flags": flags})
	}
	out := map[string]any{"grain": "session", "rows": rows, "population": map[string]any{"grain": "session", "unit": "conversation_id", "scope_n": count, "cohort_n": count, "eligible_n": count, "returned_n": len(rows), "missing_by_reason": map[string]int{}}, "sort": sortSpec, "partial": ts.t.CompactionState() != "complete"}
	if more && len(page) > 0 {
		last := page[len(page)-1]
		out["next"] = (cursor{Route: "entities:session", Filter: canonFilter(q), From: f.From.UnixNano(), To: f.To.UnixNano(), TS: last.Measures[sortBy], Key: []string{last.ID}}).encode()
	}
	writeJSON(w, 200, out)
}

func (s *Server) analyticsSessionAggregate(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	if len(r.URL.RawQuery) > 8192 {
		errJSON(w, 400, "session predicate exceeds the 8 KiB URL budget")
		return
	}
	if len(q["dim"]) > 0 {
		errJSON(w, 400, "session aggregate dimensions are not supported")
		return
	}
	stat := q.Get("stat")
	if stat == "" {
		stat = "count"
	}
	field := q.Get("field")
	if stat != "count" && stat != "sum" && stat != "percentiles" && stat != "histogram" {
		errJSON(w, 400, "unsupported session aggregate stat "+stat)
		return
	}
	if stat != "count" && !store.SessionSortMeasure(field) {
		errJSON(w, 400, "unsupported session aggregate field "+field)
		return
	}
	if stat == "count" && field != "" {
		errJSON(w, 400, "count does not accept field")
		return
	}
	if stat == "sum" && (field == "first_ts" || field == "last_ts") {
		errJSON(w, 400, "unsupported session sum field "+field)
		return
	}
	f, ok := parseFilter(w, r, filterOpts{query: true})
	if !ok {
		return
	}
	ranges, err := parseSessionRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	f.SessionRanges = ranges
	result, err := ts.t.SessionAggregate(r.Context(), f, stat, field)
	if err != nil {
		readFailed(w)
		return
	}
	pop, err := ts.t.ConversationCount(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	eligible := pop
	if n, ok := result["eligible_n"].(int); ok {
		eligible = n
	}
	lowerBound := false
	if field == "cost_usd" && stat != "count" {
		var lowerBoundN int
		eligible, lowerBoundN, err = ts.t.SessionCostCoverage(r.Context(), f)
		if err != nil {
			readFailed(w)
			return
		}
		lowerBound = lowerBoundN > 0
	}
	result["grain"] = "session"
	missing := map[string]int{}
	if field == "cost_usd" && eligible < pop {
		missing["unpriced_cost"] = pop - eligible
	}
	result["population"] = map[string]any{"grain": "session", "unit": "conversation_id", "scope_n": pop, "cohort_n": pop, "eligible_n": eligible, "returned_n": 1, "missing_by_reason": missing}
	if lowerBound {
		result["cost_lower_bound"] = true
	}
	writeJSON(w, 200, result)
}

func parseSessionRanges(values []string) ([]store.SessionRange, error) {
	out := make([]store.SessionRange, 0, len(values))
	for _, raw := range values {
		measure, bounds, ok := strings.Cut(raw, ":")
		if !ok || !store.SessionSortMeasure(measure) {
			return nil, fmt.Errorf("unsupported session predicate measure %s", measure)
		}
		loText, hiText, ok := strings.Cut(bounds, "..")
		if !ok || (loText == "" && hiText == "") {
			return nil, fmt.Errorf("where must be <measure>:<lo>..<hi>")
		}
		var lo, hi *float64
		parse := func(v string) (*float64, error) {
			n, e := strconv.ParseFloat(v, 64)
			if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				return nil, fmt.Errorf("where bounds must be finite numbers")
			}
			return &n, nil
		}
		var err error
		if loText != "" {
			lo, err = parse(loText)
			if err != nil {
				return nil, err
			}
		}
		if hiText != "" {
			hi, err = parse(hiText)
			if err != nil {
				return nil, err
			}
		}
		if lo != nil && hi != nil && *lo > *hi {
			return nil, fmt.Errorf("where lower bound exceeds upper bound")
		}
		out = append(out, store.SessionRange{Measure: measure, Lo: lo, Hi: hi})
	}
	return out, nil
}

func (s *Server) analyticsSessionScatter(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	fields := append([]string(nil), q["field"]...)
	if len(fields) == 0 {
		fields = append(fields, q["fields"]...)
	}
	var expanded []string
	for _, f := range fields {
		expanded = append(expanded, strings.Split(f, ",")...)
	}
	fields = expanded
	if len(fields) < 2 || len(fields) > 4 {
		errJSON(w, 400, "session scatter requires two to four fields")
		return
	}
	allowed := map[string]bool{"cost_usd": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true}
	seen := map[string]bool{}
	for _, f := range fields {
		if !allowed[f] || seen[f] {
			errJSON(w, 400, "unsupported session scatter field "+f)
			return
		}
		seen[f] = true
	}
	filter, ok := parseFilter(w, r, filterOpts{})
	if !ok {
		return
	}
	if len(r.URL.RawQuery) > 8192 {
		errJSON(w, 400, "session predicate exceeds the 8 KiB URL budget")
		return
	}
	ranges, err := parseSessionRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	filter.SessionRanges = ranges
	population, err := ts.t.ConversationCount(r.Context(), filter)
	if err != nil {
		readFailed(w)
		return
	}
	limit := min(population, 5000)
	page, _, err := ts.t.SessionEntitiesPage(r.Context(), filter, "sample_hash", false, nil, limit)
	if err != nil {
		readFailed(w)
		return
	}
	ids := make([]string, len(page))
	for i := range page {
		ids[i] = page[i].ID
	}
	prov, err := ts.t.SessionProvenanceFor(r.Context(), ids)
	if err != nil {
		readFailed(w)
		return
	}
	points := make([]map[string]any, 0, len(page))
	for _, row := range page {
		m := map[string]any{}
		for _, f := range fields {
			v := any(row.Measures[f])
			if f == "cost_usd" && row.Measures["model_calls"] > 0 && row.Measures["unpriced_calls"] == row.Measures["model_calls"] {
				v = nil
			}
			m[f] = v
		}
		p := prov[row.ID]
		points = append(points, map[string]any{"id": row.ID, "m": m, "l": map[string]any{"session_repo": p.Repo, "session_model": p.Model, "harness": p.Harness}})
	}
	marginals := map[string]any{}
	eligible := map[string]int{}
	missing := map[string]int{}
	callSessions, err := ts.t.SessionCallConversationCount(r.Context(), filter)
	if err != nil {
		readFailed(w)
		return
	}
	noCalls := max(0, population-callSessions)
	for _, f := range fields {
		d, err := ts.t.Distribution(r.Context(), filter, store.DistributionParams{Measure: f, Grain: "conversation", Top: 100})
		if err != nil {
			readFailed(w)
			return
		}
		bins := []store.DistributionBin{}
		for _, g := range d.Rows {
			if g.K == "all" {
				bins = g.Bins
				break
			}
		}
		if len(bins) > 0 && noCalls > 0 {
			bins[0].N += noCalls
		}
		marginals[f] = bins
		total := 0
		for _, b := range bins {
			total += b.N
		}
		if f == "cost_usd" {
			eligible[f] = total
			missing["unpriced_cost"] += max(0, population-total)
		} else {
			eligible[f] = total
		}
	}
	sampled := population > len(points)
	writeJSON(w, 200, map[string]any{"grain": "session", "mode": "scatter", "fields": fields, "rows": points, "sampled": sampled, "sample_rule": "lowest SHA-256 of conversation_id", "population_n": population, "returned_n": len(points), "marginals": marginals, "population": map[string]any{"grain": "session", "unit": "conversation_id", "scope_n": population, "cohort_n": population, "eligible_n": eligible, "returned_n": len(points), "missing_by_reason": missing}, "sample_limit": 5000})
}

func (s *Server) analyticsTimeEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = "aggregate"
	}
	if mode != "aggregate" {
		errJSON(w, 400, "unsupported time mode")
		return
	}
	fields := append([]string(nil), q["field"]...)
	if len(fields) == 0 {
		fields = append(fields, q["fields"]...)
	}
	var expanded []string
	for _, f := range fields {
		expanded = append(expanded, strings.Split(f, ",")...)
	}
	fields = expanded
	if len(fields) < 2 || len(fields) > 4 {
		errJSON(w, 400, "time entities require two to four fields")
		return
	}
	allowed := map[string]bool{}
	for _, m := range store.Measures() {
		allowed[m.Name] = true
	}
	seen := map[string]bool{}
	for _, f := range fields {
		if !allowed[f] || seen[f] {
			errJSON(w, 400, "unknown or repeated time measure "+f)
			return
		}
		seen[f] = true
	}
	stat := q.Get("stat")
	if stat == "" {
		stat = "sum"
	}
	if stat != "sum" {
		errJSON(w, 400, "time entities support stat=sum")
		return
	}
	f, ok := parseFilter(w, r, filterOpts{query: true})
	if !ok {
		return
	}
	bucket := q.Get("bucket")
	cellBudget := 20000
	if v := q.Get("max_cells"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil || n < 1 {
			errJSON(w, 400, "max_cells must be a positive integer")
			return
		}
		cellBudget = min(cellBudget, n)
	}
	if bucket == "" || bucket == "auto" {
		bucket = resolveAutoBucket(f.From, f.To, f.TZ, max(1, cellBudget/len(fields)))
	}
	if bucket == "none" {
		errJSON(w, 400, "time entities require a bucket")
		return
	}
	if bucketSpan(f.From, f.To, bucket, f.TZ)*len(fields) > cellBudget {
		next, step := nextBucket(bucket)
		errCodeJSON(w, 400, "too_many_cells", "time entity exceeds cell budget", map[string]any{"max_cells": cellBudget, "suggested_bucket": next, "suggested_bucket_step": step})
		return
	}
	grid := map[string]map[string]float64{}
	for _, measure := range fields {
		res, err := ts.t.Query(r.Context(), f, store.QueryParams{Measure: measure, Bucket: bucket, Top: 100})
		if err != nil {
			if err == store.ErrUnsupported {
				errJSON(w, 400, "unsupported time measure")
			} else {
				readFailed(w)
			}
			return
		}
		for _, row := range res.Rows {
			if grid[row.T] == nil {
				grid[row.T] = map[string]float64{}
			}
			grid[row.T][measure] = row.V
		}
		bucket = res.Bucket
	}
	keys := make([]string, 0, len(grid))
	for k := range grid {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	rows := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		m := map[string]any{}
		for _, f := range fields {
			if v, ok := grid[k][f]; ok {
				m[f] = v
			} else {
				m[f] = 0
			}
		}
		rows = append(rows, map[string]any{"id": map[string]any{"t": k, "tz": fTZ(f)}, "m": m, "l": map[string]any{}, "flags": map[string]any{}})
	}
	writeJSON(w, 200, map[string]any{"grain": "time", "bucket": bucket, "fields": fields, "rows": rows, "population": map[string]any{"grain": "time", "unit": "bucket", "scope_n": len(rows), "cohort_n": len(rows), "eligible_n": len(rows), "returned_n": len(rows), "missing_by_reason": map[string]int{}}, "window": map[string]any{"requested": map[string]string{"from": f.From.Format(time.RFC3339Nano), "to": f.To.Format(time.RFC3339Nano)}, "effective": map[string]string{"from": f.From.Format(time.RFC3339Nano), "to": f.To.Format(time.RFC3339Nano)}, "clipped": false}})
}

func fTZ(f store.AnalyticsFilter) string {
	if f.TZ == nil {
		return "UTC"
	}
	return f.TZ.String()
}
func firstKey(xs []string) string {
	if len(xs) == 0 {
		return ""
	}
	return xs[0]
}
