package store

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
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
	var query string
	if p.Grain == "conversation" {
		switch p.Dim {
		case "model":
			keyExpr = "coalesce(cm.model,'')"
		case "harness":
			keyExpr = "coalesce(sh.harness,'unknown')"
		case "session_model":
			keyExpr = "coalesce(sm.model,'unknown')"
		case "session_repo":
			keyExpr = "coalesce(sr.repo,'(none)')"
		}
		query = cte + `, session_repo_counts AS (SELECT conversation_id,COUNT(DISTINCT repo_id) n,MIN(repo_id) repo FROM facts WHERE type IN ('artifact_version','commit') AND repo_id!='' GROUP BY conversation_id),
			session_repo AS (SELECT conversation_id,CASE WHEN n=1 THEN repo WHEN n>1 THEN '(multi)' ELSE '(none)' END repo FROM session_repo_counts),
			harness_counts AS (SELECT conversation_id,COALESCE(NULLIF(harness,''),'unknown') harness,COUNT(*) n FROM facts GROUP BY conversation_id,COALESCE(NULLIF(harness,''),'unknown')),
			harness_ranked AS (SELECT conversation_id,harness,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,harness ASC) rn FROM harness_counts),
			session_harness AS (SELECT conversation_id,harness FROM harness_ranked WHERE rn=1),
			all_usage AS (SELECT row_hash,conversation_id,model,CASE WHEN harness='claude' THEN json_extract(raw,'$.backfill.ref') END mid,tok_out FROM facts WHERE type='hook_event' AND norm_event='usage'),
			all_kept AS (SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY conversation_id,mid ORDER BY tok_out DESC,row_hash ASC) rn FROM all_usage) WHERE mid IS NULL OR mid='' OR rn=1),
			model_counts AS (SELECT conversation_id,model,COUNT(*) n FROM all_kept WHERE model!='' GROUP BY conversation_id,model),
			model_totals AS (SELECT conversation_id,COUNT(*) n FROM all_kept GROUP BY conversation_id),
			model_ranked AS (SELECT conversation_id,model,n,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,model ASC) rn FROM model_counts),
			session_model AS (SELECT t.conversation_id,CASE WHEN t.n=0 THEN '(none)' WHEN COALESCE(r.n,0)*1.0/t.n<0.8 THEN '(mixed)' WHEN r.model IS NULL THEN 'unknown' ELSE r.model END model FROM model_totals t LEFT JOIN model_ranked r ON r.conversation_id=t.conversation_id AND r.rn=1),
			counts AS (SELECT conversation_id,model,count(*) n FROM kept WHERE model!='' GROUP BY conversation_id,model),
			mc AS (SELECT conversation_id,model,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,model ASC) rn FROM counts),
			cm AS (SELECT conversation_id,model FROM mc WHERE rn=1),
			per AS (SELECT conversation_id,sum(CASE WHEN ` + pricedExpr + `=1 THEN ` + valueExpr + ` ELSE 0 END) value,
				sum(1-` + pricedExpr + `) unpriced,sum(` + pricedExpr + `) priced FROM kept GROUP BY conversation_id)
			INSERT INTO dist_samples SELECT ` + keyExpr + `,per.value,per.priced,per.unpriced FROM per LEFT JOIN cm USING(conversation_id) LEFT JOIN session_repo sr USING(conversation_id) LEFT JOIN session_harness sh USING(conversation_id) LEFT JOIN session_model sm USING(conversation_id)` + sessionPredicateSQL(f2, "per", &args)
	} else {
		if p.Dim == "session_repo" {
			query = cte + `, session_repo_counts AS (SELECT conversation_id,COUNT(DISTINCT repo_id) n,MIN(repo_id) repo FROM facts WHERE type IN ('artifact_version','commit') AND repo_id!='' GROUP BY conversation_id), session_repo AS (SELECT conversation_id,CASE WHEN n=1 THEN repo WHEN n>1 THEN '(multi)' ELSE '(none)' END repo FROM session_repo_counts) INSERT INTO dist_samples SELECT ` + keyExpr + `,` + valueExpr + `,` + pricedExpr + `,1-` + pricedExpr + ` FROM kept LEFT JOIN session_repo sr USING(conversation_id)`
		} else {
			query = cte + ` INSERT INTO dist_samples SELECT ` + keyExpr + `,` + valueExpr + `,` + pricedExpr + `,1-` + pricedExpr + ` FROM kept`
		}
	}
	if _, err := t.rdb.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS dist_samples(k TEXT,value REAL,priced INTEGER,unpriced INTEGER); DELETE FROM dist_samples`); err != nil {
		return DistributionResult{}, err
	}
	if _, err := t.rdb.ExecContext(ctx, query, args...); err != nil {
		return DistributionResult{}, err
	}
	top := p.Top
	if top <= 0 {
		top = 20
	}
	if top > 100 {
		top = 100
	}
	var groupN int
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT k FROM dist_samples GROUP BY k)`).Scan(&groupN); err != nil {
		return DistributionResult{}, err
	}
	if groupN > top {
		res.Truncated = true
	}
	res.GroupN = groupN
	if err := t.rdb.QueryRowContext(ctx, `SELECT COALESCE(SUM(priced),0),COALESCE(SUM(unpriced),0) FROM dist_samples WHERE k NOT IN (SELECT k FROM dist_samples GROUP BY k ORDER BY SUM(priced) DESC,k ASC LIMIT ?)`, top).Scan(&res.OmittedN, &res.OmittedUnpriced); err != nil {
		return DistributionResult{}, err
	}
	rows, err := t.rdb.QueryContext(ctx, `WITH groups AS (SELECT k,sum(priced) n,sum(unpriced) unpriced FROM dist_samples GROUP BY k),
		ranked AS (SELECT d.k,d.value,ROW_NUMBER() OVER(PARTITION BY d.k ORDER BY d.value)-1 rn,g.n FROM dist_samples d JOIN groups g USING(k) WHERE d.priced=1),
		stats AS (SELECT k,MIN(value) minv,MAX(value) maxv,MAX(n) n,
			SUM(CASE WHEN rn=CAST((n-1)*0.25 AS INTEGER) THEN value*(1-((n-1)*0.25-CAST((n-1)*0.25 AS INTEGER))) WHEN rn=CAST((n-1)*0.25 AS INTEGER)+1 THEN value*((n-1)*0.25-CAST((n-1)*0.25 AS INTEGER)) ELSE 0 END) p25,
			SUM(CASE WHEN rn=CAST((n-1)*0.5 AS INTEGER) THEN value*(1-((n-1)*0.5-CAST((n-1)*0.5 AS INTEGER))) WHEN rn=CAST((n-1)*0.5 AS INTEGER)+1 THEN value*((n-1)*0.5-CAST((n-1)*0.5 AS INTEGER)) ELSE 0 END) med,
			SUM(CASE WHEN rn=CAST((n-1)*0.75 AS INTEGER) THEN value*(1-((n-1)*0.75-CAST((n-1)*0.75 AS INTEGER))) WHEN rn=CAST((n-1)*0.75 AS INTEGER)+1 THEN value*((n-1)*0.75-CAST((n-1)*0.75 AS INTEGER)) ELSE 0 END) p75,
			SUM(CASE WHEN rn=CAST((n-1)*0.95 AS INTEGER) THEN value*(1-((n-1)*0.95-CAST((n-1)*0.95 AS INTEGER))) WHEN rn=CAST((n-1)*0.95 AS INTEGER)+1 THEN value*((n-1)*0.95-CAST((n-1)*0.95 AS INTEGER)) ELSE 0 END) p95
		FROM ranked GROUP BY k) SELECT g.k,g.n,g.unpriced,s.minv,s.p25,s.med,s.p75,s.p95,s.maxv FROM groups g LEFT JOIN stats s USING(k) ORDER BY g.n DESC,g.k ASC LIMIT ?`, top)
	if err != nil {
		return DistributionResult{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var r DistributionRow
		var minv, p25, med, p75, p95, maxv sql.NullFloat64
		if err := rows.Scan(&r.K, &r.N, &r.Unpriced, &minv, &p25, &med, &p75, &p95, &maxv); err != nil {
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
		return DistributionResult{}, err
	}
	binRows, err := t.rdb.QueryContext(ctx, `WITH top_keys AS (
		SELECT k FROM dist_samples GROUP BY k ORDER BY sum(priced) DESC,k ASC LIMIT ?
	), counts AS (
		SELECT d.k,`+distributionBinIndexSQL(p.Measure)+` AS bin_index,count(*) AS n
		FROM dist_samples d JOIN top_keys USING(k) WHERE d.priced=1 GROUP BY d.k,bin_index
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
