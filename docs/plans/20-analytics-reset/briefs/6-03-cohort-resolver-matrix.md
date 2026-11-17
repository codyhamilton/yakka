# Brief: 6-03 — Full cohort resolver matrix

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/store/analytics_cohort.go`, `packages/yakka/internal/store/plan_entities.go`, `packages/yakka/internal/store/artifact_entities.go` and `packages/yakka/internal/store/analytics.go` only where a resolver read is added, focused store tests, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-03-cohort-resolver-matrix.md` and include it in the commit.
Depends on: 6-02.
Runs alongside: Nothing; schema publication and route integration consume this resolver.
Budget: 12 files to read, about 700 lines to change, 24 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3.1 — the normative Capability matrix, Matrix is the maximum, Source requirement, Resolves to sessions by.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3 — the `cohort=` and Time-cohort resolution paragraphs.
3. `packages/yakka/internal/store/analytics_cohort.go`, `plan_entities.go`, `artifact_entities.go` — existing source subqueries and derived-measure SQL.
4. `docs/plans/20-analytics-reset/DESIGN.md` Phase 6 outcome and Assumption 31.

## Goal

Resolve every measure and lens the 17.3.1 matrix owes (all six grains, excluding only session `origin`/`has_artifacts`) into a bounded positive session set, with the signed source requirement and scope include/exclude, so the schema can offer only what the resolver answers.

## Contract

17.3.1's Capability matrix and "Matrix is the maximum" are binding. A predicate leaf compares the same value the entity row returns in `m`/`l` (lower bounds included); `range` on null is false and `is_null` is true on null. Dynamic names `score:<check>`, `design_score:<check>`, `brief_score:<check>`, `report_score:<check>`, `band:<check>` and `artifacts:<kind>` are validated against the active catalogue; an unknown name is `cohort_invalid`, a known check that does not apply yields null. Artifact `source.check` is required exactly when `scorer` is used; content requires `source:{kind,check}`. Source restriction resolves to sessions exactly as the matrix's last column says. Keep everything inside parameterized SQLite subqueries under the existing deadline/memory budgets; never materialize an unbounded id slice.

## Changes

- Extend the kernel measure/lens tables to the matrix, including session `first_ts`/`last_ts` and `id`; artifact `content_bytes`, `score:<check>`, `writing_session_*`, `band:<check>` and `id`; content `score` and its lenses; execution `brief_score:<check>`/`report_score:<check>` and `id`; plan `artifacts:<kind>`, `design_score:<check>`, `executions_*`, `complete_share`, `span_days`, `first_ts`/`last_ts` and `id`.
- Session lenses `harness`/`session_model`/`session_repo` must use the lifetime-derived values the `/entities?grain=session` row reports (same 80% model rule, `(multi)`, `(mixed)`, `(none)`, `unknown`), not fact-level values. Reuse the existing provenance code or its SQL.
- Artifact `source` uses the selected-version writing session and its attribution; `band:<check>` uses the same all-time distinct-content scorer baseline as the artifact rows; `id` is the canonical compact JSON identity.
- Content resolves by `/scores`' representative rule (`WindowScoreObservations`: earliest eligible fact per hash ordered `ts,row_hash,repo_id,path`) and that representative's writing session; it is aggregate/cohort-only and requires both kind and check.
- Execution resolves through its `conversation_id`; plan through associated sessions; time keeps the existing contributor rule. Session resolves to itself.
- Apply the canonical scope include/exclude from 6-02 to each source population (include first, then exclude) using each grain's own lens columns; a mapped-but-missing lens is `unsupported_join`, never ignored.
- `CohortSessionSubquery` returns the relation metadata the route unit needs (source grain, mapping, `resolved_n` support). Keep source Boolean `not` complementing inside the source grain before resolution; keep `op=exclude` as target-side subtraction.

### Keep untouched

Preserve the existing time resolver's bucket/DST replay and deduplicated usage identity; preserve `usageRowsWhere`, `execShapeSQL`, `PlanDesignScores`, `PlanArtifactKinds` and `WindowScoreObservations` semantics. Do not add a new grain, join or route.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- Focused fixture tests per grain resolve every matrix measure and lens, including `id`, dynamic checks and `band:<check>`, artifact `scorer`+`source.check`, content kind/check, plan derived measures, and session lifetime lenses on a two-harness/`(mixed)`-model session.
- Scope include/exclude changes the resolved set; `scope.exclude` and `op=exclude` differ on a fixture where the two sets differ; an empty source set is valid; an unknown/unsupported name returns the named error.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store -count=1` → passes. Record the two pre-existing activity failures (owned by 6-06) if the serve suite is run.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contradiction. Never resolve a contradiction silently.
