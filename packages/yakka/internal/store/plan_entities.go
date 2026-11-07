package store

import (
	"context"
	"database/sql"
	"fmt"
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
}

// PlanAssociatedCost applies the existing deduplicated usage and pricing functions to each
// in-window session with a lifetime artifact association to this repo/plan.
func (t *Tenant) PlanAssociatedCost(ctx context.Context, f AnalyticsFilter, repo, plan string) (*float64, int, int, error) {
	usageFilter := f
	usageFilter.Plans = nil
	uq, uargs := usageRowsWhere(usageFilter)
	w, wargs := f.factWhere()
	args := append([]any{}, uargs...)
	args = append(args, repo, plan)
	args = append(args, wargs...)
	var value sql.NullFloat64
	var unpriced, calls int
	err := t.rdb.QueryRowContext(ctx, uq+`, associated AS (
		 SELECT DISTINCT a.conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?
		 AND a.conversation_id IN (SELECT conversation_id FROM facts WHERE `+w+`)
	) SELECT SUM(wf_usage_cost(u.harness,u.model,u.tok_in,u.tok_out,u.tok_cache_read,u.tok_cache_write,u.tok_reasoning,u.cost_reported)),
	 COALESCE(SUM(1-wf_usage_priced(u.harness,u.model,u.tok_in,u.tok_out,u.tok_cache_read,u.tok_cache_write,u.tok_reasoning,u.cost_reported)),0),COUNT(*)
	 FROM kept u JOIN associated a USING(conversation_id)`, args...).Scan(&value, &unpriced, &calls)
	if err != nil {
		return nil, 0, 0, err
	}
	if value.Valid {
		v := value.Float64
		return &v, unpriced, calls, nil
	}
	return nil, unpriced, calls, nil
}

type PlanCursor struct {
	TS           float64
	RepoID, Plan string
}

// PlanEntitiesPage lists plans established by in-window artifact facts. Session and execution
// association is deliberately derived from captured artifact and brief facts only.
func (t *Tenant) PlanEntitiesPage(ctx context.Context, f AnalyticsFilter, sortBy string, desc bool, cur *PlanCursor, limit int) ([]PlanEntity, bool, error) {
	cols := map[string]string{"first_ts": "first_ts", "last_ts": "last_ts", "artifacts": "artifacts", "versions": "versions", "sessions": "sessions", "shared_sessions": "shared_sessions", "executions_complete": "executions_complete", "executions_unreported": "executions_unreported", "executions_started": "executions_started", "span_days": "(last_ts-first_ts)/86400.0"}
	col := cols[sortBy]
	if col == "" {
		return nil, false, fmt.Errorf("unsupported plan sort")
	}
	w, args := f.factWhere()
	q := `WITH selected AS (SELECT repo_id,plan,path,content_hash,conversation_id,ts FROM facts WHERE type='artifact_version' AND plan<>'' AND ` + w + `), plans AS (
	 SELECT repo_id,plan,COUNT(DISTINCT path) artifacts,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) sessions,MIN(ts) first_ts,MAX(ts) last_ts FROM selected GROUP BY repo_id,plan
	), shared AS (SELECT s.repo_id,s.plan,COUNT(DISTINCT s.conversation_id) shared_sessions FROM selected s WHERE (SELECT COUNT(DISTINCT f2.plan) FROM facts f2 WHERE f2.type='artifact_version' AND f2.conversation_id=s.conversation_id AND f2.plan<>'')>1 GROUP BY s.repo_id,s.plan), execs AS (
	 SELECT repo_id,plan,SUM(shape='complete') executions_complete,SUM(shape='unreported') executions_unreported,SUM(shape='started') executions_started FROM (
	 SELECT b.repo_id,b.plan,b.conversation_id,b.path,` + execShapeSQL + ` shape FROM (SELECT repo_id,plan,conversation_id,path,harness,ts,ROW_NUMBER() OVER(PARTITION BY repo_id,conversation_id,path ORDER BY ts,rowid) rn FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + `) b WHERE rn=1) GROUP BY repo_id,plan
	) SELECT p.repo_id,p.plan,p.artifacts,p.versions,p.sessions,COALESCE(sh.shared_sessions,0),COALESCE(e.executions_complete,0),COALESCE(e.executions_unreported,0),COALESCE(e.executions_started,0),p.first_ts,p.last_ts FROM plans p LEFT JOIN shared sh USING(repo_id,plan) LEFT JOIN execs e USING(repo_id,plan)`
	args = append(args, args...)
	if cur != nil {
		op := "<"
		if !desc {
			op = ">"
		}
		q += fmt.Sprintf(" WHERE (%s %s ? OR (%s=? AND (p.repo_id>? OR (p.repo_id=? AND p.plan>?))))", col, op, col)
		args = append(args, cur.TS, cur.TS, cur.RepoID, cur.RepoID, cur.Plan)
	}
	dir := "ASC"
	if desc {
		dir = "DESC"
	}
	q += fmt.Sprintf(" ORDER BY %s %s,p.repo_id ASC,p.plan ASC LIMIT ?", col, dir)
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []PlanEntity{}
	for rows.Next() {
		var x PlanEntity
		if err := rows.Scan(&x.RepoID, &x.Plan, &x.Artifacts, &x.Versions, &x.Sessions, &x.SharedSessions, &x.ExecutionsComplete, &x.ExecutionsUnreported, &x.ExecutionsStarted, &x.FirstTS, &x.LastTS); err != nil {
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
	for i := range out {
		kinds, err := t.PlanArtifactKinds(ctx, f, out[i].RepoID, out[i].Plan)
		if err != nil {
			return nil, false, err
		}
		scores, err := t.PlanDesignScores(ctx, out[i].RepoID, out[i].Plan)
		if err != nil {
			return nil, false, err
		}
		out[i].ArtifactsByKind, out[i].DesignScores = kinds, scores
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
	w, args := f.factWhere()
	args = append(args, repo, plan)
	rows, err := t.rdb.QueryContext(ctx, `SELECT DISTINCT s.conversation_id FROM facts s WHERE `+w+` AND EXISTS (
		SELECT 1 FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=? AND a.conversation_id=s.conversation_id) ORDER BY s.conversation_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (t *Tenant) ExecutionScores(ctx context.Context, repo, plan, conversation, briefPath string) (map[string]float64, error) {
	reportPath := strings.Replace(briefPath, "/briefs/", "/reports/", 1)
	rows, err := t.rdb.QueryContext(ctx, `SELECT f.kind,s.check_name,s.result FROM facts f JOIN scores s ON s.content_hash=f.content_hash
		WHERE f.type='artifact_version' AND f.repo_id=? AND f.plan=? AND f.conversation_id=? AND f.path IN (?,?)
		AND f.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=f.repo_id AND x.path=f.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1)
		AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=f.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1)`, repo, plan, conversation,
		briefPath, reportPath)
	if err != nil { return nil,err }
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() { var kind, check string; var score float64; if err := rows.Scan(&kind,&check,&score); err != nil { return nil,err }; prefix := "brief_score:"; if kind == "report" { prefix="report_score:" }; out[prefix+check]=score }
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
	args = append(args, repo, plan)
	var q string
	switch collection {
	case "artifacts":
		q = `SELECT COUNT(*) FROM (SELECT path FROM facts WHERE type='artifact_version' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY path)`
	case "sessions":
		q = `SELECT COUNT(DISTINCT s.conversation_id) FROM facts s WHERE ` + w + ` AND EXISTS(SELECT 1 FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=? AND a.conversation_id=s.conversation_id)`
	case "executions":
		q = `SELECT COUNT(*) FROM (SELECT repo_id,conversation_id,path FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY repo_id,conversation_id,path)`
	case "events":
		q = `SELECT COUNT(*) FROM facts WHERE ` + w + ` AND repo_id=? AND conversation_id IN (SELECT DISTINCT conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`
		args = append(args, repo, plan)
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
	args = append(args, repo, plan)
	var q string
	switch collection {
	case "artifacts":
		q = `SELECT repo_id,plan,path,'','','',MAX(ts) FROM facts WHERE type='artifact_version' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY repo_id,plan,path`
	case "sessions":
		q = `SELECT s.repo_id,?,'',s.conversation_id,'','',MAX(s.ts) FROM facts s WHERE ` + w + ` AND EXISTS(SELECT 1 FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=? AND a.conversation_id=s.conversation_id) GROUP BY s.repo_id,s.conversation_id`
	case "executions":
		q = `SELECT repo_id,plan,path,conversation_id,'','brief',MIN(ts) FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + w + ` AND repo_id=? AND plan=? GROUP BY repo_id,plan,path,conversation_id`
	case "events":
		q = `SELECT repo_id,plan,path,conversation_id,event,type,ts,rowid FROM facts WHERE ` + w + ` AND repo_id=? AND conversation_id IN (SELECT DISTINCT conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`
		args = append(args, repo, plan)
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
			q += ` HAVING path>?`
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
	} else if after != "" {
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
