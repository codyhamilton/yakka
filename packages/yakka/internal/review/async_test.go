package review

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func blockingProvider(t *testing.T, calls *atomic.Int32, started, release chan struct{}) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
	}))
}

func runningFixture(id, key string) map[string]any {
	return map[string]any{
		"id": id, "review_id": id, "type": "review_run", "repo_id": "repo-sentinel",
		"kind": "adhoc", "capture_id": "capture-" + id, "status": StatusRunning, "key": key,
		"configured_model": LiveModel, "effective_effort": "high", "tags": []string{},
		"attempts": []any{}, "conversation_id": "review:" + id, "ts": float64(time.Now().Unix()),
	}
}

func TestStartDetachesAndFinalizesOneRowAfterClientCancel(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	srv := blockingProvider(t, &calls, started, release)
	defer srv.Close()

	tenant := reviewTenant(t)
	req := reviewRequest(true)
	cfg := availableConfig(srv.URL)
	cfg.Lifetime = context.Background()
	var finishes atomic.Int32
	cfg.OnFinish = func() { finishes.Add(1) }

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	job, accepted, err := Start(requestCtx, tenant, "tenant", req, cfg)
	if err != nil || job == nil || accepted.ID == "" || accepted.Status != StatusRunning || accepted.Cached == nil || *accepted.Cached {
		t.Fatalf("accepted=%+v job=%v err=%v", accepted, job, err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	inFlight, found, err := tenant.ReviewByID(context.Background(), accepted.ID)
	if err != nil || !found || !strings.Contains(string(inFlight.Raw), `"status":"running"`) {
		t.Fatalf("in-flight row found=%v err=%v raw=%s", found, err, inFlight.Raw)
	}

	// The edge timeout cancels the HTTP request context; detached work must finish.
	cancelRequest()
	close(release)

	final, done := job.Wait(context.Background())
	if !done || final.Status != "ok" || final.ID != accepted.ID {
		t.Fatalf("final=%+v done=%v", final, done)
	}
	if finishes.Load() != 1 {
		t.Fatalf("OnFinish calls=%d", finishes.Load())
	}
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{RepoID: "repo-sentinel", Limit: 10})
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows=%d err=%v", len(rows), err)
	}
	var rec map[string]any
	if err := json.Unmarshal(rows[0].Raw, &rec); err != nil {
		t.Fatal(err)
	}
	if rec["status"] != "ok" || rec["review_id"] != accepted.ID {
		t.Fatalf("finalized record=%v", rec)
	}
	if in, _ := rec["input_tokens"].(float64); in <= 0 {
		t.Fatalf("terminal record lost tokens: %v", rec["input_tokens"])
	}
	if rec["cost_known"] != true {
		t.Fatalf("terminal record lost cost: %v", rec)
	}
	polled, found, err := tenant.ReviewByID(context.Background(), accepted.ID)
	if err != nil || !found || !strings.Contains(string(polled.Raw), `"status":"ok"`) {
		t.Fatalf("poll found=%v err=%v raw=%s", found, err, polled.Raw)
	}
}

func TestStartInFlightDuplicateDoesNotSpend(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	srv := blockingProvider(t, &calls, started, release)
	defer srv.Close()

	tenant := reviewTenant(t)
	req := reviewRequest(true)
	cfg := availableConfig(srv.URL)
	cfg.Lifetime = context.Background()

	first, accepted, err := Start(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || first == nil {
		t.Fatalf("first start=%v accepted=%+v err=%v", first, accepted, err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider call did not start")
	}
	dup, dupReceipt, err := Start(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || dup != nil || dupReceipt.Status != StatusRunning || dupReceipt.ID != accepted.ID || calls.Load() != 1 {
		t.Fatalf("duplicate job=%v receipt=%+v calls=%d err=%v", dup, dupReceipt, calls.Load(), err)
	}
	close(release)
	if final, done := first.Wait(context.Background()); !done || final.Status != "ok" {
		t.Fatalf("first final=%+v done=%v", final, done)
	}
	// A repeat of the completed original is the cached receipt on the same id.
	cached, cachedReceipt, err := Start(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || cached != nil || cachedReceipt.Status != "skipped_duplicate" || cachedReceipt.Cached == nil || !*cachedReceipt.Cached || cachedReceipt.OriginalReviewID != accepted.ID || calls.Load() != 1 {
		t.Fatalf("cached=%+v calls=%d err=%v", cachedReceipt, calls.Load(), err)
	}
}

func TestPersistedInFlightRowBlocksAfterRestart(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	close(release)
	srv := blockingProvider(t, &calls, make(chan struct{}, 1), release)
	defer srv.Close()

	tenant := reviewTenant(t)
	req := reviewRequest(true)
	cfg := availableConfig(srv.URL)
	key := executionKeyForTest(t, tenant, req, cfg)
	appendReviewCacheFixtures(t, tenant, runningFixture("orphan-id", key))

	// A fresh process has no in-process active claim, only the persisted row.
	job, receipt, err := Start(context.Background(), tenant, "tenant", req, availableConfig(srv.URL))
	if err != nil || job != nil || receipt.Status != StatusRunning || receipt.ID != "orphan-id" || calls.Load() != 0 {
		t.Fatalf("restart duplicate job=%v receipt=%+v calls=%d err=%v", job, receipt, calls.Load(), err)
	}
}
