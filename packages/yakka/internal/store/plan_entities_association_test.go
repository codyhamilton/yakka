package store

import (
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func TestPlanAssociatedCostUsesAssociatedSessions(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	ctx := context.Background()
	base := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	cost := 0.10
	add := func(f FactRow) {
		t.Helper()
		raw, _ := json.Marshal(map[string]any{"type": f.Type, "conversation_id": f.ConversationID})
		f.Raw = raw
		f.RowHash = keys.ContentHash(raw)
		if _, err := tn.Append(ctx, []FactRow{f}); err != nil {
			t.Fatal(err)
		}
	}
	add(FactRow{Type: "artifact_version", ConversationID: "writer", Harness: "h", RepoID: "repo-a",
		Path: "docs/plans/plan-a/DESIGN.md", ContentHash: keys.ContentHash([]byte("design")), TS: float64(base.Unix())})
	add(FactRow{Type: "hook_event", ConversationID: "writer", Harness: "opencode", Event: "transcript.assistant_message",
		NormEvent: "usage", CostReported: &cost, TS: float64(base.Add(time.Minute).Unix())})

	f := AnalyticsFilter{From: base.Add(-time.Hour), To: base.Add(time.Hour), Repos: []string{"repo-a"}}
	got, unpriced, calls, err := tn.PlanAssociatedCost(ctx, f, "repo-a", "plan-a")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || math.Abs(*got-0.10) > 1e-9 || unpriced != 0 || calls != 1 {
		t.Fatalf("associated cost with identity repo filter = %v unpriced=%d calls=%d, want 0.10/0/1", got, unpriced, calls)
	}

	page, more, err := tn.PlanEntitiesPage(ctx, f, "associated_cost_usd", true, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if more || len(page) != 1 || page[0].SortValue == nil || math.Abs(*page[0].SortValue-0.10) > 1e-9 {
		t.Fatalf("plan list sort by associated cost under identity repo filter = %+v more=%v", page, more)
	}
}

// A plan's associated session is selected by its lifetime artifact association plus in-window
// membership. That membership must not also require the session's usage facts to carry the plan's
// raw repo/plan: an empty-repo usage call is exactly the D18 shape, and the association artifact
// can predate the window.
func TestPlanAssociationIgnoresIdentityFilter(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	ctx := context.Background()
	base := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	cost := 0.10
	add := func(f FactRow) {
		t.Helper()
		raw, _ := json.Marshal(map[string]any{"type": f.Type, "conversation_id": f.ConversationID})
		f.Raw = raw
		f.RowHash = keys.ContentHash(raw)
		if _, err := tn.Append(ctx, []FactRow{f}); err != nil {
			t.Fatal(err)
		}
	}
	add(FactRow{Type: "artifact_version", ConversationID: "writer", Harness: "h", RepoID: "repo-a",
		Path: "docs/plans/plan-a/DESIGN.md", ContentHash: keys.ContentHash([]byte("old-design")),
		TS: float64(base.Add(-48 * time.Hour).Unix())})
	add(FactRow{Type: "hook_event", ConversationID: "writer", Harness: "opencode",
		Event: "transcript.assistant_message", NormEvent: "usage", CostReported: &cost, TS: float64(base.Unix())})

	f := AnalyticsFilter{From: base.Add(-time.Hour), To: base.Add(time.Hour),
		Repos: []string{"repo-a"}, Plans: []string{"plan-a"}}
	got, unpriced, calls, err := tn.PlanAssociatedCost(ctx, f, "repo-a", "plan-a")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || math.Abs(*got-0.10) > 1e-9 || unpriced != 0 || calls != 1 {
		t.Fatalf("out-of-window artifact / in-window empty-repo usage cost = %v unpriced=%d calls=%d, want 0.10/0/1", got, unpriced, calls)
	}
	ids, err := tn.PlanSessionIDs(ctx, f, "repo-a", "plan-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "writer" {
		t.Fatalf("associated session IDs = %v, want [writer]", ids)
	}
}
