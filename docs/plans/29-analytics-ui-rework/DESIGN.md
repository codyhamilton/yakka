# Analytics UI rework

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

## Assumption Ledger

### Assumption 1 — Delivery boundary

- Question: Does “Land the design” include implementation, deployment or merge?
- Answer chosen: Deliver a ready design-only PR against master; run only disposable diagnostic code, with no product fixes or merge.
- Rationale: The request explicitly asks for a design and limits building to evidence.
- If wrong: Implementation needs a separate execution invocation; this design still defines its outcomes.

### Assumption 2 — Meaning of “old school”

- Question: Which visual language and route structure should replace the centered workspace?
- Answer chosen: Preserve existing boards/explorers and URL semantics; use an edge-to-edge operational console, compact native controls, ruled tables, square panels and restrained typography.
- Rationale: Density and full width are explicit; a new navigation model or chart framework is not requested.
- If wrong: Revisit visual tokens and navigation before execution; the data contracts remain useful.

### Assumption 3 — Accessible data evidence

- Question: Which ledger can establish why outputs appear empty without touching live data?
- Answer chosen: Run the current API against an SQLite backup of the populated legacy local ledger, a fresh empty directory and a disposable authenticated fixture. Keep source data untouched and distinguish fixture, local history and deployed evidence.
- Rationale: Current default Yakka data is absent; legacy local history exists. Opening it directly would migrate it. A historical snapshot cannot establish the contents of Cody's live browser session.
- If wrong: Replay the same output matrix against the intended tenant before deployment; do not infer missing production ingestion from local history.

### Assumption 4 — Historical data and authorization

- Question: Should the rework fabricate missing history, reassign unattributed events or relax access checks to make outputs nonempty?
- Answer chosen: Preserve tenant/admin boundaries, exact grains and retained data. Repair reads and expose stale coverage, unsupported capabilities and missing provenance explicitly; no backfill or source migration by default.
- Rationale: Historical hook attribution and recency cannot be recovered by presentation code, and no data mutation was requested.
- If wrong: A source-capture/backfill project requires its own evidence and authorization, outside these phases.

### Assumption 5 — Theme and performance policy

- Question: Should the rework force dark mode or relax the query deadline to conceal failures?
- Answer chosen: Preserve saved/system theme selection; use theme-derived plot surfaces (including an off-white light surface), and retain bounded queries and the existing 500 ms p95 target.
- Rationale: The complaint is about mismatched white backgrounds and unusable output. Real-ledger query amplification is demonstrated; a longer timeout alone does not fix it.
- If wrong: Change the default theme or performance policy explicitly before execution. Do not silently rewrite user preferences or weaken existing budgets.

### Assumption 6 — Resolution compatibility boundary

- Question: Should an existing score-series refusal expand this UI repair into implementing automatic multi-year resolution on every route?
- Answer chosen: Publish actual resolution support per route and keep the current score-series day/week/month units, with explicit cell-budget refusals; correct the stable document's broader promise.
- Rationale: Default score trends already request supported units. The demonstrated blank outputs have other causes; accurate capabilities bound this repair without pretending the broad promise is implemented.
- If wrong: Restore the broader promise and add a separately bounded resolution-engine outcome before implementation; do not silently clip score history.

## Problem

Plan 20's static workspace has real API/UI integration failures despite extensive fixture-driven acceptance. At a 1920 px viewport the main area is only 1120 px wide. Its 64 px top margin, padded nested cards, large controls and repeated explanations spend space before showing observations.

The missing outputs have several independent causes. Real local runs found schema shape mismatches, omitted tenant parameters, incorrectly encoded time windows, invalid field/dimension requests, historical scores hidden by scorer configuration, a fresh-ledger schema failure and expensive queries that exceed their deadline. The available local history is also stale and lives under the legacy data root. Those environmental observations do not establish missing data in Cody's production tenant.

[EVIDENCE.md](EVIDENCE.md) records the runtime topology, endpoint results, root causes, proposed fixes and the complete board/explorer inventory. Its D01–D18 findings define the data repair scope. No product code is changed by this PR.

## Solution Shape

Keep the existing static HTML/CSS/native-module workspace, boards, explorers, identity flows and interactive chart kit. Give them one faithful read contract and an edge-to-edge operational layout. Tables and charts share compact panel frames; units, populations and coverage remain visible, while long explanations move into disclosures. The same selected tenant and resolved window reach every request, including continuations, content and baselines. Reads show observations when retained data supports the question and a specific, recoverable state when it does not.

### Domain: Read context and capability interpretation

- Owns: `web/contract/`, shell routing/context, panel registry/chooser interpretation, board loaders and explorer transport integration.
- Contract:
  - A tenant-bound view receives an explicit read context: API base, auth mode, selected tenant, validated lifecycle generation where available, timezone and resolved scope. Every analytics read and tenant-scoped `/v1/baselines` request uses it, including schema, paging, session detail, content and diff. Cookie-session requests always carry `tenant`; bearer and local modes retain the server's existing rules. No fallback to another tenant after failure.
  - Resolve relative windows once per view refresh into absolute `from`/`to`; All uses `all=1` with a fixed `to`. Never send `win` to the API. Summary, quality headline, activity, comparisons and linked charts use the same resolution. Cursors retain their original window, filters and tenant; changing any scope starts a new traversal. Unsupported filters/cohorts are disclosed or refused, never claimed applied.
  - Normalize the existing heterogeneous schema at one client boundary. Time measures may be `{name,unit,dims}` objects; other measures may be names; artifact lenses may be keyed metadata objects. Consumers receive explicit name collections plus their metadata. Preserve per-measure dimensions and per-mode field sets. A measure available in list/aggregate mode is not automatically available in scatter mode. Do not rewrite the public wire shape solely to fit the old stub.
  - Session scatter must support its existing cost-versus-commits question: publish and serve `commits` and `unpriced_calls` alongside the currently supported usage fields, using the session grain's in-window values and null semantics. Choosers use `scatter_fields`. Movers' time-query model split uses raw `model`; derived `session_model` is offered only on a route that implements that grain. Artifact score strips request numeric score fields, derive categorical grouping from returned lenses, and use a same-kind check catalogue.
  - A failed schema/adapter request cannot abort the whole route or remain cached as a successful capability result. Keep navigation available, isolate panel errors, and offer a fresh read. States distinguish loading, ready, genuinely empty, unsupported, unauthorized, busy, timeout and other errors; an error is never rendered as zero or “no data”.
- Non-goals: new grains, framework/bundler changes, arbitrary historical attribution, new chart engines or relaxed auth.

### Domain: Retained analytics and bounded query serving

- Owns: Go analytics schema, coverage, score/catalogue reads, session scatter and conversation serializers; store queries serving the affected boards.
- Contract:
  - An empty ledger answers `/schema` with 200, zero counts and absent/null time bounds. Historical checks remain discoverable and selectable with no scorer configured, or after the active catalogue changes. `/schema`, `/scores`, `/score-series` and selected-check validation use the same retained-plus-active names per kind. Querying history must not require a new scoring run.
  - Coverage distinguishes event seconds from receive-time nanoseconds and reports per-fact-type bounds. The shell shows the latest retained observation and its age, available historical range, scored coverage and missing repo attribution without implying completeness. No observations in the selected window offers an explicit All-history action; it never changes the window automatically.
  - Conversation detail supplies the existing normalized `tool_kind` taxonomy used by tool lanes. Do not invent another browser-only mapping. Artifact text/diff keeps existing complete-body, integrity and unavailable-reason contracts. Missing historical body files are not inferred from a database-only diagnostic snapshot.
  - Plan identity selects lifetime associated sessions; it is not an additional raw repo/plan filter on their usage or events. Associated cost includes those sessions' in-window usage with empty raw repo, and plan events include their hooks. Explicit genuine event filters still apply; keep page/count predicates identical and costs overlapping across plans.
  - Preserve counts, lifetime-derived provenance, in-window measures, scorer identity, cursor snapshots, sample/marginal semantics and overlapping associated plan cost while eliminating repeated scans. Derive candidate sessions/plans once and batch their associations/provenance; load only the provenance a distribution needs. Multi-dimension usage and artifact bands must share scoped work rather than rebuild the population per combination or per artifact.
  - Keep bounded concurrency/cancellation and explicit query errors. Ordinary supported requests in the EVIDENCE output inventory must complete without timeout on a ledger at least as large as the migrated diagnostic snapshot (235,496 retained facts, 20,805 scores, 7,417 sessions), including All history. Acceptance uses the diagnostic copy or a reproducible synthetic workload with at least its 257 plan identities, 1,339 artifact file identities, 823 plan/session associations, 32 usage harness/model groups, 57 sessions per highest-fan-out plan and 43 plans per highest-fan-out session. Preserve lifetime provenance and unscoped hook populations; record workload characteristics and query plans with results. Retain the existing p95 ≤500 ms target over at least 20 warm requests per affected request shape, measured alone and with a four-request board load; no timeout in either run. Record cold/migration latency separately. The one-second deadline is not increased as the acceptance mechanism.
  - Resolution support is route-specific. Add `/schema.resolutions.routes["score-series"] = {buckets:["day","week","month"], auto:false}`; this entry takes precedence over legacy global flags. Against older schemas lacking the entry, the client uses the known day/week/month set for this route and never infers score-series auto support from global flags. Unsupported units return 400 `unsupported_resolution` with `supported_buckets`. A cell-budget refusal returns 400 `too_many_cells` with `max_cells` and a supported `suggested_bucket` if one fits; if even month cannot fit, omit the suggestion and return `suggested_action: reduce_splits_checks_or_choose_window`. The UI presents that action without changing filters/window automatically. This replaces score-series' generic range refusal; do not silently clip history or implement a new multi-year resolution engine here.
- Non-goals: automatic legacy-directory migration, moving source ledgers, ingestion/backfill work, rescoring history, deployment or a global budget-policy rewrite.

### Domain: Dense workspace and theme

- Owns: shell, scope/coverage bars, panel frames, explorer tables, chart wrapper styling, chart theme tokens and theme redraw integration.
- Contract:
  - Use full viewport width: no centered max-width container, auto horizontal margins or centering calculations on header, main or footer. Desktop gutters are 12 px; below 700 px they are 8 px. At 1920 px the main content width is 1896 px, and at 1366 px it is 1342 px. Align headings, controls, panels and tables to that shared left edge.
  - Default desktop text is 13 px with approximately 1.35 line height; primary data stays at least 12 px. Use tabular numerals and right-aligned numbers. Compact ruled tables have 28–32 px rows, sticky headers and local horizontal scrolling. Long identifiers truncate with an accessible full value; keyboard focus and selected/error states remain visible.
  - Navigation and scope are compact horizontal rows, followed by one coverage/status line. Make window, timezone and existing filters editable there; changes remain URL-backed and reproducible. Start becomes a compact index of the existing question paths. Every existing board remains reachable, including Cost, Quality, Tools, Compare and Workflow. Saved views and Follow are compact controls, not large cards beneath every report.
  - Use a 12-column desktop workspace with 8 px gaps. Ordinary panels span four or six columns; tables/timelines can span all twelve. At 1366 px, ordinary charts have at least two useful columns; below 900 px stack panels. A long table scrolls within its own surface; the document has no horizontal overflow. Opening the inspector uses an adjacent column on wide screens and an overlay on narrow screens.
  - Panels use one thin border, square or at most 2 px corners, 6–8 px inner spacing and compact title/actions. Put unit, time basis and population in one short metadata row; put verbose provenance and capability details in a disclosure. Eliminate the second padded chart card. Chart/table tabs share the same returned population; chart interaction, hover, brush, legend and drill-through remain available. Typical plot height is 200–260 px and responds to its panel's width. Data rows are never replaced by a decorative KPI wall.
  - One active-theme token family supplies the document, chart hosts and shadow roots. Panels, plots, table headers/alternation, controls, legends, tooltips, selections, axes and grids all derive from it. Plots inherit the panel surface; canvas fills use its resolved token. Remove white/light-only fallback surfaces from the data presentation path. Dark uses the dark panel surface; light uses an off-white surface, with no pure-white plot canvas. Theme changes repaint existing SVG, uPlot and canvas charts without losing selection, hidden series, URL state or data.
  - Compact desktop targets may be 24–28 px where spacing preserves access; coarse-pointer controls retain 44 px targets. Density must retain semantic tables, visible focus, chart table alternatives, contrast checks and useful 200% zoom/reflow.
- Non-goals: rebranding, animations, new visualizations, changing saved-board identity, new navigation routes or rebuilding OAuth/profile/device flows.

A representative desktop arrangement (proportions, not a pixel mockup):

```text
YAKKA  Start Pulse Trends Cost Quality Tools Workflow Compare Scatter | Plans Sessions Ledger | Theme Profile
Window [30d v] From [...] To [...] TZ [...] Repo [...] Harness [...] Model [...]  [Apply] [Clear] [Saved]
Tenant … | last event … (age) | usage last … | scoring … | attribution … | request/error state
+--------------------------------+--------------------------------+--------------------------------+
| Title  unit / n       Chart/Table| Title  unit / n       Chart/Table| Title  unit / n       Chart/Table|
| plot or compact table           | plot or compact table           | plot or compact table           |
+--------------------------------+--------------------------------+--------------------------------+
| Full-width event / session / plan table: sortable header, dense rows, cursor continuation             |
+----------------------------------------------------------------------------------------------------+
```

## Architectural Implications

Read [OVERVIEW](../../OVERVIEW.md), [ARCHITECTURE](../../ARCHITECTURE.md), the relevant ingest/remote/advisory/serving contracts in `docs/design/`, and the Plan 20 record. [09-analytics-workspace-contracts.md](../../design/09-analytics-workspace-contracts.md) governs the current workspace; 07 explicitly marks its Svelte-era sections historical.

This widens a visual redesign into bounded API/read-adapter repairs because locally demonstrated failures cannot be fixed in CSS. It preserves the no-build static layout, vendored uPlot 1.6.32 and first-party SVG/canvas engines, the Pages/API release separation, tenant isolation and content trust boundary. Stable contracts gain the dense-layout/theme/read-context seam in this PR. The documented route-wide resolution promise is narrowed to honest per-route advertisement instead of treating the implementation's refusal as an empty result. No deployment, job, secret, database migration or destructive lifecycle operation belongs to this design delivery.

## Decisions

Headless posture is explicit. Assumptions above are the scope checkpoint and are waved through under the design skill. The phase count and order below are fixed. EVIDENCE's root causes are repair obligations; its environmental observations are diagnostic/presentation obligations, not permission to mutate source data. Existing Plan 20 follow-ups are included only where reproduced here (tool lanes and affected plan reads); this is not a general cleanup of its backlog.

## Open Questions

None blocks design or implementation. Production browser/deployed-SHA parity was not established: the configured remote API returned non-JSON 403 responses from this environment. This limits claims about Cody's exact deployment, not the reproduced local defects. If later replay identifies a different production cause, record it and amend the affected contract rather than claiming this PR already fixed it.

## Phases

Three phases; each is large enough for `refine` to produce separate bounded units. This PR only designs them.

### Phase 1 — Every read represents the selected question

- Outcome: In a real Chromium browser against current Go handlers and an authenticated two-tenant fixture, open every existing board/explorer, change tenant/window/filter, reload, page and drill through to session/artifact/plan detail → requests retain the selected tenant and canonical scope, no schema-shape exception aborts a route, and the returned fixture population reaches the matching chart/table or an explicit authorized/unsupported state. A fresh empty tenant loads schema successfully. Retained scores remain visible without active scorer configuration; Movers, score strips, session scatter and tool lanes use valid fields/taxonomy. All-history and finite-period Compare produce their defined distinct states. Coverage shows correct units and recency. Score-series discovery follows the route-specific capability and older-schema fallback; unsupported-unit and over-budget requests produce the defined actionable refusals.
- Surfaces: `web/contract/{transport,url-state,session-gate}.js`, `web/js/app.js`, `web/js/{core,boards,panels,explorers}/` read/adapter boundaries; Go `internal/serve/analytics*`, `internal/store/session_entities.go`; existing browser/Go contract and fixture harnesses.
- Approach: known — normalize actual wire capabilities, centralize context, repair the documented request/serializer/catalogue mismatches. Browser proof uses the real Go API with cookie sessions; stub-only tests cannot close this phase.
- Depends on: nothing.

### Phase 2 — Retained history is queryable and correct at useful latency

- Outcome: Replay every request shape in EVIDENCE against a retained-history-scale ledger, including plan lists/detail/scatter/workflow, conversation distributions, session scatter, two-dimension cost treemap and artifact bands → supported requests return complete, correctly populated results within the performance contract above, alone and under a four-request board load. The mixed-attribution fixture shows plan cost $0.10 matching its associated session and includes that session's raw-repo-empty usage event. Counts, provenance, scores, null/unpriced cases, cursor continuation and sample populations equal the fixture/reference query oracles. No underlying query failure is mislabeled as invalid sort or empty data.
- Surfaces: Go `internal/store/{plan_entities,session_entities,distribution,usage,query,artifact_entities}.go` and their helpers as confirmed by refinement; `internal/serve/analytics{,_entities,_distribution,_query,_population}.go` and artifact aggregate helpers; pageset/real-ledger benchmark and request-contract fixtures.
- Approach: known — batch candidate population/association work, make provenance joins conditional and remove per-entity rescans; use measured query plans to select indexes where needed. Preserve public grain semantics and bounded-resource policy.
- Depends on: Phase 1, so performance is measured for valid, faithful requests.

### Phase 3 — Dense full-width views follow the active theme

- Outcome: At 1920×1080 and 1366×900, opening each board/explorer → main content meets the stated full-width gutters, tables/panels follow the density contract, all boards are reachable, and the visible data is the population proved in Phases 1–2. At 768 px and 390 px, and at 200% zoom, controls remain operable and tables scroll locally. Switching dark→light→dark with populated SVG/uPlot/canvas charts → surfaces, controls, headers, legends and tooltips match the active tokens; canvas background pixels agree with the panel surface, with no pure-white plot background, and selection/URL/data survive. Real mouse/keyboard actions still hover, brush, toggle, drill through and open the table alternative. Empty, unauthorized and error states remain readable and actionable in both themes.
- Surfaces: `web/index.html`, `web/css/` shell/workspace/panel/explorer/chart styles, `web/js/app.js`, `web/js/{charts,panels,core,explorers}/` presentation and theme integration; chart gallery, workspace/identity acceptance and palette checks; generic static serving/release checks.
- Approach: known — retain the route/chart systems, replace centered geometry and duplicated chrome, establish inherited theme tokens across light/shadow DOM and verify rendered states.
- Depends on: Phases 1 and 2, so visual acceptance exercises real observations.

## Provenance Notes

Ground was independently delegated for UI/request and API/storage recon, then tested with current Go and Chromium. The original ledger was never opened for writing: SQLite backup was migrated only inside this worktree. No complete bodies, tokens, cookies or personal row dumps enter the design artifacts. A browser-only schema transformation and configured-check comparison exposed defects hidden behind the initial failures; those are explicitly labeled diagnostic interventions in EVIDENCE and are not shipped fixes.

The local chart engines already honor dark mode in Chromium. The white-canvas complaint was not reproduced at this source revision; white controls and Ledger headers were. The contract deliberately covers both the demonstrated light-DOM leak and chart surfaces rather than inventing a canvas-library root cause. Production parity remains a verification limit.

A fresh-context adversarial review found two contract gaps: workload counts alone did not reproduce association fan-out, and route-specific resolution publication lacked a wire/fallback/refusal contract. Both are resolved above. The review found no blocking intent, scope or phase-order issue.
