package store

// Analytics reads for the workflow analytics site (plan 10, phase 1). Every function reads one
// tenant's facts, rejections, screens and scores through t.rdb with parameterised SQL.
//
// Clocks: facts.ts is REAL Unix seconds; rejections.at is INTEGER Unix nanoseconds. The window is
// inclusive at both ends in each unit.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"math"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"modernc.org/sqlite"
)

func init() {
	// wf_kind(path) is keys.Kind; wf_plan(path) is the <plan> segment, "" unless the path has a kind.
	sqlite.RegisterDeterministicScalarFunction("wf_kind", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		s, _ := args[0].(string)
		return keys.Kind(s), nil
	})
	sqlite.RegisterDeterministicScalarFunction("wf_plan", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		s, _ := args[0].(string)
		return planOf(s), nil
	})
	sqlite.RegisterDeterministicScalarFunction("wf_series_bucket", 3, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		seconds, ok := args[0].(float64)
		if !ok {
			return nil, fmt.Errorf("series timestamp is not numeric")
		}
		unit, _ := args[1].(string)
		zone, _ := args[2].(string)
		loc, err := time.LoadLocation(zone)
		if err != nil {
			return nil, err
		}
		t := time.Unix(0, int64(seconds*1e9)).In(loc)
		switch unit {
		case "day":
			return t.Format("2006-01-02"), nil
		case "week":
			days := (int(t.Weekday()) + 6) % 7
			return t.AddDate(0, 0, -days).Format("2006-01-02"), nil
		default:
			return nil, fmt.Errorf("unknown series bucket %q", unit)
		}
	})
}

func planOf(p string) string {
	if keys.Kind(p) == "" {
		return ""
	}
	parts := strings.Split(path.Clean(strings.ReplaceAll(p, "\\", "/")), "/")
	return parts[2] // docs/plans/<plan>/...
}

// AnalyticsFilter is the shared filter. Empty lists mean no constraint; values within a list are
// OR, different lists are AND. A row with no value for a dimension has the value "".
type AnalyticsFilter struct {
	From, To                       time.Time // inclusive
	Repos, Harnesses, Kinds, Plans []string
	NormEvents, Events             []string
	Tools, Models, Sources         []string
	ConversationIDs                []string
	Excludes                       map[string][]string
	TZ                             *time.Location // nil means UTC
}

type ToolCount struct {
	Name string
	N    int
}
type Facets struct {
	Repos, Harnesses, Kinds, Plans, Events []string
	Models, NormEvents                     []string
	Tools                                  []ToolCount
}
type Summary struct {
	Conversations, HookEvents, ArtifactVersions, DistinctContent            int
	ByKind                                                                  map[string]int
	BySource                                                                map[string]int
	Commits                                                                 int
	Rejections                                                              map[string]int
	Screens                                                                 map[string]int
	ModelCalls, UnpricedCalls                                               int
	TokensIn, TokensOut, TokensCacheRead, TokensCacheWrite, TokensReasoning int
	CostUSD                                                                 float64
}
type SeriesPoint struct {
	Key, T string
	N      int
}
type ExecRow struct {
	RepoID, Plan, ConversationID, BriefPath, Harness, Shape string
	TS                                                      float64
}
type ConvRow struct {
	ConversationID, Harness, Model        string
	Repos, Kinds                          []string
	FirstTS, LastTS                       float64
	HookEvents, ArtifactVersions, Commits int
	ModelCalls, UnpricedCalls             int
	TokensIn, TokensOut                   int
	TokensCacheRead, TokensCacheWrite     int
	TokensReasoning, DistinctContent      int
	CostUSD                               float64
}

// SessionProvenance contains lifetime-derived lenses. Windowed measures remain in ConvRow.
type SessionProvenance struct {
	Repo, RepoAttribution, Model, Harness string
	Repos, Harnesses                      []string
	ModelShares                           map[string]float64
	HarnessMixed                          bool
}

// ExecCursor is the keyset position in the executions order (ts desc, conversation_id, path, repo_id).
type ExecCursor struct {
	TS  float64
	Key []string // conversation_id, path, repo_id
}

// ConvCursor is the keyset position in the conversations order (last_ts desc, conversation_id).
type ConvCursor struct {
	TS             float64
	ConversationID string
}

type ExploreRow struct {
	Type                                                                                                                         string
	TS                                                                                                                           float64
	Harness, RepoID, Plan, Kind, Event, Tool, NormEvent, Model, Path, ConversationID, Source, SHA, ScreenVerdict, RejectionStage string
	CostUSD                                                                                                                      *float64
	Priced                                                                                                                       bool
	PageKey                                                                                                                      string
	PageNanos                                                                                                                    int64
	PageType                                                                                                                     string
}

// ExploreCursor binds a traversal to the populations present on its first page.
type ExploreCursor struct {
	TS                 float64
	NS                 int64
	Type, Key          string
	FactWatermark      int64
	RejectionWatermark int64
}

func inList(expr string, vals []string, args *[]any) string {
	if len(vals) == 0 {
		return ""
	}
	for _, v := range vals {
		*args = append(*args, v)
	}
	return " AND " + expr + " IN (?" + strings.Repeat(",?", len(vals)-1) + ")"
}

func seconds(t time.Time) float64 { return float64(t.UnixNano()) / 1e9 }

// factWhere is the shared filter over a facts row (unqualified columns).
func (f AnalyticsFilter) factWhere() (string, []any) {
	args := []any{seconds(f.From), seconds(f.To)}
	w := "ts >= ? AND ts <= ?"
	w += inList("repo_id", f.Repos, &args)
	w += inList("harness", f.Harnesses, &args)
	w += inList("kind", f.Kinds, &args)
	w += inList("plan", f.Plans, &args)
	w += inList("norm_event", f.NormEvents, &args)
	w += inList("event", f.Events, &args)
	w += inList("tool", f.Tools, &args)
	w += inList("model", f.Models, &args)
	w += inList("source", f.Sources, &args)
	w += inList("conversation_id", f.ConversationIDs, &args)
	for dim, values := range f.Excludes {
		col := map[string]string{"repo_id": "repo_id", "harness": "harness", "kind": "kind", "plan": "plan", "norm_event": "norm_event", "event": "event", "tool": "tool", "model": "model", "source": "source", "conversation_id": "conversation_id"}[dim]
		if col != "" && len(values) > 0 {
			for _, v := range values {
				args = append(args, v)
			}
			w += " AND " + col + " NOT IN (?" + strings.Repeat(",?", len(values)-1) + ")"
		}
	}
	return w, args
}

// rejWhere is the shared filter over a rejections row: window on at (ns), repo_id and harness are
// always "", kind and plan come from path.
func (f AnalyticsFilter) rejWhere() (string, []any) {
	args := []any{f.From.UnixNano(), f.To.UnixNano()}
	w := "at >= ? AND at <= ?"
	w += inList("''", f.Repos, &args)
	w += inList("''", f.Harnesses, &args)
	w += inList("wf_kind(path)", f.Kinds, &args)
	w += inList("wf_plan(path)", f.Plans, &args)
	if values := f.Excludes["stage"]; len(values) > 0 {
		for _, v := range values {
			args = append(args, v)
		}
		w += " AND stage NOT IN (?" + strings.Repeat(",?", len(values)-1) + ")"
	}
	return w, args
}

func (t *Tenant) strings(ctx context.Context, q string, args ...any) ([]string, error) {
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// rollupEligible reports whether f constrains only time. The facet rollup covers every dimension
// value in the window but no non-time predicate, so a filter carrying any list falls back to base
// rows and its results stay exactly as the base-only Facets produced them.
func (f AnalyticsFilter) rollupEligible() bool {
	return len(f.Repos) == 0 && len(f.Harnesses) == 0 && len(f.Kinds) == 0 && len(f.Plans) == 0 &&
		len(f.NormEvents) == 0 && len(f.Events) == 0 && len(f.Tools) == 0 && len(f.Models) == 0 &&
		len(f.Sources) == 0 && len(f.ConversationIDs) == 0
}

// Facets lists the distinct dimension values and the tool histogram over the window. With no
// non-time filter it reads facets_hourly for the whole hours strictly inside the window and base
// rows for the two partial edge hours (the rollup holds each dim's presence, so the union of the
// distinct sets is exact); any other filter reads base rows alone via facetsBase.
func (t *Tenant) Facets(ctx context.Context, f AnalyticsFilter) (Facets, error) {
	if !f.rollupEligible() {
		return t.facetsBase(ctx, f)
	}
	from, to := seconds(f.From), seconds(f.To)
	hF := math.Floor(from/3600) * 3600
	hT := math.Floor(to/3600) * 3600
	if hF == hT {
		// The whole window lies in one hour; there is no whole interior hour to read from the rollup.
		return t.facetsBase(ctx, f)
	}
	var out Facets
	var err error
	var ks []string
	for _, d := range []struct {
		dst      *[]string
		dim      string
		expr     string
		nonEmpty bool
	}{
		{&out.Repos, "repo_id", "repo_id", false}, {&out.Harnesses, "harness", "harness", false},
		{&out.Plans, "plan", "plan", false}, {&out.Events, "event", "event", false},
		{&out.Models, "model", "model", true}, {&out.NormEvents, "norm_event", "norm_event", true},
		{&ks, "kind", "kind", false},
	} {
		extra, rollupExtra := "", ""
		if d.nonEmpty {
			extra = " AND " + d.expr + " != ''"
			rollupExtra = " AND value != ''"
		}
		if *d.dst, err = t.strings(ctx, `SELECT value FROM (
			SELECT value FROM facets_hourly WHERE dim=? AND hour > ? AND hour < ?`+rollupExtra+`
			UNION SELECT `+d.expr+` FROM facts WHERE ts >= ? AND ts < ?`+extra+`
			UNION SELECT `+d.expr+` FROM facts WHERE ts >= ? AND ts <= ?`+extra+`
		) ORDER BY value`, d.dim, hF, hT, from, hF+3600, hT, to); err != nil {
			return out, err
		}
	}
	have := map[string]bool{}
	for _, k := range ks {
		have[k] = true
	}
	for _, k := range []string{"design", "brief", "report"} {
		if have[k] {
			out.Kinds = append(out.Kinds, k)
		}
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT value AS tname, sum(n) AS n FROM (
		SELECT value, sum(n) AS n FROM facets_hourly WHERE dim='tool' AND hour > ? AND hour < ? GROUP BY value
		UNION ALL SELECT tool, count(*) FROM facts WHERE type='hook_event' AND ts >= ? AND ts < ? AND tool != '' GROUP BY tool
		UNION ALL SELECT tool, count(*) FROM facts WHERE type='hook_event' AND ts >= ? AND ts <= ? AND tool != '' GROUP BY tool
	) GROUP BY value HAVING value != '' ORDER BY n DESC, tname ASC LIMIT 100`,
		hF, hT, from, hF+3600, hT, to)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var c ToolCount
		if err := rows.Scan(&c.Name, &c.N); err != nil {
			return out, err
		}
		out.Tools = append(out.Tools, c)
	}
	return out, rows.Err()
}

// facetsBase is the base-row facets read: a DISTINCT scan per dimension and the tool histogram over
// facts alone. It is exact for any filter and is the fallback for filtered or single-hour windows.
func (t *Tenant) facetsBase(ctx context.Context, f AnalyticsFilter) (Facets, error) {
	w, args := f.factWhere()
	var out Facets
	var err error
	for _, d := range []struct {
		dst      *[]string
		expr     string
		nonEmpty bool
	}{
		{&out.Repos, "repo_id", false}, {&out.Harnesses, "harness", false},
		{&out.Plans, "plan", false}, {&out.Events, "event", false},
		{&out.Models, "model", true}, {&out.NormEvents, "norm_event", true},
	} {
		extra := ""
		if d.nonEmpty {
			extra = " AND " + d.expr + " != ''"
		}
		if *d.dst, err = t.strings(ctx, `SELECT DISTINCT `+d.expr+` AS v FROM facts WHERE `+w+extra+` ORDER BY v`, args...); err != nil {
			return out, err
		}
	}
	ks, err := t.strings(ctx, `SELECT DISTINCT kind FROM facts WHERE `+w, args...)
	if err != nil {
		return out, err
	}
	have := map[string]bool{}
	for _, k := range ks {
		have[k] = true
	}
	for _, k := range []string{"design", "brief", "report"} {
		if have[k] {
			out.Kinds = append(out.Kinds, k)
		}
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT tool AS tname, count(*) AS n FROM facts
		WHERE type='hook_event' AND `+w+` GROUP BY tname HAVING tname != '' ORDER BY n DESC, tname ASC LIMIT 100`, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var c ToolCount
		if err := rows.Scan(&c.Name, &c.N); err != nil {
			return out, err
		}
		out.Tools = append(out.Tools, c)
	}
	return out, rows.Err()
}

func (t *Tenant) Summary(ctx context.Context, f AnalyticsFilter) (Summary, error) {
	s := Summary{ByKind: map[string]int{"design": 0, "brief": 0, "report": 0, "other": 0},
		BySource:   map[string]int{"worktree": 0, "commit": 0},
		Rejections: map[string]int{"precheck": 0, "screen": 0},
		Screens:    map[string]int{"pass": 0, "unscreened": 0}}
	w, args := f.factWhere()
	from, to := seconds(f.From), seconds(f.To)
	hF := int64(math.Floor(from/3600)) * 3600
	hT := int64(math.Floor(to/3600)) * 3600
	if f.rollupEligible() && hF != hT {
		// Time-only window spanning whole interior hours: read the hook_events and conversations
		// counts from their hourly rollups for the interior hours and base rows for the two partial
		// edge hours (as Facets does), and the remaining per-type counts straight from base rows.
		if err := t.rdb.QueryRowContext(ctx, `SELECT COALESCE(SUM(n),0) FROM (
			SELECT n FROM hook_events_hourly WHERE hour > ? AND hour < ?
			UNION ALL SELECT count(*) FROM facts WHERE type='hook_event' AND ts >= ? AND ts < ?
			UNION ALL SELECT count(*) FROM facts WHERE type='hook_event' AND ts >= ? AND ts <= ?)`,
			hF, hT, from, hF+3600, hT, to).Scan(&s.HookEvents); err != nil {
			return s, err
		}
		if err := t.rdb.QueryRowContext(ctx, `SELECT count(DISTINCT conversation_id) FROM (
			SELECT conversation_id FROM conversations_hourly WHERE hour > ? AND hour < ?
			UNION ALL SELECT conversation_id FROM facts WHERE ts >= ? AND ts < ?
			UNION ALL SELECT conversation_id FROM facts WHERE ts >= ? AND ts <= ?)`,
			hF, hT, from, hF+3600, hT, to).Scan(&s.Conversations); err != nil {
			return s, err
		}
		if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM facts WHERE type='artifact_version' AND `+w, args...).Scan(&s.ArtifactVersions); err != nil {
			return s, err
		}
		if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM facts WHERE type='commit' AND `+w, args...).Scan(&s.Commits); err != nil {
			return s, err
		}
		if err := t.rdb.QueryRowContext(ctx, `SELECT count(DISTINCT content_hash) FROM facts WHERE type='artifact_version' AND `+w, args...).Scan(&s.DistinctContent); err != nil {
			return s, err
		}
	} else {
		if err := t.rdb.QueryRowContext(ctx, `SELECT count(DISTINCT conversation_id),
			COALESCE(SUM(type='hook_event'),0), COALESCE(SUM(type='artifact_version'),0),
			count(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END), COALESCE(SUM(type='commit'),0)
			FROM facts WHERE `+w, args...).Scan(&s.Conversations, &s.HookEvents, &s.ArtifactVersions, &s.DistinctContent, &s.Commits); err != nil {
			return s, err
		}
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT COALESCE(NULLIF(kind,''),'other'), source, count(*)
		FROM facts WHERE type='artifact_version' AND `+w+` GROUP BY 1, 2`, args...)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var k, src string
		var n int
		if err := rows.Scan(&k, &src, &n); err != nil {
			rows.Close()
			return s, err
		}
		s.ByKind[k] += n
		if _, ok := s.BySource[src]; ok {
			s.BySource[src] += n
		}
	}
	rows.Close()
	rw, rargs := f.rejWhere()
	rows, err = t.rdb.QueryContext(ctx, `SELECT stage, count(*) FROM rejections WHERE `+rw+` GROUP BY stage`, rargs...)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			rows.Close()
			return s, err
		}
		if _, ok := s.Rejections[st]; ok {
			s.Rejections[st] = n
		}
	}
	rows.Close()
	kept, err := t.usageKeptRows(ctx, f)
	if err != nil {
		return s, err
	}
	for _, u := range kept {
		s.ModelCalls++
		s.TokensIn += int(u.tokIn)
		s.TokensOut += int(u.tokOut)
		s.TokensCacheRead += int(u.tokCacheRead)
		s.TokensCacheWrite += int(u.tokCacheWrite)
		s.TokensReasoning += int(u.tokReasoning)
		usd, priced := Cost(u.harness, u.model, u.tokens(), u.costReported)
		s.CostUSD += usd
		if !priced {
			s.UnpricedCalls++
		}
	}
	// Latest screen (by id) per distinct content hash of the filtered in-window versions.
	rows, err = t.rdb.QueryContext(ctx, `SELECT v, count(*) FROM (
		SELECT (SELECT verdict FROM screens s WHERE s.content_hash=h.content_hash ORDER BY s.id DESC LIMIT 1) AS v
		FROM (SELECT DISTINCT content_hash FROM facts WHERE type='artifact_version' AND content_hash != '' AND `+w+`) h)
		WHERE v IN ('pass','unscreened') GROUP BY v`, args...)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		var n int
		if err := rows.Scan(&v, &n); err != nil {
			return s, err
		}
		s.Screens[v] = n
	}
	return s, rows.Err()
}

// Series: see the brief for metric/bucket/group. The caller validates pairings; an unsupported
// one is an error.
func (t *Tenant) Series(ctx context.Context, f AnalyticsFilter, metric, bucket, group string) ([]SeriesPoint, error) {
	zone := "UTC"
	if f.TZ != nil {
		zone = f.TZ.String()
	}
	bucketOf := func(ts string) (string, error) {
		switch bucket {
		case "day":
			return `wf_series_bucket(` + ts + `, 'day', '` + strings.ReplaceAll(zone, "'", "''") + `')`, nil
		case "week":
			return `wf_series_bucket(` + ts + `, 'week', '` + strings.ReplaceAll(zone, "'", "''") + `')`, nil
		}
		return "", fmt.Errorf("store: unknown bucket %q", bucket)
	}
	b, err := bucketOf("ts")
	if err != nil {
		return nil, err
	}
	var q string
	var args []any
	if metric == "rejections" {
		if group != "none" && group != "stage" {
			return nil, fmt.Errorf("store: group %q not valid for rejections", group)
		}
		key := "'all'"
		if group == "stage" {
			key = "stage"
		}
		rb, _ := bucketOf("at/1e9")
		var w string
		w, args = f.rejWhere()
		q = `SELECT ` + key + ` AS k, ` + rb + ` AS t, count(*) FROM rejections WHERE ` + w + ` GROUP BY k, t ORDER BY k, t`
	} else {
		groups := map[string]string{"none": "'all'", "harness": "harness", "repo_id": "repo_id", "event": "event",
			"tool": "tool", "kind": "kind", "plan": "plan", "source": "source",
			"norm_event": "norm_event", "model": "model", "conversation_id": "conversation_id"}
		key, ok := groups[group]
		if !ok {
			return nil, fmt.Errorf("store: unknown group %q", group)
		}
		agg, typ := "count(*)", ""
		switch metric {
		case "hook_events":
			typ = "type='hook_event' AND "
		case "artifact_versions":
			typ = "type='artifact_version' AND "
		case "commits":
			typ = "type='commit' AND "
		case "conversations":
			agg = "count(DISTINCT conversation_id)"
		default:
			return nil, fmt.Errorf("store: unknown metric %q", metric)
		}
		var w string
		w, args = f.factWhere()
		q = `SELECT ` + key + ` AS k, ` + b + ` AS t, ` + agg + ` FROM facts WHERE ` + typ + w + ` GROUP BY k, t ORDER BY k, t`
	}
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SeriesPoint
	for rows.Next() {
		var p SeriesPoint
		if err := rows.Scan(&p.Key, &p.T, &p.N); err != nil {
			return nil, err
		}
		if p.N > 0 {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}

// WindowScores returns the latest score per (content_hash, check) over distinct content hashes of
// filtered in-window artifact_version rows of kind; f.Kinds is ignored. Values sort ascending.
func (t *Tenant) WindowScores(ctx context.Context, f AnalyticsFilter, kind string) (map[string][]float64, error) {
	f.Kinds = nil
	w, args := f.factWhere()
	args = append([]any{kind}, args...)
	rows, err := t.rdb.QueryContext(ctx, `
	WITH h AS (SELECT DISTINCT content_hash FROM facts
		WHERE type='artifact_version' AND content_hash != '' AND kind=? AND `+w+`),
	s AS (SELECT content_hash, check_name, result,
		ROW_NUMBER() OVER (PARTITION BY content_hash, check_name ORDER BY id DESC) AS rn FROM scores)
	SELECT s.check_name, s.result FROM s JOIN h ON h.content_hash = s.content_hash
	WHERE s.rn = 1 ORDER BY s.check_name, s.result`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]float64{}
	for rows.Next() {
		var c string
		var r float64
		if err := rows.Scan(&c, &r); err != nil {
			return nil, err
		}
		out[c] = append(out[c], r)
	}
	return out, rows.Err()
}

// execShapeSQL is the executions shape CASE expression, over the brief CTE alias b.
const execShapeSQL = `CASE WHEN EXISTS (SELECT 1 FROM facts c WHERE c.type='commit' AND c.conversation_id=b.conversation_id AND c.repo_id=b.repo_id)
			THEN CASE WHEN EXISTS (SELECT 1 FROM facts r WHERE r.type='artifact_version' AND r.conversation_id=b.conversation_id
				AND r.repo_id=b.repo_id AND r.path = 'docs/plans/' || b.plan || '/reports/' || substr(b.path, length('docs/plans/' || b.plan || '/briefs/') + 1))
				THEN 'complete' ELSE 'unreported' END
			ELSE 'started' END`

// Executions lists one row per in-window brief (repo, conversation, path). Commit and report facts
// count whatever their ts; a report must be in the same conversation and repo as the brief.
func (t *Tenant) Executions(ctx context.Context, f AnalyticsFilter) ([]ExecRow, error) {
	w, args := f.factWhere()
	rows, err := t.rdb.QueryContext(ctx, `
	WITH b AS (
		SELECT repo_id, conversation_id, path, harness, ts, plan,
			ROW_NUMBER() OVER (PARTITION BY repo_id, conversation_id, path ORDER BY ts, rowid) AS rn
		FROM facts WHERE type='artifact_version' AND kind='brief' AND `+w+`)
	SELECT repo_id, plan, conversation_id, path, harness, ts, `+execShapeSQL+`
	FROM b WHERE rn = 1 ORDER BY ts DESC, conversation_id, path, repo_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExecRow
	for rows.Next() {
		var r ExecRow
		if err := rows.Scan(&r.RepoID, &r.Plan, &r.ConversationID, &r.BriefPath, &r.Harness, &r.TS, &r.Shape); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func execShapeWhere(shapes []string) (clause string, args []any) {
	if len(shapes) == 0 {
		return "", nil
	}
	ph := make([]string, len(shapes))
	args = make([]any, len(shapes))
	for i, s := range shapes {
		ph[i] = "?"
		args[i] = s
	}
	return ` AND (` + execShapeSQL + `) IN (` + strings.Join(ph, ",") + `)`, args
}

// ExecSeriesPoint is one bucket count for an executions shape series.
type ExecSeriesPoint struct {
	T string
	N int
}

// ExecSeriesEntry is sparse points for one execution shape (complete, unreported, started).
type ExecSeriesEntry struct {
	Key    string
	Points []ExecSeriesPoint
}

// ExecutionsShapeSeries returns per-shape counts over time buckets for in-window briefs. f.Kinds and
// other shared filters apply; shape query params do not affect series.
func (t *Tenant) ExecutionsShapeSeries(ctx context.Context, f AnalyticsFilter, bucket string) ([]ExecSeriesEntry, error) {
	w, args := f.factWhere()
	cte := `
	WITH b AS (
		SELECT repo_id, conversation_id, path, harness, ts, plan,
			ROW_NUMBER() OVER (PARTITION BY repo_id, conversation_id, path ORDER BY ts, rowid) AS rn
		FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + `)`
	rows, err := t.rdb.QueryContext(ctx, cte+`
	SELECT ts, `+execShapeSQL+` AS shape FROM b WHERE rn = 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byShape := map[string]map[string]int{}
	for rows.Next() {
		var ts float64
		var shape string
		if err := rows.Scan(&ts, &shape); err != nil {
			return nil, err
		}
		bt := scoreSeriesBucketStart(ts, bucket, f.TZ)
		m := byShape[shape]
		if m == nil {
			m = map[string]int{}
			byShape[shape] = m
		}
		m[bt]++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	order := []string{"complete", "unreported", "started"}
	out := make([]ExecSeriesEntry, 0, len(order))
	for _, key := range order {
		var pts []ExecSeriesPoint
		if m := byShape[key]; m != nil {
			tsKeys := make([]string, 0, len(m))
			for t := range m {
				tsKeys = append(tsKeys, t)
			}
			sort.Strings(tsKeys)
			for _, t := range tsKeys {
				pts = append(pts, ExecSeriesPoint{T: t, N: m[t]})
			}
		}
		out = append(out, ExecSeriesEntry{Key: key, Points: pts})
	}
	return out, nil
}

// ExecutionsPage returns one keyset page of Executions (ts desc, conversation_id, path, repo_id),
// the shape counts over the whole filtered window, and whether more rows follow. shapes filters rows
// only, not counts. It reads at most limit+1 rows and never loads the whole window into Go.
func (t *Tenant) ExecutionsPage(ctx context.Context, f AnalyticsFilter, shapes []string, cur *ExecCursor, limit int) ([]ExecRow, map[string]int, bool, error) {
	w, args := f.factWhere()
	cte := `
	WITH b AS (
		SELECT repo_id, conversation_id, path, harness, ts, plan,
			ROW_NUMBER() OVER (PARTITION BY repo_id, conversation_id, path ORDER BY ts, rowid) AS rn
		FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + `)`
	cnt := map[string]int{"complete": 0, "unreported": 0, "started": 0}
	crows, err := t.rdb.QueryContext(ctx, cte+`
	SELECT `+execShapeSQL+` AS shape, COUNT(*) FROM b WHERE rn = 1 GROUP BY shape`, args...)
	if err != nil {
		return nil, nil, false, err
	}
	for crows.Next() {
		var shape string
		var n int
		if err := crows.Scan(&shape, &n); err != nil {
			crows.Close()
			return nil, nil, false, err
		}
		cnt[shape] = n
	}
	if err := crows.Err(); err != nil {
		crows.Close()
		return nil, nil, false, err
	}
	crows.Close()

	shapeClause, shapeArgs := execShapeWhere(shapes)
	q := cte + `
	SELECT repo_id, plan, conversation_id, path, harness, ts, ` + execShapeSQL + `
	FROM b WHERE rn = 1` + shapeClause
	pargs := append([]any{}, args...)
	pargs = append(pargs, shapeArgs...)
	if cur != nil && len(cur.Key) >= 3 {
		q += ` AND (ts < ? OR (ts = ? AND (conversation_id, path, repo_id) > (?, ?, ?)))`
		pargs = append(pargs, cur.TS, cur.TS, cur.Key[0], cur.Key[1], cur.Key[2])
	}
	q += ` ORDER BY ts DESC, conversation_id, path, repo_id LIMIT ?`
	pargs = append(pargs, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, pargs...)
	if err != nil {
		return nil, nil, false, err
	}
	defer rows.Close()
	var out []ExecRow
	for rows.Next() {
		var r ExecRow
		if err := rows.Scan(&r.RepoID, &r.Plan, &r.ConversationID, &r.BriefPath, &r.Harness, &r.TS, &r.Shape); err != nil {
			return nil, nil, false, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, cnt, more, nil
}

// Conversations aggregates the filtered in-window facts per conversation.
func (t *Tenant) Conversations(ctx context.Context, f AnalyticsFilter) ([]ConvRow, error) {
	w, args := f.factWhere()
	rows, err := t.rdb.QueryContext(ctx, `SELECT conversation_id, harness, repo_id, type, ts, kind FROM facts WHERE `+w, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type acc struct {
		row       ConvRow
		harness   map[string]int
		repos, ks map[string]bool
	}
	m := map[string]*acc{}
	for rows.Next() {
		var conv, h, repo, typ, kind string
		var ts float64
		if err := rows.Scan(&conv, &h, &repo, &typ, &ts, &kind); err != nil {
			return nil, err
		}
		a := m[conv]
		if a == nil {
			a = &acc{row: ConvRow{ConversationID: conv, FirstTS: ts, LastTS: ts}, harness: map[string]int{}, repos: map[string]bool{}, ks: map[string]bool{}}
			m[conv] = a
		}
		a.row.FirstTS = min(a.row.FirstTS, ts)
		a.row.LastTS = max(a.row.LastTS, ts)
		a.harness[h]++
		a.repos[repo] = true
		if kind != "" {
			a.ks[kind] = true
		}
		switch typ {
		case "hook_event":
			a.row.HookEvents++
		case "artifact_version":
			a.row.ArtifactVersions++
		case "commit":
			a.row.Commits++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []ConvRow
	for _, a := range m {
		best := 0
		for h, n := range a.harness { // most frequent; ties to the smaller name
			if n > best || (n == best && h < a.row.Harness) {
				a.row.Harness, best = h, n
			}
		}
		for r := range a.repos {
			a.row.Repos = append(a.row.Repos, r)
		}
		for k := range a.ks {
			a.row.Kinds = append(a.row.Kinds, k)
		}
		sort.Strings(a.row.Repos)
		sort.Strings(a.row.Kinds)
		out = append(out, a.row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastTS != out[j].LastTS {
			return out[i].LastTS > out[j].LastTS
		}
		return out[i].ConversationID < out[j].ConversationID
	})
	if err := t.fillConvUsage(ctx, f, out); err != nil {
		return nil, err
	}
	return out, nil
}

// ConversationsPage returns one keyset page of per-conversation aggregates (last_ts desc,
// conversation_id), and whether more rows follow. Aggregation and keyset run in SQL; the page's
// harness histogram is fetched with one extra grouped query for the page's conversation ids.
func (t *Tenant) ConversationsPage(ctx context.Context, f AnalyticsFilter, cur *ConvCursor, limit int) ([]ConvRow, bool, error) {
	w, args := f.factWhere()
	q := `SELECT conversation_id, MIN(ts), MAX(ts),
		SUM(CASE WHEN type='hook_event' THEN 1 ELSE 0 END),
		SUM(CASE WHEN type='artifact_version' THEN 1 ELSE 0 END),
		SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END),
		COUNT(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END),
		group_concat(DISTINCT repo_id),
		group_concat(DISTINCT CASE WHEN kind <> '' THEN kind END)
	FROM facts WHERE ` + w + ` GROUP BY conversation_id`
	pargs := append([]any{}, args...)
	if cur != nil {
		q += ` HAVING (MAX(ts) < ?) OR (MAX(ts) = ? AND conversation_id > ?)`
		pargs = append(pargs, cur.TS, cur.TS, cur.ConversationID)
	}
	q += ` ORDER BY MAX(ts) DESC, conversation_id LIMIT ?`
	pargs = append(pargs, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, pargs...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []ConvRow
	for rows.Next() {
		var r ConvRow
		var repos, kinds sql.NullString
		if err := rows.Scan(&r.ConversationID, &r.FirstTS, &r.LastTS, &r.HookEvents, &r.ArtifactVersions, &r.Commits, &r.DistinctContent, &repos, &kinds); err != nil {
			return nil, false, err
		}
		r.Repos = splitConcat(repos)
		r.Kinds = splitConcat(kinds)
		sort.Strings(r.Repos)
		sort.Strings(r.Kinds)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	if err := t.fillHarness(ctx, w, args, out); err != nil {
		return nil, false, err
	}
	if err := t.fillConvUsage(ctx, f, out); err != nil {
		return nil, false, err
	}
	return out, more, nil
}

// splitConcat splits a group_concat(DISTINCT x) result on its default separator. NULL (no values)
// is nil. The two-argument form with a custom separator is rejected by this driver when DISTINCT
// is present, so the "," default is used; values are repo ids and the fixed kind vocabulary.
func splitConcat(s sql.NullString) []string {
	if !s.Valid {
		return nil
	}
	return strings.Split(s.String, ",")
}

// fillHarness sets each row's Harness to the most frequent harness in the window, ties to the
// smaller name, using one grouped query over just the page's conversation ids.
func (t *Tenant) fillHarness(ctx context.Context, w string, wargs []any, out []ConvRow) error {
	if len(out) == 0 {
		return nil
	}
	ids := make([]string, len(out))
	for i := range out {
		ids[i] = out[i].ConversationID
	}
	args := append([]any{}, wargs...)
	q := `SELECT conversation_id, harness, COUNT(*) FROM facts WHERE ` + w + inList("conversation_id", ids, &args) +
		` GROUP BY conversation_id, harness`
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type hc struct {
		name string
		n    int
	}
	hist := map[string][]hc{}
	for rows.Next() {
		var conv, h string
		var n int
		if err := rows.Scan(&conv, &h, &n); err != nil {
			return err
		}
		hist[conv] = append(hist[conv], hc{h, n})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range out {
		best, bestN := "", -1
		for _, x := range hist[out[i].ConversationID] {
			if x.n > bestN || (x.n == bestN && x.name < best) {
				best, bestN = x.name, x.n
			}
		}
		out[i].Harness = best
	}
	return nil
}

// fillConvUsage sets each row's in-window kept-call usage totals and dominant model, using one
// usageKeptRows fetch scoped to the page's conversation ids.
func (t *Tenant) fillConvUsage(ctx context.Context, f AnalyticsFilter, out []ConvRow) error {
	if len(out) == 0 {
		return nil
	}
	ff := f
	ff.ConversationIDs = make([]string, len(out))
	for i := range out {
		ff.ConversationIDs[i] = out[i].ConversationID
	}
	kept, err := t.usageKeptRows(ctx, ff)
	if err != nil {
		return err
	}
	type acc struct {
		modelCalls, unpriced                                                    int
		tokensIn, tokensOut, tokensCacheRead, tokensCacheWrite, tokensReasoning int64
		cost                                                                    float64
		models                                                                  map[string]int
	}
	m := map[string]*acc{}
	for _, r := range kept {
		a := m[r.convID]
		if a == nil {
			a = &acc{models: map[string]int{}}
			m[r.convID] = a
		}
		a.modelCalls++
		a.tokensIn += r.tokIn
		a.tokensOut += r.tokOut
		a.tokensCacheRead += r.tokCacheRead
		a.tokensCacheWrite += r.tokCacheWrite
		a.tokensReasoning += r.tokReasoning
		usd, priced := Cost(r.harness, r.model, r.tokens(), r.costReported)
		a.cost += usd
		if !priced {
			a.unpriced++
		}
		if r.model != "" {
			a.models[r.model]++
		}
	}
	for i := range out {
		a := m[out[i].ConversationID]
		if a == nil {
			continue
		}
		out[i].Model = dominantModel(a.models)
		out[i].ModelCalls = a.modelCalls
		out[i].UnpricedCalls = a.unpriced
		out[i].CostUSD = roundCost(a.cost)
		out[i].TokensIn = int(a.tokensIn)
		out[i].TokensOut = int(a.tokensOut)
		out[i].TokensCacheRead = int(a.tokensCacheRead)
		out[i].TokensCacheWrite = int(a.tokensCacheWrite)
		out[i].TokensReasoning = int(a.tokensReasoning)
	}
	return nil
}

// exploreFactsQuery is the facts leg of Explore: newest first, ties by row_hash ascending. The
// planner uses facts_ts or facts_ts_harness_event and only reorders ties ("USE TEMP B-TREE FOR
// LAST TERM OF ORDER BY"), never the whole window.
func exploreFactsQuery(where string) string {
	return `SELECT type, ts, harness, repo_id, plan, kind, event,
		CASE WHEN type='hook_event' THEN tool ELSE '' END AS tool,
		norm_event, model, path, conversation_id, source, sha, content_hash,
		tok_in, tok_out, tok_cache_read, tok_cache_write, tok_reasoning, cost_reported
	FROM facts WHERE ` + where + `
	ORDER BY ts DESC, row_hash ASC LIMIT ?`
}

// Explore returns filtered in-window facts and rejections, newest first (rejections by at). Ties
// break by a stable key: row_hash for facts, id for rejections, ascending (so at the same instant
// facts precede rejections). It fetches at most limit+1 from each side, merging them in Go with the
// same tie rule, and reports whether more than limit matched.
func (t *Tenant) Explore(ctx context.Context, f AnalyticsFilter, limit int) ([]ExploreRow, bool, error) {
	rows, more, _, err := t.ExplorePage(ctx, f, nil, limit)
	return rows, more, err
}

// ExplorePage traverses facts and rejections by (ts desc, source type asc, source key asc).
// The first page captures independent receive bounds so later pages cannot grow with late input.
func (t *Tenant) ExplorePage(ctx context.Context, f AnalyticsFilter, cur *ExploreCursor, limit int) ([]ExploreRow, bool, *ExploreCursor, error) {
	if limit < 1 {
		return nil, false, nil, fmt.Errorf("explore limit must be positive")
	}
	if cur == nil {
		cur = &ExploreCursor{}
		if err := t.rdb.QueryRowContext(ctx, `SELECT COALESCE(MAX(received_at),0) FROM facts`).Scan(&cur.FactWatermark); err != nil {
			return nil, false, nil, err
		}
		if err := t.rdb.QueryRowContext(ctx, `SELECT COALESCE(MAX(id),0) FROM rejections`).Scan(&cur.RejectionWatermark); err != nil {
			return nil, false, nil, err
		}
	} else {
		copy := *cur
		cur = &copy
	}
	fw, fargs := f.factWhere()
	rw, rargs := f.rejWhere()

	fq := `SELECT type, ts, harness, repo_id, plan, kind, event,
		CASE WHEN type='hook_event' THEN tool ELSE '' END AS tool,
		norm_event, model, path, conversation_id, source, sha, content_hash,
		tok_in, tok_out, tok_cache_read, tok_cache_write, tok_reasoning, cost_reported, row_hash
	FROM facts WHERE ` + fw + ` AND received_at <= ?`
	fargs = append(fargs, cur.FactWatermark)
	if cur.Type != "" {
		if cur.Type == "fact" {
			fq += ` AND (ts < ? OR (ts = ? AND row_hash > ?))`
			fargs = append(fargs, cur.TS, cur.TS, cur.Key)
		} else {
			fq += ` AND ts < ?`
			fargs = append(fargs, cur.TS)
		}
	}
	fq += ` ORDER BY ts DESC, row_hash ASC LIMIT ?`
	frows, err := t.rdb.QueryContext(ctx, fq, append(fargs, limit+1)...)
	if err != nil {
		return nil, false, nil, err
	}
	defer frows.Close()
	var facts []ExploreRow
	var hashes []string
	for frows.Next() {
		var r ExploreRow
		var contentHash, rowHash string
		var tokIn, tokOut, tokCR, tokCW, tokReas int64
		var cost sql.NullFloat64
		if err := frows.Scan(&r.Type, &r.TS, &r.Harness, &r.RepoID, &r.Plan, &r.Kind, &r.Event, &r.Tool,
			&r.NormEvent, &r.Model, &r.Path, &r.ConversationID, &r.Source, &r.SHA, &contentHash,
			&tokIn, &tokOut, &tokCR, &tokCW, &tokReas, &cost, &rowHash); err != nil {
			return nil, false, nil, err
		}
		if r.Type == "hook_event" && r.NormEvent == "usage" {
			var reported *float64
			if cost.Valid {
				v := cost.Float64
				reported = &v
			}
			usd, priced := Cost(r.Harness, r.Model, Tokens{In: tokIn, Out: tokOut, CacheRead: tokCR, CacheWrite: tokCW, Reasoning: tokReas}, reported)
			r.CostUSD = &usd
			r.Priced = priced
		}
		facts = append(facts, r)
		hashes = append(hashes, contentHash)
		r.PageKey = rowHash
		r.PageType = "fact"
		facts[len(facts)-1] = r
	}
	if err := frows.Err(); err != nil {
		return nil, false, nil, err
	}

	rq := `SELECT at, wf_plan(path), wf_kind(path), path, conversation_id, stage, id
		FROM rejections WHERE ` + rw + ` AND id <= ?`
	rargs = append(rargs, cur.RejectionWatermark)
	if cur.Type != "" {
		if cur.Type == "rejection" {
			id, _ := strconv.ParseInt(cur.Key, 10, 64)
			rq += ` AND (at < ? OR (at = ? AND id > ?))`
			rargs = append(rargs, cur.NS, cur.NS, id)
		} else if cur.Type == "fact" {
			rq += ` AND at <= ?`
			rargs = append(rargs, cur.NS)
		} else {
			rq += ` AND at < ?`
			rargs = append(rargs, int64(cur.TS*1e9))
		}
	}
	rq += ` ORDER BY at DESC, id ASC LIMIT ?`
	rrows, err := t.rdb.QueryContext(ctx, rq, append(rargs, limit+1)...)
	if err != nil {
		return nil, false, nil, err
	}
	defer rrows.Close()
	var rejs []ExploreRow
	for rrows.Next() {
		var at, id int64
		r := ExploreRow{Type: "rejection"}
		if err := rrows.Scan(&at, &r.Plan, &r.Kind, &r.Path, &r.ConversationID, &r.RejectionStage, &id); err != nil {
			return nil, false, nil, err
		}
		r.TS = float64(at) / 1e9
		r.PageKey = strconv.FormatInt(id, 10)
		r.PageNanos = at
		r.PageType = "rejection"
		rejs = append(rejs, r)
	}
	if err := rrows.Err(); err != nil {
		return nil, false, nil, err
	}

	page := make([]ExploreRow, 0, limit+1)
	pageHashes := make([]string, 0, limit+1)
	i, j := 0, 0
	for len(page) < limit+1 && (i < len(facts) || j < len(rejs)) {
		if i < len(facts) && (j >= len(rejs) || facts[i].TS >= rejs[j].TS) {
			page = append(page, facts[i])
			pageHashes = append(pageHashes, hashes[i])
			i++
		} else {
			page = append(page, rejs[j])
			pageHashes = append(pageHashes, "")
			j++
		}
	}
	if err := t.fillVerdicts(ctx, pageHashes, page); err != nil {
		return nil, false, nil, err
	}
	truncated := len(page) > limit
	if truncated {
		page = page[:limit]
	}
	if truncated {
		last := page[len(page)-1]
		ns := last.PageNanos
		if last.PageType == "fact" {
			ns = int64(math.Round(last.TS * 1e9))
		}
		cur.TS, cur.NS, cur.Type, cur.Key = last.TS, ns, last.PageType, last.PageKey
	} else {
		cur = nil
	}
	return page, truncated, cur, nil
}

// fillVerdicts sets each page row's ScreenVerdict to the latest screen (by id) for its content
// hash, only for the rows actually on the page.
func (t *Tenant) fillVerdicts(ctx context.Context, hashes []string, page []ExploreRow) error {
	seen := map[string]bool{}
	var uniq []string
	for _, h := range hashes {
		if h != "" && !seen[h] {
			seen[h] = true
			uniq = append(uniq, h)
		}
	}
	if len(uniq) == 0 {
		return nil
	}
	args := make([]any, len(uniq))
	for i, h := range uniq {
		args[i] = h
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT content_hash, verdict FROM screens s WHERE s.content_hash IN (?`+
		strings.Repeat(",?", len(uniq)-1)+`)
		AND s.id = (SELECT max(id) FROM screens WHERE content_hash = s.content_hash)`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	verdict := map[string]string{}
	for rows.Next() {
		var h, v string
		if err := rows.Scan(&h, &v); err != nil {
			return err
		}
		verdict[h] = v
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range page {
		if h := hashes[i]; h != "" {
			page[i].ScreenVerdict = verdict[h]
		}
	}
	return nil
}
