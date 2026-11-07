# Brief: 5-01 — Artifact identity, history and observations

Consumer: Plan 20 Phase 5 server worker; subsequent unit 5-02 consumes the canonical content-hash observation rules.
Owned paths: packages/yakka/internal/serve/analytics_entities.go and focused entity-serving tests; packages/yakka/internal/serve/serve.go only to register the already specified `/v1/analytics/entity` route; artifact-specific store reads in a new focused store file/tests (reuse existing read primitives as appropriate); packages/yakka/internal/serve/analytics_query.go only for Phase 5 schema metadata; docs/design/03-remote-service.md; docs/plans/20-analytics-reset/CONTRACTS.md only for an explicitly documented correction if evidence proves a contradiction; this plan's report. Touch no UI, other plan, or unrelated files.
Commits: Commit implementation and docs/plans/20-analytics-reset/reports/5-01-artifact-entities.md together in one plain-summary unit commit. Phase owner records integrated verification separately.
Report: Use packages/yakka/catalogue/checks/execution-report.json; under 1,500 tokens.
Depends on: Phases 1–4 closed. Runs alongside: nothing.

## Required reading

1. docs/plans/20-analytics-reset/DESIGN.md, Phase 5 and scope vocabulary.
2. docs/plans/20-analytics-reset/CONTRACTS.md, sections 7, 12 and 17.1–17.3.
3. Existing analytics_entities.go, artifact/read/store code, fixture manifest/generator and related tests.

## Goal

Implement Phase 5's artifact entity behavior over the existing ledger facts and scores. Keep the signed outcome fixed; refine the implementation within the declared budgets and identities.

## Contract and boundaries

Implement only artifact list/detail/history and artifact-grain aggregate/scatter/quality observation behavior assigned by CONTRACTS.md 17.3. Artifact identity is (repo_id,path); version identity is (repo_id,path,content_hash). Membership is by in-window artifact facts, latest version is lifetime-selected by received_at desc,rowid desc, and version history is paged by received_at desc,content_hash asc. Include the version's writing session using the earliest artifact fact for that version, ties by row_hash; label it as captured provenance, not proven authorship. Preserve later sessions as also_seen_sessions. Keep file-weighted artifact populations distinct from tenant-local distinct-hash content populations. Scores are latest per (hash,check), with scorer-specific metadata. Report nulls, missing scores, population and budget coverage as contracted.

The signed /entities?grain=artifact, /entity?grain=artifact, and artifact aggregate/scatter modes are already specified. Register/use only these existing routes and semantics. Honor shared filters/exclusions, paging, deterministic tie-breaks, schema validation, deadlines, cancellation and coverage. Do not add a route, grain, join, gesture, dependency, capture field, migration, or new contract. No plan/execution/cohort/activity implementation (Phase 6); no content byte-serving endpoint (5-03); no UI.

Read current Phase 4 implementation first. Do not advertise a capability before its handler and behavior are complete. Keep capability schema edits to artifact entity modes/fields and the Phase 5 feature flag; do not advertise later features. If an outcome requires changing the identity, join, or population contract, stop and report the gap rather than inventing semantics.

## Done evidence

- Fixture tests show artifact identity/membership and lifetime latest version with the exact ordering and cursor boundaries, including equal receive times.
- Identical bytes at distinct paths/repos remain distinct artifact rows and a shared content hash where the contract calls for it.
- Version detail exposes scores/scorers and the canonical writing session; a repeated save does not move that attribution.
- Artifact list paging/sorting, aggregate/scatter, predicates/exclusions and typed population metadata match fixture eligibility and published budgets.
- /schema advertises only implemented Phase 5 artifact capabilities; Phase 6 capabilities remain absent.
- Existing behavior and resource/cancellation bounds remain valid.

Identify a missing/failing check before edits. Record exact bounded verification commands/results in the report. Use the 8 GiB memory cap and, if Vitest is relevant, at most three workers; no animation/timing tests.

## Report back

Include implementation summary, fixture outcomes, verification commands/results, deviations and unresolved gates. If the contract cannot support the work without new scope, report the precise gap and bounce.

## Retry: uncovered existing section 17.3 requirements

Complete the existing contract surface left unfinished by the first implementation:

- Aggregate supports zero to two supported artifact dimensions and deterministic groups, with whole-population group coverage under the published cell budget.
- Every supported numeric artifact measure accepts `where`; Boolean predicates and exclusions use the existing bounded grammar and shared filter semantics. Unsupported lenses/measures remain explicit errors. Score baseline/band and writing-session lens extensions stay with 5-02.
- List, aggregate and scatter report typed whole-population eligibility and missing-score/content reasons per requested measure, independent of paging or sampling.
- Remove the unpublished 20,000-file content-size scan ceiling; enforce the existing published request deadline and output cell budget instead of an invented population cap.

Identify focused failing fixtures for these requirements before code edits. Keep the result unfinished if any assigned behavior is unresolved. No contract change is authorized.
