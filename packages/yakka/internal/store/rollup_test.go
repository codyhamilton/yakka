package store

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"
	_ "time/tzdata"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

// hook rolls up one hook_event fact at second ts.
func hook(i int, ts int64, harness, repo, norm, event, tool, conv string) FactRow {
	raw := []byte(fmt.Sprintf(`{"rollup":%d}`, i))
	return FactRow{RowHash: keys.ContentHash(raw), Type: "hook_event", ConversationID: conv,
		Harness: harness, Event: event, NormEvent: norm, Tool: tool, RepoID: repo, TS: float64(ts), Raw: raw}
}

func rollupFixture(t *testing.T) (*Tenant, []FactRow, int64) {
	t.Helper()
	return rollupFixtureOn(t, openT(t, Options{}))
}

// baseHookAgg is the base-row oracle: counts by one dimension over [from,to], dim "" for total.
func baseHookAgg(t *testing.T, tn *Tenant, from, to int64, dim string) map[string]float64 {
	t.Helper()
	sel := "''"
	if dim != "" {
		if dim == "tool_kind" {
			sel = toolKindExpr
		} else {
			sel = dim
		}
	}
	q := "SELECT " + sel + " AS k, count(*) FROM facts WHERE type='hook_event' AND ts>=? AND ts<=? GROUP BY k"
	rows, err := tn.rdb.Query(q, float64(from), float64(to))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]float64{}
	if dim == "" {
		out[""] = 0 // an ungrouped count is 0, not absent, over an empty window
	}
	for rows.Next() {
		var k string
		var v float64
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatal(err)
		}
		out[k] = v
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func queryHookAgg(t *testing.T, tn *Tenant, from, to int64, dim string) map[string]float64 {
	t.Helper()
	var dims []string
	if dim != "" {
		dims = []string{dim}
	}
	res, err := tn.Query(context.Background(),
		AnalyticsFilter{From: time.Unix(from, 0).UTC(), To: time.Unix(to, 0).UTC()},
		QueryParams{Measure: "hook_events", Dims: dims, Top: 100})
	if err != nil {
		t.Fatalf("query from=%d to=%d dim=%q: %v", from, to, dim, err)
	}
	out := map[string]float64{}
	for _, r := range res.Rows {
		k := ""
		if dim != "" {
			k = r.K[0]
		}
		out[k] = r.V
	}
	return out
}

// TestRollupEqualsBaseRows drives the rolled-up read path over windows that start and end mid-hour
// and compares it, dimension by dimension, with an aggregate over base rows alone.
func TestRollupEqualsBaseRows(t *testing.T) {
	tn, _, base := rollupFixture(t)
	windows := []struct {
		name     string
		from, to int64
	}{
		{"whole hours", base, base + 3*3600 + 3599},
		{"mid start", base + 1800, base + 3*3600 + 1800},
		{"mid end", base, base + 2*3600 + 1800},
		{"single hour mid", base + 3600 + 600, base + 3600 + 3000},
		{"exact hour edges", base + 3600, base + 2*3600},
		{"one second in", base + 1, base + 3600 - 1},
		{"all", 0, base + 10*3600},
	}
	dims := []string{"", "harness", "repo_id", "norm_event", "event", "tool", "tool_kind", "conversation_id"}
	for _, w := range windows {
		for _, d := range dims {
			want := baseHookAgg(t, tn, w.from, w.to, d)
			got := queryHookAgg(t, tn, w.from, w.to, d)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("window %q dim %q: rollup %v != base %v", w.name, d, got, want)
			}
		}
	}
}

// TestRollupEqualsBaseSQL asserts the rollup table is exactly the base aggregate, in both
// directions, so no tuple is missing or double-counted.
func TestRollupEqualsBaseSQL(t *testing.T) {
	tn, _, _ := rollupFixture(t)
	sel := `SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, norm_event, event, tool, conversation_id, count(*)
		FROM facts WHERE type='hook_event' GROUP BY 1,2,3,4,5,6,7`
	var diff int
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (
		SELECT hour,harness,repo_id,norm_event,event,tool,conversation_id,n FROM hook_events_hourly
		EXCEPT ` + sel + `)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("rollup has %d tuples not in the base aggregate", diff)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (` + sel + `
		EXCEPT SELECT hour,harness,repo_id,norm_event,event,tool,conversation_id,n FROM hook_events_hourly)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("base aggregate has %d tuples not in the rollup", diff)
	}
}

// TestRollupDuplicateAppend: re-appending the same facts (identical row hashes) inserts no row, so
// it must leave both the base aggregate and the rollup unchanged.
func TestRollupDuplicateAppend(t *testing.T) {
	tn, rows, base := rollupFixture(t)
	before := queryHookAgg(t, tn, base, base+3*3600+3599, "tool")
	ins, err := tn.Append(context.Background(), rows)
	if err != nil {
		t.Fatal(err)
	}
	for i, ok := range ins {
		if ok {
			t.Fatalf("duplicate row %d reported inserted", i)
		}
	}
	after := queryHookAgg(t, tn, base, base+3*3600+3599, "tool")
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("duplicate append changed counts: %v -> %v", before, after)
	}
	// The total rollup weight must still equal the base row count.
	var rollupN, baseN int
	if err := tn.rdb.QueryRow(`SELECT sum(n) FROM hook_events_hourly`).Scan(&rollupN); err != nil {
		t.Fatal(err)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM facts WHERE type='hook_event'`).Scan(&baseN); err != nil {
		t.Fatal(err)
	}
	if rollupN != baseN || baseN != len(rows) {
		t.Fatalf("rollup sum %d, base %d, fixture %d", rollupN, baseN, len(rows))
	}
}

// TestRollupBackfilledOnMigrate rewinds the ledger to before the rollup table (migration 6) and
// reopens it, asserting the open-time backfill refills the rollup from base rows.
func TestRollupBackfilledOnMigrate(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tenant")
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	_, rows, base := rollupFixtureOn(t, tn)
	if err := tn.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "ledger.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM hook_events_hourly`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 5`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	tn2, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tn2.Close() })
	var n int
	if err := tn2.rdb.QueryRow(`SELECT count(*) FROM hook_events_hourly`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("migration did not refill the rollup")
	}
	got := queryHookAgg(t, tn2, base, base+3*3600+3599, "harness")
	want := baseHookAgg(t, tn2, base, base+3*3600+3599, "harness")
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("after refill: rollup %v != base %v", got, want)
	}
	if len(rows) == 0 {
		t.Fatal("fixture empty")
	}
}

// assertHookRollupExactBothWays asserts hook_events_hourly is exactly the base hook_event
// aggregate, in both directions, so no tuple is missing or double-counted.
func assertHookRollupExactBothWays(t *testing.T, tn *Tenant) {
	t.Helper()
	rollup := `SELECT hour,harness,repo_id,norm_event,event,tool,conversation_id,n FROM hook_events_hourly`
	base := `SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, norm_event, event, tool, conversation_id, count(*)
		FROM facts WHERE type='hook_event' GROUP BY 1,2,3,4,5,6,7`
	exceptBothWays(t, tn, rollup, base, "hook_events")
}

// assertConvRollupExactBothWays asserts conversations_hourly is exactly the base-row aggregate, in
// both directions, so no tuple is missing or double-counted.
func assertConvRollupExactBothWays(t *testing.T, tn *Tenant) {
	t.Helper()
	rollup := `SELECT hour,harness,repo_id,model,conversation_id,n FROM conversations_hourly`
	base := `SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, model, conversation_id, count(*)
		FROM facts GROUP BY 1,2,3,4,5`
	exceptBothWays(t, tn, rollup, base, "conversations")
}

// facetBaseAggregate mirrors facetRollupFill exactly: 8 UNION ALL branches producing (dim, hour,
// value, count(*)) for every dimension, the tool branch restricted to hook_event.
const facetBaseAggregate = `SELECT 'repo_id', CAST(ts/3600 AS INTEGER)*3600, repo_id, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'harness', CAST(ts/3600 AS INTEGER)*3600, harness, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'plan', CAST(ts/3600 AS INTEGER)*3600, plan, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'event', CAST(ts/3600 AS INTEGER)*3600, event, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'model', CAST(ts/3600 AS INTEGER)*3600, model, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'norm_event', CAST(ts/3600 AS INTEGER)*3600, norm_event, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'kind', CAST(ts/3600 AS INTEGER)*3600, kind, count(*) FROM facts GROUP BY 2,3
	UNION ALL SELECT 'tool', CAST(ts/3600 AS INTEGER)*3600, tool, count(*) FROM facts WHERE type='hook_event' GROUP BY 2,3`

// assertFacetRollupExactBothWays asserts facets_hourly is exactly the base-row aggregate, in both
// directions, so no tuple is missing or double-counted.
func assertFacetRollupExactBothWays(t *testing.T, tn *Tenant) {
	t.Helper()
	exceptBothWays(t, tn, `SELECT dim,hour,value,n FROM facets_hourly`, facetBaseAggregate, "facets")
}

// exceptBothWays asserts two row sets (rollup rows and base aggregate rows) are identical in both
// directions, naming name in the failure.
func exceptBothWays(t *testing.T, tn *Tenant, rollupSel, baseSel, name string) {
	t.Helper()
	var diff int
	sub := func(s string) string { return "SELECT * FROM (" + s + ")" }
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (` + sub(rollupSel) + ` EXCEPT ` + sub(baseSel) + `)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("%s rollup has %d tuples not in the base aggregate", name, diff)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (` + sub(baseSel) + ` EXCEPT ` + sub(rollupSel) + `)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("%s base aggregate has %d tuples not in the rollup", name, diff)
	}
}

// TestRebuildConversationRollup changes base rows behind the conversations rollup's back the way
// compaction does, then asserts the exported rebuild makes the table the base aggregate again in
// both directions.
func TestRebuildConversationRollup(t *testing.T) {
	tn, _, _ := convRollupFixture(t)
	if _, err := tn.wdb.Exec(`DELETE FROM facts WHERE harness='codex'`); err != nil {
		t.Fatal(err)
	}
	if err := tn.RebuildConversationRollup(context.Background()); err != nil {
		t.Fatalf("RebuildConversationRollup: %v", err)
	}
	assertConvRollupExactBothWays(t, tn)
}

// TestRebuildFacetRollup changes base rows behind the facets rollup's back the way compaction does,
// then asserts the exported rebuild makes the table the base aggregate again in both directions.
func TestRebuildFacetRollup(t *testing.T) {
	tn, _, _ := facetFixture(t)
	if _, err := tn.wdb.Exec(`DELETE FROM facts WHERE harness='codex'`); err != nil {
		t.Fatal(err)
	}
	if err := tn.RebuildFacetRollup(context.Background()); err != nil {
		t.Fatalf("RebuildFacetRollup: %v", err)
	}
	assertFacetRollupExactBothWays(t, tn)
}

// TestRebuildRollups changes base rows behind every rollup's back, then asserts the single
// RebuildRollups entry point makes all three tables the base aggregate again in both directions.
func TestRebuildRollups(t *testing.T) {
	tn, _, _ := facetFixture(t)
	if _, err := tn.wdb.Exec(`DELETE FROM facts WHERE harness='codex'`); err != nil {
		t.Fatal(err)
	}
	if err := tn.RebuildRollups(context.Background()); err != nil {
		t.Fatalf("RebuildRollups: %v", err)
	}
	assertHookRollupExactBothWays(t, tn)
	assertConvRollupExactBothWays(t, tn)
	assertFacetRollupExactBothWays(t, tn)
}

// TestRebuildHookRollup changes base rows behind the rollup's back the way compaction does, then
// asserts the exported rebuild makes the table the base aggregate again in both directions.
func TestRebuildHookRollup(t *testing.T) {
	tn, _, _ := rollupFixture(t)
	if _, err := tn.wdb.Exec(`DELETE FROM facts WHERE type='hook_event' AND event='Stop'`); err != nil {
		t.Fatal(err)
	}
	if err := tn.RebuildHookRollup(context.Background()); err != nil {
		t.Fatalf("RebuildHookRollup: %v", err)
	}
	sel := `SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, norm_event, event, tool, conversation_id, count(*)
		FROM facts WHERE type='hook_event' GROUP BY 1,2,3,4,5,6,7`
	var diff int
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (
		SELECT hour,harness,repo_id,norm_event,event,tool,conversation_id,n FROM hook_events_hourly
		EXCEPT ` + sel + `)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("rollup has %d tuples not in the base aggregate", diff)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (` + sel + `
		EXCEPT SELECT hour,harness,repo_id,norm_event,event,tool,conversation_id,n FROM hook_events_hourly)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("base aggregate has %d tuples not in the rollup", diff)
	}
}

// convFact builds a fact of any type at second ts for the conversations-rollup tests.
func convFact(i int, ts int64, typ, harness, repo, model, conv string) FactRow {
	raw := []byte(fmt.Sprintf(`{"conv":%d}`, i))
	return FactRow{RowHash: keys.ContentHash(raw), Type: typ, ConversationID: conv,
		Harness: harness, RepoID: repo, Model: model, TS: float64(ts), Raw: raw}
}

// convRollupFixture plants facts of every type the conversations measure counts, reusing
// conversations across hours so DISTINCT is exercised.
func convRollupFixture(t *testing.T) (*Tenant, []FactRow, int64) {
	t.Helper()
	tn := openT(t, Options{})
	base := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC).Unix()
	rows := []FactRow{
		convFact(1, base+15*60, "hook_event", "claude", "r1", "m1", "c1"),
		convFact(2, base+45*60, "hook_event", "codex", "r1", "m2", "c2"),
		convFact(3, base+50*60, "artifact_version", "claude", "r2", "m1", "c1"),
		convFact(4, base+3600+5*60, "hook_event", "claude", "r2", "m1", "c1"),
		convFact(5, base+3600+59*60, "commit", "claude", "r1", "m3", "c3"),
		convFact(6, base+2*3600, "hook_event", "codex", "r2", "m2", "c1"),
		convFact(7, base+2*3600+30*60, "artifact_version", "claude", "r1", "m1", "c2"),
		convFact(8, base+3*3600+10*60, "hook_event", "codex", "r1", "m2", "c4"),
		convFact(9, base+3*3600+40*60, "commit", "claude", "r2", "m3", "c1"),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn, rows, base
}

// baseConvAgg is the base-row oracle: distinct conversation_id by one dimension over [from,to],
// dim "" for the total, time dims via strftime. It counts a conversation once per dimension value.
func baseConvAgg(t *testing.T, tn *Tenant, from, to int64, dim string) map[string]float64 {
	t.Helper()
	var sel string
	switch dim {
	case "":
		sel = "''"
	case "hour_of_day":
		sel = "strftime('%H', ts, 'unixepoch')"
	case "weekday":
		sel = "strftime('%w', ts, 'unixepoch')"
	default:
		sel = dim
	}
	q := "SELECT " + sel + " AS k, count(DISTINCT conversation_id) FROM facts WHERE ts>=? AND ts<=? GROUP BY k"
	rows, err := tn.rdb.Query(q, float64(from), float64(to))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]float64{}
	if dim == "" {
		out[""] = 0 // an ungrouped distinct count is 0, not absent, over an empty window
	}
	for rows.Next() {
		var k string
		var v float64
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatal(err)
		}
		out[k] = v
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func queryConvAgg(t *testing.T, tn *Tenant, from, to int64, dim string) map[string]float64 {
	t.Helper()
	var dims []string
	if dim != "" {
		dims = []string{dim}
	}
	res, err := tn.Query(context.Background(),
		AnalyticsFilter{From: time.Unix(from, 0).UTC(), To: time.Unix(to, 0).UTC()},
		QueryParams{Measure: "conversations", Dims: dims, Top: 100})
	if err != nil {
		t.Fatalf("query from=%d to=%d dim=%q: %v", from, to, dim, err)
	}
	out := map[string]float64{}
	for _, r := range res.Rows {
		k := ""
		if dim != "" {
			k = r.K[0]
		}
		out[k] = r.V
	}
	return out
}

// TestConversationRollupEqualsBaseRows drives the distinct-rollup read path over windows that start
// and end mid-hour and compares it, dimension by dimension, with an aggregate over base rows alone.
func TestConversationRollupEqualsBaseRows(t *testing.T) {
	tn, _, base := convRollupFixture(t)
	windows := []struct {
		name     string
		from, to int64
	}{
		{"whole hours", base, base + 3*3600 + 3599},
		{"mid start", base + 1800, base + 3*3600 + 1800},
		{"mid end", base, base + 2*3600 + 1800},
		{"single hour mid", base + 3600 + 600, base + 3600 + 3000},
		{"exact hour edges", base + 3600, base + 2*3600},
		{"one second in", base + 1, base + 3600 - 1},
		{"all", 0, base + 10*3600},
	}
	dims := []string{"", "harness", "repo_id", "model", "hour_of_day", "weekday"}
	for _, w := range windows {
		for _, d := range dims {
			want := baseConvAgg(t, tn, w.from, w.to, d)
			got := queryConvAgg(t, tn, w.from, w.to, d)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("window %q dim %q: rollup %v != base %v", w.name, d, got, want)
			}
		}
	}
}

// TestConversationRollupEqualsBaseSQL asserts the conversations rollup is exactly the base
// aggregate, in both directions, so no tuple is missing or double-counted.
func TestConversationRollupEqualsBaseSQL(t *testing.T) {
	tn, _, _ := convRollupFixture(t)
	sel := `SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, model, conversation_id, count(*)
		FROM facts GROUP BY 1,2,3,4,5`
	var diff int
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (
		SELECT hour,harness,repo_id,model,conversation_id,n FROM conversations_hourly
		EXCEPT ` + sel + `)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("rollup has %d tuples not in the base aggregate", diff)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM (` + sel + `
		EXCEPT SELECT hour,harness,repo_id,model,conversation_id,n FROM conversations_hourly)`).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	if diff != 0 {
		t.Fatalf("base aggregate has %d tuples not in the rollup", diff)
	}
}

// TestConversationRollupDuplicateAppend: re-appending the same facts (identical row hashes) inserts
// no row, so it must leave both the base aggregate and the conversations rollup unchanged.
func TestConversationRollupDuplicateAppend(t *testing.T) {
	tn, rows, base := convRollupFixture(t)
	before := queryConvAgg(t, tn, base, base+3*3600+3599, "model")
	ins, err := tn.Append(context.Background(), rows)
	if err != nil {
		t.Fatal(err)
	}
	for i, ok := range ins {
		if ok {
			t.Fatalf("duplicate row %d reported inserted", i)
		}
	}
	after := queryConvAgg(t, tn, base, base+3*3600+3599, "model")
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("duplicate append changed counts: %v -> %v", before, after)
	}
	var rollupN, baseN int
	if err := tn.rdb.QueryRow(`SELECT sum(n) FROM conversations_hourly`).Scan(&rollupN); err != nil {
		t.Fatal(err)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM facts`).Scan(&baseN); err != nil {
		t.Fatal(err)
	}
	if rollupN != baseN || baseN != len(rows) {
		t.Fatalf("rollup sum %d, base %d, fixture %d", rollupN, baseN, len(rows))
	}
}

// rollupFixtureOn appends the standard fixture to an already-open tenant.
func rollupFixtureOn(t *testing.T, tn *Tenant) (*Tenant, []FactRow, int64) {
	t.Helper()
	base := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC).Unix()
	rows := []FactRow{
		hook(1, base+15*60, "claude", "r1", "tool_post", "PostToolUse", "Read", "c1"),
		hook(2, base+45*60, "codex", "r1", "tool_post", "PostToolUse", "Bash", "c2"),
		hook(3, base+3600+5*60, "claude", "r2", "tool_pre", "PreToolUse", "Bash", "c1"),
		hook(4, base+3600+59*60, "claude", "r1", "tool_post", "PostToolUse", "Edit", "c3"),
		hook(5, base+2*3600, "codex", "r2", "tool_pre", "PreToolUse", "Read", "c1"),
		hook(6, base+2*3600+30*60, "claude", "r1", "stop", "Stop", "", "c2"),
		hook(7, base+3*3600+10*60, "codex", "r1", "tool_post", "PostToolUse", "Bash", "c4"),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn, rows, base
}

// facetFact builds a fact of any type with a repo-relative path so kind and plan are exercised.
func facetFact(i int, ts int64, typ, harness, repo, event, norm, tool, model, conv, p string) FactRow {
	raw := []byte(fmt.Sprintf(`{"facet":%d}`, i))
	return FactRow{RowHash: keys.ContentHash(raw), Type: typ, ConversationID: conv,
		Harness: harness, Event: event, NormEvent: norm, Tool: tool, Model: model,
		RepoID: repo, Path: p, TS: float64(ts), Raw: raw}
}

// facetFixture plants facts over four hours and every type, with design/brief/report paths and
// several repos, harnesses, models and tools so each facet dimension has a non-trivial distinct set.
func facetFixture(t *testing.T) (*Tenant, []FactRow, int64) {
	t.Helper()
	tn := openT(t, Options{})
	base := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC).Unix()
	rows := []FactRow{
		facetFact(1, base+10*60, "hook_event", "claude", "r1", "PostToolUse", "tool_post", "Read", "m1", "c1", "docs/plans/p1/briefs/b1.md"),
		facetFact(2, base+20*60, "hook_event", "codex", "r1", "PostToolUse", "tool_post", "Bash", "m2", "c2", "docs/plans/p1/briefs/b1.md"),
		facetFact(3, base+40*60, "artifact_version", "claude", "r2", "artifact", "", "", "m1", "c1", "docs/plans/p1/briefs/b1.md"),
		facetFact(4, base+3600+15*60, "hook_event", "claude", "r2", "PreToolUse", "tool_pre", "Bash", "m1", "c1", "docs/plans/p2/DESIGN.md"),
		facetFact(5, base+3600+45*60, "commit", "codex", "r1", "commit", "", "", "", "c2", ""),
		facetFact(6, base+2*3600+5*60, "hook_event", "codex", "r1", "PostToolUse", "tool_post", "Read", "m2", "c3", "docs/plans/p2/reports/r1.md"),
		facetFact(7, base+2*3600+35*60, "artifact_version", "claude", "r2", "artifact", "", "", "m1", "c2", "docs/plans/p2/reports/r1.md"),
		facetFact(8, base+3*3600+10*60, "hook_event", "claude", "r1", "Stop", "stop", "", "m1", "c1", "docs/plans/p1/briefs/b2.md"),
		facetFact(9, base+3*3600+50*60, "commit", "codex", "r2", "commit", "", "", "", "c4", ""),
		facetFact(10, base+3*3600+55*60, "hook_event", "claude", "r2", "PostToolUse", "tool_post", "Read", "m1", "c1", "docs/plans/p1/briefs/b2.md"),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn, rows, base
}

// facetsBaseOracle computes the Facets result directly from base rows over [from,to], the oracle the
// rollup path must equal for an unfiltered window.
func facetsBaseOracle(t *testing.T, tn *Tenant, from, to int64) Facets {
	t.Helper()
	return facetsOracle(t, tn, AnalyticsFilter{From: time.Unix(from, 0).UTC(), To: time.Unix(to, 0).UTC()})
}

// facetsOracle computes the Facets result directly from base rows for any filter, the oracle both
// the rollup path and the filtered fallback (rollupEligible()==false) path must equal.
func facetsOracle(t *testing.T, tn *Tenant, f AnalyticsFilter) Facets {
	t.Helper()
	w, args := f.factWhere()
	distinct := func(expr string, nonEmpty bool) []string {
		extra := ""
		if nonEmpty {
			extra = " AND " + expr + " != ''"
		}
		rows, err := tn.rdb.Query("SELECT DISTINCT "+expr+" AS v FROM facts WHERE "+w+extra+" ORDER BY v", args...)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				t.Fatal(err)
			}
			out = append(out, s)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}
	var want Facets
	want.Repos = distinct("repo_id", false)
	want.Harnesses = distinct("harness", false)
	want.Plans = distinct("plan", false)
	want.Events = distinct("event", false)
	want.Models = distinct("model", true)
	want.NormEvents = distinct("norm_event", true)
	have := map[string]bool{}
	for _, k := range distinct("kind", false) {
		have[k] = true
	}
	for _, k := range []string{"design", "brief", "report"} {
		if have[k] {
			want.Kinds = append(want.Kinds, k)
		}
	}
	rows, err := tn.rdb.Query(`SELECT tool AS tname, count(*) AS n FROM facts
		WHERE type='hook_event' AND `+w+` GROUP BY tname HAVING tname != '' ORDER BY n DESC, tname ASC LIMIT 100`, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var c ToolCount
		if err := rows.Scan(&c.Name, &c.N); err != nil {
			t.Fatal(err)
		}
		want.Tools = append(want.Tools, c)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return want
}

// TestFacetRollupEqualsBaseRows drives the rolled-up facets read over windows that start and end
// mid-hour and compares it, dimension by dimension, with distinct sets over base rows alone.
func TestFacetRollupEqualsBaseRows(t *testing.T) {
	tn, _, base := facetFixture(t)
	windows := []struct {
		name     string
		from, to int64
	}{
		{"whole hours", base, base + 3*3600 + 3599},
		{"mid start", base + 1800, base + 3*3600 + 1800},
		{"mid end", base, base + 2*3600 + 1800},
		{"single hour mid", base + 3600 + 600, base + 3600 + 3000},
		{"exact hour edges", base + 3600, base + 2*3600},
		{"all", 0, base + 10*3600},
	}
	for _, w := range windows {
		f := AnalyticsFilter{From: time.Unix(w.from, 0).UTC(), To: time.Unix(w.to, 0).UTC()}
		got, err := tn.Facets(context.Background(), f)
		if err != nil {
			t.Fatalf("window %q: %v", w.name, err)
		}
		want := facetsBaseOracle(t, tn, w.from, w.to)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("window %q: rollup %+v != base %+v", w.name, got, want)
		}
	}
}

// TestFacetsFilteredFallback covers the rollupEligible()==false path: any non-time filter makes
// Facets read base rows alone (facetsBase), and the result must equal the base-row oracle under that
// filter for multi-hour windows that would otherwise take the rollup fast path.
func TestFacetsFilteredFallback(t *testing.T) {
	tn, _, base := facetFixture(t)
	windows := []struct {
		name     string
		from, to int64
	}{
		{"whole hours", base, base + 3*3600 + 3599},
		{"mid start", base + 1800, base + 3*3600 + 1800},
	}
	for _, w := range windows {
		for _, repos := range [][]string{{"r1"}, {"r2"}, {"r1", "r2"}} {
			f := AnalyticsFilter{From: time.Unix(w.from, 0).UTC(), To: time.Unix(w.to, 0).UTC(), Repos: repos}
			if f.rollupEligible() {
				t.Fatalf("window %q repos %v: filter unexpectedly rollup-eligible", w.name, repos)
			}
			got, err := tn.Facets(context.Background(), f)
			if err != nil {
				t.Fatalf("window %q repos %v: %v", w.name, repos, err)
			}
			want := facetsOracle(t, tn, f)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("window %q repos %v: fallback %+v != base %+v", w.name, repos, got, want)
			}
		}
	}
}

// TestFacetRollupDuplicateAppend: re-appending the same facts (identical row hashes) inserts no row,
// so it must leave the facets output unchanged, and the rollup weight per dimension must still equal
// the base-row count.
func TestFacetRollupDuplicateAppend(t *testing.T) {
	tn, rows, base := facetFixture(t)
	ctx := context.Background()
	f := AnalyticsFilter{From: time.Unix(base, 0).UTC(), To: time.Unix(base+3*3600+3599, 0).UTC()}
	before, err := tn.Facets(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	ins, err := tn.Append(ctx, rows)
	if err != nil {
		t.Fatal(err)
	}
	for i, ok := range ins {
		if ok {
			t.Fatalf("duplicate row %d reported inserted", i)
		}
	}
	after, err := tn.Facets(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("duplicate append changed facets: %+v -> %+v", before, after)
	}
	for _, d := range []struct {
		dim, where string
	}{
		{"repo_id", ""}, {"harness", ""}, {"plan", ""}, {"event", ""},
		{"model", ""}, {"norm_event", ""}, {"kind", ""}, {"tool", "type='hook_event'"},
	} {
		var rn, bn int
		if err := tn.rdb.QueryRow(`SELECT sum(n) FROM facets_hourly WHERE dim=?`, d.dim).Scan(&rn); err != nil {
			t.Fatal(err)
		}
		q := `SELECT count(*) FROM facts`
		if d.where != "" {
			q += " WHERE " + d.where
		}
		if err := tn.rdb.QueryRow(q).Scan(&bn); err != nil {
			t.Fatal(err)
		}
		if rn != bn {
			t.Fatalf("dim %q: rollup sum %d != base count %d", d.dim, rn, bn)
		}
	}
}

// summaryFact builds a fact of any type with a content hash so the summary's distinct-content count
// is exercised.
func summaryFact(i int, ts int64, typ, harness, repo, conv, content string) FactRow {
	raw := []byte(fmt.Sprintf(`{"summary":%d}`, i))
	return FactRow{RowHash: keys.ContentHash(raw), Type: typ, ConversationID: conv,
		Harness: harness, RepoID: repo, ContentHash: content, TS: float64(ts), Raw: raw}
}

// summaryFixture plants hook_event, artifact_version and commit facts across four hours, reusing
// conversations and content hashes so the summary distinct counts are non-trivial.
func summaryFixture(t *testing.T) (*Tenant, int64) {
	t.Helper()
	tn := openT(t, Options{})
	base := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC).Unix()
	h := func(n int) string { return fmt.Sprintf("%064x", n) }
	rows := []FactRow{
		summaryFact(1, base+15*60, "hook_event", "claude", "r1", "c1", ""),
		summaryFact(2, base+45*60, "hook_event", "codex", "r1", "c2", ""),
		summaryFact(3, base+50*60, "artifact_version", "claude", "r2", "c1", h(1)),
		// An artifact_version with an empty content_hash: Append allows it, and it must count as one
		// distinct content value (the '' string), matching the old count(DISTINCT CASE ...) branch.
		summaryFact(10, base+55*60, "artifact_version", "claude", "r2", "c1", ""),
		summaryFact(4, base+3600+5*60, "hook_event", "claude", "r2", "c1", ""),
		summaryFact(5, base+3600+59*60, "commit", "claude", "r1", "c3", ""),
		summaryFact(6, base+2*3600, "artifact_version", "codex", "r2", "c1", h(1)),
		summaryFact(7, base+2*3600+30*60, "artifact_version", "claude", "r1", "c2", h(2)),
		summaryFact(8, base+3*3600+10*60, "hook_event", "codex", "r1", "c4", ""),
		summaryFact(9, base+3*3600+40*60, "commit", "claude", "r2", "c1", ""),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn, base
}

// summaryBaseOracle computes the five summary count fields directly from base rows over [from,to].
func summaryBaseOracle(t *testing.T, tn *Tenant, from, to int64) (conv, hook, av, distinct, commits int) {
	t.Helper()
	if err := tn.rdb.QueryRow(`SELECT count(DISTINCT conversation_id),
		COALESCE(SUM(type='hook_event'),0), COALESCE(SUM(type='artifact_version'),0),
		count(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END), COALESCE(SUM(type='commit'),0)
		FROM facts WHERE ts>=? AND ts<=?`, float64(from), float64(to)).Scan(&conv, &hook, &av, &distinct, &commits); err != nil {
		t.Fatal(err)
	}
	return
}

// TestSummaryRollupEqualsBase drives the summary rollup fast path (a time-only filter) over several
// windows, including ones that start and end mid-hour, and asserts the five count fields equal an
// aggregate computed directly from base rows.
func TestSummaryRollupEqualsBase(t *testing.T) {
	tn, base := summaryFixture(t)
	windows := []struct {
		name     string
		from, to int64
	}{
		{"whole hours", base, base + 3*3600 + 3599},
		{"mid start", base + 1800, base + 3*3600 + 1800},
		{"mid end", base, base + 2*3600 + 1800},
		{"mid both", base + 1800, base + 2*3600 + 1800},
		{"single hour mid", base + 1500, base + 3300},
		{"all", 0, base + 10*3600},
	}
	for _, w := range windows {
		f := AnalyticsFilter{From: time.Unix(w.from, 0).UTC(), To: time.Unix(w.to, 0).UTC()}
		got, err := tn.Summary(context.Background(), f)
		if err != nil {
			t.Fatalf("window %q: %v", w.name, err)
		}
		wantConv, wantHook, wantAV, wantDistinct, wantCommits := summaryBaseOracle(t, tn, w.from, w.to)
		if got.Conversations != wantConv || got.HookEvents != wantHook || got.ArtifactVersions != wantAV ||
			got.DistinctContent != wantDistinct || got.Commits != wantCommits {
			t.Fatalf("window %q: rollup {conv %d hook %d av %d distinct %d commits %d} != base {conv %d hook %d av %d distinct %d commits %d}",
				w.name, got.Conversations, got.HookEvents, got.ArtifactVersions, got.DistinctContent, got.Commits,
				wantConv, wantHook, wantAV, wantDistinct, wantCommits)
		}
	}
}

// queryMeasureNoRollup is the "forced off" oracle: it mirrors Query's normalization (bucket "" ->
// "none", top default 20 / cap 100) and then calls the unexported queryMeasure with the measure's
// rollup cleared, so source reads base `facts` rows alone. Query exposes no rollup-off toggle and
// query.go is not an owned path, so the base-only path is reached directly from this same-package
// test.
func queryMeasureNoRollup(t *testing.T, tn *Tenant, f AnalyticsFilter, p QueryParams) QueryResult {
	t.Helper()
	def, ok := measureByName(p.Measure)
	if !ok {
		t.Fatalf("unknown measure %q", p.Measure)
	}
	bucket := p.Bucket
	if bucket == "" {
		bucket = "none"
	}
	top := p.Top
	if top <= 0 {
		top = 20
	}
	if top > 100 {
		top = 100
	}
	def.rollup = ""
	res, err := tn.queryMeasure(context.Background(), f, p, def, top, bucket)
	if err != nil {
		t.Fatalf("queryMeasure(no rollup) measure=%q: %v", p.Measure, err)
	}
	return res
}

// convBucketedFixture spans about 20 hours across a Sydney (UTC+11) day boundary: 2026-03-03
// 20:00 UTC is 2026-03-04 07:00 in Sydney, and Sydney midnight 2026-03-04 is 13:00 UTC, so facts
// sit just before and just after it. Several harness/repo_id values and repeated conversations make
// DISTINCT and the two interpreted dimensions non-trivial.
func convBucketedFixture(t *testing.T) (*Tenant, int64, int64) {
	t.Helper()
	tn := openT(t, Options{})
	base := time.Date(2026, 3, 3, 20, 0, 0, 0, time.UTC).Unix()
	rows := []FactRow{
		convFact(1, base-8*3600, "hook_event", "claude", "r1", "m1", "c1"),
		convFact(2, base-7*3600-120, "hook_event", "codex", "r2", "m2", "c2"),
		convFact(3, base-7*3600+120, "artifact_version", "claude", "r1", "m1", "c1"),
		convFact(4, base-6*3600, "hook_event", "claude", "r2", "m1", "c1"),
		convFact(5, base-4*3600+30*60, "commit", "codex", "r1", "m3", "c3"),
		convFact(6, base-2*3600, "hook_event", "codex", "r2", "m2", "c2"),
		convFact(7, base, "artifact_version", "claude", "r1", "m1", "c1"),
		convFact(8, base+2*3600+10*60, "hook_event", "claude", "r2", "m1", "c4"),
		convFact(9, base+5*3600, "commit", "codex", "r1", "m3", "c3"),
		convFact(10, base+8*3600, "hook_event", "codex", "r2", "m2", "c1"),
		convFact(11, base+11*3600+30*60, "artifact_version", "claude", "r1", "m1", "c2"),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn, base - 8*3600, base + 12*3600
}

// TestConversationRollupBucketedLocalTwoDim drives the conversations measure with two dimensions,
// a day/week bucket and both UTC and Australia/Sydney (UTC+11) time zones through the rolled-up
// read path, and asserts the rows equal the same query with the rollup path forced off. The
// non-UTC, bucketed and two-dimensional cases cross the interior-hour and day-boundary logic the
// single-dimension UTC tests never exercise.
func TestConversationRollupBucketedLocalTwoDim(t *testing.T) {
	tn, from, to := convBucketedFixture(t)
	syd, err := time.LoadLocation("Australia/Sydney")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	for _, loc := range []*time.Location{time.UTC, syd} {
		for _, bucket := range []string{"day", "week"} {
			f := AnalyticsFilter{From: time.Unix(from, 0).UTC(), To: time.Unix(to, 0).UTC(), TZ: loc}
			p := QueryParams{Measure: "conversations", Dims: []string{"harness", "repo_id"}, Bucket: bucket, Top: 100}
			got, err := tn.Query(context.Background(), f, p)
			if err != nil {
				t.Fatalf("Query tz=%v bucket=%s: %v", loc, bucket, err)
			}
			want := queryMeasureNoRollup(t, tn, f, p)
			if len(got.Rows) == 0 {
				t.Fatalf("tz=%v bucket=%s: no rows, test is vacuous", loc, bucket)
			}
			if !reflect.DeepEqual(got.Rows, want.Rows) {
				t.Fatalf("tz=%v bucket=%s: rollup rows %+v != base-only rows %+v", loc, bucket, got.Rows, want.Rows)
			}
		}
	}
}
