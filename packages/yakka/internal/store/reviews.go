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

const (
	maxReviewRecords  = 500
	maxReviewPageSize = 500
)

// ReviewRecordFilter bounds a tenant-local review record query. Empty strings disable a filter.
// Since is an inclusive Unix timestamp in seconds. Tags match ALL of the given tags; an empty
// slice disables tag filtering, and an untagged record never matches a tag filter.
type ReviewRecordFilter struct {
	RepoID, Plan, Kind, Status, Effort, Profile, ManifestHash string
	Tags                                                      []string
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
	InsertionID    int64           `json:"insertion_id,omitempty"`
}

// ReviewPageKey is the strict last-key boundary for a review walk: descending (TS, insertion id).
type ReviewPageKey struct {
	TS          float64
	InsertionID int64
}

// reviewFilterClause appends the shared json_extract/tag/since filters to q and args.
func reviewFilterClause(q *strings.Builder, args []any, f ReviewRecordFilter) []any {
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
	for _, tag := range f.Tags {
		q.WriteString(` AND EXISTS (SELECT 1 FROM json_each(raw,'$.tags') WHERE value=?)`)
		args = append(args, tag)
	}
	return args
}

func (t *Tenant) reviewRunsExist(ctx context.Context) (bool, error) {
	var exists int
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='review_runs'`).Scan(&exists); err != nil {
		return false, err
	}
	return exists > 0, nil
}

// BeginReviewWalk fixes the insertion high-water mark for a complete tenant-local review read.
// Rows appended after this call, including backdated-ts rows, cannot enter the walk.
func (t *Tenant) BeginReviewWalk(ctx context.Context) (int64, error) {
	exists, err := t.reviewRunsExist(ctx)
	if err != nil {
		return 0, err
	}
	if !exists {
		return 0, nil
	}
	var highWater int64
	if err := t.rdb.QueryRowContext(ctx, `SELECT COALESCE(MAX(rowid),0) FROM review_runs`).Scan(&highWater); err != nil {
		return 0, err
	}
	return highWater, nil
}

// ReviewPage returns one keyset page of tenant-local review facts bounded by the walk's fixed
// high-water mark and a strict descending (ts, insertion id) last-key boundary. hasMore reports
// whether rows remain; the caller builds the next key from the last returned record. A limit
// outside 1..500 is an error: this API is a page size, never a completeness ceiling.
func (t *Tenant) ReviewPage(ctx context.Context, f ReviewRecordFilter, highWater int64, after *ReviewPageKey, limit int) ([]ReviewRecord, bool, error) {
	if limit < 1 || limit > maxReviewPageSize {
		return nil, false, fmt.Errorf("store: review page limit must be between 1 and %d", maxReviewPageSize)
	}
	exists, err := t.reviewRunsExist(ctx)
	if err != nil {
		return nil, false, err
	}
	if !exists {
		return []ReviewRecord{}, false, nil
	}
	var q strings.Builder
	q.WriteString(`SELECT conversation_id,repo_id,ts,raw,rowid FROM review_runs WHERE rowid<=?`)
	args := []any{highWater}
	args = reviewFilterClause(&q, args, f)
	if after != nil {
		q.WriteString(` AND (ts<? OR (ts=? AND rowid<?))`)
		args = append(args, after.TS, after.TS, after.InsertionID)
	}
	q.WriteString(` ORDER BY ts DESC,rowid DESC LIMIT ?`)
	args = append(args, limit+1)
	rows, err := t.rdb.QueryContext(ctx, q.String(), args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := make([]ReviewRecord, 0, limit+1)
	for rows.Next() {
		var r ReviewRecord
		if err := rows.Scan(&r.ConversationID, &r.RepoID, &r.TS, &r.Raw, &r.InsertionID); err != nil {
			return nil, false, err
		}
		if !json.Valid(r.Raw) {
			return nil, false, fmt.Errorf("store: corrupt review row %d: raw is not valid JSON", r.InsertionID)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	return out, hasMore, nil
}

// reviewExecutionIndex supports direct execution-key lookup. The partial predicate keeps malformed
// JSON rows out of the index (evaluating json_extract on them would fail the write).
const reviewExecutionIndex = `CREATE INDEX IF NOT EXISTS review_runs_execution_key ON review_runs(repo_id, json_extract(raw,'$.key')) WHERE json_valid(raw)`

// ensureReviewExecutionIndex creates the lookup index for tables that predate it. The writer owns
// schema changes; a lookup only submits work when the index is actually missing.
func (t *Tenant) ensureReviewExecutionIndex(ctx context.Context) error {
	var n int
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='index' AND name='review_runs_execution_key'`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return t.submit(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(reviewExecutionIndex)
		return err
	})
}

// ReviewByExecutionKey returns the canonical completed review stored for repo and execution key,
// without a bounded table scan. Rows whose own status is skipped_duplicate are audit references:
// they are skipped, or their canonical pointer is followed once when the original lives under a
// different key (legacy adapter records). An audit row never satisfies the lookup itself.
func (t *Tenant) ReviewByExecutionKey(ctx context.Context, repo, key string) (ReviewRecord, bool, error) {
	if key == "" {
		return ReviewRecord{}, false, nil
	}
	exists, err := t.reviewRunsExist(ctx)
	if err != nil {
		return ReviewRecord{}, false, err
	}
	if !exists {
		return ReviewRecord{}, false, nil
	}
	if err := t.ensureReviewExecutionIndex(ctx); err != nil {
		return ReviewRecord{}, false, err
	}
	field, value := "key", key
	var audit *ReviewRecord
	for hop := 0; hop < 2; hop++ {
		rows, err := t.reviewRowsByJSONField(ctx, repo, field, value)
		if err != nil {
			return ReviewRecord{}, false, err
		}
		if len(rows) == 0 && field == "review_id" {
			// Compatibility for pre-canonical fixtures or stored rows that retained id.
			rows, err = t.reviewRowsByJSONField(ctx, repo, "id", value)
			if err != nil {
				return ReviewRecord{}, false, err
			}
		}
		pointer := ""
		for _, row := range rows {
			var m struct {
				Status           string            `json:"status"`
				ReviewID         string            `json:"review_id"`
				OriginalReviewID string            `json:"original_review_id"`
				Reason           string            `json:"reason"`
				Attempts         []json.RawMessage `json:"attempts"`
			}
			if err := json.Unmarshal(row.Raw, &m); err != nil {
				// Cannot classify the row. Return it so the caller reports cache_unavailable
				// instead of inventing an empty successful cache hit.
				return row, true, nil
			}
			if m.Status == "skipped_duplicate" {
				if audit == nil {
					copy := row
					audit = &copy
				}
				if m.OriginalReviewID != "" {
					pointer = m.OriginalReviewID
				} else if m.Reason != "" {
					pointer = m.Reason
				}
				continue
			}
			// Preflight and budget refusals are persisted for audit, but no review
			// call ran. They must not turn a later eligible request into a cache hit.
			if len(m.Attempts) == 0 {
				continue
			}
			return row, true, nil
		}
		if pointer == "" {
			if audit != nil {
				return *audit, true, nil
			}
			return ReviewRecord{}, false, nil
		}
		// keys.Canonical strips the reserved top-level id, so new rows retain the
		// public receipt id in review_id for this pointer lookup.
		field, value = "review_id", pointer
	}
	if audit != nil {
		return *audit, true, nil
	}
	return ReviewRecord{}, false, nil
}

// reviewRowsByJSONField returns every row for repo whose JSON field equals value, newest first.
// field is always an internal constant, never caller input.
func (t *Tenant) reviewRowsByJSONField(ctx context.Context, repo, field, value string) ([]ReviewRecord, error) {
	q := `SELECT conversation_id,repo_id,ts,raw,rowid FROM review_runs WHERE repo_id=? AND json_valid(raw) AND json_extract(raw,'$.` + field + `')=? ORDER BY ts DESC,rowid DESC`
	rows, err := t.rdb.QueryContext(ctx, q, repo, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewRecord{}
	for rows.Next() {
		var r ReviewRecord
		if err := rows.Scan(&r.ConversationID, &r.RepoID, &r.TS, &r.Raw, &r.InsertionID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
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
		if _, err := tx.Exec(reviewExecutionIndex); err != nil {
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
	args := reviewFilterClause(&q, []any{}, f)
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
