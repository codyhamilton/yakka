package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const (
	proofFrom = "2026-11-08T00:00:00Z"
	proofTo   = "2026-11-08T23:59:59Z"
	proofWin  = "from=" + proofFrom + "&to=" + proofTo
)

// proofCatalogue builds a server with the real check catalogue so dynamic score names are
// validated as they are in production.
func proofCatalogue(t *testing.T) (*Server, *tenantState, string) {
	t.Helper()
	catalog, err := scorer.LoadChecks("../../catalogue")
	if err != nil {
		t.Fatal(err)
	}
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true, Checks: &catalog})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	checks := catalog.For("design")
	if len(checks) == 0 {
		t.Fatal("catalogue publishes no design check")
	}
	// Coverage aggregates scan into non-null ints, so an empty tenant cannot answer /schema.
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "coverage-seed", Harness: "seed",
		Event: "PreToolUse", NormEvent: "tool_use", Tool: "Read",
		TS: float64(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Unix())}, nil)
	return s, ts, checks[0].Name
}

func proofEncode(v any) string {
	raw, _ := json.Marshal(v)
	return url.QueryEscape(string(raw))
}

func proofCohortURL(grain string, include []any, predicate map[string]any, source map[string]any, op string) string {
	d := map[string]any{
		"v":         1,
		"grain":     grain,
		"scope":     map[string]any{"from": proofFrom, "to": proofTo, "tz": "UTC", "include": include, "exclude": []any{}},
		"predicate": predicate,
	}
	if source != nil {
		d["source"] = source
	}
	if op != "" {
		d["op"] = op
	}
	return "cohort=" + proofEncode(d)
}

func proofCohortURLExclude(grain string, exclude []any, predicate map[string]any, source map[string]any, op string) string {
	d := map[string]any{
		"v": 1, "grain": grain,
		"scope":     map[string]any{"from": proofFrom, "to": proofTo, "tz": "UTC", "include": []any{}, "exclude": exclude},
		"predicate": predicate,
	}
	if source != nil {
		d["source"] = source
	}
	if op != "" {
		d["op"] = op
	}
	return "cohort=" + proofEncode(d)
}

func proofRange(name string) map[string]any {
	return map[string]any{"range": map[string]any{"measure": name, "lo": 0, "hi": 1e12}}
}

func proofIn(name string) map[string]any {
	return map[string]any{"in": map[string]any{"lens": name, "values": []string{"cohort-proof-value"}}}
}

func proofSourceFor(grain, field, designCheck string) map[string]any {
	switch grain {
	case "content":
		return map[string]any{"kind": "design", "check": designCheck}
	case "artifact":
		return map[string]any{"kind": "design", "check": designCheck}
	case "time":
		return map[string]any{"fields": []string{field}, "bucket": "day", "bucket_step": 1}
	}
	return nil
}

// expandPredicateName turns a published dynamic placeholder into one concrete name the resolver
// validates. The catalogue supplies the check; design/brief/report are the published kinds.
func expandPredicateName(name, designCheck string) string {
	switch {
	case strings.Contains(name, ":<kind>"):
		return strings.ReplaceAll(name, "<kind>", "design")
	case strings.Contains(name, ":<check>"):
		return strings.ReplaceAll(name, "<check>", designCheck)
	}
	return name
}

type proofPair struct {
	grain string
	name  string
	kind  string // measure, lens, undefined
}

func TestCohortSchemaEnumeration(t *testing.T) {
	s, _, designCheck := proofCatalogue(t)
	schema := aok(t, s, "/v1/analytics/schema")
	grains := schema["grains"].(map[string]any)

	grainNames := make([]string, 0, len(grains))
	for name := range grains {
		grainNames = append(grainNames, name)
	}
	sort.Strings(grainNames)

	total, sourceGrains := 0, 0
	for _, grain := range grainNames {
		g := grains[grain].(map[string]any)
		predicate, ok := g["predicate"].(map[string]any)
		if !ok {
			// /schema also lists non-source grains such as activity; they offer no cohort pairs.
			continue
		}
		sourceGrains++
		for _, raw := range predicate["measures"].([]any) {
			name := expandPredicateName(raw.(string), designCheck)
			pair := proofPair{grain: grain, name: name, kind: "measure"}
			cohort := proofCohortURL(grain, []any{}, proofRange(name), proofSourceFor(grain, name, designCheck), "")
			code, body := aget(t, s, "/v1/analytics/entities?grain=session&"+proofWin+"&"+cohort)
			if code != 200 {
				t.Errorf("%s measure %s did not resolve: %d %v", pair.grain, pair.name, code, body)
			}
			total++
		}
		for _, raw := range predicate["lenses"].([]any) {
			name := expandPredicateName(raw.(string), designCheck)
			pair := proofPair{grain: grain, name: name, kind: "lens"}
			cohort := proofCohortURL(grain, []any{}, proofIn(name), proofSourceFor(grain, "commits", designCheck), "")
			code, body := aget(t, s, "/v1/analytics/entities?grain=session&"+proofWin+"&"+cohort)
			if code != 200 {
				t.Errorf("%s lens %s did not resolve: %d %v", pair.grain, pair.name, code, body)
			}
			total++
		}
		for _, raw := range predicate["undefined"].([]any) {
			entry := raw.(map[string]any)
			name := entry["name"].(string)
			reason := entry["reason"].(string)
			if reason == "" {
				t.Errorf("%s undefined lens %s has no reason", grain, name)
			}
			cohort := proofCohortURL(grain, []any{}, proofIn(name), proofSourceFor(grain, "commits", designCheck), "")
			code, body := aget(t, s, "/v1/analytics/entities?grain=session&"+proofWin+"&"+cohort)
			if code != 400 || body["code"] != "unsupported_join" || body["reason"] == "" {
				t.Errorf("%s undefined lens %s: want 400 unsupported_join with a reason, got %d %v", grain, name, code, body)
			}
			total++
		}
	}
	if total == 0 {
		t.Fatal("schema enumerated no cohort pairs")
	}
	t.Logf("resolved %d published cohort pairs across %d source grains", total, sourceGrains)
}

func TestCohortFeatureAdvertisedAfterProof(t *testing.T) {
	s, _ := queryFixture(t)
	features := aok(t, s, "/v1/analytics/schema")["features"].(map[string]any)
	if features["cohort"] != true {
		t.Fatalf("features.cohort = %v, want true after the enumeration", features["cohort"])
	}
}

// proofFixture seeds two sessions: s1 has two harnesses and a (mixed) model; s2 is single-valued
// on every derived lens. All facts of a session share one hour so a time target does not expand
// into new buckets under a cohort restriction.
func proofFixture(t *testing.T) (*Server, *tenantState, string) {
	t.Helper()
	s, ts, designCheck := proofCatalogue(t)
	at := func(hour, minute int) float64 {
		return float64(time.Date(2026, 11, 8, hour, minute, 0, 0, time.UTC).Unix())
	}
	hook := func(conv, harness, repo, model, tool string, hour, minute int) {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: conv, Harness: harness, RepoID: repo,
			Event: "PreToolUse", NormEvent: "usage", Tool: tool, Model: model, TokIn: 10, TS: at(hour, minute)}, nil)
	}
	commit := func(conv, harness, repo string, hour, minute int) {
		qadd(t, ts, store.FactRow{Type: "commit", ConversationID: conv, Harness: harness, RepoID: repo, Event: "commit", TS: at(hour, minute)}, nil)
	}
	artifact := func(conv, harness, repo, path string, hour, minute int) {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: conv, Harness: harness, RepoID: repo,
			Path: path, Source: "agent", ContentHash: keys.ContentHash([]byte(conv + path)), TS: at(hour, minute)}, nil)
	}
	// s1: alpha/model-1 and beta/model-2 facts, commits in repo-1 and artifacts in repo-2.
	hook("s1", "alpha", "repo-1", "model-1", "Read", 1, 0)
	hook("s1", "alpha", "repo-1", "model-1", "Read", 1, 5)
	hook("s1", "beta", "repo-2", "model-2", "Bash", 1, 10)
	commit("s1", "alpha", "repo-1", 1, 20)
	artifact("s1", "beta", "repo-2", "docs/plans/p1/DESIGN.md", 1, 30)
	artifact("s1", "beta", "repo-2", "docs/plans/p1/briefs/b.md", 1, 35)
	artifact("s1", "beta", "repo-2", "docs/plans/p1/reports/b.md", 1, 40)
	// s2: beta/model-2 only, repo-2 only.
	hook("s2", "beta", "repo-2", "model-2", "Bash", 2, 0)
	commit("s2", "beta", "repo-2", 2, 10)
	artifact("s2", "beta", "repo-2", "docs/plans/p2/DESIGN.md", 2, 20)
	artifact("s2", "beta", "repo-2", "docs/plans/p2/briefs/b.md", 2, 30)
	return s, ts, designCheck
}

func proofObservedValues(t *testing.T, s *Server, grain, designCheck string) map[string]string {
	t.Helper()
	path := "/v1/analytics/entities?grain=" + grain + "&" + proofWin
	if grain == "artifact" {
		path += "&check=" + url.QueryEscape(designCheck)
	}
	if grain == "time" {
		path += "&field=commits&field=hook_events&bucket=hour"
	}
	values := map[string]string{}
	for _, row := range rowsOf(aok(t, s, path), "rows") {
		if l, ok := row["l"].(map[string]any); ok {
			for name, raw := range l {
				if text := fmt.Sprint(raw); text != "" && text != "<nil>" {
					if _, seen := values[name]; !seen {
						values[name] = text
					}
				}
			}
		}
		if _, seen := values["id"]; !seen {
			if id, ok := row["id"]; ok {
				raw, _ := json.Marshal(id)
				values["id"] = string(raw)
			}
		}
	}
	if grain == "time" {
		for name, value := range map[string]string{
			"repo_id": "repo-2", "harness": "beta", "kind": "design", "plan": "p1",
			"norm_event": "usage", "event": "PreToolUse", "tool": "Read", "model": "model-2",
			"source": "agent", "conversation_id": "s1",
		} {
			if _, seen := values[name]; !seen {
				values[name] = value
			}
		}
	}
	return values
}

func proofTimeField(lens string) string {
	switch lens {
	case "kind", "plan", "source":
		return "artifact_versions"
	case "norm_event", "event", "tool":
		return "hook_events"
	case "model":
		return "model_calls"
	default:
		return "commits"
	}
}

func proofTimeFields(lens string) []string {
	primary := proofTimeField(lens)
	if primary != "commits" {
		return []string{primary, "commits"}
	}
	return []string{"commits", "hook_events"}
}

func proofScopeValue(name, value string) string {
	return url.QueryEscape(name) + "=" + url.QueryEscape(value)
}

// TestCohortInvariantFrozenScope proves 17.3.1 invariant 4: for every published filter name on
// every /entities grain, supplying the same include/exclude as ordinary filters reproduces the
// cohort's scope_n. s1 has two harnesses and a (mixed) model, so a fact-level harness filter and
// the lifetime-derived session lens would diverge.
func TestCohortInvariantFrozenScope(t *testing.T) {
	s, _, designCheck := proofFixture(t)
	grains := aok(t, s, "/v1/analytics/schema")["grains"].(map[string]any)

	for _, grain := range []string{"session", "artifact", "plan", "execution", "time"} {
		g := grains[grain].(map[string]any)
		values := proofObservedValues(t, s, grain, designCheck)
		filters := strs(g["filters"])
		if len(filters) == 0 {
			t.Fatalf("%s publishes no filters", grain)
		}
		for _, published := range filters {
			name := expandPredicateName(published, designCheck)
			value, ok := values[name]
			if !ok || value == "" {
				t.Fatalf("%s publishes filter %s but the fixture exposes no value for it", grain, published)
			}
			base := "/v1/analytics/entities?grain=" + grain + "&" + proofWin
			if grain == "artifact" {
				base += "&check=" + url.QueryEscape(designCheck)
			}
			source := map[string]any(nil)
			predicate := proofRange("commits")
			switch grain {
			case "artifact":
				source = map[string]any{"kind": "design", "check": designCheck}
				predicate = proofRange("versions")
			case "plan":
				predicate = proofRange("artifacts")
			case "execution":
				predicate = proofRange("ts")
			case "time":
				fields := proofTimeFields(name)
				for _, f := range fields {
					base += "&field=" + f
				}
				base += "&bucket=hour"
				source = map[string]any{"fields": fields, "bucket": "hour", "bucket_step": 1}
				predicate = proofRange(fields[0])
			}
			include := []any{map[string]any{"lens": name, "values": []string{value}}}
			panel := aok(t, s, base+"&"+proofScopeValue(name, value))
			panelN := populationOf(t, panel)["scope_n"].(float64)
			cohort := aok(t, s, base+"&"+proofScopeValue(name, value)+"&"+proofCohortURL(grain, include, predicate, source, "include"))
			cohortN := populationOf(t, cohort)["scope_n"].(float64)
			if panelN != cohortN {
				t.Errorf("%s filter %s include: panel scope_n %v != cohort scope_n %v", grain, published, panelN, cohortN)
			}
			if strings.Contains(name, ":") && !strings.HasPrefix(name, "band:") {
				continue
			}
			exclude := "exclude=" + url.QueryEscape(name) + ":" + url.QueryEscape(value)
			panel = aok(t, s, base+"&"+exclude)
			panelN = populationOf(t, panel)["scope_n"].(float64)
			cohort = aok(t, s, base+"&"+exclude+"&"+proofCohortURLExclude(grain, include, predicate, source, "include"))
			cohortN = populationOf(t, cohort)["scope_n"].(float64)
			if panelN != cohortN {
				t.Errorf("%s filter %s exclude: panel scope_n %v != cohort scope_n %v", grain, published, panelN, cohortN)
			}
		}
	}
}

// TestCohortInvariantScopeExcludeDiffersFromOp proves 17.3.1 invariant 5: scope.exclude narrows
// the source population before resolution, while op=exclude subtracts the resolved set afterwards.
func TestCohortInvariantScopeExcludeDiffersFromOp(t *testing.T) {
	s, ts := queryTenant(t)
	at := float64(time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC).Unix())
	for _, conv := range []string{"cut-a", "keep-b"} {
		qadd(t, ts, store.FactRow{Type: "commit", ConversationID: conv, Harness: "h", RepoID: "r", TS: at}, nil)
	}
	scope := []any{map[string]any{"lens": "id", "values": []string{"cut-a"}}}
	ids := func(body map[string]any) []string {
		out := []string{}
		for _, row := range rowsOf(body, "rows") {
			out = append(out, row["id"].(string))
		}
		sort.Strings(out)
		return out
	}
	path := "/v1/analytics/entities?grain=session&" + proofWin + "&"
	included := ids(aok(t, s, path+proofCohortURLExclude("session", scope, proofRange("commits"), nil, "include")))
	excluded := ids(aok(t, s, path+proofCohortURLExclude("session", scope, proofRange("commits"), nil, "exclude")))
	if !equalStrs(included, []string{"keep-b"}) {
		t.Fatalf("scope.exclude include rows = %v, want [keep-b]", included)
	}
	if !equalStrs(excluded, []string{"cut-a"}) {
		t.Fatalf("op=exclude rows = %v, want [cut-a] (scope.exclude and op differ)", excluded)
	}
}

// TestCohortInvariantSessionPartition proves 17.3.1 invariant 3 on a session target.
func TestCohortInvariantSessionPartition(t *testing.T) {
	s, ts := queryTenant(t)
	at := float64(time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC).Unix())
	for _, conv := range []string{"part-a", "part-b"} {
		qadd(t, ts, store.FactRow{Type: "commit", ConversationID: conv, Harness: "h", RepoID: "r", TS: at}, nil)
	}
	include := populationOf(t, aok(t, s, "/v1/analytics/summary?"+proofWin+"&"+proofCohortURL("session", []any{}, proofRange("commits"), nil, "include")))
	exclude := populationOf(t, aok(t, s, "/v1/analytics/summary?"+proofWin+"&"+proofCohortURL("session", []any{}, proofRange("commits"), nil, "exclude")))
	scope, inN, outN := include["scope_n"].(float64), include["cohort_n"].(float64), exclude["cohort_n"].(float64)
	if inN+outN != scope {
		t.Fatalf("cohort_n(include) %v + cohort_n(exclude) %v != scope_n %v", inN, outN, scope)
	}
	if inN != 2 || outN != 0 || scope != 2 {
		t.Fatalf("partition include=%v exclude=%v scope=%v, want 2/0/2", inN, outN, scope)
	}
}

func TestCohortInvariantAssociations(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	at := float64(now.Add(-10 * time.Minute).Unix())
	for _, conv := range []string{"assoc-in", "assoc-out"} {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: conv, Harness: "h", RepoID: "r",
			Event: "e", NormEvent: "tool_use", Tool: "Read", TS: at}, nil)
	}
	for _, conv := range []string{"assoc-in", "assoc-in", "assoc-out", "", "ghost"} {
		if err := ts.t.AppendRejection(context.Background(), store.Rejection{Stage: "screen", ConversationID: conv, Pattern: "p", Reason: "r"}); err != nil {
			t.Fatal(err)
		}
	}
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	win := "from=" + url.QueryEscape(from.Format(time.RFC3339)) + "&to=" + url.QueryEscape(to.Format(time.RFC3339))
	cohort := "cohort=" + url.QueryEscape(fmt.Sprintf(`{"v":1,"grain":"session","scope":{"from":%q,"to":%q,"tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"hook_events","lo":1,"hi":1000000}}}`,
		from.Format(time.RFC3339), to.Format(time.RFC3339)))
	join := func(path string) string {
		sep := "?"
		if strings.Contains(path, "?") {
			sep = "&"
		}
		return path + sep + win + "&" + cohort
	}
	checkIdentity := func(route string, rel map[string]any) {
		list, ok := rel["associations"].([]any)
		if !ok || len(list) == 0 {
			t.Errorf("%s relation has no associations: %v", route, rel)
			return
		}
		for _, raw := range list {
			a := raw.(map[string]any)
			total, associated := a["total_n"].(float64), a["associated_n"].(float64)
			missing := a["missing_by_reason"].(map[string]any)
			noID, orphan := missing["no_conversation_id"].(float64), missing["orphan_conversation_id"].(float64)
			if total != associated+noID+orphan {
				t.Errorf("%s %v: total_n %v != associated %v + missing %v + orphan %v", route, a["side"], total, associated, noID, orphan)
			}
			if a["contributor"] != "rejection" || a["unit"] != "rejection" || a["side"] == nil || a["treatment"] == nil {
				t.Errorf("%s association identity fields: %v", route, a)
			}
		}
	}
	for _, path := range []string{
		"/v1/analytics/query?measure=rejections&bucket=none",
		"/v1/analytics/series?metric=rejections&bucket=day",
		"/v1/analytics/summary",
		"/v1/analytics/explore",
		"/v1/analytics/activity",
		"/v1/analytics/entities?grain=time&field=rejections&field=commits&bucket=day",
	} {
		checkIdentity(path, relationOf(t, aok(t, s, join(path))))
	}

	timeCohort := "cohort=" + url.QueryEscape(fmt.Sprintf(`{"v":1,"grain":"time","scope":{"from":%q,"to":%q,"tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"rejections","lo":1,"hi":1000000}},"source":{"fields":["rejections"],"bucket":"day","bucket_step":1}}`,
		from.Format(time.RFC3339), to.Format(time.RFC3339)))
	body := aok(t, s, "/v1/analytics/entities?grain=time&field=rejections&field=commits&bucket=day&"+win+"&"+timeCohort)
	rel := relationOf(t, body)
	checkIdentity("time source", rel)
	if rel["resolved_n"].(float64) != 2 {
		t.Errorf("time rejection source resolved_n = %v, want 2 distinct associated sessions", rel["resolved_n"])
	}
	sides := map[string]map[string]any{}
	for _, raw := range rel["associations"].([]any) {
		a := raw.(map[string]any)
		sides[a["side"].(string)] = a
	}
	if sides["source"]["treatment"] != "selected" || sides["target"]["treatment"] != "dropped" {
		t.Errorf("association treatments = %v", sides)
	}
	for _, side := range []string{"source", "target"} {
		a := sides[side]
		if a == nil {
			t.Fatalf("missing %s association", side)
		}
		if a["total_n"] != float64(5) || a["associated_n"] != float64(3) {
			t.Errorf("%s association counts = %v, want total 5 associated 3", side, a)
		}
	}
}
