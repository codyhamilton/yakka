# An exploratory analytics workspace for Yakka

Plan 20 replaced the analytics interface with a static, no-build workspace and extended the analytics service to support bounded, honest cross-lens analysis. The 13 phases delivered the server contracts, identity flows, chart kit, linked dashboards and entity explorers. The terminal review blockers were fixed and independently re-reviewed; remaining tracked issues and external evidence gates are listed below.

## Intent
User request, verbatim:

> Work only in ~/workspace/yakka-wt/analytics-reset (branch analytics-reset). Don't touch any other checkout or worktree. Don't push, open a PR, merge, or touch master. Commit on the branch when done.
>
> Follow the Yakka design skill (plugins/yakka/skills/design/SKILL.md in this worktree), headless: no human sign-off step; record every judgement call in an assumption ledger with open questions for Cody. Write the design into docs/plans/20-analytics-reset/ (DESIGN.md alongside the existing CONTRACTS.md and charting-research.md).
>
> Task: design a brand-new analytics web UI for Yakka from scratch. The old UX was judged unusable and has been deleted. Do NOT read or build on docs/plans/10, 12, 14 or 17, the deleted package, its git history, or the old copy of docs/design/07. The only inputs: docs/plans/20-analytics-reset/CONTRACTS.md, packages/yakka-analytics/contract/*.js, docs/plans/20-analytics-reset/charting-research.md, and the Go API in packages/yakka (plus the general docs OVERVIEW/ARCHITECTURE for what Yakka is).
>
> Hard technical line: pure HTML/CSS/JS, web components, native ES import, no build system, no bundler. Minimal runtime deps, no deep transitive graphs; every dependency vendored as a single file and justified (name, version, size min+gzip, licence, why). Research pick is uPlot (0 deps, ~23 KB gzip); interaction is built on top of it.
>
> Hard UX requirement: charts are genuinely interactive: hover tooltips, zoom/pan, brushing/range selection that drives other views, legend toggles, click-through to the underlying runs/events. Verified by real browser interaction tests (not tables standing in for charts, no animation-timing tests; settled end-state checks). Start from what a Yakka user needs to find out (list those questions), and derive the pages from them, not from any old page set. For each page, state the questions it answers, its charts, and exactly how each chart interacts and what it drives.
>
> Do first: fix two conflicts in CONTRACTS.md. (1) Section 10.1's SvelteKit _app/immutable/ cache prefix: make cache rules generic for the new static layout, and note that site.go/site_test.go need a matching change (a build phase item). (2) Section 12's pinned Overview/Usage request sets: reframe as available endpoints, not a required page shape.
>
> Also required: the new UI must serve /oauth/callback and /device so the login flows keep working before the Pages deployment is replaced.
>
> Stale guidance: docs/design/07 pointer is fine as is; fix "static Svelte site" in docs/design/system-architecture.md. Do not edit plugin skills; instead add notes in the design about the design skill reading docs/design first and the execute/refine "do not invent scope" wording.
>
> Phases must each close with a provable outcome. Finish with a short summary: commit hash, page set with chart interactions, dependency list with sizes, phases, and the ledger's open questions.

Clarified direction, verbatim (appended; the original request above stands):

> we should be able to slice and visualise data in multiple ways. E.g. quality by harness, by model, by repo, drilling down into plans and what they contained. for the dashboard give a range of things - what is recent, what are trends sliced over the various lenses - harnesses, models, repos, quality outcomes etc etc. Go more and genuinely different and we'll prune after.
>
> I'd like to see visualisations, and particularly as mentioned be able to trend, scatter, slice across all the lenses we have
>
> uplot as published is fine
>
> pages deploys automatically when the pr is merged to master by the automation job
>
> why have arbitrary max reporting window?

## Why This Existed
The previous analytics interface did not support the requested cross-lens questions, entity-level drill-down, or useful all-history analysis. The API lacked bounded range handling, a capability inventory, entity populations and artifact content needed to make those views truthful.

## What Was Built
**Changed:** a framework-free analytics workspace in `packages/yakka-analytics/web/`; bounded analytics range, entity, cohort, population, capability and content APIs in `packages/yakka`; release and hosting documentation; browser acceptance and deterministic fixture coverage. The durable API and release contract is in [Analytics workspace contracts](../design/09-analytics-workspace-contracts.md).

### Phase 1 — Reset and shell
Replaced the prior site with a static HTML/CSS/ES module shell, preserved the identity routes, and established the Pages and embedded serving layout.

### Phase 2 — Identity flows
Implemented and browser-proved GitHub callback, device approval, session gating, profile, settings and tenant recovery flows.

### Phase 3 — Bounded range reads
Removed the arbitrary reporting-window cap; added automatic time resolution, bounded aggregation and paging, deadlines, cancellation, coverage reporting and fixture-backed performance evidence.

### Phase 4 — Capability schema and session grain
Published server capabilities and coverage, added session-grain measures and derived session repo/model/harness associations, and made unsupported combinations explicit.

### Phase 5 — Artifact entities, scores and content
Added artifact and scored-content populations, scorer-specific score metadata, version history and tenant-scoped complete content reads with integrity and refusal states.

### Phase 6 — Plan and execution entities and cohort predicate
Delivered plan/execution entities and the complete published cohort resolver matrix, frozen source scopes, typed population relations and rejection associations. The earlier scope, association and matrix gates were settled by design amendment PR #249.

### Phase 7 — Time-series chart kit
Delivered interactive time-series, scatter and shared selection gestures, with accessible tables and settled-state browser checks.

### Phase 8 — Distribution and categorical chart kit
Delivered bars, ranges, matrix, lanes and treemap elements with stable styles, accessible tables and real browser interaction coverage.

### Phase 9 — Workspace engine, Start and Pulse
Connected URL-backed scope, request scheduling, capability detection, saved boards and linked Start/Pulse views to the server contract.

### Phase 10 — Trends, Compare, Quality, Cost and Tools
Delivered linked analytics boards with trend and period comparison, cohort comparison, quality baselines, cost coverage and tool activity views.

### Phase 11 — Scatter lab and Sessions
Delivered server-backed scatter populations, selection-to-cohort flow, session lists and session detail with ledger and entity links.

### Phase 12 — Workflow, Plans and artifact reader
Delivered the workflow board, plans list and detail, execution/process shape views, artifact reader and bounded version diff.

### Phase 13 — Release readiness
Recorded Pages-style and embedded acceptance, request shapes, p95 smoke evidence, identity routes and release documentation. The external Pages automation job remains unverified.

## Deviations
The design's unresolved artifact file-to-time-bucket assignment stayed unsupported because no assignment rule was established. Plan-level associated cost remains explicitly overlapping where sessions touch multiple plans. Plan outcome and review data are not ingested, and absent Plan 21/22/23 capabilities are not fabricated. External Pages automation behavior and owner-data real-ledger benchmark evidence remain open.

## Review
Terminal review at `8e674d1` was blocking on HIGH #252 and #257. Both were fixed in `dab457ba77d852e7d8d27e4f7c57aa15e3ac1a7d` and independently re-reviewed as resolved in `/home/codyh/workspace/.briefs/yakka/20-rv-fix-term.md`.

**Automation review (reviewed head `5edd54e4`, 2026-11-19):** Verdict `PASS_WITH_FOLLOWUPS`. Resolved in review: OAuth return-path open redirect (`f0aa8123`); stale route render #262 (`84e70740`); time-scatter aggregate request shape (`7f1bdcd9`); truncated plan list labelling (`5edd54e4`). Blockers #252/#257 remain verified. Open follow-ups: #263 session tool lanes; #275 plan lens filters / scatter sampling semantics; canvas-scatter hit-test padding offset (tests align with current behaviour); plan `mode=scatter` list-page semantics vs full marginal sample.

## QA
The 13 phase records include Go store/serve and fixture suites, browser acceptance in Chromium, release/layout/static checks, request-shape replay and a fixture pageset benchmark. The recorded matrix covered both Pages-style and embedded serving with 40 acceptance checks and zero skips. Identity acceptance covered 8 browser flows and 7 contract tests; the Phase 12 suite passed 64 checks. The Phase 13 pageset served 61 of 75 requests and returned 14 documented capability refusals; maximum recorded p95 was 282.5 ms against the 500 ms bound. One full-suite run had an environment-only `internal/keys` temp-path failure; that focused test passed when its temp directory was outside the checkout. No animation or timing assertions were used.

## Residual Risks
The Pages automation job's handling of `./web` has not been observed. Real-ledger p95 evidence still needs owner-provided `YAKKA_BENCH_DIR`; the fixture benchmark is the available gate. Hook facts still lack direct `repo_id` capture, so repo attribution remains derived from artifact and commit facts. Plan/phase outcome capture remains outside this design.

## Follow-ups
- #252 and #257 are fixed in `dab457ba77d852e7d8d27e4f7c57aa15e3ac1a7d`.
- #262 tracks a stale route render overwriting the current destination.
- #263 tracks session detail collapsing tool lanes when `/conversation` omits `tool_kind`.
- #275 tracks Plans scatter dropping `session_model` while the table applies it.
- Verify that the external Pages automation accepts `./web` as its output directory.
- Add real-ledger p95 evidence when the owner supplies `YAKKA_BENCH_DIR`.
- Decide whether hook events should carry `repo_id`; define an outcome-data capture design if phase and review outcomes are needed.
