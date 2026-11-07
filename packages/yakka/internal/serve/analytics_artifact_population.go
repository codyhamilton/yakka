package serve

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

type artifactPopulationRow struct {
	entity   store.ArtifactEntity
	measures map[string]any
	lenses   map[string]any
	flags    map[string]any
}

func (x artifactPopulationRow) json() map[string]any {
	return map[string]any{"id": map[string]string{"repo_id": x.entity.RepoID, "path": x.entity.Path}, "m": x.measures, "l": x.lenses, "flags": x.flags}
}
func artifactNumericField(name string) bool {
	return store.ArtifactSortMeasure(name) || artifactWriterMeasure(name) || name == "content_bytes" || strings.HasPrefix(name, "score:") && len(strings.TrimPrefix(name, "score:")) > 0
}
func artifactLens(name string) bool {
	switch name {
	case "id", "repo_id", "kind", "plan", "source", "screen_verdict", "harness", "session_model", "scorer":
		return true
	}
	return strings.HasPrefix(name, "band:") && len(strings.TrimPrefix(name, "band:")) > 0
}
func artifactNumber(x artifactPopulationRow, name string) (float64, bool) {
	switch v := x.measures[name].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	}
	return 0, false
}
func artifactMissing(field string) string {
	if field == "writing_session_cost_usd" {
		return "all_unpriced"
	}
	if field == "content_bytes" {
		return "content_unavailable"
	}
	return "unscored"
}
func artifactTypedPopulation(scope, eligible, returned int, missing map[string]int) map[string]any {
	return map[string]any{"grain": "artifact", "unit": "repo_id,path", "scope_n": scope, "cohort_n": scope, "eligible_n": eligible, "returned_n": returned, "missing_by_reason": missing, "relation": nil}
}

// Pages bound each database read; the request's shared deadline bounds the complete scan.
// Membership is selected before lifetime version enrichment and entity predicates.
func artifactPopulation(ctx context.Context, t *store.Tenant, f store.AnalyticsFilter) ([]artifactPopulationRow, error) {
	out := []artifactPopulationRow{}
	baselines := map[string]artifactBaselines{}
	// Session lenses cannot change file membership or lifetime writer selection.
	memberFilter := f
	memberFilter.Harnesses = nil
	memberFilter.Models = nil
	memberFilter.Excludes = map[string][]string{}
	for dim, values := range f.Excludes {
		if dim != "harness" && dim != "model" {
			memberFilter.Excludes[dim] = values
		}
	}

	var cur *store.ArtifactCursor
	for {
		page, more, err := t.ArtifactEntitiesPage(ctx, memberFilter, nil, "last_ts", true, cur, 500)
		if err != nil {
			return nil, err
		}
		ids := []string{}
		for _, x := range page {
			ids = append(ids, x.ConversationID)
		}
		prov, err := t.SessionProvenanceFor(ctx, ids)
		if err != nil {
			return nil, err
		}
		writers, err := t.WritingSessionMeasuresFor(ctx, ids, f.From, f.To)
		if err != nil {
			return nil, err
		}
		for _, x := range page {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			kind := keys.Kind(x.Path)
			plan := ""
			if kind != "" {
				plan = strings.Split(strings.ReplaceAll(x.Path, "\\", "/"), "/")[2]
			}
			if _, ok := baselines[kind]; !ok {
				b, err := loadArtifactBaselines(ctx, t, kind)
				if err != nil {
					return nil, err
				}
				baselines[kind] = b
			}
			p := prov[x.ConversationID]
			if len(f.Harnesses) > 0 && !containsValue(f.Harnesses, p.Harness) || len(f.Models) > 0 && !containsValue(f.Models, p.Model) || containsValue(f.Excludes["harness"], p.Harness) || containsValue(f.Excludes["model"], p.Model) {
				continue
			}
			row := artifactPopulationRow{entity: x, measures: map[string]any{"versions": x.Versions, "distinct_writing_sessions": x.WritingSessions, "first_ts": x.FirstTS, "last_ts": x.LastTS, "latest_version_ts": x.LatestTS}, lenses: map[string]any{"repo_id": x.RepoID, "kind": kind, "plan": plan, "source": x.Source, "writing_session": x.ConversationID, "harness": p.Harness, "session_model": p.Model}, flags: map[string]any{"writing_session_label": "earliest observed writing session for this version", "writing_session_is_captured_provenance": true, "latest_version_outside_window": x.LatestTS < float64(f.From.UnixNano())/1e9 || x.LatestTS > float64(f.To.UnixNano())/1e9}}

			writer := writers[x.ConversationID]
			for _, name := range artifactWriterMeasures {
				row.measures[name] = writer[strings.TrimPrefix(name, "writing_session_")]
			}
			row.flags["writing_session_unpriced_calls"] = writer["unpriced_calls"]
			row.flags["writing_session_cost_lower_bound"] = writer["unpriced_calls"] > 0
			row.flags["writing_session_time_basis"] = "facts.ts inside the current window"
			if writer["model_calls"] > 0 && writer["model_calls"] == writer["unpriced_calls"] {
				row.measures["writing_session_cost_usd"] = nil
				row.flags["null_reasons"] = map[string]string{"writing_session_cost_usd": "all_unpriced"}
			}
			n, available, err := t.ArtifactContentBytes(x.Hash)
			if err != nil {
				return nil, err
			}
			if available {
				row.measures["content_bytes"] = n
			} else {
				row.measures["content_bytes"] = nil
				row.flags["content_unavailable"] = true
			}
			scores, err := t.ArtifactVersionScores(ctx, x.Hash)
			if err != nil {
				return nil, err
			}
			for check, v := range scores {
				row.measures["score:"+check] = v["score"]
				row.measures["score_scorer:"+check] = v["scorer"]
				row.lenses["band:"+check] = artifactScoreBand(v, baselines[kind][check][v["scorer"].(string)])
			}
			screen, err := t.ArtifactScreen(ctx, x.Hash)
			if err != nil {
				return nil, err
			}
			row.lenses["screen_verdict"] = "unknown"
			if screen != nil {
				row.lenses["screen_verdict"] = screen.Verdict
			}
			out = append(out, row)
		}
		if !more {
			break
		}
		last := page[len(page)-1]
		cur = &store.ArtifactCursor{Value: last.LastTS, RepoID: last.RepoID, Path: last.Path}
	}
	return out, nil
}

type artifactPredicate func(artifactPopulationRow) bool

func artifactDecode(raw json.RawMessage, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(v)
}
func parseArtifactPredicate(raw json.RawMessage, depth int, leaves *int, allowed ...map[string]bool) (artifactPredicate, error) {
	validField := func(name string) bool { return artifactNumericField(name) && (len(allowed) == 0 || allowed[0][name]) }
	validLens := func(name string) bool {
		if !artifactLens(name) {
			return false
		}
		if name == "scorer" || strings.HasPrefix(name, "band:") {
			return len(allowed) == 0 || allowed[0]["lens:"+name]
		}
		return true
	}
	if depth > 8 {
		return nil, fmt.Errorf("predicate exceeds depth budget")
	}
	var node map[string]json.RawMessage
	if err := json.Unmarshal(raw, &node); err != nil || len(node) != 1 {
		return nil, fmt.Errorf("predicate node must have exactly one operator")
	}
	for op, body := range node {
		switch op {
		case "and", "or":
			var children []json.RawMessage
			if err := json.Unmarshal(body, &children); err != nil || len(children) == 0 {
				return nil, fmt.Errorf("predicate requires nonempty children")
			}
			ps := []artifactPredicate{}
			for _, child := range children {
				p, e := parseArtifactPredicate(child, depth+1, leaves, allowed...)
				if e != nil {
					return nil, e
				}
				ps = append(ps, p)
			}
			return func(x artifactPopulationRow) bool {
				for _, p := range ps {
					if p(x) == (op == "or") {
						return op == "or"
					}
				}
				return op == "and"
			}, nil
		case "not":
			p, e := parseArtifactPredicate(body, depth+1, leaves, allowed...)
			if e != nil {
				return nil, e
			}
			return func(x artifactPopulationRow) bool { return !p(x) }, nil
		}
		*leaves++
		if *leaves > 64 {
			return nil, fmt.Errorf("predicate exceeds leaf budget")
		}
		switch op {
		case "range":
			var v struct {
				Measure string   `json:"measure"`
				Lo      *float64 `json:"lo"`
				Hi      *float64 `json:"hi"`
			}
			if err := artifactDecode(body, &v); err != nil || !validField(v.Measure) || v.Lo != nil && v.Hi != nil && *v.Lo > *v.Hi {
				return nil, fmt.Errorf("invalid artifact range")
			}
			return func(x artifactPopulationRow) bool {
				n, ok := artifactNumber(x, v.Measure)
				return ok && (v.Lo == nil || n >= *v.Lo) && (v.Hi == nil || n <= *v.Hi)
			}, nil
		case "is_null":
			var v struct {
				Measure string `json:"measure"`
			}
			if err := artifactDecode(body, &v); err != nil || !validField(v.Measure) {
				return nil, fmt.Errorf("invalid artifact null predicate")
			}
			return func(x artifactPopulationRow) bool { _, ok := artifactNumber(x, v.Measure); return !ok }, nil
		case "in":
			var v struct {
				Lens   string   `json:"lens"`
				Values []string `json:"values"`
			}
			if err := artifactDecode(body, &v); err != nil || !validLens(v.Lens) || len(v.Values) > 64 {
				return nil, fmt.Errorf("invalid artifact lens predicate")
			}
			return func(x artifactPopulationRow) bool {
				value := fmt.Sprint(x.lenses[v.Lens])
				if v.Lens == "id" {
					b, _ := json.Marshal(map[string]string{"repo_id": x.entity.RepoID, "path": x.entity.Path})
					value = string(b)
				}
				for _, want := range v.Values {
					if value == want {
						return true
					}
				}
				return false
			}, nil
		default:
			return nil, fmt.Errorf("unsupported predicate operator")
		}
	}
	return nil, fmt.Errorf("invalid predicate")
}
func artifactFields(values []string) []string {
	out := []string{}
	for _, v := range values {
		out = append(out, strings.Split(v, ",")...)
	}
	return out
}
func artifactCursorFilter(q url.Values) string {
	copyQ := url.Values{}
	for k, v := range q {
		if k != "cursor" && k != "limit" {
			copyQ[k] = append([]string(nil), v...)
			sort.Strings(copyQ[k])
		}
	}
	return copyQ.Encode()
}

func (s *Server) analyticsArtifactEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = "list"
	}
	if len(r.URL.RequestURI()) > 8192 {
		errCodeJSON(w, 400, "predicate_too_complex", "view URL exceeds 8 KiB", nil)
		return
	}
	if mode != "list" && mode != "aggregate" && mode != "scatter" {
		errJSON(w, 400, "unsupported artifact mode")
		return
	}
	// Cohort resolution belongs to the later cohort phase and is never silently ignored.
	if q.Get("cohort") != "" {
		errCodeJSON(w, 400, "cohort_invalid", "artifact cohorts are not available", nil)
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	if cur != nil && (cur.Route != "entities:artifact" || cur.Filter != artifactCursorFilter(q)) {
		errJSON(w, 400, "cursor mismatch")
		return
	}
	// The artifact cursor binds every entity predicate and freezes the shared window.
	fr := r.Clone(r.Context())
	u := *r.URL
	fr.URL = &u
	if cur != nil {
		fq := fr.URL.Query()
		fq.Set("from", timeFromCursor(cur.From))
		fq.Set("to", timeFromCursor(cur.To))
		fq.Del("all")
		fr.URL.RawQuery = fq.Encode()
	}
	f, ok := parseFilter(w, fr, filterOpts{})
	if !ok {
		return
	}

	checks, err := s.artifactChecks(r.Context(), ts.t)
	if err != nil {
		readFailed(w)
		return
	}
	allowed := artifactAllowedFields(checks)
	selectedCheck := q.Get("check")
	if selectedCheck != "" {
		allowed["lens:scorer"] = true
		allowed["lens:band:"+selectedCheck] = true
	}
	if q.Has("scorer") && selectedCheck == "" {
		errJSON(w, 400, "artifact scorer requires a selected check")
		return
	}
	if selectedCheck != "" && !allowed["score:"+selectedCheck] {
		errJSON(w, 400, "unsupported artifact check")
		return
	}
	ranges, err := parseArtifactRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	for _, v := range ranges {
		if !allowed[v.Measure] {
			errJSON(w, 400, "unsupported artifact predicate measure")
			return
		}
	}
	var predicate artifactPredicate
	if raw := q.Get("predicate"); raw != "" {
		leaves := 0
		predicate, err = parseArtifactPredicate(json.RawMessage(raw), 1, &leaves, allowed)
		if err != nil {
			errCodeJSON(w, 400, "predicate_too_complex", err.Error(), nil)
			return
		}
	}
	fields := artifactFields(q["fields"])
	if len(fields) == 0 {
		fields = artifactFields(q["field"])
	}
	if mode == "scatter" && (len(fields) < 2 || len(fields) > 4) {
		errJSON(w, 400, "artifact scatter requires two to four fields")
		return
	}
	for _, field := range fields {
		if !allowed[field] {
			errJSON(w, 400, "unsupported artifact field "+field)
			return
		}
	}
	dims := q["dim"]
	if len(dims) > 2 {
		errJSON(w, 400, "at most two artifact dimensions")
		return
	}
	for i, dim := range dims {
		if !artifactLens(dim) || dim == "id" || i > 0 && dims[0] == dim || dim == "scorer" && selectedCheck == "" || strings.HasPrefix(dim, "band:") && (!allowed["score:"+strings.TrimPrefix(dim, "band:")] || selectedCheck != strings.TrimPrefix(dim, "band:")) {
			errJSON(w, 400, "unsupported artifact dimension "+dim)
			return
		}
	}
	if q.Get("bucket") != "" && q.Get("bucket") != "none" {
		errJSON(w, 400, "artifact bucket grouping is not available")
		return
	}
	rows, err := artifactPopulation(r.Context(), ts.t, f)
	if err != nil {
		readFailed(w)
		return
	}

	for i := range rows {
		if selectedCheck != "" {
			scorer, scored := rows[i].measures["score_scorer:"+selectedCheck]
			rows[i].lenses["scorer"] = scorer
			if !scored {
				rows[i].lenses["scorer"] = "unscored"
				rows[i].lenses["band:"+selectedCheck] = "unscored"
			}
		}
	}
	scope := len(rows)
	selected := rows[:0]
	for _, x := range rows {
		keep := q.Get("scorer") == "" || x.lenses["scorer"] == q.Get("scorer")
		for _, v := range ranges {
			n, valid := artifactNumber(x, v.Measure)
			if !valid || v.Lo != nil && n < *v.Lo || v.Hi != nil && n > *v.Hi {
				keep = false
				break
			}
		}
		if keep && (predicate == nil || predicate(x)) {
			selected = append(selected, x)
		}
	}
	rows = selected
	if len(fields) == 0 && mode == "list" {
		seen := map[string]bool{}
		for _, x := range rows {
			for name := range x.measures {
				if artifactNumericField(name) {
					seen[name] = true
				}
			}
		}
		for name := range seen {
			fields = append(fields, name)
		}
		sort.Strings(fields)
	}
	populations := map[string]any{}
	for _, field := range fields {
		eligible := 0
		for i := range rows {
			if _, ok := artifactNumber(rows[i], field); ok {
				eligible++
			} else {
				rows[i].measures[field] = nil
				reasons, ok := rows[i].flags["null_reasons"].(map[string]string)
				if !ok {
					reasons = map[string]string{}
					rows[i].flags["null_reasons"] = reasons
				}
				reasons[field] = artifactMissing(field)
			}
		}
		populations[field] = artifactTypedPopulation(scope, eligible, 0, map[string]int{artifactMissing(field): len(rows) - eligible})
		if field == "writing_session_cost_usd" {
			for key, value := range artifactWriterCostCoverage(rows) {
				populations[field].(map[string]any)[key] = value
			}
		}
	}
	out := map[string]any{"grain": "artifact", "mode": mode, "population": artifactTypedPopulation(scope, len(rows), 0, map[string]int{}), "populations": populations, "partial": ts.t.CompactionState() != "complete"}
	switch mode {
	case "aggregate":
		stat := q.Get("stat")
		if stat == "" {
			stat = "count"
		}
		field := q.Get("field")
		if stat != "count" && stat != "sum" && stat != "percentiles" && stat != "histogram" || stat != "count" && !allowed[field] || stat == "count" && field != "" {
			errJSON(w, 400, "unsupported artifact aggregate operation")
			return
		}
		if stat == "sum" && (!artifactAdditiveField(field)) {
			errJSON(w, 400, "field is not additive")
			return
		}
		budget := 20000
		if v := q.Get("max_cells"); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 {
				errJSON(w, 400, "invalid max_cells")
				return
			}
			budget = min(budget, n)
		}
		grouped := map[string][]artifactPopulationRow{}
		labels := map[string]map[string]any{}
		for _, x := range rows {
			label := map[string]any{}
			for _, d := range dims {
				label[d] = x.lenses[d]
			}
			b, _ := json.Marshal(label)
			key := string(b)
			grouped[key] = append(grouped[key], x)
			labels[key] = label
		}
		if len(dims) == 0 && len(grouped) == 0 {
			grouped["{}"] = nil
			labels["{}"] = map[string]any{}
		}
		ks := []string{}
		for k := range grouped {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		groups := []map[string]any{}
		cells := 0
		for _, k := range ks {
			group := artifactStatistics(grouped[k], stat, field)
			group["l"] = labels[k]
			eligible := group["eligible_n"].(int)
			group["population"] = artifactTypedPopulation(len(grouped[k]), eligible, 1, group["missing_by_reason"].(map[string]int))
			groups = append(groups, group)
			n := 1
			if stat == "histogram" {
				n = max(1, len(group["bins"].([]map[string]any)))
			}
			cells += n
		}
		// The shared budget uses the product of dimension cardinalities,
		// including sparse combinations, rather than only observed tuples.
		combinations := 1
		for _, dim := range dims {
			values := map[string]bool{}
			for _, row := range rows {
				values[fmt.Sprint(row.lenses[dim])] = true
			}
			if len(values) > 0 && combinations > budget/len(values) {
				combinations = budget + 1
				break
			}
			combinations *= len(values)
		}
		cells = max(cells, combinations)
		if cells > budget {
			errCodeJSON(w, 400, "too_many_cells", "artifact groups exceed the output cell budget", map[string]any{"max_cells": budget, "suggested_bucket": "none"})
			return
		}
		out["groups"], out["dims"], out["omitted_groups"], out["omitted_n"], out["cells"] = groups, dims, 0, 0, cells
		total := artifactStatistics(rows, stat, field)
		for k, v := range total {
			out[k] = v
		}
		out["population"] = artifactTypedPopulation(scope, total["eligible_n"].(int), len(groups), total["missing_by_reason"].(map[string]int))
	case "scatter":
		marginals := map[string]any{}
		eligible := 0
		missing := map[string]int{}
		for _, field := range fields {
			marginals[field] = artifactStatistics(rows, "histogram", field)["bins"]
		}
		for _, x := range rows {
			valid := true
			rowMissing := map[string]bool{}
			for _, field := range fields {
				if _, ok := artifactNumber(x, field); !ok {
					valid = false
					rowMissing[artifactMissing(field)] = true
				}
			}
			for reason := range rowMissing {
				missing[reason]++
			}
			if valid {
				eligible++
			}
		}
		sort.Slice(rows, func(i, j int) bool {
			a := sha256.Sum256([]byte(rows[i].entity.RepoID + "\x00" + rows[i].entity.Path))
			b := sha256.Sum256([]byte(rows[j].entity.RepoID + "\x00" + rows[j].entity.Path))
			return bytes.Compare(a[:], b[:]) < 0
		})
		n := len(rows)
		if len(rows) > 5000 {
			rows = rows[:5000]
		}
		out["population_n"], out["returned_n"], out["sampled"], out["sample_rule"], out["sample_limit"], out["marginals"], out["fields"] = n, len(rows), n > 5000, "lowest SHA-256 of repo_id and path", 5000, marginals, fields
		out["population"] = artifactTypedPopulation(scope, eligible, len(rows), missing)
		result := []map[string]any{}
		for _, x := range rows {
			result = append(result, x.json())
		}
		out["rows"] = result
	case "list":
		sortSpec := q.Get("sort")
		if sortSpec == "" {
			sortSpec = "last_ts:desc"
		}
		i := strings.LastIndex(sortSpec, ":")
		if i < 0 || !allowed[sortSpec[:i]] || (sortSpec[i+1:] != "asc" && sortSpec[i+1:] != "desc") {
			errJSON(w, 400, "unsupported artifact sort")
			return
		}
		field, desc := sortSpec[:i], sortSpec[i+1:] == "desc"
		less := func(a, b artifactPopulationRow) bool {
			av, aok := artifactNumber(a, field)
			bv, bok := artifactNumber(b, field)
			if aok != bok {
				return aok
			}
			if av != bv {
				if desc {
					return av > bv
				}
				return av < bv
			}
			if a.entity.RepoID != b.entity.RepoID {
				return a.entity.RepoID < b.entity.RepoID
			}
			return a.entity.Path < b.entity.Path
		}
		sort.Slice(rows, func(i, j int) bool { return less(rows[i], rows[j]) })
		if cur != nil {
			if len(cur.Key) != 3 {
				errJSON(w, 400, "invalid artifact cursor")
				return
			}
			boundary := artifactPopulationRow{entity: store.ArtifactEntity{RepoID: cur.Key[0], Path: cur.Key[1]}, measures: map[string]any{}}
			if cur.Key[2] == "value" {
				boundary.measures[field] = cur.TS
			}
			start := sort.Search(len(rows), func(i int) bool { return less(boundary, rows[i]) })
			rows = rows[start:]
		}
		if len(rows) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			value, valid := artifactNumber(last, field)
			state := "null"
			if valid {
				state = "value"
			}
			out["next"] = (cursor{Route: "entities:artifact", Filter: artifactCursorFilter(q), From: f.From.UnixNano(), To: f.To.UnixNano(), TS: value, Key: []string{last.entity.RepoID, last.entity.Path, state}}).encode()
		}
		result := []map[string]any{}
		for _, x := range rows {
			result = append(result, x.json())
		}
		out["rows"], out["sort"] = result, sortSpec
		out["population"].(map[string]any)["returned_n"] = len(rows)
	}
	for _, p := range populations {
		p.(map[string]any)["returned_n"] = out["population"].(map[string]any)["returned_n"]
	}
	writeJSON(w, 200, out)
}

func artifactStatistics(rows []artifactPopulationRow, stat, field string) map[string]any {
	values := []float64{}
	for _, x := range rows {
		if stat == "count" {
			values = append(values, 1)
		} else if v, ok := artifactNumber(x, field); ok {
			values = append(values, v)
		}
	}
	sort.Float64s(values)
	n := len(values)
	out := map[string]any{"stat": stat, "field": field, "eligible_n": n, "missing_by_reason": map[string]int{}}
	if field == "writing_session_cost_usd" {
		for key, value := range artifactWriterCostCoverage(rows) {
			out[key] = value
		}
	}
	if n < len(rows) {
		out["missing_by_reason"] = map[string]int{artifactMissing(field): len(rows) - n}
	}
	switch stat {
	case "count":
		out["value"] = n
	case "sum":
		out["value"] = nil
		if n > 0 {
			v := 0.0
			for _, x := range values {
				v += x
			}
			out["value"] = v
		}
	case "percentiles":
		for key, p := range map[string]float64{"p25": .25, "p50": .5, "p75": .75} {
			out[key] = nil
			if n > 0 {
				out[key] = values[max(0, int(math.Ceil(float64(n)*p))-1)]
			}
		}
	case "histogram":
		bins := []map[string]any{}
		if n > 0 {
			lo, hi := values[0], values[n-1]
			counts := [10]int{}
			for _, v := range values {
				b := 0
				if hi > lo {
					b = min(9, int((v-lo)/(hi-lo)*10))
				}
				counts[b]++
			}
			for i, n := range counts {
				if n > 0 {
					bins = append(bins, map[string]any{"bin": i + 1, "lo": lo + (hi-lo)*float64(i)/10, "hi": lo + (hi-lo)*float64(i+1)/10, "n": n})
				}
			}
		}
		out["bins"] = bins
	}
	return out
}

func timeFromCursor(ns int64) string { return time.Unix(0, ns).UTC().Format(time.RFC3339Nano) }

// Coverage is file-weighted like the containing population, including when a
// captured session is associated with several files.
func artifactWriterCostCoverage(rows []artifactPopulationRow) map[string]any {
	lower, unpriced, calls := 0, 0, 0.0
	for _, row := range rows {
		if row.flags["writing_session_cost_lower_bound"] == true {
			unpriced++
			if _, ok := artifactNumber(row, "writing_session_cost_usd"); ok {
				lower++
			}
		}
		if n, ok := row.flags["writing_session_unpriced_calls"].(float64); ok {
			calls += n
		}
	}
	return map[string]any{"lower_bound_n": lower, "unpriced_n": unpriced, "unpriced_calls": calls, "cost_lower_bound": unpriced > 0}
}
