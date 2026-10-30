package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
	_ "time/tzdata"
)

func TestQueryMeasuresMatrix(t *testing.T) {
	ud := []string{"harness", "repo_id", "model", "conversation_id"}
	want := []MeasureSpec{
		{Name: "hook_events", Unit: "count", Dims: []string{"harness", "repo_id", "norm_event", "event", "tool", "tool_kind", "conversation_id", "hour_of_day", "weekday"}},
		{Name: "conversations", Unit: "count", Dims: []string{"harness", "repo_id", "model", "hour_of_day", "weekday"}},
		{Name: "artifact_versions", Unit: "count", Dims: []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id", "hour_of_day", "weekday"}},
		{Name: "distinct_content", Unit: "count", Dims: []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id", "hour_of_day", "weekday"}},
		{Name: "commits", Unit: "count", Dims: []string{"harness", "repo_id", "conversation_id", "hour_of_day", "weekday"}},
		{Name: "rejections", Unit: "count", Dims: []string{"stage", "hour_of_day", "weekday"}},
		{Name: "model_calls", Unit: "count", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "tokens_in", Unit: "tokens", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "tokens_out", Unit: "tokens", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "tokens_cache_read", Unit: "tokens", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "tokens_cache_write", Unit: "tokens", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "tokens_reasoning", Unit: "tokens", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "cost_usd", Unit: "usd", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
		{Name: "unpriced_calls", Unit: "count", Dims: append(append([]string{}, ud...), "hour_of_day", "weekday")},
	}
	if got := Measures(); !reflect.DeepEqual(got, want) {
		t.Fatalf("matrix mismatch:\n got %#v\nwant %#v", got, want)
	}
	if !reflect.DeepEqual(Buckets, []string{"none", "hour", "day", "week", "month"}) {
		t.Fatalf("buckets = %v", Buckets)
	}
}

func TestQueryUnsupportedDim(t *testing.T) {
	tn, f := fixture(t)
	_, err := tn.Query(context.Background(), f, QueryParams{Measure: "hook_events", Dims: []string{"kind"}})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("want ErrUnsupported, got %v", err)
	}
}

func TestQueryHookEventsDims(t *testing.T) {
	ctx := context.Background()
	tn, f := fixture(t)
	cases := []struct {
		name string
		dims []string
		want []QueryRow
	}{
		{"none", nil, []QueryRow{{V: 4}}},
		{"harness", []string{"harness"}, []QueryRow{{K: []string{"claude"}, V: 3}, {K: []string{"cursor"}, V: 1}}},
		{"harness,tool", []string{"harness", "tool"}, []QueryRow{
			{K: []string{"claude", ""}, V: 1},
			{K: []string{"claude", "Bash"}, V: 1},
			{K: []string{"claude", "Read"}, V: 1},
			{K: []string{"cursor", "Bash"}, V: 1},
		}},
		{"harness,tool_kind", []string{"harness", "tool_kind"}, []QueryRow{
			{K: []string{"claude", ""}, V: 1},
			{K: []string{"claude", "read"}, V: 1},
			{K: []string{"claude", "shell"}, V: 1},
			{K: []string{"cursor", "shell"}, V: 1},
		}},
	}
	for _, c := range cases {
		got, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", Dims: c.dims})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		want := c.want
		for i := range want {
			if want[i].K == nil {
				want[i].K = []string{}
			}
		}
		if !reflect.DeepEqual(got.Rows, want) {
			t.Fatalf("%s: got %#v want %#v", c.name, got.Rows, want)
		}
	}
}

func TestQueryBuckets(t *testing.T) {
	ctx := context.Background()
	tn, f := fixture(t)
	day, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", Bucket: "day"})
	if err != nil {
		t.Fatal(err)
	}
	wantDay := []QueryRow{
		{T: "2026-09-28T00:00:00Z", K: []string{}, V: 1},
		{T: "2026-10-04T00:00:00Z", K: []string{}, V: 1},
		{T: "2026-10-05T00:00:00Z", K: []string{}, V: 2},
	}
	if !reflect.DeepEqual(day.Rows, wantDay) {
		t.Fatalf("day: %#v", day.Rows)
	}
	week, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", Bucket: "week"})
	if err != nil {
		t.Fatal(err)
	}
	wantWeek := []QueryRow{
		{T: "2026-09-28T00:00:00Z", K: []string{}, V: 2},
		{T: "2026-10-05T00:00:00Z", K: []string{}, V: 2},
	}
	if !reflect.DeepEqual(week.Rows, wantWeek) {
		t.Fatalf("week: %#v", week.Rows)
	}
}

func TestQuerySydneyTZ(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	at := time.Date(2026, 10, 4, 23, 30, 0, 0, time.UTC)
	addFacts(t, tn, afx{typ: "hook_event", conv: "c1", harness: "cursor", event: "PreToolUse", ts: at, repo: "repoA", tool: "Bash"})
	loc, err := time.LoadLocation("Australia/Sydney")
	if err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: at.Add(-time.Hour), To: at.Add(time.Hour), TZ: loc}
	r, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", Dims: []string{"hour_of_day"}, Bucket: "day"})
	if err != nil {
		t.Fatal(err)
	}
	want := []QueryRow{{T: "2026-10-05T00:00:00+11:00", K: []string{"10"}, V: 1}}
	if !reflect.DeepEqual(r.Rows, want) {
		t.Fatalf("sydney: %#v", r.Rows)
	}
}

func TestQueryTopNSum(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	var fs []afx
	for _, x := range []struct {
		tool string
		n    int
	}{{"t1", 1}, {"t2", 2}, {"t3", 3}, {"t4", 4}} {
		for i := 0; i < x.n; i++ {
			fs = append(fs, afx{typ: "hook_event", conv: "c", harness: "h", event: "PreToolUse", ts: aFrom, repo: "r", tool: x.tool})
		}
	}
	addFacts(t, tn, fs...)
	f := AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo}
	r, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", Dims: []string{"tool"}, Top: 2})
	if err != nil {
		t.Fatal(err)
	}
	want := []QueryRow{
		{K: []string{"__other__"}, V: 3},
		{K: []string{"t3"}, V: 3},
		{K: []string{"t4"}, V: 4},
	}
	if !reflect.DeepEqual(r.Rows, want) {
		t.Fatalf("top sum: %#v", r.Rows)
	}
}

func TestQueryTopNDistinct(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	add := func(conv, h string) {
		addFacts(t, tn, afx{typ: "hook_event", conv: conv, harness: h, event: "PreToolUse", ts: aFrom, repo: "r", tool: "x"})
	}
	add("cA", "h1")
	add("cB", "h1")
	add("cC", "h1")
	add("cA", "h2")
	add("cA", "h3")
	add("cA", "h4")
	f := AnalyticsFilter{From: aFrom.Add(-time.Hour), To: aTo}
	r, err := tn.Query(ctx, f, QueryParams{Measure: "conversations", Dims: []string{"harness"}, Top: 2})
	if err != nil {
		t.Fatal(err)
	}
	want := []QueryRow{
		{K: []string{"__other__"}, V: 1},
		{K: []string{"h1"}, V: 3},
		{K: []string{"h2"}, V: 1},
	}
	if !reflect.DeepEqual(r.Rows, want) {
		t.Fatalf("top distinct: %#v", r.Rows)
	}
}

func TestQueryIgnoredFilters(t *testing.T) {
	ctx := context.Background()
	tn, f := fixture(t)
	ff := f
	ff.Kinds = []string{"brief"}
	withKind, err := tn.Query(ctx, ff, QueryParams{Measure: "hook_events"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(withKind.Ignored, []string{"kind"}) {
		t.Fatalf("ignored = %v", withKind.Ignored)
	}
	base, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(withKind.Rows, base.Rows) {
		t.Fatalf("rows differ: %#v vs %#v", withKind.Rows, base.Rows)
	}
}

func TestQueryTruncated(t *testing.T) {
	ctx := context.Background()
	old := queryRowCap
	queryRowCap = 2
	defer func() { queryRowCap = old }()
	tn, f := fixture(t)
	r, err := tn.Query(ctx, f, QueryParams{Measure: "hook_events", Bucket: "day"})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Truncated || len(r.Rows) != 2 {
		t.Fatalf("truncated=%v rows=%d", r.Truncated, len(r.Rows))
	}
}

func TestQueryEveryMeasure(t *testing.T) {
	ctx := context.Background()
	tn, f := fixture(t)
	for _, m := range Measures() {
		if usageMeasures[m.Name] {
			continue
		}
		if _, err := tn.Query(ctx, f, QueryParams{Measure: m.Name}); err != nil {
			t.Errorf("%s: %v", m.Name, err)
		}
	}
}

func TestQueryUsageAvailable(t *testing.T) {
	tn, f := fixture(t)
	if _, err := tn.Query(context.Background(), f, QueryParams{Measure: "model_calls"}); err != nil {
		t.Fatalf("model_calls: %v", err)
	}
}
