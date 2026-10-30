package store

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Footprint is what a tenant directory occupies on disk, by part. The archive and blobs are plain
// files outside SQLite, so they are measured by walking the directory.
type Footprint struct {
	LedgerBytes  int64 `json:"ledger_bytes"` // ledger.db
	WALBytes     int64 `json:"wal_bytes"`    // ledger.db-wal and -shm
	ArchiveBytes int64 `json:"archive_bytes"`
	ArchiveFiles int   `json:"archive_files"`
	BlobBytes    int64 `json:"blob_bytes"`
	Blobs        int   `json:"blobs"`
	PendingBytes int64 `json:"pending_bytes"`
	Pending      int   `json:"pending"`
	OtherBytes   int64 `json:"other_bytes"`
}

// Footprint walks the tenant directory. Files that vanish mid-walk (a pending file being promoted)
// are skipped.
func (t *Tenant) Footprint() (Footprint, error) {
	var f Footprint
	err := filepath.WalkDir(t.dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			// A file promoted or deleted mid-walk is not a failed measurement.
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		size := info.Size()
		rel, _ := filepath.Rel(t.dir, p)
		top, _, _ := strings.Cut(filepath.ToSlash(rel), "/")
		switch {
		case top == "archive":
			f.ArchiveBytes += size
			f.ArchiveFiles++
		case top == "blobs":
			f.BlobBytes += size
			f.Blobs++
		case top == "pending":
			f.PendingBytes += size
			f.Pending++
		case top == "ledger.db":
			f.LedgerBytes += size
		case strings.HasPrefix(top, "ledger.db-"):
			f.WALBytes += size
		default:
			f.OtherBytes += size
		}
		return nil
	})
	return f, err
}

// ScreenSummary counts content by its latest screen verdict, the scores recorded, and the
// rejections by stage and pattern. It reads only counts.
type ScreenSummary struct {
	Verdicts       map[string]int   `json:"verdicts"`       // latest verdict per content hash: pass, unscreened
	ScoredContent  int              `json:"scored_content"` // distinct content hashes with at least one score
	ScoreRows      int              `json:"score_rows"`
	Rejections     []RejectionCount `json:"rejections"`
	TotalRejection int              `json:"total_rejections"`
}

// RejectionCount is a group of rejections sharing a stage and pattern.
type RejectionCount struct {
	Stage   string `json:"stage"`
	Pattern string `json:"pattern"`
	Count   int    `json:"count"`
	Last    int64  `json:"last"` // unix seconds of the latest
}

// ScreenSummary reads the counts.
func (t *Tenant) ScreenSummary(ctx context.Context) (ScreenSummary, error) {
	s := ScreenSummary{Verdicts: map[string]int{}}
	rows, err := t.rdb.QueryContext(ctx, `SELECT verdict, count(*) FROM screens s
		WHERE id = (SELECT max(id) FROM screens WHERE content_hash = s.content_hash) GROUP BY verdict`)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var v string
		var n int
		if err := rows.Scan(&v, &n); err != nil {
			rows.Close()
			return s, err
		}
		s.Verdicts[v] = n
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return s, err
	}
	if err := rows.Close(); err != nil {
		return s, err
	}
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(DISTINCT content_hash), count(*) FROM scores`).
		Scan(&s.ScoredContent, &s.ScoreRows); err != nil {
		return s, err
	}
	rr, err := t.rdb.QueryContext(ctx, `SELECT stage, pattern, count(*), max(at) FROM rejections GROUP BY stage, pattern`)
	if err != nil {
		return s, err
	}
	defer rr.Close()
	for rr.Next() {
		var c RejectionCount
		var at int64
		if err := rr.Scan(&c.Stage, &c.Pattern, &c.Count, &at); err != nil {
			return s, err
		}
		c.Last = at / int64(time.Second)
		s.TotalRejection += c.Count
		s.Rejections = append(s.Rejections, c)
	}
	sort.Slice(s.Rejections, func(i, j int) bool { return s.Rejections[i].Count > s.Rejections[j].Count })
	return s, rr.Err()
}

// RejectionEntry is one recorded rejection.
type RejectionEntry struct {
	Stage       string `json:"stage"`
	Pattern     string `json:"pattern"`
	Reason      string `json:"reason"`
	Path        string `json:"path"`
	ContentHash string `json:"content_hash"`
	At          int64  `json:"at"` // unix seconds
}

// RecentRejections returns the newest rejections at stage, newest first. An empty stage means all.
func (t *Tenant) RecentRejections(ctx context.Context, stage string, limit int) ([]RejectionEntry, error) {
	q := `SELECT stage, pattern, reason, path, content_hash, at FROM rejections`
	var args []any
	if stage != "" {
		q += ` WHERE stage = ?`
		args = append(args, stage)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RejectionEntry{}
	for rows.Next() {
		var e RejectionEntry
		var at int64
		if err := rows.Scan(&e.Stage, &e.Pattern, &e.Reason, &e.Path, &e.ContentHash, &at); err != nil {
			return nil, err
		}
		e.At = at / int64(time.Second)
		out = append(out, e)
	}
	return out, rows.Err()
}

// UnscoredBlobs lists promoted blobs whose latest screen is "unscreened": content stored while no
// scorer was configured. It is the set a rescore works through. Blobs with no screen row are the
// worker's crash-recovery set (UnscreenedBlobs) and are not included here.
func (t *Tenant) UnscoredBlobs(ctx context.Context) ([]string, error) {
	rows, err := t.rdb.QueryContext(ctx, `SELECT content_hash FROM screens s WHERE verdict = 'unscreened'
		AND id = (SELECT max(id) FROM screens WHERE content_hash = s.content_hash)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			return nil, err
		}
		if validHash(h) == nil && exists(t.blobPath(h)) {
			out = append(out, h)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}

// FactCount is the number of rows in facts.
func (t *Tenant) FactCount(ctx context.Context) (int, error) {
	var n int
	err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM facts`).Scan(&n)
	return n, err
}
