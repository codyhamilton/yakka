package review

import (
	"context"
	"errors"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const (
	// reviewLookupAttempts bounds the execution-key lookup retries so a busy
	// store cannot stretch the synchronous POST past the edge timeout.
	reviewLookupAttempts = 3
	// reviewLookupAttemptTimeout is deliberately short: the SQLite driver already
	// waits up to its busy_timeout (5s) inside a single query, so a try that runs
	// longer than that is contention, not useful work.
	reviewLookupAttemptTimeout = 5 * time.Second
	reviewLookupBackoff        = 100 * time.Millisecond
)

// reviewByExecutionKey wraps Tenant.ReviewByExecutionKey with a bounded retry
// for transient store contention. A busy or locked SQLite database, or a
// per-try deadline, is retried; any other error is returned immediately so the
// caller keeps recording the existing unavailable answer.
func reviewByExecutionKey(ctx context.Context, tenant *store.Tenant, repo, key string) (store.ReviewRecord, bool, error) {
	return retryReviewLookup(ctx, reviewLookupAttempts, reviewLookupAttemptTimeout, reviewLookupBackoff,
		func(ctx context.Context) (store.ReviewRecord, bool, error) {
			return tenant.ReviewByExecutionKey(ctx, repo, key)
		})
}

func retryReviewLookup(ctx context.Context, attempts int, attemptTimeout, backoff time.Duration, lookup func(context.Context) (store.ReviewRecord, bool, error)) (store.ReviewRecord, bool, error) {
	if attempts < 1 {
		attempts = 1
	}
	var (
		row   store.ReviewRecord
		found bool
		err   error
	)
	wait := backoff
	for try := 1; try <= attempts; try++ {
		tryCtx := ctx
		cancel := func() {}
		if attemptTimeout > 0 {
			tryCtx, cancel = context.WithTimeout(ctx, attemptTimeout)
		}
		row, found, err = lookup(tryCtx)
		cancel()
		if err == nil {
			return row, found, nil
		}
		if try == attempts || ctx.Err() != nil || !transientReviewLookupError(err) {
			return row, found, err
		}
		if wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				return row, found, err
			case <-timer.C:
			}
			wait *= 2
		}
	}
	return row, found, err
}

// transientReviewLookupError recognises SQLite busy/locked contention and a
// per-try context deadline. Extended SQLite result codes share the low byte
// with their primary code.
func transientReviewLookupError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var coded interface{ Code() int }
	if errors.As(err, &coded) {
		switch coded.Code() & 0xff {
		case 5, 6: // SQLITE_BUSY, SQLITE_LOCKED
			return true
		}
	}
	return false
}
