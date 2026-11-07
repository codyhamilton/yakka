package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func TestSessionProvenanceForUsesLifetimeFactsAndPublishedModes(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	now := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC).Unix()
	var facts []FactRow
	add := func(id, typ, conv, harness, repo, model, norm string, ts int64) {
		raw, _ := json.Marshal(map[string]any{"type": typ, "id": id})
		facts = append(facts, FactRow{RowHash: keys.ContentHash(raw), Type: typ, ConversationID: conv, Harness: harness, RepoID: repo, Model: model,
			NormEvent: norm, TS: float64(ts), Raw: raw, TokIn: 1})
	}
	add("a1", "artifact_version", "session-a", "alpha", "repo-a", "", "", now-1000)
	add("a2", "commit", "session-a", "beta", "repo-b", "", "", now-900)
	add("h1", "hook_event", "session-a", "alpha", "", "", "usage", now-800)
	add("u1", "hook_event", "session-a", "alpha", "", "model-a", "usage", now-700)
	add("u2", "hook_event", "session-a", "alpha", "", "model-a", "usage", now-600)
	add("u3", "hook_event", "session-a", "alpha", "", "model-a", "usage", now-500)
	add("u4", "hook_event", "session-a", "alpha", "", "model-b", "usage", now-400)
	add("h2", "hook_event", "session-b", "", "", "", "tool", now-300)
	if _, err := tn.Append(context.Background(), facts); err != nil {
		t.Fatal(err)
	}
	got, err := tn.SessionProvenanceFor(context.Background(), []string{"session-a", "session-b", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	a := got["session-a"]
	if a.Repo != "(multi)" || a.RepoAttribution != "multi" || len(a.Repos) != 2 || a.Model != "(mixed)" {
		t.Fatalf("session-a provenance = %+v", a)
	}
	if !a.HarnessMixed || a.Harness != "alpha" || len(a.Harnesses) != 2 {
		t.Fatalf("session-a harness = %+v", a)
	}
	if a.ModelShares["model-a"] != .6 || a.ModelShares["model-b"] != .2 {
		t.Fatalf("model shares = %v", a.ModelShares)
	}
	if got["session-b"].Repo != "(none)" || got["session-b"].Model != "(none)" || got["session-b"].Harness != "unknown" {
		t.Fatalf("session-b provenance = %+v", got["session-b"])
	}
	if got["missing"].Repo != "(none)" || got["missing"].Model != "(none)" {
		t.Fatalf("missing provenance = %+v", got["missing"])
	}
}

func TestSessionEntitiesPageSupportsEveryPublishedMeasureSort(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	base := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC).Unix()
	var facts []FactRow
	add := func(id, conv, model string, ts int64, tok int64) {
		raw, _ := json.Marshal(map[string]any{"type": "hook_event", "id": id})
		facts = append(facts, FactRow{RowHash: keys.ContentHash(raw), Type: "hook_event", ConversationID: conv, Harness: "h", Model: model, NormEvent: "usage", TS: float64(ts), TokIn: tok, TokOut: tok * 2, Raw: raw})
	}
	add("a1", "session-a", "model-a", base+1, 1)
	add("b1", "session-b", "model-a", base+2, 2)
	add("b2", "session-b", "model-b", base+3, 3)
	if _, err := tn.Append(context.Background(), facts); err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: time.Unix(base, 0).UTC(), To: time.Unix(base+10, 0).UTC()}
	for measure := range sessionSortMeasures {
		page, _, err := tn.SessionEntitiesPage(context.Background(), f, measure, true, nil, 1)
		if err != nil {
			t.Errorf("sort %s: %v", measure, err)
			continue
		}
		if len(page) != 1 {
			t.Errorf("sort %s page len=%d", measure, len(page))
		}
	}
	page, more, err := tn.SessionEntitiesPage(context.Background(), f, "model_calls", true, nil, 1)
	if err != nil || !more || len(page) != 1 || page[0].ID != "session-b" {
		t.Fatalf("model_calls sort page=%+v more=%v err=%v", page, more, err)
	}
	page2, more, err := tn.SessionEntitiesPage(context.Background(), f, "model_calls", true, &ConvCursor{TS: page[0].Measures["model_calls"], ConversationID: page[0].ID}, 1)
	if err != nil || more || len(page2) != 1 || page2[0].ID != "session-a" {
		t.Fatalf("model_calls cursor page=%+v more=%v err=%v", page2, more, err)
	}
}
