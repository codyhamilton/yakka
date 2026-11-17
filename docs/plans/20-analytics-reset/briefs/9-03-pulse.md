# Brief: 9-03 — Pulse preset, river, feed, brush and movers

Consumer: the Phase 9 Pulse worker.
Owned paths: `packages/yakka-analytics/web/js/panels/{river,pulse-strips,movers,calendar,coverage}.js` (new), `packages/yakka-analytics/web/js/panels/index.js` (add the five imports), `packages/yakka-analytics/web/css/pulse.css` (new), `packages/yakka-analytics/tests/workspace/{pulse.test.mjs,follow-ui.test.mjs}`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/9-03-pulse.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 9-01, 9-02.
Runs alongside: 9-04, 9-05.
Budget: 20 files to read, about 1,200 lines to change, 65 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3 — activity list/probe, measures/lenses/time basis, typed populations, time-cohort resolution; 17.3.1 — population/relation/associations; 17.2 — `/schema.coverage`, budgets, features.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 9 outcome; panel catalog rows `river`, `pulse-strips`, `movers`, `calendar`, `coverage`; preset mapping `pulse`; Interaction model (brush vs scope, gestures, linking, honest uncertainty); Workspace shell and state (time basis, money, Follow, states/badges).
3. `packages/yakka-analytics/web/js/panels/{registry,panel-frame,index}.js`, `web/js/boards/{presets,board}.js`, `web/js/core/{panel-state,follow,view-spec}.js`, `web/js/core/{chips,selection-tray,inspector,capability-inspector}.js` — the 9-01/9-02 seams; use their public surface.
4. `packages/yakka-analytics/web/js/charts/{yk-chart,yk-bars,yk-matrix,yk-lanes,legend,badges,formatters}.js` — the existing elements; read exports/spec/events only, do not edit.
5. `packages/yakka-analytics/tests/workspace/{harness.mjs,fixture.mjs,stub-api.mjs,browser.mjs}` and `tests/charts-cat/matrix.test.mjs` — the harness, deterministic rows and calendar interaction precedent.
6. `packages/yakka/internal/serve/analytics_activity.go:10-120` (row/probe fields), `analytics.go:483-620` (`/summary`, `/scores`), `analytics_query.go:161-260` (`/query` points/buckets), `internal/store/session_entities.go:439-500` (`AnalyticsCoverage`), and `packages/yakka/internal/analyticsfixture/manifest.json`.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Deliver the Pulse preset against the fixture: the five panels named in the design, with feed inspect opening provenance, the time brush previewing peers, zoom refining scope, Follow announcing new observations and acknowledging honestly, and every panel naming its grain, units, time basis, coverage and caveats.

## Contract

- **Preset `pulse`** (DESIGN.md preset table): `river`, `pulse-strips`, `movers` by harness/model (repo lens only when `/schema` offers it), `calendar`, `coverage`. Main action: feed inspect → session/artifact/execution provenance; time brush previews peers; zoom refines scope. Five panels, one shared scope; at most 12 panels per board.
- **`river`** (`activity observation`, P6 `/activity`): recent session starts, artifact versions, executions and rejections as a dense linked timeline; each clock and observation type labelled. List rows are `{event_time,type,identity,conversation_id,repo_id,path,harness,kind,plan,stage}` from `/activity?mode=list` with cursor `next`; the panel uses `<yk-lanes>` (no new chart type) with kind-keyed colours/shapes and entity keys that inspect to the inspector. State the basis: row clock is event time; late arrivals are what Follow reports by receive time. Preserve `ignored_filters` naming from the response.
- **Follow** is 9-01's `follow.js`: off by default, interval `yakka-analytics-follow-seconds` (default 30), probe `/activity?mode=probe&after=<watermark>` only while visible, counts by observation type since the acknowledged watermark, refetch the feed only on click, advance the watermark only then; a cancelled/error probe advances nothing; no other auto-refresh. The river renders the toggle, interval, counts, watermark state and acknowledge action; it never fakes counts.
- **`pulse-strips`** (`time`, Now): one strip per headline measure — cost, calls, sessions, events, artifacts, commits, rejections, quality median — with change against the previous equal period. Use `/summary` for `cost_usd`, `model_calls`, `conversations`, `hook_events`, `artifact_versions`, `commits`, `rejections` (show the stage split; the strip total is their sum) current and previous; use `/scores?kind=<selected kind>` for the median (name kind/check/scorer and `n`). Previous is the equal-length window immediately before the current one; with `all` there is no previous and the strip says "no previous period", never zero. Unpriced cost is a lower bound with the unpriced count; an all-unpriced value is `unpriced`, never `$0`. Use an existing element (`<yk-bars type="lollipop">` with current and previous series, or the shared table) — no new chart type.
- **`movers`** (`time`, Now; repo lens P4): ranked change per lens value, this period against the previous: bars with sparklines, `n` and unpriced counts. Default measure `cost_usd`, chooser limited to measures `/schema` offers for the time grain. Query `/query` with `dim=harness` and `dim=session_model`, `bucket=none` for totals and `bucket=day` for the sparkline series, current and previous windows; `n` from the response's typed population, unpriced from the `unpriced_calls` measure, and where the server supplies neither, name that rather than inventing it. The repo lens is offered only when `/schema.grains.time.lenses` or `predicate.lenses` includes `session_repo`; otherwise the panel omits it and names the absent capability. Compose `<yk-bars>` and `<yk-chart>`/the shared table; no new chart type.
- **`calendar`** (`time`, Now): day-by-week calendar of a supported measure. Use `/query?measure=<measure>&bucket=day` (or the coarser resolution the server returns) and `<yk-matrix type="calendar">`; label coarsening. A brush emits a day-snapped interval as transient `sel`, shows the labelled peer preview without a URL push, and double-click/*Zoom to selection* commits `from`/`to`, pushes history and clears `sel` (9-02's tray/router owns the commit). Heatmap cells and calendar days share entity keys by design (Phase 8 carried item): a selected day key highlights every cell for it and the table repeats the key; name this in the panel caveat and do not edit `yk-matrix`.
- **`coverage`** (`typed populations`, P3/P4/P5): typed rows with units and denominators, no single blended percentage. Read `/schema.coverage` (`facts` first/last/last_received per type, `sessions.total/with_session_repo/without_session_repo`, `scored_content_by_kind.scored/total`, `pending`, `screen_gaps`, `compaction`, `scorer_configured`, revisions) and `/summary` (`by_source`, `screens`, `rejections`, `model_calls`, `unpriced_calls`). Show data by source, last receive per type, pending, scored/total hashes per kind, priced/total calls, attributed/total sessions, rejected by stage, and compaction/scoring state. Every value names its unit; overlapping populations are not summed into one figure. An existing element/table is enough; no new chart type.
- **States and badges.** Every panel is the 9-01 frame: `loading`/`ready`/`empty`/`error`/`unsupported`/`cancelled` plus `partial`/`sampled`/`coarsened`/`clipped`/`lower-bound` from the response/server. Empty names which filter/cohort/selection produced zero and offers to clear each; error shows the server's message, `code` and retry; cancelled offers retry, never an error; unsupported names the missing feature and nearest supported choice.
- **Honest uncertainty.** Quality strips carry the comparative/scored-of-total banner with the scorer; movers and any correlation carry "association, not cause"; any sampled response carries "sample of N of M; marginals are the whole population"; repo-using panels say how many sessions are unattributed; plan cost is not shown in Phase 9.
- **No fixed sleeps, no animation.** Browser specs wait on `data-state`/`data-idle`, URL end state and `inspect()`; touch/keyboard reach every action without hover; at most four analytics requests in flight; no `/tmp`; no product branch on being under test.

## Changes

- Register the five panel modules in registry shape, each with `{id, grain, measures, lenses, charts, requires, caveats}` and a `requests()` descriptor for the capability inspector. In `web/js/panels/index.js`, add their imports and register the `pulse` preset (the five ids in DESIGN.md's preset table, one scope) through 9-01's `registerPreset`; do not change `app.js`, the router, the later-destination rows or the frame.
- `river.js`: `/activity` list panel on `<yk-lanes>`; cursor paging; inspect emits the entity key and type; ignored filters named; Follow UI bound to `follow.js`.
- `pulse-strips.js`: current/previous summary calls (and `/scores` for the median), previous-window arithmetic from the shared scope (no cap, no `all` previous), lower-bound/unpriced rules, strip model used by the table and bars.
- `movers.js`: per-lens current/previous totals and sparkline series, ranked by change, `n`/unpriced reconciliation, conditional repo lens, chooser limited to schema-supported measures.
- `calendar.js`: `/query` day buckets, `<yk-matrix type="calendar">`, brush preview vs commit wiring through 9-02, coarsening/basis labels and the shared-key caveat.
- `coverage.js`: coverage/summary typed rows and units, no blended percentage, tables/badges only.
- `pulse.css`: layout for the five panels, strip/table presentation, no animation/transition; loaded idempotently by the pulse board/panels through an absolute `/css/pulse.css` link so other routes never request it.
- `tests/workspace/pulse.test.mjs`: pure strip/mover/coverage/previous-window checks (including `all` = no previous, unpriced lower bounds, no blended percentage, repo-lens absence) plus a Chromium spec that opens `/b/pulse`, waits for all five panels to settle, inspects a river mark to the inspector with the right provenance, brushes the calendar and observes a transient peer preview with no URL `from`/`to`, commits a zoom that pushes `from`/`to` and clears `sel`, checks the calendar key caveat, moves the measure/lens within schema limits, and asserts no console/page/CSP error and `maxInFlight <= 4`.
- `tests/workspace/follow-ui.test.mjs`: Chromium spec: Follow is off at load; `probeNow()` reports counts by observation type from a stub late arrival without moving the acknowledged watermark; acknowledge advances it and refetches the feed once; an injected probe error leaves the watermark unchanged; hiding the document stops probing. Drive the module's explicit surfaces; no timers, no sleeps.

### Keep untouched

Do not edit `web/js/charts/*`, `web/css/charts.css`, 9-01's `router/view-spec/panel-state/follow/saved-boards`, `registry/panel-frame`, `boards/*`, `web/js/app.js`, 9-02's chips/tray/inspector/capability modules, the harness/stub, any Go file, or `tests/e2e/*`, `tests/hosted/*`, `tests/identity/*`. No new chart type, route, grain, join, gesture, storage key or dependency. Do not change preset ids or panel ids.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/workspace/pulse.test.mjs packages/yakka-analytics/tests/workspace/follow-ui.test.mjs` → all pass, or browser tests skip with `SKIP_REASON` and the run records the gate.
- `NODE_PATH=… node --test packages/yakka-analytics/tests/workspace/engine.test.mjs packages/yakka-analytics/tests/workspace/tray.test.mjs` → no regression; the preset validation still passes.
- Observable on `/b/pulse`: five panels settle `ready` against the fixture (or the contracted `empty`/`unsupported` for a genuinely absent capability); river rows show four observation types with their clocks; inspect opens the matching entity provenance; the calendar brush shows a labelled preview and no URL change, zoom writes `from`/`to` and clears `sel`; Follow is off by default, reports late counts, and advances its watermark only on acknowledge; pulse strips compare against the previous equal window and never show `$0` for unpriced; movers shows repo only when schema offers it; coverage shows units and no blended percentage; no console/page/CSP error and `maxInFlight <= 4`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
