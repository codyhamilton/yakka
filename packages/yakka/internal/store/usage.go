package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"modernc.org/sqlite"
	"time"
)

// init registers the usage-measure executor 3-04 left nil.
func init() {
	usageQuery = usageQueryImpl
	sqlite.RegisterDeterministicScalarFunction("wf_usage_cost", 8, func(_ *sqlite.FunctionContext, a []driver.Value) (driver.Value, error) {
		str := func(i int) string { v, _ := a[i].(string); return v }
		integer := func(i int) int64 {
			switch v := a[i].(type) {
			case int64:
				return v
			case float64:
				return int64(v)
			}
			return 0
		}
		var reported *float64
		if v, ok := a[7].(float64); ok {
			reported = &v
		} else if v, ok := a[7].(int64); ok {
			x := float64(v)
			reported = &x
		}
		v, ok := Cost(str(0), str(1), Tokens{In: integer(2), Out: integer(3), CacheRead: integer(4), CacheWrite: integer(5), Reasoning: integer(6)}, reported)
		if !ok {
			return float64(0), nil
		}
		return v, nil
	})
	sqlite.RegisterDeterministicScalarFunction("wf_usage_priced", 8, func(_ *sqlite.FunctionContext, a []driver.Value) (driver.Value, error) {
		str := func(i int) string { v, _ := a[i].(string); return v }
		integer := func(i int) int64 {
			switch v := a[i].(type) {
			case int64:
				return v
			case float64:
				return int64(v)
			}
			return 0
		}
		var reported *float64
		if v, ok := a[7].(float64); ok {
			reported = &v
		} else if v, ok := a[7].(int64); ok {
			x := float64(v)
			reported = &x
		}
		_, ok := Cost(str(0), str(1), Tokens{In: integer(2), Out: integer(3), CacheRead: integer(4), CacheWrite: integer(5), Reasoning: integer(6)}, reported)
		if ok {
			return int64(1), nil
		}
		return int64(0), nil
	})
}

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
	if bucket == "year" {
		validBucket = true
	}
	if _, ok := multiYearStep(bucket); ok {
		validBucket = true
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
	f2, ignored := def.applyFilters(f)
	where, args := def.whereClause(AnalyticsFilter{From: f2.From, To: f2.To})
	cte, sourceArgs := usageRowsWhere(f2)
	value := "count(*)"
	switch p.Measure {
	case "tokens_in":
		value = "sum(tok_in)"
	case "tokens_out":
		value = "sum(tok_out)"
	case "tokens_cache_read":
		value = "sum(tok_cache_read)"
	case "tokens_cache_write":
		value = "sum(tok_cache_write)"
	case "tokens_reasoning":
		value = "sum(tok_reasoning)"
	case "cost_usd":
		value = "sum(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported))"
	case "unpriced_calls":
		value = "sum(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported))"
	}
	qdef := measureDef{table: "facts", value: value, dims: []string{"harness", "repo_id", "model", "conversation_id"}, sourceSQL: "(" + cte + " SELECT harness,repo_id,model,conversation_id,ts,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported FROM kept)", sourceArgs: sourceArgs}
	// The source CTE already applied the usage-specific filter and message dedupe. The outer time
	// predicate is neutral, retaining queryMeasure's rank/fold/bucket SQL without materializing calls.
	_ = where
	_ = args
	res, err := t.queryMeasure(ctx, AnalyticsFilter{From: f.From, To: f.To, TZ: f.TZ}, p, qdef, top, bucket)
	if err != nil {
		return QueryResult{}, err
	}
	res.Ignored = ignored
	return res, nil
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
		case "year":
			return fmt.Sprintf("%04d-01-01T00:00:00Z", y)
		}
	}
	if bucket == "year" {
		return localBucket(usageHourKey(sec), loc, bucket)
	}
	if _, ok := multiYearStep(bucket); ok {
		return localBucket(usageHourKey(sec), loc, bucket)
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
