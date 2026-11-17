# Brief: 8-03 — Matrix heatmap and calendar

Consumer: the Phase 8 chart-kit worker; 8-05 proves the combined gallery.
Owned paths: `packages/yakka-analytics/web/js/charts/yk-matrix.js`, `packages/yakka-analytics/tests/gallery/{matrix.html,matrix.js,fixture-matrix.js}`, `packages/yakka-analytics/tests/charts-cat/matrix.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/8-03-matrix.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 8-01.
Runs alongside: 8-02 and 8-04; each owns a disjoint element, gallery page, fixture and spec.
Budget: 10 files to read, about 700 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements" for `<yk-matrix>` (heatmap, calendar; same `spec`/`data`, events and `inspect()`), "Colour registry" (the sequential and diverging ramps), "Rules from the dataviz discipline", "Testability surface".
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 8 outcome; Interaction model Gestures table (drag on a time axis, keyboard `[` `]`, touch Select mode), Accessibility and responsiveness baseline; Chart kit; the `calendar` and `rhythm` catalog entries.
3. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.7 — the Chromium, settled-state, no-sleep, console/CSP and in-flight rules.
4. `packages/yakka-analytics/web/js/charts/svg-base.js` and `yk-bars.js` from 8-01 — the shared element lifecycle, optional brush wiring, `inspect()` shape and mark model. Import the base; do not edit it.
5. `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,selection}.js` — exports only; the sequential/diverging tokens are in `charts.css`.
6. `packages/yakka-analytics/tests/gallery/{harness.mjs,fixture.js,bars.html,bars.js}` and `packages/yakka-analytics/tests/charts-cat/{browser.mjs,bars.test.mjs}` — the settled-page and spec patterns.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Deliver `<yk-matrix>` for a categorical heatmap and a day-by-week calendar, with a labelled sequential ramp, inspect/selection and a keyboard/touch-operable table, and with the calendar brushing its time axis through the shared wiring.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-matrix>` covers heatmap and calendar; it takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush`, and exposes `inspect()`.
- CONTRACTS.md 17.5 "Colour registry": the sequential ramp is for ordered values; the diverging ramp is for deltas. A ramp is not an entity slot, and a value change never repaints an entity slot.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline" and DESIGN.md Accessibility baseline: units and time basis in the frame, a table showing plotted values, colour never alone (each cell carries a label/value and the ramp is labelled), no animation, both colour schemes and reduced motion honoured.
- DESIGN.md Interaction model: hover/focus highlights the cell's key; click/Enter inspects; Space and the row checkbox select; Alt-click and `x` exclude; `o`/`f`/`c` then `a`–`d`/Esc emit their intents. Calendar drag on the time axis emits `brush`; `[` `]` move a brush edge; touch Select mode turns a drag into the same brush; tap inspects. Heatmap has no continuous axis, so it reports `brush: null` and emits no brush.
- CONTRACTS.md 17.7: real Chromium events at `inspect()` coordinates; no fixed sleeps; no animation; no `/tmp`; tests are not shipped; nothing branches on being under test.
- Settled: SVG with the shared tooltip, legend and registry; no new dependency, route, grain, join, measure or gesture; no palette change.

## Changes

- `yk-matrix.js`: `<yk-matrix>` with `spec.chart = 'matrix'` and `spec.type` `heatmap` or `calendar`.
  - Data rows are `{ key, row, column, x?, values: { <measure>: number }, n?, coverage? }`; `spec` is `{ chart, type, title, units, rows: [{ key, label }], columns: [{ key, label }], x?: { label, kind }, series: [{ key, label, unit, kind }], ramp: 'sequential' | 'diverging', timeBasis?, coverage?, sample?, resolution?, empty?, unsupported? }`.
  - `heatmap`: row × column cells on the categorical grid; fill from the named ramp; a labelled ramp legend with its stop values; no brush.
  - `calendar`: day cells laid out by week and weekday with a real time x axis; fill from the same ramp; a drag over days emits `brush { from, to, aligned: true }` and `inspect().brush`; `[` `]` move an edge; Esc clears selection before brush.
  - Every cell carries `data-entity-key` and the 8-01 mark shape; the table shows row, column, value and unit.
- `matrix.html`/`matrix.js`/`fixture-matrix.js`: deterministic test-only data for both modes, using the shared entity keys (`model:atlas`, `harness:orca`, `repo:core`, `kind:test`); external modules only; settle every element, then set `data-idle`.
- `tests/charts-cat/matrix.test.mjs`: pure checks for row/column mapping, ramp stop selection, calendar day-to-week layout and brush range conversion, plus a Chromium spec driving real mouse, keyboard and touch at `inspect()` coordinates.

### Keep untouched

Do not edit `svg-base.js`, `yk-bars.js`, `yk-chart.js` or any Phase 7 module; if the shared base cannot carry this element, report it rather than editing the foundation. Do not edit `tests/gallery/index.html`/`index.js`, another unit's page, fixture or spec, the harness, the vendored uPlot files, Go code, or the stale `tests/e2e*`, `tests/hosted` and `tests/identity` trees. Add no dependency, route, panel, grain, join, gesture or sample data to the product; no `/tmp`; no animation or fixed sleep.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/matrix.test.mjs` → passes, or skips with the exact named browser reason.
- Heatmap → table and `inspect()` values match `fixture-matrix.js`; the ramp legend is labelled with its stops; cells expose row, column, value and key; `inspect().brush` is `null` and no brush event fires.
- Calendar → day cells map to the fixture dates; a real drag on the time axis emits `brush` with finite `from`/`to`/`aligned:true` and `inspect().brush` reflects it; Esc clears the brush; `[` and `]` move an edge.
- Real interaction → hover/focus highlights the cell key; click/Enter emits `inspect`; Space/checkbox selects; Alt-click/`x` excludes; `o`/`f`/`c` then `a`–`d` emit their intents; touch tap inspects at a target of at least 44 px and Select-mode drag brushes the calendar.
- Table → keyboard operable (ArrowUp/ArrowDown, Space, Enter), unit-labelled, with row and column names.
- Both themes → the same entity keeps its slot and the ramp re-reads from tokens; no animation; no `console.error`, page error or CSP violation; at most four analytics requests in flight.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs` → the accumulated Phase 8 specs all pass.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, how the calendar brush uses the 8-01 wiring, any shared-base assumption that did not hold, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
