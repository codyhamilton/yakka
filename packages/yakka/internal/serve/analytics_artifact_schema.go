package serve

import (
	"context"
	"sort"
	"strings"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

var artifactWriterMeasures = []string{"writing_session_cost_usd", "writing_session_model_calls", "writing_session_tokens_in", "writing_session_tokens_out", "writing_session_tokens_cache_read", "writing_session_tokens_cache_write", "writing_session_tokens_reasoning", "writing_session_hook_events"}

func artifactWriterMeasure(name string) bool {
	for _, field := range artifactWriterMeasures {
		if name == field {
			return true
		}
	}
	return false
}

// A writing session can contribute to several files, so its measures cannot be
// summed over artifacts as though they were file-exact spend or work.
func artifactAdditiveField(name string) bool {
	return name == "versions" || name == "distinct_writing_sessions" || name == "content_bytes"
}

type artifactBaselines map[string]map[string][]float64

func loadArtifactBaselines(ctx context.Context, t *store.Tenant, kind string) (artifactBaselines, error) {
	out := artifactBaselines{}
	if !validKind(kind) {
		return out, nil
	}
	rows, err := t.LatestContentScores(ctx, kind)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if out[row.Check] == nil {
			out[row.Check] = map[string][]float64{}
		}
		out[row.Check][row.Scorer] = append(out[row.Check][row.Scorer], row.Score)
	}
	for _, scorers := range out {
		for _, values := range scorers {
			sort.Float64s(values)
		}
	}
	return out, nil
}
func artifactScoreBand(score map[string]any, baseline []float64) string {
	if score == nil {
		return "unscored"
	}
	if len(baseline) == 0 {
		return "baseline_unavailable"
	}
	value := score["score"].(float64)
	// Use the same distinct-content population and interpolated quartiles as
	// population=content /baselines, before display rounding.
	if value < percentile(baseline, .25) {
		return "low"
	}
	if value > percentile(baseline, .75) {
		return "high"
	}
	return "mid"
}

// Historical score names remain queryable after catalogue changes. Names absent
// from both the active catalogue and retained scores are never advertised.
func (s *Server) artifactChecks(ctx context.Context, t *store.Tenant) (map[string][]string, error) {
	out := map[string][]string{}
	for _, kind := range kindOrder {
		names := map[string]bool{}
		if s.opts.Checks != nil {
			for _, check := range s.opts.Checks.For(kind) {
				names[check.Name] = true
			}
		}
		rows, err := t.LatestContentScores(ctx, kind)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			names[row.Check] = true
		}
		out[kind] = []string{}
		for name := range names {
			out[kind] = append(out[kind], name)
		}
		sort.Strings(out[kind])
	}
	return out, nil
}
func artifactAllowedFields(checks map[string][]string) map[string]bool {
	out := map[string]bool{"versions": true, "distinct_writing_sessions": true, "first_ts": true, "last_ts": true, "content_bytes": true}
	for _, field := range artifactWriterMeasures {
		out[field] = true
	}
	for _, names := range checks {
		for _, name := range names {
			out["score:"+name] = true
		}
	}
	return out
}
func artifactGrainSchema(checks map[string][]string) map[string]any {
	allowed := artifactAllowedFields(checks)
	fields := []string{}
	measures := map[string]any{}
	for name := range allowed {
		fields = append(fields, name)
		unit, timeBasis, nullRule := "count", "facts.ts inside the current window", "zero when no observed facts"
		switch name {
		case "first_ts", "last_ts":
			unit = "unix seconds"
			nullRule = "present for every member artifact"
		case "content_bytes":
			unit = "bytes"
			timeBasis = "lifetime selected version"
			nullRule = "null: content_unavailable when unstored"
		case "writing_session_cost_usd":
			unit = "USD"
			nullRule = "no calls: zero; all unpriced: null (all_unpriced); partial: priced lower bound"
		}
		if strings.HasPrefix(name, "score:") {
			unit = "normalised score [0,1], higher better"
			timeBasis = "latest score per hash/check for lifetime selected version"
			nullRule = "null: unscored"
		}
		if strings.Contains(name, "tokens_") {
			unit = "tokens"
		}
		measures[name] = map[string]any{"unit": unit, "time_basis": timeBasis, "null_rule": nullRule, "additive": artifactAdditiveField(name)}
	}
	sort.Strings(fields)
	dims := []string{"repo_id", "kind", "plan", "source", "screen_verdict", "harness", "session_model", "scorer"}
	lenses := map[string]any{}
	for _, name := range append([]string{"id"}, dims...) {
		lenses[name] = map[string]any{"grain": "artifact", "cardinality": "single-valued"}
	}
	lenses["id"].(map[string]any)["encoding"] = "JSON object with repo_id and path"
	lenses["kind"].(map[string]any)["values"] = []string{"design", "brief", "report"}
	for _, name := range []string{"repo_id", "kind", "plan", "source"} {
		lenses[name].(map[string]any)["unknown"] = ""
		lenses[name].(map[string]any)["observed_values"] = true
	}
	lenses["screen_verdict"].(map[string]any)["unknown"] = "unknown"
	lenses["screen_verdict"].(map[string]any)["observed_values"] = true
	lenses["harness"].(map[string]any)["association"] = "writing session lifetime mode; lexical tie break"
	lenses["harness"].(map[string]any)["unknown"] = "unknown"
	lenses["session_model"].(map[string]any)["association"] = "writing session lifetime deduplicated calls"
	lenses["session_model"].(map[string]any)["threshold"] = 0.8
	lenses["session_model"].(map[string]any)["special_values"] = []string{"(mixed)", "(none)", "unknown"}
	lenses["scorer"].(map[string]any)["requires"] = "selected check"
	lenses["scorer"].(map[string]any)["unknown"] = "unscored"
	seen := map[string]bool{}
	for _, names := range checks {
		for _, name := range names {
			if seen[name] {
				continue
			}
			seen[name] = true
			dim := "band:" + name
			dims = append(dims, dim)
			lenses[dim] = map[string]any{"grain": "artifact", "cardinality": "single-valued", "requires": "check=" + name, "values": []string{"low", "mid", "high", "unscored", "baseline_unavailable"}, "baseline": "all-time distinct content, kind/check/latest-score scorer; strict below p25 and above p75; inclusive mid; rubric revisions not captured"}
		}
	}
	sort.Strings(dims)
	return map[string]any{"identity": []string{"repo_id", "path"},
		"modes":                []string{"list", "scatter", "aggregate"},
		"routes":               map[string]string{"list": "/v1/analytics/entities?grain=artifact", "detail": "/v1/analytics/entity?grain=artifact", "content": "/v1/analytics/content"},
		"detail_collections":   []string{"versions"},
		"measures":             fields,
		"measure_metadata":     measures,
		"checks_by_kind":       checks,
		"aggregate_stats":      []string{"count", "sum", "percentiles", "histogram"},
		"aggregate_fields":     fields,
		"sum_fields":           []string{"versions", "distinct_writing_sessions", "content_bytes"},
		"aggregate_dimensions": dims,
		"scatter_fields":       fields,
		"lenses":               lenses,
		"joins":                map[string]any{"writing_session": map[string]any{"cardinality": "single-valued", "label": "earliest observed writing session for this version", "rule": "earliest artifact_version ts, row_hash tie; captured provenance, not proven authorship", "measure_scope": "session facts.ts inside the current window; measures may overlap across files"}},
		"time_basis":           "membership and file measures: in-window facts.ts; selected version: lifetime received_at desc,rowid desc; provenance: lifetime before filters",
		"bucket_grouping":      false,
		"default_sort":         "last_ts:desc,repo_id:asc,path:asc",
		"version_order":        "received_at:desc,content_hash:asc",
		"budget_source":        "schema.budgets",
		"predicate_budgets":    map[string]int{"leaves": 64, "in_values": 64, "depth": 8, "encoded_url_bytes": 8192},
		"scatter_field_count":  []int{2, 4},
		"max_dimensions":       2}
}
