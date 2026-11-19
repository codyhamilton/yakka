package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"unicode/utf8"
)

// searchable reports whether content with this screen verdict is full-text indexed.
func searchable(verdict string) bool { return verdict == "pass" || verdict == "unscreened" }

// indexTx (re)writes the search row for hash from its blob. Content that is not valid UTF-8 is
// not indexed. Safe to run twice.
func (t *Tenant) indexTx(tx *sql.Tx, hash string) error {
	if _, err := tx.Exec(`DELETE FROM search WHERE content_hash=?`, hash); err != nil {
		return err
	}
	b, err := os.ReadFile(t.blobPath(hash))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !utf8.Valid(b) {
		return nil
	}
	_, err = tx.Exec(`INSERT INTO search (content_hash, body) VALUES (?, ?)`, hash, string(b))
	return err
}

func (t *Tenant) reindexTx(tx *sql.Tx) error {
	if _, err := tx.Exec(`DELETE FROM search`); err != nil {
		return err
	}
	latest := map[string]string{}
	rows, err := tx.Query(`SELECT content_hash, verdict FROM screens ORDER BY id ASC`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var h, v string
		if err := rows.Scan(&h, &v); err != nil {
			rows.Close()
			return err
		}
		latest[h] = v
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	files, err := filepath.Glob(filepath.Join(t.dir, "blobs", "??", "*"))
	if err != nil {
		return err
	}
	for _, f := range files {
		h := filepath.Base(f)
		if !hashRE.MatchString(h) || !searchable(latest[h]) {
			continue
		}
		if err := t.indexTx(tx, h); err != nil {
			return err
		}
	}
	return nil
}

// reindex rebuilds the index directly on the writer connection; only for Open, before the writer starts.
func (t *Tenant) reindex(ctx context.Context) error {
	tx, err := t.wdb.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := t.reindexTx(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Reindex clears and rebuilds the search index from the blobs whose latest screen is pass or unscreened.
func (t *Tenant) Reindex(ctx context.Context) error {
	return t.submit(ctx, t.reindexTx)
}

// Baseline is one artifact's latest score for one check.
type Baseline struct {
	Path, Check string
	Score       float64
}

// ContentBaseline is the latest score for one distinct retained content hash.
// Scorer is taken from that latest score row, so re-scores never revive an older scorer.
type ContentBaseline struct {
	Hash, Check, Scorer string
	Score               float64
}

// LatestContentScores returns one latest score per retained (kind, content_hash, check).
// The population is content-weighted and deliberately does not join files into the result.
func (t *Tenant) LatestContentScores(ctx context.Context, kind string) ([]ContentBaseline, error) {
	rows, err := t.rdb.QueryContext(ctx, `
	WITH hashes AS (
		SELECT DISTINCT content_hash FROM facts
		WHERE type='artifact_version' AND content_hash!='' AND kind=?
	), latest AS (
		SELECT s.content_hash,s.check_name,s.scorer,s.result,
			ROW_NUMBER() OVER(PARTITION BY s.content_hash,s.check_name ORDER BY s.id DESC) rn
		FROM scores s JOIN hashes h USING(content_hash)
	)
	SELECT content_hash,check_name,COALESCE(scorer,''),result FROM latest WHERE rn=1
	ORDER BY check_name,scorer,content_hash`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ContentBaseline
	for rows.Next() {
		var row ContentBaseline
		if err := rows.Scan(&row.Hash, &row.Check, &row.Scorer, &row.Score); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// LatestScores returns, for the latest artifact_version of every (repo_id, path), the latest score
// per check. Rows for every path are returned; the caller filters by kind.
func (t *Tenant) LatestScores(ctx context.Context) ([]Baseline, error) {
	rows, err := t.rdb.QueryContext(ctx, `
	WITH latest AS (
		SELECT repo_id, path, content_hash,
			ROW_NUMBER() OVER (PARTITION BY repo_id, path ORDER BY received_at DESC, rowid DESC) AS rn
		FROM facts WHERE type='artifact_version'),
	s AS (
		SELECT content_hash, check_name, result,
			ROW_NUMBER() OVER (PARTITION BY content_hash, check_name ORDER BY id DESC) AS rn FROM scores)
	SELECT l.path, s.check_name, s.result FROM latest l JOIN s ON s.content_hash = l.content_hash
	WHERE l.rn = 1 AND s.rn = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Baseline
	for rows.Next() {
		var b Baseline
		if err := rows.Scan(&b.Path, &b.Check, &b.Score); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Hit is one search result.
type Hit struct {
	RepoID, Path, ContentHash, Snippet string
	Rank                               float64
}

// Search runs an FTS5 MATCH expression (built by the caller from quoted terms) over the latest
// screened version of each (repo_id, path), best bm25 first. keep filters by path while rows are
// read in rank order; reading stops at limit hits.
func (t *Tenant) Search(ctx context.Context, match string, limit int, keep func(path string) bool) ([]Hit, error) {
	rows, err := t.rdb.QueryContext(ctx, `
	WITH latest AS (
		SELECT repo_id, path, content_hash,
			ROW_NUMBER() OVER (PARTITION BY repo_id, path ORDER BY received_at DESC, rowid DESC) AS rn
		FROM facts f WHERE type='artifact_version'
			AND EXISTS (SELECT 1 FROM screens s WHERE s.content_hash = f.content_hash AND s.verdict IN ('pass','unscreened'))
			AND NOT EXISTS (SELECT 1 FROM rejections r WHERE r.content_hash = f.content_hash))
	SELECT l.repo_id, l.path, l.content_hash, snippet(search, 1, '[', ']', '…', 16), bm25(search)
	FROM search JOIN latest l ON l.content_hash = search.content_hash AND l.rn = 1
	WHERE search MATCH ? ORDER BY bm25(search) ASC, l.repo_id, l.path`, match)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Hit{}
	for rows.Next() && len(out) < limit {
		var h Hit
		if err := rows.Scan(&h.RepoID, &h.Path, &h.ContentHash, &h.Snippet, &h.Rank); err != nil {
			return nil, err
		}
		if keep == nil || keep(h.Path) {
			out = append(out, h)
		}
	}
	return out, rows.Err()
}
