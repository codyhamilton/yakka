# Brief: 7-04 — Numeric scatter, ECDF and hit-test reference

Consumer: the Phase 7 chart-kit worker; 7-05 proves the combined gallery.
Owned paths: `packages/yakka-analytics/web/js/charts/{scatter,canvas-scatter,ecdf,hit-test}.js`, `packages/yakka-analytics/web/js/charts/yk-chart.js` (the scatter/ECDF dispatch seam only), `packages/yakka-analytics/tests/gallery/{scatter.html,scatter.js}`, `packages/yakka-analytics/tests/charts-time/scatter.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/7-04-scatter-ecdf.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 7-03.
Runs alongside: nothing; it shares the `<yk-chart>` gesture and dispatch surfaces.
Budget: 12 files to read, about 1,000 lines to change, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements" (numeric-x scatter with point colour, shape and size; ECDF step lines), "Scatter" (two-dimensional nearest-point hover and rectangle selection over `budgets.scatter_points`, built on uPlot's hooks; first-party canvas fallback if uPlot cannot carry it; no second library), "Testability surface".
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 7 outcome; Interaction model (four distinct things, Gestures drag-on-a-time-axis and drag-on-a-scatter rows, Linking); Chart kit.
3. `packages/yakka/internal/serve/analytics_query.go` near the budgets map — `scatter_points` is 5,000; do not change it.
4. `docs/plans/20-analytics-reset/charting-research.md` — uPlot interactivity matrix, "Brush / range select", "Primary: uPlot"; the declared fallback is first-party canvas, not ECharts.
5. `packages/yakka-analytics/web/js/charts/yk-chart.js`, `gestures.js`, `selection.js`, `scales.js` from 7-02/7-03, and `tests/gallery/fixture.js` from 7-01.

Read ranges and grep; do not re-read a file already in context.

## Goal

Add numeric-x scatter with two-dimensional nearest-point hover and rectangle selection, plus ECDF step lines, to `<yk-chart>` — using uPlot's hooks where they carry the 2-D work and the declared first-party canvas fallback where they do not — and prove hit-testing and rectangle membership against an independent reference at the 5,000-point budget.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-chart>` includes numeric-x scatter with point colour, shape and size, and ECDF step lines, taking the same `spec`/`data`, emitting `select`/`inspect`/`brush`, and exposing `inspect()`.
- CONTRACTS.md 17.5 "Scatter": two-dimensional nearest-point hover and rectangle selection over up to `budgets.scatter_points` points, built on uPlot's hooks. If uPlot as published cannot carry 2-D hit-testing and rectangle brushing at that size, the fallback is a first-party canvas scatter element behind the same element contract; no second library is added. The server budget is 5,000 (`serve/analytics_query.go:74`); do not invent a different cap.
- DESIGN.md Interaction model: a numeric scatter rectangle denotes every eligible entity in the region, including unsampled ones; sampled marks are labelled separately and never define membership. A rectangle is an entity predicate over the two axes; Alt-drag subtracts. This phase emits that predicate and state; the tray and population query are later phases.
- CONTRACTS.md 17.5 "Testability surface" and 17.7: tests drive real events at `inspect()` coordinates, wait on `data-idle`/`data-state`, never sleep, and fail on console/CSP errors. No animation.
- No new dependency, route, measure, join or gesture; uPlot 1.6.32 remains the sole runtime dependency.

## Changes

- `hit-test.js`: nearest-point and rectangle-membership logic at pixel/data coordinates, with a stable tie-break by entity key; usable by either the uPlot-hook path or the canvas fallback. Do not expose a test-only branch.
- `scatter.js`: scatter spec (numeric x/y, entity keys, colour slot, shape, size, sampled flag) and the uPlot-hook attempt: nearest point on cursor, rectangle drag, union/subtraction, point drawing. If the hooks cannot carry 2-D hit-testing or rectangle brushing at 5,000 points, stop using them and use the fallback.
- `canvas-scatter.js`: the declared first-party Canvas 2D fallback behind the same element contract (same `spec`/`data`, `inspect()`, events, colours from CSS custom properties). No new library, no per-point DOM.
- `ecdf.js`: ECDF step-line mode over a numeric x domain, sorted points, optional cohort/lens series, step rendering and table values.
- `yk-chart.js`: dispatch `chart: 'scatter'` and `chart: 'ecdf'` to these modules while leaving 7-02/7-03 line/area/column, threshold, table, tooltip, legend, gesture and `inspect()` behaviour intact.
- Gallery: `scatter.html`/`scatter.js` with deterministic 5,000-point data from `tests/gallery/fixture.js`, sampled and unsampled cases, colour/shape/size, rectangle union/subtraction and an ECDF case.
- `tests/charts-time/scatter.test.mjs`: independent reference (a plain linear scan written in the spec, importing neither `hit-test.js` nor the production index) for nearest point and rectangle membership at 5,000 points; real mouse drag/hover; duplicate-key cases; `inspect()` assertions.

### Keep untouched

Do not add a second charting library, a component framework, a build step, or a server route. Do not implement the tray, exact population count, cross-grain requery or sample identity inference. Do not edit the 7-01 foundations, 7-03 gestures or selection modules except to call them; if a contract is insufficient, stop and report it. Do not edit `web/index.html`, `web/js/app.js`, `web/contract/url-state.js`, the vendored uPlot files, Go code or the 5,000 budget.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test packages/yakka-analytics/tests/charts-time/scatter.test.mjs` → passes, or skips with the exact named browser reason.
- Scatter render → 5,000 points render with colour, shape and size from the spec; sampled marks are distinguishable and `inspect().marks` exposes the sampled flag; no per-point DOM is required.
- Nearest-point hover → a real mouse move at `xToPx`/`yToPx` coordinates selects the same mark as the independent linear-scan reference, including a tie case.
- Rectangle membership → a real drag selects exactly the keys the independent reference reports; Shift/Ctrl adds and Alt subtracts; `inspect().selection` and the `select` event carry the predicate.
- ECDF → step-line values and table values match the sorted input, monotonic and labelled.
- Fallback decision → the report states whether uPlot's hooks carried the 2-D work or the canvas fallback was used, with the evidence; both satisfy the same element contract and no dependency was added.
- `node --test packages/yakka-analytics/tests/*.test.mjs` → the earlier suite and 7-01 to 7-03 checks still pass; no `console.error`, page error or CSP violation; no animation.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, the fallback decision with evidence, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
