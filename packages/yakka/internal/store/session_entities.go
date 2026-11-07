package store

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

type SessionEntityRow struct {
	ID              string
	Measures        map[string]float64
	FirstTS, LastTS float64
}

var sessionSortMeasures = map[string]bool{"hook_events": true, "artifact_versions": true, "commits": true, "distinct_content": true, "model_calls": true, "unpriced_calls": true, "cost_usd": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true, "first_ts": true, "last_ts": true, "duration_s": true}

func SessionSortMeasure(name string) bool { return sessionSortMeasures[name] }

func sessionAggregateCTE(f AnalyticsFilter) (string, []any) {
	usageCTE, usageArgs := usageRowsWhere(f)
	factWhere, factArgs := f.factWhere()
	args := append(append([]any{}, usageArgs...), factArgs...)
	query := usageCTE + `, usage AS (
	 SELECT conversation_id,COUNT(*) model_calls,SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced_calls,
	 COALESCE(SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)),0) cost_usd,
	 COALESCE(SUM(tok_in),0) tokens_in,COALESCE(SUM(tok_out),0) tokens_out,COALESCE(SUM(tok_cache_read),0) tokens_cache_read,
	 COALESCE(SUM(tok_cache_write),0) tokens_cache_write,COALESCE(SUM(tok_reasoning),0) tokens_reasoning FROM kept GROUP BY conversation_id
	), base AS (SELECT conversation_id,MIN(ts) first_ts,MAX(ts) last_ts,
	 SUM(CASE WHEN type='hook_event' THEN 1 ELSE 0 END) hook_events,
	 SUM(CASE WHEN type='artifact_version' THEN 1 ELSE 0 END) artifact_versions,
	 SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END) commits,
	 COUNT(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END) distinct_content
	 FROM facts WHERE ` + factWhere + ` GROUP BY conversation_id
	), result AS (SELECT base.*,COALESCE(usage.model_calls,0) model_calls,COALESCE(usage.unpriced_calls,0) unpriced_calls,
	 COALESCE(usage.cost_usd,0) cost_usd,COALESCE(usage.tokens_in,0) tokens_in,COALESCE(usage.tokens_out,0) tokens_out,
	 COALESCE(usage.tokens_cache_read,0) tokens_cache_read,COALESCE(usage.tokens_cache_write,0) tokens_cache_write,COALESCE(usage.tokens_reasoning,0) tokens_reasoning
	 FROM base LEFT JOIN usage USING(conversation_id)), result2 AS (SELECT result.*,(last_ts-first_ts) duration_s FROM result), filtered AS (SELECT * FROM result2 WHERE 1=1` + sessionRangeWhere(f.SessionRanges, &args) + `)`
	return query, args
}

// SessionAggregate runs scalar or histogram aggregates in SQLite. It never materializes the
// session population in Go; the response is bounded by the operation (at most ten bins).
func (t *Tenant) SessionAggregate(ctx context.Context, f AnalyticsFilter, stat, field string) (map[string]any, error) {
	if stat != "count" && !sessionSortMeasures[field] {
		return nil, fmt.Errorf("unsupported session aggregate field")
	}
	if stat != "count" && stat != "sum" && stat != "percentiles" && stat != "histogram" {
		return nil, fmt.Errorf("unsupported session aggregate stat")
	}
	if stat == "sum" && (field == "first_ts" || field == "last_ts") {
		return nil, fmt.Errorf("unsupported session sum field")
	}
	cte, args := sessionAggregateCTE(f)
	source := "filtered"
	if stat == "count" {
		var n int
		err := t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(*) FROM filtered`, args...).Scan(&n)
		return map[string]any{"stat": "count", "value": n}, err
	}
	if stat != "count" && field == "cost_usd" {
		cte += `, eligible AS (SELECT * FROM filtered WHERE model_calls=0 OR model_calls>unpriced_calls)`
		source = "eligible"
	}
	switch stat {
	case "sum":
		var value sql.NullFloat64
		err := t.rdb.QueryRowContext(ctx, cte+` SELECT SUM(`+field+`) FROM `+source, args...).Scan(&value)
		if !value.Valid {
			return map[string]any{"stat": "sum", "field": field, "value": nil, "eligible_n": 0}, err
		}
		var n int
		_ = t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(*) FROM `+source, args...).Scan(&n)
		return map[string]any{"stat": "sum", "field": field, "value": value.Float64, "eligible_n": n}, err
	case "percentiles":
		var n int
		if err := t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(`+field+`) FROM `+source, args...).Scan(&n); err != nil {
			return nil, err
		}
		out := map[string]any{"stat": "percentiles", "field": field, "eligible_n": n}
		if n == 0 {
			out["p25"], out["p50"], out["p75"] = nil, nil, nil
			return out, nil
		}
		for name, rank := range map[string]int{"p25": max(1, (n+3)/4), "p50": max(1, (n+1)/2), "p75": max(1, (3*n+3)/4)} {
			var v float64
			if err := t.rdb.QueryRowContext(ctx, cte+`, ranked AS (SELECT `+field+`,ROW_NUMBER() OVER (ORDER BY `+field+`) rn FROM `+source+` WHERE `+field+` IS NOT NULL) SELECT `+field+` FROM ranked WHERE rn=?`, append(append([]any{}, args...), rank)...).Scan(&v); err != nil {
				return nil, err
			}
			out[name] = v
		}
		return out, nil
	default:
		bucket := `CASE WHEN stats.hi=stats.lo THEN 1 ELSE MIN(10,CAST((` + field + `-stats.lo)/(stats.hi-stats.lo)*10 AS INTEGER)+1) END`
		rows, err := t.rdb.QueryContext(ctx, cte+`, stats AS (SELECT MIN(`+field+`) lo,MAX(`+field+`) hi FROM `+source+` WHERE `+field+` IS NOT NULL), binned AS (SELECT `+field+`,`+bucket+` bin FROM `+source+` CROSS JOIN stats WHERE `+field+` IS NOT NULL) SELECT bin,MIN(`+field+`),MAX(`+field+`),COUNT(*) FROM binned GROUP BY bin ORDER BY bin`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		bins := []map[string]any{}
		eligible := 0
		for rows.Next() {
			var b int
			var lo, hi float64
			var n int
			if err := rows.Scan(&b, &lo, &hi, &n); err != nil {
				return nil, err
			}
			bins = append(bins, map[string]any{"bin": b, "lo": lo, "hi": hi, "n": n})
			eligible += n
		}
		return map[string]any{"stat": "histogram", "field": field, "bins": bins, "eligible_n": eligible}, rows.Err()
	}
}

// SessionCostCoverage reports priced eligibility and lower-bound sessions without materializing
// session rows in Go.
func (t *Tenant) SessionCostCoverage(ctx context.Context, f AnalyticsFilter) (eligible, lowerBound int, err error) {
	cte, args := sessionAggregateCTE(f)
	err = t.rdb.QueryRowContext(ctx, cte+` SELECT COALESCE(SUM(CASE WHEN model_calls=0 OR model_calls>unpriced_calls THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN model_calls>0 AND unpriced_calls>0 THEN 1 ELSE 0 END),0) FROM filtered`, args...).Scan(&eligible, &lowerBound)
	return
}

// SessionEntitiesPage pages a selected-window population in SQL for every published measure sort.
func (t *Tenant) SessionEntitiesPage(ctx context.Context, f AnalyticsFilter, sortBy string, desc bool, cur *ConvCursor, limit int) ([]SessionEntityRow, bool, error) {
	if !sessionSortMeasures[sortBy] && sortBy != "sample_hash" {
		return nil, false, fmt.Errorf("unsupported session sort")
	}
	usageCTE, usageArgs := usageRowsWhere(f)
	factWhere, factArgs := f.factWhere()
	args := append(append([]any{}, usageArgs...), factArgs...)
	usageValue := func(col string) string { return "COALESCE(SUM(" + col + "),0)" }
	query := usageCTE + `, usage AS (
	 SELECT conversation_id,COUNT(*) model_calls,SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced_calls,
	 ` + usageValue("wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)") + ` cost_usd,
	 ` + usageValue("tok_in") + ` tokens_in,` + usageValue("tok_out") + ` tokens_out,` + usageValue("tok_cache_read") + ` tokens_cache_read,
	 ` + usageValue("tok_cache_write") + ` tokens_cache_write,` + usageValue("tok_reasoning") + ` tokens_reasoning
	 FROM kept GROUP BY conversation_id
	), base AS (
	 SELECT conversation_id,MIN(ts) first_ts,MAX(ts) last_ts,
	 SUM(CASE WHEN type='hook_event' THEN 1 ELSE 0 END) hook_events,
	 SUM(CASE WHEN type='artifact_version' THEN 1 ELSE 0 END) artifact_versions,
	 SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END) commits,
	 COUNT(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END) distinct_content
	 FROM facts WHERE ` + factWhere + ` GROUP BY conversation_id
	), result AS (SELECT base.*,COALESCE(usage.model_calls,0) model_calls,COALESCE(usage.unpriced_calls,0) unpriced_calls,
	 COALESCE(usage.cost_usd,0) cost_usd,COALESCE(usage.tokens_in,0) tokens_in,COALESCE(usage.tokens_out,0) tokens_out,
	 COALESCE(usage.tokens_cache_read,0) tokens_cache_read,COALESCE(usage.tokens_cache_write,0) tokens_cache_write,COALESCE(usage.tokens_reasoning,0) tokens_reasoning
	 FROM base LEFT JOIN usage USING(conversation_id)), result2 AS (SELECT result.*,(last_ts-first_ts) duration_s FROM result), filtered AS (SELECT * FROM result2 WHERE 1=1` + sessionRangeWhere(f.SessionRanges, &args) + `) SELECT conversation_id,first_ts,last_ts,hook_events,artifact_versions,commits,distinct_content,
	 model_calls,unpriced_calls,cost_usd,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,tokens_reasoning FROM filtered`
	order := sortBy
	if sortBy == "sample_hash" {
		order = "wf_session_hash(conversation_id)"
	}
	if sortBy == "duration_s" {
		order = "(last_ts-first_ts)"
	}
	direction := "ASC"
	if desc {
		direction = "DESC"
	}
	if cur != nil {
		op := "<"
		if !desc {
			op = ">"
		}
		query += fmt.Sprintf(" WHERE (%s %s ? OR (%s = ? AND conversation_id > ?))", order, op, order)
		args = append(args, cur.TS, cur.TS, cur.ConversationID)
	}
	query += fmt.Sprintf(" ORDER BY %s %s,conversation_id ASC LIMIT ?", order, direction)
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []SessionEntityRow{}
	for rows.Next() {
		var r SessionEntityRow
		vals := make([]float64, 12)
		if err := rows.Scan(&r.ID, &r.FirstTS, &r.LastTS, &vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5], &vals[6], &vals[7], &vals[8], &vals[9], &vals[10], &vals[11]); err != nil {
			return nil, false, err
		}
		r.Measures = map[string]float64{"hook_events": vals[0], "artifact_versions": vals[1], "commits": vals[2], "distinct_content": vals[3], "model_calls": vals[4], "unpriced_calls": vals[5], "cost_usd": vals[6], "tokens_in": vals[7], "tokens_out": vals[8], "tokens_cache_read": vals[9], "tokens_cache_write": vals[10], "tokens_reasoning": vals[11], "first_ts": r.FirstTS, "last_ts": r.LastTS, "duration_s": math.Max(0, r.LastTS-r.FirstTS)}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

// SessionProvenanceFor returns lifetime-derived repo, model and harness lenses for only the
// supplied page of conversation identities. The caller must keep the identity page bounded.
func (t *Tenant) SessionProvenanceFor(ctx context.Context, ids []string) (map[string]SessionProvenance, error) {
	out := make(map[string]SessionProvenance, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	for _, id := range ids {
		out[id] = SessionProvenance{ModelShares: map[string]float64{}}
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT conversation_id,COALESCE(NULLIF(harness,''),'unknown'),COUNT(*) FROM facts WHERE conversation_id IN (`+placeholders(len(ids))+`) GROUP BY conversation_id,COALESCE(NULLIF(harness,''),'unknown')`, stringsToAny(ids)...)
	if err != nil {
		return nil, err
	}
	type counts struct {
		harness map[string]int
		repos   map[string]bool
	}
	all := make(map[string]*counts, len(ids))
	for _, id := range ids {
		all[id] = &counts{harness: map[string]int{}, repos: map[string]bool{}}
	}
	for rows.Next() {
		var id, h string
		var n int
		if err := rows.Scan(&id, &h, &n); err != nil {
			rows.Close()
			return nil, err
		}
		c := all[id]
		c.harness[h] = n
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = t.rdb.QueryContext(ctx, `SELECT DISTINCT conversation_id,repo_id FROM facts WHERE type IN ('artifact_version','commit') AND repo_id!='' AND conversation_id IN (`+placeholders(len(ids))+`) ORDER BY conversation_id,repo_id`, stringsToAny(ids)...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, repo string
		if err := rows.Scan(&id, &repo); err != nil {
			rows.Close()
			return nil, err
		}
		all[id].repos[repo] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for id, c := range all {
		var hs []string
		bestN := -1
		for h, n := range c.harness {
			hs = append(hs, h)
			if n > bestN || (n == bestN && h < out[id].Harness) {
				out[id] = setHarness(out[id], h)
				bestN = n
			}
		}
		sort.Strings(hs)
		out[id] = setHarnesses(out[id], hs)
		for repo := range c.repos {
			out[id] = setRepoValue(out[id], repo)
		}
	}

	f := AnalyticsFilter{From: time.Unix(0, -1<<63).UTC(), To: time.Unix(0, 1<<63-1).UTC(), ConversationIDs: ids}
	usageCTE, usageArgs := usageRowsWhere(f)
	rows, err = t.rdb.QueryContext(ctx, usageCTE+` SELECT conversation_id,model,COUNT(*) FROM kept GROUP BY conversation_id,model`, usageArgs...)
	if err != nil {
		return nil, err
	}
	modelCounts := map[string]map[string]int{}
	totalCalls := map[string]int{}
	for rows.Next() {
		var id, name string
		var n int
		if err := rows.Scan(&id, &name, &n); err != nil {
			rows.Close()
			return nil, err
		}
		totalCalls[id] += n
		if name != "" {
			if modelCounts[id] == nil {
				modelCounts[id] = map[string]int{}
			}
			modelCounts[id][name] = n
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for id := range out {
		x := out[id]
		if len(x.Repos) == 0 {
			x.Repo = "(none)"
			x.RepoAttribution = "none"
		} else if len(x.Repos) == 1 {
			x.Repo = x.Repos[0]
			x.RepoAttribution = "single"
		} else {
			x.Repo = "(multi)"
			x.RepoAttribution = "multi"
		}
		if totalCalls[id] == 0 {
			x.Model = "(none)"
		} else if len(modelCounts[id]) == 0 {
			x.Model = "unknown"
		} else {
			best, n := "", 0
			for m, c := range modelCounts[id] {
				x.ModelShares[m] = float64(c) / float64(totalCalls[id])
				if c > n || (c == n && (best == "" || m < best)) {
					best, n = m, c
				}
			}
			if float64(n)/float64(totalCalls[id]) >= .8 {
				x.Model = best
			} else {
				x.Model = "(mixed)"
			}
		}
		if len(x.Harnesses) > 1 {
			x.HarnessMixed = true
		}
		out[id] = x
	}
	return out, nil
}

// ConversationCount reports the full in-window session population without loading its identities.
func (t *Tenant) ConversationCount(ctx context.Context, f AnalyticsFilter) (int, error) {
	if len(f.SessionRanges) > 0 {
		a, err := t.SessionAggregate(ctx, f, "count", "")
		if err != nil {
			return 0, err
		}
		return a["value"].(int), nil
	}
	w, args := f.factWhere()
	var n int
	err := t.rdb.QueryRowContext(ctx, `SELECT count(DISTINCT conversation_id) FROM facts WHERE `+w, args...).Scan(&n)
	return n, err
}

func sessionRangeWhere(ranges []SessionRange, args *[]any) string {
	var w strings.Builder
	for _, r := range ranges {
		if !sessionSortMeasures[r.Measure] {
			continue
		}
		w.WriteString(" AND ")
		w.WriteString(r.Measure)
		w.WriteString(" IS NOT NULL")
		if r.Measure == "cost_usd" {
			w.WriteString(" AND (model_calls=0 OR model_calls>unpriced_calls)")
		}
		if r.Lo != nil {
			w.WriteString(" AND ")
			w.WriteString(r.Measure)
			w.WriteString(" >= ?")
			*args = append(*args, *r.Lo)
		}
		if r.Hi != nil {
			w.WriteString(" AND ")
			w.WriteString(r.Measure)
			w.WriteString(" <= ?")
			*args = append(*args, *r.Hi)
		}
	}
	return w.String()
}

func (t *Tenant) SessionCallConversationCount(ctx context.Context, f AnalyticsFilter) (int, error) {
	cte, args := usageRowsWhere(f)
	var n int
	err := t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(DISTINCT conversation_id) FROM kept`, args...).Scan(&n)
	return n, err
}

// AnalyticsCoverage reports tenant-wide facts and derived-session coverage without returning facts.
func (t *Tenant) AnalyticsCoverage(ctx context.Context) (map[string]any, error) {
	firstLast := map[string]any{}
	rows, err := t.rdb.QueryContext(ctx, `SELECT type,MIN(ts),MAX(ts),MAX(received_at) FROM facts GROUP BY type ORDER BY type`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var typ string
		var lo, hi sql.NullFloat64
		var received sql.NullInt64
		if err := rows.Scan(&typ, &lo, &hi, &received); err != nil {
			rows.Close()
			return nil, err
		}
		entry := map[string]any{}
		if lo.Valid {
			entry["first_ts"] = lo.Float64
		}
		if hi.Valid {
			entry["last_ts"] = hi.Float64
		}
		if received.Valid {
			entry["last_received_at"] = received.Int64
		}
		firstLast[typ] = entry
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	scoredByKind := map[string]map[string]int{"design": {"scored": 0, "total": 0}, "brief": {"scored": 0, "total": 0}, "report": {"scored": 0, "total": 0}}
	kr, err := t.rdb.QueryContext(ctx, `WITH content AS (SELECT wf_kind(path) kind,content_hash FROM facts WHERE type='artifact_version' AND wf_kind(path)!='' GROUP BY wf_kind(path),content_hash) SELECT kind,COUNT(*),SUM(CASE WHEN EXISTS(SELECT 1 FROM scores s WHERE s.content_hash=content.content_hash) THEN 1 ELSE 0 END) FROM content GROUP BY kind`)
	if err != nil {
		return nil, err
	}
	for kr.Next() {
		var kind string
		var total, scored int
		if err := kr.Scan(&kind, &total, &scored); err != nil {
			kr.Close()
			return nil, err
		}
		scoredByKind[kind] = map[string]int{"scored": scored, "total": total}
	}
	if err := kr.Err(); err != nil {
		kr.Close()
		return nil, err
	}
	kr.Close()
	var sessions, withRepo, withoutRepo int
	err = t.rdb.QueryRowContext(ctx, `WITH repos AS (SELECT conversation_id,COUNT(DISTINCT repo_id) n FROM facts WHERE type IN ('artifact_version','commit') AND repo_id!='' GROUP BY conversation_id), sessions AS (SELECT DISTINCT conversation_id FROM facts) SELECT COUNT(*),SUM(CASE WHEN coalesce(r.n,0)>0 THEN 1 ELSE 0 END),SUM(CASE WHEN coalesce(r.n,0)=0 THEN 1 ELSE 0 END) FROM sessions s LEFT JOIN repos r USING(conversation_id)`).Scan(&sessions, &withRepo, &withoutRepo)
	if err != nil {
		return nil, err
	}
	return map[string]any{"facts": firstLast, "sessions": map[string]int{"total": sessions, "with_session_repo": withRepo, "without_session_repo": withoutRepo}, "scored_content_by_kind": scoredByKind}, nil
}

func placeholders(n int) string {
	if n < 1 {
		return ""
	}
	s := "?"
	for i := 1; i < n; i++ {
		s += ",?"
	}
	return s
}
func stringsToAny(xs []string) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}
func setHarness(p SessionProvenance, v string) SessionProvenance     { p.Harness = v; return p }
func setHarnesses(p SessionProvenance, v []string) SessionProvenance { p.Harnesses = v; return p }
func setRepoValue(p SessionProvenance, v string) SessionProvenance {
	p.Repos = append(p.Repos, v)
	sort.Strings(p.Repos)
	return p
}
