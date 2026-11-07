package store

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func ad(m time.Month, d, h, mi int) time.Time { return time.Date(2026, m, d, h, mi, 0, 0, time.UTC) }

var (
	aFrom = ad(9, 28, 0, 0) // a Monday
	aTo   = ad(10, 5, 12, 0)
)

type afx struct {
	typ, conv, harness, event string
	ts                        time.Time
	repo, path, hash          string
	source, sha, tool         string
	noTool                    bool
}

var anSeq int

func hx(s string) string { return keys.ContentHash([]byte("content-" + s)) }

func addFacts(t *testing.T, tn *Tenant, fs ...afx) {
	t.Helper()
	var rows []FactRow
	for _, f := range fs {
		anSeq++
		m := map[string]any{"n": anSeq, "type": f.typ}
		if f.source != "" {
			m["source"] = f.source
		}
		if f.sha != "" {
			m["sha"] = f.sha
		}
		if f.typ == "hook_event" {
			p := map[string]any{}
			if !f.noTool {
				p["tool_name"] = f.tool
			}
			m["payload"] = p
		}
		raw, _ := json.Marshal(m)
		rows = append(rows, FactRow{RowHash: keys.ContentHash(raw), Type: f.typ, ConversationID: f.conv,
			Harness: f.harness, Event: f.event, TS: float64(f.ts.Unix()), RepoID: f.repo, Path: f.path,
			ContentHash: f.hash, Raw: raw, Tool: f.tool, Source: f.source, SHA: f.sha})
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
}

func mustExec(t *testing.T, tn *Tenant, q string, args ...any) {
	t.Helper()
	if _, err := tn.wdb.Exec(q, args...); err != nil {
		t.Fatal(err)
	}
}

// fixture is the hand-counted data set; the expected numbers are derived in each test.
func fixture(t *testing.T) (*Tenant, AnalyticsFilter) {
	tn := openT(t, Options{})
	hk := func(conv, h, ev string, ts time.Time, repo, tool string, noTool bool) afx {
		return afx{typ: "hook_event", conv: conv, harness: h, event: ev, ts: ts, repo: repo, tool: tool, noTool: noTool}
	}
	av := func(conv, h string, ts time.Time, repo, path, hash, source, sha string) afx {
		return afx{typ: "artifact_version", conv: conv, harness: h, event: "artifact", ts: ts, repo: repo, path: path, hash: hx(hash), source: source, sha: sha}
	}
	cm := func(conv, h string, ts time.Time, repo, sha string) afx {
		return afx{typ: "commit", conv: conv, harness: h, event: "commit", ts: ts, repo: repo, sha: sha}
	}
	addFacts(t, tn,
		hk("c1", "cursor", "PreToolUse", aFrom, "repoA", "Bash", false),                   // edge: at From
		hk("c1", "cursor", "PreToolUse", aFrom.Add(-time.Second), "repoA", "Bash", false), // out
		hk("c2", "claude", "PostToolUse", ad(10, 4, 23, 0), "repoA", "Read", false),       // Sunday
		hk("c2", "claude", "PostToolUse", ad(10, 5, 1, 0), "", "", true),                  // Monday, no repo, no tool
		hk("c3", "claude", "PreToolUse", aTo, "repoB", "Bash", false),                     // edge: at To
		hk("c3", "claude", "PreToolUse", aTo.Add(time.Second), "repoB", "Bash", false),    // out
		av("c1", "cursor", ad(9, 29, 10, 0), "repoA", "docs/plans/p1/DESIGN.md", "H1", "worktree", ""),
		av("c1", "cursor", ad(9, 29, 11, 0), "repoA", "docs/plans/p1/briefs/b1.md", "H2", "commit", "abc123"),
		av("c1", "codex", ad(9, 30, 8, 0), "repoA", "docs/plans/p1/briefs/b1.md", "H2", "worktree", ""),
		av("c1", "old", ad(9, 27, 0, 0), "repoA", "docs/plans/p1/briefs/b1.md", "H2", "worktree", ""), // out
		av("c1", "cursor", ad(9, 30, 9, 0), "repoA", "docs/plans/p1/briefs/sub/x.md", "H3", "worktree", ""),
		av("c2", "claude", ad(10, 1, 9, 0), "repoA", "docs/plans/p1/reports/b1.md", "H4", "worktree", ""),
		av("c1", "cursor", ad(10, 1, 10, 0), "repoA", "docs/plans/p2/briefs/b2.md", "H5", "worktree", ""),
		av("c1", "cursor", ad(9, 20, 0, 0), "repoA", "docs/plans/p2/reports/b2.md", "H6", "worktree", ""), // out
		av("c3", "claude", ad(10, 2, 9, 0), "repoB", "docs/plans/p1/briefs/b1.md", "H2", "worktree", ""),
		av("c4", "cursor", ad(10, 2, 9, 0), "repoA", "docs/plans/p2/briefs/b3.md", "H7", "commit", ""),
		av("c6", "cursor", ad(9, 10, 0, 0), "repoA", "docs/plans/p3/DESIGN.md", "H8", "worktree", ""), // out
		cm("c1", "cursor", ad(10, 20, 0, 0), "repoA", "c1sha"),                                        // out
		cm("c4", "codex", ad(10, 3, 12, 0), "repoA", "def"),
		cm("c5", "cursor", ad(10, 1, 10, 0), "repoB", "ghi"),
	)
	rej := func(stage, path string, at int64) {
		mustExec(t, tn, `INSERT INTO rejections (stage,fact_type,conversation_id,path,content_hash,pattern,reason,at) VALUES (?,?,?,?,?,?,?,?)`,
			stage, "artifact_version", "c1", path, "", "p", "r", at)
	}
	rej("precheck", "docs/plans/p1/briefs/b1.md", ad(9, 29, 12, 0).UnixNano())
	rej("precheck", "", ad(10, 1, 0, 0).UnixNano())
	rej("screen", "docs/plans/p2/DESIGN.md", ad(10, 2, 0, 0).UnixNano())
	rej("precheck", "", aFrom.UnixNano()-1) // out by 1ns
	rej("screen", "docs/plans/p1/reports/b1.md", aTo.UnixNano())
	rej("screen", "", aTo.UnixNano()+1) // out by 1ns
	scr := func(h, v string) {
		mustExec(t, tn, `INSERT INTO screens (content_hash,verdict,scorer,at) VALUES (?,?,?,?)`, hx(h), v, "s", 1)
	}
	scr("H1", "pass")
	scr("H2", "unscreened")
	scr("H2", "pass") // latest wins
	scr("H3", "unscreened")
	scr("H4", "pass")
	scr("H4", "fail") // latest is neither
	scr("H7", "pass")
	scr("H6", "pass") // out of window
	sc := func(h, c string, r float64) {
		mustExec(t, tn, `INSERT INTO scores (content_hash,check_name,result,scorer,at) VALUES (?,?,?,?,?)`, hx(h), c, r, "s", 1)
	}
	sc("H1", "d.x", 0.2)
	sc("H1", "d.x", 0.8)
	sc("H1", "d.y", 0.5)
	sc("H8", "d.x", 0.1) // out-of-window hash
	sc("H2", "b.x", 0.1)
	sc("H2", "b.x", 0.3)
	sc("H5", "b.x", 0.6)
	sc("H7", "b.x", 0.9)
	sc("H3", "b.x", 0.99) // kind other
	return tn, AnalyticsFilter{From: aFrom, To: aTo}
}

func sm(conv, hook, av, distinct, commits int, kind, source, rej, scr [4]int) Summary {
	return Summary{Conversations: conv, HookEvents: hook, ArtifactVersions: av, DistinctContent: distinct, Commits: commits,
		ByKind:     map[string]int{"design": kind[0], "brief": kind[1], "report": kind[2], "other": kind[3]},
		BySource:   map[string]int{"worktree": source[0], "commit": source[1]},
		Rejections: map[string]int{"precheck": rej[0], "screen": rej[1]},
		Screens:    map[string]int{"pass": scr[0], "unscreened": scr[1]}}
}

func TestAnalyticsSummary(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	// hooks: F1,F3,F4,F5 (the two others are 1s outside); versions: 8 in window; commits: def, ghi.
	want := sm(5, 4, 8, 6, 2, [4]int{1, 5, 1, 1}, [4]int{6, 2}, [4]int{2, 2}, [4]int{3, 1})
	got, err := tn.Summary(ctx, f)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("summary\n got %+v %v\nwant %+v", got, err, want)
	}
	cases := []struct {
		name string
		mod  func(*AnalyticsFilter)
		want Summary
	}{
		{"repoB (rejections have no repo)", func(f *AnalyticsFilter) { f.Repos = []string{"repoB"} },
			sm(2, 1, 1, 1, 1, [4]int{0, 1, 0, 0}, [4]int{1, 0}, [4]int{0, 0}, [4]int{1, 0})},
		{"kind brief drops hooks and commits", func(f *AnalyticsFilter) { f.Kinds = []string{"brief"} },
			sm(3, 0, 5, 3, 0, [4]int{0, 5, 0, 0}, [4]int{3, 2}, [4]int{1, 0}, [4]int{2, 0})},
		{"kind OR", func(f *AnalyticsFilter) { f.Kinds = []string{"design", "report"} },
			sm(2, 0, 2, 2, 0, [4]int{1, 0, 1, 0}, [4]int{2, 0}, [4]int{0, 2}, [4]int{1, 0})},
		{"repo AND kind", func(f *AnalyticsFilter) { f.Repos = []string{"repoB"}; f.Kinds = []string{"brief"} },
			sm(1, 0, 1, 1, 0, [4]int{0, 1, 0, 0}, [4]int{1, 0}, [4]int{0, 0}, [4]int{1, 0})},
		{"plan p2", func(f *AnalyticsFilter) { f.Plans = []string{"p2"} },
			sm(2, 0, 2, 2, 0, [4]int{0, 2, 0, 0}, [4]int{1, 1}, [4]int{0, 1}, [4]int{1, 0})},
	}
	for _, c := range cases {
		ff := f
		c.mod(&ff)
		got, err := tn.Summary(ctx, ff)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s\n got %+v %v\nwant %+v", c.name, got, err, c.want)
		}
	}
}

func pts(s ...string) []SeriesPoint {
	var out []SeriesPoint
	for i := 0; i+2 < len(s); i += 3 {
		var n int
		fmt.Sscan(s[i+2], &n)
		out = append(out, SeriesPoint{Key: s[i], T: s[i+1], N: n})
	}
	return out
}

func TestAnalyticsSeries(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	cases := []struct {
		name                  string
		metric, bucket, group string
		want                  []SeriesPoint
	}{
		{"hook day", "hook_events", "day", "none", pts("all", "2026-09-28", "1", "all", "2026-10-04", "1", "all", "2026-10-05", "2")},
		// Sunday 10-04 belongs to the week of Monday 09-28; Monday 10-05 starts a new week.
		{"hook week", "hook_events", "week", "none", pts("all", "2026-09-28", "2", "all", "2026-10-05", "2")},
		{"hook tool", "hook_events", "day", "tool", pts("", "2026-10-05", "1", "Bash", "2026-09-28", "1", "Bash", "2026-10-05", "1", "Read", "2026-10-04", "1")},
		{"conversations day", "conversations", "day", "none", pts("all", "2026-09-28", "1", "all", "2026-09-29", "1", "all", "2026-09-30", "1",
			"all", "2026-10-01", "3", "all", "2026-10-02", "2", "all", "2026-10-03", "1", "all", "2026-10-04", "1", "all", "2026-10-05", "2")},
		{"conversations week harness", "conversations", "week", "harness", pts("claude", "2026-09-28", "2", "claude", "2026-10-05", "2",
			"codex", "2026-09-28", "2", "cursor", "2026-09-28", "3")},
		{"commits harness", "commits", "day", "harness", pts("codex", "2026-10-03", "1", "cursor", "2026-10-01", "1")},
		{"av plan week", "artifact_versions", "week", "plan", pts("", "2026-09-28", "1", "p1", "2026-09-28", "5", "p2", "2026-09-28", "2")},
		{"rejections stage", "rejections", "day", "stage", pts("precheck", "2026-09-29", "1", "precheck", "2026-10-01", "1",
			"screen", "2026-10-02", "1", "screen", "2026-10-05", "1")},
	}
	for _, c := range cases {
		got, err := tn.Series(ctx, f, c.metric, c.bucket, c.group)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s\n got %v %v\nwant %v", c.name, got, err, c.want)
		}
	}
}

func TestAnalyticsSeriesUsesTimezoneForCalendarBuckets(t *testing.T) {
	tn, f := fixture(t)
	f.TZ, _ = time.LoadLocation("America/New_York")
	got, err := tn.Series(context.Background(), f, "hook_events", "day", "none")
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, p := range got {
		counts[p.T] = p.N
	}
	if counts["2026-10-04"] != 2 || counts["2026-10-05"] != 1 {
		t.Fatalf("local day buckets = %v", counts)
	}
}

func TestAnalyticsWindowScores(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	f.Kinds = []string{"report"} // ignored
	got, err := tn.WindowScores(ctx, f, "design")
	want := map[string][]float64{"d.x": {0.8}, "d.y": {0.5}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("design: %v %v", got, err)
	}
	got, err = tn.WindowScores(ctx, f, "brief")
	want = map[string][]float64{"b.x": {0.3, 0.6, 0.9}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("brief: %v %v", got, err)
	}
	f.Repos = []string{"repoB"} // only H2 via repoB
	got, _ = tn.WindowScores(ctx, f, "brief")
	if !reflect.DeepEqual(got, map[string][]float64{"b.x": {0.3}}) {
		t.Fatalf("brief repoB: %v", got)
	}
}

func TestAnalyticsExecutions(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	// c1/b2 is complete via a report and commit outside the window; c1/b1 has a commit outside
	// the window but its only report is in conversation c2, so it is unreported.
	want := []ExecRow{
		{RepoID: "repoB", Plan: "p1", ConversationID: "c3", BriefPath: "docs/plans/p1/briefs/b1.md", Harness: "claude", Shape: "started", TS: float64(ad(10, 2, 9, 0).Unix())},
		{RepoID: "repoA", Plan: "p2", ConversationID: "c4", BriefPath: "docs/plans/p2/briefs/b3.md", Harness: "cursor", Shape: "unreported", TS: float64(ad(10, 2, 9, 0).Unix())},
		{RepoID: "repoA", Plan: "p2", ConversationID: "c1", BriefPath: "docs/plans/p2/briefs/b2.md", Harness: "cursor", Shape: "complete", TS: float64(ad(10, 1, 10, 0).Unix())},
		{RepoID: "repoA", Plan: "p1", ConversationID: "c1", BriefPath: "docs/plans/p1/briefs/b1.md", Harness: "cursor", Shape: "unreported", TS: float64(ad(9, 29, 11, 0).Unix())},
	}
	got, err := tn.Executions(ctx, f)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("executions\n got %+v %v\nwant %+v", got, err, want)
	}
	ff := f
	ff.Repos = []string{"repoB"}
	if got, _ := tn.Executions(ctx, ff); !reflect.DeepEqual(got, want[:1]) {
		t.Fatalf("repoB: %+v", got)
	}
	ff = f
	ff.Kinds = []string{"report"}
	if got, _ := tn.Executions(ctx, ff); len(got) != 0 {
		t.Fatalf("kind report: %+v", got)
	}
	ff = f
	ff.Plans = []string{"p2"}
	if got, _ := tn.Executions(ctx, ff); !reflect.DeepEqual(got, want[1:3]) {
		t.Fatalf("plan p2: %+v", got)
	}
}

// pageFixture makes 9 distinct conversations, each one brief, at 7 distinct ts: c08 and c09 share
// the largest ts (the keyset tie). It backs both paging tests.
func pageFixture(t *testing.T) (*Tenant, AnalyticsFilter, time.Time) {
	tn := openT(t, Options{})
	base := ad(10, 1, 0, 0)
	var fs []afx
	for i := 1; i <= 9; i++ {
		conv := fmt.Sprintf("c%02d", i)
		mins := i - 1
		if i >= 8 {
			mins = 7
		}
		fs = append(fs, afx{typ: "artifact_version", conv: conv, harness: "h", event: "artifact",
			ts: base.Add(time.Duration(mins) * time.Minute), repo: "repoA",
			path: fmt.Sprintf("docs/plans/p/briefs/%s.md", conv), hash: hx(conv), source: "worktree"})
	}
	addFacts(t, tn, fs...)
	return tn, AnalyticsFilter{From: base, To: base.Add(time.Hour)}, base
}

func TestExecutionsPage(t *testing.T) {
	tn, f, _ := pageFixture(t)
	ctx := context.Background()
	all, cntAll, moreAll, err := tn.ExecutionsPage(ctx, f, nil, nil, 500)
	if err != nil || moreAll || len(all) != 9 {
		t.Fatalf("all: n=%d more=%v err=%v", len(all), moreAll, err)
	}
	if !reflect.DeepEqual(cntAll, map[string]int{"complete": 0, "unreported": 0, "started": 9}) {
		t.Fatalf("counts %v", cntAll)
	}
	var walk []ExecRow
	var cur *ExecCursor
	for pages := 1; ; pages++ {
		page, cnt, more, err := tn.ExecutionsPage(ctx, f, nil, cur, 3)
		if err != nil {
			t.Fatal(err)
		}
		if pages == 1 && !reflect.DeepEqual(cnt, cntAll) {
			t.Errorf("page 1 counts %v != all %v", cnt, cntAll)
		}
		if len(page) > 3 {
			t.Fatalf("page %d has %d rows", pages, len(page))
		}
		walk = append(walk, page...)
		if !more {
			if pages != 3 {
				t.Errorf("pages %d, want 3", pages)
			}
			break
		}
		last := page[len(page)-1]
		cur = &ExecCursor{TS: last.TS, Key: []string{last.ConversationID, last.BriefPath, last.RepoID}}
	}
	if !reflect.DeepEqual(walk, all) {
		t.Errorf("walk\n got %+v\nwant %+v", walk, all)
	}
	// The tie at the max ts is ordered c08 then c09 by conversation_id.
	if walk[0].ConversationID != "c08" || walk[1].ConversationID != "c09" {
		t.Errorf("tie order %+v", walk[:2])
	}
}

func TestExecutionsPageShapeFilter(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	all, cntAll, _, err := tn.ExecutionsPage(ctx, f, nil, nil, 500)
	if err != nil {
		t.Fatal(err)
	}
	complete, cnt, _, err := tn.ExecutionsPage(ctx, f, []string{"complete"}, nil, 500)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cnt, cntAll) {
		t.Fatalf("counts with shape: %v want %v", cnt, cntAll)
	}
	var nComplete int
	for _, r := range all {
		if r.Shape == "complete" {
			nComplete++
		}
	}
	if len(complete) != nComplete || nComplete == 0 {
		t.Fatalf("complete rows %d, want %d", len(complete), nComplete)
	}
	for _, r := range complete {
		if r.Shape != "complete" {
			t.Fatalf("shape %q", r.Shape)
		}
	}
	var walk []ExecRow
	var cur *ExecCursor
	for {
		page, c, more, err := tn.ExecutionsPage(ctx, f, []string{"complete"}, cur, 1)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(c, cntAll) {
			t.Fatalf("paged counts %v", c)
		}
		walk = append(walk, page...)
		if !more {
			break
		}
		last := page[len(page)-1]
		cur = &ExecCursor{TS: last.TS, Key: []string{last.ConversationID, last.BriefPath, last.RepoID}}
	}
	if !reflect.DeepEqual(walk, complete) {
		t.Errorf("shape walk\n got %+v\nwant %+v", walk, complete)
	}
}

func TestExecutionsShapeSeries(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	series, err := tn.ExecutionsShapeSeries(ctx, f, "day")
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 3 {
		t.Fatalf("len %d", len(series))
	}
	wantKeys := []string{"complete", "unreported", "started"}
	for i, key := range wantKeys {
		if series[i].Key != key {
			t.Fatalf("[%d] key %q want %q", i, series[i].Key, key)
		}
	}
	var total int
	for _, e := range series {
		for _, p := range e.Points {
			total += p.N
			if p.T == "" || p.N <= 0 {
				t.Fatalf("bad point %+v", p)
			}
		}
	}
	all, _, _, _ := tn.ExecutionsPage(ctx, f, nil, nil, 500)
	if total != len(all) {
		t.Fatalf("series total %d != rows %d", total, len(all))
	}
}

func TestConversationsPage(t *testing.T) {
	tn, f, _ := pageFixture(t)
	ctx := context.Background()
	all, moreAll, err := tn.ConversationsPage(ctx, f, nil, 500)
	if err != nil || moreAll || len(all) != 9 {
		t.Fatalf("all: n=%d more=%v err=%v", len(all), moreAll, err)
	}
	if all[0].ConversationID != "c08" || all[1].ConversationID != "c09" || all[0].LastTS != all[1].LastTS {
		t.Fatalf("last_ts tie not first: %+v", all[:2])
	}
	var walk []ConvRow
	var cur *ConvCursor
	for pages := 1; ; pages++ {
		page, more, err := tn.ConversationsPage(ctx, f, cur, 3)
		if err != nil {
			t.Fatal(err)
		}
		if len(page) > 3 {
			t.Fatalf("page %d has %d rows", pages, len(page))
		}
		walk = append(walk, page...)
		if !more {
			if pages != 3 {
				t.Errorf("pages %d, want 3", pages)
			}
			break
		}
		last := page[len(page)-1]
		cur = &ConvCursor{TS: last.LastTS, ConversationID: last.ConversationID}
	}
	if !reflect.DeepEqual(walk, all) {
		t.Errorf("walk\n got %+v\nwant %+v", walk, all)
	}
}

func TestExecutionsPageTiming(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	base := ad(9, 1, 0, 0)
	fs := make([]afx, 0, 20000)
	for i := 0; i < 20000; i++ {
		conv := fmt.Sprintf("c%05d", i)
		fs = append(fs, afx{typ: "artifact_version", conv: conv, harness: "h", event: "artifact",
			ts: base.Add(time.Duration(i) * time.Second), repo: "repoA",
			path: fmt.Sprintf("docs/plans/p/briefs/%s.md", conv), hash: hx(conv), source: "worktree"})
	}
	addFacts(t, tn, fs...)
	f := AnalyticsFilter{From: base, To: base.Add(48 * time.Hour)}
	start := time.Now()
	rows, _, more, err := tn.ExecutionsPage(ctx, f, nil, nil, 5)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 5 || !more {
		t.Fatalf("n=%d more=%v", len(rows), more)
	}
	for i := 1; i < len(rows); i++ {
		if rows[i].TS > rows[i-1].TS {
			t.Fatalf("not ts desc at %d", i)
		}
	}
	t.Logf("ExecutionsPage limit=5 over 20000 facts: %v", elapsed)
}

func TestAnalyticsConversations(t *testing.T) {
	tn, f := fixture(t)
	got, err := tn.Conversations(context.Background(), f)
	u := func(tm time.Time) float64 { return float64(tm.Unix()) }
	want := []ConvRow{
		{ConversationID: "c3", Harness: "claude", Repos: []string{"repoB"}, Kinds: []string{"brief"}, FirstTS: u(ad(10, 2, 9, 0)), LastTS: u(aTo), HookEvents: 1, ArtifactVersions: 1},
		{ConversationID: "c2", Harness: "claude", Repos: []string{"", "repoA"}, Kinds: []string{"report"}, FirstTS: u(ad(10, 1, 9, 0)), LastTS: u(ad(10, 5, 1, 0)), HookEvents: 2, ArtifactVersions: 1},
		// harness tie cursor/codex -> codex; out-of-window facts are not counted
		{ConversationID: "c4", Harness: "codex", Repos: []string{"repoA"}, Kinds: []string{"brief"}, FirstTS: u(ad(10, 2, 9, 0)), LastTS: u(ad(10, 3, 12, 0)), ArtifactVersions: 1, Commits: 1},
		{ConversationID: "c1", Harness: "cursor", Repos: []string{"repoA"}, Kinds: []string{"brief", "design"}, FirstTS: u(aFrom), LastTS: u(ad(10, 1, 10, 0)), HookEvents: 1, ArtifactVersions: 5},
		{ConversationID: "c5", Harness: "cursor", Repos: []string{"repoB"}, FirstTS: u(ad(10, 1, 10, 0)), LastTS: u(ad(10, 1, 10, 0)), Commits: 1},
	}
	if err != nil || len(got) != len(want) {
		t.Fatalf("conversations: %+v %v", got, err)
	}
	for i := range want {
		if len(got[i].Kinds) == 0 {
			got[i].Kinds = nil
		}
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Errorf("row %d\n got %+v\nwant %+v", i, got[i], want[i])
		}
	}
	// Usage on c1: two alpha calls, one beta; dominant model alpha (ties to smaller name).
	ts := ad(10, 1, 9, 0)
	usageRows := []FactRow{
		ufact(101, "codex", "alpha", "c1", `{"n":101}`, ts, 100, 10, 0, 0, 0, nil),
		ufact(102, "codex", "alpha", "c1", `{"n":102}`, ts, 50, 5, 0, 0, 0, nil),
		ufact(103, "codex", "beta", "c1", `{"n":103}`, ts, 0, 20, 0, 0, 0, nil),
	}
	if _, err := tn.Append(context.Background(), usageRows); err != nil {
		t.Fatal(err)
	}
	got2, _, err := tn.ConversationsPage(context.Background(), f, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	var c1 *ConvRow
	for i := range got2 {
		if got2[i].ConversationID == "c1" {
			c1 = &got2[i]
			break
		}
	}
	if c1 == nil {
		t.Fatal("c1 missing")
	}
	if c1.Model != "alpha" || c1.ModelCalls != 3 || c1.TokensIn != 150 || c1.TokensOut != 35 {
		t.Fatalf("c1 usage: %+v", *c1)
	}
}

func TestAnalyticsFacets(t *testing.T) {
	tn, f := fixture(t)
	got, err := tn.Facets(context.Background(), f)
	want := Facets{Repos: []string{"", "repoA", "repoB"}, Harnesses: []string{"claude", "codex", "cursor"},
		Kinds: []string{"design", "brief", "report"}, Plans: []string{"", "p1", "p2"},
		Events: []string{"PostToolUse", "PreToolUse", "artifact", "commit"},
		Tools:  []ToolCount{{"Bash", 2}, {"Read", 1}}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("facets\n got %+v %v\nwant %+v", got, err, want)
	}

	tn2 := openT(t, Options{})
	var fs []afx
	for i := 0; i < 105; i++ {
		fs = append(fs, afx{typ: "hook_event", conv: "c", harness: "h", event: "e", ts: aFrom.Add(time.Hour), tool: fmt.Sprintf("t%03d", i)})
	}
	fs = append(fs, afx{typ: "hook_event", conv: "c", harness: "h", event: "e", ts: aFrom.Add(time.Hour), tool: "t104"})
	addFacts(t, tn2, fs...)
	got, err = tn2.Facets(context.Background(), AnalyticsFilter{From: aFrom, To: aTo})
	if err != nil || len(got.Tools) != 100 || got.Tools[0] != (ToolCount{"t104", 2}) ||
		got.Tools[1] != (ToolCount{"t000", 1}) || got.Tools[99] != (ToolCount{"t098", 1}) {
		t.Fatalf("tools cap: %d %v", len(got.Tools), err)
	}
}

func TestAnalyticsColumnReads(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	mk := func(conv, repo, event, tool, norm, model, source string, ts time.Time) FactRow {
		raw, _ := json.Marshal(map[string]any{"type": "hook_event", "conversation_id": conv}) // no payload
		return FactRow{RowHash: keys.ContentHash([]byte(conv)), Type: "hook_event", ConversationID: conv,
			Harness: "h", Event: event, TS: float64(ts.Unix()), RepoID: repo, Raw: raw,
			Tool: tool, NormEvent: norm, Model: model, Source: source}
	}
	tsA, tsB := ad(9, 29, 10, 0), ad(9, 29, 11, 0)
	if _, err := tn.Append(ctx, []FactRow{
		mk("cA", "rA", "PreToolUse", "Read", "tool_use", "m1", "commit", tsA),
		mk("cB", "rB", "PostToolUse", "Bash", "tool_result", "m2", "worktree", tsB),
	}); err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: aFrom, To: aTo}
	// Facets reads the tool column even though raw carries no payload.
	fac, err := tn.Facets(ctx, f)
	if err != nil || !reflect.DeepEqual(fac.Tools, []ToolCount{{"Bash", 1}, {"Read", 1}}) {
		t.Fatalf("facets tools: %+v %v", fac.Tools, err)
	}
	// Series groups on tool and on each new group name.
	for _, c := range []struct{ group, a, b string }{
		{"tool", "Bash", "Read"},
		{"norm_event", "tool_result", "tool_use"},
		{"model", "m1", "m2"},
		{"conversation_id", "cA", "cB"},
	} {
		got, err := tn.Series(ctx, f, "hook_events", "day", c.group)
		want := pts(c.a, "2026-09-29", "1", c.b, "2026-09-29", "1")
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("series %s: %v %v", c.group, got, err)
		}
	}
	// One assertion per new filter key, then an AND of two.
	base := func() AnalyticsFilter { return AnalyticsFilter{From: aFrom, To: aTo} }
	one := func(name string, f AnalyticsFilter) {
		t.Helper()
		s, err := tn.Summary(ctx, f)
		if err != nil || s.HookEvents != 1 || s.Conversations != 1 {
			t.Fatalf("%s: %+v %v", name, s, err)
		}
	}
	fa := base()
	fa.NormEvents = []string{"tool_use"}
	one("norm_event", fa)
	fa = base()
	fa.Events = []string{"PreToolUse"}
	one("event", fa)
	fa = base()
	fa.Tools = []string{"Read"}
	one("tool", fa)
	fa = base()
	fa.Models = []string{"m1"}
	one("model", fa)
	fa = base()
	fa.Sources = []string{"commit"}
	one("source", fa)
	fa = base()
	fa.ConversationIDs = []string{"cA"}
	one("conversation_id", fa)
	fa = base()
	fa.NormEvents = []string{"tool_use"}
	fa.Tools = []string{"Read"}
	one("norm_event AND tool", fa)
	fa = base()
	fa.Tools = []string{"Nope"}
	if s, err := tn.Summary(ctx, fa); err != nil || s.HookEvents != 0 {
		t.Fatalf("miss: %+v %v", s, err)
	}
}

func TestAnalyticsExplore(t *testing.T) {
	tn, f := fixture(t)
	ctx := context.Background()
	rows, trunc, err := tn.Explore(ctx, f, 18) // 14 facts + 4 rejections in the window
	if err != nil || trunc || len(rows) != 18 {
		t.Fatalf("limit exactly: n=%d trunc=%v err=%v", len(rows), trunc, err)
	}
	rows17, trunc, err := tn.Explore(ctx, f, 17)
	if err != nil || !trunc || len(rows17) != 17 {
		t.Fatalf("limit exceeded: n=%d trunc=%v err=%v", len(rows17), trunc, err)
	}
	// Newest first; at the same instant facts precede rejections (stable key: row_hash, then "rej-<id>").
	if rows[0].Type != "hook_event" || rows[0].TS != float64(aTo.Unix()) || rows[0].Tool != "Bash" ||
		rows[1].Type != "rejection" || rows[1].RejectionStage != "screen" || rows[1].TS != float64(aTo.Unix()) ||
		rows[1].Path != "docs/plans/p1/reports/b1.md" || rows[1].Kind != "report" || rows[1].Plan != "p1" || rows[1].Harness != "" {
		t.Fatalf("head: %+v %+v", rows[0], rows[1])
	}
	for i := 1; i < len(rows); i++ {
		if rows[i].TS > rows[i-1].TS {
			t.Fatalf("not newest first at %d", i)
		}
	}
	find := func(typ, path string, ts time.Time) ExploreRow {
		for _, r := range rows {
			if r.Type == typ && r.Path == path && r.TS == float64(ts.Unix()) {
				return r
			}
		}
		t.Fatalf("missing %s %s", typ, path)
		return ExploreRow{}
	}
	a2 := find("artifact_version", "docs/plans/p1/briefs/b1.md", ad(9, 29, 11, 0))
	if a2.SHA != "abc123" || a2.Source != "commit" || a2.ScreenVerdict != "pass" || a2.Kind != "brief" || a2.Plan != "p1" ||
		a2.ConversationID != "c1" || a2.Harness != "cursor" || a2.RepoID != "repoA" || a2.Event != "artifact" {
		t.Fatalf("a2: %+v", a2)
	}
	if a5 := find("artifact_version", "docs/plans/p2/briefs/b2.md", ad(10, 1, 10, 0)); a5.ScreenVerdict != "" {
		t.Fatalf("a5: %+v", a5)
	}
	if c := find("commit", "", ad(10, 3, 12, 0)); c.SHA != "def" {
		t.Fatalf("commit: %+v", c)
	}
	ff := f
	ff.Repos = []string{"repoB"}
	if rows, _, _ := tn.Explore(ctx, ff, 100); len(rows) != 3 { // hook, version, commit; no rejections
		t.Fatalf("repoB: %d", len(rows))
	}
}

func TestAnalyticsSummaryUsage(t *testing.T) {
	tn := usageFixture(t)
	got, err := tn.Summary(context.Background(), usageFilter())
	if err != nil {
		t.Fatal(err)
	}
	if got.ModelCalls != 3 || got.TokensIn != 1000 || got.TokensOut != 40 || got.TokensCacheRead != 400 ||
		got.TokensCacheWrite != 0 || got.TokensReasoning != 0 || got.UnpricedCalls != 1 {
		t.Fatalf("usage summary: %+v", got)
	}
	if math.Abs(got.CostUSD-0.2504) > 1e-9 {
		t.Fatalf("cost_usd: %v", got.CostUSD)
	}
}

func TestAnalyticsFacetsModels(t *testing.T) {
	ctx := context.Background()
	// The base fixture has no model or norm_event values, so both lists stay empty (empties
	// are excluded, unlike repo_id).
	tn, f := fixture(t)
	got, err := tn.Facets(ctx, f)
	if err != nil || got.Models != nil || got.NormEvents != nil {
		t.Fatalf("empty: %+v %v", got, err)
	}
	tn2 := usageFixture(t)
	got, err = tn2.Facets(ctx, usageFilter())
	wantModels := []string{"claude-test-unpriced", "grok-4.5", "kimi-k2.5"}
	if err != nil || !reflect.DeepEqual(got.Models, wantModels) ||
		!reflect.DeepEqual(got.NormEvents, []string{"usage"}) {
		t.Fatalf("models/norm: %+v %v", got, err)
	}
}

// bruteExplore reproduces the pre-change whole-window ordering in SQL, for comparison.
func bruteExplore(t *testing.T, tn *Tenant, f AnalyticsFilter, limit int) []struct {
	typ  string
	ts   float64
	path string
} {
	t.Helper()
	fw, fargs := f.factWhere()
	rw, rargs := f.rejWhere()
	args := append(append(fargs, rargs...), limit)
	rows, err := tn.rdb.QueryContext(context.Background(), `
		SELECT type, ts, path FROM (
			SELECT type, ts, path, row_hash AS k FROM facts WHERE `+fw+`
			UNION ALL
			SELECT 'rejection', at/1e9, path, printf('rej-%020d', id) FROM rejections WHERE `+rw+`)
		ORDER BY ts DESC, k ASC LIMIT ?`, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []struct {
		typ  string
		ts   float64
		path string
	}
	for rows.Next() {
		var r struct {
			typ  string
			ts   float64
			path string
		}
		if err := rows.Scan(&r.typ, &r.ts, &r.path); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAnalyticsExploreCap(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	base := ad(10, 1, 0, 0)
	var fs []afx
	for i := 0; i < 5; i++ {
		fs = append(fs, afx{typ: "hook_event", conv: "c", harness: "h", event: "e",
			ts: base.Add(time.Duration(i) * time.Minute), tool: "Bash"})
	}
	addFacts(t, tn, fs...)
	rej := func(id int, at time.Time) {
		mustExec(t, tn, `INSERT INTO rejections (stage,fact_type,conversation_id,path,content_hash,pattern,reason,at) VALUES (?,?,?,?,?,?,?,?)`,
			"precheck", "artifact_version", "c", fmt.Sprintf("p%d", id), "", "p", "r", at.UnixNano())
	}
	rej(1, base.Add(4*time.Minute+30*time.Second))
	rej(2, base.Add(2*time.Minute+30*time.Second))
	f := AnalyticsFilter{From: base, To: base.Add(time.Hour)}

	all, truncAll, err := tn.Explore(ctx, f, 100)
	if err != nil || truncAll || len(all) != 7 {
		t.Fatalf("all: n=%d trunc=%v err=%v", len(all), truncAll, err)
	}
	wantAll := bruteExplore(t, tn, f, 100)
	for i := range all {
		if all[i].Type != wantAll[i].typ || all[i].TS != wantAll[i].ts || all[i].Path != wantAll[i].path {
			t.Fatalf("row %d got %+v want %+v", i, all[i], wantAll[i])
		}
		if all[i].CostUSD != nil {
			t.Fatalf("row %d has cost for a non-usage fact", i)
		}
	}

	page, trunc, err := tn.Explore(ctx, f, 3)
	if err != nil || !trunc || len(page) != 3 {
		t.Fatalf("page: n=%d trunc=%v err=%v", len(page), trunc, err)
	}
	want := bruteExplore(t, tn, f, 4)
	for i := range page {
		if page[i].Type != want[i].typ || page[i].TS != want[i].ts || page[i].Path != want[i].path {
			t.Fatalf("page row %d got %+v want %+v", i, page[i], want[i])
		}
	}
}

func TestAnalyticsExploreUsageRow(t *testing.T) {
	tn := usageFixture(t)
	rows, trunc, err := tn.Explore(context.Background(), usageFilter(), 100)
	if err != nil || trunc || len(rows) != 4 {
		t.Fatalf("n=%d trunc=%v err=%v", len(rows), trunc, err)
	}
	var found bool
	for i := range rows {
		if rows[i].Model == "grok-4.5" {
			found = true
			if rows[i].NormEvent != "usage" || rows[i].CostUSD == nil || math.Abs(*rows[i].CostUSD-0.25) > 1e-9 {
				t.Fatalf("opencode usage row: %+v", rows[i])
			}
		}
	}
	if !found {
		t.Fatalf("opencode row missing: %+v", rows)
	}
}

func TestAnalyticsExploreFactsPlan(t *testing.T) {
	tn := openT(t, Options{})
	f := AnalyticsFilter{From: aFrom, To: aTo}
	w, args := f.factWhere()
	rows, err := tn.rdb.QueryContext(context.Background(), "EXPLAIN QUERY PLAN "+exploreFactsQuery(w), append(args, 3)...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var details []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	plan := strings.Join(details, "\n")
	t.Logf("explore facts plan:\n%s", plan)
	if strings.Contains(plan, "USE TEMP B-TREE FOR ORDER BY") {
		t.Fatalf("whole-window sort in plan: %s", plan)
	}
}
