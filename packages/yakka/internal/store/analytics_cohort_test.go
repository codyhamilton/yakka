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
