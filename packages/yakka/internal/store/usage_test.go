package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func ufact(n int, harness, model, conv, raw string, ts time.Time, in, out, cr, cw, reas int64, cost *float64) FactRow {
	return FactRow{
		RowHash: keys.ContentHash([]byte(raw)), Type: "hook_event",
		ConversationID: conv, Harness: harness, Event: "transcript.assistant_message",
		TS: float64(ts.Unix()), RepoID: "repoA", Raw: []byte(raw), NormEvent: "usage", Model: model,
		TokIn: in, TokOut: out, TokCacheRead: cr, TokCacheWrite: cw, TokReasoning: reas,
		CostReported: cost,
	}
}

// usageFixture is one conversation of four usage facts (a two-row Claude pair, Codex, OpenCode).
func usageFixture(t *testing.T) *Tenant {
	t.Helper()
	tn := openT(t, Options{})
	reported := 0.25
	rows := []FactRow{
		// Claude pair: same conversation and backfill.ref msg-A, tok_out 10 then 40. The model is
		// not in pricing_table.json and no cost is reported, so the single kept call is unpriced.
		ufact(1, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"msg-A"},"n":1}`, aFrom, 0, 10, 0, 0, 0, nil),
		ufact(2, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"msg-A"},"n":2}`, aFrom, 0, 40, 0, 0, 0, nil),
		// Codex: input_tokens include cached input, so fresh = 1000-400 = 600; kimi-k2.5 rates
		// are input 0.6 and cache_read 0.1, giving (600*0.6 + 400*0.1)/1e6 = 0.0004.
		ufact(3, "codex", "kimi-k2.5", "c1", `{"n":3}`, aFrom, 1000, 0, 400, 0, 0, nil),
		// OpenCode: a reported cost of 0.25 passes through unchanged.
		ufact(4, "opencode", "grok-4.5", "c1", `{"n":4}`, aFrom, 0, 0, 0, 0, 0, &reported),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn
}

func usageFilter() AnalyticsFilter { return AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo} }

func TestUsageMeasures(t *testing.T) {
	ctx := context.Background()
	tn := usageFixture(t)
	f := usageFilter()
	q := func(measure string) QueryResult {
		t.Helper()
		r, err := tn.Query(ctx, f, QueryParams{Measure: measure})
		if err != nil {
			t.Fatalf("%s: %v", measure, err)
		}
		return r
	}
	// The two Claude rows (msg-A) count once, plus Codex and OpenCode: 1+1+1 = 3.
	if got := q("model_calls").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 3}}) {
		t.Fatalf("model_calls: %#v", got)
	}
	// The kept Claude row has tok_out 40, not 10+40=50; Codex and OpenCode report no output.
	if got := q("tokens_out").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 40}}) {
		t.Fatalf("tokens_out: %#v", got)
	}
	// Codex 1000; Claude and OpenCode report none.
	if got := q("tokens_in").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 1000}}) {
		t.Fatalf("tokens_in: %#v", got)
	}
	// Codex 400.
	if got := q("tokens_cache_read").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 400}}) {
		t.Fatalf("tokens_cache_read: %#v", got)
	}
	// Codex 0.0004 + OpenCode 0.25 = 0.2504 (Claude is unpriced, adds 0).
	if got := q("cost_usd").Rows; len(got) != 1 || math.Abs(got[0].V-0.2504) > 1e-9 {
		t.Fatalf("cost_usd: %#v", got)
	}
	// Only the kept Claude call (unknown model, no reported cost) is unpriced: 1.
	if got := q("unpriced_calls").Rows; !reflect.DeepEqual(got, []QueryRow{{K: []string{}, V: 1}}) {
		t.Fatalf("unpriced_calls: %#v", got)
	}
}

func TestUsageGroupByHarnessAndModel(t *testing.T) {
	ctx := context.Background()
	tn := usageFixture(t)
	r, err := tn.Query(ctx, usageFilter(), QueryParams{Measure: "model_calls", Dims: []string{"harness", "model"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []QueryRow{
		{K: []string{"claude", "claude-test-unpriced"}, V: 1},
		{K: []string{"codex", "kimi-k2.5"}, V: 1},
		{K: []string{"opencode", "grok-4.5"}, V: 1},
	}
	if !reflect.DeepEqual(r.Rows, want) {
		t.Fatalf("group: got %#v want %#v", r.Rows, want)
	}
}

func TestUsageActionDimensionJoinsProjectedSegment(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	action := appendAction(t, tn, "action", "tagged", "env", "build", "owner/repo:plan/22-session-work-tagging", "3", float64(aFrom.Unix()))
	if err := tn.ProjectAction(ctx, action); err != nil {
		t.Fatal(err)
	}
	call := ufact(1, "codex", "kimi-k2.5", "tagged", `{"call":1}`, aFrom, 1000, 0, 400, 0, 0, nil)
	if _, err := tn.Append(ctx, []FactRow{call}); err != nil {
		t.Fatal(err)
	}
	r, err := tn.Query(ctx, usageFilter(), QueryParams{Measure: "cost_usd", Dims: []string{"action_kind"}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.Rows, []QueryRow{{K: []string{"build"}, V: 0.0004}}) {
		t.Fatalf("action cost: %#v", r.Rows)
	}
}

func TestUsageActionCostBucketsAndSessions(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	addAction := func(id, conv, kind, phase string, ts time.Time) {
		t.Helper()
		h := appendAction(t, tn, id, conv, "env", kind, "owner/repo:plan/22-session-work-tagging", phase, float64(ts.Unix()))
		if err := tn.ProjectAction(ctx, h); err != nil {
			t.Fatal(err)
		}
	}
	// The rejected action at t1 must not end build. The call exactly at t2 belongs to review.
	t0, t1, t2 := aFrom, aFrom.Add(time.Minute), aFrom.Add(2*time.Minute)
	addAction("switch-build", "switch", "build", "1", t0)
	bad := appendAction(t, tn, "switch-rejected", "switch", "env", "bogus", "owner/repo:plan/22-session-work-tagging", "2", float64(t1.Unix()))
	if err := tn.ProjectAction(ctx, bad); err != nil {
		t.Fatal(err)
	}
	addAction("switch-review", "switch", "review", "2", t2)
	addAction("fix", "fix", "fix", "3", t0)
	addAction("unpriced", "unpriced", "build", "1", t0)
	githubRaw, err := json.Marshal(map[string]any{"type": "session_action", "conversation_id": "github", "harness": "codex", "ts": float64(t0.Unix()), "source": "env", "action": map[string]string{"kind": "build", "subject_type": "github", "subject_id": "owner/repo#7"}})
	if err != nil {
		t.Fatal(err)
	}
	githubHash, err := keys.RowHash(githubRaw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tn.Append(ctx, []FactRow{{RowHash: githubHash, Type: "session_action", ConversationID: "github", Harness: "codex", TS: float64(t0.Unix()), Raw: githubRaw}}); err != nil {
		t.Fatal(err)
	}
	if err := tn.ProjectAction(ctx, githubHash); err != nil {
		t.Fatal(err)
	}
	badOnly := appendAction(t, tn, "rejected-only", "rejected", "env", "bogus", "owner/repo:plan/22-session-work-tagging", "1", float64(t0.Unix()))
	if err := tn.ProjectAction(ctx, badOnly); err != nil {
		t.Fatal(err)
	}
	rows := []FactRow{
		ufact(1, "codex", "kimi-k2.5", "switch", `{"n":1}`, t0, 1000, 0, 400, 0, 0, nil),
		ufact(2, "codex", "kimi-k2.5", "switch", `{"n":2}`, t1, 1000, 0, 400, 0, 0, nil),
		ufact(3, "codex", "kimi-k2.5", "switch", `{"n":3}`, t2, 1000, 0, 400, 0, 0, nil),
		ufact(4, "codex", "kimi-k2.5", "fix", `{"n":4}`, t0, 1000, 0, 400, 0, 0, nil),
		ufact(5, "codex", "kimi-k2.5", "untagged", `{"n":5}`, t0, 1000, 0, 400, 0, 0, nil),
		ufact(6, "codex", "kimi-k2.5", "rejected", `{"n":6}`, t0, 1000, 0, 400, 0, 0, nil),
		ufact(7, "codex", "not-priced", "unpriced", `{"n":7}`, t0, 0, 0, 0, 0, 0, nil),
		ufact(8, "codex", "kimi-k2.5", "github", `{"n":8}`, t0, 1000, 0, 400, 0, 0, nil),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	f := usageFilter()
	query := func(p QueryParams) QueryResult {
		t.Helper()
		r, err := tn.Query(ctx, f, p)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	all := query(QueryParams{Measure: "cost_usd"})
	if len(all.Rows) != 1 || math.Abs(all.Rows[0].V-0.0028) > 1e-12 {
		t.Fatalf("total cost: %#v", all.Rows)
	}
	byAction := query(QueryParams{Measure: "cost_usd", Dims: []string{"action_plan", "action_phase", "action_kind"}})
	var sum float64
	got := map[string]float64{}
	missingValueBucket := false
	for _, row := range byAction.Rows {
		sum += row.V
		got[row.K[2]] += row.V
		if row.K[0] == "(none)" && row.K[1] == "(none)" && row.K[2] == "build" && row.V == 0.0004 {
			missingValueBucket = true
		}
	}
	if math.Abs(sum-all.Rows[0].V) > 1e-12 {
		t.Fatalf("bucket sum %.12f != total %.12f: %#v", sum, all.Rows[0].V, byAction.Rows)
	}
	if math.Abs(got["build"]-0.0012) > 1e-12 || got["review"] != 0.0004 || got["fix"] != 0.0004 || got["(untagged)"] != 0.0004 || got["(rejected)"] != 0.0004 || !missingValueBucket {
		t.Fatalf("timestamp/special buckets: %#v rows=%#v missing=%v", got, byAction.Rows, missingValueBucket)
	}
	plan := query(QueryParams{Measure: "cost_usd", Dims: []string{"action_plan"}, ActionPlans: []string{"22-session-work-tagging"}})
	var planCost float64
	for _, row := range plan.Rows {
		if row.K[0] == "22-session-work-tagging" {
			planCost += row.V
		}
		if row.K[0] == "(untagged)" || row.K[0] == "(rejected)" {
			t.Fatalf("special bucket survived action filter: %#v", plan.Rows)
		}
	}
	if math.Abs(planCost-0.0016) > 1e-12 {
		t.Fatalf("filtered plan cost: %#v", plan.Rows)
	}
	folded := query(QueryParams{Measure: "cost_usd", Dims: []string{"action_plan"}, Top: 1})
	var foldedSum float64
	seen := map[string]bool{}
	for _, row := range folded.Rows {
		foldedSum += row.V
		seen[row.K[0]] = true
	}
	if !seen["(untagged)"] || !seen["(rejected)"] || math.Abs(foldedSum-all.Rows[0].V) > 1e-12 {
		t.Fatalf("top-N special buckets: %#v", folded.Rows)
	}
	unpriced := query(QueryParams{Measure: "unpriced_calls", Dims: []string{"action_kind"}})
	if len(unpriced.Rows) == 0 {
		t.Fatal("no action buckets for unpriced_calls")
	}
	var buildUnpriced float64
	for _, row := range unpriced.Rows {
		if row.K[0] == "build" {
			buildUnpriced = row.V
		}
	}
	if buildUnpriced != 1 {
		t.Fatalf("unpriced build bucket: %#v", unpriced.Rows)
	}
	sessions := query(QueryParams{Measure: "sessions", Dims: []string{"action_kind"}})
	sessionCounts := map[string]float64{}
	for _, row := range sessions.Rows {
		sessionCounts[row.K[0]] = row.V
	}
	if sessionCounts["build"] != 3 || sessionCounts["review"] != 1 || sessionCounts["fix"] != 1 || sessionCounts["(untagged)"] != 1 || sessionCounts["(rejected)"] != 1 {
		t.Fatalf("distinct sessions by bucket: %#v", sessionCounts)
	}
	if _, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", ActionKinds: []string{"build"}}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unsupported action filter error = %v", err)
	}
}

func TestUsageClaudeDedupeKeepsLargestOut(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	// Same conversation and id, different tok_out; only the 40-output row survives, so
	// tokens_out is 40 (not 50) and model_calls is 1.
	rows := []FactRow{
		ufact(1, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"m"},"n":1}`, aFrom, 0, 10, 0, 0, 0, nil),
		ufact(2, "claude", "claude-test-unpriced", "c1", `{"backfill":{"ref":"m"},"n":2}`, aFrom, 0, 40, 0, 0, 0, nil),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo}
	calls, err := tn.Query(ctx, f, QueryParams{Measure: "model_calls"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(calls.Rows, []QueryRow{{K: []string{}, V: 1}}) {
		t.Fatalf("model_calls: %#v", calls.Rows)
	}
	outTok, err := tn.Query(ctx, f, QueryParams{Measure: "tokens_out"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(outTok.Rows, []QueryRow{{K: []string{}, V: 40}}) {
		t.Fatalf("tokens_out: %#v", outTok.Rows)
	}
}

func TestUsageLiveClaudeWithoutIdIsNotDeduped(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	// Live-captured Claude facts carry no id in the stored envelope, so each is its own call.
	rows := []FactRow{
		ufact(1, "claude", "claude-test-unpriced", "c1", `{"n":1}`, aFrom, 0, 10, 0, 0, 0, nil),
		ufact(2, "claude", "claude-test-unpriced", "c1", `{"n":2}`, aFrom, 0, 40, 0, 0, 0, nil),
	}
	if _, err := tn.Append(ctx, rows); err != nil {
		t.Fatal(err)
	}
	r, err := tn.Query(ctx, AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo}, QueryParams{Measure: "model_calls"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.Rows, []QueryRow{{K: []string{}, V: 2}}) {
		t.Fatalf("model_calls: %#v", r.Rows)
	}
}

// TestUsageIndexDrivesUsageRead: the usage CTE must be served by facts_usage_ts, not a walk of
// facts_conv_page over every base row, and the index must be created on open.
func TestUsageIndexDrivesUsageRead(t *testing.T) {
	tn := usageFixture(t)
	var n int
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name='facts_usage_ts'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("facts_usage_ts present = %d, err %v", n, err)
	}
	cte, args := usageRowsWhere(AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(4e9, 0)})
	rs, err := tn.rdb.Query("EXPLAIN QUERY PLAN "+cte+" SELECT harness FROM kept", args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var plan string
	for rs.Next() {
		var a, b, c int
		var d string
		if err := rs.Scan(&a, &b, &c, &d); err != nil {
			t.Fatal(err)
		}
		plan += d + "\n"
	}
	if !strings.Contains(plan, "facts_usage_ts") {
		t.Fatalf("usage CTE does not use facts_usage_ts:\n%s", plan)
	}
}
