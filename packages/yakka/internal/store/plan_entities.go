package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

type PlanEntity struct {
	RepoID, Plan                                                string
	Artifacts, Versions, Sessions, SharedSessions               int
	ExecutionsComplete, ExecutionsUnreported, ExecutionsStarted int
	FirstTS, LastTS                                             float64
	AssociatedCostUSD                                           *float64
	UnpricedCalls                                               int
	ArtifactsByKind                                             map[string]int
	DesignScores                                                map[string]float64
	SortValue                                                   *float64
}

// PlanIdentity is one (repo_id, plan) page key shared by the batched plan reads.
type PlanIdentity struct{ RepoID, Plan string }

// PlanCost is one plan's associated cost measure, derived from the deduplicated usage source.
type PlanCost struct {
	CostUSD       *float64
	UnpricedCalls int
	Calls         int
}

func planKeyValues(plans []PlanIdentity) (string, []any) {
	var b strings.Builder
	args := make([]any, 0, len(plans)*2)
	for i, p := range plans {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString("(?,?)")
		args = append(args, p.RepoID, p.Plan)
	}
	return b.String(), args
}

// PlanCostsAll returns associated cost for every plan with a lifetime artifact association. The
// deduplicated usage source and the lifetime plan associations are read separately and joined in
// Go, because a SQL join between the two grouped reads forces SQLite into a cross-product scan.
func (t *Tenant) PlanCostsAll(ctx context.Context, f AnalyticsFilter) (map[PlanIdentity]PlanCost, error) {
	usageFilter := f
	usageFilter.Plans = nil
	usageFilter.Repos = nil
	uq, uargs := usageRowsWhere(usageFilter)
	rows, err := t.rdb.QueryContext(ctx, uq+`, perconv AS MATERIALIZED (
		SELECT conversation_id,
		 SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) cost,
		 SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced,
		 COUNT(*) calls FROM kept GROUP BY conversation_id
		) SELECT conversation_id,cost,unpriced,calls FROM perconv`, uargs...)
	if err != nil {
		return nil, err
	}
	type conversationCost struct {
		cost     sql.NullFloat64
		unpriced int
		calls    int
	}
	perconv := map[string]conversationCost{}
	for rows.Next() {
		var id string
		var c conversationCost
		if err := rows.Scan(&id, &c.cost, &c.unpriced, &c.calls); err != nil {
			rows.Close()
			return nil, err
		}
		perconv[id] = c
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	w, wargs := f.factWhere()
	rows, err = t.rdb.QueryContext(ctx, `SELECT DISTINCT a.repo_id,a.plan,a.conversation_id FROM facts a
		WHERE a.type='artifact_version' AND a.plan<>''
		AND EXISTS(SELECT 1 FROM facts wf WHERE wf.conversation_id=a.conversation_id AND `+w+`)`, wargs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[PlanIdentity]PlanCost{}
	cost := map[PlanIdentity]float64{}
	hasCost := map[PlanIdentity]bool{}
	for rows.Next() {
		var key PlanIdentity
		var id string
		if err := rows.Scan(&key.RepoID, &key.Plan, &id); err != nil {
			return nil, err
		}
		c, ok := perconv[id]
		if !ok {
			continue
		}
		pc := out[key]
		pc.UnpricedCalls += c.unpriced
		pc.Calls += c.calls
		if c.cost.Valid {
			cost[key] += c.cost.Float64
			hasCost[key] = true
		}
		out[key] = pc
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for key, pc := range out {
		if hasCost[key] {
			v := cost[key]
			pc.CostUSD = &v
		}
		out[key] = pc
	}
	return out, nil
}

type planAssociation struct {
	Key            PlanIdentity
	ConversationID string
}

// planAssociations reads lifetime plan artifacts intersected with the in-window conversation set.
func (t *Tenant) planAssociations(ctx context.Context, f AnalyticsFilter, plans []PlanIdentity) ([]planAssociation, error) {
	w, wargs := f.factWhere()
	q := `SELECT DISTINCT a.repo_id,a.plan,a.conversation_id FROM facts a
		WHERE a.type='artifact_version' AND a.plan<>''
		AND EXISTS(SELECT 1 FROM facts wf WHERE wf.conversation_id=a.conversation_id AND ` + w + `)`
	args := append([]any{}, wargs...)
	if len(plans) > 0 {
		values, pageArgs := planKeyValues(plans)
		q = `WITH page(repo_id,plan) AS (VALUES ` + values + `) ` + q +
			` AND EXISTS(SELECT 1 FROM page p WHERE p.repo_id=a.repo_id AND p.plan=a.plan)`
		args = append(pageArgs, args...)
	}
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []planAssociation{}
	for rows.Next() {
		var a planAssociation
		if err := rows.Scan(&a.Key.RepoID, &a.Key.Plan, &a.ConversationID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// planCostsForAssociations groups the deduplicated usage source only for the associated
// conversations, then folds it into per-plan totals in Go.
func (t *Tenant) planCostsForAssociations(ctx context.Context, f AnalyticsFilter, assocs []planAssociation) (map[PlanIdentity]PlanCost, error) {
	out := map[PlanIdentity]PlanCost{}
	if len(assocs) == 0 {
		return out, nil
	}
	seen := map[string]bool{}
	ids := make([]string, 0, len(assocs))
	for _, a := range assocs {
		if !seen[a.ConversationID] {
			seen[a.ConversationID] = true
			ids = append(ids, a.ConversationID)
		}
	}
	usageFilter := f
	usageFilter.Plans = nil
	usageFilter.Repos = nil
	usageFilter.ConversationIDs = ids
	uq, uargs := usageRowsWhere(usageFilter)
	rows, err := t.rdb.QueryContext(ctx, uq+`, perconv AS MATERIALIZED (
		SELECT conversation_id,
		 SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) cost,
		 SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced,
		 COUNT(*) calls FROM kept GROUP BY conversation_id
		) SELECT conversation_id,cost,unpriced,calls FROM perconv`, uargs...)
	if err != nil {
		return nil, err
	}
	type conversationCost struct {
		cost     sql.NullFloat64
		unpriced int
		calls    int
	}
	perconv := map[string]conversationCost{}
	for rows.Next() {
		var id string
		var c conversationCost
		if err := rows.Scan(&id, &c.cost, &c.unpriced, &c.calls); err != nil {
			rows.Close()
			return nil, err
		}
		perconv[id] = c
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	cost := map[PlanIdentity]float64{}
	hasCost := map[PlanIdentity]bool{}
	for _, a := range assocs {
		c, ok := perconv[a.ConversationID]
		if !ok {
			continue
		}
		pc := out[a.Key]
		pc.UnpricedCalls += c.unpriced
		pc.Calls += c.calls
		if c.cost.Valid {
			cost[a.Key] += c.cost.Float64
			hasCost[a.Key] = true
		}
		out[a.Key] = pc
	}
	for key, pc := range out {
		if hasCost[key] {
			v := cost[key]
			pc.CostUSD = &v
		}
		out[key] = pc
	}
	return out, nil
}

// PlanAssociatedCosts returns associated cost for every requested plan. The association is
// lifetime plan artifacts intersected with the in-window conversation set, matching
// PlanAssociatedCost, and only the associated conversations are grouped.
func (t *Tenant) PlanAssociatedCosts(ctx context.Context, f AnalyticsFilter, plans []PlanIdentity) (map[PlanIdentity]PlanCost, error) {
	out := make(map[PlanIdentity]PlanCost, len(plans))
	if len(plans) == 0 {
		return out, nil
	}
	assocs, err := t.planAssociations(ctx, f, plans)
	if err != nil {
		return nil, err
	}
	all, err := t.planCostsForAssociations(ctx, f, assocs)
	if err != nil {
		return nil, err
	}
	for _, p := range plans {
		if pc, ok := all[p]; ok {
			out[p] = pc
		}
	}
	return out, nil
}

// PlanSessionIDsByPlan returns the in-window associated session IDs for every requested plan in
// one query. It starts from the small lifetime plan-artifact associations and joins window
// membership, rather than scanning scoped facts with a correlated lookup per fact.
func (t *Tenant) PlanSessionIDsByPlan(ctx context.Context, f AnalyticsFilter, plans []PlanIdentity) (map[PlanIdentity][]string, error) {
	out := make(map[PlanIdentity][]string, len(plans))
	if len(plans) == 0 {
		return out, nil
	}
	values, pageArgs := planKeyValues(plans)
	w, wargs := f.factWhere()
	args := append([]any{}, pageArgs...)
	args = append(args, wargs...)
	rows, err := t.rdb.QueryContext(ctx, `WITH page(repo_id,plan) AS (VALUES `+values+`), associated AS (
		 SELECT DISTINCT a.repo_id,a.plan,a.conversation_id FROM facts a
		 WHERE a.type='artifact_version'
		 AND EXISTS(SELECT 1 FROM page p WHERE p.repo_id=a.repo_id AND p.plan=a.plan)
		 AND EXISTS(SELECT 1 FROM facts wf WHERE wf.conversation_id=a.conversation_id AND `+w+`)
		) SELECT repo_id,plan,conversation_id FROM associated ORDER BY repo_id,plan,conversation_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key PlanIdentity
		var id string
		if err := rows.Scan(&key.RepoID, &key.Plan, &id); err != nil {
			return nil, err
		}
		out[key] = append(out[key], id)
	}
	return out, rows.Err()
}

// PlanArtifactKindsFor returns the in-window artifact-kind counts for a page of plans in one read.
func (t *Tenant) PlanArtifactKindsFor(ctx context.Context, f AnalyticsFilter, plans []PlanIdentity) (map[PlanIdentity]map[string]int, error) {
	out := make(map[PlanIdentity]map[string]int, len(plans))
	if len(plans) == 0 {
		return out, nil
	}
	values, pageArgs := planKeyValues(plans)
	w, wargs := f.factWhere()
	args := append([]any{}, pageArgs...)
	args = append(args, wargs...)
	rows, err := t.rdb.QueryContext(ctx, `WITH page(repo_id,plan) AS (VALUES `+values+`)
		SELECT repo_id,plan,kind,COUNT(DISTINCT path) FROM facts
		WHERE type='artifact_version' AND `+w+`
		AND EXISTS(SELECT 1 FROM page p WHERE p.repo_id=facts.repo_id AND p.plan=facts.plan)
		GROUP BY repo_id,plan,kind`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key PlanIdentity
		var kind string
		var n int
		if err := rows.Scan(&key.RepoID, &key.Plan, &kind, &n); err != nil {
			return nil, err
		}
		if out[key] == nil {
			out[key] = map[string]int{}
		}
		out[key][kind] = n
	}
	return out, rows.Err()
}

// PlanDesignScoresFor returns each check's latest score for the lifetime-latest design version per
// path for a page of plans in one read.
func (t *Tenant) PlanDesignScoresFor(ctx context.Context, plans []PlanIdentity) (map[PlanIdentity]map[string]float64, error) {
	out := make(map[PlanIdentity]map[string]float64, len(plans))
	if len(plans) == 0 {
		return out, nil
	}
	values, pageArgs := planKeyValues(plans)
	rows, err := t.rdb.QueryContext(ctx, `WITH page(repo_id,plan) AS (VALUES `+values+`)
		SELECT d.repo_id,d.plan,s.check_name,s.result FROM facts d JOIN scores s ON s.content_hash=d.content_hash
		WHERE d.type='artifact_version' AND d.kind='design'
		AND EXISTS(SELECT 1 FROM page p WHERE p.repo_id=d.repo_id AND p.plan=d.plan)
		AND d.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=d.repo_id AND x.path=d.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1)
		AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=s.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1)
		ORDER BY d.repo_id,d.plan,s.check_name,d.rowid`, pageArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key PlanIdentity
		var check string
		var score float64
		if err := rows.Scan(&key.RepoID, &key.Plan, &check, &score); err != nil {
			return nil, err
		}
		if out[key] == nil {
			out[key] = map[string]float64{}
		}
		out[key][check] = score
	}
	return out, rows.Err()
}

// PlanSortValid reports whether sortBy names a supported plan sort measure. Unsupported sorts are
// rejected before querying so a store read error is never reported as an invalid sort.
func PlanSortValid(sortBy string) bool {
	col, _, _ := planSortExpression(sortBy)
	return col != ""
}

// PlanAssociatedCost applies the existing deduplicated usage and pricing functions to each
// in-window session with a lifetime artifact association to this repo/plan.
func (t *Tenant) PlanAssociatedCost(ctx context.Context, f AnalyticsFilter, repo, plan string) (*float64, int, int, error) {
	costs, err := t.PlanAssociatedCosts(ctx, f, []PlanIdentity{{RepoID: repo, Plan: plan}})
	if err != nil {
		return nil, 0, 0, err
	}
	pc := costs[PlanIdentity{RepoID: repo, Plan: plan}]
	return pc.CostUSD, pc.UnpricedCalls, pc.Calls, nil
}

type PlanCursor struct {
	TS           float64
	RepoID, Plan string
	Null         bool
}

// planSortExpression returns only fixed SQL fragments. Dynamic names remain bound parameters.
func planSortExpression(sortBy string) (string, []any, bool) {
	cols := map[string]string{"first_ts": "p.first_ts", "last_ts": "p.last_ts", "artifacts": "p.artifacts", "versions": "p.versions", "sessions": "p.sessions", "shared_sessions": "COALESCE(sh.shared_sessions,0)", "executions_complete": "COALESCE(e.executions_complete,0)", "executions_unreported": "COALESCE(e.executions_unreported,0)", "executions_started": "COALESCE(e.executions_started,0)", "span_days": "(p.last_ts-p.first_ts)/86400.0"}
	if col := cols[sortBy]; col != "" {
		return col, nil, false
	}
	if strings.HasPrefix(sortBy, "artifacts:") {
		kind := strings.TrimPrefix(sortBy, "artifacts:")
		if kind == "" || strings.Contains(kind, ":") {
			return "", nil, false
		}
		return `(SELECT COUNT(DISTINCT k.path) FROM facts k WHERE k.type='artifact_version' AND k.repo_id=p.repo_id AND k.plan=p.plan AND k.kind=? AND __PLAN_SORT_WINDOW__)`, []any{kind}, true
	}
	if strings.HasPrefix(sortBy, "design_score:") {
		check := strings.TrimPrefix(sortBy, "design_score:")
		if check == "" || strings.Contains(check, ":") {
			return "", nil, false
		}
		return `(SELECT s.result FROM facts d JOIN scores s ON s.content_hash=d.content_hash WHERE d.type='artifact_version' AND d.repo_id=p.repo_id AND d.plan=p.plan AND d.kind='design' AND d.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=d.repo_id AND x.path=d.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) AND s.check_name=? AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=s.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1) ORDER BY s.id DESC LIMIT 1)`, []any{check}, false
	}
	switch sortBy {
	case "associated_cost_usd":
		return `(CASE WHEN COALESCE(pc.calls,0)=0 THEN 0 WHEN COALESCE(pc.unpriced,0)=pc.calls THEN NULL ELSE pc.cost END)`, nil, false
	case "unpriced_calls":
		return `COALESCE(pc.unpriced,0)`, nil, false
	case "complete_share":
		return `1.0*COALESCE(e.executions_complete,0)/NULLIF(COALESCE(e.executions_complete,0)+COALESCE(e.executions_unreported,0)+COALESCE(e.executions_started,0),0)`, nil, false
	}
	return "", nil, false
}

func wArgsForSort(f AnalyticsFilter) []any {
	_, args := f.factWhere()
	return args
}

// EntitySnapshot identifies the fact and derived-score state observed by a paged traversal.
// Fact rowid supplements received_at because receive timestamps can tie.
type EntitySnapshot struct {
	FactWatermark int64
	FactRowID     int64
	Revision      int64
}

func (t *Tenant) PlanExecutionSnapshot(ctx context.Context) (EntitySnapshot, error) {
	var s EntitySnapshot
	err := t.rdb.QueryRowContext(ctx, `SELECT
		(SELECT COALESCE(MAX(received_at),0) FROM facts),
		(SELECT COALESCE(MAX(rowid),0) FROM facts),
		MAX(revision) FROM (
			SELECT COALESCE(MAX(id),0) revision FROM scores
			UNION ALL SELECT COALESCE(MAX(id),0) FROM screens
		)`).Scan(&s.FactWatermark, &s.FactRowID, &s.Revision)
	return s, err
}

func planCostsValues(costs map[PlanIdentity]PlanCost) (string, []any) {
	keys := make([]PlanIdentity, 0, len(costs))
	for k := range costs {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].RepoID != keys[j].RepoID {
			return keys[i].RepoID < keys[j].RepoID
		}
		return keys[i].Plan < keys[j].Plan
	})
	var b strings.Builder
	args := make([]any, 0, len(keys)*5)
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString("(?,?,?,?,?)")
		pc := costs[k]
		var cost any
		if pc.CostUSD != nil {
			cost = *pc.CostUSD
		}
		args = append(args, k.RepoID, k.Plan, cost, pc.UnpricedCalls, pc.Calls)
	}
	return b.String(), args
}

// PlanEntitiesPage lists plans established by in-window artifact facts. Session and execution
// association is deliberately derived from captured artifact and brief facts only.
func (t *Tenant) PlanEntitiesPage(ctx context.Context, f AnalyticsFilter, sortBy string, desc bool, cur *PlanCursor, limit int) ([]PlanEntity, bool, error) {
	return t.PlanEntitiesPageWithCosts(ctx, f, sortBy, desc, cur, limit, nil)
}

// PlanEntitiesPageWithCosts is PlanEntitiesPage with a precomputed cost snapshot. Supplying the
// snapshot lets a caller that already needs every plan's cost avoid a second deduplicated usage
// pass; nil computes it here for cost sorts.
func (t *Tenant) PlanEntitiesPageWithCosts(ctx context.Context, f AnalyticsFilter, sortBy string, desc bool, cur *PlanCursor, limit int, costs map[PlanIdentity]PlanCost) ([]PlanEntity, bool, error) {
	col, sortArgs, dynamic := planSortExpression(sortBy)
	if col == "" {
		return nil, false, fmt.Errorf("unsupported plan sort")
	}
	w, args := f.factWhere()
	usageFilter := f
	usageFilter.Plans = nil
	usageFilter.Repos = nil
	usageQ, usageArgs := usageRowsWhere(usageFilter)
	usageCTE := strings.TrimPrefix(usageQ, "WITH ")
	col = strings.ReplaceAll(col, "__PLAN_SORT_WINDOW__", w)
	wArgs := append([]any{}, args...)
	needsCost := sortBy == "associated_cost_usd" || sortBy == "unpriced_calls"
	costCTE, costJoin := "", ""
	costArgs := []any{}
	if needsCost {
		if costs == nil {
			var err error
			costs, err = t.PlanCostsAll(ctx, f)
			if err != nil {
				return nil, false, err
			}
		}
		if len(costs) == 0 {
			costCTE = `, plan_costs(repo_id,plan,cost,unpriced,calls) AS (SELECT '','',NULL,0,0 WHERE 0)`
		} else {
			values, args := planCostsValues(costs)
			costCTE = `, plan_costs(repo_id,plan,cost,unpriced,calls) AS (VALUES ` + values + `)`
			costArgs = args
		}
		costJoin = ` LEFT JOIN plan_costs pc USING(repo_id,plan)`
	}
	q := `WITH ` + usageCTE + `, selected AS (SELECT repo_id,plan,path,content_hash,conversation_id,ts FROM facts WHERE type='artifact_version' AND plan<>'' AND ` + w + `), plans AS (
	 SELECT repo_id,plan,COUNT(DISTINCT path) artifacts,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) sessions,MIN(ts) first_ts,MAX(ts) last_ts FROM selected GROUP BY repo_id,plan
	), session_plans AS (SELECT conversation_id,COUNT(DISTINCT plan) np FROM facts WHERE type='artifact_version' AND plan<>'' GROUP BY conversation_id), shared AS (SELECT s.repo_id,s.plan,COUNT(DISTINCT s.conversation_id) shared_sessions FROM selected s JOIN session_plans sp ON sp.conversation_id=s.conversation_id AND sp.np>1 GROUP BY s.repo_id,s.plan), execs AS (
	 SELECT repo_id,plan,SUM(shape='complete') executions_complete,SUM(shape='unreported') executions_unreported,SUM(shape='started') executions_started FROM (
	 SELECT b.repo_id,b.plan,b.conversation_id,b.path,` + execShapeSQL + ` shape FROM (SELECT repo_id,plan,conversation_id,path,harness,ts,ROW_NUMBER() OVER(PARTITION BY repo_id,conversation_id,path ORDER BY ts,rowid) rn FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + `) b WHERE rn=1) GROUP BY repo_id,plan
	)` + costCTE + `, computed AS (SELECT p.repo_id,p.plan,p.artifacts,p.versions,p.sessions,COALESCE(sh.shared_sessions,0) shared_sessions,COALESCE(e.executions_complete,0) executions_complete,COALESCE(e.executions_unreported,0) executions_unreported,COALESCE(e.executions_started,0) executions_started,p.first_ts,p.last_ts,CAST((` + col + `) AS REAL) AS sort_value FROM plans p LEFT JOIN shared sh USING(repo_id,plan) LEFT JOIN execs e USING(repo_id,plan)` + costJoin + `) SELECT * FROM computed`
	args = append(append([]any{}, usageArgs...), args...)
	args = append(args, wArgs...)
	if needsCost {
		args = append(args, costArgs...)
	}
	args = append(args, sortArgs...)
	if dynamic {
		args = append(args, wArgsForSort(f)...)
	}
	if cur != nil {
		op := "<"
		if !desc {
			op = ">"
		}
		if cur.Null {
			q += ` WHERE sort_value IS NULL AND (repo_id>? OR (repo_id=? AND plan>?))`
			args = append(args, cur.RepoID, cur.RepoID, cur.Plan)
		} else {
			q += fmt.Sprintf(" WHERE (sort_value %s ? OR sort_value IS NULL OR (sort_value=? AND (repo_id>? OR (repo_id=? AND plan>?))))", op)
			args = append(args, cur.TS, cur.TS, cur.RepoID, cur.RepoID, cur.Plan)
		}
	}
	dir := "ASC"
	if desc {
		dir = "DESC"
	}
	q += fmt.Sprintf(" ORDER BY sort_value IS NULL ASC,sort_value %s,repo_id ASC,plan ASC LIMIT ?", dir)
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []PlanEntity{}
	for rows.Next() {
		var x PlanEntity
		var sortValue sql.NullFloat64
		if err := rows.Scan(&x.RepoID, &x.Plan, &x.Artifacts, &x.Versions, &x.Sessions, &x.SharedSessions, &x.ExecutionsComplete, &x.ExecutionsUnreported, &x.ExecutionsStarted, &x.FirstTS, &x.LastTS, &sortValue); err != nil {
			return nil, false, err
		}
		if sortValue.Valid {
			v := sortValue.Float64
			x.SortValue = &v
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	if len(out) > 0 {
		keys := make([]PlanIdentity, len(out))
		for i := range out {
			keys[i] = PlanIdentity{RepoID: out[i].RepoID, Plan: out[i].Plan}
		}
		kinds, err := t.PlanArtifactKindsFor(ctx, f, keys)
		if err != nil {
			return nil, false, err
		}
		scores, err := t.PlanDesignScoresFor(ctx, keys)
		if err != nil {
			return nil, false, err
		}
		for i, key := range keys {
			out[i].ArtifactsByKind = kinds[key]
			if out[i].ArtifactsByKind == nil {
				out[i].ArtifactsByKind = map[string]int{}
			}
			out[i].DesignScores = scores[key]
			if out[i].DesignScores == nil {
				out[i].DesignScores = map[string]float64{}
			}
		}
	}
	return out, more, nil
}

func (t *Tenant) PlanArtifactKinds(ctx context.Context, f AnalyticsFilter, repo, plan string) (map[string]int, error) {
	w, args := f.factWhere()
	args = append(args, repo, plan)
	rows, err := t.rdb.QueryContext(ctx, `SELECT kind,COUNT(DISTINCT path) FROM facts WHERE type='artifact_version' AND `+w+` AND repo_id=? AND plan=? GROUP BY kind`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var kind string
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			return nil, err
		}
		out[kind] = n
	}
	return out, rows.Err()
}

// PlanDesignScores returns each check's latest score for the plan's lifetime-latest design version.
func (t *Tenant) PlanDesignScores(ctx context.Context, repo, plan string) (map[string]float64, error) {
	rows, err := t.rdb.QueryContext(ctx, `SELECT s.check_name,s.result FROM facts f JOIN scores s ON s.content_hash=f.content_hash
		WHERE f.type='artifact_version' AND f.repo_id=? AND f.plan=? AND f.kind='design'
		AND f.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=f.repo_id AND x.path=f.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1)
		AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=f.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1)
		ORDER BY s.check_name`, repo, plan)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var check string
		var score float64
		if err := rows.Scan(&check, &score); err != nil {
			return nil, err
		}
		out[check] = score
	}
	return out, rows.Err()
}

func (t *Tenant) PlanSessionIDs(ctx context.Context, f AnalyticsFilter, repo, plan string) ([]string, error) {
	byPlan, err := t.PlanSessionIDsByPlan(ctx, f, []PlanIdentity{{RepoID: repo, Plan: plan}})
	if err != nil {
		return nil, err
	}
	return byPlan[PlanIdentity{RepoID: repo, Plan: plan}], nil
}

func (t *Tenant) ExecutionScores(ctx context.Context, repo, plan, conversation, briefPath string) (map[string]float64, error) {
	reportPath := strings.Replace(briefPath, "/briefs/", "/reports/", 1)
	rows, err := t.rdb.QueryContext(ctx, `SELECT f.kind,s.check_name,s.result FROM facts f JOIN scores s ON s.content_hash=f.content_hash
		WHERE f.type='artifact_version' AND f.repo_id=? AND f.plan=? AND f.conversation_id=? AND f.path IN (?,?)
		AND f.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=f.repo_id AND x.path=f.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1)
		AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=f.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1)`, repo, plan, conversation,
		briefPath, reportPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var kind, check string
		var score float64
		if err := rows.Scan(&kind, &check, &score); err != nil {
			return nil, err
		}
		prefix := "brief_score:"
		if kind == "report" {
			prefix = "report_score:"
		}
		out[prefix+check] = score
	}
	return out, rows.Err()
}

func (t *Tenant) PlanEntityCount(ctx context.Context, f AnalyticsFilter) (int, error) {
	w, args := f.factWhere()
	var n int
	err := t.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT repo_id,plan FROM facts WHERE type='artifact_version' AND plan<>'' AND `+w+` GROUP BY repo_id,plan)`, args...).Scan(&n)
	return n, err
}

type PlanDetailRow struct {
	RepoID, Plan, Path, ConversationID, Event, Type string
	TS                                              float64
	RowID                                           int64
}

func (t *Tenant) PlanDetailCount(ctx context.Context, f AnalyticsFilter, repo, plan, collection string) (int, error) {
	w, args := f.factWhere()
	if collection == "events" {
		eventFilter := f
		eventFilter.Repos = nil
		eventFilter.Plans = nil
		w, args = eventFilter.factWhere()
	}
	args = append(args, repo, plan)
	var q string
	switch collection {
	case "artifacts":
		q = `SELECT COUNT(*) FROM (SELECT path FROM facts WHERE type='artifact_version' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY path)`
	case "sessions":
		q = `SELECT COUNT(DISTINCT s.conversation_id) FROM facts s WHERE ` + w + ` AND s.conversation_id IN (SELECT a.conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`
	case "executions":
		q = `SELECT COUNT(*) FROM (SELECT repo_id,conversation_id,path FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY repo_id,conversation_id,path)`
	case "events":
		q = `SELECT COUNT(*) FROM facts WHERE ` + w + ` AND conversation_id IN (SELECT DISTINCT conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`
	default:
		return 0, fmt.Errorf("unsupported plan collection")
	}
	var n int
	err := t.rdb.QueryRowContext(ctx, q, args...).Scan(&n)
	return n, err
}

// PlanDetailPage pages one bounded plan collection. Collection identity orders are stable and the
// filters in f apply to the window facts; session association uses lifetime plan artifacts.
func (t *Tenant) PlanDetailPage(ctx context.Context, f AnalyticsFilter, repo, plan, collection string, after string, afterTS float64, limit int) ([]PlanDetailRow, bool, error) {
	w, args := f.factWhere()
	if collection == "events" {
		eventFilter := f
		eventFilter.Repos = nil
		eventFilter.Plans = nil
		w, args = eventFilter.factWhere()
	}
	args = append(args, repo, plan)
	var q string
	switch collection {
	case "artifacts":
		q = `SELECT repo_id,plan,path,'','','',MAX(ts) FROM facts WHERE type='artifact_version' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY repo_id,plan,path`
	case "sessions":
		q = `SELECT s.repo_id,?,'',s.conversation_id,'','',MAX(s.ts) FROM facts s WHERE ` + w + ` AND s.conversation_id IN (SELECT a.conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?) GROUP BY s.repo_id,s.conversation_id`
	case "executions":
		q = `SELECT repo_id,plan,path,conversation_id,'','brief',MIN(ts) FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY repo_id,plan,path,conversation_id`
	case "events":
		q = `SELECT repo_id,plan,path,conversation_id,event,type,ts,rowid FROM facts WHERE ` + w + ` AND conversation_id IN (SELECT DISTINCT conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`
	default:
		return nil, false, fmt.Errorf("unsupported plan collection")
	}
	if collection == "sessions" {
		args = append([]any{plan}, args...)
	} // plan in SELECT precedes the window and identity parameters
	if after != "" {
		switch collection {
		case "artifacts":
			q += ` HAVING path>?`
		case "sessions":
			q += ` HAVING s.conversation_id>?`
		case "executions":
			conversation, path, _ := strings.Cut(after, "|")
			q += ` HAVING (MIN(ts)<? OR (MIN(ts)=? AND (conversation_id>? OR (conversation_id=? AND path>?))))`
			args = append(args, afterTS, afterTS, conversation, conversation, path)
		case "events":
			q += ` AND (ts<? OR (ts=? AND (type>? OR (type=? AND rowid>?))))`
		}
	}
	if collection == "events" {
		q += ` ORDER BY ts DESC,type ASC,rowid ASC`
	} else {
		q += ` ORDER BY ` + map[string]string{"artifacts": "path ASC", "sessions": "s.conversation_id ASC", "executions": "MIN(ts) DESC,conversation_id ASC,path ASC"}[collection]
	}
	if collection == "events" && after != "" {
		typ, rawID, _ := strings.Cut(after, "|")
		var rowID int64
		_, _ = fmt.Sscan(rawID, &rowID)
		args = append(args, afterTS, afterTS, typ, typ, rowID)
	} else if after != "" && collection != "executions" {
		args = append(args, after)
	}
	q += ` LIMIT ?`
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []PlanDetailRow{}
	for rows.Next() {
		var x PlanDetailRow
		if collection == "events" {
			if err := rows.Scan(&x.RepoID, &x.Plan, &x.Path, &x.ConversationID, &x.Event, &x.Type, &x.TS, &x.RowID); err != nil {
				return nil, false, err
			}
		} else if err := rows.Scan(&x.RepoID, &x.Plan, &x.Path, &x.ConversationID, &x.Event, &x.Type, &x.TS); err != nil {
			return nil, false, err
		}
		out = append(out, x)
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
