# Brief: phase2-03 — Conditional conversation distributions and correct session-scatter marginals

Consumer: the execute worker for phase2-03; the Phase 2 verifier reads the conversation-distribution and session-scatter evidence.
Owned paths: `packages/yakka/internal/store/distribution.go`, `packages/yakka/internal/store/session_entities.go`, `packages/yakka/internal/serve/analytics_entities.go` (session-scatter region only: `analyticsSessionScatter` around 1064-1220, plus private helpers used only by it), `packages/yakka/internal/serve/analytics_distribution.go`, `packages/yakka/internal/store/phase2_distribution_scale_test.go` (new), `packages/yakka/internal/serve/analytics_session_scatter_marginals_test.go` (new), `packages/yakka/internal/serve/analytics_distribution_scale_test.go` (new). Do not edit the plan region (around 198-420) or other parts of `analytics_entities.go`; phase2-02 owns those. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase2-03-conversation-distribution.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-02 (both change `analytics_entities.go`), phase2-01 (retained-scale evidence). Runs alongside: nothing.
Budget: read about 10 files, change about 320 lines, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:177` — Phase 2 outcome; `:97-98` — conditional provenance, sample/marginal semantics and the performance contract; `:85` — session scatter fields; `:89-100` — the domain.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:38` — D08; `:41` — D11; `:63,69,71` — Compare/Cost/Scatter observations.
3. `docs/design/09-analytics-workspace-contracts.md:63` — session cost null/lower-bound; `:77` — "marginals … over the whole population, not the sample"; `:81` — `/distribution` lens dims; `:24-25` — deadline/cancellation and aggregation bounds.
4. `packages/yakka/internal/store/distribution.go:61-223` — conversation and call SQL, provenance CTEs, top-N/omitted groups and bins; `:241-257` — `distributionValueSQL`.
5. `packages/yakka/internal/serve/analytics_distribution.go:15-91` — route validation and response.
6. `packages/yakka/internal/serve/analytics_entities.go:618-776` — session lens population/page/helpers; `:1064-1220` — `analyticsSessionScatter`, including the per-field `Distribution` calls and marginal assembly.
7. `packages/yakka/internal/store/session_entities.go:23-43` — `sessionAggregateCTE`; `:200-290` — `SessionProvenanceFor`; `:338-350` — `ConversationCount`; `:380-431` — `sessionPredicateSQL`.
8. Existing tests: `packages/yakka/internal/store/distribution_test.go:15-180`; `packages/yakka/internal/serve/analytics_distribution_test.go:18-80`; `packages/yakka/internal/serve/analytics_query_test.go:280-335,569-600`.
9. The phase1-06 report carried item: `docs/plans/29-analytics-ui-rework/reports/phase1-06-capability-parity.md:115-124` — all-zero `commits`/`unpriced_calls` marginals and the cell-budget residue.
10. `packages/yakka/internal/serve/analytics_retained_bench_test.go` and `testdata/retained-request-shapes.json` from phase2-01.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make conversation-grain distributions and session scatter complete at retained-history scale, derive only the provenance an answer needs, and give `commits` and `unpriced_calls` correct whole-population marginal histograms instead of all-zero bins.

## Contract

- `DESIGN.md:97`: "Preserve counts, lifetime-derived provenance, in-window measures, scorer identity, cursor snapshots, sample/marginal semantics and overlapping associated plan cost while eliminating repeated scans. … load only the provenance a distribution needs."
- `EVIDENCE.md:41`: "Restrict provenance to candidate sessions and only requested lenses, reuse/batch it. Keep full-lifetime meaning rather than changing attribution to window-only."
- `09-analytics-workspace-contracts.md:77`: "plus `marginals` (fixed-bin histograms of each field over the **whole population**, not the sample)."
- `09-analytics-workspace-contracts.md:63`: "a session whose calls are all unpriced reports `cost_usd: null`, never 0."
- Performance acceptance, verbatim: "Retain the existing p95 ≤500 ms target over at least 20 warm requests per affected request shape, measured alone and with a four-request board load; no timeout in either run. Record cold/migration latency separately. The one-second deadline is not increased as the acceptance mechanism."
- Carried from phase1-06: session-scatter marginals for `commits` and `unpriced_calls` are all-zero; row values in `rows[].m` are correct, only the marginal histograms are degenerate. This unit owns that fix.

## Changes

- **Conversation distribution provenance** (`distribution.go`):
  - When `grain=conversation` and `dim=""`, do not join the `session_repo`, `session_harness` or `session_model` derivations; aggregate the `kept` usage CTE per conversation directly.
  - When a dim is requested, derive only that lens. Compute the candidate conversation set from `kept` first, then read lifetime provenance for those candidates only (not all facts). Keep the full-lifetime meaning: repo from lifetime artifact/commit facts, harness mode and model dominance over lifetime facts as today.
  - `dim=session_repo` must count distinct nonempty `repo_id` among the candidate conversations' lifetime artifact/commit facts and preserve `(multi)`/`(none)`.
  - Preserve per-group n/unpriced, percentiles, fixed bins, `truncated`, `omitted_groups`, `omitted_n`, `omitted_unpriced`, and the deterministic `n desc, key asc` order.
- **Call distribution**: leave the call-grain path's semantics unchanged; apply the same "only what the dim needs" rule where it already joins `session_repo`.
- **Session-scatter marginals** (`session_entities.go` and/or `distribution.go`): add one store-level session-grain marginal calculation that, for each requested scatter field, returns the fixed-bin histogram over the whole session population under the same filter the scatter uses. Drive it from `sessionAggregateCTE` (or an equivalent single grouped read) so `commits` and `unpriced_calls` use their real session values; for `cost_usd` keep the priced-only eligibility and the no-call/no-priced semantics; for token fields keep the existing values. Do not compute one full `Distribution` query per field.
  - Keep the existing `Distribution` route's public measure list unchanged: `commits` and `unpriced_calls` are session-scatter fields, not new `/distribution` measures.
  - Preserve the current no-call zero-bin adjustment, `eligible_n` per field, and `missing_by_reason.unpriced_cost`; a `commits`/`unpriced_calls` marginal total must equal the scatter population.
- **Session scatter** (`analytics_entities.go`): derive the session population/measures once, batch `SessionProvenanceFor` for the returned sample once, and use the new marginal method instead of calling `Distribution` per field. Keep `sample_hash` ordering, the deterministic hash sample, `sample_limit: 5000`, `population_n`, `returned_n`, `sampled`, `sample_rule`, and row `m`/`l`/null handling unchanged.

### Keep untouched

- Public `/distribution` route measures/dims and wire shape; `/distribution` must still reject a non-published measure.
- Session-scatter row values, deterministic sample rule, whole-population (not sample) marginal meaning, and null/all-unpriced/partial semantics.
- Lifetime provenance meaning; grain identities; `sessionLensFilter` population/filter behavior.
- One-second deadline; no new approximate percentiles; no backfill.
- Production parity, deployment and the Plan 28 trial.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after. Retained-scale harness data lives under the worktree's ignored `.scratch/`, never `/tmp`; ordinary unit fixtures may use `t.TempDir()`. Use `GOTOOLCHAIN=auto` and `GOMEMLIMIT=8GiB`.

- New `TestAnalyticsSessionScatterMarginalsCommitsUnpriced` → fails before, passes after. Build sessions with known commits counts and known priced/unpriced call counts; request `fields=cost_usd,commits,unpriced_calls`. Before: `commits` and `unpriced_calls` marginal totals are 0 while the row values are correct. After: each marginal total equals `population_n`, the nonzero bins match the constructed values, and cost/token marginals are unchanged.
- Existing marginals tests stay green: `… go test ./internal/serve -run 'TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals|TestAnalyticsSessionScatterMarginalsHonorWhere' -count=1`.
- Retained scale (phase2-01): `YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20 go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -timeout 30m` filtered to conversation-distribution and session-scatter shapes. Report before/after p95 alone and under the four-request load for: cost conversation `dim=session_repo|model|harness|session_model`; token conversation; call cost `dim=harness`; session scatter cost/commits/unpriced and cost/tokens. Expectation: p95 ≤500 ms alone and under load, zero 503, marginals over the whole population.
- Correctness oracle: conversation-distribution groups and omitted counts equal an independent reference query on the same fixture; each scatter marginal's per-bin counts equal a direct `sessionAggregateCTE` histogram.
- Regressions: `… go test ./internal/store -run 'TestDistribution' -count=1` and `… go test ./internal/serve -run 'TestDistribution|TestAnalyticsSessionScatter' -count=1` → pass.
- `gofmt -l` clean on changed files; `go vet ./internal/store ./internal/serve` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
