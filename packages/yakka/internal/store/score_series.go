package store

import (
	"context"
	"math"
	"sort"
	"time"
)

// ScoreSeriesPoint is one bucket's percentile summary for a check.
type ScoreSeriesPoint struct {
	T      string
	N      int
	P25    float64
	Median float64
	P75    float64
}

// ScoreSeriesCheck is sparse points for one check name.
type ScoreSeriesCheck struct {
	Name   string
	Points []ScoreSeriesPoint
}

// ScoreSeriesObservation is a latest check score attached to the canonical fact for a hash in
// one bucket. A hash may legitimately occur once in each bucket it touched.
type ScoreSeriesObservation struct {
	Bucket, Hash, Check, Scorer, RepoID, Path, ConversationID string
	Score                                                     float64
}

func roundScore(v float64) float64 { return math.Round(v*1000) / 1000 }

func scoreSeriesBucketStart(ts float64, bucket string, loc *time.Location) string {
	if loc == nil {
		loc = time.UTC
	}
	tm := time.Unix(int64(ts), 0).In(loc)
	y, m, d := tm.Date()
	switch bucket {
	case "day":
		return time.Date(y, m, d, 0, 0, 0, 0, loc).Format(time.RFC3339)
	case "week":
		wd := (int(tm.Weekday()) + 6) % 7
		mon := time.Date(y, m, d, 0, 0, 0, 0, loc).AddDate(0, 0, -wd)
		return mon.Format(time.RFC3339)
	case "month":
		return time.Date(y, m, 1, 0, 0, 0, 0, loc).Format(time.RFC3339)
	case "year":
		return time.Date(y, 1, 1, 0, 0, 0, 0, loc).Format(time.RFC3339)
	default:
		if n, ok := multiYearStep(bucket); ok {
			start := (y / n) * n
			return time.Date(start, 1, 1, 0, 0, 0, 0, loc).Format(time.RFC3339)
		}
		return ""
	}
}

// ScoreSeries returns per-check percentile points over time buckets for artifact versions of kind.
// f.Kinds is ignored; kind comes from the route. Each bucket uses distinct content hashes with a
// version in that bucket; several versions of one hash in a bucket contribute the latest only.
func (t *Tenant) ScoreSeries(ctx context.Context, f AnalyticsFilter, kind, bucket string) ([]ScoreSeriesCheck, error) {
	f2 := f
	f2.Kinds = nil
	w, args := f2.factWhere()
	args = append([]any{kind}, args...)
	tx, err := t.rdb.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS score_series_population (bucket TEXT NOT NULL, content_hash TEXT NOT NULL, version_ts REAL NOT NULL, PRIMARY KEY(bucket,content_hash)) WITHOUT ROWID; DELETE FROM score_series_population`); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT content_hash, ts FROM facts
		WHERE type='artifact_version' AND content_hash != '' AND kind=? AND `+w, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ins, err := tx.PrepareContext(ctx, `INSERT INTO score_series_population(bucket,content_hash,version_ts) VALUES(?,?,?) ON CONFLICT(bucket,content_hash) DO UPDATE SET version_ts=max(version_ts,excluded.version_ts)`)
	if err != nil {
		rows.Close()
		return nil, err
	}
	for rows.Next() {
		var hash string
		var ts float64
		if err := rows.Scan(&hash, &ts); err != nil {
			return nil, err
		}
		b := scoreSeriesBucketStart(ts, bucket, f.TZ)
		if _, err := ins.ExecContext(ctx, b, hash, ts); err != nil {
			ins.Close()
			rows.Close()
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		ins.Close()
		return nil, err
	}
	rows.Close()
	if err := ins.Close(); err != nil {
		return nil, err
	}
	// SQL owns the hash join, latest-score selection and exact order statistics. SQLite may spill
	// its window-sort work table to disk; Go retains only the bounded bucket/check result.
	result, err := tx.QueryContext(ctx, `WITH latest AS (
		SELECT s.content_hash,s.check_name,s.result,ROW_NUMBER() OVER(PARTITION BY s.content_hash,s.check_name ORDER BY s.id DESC) rn
		FROM scores s JOIN (SELECT DISTINCT content_hash FROM score_series_population) p USING(content_hash)),
	vals AS (SELECT p.bucket,l.check_name,l.result FROM score_series_population p JOIN latest l USING(content_hash) WHERE l.rn=1),
	ranked AS (SELECT bucket,check_name,result,ROW_NUMBER() OVER(PARTITION BY bucket,check_name ORDER BY result)-1 rn,COUNT(*) OVER(PARTITION BY bucket,check_name) n FROM vals),
	q AS (SELECT bucket,check_name,MAX(n) n,
		SUM(CASE WHEN rn=CAST((n-1)*0.25 AS INTEGER) THEN result*(1-((n-1)*0.25-CAST((n-1)*0.25 AS INTEGER))) WHEN rn=CAST((n-1)*0.25 AS INTEGER)+1 THEN result*((n-1)*0.25-CAST((n-1)*0.25 AS INTEGER)) ELSE 0 END) p25,
		SUM(CASE WHEN rn=CAST((n-1)*0.5 AS INTEGER) THEN result*(1-((n-1)*0.5-CAST((n-1)*0.5 AS INTEGER))) WHEN rn=CAST((n-1)*0.5 AS INTEGER)+1 THEN result*((n-1)*0.5-CAST((n-1)*0.5 AS INTEGER)) ELSE 0 END) med,
		SUM(CASE WHEN rn=CAST((n-1)*0.75 AS INTEGER) THEN result*(1-((n-1)*0.75-CAST((n-1)*0.75 AS INTEGER))) WHEN rn=CAST((n-1)*0.75 AS INTEGER)+1 THEN result*((n-1)*0.75-CAST((n-1)*0.75 AS INTEGER)) ELSE 0 END) p75
		FROM ranked GROUP BY bucket,check_name) SELECT bucket,check_name,n,p25,med,p75 FROM q ORDER BY check_name,bucket`)
	if err != nil {
		return nil, err
	}
	defer result.Close()
	byCheck := map[string][]ScoreSeriesPoint{}
	for result.Next() {
		var b, c string
		var p ScoreSeriesPoint
		if err := result.Scan(&b, &c, &p.N, &p.P25, &p.Median, &p.P75); err != nil {
			return nil, err
		}
		p.T = b
		p.P25 = roundScore(p.P25)
		p.Median = roundScore(p.Median)
		p.P75 = roundScore(p.P75)
		byCheck[c] = append(byCheck[c], p)
	}
	if err := result.Err(); err != nil {
		return nil, err
	}
	checks := make([]string, 0, len(byCheck))
	for c := range byCheck {
		checks = append(checks, c)
	}
	sort.Strings(checks)
	out := make([]ScoreSeriesCheck, 0, len(checks))
	for _, c := range checks {
		out = append(out, ScoreSeriesCheck{Name: c, Points: byCheck[c]})
	}
	return out, nil
}

// ScoreSeriesObservations returns hash/check observations after canonicalizing each hash inside
// each bucket. It is used by the explicit lens mode; the legacy unsplit route keeps ScoreSeries.
func (t *Tenant) ScoreSeriesObservations(ctx context.Context, f AnalyticsFilter, kind, bucket string) ([]ScoreSeriesObservation, error) {
	f.Kinds = nil
	w, args := f.factWhere()
	args = append([]any{kind}, args...)
	tx, err := t.rdb.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS score_lens_population (
		bucket TEXT NOT NULL, content_hash TEXT NOT NULL, ts REAL NOT NULL, row_hash TEXT NOT NULL,
		repo_id TEXT NOT NULL, path TEXT NOT NULL, conversation_id TEXT NOT NULL,
		PRIMARY KEY(bucket,content_hash)) WITHOUT ROWID; DELETE FROM score_lens_population`); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT content_hash,ts,row_hash,repo_id,path,COALESCE(conversation_id,'') FROM facts WHERE type='artifact_version' AND content_hash!='' AND kind=? AND `+w, args...)
	if err != nil {
		return nil, err
	}
	ins, err := tx.PrepareContext(ctx, `INSERT INTO score_lens_population(bucket,content_hash,ts,row_hash,repo_id,path,conversation_id) VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(bucket,content_hash) DO UPDATE SET ts=excluded.ts,row_hash=excluded.row_hash,repo_id=excluded.repo_id,path=excluded.path,conversation_id=excluded.conversation_id
		WHERE excluded.ts<score_lens_population.ts OR (excluded.ts=score_lens_population.ts AND (excluded.row_hash<score_lens_population.row_hash OR (excluded.row_hash=score_lens_population.row_hash AND (excluded.repo_id<score_lens_population.repo_id OR (excluded.repo_id=score_lens_population.repo_id AND excluded.path<score_lens_population.path)))))`)
	if err != nil {
		rows.Close()
		return nil, err
	}
	for rows.Next() {
		var hash, rowHash, repo, path, conv string
		var ts float64
		if err := rows.Scan(&hash, &ts, &rowHash, &repo, &path, &conv); err != nil {
			ins.Close()
			rows.Close()
			return nil, err
		}
		b := scoreSeriesBucketStart(ts, bucket, f.TZ)
		if _, err := ins.ExecContext(ctx, b, hash, ts, rowHash, repo, path, conv); err != nil {
			ins.Close()
			rows.Close()
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		ins.Close()
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := ins.Close(); err != nil {
		return nil, err
	}
	result, err := tx.QueryContext(ctx, `WITH latest AS (
		SELECT content_hash,check_name,scorer,result,ROW_NUMBER() OVER(PARTITION BY content_hash,check_name ORDER BY id DESC) rn FROM scores)
		SELECT p.bucket,p.content_hash,l.check_name,COALESCE(l.scorer,''),p.repo_id,p.path,p.conversation_id,l.result
		FROM score_lens_population p JOIN latest l ON l.content_hash=p.content_hash AND l.rn=1 ORDER BY p.bucket,l.check_name,p.content_hash`)
	if err != nil {
		return nil, err
	}
	defer result.Close()
	var out []ScoreSeriesObservation
	for result.Next() {
		var row ScoreSeriesObservation
		if err := result.Scan(&row.Bucket, &row.Hash, &row.Check, &row.Scorer, &row.RepoID, &row.Path, &row.ConversationID, &row.Score); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if err := result.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func anyStrings(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}
