package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// init registers the usage-measure executor 3-04 left nil.
func init() { usageQuery = usageQueryImpl }

// usageRowsWhere returns a "WITH usage_u AS (...), kept AS (...)" fragment selecting the
// deduplicated usage calls (facts with type='hook_event' AND norm_event='usage') matching f,
// and the arguments for its placeholders. f is applied verbatim through factWhere, so callers
// that go through Query must pass the filter after measureDef.applyFilters has cleared the
// non-usage dimensions.
//
// A Claude call is deduplicated by its message id, json_extract(raw,'$.backfill.ref'): rows are
// grouped by (conversation_id, id) and only the row with the largest tok_out (ties broken by the
// lowest row_hash) survives. Rows with no id -- other harnesses, and Claude facts captured live,
// whose stored envelope has no payload and therefore no id -- are each their own call.
func usageRowsWhere(f AnalyticsFilter) (string, []any) {
	where, args := f.factWhere()
	mid := "CASE WHEN harness = 'claude' THEN json_extract(raw, '$.backfill.ref') END"
	q := "WITH usage_u AS (SELECT row_hash, harness, repo_id, model, conversation_id, ts, tok_in, tok_out, " +
		"tok_cache_read, tok_cache_write, tok_reasoning, cost_reported, " + mid + " AS _mid FROM facts " +
		"WHERE type = 'hook_event' AND norm_event = 'usage' AND " + where + "), " +
		"kept AS (SELECT * FROM (" +
		"SELECT *, ROW_NUMBER() OVER (PARTITION BY conversation_id, _mid " +
		"ORDER BY tok_out DESC, row_hash ASC) AS _rn FROM usage_u) " +
		"WHERE _mid IS NULL OR _mid = '' OR _rn = 1)"
	return q, args
}

// usageRow is one kept usage call fetched from the kept CTE.
type usageRow struct {
	harness, repoID, model, convID                           string
	ts                                                       float64
	tokIn, tokOut, tokCacheRead, tokCacheWrite, tokReasoning int64
	costReported                                             *float64
	actionKind, actionPlan, actionPhase, actionSubject       string
	actionPR, actionSource, actionBucket                     string
}

func (r usageRow) dim(d string) string {
	switch d {
	case "harness":
		return r.harness
	case "repo_id":
		return r.repoID
	case "model":
		return r.model
	case "conversation_id":
		return r.convID
	case "action_kind":
		return r.actionKind
	case "action_plan":
		return r.actionPlan
	case "action_phase":
		return r.actionPhase
	case "action_subject":
		return r.actionSubject
	case "action_pr":
		return r.actionPR
	case "action_source":
		return r.actionSource
	}
	return ""
}

func (r usageRow) tokens() Tokens {
	return Tokens{In: r.tokIn, Out: r.tokOut, CacheRead: r.tokCacheRead, CacheWrite: r.tokCacheWrite, Reasoning: r.tokReasoning}
}

// usageValue is one kept call's contribution to the requested measure.
func usageValue(measure string, r usageRow) float64 {
	switch measure {
	case "model_calls":
		return 1
	case "tokens_in":
		return float64(r.tokIn)
	case "tokens_out":
		return float64(r.tokOut)
	case "tokens_cache_read":
		return float64(r.tokCacheRead)
	case "tokens_cache_write":
		return float64(r.tokCacheWrite)
	case "tokens_reasoning":
		return float64(r.tokReasoning)
	case "cost_usd":
		usd, _ := Cost(r.harness, r.model, r.tokens(), r.costReported)
		return usd
	case "unpriced_calls":
		if _, ok := Cost(r.harness, r.model, r.tokens(), r.costReported); ok {
			return 0
		}
		return 1
	case "sessions":
		return 1
	}
	return 0
}

func usageQueryImpl(ctx context.Context, t *Tenant, f AnalyticsFilter, p QueryParams) (QueryResult, error) {
	def, ok := measureByName(p.Measure)
	if !ok || !def.usage {
		return QueryResult{}, fmt.Errorf("unknown measure %q", p.Measure)
	}
	bucket := p.Bucket
	if bucket == "" {
		bucket = "none"
	}
	validBucket := false
	for _, b := range Buckets {
		if b == bucket {
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
	if p.hasActionFilters() && !isActionMeasure(p.Measure) {
		return QueryResult{}, fmt.Errorf("action filters unsupported for %s: %w", p.Measure, ErrUnsupported)
	}
	top := p.Top
	if top <= 0 {
		top = 20
	}
	if top > 100 {
		top = 100
	}
	res := QueryResult{Measure: p.Measure, Bucket: bucket, Dims: append([]string{}, p.Dims...)}
	f2, ignored := def.applyFilters(f)
	res.Ignored = ignored
	rows, err := t.usageKeptRows(ctx, f2)
	if err != nil {
		return QueryResult{}, err
	}
	if hasActionDim(p.Dims) || p.hasActionFilters() {
		if err := t.attachUsageActions(ctx, rows); err != nil {
			return QueryResult{}, err
		}
		rows = filterUsageActions(rows, p)
	}
	val := func(r usageRow) float64 { return usageValue(p.Measure, r) }

	tops := map[string][]string{}
	for _, d := range p.Dims {
		if d == "hour_of_day" || d == "weekday" {
			continue
		}
		totals := map[string]float64{}
		if p.Measure == "sessions" {
			sets := map[string]map[string]bool{}
			for _, r := range rows {
				k := r.dim(d)
				if sets[k] == nil {
					sets[k] = map[string]bool{}
				}
				sets[k][r.convID] = true
			}
			for k, s := range sets {
				totals[k] = float64(len(s))
			}
		} else {
			for _, r := range rows {
				totals[r.dim(d)] += val(r)
			}
		}
		tops[d] = rankKeys(totals, top)
	}

	loc := f.TZ
	if loc == nil {
		loc = time.UTC
	}
	type usageGroup struct {
		t             string
		k             []string
		v             float64
		conversations map[string]bool
	}
	groups := map[string]*usageGroup{}
	var order []string
	for _, r := range rows {
		kv := make([]string, len(p.Dims))
		for i, d := range p.Dims {
			switch d {
			case "hour_of_day":
				kv[i] = localKey(usageHourKey(r.ts), loc, "hour_of_day")
			case "weekday":
				kv[i] = localKey(usageHourKey(r.ts), loc, "weekday")
			default:
				if isActionDim(d) {
					kv[i] = foldActionDim(r.dim(d), tops[d])
				} else {
					kv[i] = foldUsageDim(r.dim(d), tops[d])
				}
			}
		}
		tv := usageBucketKey(r.ts, loc, bucket)
		gk := tv + "\x00" + strings.Join(kv, "\x00")
		g := groups[gk]
		if g == nil {
			g = &usageGroup{t: tv, k: kv}
			if p.Measure == "sessions" {
				g.conversations = map[string]bool{}
			}
			groups[gk] = g
			order = append(order, gk)
		}
		if p.Measure == "sessions" {
			g.conversations[r.convID] = true
		} else {
			g.v += val(r)
		}
	}
	out := make([]QueryRow, 0, len(order))
	for _, gk := range order {
		g := groups[gk]
		if p.Measure == "sessions" {
			g.v = float64(len(g.conversations))
		}
		out = append(out, QueryRow{T: g.t, K: g.k, V: g.v})
	}
	sortRows(out)
	if len(out) > queryRowCap {
		out = out[:queryRowCap]
		res.Truncated = true
	}
	res.Rows = out
	return res, nil
}

func isActionMeasure(measure string) bool {
	return usageMeasures[measure]
}

type usageAction struct {
	kind, subjectType, subjectID, phase, pr, source string
	start, end                                      *float64
	accepted, effective                             bool
}

func (a usageAction) contains(ts float64) bool {
	return a.accepted && a.effective && (a.start == nil || ts >= *a.start) && (a.end == nil || ts < *a.end)
}

func (t *Tenant) attachUsageActions(ctx context.Context, rows []usageRow) error {
	convs := map[string]bool{}
	for _, r := range rows {
		convs[r.convID] = true
	}
	if len(convs) == 0 {
		return nil
	}
	ids := make([]string, 0, len(convs))
	for id := range convs {
		ids = append(ids, id)
	}
	actionsByConv := map[string][]usageAction{}
	for start := 0; start < len(ids); start += 400 {
		end := start + 400
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		q := `SELECT conversation_id,source,status,kind,subject_type,subject_id,phase,pr,segment_start,segment_end,effective FROM session_actions WHERE conversation_id IN (` + strings.TrimRight(strings.Repeat("?,", len(chunk)), ",") + `)`
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		got, err := t.rdb.QueryContext(ctx, q, args...)
		if err != nil {
			return err
		}
		for got.Next() {
			var conv, source, status, kind, typ, subject, phase, pr string
			var startAt, endAt sql.NullFloat64
			var effective int
			if err := got.Scan(&conv, &source, &status, &kind, &typ, &subject, &phase, &pr, &startAt, &endAt, &effective); err != nil {
				got.Close()
				return err
			}
			a := usageAction{kind: kind, subjectType: typ, subjectID: subject, phase: phase, pr: pr, source: source, accepted: status == "accepted", effective: effective != 0}
			if startAt.Valid {
				v := startAt.Float64
				a.start = &v
			}
			if endAt.Valid {
				v := endAt.Float64
				a.end = &v
			}
			actionsByConv[conv] = append(actionsByConv[conv], a)
		}
		if err := got.Err(); err != nil {
			got.Close()
			return err
		}
		got.Close()
	}
	for i := range rows {
		acts := actionsByConv[rows[i].convID]
		accepted, rejected := false, false
		var active *usageAction
		for j := range acts {
			a := &acts[j]
			if a.accepted {
				accepted = true
			} else {
				rejected = true
			}
			if a.contains(rows[i].ts) {
				active = a
				break
			}
		}
		if active == nil {
			bucket := "(untagged)"
			if !accepted && rejected {
				bucket = "(rejected)"
			}
			rows[i].actionBucket = bucket
			rows[i].actionKind, rows[i].actionPlan, rows[i].actionPhase = bucket, bucket, bucket
			rows[i].actionSubject, rows[i].actionPR, rows[i].actionSource = bucket, bucket, bucket
			continue
		}
		rows[i].actionBucket = "tagged"
		rows[i].actionKind = noneValue(active.kind)
		rows[i].actionPlan = "(none)"
		if active.subjectType == "plan" {
			if marker := strings.LastIndex(active.subjectID, ":plan/"); marker >= 0 {
				rows[i].actionPlan = noneValue(active.subjectID[marker+len(":plan/"):])
			}
		}
		rows[i].actionPhase = noneValue(active.phase)
		rows[i].actionSubject = noneValue(active.subjectID)
		rows[i].actionPR = noneValue(active.pr)
		rows[i].actionSource = noneValue(active.source)
	}
	return nil
}

func noneValue(v string) string {
	if v == "" {
		return "(none)"
	}
	return v
}

func filterUsageActions(rows []usageRow, p QueryParams) []usageRow {
	if !p.hasActionFilters() {
		return rows
	}
	match := func(values []string, value string) bool {
		if len(values) == 0 {
			return true
		}
		for _, v := range values {
			if v == value {
				return true
			}
		}
		return false
	}
	out := rows[:0]
	for _, r := range rows {
		if r.actionBucket != "tagged" {
			continue
		}
		if !match(p.ActionKinds, r.actionKind) || !match(p.ActionPlans, r.actionPlan) || !match(p.ActionPhases, r.actionPhase) || !match(p.ActionSubjects, r.actionSubject) || !match(p.ActionPRs, r.actionPR) || !match(p.ActionSources, r.actionSource) {
			continue
		}
		out = append(out, r)
	}
	return out
}

func foldActionDim(value string, keys []string) string {
	if value == "(untagged)" || value == "(rejected)" {
		return value
	}
	return foldUsageDim(value, keys)
}

func (t *Tenant) usageKeptRows(ctx context.Context, f AnalyticsFilter) ([]usageRow, error) {
	cte, args := usageRowsWhere(f)
	rows, err := t.rdb.QueryContext(ctx, cte+
		" SELECT harness, repo_id, model, conversation_id, ts, tok_in, tok_out, tok_cache_read, tok_cache_write, tok_reasoning, cost_reported FROM kept", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []usageRow
	for rows.Next() {
		var r usageRow
		var cost sql.NullFloat64
		if err := rows.Scan(&r.harness, &r.repoID, &r.model, &r.convID, &r.ts,
			&r.tokIn, &r.tokOut, &r.tokCacheRead, &r.tokCacheWrite, &r.tokReasoning, &cost); err != nil {
			return nil, err
		}
		if cost.Valid {
			v := cost.Float64
			r.costReported = &v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// usageHourKey is the UTC hour-truncated key 3-04's hourKeyExpr produces for a fact's ts.
func usageHourKey(sec float64) string {
	return time.Unix(int64(sec), 0).UTC().Format("2006-01-02T15:00:00") + "Z"
}

// usageBucketKey matches 3-04's SQL bucketing in UTC and its localBucket in another location.
func usageBucketKey(sec float64, loc *time.Location, bucket string) string {
	if bucket == "none" {
		return ""
	}
	if loc == nil || loc == time.UTC {
		tm := time.Unix(int64(sec), 0).UTC()
		y, m, d := tm.Date()
		switch bucket {
		case "hour":
			return tm.Format("2006-01-02T15:00:00") + "Z"
		case "day":
			return fmt.Sprintf("%04d-%02d-%02dT00:00:00Z", y, int(m), d)
		case "week":
			wd := (int(tm.Weekday()) + 6) % 7
			mon := time.Date(y, m, d, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -wd)
			return mon.Format("2006-01-02") + "T00:00:00Z"
		case "month":
			return fmt.Sprintf("%04d-%02d-01T00:00:00Z", y, int(m))
		}
	}
	return localBucket(usageHourKey(sec), loc, bucket)
}

// foldUsageDim mirrors 3-04's foldExpr: a key outside the top N folds to "__other__".
func foldUsageDim(v string, keys []string) string {
	if len(keys) == 0 {
		return "__other__"
	}
	for _, k := range keys {
		if k == v {
			return v
		}
	}
	return "__other__"
}
