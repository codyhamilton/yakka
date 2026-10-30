package store

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MeasureSpec is one row of the measure × dimension matrix.
type MeasureSpec struct {
	Name string
	Unit string
	Dims []string
}

// The measure × dimension matrix, verbatim from DESIGN.md (phase 3, Analytics reads):
//
//	| Measure | Dimensions |
//	| `hook_events` | `harness`, `repo_id`, `norm_event`, `event`, `tool`, `tool_kind`, `conversation_id` |
//	| `conversations` (distinct) | `harness`, `repo_id`, `model` |
//	| `artifact_versions`, `distinct_content` | `harness`, `repo_id`, `kind`, `plan`, `source`, `conversation_id` |
//	| `commits` | `harness`, `repo_id`, `conversation_id` |
//	| `rejections` | `stage` |
//	| `model_calls`, `tokens_*`, `cost_usd`, `unpriced_calls` | `harness`, `repo_id`, `model`, `conversation_id` |
//
// Every measure also takes hour_of_day and weekday, appended by Measures.
var measureMatrix = []MeasureSpec{
	{Name: "hook_events", Unit: "count", Dims: []string{"harness", "repo_id", "norm_event", "event", "tool", "tool_kind", "conversation_id"}},
	{Name: "conversations", Unit: "count", Dims: []string{"harness", "repo_id", "model"}},
	{Name: "artifact_versions", Unit: "count", Dims: []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}},
	{Name: "distinct_content", Unit: "count", Dims: []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}},
	{Name: "commits", Unit: "count", Dims: []string{"harness", "repo_id", "conversation_id"}},
	{Name: "rejections", Unit: "count", Dims: []string{"stage"}},
	{Name: "model_calls", Unit: "count", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "tokens_in", Unit: "tokens", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "tokens_out", Unit: "tokens", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "tokens_cache_read", Unit: "tokens", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "tokens_cache_write", Unit: "tokens", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "tokens_reasoning", Unit: "tokens", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "cost_usd", Unit: "usd", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
	{Name: "unpriced_calls", Unit: "count", Dims: []string{"harness", "repo_id", "model", "conversation_id"}},
}

var usageMeasures = map[string]bool{
	"model_calls": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true,
	"tokens_cache_write": true, "tokens_reasoning": true, "cost_usd": true, "unpriced_calls": true,
}

// Measures returns the matrix in the design's order; every measure's Dims ends with
// hour_of_day and weekday.
func Measures() []MeasureSpec {
	out := make([]MeasureSpec, 0, len(measureMatrix))
	for _, m := range measureMatrix {
		dims := make([]string, 0, len(m.Dims)+2)
		dims = append(dims, m.Dims...)
		dims = append(dims, "hour_of_day", "weekday")
		out = append(out, MeasureSpec{Name: m.Name, Unit: m.Unit, Dims: dims})
	}
	return out
}

var Buckets = []string{"none", "hour", "day", "week", "month"}

type QueryParams struct {
	Measure string
	Dims    []string
	Bucket  string
	Top     int
}

type QueryRow struct {
	T string
	K []string
	V float64
}

type QueryResult struct {
	Measure, Bucket string
	Dims            []string
	Rows            []QueryRow
	Ignored         []string
	Truncated       bool
}

var ErrUnsupported = errors.New("unsupported")

var usageQuery func(ctx context.Context, t *Tenant, f AnalyticsFilter, p QueryParams) (QueryResult, error)

var queryRowCap = 20000

type measureDef struct {
	table      string
	pred       string
	value      string
	distinct   string
	dims       []string
	usage      bool
	rollup     string   // hourly rollup table read for whole interior hours; "" reads table alone
	rollupCols []string // base/rollup columns the union exposes beside the time column
	rollupType string   // constant exposed as `type` when the outer WHERE filters on it; "" otherwise
}

var factColumns = map[string]string{
	"harness": "harness", "repo_id": "repo_id", "norm_event": "norm_event",
	"event": "event", "tool": "tool", "tool_kind": toolKindExpr, "conversation_id": "conversation_id",
	"model": "model", "kind": "kind", "plan": "plan", "source": "source",
}

func measureByName(name string) (measureDef, bool) {
	switch name {
	case "hook_events":
		return measureDef{table: "facts", pred: "type='hook_event'", dims: []string{"harness", "repo_id", "norm_event", "event", "tool", "tool_kind", "conversation_id"},
			rollup: "hook_events_hourly", rollupType: "hook_event",
			rollupCols: []string{"harness", "repo_id", "norm_event", "event", "tool", "conversation_id"}}, true
	case "conversations":
		return measureDef{table: "facts", distinct: "conversation_id", dims: []string{"harness", "repo_id", "model"},
			rollup:     "conversations_hourly",
			rollupCols: []string{"harness", "repo_id", "model", "conversation_id"}}, true
	case "artifact_versions":
		return measureDef{table: "facts", pred: "type='artifact_version'", dims: []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}}, true
	case "distinct_content":
		return measureDef{table: "facts", pred: "type='artifact_version'", distinct: "content_hash", dims: []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}}, true
	case "commits":
		return measureDef{table: "facts", pred: "type='commit'", dims: []string{"harness", "repo_id", "conversation_id"}}, true
	case "rejections":
		return measureDef{table: "rejections", dims: []string{"stage"}}, true
	}
	if usageMeasures[name] {
		return measureDef{table: "facts", dims: []string{"harness", "repo_id", "model", "conversation_id"}, usage: true}, true
	}
	return measureDef{}, false
}

func (d measureDef) hasDim(dim string) bool {
	if dim == "hour_of_day" || dim == "weekday" {
		return true
	}
	for _, x := range d.dims {
		if x == dim {
			return true
		}
	}
	return false
}

func (d measureDef) colExpr(dim string) string {
	if d.table == "rejections" {
		return "stage"
	}
	return factColumns[dim]
}

func (d measureDef) timeExpr() string {
	if d.table == "rejections" {
		return "at/1e9"
	}
	return "ts"
}

func (d measureDef) agg() string {
	if d.distinct != "" {
		return "count(DISTINCT " + d.distinct + ")"
	}
	if d.value != "" {
		return d.value
	}
	return "count(*)"
}

// aggSQL is the aggregation over the query's FROM source: one per fact normally, the sum of the
// rollup weights when reading a counting rollup whose rows stand for n facts each, and the plain
// distinct count when reading a distinct-count rollup (summing weights would overcount there; the
// union's count(DISTINCT ...) dedupes across base edge rows and interior rollup rows).
func (d measureDef) aggSQL() string {
	if d.rollup != "" && d.distinct == "" {
		return "coalesce(sum(w),0)"
	}
	return d.agg()
}

// source returns the FROM source for a measure. A rolled-up measure reads its rollup table for whole
// hours strictly inside the window and base rows for the two partial edge hours the window cuts, so
// the result is identical to aggregating base rows alone. It exposes the base columns (plus a weight
// w for a counting rollup) so the rank and final queries are unchanged. The projection is shared: a
// counting rollup sums w, a distinct rollup counts DISTINCT over the union. Other measures read
// their table.
func (d measureDef) source(f AnalyticsFilter) string {
	if d.rollup == "" {
		return d.table
	}
	from, to := seconds(f.From), seconds(f.To)
	hF := math.Floor(from/3600) * 3600
	hT := math.Floor(to/3600) * 3600
	num := func(x float64) string { return strconv.FormatFloat(x, 'f', -1, 64) }
	cols := strings.Join(d.rollupCols, ", ")
	weighted := d.distinct == "" // a counting rollup exposes and sums a per-row weight
	proj := func(timeExpr, weight string) string {
		var b strings.Builder
		if d.rollupType != "" {
			b.WriteString("'" + d.rollupType + "' AS type, ")
		}
		b.WriteString(timeExpr + " AS ts, " + cols)
		if weighted {
			b.WriteString(", " + weight + " AS w")
		}
		return b.String()
	}
	baseWhere := func(lo, hi string) string {
		p := ""
		if d.pred != "" {
			p = d.pred + " AND "
		}
		return p + "ts" + lo + " AND ts" + hi
	}
	base := func(lo, hi string) string {
		return "SELECT " + proj("ts", "1") + " FROM facts WHERE " + baseWhere(lo, hi)
	}
	if hF == hT {
		// The whole window lies in one hour; there is no whole interior hour to read from the rollup.
		return "(" + base(" >= "+num(from), " <= "+num(to)) + ")"
	}
	// Two disjoint one-hour base ranges bound the window; the rollup covers the hours strictly
	// between them. Each base range is a narrow index seek rather than a scan of the whole window.
	b1 := base(" >= "+num(from), " < "+num(hF+3600))
	b2 := base(" >= "+num(hT), " <= "+num(to))
	roll := "SELECT " + proj("hour", "n") + " FROM " + d.rollup +
		" WHERE hour > " + num(hF) + " AND hour < " + num(hT)
	return "(" + b1 + " UNION ALL " + b2 + " UNION ALL " + roll + ")"
}

// Query answers measure × 0..2 dims × bucket × top-N for the six non-usage measures.
func (t *Tenant) Query(ctx context.Context, f AnalyticsFilter, p QueryParams) (QueryResult, error) {
	def, ok := measureByName(p.Measure)
	if !ok {
		return QueryResult{}, fmt.Errorf("unknown measure %q", p.Measure)
	}
	if def.usage {
		if usageQuery == nil {
			return QueryResult{}, errors.New("measure not available")
		}
		return usageQuery(ctx, t, f, p)
	}
	bucket := p.Bucket
	if bucket == "" {
		bucket = "none"
	}
	validBucket := false
	for _, x := range Buckets {
		if x == bucket {
			validBucket = true
			break
		}
	}
	if !validBucket {
		return QueryResult{}, fmt.Errorf("unknown bucket %q", p.Bucket)
	}
	for _, d := range p.Dims {
		if !def.hasDim(d) {
			return QueryResult{}, fmt.Errorf("unsupported dimension %s for %s: %w", d, p.Measure, ErrUnsupported)
		}
	}
	top := p.Top
	if top <= 0 {
		top = 20
	}
	if top > 100 {
		top = 100
	}
	return t.queryMeasure(ctx, f, p, def, top, bucket)
}

func (t *Tenant) queryMeasure(ctx context.Context, f AnalyticsFilter, p QueryParams, def measureDef, top int, bucket string) (QueryResult, error) {
	res := QueryResult{Measure: p.Measure, Bucket: bucket, Dims: append([]string{}, p.Dims...)}
	f2, ignored := def.applyFilters(f)
	res.Ignored = ignored
	where, args := def.whereClause(f2)
	src := def.source(f2)
	loc := f.TZ
	if loc == nil {
		loc = time.UTC
	}
	tops := map[string][]string{}
	for _, d := range p.Dims {
		keys, err := t.rankDim(ctx, def, src, where, args, d, loc, top)
		if err != nil {
			return QueryResult{}, err
		}
		tops[d] = keys
	}
	var rows []QueryRow
	var err error
	if loc == time.UTC {
		rows, err = t.finalUTC(ctx, def, src, where, args, p.Dims, tops, bucket)
	} else {
		rows, err = t.finalLocal(ctx, def, src, where, args, p.Dims, tops, bucket, loc)
	}
	if err != nil {
		return QueryResult{}, err
	}
	sortRows(rows)
	if len(rows) > queryRowCap {
		rows = rows[:queryRowCap]
		res.Truncated = true
	}
	res.Rows = rows
	return res, nil
}

func (d measureDef) applyFilters(f AnalyticsFilter) (AnalyticsFilter, []string) {
	applied := map[string]bool{}
	if d.table == "rejections" {
		applied["kind"] = true
		applied["plan"] = true
	} else {
		for _, dim := range d.dims {
			applied[dim] = true
		}
	}
	var ignored []string
	f2 := f
	f2.Repos = keepFilter(f.Repos, applied["repo_id"], "repo_id", &ignored)
	f2.Harnesses = keepFilter(f.Harnesses, applied["harness"], "harness", &ignored)
	f2.Kinds = keepFilter(f.Kinds, applied["kind"], "kind", &ignored)
	f2.Plans = keepFilter(f.Plans, applied["plan"], "plan", &ignored)
	f2.NormEvents = keepFilter(f.NormEvents, applied["norm_event"], "norm_event", &ignored)
	f2.Events = keepFilter(f.Events, applied["event"], "event", &ignored)
	f2.Tools = keepFilter(f.Tools, applied["tool"], "tool", &ignored)
	f2.Models = keepFilter(f.Models, applied["model"], "model", &ignored)
	f2.Sources = keepFilter(f.Sources, applied["source"], "source", &ignored)
	f2.ConversationIDs = keepFilter(f.ConversationIDs, applied["conversation_id"], "conversation_id", &ignored)
	sort.Strings(ignored)
	return f2, ignored
}

func keepFilter(vals []string, applied bool, dim string, ignored *[]string) []string {
	if len(vals) == 0 {
		return vals
	}
	if applied {
		return vals
	}
	*ignored = append(*ignored, dim)
	return nil
}

func (d measureDef) whereClause(f AnalyticsFilter) (string, []any) {
	if d.table == "rejections" {
		return f.rejWhere()
	}
	w, args := f.factWhere()
	if d.pred != "" {
		w = d.pred + " AND " + w
	}
	return w, args
}

func (t *Tenant) rankDim(ctx context.Context, def measureDef, src, where string, args []any, dim string, loc *time.Location, top int) ([]string, error) {
	if dim == "hour_of_day" || dim == "weekday" {
		if loc == time.UTC {
			if dim == "hour_of_day" {
				return t.rankSQL(ctx, def, src, where, args, hourOfDayExpr(def), top)
			}
			return t.rankSQL(ctx, def, src, where, args, weekdayExpr(def), top)
		}
		return t.rankLocalTimeDim(ctx, def, src, where, args, dim, loc, top)
	}
	return t.rankSQL(ctx, def, src, where, args, def.colExpr(dim), top)
}

func (t *Tenant) rankSQL(ctx context.Context, def measureDef, src, where string, args []any, expr string, top int) ([]string, error) {
	q := "SELECT " + expr + " AS k, " + def.aggSQL() + " AS v FROM " + src + " WHERE " + where +
		" GROUP BY k ORDER BY v DESC, k ASC LIMIT ?"
	qargs := append(append([]any{}, args...), top)
	rows, err := t.rdb.QueryContext(ctx, q, qargs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		var v float64
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (t *Tenant) rankLocalTimeDim(ctx context.Context, def measureDef, src, where string, args []any, dim string, loc *time.Location, top int) ([]string, error) {
	totals := map[string]float64{}
	if def.distinct == "" {
		q := "SELECT " + hourKeyExpr(def) + " AS h, " + def.aggSQL() + " AS v FROM " + src + " WHERE " + where + " GROUP BY h"
		rows, err := t.rdb.QueryContext(ctx, q, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var h string
			var v float64
			if err := rows.Scan(&h, &v); err != nil {
				return nil, err
			}
			totals[localKey(h, loc, dim)] += v
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	} else {
		q := "SELECT DISTINCT " + hourKeyExpr(def) + " AS h, " + def.distinct + " FROM " + src + " WHERE " + where
		rows, err := t.rdb.QueryContext(ctx, q, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		sets := map[string]map[string]bool{}
		for rows.Next() {
			var h, c string
			if err := rows.Scan(&h, &c); err != nil {
				return nil, err
			}
			k := localKey(h, loc, dim)
			if sets[k] == nil {
				sets[k] = map[string]bool{}
			}
			sets[k][c] = true
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		for k, s := range sets {
			totals[k] = float64(len(s))
		}
	}
	return rankKeys(totals, top), nil
}

func (t *Tenant) finalUTC(ctx context.Context, def measureDef, src, where string, args []any, dims []string, tops map[string][]string, bucket string) ([]QueryRow, error) {
	var sel []string
	var selArgs []any
	var groupBy []string
	for i, d := range dims {
		var expr string
		switch d {
		case "hour_of_day":
			expr = hourOfDayExpr(def)
		case "weekday":
			expr = weekdayExpr(def)
		default:
			expr = foldExpr(def.colExpr(d), tops[d], &selArgs)
		}
		al := "k" + strconv.Itoa(i)
		sel = append(sel, expr+" AS "+al)
		groupBy = append(groupBy, al)
	}
	haveT := bucket != "none"
	if haveT {
		sel = append(sel, bucketExprSQL(def, bucket)+" AS t")
		groupBy = append(groupBy, "t")
	}
	sel = append(sel, def.aggSQL()+" AS v")
	q := "SELECT " + strings.Join(sel, ", ") + " FROM " + src + " WHERE " + where
	if len(groupBy) > 0 {
		q += " GROUP BY " + strings.Join(groupBy, ", ")
	}
	qargs := append(append([]any{}, selArgs...), args...)
	rows, err := t.rdb.QueryContext(ctx, q, qargs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QueryRow
	for rows.Next() {
		vals := make([]string, len(dims))
		dest := make([]any, 0, len(dims)+2)
		for i := range vals {
			dest = append(dest, &vals[i])
		}
		var tv string
		var v float64
		if haveT {
			dest = append(dest, &tv)
		}
		dest = append(dest, &v)
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		out = append(out, QueryRow{T: tv, K: vals, V: v})
	}
	return out, rows.Err()
}

func (t *Tenant) finalLocal(ctx context.Context, def measureDef, src, where string, args []any, dims []string, tops map[string][]string, bucket string, loc *time.Location) ([]QueryRow, error) {
	var sel []string
	var selArgs []any
	var aliases []string
	for i, d := range dims {
		if d == "hour_of_day" || d == "weekday" {
			continue
		}
		al := "k" + strconv.Itoa(i)
		sel = append(sel, foldExpr(def.colExpr(d), tops[d], &selArgs)+" AS "+al)
		aliases = append(aliases, al)
	}
	sel = append(sel, hourKeyExpr(def)+" AS h")
	distinct := def.distinct != ""
	if distinct {
		sel = append(sel, def.distinct)
	} else {
		sel = append(sel, def.aggSQL()+" AS v")
	}
	q := "SELECT "
	if distinct {
		q += "DISTINCT "
	}
	q += strings.Join(sel, ", ") + " FROM " + src + " WHERE " + where
	if !distinct {
		gb := append(append([]string{}, aliases...), "h")
		q += " GROUP BY " + strings.Join(gb, ", ")
	}
	qargs := append(append([]any{}, selArgs...), args...)
	rows, err := t.rdb.QueryContext(ctx, q, qargs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type item struct {
		tv  string
		kv  []string
		v   float64
		set map[string]bool
	}
	byKey := map[string]*item{}
	for rows.Next() {
		pv := make([]string, len(aliases))
		dest := make([]any, 0, len(aliases)+3)
		for i := range pv {
			dest = append(dest, &pv[i])
		}
		var h string
		dest = append(dest, &h)
		var v float64
		var col string
		if distinct {
			dest = append(dest, &col)
		} else {
			dest = append(dest, &v)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		kv := make([]string, len(dims))
		pi := 0
		for i, d := range dims {
			if d == "hour_of_day" || d == "weekday" {
				kv[i] = localKey(h, loc, d)
			} else {
				kv[i] = pv[pi]
				pi++
			}
		}
		tv := ""
		if bucket != "none" {
			tv = localBucket(h, loc, bucket)
		}
		key := tv + "\x00" + strings.Join(kv, "\x00")
		it := byKey[key]
		if it == nil {
			it = &item{tv: tv, kv: kv}
			byKey[key] = it
		}
		if distinct {
			if it.set == nil {
				it.set = map[string]bool{}
			}
			it.set[col] = true
			it.v = float64(len(it.set))
		} else {
			it.v += v
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]QueryRow, 0, len(byKey))
	for _, it := range byKey {
		out = append(out, QueryRow{T: it.tv, K: it.kv, V: it.v})
	}
	return out, nil
}

func hourOfDayExpr(def measureDef) string {
	return "strftime('%H', " + def.timeExpr() + ", 'unixepoch')"
}

func weekdayExpr(def measureDef) string {
	return "strftime('%w', " + def.timeExpr() + ", 'unixepoch')"
}

func hourKeyExpr(def measureDef) string {
	return "strftime('%Y-%m-%dT%H:00:00Z', " + def.timeExpr() + ", 'unixepoch')"
}

func bucketExprSQL(def measureDef, bucket string) string {
	te := def.timeExpr()
	switch bucket {
	case "hour":
		return "strftime('%Y-%m-%dT%H:00:00', " + te + ", 'unixepoch') || 'Z'"
	case "day":
		return "strftime('%Y-%m-%dT00:00:00', " + te + ", 'unixepoch') || 'Z'"
	case "week":
		return "date(" + te + ", 'unixepoch', 'weekday 0', '-6 days') || 'T00:00:00Z'"
	case "month":
		return "strftime('%Y-%m-01T00:00:00', " + te + ", 'unixepoch') || 'Z'"
	}
	return "''"
}

func localKey(h string, loc *time.Location, dim string) string {
	tm, err := time.Parse(time.RFC3339, h)
	if err != nil {
		return h
	}
	tm = tm.In(loc)
	if dim == "hour_of_day" {
		return fmt.Sprintf("%02d", tm.Hour())
	}
	return strconv.Itoa(int(tm.Weekday()))
}

func localBucket(h string, loc *time.Location, bucket string) string {
	tm, err := time.Parse(time.RFC3339, h)
	if err != nil {
		return h
	}
	tm = tm.In(loc)
	y, m, d := tm.Date()
	switch bucket {
	case "hour":
		return time.Date(y, m, d, tm.Hour(), 0, 0, 0, loc).Format(time.RFC3339)
	case "day":
		return time.Date(y, m, d, 0, 0, 0, 0, loc).Format(time.RFC3339)
	case "week":
		wd := (int(tm.Weekday()) + 6) % 7
		mon := time.Date(y, m, d, 0, 0, 0, 0, loc).AddDate(0, 0, -wd)
		return mon.Format(time.RFC3339)
	case "month":
		return time.Date(y, m, 1, 0, 0, 0, 0, loc).Format(time.RFC3339)
	}
	return ""
}

func foldExpr(col string, keys []string, selArgs *[]any) string {
	if len(keys) == 0 {
		return "'__other__'"
	}
	for _, k := range keys {
		*selArgs = append(*selArgs, k)
	}
	return "CASE WHEN " + col + " IN (?" + strings.Repeat(",?", len(keys)-1) + ") THEN " + col + " ELSE '__other__' END"
}

func sortRows(rows []QueryRow) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].T != rows[j].T {
			return rows[i].T < rows[j].T
		}
		return strings.Join(rows[i].K, "\x00") < strings.Join(rows[j].K, "\x00")
	})
}

func rankKeys(totals map[string]float64, top int) []string {
	keys := make([]string, 0, len(totals))
	for k := range totals {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if totals[keys[i]] != totals[keys[j]] {
			return totals[keys[i]] > totals[keys[j]]
		}
		return keys[i] < keys[j]
	})
	if len(keys) > top {
		keys = keys[:top]
	}
	return keys
}
