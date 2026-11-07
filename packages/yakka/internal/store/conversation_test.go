package store

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func cvFact(n int, typ string, ts float64, f FactRow) FactRow {
	raw := []byte(fmt.Sprintf(`{"type":%q,"n":%d}`, typ, n))
	f.RowHash, f.Raw = keys.ContentHash(raw), raw
	return f
}

// conversationMixed is one conversation of five kinds of fact at increasing ts.
func conversationMixed(t *testing.T) (*Tenant, float64) {
	t.Helper()
	tn := openT(t, Options{})
	base := float64(time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC).Unix())
	rows := []FactRow{
		cvFact(1, "hook_event", base+0, FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "UserPromptSubmit", TS: base + 0, RepoID: "repoA", NormEvent: "prompt"}),
		cvFact(2, "hook_event", base+1, FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "PreToolUse", TS: base + 1, RepoID: "repoA", NormEvent: "tool_use", Tool: "Read"}),
		cvFact(3, "hook_event", base+2, FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
			Event: "transcript.assistant_message", TS: base + 2, RepoID: "repoA", NormEvent: "usage",
			Model: "kimi-k2.5", TokIn: 1000, TokOut: 50}),
		cvFact(4, "artifact_version", base+3, FactRow{Type: "artifact_version", ConversationID: "c1", Harness: "codex",
			Event: "artifact", TS: base + 3, RepoID: "repoB", Path: "docs/plans/p1/DESIGN.md", Source: "worktree"}),
		cvFact(5, "commit", base+4, FactRow{Type: "commit", ConversationID: "c1", Harness: "codex",
			Event: "commit", TS: base + 4, RepoID: "repoB", SHA: "abc123"}),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn, base
}

func TestConversationTimeline(t *testing.T) {
	ctx := context.Background()
	tn, base := conversationMixed(t)
	d, ok, err := tn.Conversation(ctx, "c1", ConversationBounds{})
	if err != nil || !ok {
		t.Fatalf("Conversation: ok=%v err=%v", ok, err)
	}
	if d.Truncated || len(d.Events) != 5 {
		t.Fatalf("events: truncated=%v n=%d", d.Truncated, len(d.Events))
	}
	if d.Harness != "claude" {
		t.Errorf("harness = %q", d.Harness)
	}
	if !reflect.DeepEqual(d.Repos, []string{"repoA", "repoB"}) {
		t.Errorf("repos = %#v", d.Repos)
	}
	if !reflect.DeepEqual(d.Models, []string{"kimi-k2.5"}) {
		t.Errorf("models = %#v", d.Models)
	}
	if d.FirstTS != base || d.LastTS != base+4 {
		t.Errorf("span = %v..%v, want %v..%v", d.FirstTS, d.LastTS, base, base+4)
	}
	for i := 0; i+1 < len(d.Events); i++ {
		if d.Events[i].TS > d.Events[i+1].TS {
			t.Fatalf("not time ordered at %d: %v > %v", i, d.Events[i].TS, d.Events[i+1].TS)
		}
	}
	if e := d.Events[0]; e.NormEvent != "prompt" || e.Event != "UserPromptSubmit" || e.Tokens != nil || e.CostUSD != nil {
		t.Errorf("event 0 = %#v", e)
	}
	if e := d.Events[1]; e.Tool != "Read" || e.Tokens != nil {
		t.Errorf("event 1 = %#v", e)
	}
	if e := d.Events[2]; e.Tokens == nil || e.Tokens.In != 1000 || e.Tokens.Out != 50 || e.CostUSD == nil || !e.Priced {
		t.Errorf("event 2 = %#v", e)
	} else if math.Abs(*e.CostUSD-0.00075) > 1e-12 {
		t.Errorf("event 2 cost = %v, want 0.00075", *e.CostUSD)
	}
	if e := d.Events[3]; e.Kind != "design" || e.Source != "worktree" {
		t.Errorf("event 3 = %#v", e)
	}
	if e := d.Events[4]; e.Type != "commit" || e.SHA != "abc123" {
		t.Errorf("event 4 = %#v", e)
	}
	if tot := d.Totals; tot.ModelCalls != 1 || tot.TokensIn != 1000 || tot.TokensOut != 50 ||
		tot.UnpricedCalls != 0 || math.Abs(tot.CostUSD-0.00075) > 1e-12 {
		t.Errorf("totals = %#v", tot)
	}
}

func TestConversationUnpricedFlag(t *testing.T) {
	tn := openT(t, Options{})
	tm := float64(time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC).Unix())
	row := cvFact(1, "hook_event", tm, FactRow{Type: "hook_event", ConversationID: "c1", Harness: "claude",
		Event: "transcript.assistant_message", TS: tm, NormEvent: "usage", Model: "unknown-model", TokIn: 12})
	if _, err := tn.Append(context.Background(), []FactRow{row}); err != nil {
		t.Fatal(err)
	}
	d, ok, err := tn.Conversation(context.Background(), "c1", ConversationBounds{})
	if err != nil || !ok || len(d.Events) != 1 {
		t.Fatalf("Conversation: ok=%v n=%d err=%v", ok, len(d.Events), err)
	}
	if d.Events[0].CostUSD == nil || d.Events[0].Priced || d.Totals.UnpricedCalls != 1 {
		t.Fatalf("unpriced event/totals: event=%+v totals=%+v", d.Events[0], d.Totals)
	}
}

func claudeUsage(n int, ref string, out int64, reported float64, ts float64) FactRow {
	raw := []byte(fmt.Sprintf(`{"backfill":{"ref":%q},"n":%d}`, ref, n))
	cp := reported
	return FactRow{RowHash: keys.ContentHash(raw), Type: "hook_event", ConversationID: "c1", Harness: "claude",
		Event: "transcript.assistant_message", TS: ts, RepoID: "repoA", Raw: raw, NormEvent: "usage",
		Model: "claude-sonnet-5-5", TokOut: out, CostReported: &cp}
}

func TestConversationDedupe(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	base := float64(time.Date(2026, 9, 28, 11, 0, 0, 0, time.UTC).Unix())
	rows := []FactRow{
		claudeUsage(1, "msg-A", 40, 0.5, base),
		claudeUsage(2, "msg-A", 10, 0.5, base+1),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	d, ok, err := tn.Conversation(ctx, "c1", ConversationBounds{})
	if err != nil || !ok {
		t.Fatalf("Conversation: ok=%v err=%v", ok, err)
	}
	if len(d.Events) != 2 {
		t.Fatalf("events = %d", len(d.Events))
	}
	if d.Events[0].CostUSD == nil || d.Events[0].Tokens == nil || d.Events[0].Tokens.Out != 40 {
		t.Errorf("winner = %#v", d.Events[0])
	}
	if d.Events[1].CostUSD != nil || d.Events[1].Tokens != nil {
		t.Errorf("repeat = %#v", d.Events[1])
	}
	if d.Totals.ModelCalls != 1 || d.Totals.TokensOut != 40 || math.Abs(d.Totals.CostUSD-0.5) > 1e-12 {
		t.Errorf("totals = %#v", d.Totals)
	}
	var sum float64
	for _, e := range d.Events {
		if e.CostUSD != nil {
			sum += *e.CostUSD
		}
	}
	if math.Abs(sum-d.Totals.CostUSD) > 1e-12 {
		t.Errorf("event cost sum %v != totals %v", sum, d.Totals.CostUSD)
	}
}

func TestConversationTruncate(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	base := float64(time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC).Unix())
	rows := make([]FactRow, 0, 5001)
	for i := 1; i <= 5001; i++ {
		ts := base + float64(i)
		rows = append(rows, cvFact(i, "hook_event", ts, FactRow{Type: "hook_event", ConversationID: "big",
			Harness: "claude", Event: "PreToolUse", TS: ts, RepoID: "repoA", NormEvent: "tool_use"}))
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	d, ok, err := tn.Conversation(ctx, "big", ConversationBounds{})
	if err != nil || !ok {
		t.Fatalf("Conversation: ok=%v err=%v", ok, err)
	}
	if !d.Truncated || len(d.Events) != 5000 {
		t.Fatalf("truncated=%v events=%d", d.Truncated, len(d.Events))
	}
	if d.FirstTS != base+1 || d.LastTS != base+5001 {
		t.Errorf("span = %v..%v, want %v..%v", d.FirstTS, d.LastTS, base+1, base+5001)
	}
	if d.Events[4999].TS != base+5000 {
		t.Errorf("last event ts = %v, want %v", d.Events[4999].TS, base+5000)
	}
}

func TestConversationUnknown(t *testing.T) {
	tn, _ := conversationMixed(t)
	if _, ok, err := tn.Conversation(context.Background(), "nope", ConversationBounds{}); err != nil || ok {
		t.Fatalf("unknown id: ok=%v err=%v", ok, err)
	}
}

func TestConversationTotalsBeyondCap(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	base := float64(time.Date(2026, 9, 28, 13, 0, 0, 0, time.UTC).Unix())
	rows := make([]FactRow, 0, 5002)
	for i := 1; i <= 5001; i++ {
		rows = append(rows, cvFact(i, "hook_event", base+float64(i), FactRow{Type: "hook_event", ConversationID: "cap",
			Harness: "claude", Event: "PreToolUse", TS: base + float64(i), RepoID: "repoA", NormEvent: "tool_use"}))
	}
	rows = append(rows, cvFact(5002, "hook_event", base+5002, FactRow{Type: "hook_event", ConversationID: "cap",
		Harness: "claude", Event: "transcript.assistant_message", TS: base + 5002, RepoID: "repoA", NormEvent: "usage",
		Model: "kimi-k2.5", TokIn: 2000, TokOut: 100}))
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	d, ok, err := tn.Conversation(ctx, "cap", ConversationBounds{})
	if err != nil || !ok {
		t.Fatalf("Conversation: ok=%v err=%v", ok, err)
	}
	if !d.Truncated || len(d.Events) != 5000 {
		t.Fatalf("truncated=%v events=%d", d.Truncated, len(d.Events))
	}
	if d.Totals.ModelCalls != 1 || d.Totals.TokensIn != 2000 {
		t.Errorf("totals = %#v", d.Totals)
	}
	var sumIn int64
	for _, e := range d.Events {
		if e.Tokens != nil {
			sumIn += e.Tokens.In
		}
	}
	if sumIn != 0 {
		t.Errorf("capped events token sum = %d, usage is past cap", sumIn)
	}
}

func TestConversationWindowTotals(t *testing.T) {
	ctx := context.Background()
	tn, base := conversationMixed(t)
	from := base + 3
	to := base + 4
	d, ok, err := tn.Conversation(ctx, "c1", ConversationBounds{From: &from, To: &to})
	if err != nil || !ok {
		t.Fatalf("Conversation: ok=%v err=%v", ok, err)
	}
	if d.WindowTotals == nil {
		t.Fatal("window_totals missing")
	}
	if d.WindowTotals.ModelCalls != 0 {
		t.Errorf("window model_calls = %d, usage at ts=%v is outside range", d.WindowTotals.ModelCalls, base+2)
	}
	if len(d.Events) != 5 {
		t.Fatalf("events = %d, want full run", len(d.Events))
	}
	if d.Events[2].Tokens == nil {
		t.Errorf("usage event still listed: %#v", d.Events[2])
	}
	if d.Totals.ModelCalls != 1 {
		t.Errorf("run totals = %#v", d.Totals)
	}
}
