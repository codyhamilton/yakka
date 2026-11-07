package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

func (t *Tenant) ArtifactContentBytes(hash string) (int64, bool, error) {
	if err := validHash(hash); err != nil {
		return 0, false, err
	}
	st, err := os.Stat(t.blobPath(hash))
	if os.IsNotExist(err) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return st.Size(), true, nil
}

// ArtifactEntity is one file identity with in-window measures and a lifetime-selected version.
type ArtifactEntity struct {
	RepoID, Path, Hash, ConversationID, Source, SHA string
	Versions, WritingSessions                       int
	FirstTS, LastTS, LatestTS                       float64
	ReceivedAt                                      int64
}

type ArtifactCursor struct {
	Value        float64
	RepoID, Path string
}

var artifactSortMeasures = map[string]bool{"last_ts": true, "first_ts": true, "versions": true, "distinct_writing_sessions": true}

func artifactRangeSQL(ranges []SessionRange) (string, []any) {
	cols := map[string]string{"versions": "versions", "distinct_writing_sessions": "writing_sessions", "first_ts": "first_ts", "last_ts": "last_ts"}
	var terms []string
	var args []any
	for _, r := range ranges {
		col := cols[r.Measure]
		if col == "" {
			continue
		}
		if r.Lo != nil {
			terms = append(terms, col+">=?")
			args = append(args, *r.Lo)
		}
		if r.Hi != nil {
			terms = append(terms, col+"<=?")
			args = append(args, *r.Hi)
		}
	}
	if len(terms) == 0 {
		return "", nil
	}
	return " HAVING " + strings.Join(terms, " AND "), args
}

func ArtifactSortMeasure(name string) bool { return artifactSortMeasures[name] }

// ArtifactEntitiesPage selects file membership from in-window facts but its displayed version
// from the full lifetime, ordered exactly like Artifact's established read.
func (t *Tenant) ArtifactEntitiesPage(ctx context.Context, f AnalyticsFilter, ranges []SessionRange, sortBy string, desc bool, cur *ArtifactCursor, limit int) ([]ArtifactEntity, bool, error) {
	if !artifactSortMeasures[sortBy] && sortBy != "sample_hash" {
		return nil, false, fmt.Errorf("unsupported artifact sort")
	}
	w, args := f.factWhere()
	having, hargs := artifactRangeSQL(ranges)
	args = append(args, hargs...)
	q := `WITH members AS (
	 SELECT repo_id,path,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) writing_sessions,
		 MIN(ts) first_ts,MAX(ts) last_ts FROM facts WHERE type='artifact_version' AND ` + w + ` GROUP BY repo_id,path` + having + `
	), latest AS (
	 SELECT m.*, (SELECT content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) hash,
		(SELECT w.conversation_id FROM facts w WHERE w.type='artifact_version' AND w.repo_id=m.repo_id AND w.path=m.path AND w.content_hash=(SELECT x.content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) ORDER BY w.ts ASC,w.row_hash ASC LIMIT 1) conversation_id,
	 (SELECT source FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) source,
	 (SELECT sha FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) sha,
	 (SELECT ts FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) latest_ts,
	 (SELECT received_at FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) received_at
	 FROM members m
	) SELECT repo_id,path,hash,conversation_id,source,sha,versions,writing_sessions,first_ts,last_ts,latest_ts,received_at FROM latest`
	order := sortBy
	if sortBy == "sample_hash" {
		order = "wf_session_hash(repo_id||char(0)||path)"
	}
	if cur != nil {
		op := "<"
		if !desc {
			op = ">"
		}
		q += ` WHERE (` + order + ` ` + op + ` ? OR (` + order + `=? AND (repo_id>? OR (repo_id=? AND path>?))))`
		args = append(args, cur.Value, cur.Value, cur.RepoID, cur.RepoID, cur.Path)
	}
	dir := "ASC"
	if desc {
		dir = "DESC"
	}
	q += ` ORDER BY ` + order + ` ` + dir + `,repo_id ASC,path ASC LIMIT ?`
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []ArtifactEntity{}
	for rows.Next() {
		var x ArtifactEntity
		var hash, conv, source, sha sql.NullString
		if err := rows.Scan(&x.RepoID, &x.Path, &hash, &conv, &source, &sha, &x.Versions, &x.WritingSessions, &x.FirstTS, &x.LastTS, &x.LatestTS, &x.ReceivedAt); err != nil {
			return nil, false, err
		}
		x.Hash, x.ConversationID, x.Source, x.SHA = hash.String, conv.String, source.String, sha.String
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

var artifactNumericMeasures = map[string]string{"versions": "versions", "distinct_writing_sessions": "writing_sessions", "first_ts": "first_ts", "last_ts": "last_ts"}
var ErrArtifactBudget = errors.New("artifact aggregate exceeds the 20000 entity work budget")

// ArtifactAggregate computes exact file-weighted statistics in SQLite, without materializing the
// population in the serving process. Score and blob measures are added only when their full
// coverage rules are available to the caller.
func (t *Tenant) ArtifactAggregate(ctx context.Context, f AnalyticsFilter, ranges []SessionRange, stat, field string) (map[string]any, error) {
	if stat != "count" {
		if _, ok := artifactNumericMeasures[field]; !ok {
			if strings.HasPrefix(field, "score:") && len(strings.TrimPrefix(field, "score:")) > 0 {
				return t.artifactScoreAggregate(ctx, f, ranges, stat, strings.TrimPrefix(field, "score:"))
			}
			if field != "content_bytes" {
				return nil, fmt.Errorf("unsupported artifact aggregate field")
			}
			return t.artifactFileAggregate(ctx, f, ranges, stat, field)
		}
	}
	w, args := f.factWhere()
	having, hargs := artifactRangeSQL(ranges)
	args = append(args, hargs...)
	projection := artifactNumericMeasures[field]
	if stat == "count" {
		projection = "1"
	}
	cte := `WITH members AS (SELECT repo_id,path,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) writing_sessions,MIN(ts) first_ts,MAX(ts) last_ts FROM facts WHERE type='artifact_version' AND ` + w + ` GROUP BY repo_id,path` + having + `), vals AS (SELECT ` + projection + ` value FROM members)`
	if stat == "count" {
		var n int
		err := t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(*) FROM members`, args...).Scan(&n)
		return map[string]any{"stat": "count", "value": n, "eligible_n": n}, err
	}
	var n int
	if err := t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(value) FROM vals`, args...).Scan(&n); err != nil {
		return nil, err
	}
	switch stat {
	case "sum":
		var sum sql.NullFloat64
		err := t.rdb.QueryRowContext(ctx, cte+` SELECT SUM(value) FROM vals`, args...).Scan(&sum)
		var v any
		if sum.Valid {
			v = sum.Float64
		}
		return map[string]any{"stat": "sum", "field": field, "value": v, "eligible_n": n}, err
	case "percentiles":
		out := map[string]any{"stat": stat, "field": field, "eligible_n": n}
		if n == 0 {
			out["p25"], out["p50"], out["p75"] = nil, nil, nil
			return out, nil
		}
		for name, rank := range map[string]int{"p25": max(1, (n+3)/4), "p50": max(1, (n+1)/2), "p75": max(1, (3*n+3)/4)} {
			var v float64
			err := t.rdb.QueryRowContext(ctx, cte+`, ranked AS (SELECT value,ROW_NUMBER() OVER(ORDER BY value) rn FROM vals) SELECT value FROM ranked WHERE rn=?`, append(append([]any{}, args...), rank)...).Scan(&v)
			if err != nil {
				return nil, err
			}
			out[name] = v
		}
		return out, nil
	case "histogram":
		rows, err := t.rdb.QueryContext(ctx, cte+`, stats AS (SELECT MIN(value) lo,MAX(value) hi FROM vals), binned AS (SELECT value,CASE WHEN stats.hi=stats.lo THEN 1 ELSE MIN(10,CAST((value-stats.lo)/(stats.hi-stats.lo)*10 AS INTEGER)+1) END bin FROM vals CROSS JOIN stats) SELECT bin,MIN(value),MAX(value),COUNT(*) FROM binned GROUP BY bin ORDER BY bin`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		bins := []map[string]any{}
		for rows.Next() {
			var b, n int
			var lo, hi float64
			if err := rows.Scan(&b, &lo, &hi, &n); err != nil {
				return nil, err
			}
			bins = append(bins, map[string]any{"bin": b, "lo": lo, "hi": hi, "n": n})
		}
		return map[string]any{"stat": stat, "field": field, "eligible_n": n, "bins": bins}, rows.Err()
	default:
		return nil, fmt.Errorf("unsupported artifact aggregate stat")
	}
}

func (t *Tenant) artifactScoreAggregate(ctx context.Context, f AnalyticsFilter, ranges []SessionRange, stat, check string) (map[string]any, error) {
	if stat != "sum" && stat != "percentiles" && stat != "histogram" {
		return nil, fmt.Errorf("unsupported artifact aggregate stat")
	}
	w, args := f.factWhere()
	having, hargs := artifactRangeSQL(ranges)
	args = append(args, hargs...)
	args = append(args, check)
	cte := `WITH members AS (SELECT repo_id,path,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) writing_sessions,MIN(ts) first_ts,MAX(ts) last_ts FROM facts WHERE type='artifact_version' AND ` + w + ` GROUP BY repo_id,path` + having + `), vals AS (SELECT (SELECT s.result FROM scores s WHERE s.content_hash=(SELECT x.content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) AND s.check_name=? ORDER BY s.id DESC LIMIT 1) value FROM members m)`
	var scope, eligible int
	if err := t.rdb.QueryRowContext(ctx, cte+` SELECT COUNT(*),COUNT(value) FROM vals`, args...).Scan(&scope, &eligible); err != nil {
		return nil, err
	}
	out := map[string]any{"stat": stat, "field": "score:" + check, "eligible_n": eligible, "missing_by_reason": map[string]int{"unscored": scope - eligible}}
	switch stat {
	case "sum":
		var v sql.NullFloat64
		if err := t.rdb.QueryRowContext(ctx, cte+` SELECT SUM(value) FROM vals`, args...).Scan(&v); err != nil {
			return nil, err
		}
		if v.Valid {
			out["value"] = v.Float64
		} else {
			out["value"] = nil
		}
	case "percentiles":
		if eligible == 0 {
			out["p25"], out["p50"], out["p75"] = nil, nil, nil
			return out, nil
		}
		for name, rank := range map[string]int{"p25": max(1, (eligible+3)/4), "p50": max(1, (eligible+1)/2), "p75": max(1, (3*eligible+3)/4)} {
			var v float64
			if err := t.rdb.QueryRowContext(ctx, cte+`, ranked AS (SELECT value,ROW_NUMBER() OVER(ORDER BY value) rn FROM vals WHERE value IS NOT NULL) SELECT value FROM ranked WHERE rn=?`, append(append([]any{}, args...), rank)...).Scan(&v); err != nil {
				return nil, err
			}
			out[name] = v
		}
	case "histogram":
		rows, err := t.rdb.QueryContext(ctx, cte+`, stats AS (SELECT MIN(value) lo,MAX(value) hi FROM vals), binned AS (SELECT value,CASE WHEN stats.hi=stats.lo THEN 1 ELSE MIN(10,CAST((value-stats.lo)/(stats.hi-stats.lo)*10 AS INTEGER)+1) END bin FROM vals CROSS JOIN stats WHERE value IS NOT NULL) SELECT bin,MIN(value),MAX(value),COUNT(*) FROM binned GROUP BY bin ORDER BY bin`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		bins := []map[string]any{}
		for rows.Next() {
			var b, n int
			var lo, hi float64
			if err := rows.Scan(&b, &lo, &hi, &n); err != nil {
				return nil, err
			}
			bins = append(bins, map[string]any{"bin": b, "lo": lo, "hi": hi, "n": n})
		}
		out["bins"] = bins
		return out, rows.Err()
	}
	return out, nil
}

func (t *Tenant) artifactFileAggregate(ctx context.Context, f AnalyticsFilter, ranges []SessionRange, stat, field string) (map[string]any, error) {
	if stat != "sum" && stat != "percentiles" && stat != "histogram" {
		return nil, fmt.Errorf("unsupported artifact aggregate stat")
	}
	count, err := t.ArtifactEntityCount(ctx, f, ranges)
	if err != nil {
		return nil, err
	}
	if count > 20000 {
		return nil, ErrArtifactBudget
	}
	values := make([]float64, 0, count)
	missing := 0
	missingReason := "unscored"
	if field == "content_bytes" {
		missingReason = "content_unavailable"
	}
	var cur *ArtifactCursor
	for {
		page, more, e := t.ArtifactEntitiesPage(ctx, f, ranges, "last_ts", true, cur, 500)
		if e != nil {
			return nil, e
		}
		for _, x := range page {
			var value float64
			ok := false
			if field == "content_bytes" {
				n, available, e := t.ArtifactContentBytes(x.Hash)
				if e != nil {
					return nil, e
				}
				if available {
					value = float64(n)
					ok = true
				}
			} else {
				scores, e := t.ArtifactVersionScores(ctx, x.Hash)
				if e != nil {
					return nil, e
				}
				if score, exists := scores[strings.TrimPrefix(field, "score:")]; exists {
					value = score["score"].(float64)
					ok = true
				}
			}
			if ok {
				values = append(values, value)
			} else {
				missing++
			}
		}
		if !more {
			break
		}
		last := page[len(page)-1]
		cur = &ArtifactCursor{Value: last.LastTS, RepoID: last.RepoID, Path: last.Path}
	}
	sort.Float64s(values)
	eligible := len(values)
	out := map[string]any{"stat": stat, "field": field, "eligible_n": eligible, "missing_by_reason": map[string]int{missingReason: missing}}
	switch stat {
	case "sum":
		var n float64
		for _, v := range values {
			n += v
		}
		if eligible == 0 {
			out["value"] = nil
		} else {
			out["value"] = n
		}
	case "percentiles":
		if eligible == 0 {
			out["p25"], out["p50"], out["p75"] = nil, nil, nil
		} else {
			out["p25"] = values[max(0, (eligible+3)/4-1)]
			out["p50"] = values[max(0, (eligible+1)/2-1)]
			out["p75"] = values[max(0, (3*eligible+3)/4-1)]
		}
	case "histogram":
		bins := []map[string]any{}
		if eligible > 0 {
			lo, hi := values[0], values[eligible-1]
			counts := make([]int, 10)
			for _, v := range values {
				b := 0
				if hi > lo {
					b = min(9, int((v-lo)/(hi-lo)*10))
				}
				counts[b]++
			}
			for i, n := range counts {
				if n > 0 {
					blo := lo + (hi-lo)*float64(i)/10
					bhi := lo + (hi-lo)*float64(i+1)/10
					bins = append(bins, map[string]any{"bin": i + 1, "lo": blo, "hi": bhi, "n": n})
				}
			}
		}
		out["bins"] = bins
	}
	return out, nil
}

// ArtifactEntityCount returns the file-weighted in-window population.
func (t *Tenant) ArtifactEntityCount(ctx context.Context, f AnalyticsFilter, ranges []SessionRange) (int, error) {
	w, args := f.factWhere()
	having, hargs := artifactRangeSQL(ranges)
	args = append(args, hargs...)
	var n int
	err := t.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT repo_id,path,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) writing_sessions,MIN(ts) first_ts,MAX(ts) last_ts FROM facts WHERE type='artifact_version' AND `+w+` GROUP BY repo_id,path`+having+`)`, args...).Scan(&n)
	return n, err
}

// ArtifactVersionHistory returns versions ordered received_at DESC, content_hash ASC. The
// cursor boundary is stable when receive timestamps tie.
type ArtifactVersion struct {
	Hash, ConversationID, Source, SHA string
	TS                                float64
	ReceivedAt                        int64
	AlsoSeen                          int
}

func (t *Tenant) ArtifactScreen(ctx context.Context, hash string) (*ScreenRow, error) {
	var s ScreenRow
	var at int64
	err := t.rdb.QueryRowContext(ctx, `SELECT verdict,scorer,at FROM screens WHERE content_hash=? ORDER BY at DESC,id DESC LIMIT 1`, hash).Scan(&s.Verdict, &s.Scorer, &at)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.At = time.Unix(0, at)
	return &s, nil
}

func (t *Tenant) ArtifactVersionWriter(ctx context.Context, repo, path, hash string) (string, error) {
	var conv string
	err := t.rdb.QueryRowContext(ctx, `SELECT conversation_id FROM facts WHERE type='artifact_version' AND repo_id=? AND path=? AND content_hash=? ORDER BY ts ASC,row_hash ASC LIMIT 1`, repo, path, hash).Scan(&conv)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return conv, err
}

func (t *Tenant) ArtifactVersionHistory(ctx context.Context, repo, path string, afterReceived *int64, afterHash string, limit int) ([]ArtifactVersion, bool, error) {
	q := `SELECT f.content_hash,
	 (SELECT w.conversation_id FROM facts w WHERE w.type='artifact_version' AND w.repo_id=f.repo_id AND w.path=f.path AND w.content_hash=f.content_hash ORDER BY w.ts ASC,w.row_hash ASC LIMIT 1),
	 f.source,f.sha,f.ts,f.received_at,
	 (SELECT COUNT(DISTINCT z.conversation_id)-1 FROM facts z WHERE z.type='artifact_version' AND z.repo_id=f.repo_id AND z.path=f.path AND z.content_hash=f.content_hash) also_seen
	 FROM facts f WHERE f.type='artifact_version' AND f.repo_id=? AND f.path=? AND f.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=f.repo_id AND x.path=f.path AND x.content_hash=f.content_hash ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1)`
	args := []any{repo, path}
	if afterReceived != nil {
		q += ` AND (f.received_at<? OR (f.received_at=? AND f.content_hash>?))`
		args = append(args, *afterReceived, *afterReceived, afterHash)
	}
	q += ` ORDER BY f.received_at DESC,f.content_hash ASC,f.rowid DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []ArtifactVersion{}
	for rows.Next() {
		var v ArtifactVersion
		if err := rows.Scan(&v.Hash, &v.ConversationID, &v.Source, &v.SHA, &v.TS, &v.ReceivedAt, &v.AlsoSeen); err != nil {
			return nil, false, err
		}
		out = append(out, v)
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

// ArtifactVersionScores returns latest score by id for each check plus its scorer.
func (t *Tenant) ArtifactVersionScores(ctx context.Context, hash string) (map[string]map[string]any, error) {
	rows, err := t.rdb.QueryContext(ctx, `SELECT s.check_name,s.result,s.scorer FROM scores s JOIN (SELECT check_name,MAX(id) id FROM scores WHERE content_hash=? GROUP BY check_name) x ON x.id=s.id ORDER BY s.check_name`, hash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]any{}
	for rows.Next() {
		var check, scorer string
		var result float64
		if err := rows.Scan(&check, &result, &scorer); err != nil {
			return nil, err
		}
		out[check] = map[string]any{"score": result, "scorer": scorer}
	}
	return out, rows.Err()
}

func artifactSQLFilter(f AnalyticsFilter) (string, []any) {
	w, a := f.factWhere()
	return strings.TrimSpace(w), a
}
