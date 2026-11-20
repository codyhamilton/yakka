package serve

import (
	"math"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestAnalyticsCostTreemapRetainedShape(t *testing.T) {
	s, ts := queryTenant(t)
	at := time.Now().UTC().Add(-time.Hour)
	tag := 0
	add := func(harness, model, conv string, n int, cost float64) {
		for i := 0; i < n; i++ {
			tag++
			c := cost
			qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: conv, Harness: harness, RepoID: "r1",
				Event: "transcript.assistant_message", NormEvent: "usage", Model: model, TokIn: 10, TokOut: 1,
				CostReported: &c, TS: float64(at.Add(time.Duration(tag) * time.Second).Unix())}, fx{"tag": tag})
		}
	}
	// Two dimensions whose independent top-two sets differ: harness top two are claude and
	// codex (opencode folds); model top two by cost are model-a and model-c (b, d, e fold).
	add("claude", "model-a", "c1", 5, 0.10) // 0.50
	add("claude", "model-b", "c1", 3, 0.10) // 0.30
	add("codex", "model-c", "c2", 2, 0.20)  // 0.40
	add("codex", "model-d", "c2", 1, 0.20)  // 0.20
	add("opencode", "model-e", "c3", 1, 0.20)

	m := aok(t, s, "/v1/analytics/query?measure=cost_usd&dim=harness&dim=model&top=2&bucket=none&all=1")
	if got := strs(m["dims"]); len(got) != 2 || got[0] != "harness" || got[1] != "model" {
		t.Fatalf("dims order: %v", got)
	}
	if m["bucket"] != "none" || m["measure"] != "cost_usd" {
		t.Fatalf("response shape: bucket=%v measure=%v", m["bucket"], m["measure"])
	}

	type wantRow struct {
		k [2]string
		v float64
	}
	want := []wantRow{
		{[2]string{"__other__", "__other__"}, 0.20},
		{[2]string{"claude", "__other__"}, 0.30},
		{[2]string{"claude", "model-a"}, 0.50},
		{[2]string{"codex", "__other__"}, 0.20},
		{[2]string{"codex", "model-c"}, 0.40},
	}
	got := rowsOf(m, "rows")
	if len(got) != len(want) {
		t.Fatalf("rows: %v", got)
	}
	total := 0.0
	for i, r := range got {
		k := strs(r["k"])
		if len(k) != 2 {
			t.Fatalf("row %d key: %v", i, r["k"])
		}
		if k[0] != want[i].k[0] || k[1] != want[i].k[1] {
			t.Fatalf("row %d key: got %v want %v", i, k, want[i].k)
		}
		v, _ := r["v"].(float64)
		if math.Abs(v-want[i].v) > 1e-9 {
			t.Fatalf("row %d value: got %v want %v", i, v, want[i].v)
		}
		if k[0] != "claude" && k[0] != "codex" && k[0] != "__other__" {
			t.Fatalf("harness %q outside its own top two: %v", k[0], k)
		}
		if k[1] != "model-a" && k[1] != "model-c" && k[1] != "__other__" {
			t.Fatalf("model %q outside its own top two: %v", k[1], k)
		}
		total += v
	}
	if math.Abs(total-1.60) > 1e-9 {
		t.Fatalf("total cost: got %v want 1.60", total)
	}
	// (other) is present in each dimension independently, not as an intersection of both.
	if k := strs(got[0]["k"]); k[0] != "__other__" {
		t.Fatalf("harness (other) missing: %v", k)
	}
	if k := strs(got[1]["k"]); k[1] != "__other__" {
		t.Fatalf("model (other) missing: %v", k)
	}
}
