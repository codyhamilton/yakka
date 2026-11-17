# Brief: 6-05b — Typed population, relation and association reporting

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/` analytics handlers and shared filter/population code, `packages/yakka/internal/store/` cohort count and rejection-association reads, focused serve/store tests, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-05b-cohort-population-relation.md` and include it in the commit.
Depends on: 6-05.
Runs alongside: Nothing.
Budget: 12 files to read, about 600 lines to change, 24 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3.1 — Population and relation reporting, Association reporting, Invariants (1)-(3).
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3 — Typed populations.
3. `packages/yakka/internal/serve/analytics.go`, `analytics_query.go`, `analytics_distribution.go`, `analytics_score_series.go`, `analytics_entities.go`, `analytics_artifact_population.go`.

## Goal

Carry the typed population, `relation` object and rejection-association counts 17.3.1 places on each accepting route, closing the gap left by 6-05.

## Contract

- With a cohort, `population` is carried as 17.3.1 says: entity list/aggregate in the entity's unit; `/conversations` and `/executions` in the entity's unit; `/scores` and `/score-series` in `content_hash` per check; `/query`, `/distribution`, `/summary`, `/series`, `/explore` gain a `session`-unit population. `/entities?grain=time` and `/activity` are extended by 6-06, not here.
- `population.relation` is `{source_grain, target_grain, mapping, op, resolved_n, resolved_unit:"session", associations}`; without a cohort it stays `null`. `resolved_n` is `|C|` before the target window. `target_sessions` is added only where the route's population is not sessions (6-06 for time).
- Session-unit `scope_n` and `cohort_n` count distinct sessions with at least one eligible in-scope contributing fact before and after restriction. `population.missing_by_reason` stays target eligibility only.
- `relation.associations` is an array (empty when the route/source cannot involve unassociated rows) of `{side, contributor:"rejection", unit:"rejection", total_n, associated_n, missing_by_reason:{no_conversation_id, orphan_conversation_id}, treatment}`. Target side appears on `/query` and `/series` with `rejections`, `/summary`, `/explore` (and time `/entities`/`/activity` in 6-06). `treatment` is `dropped` under `op=include` and `kept` under `op=exclude`. `total_n = associated_n + no_conversation_id + orphan_conversation_id`.
- Invariant (3): on a session target over the same scope, `cohort_n(op=include) + cohort_n(op=exclude) = scope_n`.

## Changes

- Have the resolver expose `|C|` (distinct resolved sessions) so handlers do not re-resolve for the count. Compute it inside SQL under the existing deadline, not by materialising ids.
- Add one shared helper that builds the `population`/`relation` objects from a resolved cohort + target counts, and use it in each accepting route so the shape is identical everywhere.
- Add the rejection-association read: classify rejections in the route's own scope into associated (recorded conversation id names a session with at least one non-`session_action` fact), missing (no conversation id) and orphan (unknown conversation id); never inner-join away unassociated rows.
- Keep each route's existing measures and units; add only the cohort-bearing fields.

### Keep untouched

No-cohort responses stay exactly as before. Do not implement the time-route `target_sessions`, time/activity associations, or `/activity population.by_type` here (6-06). Do not change measure semantics or add a route/grain.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- Each accepting route with a cohort returns `population.relation` with the exact fields and `resolved_n`; no-cohort responses still report `relation: null`.
- `cohort_n(op=include) + cohort_n(op=exclude) = scope_n` on a session target.
- Every rejection-bearing response satisfies the association identity and its `treatment`; missing and orphan are separate and non-zero on a fixture that has both.
- `/scores` and `/score-series` report `content_hash` unit; `/query`/`/distribution`/`/summary`/`/series`/`/explore` report `session` unit.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → passes (record, do not fix, the two activity failures owned by 6-06).

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contradiction. Never resolve a contradiction silently.
