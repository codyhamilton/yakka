package serve

import (
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

var kindOrder = []string{"design", "brief", "report"}

func validKind(k string) bool { return k == "design" || k == "brief" || k == "report" }

func badKind(w http.ResponseWriter) {
	writeJSON(w, 400, map[string]string{"error": "kind must be design, brief or report"})
}

// checks lists the checks serve loaded at start.
func (s *Server) checks(w http.ResponseWriter, r *http.Request, _ string, _ *tenantState) {
	kind := r.URL.Query().Get("kind")
	if kind != "" && !validKind(kind) {
		badKind(w)
		return
	}
	out := []map[string]any{}
	if s.opts.Checks == nil {
		writeJSON(w, 200, map[string]any{"checks": out, "loaded": false})
		return
	}
	for _, k := range kindOrder {
		if kind != "" && kind != k {
			continue
		}
		for _, c := range s.opts.Checks.For(k) {
			levels := c.Levels
			if levels == nil {
				levels = []string{}
			}
			out = append(out, map[string]any{"kind": c.Kind, "name": c.Name, "q": c.Q, "levels": levels, "invert": c.Invert})
		}
	}
	writeJSON(w, 200, map[string]any{"checks": out, "loaded": true})
}

// percentile is the linear interpolation between closest ranks (position (n-1)*q) of sorted values.
func percentile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	pos := float64(len(sorted)-1) * q
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	return sorted[lo] + (sorted[hi]-sorted[lo])*(pos-float64(lo))
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

func (s *Server) baselines(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	kind := q.Get("kind")
	if !validKind(kind) {
		badKind(w)
		return
	}
	population := q.Get("population")
	if population != "" && population != "content" {
		errJSON(w, 400, "population must be content")
		return
	}
	if population == "" && (q.Get("check") != "" || q.Get("scorer") != "") {
		errJSON(w, 400, "check and scorer require population=content")
		return
	}
	if population == "content" {
		rows, err := ts.t.LatestContentScores(r.Context(), kind)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "read failed"})
			return
		}
		selectedCheck, selectedScorer := q.Get("check"), q.Get("scorer")
		byScorer := map[string]map[string][]float64{}
		for _, row := range rows {
			if selectedCheck != "" && selectedCheck != row.Check || selectedScorer != "" && selectedScorer != row.Scorer {
				continue
			}
			if byScorer[row.Scorer] == nil {
				byScorer[row.Scorer] = map[string][]float64{}
			}
			byScorer[row.Scorer][row.Check] = append(byScorer[row.Scorer][row.Check], row.Score)
		}
		scorers := map[string]any{}
		for scorer, checks := range byScorer {
			outChecks := map[string]any{}
			for name, values := range checks {
				sort.Float64s(values)
				outChecks[name] = map[string]any{"n": len(values), "p25": round3(percentile(values, .25)),
					"median": round3(percentile(values, .5)), "p75": round3(percentile(values, .75))}
			}
			scorers[scorer] = outChecks
		}
		if selectedCheck != "" && selectedScorer != "" {
			if scorers[selectedScorer] == nil {
				scorers[selectedScorer] = map[string]any{}
			}
			checkRows := scorers[selectedScorer].(map[string]any)
			if checkRows[selectedCheck] == nil {
				checkRows[selectedCheck] = map[string]any{"n": 0, "p25": nil, "median": nil, "p75": nil}
			}
		}
		writeJSON(w, 200, map[string]any{"kind": kind, "population": "content", "scorers": scorers})
		return
	}
	rows, err := ts.t.LatestScores(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "read failed"})
		return
	}
	vals := map[string][]float64{}
	for _, b := range rows {
		if keys.Kind(b.Path) == kind {
			vals[b.Check] = append(vals[b.Check], b.Score)
		}
	}
	checks := map[string]any{}
	for name, v := range vals {
		sort.Float64s(v)
		checks[name] = map[string]any{"n": len(v), "p25": round3(percentile(v, 0.25)),
			"median": round3(percentile(v, 0.5)), "p75": round3(percentile(v, 0.75))}
	}
	writeJSON(w, 200, map[string]any{"kind": kind, "checks": checks})
}

var wordRE = regexp.MustCompile(`[\p{L}\p{N}_]+`)

// matchExpr turns free text into a safe FTS5 expression: up to 32 quoted word runs joined by OR.
func matchExpr(q string) string {
	words := wordRE.FindAllString(q, 32)
	expr := ""
	for i, w := range words {
		if i > 0 {
			expr += " OR "
		}
		expr += `"` + w + `"`
	}
	return expr
}

func (s *Server) search(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	qs := r.URL.Query()
	expr := matchExpr(qs.Get("q"))
	if expr == "" {
		writeJSON(w, 400, map[string]string{"error": "q is required"})
		return
	}
	kind := qs.Get("kind")
	if kind != "" && !validKind(kind) {
		badKind(w)
		return
	}
	limit := 10
	if v := qs.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "limit must be an integer"})
			return
		}
		limit = min(max(n, 1), 50)
	}
	var keep func(string) bool
	if kind != "" {
		keep = func(p string) bool { return keys.Kind(p) == kind }
	}
	found, err := ts.t.Search(r.Context(), expr, limit, keep)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "search failed"})
		return
	}
	hits := []map[string]any{}
	for _, h := range found {
		hits = append(hits, map[string]any{"repo_id": h.RepoID, "path": h.Path, "kind": keys.Kind(h.Path),
			"content_hash": h.ContentHash, "snippet": h.Snippet, "rank": h.Rank})
	}
	writeJSON(w, 200, map[string]any{"hits": hits})
}
