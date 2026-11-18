# Brief: 10-01 — Trend and compare primitives, the Trends and Compare presets

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/p10-shared.js`, `packages/yakka-analytics/web/js/panels/trend-columns.js`, `trend-lines.js`, `trend-multiples.js`, `rhythm.js`, `dist-ranges.js`, `dist-hist.js`, `dist-ecdf.js`, `rank.js`, `p10-trends.js`, `p10-compare.js`, `p10-quality.js`, `p10-cost.js`, `p10-tools.js`, `panels/index.js`, `panels/panel-frame.js`, `boards/board.js`, `web/js/app.js`, `web/js/charts/yk-ranges.js`, `web/js/charts/yk-bars.js`, `web/css/trends.css`, `packages/yakka-analytics/tests/trends-quality/browser.mjs`, `fixture.mjs`, `trends.test.mjs`, `compare.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `stub-api.mjs`, and `docs/plans/20-analytics-reset/reports/10-01-trends-compare.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/10-01-trends-compare.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phases 3, 4, 5, 7, 8 and 9.
Runs alongside: nothing; it establishes the seams and stubs that 10-02 to 10-04 fill.
Budget: 22 files to read, about 1,900 lines to change, 48 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 10 outcome, the panel catalog and preset matrix, and the Interaction model.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.2 (schema/features), 17.3 (measures, lenses, time grain, comparisons), 17.3.1 (cohorts), 17.5 (chart kit and legend/colour rules), 17.7 (harness).
3. `docs/plans/20-analytics-reset/CONTRACTS.md` — 7.1, 7.2 and 17.1 for the shared filter, `/query`, `/distribution` and effective windows.
4. `packages/yakka-analytics/web/js/panels/{pulse-strips,movers,calendar,index,panel-frame,registry}.js` and `boards/{presets,board}.js` — the existing helpers, panel shape, frame and preset data.
5. `packages/yakka-analytics/web/js/{app,core/view-spec,core/selection-tray,core/chips}.js` — the frame wiring, panel-spec URL state, tray and chips.
6. `packages/yakka-analytics/web/js/charts/{svg-base,yk-chart,yk-bars,yk-ranges,yk-matrix}.js` — the public surfaces you compose; read the model builders and `inspect()` rather than the whole files.
7. `packages/yakka-analytics/tests/workspace/{harness,fixture,stub-api,browser}.mjs`, `pulse.test.mjs`, `tests/gallery/harness.mjs` — the test harness and the route stubbing pattern.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Deliver the Trends and Compare presets over the existing chart kit, and the shared P10 request/chooser/legend/test seams the Quality, Cost and Tools units will fill, so each preset regroups on a supported measure, lens or chart and every comparison shows both populations rather than one bare delta.

## Contract

- DESIGN.md Phase 10: every panel assigned to P10 in the preset matrix is delivered; changing a supported measure/lens/chart regroups the preset with stable surviving styles; long-history auto resolution and zoom preserve dates; finite period/cohort comparisons show both populations and coverage; all modes, linked actions and table values match the fixture.
- Preset data (DESIGN.md panel catalog): Trends is `trend-columns`, `trend-lines`, `trend-multiples`, `calendar`, `rhythm` over time facts. Compare is `dist-ranges`, `dist-hist`, `dist-ecdf`, `trend-lines`, `rank` in slope mode over two equal finite periods.
- CONTRACTS.md 17.5: no dual axes, a legend whenever two or more series, units/time basis in the frame, zero-based bar axes, a table view for every chart, a filter never repaints a surviving series. Bars legend focus emits `filter` with a null value; the app maps series keys to contract lens names.
- CONTRACTS.md 17.3/17.1: offers come from `/schema` and the effective window/bucket come from the response (`requested_bucket`, `bucket`, `coarsened`, `window`). A measure or dimension not published for the grain is unsupported with its source, never requested and never faked. `all=1`/`win=all` has no previous period.
- CONTRACTS.md 17.3.1: a cohort is the canonical `cohort=` JSON with frozen absolute scope; 10-05 will add that parameter. This unit must leave one request-builder seam and must not itself edit cohort grammar.
- Chart kit facts: `<yk-chart>` supports lines/area/columns/cumulative/share/scatter/ecdf and exposes `inspect()`; `<yk-ranges>` supports box/histogram/strip/dots and derives six summary series for a box; `<yk-bars>` supports ranked/stacked/percent/lollipop/slope; `<yk-matrix>` supports heatmap/calendar. Reuse them; add no chart type.
- Carried from Phase 8: the box legend's summary-series coupling is owed if a Phase 10 distribution panel shows a box legend, and the diverging ramp must be browser-shown in Phase 10's compare panels. Both are settled here: an opt-in entity legend on `<yk-ranges>` and an opt-in diverging slope stroke on `<yk-bars>`, with the existing element behaviour unchanged when the option is absent.

## Changes

### Shared seams

- Add `p10-shared.js` with pure helpers and one render seam:
  - `schemaGrain(schema, grain)`, `measureMeta(schema, name)` (unit/kind from `/schema.measures` plus a small fallback for the published measures), `offeredMeasures(panel, schema)`, `offeredSplit(panel, measure, schema)` using the grain's published lenses and the measure's published `dims` (exclude `hour_of_day`/`weekday` from split; `id` is not a split), and `chooserModel(panel, spec, schema)` returning `{measures, splits, charts, unsupported}`.
  - `requestScope(scope)` and `windowParams` re-exported or wrapped from `pulse-strips.js`; do not duplicate the window parser. Add `cohortParams(scope)` returning an empty object for now with a comment that 10-05 fills it. Every P10 request goes through one `requestParams({scope, spec})` so 10-05 changes one place.
  - `renderChooser({panelId, spec, schema, doc, onSpec})`: three labelled selects (measure, split, chart) plus the unsupported list with reason/source. A change dispatches a composed `spec` `CustomEvent` from the panel host with the merged canonical spec; it does not touch the router.
  - `ensureP10Styles(href, doc)` and `whenPanelSlot(panelId, slot, doc, paint)` following `ensurePulseStyles`/`whenPanelBody`.
  - `bucketForWindow(scope, schema)` (day/week/month for score series later; `/query` uses `auto`), `coarsenedText(body)`, `populationLine(result)`, `coverageFacts(result)` and `comparisonSummary({current, previous, unit})` that prints both populations/sample sizes/coverage and never a lone delta.
  - `chartSeries` helpers that keep a contract `lens` on every series when the split is a contract lens.
- `panel-frame.js`: accept `schema` in the options and pass it to `panel.load({...})`. Do not change the frame's state vocabulary, retry, population or basis behaviour.
- `app.js`: pass `schema` to every frame; listen for the panel `spec` event and write it with `writePanelSpec(currentState(), entry.key, spec)` then `router.pushScope(stateUrl(...))`; listen for a `scope` event carrying absolute `{from,to}` and push `win:''` with those bounds; in the `inspect` listener, read `event.target.spec.entities?.[detail.key]` and pass `destination` (`/artifact?repo_id=…&path=…&hash=…` for an artifact) plus an `entity` object into the inspector context. Do not change the inspector or the inspector action contract.
- `board.js`: include `state.cmp` in `boardScope` when it is set (the compare mode is a scope input; it is not a server parameter). Do not add panel ids or change `MAX_BOARD_PANELS`.
- `charts/yk-ranges.js` and `charts/svg-base.js`: add an opt-in entity legend. When `spec.legend === 'entities'`, `buildBox` returns `legendSeries` from the group rows (key/label) and the box render filters rows whose key is hidden; the legend labels/colours the groups, while the tooltip still reports the summary statistics. Without the option the box keeps its current summary legend exactly. Add a model test for both forms.
- `charts/yk-bars.js`: add `spec.deltaRamp`; when true, a slope segment whose end is above its start uses the committed positive diverging token and a fall below uses the negative token, with a `data-delta="up|down"` attribute. Without the option slope keeps its series colours exactly.
- `panels/index.js`: import and call `registerTrendsPanels`, `registerComparePanels`, `registerQualityPanels`, `registerCostPanels` and `registerToolsPanels`; the last three are empty stubs in `p10-quality.js`, `p10-cost.js` and `p10-tools.js` that return true until 10-02 to 10-04 fill them. Keep `registerPulse()` and its exports unchanged.

### Trends

- `trend-columns.js`: time grain, one measure and one split. Load `/query` with `bucket=auto` (or `hour/day` when the scope specifies one), `dims` only for the chosen supported split, and `top` from the schema budget where the server supports it. Compose `<yk-chart type="columns" stacked>` when a split is present, single columns otherwise. Render the coarsened/effective bucket and the matrix of zero-fill only where the server supplied a zero. A measure with no published dims shows the unsupported pairing with its source instead of a fake split.
- `trend-lines.js`: same request shape, `<yk-chart type="lines">`. In compare mode it requests the current window and `previousWindow(scope)` and renders two named series in one chart, current first. `win=all` with `cmp=period` is `unsupported` with “Choose a finite period to compare periods.” and no request for a previous window.
- `trend-multiples.js`: same query, but one chart per split value (small multiples). Use `top` so the chart count is bounded by the published `top_max`, label the remainder as omitted from the returned top groups, and keep one table per chart. Compare + split is small multiples, never one overlaid chart.
- `rhythm.js`: `/query` `measure=hook_events`, `dims=weekday&hour_of_day`, `bucket=none`; feed `<yk-matrix type="heatmap">` rows `{key,row,column,x,values:{hook_events}}`. Keep the unit and the “shared entity key marks every cell” note visible.
- `calendar`: reuse the registered Phase 9 panel by id; do not fork it. The Trends preset names it; it is already schema-driven and chooses its own measure.
- Register the five-panel `trends` preset with these panel ids and canonical preset specs: a measure chosen from the schema (default `cost_usd`), split `model` for columns/lines/multiples, `hook_events` for rhythm. The preset must not name an unregistered panel.

### Compare

- `dist-ranges.js`: `/distribution?measure=<cost_usd|tokens_in|tokens_out|tokens_cache_read|tokens_cache_write|tokens_reasoning>&grain=call|conversation&dim=<model|harness|session_model|session_repo>`; map each row to a box row with min/q1/median/q3/max/p95 and n. Pass `spec.legend='entities'` and, when a scorer baseline exists, `spec.baseline`. In compare mode render one row per group for the current and previous period, labelled with the period, so both populations are visible; never show only the difference. Show `unpriced`, `omitted_groups`/`omitted_n` and the population unit.
- `dist-hist.js`: use the distribution `bins` of the first group as the fixed `spec.bins`; one chart per group in single mode; current and previous side by side in compare mode. A zero-filled bin is the server's count, never an invented count for a null score.
- `dist-ecdf.js`: build ECDF series from the same distribution bins (cumulative count / n per group); one `<yk-chart type="ecdf">` with one series per group, and current/previous as two series in compare mode. Keep n and the highest bin's edge visible.
- `rank.js`: `/query` `bucket=none` with the chosen measure and split. Single mode is `<yk-bars type="ranked">`. Compare mode is `<yk-bars type="slope" deltaRamp>` with exactly two named series (current, previous) and `spec.deltaRamp`; more than two periods or a missing previous period is `unsupported`, not an invented baseline.
- Register the five-panel `compare` preset. Its preset specs carry `scope: { cmp: 'period' }` for each compare-sensitive panel, so `/b/compare` compares without requiring a URL edit; a per-panel URL spec can still override it. Do not set `cmp` at board level.

### Fixture and tests

- Extend `tests/workspace/fixture.mjs` with a `p10Schema()` and `p10Fixture()` set that cover the time/session/artifact lenses and comparisons without changing the default `makeSchema()`/`summary()` values the Phase 9 specs pin. Add `tests/workspace/stub-api.mjs` support for a `p10` state flag: when true it serves deterministic `/query`, `/distribution`, `/scores`, `/score-series`, `/baselines`, `/entities`, `/summary` and `/schema` bodies from that fixture for every supported measure/lens/bucket; when false the current responses stay byte-identical. Add a per-request URL log to the stub state (test-only) so 10-05 can prove `cohort=` forwarding.
- Add `tests/trends-quality/browser.mjs` re-exporting the existing loader and skip reason; `tests/trends-quality/fixture.mjs` with the deterministic rows (several models/harnesses/session models/repos, priced/unpriced and all-unpriced groups, `(mixed)`/`(none)`/`(multi)`, long history with pre-epoch and multi-century bounds, scored/unscored artifacts).
- `trends.test.mjs`: pure checks for the chooser/primitives, registrations and preset data; Chromium checks for `/b/trends` (five frames settle; choose cost→commits and model→harness and columns→lines; surviving series keep their colour; brush/zoom writes absolute `from`/`to` and reload/Back preserve the dates; auto bucket/coarsening and table values match the fixture; no console/page/CSP error; ≤4 in flight).
- `compare.test.mjs`: Chromium checks for `/b/compare` (both period populations and n/coverage are present, not one delta; slope has one up and one down segment with distinct diverging tokens and `data-delta`; `win=all&cmp=period` shows the existing finite-period copy and issues no previous-window request; the ECDF/hist/range tables match the fixture; the box legend names groups, not summaries).
- Run `node --test tests/workspace/*.test.mjs` before and after; the Phase 9 suite must stay green.

### Keep untouched

- The Phase 9 Pulse panel ids, preset, routes, Start paths, chips/tray grammar, inspector action set and frame state names.
- `pulse-strips.js`, `movers.js`, `calendar.js`, `river.js`, `coverage.js`, `ledger*`, `ops*` behaviour. Calendar is reused by id, not edited.
- The chart kit's existing defaults: no option absent from a spec may change a current element's legend, colour, marks or `inspect()` shape.
- No new server route, grain, join, dependency, gesture or contract; do not edit Go files.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test tests/trends-quality/trends.test.mjs tests/trends-quality/compare.test.mjs` (workdir `packages/yakka-analytics`) → all pass, including the Chromium cases above; a missing playwright-core/Chromium skips with the named reason, never passes silently.
- The same run proves: choose changes regroup the preset and surviving styles are stable; long-history auto resolution and zoom preserve dates; compare shows both populations; the diverging slope is browser-visible; table values equal the committed fixture; `git diff --check` clean.
- `NODE_PATH=… node --test tests/workspace/*.test.mjs` → the Phase 9 suite stays green (86/86 at the closing tree).
- `node --test tests/charts-cat/*.test.mjs` → existing element tests stay green with the two opt-in seams absent.
- The report records the exact before/after outputs, the files read/changed, the fixture counts used, and any deviation from this brief and why.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
