# Brief: 6-05 — Cohort target routes, population, relation and associations

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/` analytics handlers and shared filter code, `packages/yakka/internal/store/` cohort-read support, focused serve/store tests, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-05-cohort-target-population.md` and include it in the commit.
Depends on: 6-04.
Runs alongside: Nothing; the time/activity unit extends the same response contract.
Budget: 14 files to read, about 700 lines to change, 26 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3.1 — Routes, Target restriction, Population and relation reporting, Association reporting, Invariants.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3 — typed populations and the `cohort=` paragraph.
3. `packages/yakka/internal/serve/analytics.go` (`parseFilter`), `analytics_activity.go`, `analytics_entities.go`, `analytics_query.go`, `analytics_distribution.go`, `analytics_score_series.go`.

## Goal

Apply the resolved cohort to exactly the eleven accepting routes, refuse it everywhere else with a named error, and carry the typed population, relation and association counts the contract places on each response.

## Contract

- `cohort=` is accepted by `/query`, `/distribution`, `/summary`, `/series`, `/conversations`, `/executions`, `/scores`, `/score-series`, `/explore`, `/activity` and `/entities` (all grains and modes). `/facets`, `/entity`, `/conversation`, `/content`, `/baselines` and `/schema` answer 400 `cohort_invalid` reason `route_not_supported`; none ignores the parameter.
- Target restriction keeps or removes contributing facts by the `conversation_id` of the sessions in C before the target computes measures; entities left with no contributing fact leave an entity-grain population. Derived attributes stay lifetime-derived.
- Population placement per 17.3.1: entity list/aggregate in the entity's unit; `/conversations` and `/executions` in the entity's unit; `/scores`/`/score-series` in `content_hash` per check; `/query`, `/distribution`, `/summary`, `/series`, `/explore` gain a `session`-unit population; `/entities?grain=time` keeps bucket-unit population and adds `population.relation.target_sessions = {unit:"session", scope_n, cohort_n}`; `/activity` carries `population.by_type`.
- `population.relation` is `{source_grain, target_grain, mapping, op, resolved_n, resolved_unit:"session", associations}` plus `target_sessions` where the route's population is not sessions; without a cohort it is `null`. `resolved_n` is `|C|` before the target window.
- `relation.associations` entries are `{side, contributor:"rejection", unit:"rejection", total_n, associated_n, missing_by_reason:{no_conversation_id, orphan_conversation_id}, treatment}` with `total_n = associated_n + no_conversation_id + orphan_conversation_id`. Target side appears on routes that can return a rejection count/row; treatment is `dropped` (include) or `kept` (exclude).
- Invariant: on a session target over the same scope, `cohort_n(op=include) + cohort_n(op=exclude) = scope_n`.

## Changes

- Centralise the accept/refuse decision in the shared filter parse so no accepting route silently skips the cohort and no refusing route ignores it.
- Thread the resolved relation and the association counts into the handlers above, reusing the 6-03 resolver output; do not re-resolve per measure when one source set serves the response.
- Ensure `/series` and `/summary` accept the cohort and gain a session-unit population; ensure `/facets` refuses even though it currently parses the shared filter.
- Reconcile counts within their own units; never equate session, artifact, plan and rejection counts.

### Keep untouched

Requests without `cohort=` must return exactly what they did before. Preserve existing units and measure semantics; only add the cohort-bearing fields. Do not add a route or a grain.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- Table test: all eleven routes accept a valid cohort (200) and the six refusing routes return 400 `cohort_invalid`/`route_not_supported`.
- Fixture: a session writing both a low- and a high-score artifact; board exclusion removes the resolved positive session set, not the complemented artifact predicate.
- `cohort_n(op=include) + cohort_n(op=exclude) = scope_n` on a session target; `relation.resolved_n` equals `|C|` before the window.
- Every rejection-bearing response satisfies the association identity; target treatment is `dropped`/`kept` as specified.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → passes (record, do not fix, the two time-dependent activity failures owned by 6-06).

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contradiction. Never resolve a contradiction silently.
