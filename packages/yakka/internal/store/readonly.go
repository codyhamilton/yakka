package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// SchemaVersion is the ledger schema version this binary writes (the number of migrations).
func SchemaVersion() int { return len(migrations) }

// ReadOnly is a tenant directory opened only for reading, for `yakka sync`. It takes the shared
// directory lock (so compaction's exclusive lock is refused while it is open) and opens ledger.db
// with mode=ro. It never migrates, backfills, starts a writer, or creates any file or directory,
// so a serve process may keep writing to the same tenant meanwhile.
type ReadOnly struct {
	dir  string
	db   *sql.DB
	lock *os.File
}

// OpenReadOnly opens dir read-only. The directory and its ledger.db must already exist.
func OpenReadOnly(dir string) (*ReadOnly, error) {
	dbPath := filepath.Join(dir, "ledger.db")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("store: %s is not a tenant directory: %w", dir, err)
	}
	lock, err := openLockExisting(dir)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		releaseLock(lock)
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		releaseLock(lock)
		return nil, err
	}
	return &ReadOnly{dir: dir, db: db, lock: lock}, nil
}

// openLockExisting takes the shared lock. The tenant directory exists already, so this normally
// opens the existing .lock; a directory that is not writable is read without the lock.
func openLockExisting(dir string) (*os.File, error) {
	f, err := acquireLock(dir, syscall.LOCK_SH)
	if err != nil {
		if os.IsPermission(err) {
			return nil, nil
		}
		return nil, err
	}
	return f, nil
}

// Close releases the database and the lock.
func (r *ReadOnly) Close() error {
	err := r.db.Close()
	releaseLock(r.lock)
	r.lock = nil
	return err
}

// Dir returns the tenant directory.
func (r *ReadOnly) Dir() string { return r.dir }

// UserVersion returns ledger.db's PRAGMA user_version.
func (r *ReadOnly) UserVersion(ctx context.Context) (int, error) {
	var v int
	err := r.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&v)
	return v, err
}

// SyncRow is one fact row as sync reads it.
type SyncRow struct {
	Rowid          int64
	RowHash        string
	Type           string
	ConversationID string
	ContentHash    string
	Raw            []byte
}

// FactsAfter returns up to limit fact rows with rowid greater than after, in rowid order.
func (r *ReadOnly) FactsAfter(ctx context.Context, after int64, limit int) ([]SyncRow, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT rowid, row_hash, type, conversation_id, content_hash, raw
		FROM facts WHERE rowid > ? ORDER BY rowid LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncRow
	for rows.Next() {
		var x SyncRow
		if err := rows.Scan(&x.Rowid, &x.RowHash, &x.Type, &x.ConversationID, &x.ContentHash, &x.Raw); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// Content returns an artifact's bytes from blobs/ or, when not yet promoted, pending/. ok is false
// when neither holds it (a dropped artifact).
func (r *ReadOnly) Content(hash string) (b []byte, ok bool, err error) {
	if err := validHash(hash); err != nil {
		return nil, false, err
	}
	for _, p := range []string{
		filepath.Join(r.dir, "blobs", hash[:2], hash),
		filepath.Join(r.dir, "pending", hash),
	} {
		b, err := os.ReadFile(p)
		if err == nil {
			return b, true, nil
		}
		if !os.IsNotExist(err) {
			return nil, false, err
		}
	}
	return nil, false, nil
}
