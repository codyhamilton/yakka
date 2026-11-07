# Brief: 5-02 — Hash-weighted scores by lens

Consumer: Plan 20 Phase 5 server worker; the Phase 5 quality panels and artifact inspector consume these APIs.
Owned paths: packages/yakka/internal/serve/analytics.go (scores, score-series and distribution handlers), focused serving tests; packages/yakka/internal/store/reads.go, packages/yakka/internal/store/score_series.go, distribution store implementation and focused tests; packages/yakka/internal/serve/analytics_query.go only if the Phase 5 schema metadata needs completion; docs/design/03-remote-service.md; this plan's report. This unit follows 5-01 and owns all edits to these score/distribution surfaces; touch no UI or other plan.
Commits: Commit implementation and docs/plans/20-analytics-reset/reports/5-02-scores-by-lens.md together in one plain-summary unit commit.
Report: Use packages/yakka/catalogue/checks/execution-report.json; under 1,500 tokens.
Depends on: 5-01 and Phases 1–4. Runs alongside: nothing.

## Required reading

1. docs/plans/20-analytics-reset/DESIGN.md, Phase 5 and scope vocabulary.
2. docs/plans/20-analytics-reset/CONTRACTS.md, sections 7, 12 and 17.3.
3. 5-01 report and implementation, existing score/baseline/series/distribution handlers and store queries, fixture manifest/generator.

## Goal

Implement the signed hash-weighted score comparisons and scorer-aware content baseline, preserving legacy populations when new parameters are absent.

## Contract and boundaries

Implement exactly the /scores, /score-series, /baselines and /distribution extensions in CONTRACTS.md 17.3. Score observations remain distinct tenant-local content hashes per kind/check (per bucket for series), not artifact files. Select eligible artifact facts under the request's window and shared filters; canonicalize each hash by ts asc,row_hash asc,repo_id asc,path asc, then derive its lens. Apply derived lens filters after selecting that representative. Select latest score per hash/check before scorer filtering; do not revive historical scores. Every group and omitted-group count reconciles to the same unsplit filtered eligible hash population for that check/bucket. Page group lists; never silently top-N truncate. Series buckets can repeat a hash across buckets as specified. Content baseline mode uses latest score per hash/check partitioned by that row's scorer; omitted new parameters preserve existing latest-file-weighted baseline. Distribution lens additions retain their declared call/session grain and eligibility.

Do not change file-weighted artifact entity rows, legacy baseline defaults, score meanings, or introduce a new lens/join/route/dependency/gesture/contract. Do not implement phase 6 cohorts/plans/executions/activity or UI. Preserve deadline, cancellation, cell/memory budget and explicit unsupported-join semantics. If the signed representative rule cannot be implemented from stored facts within those limits, stop and name the exact gap.

## Done evidence

- Fixtures with identical hashes across paths/plans/repos prove the canonical observation is counted once and lens groups partition the same eligible hash population.
- Multiple scorers/rescores/checks prove latest-row selection, scorer filtering and scorer-specific baselines/bands; missing checks have null quartiles and zero/absent semantics exactly as contracted.
- Time series preserve sparse bucket and per-bucket population semantics; group paging and omitted coverage reconcile.
- Distribution lens additions match declared call/session populations and retain priced/unpriced coverage.
- Legacy baseline output is unchanged when new parameters are omitted; unsupported lens/filter combinations return named contract errors.
- Run bounded store/serve checks under the 8 GiB cap; Vitest, if used, max three workers. No animation/timing tests.

Identify one missing/failing check before edits. Report exact commands/results, behavior before/after, deviations and unresolved gates. No live ledger or external service.
