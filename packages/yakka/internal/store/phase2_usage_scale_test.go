package store

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// multidimUsageFixture gives two dimensions whose top-N sets differ, so each dimension folds
// at least one key to (other) independently.
func multidimUsageFixture(t *testing.T) *Tenant {
	t.Helper()
	tn := openT(t, Options{})
	var rows []FactRow
	add := func(harness, model, conv string) {
		n := len(rows)
		rows = append(rows, ufact(n, harness, model, conv, fmt.Sprintf(`{"n":%d}`, n), aFrom, 1, 1, 0, 0, 0, nil))
	}
	for i := 0; i < 5; i++ {
		add("claude", "model-a", "c1")
	}
	for i := 0; i < 3; i++ {
		add("claude", "model-b", "c1")
	}
	for i := 0; i < 2; i++ {
		add("codex", "model-c", "c2")
	}
	add("codex", "model-d", "c2")
	add("opencode", "model-e", "c3")
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	return tn
}

// singlePassUsageOracle computes the folded groups over the deduplicated calls with plain Go:
// independent per-dimension ranks, then (other) folding and grouping. It shares only the kept
// source with the production path, so the grouping/folding is independently checked.
func singlePassUsageOracle(t *testing.T, tn *Tenant, f AnalyticsFilter, measure string, dims []string, top int) []QueryRow {
	t.Helper()
	def, ok := measureByName(measure)
	if !ok || !def.usage {
		t.Fatalf("not a usage measure: %s", measure)
	}
	f2, _ := def.applyFilters(f)
	kept, err := tn.usageKeptRows(context.Background(), f2)
	if err != nil {
		t.Fatal(err)
	}
	tops := map[string][]string{}
	for _, d := range dims {
		totals := map[string]float64{}
		for _, r := range kept {
			totals[r.dim(d)] += usageValue(measure, r)
		}
		keys := make([]string, 0, len(totals))
		for k := range totals {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			if totals[keys[i]] != totals[keys[j]] {
				return totals[keys[i]] > totals[keys[j]]
			}
			return keys[i] < keys[j]
		})
		if len(keys) > top {
			keys = keys[:top]
		}
		tops[d] = keys
	}
	groups := map[string]*QueryRow{}
	for _, r := range kept {
		k := make([]string, len(dims))
		for i, d := range dims {
			k[i] = foldUsageDim(r.dim(d), tops[d])
		}
		key := strings.Join(k, "\x00")
		g := groups[key]
		if g == nil {
			g = &QueryRow{K: k}
			groups[key] = g
		}
		g.V += usageValue(measure, r)
	}
	out := make([]QueryRow, 0, len(groups))
	for _, g := range groups {
		out = append(out, *g)
	}
	sortRows(out)
	return out
}

func sameUsageRows(got, want []QueryRow) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if !reflect.DeepEqual(got[i].K, want[i].K) || math.Abs(got[i].V-want[i].V) > 1e-9 {
			return false
		}
	}
	return true
}

func TestUsageQueryMultiDimMatchesSinglePassOracle(t *testing.T) {
	ctx := context.Background()
	tn := multidimUsageFixture(t)
	f := AnalyticsFilter{From: aFrom.Add(-1), To: aTo.Add(1)}
	for _, measure := range []string{"model_calls", "cost_usd"} {
		t.Run(measure, func(t *testing.T) {
			gotTwo, err := tn.Query(ctx, f, QueryParams{Measure: measure, Dims: []string{"harness", "model"}, Top: 2})
			if err != nil {
				t.Fatal(err)
			}
			wantTwo := singlePassUsageOracle(t, tn, f, measure, []string{"harness", "model"}, 2)
			if !sameUsageRows(gotTwo.Rows, wantTwo) {
				t.Fatalf("two-dim %s: got %#v want %#v", measure, gotTwo.Rows, wantTwo)
			}
			if !reflect.DeepEqual(gotTwo.Dims, []string{"harness", "model"}) {
				t.Fatalf("dim order changed: %v", gotTwo.Dims)
			}

			gotOne, err := tn.Query(ctx, f, QueryParams{Measure: measure, Dims: []string{"harness"}, Top: 2})
			if err != nil {
				t.Fatal(err)
			}
			wantOne := singlePassUsageOracle(t, tn, f, measure, []string{"harness"}, 2)
			if !sameUsageRows(gotOne.Rows, wantOne) {
				t.Fatalf("one-dim %s: got %#v want %#v", measure, gotOne.Rows, wantOne)
			}
		})
	}
}
