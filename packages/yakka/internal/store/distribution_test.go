package store

import (
	"context"
	"fmt"
	"math"
	"runtime"
	"testing"
	"time"
)

func distFilter() AnalyticsFilter { return AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo} }

func TestDistributionCostExcludesUnpricedFromStats(t *testing.T) {
	ctx := context.Background()
	tn := usageFixture(t)
	res, err := tn.Distribution(ctx, distFilter(), DistributionParams{Measure: "cost_usd", Grain: "call"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 1 || res.Rows[0].K != "all" {
		t.Fatalf("rows: %#v", res.Rows)
	}
	row := res.Rows[0]
	if row.N != 2 || row.Unpriced != 1 {
		t.Fatalf("n/unpriced: got %d/%d want 2/1", row.N, row.Unpriced)
	}
	// Priced costs: codex 0.0004 and opencode 0.25.
	if math.Abs(row.Min-0.0004) > 1e-9 || math.Abs(row.Max-0.25) > 1e-9 {
		t.Fatalf("min/max: %v %v", row.Min, row.Max)
	}
	var zeroN int
	for _, b := range row.Bins {
		if b.Lo == 0 && b.Hi == nil {
			zeroN = b.N
		}
	}
	if zeroN != 0 {
		t.Fatalf("zero bin counted unpriced or empty: %d", zeroN)
	}
	var centN int
	for _, b := range row.Bins {
		if b.Hi != nil && *b.Hi == 1e-3 {
			centN = b.N
		}
	}
	if centN != 1 {
		t.Fatalf("[1e-4,1e-3) bin n = %d want 1 (codex 0.0004)", centN)
	}
}

func TestDistributionTokensUnpricedZero(t *testing.T) {
	ctx := context.Background()
	tn := usageFixture(t)
	res, err := tn.Distribution(ctx, distFilter(), DistributionParams{Measure: "tokens_out", Grain: "call"})
	if err != nil {
		t.Fatal(err)
	}
	row := res.Rows[0]
	if row.Unpriced != 0 {
		t.Fatalf("unpriced = %d want 0", row.Unpriced)
	}
	if row.N != 3 {
		t.Fatalf("n = %d want 3 kept calls", row.N)
	}
}

func TestDistributionTwoModelsShareCostEdges(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	c1 := 0.00005
	c2 := 0.00008
	rows := []FactRow{
		ufact(1, "opencode", "model-a", "c1", `{"n":1}`, aFrom, 0, 0, 0, 0, 0, &c1),
		ufact(2, "opencode", "model-b", "c2", `{"n":2}`, aFrom, 0, 0, 0, 0, 0, &c2),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	res, err := tn.Distribution(ctx, distFilter(), DistributionParams{Measure: "cost_usd", Grain: "call", Dim: "model", Top: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 2 {
		t.Fatalf("rows: %d", len(res.Rows))
	}
	for _, row := range res.Rows {
		var micro int
		for _, b := range row.Bins {
			if b.Hi != nil && *b.Hi == 1e-4 {
				micro = b.N
			}
		}
		if micro != 1 {
			t.Fatalf("model %s micro bin n=%d want 1", row.K, micro)
		}
	}
}

func TestDistributionTruncatedWithoutOther(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	var rows []FactRow
	for i := 0; i < 25; i++ {
		cp := 0.01
		name := "model-" + string(rune('a'+i))
		raw := fmt.Sprintf(`{"n":%d}`, i)
		rows = append(rows, ufact(i, "opencode", name, "c1", raw, aFrom, 0, 0, 0, 0, 0, &cp))
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	res, err := tn.Distribution(ctx, distFilter(), DistributionParams{Measure: "cost_usd", Grain: "call", Dim: "model", Top: 20})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncated {
		t.Fatal("want truncated")
	}
	if len(res.Rows) != 20 {
		t.Fatalf("rows = %d want 20", len(res.Rows))
	}
	for _, row := range res.Rows {
		if row.K == "__other__" {
			t.Fatal("found __other__ row")
		}
	}
}

func TestDistributionGoHeapDoesNotScaleWithScannedRows(t *testing.T) {
	queryAlloc := func(n int) uint64 {
		tn := openT(t, Options{})
		rows := make([]FactRow, n)
		for i := range rows {
			rows[i] = ufact(i, "opencode", "model-a", fmt.Sprintf("c-%d", i), fmt.Sprintf(`{"n":%d}`, i), aFrom, 0, int64(i+1), 0, 0, 0, nil)
		}
		if _, err := tn.Append(context.Background(), rows); err != nil {
			t.Fatal(err)
		}
		params := DistributionParams{Measure: "tokens_out", Grain: "call", Top: 20}
		if _, err := tn.Distribution(context.Background(), distFilter(), params); err != nil {
			t.Fatal(err) // warm the SQL and result path before measuring
		}
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		if _, err := tn.Distribution(context.Background(), distFilter(), params); err != nil {
			t.Fatal(err)
		}
		runtime.ReadMemStats(&after)
		return after.TotalAlloc - before.TotalAlloc
	}

	small := queryAlloc(128)
	large := queryAlloc(2048)
	t.Logf("Go allocations: 128 rows=%d bytes, 2048 rows=%d bytes", small, large)
	// The input population grows 16x. Allow fixed driver/query overhead while rejecting
	// per-row Go retention or accumulation in the aggregate path.
	if large > small*4+64*1024 {
		t.Fatalf("Go allocations scale with scanned rows: 128 rows=%d bytes, 2048 rows=%d bytes", small, large)
	}
}
