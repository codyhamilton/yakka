package serve

import (
	"context"
	"net/http"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// withoutCohort clears the cohort restriction so a read sees the route's own scope before
// restriction (17.3.1's target side total_n and pre-cohort session counts).
func withoutCohort(f store.AnalyticsFilter) store.AnalyticsFilter {
	f.CohortSQL, f.CohortArgs, f.CohortExclude = "", nil, false
	f.CohortSourceGrain, f.CohortMapping, f.CohortOp = "", "", ""
	f.CohortSourceAssociation = nil
	return f
}

// cohortSessionCounts returns distinct in-window sessions with at least one contributing fact,
// before and after the cohort restriction. Without a cohort both are the same count.
func cohortSessionCounts(ctx context.Context, t *store.Tenant, f store.AnalyticsFilter) (scopeN, cohortN int, err error) {
	cohortN, err = t.ConversationCount(ctx, f)
	if err != nil || f.CohortSQL == "" {
		return cohortN, cohortN, err
	}
	scopeN, err = t.ConversationCount(ctx, withoutCohort(f))
	return scopeN, cohortN, err
}

// cohortRelation builds the 17.3.1 relation object, or nil without a cohort. associations is
// non-nil only on routes that can return a rejection count or row. targetSessions is added when
// the route's own population is not in sessions. A default empty associations array keeps the
// shape identical everywhere.
func cohortRelation(ctx context.Context, t *store.Tenant, f store.AnalyticsFilter, withAssociations bool, scopeN, cohortN int, targetSessions bool) (map[string]any, error) {
	if f.CohortSQL == "" {
		return nil, nil
	}
	resolvedN, err := t.CohortCount(ctx, f)
	if err != nil {
		return nil, err
	}
	rel := map[string]any{
		"source_grain":  f.CohortSourceGrain,
		"target_grain":  "session",
		"mapping":       f.CohortMapping,
		"op":            f.CohortOp,
		"resolved_n":    resolvedN,
		"resolved_unit": "session",
		"associations":  []any{},
	}
	if withAssociations {
		a, err := t.RejectionAssociations(ctx, withoutCohort(f))
		if err != nil {
			return nil, err
		}
		treatment := "dropped"
		if f.CohortExclude {
			treatment = "kept"
		}
		rel["associations"] = []any{map[string]any{
			"side":         "target",
			"contributor":  "rejection",
			"unit":         "rejection",
			"total_n":      a.Total,
			"associated_n": a.Associated,
			"missing_by_reason": map[string]int{
				"no_conversation_id":     a.NoConversationID,
				"orphan_conversation_id": a.OrphanConversationID,
			},
			"treatment": treatment,
		}}
	}
	if f.CohortSourceAssociation != nil {
		a := *f.CohortSourceAssociation
		rel["associations"] = append(rel["associations"].([]any), map[string]any{
			"side":         "source",
			"contributor":  "rejection",
			"unit":         "rejection",
			"total_n":      a.Total,
			"associated_n": a.Associated,
			"missing_by_reason": map[string]int{
				"no_conversation_id":     a.NoConversationID,
				"orphan_conversation_id": a.OrphanConversationID,
			},
			"treatment": "selected",
		})
	}
	if targetSessions {
		rel["target_sessions"] = map[string]any{"unit": "session", "scope_n": scopeN, "cohort_n": cohortN}
	}
	return rel, nil
}

// sessionPopulation is the session-unit typed population for the legacy routes that carried no
// population object before 17.3.1.
func sessionPopulation(scopeN, cohortN, returnedN int, relation map[string]any) map[string]any {
	return map[string]any{
		"grain":             "session",
		"unit":              "conversation_id",
		"scope_n":           scopeN,
		"cohort_n":          cohortN,
		"eligible_n":        cohortN,
		"returned_n":        returnedN,
		"missing_by_reason": map[string]int{},
		"relation":          relation,
	}
}

// contentPopulation is the content_hash-unit population /scores and /score-series report,
// including the session relation's target_sessions counts.
func contentPopulation(ctx context.Context, r *http.Request, ts *tenantState, f store.AnalyticsFilter, kind string) (map[string]any, error) {
	n, err := ts.t.ContentHashCount(ctx, f, kind)
	if err != nil {
		return nil, err
	}
	scopeN, cohortN, err := cohortSessionCounts(ctx, ts.t, f)
	if err != nil {
		return nil, err
	}
	rel, err := cohortRelation(ctx, ts.t, f, false, scopeN, cohortN, true)
	if err != nil {
		return nil, err
	}
	return map[string]any{"grain": "content", "unit": "content_hash",
		"scope_n": n, "cohort_n": n, "eligible_n": n, "returned_n": 0,
		"missing_by_reason": map[string]int{}, "relation": rel}, nil
}
