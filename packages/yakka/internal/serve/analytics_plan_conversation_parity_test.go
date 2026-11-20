package serve

import (
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestPlanDetailEventIdentity(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	cost := 0.10
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "writer", Harness: "h", RepoID: "repo",
		Path: "docs/plans/p/DESIGN.md", ContentHash: keys.ContentHash([]byte("design")), TS: float64(now.Add(-time.Minute).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "writer", Harness: "opencode", Event: "transcript.assistant_message",
		NormEvent: "usage", CostReported: &cost, TS: float64(now.Add(-time.Second).Unix())}, nil)
	window := "&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	eventURL := "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=events&limit=1" + window
	page := aok(t, s, eventURL)
	seen := []fx{}
	for {
		seen = append(seen, rowsOf(page, "rows")...)
		next, ok := page["next"].(string)
		if !ok {
			break
		}
		page = aok(t, s, eventURL+"&cursor="+url.QueryEscape(next))
	}
	pop := page["population"].(map[string]any)
	if got := pop["scope_n"]; got != float64(len(seen)) || len(seen) != 2 {
		t.Fatalf("plan event count %v != paged total %d", got, len(seen))
	}
	types := map[string]bool{}
	for _, e := range seen {
		types[e["event_type"].(string)] = true
	}
	if !types["artifact_version"] || !types["hook_event"] {
		t.Fatalf("plan events missing associated usage hook: %v", seen)
	}
}

func TestConversationToolKind(t *testing.T) {
	s, ts := queryTenant(t)
	base := float64(time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC).Unix())
	convAppend(t, ts,
		convFact(t, 1, store.FactRow{Type: "hook_event", ConversationID: "c-kind", Harness: "claude",
			Event: "UserPromptSubmit", TS: base, NormEvent: "prompt"}, nil),
		convFact(t, 2, store.FactRow{Type: "hook_event", ConversationID: "c-kind", Harness: "claude",
			Event: "PreToolUse", TS: base + 1, NormEvent: "tool_use", Tool: "Read"}, nil),
		convFact(t, 3, store.FactRow{Type: "hook_event", ConversationID: "c-kind", Harness: "claude",
			Event: "PreToolUse", TS: base + 2, NormEvent: "tool_use", Tool: "Bash"}, nil),
		convFact(t, 4, store.FactRow{Type: "hook_event", ConversationID: "c-kind", Harness: "claude",
			Event: "PreToolUse", TS: base + 3, NormEvent: "tool_use", Tool: "Frobnicate"}, nil),
	)
	ev := convEvents(aok(t, s, "/v1/analytics/conversation?id=c-kind"))
	want := map[string]string{"Read": "read", "Bash": "shell", "Frobnicate": "other", "": ""}
	for i, e := range ev {
		kind, ok := e["tool_kind"]
		if !ok {
			t.Fatalf("event %d missing tool_kind: %v", i, e)
		}
		if w, ok := want[e["tool"].(string)]; ok && kind != w {
			t.Fatalf("tool %q kind = %v, want %q", e["tool"], kind, w)
		}
	}
}
