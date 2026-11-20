package serve

import (
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func scatterMarginalTotal(t *testing.T, m fx, field string) float64 {
	t.Helper()
	bins, ok := m["marginals"].(map[string]any)[field].([]any)
	if !ok {
		t.Fatalf("marginal %s has unexpected shape %T", field, m["marginals"].(map[string]any)[field])
	}
	total := 0.0
	for _, raw := range bins {
		total += raw.(map[string]any)["n"].(float64)
	}
	return total
}

func scatterMarginalBinN(t *testing.T, m fx, field string, index int) float64 {
	t.Helper()
	bins, ok := m["marginals"].(map[string]any)[field].([]any)
	if !ok {
		t.Fatalf("marginal %s has unexpected shape %T", field, m["marginals"].(map[string]any)[field])
	}
	return bins[index].(map[string]any)["n"].(float64)
}

func TestAnalyticsSessionScatterMarginalsCommitsUnpriced(t *testing.T) {
	s, ts := queryTenant(t)
	at := float64(time.Now().UTC().Add(-time.Hour).Unix())
	addCommit := func(conv string, n int) {
		for i := 0; i < n; i++ {
			qadd(t, ts, store.FactRow{Type: "commit", ConversationID: conv, Harness: "h", RepoID: "r",
				Event: "commit", TS: at + float64(i)}, nil)
		}
	}
	price := 0.25
	callTS := at
	addCall := func(conv, model string, tokIn int64, reported *float64) {
		callTS++
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: conv, Harness: "h", NormEvent: "usage",
			Event: "usage", Model: model, TokIn: tokIn, CostReported: reported, TS: callTS}, nil)
	}
	// s1: two commits, one priced and one unpriced call.
	addCommit("s1", 2)
	addCall("s1", "priced-model", 100, &price)
	addCall("s1", "unpriced-model", 1, nil)
	// s2: one commit, no calls (cost is an eligible zero).
	addCommit("s2", 1)
	// s3: no commits, two unpriced calls (cost is missing, not zero).
	addCall("s3", "unpriced-model", 1, nil)
	addCall("s3", "unpriced-model", 1, nil)
	// s4: three commits, one priced call.
	addCommit("s4", 3)
	addCall("s4", "priced-model", 200, &price)

	got := aok(t, s, "/v1/analytics/entities?grain=session&mode=scatter&fields=cost_usd,commits,unpriced_calls&all=1")
	population := got["population_n"].(float64)
	if population != 4 {
		t.Fatalf("population_n=%v want 4", population)
	}
	if len(rowsOf(got, "rows")) != 4 {
		t.Fatalf("rows=%v", got["rows"])
	}
	byID := map[string]fx{}
	for _, row := range rowsOf(got, "rows") {
		byID[row["id"].(string)] = row["m"].(map[string]any)
	}
	want := map[string]struct {
		commits, unpriced float64
		costNil           bool
	}{
		"s1": {2, 1, false},
		"s2": {1, 0, false},
		"s3": {0, 2, true},
		"s4": {3, 0, false},
	}
	for id, w := range want {
		m := byID[id]
		if m["commits"] != w.commits || m["unpriced_calls"] != w.unpriced {
			t.Fatalf("%s row measures=%v want commits=%v unpriced=%v", id, m, w.commits, w.unpriced)
		}
		if (m["cost_usd"] == nil) != w.costNil {
			t.Fatalf("%s cost_usd=%v want null=%v", id, m["cost_usd"], w.costNil)
		}
	}
	if total := scatterMarginalTotal(t, got, "commits"); total != population {
		t.Fatalf("commits marginal total=%v want population %v", total, population)
	}
	if total := scatterMarginalTotal(t, got, "unpriced_calls"); total != population {
		t.Fatalf("unpriced_calls marginal total=%v want population %v", total, population)
	}
	if n := scatterMarginalBinN(t, got, "commits", 0); n != 1 {
		t.Fatalf("commits zero bin=%v want 1 (s3)", n)
	}
	if n := scatterMarginalBinN(t, got, "commits", 1); n != 1 {
		t.Fatalf("commits [1,2) bin=%v want 1 (s2)", n)
	}
	if n := scatterMarginalBinN(t, got, "commits", 2); n != 2 {
		t.Fatalf("commits [2,4) bin=%v want 2 (s1 2, s4 3)", n)
	}
	if n := scatterMarginalBinN(t, got, "unpriced_calls", 0); n != 2 {
		t.Fatalf("unpriced_calls zero bin=%v want 2 (s2, s4)", n)
	}
	if n := scatterMarginalBinN(t, got, "unpriced_calls", 1); n != 1 {
		t.Fatalf("unpriced_calls [1,2) bin=%v want 1 (s1)", n)
	}
	if n := scatterMarginalBinN(t, got, "unpriced_calls", 2); n != 1 {
		t.Fatalf("unpriced_calls [2,4) bin=%v want 1 (s3)", n)
	}
	// Cost keeps its priced-only eligibility: s1 and s4 priced, s2 an eligible zero,
	// and s3 (all calls unpriced) missing rather than zero.
	if total := scatterMarginalTotal(t, got, "cost_usd"); total != 3 {
		t.Fatalf("cost_usd marginal total=%v want 3", total)
	}
	if n := scatterMarginalBinN(t, got, "cost_usd", 0); n != 1 {
		t.Fatalf("cost_usd zero bin=%v want 1 (s2)", n)
	}
	coverage := got["population"].(map[string]any)
	eligible := coverage["eligible_n"].(map[string]any)
	missing := coverage["missing_by_reason"].(map[string]any)
	if eligible["cost_usd"] != 3.0 || eligible["commits"] != 4.0 || eligible["unpriced_calls"] != 4.0 {
		t.Fatalf("eligible_n=%v", eligible)
	}
	if missing["unpriced_cost"] != 1.0 {
		t.Fatalf("missing_by_reason=%v want unpriced_cost 1", missing)
	}
}
