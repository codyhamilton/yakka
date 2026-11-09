package ingest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func secretText() string { return "AKIA" + "IOSFODNN7" + "EXAMPLE" }

func artifact(id, content string) map[string]any {
	return map[string]any{"id": id, "type": "artifact_version", "conversation_id": "c1", "harness": "h", "event": "write",
		"ts": 1.5, "repo_id": "r", "path": "docs/plans/01-x/DESIGN.md", "content": content,
		"content_hash": keys.ContentHash([]byte(content)), "source": "worktree"}
}

func marshal(t *testing.T, ms ...any) []json.RawMessage {
	var out []json.RawMessage
	for _, m := range ms {
		b, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, b)
	}
	return out
}

func open(t *testing.T) *store.Tenant {
	tn, err := store.Open(t.TempDir(), store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tn.Close() })
	return tn
}

func TestIngestBatchAndResend(t *testing.T) {
	tn := open(t)
	hook := map[string]any{"id": "q#0", "type": "hook_event", "conversation_id": "c1", "harness": "h", "event": "Stop", "ts": 1, "payload": map[string]any{"a": "b"}, "extra": 1}
	art := artifact("q#1", "# design\n")
	commit := map[string]any{"id": "q#2", "type": "commit", "conversation_id": "c1", "harness": "h", "event": "commit", "ts": 2,
		"repo_id": "r", "sha": "abc", "paths": []string{"a"}, "renames": []map[string]string{{"from": "a", "to": "b"}}}
	bad := map[string]any{"id": "q#3", "type": "hook_event", "conversation_id": "c1", "harness": "h", "event": "x", "ts": 3,
		"payload": map[string]any{"cmd": "line\nkey " + secretText()}}
	facts := marshal(t, hook, art, commit, bad)
	for round := 0; round < 2; round++ {
		res, err := Ingest(context.Background(), tn, facts)
		if err != nil {
			t.Fatal(err)
		}
		if len(res) != 4 {
			t.Fatalf("results %d", len(res))
		}
		want := Accepted
		if round == 1 {
			want = Duplicate
		}
		for i := 0; i < 3; i++ {
			if res[i].Status != want || res[i].ID != "q#"+string(rune('0'+i)) {
				t.Fatalf("round %d result %d: %+v", round, i, res[i])
			}
		}
		if res[3].Status != Rejected || !strings.HasPrefix(res[3].Reason, "precheck: ") || !strings.Contains(res[3].Reason, "payload.cmd line 2") || strings.Contains(res[3].Reason, secretText()) {
			t.Fatalf("round %d secret result: %+v", round, res[3])
		}
	}
	if pend, _ := tn.PendingHashes(); len(pend) != 1 {
		t.Fatalf("pending %v", pend)
	}
}

func TestIngestSecretInContent(t *testing.T) {
	tn := open(t)
	res, _ := Ingest(context.Background(), tn, marshal(t, artifact("x#0", "a\nb "+secretText()+"\n")))
	if res[0].Status != Rejected || !strings.HasSuffix(res[0].Reason, "at line 2") || strings.Contains(res[0].Reason, secretText()) {
		t.Fatalf("%+v", res[0])
	}
	if pend, _ := tn.PendingHashes(); len(pend) != 0 {
		t.Fatal("secret content reached pending")
	}
}

func TestIngestInvalid(t *testing.T) {
	tn := open(t)
	good := artifact("g#0", "ok")
	badHash := artifact("g#1", "ok2")
	badHash["content_hash"] = "deadbeef"
	noPath := artifact("g#2", "ok3")
	delete(noPath, "path")
	noConv := artifact("g#3", "ok4")
	noConv["conversation_id"] = ""
	noSha := map[string]any{"id": "g#4", "type": "commit", "conversation_id": "c", "repo_id": "r"}
	noRepo := map[string]any{"id": "g#5", "type": "commit", "conversation_id": "c", "sha": "s"}
	unk := map[string]any{"id": "g#6", "type": "bogus", "conversation_id": "c"}
	facts := marshal(t, good, badHash, noPath, noConv, noSha, noRepo, unk)
	facts = append(facts, json.RawMessage(`"str"`), json.RawMessage(`[1]`))
	res, err := Ingest(context.Background(), tn, facts)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].Status != Accepted {
		t.Fatalf("good: %+v", res[0])
	}
	for i := 1; i < len(res); i++ {
		if res[i].Status != Rejected || !strings.HasPrefix(res[i].Reason, "invalid:") {
			t.Fatalf("%d: %+v", i, res[i])
		}
	}
}

func TestPrecheckPaths(t *testing.T) {
	obj := map[string]any{"payload": map[string]any{"l": []any{"x", "k " + secretText()}}}
	r := Precheck(obj)
	if !strings.Contains(r, "payload.l[1] line 1") {
		t.Fatal(r)
	}
}

func TestIngestRejectsReviewRun(t *testing.T) {
	tn := open(t)
	review := map[string]any{"id": "r#0", "type": "review_run", "conversation_id": "review:abc", "repo_id": "repo",
		"kind": "phase", "capture_id": "abc", "status": "unavailable", "ts": 10}
	got, err := Ingest(context.Background(), tn, marshal(t, review))
	if err != nil || got[0].Status != Rejected || !strings.Contains(got[0].Reason, "server-authored") {
		t.Fatalf("public ingest review_run = %+v, %v", got, err)
	}
}

func TestReviewRunAcceptanceValidationAndIdempotency(t *testing.T) {
	tn := open(t)
	review := map[string]any{"id": "r#0", "type": "review_run", "conversation_id": "review:abc", "repo_id": "repo",
		"kind": "phase", "plan": "23-llm-review-shadow", "phase": 4, "capture_id": "abc", "status": "unavailable",
		"effective_effort": "high", "review_profile": "shadow", "ts": 10}
	good := marshal(t, review)
	first, err := IngestReviewRuns(context.Background(), tn, good)
	if err != nil || first[0].Status != Accepted {
		t.Fatalf("first ingest = %+v, %v", first, err)
	}
	second, err := IngestReviewRuns(context.Background(), tn, good)
	if err != nil || second[0].Status != Duplicate {
		t.Fatalf("duplicate ingest = %+v, %v", second, err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"repo":    func(m map[string]any) { delete(m, "repo_id") },
		"kind":    func(m map[string]any) { m["kind"] = "other" },
		"capture": func(m map[string]any) { delete(m, "capture_id") },
		"status":  func(m map[string]any) { m["status"] = "surprise" },
	} {
		bad := map[string]any{}
		for k, v := range review {
			bad[k] = v
		}
		bad["id"] = "bad-" + name
		mutate(bad)
		got, err := IngestReviewRuns(context.Background(), tn, marshal(t, bad))
		if err != nil || got[0].Status != Rejected || !strings.HasPrefix(got[0].Reason, "invalid:") {
			t.Fatalf("%s invalid review = %+v, %v", name, got, err)
		}
	}
	secret := map[string]any{}
	for k, v := range review {
		secret[k] = v
	}
	secret["id"], secret["attempts"] = "secret", []any{map[string]any{"error": "key " + secretText()}}
	got, err := IngestReviewRuns(context.Background(), tn, marshal(t, secret))
	if err != nil || got[0].Status != Rejected || !strings.HasPrefix(got[0].Reason, "precheck:") {
		t.Fatalf("secret review = %+v, %v", got, err)
	}
	rows, err := tn.ReviewRecords(context.Background(), store.ReviewRecordFilter{})
	if err != nil || len(rows) != 1 {
		t.Fatalf("stored review records = %d, %v", len(rows), err)
	}
	summary, err := tn.Summary(context.Background(), store.AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(20, 0)})
	if err != nil || summary.Conversations != 0 || summary.HookEvents != 0 || summary.ArtifactVersions != 0 {
		t.Fatalf("review_run altered summary: %+v, %v", summary, err)
	}
	facets, err := tn.Facets(context.Background(), store.AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(20, 0)})
	if err != nil || len(facets.Repos)+len(facets.Harnesses)+len(facets.Kinds)+len(facets.Plans)+len(facets.Events) != 0 {
		t.Fatalf("review_run altered facets: %+v, %v", facets, err)
	}
}

func usageFact(id string) map[string]any {
	return map[string]any{"id": id, "type": "review_usage", "usage_id": "usage-1",
		"configured_model": "claude-haiku-5-5", "returned_model": "claude-haiku-5-5-20261101",
		"configured_effort": "high", "requested_effort": "xhigh", "effective_effort": "xhigh",
		"input_tokens": 100, "output_tokens": 50, "cost_usd": 0.0018, "pricing_table_id": "table-1",
		"ts": 10.0, "tags": []string{"run:alpha"}, "store": false, "status": "ok",
		"attempts": []any{}, "reservation_outcome": "settled", "reservation_usd": 0.0018}
}

func TestReviewUsageAcceptanceValidationAndIsolation(t *testing.T) {
	tn := open(t)
	ctx := context.Background()
	public, err := Ingest(ctx, tn, marshal(t, usageFact("q#0")))
	if err != nil || public[0].Status != Rejected || !strings.Contains(public[0].Reason, "server-authored") {
		t.Fatalf("public ingest = %+v, %v", public, err)
	}
	first, err := IngestReviewUsage(ctx, tn, marshal(t, usageFact("q#0")))
	if err != nil || first[0].Status != Accepted {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := IngestReviewUsage(ctx, tn, marshal(t, usageFact("q#1")))
	if err != nil || second[0].Status != Duplicate {
		t.Fatalf("duplicate = %+v, %v", second, err)
	}
	bad := usageFact("q#2")
	bad["repo_id"] = "repo"
	if got, err := IngestReviewUsage(ctx, tn, marshal(t, bad)); err != nil || got[0].Status != Rejected || !strings.Contains(got[0].Reason, "must not contain repo_id") {
		t.Fatalf("forbidden key = %+v, %v", got, err)
	}
	badStore := usageFact("q#3")
	badStore["store"] = true
	if got, err := IngestReviewUsage(ctx, tn, marshal(t, badStore)); err != nil || got[0].Status != Rejected {
		t.Fatalf("store=true = %+v, %v", got, err)
	}
	if rows, err := tn.ReviewUsageRecords(ctx); err != nil || len(rows) != 1 {
		t.Fatalf("usage rows=%d err=%v", len(rows), err)
	}
	if reviews, err := tn.ReviewRecords(ctx, store.ReviewRecordFilter{Limit: 10}); err != nil || len(reviews) != 0 {
		t.Fatalf("review rows=%d err=%v", len(reviews), err)
	}
	window := store.AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(20, 0)}
	summary, err := tn.Summary(ctx, window)
	if err != nil || summary.Conversations != 0 || summary.HookEvents != 0 || summary.ArtifactVersions != 0 {
		t.Fatalf("summary=%+v err=%v", summary, err)
	}
	facets, err := tn.Facets(ctx, window)
	if err != nil || len(facets.Repos)+len(facets.Harnesses)+len(facets.Kinds)+len(facets.Plans)+len(facets.Events) != 0 {
		t.Fatalf("facets=%+v err=%v", facets, err)
	}
}
