package store

import (
	"context"
	"fmt"
	"strings"
)

type ActivityRow struct {
	EventTime                                                                float64
	Type, Identity, ConversationID, RepoID, Path, Harness, Kind, Plan, Stage string
}

// ActivityPage merges existing ledger observations and applies the shared filter before keyset paging.
func (t *Tenant) ActivityPage(ctx context.Context, f AnalyticsFilter, afterTS *float64, afterType, afterID string, limit int) ([]ActivityRow, bool, int, error) {
	fw, fa := f.factWhere()
	rw, ra := f.rejWhere()
	factBucket := `SELECT MIN(ts) event_time,'session_start' type,'session_start:'||conversation_id identity,conversation_id,'' repo_id,'' path,MIN(harness) harness,'' kind,'' plan,'' stage FROM facts WHERE ` + fw + ` GROUP BY conversation_id
 UNION ALL SELECT ts,'artifact_version','artifact_version:'||repo_id||':'||path||':'||content_hash,conversation_id,repo_id,path,harness,kind,plan,'' FROM facts WHERE type='artifact_version' AND ` + fw + `
 UNION ALL SELECT ts,'brief_execution','brief_execution:'||repo_id||':'||conversation_id||':'||path,conversation_id,repo_id,path,harness,kind,plan,'' FROM (SELECT MIN(ts) ts,repo_id,conversation_id,path,MIN(harness) harness,MIN(kind) kind,MIN(plan) plan FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + fw + ` GROUP BY repo_id,conversation_id,path)
 UNION ALL SELECT at/1e9,'rejection','rejection:'||id,conversation_id,'',path,'',wf_kind(path),wf_plan(path),stage FROM rejections WHERE ` + rw
	args := append(append([]any{}, fa...), fa...)
	args = append(args, fa...)
	args = append(args, ra...)
	where := ""
	if afterTS != nil {
		where = ` WHERE event_time < ? OR (event_time = ? AND (type > ? OR (type = ? AND identity > ?)))`
		args = append(args, *afterTS, *afterTS, afterType, afterType, afterID)
	}
	countQ := `WITH observations AS (` + factBucket + `) SELECT COUNT(*) FROM observations`
	var total int
	countArgs := append(append(append(append([]any{}, fa...), fa...), fa...), ra...)
	if err := t.rdb.QueryRowContext(ctx, countQ, countArgs...).Scan(&total); err != nil {
		return nil, false, 0, err
	}
	q := `WITH observations AS (` + factBucket + `) SELECT event_time,type,identity,conversation_id,repo_id,path,harness,kind,plan,stage FROM observations` + where + ` ORDER BY event_time DESC,type ASC,identity ASC LIMIT ?`
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, false, 0, err
	}
	defer rows.Close()
	out := []ActivityRow{}
	for rows.Next() {
		var x ActivityRow
		if err := rows.Scan(&x.EventTime, &x.Type, &x.Identity, &x.ConversationID, &x.RepoID, &x.Path, &x.Harness, &x.Kind, &x.Plan, &x.Stage); err != nil {
			return nil, false, 0, err
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		return nil, false, 0, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, total, nil
}

// ActivityTypeCounts counts each activity observation type in the filter's window and scope. With
// a cohort restriction present the counts are post-restriction; callers pass a filter cleared of
// the cohort for the pre-restriction scope. The four units are the 17.3.1 by_type keys.
func (t *Tenant) ActivityTypeCounts(ctx context.Context, f AnalyticsFilter) (map[string]int, error) {
	fw, fa := f.factWhere()
	rw, ra := f.rejWhere()
	counts := map[string]int{}
	queries := []struct {
		name, q string
		args    []any
	}{
		{"session_start", `SELECT COUNT(*) FROM (SELECT conversation_id FROM facts WHERE ` + fw + ` GROUP BY conversation_id)`, fa},
		{"artifact_version", `SELECT COUNT(*) FROM facts WHERE type='artifact_version' AND ` + fw, fa},
		{"execution", `SELECT COUNT(DISTINCT repo_id||':'||conversation_id||':'||path) FROM facts WHERE type='artifact_version' AND kind='brief' AND ` + fw, fa},
		{"rejection", `SELECT COUNT(*) FROM rejections WHERE ` + rw, ra},
	}
	for _, x := range queries {
		var count int
		if err := t.rdb.QueryRowContext(ctx, x.q, x.args...).Scan(&count); err != nil {
			return nil, fmt.Errorf("activity type count %s: %w", x.name, err)
		}
		counts[x.name] = count
	}
	return counts, nil
}

// ActivityProbe counts new observations after a receive watermark and returns the latest watermark.
func (t *Tenant) ActivityProbe(ctx context.Context, after int64, f AnalyticsFilter) (map[string]int, int64, error) {
	fw, fa := f.factWhere()
	rw, ra := f.rejWhere()
	_ = rw
	_ = ra
	counts := map[string]int{"session_start": 0, "artifact_version": 0, "brief_execution": 0, "rejection": 0}
	queries := []struct {
		name, q string
		args    []any
	}{
		{"session_start", `SELECT COUNT(*) FROM (SELECT conversation_id FROM facts WHERE ` + fw + ` GROUP BY conversation_id HAVING MIN(received_at)>?)`, append(append([]any{}, fa...), after)},
		{"artifact_version", `SELECT COUNT(*) FROM facts WHERE received_at>? AND type='artifact_version' AND ` + fw, append([]any{after}, fa...)},
		{"brief_execution", `SELECT COUNT(DISTINCT repo_id||':'||conversation_id||':'||path) FROM facts WHERE received_at>? AND type='artifact_version' AND kind='brief' AND ` + fw, append([]any{after}, fa...)},
		{"rejection", `SELECT COUNT(*) FROM rejections WHERE at>? AND ` + rejProbeWhere(f), append([]any{after}, rejProbeArgs(f)...)}}
	var watermark int64
	if err := t.rdb.QueryRowContext(ctx, `SELECT MAX(v) FROM (SELECT COALESCE(MAX(received_at),0) v FROM facts UNION ALL SELECT COALESCE(MAX(at),0) v FROM rejections)`).Scan(&watermark); err != nil {
		return nil, 0, err
	}
	for _, x := range queries {
		var count int
		if err := t.rdb.QueryRowContext(ctx, x.q, x.args...).Scan(&count); err != nil {
			return nil, 0, fmt.Errorf("activity probe %s: %w", x.name, err)
		}
		counts[x.name] = count
	}
	return counts, watermark, nil
}
func rejProbeWhere(f AnalyticsFilter) string {
	w, _ := f.rejWhere()
	w = strings.TrimPrefix(w, "at >= ? AND at <= ?")
	w = strings.TrimPrefix(w, " AND ")
	if w == "" {
		return "1"
	}
	return w
}
func rejProbeArgs(f AnalyticsFilter) []any {
	_, a := f.rejWhere()
	if len(a) < 2 {
		return nil
	}
	return a[2:]
}
