package serve

import (
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// scoreSeriesBuckets is the route's own resolution set. It takes precedence over
// the global auto/year flags published at /schema.resolutions.
var scoreSeriesBuckets = []string{"day", "week", "month"}

// scoreSeriesMaxCells matches /schema.budgets.max_cells and is never raised.
const scoreSeriesMaxCells = 20000

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
		errCodeJSON(w, 400, "unsupported_resolution", "bucket must be day, week, or month",
			map[string]any{"supported_buckets": scoreSeriesBuckets})
		return
	}
	budget, ok := scoreSeriesCellBudget(w, q)
	if !ok {
		return
	}
	f, ok := s.parseFilter(w, r, ts, filterOpts{weeks: bucket == "week"})
	if !ok {
		return
	}
	if q.Has("dim") || q.Has("scorer") || q.Has("check") || q.Has("limit") || q.Has("offset") {
		s.analyticsScoreSeriesByLens(w, r, ts, f, kind, bucket, budget)
		return
	}
	checks, err := ts.t.ScoreSeries(r.Context(), f, kind, bucket)
	if err != nil {
		readFailed(w)
		return
	}
	outChecks := []map[string]any{}
	pct := 0
	labels := []string{}
	for _, c := range checks {
		pts := make([]map[string]any, len(c.Points))
		for i, p := range c.Points {
			pts[i] = map[string]any{
				"t": p.T, "n": p.N,
				"p25": p.P25, "median": p.Median, "p75": p.P75,
			}
			labels = append(labels, p.T)
		}
		pct += len(pts)
		outChecks = append(outChecks, map[string]any{"name": c.Name, "points": pts})
	}
	if scoreSeriesCellRefusal(w, f, bucket, budget, pct, len(outChecks), labels) {
		return
	}
	resp := map[string]any{"kind": kind, "bucket": bucket, "checks": outChecks}
	if f.CohortSQL != "" {
		pop, err := contentPopulation(r.Context(), r, ts, f, kind)
		if err != nil {
			readFailed(w)
			return
		}
		resp["population"] = pop
	}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}

func (s *Server) analyticsScoreSeriesByLens(w http.ResponseWriter, r *http.Request, ts *tenantState, f store.AnalyticsFilter, kind, bucket string, budget int) {
	q := r.URL.Query()
	dim := q.Get("dim")
	allowed := map[string]bool{"harness": true, "session_model": true, "repo_id": true, "plan": true, "scorer": true, "screen_verdict": true}
	if dim != "" && !allowed[dim] {
		errJSON(w, 400, "unsupported dimension "+dim+" for score-series")
		return
	}
	checks := map[string]bool{}
	names, err := s.retainedChecks(r.Context(), ts.t, kind)
	if err != nil {
		readFailed(w)
		return
	}
	for _, name := range names {
		checks[name] = true
	}
	check := q.Get("check")
	if check != "" && !checks[check] {
		errJSON(w, 400, "unknown check "+check)
		return
	}
	limit := 100
	if raw := q.Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 {
			errJSON(w, 400, "limit must be a positive integer")
			return
		}
		limit = min(n, 500)
	}
	offset := 0
	if raw := q.Get("offset"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 0 {
			errJSON(w, 400, "offset must be a non-negative integer")
			return
		}
		offset = n
	}
	f.Harnesses = nil
	f.Models = nil
	rows, err := ts.t.ScoreSeriesObservations(r.Context(), f, kind, bucket)
	if err != nil {
		readFailed(w)
		return
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, row := range rows {
		if !seen[row.ConversationID] {
			seen[row.ConversationID] = true
			ids = append(ids, row.ConversationID)
		}
	}
	prov, err := scoreSessionProvenance(r.Context(), ts.t, ids)
	if err != nil {
		readFailed(w)
		return
	}
	type group struct {
		key    string
		values []float64
	}
	by := map[string]map[string]map[string][]float64{} // bucket -> check -> group -> observations
	for _, row := range rows {
		if check != "" && row.Check != check || q.Get("scorer") != "" && row.Scorer != q.Get("scorer") {
			continue
		}
		if len(q["harness"]) > 0 && !containsValue(q["harness"], prov[row.ConversationID].Harness) {
			continue
		}
		if len(q["model"]) > 0 && !containsValue(q["model"], prov[row.ConversationID].Model) {
			continue
		}
		key := "all"
		switch dim {
		case "harness":
			key = prov[row.ConversationID].Harness
		case "session_model":
			key = prov[row.ConversationID].Model
		case "repo_id":
			key = row.RepoID
		case "plan":
			key = planFromArtifactPath(row.Path)
		case "scorer":
			key = row.Scorer
		case "screen_verdict":
			scr, e := ts.t.ArtifactScreen(r.Context(), row.Hash)
			if e != nil {
				readFailed(w)
				return
			}
			key = "unknown"
			if scr != nil {
				key = scr.Verdict
			}
		}
		if by[row.Bucket] == nil {
			by[row.Bucket] = map[string]map[string][]float64{}
		}
		if by[row.Bucket][row.Check] == nil {
			by[row.Bucket][row.Check] = map[string][]float64{}
		}
		by[row.Bucket][row.Check][key] = append(by[row.Bucket][row.Check][key], row.Score)
	}
	checkNames := []string{}
	for name := range checks {
		if check == "" || check == name {
			checkNames = append(checkNames, name)
		}
	}
	sort.Strings(checkNames)
	checkOut := []map[string]any{}
	for _, name := range checkNames {
		buckets := []string{}
		for b, items := range by {
			if len(items[name]) > 0 {
				buckets = append(buckets, b)
			}
		}
		sort.Strings(buckets)
		points := []map[string]any{}
		for _, b := range buckets {
			groups := []group{}
			n := 0
			for key, values := range by[b][name] {
				groups = append(groups, group{key, values})
				n += len(values)
			}
			sort.Slice(groups, func(i, j int) bool { return groups[i].key < groups[j].key })
			start := min(offset, len(groups))
			end := min(start+limit, len(groups))
			page := []map[string]any{}
			for _, g := range groups[start:end] {
				sort.Float64s(g.values)
				page = append(page, map[string]any{"key": g.key, "n": len(g.values), "p25": round3(percentile(g.values, .25)), "median": round3(percentile(g.values, .5)), "p75": round3(percentile(g.values, .75))})
			}
			omitted := 0
			for _, g := range groups[:start] {
				omitted += len(g.values)
			}
			for _, g := range groups[end:] {
				omitted += len(g.values)
			}
			p := map[string]any{"t": b, "n": n, "groups": page, "omitted_groups": len(groups) - (end - start), "omitted_n": omitted}
			if dim == "" {
				delete(p, "groups")
				delete(p, "omitted_groups")
				delete(p, "omitted_n")
			}
			points = append(points, p)
		}
		checkOut = append(checkOut, map[string]any{"name": name, "points": points})
	}
	cellCount, groups := 0, 0
	labels := []string{}
	for _, c := range checkOut {
		for _, p := range c["points"].([]map[string]any) {
			labels = append(labels, p["t"].(string))
			if dim == "" {
				cellCount++
				continue
			}
			n := len(p["groups"].([]map[string]any))
			cellCount += n
			groups = max(groups, n)
		}
	}
	if dim == "" {
		groups = len(checkOut)
	}
	if scoreSeriesCellRefusal(w, f, bucket, budget, cellCount, groups, labels) {
		return
	}
	resp := map[string]any{"kind": kind, "bucket": bucket, "checks": checkOut}
	if dim != "" {
		resp["dim"] = dim
		resp["offset"] = offset
		resp["limit"] = limit
	}
	if f.CohortSQL != "" {
		pop, err := contentPopulation(r.Context(), r, ts, f, kind)
		if err != nil {
			readFailed(w)
			return
		}
		resp["population"] = pop
	}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}

// scoreSeriesCellBudget reads the explicit output cell budget. The default is
// /schema.budgets.max_cells and an explicit value may only lower it.
func scoreSeriesCellBudget(w http.ResponseWriter, q url.Values) (int, bool) {
	budget := scoreSeriesMaxCells
	if v := q.Get("max_cells"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			errJSON(w, 400, "max_cells must be a positive integer")
			return 0, false
		}
		budget = min(budget, n)
	}
	return budget, true
}

// scoreSeriesCellRefusal enforces the cell budget as returned buckets × returned
// check/series groups. It never clips the series or buckets; a breach names the
// next supported coarser bucket that fits, or an explicit action when none does.
func scoreSeriesCellRefusal(w http.ResponseWriter, f store.AnalyticsFilter, bucket string, budget, cells, groups int, labels []string) bool {
	if cells <= budget || groups <= 0 {
		return false
	}
	extra := map[string]any{"max_cells": budget}
	if next := scoreSeriesFittingBucket(f, bucket, budget, groups, labels); next != "" {
		extra["suggested_bucket"] = next
	} else {
		extra["suggested_action"] = "reduce_splits_checks_or_choose_window"
	}
	errCodeJSON(w, 400, "too_many_cells", "score series exceeds the cell budget", extra)
	return true
}

// scoreSeriesFittingBucket returns the next supported coarser bucket whose
// returned span fits the budget, or "" when none does.
func scoreSeriesFittingBucket(f store.AnalyticsFilter, bucket string, budget, groups int, labels []string) string {
	start := -1
	for i, b := range scoreSeriesBuckets {
		if b == bucket {
			start = i
			break
		}
	}
	from, to, ok := scoreSeriesLabelSpan(labels)
	if start < 0 || !ok {
		return ""
	}
	for _, b := range scoreSeriesBuckets[start+1:] {
		if bucketSpan(from, to, b, f.TZ)*groups <= budget {
			return b
		}
	}
	return ""
}

func scoreSeriesLabelSpan(labels []string) (time.Time, time.Time, bool) {
	var lo, hi time.Time
	for _, label := range labels {
		ts, err := time.Parse(time.RFC3339, label)
		if err != nil {
			continue
		}
		if lo.IsZero() || ts.Before(lo) {
			lo = ts
		}
		if hi.IsZero() || ts.After(hi) {
			hi = ts
		}
	}
	if lo.IsZero() {
		return time.Time{}, time.Time{}, false
	}
	return lo, hi.Add(time.Second), true
}
