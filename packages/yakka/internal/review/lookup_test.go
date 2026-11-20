package review

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// codedError stands in for a SQLite result code without depending on the
// driver's unexported error constructor.
type codedError int

func (e codedError) Error() string { return "injected sqlite error" }
func (e codedError) Code() int     { return int(e) }

func TestRetryReviewLookupSucceedsAfterTransientBusy(t *testing.T) {
	calls := 0
	row, found, err := retryReviewLookup(context.Background(), 3, 0, 0,
		func(context.Context) (store.ReviewRecord, bool, error) {
			calls++
			if calls < 3 {
				return store.ReviewRecord{}, false, codedError(5)
			}
			return store.ReviewRecord{Raw: []byte(`{"status":"ok"}`)}, true, nil
		})
	if err != nil || !found || string(row.Raw) != `{"status":"ok"}` || calls != 3 {
		t.Fatalf("row=%s found=%v calls=%d err=%v", row.Raw, found, calls, err)
	}
}

func TestRetryReviewLookupReturnsLastErrorWhenStillBusy(t *testing.T) {
	calls := 0
	_, _, err := retryReviewLookup(context.Background(), 3, 0, 0,
		func(context.Context) (store.ReviewRecord, bool, error) {
			calls++
			return store.ReviewRecord{}, false, codedError(6)
		})
	var coded codedError
	if !errors.As(err, &coded) || calls != 3 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func TestRetryReviewLookupDoesNotRetryPermanentError(t *testing.T) {
	permanent := errors.New("corrupt row")
	calls := 0
	_, _, err := retryReviewLookup(context.Background(), 3, 0, 0,
		func(context.Context) (store.ReviewRecord, bool, error) {
			calls++
			return store.ReviewRecord{}, false, permanent
		})
	if !errors.Is(err, permanent) || calls != 1 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func TestRetryReviewLookupRetriesPerTryDeadline(t *testing.T) {
	calls := 0
	row, found, err := retryReviewLookup(context.Background(), 3, 10*time.Millisecond, 0,
		func(ctx context.Context) (store.ReviewRecord, bool, error) {
			calls++
			if calls == 1 {
				<-ctx.Done()
				return store.ReviewRecord{}, false, ctx.Err()
			}
			return store.ReviewRecord{Raw: []byte(`{"status":"ok"}`)}, true, nil
		})
	if err != nil || !found || calls != 2 {
		t.Fatalf("row=%s found=%v calls=%d err=%v", row.Raw, found, calls, err)
	}
}

func TestRetryReviewLookupStopsWhenRequestEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	_, _, err := retryReviewLookup(ctx, 3, 0, 0,
		func(ctx context.Context) (store.ReviewRecord, bool, error) {
			calls++
			return store.ReviewRecord{}, false, ctx.Err()
		})
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}
