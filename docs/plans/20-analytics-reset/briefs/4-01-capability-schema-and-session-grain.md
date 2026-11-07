# Brief: 4-01 — Capability schema and session grain

Consumer: Plan 20 Phase 4 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_query.go` (schema), new `analytics_entities.go` and focused serving tests, `packages/yakka/internal/store/{query.go,distribution.go,analytics.go}` and new focused session-entity store code/tests, `docs/design/03-remote-service.md`, `docs/plans/20-analytics-reset/CONTRACTS.md`, and this plan's report. Touch nothing else.
Commits: Commit the implementation and `docs/plans/20-analytics-reset/reports/4-01-capability-schema-and-session-grain.md` together in one plain-summary unit commit. The phase owner will record verification and close the phase separately.
Report: Before committing, write the report using the execution rubric at `packages/yakka/catalogue/checks/execution-report.json`.
Depends on: Plan 20 Phases 1–3, already closed on this branch.
Runs alongside: nothing.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md`, especially Phase 4 and the scope vocabulary.
2. `docs/plans/20-analytics-reset/CONTRACTS.md`, sections 7, 12 and 17.1–17.3.
3. `docs/design/03-remote-service.md` and the existing `/schema`, `/query`, `/conversations`, distribution and store implementations.
4. The fixture manifest and generator in `packages/yakka/internal/analyticsfixture/`.

## Goal

Implement the Phase 4 outcome at the HTTP and store boundary. The phase outcome is the fixed acceptance yardstick; the approach is open only for deriving session attributes within the published resource budgets.

## Contract and boundaries

Implement only capabilities owned by Phase 4: the capability schema, time and session entity modes, session provenance/measures, supported numeric predicates, deterministic scatter sampling and whole-population marginals, time-grain shared bucket grids and session aggregates, typed population/coverage and server-side exclusions. Preserve existing response fields and defaults. Additive metadata and the documented corrections are allowed.

Before settling the session-attribute implementation, compare bounded join/aggregation and rollup options against fixture size, existing storage paths and the Phase 3 deadline/memory contract. Record the chosen path and reason in the report. Do not add a stored rollup unless it is already in the signed contract; bounce any need for a new grain, join, route, dependency, gesture or contract change.

`/schema` must advertise only working Phase 1–4 capabilities, modes, measures, lenses, null/time semantics, budgets and typed coverage. Do not advertise artifact, content, plan, execution, activity, cohort, score-by-lens or other Phase 5/6 features. Do not invent Plan 21/22/23 data: capability discovery is via `/schema`, and those capabilities remain absent unless a complete server contract is already present on this branch.

Session attributes follow CONTRACTS.md: session repo is derived from artifact/commit facts and distinguishes single, `(multi)`, `(none)`; session model uses deduplicated calls and the published 80% rule with `(mixed)`, `(none)`, `unknown`; harness uses the published mode/tie behavior and exposes observed values. Provenance is lifetime-derived and stable across window changes; measures are in-window. Cost distinguishes no calls (zero), all-unpriced (null), and partial lower bound. Do not conflate session lenses with call-level `repo_id` or `model`.

Entity requests must be bounded by the published budgets, page and sort on every supported session measure, use deterministic identity tie-breaks, return typed populations, and validate names against schema. Scatter samples must be deterministic for the same query; marginals describe the whole eligible population. Time-grain fields share one resolved bucket grid and window. Exclusions are applied server-side. Existing `/query` and legacy counts retain their meaning and agree on matching eligibility, with lifetime-derived lens differences made explicit.

No Phase 5/6 route or join, no UI work, no modifications outside owned paths. Do not read production ledgers, credentials or secrets, contact a live system, deploy, push, or use `fly`/`wrangler`. Drizzle/DB migrations are local only. Keep resource use within an 8 GiB memory cap; use at most three Vitest workers if Vitest is needed. No animation/timing tests.

## Done evidence

Identify a failing or missing check before changes. The report must include candidate comparison, implementation summary, every departure/deferment, and exact verification commands/results.

- HTTP schema assertions prove the advertised Phase 4 feature set is complete and later-phase capabilities remain absent.
- Deterministic fixture HTTP/store checks prove stable session repo/model/harness provenance across windows; explicit unknown/mixed/multi and cost-null/lower-bound/no-call semantics; additive sums; paging and sorting for every supported measure; and legacy count reconciliation.
- Predicate, exclusion, scatter sample and whole-population marginal, time-grid and aggregate checks match fixture populations and remain deterministic.
- Existing response fields/defaults retain their semantics. Resource budget/cancellation behavior is consistent with Phase 3.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include candidate comparison, checks before/after, deviations/contradictions, and unresolved gates.
