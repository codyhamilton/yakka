package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

const maxReviewRecords = 500

// ReviewRecordFilter bounds a tenant-local review record query. Empty strings disable a filter.
// Since is an inclusive Unix timestamp in seconds.
type ReviewRecordFilter struct {
	RepoID, Plan, Kind, Status, Effort, Profile, ManifestHash string
	Phase                                                     *int
	Since                                                     float64
	Limit                                                     int
}

// ReviewRecord is the persisted generic review_run fact. Raw contains its complete canonical
// fields; captured input is kept separately and is never included here.
type ReviewRecord struct {
	ConversationID string          `json:"conversation_id"`
	RepoID         string          `json:"repo_id"`
	TS             float64         `json:"ts"`
	Raw            json.RawMessage `json:"raw"`
}

// AppendReviewRuns writes accepted review facts through the tenant's serialized writer without
// adding them to conversation, hook-event, or facet aggregates. Duplicate row hashes are ignored,
// matching Tenant.Append semantics. The caller is ingest, which owns fact validation and hashing.
func (t *Tenant) AppendReviewRuns(ctx context.Context, rows []FactRow) ([]bool, error) {
	for _, r := range rows {
		if r.Type != "review_run" {
			return nil, fmt.Errorf("store: AppendReviewRuns only accepts review_run facts")
		}
		if r.RowHash == "" || len(r.Raw) == 0 {
			return nil, fmt.Errorf("store: review_run needs row hash and raw fact")
		}
	}
	inserted := make([]bool, len(rows))
	err := t.submit(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS review_runs (
			row_hash TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, repo_id TEXT NOT NULL,
			ts REAL NOT NULL, raw BLOB NOT NULL)`); err != nil {
			return err
		}
		st, err := tx.Prepare(`INSERT OR IGNORE INTO review_runs(row_hash,conversation_id,repo_id,ts,raw) VALUES(?,?,?,?,?)`)
		if err != nil {
			return err
		}
		defer st.Close()
		for i, r := range rows {
			res, err := st.Exec(r.RowHash, r.ConversationID, r.RepoID, r.TS, r.Raw)
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			inserted[i] = n > 0
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return inserted, nil
}

// ReviewRecords returns at most 500 records from this tenant, newest first, matching the design's
// repo_id, plan, phase, kind, status, effective effort, profile, manifest_hash, and since filters.
func (t *Tenant) ReviewRecords(ctx context.Context, f ReviewRecordFilter) ([]ReviewRecord, error) {
	limit := f.Limit
	if limit <= 0 || limit > maxReviewRecords {
		limit = maxReviewRecords
	}
	var exists int
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='review_runs'`).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return []ReviewRecord{}, nil
	}
	var q strings.Builder
	q.WriteString(`SELECT conversation_id,repo_id,ts,raw FROM review_runs WHERE 1=1`)
	args := []any{}
	add := func(path, value string) {
		if value != "" {
			q.WriteString(` AND json_extract(raw,'$.` + path + `')=?`)
			args = append(args, value)
		}
	}
	add("repo_id", f.RepoID)
	add("plan", f.Plan)
	add("kind", f.Kind)
	add("status", f.Status)
	add("effective_effort", f.Effort)
	add("profile", f.Profile)
	add("manifest_hash", f.ManifestHash)
	if f.Phase != nil {
		q.WriteString(` AND json_extract(raw,'$.phase')=?`)
		args = append(args, *f.Phase)
	}
	if f.Since != 0 {
		q.WriteString(` AND ts>=?`)
		args = append(args, f.Since)
	}
	q.WriteString(` ORDER BY ts DESC,rowid DESC LIMIT ?`)
	args = append(args, limit)
	rows, err := t.rdb.QueryContext(ctx, q.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewRecord{}
	for rows.Next() {
		var r ReviewRecord
		if err := rows.Scan(&r.ConversationID, &r.RepoID, &r.TS, &r.Raw); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// WriteReviewInput atomically stores captured bytes under review-inputs/<shard>/<sha256>. It
// verifies an existing object before treating the operation as idempotent.
func (t *Tenant) WriteReviewInput(hash string, content []byte) error {
	if err := validHash(hash); err != nil {
		return err
	}
	if keys.ContentHash(content) != hash {
		return fmt.Errorf("store: review input hash mismatch")
	}
	dir := filepath.Join(t.dir, "review-inputs", hash[:2])
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(dir, hash)
	if existing, err := os.ReadFile(path); err == nil {
		if keys.ContentHash(existing) != hash {
			return fmt.Errorf("store: stored review input hash mismatch")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".review-input-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		if existing, readErr := os.ReadFile(path); readErr == nil && keys.ContentHash(existing) == hash {
			return nil
		}
		return err
	}
	return nil
}

// ReadReviewInput reads and verifies one tenant-local captured input object.
func (t *Tenant) ReadReviewInput(hash string) ([]byte, error) {
	if err := validHash(hash); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(t.dir, "review-inputs", hash[:2], hash))
	if err != nil {
		return nil, err
	}
	if keys.ContentHash(b) != hash {
		return nil, fmt.Errorf("store: review input hash mismatch")
	}
	return b, nil
}
