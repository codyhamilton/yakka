package serve

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func queryTenant(t *testing.T) (*Server, *tenantState) {
	t.Helper()
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	return s, ts
}

// qadd appends one fact with round-trippable raw JSON, as an uncompacted ledger holds.
func qadd(t *testing.T, ts *tenantState, f store.FactRow, payload fx) {
	t.Helper()
	if payload == nil {
		payload = fx{}
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
	if _, err := ts.t.Append(context.Background(), []store.FactRow{f}); err != nil {
		t.Fatal(err)
	}
}

func queryFixture(t *testing.T) (*Server, *tenantState) {
	t.Helper()
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	recent := float64(now.Add(-time.Hour).Unix())
	hook := func(conv, harness, repo, event, tool string, at float64) {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: conv, Harness: harness, RepoID: repo,
			Event: event, NormEvent: "tool_use", Tool: tool, TS: at}, nil)
	}
	hook("c1", "claude", "r1", "PreToolUse", "Read", recent)
	hook("c2", "claude", "r1", "PreToolUse", "Bash", recent)
	hook("c3", "cursor", "r2", "Stop", "", recent)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "cold", Harness: "claude", RepoID: "r1",
		Event: "commit", TS: float64(now.AddDate(0, 0, -40).Unix())}, nil)
	// A sub-day fact for the tz bucket boundary (23:30 UTC, outside the default window).
	hook("ctz", "claude", "r1", "PreToolUse", "Read", float64(time.Date(2026, 3, 10, 23, 30, 0, 0, time.UTC).Unix()))
	return s, ts
}

func TestAnalyticsSchema(t *testing.T) {
	s, _ := queryFixture(t)
	m := aok(t, s, "/v1/analytics/schema")
	if got := strs(m["buckets"]); !equalStrs(got, []string{"none", "hour", "day", "week", "month"}) {
		t.Errorf("buckets = %v", got)
	}
	// The design's measure × dimension matrix, verbatim; every measure also takes hour_of_day, weekday.
	design := []struct {
		name, unit string
		dims       []string
	}{
		{"hook_events", "count", []string{"harness", "repo_id", "norm_event", "event", "tool", "tool_kind", "conversation_id"}},
		{"conversations", "count", []string{"harness", "repo_id", "model"}},
		{"artifact_versions", "count", []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}},
		{"distinct_content", "count", []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}},
		{"commits", "count", []string{"harness", "repo_id", "conversation_id"}},
		{"rejections", "count", []string{"stage"}},
		{"model_calls", "count", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_in", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_out", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_cache_read", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_cache_write", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_reasoning", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"cost_usd", "usd", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"unpriced_calls", "count", []string{"harness", "repo_id", "model", "conversation_id"}},
	}
	got := rowsOf(m, "measures")
	if len(got) != len(design) {
		t.Fatalf("measures = %d, want %d", len(got), len(design))
	}
	for i, d := range design {
		if got[i]["name"] != d.name || got[i]["unit"] != d.unit {
			t.Errorf("measure %d = %v %v, want %s %s", i, got[i]["name"], got[i]["unit"], d.name, d.unit)
		}
		want := append(append([]string{}, d.dims...), "hour_of_day", "weekday")
		if g := strs(got[i]["dims"]); !equalStrs(g, want) {
			t.Errorf("%s dims = %v, want %v", d.name, g, want)
		}
	}
}

func equalStrs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestAnalyticsQuery(t *testing.T) {
	s, _ := queryFixture(t)
	A := "/v1/analytics/query?"
	rows := func(u string) []fx { return rowsOf(aok(t, s, A+u), "rows") }

	t.Run("dims", func(t *testing.T) {
		zero := rows("measure=hook_events&bucket=none")
		if len(zero) != 1 || len(strs(zero[0]["k"])) != 0 || zero[0]["v"] != 3.0 {
			t.Fatalf("0 dims: %v", zero)
		}
		one := rows("measure=hook_events&dim=harness&bucket=none")
		if len(one) != 2 {
			t.Fatalf("1 dim: %v", one)
		}
		two := rows("measure=hook_events&dim=harness&dim=tool&bucket=none")
		if len(two) != 3 {
			t.Fatalf("2 dims: %v", two)
		}
		for _, r := range two {
			if len(strs(r["k"])) != 2 {
				t.Errorf("2 dims key: %v", r["k"])
			}
		}
	})

	t.Run("errors", func(t *testing.T) {
		aerr(t, s, A, 400, "measure required")
		aerr(t, s, A+"measure=nope", 400, "unknown measure nope")
		aerr(t, s, A+"measure=hook_events&dim=harness&dim=tool&dim=repo_id", 400, "at most two dim")
		aerr(t, s, A+"measure=conversations&dim=tool", 400, "unsupported dimension tool for conversations")
		aerr(t, s, A+"measure=hook_events&tz=Not%2FAZone", 400, "invalid tz")
		aerr(t, s, A+"measure=model_calls&dim=tool", 400, "unsupported dimension tool for model_calls")
	})

	t.Run("ignored_filters", func(t *testing.T) {
		m := aok(t, s, A+"measure=hook_events&dim=harness&kind=design&bucket=none")
		if g := strs(m["ignored_filters"]); !equalStrs(g, []string{"kind"}) {
			t.Fatalf("ignored_filters = %v", g)
		}
	})

	t.Run("top", func(t *testing.T) {
		m := aok(t, s, A+"measure=hook_events&dim=tool&top=1&bucket=none")
		found := false
		for _, r := range rowsOf(m, "rows") {
			if k := strs(r["k"]); len(k) == 1 && k[0] == "__other__" {
				found = true
			}
		}
		if !found {
			t.Fatalf("top=1 rows: %v", m["rows"])
		}
	})

	t.Run("all", func(t *testing.T) {
		if got := rows("measure=commits&dim=repo_id&bucket=none"); len(got) != 0 {
			t.Fatalf("default window: %v", got)
		}
		got := rows("measure=commits&dim=repo_id&all=1&bucket=none")
		if len(got) != 1 || got[0]["v"] != 1.0 {
			t.Fatalf("all=1: %v", got)
		}
	})

	t.Run("tz", func(t *testing.T) {
		m := aok(t, s, A+"measure=hook_events&dim=harness&bucket=day&tz=Australia%2FSydney"+
			"&from=2026-03-10T00:00:00Z&to=2026-03-12T00:00:00Z")
		rs := rowsOf(m, "rows")
		if len(rs) != 1 {
			t.Fatalf("tz rows: %v", rs)
		}
		ts, _ := rs[0]["t"].(string)
		if !strings.Contains(ts, "2026-03-11") || !(strings.Contains(ts, "+11:00") || strings.Contains(ts, "+10:00")) {
			t.Fatalf("tz bucket t = %q", ts)
		}
	})

	t.Run("cap", func(t *testing.T) {
		from := time.Now().UTC().AddDate(0, 0, -31).Format(time.RFC3339)
		to := time.Now().UTC().Format(time.RFC3339)
		aerr(t, s, A+"measure=hook_events&dim=harness&bucket=hour&from="+from+"&to="+to, 400, "range too wide")
		aok(t, s, A+"measure=hook_events&dim=harness&bucket=day&from="+from+"&to="+to)
	})
}

func TestAnalyticsQueryPartial(t *testing.T) {
	s, ts := queryTenant(t)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c", Harness: "claude", RepoID: "r1", Event: "commit",
		TS: float64(time.Now().UTC().Add(-time.Hour).Unix())}, nil)
	u := "/v1/analytics/query?measure=commits&bucket=none"

	// A tenant opened on an empty ledger seeds compaction=complete; mark it uncompacted, then compact.
	if err := ts.t.SetMeta(context.Background(), "compaction", "required"); err != nil {
		t.Fatal(err)
	}
	code, m := aget(t, s, u)
	if code != 200 || m["partial"] != true {
		t.Fatalf("uncompacted: %d %v", code, m)
	}
	if err := ts.t.SetMeta(context.Background(), "compaction", "complete"); err != nil {
		t.Fatal(err)
	}
	code, m = aget(t, s, u)
	if code != 200 {
		t.Fatalf("compacted: %d %v", code, m)
	}
	if _, ok := m["partial"]; ok {
		t.Fatalf("partial present after compaction: %v", m)
	}
}

func TestAnalyticsFilterToolSummary(t *testing.T) {
	s, _ := queryFixture(t)
	aok(t, s, "/v1/analytics/summary?tool=Read")
}
