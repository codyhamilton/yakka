# Analytics UI rework — dense full-width console and evidence-led data repairs

Plan 29 replaced the Plan 20 analytics workspace's centred, wrapper-heavy console with an edge-to-edge operational layout, gave the document, chart hosts and shadow roots one active-theme token family, and repaired the read, capability and query paths behind the blank or misleading data outputs D01–D18. It did what it set out to do locally: all three phase outcomes were verified against a real Go server and real Chromium, and retained-scale query latency stayed inside the existing one-second deadline and 500 ms p95 budget. Deployed parity remains unproven because the remote refused the trial credential and the deployed UI needs an interactive browser session.

## Intent

User request, verbatim:

> Work only in worktree /home/codyh/workspace/yakka-wt/29-analytics-ui-rework (branch docs/29-analytics-ui-rework, off origin/master). Don't edit other worktrees or checkouts. You may read them.
>
> Task: design a rework of the Yakka UI. Cody (20 Nov 2026, 11:33 PM AEST): "Yakka UI needs reworking - firstly, redesign for high information density, think old school. Drop the centre alignment, use the full width. The graphs are in white background, and basically none of the data outputs anywhere are working."
>
> The design must cover:
> (1) A layout redesign: dense, old-school, full-width, no centred max-width container, using compact tables and panels.
> (2) Graph theming: charts must follow the app's dark or active theme, with no white chart backgrounds.
> (3) A diagnosis of why the data outputs show nothing. Use real evidence: run the UI and API locally, find which endpoints or queries return empty or error, and check whether the cause is the data source, the wiring, the env or the queries. List every broken output with its root cause and fix.
>
> This is Plan 29, docs/plans/29-analytics-ui-rework (better slug if the skill prefers). The current UI is packages/yakka-analytics (Plan 20). Don't build anything beyond what the evidence needs, and don't merge.
>
> Follow the Yakka design skill. You are headless and no one will answer: keep an assumption ledger. If a question truly blocks the work and only Cody can answer it, stop and report it rather than assuming. Land the design as its own ready PR into master, not draft. Write /home/codyh/workspace/yakka-design-logs/29-analytics-ui-rework/done.md with the PR URL, each broken data output and its root cause, the key layout decisions, and any blocker.

## Why This Existed

The Plan 20 workspace integrated real APIs but failed in practice. At 1920 px its main column was 1120 px, with nested padded cards, large controls and repeated explanations spending space before any observation. The blank data outputs had independent causes: schema-shape mismatches, omitted tenant parameters on follow-on requests, incorrectly encoded time windows, invalid field and dimension requests, historical scores hidden behind scorer configuration, a fresh-ledger coverage failure, and queries that exceeded their deadline on a retained-history ledger. Some apparent emptiness was legitimate (stale local history, empty windows, missing raw repo attribution), so the fix had to separate broken reads from honest empty and permission states rather than backfill data or relax authorization.

## What Was Built

**Changed:** `packages/yakka-analytics/web/` (HTML, CSS, JS shell, adapters, panels, explorers, charts, tests), Go `internal/serve/analytics*` and `internal/store/{plan_entities,session_entities,distribution,usage,query,artifact_entities,store}.go`, migration 10 covering indexes, a test-only real-Go two-tenant harness, retained-history workload fixtures and benchmarks, and the per-route workspace contracts in [09-analytics-workspace-contracts.md](../design/09-analytics-workspace-contracts.md).

### Phase 1 — Every read represents the selected question

One tenant-bound read context now reaches schema, first pages, continuations, session and plan detail, content and baselines, with relative windows resolved once to absolute bounds and All using `all=1` plus a frozen `to`. A single schema adapter normalises the heterogeneous wire shape (measure objects, lens metadata) without rewriting the public API, and route errors are contained to the failing panel with distinct loading, empty, unsupported, unauthorized, busy and timeout states. The server gains zero-coalesced empty-ledger coverage with event-second and receive-nanosecond units, one retained-plus-active check catalogue, route-specific score-series capability (`day/week/month`, explicit `unsupported_resolution` and `too_many_cells` refusals), session-scatter `commits`/`unpriced_calls`, plan-associated sessions for cost and events, and the existing `tool_kind` taxonomy in conversation rows. Movers uses the raw `model` split, score strips request only numeric score fields, and every chooser uses the published mode-specific fields. A real-Go, cookie-session, two-tenant browser harness proves the tenant, window and field behaviour without stubs.

### Phase 2 — Retained history is queryable at useful latency

Plan population, association, cost and provenance reads were batched per page; candidate sessions and plan associations are derived once and joined rather than rescanned per fact. Multi-dimension usage treemaps share one request-scoped deduplicated and priced source, artifact band counts are grouped from the selected versions, conversation provenance is conditional on the requested lens and run concurrently, and session scatter folds marginals over the whole filtered population. Migration 10 adds covering indexes and the read DSN sets bounded page cache, mmap and in-memory temp storage. A deterministic synthetic retained workload at or above the evidence scale (239,810 facts, 33,600 usage calls, 7,440 sessions, 260 plans) records 24 request shapes: every shape returns 200 with expected rows alone and under a four-request board load, worst load p95 474.2 ms, no timeout, and the deadline remains one second. The mixed-attribution oracle confirms the `$0.10` plan cost and the raw-repo-empty usage event.

### Phase 3 — Dense full-width views follow the active theme

The centred 1120/1000 px column is gone: 12 px gutters (8 px below 700 px), a 12-column 8 px-gap grid, 13 px/1.35 root type, 28–32 px dense rows, sticky headers, local scrollers, compact scope/coverage rows and an adjacent inspector column. One canonical token family is defined on `:root`/`:host` and inherited by shadow roots; `--yk-chart-*` are aliases, the light surface is `#f4f6f8`, the dark surface `#1b2734`, and canvas fills use the resolved surface. The real-Go real-Chromium acceptance suite covers 16 routes at 1920/1366, light→dark→light survival, real hover/brush/legend/rectangle/keyboard/table selection, 768/390/200% reflow, and empty/permission/error contrast. A follow-up fix corrected keyboard-opened inspector focus and narrow scatter overflow.

## Deviations

- The plan-detail `sessions` collection still applies the raw repo/plan identity filter to session facts. The phase 1 brief deliberately kept session/artifact/execution collections unchanged and fixed only the event identity conflation; a session whose lifetime artifact is outside the window can still drop from the tab while its cost is counted (issue 303).
- The scope row renders static values; window, timezone and filters are not editable there, contrary to the dense-shell contract. Scope changes come from preset links, chip removal and chart brushes (issue 298).
- The plan-detail table header is set to `sticky` but its section has no bounded height, so it does not pin against page scroll (issue 299). Narrow Ledger rows measure 27 px, one pixel below the desktop density band (issue 301).
- The committed retained-history workload is synthetic; the opt-in prepared real-ledger path was not measured, and cold/migration latency was not timed separately (issue 294).
- The conversation-distribution report claims a candidate-session bound that the harness and `session_repo`/`session_model` provenance queries do not use; the full population is materialised (issue 295).
- The terminal review found and fixed the plan-association membership filter: in-window membership no longer applies the plan/repo identity filter, so an associated session whose only in-window fact is empty-repo usage still contributes its cost (D18). An out-of-window-artifact regression test was added.
- Phase 2 and 3 left `release-matrix/matrix.test.mjs` (two release topologies) unrun; the release record, page-set pins and real-Go acceptance were run instead.

## Review

The design review passed with follow-ups: design intent, all three phase outcomes, D01–D18 obligations, domain boundaries and measurable checks were judged sufficient, with deployed parity and SQLite cancellation recorded as follow-ups.

The terminal review re-read the whole change against the three phase outcomes, re-ran the plan/store and plan/serve tests, and re-ran the Phase 3 acceptance suite (10/10). It found one HIGH: the plan-association membership subquery applied the plan/repo identity filter, so a plan whose in-window session activity is empty-repo usage could report `$0` associated cost under a repo/plan filter or a window boundary. That was fixed with a focused regression test and recorded as a review touch-up; no CRITICAL or HIGH finding remains. MEDIUM and LOW findings were filed as issues #291–#303 (numbered list in Follow-ups), with the earlier #283, #284 and #289 still open from phase reviews.

## QA

- Real-Go two-tenant Chromium sweep: 29/29 board, explorer and detail paths settled, every analytics request carried the selected tenant, no request carried `win`, every `all=1` request carried `to`.
- Phase 3 acceptance: 10/10 (real Go, real Chromium, no stubs, no fixed sleeps), including canvas pixels `[244,246,248,255]` light and `[27,39,52,255]` dark, never pure white.
- Regression set: 41/41 across charts, workspace, trends/quality, scatter, plans/artifacts, static shell, release record and the plan29 harness.
- Go: `go test ./internal/store -count=1` and `go test ./internal/serve -count=1` pass; `TestAnalyticsPageSet` serves 75 requests with 0 refusals; the new plan-association regression fails before and passes after the review fix; `go vet` clean.
- Retained workload: 20 runs, all 24 shapes 200 alone and under load, worst load p95 474.2 ms, cancellation releases the reader and the next request succeeds.
- Production parity (read-only, trial tenant `test`, GET only, credential never printed): the remote API returned 401 for `/v1/me`, `/schema`, `/score-series?bucket=auto` and session scatter. The deployed UI answered 200 but is unauthenticated and redirects to `/login`, so there was no authenticated read and no chart canvas to sample. Prior phase runs saw 403/non-JSON from the same remote. Deployed D01–D18 reproduction and deployed plot-canvas colour remain unverified.
- Gate: production parity remote refused the trial credential (401) and the deployed UI requires an interactive session, so deployed reads and canvas sampling could not be performed.
- Gate: deploy Phases 1–3 to production (merge) before deployed UI/data parity can be claimed.

## Residual Risks

- The deployed analytics behaviour is unverified; the local defects are reproduced and fixed, but the production cause could differ.
- Session-scatter load p95 sits about 3–5% below the 500 ms bound on this host (issue 297).
- The read DSN's page cache, mmap and temp-store settings are applied per connection rather than tenant-wide as one phase record states; residency is bounded for the evidence scale but grows with the connection pool.
- A filtered plan view and a window boundary can still hide associated-session activity in the plan-detail sessions tab (issue 303).
- The retained workload's committed source is synthetic; a much larger real ledger, or a much larger session window, is not exercised.

## Follow-ups

- [#283](https://github.com/codyhamilton/yakka/issues/283) Coverage facts disappear for an empty window.
- [#284](https://github.com/codyhamilton/yakka/issues/284) Session detail drops the resolved relative window.
- [#289](https://github.com/codyhamilton/yakka/issues/289) Table panels do not span the desktop grid (fixed in review touch-up; issue left open).
- [#291](https://github.com/codyhamilton/yakka/issues/291) `/scores` zero-fills retained checks absent from the window.
- [#292](https://github.com/codyhamilton/yakka/issues/292) Coverage client ignores the published `coverage.units`.
- [#293](https://github.com/codyhamilton/yakka/issues/293) Rank default split changed from `model` to `harness`.
- [#294](https://github.com/codyhamilton/yakka/issues/294) Cold/migration latency is not recorded.
- [#295](https://github.com/codyhamilton/yakka/issues/295) Distribution report claims a candidate bound the code does not use.
- [#296](https://github.com/codyhamilton/yakka/issues/296) Artifact aggregate accepts `stat=count` with a field.
- [#297](https://github.com/codyhamilton/yakka/issues/297) Session-scatter latency has thin load headroom.
- [#298](https://github.com/codyhamilton/yakka/issues/298) Scope bar is read-only; window and filters are not editable.
- [#299](https://github.com/codyhamilton/yakka/issues/299) Plan-detail table header is not sticky against page scroll.
- [#300](https://github.com/codyhamilton/yakka/issues/300) Palette oracle measures contrast against pure white.
- [#301](https://github.com/codyhamilton/yakka/issues/301) Narrow Ledger rows are 27 px, below the 28–32 px band.
- [#302](https://github.com/codyhamilton/yakka/issues/302) Phase 3 acceptance does not pixel-prove uPlot/SVG themes or 200% operation.
- [#303](https://github.com/codyhamilton/yakka/issues/303) Plan-detail sessions collection still applies the raw repo/plan identity window filter.

## Decisions Worth Keeping

- One explicit read context per view, shared by summaries, headlines, charts, continuations and detail reads; never fall back to another tenant.
- Advertise resolution capabilities per route and refuse unsupported units explicitly, instead of inferring global auto support or clipping history.
- Keep the one-second query deadline and earn headroom through batching and indexes, not a longer timeout.
- Separate plan identity and lifetime association from raw fact filters; associated cost may overlap across plans and includes empty-repo usage.
- One inherited theme token family across document, shadow roots and canvas, with an off-white light plot surface and no white fallbacks.
- Distinguish loading, ready, empty, unsupported, unauthorized, busy, timeout and error states; never render an error as zero or no data.
