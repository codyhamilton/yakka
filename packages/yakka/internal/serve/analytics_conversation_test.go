package serve

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// convFact builds a fact whose raw JSON carries the extra payload (so json_extract can read a
// Claude backfill.ref), and returns it with a row hash and raw set.
func convFact(t *testing.T, n int, f store.FactRow, extra fx) store.FactRow {
	t.Helper()
	payload := fx{"n": n}
	for k, v := range extra {
		payload[k] = v
	}
	payload["type"], payload["conversation_id"], payload["harness"] = f.Type, f.ConversationID, f.Harness
	payload["repo_id"], payload["event"], payload["ts"] = f.RepoID, f.Event, f.TS
	if f.Path != "" {
		payload["path"] = f.Path
	}
	if f.Source != "" {
		payload["source"] = f.Source
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	rh, err := keys.RowHash(raw)
	if err != nil {
		t.Fatal(err)
	}
	f.RowHash, f.Raw = rh, raw
	return f
}

func convAppend(t *testing.T, ts *tenantState, rows ...store.FactRow) {
	t.Helper()
	if _, err := ts.t.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
}

func convEvents(m fx) []fx {
	out := []fx{}
	for _, e := range m["events"].([]any) {
		out = append(out, e.(map[string]any))
	}
	return out
}

func assertNoRaw(t *testing.T, m fx, body string) {
	t.Helper()
	if _, ok := m["raw"]; ok {
		t.Fatal("top-level raw key")
	}
	for i, e := range convEvents(m) {
		if _, ok := e["raw"]; ok {
			t.Fatalf("event %d has raw key", i)
		}
	}
	if strings.Contains(body, `"raw"`) {
		t.Fatalf("body contains raw: %s", body)
	}
}

// convFixture is a five-fact conversation mixing prompt, tool, usage, artifact_version and commit.
func convFixture(t *testing.T) (*Server, *tenantState, float64) {
	t.Helper()
	s, ts := queryTenant(t)
	base := float64(time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC).Unix())
	convAppend(t, ts,
		convFact(t, 1, store.FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "UserPromptSubmit", TS: base + 0, RepoID: "r1", NormEvent: "prompt"}, nil),
		convFact(t, 2, store.FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "PreToolUse", TS: base + 1, RepoID: "r1", NormEvent: "tool_use", Tool: "Read"}, nil),
		convFact(t, 3, store.FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "transcript.assistant_message", TS: base + 2, RepoID: "r1", NormEvent: "usage",
			Model: "kimi-k2.5", TokIn: 1000, TokOut: 50}, nil),
		convFact(t, 4, store.FactRow{Type: "artifact_version", ConversationID: "c1", Harness: "codex",
			Event: "artifact", TS: base + 3, RepoID: "r2", Path: "docs/plans/p1/DESIGN.md", Source: "worktree"}, nil),
		convFact(t, 5, store.FactRow{Type: "commit", ConversationID: "c1", Harness: "codex",
			Event: "commit", TS: base + 4, RepoID: "r2", SHA: "abc123"}, nil),
	)
	return s, ts, base
}

func TestConversationRouteFields(t *testing.T) {
	s, _, base := convFixture(t)
	m := aok(t, s, "/v1/analytics/conversation?id=c1")
	if m["conversation_id"] != "c1" || m["harness"] != "claude" {
		t.Errorf("id/harness = %v %v", m["conversation_id"], m["harness"])
	}
	if got := strs(m["repos"]); !equalStrs(got, []string{"r1", "r2"}) {
		t.Errorf("repos = %v", got)
	}
	if got := strs(m["models"]); !equalStrs(got, []string{"kimi-k2.5"}) {
		t.Errorf("models = %v", got)
	}
	if m["first_ts"] != rfc(base) || m["last_ts"] != rfc(base+4) {
		t.Errorf("span = %v..%v", m["first_ts"], m["last_ts"])
	}
	ev := convEvents(m)
	if len(ev) != 5 {
		t.Fatalf("events = %d", len(ev))
	}
	if _, ok := ev[0]["tokens"]; ok {
		t.Errorf("prompt event tokens = %v", ev[0]["tokens"])
	}
	if ev[1]["tool"] != "Read" || ev[1]["norm_event"] != "tool_use" {
		t.Errorf("tool event = %v", ev[1])
	}
	tk, ok := ev[2]["tokens"].(map[string]any)
	if !ok || tk["in"] != 1000.0 || tk["out"] != 50.0 || ev[2]["cost_usd"] == nil || ev[2]["priced"] != true {
		t.Errorf("usage event = %v", ev[2])
	}
	if ev[3]["kind"] != "design" || ev[3]["source"] != "worktree" || ev[3]["path"] != "docs/plans/p1/DESIGN.md" {
		t.Errorf("artifact event = %v", ev[3])
	}
	if ev[4]["type"] != "commit" || ev[4]["sha"] != "abc123" {
		t.Errorf("commit event = %v", ev[4])
	}
	code, body := do(t, s.Handler(), "GET", "/v1/analytics/conversation?id=c1", "ka", "")
	if code != 200 {
		t.Fatalf("code = %d", code)
	}
	var decoded fx
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatal(err)
	}
	assertNoRaw(t, decoded, body)
}

func TestAnalyticsPartialReasonOnConversation(t *testing.T) {
	s, ts, _ := convFixture(t)
	if err := ts.t.SetMeta(t.Context(), "compaction", "required"); err != nil {
		t.Fatal(err)
	}
	m := aok(t, s, "/v1/analytics/conversation?id=c1")
	if m["partial"] != true || !equalStrs(strs(m["partial_reasons"]), []string{"compaction_incomplete"}) {
		t.Fatalf("partial metadata: %v", m)
	}
}

func TestConversationRouteErrors(t *testing.T) {
	s, _, _ := convFixture(t)
	aerr(t, s, "/v1/analytics/conversation", 400, "id required")
	aerr(t, s, "/v1/analytics/conversation?id=nope", 404, "conversation not found")
}

func TestConversationRouteDedupe(t *testing.T) {
	s, ts := queryTenant(t)
	base := float64(time.Date(2026, 9, 28, 11, 0, 0, 0, time.UTC).Unix())
	reported := 0.5
	ref := fx{"backfill": fx{"ref": "msg-A"}}
	convAppend(t, ts,
		convFact(t, 1, store.FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "transcript.assistant_message", TS: base, RepoID: "r1", NormEvent: "usage",
			Model: "claude-sonnet-5-5", TokOut: 40, CostReported: &reported}, ref),
		convFact(t, 2, store.FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "transcript.assistant_message", TS: base + 1, RepoID: "r1", NormEvent: "usage",
			Model: "claude-sonnet-5-5", TokOut: 10, CostReported: &reported}, ref),
	)
	m := aok(t, s, "/v1/analytics/conversation?id=c1")
	ev := convEvents(m)
	if len(ev) != 2 {
		t.Fatalf("events = %d", len(ev))
	}
	if ev[0]["cost_usd"] == nil {
		t.Errorf("winner has no cost: %v", ev[0])
	}
	if _, ok := ev[1]["cost_usd"]; ok {
		t.Errorf("repeat has cost: %v", ev[1])
	}
	if _, ok := ev[1]["tokens"]; ok {
		t.Errorf("repeat has tokens: %v", ev[1])
	}
	tot, _ := m["totals"].(map[string]any)
	if tot["model_calls"] != 1.0 {
		t.Errorf("model_calls = %v", tot["model_calls"])
	}
	var sum float64
	for _, e := range ev {
		if c, ok := e["cost_usd"].(float64); ok {
			sum += c
		}
	}
	if totCost, _ := tot["cost_usd"].(float64); math.Abs(sum-totCost) > 1e-12 {
		t.Errorf("event cost sum %v != totals %v", sum, totCost)
	}
}

func TestConversationRouteTruncate(t *testing.T) {
	s, ts := queryTenant(t)
	base := float64(time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC).Unix())
	rows := make([]store.FactRow, 0, 5001)
	for i := 1; i <= 5001; i++ {
		rows = append(rows, convFact(t, i, store.FactRow{Type: "hook_event", ConversationID: "big",
			Harness: "claude", Event: "PreToolUse", TS: base + float64(i), RepoID: "r1", NormEvent: "tool_use"}, nil))
	}
	convAppend(t, ts, rows...)
	m := aok(t, s, "/v1/analytics/conversation?id=big")
	ev := convEvents(m)
	if len(ev) != 5000 || m["truncated"] != true {
		t.Fatalf("truncated=%v events=%d", m["truncated"], len(ev))
	}
	if m["last_ts"] != rfc(base+5001) {
		t.Errorf("last_ts = %v, want %v", m["last_ts"], rfc(base+5001))
	}
	if ev[4999]["ts"] != rfc(base+5000) {
		t.Errorf("last event ts = %v", ev[4999]["ts"])
	}
}

func TestConversationRouteWindowTotals(t *testing.T) {
	s, _, base := convFixture(t)
	from := rfc(base + 3)
	to := rfc(base + 4)
	m := aok(t, s, "/v1/analytics/conversation?id=c1&from="+from+"&to="+to)
	wt, ok := m["window_totals"].(map[string]any)
	if !ok {
		t.Fatal("window_totals missing")
	}
	if wt["model_calls"] != 0.0 {
		t.Errorf("window model_calls = %v", wt["model_calls"])
	}
	tot, _ := m["totals"].(map[string]any)
	if tot["model_calls"] != 1.0 {
		t.Errorf("totals = %v", tot)
	}
	ev := convEvents(m)
	if len(ev) != 5 || ev[2]["cost_usd"] == nil {
		t.Errorf("full events = %d, usage=%v", len(ev), ev[2]["cost_usd"])
	}
	m2 := aok(t, s, "/v1/analytics/conversation?id=c1")
	if _, ok := m2["window_totals"]; ok {
		t.Errorf("window_totals present without bounds: %v", m2["window_totals"])
	}
}

func TestConversationRouteFromAfterTo(t *testing.T) {
	s, _, base := convFixture(t)
	aerr(t, s, "/v1/analytics/conversation?id=c1&from="+rfc(base+4)+"&to="+rfc(base), 400, "from after to")
}
