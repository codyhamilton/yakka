package serve

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// The analytics reads (DESIGN.md plan 10, "Domain: Analytics reads"). Each handler resolves the
// shared filter, calls one store query and shapes the JSON; tenant auth is the same as /v1/artifacts.

const (
	// maxBuckets remains for the benchmark's historical search helper. Request
	// handlers do not use it as a window or resolution cap.
	maxBuckets   = int(^uint(0) >> 1)
	defaultLimit = 100
	maxLimit     = 500
)

var (
	minAnalyticsTime = time.Unix(0, math.MinInt64).UTC()
	maxAnalyticsTime = time.Unix(0, math.MaxInt64).UTC()
)

const analyticsHeavyConcurrency = 4

// The local fixture's slowest route p95 is below 5 ms; 1 s leaves substantial tail room while
// remaining twice the unchanged 500 ms p95 contract. The fixture result is recorded in the report.
var analyticsDeadline = time.Second

type analyticsBuffer struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func newAnalyticsBuffer() *analyticsBuffer     { return &analyticsBuffer{header: make(http.Header)} }
func (b *analyticsBuffer) Header() http.Header { return b.header }
func (b *analyticsBuffer) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}
func (b *analyticsBuffer) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = http.StatusOK
	}
	return b.body.Write(p)
}

func serveBoundedAnalytics(w http.ResponseWriter, r *http.Request, name string, ts *tenantState, h tenantHandler) {
	select {
	case ts.analyticsSlots <- struct{}{}:
		defer func() { <-ts.analyticsSlots }()
	default:
		w.Header().Set("Retry-After", "1")
		errCodeJSON(w, http.StatusServiceUnavailable, "busy", "analytics read concurrency limit reached", map[string]any{"retry": map[string]any{"after_s": 1}})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), analyticsDeadline)
	b := newAnalyticsBuffer()
	h(b, r.WithContext(ctx), name, ts)
	expired := errors.Is(ctx.Err(), context.DeadlineExceeded)
	canceled := r.Context().Err() != nil
	cancel()
	if canceled {
		return
	}
	if expired {
		errCodeJSON(w, http.StatusServiceUnavailable, "query_timeout", "analytics query deadline exceeded", map[string]any{
			"retry": map[string]any{"after_s": 1, "suggested_action": "narrow_window_or_coarsen_bucket"},
		})
		return
	}
	for k, values := range b.header {
		for _, v := range values {
			w.Header().Add(k, v)
		}
	}
	status := b.status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = w.Write(b.body.Bytes())
}

// exploreCap is the most rows /explore returns. A variable so the test can lower it.
var exploreCap = 20000

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func errCodeJSON(w http.ResponseWriter, status int, code, msg string, extra map[string]any) {
	out := map[string]any{"error": msg, "code": code}
	for k, v := range extra {
		out[k] = v
	}
	writeJSON(w, status, out)
}

func readFailed(w http.ResponseWriter) { errJSON(w, 500, "read failed") }

// cursor is the opaque paging token: the route and filter it was issued for, the first page's
// resolved window, and the sort key of the last row returned.
type cursor struct {
	Route              string   `json:"r"`
	Filter             string   `json:"f"`
	From               int64    `json:"from"`
	To                 int64    `json:"to"`
	TS                 float64  `json:"ts"`
	NS                 int64    `json:"ns,omitempty"`
	Key                []string `json:"k"`
	FactWatermark      int64    `json:"fw,omitempty"`
	RejectionWatermark int64    `json:"rw,omitempty"`
}

func (c cursor) encode() string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (*cursor, bool) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, false
	}
	var c cursor
	if json.Unmarshal(b, &c) != nil {
		return nil, false
	}
	return &c, true
}

// canonFilter is the filter parameters as sent, with repeated values sorted.
func canonFilter(q url.Values) string {
	out := url.Values{}
	for _, k := range []string{"from", "to", "repo_id", "harness", "kind", "plan",
		"norm_event", "event", "tool", "model", "source", "conversation_id", "tz", "all",
		"shape", "bucket", "exclude", "sort", "mode", "grain", "field", "fields", "stat"} {
		if v, ok := q[k]; ok {
			c := append([]string(nil), v...)
			sort.Strings(c)
			out[k] = c
		}
	}
	return out.Encode()
}

func utcDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// tooWide reports whether [from, to] spans more than maxBuckets UTC days, or ISO weeks.
func tooWide(from, to time.Time, weeks bool) bool {
	a, b := utcDay(from), utcDay(to)
	if weeks {
		a = a.AddDate(0, 0, -((int(a.Weekday()) + 6) % 7))
		b = b.AddDate(0, 0, -((int(b.Weekday()) + 6) % 7))
		return int(b.Sub(a).Hours()/24)/7+1 > maxBuckets
	}
	return int(b.Sub(a).Hours()/24)+1 > maxBuckets
}

type filterOpts struct {
	weeks      bool    // count the cap in ISO weeks
	scoresKind bool    // exactly one kind required
	query      bool    // /query validates the bucket cap itself, so skip the day/week cap here
	route      string  // set with cur
	cur        *cursor // paged routes: the request's cursor
}

// parseFilter resolves the shared filter, or writes the 400 and returns false. With a cursor it
// must match this route and these filter parameters, and its window replaces from/to.
func parseFilter(w http.ResponseWriter, r *http.Request, o filterOpts) (store.AnalyticsFilter, bool) {
	q := r.URL.Query()
	var f store.AnalyticsFilter
	var from, to time.Time
	var hasFrom, hasTo bool
	var err error
	if v := q.Get("from"); v != "" {
		if from, err = time.Parse(time.RFC3339, v); err != nil {
			errJSON(w, 400, "from and to must be RFC3339")
			return f, false
		}
		hasFrom = true
	}
	if v := q.Get("to"); v != "" {
		if to, err = time.Parse(time.RFC3339, v); err != nil {
			errJSON(w, 400, "from and to must be RFC3339")
			return f, false
		}
		hasTo = true
	}
	var loc *time.Location
	if v := q.Get("tz"); v != "" {
		if loc, err = time.LoadLocation(v); err != nil {
			errJSON(w, 400, "invalid tz")
			return f, false
		}
	}
	if q.Get("all") == "1" {
		from, hasFrom = minAnalyticsTime, true
		if !hasTo {
			to = time.Now().UTC()
		}
	}
	if o.cur != nil {
		if o.cur.Route != o.route || o.cur.Filter != canonFilter(q) {
			errJSON(w, 400, "cursor mismatch")
			return f, false
		}
		from, to = time.Unix(0, o.cur.From).UTC(), time.Unix(0, o.cur.To).UTC()
	} else {
		if !hasTo {
			to = time.Now().UTC()
		}
		if !hasFrom {
			from = to.AddDate(0, 0, -30)
		}
	}
	if from.After(to) {
		errJSON(w, 400, "from is after to")
		return f, false
	}
	if from.Before(minAnalyticsTime) || from.After(maxAnalyticsTime) || to.Before(minAnalyticsTime) || to.After(maxAnalyticsTime) {
		errCodeJSON(w, 400, "time_out_of_range", "time is outside the nanosecond-representable range", map[string]any{
			"min": minAnalyticsTime.Format(time.RFC3339Nano), "max": maxAnalyticsTime.Format(time.RFC3339Nano),
		})
		return f, false
	}
	excludes := map[string][]string{}
	allowedExclude := map[string]bool{"repo_id": true, "harness": true, "kind": true, "plan": true, "norm_event": true, "event": true, "tool": true, "model": true, "source": true, "conversation_id": true, "stage": true}
	for _, item := range q["exclude"] {
		dim, value, ok := strings.Cut(item, ":")
		if !ok || !allowedExclude[dim] || value == "" {
			errJSON(w, 400, "exclude must be <dimension>:<value>")
			return f, false
		}
		excludes[dim] = append(excludes[dim], value)
	}
	f = store.AnalyticsFilter{From: from.UTC(), To: to.UTC(), Repos: q["repo_id"], Harnesses: q["harness"], Kinds: q["kind"], Plans: q["plan"],
		NormEvents: q["norm_event"], Events: q["event"], Tools: q["tool"], Models: q["model"], Sources: q["source"], ConversationIDs: q["conversation_id"], TZ: loc}
	f.Excludes = excludes
	if o.scoresKind && len(f.Kinds) != 1 {
		errJSON(w, 400, "kind required")
		return f, false
	}
	for _, k := range f.Kinds {
		if !validKind(k) {
			badKind(w)
			return f, false
		}
	}
	return f, true
}

// pageParams reads limit (clamped to 1..500) and cursor.
func pageParams(w http.ResponseWriter, r *http.Request) (int, *cursor, bool) {
	q := r.URL.Query()
	limit := defaultLimit
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			errJSON(w, 400, "limit must be an integer")
			return 0, nil, false
		}
		limit = min(max(n, 1), maxLimit)
	}
	var cur *cursor
	if v := q.Get("cursor"); v != "" {
		c, ok := decodeCursor(v)
		if !ok {
			errJSON(w, 400, "cursor mismatch")
			return 0, nil, false
		}
		cur = c
	}
	return limit, cur, true
}

func rfc(ts float64) string { return time.Unix(int64(ts), 0).UTC().Format(time.RFC3339) }

func nz(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// counts returns m with every key present, zero when absent.
func counts(m map[string]int, keys ...string) map[string]int {
	out := map[string]int{}
	for _, k := range keys {
		out[k] = m[k]
	}
	return out
}

// catalogChecks lists the loaded checks per kind in kindOrder; nil when none are loaded.
func (s *Server) catalogChecks(kinds ...string) []struct{ Kind, Name string } {
	var out []struct{ Kind, Name string }
	if s.opts.Checks == nil {
		return out
	}
	for _, k := range kinds {
		for _, c := range s.opts.Checks.For(k) {
			out = append(out, struct{ Kind, Name string }{c.Kind, c.Name})
		}
	}
	return out
}

func (s *Server) analyticsFacets(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	f, ok := parseFilter(w, r, filterOpts{})
	if !ok {
		return
	}
	fc, err := ts.t.Facets(r.Context(), store.AnalyticsFilter{From: f.From, To: f.To})
	if err != nil {
		readFailed(w)
		return
	}
	tools := []map[string]any{}
	for _, t := range fc.Tools {
		tools = append(tools, map[string]any{"name": t.Name, "n": t.N})
	}
	checks := []map[string]string{}
	for _, c := range s.catalogChecks(kindOrder...) {
		checks = append(checks, map[string]string{"kind": c.Kind, "name": c.Name})
	}
	out := map[string]any{"repos": nz(fc.Repos), "harnesses": nz(fc.Harnesses), "kinds": nz(fc.Kinds),
		"plans": nz(fc.Plans), "events": nz(fc.Events), "models": nz(fc.Models), "norm_events": nz(fc.NormEvents),
		"tools": tools, "checks": checks}
	addAnalyticsPartial(out, ts)
	writeJSON(w, 200, out)
}

func (s *Server) analyticsSummary(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	f, ok := parseFilter(w, r, filterOpts{})
	if !ok {
		return
	}
	sm, err := ts.t.Summary(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	out := map[string]any{"from": f.From.Format(time.RFC3339), "to": f.To.Format(time.RFC3339),
		"conversations": sm.Conversations, "hook_events": sm.HookEvents, "artifact_versions": sm.ArtifactVersions,
		"distinct_content": sm.DistinctContent,
		"by_kind":          counts(sm.ByKind, "design", "brief", "report", "other"),
		"by_source":        counts(sm.BySource, "worktree", "commit"),
		"commits":          sm.Commits,
		"rejections":       counts(sm.Rejections, "precheck", "screen"),
		"screens":          counts(sm.Screens, "pass", "unscreened"),
		"model_calls":      sm.ModelCalls, "unpriced_calls": sm.UnpricedCalls, "cost_usd": sm.CostUSD,
		"tokens_in": sm.TokensIn, "tokens_out": sm.TokensOut, "tokens_cache_read": sm.TokensCacheRead,
		"tokens_cache_write": sm.TokensCacheWrite, "tokens_reasoning": sm.TokensReasoning}
	addAnalyticsPartial(out, ts)
	writeJSON(w, 200, out)
}

var seriesGroups = map[string][]string{
	"hook_events":       {"harness", "repo_id", "event", "tool"},
	"artifact_versions": {"harness", "repo_id", "kind", "plan", "source"},
	"commits":           {"harness", "repo_id"},
	"conversations":     {"harness"},
	"rejections":        {"stage"},
}

func (s *Server) analyticsSeries(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	metric, bucket, group := q.Get("metric"), q.Get("bucket"), q.Get("group")
	allowed, ok := seriesGroups[metric]
	if !ok {
		errJSON(w, 400, "metric must be hook_events, artifact_versions, commits, conversations or rejections")
		return
	}
	if bucket != "day" && bucket != "week" {
		errJSON(w, 400, "bucket must be day or week")
		return
	}
	if group == "" {
		group = "none"
	}
	if group != "none" {
		found := false
		for _, g := range allowed {
			found = found || g == group
		}
		if !found {
			errJSON(w, 400, "group not allowed for metric")
			return
		}
	}
	f, ok := parseFilter(w, r, filterOpts{weeks: bucket == "week"})
	if !ok {
		return
	}
	pts, err := ts.t.Series(r.Context(), f, metric, bucket, group)
	if err != nil {
		readFailed(w)
		return
	}
	type point struct {
		T string `json:"t"`
		N int    `json:"n"`
	}
	type entry struct {
		Key    string  `json:"key"`
		Points []point `json:"points"`
	}
	byKey := map[string]*entry{}
	var list []*entry
	for _, p := range pts {
		e := byKey[p.Key]
		if e == nil {
			e = &entry{Key: p.Key, Points: []point{}}
			byKey[p.Key] = e
			list = append(list, e)
		}
		e.Points = append(e.Points, point{p.T, p.N})
	}
	if len(list) == 0 && group == "none" {
		list = append(list, &entry{Key: "all", Points: []point{}})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Key < list[j].Key })
	if list == nil {
		list = []*entry{}
	}
	out := map[string]any{"bucket": bucket, "series": list}
	addAnalyticsPartial(out, ts)
	writeJSON(w, 200, out)
}

func (s *Server) analyticsScores(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	f, ok := parseFilter(w, r, filterOpts{scoresKind: true})
	if !ok {
		return
	}
	kind := f.Kinds[0]
	f.Kinds = nil
	vals, err := ts.t.WindowScores(r.Context(), f, kind)
	if err != nil {
		readFailed(w)
		return
	}
	out := []map[string]any{}
	for _, c := range s.catalogChecks(kind) {
		v := vals[c.Name]
		sort.Float64s(v)
		out = append(out, map[string]any{"name": c.Name, "n": len(v), "min": round3(percentile(v, 0)),
			"p25": round3(percentile(v, .25)), "median": round3(percentile(v, .5)),
			"p75": round3(percentile(v, .75)), "max": round3(percentile(v, 1))})
	}
	resp := map[string]any{"kind": kind, "checks": out}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}

func parseExecShapes(w http.ResponseWriter, q url.Values) ([]string, bool) {
	allowed := map[string]bool{"complete": true, "unreported": true, "started": true}
	var shapes []string
	for _, s := range q["shape"] {
		if !allowed[s] {
			errJSON(w, 400, fmt.Sprintf("unknown shape %s", s))
			return nil, false
		}
		shapes = append(shapes, s)
	}
	sort.Strings(shapes)
	return shapes, true
}

func (s *Server) analyticsExecutions(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	shapes, ok := parseExecShapes(w, q)
	if !ok {
		return
	}
	bucket := q.Get("bucket")
	if bucket != "" && bucket != "day" && bucket != "week" && bucket != "month" {
		errJSON(w, 400, "bucket must be day, week, or month")
		return
	}
	f, ok := parseFilter(w, r, filterOpts{route: "executions", cur: cur, weeks: bucket == "week"})
	if !ok {
		return
	}
	if bucket != "" && bucketSpan(f.From, f.To, bucket, f.TZ) > maxBuckets {
		errJSON(w, 400, "range too wide")
		return
	}
	var ec *store.ExecCursor
	if cur != nil {
		ec = &store.ExecCursor{TS: cur.TS, Key: cur.Key}
	}
	rows, cnt, more, err := ts.t.ExecutionsPage(r.Context(), f, shapes, ec, limit)
	if err != nil {
		readFailed(w)
		return
	}
	type row struct {
		RepoID         string `json:"repo_id"`
		Plan           string `json:"plan"`
		ConversationID string `json:"conversation_id"`
		BriefPath      string `json:"brief_path"`
		Harness        string `json:"harness"`
		Shape          string `json:"shape"`
		TS             string `json:"ts"`
	}
	out := []row{}
	for _, x := range rows {
		out = append(out, row{x.RepoID, x.Plan, x.ConversationID, x.BriefPath, x.Harness, x.Shape, rfc(x.TS)})
	}
	resp := map[string]any{"counts": cnt, "rows": out}
	if bucket != "" {
		series, err := ts.t.ExecutionsShapeSeries(r.Context(), f, bucket)
		if err != nil {
			readFailed(w)
			return
		}
		list := make([]map[string]any, len(series))
		for i, e := range series {
			pts := make([]map[string]any, len(e.Points))
			for j, p := range e.Points {
				pts[j] = map[string]any{"t": p.T, "n": p.N}
			}
			list[i] = map[string]any{"key": e.Key, "points": pts}
		}
		resp["bucket"] = bucket
		resp["series"] = list
	}
	if more {
		last := rows[len(rows)-1]
		resp["next"] = cursor{Route: "executions", Filter: canonFilter(r.URL.Query()), From: f.From.UnixNano(), To: f.To.UnixNano(),
			TS: last.TS, Key: []string{last.ConversationID, last.BriefPath, last.RepoID}}.encode()
	}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}

func (s *Server) analyticsConversations(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	f, ok := parseFilter(w, r, filterOpts{route: "conversations", cur: cur})
	if !ok {
		return
	}
	var cc *store.ConvCursor
	if cur != nil && len(cur.Key) >= 1 {
		cc = &store.ConvCursor{TS: cur.TS, ConversationID: cur.Key[0]}
	}
	rows, more, err := ts.t.ConversationsPage(r.Context(), f, cc, limit)
	if err != nil {
		readFailed(w)
		return
	}
	type row struct {
		ConversationID   string   `json:"conversation_id"`
		Harness          string   `json:"harness"`
		Model            string   `json:"model"`
		Repos            []string `json:"repos"`
		FirstTS          string   `json:"first_ts"`
		LastTS           string   `json:"last_ts"`
		HookEvents       int      `json:"hook_events"`
		ArtifactVersions int      `json:"artifact_versions"`
		Commits          int      `json:"commits"`
		Kinds            []string `json:"kinds"`
		ModelCalls       int      `json:"model_calls"`
		UnpricedCalls    int      `json:"unpriced_calls"`
		CostUSD          float64  `json:"cost_usd"`
		TokensIn         int      `json:"tokens_in"`
		TokensOut        int      `json:"tokens_out"`
	}
	out := []row{}
	for _, x := range rows {
		out = append(out, row{x.ConversationID, x.Harness, x.Model, nz(x.Repos), rfc(x.FirstTS), rfc(x.LastTS),
			x.HookEvents, x.ArtifactVersions, x.Commits, nz(x.Kinds),
			x.ModelCalls, x.UnpricedCalls, x.CostUSD, x.TokensIn, x.TokensOut})
	}
	resp := map[string]any{"rows": out}
	if more {
		last := rows[len(rows)-1]
		resp["next"] = cursor{Route: "conversations", Filter: canonFilter(r.URL.Query()), From: f.From.UnixNano(), To: f.To.UnixNano(),
			TS: last.LastTS, Key: []string{last.ConversationID}}.encode()
	}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}

func (s *Server) analyticsExplore(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	if limit > exploreCap {
		limit = exploreCap
	}
	f, ok := parseFilter(w, r, filterOpts{route: "explore", cur: cur})
	if !ok {
		return
	}
	var ec *store.ExploreCursor
	if cur != nil {
		if len(cur.Key) != 2 {
			errJSON(w, 400, "cursor mismatch")
			return
		}
		ec = &store.ExploreCursor{TS: cur.TS, NS: cur.NS, Type: cur.Key[0], Key: cur.Key[1],
			FactWatermark: cur.FactWatermark, RejectionWatermark: cur.RejectionWatermark}
	}
	rows, more, next, err := ts.t.ExplorePage(r.Context(), f, ec, limit)
	if err != nil {
		readFailed(w)
		return
	}
	type row struct {
		Type           string   `json:"type"`
		TS             string   `json:"ts"`
		Harness        string   `json:"harness"`
		RepoID         string   `json:"repo_id"`
		Plan           string   `json:"plan"`
		Kind           string   `json:"kind"`
		Event          string   `json:"event"`
		Tool           string   `json:"tool"`
		NormEvent      string   `json:"norm_event"`
		Model          string   `json:"model"`
		Path           string   `json:"path"`
		ConversationID string   `json:"conversation_id"`
		Source         string   `json:"source"`
		SHA            string   `json:"sha"`
		ScreenVerdict  string   `json:"screen_verdict"`
		RejectionStage string   `json:"rejection_stage"`
		CostUSD        *float64 `json:"cost_usd,omitempty"`
		Priced         *bool    `json:"priced,omitempty"`
	}
	out := make([]row, 0, len(rows))
	for _, x := range rows {
		var priced *bool
		if x.Type == "hook_event" && x.NormEvent == "usage" {
			p := x.Priced
			priced = &p
		}
		out = append(out, row{x.Type, rfc(x.TS), x.Harness, x.RepoID, x.Plan, x.Kind, x.Event, x.Tool,
			x.NormEvent, x.Model, x.Path, x.ConversationID, x.Source, x.SHA, x.ScreenVerdict, x.RejectionStage, x.CostUSD, priced})
	}
	resp := map[string]any{"rows": out, "truncated": more}
	if more && next != nil {
		resp["next"] = cursor{Route: "explore", Filter: canonFilter(r.URL.Query()), From: f.From.UnixNano(), To: f.To.UnixNano(),
			TS: next.TS, NS: next.NS, Key: []string{next.Type, next.Key}, FactWatermark: next.FactWatermark, RejectionWatermark: next.RejectionWatermark}.encode()
	}
	addAnalyticsPartial(resp, ts)
	writeJSON(w, 200, resp)
}
