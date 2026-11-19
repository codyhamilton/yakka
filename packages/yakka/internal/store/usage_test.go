package store

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func ufact(n int, harness, model, conv, raw string, ts time.Time, in, out, cr, cw, reas int64, cost *float64) FactRow {
	return FactRow{
		RowHash: keys.ContentHash([]byte(raw)), Type: "hook_event",
		ConversationID: conv, Harness: harness, Event: "transcript.assistant_message",
		TS: float64(ts.Unix()), RepoID: "repoA", Raw: []byte(raw), NormEvent: "usage", Model: model,
		TokIn: in, TokOut: out, TokCacheRead: cr, TokCacheWrite: cw, TokReasoning: reas,
		CostReported: cost,
	}
}

// usageFixture is one conversation of four usage facts (a two-row Claude pair, Codex, OpenCode).
func usageFixture(t *testing.T) *Tenant {
	t.Helper()
	tn := openT(t, Options{})
	reported := 0.25
	rows := []FactRow{
		// Claude pair: same conversation and backfill.ref msg-A, tok_out 10 then 40. The model is
		// not in pricing_table.json and no cost is reported, so the single kept call is unpriced.
		ufact(1, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"msg-A"},"n":1}`, aFrom, 0, 10, 0, 0, 0, nil),
		ufact(2, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"msg-A"},"n":2}`, aFrom, 0, 40, 0, 0, 0, nil),
		// Codex: input_tokens include cached input, so fresh = 1000-400 = 600; kimi-k2.5 rates
		// are input 0.6 and cache_read 0.1, giving (600*0.6 + 400*0.1)/1e6 = 0.0004.
		ufact(3, "codex", "kimi-k2.5", "c1", `{"n":3}`, aFrom, 1000, 0, 400, 0, 0, nil),
		// OpenCode: a reported cost of 0.25 passes through unchanged.
		ufact(4, "opencode", "grok-4.5", "c1", `{"n":4}`, aFrom, 0, 0, 0, 0, 0, &reported),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn
}

func usageFilter() AnalyticsFilter { return AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo} }

func TestUsageMeasures(t *testing.T) {
	ctx := context.Background()
	tn := usageFixture(t)
	f := usageFilter()
	q := func(measure string) QueryResult {
		t.Helper()
		r, err := tn.Query(ctx, f, QueryParams{Measure: measure})
		if err != nil {
			t.Fatalf("%s: %v", measure, err)
		}
		return r
	}
	// The two Claude rows (msg-A) count once, plus Codex and OpenCode: 1+1+1 = 3.
	if got := q("model_calls").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 3}}) {
		t.Fatalf("model_calls: %#v", got)
	}
	// The kept Claude row has tok_out 40, not 10+40=50; Codex and OpenCode report no output.
	if got := q("tokens_out").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 40}}) {
		t.Fatalf("tokens_out: %#v", got)
	}
	// Codex 1000; Claude and OpenCode report none.
	if got := q("tokens_in").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 1000}}) {
		t.Fatalf("tokens_in: %#v", got)
	}
	// Codex 400.
	if got := q("tokens_cache_read").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 400}}) {
		t.Fatalf("tokens_cache_read: %#v", got)
	}
	// Codex 0.0004 + OpenCode 0.25 = 0.2504 (Claude is unpriced, adds 0).
	if got := q("cost_usd").Rows; len(got) != 1 || math.Abs(got[0].V-0.2504) > 1e-9 {
		t.Fatalf("cost_usd: %#v", got)
	}
	// Only the kept Claude call (unknown model, no reported cost) is unpriced: 1.
	if got := q("unpriced_calls").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 1}}) {
		t.Fatalf("unpriced_calls: %#v", got)
	}
}

func TestUsageGroupByHarnessAndModel(t *testing.T) {
	ctx := context.Background()
	tn := usageFixture(t)
	r, err := tn.Query(ctx, usageFilter(), QueryParams{Measure: "model_calls", Dims: []string{"harness", "model"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []QueryRow{
		{K: []string{"claude", "claude-test-unpriced"}, V: 1},
		{K: []string{"codex", "kimi-k2.5"}, V: 1},
		{K: []string{"opencode", "grok-4.5"}, V: 1},
	}
	if !reflect.DeepEqual(r.Rows, want) {
		t.Fatalf("group: got %#v want %#v", r.Rows, want)
	}
}

func TestUsageClaudeDedupeKeepsLargestOut(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	// Same conversation and id, different tok_out; only the 40-output row survives, so
	// tokens_out is 40 (not 50) and model_calls is 1.
	rows := []FactRow{
		ufact(1, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"m"},"n":1}`, aFrom, 0, 10, 0, 0, 0, nil),
		ufact(2, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"m"},"n":2}`, aFrom, 0, 40, 0, 0, 0, nil),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo}
	calls, err := tn.Query(ctx, f, QueryParams{Measure: "model_calls"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(calls.Rows, []QueryRow{{K: []string{}, V: 1}}) {
		t.Fatalf("model_calls: %#v", calls.Rows)
	}
	outTok, err := tn.Query(ctx, f, QueryParams{Measure: "tokens_out"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(outTok.Rows, []QueryRow{{K: []string{}, V: 40}}) {
		t.Fatalf("tokens_out: %#v", outTok.Rows)
	}
}

func TestUsageLiveClaudeWithoutIdIsNotDeduped(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	// Live-captured Claude facts carry no id in the stored envelope, so each is its own call.
	rows := []FactRow{
		ufact(1, "claude", "claude-test-unpriced", "c1", `{"n":1}`, aFrom, 0, 10, 0, 0, 0, nil),
		ufact(2, "claude", "claude-test-unpriced", "c1", `{"n":2}`, aFrom, 0, 40, 0, 0, 0, nil),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	r, err := tn.Query(ctx, AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo}, QueryParams{Measure: "model_calls"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.Rows, []QueryRow{{K: []string{}, V: 2}}) {
		t.Fatalf("model_calls: %#v", r.Rows)
	}
}

// TestUsageIndexDrivesUsageRead: the usage CTE must be served by facts_usage_ts, not a walk of
// facts_conv_page over every base row, and the index must be created on open.
func TestUsageIndexDrivesUsageRead(t *testing.T) {
	tn := usageFixture(t)
	var n int
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name='facts_usage_ts'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("facts_usage_ts present = %d, err %v", n, err)
	}
	cte, args := usageRowsWhere(AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(4e9, 0)})
	rs, err := tn.rdb.Query("EXPLAIN QUERY PLAN "+cte+" SELECT harness FROM kept", args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var plan string
	for rs.Next() {
		var a, b, c int
		var d string
		if err := rs.Scan(&a, &b, &c, &d); err != nil {
			t.Fatal(err)
		}
		plan += d + "\n"
	}
	if !strings.Contains(plan, "facts_usage_ts") {
		t.Fatalf("usage CTE does not use facts_usage_ts:\n%s", plan)
	}
}

func TestUsageGoHeapDoesNotScaleWithScannedRows(t *testing.T) {
	queryAlloc := func(n int) uint64 {
		tn := openT(t, Options{})
		rows := make([]FactRow, n)
		for i := range rows {
			rows[i] = ufact(i, "opencode", "model-a", fmt.Sprintf("c-%d", i), fmt.Sprintf(`{"n":%d}`, i), aFrom, 1, int64(i+1), 0, 0, 0, nil)
		}
		if _, err := tn.Append(context.Background(), rows); err != nil {
			t.Fatal(err)
		}
		params := QueryParams{Measure: "tokens_out"}
		if _, err := tn.Query(context.Background(), usageFilter(), params); err != nil {
			t.Fatal(err)
		}
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		if _, err := tn.Query(context.Background(), usageFilter(), params); err != nil {
			t.Fatal(err)
		}
		runtime.ReadMemStats(&after)
		return after.TotalAlloc - before.TotalAlloc
	}

	small := queryAlloc(128)
	large := queryAlloc(2048)
	t.Logf("Go allocations: 128 rows=%d bytes, 2048 rows=%d bytes", small, large)
	if large > small*4+64*1024 {
		t.Fatalf("Go allocations scale with scanned rows: 128 rows=%d bytes, 2048 rows=%d bytes", small, large)
	}
}
