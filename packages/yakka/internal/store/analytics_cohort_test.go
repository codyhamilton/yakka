package store

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestAnalyticsCohortCanonicalizesPredicates(t *testing.T) {
	base := `"v":1,"grain":"session","scope":{"from":"2025-01-01T00:00:00Z","to":"2025-01-31T00:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":%s`
	a, err := ParseCohortDefinition([]byte("{" + fmt.Sprintf(base, `{"and":[{"in":{"lens":"harness","values":["z","a","a"]}},{"range":{"measure":"commits","lo":1.0,"hi":2}}]}`) + "}"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := ParseCohortDefinition([]byte("{" + fmt.Sprintf(base, `{"and":[{"range":{"hi":2.0,"lo":1,"measure":"commits"}},{"in":{"values":["a","z"],"lens":"harness"}}]}`) + "}"))
	if err != nil {
		t.Fatal(err)
	}
	if a.Key != b.Key {
		t.Fatalf("canonical keys differ: %s != %s", a.Key, b.Key)
	}
}

func TestAnalyticsCohortPositiveArtifactResolutionUsesSelectedVersionWriter(t *testing.T) {
	tn, _ := fixture(t)
	defer tn.Close()
	raw := []byte(`{"v":1,"grain":"artifact","scope":{"from":"2026-09-28T00:00:00Z","to":"2026-10-05T12:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":{"in":{"lens":"kind","values":["design"]}},"op":"exclude"}`)
	c, err := ParseCohortDefinition(raw)
	if err != nil {
		t.Fatal(err)
	}
	query, args, rel, err := CohortSessionSubquery(c)
	if err != nil {
		t.Fatal(err)
	}
	if rel.Mapping != "artifact_selected_version_to_earliest_writer" {
		t.Fatalf("relation=%+v", rel)
	}
	rows, err := tn.rdb.QueryContext(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("resolver SQL: %v\n%s", err, query)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		got = append(got, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("positive resolved sessions=%v want [c1]", got)
	}
	if strings.Contains(strings.ToUpper(query), "NOT (") {
		t.Fatalf("op=exclude complemented source predicate: %s", query)
	}
}

func TestAnalyticsCohortSourceQueriesStayInSQLiteForSupportedGrains(t *testing.T) {
	tn, _ := fixture(t)
	defer tn.Close()
	for _, tc := range []struct{ grain, predicate string }{
		{"session", `{"not":{"range":{"measure":"commits","lo":0,"hi":10}}}`},
		{"execution", `{"range":{"measure":"ts","lo":0,"hi":2000000000}}`},
		{"plan", `{"range":{"measure":"sessions","lo":0,"hi":10}}`},
		{"time", `{"range":{"measure":"commits","lo":0,"hi":10}}`},
	} {
		t.Run(tc.grain, func(t *testing.T) {
			rawText := fmt.Sprintf(`{"v":1,"grain":%q,"scope":{"from":"2026-09-28T00:00:00Z","to":"2026-10-05T12:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":%s}`, tc.grain, tc.predicate)
			if tc.grain == "time" {
				rawText = strings.TrimSuffix(rawText, "}") + `,"source":{"fields":["commits"],"bucket":"day","bucket_step":1}}`
			}
			raw := []byte(rawText)
			c, err := ParseCohortDefinition(raw)
			if err != nil {
				t.Fatal(err)
			}
			query, args, _, err := CohortSessionSubquery(c)
			if err != nil {
				t.Fatal(err)
			}
			rows, err := tn.rdb.QueryContext(context.Background(), query, args...)
			if err != nil {
				t.Fatalf("resolver SQL: %v\n%s", err, query)
			}
			got := []string{}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					t.Fatal(err)
				}
				if tc.grain == "time" {
					got = append(got, id)
				}
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			if tc.grain == "time" {
				sort.Strings(got)
				if !reflect.DeepEqual(got, []string{"c4", "c5"}) {
					t.Fatalf("time contributors=%v want [c4 c5]", got)
				}
			}
			rows.Close()
		})
	}
}

func TestAnalyticsCohortRejectsMalformedAndUnsupported(t *testing.T) {
	base := func(g, p string) []byte {
		return []byte(`{"v":1,"grain":"` + g + `","scope":{"from":"2025-01-01T00:00:00Z","to":"2025-01-31T00:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":` + p + `}`)
	}
	for _, tc := range []struct {
		name string
		raw  []byte
		want error
	}{
		{"unknown operator", base("session", `{"eq":{"measure":"commits","value":2}}`), ErrCohortInvalid},
		{"unpublished measure", base("session", `{"range":{"measure":"phase","lo":0,"hi":1}}`), ErrCohortInvalid},
		{"time source metadata required", base("time", `{"range":{"measure":"commits","lo":0,"hi":1}}`), ErrCohortInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseCohortDefinition(tc.raw)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err=%v want %v", err, tc.want)
			}
		})
	}
}

func TestAnalyticsTimeCohortRequiresAndAcceptsFrozenSource(t *testing.T) {
	raw := []byte(`{"v":1,"grain":"time","scope":{"from":"2025-01-01T00:00:00Z","to":"2025-01-31T00:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"commits","lo":1,"hi":2}},"source":{"fields":["commits"],"bucket":"day","bucket_step":1}}`)
	if _, err := ParseCohortDefinition(raw); err != nil {
		t.Fatalf("parse frozen time source: %v", err)
	}
}

func TestAnalyticsTimeCohortReplaysLocalGridAndUsageIdentity(t *testing.T) {
	tn, _ := fixture(t)
	defer tn.Close()
	from := time.Date(2026, 11, 1, 4, 0, 0, 0, time.UTC)
	to := time.Date(2026, 11, 1, 7, 0, 0, 0, time.UTC)
	addFacts(t, tn,
		afx{typ: "commit", conv: "commit-writer", harness: "h", ts: from.Add(30 * time.Minute)},
		afx{typ: "hook_event", conv: "other-day", harness: "h", event: "hook", ts: from.Add(90 * time.Minute)},
	)
	usageRows := []FactRow{
		ufact(801, "claude", "test-unpriced", "usage-writer", `{"backfill":{"ref":"same-message"},"n":801}`, from.Add(30*time.Minute), 0, 1, 0, 0, 0, nil),
		ufact(802, "claude", "test-unpriced", "usage-writer", `{"backfill":{"ref":"same-message"},"n":802}`, from.Add(90*time.Minute), 0, 9, 0, 0, 0, nil),
	}
	if _, err := tn.Append(context.Background(), usageRows); err != nil {
		t.Fatal(err)
	}

	resolve := func(fields, predicate string) []string {
		t.Helper()
		raw := fmt.Sprintf(`{"v":1,"grain":"time","scope":{"from":%q,"to":%q,"tz":"America/New_York","include":[],"exclude":[]},"predicate":%s,"source":{"fields":%s,"bucket":"day","bucket_step":1}}`, from.Format(time.RFC3339), to.Format(time.RFC3339), predicate, fields)
		c, err := ParseCohortDefinition([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		query, args, _, err := CohortSessionSubquery(c)
		if err != nil {
			t.Fatal(err)
		}
		rows, err := tn.rdb.QueryContext(context.Background(), query, args...)
		if err != nil {
			t.Fatalf("resolver SQL: %v\n%s", err, query)
		}
		defer rows.Close()
		var got []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			got = append(got, id)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		sort.Strings(got)
		return got
	}
	if got := resolve(` ["commits"] `, `{"range":{"measure":"commits","lo":1,"hi":1}}`); !reflect.DeepEqual(got, []string{"commit-writer"}) {
		t.Fatalf("New York day cohort contributors=%v, want commit-writer only", got)
	}
	if got := resolve(` ["tokens_out"] `, `{"range":{"measure":"tokens_out","lo":9,"hi":9}}`); !reflect.DeepEqual(got, []string{"usage-writer"}) {
		t.Fatalf("deduplicated usage contributors=%v, want usage-writer", got)
	}
}

func TestAnalyticsTimeCohortRejectsUnassociatedRejectionContributors(t *testing.T) {
	tn, _ := fixture(t)
	defer tn.Close()
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	for _, conv := range []string{"c1", "orphan"} {
		mustExec(t, tn, `INSERT INTO rejections (stage,fact_type,conversation_id,path,content_hash,pattern,reason,at) VALUES (?,?,?,?,?,?,?,?)`,
			"screen", "artifact_version", conv, "", "", "p", "r", from.Add(20*time.Minute).UnixNano())
	}
	raw := fmt.Sprintf(`{"v":1,"grain":"time","scope":{"from":%q,"to":%q,"tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"rejections","lo":2,"hi":2}},"source":{"fields":["rejections"],"bucket":"hour","bucket_step":1}}`, from.Format(time.RFC3339), to.Format(time.RFC3339))
	c, err := ParseCohortDefinition([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	query, args, _, err := CohortSessionSubquery(c)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := tn.rdb.QueryContext(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("resolver SQL: %v\n%s", err, query)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		got = append(got, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("rejection contributors=%v, want only existing conversation c1", got)
	}
}

func cohortScopeRaw(grain, include, exclude, predicate string) []byte {
	return []byte(`{"v":1,"grain":"` + grain + `","scope":{"from":"2025-01-01T00:00:00Z","to":"2025-01-31T00:00:00Z","tz":"UTC","include":` + include + `,"exclude":` + exclude + `},"predicate":` + predicate + `}`)
}

func TestAnalyticsCohortScopeElementsValidate(t *testing.T) {
	sessionPred := `{"range":{"measure":"commits","lo":0,"hi":1}}`
	if _, err := ParseCohortDefinition(cohortScopeRaw("session", `[]`, `[]`, sessionPred)); err != nil {
		t.Fatalf("empty lists must be accepted: %v", err)
	}
	for _, tc := range []struct {
		name     string
		include  string
		exclude  string
		wantJoin bool
	}{
		{"null include", `null`, `[]`, false},
		{"missing include", ``, `[]`, false},
		{"null element", `[null]`, `[]`, false},
		{"bare string element", `["harness:x"]`, `[]`, false},
		{"missing values", `[{"lens":"harness"}]`, `[]`, false},
		{"empty values", `[{"lens":"harness","values":[]}]`, `[]`, false},
		{"unknown lens", `[{"lens":"not_a_lens","values":["x"]}]`, `[]`, false},
		{"published outside grain", `[{"lens":"screen_verdict","values":["pass"]}]`, `[]`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := cohortScopeRaw("session", tc.include, tc.exclude, sessionPred)
			if tc.name == "missing include" {
				raw = []byte(`{"v":1,"grain":"session","scope":{"from":"2025-01-01T00:00:00Z","to":"2025-01-31T00:00:00Z","tz":"UTC","exclude":[]},"predicate":` + sessionPred + `}`)
			}
			_, err := ParseCohortDefinition(raw)
			if tc.wantJoin {
				if !errors.Is(err, ErrUnsupportedJoin) {
					t.Fatalf("err=%v want unsupported_join", err)
				}
				var lensErr *CohortScopeLensError
				if !errors.As(err, &lensErr) || lensErr.Reason != "not_defined_for_grain" || len(lensErr.Try) == 0 {
					t.Fatalf("err=%v want not_defined_for_grain with try", err)
				}
				return
			}
			if !errors.Is(err, ErrCohortInvalid) {
				t.Fatalf("err=%v want cohort_invalid", err)
			}
		})
	}
	artifactPred := `{"range":{"measure":"versions","lo":0,"hi":1}}`
	if _, err := ParseCohortDefinition(cohortScopeRaw("artifact", `[{"lens":"band:review","values":["high"]}]`, `[]`, artifactPred)); err != nil {
		t.Fatalf("dynamic band lens must be accepted: %v", err)
	}
}

func TestAnalyticsCohortScopeCanonicalisesElements(t *testing.T) {
	pred := `{"range":{"measure":"commits","lo":0,"hi":1}}`
	a, err := ParseCohortDefinition(cohortScopeRaw("session",
		`[{"lens":"harness","values":["b","a","a"]},{"lens":"harness","values":["c","b"]},{"lens":"session_model","values":["z","y"]}]`,
		`[{"lens":"session_repo","values":["r1","r0"]}]`, pred))
	if err != nil {
		t.Fatal(err)
	}
	b, err := ParseCohortDefinition(cohortScopeRaw("session",
		`[{"lens":"session_model","values":["y","z"]},{"lens":"harness","values":["a","b","c"]}]`,
		`[{"lens":"session_repo","values":["r0","r1"]}]`, pred))
	if err != nil {
		t.Fatal(err)
	}
	if a.Key != b.Key {
		t.Fatalf("canonical keys differ: %s != %s", a.Key, b.Key)
	}
	wantInclude := []CohortScopeElement{{Lens: "harness", Values: []string{"a", "b", "c"}}, {Lens: "session_model", Values: []string{"y", "z"}}}
	wantExclude := []CohortScopeElement{{Lens: "session_repo", Values: []string{"r0", "r1"}}}
	if !reflect.DeepEqual(a.Definition.Scope.Include, wantInclude) || !reflect.DeepEqual(a.Definition.Scope.Exclude, wantExclude) {
		t.Fatalf("canonical scope=%+v / %+v", a.Definition.Scope.Include, a.Definition.Scope.Exclude)
	}
}

func TestAnalyticsCohortScopeBudgets(t *testing.T) {
	artifactPred := `{"range":{"measure":"versions","lo":0,"hi":1}}`
	sessionPred := `{"range":{"measure":"commits","lo":0,"hi":1}}`
	elems := make([]string, 65)
	for i := range elems {
		elems[i] = fmt.Sprintf(`{"lens":"band:c%d","values":["v"]}`, i)
	}
	_, err := ParseCohortDefinition(cohortScopeRaw("artifact", "["+strings.Join(elems, ",")+"]", "[]", artifactPred))
	if !errors.Is(err, ErrCohortInvalid) || !strings.Contains(err.Error(), "scope_elements") {
		t.Fatalf("scope_elements err=%v", err)
	}
	vals := make([]string, 65)
	for i := range vals {
		vals[i] = fmt.Sprintf(`"v%d"`, i)
	}
	_, err = ParseCohortDefinition(cohortScopeRaw("artifact", `[{"lens":"band:c","values":[`+strings.Join(vals, ",")+`]}]`, "[]", artifactPred))
	if !errors.Is(err, ErrCohortInvalid) || !strings.Contains(err.Error(), "scope_values") {
		t.Fatalf("scope_values err=%v", err)
	}
	_, err = ParseCohortDefinition(cohortScopeRaw("session", `[{"lens":"harness","values":["`+strings.Repeat("x", 257)+`"]}]`, "[]", sessionPred))
	if !errors.Is(err, ErrCohortInvalid) || !strings.Contains(err.Error(), "value_bytes") {
		t.Fatalf("value_bytes err=%v", err)
	}
	if _, err := ParseCohortDefinition(cohortScopeRaw("artifact", `[{"lens":"id","values":["`+strings.Repeat("x", 1024)+`"]}]`, "[]", artifactPred)); err != nil {
		t.Fatalf("composite id of 1024 bytes must be accepted: %v", err)
	}
	_, err = ParseCohortDefinition(cohortScopeRaw("artifact", `[{"lens":"id","values":["`+strings.Repeat("x", 1025)+`"]}]`, "[]", artifactPred))
	if !errors.Is(err, ErrCohortInvalid) || !strings.Contains(err.Error(), "value_bytes") {
		t.Fatalf("composite id value_bytes err=%v", err)
	}
}

func TestAnalyticsCohortCompilesScopePredicate(t *testing.T) {
	scope := CohortScope{
		Include: []CohortScopeElement{{Lens: "harness", Values: []string{"a", "b"}}, {Lens: "session_model", Values: []string{"m"}}},
		Exclude: []CohortScopeElement{{Lens: "session_repo", Values: []string{"r"}}},
	}
	cols := map[string]SQLExpression{"harness": "source.harness", "session_model": "source.session_model", "session_repo": "source.session_repo"}
	sql, args, err := CompileCohortScope(scope, cols)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "source.harness IN (?,?)") || !strings.Contains(sql, "source.session_model IN (?)") || !strings.Contains(sql, "source.session_repo NOT IN (?)") {
		t.Fatalf("scope SQL=%s", sql)
	}
	if !reflect.DeepEqual(args, []any{"a", "b", "m", "r"}) {
		t.Fatalf("args=%v", args)
	}
	if sql, args, err := CompileCohortScope(CohortScope{}, cols); err != nil || sql != "1" || args != nil {
		t.Fatalf("empty scope sql=%q args=%v err=%v", sql, args, err)
	}
	_, _, err = CompileCohortScope(scope, map[string]SQLExpression{"harness": "h"})
	if !errors.Is(err, ErrUnsupportedJoin) {
		t.Fatalf("unmapped lens err=%v want unsupported_join", err)
	}
	var lensErr *CohortScopeLensError
	if !errors.As(err, &lensErr) || lensErr.Reason != "not_defined_for_grain" {
		t.Fatalf("unmapped lens err=%v want not_defined_for_grain", err)
	}
}

func cohortMatrixFixture(t *testing.T) *Tenant {
	t.Helper()
	tn, _ := fixture(t)
	rows := []FactRow{
		ufact(901, "cursor", "model-a", "c1", `{"n":901}`, ad(9, 29, 12, 0), 1, 2, 0, 0, 0, nil),
		ufact(902, "cursor", "model-a", "c1", `{"n":902}`, ad(9, 29, 13, 0), 1, 2, 0, 0, 0, nil),
		ufact(903, "cursor", "model-a", "c1", `{"n":903}`, ad(9, 30, 1, 0), 1, 2, 0, 0, 0, nil),
		ufact(904, "cursor", "model-b", "c1", `{"n":904}`, ad(9, 30, 2, 0), 1, 2, 0, 0, 0, nil),
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn
}

func cohortCatalogue() CohortResolveOptions {
	return CohortResolveOptions{Checks: map[string][]string{
		"design": {"d.x", "d.y"}, "brief": {"b.x"}, "report": {"b.x"},
	}}
}

func resolveCohortSessions(t *testing.T, tn *Tenant, raw string, opts *CohortResolveOptions) []string {
	t.Helper()
	c, err := ParseCohortDefinition([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	var tail []CohortResolveOptions
	if opts != nil {
		tail = append(tail, *opts)
	}
	q, args, rel, err := CohortSessionSubquery(c, tail...)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if !rel.ResolvedN || rel.SourceGrain != c.Definition.Grain {
		t.Fatalf("relation=%+v", rel)
	}
	rows, err := tn.rdb.QueryContext(context.Background(), q, args...)
	if err != nil {
		t.Fatalf("resolver SQL: %v\n%s", err, q)
	}
	defer rows.Close()
	got := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		got = append(got, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	return got
}

func cohortRaw(grain, scope, predicate string) string {
	return `{"v":1,"grain":"` + grain + `","scope":` + scope + `,"predicate":` + predicate + `}`
}

func cohortScope(include, exclude string) string {
	return `{"from":"2026-09-28T00:00:00Z","to":"2026-10-05T12:00:00Z","tz":"UTC","include":` + include + `,"exclude":` + exclude + `}`
}

func cohortSmoke(t *testing.T, tn *Tenant, opts CohortResolveOptions, grain, source string, measures, lenses []string) {
	t.Helper()
	extra := ""
	if source != "" {
		extra = `,"source":` + source
	}
	for _, name := range measures {
		raw := `{"v":1,"grain":"` + grain + `","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"range":{"measure":` + fmt.Sprintf("%q", name) + `,"lo":0,"hi":1e18}}` + extra + `}`
		if _, _, _, err := CohortSessionSubquery(mustParse(t, raw), opts); err != nil {
			t.Fatalf("%s measure %s: %v", grain, name, err)
		}
	}
	for _, name := range lenses {
		raw := `{"v":1,"grain":"` + grain + `","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"in":{"lens":` + fmt.Sprintf("%q", name) + `,"values":["x"]}}` + extra + `}`
		if _, _, _, err := CohortSessionSubquery(mustParse(t, raw), opts); err != nil {
			t.Fatalf("%s lens %s: %v", grain, name, err)
		}
	}
	if extra == "" {
		raw := `{"v":1,"grain":"` + grain + `","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"is_null":{"measure":` + fmt.Sprintf("%q", measures[0]) + `}}}`
		if _, _, _, err := CohortSessionSubquery(mustParse(t, raw), opts); err != nil {
			t.Fatalf("%s is_null %s: %v", grain, measures[0], err)
		}
	}
}

func TestAnalyticsCohortMatrixSessionResolvesEveryEntry(t *testing.T) {
	tn := cohortMatrixFixture(t)
	defer tn.Close()
	opts := cohortCatalogue()
	for _, measure := range []string{"cost_usd", "unpriced_calls", "model_calls", "tokens_in", "tokens_out", "tokens_cache_read", "tokens_cache_write", "tokens_reasoning", "hook_events", "commits", "artifact_versions", "distinct_content", "duration_s", "first_ts", "last_ts"} {
		raw := cohortRaw("session", cohortScope(`[]`, `[]`), fmt.Sprintf(`{"range":{"measure":%q,"lo":0,"hi":1e18}}`, measure))
		if _, err := ParseCohortDefinition([]byte(raw)); err != nil {
			t.Fatalf("%s parse: %v", measure, err)
		}
	}
	for _, lens := range []string{"harness", "session_model", "session_repo", "id"} {
		raw := cohortRaw("session", cohortScope(`[]`, `[]`), fmt.Sprintf(`{"in":{"lens":%q,"values":["c1"]}}`, lens))
		_ = resolveCohortSessions(t, tn, raw, &opts)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("session", cohortScope(`[]`, `[]`), `{"in":{"lens":"session_model","values":["(mixed)"]}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("mixed-model sessions=%v want [c1]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("session", cohortScope(`[]`, `[]`), `{"in":{"lens":"harness","values":["codex"]}}`), &opts); !reflect.DeepEqual(got, []string{"c4"}) {
		t.Fatalf("lifetime harness sessions=%v want [c4]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("session", cohortScope(`[]`, `[]`), `{"range":{"measure":"model_calls","lo":1,"hi":10}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("model-call sessions=%v want [c1]", got)
	}
}

func TestAnalyticsCohortMatrixArtifactResolvesScoreBandWriterAndScope(t *testing.T) {
	tn := cohortMatrixFixture(t)
	defer tn.Close()
	opts := cohortCatalogue()
	cohortSmoke(t, tn, opts, "artifact", `{"check":"d.x"}`,
		[]string{"versions", "distinct_writing_sessions", "first_ts", "last_ts", "content_bytes", "score:d.x", "writing_session_cost_usd", "writing_session_model_calls", "writing_session_tokens_in", "writing_session_tokens_out", "writing_session_tokens_cache_read", "writing_session_tokens_cache_write", "writing_session_tokens_reasoning", "writing_session_hook_events"},
		[]string{"kind", "plan", "repo_id", "harness", "session_model", "source", "screen_verdict", "scorer", "band:d.x", "id"})
	if got := resolveCohortSessions(t, tn, cohortRaw("artifact", cohortScope(`[]`, `[]`), `{"range":{"measure":"score:d.x","lo":0.7,"hi":1}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("score:d.x=%v want [c1]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("artifact", cohortScope(`[]`, `[]`), `{"in":{"lens":"band:d.x","values":["high"]}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("band:d.x=%v want [c1]", got)
	}
	scorerRaw := `{"v":1,"grain":"artifact","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"in":{"lens":"scorer","values":["s"]}},"source":{"check":"d.x"}}`
	if got := resolveCohortSessions(t, tn, scorerRaw, &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("scorer/check=%v want [c1]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("artifact", cohortScope(`[]`, `[]`), `{"range":{"measure":"writing_session_model_calls","lo":1,"hi":100}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("writing-session measure=%v want [c1]", got)
	}
	design := resolveCohortSessions(t, tn, cohortRaw("artifact", cohortScope(`[{"lens":"kind","values":["design"]}]`, `[]`), `{"range":{"measure":"versions","lo":0,"hi":100}}`), &opts)
	brief := resolveCohortSessions(t, tn, cohortRaw("artifact", cohortScope(`[]`, `[{"lens":"kind","values":["design"]}]`), `{"range":{"measure":"versions","lo":0,"hi":100}}`), &opts)
	if !reflect.DeepEqual(design, []string{"c1"}) || !reflect.DeepEqual(brief, []string{"c1", "c2", "c3", "c4"}) {
		t.Fatalf("scope include design=%v exclude design=%v", design, brief)
	}
	idScope := cohortScope(`[{"lens":"id","values":["{\"path\":\"docs/plans/p1/DESIGN.md\",\"repo_id\":\"repoA\"}"]}]`, `[]`)
	if got := resolveCohortSessions(t, tn, cohortRaw("artifact", idScope, `{"range":{"measure":"versions","lo":0,"hi":100}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("artifact id=%v want [c1]", got)
	}
}

func TestAnalyticsCohortMatrixContentResolvesRepresentative(t *testing.T) {
	tn := cohortMatrixFixture(t)
	defer tn.Close()
	opts := cohortCatalogue()
	cohortSmoke(t, tn, opts, "content", `{"kind":"design","check":"d.x"}`,
		[]string{"score"}, []string{"harness", "session_model", "repo_id", "plan", "scorer", "screen_verdict", "band", "id"})
	raw := `{"v":1,"grain":"content","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"range":{"measure":"score","lo":0.7,"hi":1}},"source":{"kind":"design","check":"d.x"}}`
	if got := resolveCohortSessions(t, tn, raw, &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("content score=%v want [c1]", got)
	}
	band := `{"v":1,"grain":"content","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"in":{"lens":"band","values":["high"]}},"source":{"kind":"design","check":"d.x"}}`
	if got := resolveCohortSessions(t, tn, band, &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("content band=%v want [c1]", got)
	}
	missing := `{"v":1,"grain":"content","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"range":{"measure":"score","lo":0,"hi":1}},"source":{"kind":"design"}}`
	if _, err := ParseCohortDefinition([]byte(missing)); !errors.Is(err, ErrCohortInvalid) {
		t.Fatalf("missing content check err=%v", err)
	}
	unknown := &CohortResolveOptions{Checks: map[string][]string{"design": {"d.x"}}}
	unknownRaw := `{"v":1,"grain":"content","scope":` + cohortScope(`[]`, `[]`) + `,"predicate":{"range":{"measure":"score","lo":0,"hi":1}},"source":{"kind":"design","check":"not_a_check"}}`
	if _, _, _, err := CohortSessionSubquery(mustParse(t, unknownRaw), *unknown); !errors.Is(err, ErrCohortInvalid) {
		t.Fatalf("unknown check err=%v", err)
	}
}

func mustParse(t *testing.T, raw string) ParsedCohort {
	t.Helper()
	c, err := ParseCohortDefinition([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestAnalyticsCohortMatrixExecutionResolvesScoresAndShape(t *testing.T) {
	tn := cohortMatrixFixture(t)
	defer tn.Close()
	opts := cohortCatalogue()
	cohortSmoke(t, tn, opts, "execution", "",
		[]string{"session_cost_usd", "brief_score:b.x", "report_score:b.x", "ts"},
		[]string{"shape", "plan", "repo_id", "harness", "session_model", "id"})
	if got := resolveCohortSessions(t, tn, cohortRaw("execution", cohortScope(`[]`, `[]`), `{"range":{"measure":"brief_score:b.x","lo":0,"hi":0.5}}`), &opts); !reflect.DeepEqual(got, []string{"c1", "c3"}) {
		t.Fatalf("brief_score=%v want [c1 c3]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("execution", cohortScope(`[]`, `[]`), `{"in":{"lens":"shape","values":["complete"]}}`), &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("shape complete=%v want [c1]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("execution", cohortScope(`[]`, `[]`), `{"in":{"lens":"shape","values":["started"]}}`), &opts); !reflect.DeepEqual(got, []string{"c3"}) {
		t.Fatalf("shape started=%v want [c3]", got)
	}
	id := `{"v":1,"grain":"execution","scope":` + cohortScope(`[{"lens":"id","values":["{\"brief_path\":\"docs/plans/p1/briefs/b1.md\",\"conversation_id\":\"c1\",\"repo_id\":\"repoA\"}"]}]`, `[]`) + `,"predicate":{"range":{"measure":"ts","lo":0,"hi":1e18}}}`
	if got := resolveCohortSessions(t, tn, id, &opts); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("execution id=%v want [c1]", got)
	}
}

func TestAnalyticsCohortMatrixPlanResolvesDerivedMeasuesAndLenses(t *testing.T) {
	tn := cohortMatrixFixture(t)
	defer tn.Close()
	opts := cohortCatalogue()
	cohortSmoke(t, tn, opts, "plan", "",
		[]string{"artifacts", "artifacts:design", "versions", "sessions", "shared_sessions", "associated_cost_usd", "unpriced_calls", "executions_complete", "executions_unreported", "executions_started", "complete_share", "design_score:d.x", "span_days", "first_ts", "last_ts"},
		[]string{"repo_id", "harness", "session_model", "id"})
	for _, tc := range []struct {
		predicate string
		want      []string
	}{
		{`{"range":{"measure":"design_score:d.x","lo":0.7,"hi":1}}`, []string{"c1", "c2"}},
		{`{"range":{"measure":"artifacts:design","lo":1,"hi":1}}`, []string{"c1", "c2"}},
		{`{"range":{"measure":"complete_share","lo":0.5,"hi":0.5}}`, []string{"c1", "c4"}},
		{`{"range":{"measure":"span_days","lo":0,"hi":100}}`, []string{"c1", "c2", "c3", "c4"}},
		{`{"range":{"measure":"executions_complete","lo":1,"hi":10}}`, []string{"c1", "c4"}},
	} {
		if got := resolveCohortSessions(t, tn, cohortRaw("plan", cohortScope(`[]`, `[]`), tc.predicate), &opts); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("plan %s=%v want %v", tc.predicate, got, tc.want)
		}
	}
	id := `{"v":1,"grain":"plan","scope":` + cohortScope(`[{"lens":"id","values":["{\"plan\":\"p1\",\"repo_id\":\"repoA\"}"]}]`, `[]`) + `,"predicate":{"range":{"measure":"artifacts","lo":0,"hi":100}}}`
	if got := resolveCohortSessions(t, tn, id, &opts); !reflect.DeepEqual(got, []string{"c1", "c2"}) {
		t.Fatalf("plan id=%v want [c1 c2]", got)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("plan", cohortScope(`[{"lens":"harness","values":["codex"]}]`, `[]`), `{"range":{"measure":"artifacts","lo":0,"hi":100}}`), &opts); !reflect.DeepEqual(got, []string{"c1", "c4"}) {
		t.Fatalf("plan harness=%v want [c1 c4]", got)
	}
}

func TestAnalyticsCohortScopeExcludeDiffersFromTargetOpExclude(t *testing.T) {
	tn := cohortMatrixFixture(t)
	defer tn.Close()
	opts := cohortCatalogue()
	predicate := `{"range":{"measure":"commits","lo":0,"hi":100}}`
	all := resolveCohortSessions(t, tn, cohortRaw("session", cohortScope(`[]`, `[]`), predicate), &opts)
	scopeExcluded := resolveCohortSessions(t, tn, cohortRaw("session", cohortScope(`[]`, `[{"lens":"harness","values":["codex"]}]`), predicate), &opts)
	if reflect.DeepEqual(all, scopeExcluded) || len(scopeExcluded) == 0 || len(all) <= len(scopeExcluded) {
		t.Fatalf("scope exclude did not narrow: all=%v excluded=%v", all, scopeExcluded)
	}
	opExcluded := resolveCohortSessions(t, tn, `{"v":1,"grain":"session","scope":`+cohortScope(`[]`, `[]`)+`,"predicate":`+predicate+`,"op":"exclude"}`, &opts)
	if !reflect.DeepEqual(all, opExcluded) {
		t.Fatalf("op=exclude changed positive source resolution: all=%v op=%v", all, opExcluded)
	}
	if got := resolveCohortSessions(t, tn, cohortRaw("session", cohortScope(`[]`, `[]`), `{"range":{"measure":"commits","lo":1000,"hi":2000}}`), &opts); len(got) != 0 {
		t.Fatalf("empty source=%v want empty", got)
	}
}
