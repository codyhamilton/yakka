# Brief: 5-04 — Artifact schema, score bands and writing-session measures

Consumer: Plan 20 Phase 5 integration runner; the Phase 12 artifact reader consumes the schema and artifact rows.
Owned paths: `packages/yakka/internal/serve/analytics_query.go`, artifact population/serving code and focused tests under `packages/yakka/internal/serve/`, `packages/yakka/internal/store/` only for existing bounded session-measure or baseline reads, `docs/design/03-remote-service.md`, this plan's report. Touch nothing else.
Commits: Commit implementation and `docs/plans/20-analytics-reset/reports/5-04-artifact-schema-and-bands.md` together in one plain-summary commit.
Report: Under 1,500 tokens, per `packages/yakka/catalogue/checks/execution-report.json`.
Depends on: 5-01, 5-02, 5-03.
Runs alongside: nothing.
Budget: Read the 5-01/5-02/5-03 reports, CONTRACTS.md 17.2–17.4, the schema handler and artifact row code. Keep changes limited to Phase 5 metadata/row integration and focused fixture tests.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` §§17.2–17.4 — binding schema, artifact measure/lens, score, and baseline semantics.
2. `docs/plans/20-analytics-reset/DESIGN.md` Phase 5 outcome and the existing unit reports — fixed outcome and implementation handoffs.
3. `packages/yakka/internal/serve/analytics_query.go` and artifact population code — current feature/schema/row behavior.

## Goal

Complete the artifact-grain contract integration after its routes have landed. Publish only implemented Phase 5 capabilities through `/schema`, and expose scorer-specific bands and the declared writing-session measures on artifact rows.

## Contract

CONTRACTS.md §17.2 requires a capability schema for artifact measures, lenses, modes, budgets and joins, with feature flags only when routes/lens contracts are served. §17.3 defines artifact identity `(repo_id,path)`, selected-version scores and per-check scorers; artifact measures `versions`, `distinct_writing_sessions`, `first_ts`, `last_ts`, `content_bytes`, `score:<check>`, and selected-version `writing_session_cost_usd`, `_model_calls`, `_tokens_*`, `_hook_events`; and selected-check `scorer` and `band:<check>` lenses. Scores use the latest row per `(hash,check)`. Bands use all-time distinct-content baselines per kind/check/scorer, with strict below-p25/above-p75 and inclusive `mid`; absent baseline is `baseline_unavailable`, not `unscored`. Session measures are inside the board window and preserve no-call zero, all-unpriced null and partially priced lower-bound rules. §17.4 content capability is independently published only with the bounded content route.

## Changes

- Add the `entities_artifact` feature and an `artifact` grain entry to `/schema`, enumerating only the implemented list/detail/scatter/aggregate fields, modes, dimensions, supported statistics, null/time rules and the existing output budgets. Do not advertise artifact time-bucket grouping; 5-01 records that the contract does not choose a timestamp for a file spanning buckets. Keep Plan 6 features absent.
- Add `band:<check>` for selected artifact versions using the existing distinct-content scorer baseline. Apply latest-score selection before scorer association; use `baseline_unavailable` when no matching scorer baseline exists. Preserve unscored separately.
- Expose the selected version's writing-session cost/call/token/hook measures from its captured writer session, restricted to the active window, preserving the contract's null/lower-bound rules. Do not infer authorship or add another join.
- Update tests and the remote-service description only for these existing Phase 5 contracts. No contract edit, new route/grain/join/dependency, or UI.

### Keep untouched

Preserve legacy `/scores`, `/score-series`, `/baselines`, `/distribution`, content authorization and existing session measures/defaults. Do not change artifact identity, representative selection, cohort/plan/execution behavior, or the documented unadvertised artifact bucket behavior. Do not add a new baseline policy or any action/review capability.

## Done evidence

Identify or write the failing check before edits; include before and after evidence in the report.

- Schema test proves `entities_artifact` and the artifact metadata are present, `artifact_content` remains independently advertised, and Phase 6/design-only flags remain absent.
- Fixture tests prove scorer-specific strict/inclusive band boundaries, rescore selection, missing-baseline versus unscored states, and writing-session cost/model-call/token/hook measures for no-call, all-unpriced, partially priced and out-of-window cases.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passes. No animation/timing tests or live systems.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, any departure and why, and any contradiction. If the existing contract cannot support a field without inventing semantics, leave it unsupported and name the precise gap; do not alter the contract.
