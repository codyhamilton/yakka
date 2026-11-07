package store

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"os"
)

// ArtifactContentState describes the stored body and its screening state. Callers must first
// establish the exact artifact identity with ArtifactContentReferenced.
type ArtifactContentState struct {
	BlobExists    bool
	Pending       bool
	ScreenVerdict string
	ScreenStage   bool
}

// ArtifactContentReferenced reports whether this tenant recorded hash at this exact file identity.
func (t *Tenant) ArtifactContentReferenced(ctx context.Context, repoID, path, hash string) (bool, error) {
	if err := validHash(hash); err != nil {
		return false, err
	}
	var found int
	err := t.rdb.QueryRowContext(ctx, `SELECT 1 FROM facts WHERE type='artifact_version' AND repo_id=? AND path=? AND content_hash=? LIMIT 1`, repoID, path, hash).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ArtifactContentStatus returns screen and filesystem state for a referenced content hash.
func (t *Tenant) ArtifactContentStatus(ctx context.Context, hash string) (ArtifactContentState, error) {
	if err := validHash(hash); err != nil {
		return ArtifactContentState{}, err
	}
	state := ArtifactContentState{BlobExists: exists(t.blobPath(hash)), Pending: exists(t.pendingPath(hash))}
	var verdict string
	err := t.rdb.QueryRowContext(ctx, `SELECT verdict FROM screens WHERE content_hash=? ORDER BY id DESC LIMIT 1`, hash).Scan(&verdict)
	if err == nil {
		state.ScreenVerdict = verdict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	var stage string
	err = t.rdb.QueryRowContext(ctx, `SELECT stage FROM rejections WHERE content_hash=? ORDER BY id DESC LIMIT 1`, hash).Scan(&stage)
	if err == nil {
		state.ScreenStage = stage == "screen"
	} else if !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	return state, nil
}

// ReadBlobBounded reads a complete promoted blob up to limit bytes. It checks cancellation between
// reads and never returns a partial body on error or when the file grows beyond the limit.
func (t *Tenant) ReadBlobBounded(ctx context.Context, hash string, limit int64) ([]byte, int64, error) {
	if err := validHash(hash); err != nil {
		return nil, 0, err
	}
	f, err := os.Open(t.blobPath(hash))
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, 0, err
	}
	if st.Size() > limit {
		return nil, st.Size(), ErrContentTooLarge
	}
	buf := make([]byte, 0, st.Size())
	chunk := make([]byte, 32*1024)
	for {
		if err := ctx.Err(); err != nil {
			return nil, 0, err
		}
		n, readErr := f.Read(chunk)
		if n > 0 {
			if int64(len(buf)+n) > limit {
				return nil, int64(len(buf) + n), ErrContentTooLarge
			}
			buf = append(buf, chunk[:n]...)
		}
		if errors.Is(readErr, io.EOF) {
			return buf, int64(len(buf)), nil
		}
		if readErr != nil {
			return nil, 0, readErr
		}
	}
}

// ErrContentTooLarge signals that a bounded blob read refused the whole body.
var ErrContentTooLarge = errors.New("store: content exceeds read limit")
