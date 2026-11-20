package store

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
)

// DistributionParams selects measure, grain, optional lens dimension, and top-N keys.
type DistributionParams struct {
	Measure string
	Grain   string // "call" or "conversation"
	Dim     string // "", "model", or a declared session/call lens
	Top     int
}

// DistributionBin is one histogram bucket; Hi is omitted on the overflow bucket.
type DistributionBin struct {
	Lo float64  `json:"lo"`
	Hi *float64 `json:"hi,omitempty"`
	N  int      `json:"n"`
}

// DistributionRow is one dimension key's summary.
type DistributionRow struct {
	K        string            `json:"k"`
	N        int               `json:"n"`
	Unpriced int               `json:"unpriced"`
	Min      float64           `json:"min"`
	P25      float64           `json:"p25"`
	Median   float64           `json:"median"`
	P75      float64           `json:"p75"`
	P95      float64           `json:"p95"`
	Max      float64           `json:"max"`
	Bins     []DistributionBin `json:"bins"`
}

// DistributionResult is the store output for GET /v1/analytics/distribution.
type DistributionResult struct {
	Measure         string
	Grain           string
	Dim             string
	Rows            []DistributionRow
	Truncated       bool
	GroupN          int
	OmittedGroups   int
	OmittedN        int
	OmittedUnpriced int
	IgnoredFilters  []string
}

type distSample struct {
	key           string
	value         float64
	priced        bool
	unpricedCalls int
}

func distributionApplyFilters(f AnalyticsFilter) (AnalyticsFilter, []string) {
	def, _ := measureByName("cost_usd")
	return def.applyFilters(f)
}

func (t *Tenant) Distribution(ctx context.Context, f AnalyticsFilter, p DistributionParams) (DistributionResult, error) {
	f2, ignored := distributionApplyFilters(f)
	res := DistributionResult{
		Measure: p.Measure, Grain: p.Grain, Dim: p.Dim,
		IgnoredFilters: ignored,
	}
	cte, args := usageRowsWhere(f2)
	valueExpr := distributionValueSQL(p.Measure)
	pricedExpr := "1"
	if p.Measure == "cost_usd" {
		pricedExpr = "wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)"
	}
	keyExpr := "'all'"
	if p.Dim == "model" {
		keyExpr = "model"
	}
	if p.Grain == "call" {
		switch p.Dim {
		case "harness":
			keyExpr = "harness"
		case "session_model":
			keyExpr = "model"
		case "session_repo":
			keyExpr = "COALESCE(sr.repo,'(none)')"
		}
	}
	var query, provQuery, provFallback string
	var provArgs []any
	if p.Grain == "conversation" {
		// Aggregate the in-window usage population once, then derive the lifetime
		// provenance the requested lens needs. The usage scan and the provenance scan
		// are independent, so for a lens they run concurrently and their results are
		// joined in connection-scoped temp tables instead of nesting the provenance
		// scan inside the usage scan.
		callsCTE := `calls AS MATERIALIZED (SELECT conversation_id,harness,model,` + pricedExpr + ` priced,` + valueExpr + ` value FROM kept)`
		perCTE := `per AS MATERIALIZED (SELECT conversation_id,sum(CASE WHEN priced=1 THEN value ELSE 0 END) value,
				sum(1-priced) unpriced,sum(priced) priced FROM calls GROUP BY conversation_id)`
		base := cte + `, ` + callsCTE + `, ` + perCTE
		baseArgs := append([]any(nil), args...)
		predicate := sessionPredicateSQL(f2, "per", &args)
		provFallback = "unknown"
		switch p.Dim {
		case "":
			query = base + ` INSERT INTO dist_samples SELECT 'all',per.value,per.priced,per.unpriced FROM per` + predicate
		case "model":
			query = base + ` INSERT INTO dist_samples SELECT conversation_id,per.value,per.priced,per.unpriced FROM per` + predicate
			provQuery = cte + `, model_calls AS (SELECT conversation_id,model FROM kept),
				counts AS (SELECT conversation_id,model,count(*) n FROM model_calls WHERE model!='' GROUP BY conversation_id,model),
				mc AS (SELECT conversation_id,model,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,model ASC) rn FROM counts),
				cm AS (SELECT conversation_id,model FROM mc WHERE rn=1)
				SELECT conversation_id,coalesce(model,'') FROM cm`
			provArgs = baseArgs
			provFallback = ""
		case "harness":
			query = base + ` INSERT INTO dist_samples SELECT conversation_id,per.value,per.priced,per.unpriced FROM per` + predicate
			provQuery = `SELECT conversation_id,harness FROM (
				SELECT conversation_id,harness,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,harness ASC) rn FROM (
					SELECT conversation_id,COALESCE(NULLIF(harness,''),'unknown') harness,COUNT(*) n
					FROM facts INDEXED BY facts_conv_harness
					GROUP BY conversation_id,COALESCE(NULLIF(harness,''),'unknown')
				)
			) WHERE rn=1`
			provArgs = nil
			provFallback = "unknown"
		case "session_model":
			query = base + ` INSERT INTO dist_samples SELECT conversation_id,per.value,per.priced,per.unpriced FROM per` + predicate
			provQuery = `WITH all_usage AS MATERIALIZED (SELECT row_hash,conversation_id,model,CASE WHEN harness='claude' THEN json_extract(raw,'$.backfill.ref') END mid,tok_out FROM facts INDEXED BY facts_conv_type_event WHERE type='hook_event' AND norm_event='usage'),
				all_kept AS (SELECT *,NULL AS rn FROM all_usage WHERE mid IS NULL OR mid='' UNION ALL SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY conversation_id,mid ORDER BY tok_out DESC,row_hash ASC) rn FROM all_usage WHERE mid IS NOT NULL AND mid<>'') WHERE rn=1),
				model_counts AS (SELECT conversation_id,model,COUNT(*) n FROM all_kept WHERE model!='' GROUP BY conversation_id,model),
				model_totals AS (SELECT conversation_id,COUNT(*) n FROM all_kept GROUP BY conversation_id),
				model_ranked AS (SELECT conversation_id,model,n,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,model ASC) rn FROM model_counts),
				session_model AS (SELECT t.conversation_id,CASE WHEN t.n=0 THEN '(none)' WHEN COALESCE(r.n,0)*1.0/t.n<0.8 THEN '(mixed)' WHEN r.model IS NULL THEN 'unknown' ELSE r.model END model FROM model_totals t LEFT JOIN model_ranked r ON r.conversation_id=t.conversation_id AND r.rn=1)
				SELECT conversation_id,model FROM session_model`
			provArgs = nil
			provFallback = "unknown"
		case "session_repo":
			query = base + ` INSERT INTO dist_samples SELECT conversation_id,per.value,per.priced,per.unpriced FROM per` + predicate
			provQuery = `SELECT conversation_id,repo FROM (
				SELECT conversation_id,CASE WHEN n=1 THEN repo WHEN n>1 THEN '(multi)' ELSE '(none)' END repo FROM (
					SELECT conversation_id,COUNT(DISTINCT repo_id) n,MIN(repo_id) repo
					FROM facts INDEXED BY facts_conv_type_repo
					WHERE type IN ('artifact_version','commit') AND repo_id!=''
					GROUP BY conversation_id
				)
			)`
			provArgs = nil
			provFallback = "(none)"
		default:
			query = base + ` INSERT INTO dist_samples SELECT 'all',per.value,per.priced,per.unpriced FROM per` + predicate
		}
	} else {
		extra, from := "", " FROM kept"
		if p.Dim == "session_repo" {
			extra = `, session_repo_counts AS (SELECT conversation_id,COUNT(DISTINCT repo_id) n,MIN(repo_id) repo FROM facts WHERE type IN ('artifact_version','commit') AND repo_id!='' GROUP BY conversation_id), session_repo AS (SELECT conversation_id,CASE WHEN n=1 THEN repo WHEN n>1 THEN '(multi)' ELSE '(none)' END repo FROM session_repo_counts)`
			from = " FROM kept LEFT JOIN session_repo sr USING(conversation_id)"
		}
		// Evaluate the pricing lookups once per kept call rather than once per use.
		query = cte + extra + `, per_call AS (SELECT ` + keyExpr + ` k,` + valueExpr + ` value,` + pricedExpr + ` priced` + from + `) INSERT INTO dist_samples SELECT k,value,priced,1-priced FROM per_call`
	}
	conn, err := t.rdb.Conn(ctx)
	if err != nil {
		return DistributionResult{}, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS dist_samples(k TEXT,value REAL,priced INTEGER,unpriced INTEGER); DELETE FROM dist_samples`); err != nil {
		return DistributionResult{}, err
	}
	provNeeded := provQuery != ""
	var (
		provRows [][2]string
		provErr  error
		wg       sync.WaitGroup
	)
	if provNeeded {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rows, err := t.rdb.QueryContext(ctx, provQuery, provArgs...)
			if err != nil {
				provErr = err
				return
			}
			defer rows.Close()
			for rows.Next() {
				var id, key string
				if err := rows.Scan(&id, &key); err != nil {
					provErr = err
					return
				}
				provRows = append(provRows, [2]string{id, key})
			}
			provErr = rows.Err()
		}()
	}
	if _, err := conn.ExecContext(ctx, query, args...); err != nil {
		wg.Wait()
		return DistributionResult{}, err
	}
	if provNeeded {
		wg.Wait()
		if provErr != nil {
			return DistributionResult{}, provErr
		}
		if _, err := conn.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS dist_prov(conversation_id TEXT PRIMARY KEY,k TEXT); DELETE FROM dist_prov`); err != nil {
			return DistributionResult{}, err
		}
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return DistributionResult{}, err
		}
		for i := 0; i < len(provRows); i += 500 {
			end := i + 500
			if end > len(provRows) {
				end = len(provRows)
			}
			var sb strings.Builder
			sb.WriteString(`INSERT INTO dist_prov(conversation_id,k) VALUES `)
			vargs := make([]any, 0, (end-i)*2)
			for j := i; j < end; j++ {
				if j > i {
					sb.WriteByte(',')
				}
				sb.WriteString(`(?,?)`)
				vargs = append(vargs, provRows[j][0], provRows[j][1])
			}
			if _, err := tx.ExecContext(ctx, sb.String(), vargs...); err != nil {
				tx.Rollback()
				return DistributionResult{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return DistributionResult{}, err
		}
		if _, err := conn.ExecContext(ctx, `UPDATE dist_samples SET k=COALESCE((SELECT k FROM dist_prov p WHERE p.conversation_id=dist_samples.k),?)`, provFallback); err != nil {
			return DistributionResult{}, err
		}
	}
	top := p.Top
	if top <= 0 {
		top = 20
	}
	if top > 100 {
		top = 100
	}
	var groupN int
	if err := conn.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT k FROM dist_samples GROUP BY k)`).Scan(&groupN); err != nil {
		return DistributionResult{}, err
	}
	if groupN > top {
		res.Truncated = true
	}
	res.GroupN = groupN
	if err := conn.QueryRowContext(ctx, `SELECT COALESCE(SUM(priced),0),COALESCE(SUM(unpriced),0) FROM dist_samples WHERE k NOT IN (SELECT k FROM dist_samples GROUP BY k ORDER BY SUM(priced) DESC,k ASC LIMIT ?)`, top).Scan(&res.OmittedN, &res.OmittedUnpriced); err != nil {
		return DistributionResult{}, err
	}
	// `priced` is 0/1 per call, and at conversation grain it is the priced-call
	// count. Published n stays that sum. Percentiles and bins are one sample per
	// row with priced>0, so a multi-call conversation contributes its summed value
	// once instead of disappearing when the count is not exactly 1. Call grain is
	// unchanged: its priced flag is already 0 or 1.
	rows, err := conn.QueryContext(ctx, `WITH groups AS (SELECT k,sum(priced) n,sum(unpriced) unpriced FROM dist_samples GROUP BY k),
		ranked AS (SELECT k,value,ROW_NUMBER() OVER(PARTITION BY k ORDER BY value)-1 rn,COUNT(*) OVER(PARTITION BY k) samples FROM dist_samples WHERE priced>0),
		stats AS (SELECT k,MIN(value) minv,MAX(value) maxv,MAX(samples) samples,
			SUM(CASE WHEN rn=CAST((samples-1)*0.25 AS INTEGER) THEN value*(1-((samples-1)*0.25-CAST((samples-1)*0.25 AS INTEGER))) WHEN rn=CAST((samples-1)*0.25 AS INTEGER)+1 THEN value*((samples-1)*0.25-CAST((samples-1)*0.25 AS INTEGER)) ELSE 0 END) p25,
			SUM(CASE WHEN rn=CAST((samples-1)*0.5 AS INTEGER) THEN value*(1-((samples-1)*0.5-CAST((samples-1)*0.5 AS INTEGER))) WHEN rn=CAST((samples-1)*0.5 AS INTEGER)+1 THEN value*((samples-1)*0.5-CAST((samples-1)*0.5 AS INTEGER)) ELSE 0 END) med,
			SUM(CASE WHEN rn=CAST((samples-1)*0.75 AS INTEGER) THEN value*(1-((samples-1)*0.75-CAST((samples-1)*0.75 AS INTEGER))) WHEN rn=CAST((samples-1)*0.75 AS INTEGER)+1 THEN value*((samples-1)*0.75-CAST((samples-1)*0.75 AS INTEGER)) ELSE 0 END) p75,
			SUM(CASE WHEN rn=CAST((samples-1)*0.95 AS INTEGER) THEN value*(1-((samples-1)*0.95-CAST((samples-1)*0.95 AS INTEGER))) WHEN rn=CAST((samples-1)*0.95 AS INTEGER)+1 THEN value*((samples-1)*0.95-CAST((samples-1)*0.95 AS INTEGER)) ELSE 0 END) p95
		FROM ranked GROUP BY k) SELECT g.k,g.n,g.unpriced,s.minv,s.p25,s.med,s.p75,s.p95,s.maxv FROM groups g LEFT JOIN stats s USING(k) ORDER BY g.n DESC,g.k ASC LIMIT ?`, top)
	if err != nil {
		return DistributionResult{}, err
	}
	for rows.Next() {
		var r DistributionRow
		var minv, p25, med, p75, p95, maxv sql.NullFloat64
		if err := rows.Scan(&r.K, &r.N, &r.Unpriced, &minv, &p25, &med, &p75, &p95, &maxv); err != nil {
			rows.Close()
			return DistributionResult{}, err
		}
		if minv.Valid {
			round := func(v float64) float64 { return roundMeasure(p.Measure, v) }
			r.Min = round(minv.Float64)
			r.P25 = round(p25.Float64)
			r.Median = round(med.Float64)
			r.P75 = round(p75.Float64)
			r.P95 = round(p95.Float64)
			r.Max = round(maxv.Float64)
		}
		r.Bins = distributionBinDefs(p.Measure)
		res.Rows = append(res.Rows, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return DistributionResult{}, err
	}
	if err := rows.Close(); err != nil {
		return DistributionResult{}, err
	}
	binRows, err := conn.QueryContext(ctx, `WITH top_keys AS (
		SELECT k FROM dist_samples GROUP BY k ORDER BY sum(priced) DESC,k ASC LIMIT ?
	), counts AS (
		SELECT d.k,`+distributionBinIndexSQL(p.Measure)+` AS bin_index,count(*) AS n
		FROM dist_samples d JOIN top_keys USING(k) WHERE d.priced>0 GROUP BY d.k,bin_index
	) SELECT k,bin_index,n FROM counts ORDER BY k,bin_index`, top)
	if err != nil {
		return DistributionResult{}, err
	}
	defer binRows.Close()
	byKey := map[string][]DistributionBin{}
	for _, r := range res.Rows {
		byKey[r.K] = r.Bins
	}
	for binRows.Next() {
		var k string
		var index, count int
		if err := binRows.Scan(&k, &index, &count); err != nil {
			return DistributionResult{}, err
		}
		if bins := byKey[k]; bins != nil && index >= 0 && index < len(bins) {
			bins[index].N = count
		}
	}
	for i := range res.Rows {
		res.Rows[i].Bins = binCounts(p.Measure, byKey[res.Rows[i].K])
	}
	res.OmittedGroups = res.GroupN - len(res.Rows)
	return res, nil
}

// sessionScatterMarginalMeasures are the session-scatter fields with a whole-population marginal.
var sessionScatterMarginalMeasures = map[string]bool{
	"cost_usd": true, "commits": true, "unpriced_calls": true,
	"tokens_in": true, "tokens_out": true, "tokens_cache_read": true,
	"tokens_cache_write": true, "tokens_reasoning": true,
}

// SessionScatterMarginals returns the fixed-bin marginal histogram for each requested
// session-scatter field over the whole filtered session population. It folds the session
// aggregate rows in one stream instead of running a Distribution query per field, and never
// retains the population in Go. Cost follows the priced-only eligibility used by session cost;
// every other field counts every session, including zero-valued ones.
func (t *Tenant) SessionScatterMarginals(ctx context.Context, f AnalyticsFilter, fields []string) (map[string][]DistributionBin, error) {
	for _, field := range fields {
		if !sessionScatterMarginalMeasures[field] {
			return nil, fmt.Errorf("unsupported session scatter field %s", field)
		}
	}
	cte, args := sessionAggregateCTE(f)
	rows, err := t.rdb.QueryContext(ctx, cte+` SELECT model_calls,unpriced_calls,commits,cost_usd,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,tokens_reasoning FROM filtered`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]DistributionBin, len(fields))
	for _, field := range fields {
		out[field] = distributionBinDefs(field)
	}
	for rows.Next() {
		var modelCalls, unpriced, commits, cost, tokIn, tokOut, cacheRead, cacheWrite, reasoning float64
		if err := rows.Scan(&modelCalls, &unpriced, &commits, &cost, &tokIn, &tokOut, &cacheRead, &cacheWrite, &reasoning); err != nil {
			return nil, err
		}
		for _, field := range fields {
			value, ok := sessionMarginalValue(field, modelCalls, unpriced, commits, cost, tokIn, tokOut, cacheRead, cacheWrite, reasoning)
			if !ok {
				continue
			}
			bins := out[field]
			assignBin(&bins, field, value)
			out[field] = bins
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// SessionScatterPopulation reads the filtered session population once, returning the
// deterministic hash sample and the whole-population marginal histograms. It streams the rows so
// only the bounded sample is retained in Go, and the marginals share the same aggregates the
// scatter sample is drawn from.
func (t *Tenant) SessionScatterPopulation(ctx context.Context, f AnalyticsFilter, fields []string, limit int) ([]SessionEntityRow, int, map[string][]DistributionBin, error) {
	for _, field := range fields {
		if !sessionScatterMarginalMeasures[field] {
			return nil, 0, nil, fmt.Errorf("unsupported session scatter field %s", field)
		}
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
	 SELECT conversation_id,SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END) commits
	 FROM facts INDEXED BY facts_conv_ts_type WHERE ` + factWhere + ` GROUP BY conversation_id
	), result AS (SELECT base.conversation_id,base.commits,COALESCE(usage.model_calls,0) model_calls,COALESCE(usage.unpriced_calls,0) unpriced_calls,
	 COALESCE(usage.cost_usd,0) cost_usd,COALESCE(usage.tokens_in,0) tokens_in,COALESCE(usage.tokens_out,0) tokens_out,
	 COALESCE(usage.tokens_cache_read,0) tokens_cache_read,COALESCE(usage.tokens_cache_write,0) tokens_cache_write,COALESCE(usage.tokens_reasoning,0) tokens_reasoning
	 FROM base LEFT JOIN usage USING(conversation_id)), filtered AS (SELECT * FROM result WHERE 1=1` + sessionRangeWhere(f.SessionRanges, &args) + `)
	 SELECT conversation_id,commits,model_calls,unpriced_calls,cost_usd,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,tokens_reasoning
	 FROM filtered ORDER BY wf_session_hash(conversation_id) ASC`
	rows, err := t.rdb.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, nil, err
	}
	defer rows.Close()
	out := make(map[string][]DistributionBin, len(fields))
	for _, field := range fields {
		out[field] = distributionBinDefs(field)
	}
	sample := make([]SessionEntityRow, 0, limit)
	population := 0
	for rows.Next() {
		var r SessionEntityRow
		vals := make([]float64, 9)
		if err := rows.Scan(&r.ID, &vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5], &vals[6], &vals[7], &vals[8]); err != nil {
			return nil, 0, nil, err
		}
		r.Measures = map[string]float64{"commits": vals[0], "model_calls": vals[1], "unpriced_calls": vals[2], "cost_usd": vals[3], "tokens_in": vals[4], "tokens_out": vals[5], "tokens_cache_read": vals[6], "tokens_cache_write": vals[7], "tokens_reasoning": vals[8]}
		population++
		for _, field := range fields {
			value, ok := sessionMarginalValue(field, r.Measures["model_calls"], r.Measures["unpriced_calls"], r.Measures["commits"], r.Measures["cost_usd"], r.Measures["tokens_in"], r.Measures["tokens_out"], r.Measures["tokens_cache_read"], r.Measures["tokens_cache_write"], r.Measures["tokens_reasoning"])
			if !ok {
				continue
			}
			bins := out[field]
			assignBin(&bins, field, value)
			out[field] = bins
		}
		if len(sample) < limit {
			sample = append(sample, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, 0, nil, err
	}
	return sample, population, out, nil
}

// SessionScatterMarginalsFromRows folds marginal histograms from session rows the caller
// already holds. Lens-filtered scatter uses it so the marginal query does not bind every
// matching conversation id.
func (t *Tenant) SessionScatterMarginalsFromRows(fields []string, rows []SessionEntityRow) (map[string][]DistributionBin, error) {
	for _, field := range fields {
		if !sessionScatterMarginalMeasures[field] {
			return nil, fmt.Errorf("unsupported session scatter field %s", field)
		}
	}
	out := make(map[string][]DistributionBin, len(fields))
	for _, field := range fields {
		out[field] = distributionBinDefs(field)
	}
	for _, row := range rows {
		m := row.Measures
		for _, field := range fields {
			value, ok := sessionMarginalValue(field, m["model_calls"], m["unpriced_calls"], m["commits"], m["cost_usd"], m["tokens_in"], m["tokens_out"], m["tokens_cache_read"], m["tokens_cache_write"], m["tokens_reasoning"])
			if !ok {
				continue
			}
			bins := out[field]
			assignBin(&bins, field, value)
			out[field] = bins
		}
	}
	return out, nil
}

func sessionMarginalValue(field string, modelCalls, unpriced, commits, cost, tokIn, tokOut, cacheRead, cacheWrite, reasoning float64) (float64, bool) {
	switch field {
	case "cost_usd":
		if modelCalls > 0 && modelCalls <= unpriced {
			return 0, false
		}
		return cost, true
	case "commits":
		return commits, true
	case "unpriced_calls":
		return unpriced, true
	case "tokens_in":
		return tokIn, true
	case "tokens_out":
		return tokOut, true
	case "tokens_cache_read":
		return cacheRead, true
	case "tokens_cache_write":
		return cacheWrite, true
	case "tokens_reasoning":
		return reasoning, true
	}
	return 0, false
}

func distributionBinIndexSQL(measure string) string {
	if measure == "cost_usd" {
		query := "CASE WHEN value=0 THEN 0 WHEN value>0 AND value<0.0001 THEN 1 WHEN value>=100 THEN 8"
		for i := -4; i <= 1; i++ {
			lo, hi := math.Pow(10, float64(i)), math.Pow(10, float64(i+1))
			query += fmt.Sprintf(" WHEN value>=%g AND value<%g THEN %d", lo, hi, i+6)
		}
		return query + " ELSE 8 END"
	}
	query := "CASE WHEN value=0 OR (value>0 AND value<1) THEN 0 WHEN value>=1048576 THEN 21"
	for i := 0; i < 20; i++ {
		query += fmt.Sprintf(" WHEN value>=%d AND value<%d THEN %d", 1<<i, 1<<(i+1), i+1)
	}
	return query + " ELSE 21 END"
}

func distributionValueSQL(measure string) string {
	switch measure {
	case "cost_usd":
		return "wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)"
	case "tokens_in":
		return "tok_in"
	case "tokens_out":
		return "tok_out"
	case "tokens_cache_read":
		return "tok_cache_read"
	case "tokens_cache_write":
		return "tok_cache_write"
	case "tokens_reasoning":
		return "tok_reasoning"
	}
	return "0"
}

type distGroup struct {
	key         string
	n, unpriced int
	values      []float64
	bins        []DistributionBin
}

func (g *distGroup) add(measure string, value float64, priced bool, unpricedCalls int) {
	g.unpriced += unpricedCalls
	if measure == "cost_usd" {
		if priced {
			g.n++
			g.values = append(g.values, value)
			assignBin(&g.bins, measure, value)
		} else if unpricedCalls == 0 {
			g.unpriced++
		}
		return
	}
	if priced {
		g.n++
		g.values = append(g.values, value)
		assignBin(&g.bins, measure, value)
	}
}

func (g *distGroup) row(measure string) DistributionRow {
	sort.Float64s(g.values)
	round := func(v float64) float64 { return roundMeasure(measure, v) }
	r := DistributionRow{
		K: g.key, N: g.n, Unpriced: g.unpriced,
		Min: round(Percentile(g.values, 0)), P25: round(Percentile(g.values, 0.25)),
		Median: round(Percentile(g.values, 0.5)), P75: round(Percentile(g.values, 0.75)),
		P95: round(Percentile(g.values, 0.95)), Max: round(Percentile(g.values, 1)),
		Bins: binCounts(measure, g.bins),
	}
	return r
}

func distSamplesFromCalls(rows []usageRow, p DistributionParams) []distSample {
	if p.Grain == "conversation" {
		return distConversationSamples(rows, p)
	}
	out := make([]distSample, 0, len(rows))
	for _, r := range rows {
		val, priced := distCallValue(p.Measure, r)
		key := "all"
		if p.Dim == "model" {
			key = r.model
		}
		out = append(out, distSample{key: key, value: val, priced: priced})
	}
	return out
}

func distCallValue(measure string, r usageRow) (float64, bool) {
	if measure == "cost_usd" {
		usd, ok := Cost(r.harness, r.model, r.tokens(), r.costReported)
		return usd, ok
	}
	return usageValue(measure, r), true
}

func distConversationSamples(rows []usageRow, p DistributionParams) []distSample {
	type acc struct {
		sum         float64
		priced, unp int
		models      map[string]int
	}
	m := map[string]*acc{}
	for _, r := range rows {
		a := m[r.convID]
		if a == nil {
			a = &acc{models: map[string]int{}}
			m[r.convID] = a
		}
		val, priced := distCallValue(p.Measure, r)
		if priced {
			a.sum += val
			a.priced++
		} else {
			a.unp++
		}
		if r.model != "" {
			a.models[r.model]++
		}
	}
	out := make([]distSample, 0, len(m))
	for _, a := range m {
		key := "all"
		if p.Dim == "model" {
			key = dominantModel(a.models)
		}
		if a.priced > 0 {
			out = append(out, distSample{key: key, value: a.sum, priced: true, unpricedCalls: a.unp})
		} else if a.unp > 0 {
			out = append(out, distSample{key: key, unpricedCalls: a.unp})
		}
	}
	return out
}

func dominantModel(counts map[string]int) string {
	best, n := "", 0
	for name, c := range counts {
		if c > n || (c == n && (best == "" || name < best)) {
			best, n = name, c
		}
	}
	return best
}

func distributionBinDefs(measure string) []DistributionBin {
	if measure == "cost_usd" {
		defs := []DistributionBin{{Lo: 0}, {Lo: 0, Hi: f64(1e-4)}}
		for i := -4; i <= 1; i++ {
			lo := math.Pow(10, float64(i))
			hi := math.Pow(10, float64(i+1))
			defs = append(defs, DistributionBin{Lo: lo, Hi: &hi})
		}
		defs = append(defs, DistributionBin{Lo: 100})
		return defs
	}
	defs := []DistributionBin{{Lo: 0}}
	for i := 0; i < 20; i++ {
		lo := math.Pow(2, float64(i))
		hi := math.Pow(2, float64(i+1))
		defs = append(defs, DistributionBin{Lo: lo, Hi: &hi})
	}
	defs = append(defs, DistributionBin{Lo: math.Pow(2, 20)})
	return defs
}

func f64(v float64) *float64 { return &v }

func binIndex(measure string, v float64) int {
	if measure == "cost_usd" {
		if v == 0 {
			return 0
		}
		if v > 0 && v < 1e-4 {
			return 1
		}
		if v >= 100 {
			return 8
		}
		for i := -4; i <= 1; i++ {
			lo := math.Pow(10, float64(i))
			if v >= lo && v < math.Pow(10, float64(i+1)) {
				return i + 6 // zero, (0,1e-4), then i=-4 at index 2
			}
		}
		return 8
	}
	if v == 0 {
		return 0
	}
	if v >= math.Pow(2, 20) {
		return 21
	}
	if v > 0 && v < 1 {
		return 0
	}
	for i := 0; i < 20; i++ {
		lo := math.Pow(2, float64(i))
		if v >= lo && v < math.Pow(2, float64(i+1)) {
			return i + 1
		}
	}
	return 21
}

func assignBin(bins *[]DistributionBin, measure string, v float64) {
	if *bins == nil {
		*bins = distributionBinDefs(measure)
	}
	idx := binIndex(measure, v)
	(*bins)[idx].N++
}

func binCounts(measure string, partial []DistributionBin) []DistributionBin {
	defs := distributionBinDefs(measure)
	if len(partial) == 0 {
		return defs
	}
	for i := range defs {
		if i < len(partial) {
			defs[i].N = partial[i].N
		}
	}
	return defs
}
