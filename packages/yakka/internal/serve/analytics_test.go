package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/screen"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// qaScorer is contentScorer with its score filed under a catalog check, so the scores route has a
// catalog check with values.
type qaScorer struct{ check string }

func (q qaScorer) Name() string { return "fake" }
func (qaScorer) Screen(ctx context.Context, c []byte, l []string) (scorer.Verdict, error) {
	return contentScorer{}.Screen(ctx, c, l)
}
func (q qaScorer) Score(ctx context.Context, c []byte, l []string) ([]scorer.Score, error) {
	s, err := contentScorer{}.Score(ctx, c, l)
	for i := range s {
		s[i].Check = q.check
	}
	return s, err
}

type fx = map[string]any

func aget(t *testing.T, s *Server, u string) (int, fx) {
	t.Helper()
	code, body := do(t, s.Handler(), "GET", u, "ka", "")
	var m fx
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		t.Fatalf("%s: not JSON: %s", u, body)
	}
	return code, m
}

func aok(t *testing.T, s *Server, u string) fx {
	t.Helper()
	code, m := aget(t, s, u)
	if code != 200 {
		t.Fatalf("%s: %d %v", u, code, m)
	}
	return m
}

func aerr(t *testing.T, s *Server, u string, code int, msg string) {
	t.Helper()
	c, m := aget(t, s, u)
	if c != code || m["error"] != msg {
		t.Fatalf("%s: want %d %q, got %d %v", u, code, msg, c, m)
	}
}

func rowsOf(m fx, k string) []fx {
	out := []fx{}
	for _, r := range m[k].([]any) {
		out = append(out, r.(map[string]any))
	}
	return out
}

func strs(v any) []string {
	out := []string{}
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestAnalyticsOutcome(t *testing.T) {
	checks, err := scorer.LoadChecks("../../catalogue")
	if err != nil {
		t.Fatal(err)
	}
	dcheck := checks.For("design")[0].Name
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{PollInterval: 20 * time.Millisecond,
		ScreenStep: func(ctx context.Context, tn *store.Tenant, h string) error {
			if b, err := tn.ReadPending(h); err == nil && strings.Contains(string(b), "UNSCREENED") {
				return tn.Promote(ctx, h, store.Screen{Verdict: "unscreened"})
			}
			return screen.Step(qaScorer{dcheck})(ctx, tn, h)
		}, Checks: &checks})
	t.Cleanup(func() { s.Close() })

	base := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -20)
	at := func(day, hh, mm int) float64 {
		return float64(base.AddDate(0, 0, day).Add(time.Duration(hh)*time.Hour + time.Duration(mm)*time.Minute).Unix())
	}
	rfc := func(ts float64) string { return time.Unix(int64(ts), 0).UTC().Format(time.RFC3339) }
	dayOf := func(d int) string { return base.AddDate(0, 0, d).Format("2006-01-02") }

	n := 0
	var facts []any
	add := func(conv, harness, repo, typ, event string, ts float64, extra fx) {
		n++
		f := fx{"id": fmt.Sprintf("f#%d", n), "type": typ, "conversation_id": conv, "harness": harness, "repo_id": repo, "event": event, "ts": ts}
		for k, v := range extra {
			f[k] = v
		}
		facts = append(facts, f)
	}
	art := func(conv, harness, repo, event string, ts float64, path, content, source string) {
		x := fx{"path": path, "content": content, "content_hash": keys.ContentHash([]byte(content)), "source": source}
		if source == "commit" {
			x["sha"] = "abc1"
		}
		add(conv, harness, repo, "artifact_version", event, ts, x)
	}
	// Hook events with a tool are inserted with store.Append and a payload-bearing raw (the shape of
	// an uncompacted ledger): ingest now stores hook facts without payload, and these analytics still
	// read payload.tool_name from raw until Phase 3 moves them to the tool column.
	var direct []store.FactRow
	addTool := func(conv, harness, repo, event string, ts float64, name string) {
		raw := mustJSON(fx{"type": "hook_event", "conversation_id": conv, "harness": harness, "repo_id": repo,
			"event": event, "ts": ts, "payload": fx{"tool_name": name}})
		rh, err := keys.RowHash(raw)
		if err != nil {
			t.Fatal(err)
		}
		direct = append(direct, store.FactRow{RowHash: rh, Type: "hook_event", ConversationID: conv, Harness: harness,
			Event: event, TS: ts, RepoID: repo, Raw: raw, Tool: name})
	}
	const (
		d1 = "docs/plans/01-x/DESIGN.md"
		b1 = "docs/plans/01-x/briefs/1-01-a.md"
		r1 = "docs/plans/01-x/reports/1-01-a.md"
		b2 = "docs/plans/02-y/briefs/2-01-b.md"
		b3 = "docs/plans/01-x/briefs/1-02-c.md"
		bn = "docs/plans/01-x/briefs/sub/1-03-n.md"
	)
	// Days are offsets from base (20 days ago, UTC midnight); the window starts at base.
	// c1: claude, r1. Its report is before the window, its commit inside.
	addTool("c1", "claude", "r1", "PreToolUse", at(1, 10, 0), "Bash")
	addTool("c1", "claude", "r1", "PreToolUse", at(1, 10, 5), "Bash")
	add("c1", "claude", "r1", "hook_event", "Stop", at(2, 9, 0), nil)
	art("c1", "claude", "r1", "Write", at(1, 11, 0), d1, "# d1 score=0.2\n", "worktree")
	art("c1", "claude", "r1", "Write", at(2, 10, 0), b1, "# b1\n", "worktree")
	add("c1", "claude", "r1", "commit", "commit", at(3, 12, 0), fx{"sha": "abc1"})
	art("c1", "claude", "r1", "commit", at(3, 12, 0), d1, "# d1 score=0.2\n", "commit")
	art("c1", "claude", "r1", "Write", at(-10, 9, 0), r1, "# rep1\n", "worktree")
	// c2: cursor, r2. Its commit is before the window and it has no report.
	addTool("c2", "cursor", "r2", "PostToolUse", at(5, 8, 0), "Read")
	art("c2", "cursor", "r2", "Write", at(6, 9, 0), b2, "# b2\n", "worktree")
	art("c2", "cursor", "r2", "Write", at(6, 9, 30), "docs/plans/02-y/DESIGN.md", "# d2 score=0.6\n", "worktree")
	art("c2", "cursor", "r2", "Write", at(7, 9, 0), "docs/plans/03-z/DESIGN.md", "# d3 score=0.9\n", "worktree")
	add("c2", "cursor", "r2", "commit", "commit", at(-9, 12, 0), fx{"sha": "def2"})
	// c3: claude, r1. A started brief and a nested brief path.
	art("c3", "claude", "r1", "Write", at(10, 9, 0), b3, "# b3 UNSCREENED\n", "worktree")
	art("c3", "claude", "r1", "Write", at(10, 9, 10), bn, "# nest\n", "worktree")
	add("c3", "claude", "r1", "hook_event", "Stop", at(10, 9, 20), nil)
	// c4: cursor, r1. One hook event is rejected by precheck for carrying a secret.
	addTool("c4", "cursor", "r1", "PreToolUse", at(12, 8, 0), "Bash")
	add("c4", "cursor", "r1", "hook_event", "PreToolUse", at(12, 8, 30), fx{"payload": fx{"tool_name": "Bash", "cmd": "AKIA" + "IOSFODNN7" + "EXAMPLE"}})
	body, _ := json.Marshal(fx{"facts": facts})
	if code, out := do(t, s.Handler(), "POST", "/v1/ingest", "ka", string(body)); code != 200 || !strings.Contains(out, "rejected") {
		t.Fatal(code, out)
	}
	if ts, err := s.tenant("a"); err != nil {
		t.Fatal(err)
	} else if _, err := ts.t.Append(context.Background(), direct); err != nil {
		t.Fatal(err)
	}
	win := "from=" + url.QueryEscape(base.Format(time.RFC3339)) + "&to=" + url.QueryEscape(time.Now().UTC().Add(time.Hour).Format(time.RFC3339))
	A := "/v1/analytics/"

	waitFor(t, "scored", func() bool {
		if healthField(t, s, "pending") != 0 {
			return false
		}
		code, m := aget(t, s, A+"scores?kind=design&"+win)
		if code != 200 {
			return false
		}
		for _, c := range rowsOf(m, "checks") {
			if c["name"] == dcheck && c["n"].(float64) == 3 {
				return true
			}
		}
		return false
	})

	t.Run("summary", func(t *testing.T) {
		m := aok(t, s, A+"summary?"+win)
		want := fx{"conversations": 4.0, "hook_events": 6.0, "artifact_versions": 8.0, "distinct_content": 7.0, "commits": 1.0,
			"by_kind":    fx{"design": 4.0, "brief": 3.0, "report": 0.0, "other": 1.0},
			"by_source":  fx{"worktree": 7.0, "commit": 1.0},
			"rejections": fx{"precheck": 1.0, "screen": 0.0},
			"screens":    fx{"pass": 6.0, "unscreened": 1.0}}
		for k, v := range want {
			if !reflect.DeepEqual(m[k], v) {
				t.Errorf("summary %s = %v, want %v", k, m[k], v)
			}
		}
		if m["from"] != base.Format(time.RFC3339) {
			t.Errorf("from = %v", m["from"])
		}
		if _, err := time.Parse(time.RFC3339, m["to"].(string)); err != nil {
			t.Errorf("to = %v", m["to"])
		}
		if d := aok(t, s, A+"summary"); d["hook_events"] != 6.0 { // default window: the last 30 days
			t.Errorf("default window: %v", d)
		}
		f := aok(t, s, A+"summary?"+win+"&harness=cursor&repo_id=r2")
		if f["conversations"] != 1.0 || f["artifact_versions"] != 3.0 {
			t.Errorf("filtered summary: %v", f)
		}
		k := aok(t, s, A+"summary?"+win+"&kind=brief&kind=report&plan=01-x")
		if k["artifact_versions"] != 2.0 || k["hook_events"] != 0.0 {
			t.Errorf("kind+plan summary: %v", k)
		}
		if m["model_calls"] != 0.0 || m["unpriced_calls"] != 0.0 || m["cost_usd"] != 0.0 ||
			m["tokens_in"] != 0.0 || m["tokens_out"] != 0.0 || m["tokens_cache_read"] != 0.0 ||
			m["tokens_cache_write"] != 0.0 || m["tokens_reasoning"] != 0.0 {
			t.Errorf("summary usage fields: %v", m)
		}
	})

	t.Run("errors", func(t *testing.T) {
		aerr(t, s, A+"summary?from=yesterday", 400, "from and to must be RFC3339")
		aerr(t, s, A+"summary?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z", 400, "from is after to")
		aerr(t, s, A+"summary?kind=plan", 400, "kind must be design, brief or report")
		aerr(t, s, A+"series?bucket=day", 400, "metric must be hook_events, artifact_versions, commits, conversations or rejections")
		aerr(t, s, A+"series?metric=commits", 400, "bucket must be day or week")
		aerr(t, s, A+"series?metric=conversations&bucket=day&group=repo_id", 400, "group not allowed for metric")
		aerr(t, s, A+"series?metric=commits&bucket=day&group=kind", 400, "group not allowed for metric")
		aerr(t, s, A+"executions?limit=x", 400, "limit must be an integer")
		aerr(t, s, A+"executions?cursor=%25%25", 400, "cursor mismatch")
		aerr(t, s, A+"scores?"+win, 400, "kind required")
		aerr(t, s, A+"scores?kind=design&kind=brief", 400, "kind required")
		aerr(t, s, A+"scores?kind=nope", 400, "kind must be design, brief or report")
		wide := "from=2025-01-01T00:00:00Z&to=2026-02-05T00:00:00Z" // 401 days inclusive
		aok(t, s, A+"summary?"+wide)
		aok(t, s, A+"series?metric=commits&bucket=day&"+wide)
		aok(t, s, A+"executions?"+wide)
		if m := aok(t, s, A+"series?metric=commits&bucket=week&"+wide); m["bucket"] != "week" {
			t.Errorf("week series: %v", m)
		}
		aok(t, s, A+"summary?from=2025-01-01T00:00:00Z&to=2026-02-04T00:00:00Z") // 400 days
	})

	t.Run("facets", func(t *testing.T) {
		m := aok(t, s, A+"facets?"+win+"&repo_id=r2&kind=report") // dimension filters do not narrow facets
		if got := strs(m["repos"]); !reflect.DeepEqual(got, []string{"r1", "r2"}) {
			t.Errorf("repos %v", got)
		}
		if got := strs(m["harnesses"]); !reflect.DeepEqual(got, []string{"claude", "cursor"}) {
			t.Errorf("harnesses %v", got)
		}
		if got := strs(m["kinds"]); !reflect.DeepEqual(got, []string{"design", "brief"}) {
			t.Errorf("kinds %v", got)
		}
		if got := strs(m["plans"]); !reflect.DeepEqual(got, []string{"", "01-x", "02-y", "03-z"}) {
			t.Errorf("plans %v", got)
		}
		if got := strs(m["events"]); !reflect.DeepEqual(got, []string{"PostToolUse", "PreToolUse", "Stop", "Write", "commit"}) {
			t.Errorf("events %v", got)
		}
		tools := rowsOf(m, "tools")
		if len(tools) != 2 || tools[0]["name"] != "Bash" || tools[0]["n"] != 3.0 || tools[1]["name"] != "Read" || tools[1]["n"] != 1.0 {
			t.Errorf("tools %v", tools)
		}
		cs := rowsOf(m, "checks")
		if len(cs) != checks.Count("design")+checks.Count("brief")+checks.Count("report") || cs[0]["kind"] != "design" || cs[0]["name"] != dcheck || len(cs[0]) != 2 {
			t.Errorf("checks %v", cs)
		}
		if got := strs(m["models"]); len(got) != 0 {
			t.Errorf("models %v", got)
		}
		if got := strs(m["norm_events"]); !reflect.DeepEqual(got, []string{"turn_end"}) {
			t.Errorf("norm_events %v", got)
		}
	})

	t.Run("series", func(t *testing.T) {
		type pt struct {
			T string
			N float64
		}
		get := func(u string) map[string][]pt {
			m := aok(t, s, A+"series?"+u)
			out := map[string][]pt{}
			var order []string
			for _, e := range rowsOf(m, "series") {
				k := e["key"].(string)
				order = append(order, k)
				ps := []pt{}
				for _, p := range e["points"].([]any) {
					ps = append(ps, pt{p.(map[string]any)["t"].(string), p.(map[string]any)["n"].(float64)})
				}
				out[k] = ps
			}
			if !sort.StringsAreSorted(order) {
				t.Errorf("%s: keys not ascending: %v", u, order)
			}
			return out
		}
		got := get("metric=hook_events&bucket=day&group=tool&" + win)
		want := map[string][]pt{"": {{dayOf(2), 1}, {dayOf(10), 1}}, "Bash": {{dayOf(1), 2}, {dayOf(12), 1}}, "Read": {{dayOf(5), 1}}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("hook_events by tool: %v", got)
		}
		got = get("metric=artifact_versions&bucket=day&" + win)
		want = map[string][]pt{"all": {{dayOf(1), 1}, {dayOf(2), 1}, {dayOf(3), 1}, {dayOf(6), 2}, {dayOf(7), 1}, {dayOf(10), 2}}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("artifact_versions: %v", got)
		}
		got = get("metric=artifact_versions&bucket=day&group=source&" + win)
		if len(got["commit"]) != 1 || len(got["worktree"]) != 5 {
			t.Errorf("by source: %v", got)
		}
		got = get("metric=commits&bucket=day&group=harness&" + win)
		if !reflect.DeepEqual(got, map[string][]pt{"claude": {{dayOf(3), 1}}}) {
			t.Errorf("commits: %v", got)
		}
		got = get("metric=conversations&bucket=day&group=harness&" + win)
		if !reflect.DeepEqual(got["cursor"], []pt{{dayOf(5), 1}, {dayOf(6), 1}, {dayOf(7), 1}, {dayOf(12), 1}}) {
			t.Errorf("conversations: %v", got)
		}
		got = get("metric=rejections&bucket=day&group=stage&" + win)
		if len(got["precheck"]) != 1 || got["precheck"][0].N != 1 {
			t.Errorf("rejections: %v", got)
		}
		m := aok(t, s, A+"series?metric=commits&bucket=day&repo_id=nope&"+win)
		if string(mustJSON(m["series"])) != `[{"key":"all","points":[]}]` {
			t.Errorf("empty series: %s", mustJSON(m["series"]))
		}
	})

	t.Run("scores", func(t *testing.T) {
		vals := []float64{0.2, 0.6, 0.9}
		m := aok(t, s, A+"scores?kind=design&"+win)
		if m["kind"] != "design" {
			t.Fatal(m)
		}
		cs := rowsOf(m, "checks")
		if len(cs) != checks.Count("design") {
			t.Fatalf("checks %v", cs)
		}
		for _, c := range cs {
			if c["name"] != dcheck {
				if c["n"] != 0.0 || c["median"] != 0.0 || c["max"] != 0.0 {
					t.Errorf("unscored check not zero: %v", c)
				}
				continue
			}
			want := fx{"name": dcheck, "n": 3.0, "min": round3(percentile(vals, 0)), "p25": round3(percentile(vals, .25)),
				"median": round3(percentile(vals, .5)), "p75": round3(percentile(vals, .75)), "max": round3(percentile(vals, 1))}
			if !reflect.DeepEqual(c, want) || c["p25"] != 0.4 || c["p75"] != 0.75 {
				t.Errorf("scores %v want %v", c, want)
			}
		}
		// a window of days 0-3 holds only the 0.2 design content
		w := aok(t, s, A+"scores?kind=design&from="+url.QueryEscape(base.Format(time.RFC3339))+"&to="+url.QueryEscape(base.AddDate(0, 0, 3).Format(time.RFC3339)))
		for _, c := range rowsOf(w, "checks") {
			if c["name"] == dcheck && (c["n"] != 1.0 || c["median"] != 0.2) {
				t.Errorf("narrow window %v", c)
			}
		}
		rep := rowsOf(aok(t, s, A+"scores?kind=report&"+win), "checks")
		if len(rep) != checks.Count("report") || rep[0]["n"] != 0.0 {
			t.Errorf("report scores %v", rep)
		}
	})

	t.Run("executions", func(t *testing.T) {
		m := aok(t, s, A+"executions?"+win)
		rows := rowsOf(m, "rows")
		if !reflect.DeepEqual(m["counts"], map[string]any{"complete": 1.0, "unreported": 1.0, "started": 1.0}) {
			t.Errorf("counts %v", m["counts"])
		}
		if _, has := m["next"]; has {
			t.Errorf("next on last page: %v", m["next"])
		}
		var got []string
		for _, r := range rows {
			got = append(got, fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s", r["repo_id"], r["plan"], r["conversation_id"], r["brief_path"], r["harness"], r["shape"], r["ts"]))
			if len(r) != 7 {
				t.Errorf("row keys %v", r)
			}
		}
		wantRows := []string{
			"r1|01-x|c3|" + b3 + "|claude|started|" + rfc(at(10, 9, 0)),
			"r2|02-y|c2|" + b2 + "|cursor|unreported|" + rfc(at(6, 9, 0)),
			"r1|01-x|c1|" + b1 + "|claude|complete|" + rfc(at(2, 10, 0)),
		}
		if !reflect.DeepEqual(got, wantRows) {
			t.Errorf("rows:\n%v\nwant\n%v", got, wantRows)
		}
		// two-page walk: limit=2 over three rows; concatenation equals the one-page result
		p1 := aok(t, s, A+"executions?limit=2&"+win)
		nx := p1["next"].(string)
		p2 := aok(t, s, A+"executions?limit=2&"+win+"&cursor="+url.QueryEscape(nx))
		if _, has := p2["next"]; has {
			t.Errorf("page 2 next %v", p2["next"])
		}
		if !reflect.DeepEqual(append(rowsOf(p1, "rows"), rowsOf(p2, "rows")...), rows) || !reflect.DeepEqual(p2["counts"], m["counts"]) {
			t.Errorf("walk differs: %v %v", p1, p2)
		}
		// limit=1 walk
		var walk []fx
		u := A + "executions?limit=1&" + win
		for i := 0; i < 10; i++ {
			p := aok(t, s, u)
			walk = append(walk, rowsOf(p, "rows")...)
			c, has := p["next"]
			if !has {
				break
			}
			u = A + "executions?limit=1&" + win + "&cursor=" + url.QueryEscape(c.(string))
		}
		if !reflect.DeepEqual(walk, rows) {
			t.Errorf("limit=1 walk %v != %v", walk, rows)
		}
		aerr(t, s, A+"executions?limit=2&"+win+"&repo_id=r1&cursor="+url.QueryEscape(nx), 400, "cursor mismatch")
		aerr(t, s, A+"conversations?limit=2&"+win+"&cursor="+url.QueryEscape(nx), 400, "cursor mismatch")
		aok(t, s, A+"executions?limit=0&"+win) // clamped, not rejected
		aok(t, s, A+"executions?limit=9999&"+win)
	})

	t.Run("conversations", func(t *testing.T) {
		m := aok(t, s, A+"conversations?"+win)
		rows := rowsOf(m, "rows")
		var ids []string
		for _, r := range rows {
			ids = append(ids, r["conversation_id"].(string))
		}
		if !reflect.DeepEqual(ids, []string{"c4", "c3", "c2", "c1"}) {
			t.Fatalf("order %v", ids)
		}
		want := fx{"conversation_id": "c1", "harness": "claude", "model": "", "repos": []any{"r1"}, "first_ts": rfc(at(1, 10, 0)), "last_ts": rfc(at(3, 12, 0)),
			"hook_events": 3.0, "artifact_versions": 3.0, "commits": 1.0, "kinds": []any{"brief", "design"},
			"model_calls": 0.0, "unpriced_calls": 0.0, "cost_usd": 0.0, "tokens_in": 0.0, "tokens_out": 0.0}
		if !reflect.DeepEqual(rows[3], want) {
			t.Errorf("c1 %v want %v", rows[3], want)
		}
		for _, k := range []string{"model", "model_calls", "unpriced_calls", "cost_usd", "tokens_in", "tokens_out"} {
			if _, ok := rows[0][k]; !ok {
				t.Errorf("row missing %q", k)
			}
		}
		if !reflect.DeepEqual(rows[0]["kinds"], []any{}) {
			t.Errorf("c4 kinds %v", rows[0]["kinds"])
		}
		p1 := aok(t, s, A+"conversations?limit=2&"+win)
		nx := p1["next"].(string)
		p2 := aok(t, s, A+"conversations?limit=2&"+win+"&cursor="+url.QueryEscape(nx))
		if _, has := p2["next"]; has {
			t.Errorf("last page has next")
		}
		if !reflect.DeepEqual(append(rowsOf(p1, "rows"), rowsOf(p2, "rows")...), rows) {
			t.Errorf("paged conversations differ")
		}
		aerr(t, s, A+"conversations?limit=2&"+win+"&plan=01-x&cursor="+url.QueryEscape(nx), 400, "cursor mismatch")
	})

	t.Run("explore", func(t *testing.T) {
		m := aok(t, s, A+"explore?"+win)
		rows := rowsOf(m, "rows")
		if len(rows) != 16 || m["truncated"] != false {
			t.Fatalf("rows %d truncated %v", len(rows), m["truncated"])
		}
		cols := []string{"type", "ts", "harness", "repo_id", "plan", "kind", "event", "tool", "norm_event", "model", "path", "conversation_id", "source", "sha", "screen_verdict", "rejection_stage"}
		sort.Strings(cols)
		for _, r := range rows {
			var ks []string
			for k, v := range r {
				ks = append(ks, k)
				if k == "priced" {
					if _, ok := v.(bool); !ok {
						t.Fatalf("priced not boolean: %v", v)
					}
				} else if _, ok := v.(string); !ok {
					t.Fatalf("%s not a string: %v", k, v)
				}
			}
			sort.Strings(ks)
			withPriced := append(append([]string(nil), cols...), "priced")
			sort.Strings(withPriced)
			if !reflect.DeepEqual(ks, cols) && !reflect.DeepEqual(ks, withPriced) {
				t.Fatalf("columns %v", ks)
			}
		}
		if rows[0]["type"] != "rejection" || rows[0]["rejection_stage"] != "precheck" {
			t.Errorf("first row %v", rows[0])
		}
		if last := rows[15]; last["type"] != "hook_event" || last["tool"] != "Bash" || last["ts"] != rfc(at(1, 10, 0)) {
			t.Errorf("last row %v", last)
		}
		for i := 1; i < len(rows); i++ {
			if rows[i]["ts"].(string) > rows[i-1]["ts"].(string) {
				t.Errorf("not newest first at %d", i)
			}
		}
		var found bool
		for _, r := range rows {
			if r["path"] == d1 && r["source"] == "commit" {
				found = r["sha"] == "abc1" && r["kind"] == "design" && r["plan"] == "01-x" && r["screen_verdict"] == "pass"
			}
		}
		if !found {
			t.Errorf("commit-sourced design row missing or wrong")
		}
		old := exploreCap
		defer func() { exploreCap = old }()
		exploreCap = 5
		c := aok(t, s, A+"explore?"+win)
		if len(rowsOf(c, "rows")) != 5 || c["truncated"] != true {
			t.Errorf("capped: %d %v", len(rowsOf(c, "rows")), c["truncated"])
		}
		seen := append([]map[string]any(nil), rowsOf(c, "rows")...)
		for c["next"] != nil {
			next := url.QueryEscape(c["next"].(string))
			c = aok(t, s, A+"explore?"+win+"&cursor="+next)
			seen = append(seen, rowsOf(c, "rows")...)
		}
		if len(seen) != 16 {
			t.Fatalf("paged explore rows %d, want 16", len(seen))
		}
		exploreCap = 16
		c = aok(t, s, A+"explore?"+win)
		if len(rowsOf(c, "rows")) != 16 || c["truncated"] != false {
			t.Errorf("cap equal to rows: %v", c["truncated"])
		}
	})

	t.Run("access", func(t *testing.T) {
		// Every analytics route refuses a keyed request without a valid key: tenant data is never
		// served unauthenticated.
		for _, rt := range []string{"facets", "summary", "series?metric=hook_events&bucket=day", "scores?kind=design",
			"executions", "conversations", "explore"} {
			if code, _ := do(t, s.Handler(), "GET", A+rt, "", ""); code != 401 {
				t.Errorf("%s no key: %d", rt, code)
			}
			if code, _ := do(t, s.Handler(), "GET", A+rt, "wrong", ""); code != 401 {
				t.Errorf("%s bad key: %d", rt, code)
			}
		}
		code, body := do(t, s.Handler(), "GET", A+"nope", "ka", "")
		if code != 404 || body != "{\"error\":\"not found\"}\n" {
			t.Errorf("nope: %d %s", code, body)
		}
		if code, _ := do(t, s.Handler(), "POST", A+"summary", "ka", "{}"); code != 405 {
			t.Errorf("post: %d", code)
		}
	})
}

func TestAnalyticsEmptyTenant(t *testing.T) {
	s, _ := newServer(t, true)
	m := aok(t, s, "/v1/analytics/facets")
	for _, k := range []string{"repos", "harnesses", "kinds", "plans", "events", "tools", "checks"} {
		if string(mustJSON(m[k])) != "[]" {
			t.Errorf("facets %s: %s", k, mustJSON(m[k]))
		}
	}
	if m := aok(t, s, "/v1/analytics/scores?kind=design"); string(mustJSON(m["checks"])) != "[]" {
		t.Errorf("empty scores: %v", m)
	}
	for _, r := range []string{"executions", "conversations", "explore"} {
		if m := aok(t, s, "/v1/analytics/"+r); string(mustJSON(m["rows"])) != "[]" {
			t.Errorf("%s rows: %v", r, m["rows"])
		}
	}
}
