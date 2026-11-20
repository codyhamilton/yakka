package store

import (
	"context"
	"encoding/json"
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

// TestPlanBatchReadsMatchPerPlan compares the page-wide plan reads with the per-plan reference
// path across artifact kinds, latest design scores, associated cost/unpriced and session IDs.
func TestPlanBatchReadsMatchPerPlan(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	ctx := context.Background()
	base := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	cost := 0.10
	n := 0
	add := func(f FactRow) string {
		t.Helper()
		n++
		raw, _ := json.Marshal(map[string]any{"type": f.Type, "conversation_id": f.ConversationID, "n": n})
		f.Raw = raw
		f.RowHash = keys.ContentHash(raw)
		if f.ContentHash == "" {
			f.ContentHash = keys.ContentHash([]byte("content-" + string(rune('a'+n))))
		}
		if _, err := tn.Append(ctx, []FactRow{f}); err != nil {
			t.Fatal(err)
		}
		return f.ContentHash
	}
	designA := add(FactRow{Type: "artifact_version", ConversationID: "writer-a", Harness: "opencode", RepoID: "repo-a",
		Path: "docs/plans/plan-a/DESIGN.md", TS: float64(base.Add(-10 * time.Minute).Unix())})
	add(FactRow{Type: "artifact_version", ConversationID: "writer-a", Harness: "opencode", RepoID: "repo-a",
		Path: "docs/plans/plan-a/briefs/b.md", TS: float64(base.Add(-9 * time.Minute).Unix())})
	designB := add(FactRow{Type: "artifact_version", ConversationID: "shared", Harness: "cursor", RepoID: "repo-a",
		Path: "docs/plans/plan-b/DESIGN.md", TS: float64(base.Add(-7 * time.Minute).Unix())})
	add(FactRow{Type: "artifact_version", ConversationID: "shared", Harness: "cursor", RepoID: "repo-a",
		Path: "docs/plans/plan-a/reports/b.md", TS: float64(base.Add(-8 * time.Minute).Unix())})
	add(FactRow{Type: "artifact_version", ConversationID: "writer-a", Harness: "opencode", RepoID: "repo-a",
		Path: "docs/plans/plan-a/reports/old.md", TS: float64(base.Add(-48 * time.Hour).Unix())})
	add(FactRow{Type: "hook_event", ConversationID: "writer-a", Harness: "opencode", RepoID: "repo-a", Event: "usage",
		NormEvent: "usage", Model: "gpt-5", CostReported: &cost, TS: float64(base.Add(-5 * time.Minute).Unix())})
	add(FactRow{Type: "hook_event", ConversationID: "shared", Harness: "cursor", RepoID: "repo-a", Event: "usage",
		NormEvent: "usage", Model: "opus", TokIn: 50, TS: float64(base.Add(-3 * time.Minute).Unix())})
	add(FactRow{Type: "hook_event", ConversationID: "writer-b", Harness: "claude", RepoID: "repo-a", Event: "usage",
		NormEvent: "usage", Model: "sonnet", TokIn: 40, TS: float64(base.Add(-2 * time.Minute).Unix())})
	if err := tn.AppendScores(ctx, designA, []Score{{Check: "clarity", Result: .4, Scorer: "fixture"}, {Check: "coverage", Result: .8, Scorer: "fixture"}}); err != nil {
		t.Fatal(err)
	}
	if err := tn.AppendScores(ctx, designB, []Score{{Check: "clarity", Result: .9, Scorer: "fixture"}}); err != nil {
		t.Fatal(err)
	}

	f := AnalyticsFilter{From: base.Add(-time.Hour), To: base.Add(time.Hour)}
	keys := []PlanIdentity{{"repo-a", "plan-a"}, {"repo-a", "plan-b"}}
	kinds, err := tn.PlanArtifactKindsFor(ctx, f, keys)
	if err != nil {
		t.Fatal(err)
	}
	scores, err := tn.PlanDesignScoresFor(ctx, keys)
	if err != nil {
		t.Fatal(err)
	}
	costs, err := tn.PlanAssociatedCosts(ctx, f, keys)
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := tn.PlanSessionIDsByPlan(ctx, f, keys)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range keys {
		wantKinds, err := tn.PlanArtifactKinds(ctx, f, key.RepoID, key.Plan)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(kinds[key], wantKinds) {
			t.Errorf("%v kinds=%v, per-plan=%v", key, kinds[key], wantKinds)
		}
		wantScores, err := tn.PlanDesignScores(ctx, key.RepoID, key.Plan)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(scores[key], wantScores) {
			t.Errorf("%v scores=%v, per-plan=%v", key, scores[key], wantScores)
		}
		wantCost, wantUnpriced, wantCalls, err := tn.PlanAssociatedCost(ctx, f, key.RepoID, key.Plan)
		if err != nil {
			t.Fatal(err)
		}
		got := costs[key]
		if !equalCost(got.CostUSD, wantCost) || got.UnpricedCalls != wantUnpriced || got.Calls != wantCalls {
			t.Errorf("%v cost=%v/%d/%d, per-plan=%v/%d/%d", key, got.CostUSD, got.UnpricedCalls, got.Calls, wantCost, wantUnpriced, wantCalls)
		}
		wantIDs, err := tn.PlanSessionIDs(ctx, f, key.RepoID, key.Plan)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(sessions[key], wantIDs) {
			t.Errorf("%v sessions=%v, per-plan=%v", key, sessions[key], wantIDs)
		}
	}

	if got := kinds[keys[0]]; got["design"] != 1 || got["brief"] != 1 || got["report"] != 1 || len(got) != 3 {
		t.Errorf("plan-a in-window kinds=%v, want design/brief/report only", got)
	}
	if !reflect.DeepEqual(sessions[keys[0]], []string{"shared", "writer-a"}) {
		t.Errorf("plan-a sessions=%v", sessions[keys[0]])
	}
	if cost := costs[keys[0]]; cost.CostUSD == nil || math.Abs(*cost.CostUSD-0.10) > 1e-9 || cost.UnpricedCalls != 1 || cost.Calls != 2 {
		t.Errorf("plan-a cost=%+v, want 0.10 lower bound over 2 calls", cost)
	}
	if !reflect.DeepEqual(scores[keys[0]], map[string]float64{"clarity": .4, "coverage": .8}) {
		t.Errorf("plan-a design scores=%v", scores[keys[0]])
	}
}

func equalCost(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return math.Abs(*a-*b) < 1e-9
}
