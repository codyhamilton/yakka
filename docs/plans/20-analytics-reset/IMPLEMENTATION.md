# Plan 20 implementation

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 3 execution
Start time: 2026-11-08 09:10 Australia/Brisbane (2026-11-07 23:10 UTC)

Previous run: feat/20-analytics-reset phase 1 execution, started 2026-11-08 04:48 Australia/Brisbane (2026-11-07 18:48 UTC).

## Phase 1 — Reset and shell

Refinement commit: `d570de6` (`docs: refine Plan 20 Phase 1 briefs`). It records three units and their dependencies in `DESIGN.md` and adds the three dispatchable briefs. The fixture and shell units are independent; release/serving depends on both. The first-design coarse check found the phase surfaces, contracts, observable outcomes and dependency order in place. `artifact_feedback` on each brief returned `delivered` / awaiting screen, with no rejection. No product work has landed yet.

### `1-02-framework-free-shell.md`

- Outcome: committed as `505360a`; replaced SvelteKit with the static shell, URL codec, schema-driven transport, scheduler, theme bootstrap and vendored uPlot; added the test-only harness and package README.
- Surfaces: `packages/yakka-analytics/`.
- Verification: Node suite 13/13; `python3 tools/release/test_layout.py` 7/7; system Chrome confirmed deep-route shell rendering, fixture-summary probe, unknown-route fallback and verbatim legacy `range too wide` without retry. No animation/timing assertions.
- Deviations and carried items: Playwright-core is unavailable, so its Chromium acceptance remains outstanding. The worker left `wrangler.toml` unchanged per the brief although DESIGN/CONTRACTS specify `./web`; the release/serving unit must resolve this. Release embedding and headers remain unverified.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: provide Playwright-core in the phase test environment and run the Chromium shell harness.

### `1-01-fixture-ledger.md`

- Outcome: committed as `2b4d2c3a7a0c3690982e7131d9fae7fbe2744ee2`; added the non-shipping deterministic ledger generator and manifest covering the populations, relations, chronology and resource boundaries in the brief.
- Surfaces: `packages/yakka/internal/analyticsfixture/`.
- Verification: `GOMEMLIMIT=8GiB go test ./internal/analyticsfixture -count=1 -v` passed; generated-ledger assertions cover exact manifest counts, timestamp bounds, shared bodies, scorer-specific scores, session repo cardinalities, three execution shapes, rejection stages and the unpriced tail. Candidate comparison selected batch append: same 5,015-event oracle, 196 ms versus 11.855 s for single-row append.
- Deviations and carried items: none. The 32,767-hash fixture takes about 187 seconds to generate and verify; later tests should construct it once per setup and reuse it.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).

### `1-03-release-and-serving.md`

- Outcome: committed as `aacab5eb85827459043a7a2a13f92837fbec251e`; release embeds the framework-free `web/` tree without Node/npm, restores the placeholder on success/failure, and serves generic cache/security policy with ETag revalidation. Pages output is `./web`.
- Surfaces: `tools/release/`, `packages/yakka/internal/serve/site.go`, `packages/yakka/internal/serve/site_test.go`, `packages/yakka-analytics/wrangler.toml`, `.dockerignore`, `docs/design/07-analytics-site.md`, `docs/design/system-architecture.md`, and `docs/plans/20-analytics-reset/CONTRACTS.md`.
- Verification: release suite 11/11 with an isolated PATH lacking Node/npm; `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSite' -count=1` passed; Node shell suite 13/13; layout checks 7/7; `git diff --check` passed. Builds embed the app/uPlot but exclude `_headers`; placeholder restoration is checked for success and failure.
- Deviations and carried items: the brief's `./build` instruction conflicted with the signed design/contract; `./web` was applied. `GOTOOLCHAIN=auto` is needed for the release build because the installed local Go version is older than the module's declared version. The full-server OAuth API handler shadows the UI callback path in local mode; route integration remains for Phase 2, as stated in the updated contract.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: verify the external Pages automation accepts `./web` as its output directory.

### Phase 1 verification and closure

- Entry point → action → result: the committed test harness serves `/__test/fixture-summary-probe` from the embedded manifest; shell tests observe the summary, uncapped URL round-trip, legacy limit message without automatic retry, request deduplication/abort/four-request cap, and unknown-route fallback. The built Go site serves direct client routes with the committed app, generic cache/security headers and correct ETags; the release harness confirms no-Node embedding and placeholder restoration.
- Final checks on the integrated branch: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/analyticsfixture -count=1` passed (306.215 s); `GOMAXPROCS=3 python3 -m unittest tools.release.test_release` passed (11); `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs` passed (13); `python3 tools/release/test_layout.py` passed (7); `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSite' -count=1` passed. No animation or timing tests were used.
- Playwright-core is unavailable in this worktree, so the Playwright Chromium harness was not run; system Chrome smoke evidence is recorded in the shell report.

Carried

- Playwright-core browser harness run when available.
- Verify the external Pages automation accepts `./web` as its output directory.
- Phase 2 reconcile the local full-server `/oauth/callback` route collision while preserving the remote API callback.
- Reuse the 32,767-hash fixture once per test setup; its generation and verification take about 187 seconds.

## Phase 2 — Identity flows

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 2 execution
Start time: 2026-11-08 05:42 Australia/Brisbane (2026-11-07 19:42 UTC)

Inline refinement: Phase 2 is one unit. The brief `2-01-identity-flows.md` is committed before implementation and covers the session gate, account routes, device login, credential handling and local/remote OAuth callback routing under CONTRACTS.md. The Phase 1 carried callback collision is included in the route seam. `artifact_feedback` pending for the brief.
`artifact_feedback` on the inline brief returned `not delivered`: the service has no version and nothing is queued, even after retrying with an absolute path. Recorded; proceed with local contract verification.

### `2-01-identity-flows.md`

- Outcome: committed in the phase-closing commit; added safe return-path and session-gate contracts, credential-aware account requests, and Login, OAuth callback, Device, Profile and Settings UI flows. Local `/oauth/callback` serves the shell; remote collector mode retains the JSON callback API.
- Surfaces: `packages/yakka-analytics/web/contract/`, `web/js/identity/`, `web/js/app.js`, `packages/yakka/internal/serve/serve.go`, focused tests.
- Deviations: none identified against the brief or CONTRACTS.md. No Plan 21/22/23 capability was invented.
- Unit evidence: report `reports/2-01-identity-flows.md`; `artifact_feedback` on the report and brief both returned delivered / screen pass (`jev-1.13.0`). Worker-reported checks: Node identity/static-shell/scheduler 12 passed; focused Go callback routing passed; syntax checks passed.

### Phase 2 verification and closure

- Entry point → action → result: `GET /oauth/callback?code=x&state=y` through `Server.Handler()` returns the embedded static shell in local mode and the JSON callback handler's unauthorized response in remote mode. Focused browser-contract tests cover safe callback targets, sign-in returns, the session gate, tenant recovery, auth headers and normalized device approval fields. The Chromium UI smoke could not run because `playwright`, `@playwright/test`, `playwright-core` and Vitest are absent, and the installed Chromium Snap wrapper fails to start (`snap-confine` missing `cap_dac_override`).
- Independent checks: `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/identity/contracts.test.mjs packages/yakka-analytics/tests/static-shell.test.mjs packages/yakka-analytics/tests/request-scheduler.test.mjs` passed 12/12; `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely|TestSiteHandlerDirectCallbackFallback' -count=1` passed. No animation/timing tests or live systems were used.
- `artifact_feedback`: report and brief delivered / screen pass (`jev-1.13.0`).
- gate: provide a working Playwright/Chromium harness and verify the Pages-faithful callback, device approval, profile/token and Settings flows end to end.

Carried

- Playwright browser acceptance for the complete identity flow; runner/browser unavailable in this worktree.
- Verify that external Pages automation accepts `./web` as its output directory (Phase 13).
- Reuse the 32,767-hash fixture once per test setup; its generation and verification take about 187 seconds (Phase 3).

## Phase 3 — Bounded range reads

Refinement commit: `d46453e883a962681e5349286c4d96c3b689b651`; four sequential units. The 32,767-hash fixture reuse was assigned to 3-02. Identity browser acceptance and the external Pages output check were bounced as unrelated to Phase 3. Before closing, runner `artifact_feedback` on all four briefs and reports returned delivered / screen pass (`jev-1.13.0`), with no flagged checks.

### `3-01-range-resolution.md`

- Outcome: committed as `95e8c13`; removed shared width rejection, accepted `all=1` from the signed nanosecond minimum, added explicit time-bound errors, and added `/query` auto-range metadata and cell/series budget errors.
- Surfaces: `packages/yakka/internal/serve/analytics.go`, `analytics_query.go`, their focused tests, `CONTRACTS.md`, and `docs/design/03-remote-service.md`.
- Deviations and carried work: route-side only; year and multi-year grouping/auto retry and pre-slice cell planning remain for 3-02. Full serve tests identify two stale expectations outside this unit's ownership: `TestDistributionRangeTooWide` and `TestScoreSeriesRangeTooWide` still require legacy 400s.
- Verification: focused `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestAnalytics(Query|Schema|Outcome)' -count=1` passed; full serve suite failed only those two stale expectations. `git diff --check` passed. Before/after regression evidence and the candidate comparison are in `reports/3-01-range-resolution.md`.

### `3-02-bounded-aggregation.md`

- Outcome: committed as `f415d72`; usage, distribution and score-series scanned-row aggregation now runs in SQLite, including exact percentile/rank logic and a 32,767-hash score-series join. Internal year and multi-year bucket expressions were added without changing the legacy public bucket list.
- Surfaces: owned aggregate store paths (`usage.go`, `query.go`, `distribution.go`, `score_series.go`, and rollup files/tests).
- Deviations and carried work: no heap-growth measurement was recorded; the SQL shape removes input-row collections but allocation independence still needs direct evidence. Serve integration must connect auto retry to internal year buckets and executable suggestions. The two stale serve assertions remain to update in the serving unit. The 14-turn budget was exceeded.
- Verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store -count=1` passed, including 32,767 distinct scored hashes; focused store checks and `git diff --check` passed. Full report and candidate comparison: `reports/3-02-bounded-aggregation.md`.

### `3-03-paged-reads-and-coverage.md`

- Outcome: committed as `b49316f`; `/series` uses the requested IANA timezone for daily and Monday-start weekly buckets, conversation usage events expose pricing, and conversation/distribution/score-series report compaction coverage. The two stale wide-window expectations now accept successful responses.
- Surfaces: owned conversation/distribution/score-series handlers, store conversation/analytics paths and corresponding tests.
- Deviations and carried work at unit landing: `/explore` keyset traversal with receive watermark, explore-event `priced`, and route-wide partial metadata were left for 3-04 because the shared handler was outside this brief's owned paths. Unit 3-04 completed those items; the final 20,005-row traversal proof is recorded in `reports/3-04-runner-note.md`.
- Verification: before, the two stale wide-window tests failed with 400-vs-200. After, `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed; `git diff --check` passed.

### `3-04-runtime-bounds-and-benchmark.md`

- Outcome: committed as `492fc80`; added a one-second measured query deadline, driver cancellation and reader-release behavior, a four-request tenant heavy-read bound, `/explore` keyset traversal with first-page watermarks and `priced`, auto year-step retries, executable overflow suggestions, and route-wide partial reasons. The fixture benchmark now covers all-time and auto.
- Surfaces: `serve/{analytics.go,analytics_query.go,analytics_score_series.go,serve.go}` and focused analytics tests/benchmark; `store/{analytics.go,analytics_test.go}` for keyset page/watermark queries.
- Deviations and carried work: the brief's original path list omitted handler and store paths needed by its fixed outcome; it has been amended to record the clarified implementation ownership. Usage/distribution allocation comparisons were added in the runner follow-up; ScoreSeries has no cross-size allocation comparison. The optional real-corpus benchmark needs owner-provided data.
- Verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed; cancellation/deadline and heavy-read concurrency tests passed; fixture benchmark completed 2,647 cases (max observed p95 4.4 ms, all-time/auto max p95 4.1 ms) against the 500 ms target; `git diff --check` passed. Full evidence/candidate comparison is in `reports/3-04-runtime-bounds-and-benchmark.md`.

### Phase 3 verification and closure

- Entry point → action → result: `/v1/analytics/query` accepts all-history and ten-year ranges without changing requested bounds, coarsens the calendar resolution under cell pressure, and returns a documented budget error rather than clipped rows. `/v1/analytics/explore` pages a 20,005-row equal-time fixture in 20,000 + 5 rows with distinct keys and no omissions; route-level tests confirm cursor round-trips. Timezone, pricing and partial-coverage fields match fixtures. Runtime tests observe query deadline interruption, reader reuse, no partial response and tenant concurrency rejection.
- Independent integrated verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed after the histogram and 20,005-row cursor follow-ups (store 7.349s; serve 24.905s). Allocation-growth tests passed for usage and distribution at 16× input rows. `git diff --check` passed.

Runner note: the first allocation-growth check found distribution histogram binning scanned every SQLite sample into Go. A follow-up change moved bin counts into SQL and added 16x input-size allocation comparisons for usage and distribution (128 vs. 2,048 rows); both passed. ScoreSeries retains only result buckets and its 32,767-hash regression passes, but a cross-size Go allocation comparison is not recorded. See `reports/3-04-runner-note.md`.

Carried

- Usage and distribution allocation comparisons passed at a 16× scanned-row increase (usage 3,288 → 3,288 bytes; distribution 21,360 → 21,856 bytes). ScoreSeries succeeds with 32,767 distinct hashes and retains only bounded result buckets, but no cross-size allocation comparison was recorded; the peak-retention claim for that path remains based on its streaming SQL-temp-table implementation shape.
- Run the analytics benchmark against an owner-provided real ledger via `YAKKA_BENCH_DIR` for additional corpus evidence.
- Playwright browser acceptance for Phase 2 identity flows remains outstanding (carried from Phase 2; not a Phase 3 blocker).
- Verify the external Pages automation accepts `./web` as its output directory (release readiness).

## Phase 4 — Capability schema and session grain

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 4 execution
Start time: 2026-11-08 06:56 Australia/Brisbane (2026-11-07 20:56 UTC)

Inline refinement: Phase 4 is one server unit. Brief `4-01-capability-schema-and-session-grain.md` fixes the signed outcome, bounds the open implementation choice to session attribute derivation under the Phase 3 budgets, and explicitly excludes later-phase capabilities and any new grain/join/route/dependency/contract. Committed before dispatch as `bc74c12`. Runner `artifact_feedback` returned delivered / screen pass (`jev-1.13.0`); the initial relative-path call resolved against the plugin cache, so the absolute worktree path was used.

The worker identified two omitted integration seams in the first brief: route registration for the signed `/analytics/entities` route and parsing/application of the signed shared `exclude` filter. Brief amendment `ad42d3b` adds `serve.go` and `analytics.go` for those existing semantics only; it adds no route/filter behavior.

### `4-01-capability-schema-and-session-grain.md`

- Outcome: committed as `b9c9ca0`; added `/schema` Phase 4 metadata, session/time entity handlers and store reads, lifetime-derived session provenance, deterministic scatter/marginals, time aggregation, typed population metadata and shared exclusions.
- Surfaces: `serve/{analytics.go,analytics_entities.go,analytics_query.go,serve.go}`, `store/{analytics.go,query.go,session_entities.go,usage.go}`, focused tests and `docs/design/03-remote-service.md`.
- Deviations / unfinished: report `reports/4-01-capability-schema-and-session-grain.md` marks done with concerns. Session numeric filtering, session aggregate mode, and pending/scored-total/revision coverage are missing. The report's commit placeholder is malformed; runner records the actual commit here (`b9c9ca0`). Unit test command passed: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` (store 6.7s, serve 23.9s); `git diff --check` passed. Report `artifact_feedback`: delivered / screen pass (`jev-1.13.0`).

The fixed Phase 4 outcome is not yet verified or closed. Follow-up brief `4-02-session-outcome-remediation.md` covers only the three reported omissions, without changing the contract; it is committed before dispatch.

### Independent Phase 4 verification finding

Runner added `TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals` for a 5,005-session fixture. The baseline failed: deterministic sample metadata was correct, but both token marginals summed to 0 rather than the whole 5,005-session population because no-call sessions had no histogram bins. This is a Phase 4 outcome defect, not a contract change. Brief `4-03-zero-call-scatter-marginals.md` scopes the fix and regression assertion; Phase 4 remains open.

### `4-02-session-outcome-remediation.md`

- Outcome: committed as `dd66a06`; implemented numeric session `where` filtering, SQL-backed count/sum/percentiles/histogram aggregate modes, typed missing population for unpriced cost, pending and per-kind scored/total coverage, and explicit unavailable revision metadata.
- Deviations / carried: session aggregate dimensions are not supported and are advertised as an empty set; pricing/catalogue/tool-kind revision identifiers have no stable local sources and are null with reasons. `reports/4-02-session-outcome-remediation.md` records both. Verification command passed in the report. Report `artifact_feedback`: delivered / screen pass (`jev-1.13.0`).

### `4-03-zero-call-scatter-marginals.md`

- Outcome: committed as `839d1de`; included the runner's 5,005-session regression and adds no-call sessions to zero-value token/cost marginal bins while retaining all-unpriced cost exclusion. Focused and full bounded store/serve tests passed as recorded in `reports/4-03-zero-call-scatter-marginals.md`. Report `artifact_feedback`: delivered / screen pass (`jev-1.13.0`).

### Phase 4 verification and closure

- Entry point → action → result: `GET /v1/analytics/schema` returns the published session/time grains, modes, measures, budgets, null/time rules, typed coverage and only Phase 1–4 feature flags; HTTP assertions prove artifact/content/plan/execution/activity/cohort/action/review flags are absent. `GET /v1/analytics/entities` against fixtures lists and sorts sessions, returns lifetime-stable repo/model/harness provenance, applies numeric `where` and shared exclusions, serves session count/sum/percentile/histogram aggregates, and returns time measures on one shared day grid. HTTP checks prove no-call zero cost, all-unpriced null cost, partial lower-bound marking, single/multi/none repo groups, unknown/mixed model groups, filtered population counts and matching legacy count totals. A 5,005-session request returns the same deterministic 5,000-point sample twice and token/cost marginal counts over all 5,005 sessions.
- Independent integrated verification on this closing tree: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 8.026s; serve 27.913s); `git diff --check` passed. The separate zero-call scatter assertion first failed (empty marginal totals), then passed after `839d1de`. No animation/timing tests, live systems, production data or secrets were used.
- Before closure, `artifact_feedback` on `4-01`, `4-02`, and `4-03` briefs and reports all returned delivered / screen pass (`jev-1.13.0`); no checks were flagged.
- Runner note: `reports/4-runner-note.md` records the first report's commit placeholder, remediation history, initial scatter failure, independent assertions and artifact feedback.

Carried

- `/schema` reports null pricing, catalogue, and tool-kind revision identifiers with reasons because stable local IDs do not exist; populate them only when a source is added to the existing contract. gate: provide stable local revision identifiers for pricing, catalogue, and tool-kind if non-null revision values are required.
- Session aggregate dimensions remain unsupported; `/schema` explicitly advertises none, and requests for `dim` return a named error. The signed Phase 4 outcome is satisfied by the implemented scalar aggregate modes; any future grouped session aggregate capability must be reconciled against the existing schema contract before being offered.

## Phase 5 — Artifact entities, scores by lens, content

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 5 execution
Start time: 2026-11-08T07:51+10:00

Refinement commit: `d23bf4693bab93a79e32096cb830fbd301037341`; three sequential units. `artifact_feedback` on the briefs returned `not delivered` because the service had no version and nothing queued. Proceed verdict; no contract gaps identified.

### `5-01-artifact-entities.md`

- Outcome: closed after retry. `e3b48c8` added artifact identity/history and writing-session attribution; `f2a497d` amended the brief with uncovered signed requirements; `108d37e` added aggregate dimensions, bounded Boolean predicates, score/content numeric filters, nullable cursor paging, typed whole-population coverage and cell budget enforcement. `/entity` registration uses the already specified Phase 5 route. `/schema` capability remains unpublished until score/content integration is complete.
- Surfaces: `packages/yakka/internal/{serve,store}/` artifact entity paths and tests; Phase 5 brief and report.
- Deviations and carried: `bucket` on artifact aggregate is rejected and unadvertised because the design does not assign a version timestamp to a file spanning buckets; cohorts remain Phase 6. Aggregate exact sorting/statistics materializes enriched rows under the existing deadline, with no invented population truncation. 5-02 owns score-name catalogue validation, scorer/band lenses, baseline semantics, writing-session measures, and derived harness/model filters.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.470s; serve 25.989s); `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run TestArtifact -count=1` passed. `artifact_feedback` on the amended brief and report returned delivered / screen pass (`jev-1.13.0`).

### `5-02-scores-by-lens.md`

- Outcome: committed as `97ef99e`; added canonical hash observation and scorer-aware score and score-series lenses, content-hash baselines, and the declared distribution harness/session-model/session-repo lenses while preserving legacy defaults. `/schema.features.scores_by_lens` reflects the implementation.
- Surfaces: score/baseline/distribution handlers and store reads under `packages/yakka/internal/{serve,store}/`, focused tests and the report.
- Deviations and carried: exact score aggregation retains observations in memory as the legacy path does, under request context; group pages are bounded and no data is silently truncated. The artifact aggregate bucket ambiguity remains from 5-01.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 8.128s; serve 27.535s); `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`).

### Runner verification finding after `5-03-artifact-content.md`

The integrated store/serve tests passed, but `TestAnalyticsSchema` confirmed `entities_artifact` remains absent and the artifact row path does not return `band:<check>` or the contract's writing-session measures. Those are explicit Phase 5 §17.2/17.3 requirements. Added a focused integration unit 5-04 before closure; its brief is `briefs/5-04-artifact-schema-and-bands.md`.

### `5-03-artifact-content.md`

- Outcome: committed as `e5fcb50`; added the tenant-bound exact-version content route with complete-byte hash verification, read-scope/session authorization, size refusal, no-partial reads and explicit screening/missing states. `/schema` advertises `artifact_content` with its limit only alongside the route.
- Surfaces: `packages/yakka/internal/{serve,store}/` content path, auth/route registration, focused tests and remote-service documentation.
- Deviations and carried: none for the unit. The artifact time-bucket question remains separate and does not affect exact-version content.
- Verification: bounded store/serve tests passed (store 7.025s; serve 25.068s); focused content tests passed after the final refinement. `artifact_feedback` on the report and brief returned delivered / screen pass (`jev-1.13.0`).

### `5-04-artifact-schema-and-bands.md`

- Outcome: committed as `13a3a7e`; `/schema` now advertises the implemented artifact grain and `entities_artifact`; artifact rows expose scorer-specific bands and selected writer cost/call/token/hook measures; derived harness/model filtering follows lifetime writer selection. Design-only Phase 6 flags remain absent.
- Surfaces: schema and artifact population serving under `packages/yakka/internal/serve/`, bounded session aggregation, focused fixture tests and remote-service documentation.
- Deviations and carried: no contract changes. Artifact bucket grouping remains rejected and absent from advertised modes because no file-to-time-bucket timestamp rule exists. Score lens aggregation retains observations in memory under the request deadline; a cross-size memory-growth proof is not recorded.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.299s; serve 26.032s); focused artifact/schema tests and `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`).

### Phase 5 verification and closure

- Entry point → action → result: fixture-backed HTTP tests exercise `/v1/analytics/schema`, artifact `/entities` and `/entity`, score and score-series lenses, content baselines, distribution lenses, and `/content`. The schema now reports artifact entities, scorer lenses and content with budgets, while plan/execution/cohort/activity/actions/reviews stay absent. Artifact fixtures prove file identity versus shared hash identity, lifetime selected-version and writer attribution, version paging, score/scorer/band behavior, grouped populations and missing coverage, windowed writer measures, and exact content authorization/integrity/refusal states.
- Integrated verification on the closing tree: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.495s; serve 26.640s); `git diff --check` passed. No animation/timing tests, live service, production data, credentials, deployment or migrations were used.
- Runner `artifact_feedback` on every Phase 5 brief and report returned delivered / screen pass (`jev-1.13.0`); no checks were flagged.

Carried

- `gate: Cody define the artifact file-to-time-bucket assignment in the design before artifact bucket grouping can be implemented or advertised.`
- Score lens exact aggregation retains observations in memory under request deadlines; no cross-size memory-growth proof is recorded. A later bounded-query review should measure or replace that retention without changing the signed population semantics.
