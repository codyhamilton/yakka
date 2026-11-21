package store

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// insertManifestFacts seeds hand-built facts in one transaction so the test can compare the
// SQL counts against a manifest it also queries directly.
func insertManifestFacts(t *testing.T, tn *Tenant, n int, at func(i int) time.Time, typ func(i int) string) {
	t.Helper()
	ctx := context.Background()
	tx, err := tn.rdb.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	ins, err := tx.PrepareContext(ctx, `INSERT INTO facts
		(row_hash,type,conversation_id,harness,event,ts,received_at,repo_id,path,content_hash,norm_event,tool,model,kind,plan,source,raw)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,x'')`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		conv := "c1"
		if i%2 == 1 {
			conv = "c2"
		}
		if _, err := ins.ExecContext(ctx, fmt.Sprintf("n1-%06d", i), typ(i), conv, "cursor", "PreToolUse",
			float64(at(i).Unix()), int64(i+1), "repoA", "docs/plans/p1/briefs/b.md", "", "PreToolUse", "Bash",
			"opus", "brief", "p1", "worktree"); err != nil {
			t.Fatal(err)
		}
	}
	if err := ins.Close(); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func insertManifestRejection(t *testing.T, tn *Tenant, stage, conv, path string, at time.Time) {
	t.Helper()
	mustExec(t, tn, `INSERT INTO rejections (stage,fact_type,conversation_id,path,content_hash,pattern,reason,at) VALUES (?,?,?,?,?,?,?,?)`,
		stage, "artifact_version", conv, path, "", "p", "r", at.UnixNano())
}

func TestEventCountsN1Population(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 30)
	const (
		totalFacts = 12480
		inWindow   = 8406
	)
	types := []string{"hook_event", "usage", "artifact_version", "commit", "session_action"}
	insertManifestFacts(t, tn, totalFacts, func(i int) time.Time {
		if i < inWindow {
			return from.Add(time.Duration(i) * time.Second)
		}
		return from.Add(-time.Duration(i-inWindow+1) * 24 * time.Hour)
	}, func(i int) string { return types[i%len(types)] })

	for j := 0; j < 9; j++ {
		at := from.Add(time.Duration(j) * time.Hour)
		if j >= 4 {
			at = from.Add(-time.Duration(j) * time.Hour)
		}
		insertManifestRejection(t, tn, "precheck", fmt.Sprintf("c%d", j%2+1), "docs/plans/p1/briefs/b.md", at)
	}

	f := AnalyticsFilter{From: from, To: to}
	got, err := tn.EventCounts(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	if got.Matched.Events != inWindow || got.Matched.Rejections != 4 || got.Matched.Rows != 8410 {
		t.Fatalf("matched = %+v, want events=%d rejections=4 rows=8410", got.Matched, inWindow)
	}
	if got.TenantTotal.Events != totalFacts || got.TenantTotal.Rejections != 9 || got.TenantTotal.Rows != 12489 {
		t.Fatalf("tenant total = %+v, want events=%d rejections=9 rows=12489", got.TenantTotal, totalFacts)
	}
	if got.CheckedAt.Location() != time.UTC || time.Since(got.CheckedAt) > 5*time.Second {
		t.Fatalf("checked_at = %v, want current UTC", got.CheckedAt)
	}

	// The assertions above are checked against the manifest the test seeded, not against the
	// production predicate alone.
	var manifestFacts, manifestInWindow, manifestRejs, manifestRejsInWindow int64
	if err := tn.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM facts`).Scan(&manifestFacts); err != nil {
		t.Fatal(err)
	}
	if err := tn.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM facts WHERE ts >= ? AND ts <= ?`,
		seconds(from), seconds(to)).Scan(&manifestInWindow); err != nil {
		t.Fatal(err)
	}
	if err := tn.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM rejections`).Scan(&manifestRejs); err != nil {
		t.Fatal(err)
	}
	if err := tn.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM rejections WHERE at >= ? AND at <= ?`,
		from.UnixNano(), to.UnixNano()).Scan(&manifestRejsInWindow); err != nil {
		t.Fatal(err)
	}
	if manifestFacts != got.TenantTotal.Events || manifestInWindow != got.Matched.Events ||
		manifestRejs != got.TenantTotal.Rejections || manifestRejsInWindow != got.Matched.Rejections {
		t.Fatalf("manifest (%d/%d facts, %d/%d rejections) != counts %+v", manifestInWindow, manifestFacts,
			manifestRejsInWindow, manifestRejs, got)
	}

	// Every stored fact type contributes to the event count exactly once.
	rows, err := tn.rdb.QueryContext(ctx, `SELECT type, COUNT(*) FROM facts GROUP BY type`)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]int64{}
	var sum int64
	for rows.Next() {
		var typ string
		var n int64
		if err := rows.Scan(&typ, &n); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		seen[typ] = n
		sum += n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, typ := range types {
		if seen[typ] == 0 {
			t.Fatalf("fact type %q was not counted: %v", typ, seen)
		}
	}
	if sum != got.TenantTotal.Events {
		t.Fatalf("typed facts sum to %d, tenant events %d", sum, got.TenantTotal.Events)
	}

	// matched.rows is the exact population of a complete ExplorePage traversal under the same
	// predicate.
	var traversed int64
	var cur *ExploreCursor
	for {
		page, more, next, err := tn.ExplorePage(ctx, f, cur, 500)
		if err != nil {
			t.Fatal(err)
		}
		traversed += int64(len(page))
		if !more {
			break
		}
		cur = next
	}
	if traversed != got.Matched.Rows {
		t.Fatalf("explore traversal returned %d rows, matched.rows = %d", traversed, got.Matched.Rows)
	}
}

func predicateFixture(t *testing.T) (*Tenant, time.Time, time.Time) {
	t.Helper()
	tn := openT(t, Options{})
	base := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	type fact struct {
		conv, repo, kind, plan, harness, event, tool, model, source string
	}
	facts := []fact{
		{"c1", "repoA", "brief", "p1", "cursor", "PreToolUse", "Bash", "opus", "worktree"},
		{"c1", "repoA", "report", "p2", "claude", "PostToolUse", "Read", "sonnet", "commit"},
		{"c2", "repoB", "brief", "p1", "cursor", "PreToolUse", "Grep", "opus", "worktree"},
		{"c2", "repoB", "report", "p3", "codex", "PreToolUse", "Bash", "gpt", "worktree"},
	}
	for i, x := range facts {
		mustExec(t, tn, `INSERT INTO facts
			(row_hash,type,conversation_id,harness,event,ts,received_at,repo_id,path,content_hash,norm_event,tool,model,kind,plan,source,raw)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,x'')`,
			fmt.Sprintf("pred-%d", i), "hook_event", x.conv, x.harness, x.event,
			float64(base.Add(time.Duration(i)*time.Minute).Unix()), i+1, x.repo, "", "",
			x.event, x.tool, x.model, x.kind, x.plan, x.source)
	}
	insertManifestRejection(t, tn, "precheck", "c1", "docs/plans/p1/briefs/b1.md", base)
	insertManifestRejection(t, tn, "screen", "c2", "docs/plans/p1/reports/r1.md", base)
	insertManifestRejection(t, tn, "screen", "c1", "docs/plans/p3/briefs/b2.md", base)
	insertManifestRejection(t, tn, "precheck", "c9", "docs/plans/p2/briefs/b3.md", base)
	return tn, base.Add(-time.Hour), base.Add(time.Hour)
}

func TestEventCountsRetainedRecordPredicate(t *testing.T) {
	tn, from, to := predicateFixture(t)
	ctx := context.Background()
	base := AnalyticsFilter{From: from, To: to}
	with := func(fn func(*AnalyticsFilter)) AnalyticsFilter {
		f := base
		fn(&f)
		return f
	}
	cases := []struct {
		name       string
		f          AnalyticsFilter
		events     int64
		rejections int64
	}{
		{"no filter", base, 4, 4},
		{"repo include OR", with(func(f *AnalyticsFilter) { f.Repos = []string{"repoA", "repoB"} }), 4, 0},
		{"repo nonempty never matches absent rejections", with(func(f *AnalyticsFilter) { f.Repos = []string{"repoA"} }), 2, 0},
		{"repo and kind intersection", with(func(f *AnalyticsFilter) { f.Repos = []string{"repoA"}; f.Kinds = []string{"brief", "report"} }), 2, 0},
		{"kind include uses path", with(func(f *AnalyticsFilter) { f.Kinds = []string{"brief"} }), 2, 3},
		{"kind repeated OR", with(func(f *AnalyticsFilter) { f.Kinds = []string{"brief", "report"} }), 4, 4},
		{"conversation include on both sides", with(func(f *AnalyticsFilter) { f.ConversationIDs = []string{"c1"} }), 2, 2},
		{"conversation exclude on both sides", with(func(f *AnalyticsFilter) { f.Excludes = map[string][]string{"conversation_id": {"c1"}} }), 2, 2},
		{"event include cannot match absent rejection", with(func(f *AnalyticsFilter) { f.Events = []string{"PreToolUse"} }), 3, 0},
		{"event exclude absent value keeps rejections", with(func(f *AnalyticsFilter) { f.Excludes = map[string][]string{"event": {"PreToolUse"}} }), 1, 4},
		{"tool include cannot match absent rejection", with(func(f *AnalyticsFilter) { f.Tools = []string{"Bash"} }), 2, 0},
		{"model exclude absent value keeps rejections", with(func(f *AnalyticsFilter) { f.Excludes = map[string][]string{"model": {"opus"}} }), 2, 4},
		{"source include cannot match absent rejection", with(func(f *AnalyticsFilter) { f.Sources = []string{"worktree"} }), 3, 0},
		{"norm_event include cannot match absent rejection", with(func(f *AnalyticsFilter) { f.NormEvents = []string{"PreToolUse"} }), 3, 0},
		{"harness include cannot match absent rejection", with(func(f *AnalyticsFilter) { f.Harnesses = []string{"cursor"} }), 2, 0},
		{"plan include uses path", with(func(f *AnalyticsFilter) { f.Plans = []string{"p1"} }), 2, 2},
		{"kind exclude uses path", with(func(f *AnalyticsFilter) { f.Excludes = map[string][]string{"kind": {"report"}} }), 2, 3},
		{"stage exclude", with(func(f *AnalyticsFilter) { f.Excludes = map[string][]string{"stage": {"precheck"}} }), 4, 2},
		{"repo exclude absent value keeps rejections", with(func(f *AnalyticsFilter) { f.Excludes = map[string][]string{"repo_id": {"repoB"}} }), 2, 4},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := tn.EventCounts(ctx, c.f)
			if err != nil {
				t.Fatal(err)
			}
			if got.Matched.Events != c.events || got.Matched.Rejections != c.rejections ||
				got.Matched.Rows != c.events+c.rejections {
				t.Fatalf("matched = %+v, want events=%d rejections=%d", got.Matched, c.events, c.rejections)
			}
			if got.TenantTotal.Events != 4 || got.TenantTotal.Rejections != 4 || got.TenantTotal.Rows != 8 {
				t.Fatalf("tenant total = %+v, want unfiltered 4/4/8", got.TenantTotal)
			}
		})
	}

	// The corrected predicate is the same one ExplorePage uses: a conversation-scoped read cannot
	// include another conversation's rejections.
	f := with(func(f *AnalyticsFilter) { f.ConversationIDs = []string{"c1"} })
	rows, _, err := tn.Explore(ctx, f, 100)
	if err != nil {
		t.Fatal(err)
	}
	var n int64
	for _, row := range rows {
		if row.ConversationID != "c1" {
			t.Fatalf("conversation-scoped explore returned %q", row.ConversationID)
		}
		n++
	}
	got, err := tn.EventCounts(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	if n != got.Matched.Rows {
		t.Fatalf("explore returned %d rows, matched.rows = %d", n, got.Matched.Rows)
	}
}

func TestEventCountsEmptyWindowKeepsTenantTotal(t *testing.T) {
	tn, from, _ := predicateFixture(t)
	got, err := tn.EventCounts(context.Background(), AnalyticsFilter{From: from.Add(-48 * time.Hour), To: from.Add(-24 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Matched.Events != 0 || got.Matched.Rejections != 0 || got.Matched.Rows != 0 {
		t.Fatalf("empty window matched = %+v", got.Matched)
	}
	if got.TenantTotal.Events != 4 || got.TenantTotal.Rejections != 4 || got.TenantTotal.Rows != 8 {
		t.Fatalf("empty window tenant total = %+v, want retained history", got.TenantTotal)
	}
}
