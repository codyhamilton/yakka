package store

import (
	"context"
	"errors"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func TestReadBlobBoundedReturnsNoPartialContent(t *testing.T) {
	tn := openT(t, Options{})
	body := []byte("whole body")
	hash := keys.ContentHash(body)
	if err := tn.WritePending(hash, body); err != nil {
		t.Fatal(err)
	}
	if err := tn.Promote(context.Background(), hash, Screen{Verdict: "pass"}); err != nil {
		t.Fatal(err)
	}

	got, size, err := tn.ReadBlobBounded(context.Background(), hash, 3)
	if !errors.Is(err, ErrContentTooLarge) || got != nil || size != int64(len(body)) {
		t.Fatalf("oversize: bytes=%q size=%d err=%v", got, size, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, size, err = tn.ReadBlobBounded(ctx, hash, 100)
	if !errors.Is(err, context.Canceled) || got != nil || size != 0 {
		t.Fatalf("cancelled: bytes=%q size=%d err=%v", got, size, err)
	}
}
