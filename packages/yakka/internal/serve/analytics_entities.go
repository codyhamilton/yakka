package serve

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// analyticsEntities exposes the Phase 4 session and time entities only. Later grains are absent
// from both this handler and /schema until their complete contracts are implemented.
func (s *Server) analyticsEntities(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	grain := q.Get("grain")
	switch grain {
	case "session":
		s.analyticsSessionEntities(w, r, ts)
	case "artifact":
		s.analyticsArtifactEntities(w, r, ts)
	case "plan":
		s.analyticsPlanEntities(w, r, ts)
	case "execution":
		s.analyticsExecutionEntities(w, r, ts)
	case "time":
		s.analyticsTimeEntities(w, r, ts)
	default:
		errJSON(w, 400, "grain must be session, artifact, plan, execution or time")
	}
}

func artifactMeasure(x store.ArtifactEntity, name string) float64 {
	switch name {
	case "first_ts":
		return x.FirstTS
	case "versions":
		return float64(x.Versions)
	case "distinct_writing_sessions":
		return float64(x.WritingSessions)
	default:
		return x.LastTS
	}
}

func parseArtifactRanges(values []string) ([]store.SessionRange, error) {
	out := make([]store.SessionRange, 0, len(values))
	for _, raw := range values {
		i := strings.LastIndex(raw, ":")
		measure, bounds, ok := "", "", i >= 0
		if ok {
			measure, bounds = raw[:i], raw[i+1:]
		}
		if !ok || !artifactNumericField(measure) {
			return nil, fmt.Errorf("unsupported artifact predicate measure %s", measure)
		}
		loText, hiText, ok := strings.Cut(bounds, "..")
		if !ok || (loText == "" && hiText == "") {
			return nil, fmt.Errorf("where must be <measure>:<lo>..<hi>")
		}
		var lo, hi *float64
		parse := func(v string) (*float64, error) {
			n, e := strconv.ParseFloat(v, 64)
			if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				return nil, fmt.Errorf("where bounds must be finite numbers")
			}
			return &n, nil
		}
		var err error
		if loText != "" {
			lo, err = parse(loText)
			if err != nil {
				return nil, err
			}
		}
		if hiText != "" {
			hi, err = parse(hiText)
			if err != nil {
				return nil, err
			}
		}
		if lo != nil && hi != nil && *lo > *hi {
			return nil, fmt.Errorf("where lower bound exceeds upper bound")
		}
		out = append(out, store.SessionRange{Measure: measure, Lo: lo, Hi: hi})
	}
	return out, nil
}

func (s *Server) analyticsEntity(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	q := r.URL.Query()
	if q.Get("grain") == "plan" {
		s.analyticsPlanDetail(w, r, ts)
		return
	}
	if q.Get("grain") != "artifact" {
		errJSON(w, 400, "grain must be artifact")
		return
	}
	repo, path := q.Get("repo_id"), q.Get("path")
	if repo == "" || path == "" {
		errJSON(w, 400, "repo_id and path required")
		return
	}
	collection := q.Get("collection")
	if collection == "" {
		collection = "versions"
	}
	if collection != "versions" {
		errJSON(w, 400, "unsupported artifact collection")
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	cursorFilter := canonFilter(q) + "|artifact_path=" + path
	if cur != nil && (cur.Route != "entity:artifact" || cur.Filter != cursorFilter) {
		errJSON(w, 400, "cursor mismatch")
		return
	}
	var after *int64
	hash := ""
	if cur != nil && len(cur.Key) == 2 {
		n, e := strconv.ParseInt(cur.Key[0], 10, 64)
		if e != nil {
			errJSON(w, 400, "invalid cursor")
			return
		}
		after = &n
		hash = cur.Key[1]
	}
	a, err := ts.t.Artifact(r.Context(), repo, path)
	if err != nil {
		readFailed(w)
		return
	}
	if a == nil {
		errJSON(w, 404, "artifact not found")
		return
	}
	latestWriter, err := ts.t.ArtifactVersionWriter(r.Context(), repo, path, a.Latest.ContentHash)
	if err != nil {
		readFailed(w)
		return
	}
	history, more, err := ts.t.ArtifactVersionHistory(r.Context(), repo, path, after, hash, limit)
	if err != nil {
		readFailed(w)
		return
	}
	ids := make([]string, 0, len(history))
	for _, v := range history {
		ids = append(ids, v.ConversationID)
	}
	provenance, err := ts.t.SessionProvenanceFor(r.Context(), ids)
	if err != nil {
		readFailed(w)
		return
	}
	versions := make([]map[string]any, 0, len(history))
	for _, v := range history {
		p := provenance[v.ConversationID]
		scores, e := ts.t.ArtifactVersionScores(r.Context(), v.Hash)
		if e != nil {
			readFailed(w)
			return
		}
		screen, e := ts.t.ArtifactScreen(r.Context(), v.Hash)
		if e != nil {
			readFailed(w)
			return
		}
		var scr any
		if screen != nil {
			scr = map[string]any{"verdict": screen.Verdict, "scorer": screen.Scorer, "at": screen.At}
		}
		versions = append(versions, map[string]any{"content_hash": v.Hash, "ts": v.TS, "received_at": time.Unix(0, v.ReceivedAt), "writing_session": v.ConversationID, "writing_session_label": "earliest observed writing session for this version", "writing_session_is_captured_provenance": true, "also_seen_sessions": v.AlsoSeen, "harness": p.Harness, "session_model": p.Model, "source": v.Source, "sha": v.SHA, "screen": scr, "scores": scores})
	}
	var next any
	if more && len(history) > 0 {
		last := history[len(history)-1]
		next = (cursor{Route: "entity:artifact", Filter: cursorFilter, Key: []string{strconv.FormatInt(last.ReceivedAt, 10), last.Hash}}).encode()
	}
	writeJSON(w, 200, map[string]any{"grain": "artifact", "id": map[string]any{"repo_id": repo, "path": path}, "versions": a.Versions, "latest": map[string]any{"content_hash": a.Latest.ContentHash, "received_at": a.Latest.ReceivedAt, "writing_session": latestWriter, "writing_session_label": "earliest observed writing session for this version", "writing_session_is_captured_provenance": true}, "collection": "versions", "rows": versions, "next": next, "population": map[string]any{"grain": "artifact_version", "unit": "repo_id,path,content_hash", "scope_n": a.Versions, "cohort_n": a.Versions, "eligible_n": a.Versions, "returned_n": len(versions), "missing_by_reason": map[string]int{}}})
}

func (s *Server) analyticsPlanEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	snapshot, err := ts.t.PlanExecutionSnapshot(r.Context())
	if err != nil {
		readFailed(w)
		return
	}
	sortSpec := q.Get("sort")
	if sortSpec == "" {
		sortSpec = "last_ts:desc"
	}
	sep := strings.LastIndexByte(sortSpec, ':')
	if sep < 0 {
		errJSON(w, 400, "sort must be <measure>:asc|desc")
		return
	}
	p := []string{sortSpec[:sep], sortSpec[sep+1:]}
	if p[0] == "" || (p[1] != "asc" && p[1] != "desc") {
		errJSON(w, 400, "sort must be <measure>:asc|desc")
		return
	}
	if strings.HasPrefix(p[0], "artifacts:") || strings.HasPrefix(p[0], "design_score:") {
		checks, checkErr := s.artifactChecks(r.Context(), ts.t)
		if checkErr != nil {
			readFailed(w)
			return
		}
		valid := false
		if strings.HasPrefix(p[0], "artifacts:") {
			kind := strings.TrimPrefix(p[0], "artifacts:")
			_, valid = checks[kind]
			valid = valid || kind == "design" || kind == "brief" || kind == "report"
		} else {
			check := strings.TrimPrefix(p[0], "design_score:")
			for _, name := range checks["design"] {
				valid = valid || name == check
			}
		}
		if !valid {
			errJSON(w, 400, "unsupported plan sort "+p[0])
			return
		}
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	f, ok := parseFilter(w, r, filterOpts{route: "entities:plan", cur: cur})
	if !ok {
		return
	}
	if cur != nil && (cur.Route != "entities:plan" || cur.Filter != canonFilter(q)) {
		errJSON(w, 400, "cursor mismatch")
		return
	}
	if cur != nil && !sameEntitySnapshot(cur, snapshot) {
		staleEntityCursor(w)
		return
	}
	var sc *store.PlanCursor
	if cur != nil && (len(cur.Key) == 2 || len(cur.Key) == 3) {
		sc = &store.PlanCursor{TS: cur.TS, RepoID: cur.Key[0], Plan: cur.Key[1], Null: len(cur.Key) == 3 && cur.Key[2] == "null"}
	}
	page, more, err := ts.t.PlanEntitiesPage(r.Context(), f, p[0], p[1] == "desc", sc, limit)
	if err != nil {
		errJSON(w, 400, "unsupported plan sort "+p[0])
		return
	}
	n, err := ts.t.PlanEntityCount(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	rows := make([]map[string]any, 0, len(page))
	for _, x := range page {
		execN := x.ExecutionsComplete + x.ExecutionsUnreported + x.ExecutionsStarted
		cost, unpriced, calls, costErr := ts.t.PlanAssociatedCost(r.Context(), f, x.RepoID, x.Plan)
		if costErr != nil {
			readFailed(w)
			return
		}
		var share any
		if execN > 0 {
			share = float64(x.ExecutionsComplete) / float64(execN)
		}
		m := map[string]any{"artifacts": x.Artifacts, "versions": x.Versions, "sessions": x.Sessions, "shared_sessions": x.SharedSessions, "associated_cost_usd": cost, "unpriced_calls": unpriced, "executions_complete": x.ExecutionsComplete, "executions_unreported": x.ExecutionsUnreported, "executions_started": x.ExecutionsStarted, "complete_share": share, "first_ts": x.FirstTS, "last_ts": x.LastTS, "span_days": (x.LastTS - x.FirstTS) / 86400}
		flags := map[string]any{}
		if calls == 0 {
			m["associated_cost_usd"] = float64(0)
		} else if unpriced > 0 {
			flags["associated_cost_lower_bound"] = true
			if unpriced == calls {
				m["associated_cost_usd"] = nil
				flags["associated_cost_null_reason"] = "all_unpriced"
			}
		}
		if execN == 0 {
			flags["complete_share_null_reason"] = "no_executions"
		}
		ids, idsErr := ts.t.PlanSessionIDs(r.Context(), f, x.RepoID, x.Plan)
		if idsErr != nil {
			readFailed(w)
			return
		}
		prov, provErr := ts.t.SessionProvenanceFor(r.Context(), ids)
		if provErr != nil {
			readFailed(w)
			return
		}
		harnesses, models := map[string]int{}, map[string]int{}
		for _, id := range ids {
			harnesses[prov[id].Harness]++
			models[prov[id].Model]++
		}
		lenses := map[string]any{"repo_id": x.RepoID, "harness": modeLens(harnesses), "session_model": dominantModelLens(models, len(ids))}
		m["artifacts_by_kind"] = x.ArtifactsByKind
		for kind, n := range x.ArtifactsByKind {
			m["artifacts:"+kind] = n
		}
		for check, score := range x.DesignScores {
			m["design_score:"+check] = score
		}
		rows = append(rows, map[string]any{"id": map[string]any{"repo_id": x.RepoID, "plan": x.Plan}, "m": m, "l": lenses, "flags": flags})
	}
	out := map[string]any{"grain": "plan", "rows": rows, "sort": sortSpec, "population": map[string]any{"grain": "plan", "unit": "repo_id,plan", "scope_n": n, "cohort_n": n, "eligible_n": n, "returned_n": len(rows), "missing_by_reason": map[string]int{}}}
	if more && len(page) > 0 {
		last := page[len(page)-1]
		ts := planMeasure(last, p[0])
		key := []string{last.RepoID, last.Plan}
		if last.SortValue == nil {
			key = append(key, "null")
		}
		out["next"] = (cursor{Route: "entities:plan", Filter: canonFilter(q), From: f.From.UnixNano(), To: f.To.UnixNano(), TS: ts, Key: key, FactWatermark: snapshot.FactWatermark, FactRowID: snapshot.FactRowID, Revision: snapshot.Revision}).encode()
	}
	writeJSON(w, 200, out)
}

func sameEntitySnapshot(cur *cursor, snapshot store.EntitySnapshot) bool {
	return cur.FactWatermark == snapshot.FactWatermark && cur.FactRowID == snapshot.FactRowID && cur.Revision == snapshot.Revision
}

func staleEntityCursor(w http.ResponseWriter) {
	errCodeJSON(w, http.StatusConflict, "cursor_stale", "analytics data changed during pagination; restart from the first page", map[string]any{"restart": true})
}

func modeLens(counts map[string]int) string {
	best, n := "unknown", 0
	for value, count := range counts {
		if count > n || count == n && value < best {
			best, n = value, count
		}
	}
	return best
}

func dominantModelLens(counts map[string]int, total int) string {
	if total == 0 {
		return "(none)"
	}
	best, n := "unknown", 0
	for value, count := range counts {
		if count > n || count == n && value < best {
			best, n = value, count
		}
	}
	if best == "unknown" && n == total {
		return best
	}
	if float64(n)/float64(total) < 0.8 {
		return "(mixed)"
	}
	return best
}

func planMeasure(x store.PlanEntity, name string) float64 {
	if x.SortValue != nil {
		return *x.SortValue
	}
	switch name {
	case "first_ts":
		return x.FirstTS
	case "artifacts":
		return float64(x.Artifacts)
	case "versions":
		return float64(x.Versions)
	case "sessions":
		return float64(x.Sessions)
	case "shared_sessions":
		return float64(x.SharedSessions)
	case "executions_complete":
		return float64(x.ExecutionsComplete)
	case "executions_unreported":
		return float64(x.ExecutionsUnreported)
	case "executions_started":
		return float64(x.ExecutionsStarted)
	case "span_days":
		return (x.LastTS - x.FirstTS) / 86400
	default:
		return x.LastTS
	}
}

func (s *Server) analyticsExecutionEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	snapshot, err := ts.t.PlanExecutionSnapshot(r.Context())
	if err != nil {
		readFailed(w)
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	f, ok := parseFilter(w, r, filterOpts{route: "entities:execution", cur: cur})
	if !ok {
		return
	}
	if cur != nil && (cur.Route != "entities:execution" || cur.Filter != canonFilter(q)) {
		errJSON(w, 400, "cursor mismatch")
		return
	}
	if cur != nil && !sameEntitySnapshot(cur, snapshot) {
		staleEntityCursor(w)
		return
	}
	var ec *store.ExecCursor
	if cur != nil && len(cur.Key) >= 3 {
		ec = &store.ExecCursor{TS: cur.TS, Key: cur.Key}
	}
	page, counts, more, err := ts.t.ExecutionsPage(r.Context(), f, nil, ec, limit)
	if err != nil {
		readFailed(w)
		return
	}
	rows := make([]map[string]any, 0, len(page))
	for _, x := range page {
		sf := f
		sf.ConversationIDs = []string{x.ConversationID}
		sessions, _, sessionErr := ts.t.SessionEntitiesPage(r.Context(), sf, "last_ts", true, nil, 1)
		if sessionErr != nil {
			readFailed(w)
			return
		}
		m := map[string]any{"ts": x.TS, "session_cost_usd": float64(0)}
		flags := map[string]any{}
		if len(sessions) > 0 {
			cost := sessions[0].Measures["cost_usd"]
			calls, unpriced := sessions[0].Measures["model_calls"], sessions[0].Measures["unpriced_calls"]
			if calls > 0 && calls == unpriced {
				m["session_cost_usd"] = nil
				flags["session_cost_null_reason"] = "all_unpriced"
			} else {
				m["session_cost_usd"] = cost
				if unpriced > 0 {
					flags["session_cost_lower_bound"] = true
				}
			}
		}
		prov, provErr := ts.t.SessionProvenanceFor(r.Context(), []string{x.ConversationID})
		if provErr != nil {
			readFailed(w)
			return
		}
		scores, scoreErr := ts.t.ExecutionScores(r.Context(), x.RepoID, x.Plan, x.ConversationID, x.BriefPath)
		if scoreErr != nil {
			readFailed(w)
			return
		}
		for name, score := range scores {
			m[name] = score
		}
		rows = append(rows, map[string]any{"id": map[string]any{"repo_id": x.RepoID, "conversation_id": x.ConversationID, "brief_path": x.BriefPath}, "m": m, "l": map[string]any{"shape": x.Shape, "plan": x.Plan, "repo_id": x.RepoID, "harness": x.Harness, "session_model": prov[x.ConversationID].Model}, "flags": flags})
	}
	n := counts["complete"] + counts["unreported"] + counts["started"]
	out := map[string]any{"grain": "execution", "rows": rows, "population": map[string]any{"grain": "execution", "unit": "repo_id,conversation_id,brief_path", "scope_n": n, "cohort_n": n, "eligible_n": n, "returned_n": len(rows), "missing_by_reason": map[string]int{}}}
	if more && len(page) > 0 {
		last := page[len(page)-1]
		out["next"] = (cursor{Route: "entities:execution", Filter: canonFilter(q), From: f.From.UnixNano(), To: f.To.UnixNano(), TS: last.TS, Key: []string{last.ConversationID, last.BriefPath, last.RepoID}, FactWatermark: snapshot.FactWatermark, FactRowID: snapshot.FactRowID, Revision: snapshot.Revision}).encode()
	}
	writeJSON(w, 200, out)
}

func (s *Server) analyticsPlanDetail(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	snapshot, err := ts.t.PlanExecutionSnapshot(r.Context())
	if err != nil {
		readFailed(w)
		return
	}
	repo, plan := q.Get("repo_id"), q.Get("plan")
	if repo == "" || plan == "" {
		errJSON(w, 400, "repo_id and plan required")
		return
	}
	collection := q.Get("collection")
	if collection == "" {
		collection = "artifacts"
	}
	if collection != "artifacts" && collection != "executions" && collection != "sessions" && collection != "events" {
		errJSON(w, 400, "unsupported plan collection")
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	cf := canonFilter(q) + "|plan=" + repo + ":" + plan + "|collection=" + collection
	after := ""
	var tsAfter float64
	if cur != nil {
		if cur.Route != "entity:plan:"+collection || cur.Filter != cf {
			errJSON(w, 400, "cursor mismatch")
			return
		}
		if !sameEntitySnapshot(cur, snapshot) {
			staleEntityCursor(w)
			return
		}
		after = firstKey(cur.Key)
		if collection == "events" && len(cur.Key) > 1 {
			after = cur.Key[0] + "|" + cur.Key[1]
		}
		if collection == "executions" && len(cur.Key) > 1 {
			after = cur.Key[0] + "|" + cur.Key[1]
		}
		tsAfter = cur.TS
	}
	filterCursor := cur
	if cur != nil {
		copy := *cur
		copy.Filter = canonFilter(q)
		filterCursor = &copy
	}
	f, ok := parseFilter(w, r, filterOpts{route: "entity:plan:" + collection, cur: filterCursor})
	if !ok {
		return
	}
	page, more, err := ts.t.PlanDetailPage(r.Context(), f, repo, plan, collection, after, tsAfter, limit)
	if err != nil {
		readFailed(w)
		return
	}
	rows := make([]map[string]any, 0, len(page))
	for _, x := range page {
		rows = append(rows, map[string]any{"repo_id": x.RepoID, "plan": x.Plan, "path": x.Path, "conversation_id": x.ConversationID, "event": x.Event, "event_type": x.Type, "ts": x.TS})
	}
	pop, err := ts.t.PlanDetailCount(r.Context(), f, repo, plan, collection)
	if err != nil {
		readFailed(w)
		return
	}
	out := map[string]any{"grain": "plan", "id": map[string]any{"repo_id": repo, "plan": plan}, "collection": collection, "rows": rows, "population": map[string]any{"grain": "plan_" + collection, "unit": collection, "scope_n": pop, "cohort_n": pop, "eligible_n": pop, "returned_n": len(rows), "missing_by_reason": map[string]int{}}}
	if more && len(page) > 0 {
		last := page[len(page)-1]
		key := []string{last.Path}
		if collection == "sessions" {
			key = []string{last.ConversationID}
		}
		if collection == "events" {
			key = []string{last.Type, strconv.FormatInt(last.RowID, 10)}
		} else if collection == "executions" {
			key = []string{last.ConversationID, last.Path}
		}
		out["next"] = (cursor{Route: "entity:plan:" + collection, Filter: cf, From: f.From.UnixNano(), To: f.To.UnixNano(), TS: last.TS, Key: key, FactWatermark: snapshot.FactWatermark, FactRowID: snapshot.FactRowID, Revision: snapshot.Revision}).encode()
	}
	writeJSON(w, 200, out)
}

func (s *Server) analyticsSessionEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = "list"
	}
	if mode == "scatter" {
		s.analyticsSessionScatter(w, r, ts)
		return
	}
	if mode == "aggregate" {
		s.analyticsSessionAggregate(w, r, ts)
		return
	}
	if mode != "list" {
		errJSON(w, 400, "unsupported session mode")
		return
	}
	sortSpec := q.Get("sort")
	if sortSpec == "" {
		sortSpec = "last_ts:desc"
	}
	sortParts := strings.Split(sortSpec, ":")
	if len(sortParts) != 2 || (sortParts[1] != "asc" && sortParts[1] != "desc") {
		errJSON(w, 400, "sort must be <measure>:asc|desc")
		return
	}
	sortBy, desc := sortParts[0], sortParts[1] == "desc"
	if !store.SessionSortMeasure(sortBy) {
		errJSON(w, 400, "unsupported session sort "+sortBy)
		return
	}
	limit, cur, ok := pageParams(w, r)
	if !ok {
		return
	}
	f, ok := parseFilter(w, r, filterOpts{route: "entities:session", cur: cur})
	if !ok {
		return
	}
	if len(r.URL.RawQuery) > 8192 {
		errJSON(w, 400, "session predicate exceeds the 8 KiB URL budget")
		return
	}
	ranges, err := parseSessionRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	f.SessionRanges = ranges
	if cur != nil && (cur.Route != "entities:session" || cur.Filter != canonFilter(q)) {
		errJSON(w, 400, "cursor mismatch")
		return
	}
	count, err := ts.t.ConversationCount(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	var sc *store.ConvCursor
	if cur != nil {
		sc = &store.ConvCursor{TS: cur.TS, ConversationID: firstKey(cur.Key)}
	}
	page, more, err := ts.t.SessionEntitiesPage(r.Context(), f, sortBy, desc, sc, limit)
	if err != nil {
		readFailed(w)
		return
	}
	ids := make([]string, len(page))
	for i := range page {
		ids[i] = page[i].ID
	}
	prov, err := ts.t.SessionProvenanceFor(r.Context(), ids)
	if err != nil {
		readFailed(w)
		return
	}
	rows := make([]map[string]any, 0, len(page))
	for _, row := range page {
		p := prov[row.ID]
		m := make(map[string]any, len(row.Measures))
		for k, v := range row.Measures {
			m[k] = v
		}
		var cost any = row.Measures["cost_usd"]
		lower := row.Measures["unpriced_calls"] > 0
		if row.Measures["model_calls"] > 0 && row.Measures["unpriced_calls"] == row.Measures["model_calls"] {
			cost = nil
		}
		m["cost_usd"] = cost
		l := map[string]any{"harness": p.Harness, "harnesses": p.Harnesses, "harness_mixed": p.HarnessMixed, "session_repo": p.Repo, "repos": p.Repos,
			"repo_attribution": p.RepoAttribution, "session_model": p.Model, "models": p.ModelShares}
		flags := map[string]any{}
		if lower {
			flags["cost_lower_bound"] = true
		}
		rows = append(rows, map[string]any{"id": row.ID, "m": m, "l": l, "flags": flags})
	}
	out := map[string]any{"grain": "session", "rows": rows, "population": map[string]any{"grain": "session", "unit": "conversation_id", "scope_n": count, "cohort_n": count, "eligible_n": count, "returned_n": len(rows), "missing_by_reason": map[string]int{}}, "sort": sortSpec, "partial": ts.t.CompactionState() != "complete"}
	if more && len(page) > 0 {
		last := page[len(page)-1]
		out["next"] = (cursor{Route: "entities:session", Filter: canonFilter(q), From: f.From.UnixNano(), To: f.To.UnixNano(), TS: last.Measures[sortBy], Key: []string{last.ID}}).encode()
	}
	writeJSON(w, 200, out)
}

func (s *Server) analyticsSessionAggregate(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	if len(r.URL.RawQuery) > 8192 {
		errJSON(w, 400, "session predicate exceeds the 8 KiB URL budget")
		return
	}
	if len(q["dim"]) > 0 {
		errJSON(w, 400, "session aggregate dimensions are not supported")
		return
	}
	stat := q.Get("stat")
	if stat == "" {
		stat = "count"
	}
	field := q.Get("field")
	if stat != "count" && stat != "sum" && stat != "percentiles" && stat != "histogram" {
		errJSON(w, 400, "unsupported session aggregate stat "+stat)
		return
	}
	if stat != "count" && !store.SessionSortMeasure(field) {
		errJSON(w, 400, "unsupported session aggregate field "+field)
		return
	}
	if stat == "count" && field != "" {
		errJSON(w, 400, "count does not accept field")
		return
	}
	if stat == "sum" && (field == "first_ts" || field == "last_ts") {
		errJSON(w, 400, "unsupported session sum field "+field)
		return
	}
	f, ok := parseFilter(w, r, filterOpts{query: true})
	if !ok {
		return
	}
	ranges, err := parseSessionRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	f.SessionRanges = ranges
	result, err := ts.t.SessionAggregate(r.Context(), f, stat, field)
	if err != nil {
		readFailed(w)
		return
	}
	pop, err := ts.t.ConversationCount(r.Context(), f)
	if err != nil {
		readFailed(w)
		return
	}
	eligible := pop
	if n, ok := result["eligible_n"].(int); ok {
		eligible = n
	}
	lowerBound := false
	if field == "cost_usd" && stat != "count" {
		var lowerBoundN int
		eligible, lowerBoundN, err = ts.t.SessionCostCoverage(r.Context(), f)
		if err != nil {
			readFailed(w)
			return
		}
		lowerBound = lowerBoundN > 0
	}
	result["grain"] = "session"
	missing := map[string]int{}
	if field == "cost_usd" && eligible < pop {
		missing["unpriced_cost"] = pop - eligible
	}
	result["population"] = map[string]any{"grain": "session", "unit": "conversation_id", "scope_n": pop, "cohort_n": pop, "eligible_n": eligible, "returned_n": 1, "missing_by_reason": missing}
	if lowerBound {
		result["cost_lower_bound"] = true
	}
	writeJSON(w, 200, result)
}

func parseSessionRanges(values []string) ([]store.SessionRange, error) {
	out := make([]store.SessionRange, 0, len(values))
	for _, raw := range values {
		i := strings.LastIndex(raw, ":")
		measure, bounds, ok := "", "", i >= 0
		if ok {
			measure, bounds = raw[:i], raw[i+1:]
		}
		if !ok || !store.SessionSortMeasure(measure) {
			return nil, fmt.Errorf("unsupported session predicate measure %s", measure)
		}
		loText, hiText, ok := strings.Cut(bounds, "..")
		if !ok || (loText == "" && hiText == "") {
			return nil, fmt.Errorf("where must be <measure>:<lo>..<hi>")
		}
		var lo, hi *float64
		parse := func(v string) (*float64, error) {
			n, e := strconv.ParseFloat(v, 64)
			if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				return nil, fmt.Errorf("where bounds must be finite numbers")
			}
			return &n, nil
		}
		var err error
		if loText != "" {
			lo, err = parse(loText)
			if err != nil {
				return nil, err
			}
		}
		if hiText != "" {
			hi, err = parse(hiText)
			if err != nil {
				return nil, err
			}
		}
		if lo != nil && hi != nil && *lo > *hi {
			return nil, fmt.Errorf("where lower bound exceeds upper bound")
		}
		out = append(out, store.SessionRange{Measure: measure, Lo: lo, Hi: hi})
	}
	return out, nil
}

func (s *Server) analyticsSessionScatter(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	fields := append([]string(nil), q["field"]...)
	if len(fields) == 0 {
		fields = append(fields, q["fields"]...)
	}
	var expanded []string
	for _, f := range fields {
		expanded = append(expanded, strings.Split(f, ",")...)
	}
	fields = expanded
	if len(fields) < 2 || len(fields) > 4 {
		errJSON(w, 400, "session scatter requires two to four fields")
		return
	}
	allowed := map[string]bool{"cost_usd": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true}
	seen := map[string]bool{}
	for _, f := range fields {
		if !allowed[f] || seen[f] {
			errJSON(w, 400, "unsupported session scatter field "+f)
			return
		}
		seen[f] = true
	}
	filter, ok := parseFilter(w, r, filterOpts{})
	if !ok {
		return
	}
	if len(r.URL.RawQuery) > 8192 {
		errJSON(w, 400, "session predicate exceeds the 8 KiB URL budget")
		return
	}
	ranges, err := parseSessionRanges(q["where"])
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	filter.SessionRanges = ranges
	population, err := ts.t.ConversationCount(r.Context(), filter)
	if err != nil {
		readFailed(w)
		return
	}
	limit := min(population, 5000)
	page, _, err := ts.t.SessionEntitiesPage(r.Context(), filter, "sample_hash", false, nil, limit)
	if err != nil {
		readFailed(w)
		return
	}
	ids := make([]string, len(page))
	for i := range page {
		ids[i] = page[i].ID
	}
	prov, err := ts.t.SessionProvenanceFor(r.Context(), ids)
	if err != nil {
		readFailed(w)
		return
	}
	points := make([]map[string]any, 0, len(page))
	for _, row := range page {
		m := map[string]any{}
		for _, f := range fields {
			v := any(row.Measures[f])
			if f == "cost_usd" && row.Measures["model_calls"] > 0 && row.Measures["unpriced_calls"] == row.Measures["model_calls"] {
				v = nil
			}
			m[f] = v
		}
		p := prov[row.ID]
		points = append(points, map[string]any{"id": row.ID, "m": m, "l": map[string]any{"session_repo": p.Repo, "session_model": p.Model, "harness": p.Harness}})
	}
	marginals := map[string]any{}
	eligible := map[string]int{}
	missing := map[string]int{}
	callSessions, err := ts.t.SessionCallConversationCount(r.Context(), filter)
	if err != nil {
		readFailed(w)
		return
	}
	noCalls := max(0, population-callSessions)
	for _, f := range fields {
		d, err := ts.t.Distribution(r.Context(), filter, store.DistributionParams{Measure: f, Grain: "conversation", Top: 100})
		if err != nil {
			readFailed(w)
			return
		}
		bins := []store.DistributionBin{}
		for _, g := range d.Rows {
			if g.K == "all" {
				bins = g.Bins
				break
			}
		}
		if noCalls > 0 {
			if len(bins) == 0 {
				// Distribution has no row when the population has no model calls;
				// represent the no-call sessions in the zero-value marginal bin.
				bins = append(bins, store.DistributionBin{Lo: 0})
			}
			// The first distribution bin is the zero-value bin for the supported
			// non-negative session usage and cost measures.
			bins[0].N += noCalls
		}
		marginals[f] = bins
		total := 0
		for _, b := range bins {
			total += b.N
		}
		if f == "cost_usd" {
			eligible[f] = total
			missing["unpriced_cost"] += max(0, population-total)
		} else {
			eligible[f] = total
		}
	}
	sampled := population > len(points)
	writeJSON(w, 200, map[string]any{"grain": "session", "mode": "scatter", "fields": fields, "rows": points, "sampled": sampled, "sample_rule": "lowest SHA-256 of conversation_id", "population_n": population, "returned_n": len(points), "marginals": marginals, "population": map[string]any{"grain": "session", "unit": "conversation_id", "scope_n": population, "cohort_n": population, "eligible_n": eligible, "returned_n": len(points), "missing_by_reason": missing}, "sample_limit": 5000})
}

func (s *Server) analyticsTimeEntities(w http.ResponseWriter, r *http.Request, ts *tenantState) {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = "aggregate"
	}
	if mode != "aggregate" {
		errJSON(w, 400, "unsupported time mode")
		return
	}
	fields := append([]string(nil), q["field"]...)
	if len(fields) == 0 {
		fields = append(fields, q["fields"]...)
	}
	var expanded []string
	for _, f := range fields {
		expanded = append(expanded, strings.Split(f, ",")...)
	}
	fields = expanded
	if len(fields) < 2 || len(fields) > 4 {
		errJSON(w, 400, "time entities require two to four fields")
		return
	}
	allowed := map[string]bool{}
	for _, m := range store.Measures() {
		allowed[m.Name] = true
	}
	seen := map[string]bool{}
	for _, f := range fields {
		if !allowed[f] || seen[f] {
			errJSON(w, 400, "unknown or repeated time measure "+f)
			return
		}
		seen[f] = true
	}
	stat := q.Get("stat")
	if stat == "" {
		stat = "sum"
	}
	if stat != "sum" {
		errJSON(w, 400, "time entities support stat=sum")
		return
	}
	f, ok := parseFilter(w, r, filterOpts{query: true})
	if !ok {
		return
	}
	populations := make([]string, len(fields))
	for i, measure := range fields {
		populations[i] = "measure:" + measure
	}
	f, window, empty, err := resolveRouteWindow(r.Context(), ts.t, populations, f)
	if err != nil {
		readFailed(w)
		return
	}
	if empty {
		writeJSON(w, 200, map[string]any{"grain": "time", "bucket": "none", "fields": fields, "rows": []any{}, "population": map[string]any{"grain": "time", "unit": "bucket", "scope_n": 0, "cohort_n": 0, "eligible_n": 0, "returned_n": 0, "missing_by_reason": map[string]int{}}, "window": window})
		return
	}
	bucket := q.Get("bucket")
	cellBudget := 20000
	if v := q.Get("max_cells"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil || n < 1 {
			errJSON(w, 400, "max_cells must be a positive integer")
			return
		}
		cellBudget = min(cellBudget, n)
	}
	if bucket == "" || bucket == "auto" {
		bucket = resolveAutoBucket(f.From, f.To, f.TZ, max(1, cellBudget/len(fields)))
	}
	if bucket == "none" {
		errJSON(w, 400, "time entities require a bucket")
		return
	}
	if bucketSpan(f.From, f.To, bucket, f.TZ)*len(fields) > cellBudget {
		next, step := nextBucket(bucket)
		errCodeJSON(w, 400, "too_many_cells", "time entity exceeds cell budget", map[string]any{"max_cells": cellBudget, "suggested_bucket": next, "suggested_bucket_step": step})
		return
	}
	grid := map[string]map[string]float64{}
	for _, measure := range fields {
		res, err := ts.t.Query(r.Context(), f, store.QueryParams{Measure: measure, Bucket: bucket, Top: 100})
		if err != nil {
			if err == store.ErrUnsupported {
				errJSON(w, 400, "unsupported time measure")
			} else {
				readFailed(w)
			}
			return
		}
		for _, row := range res.Rows {
			if grid[row.T] == nil {
				grid[row.T] = map[string]float64{}
			}
			grid[row.T][measure] = row.V
		}
		bucket = res.Bucket
	}
	keys := make([]string, 0, len(grid))
	for k := range grid {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	rows := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		m := map[string]any{}
		for _, f := range fields {
			if v, ok := grid[k][f]; ok {
				m[f] = v
			} else {
				m[f] = 0
			}
		}
		rows = append(rows, map[string]any{"id": map[string]any{"t": k, "tz": fTZ(f)}, "m": m, "l": map[string]any{}, "flags": map[string]any{}})
	}
	writeJSON(w, 200, map[string]any{"grain": "time", "bucket": bucket, "fields": fields, "rows": rows, "population": map[string]any{"grain": "time", "unit": "bucket", "scope_n": len(rows), "cohort_n": len(rows), "eligible_n": len(rows), "returned_n": len(rows), "missing_by_reason": map[string]int{}}, "window": window})
}

func fTZ(f store.AnalyticsFilter) string {
	if f.TZ == nil {
		return "UTC"
	}
	return f.TZ.String()
}
func firstKey(xs []string) string {
	if len(xs) == 0 {
		return ""
	}
	return xs[0]
}
