package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestAnalyticsConversationDistributionLifetimeProvenanceAtScale(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	usageTS := float64(now.Add(-time.Hour).Unix())
	lifetimeTS := float64(now.Add(-48 * time.Hour).Unix())
	const conversations = 120
	var facts []store.FactRow
	seq := 0
	add := func(f store.FactRow, payload map[string]any) {
		seq++
		payload["n"] = seq
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		f.RowHash = keys.ContentHash(raw)
		f.Raw = raw
		facts = append(facts, f)
	}
	for i := 0; i < conversations; i++ {
		conv := fmt.Sprintf("conv-%03d", i)
		repo := fmt.Sprintf("repo-%d", i%3)
		for j := 0; j < 2; j++ {
			add(store.FactRow{Type: "hook_event", ConversationID: conv, Harness: "opencode", NormEvent: "usage",
				Event: "usage", Model: "model-a", TokOut: int64(10 * (j + 1)), TS: usageTS}, map[string]any{"conv": conv, "j": j})
		}
		add(store.FactRow{Type: "artifact_version", ConversationID: conv, Harness: "opencode", RepoID: repo,
			Path: "docs/plans/p/DESIGN.md", ContentHash: keys.ContentHash([]byte(conv)), TS: lifetimeTS},
			map[string]any{"conv": conv, "repo": repo})
	}
	if _, err := ts.t.Append(context.Background(), facts); err != nil {
		t.Fatal(err)
	}
	all := aok(t, s, "/v1/analytics/distribution?measure=tokens_out&grain=conversation&all=1&top=100")
	allRows := rowsOf(all, "rows")
	if len(allRows) != 1 || allRows[0]["k"] != "all" || allRows[0]["n"] != float64(conversations*2) {
		t.Fatalf("no-dim groups=%v", allRows)
	}
	grouped := aok(t, s, "/v1/analytics/distribution?measure=tokens_out&grain=conversation&dim=session_repo&all=1&top=100")
	rows := rowsOf(grouped, "rows")
	if len(rows) != 3 || grouped["omitted_groups"] != float64(0) {
		t.Fatalf("session_repo groups=%v response=%v", rows, grouped)
	}
	for _, row := range rows {
		if row["n"] != float64(conversations*2/3) {
			t.Fatalf("session_repo %v n=%v want %d", row["k"], row["n"], conversations*2/3)
		}
	}
}
