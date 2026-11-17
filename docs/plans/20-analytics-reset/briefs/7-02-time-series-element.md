# Brief: 7-02 — Time-series uPlot element

Consumer: the Phase 7 chart-kit worker; 7-03 to 7-05 compose this element.
Owned paths: `packages/yakka-analytics/web/js/charts/{yk-chart,series,scales,thresholds}.js`, `packages/yakka-analytics/tests/gallery/{time-series.html,time-series.js}`, `packages/yakka-analytics/tests/charts-time/time-series.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/7-02-time-series-element.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 7-01.
Runs alongside: nothing; it composes the 7-01 foundations into the shared element.
Budget: 12 files to read, about 900 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements", "Rules from the dataviz discipline" and "Testability surface", quoted.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 7 outcome; Chart kit; Interaction model (Hover or keyboard focus, Legend click, Accessibility); Workspace shell (Panel states, Time basis).
3. `docs/plans/20-analytics-reset/charting-research.md` — "Primary: uPlot", "Shadow-DOM fit", tooltip/brush/click hook notes.
4. `packages/yakka-analytics/web/js/charts/` from 7-01 — registry, formatters, tooltip, legend, badges, table, styles.
5. `packages/yakka-analytics/tests/gallery/harness.mjs`, `tests/charts-time/browser.mjs` and `tests/gallery/fixture.js` from 7-01.

Read ranges and grep; do not re-read a file already in context.

## Goal

Deliver `<yk-chart>` as the one uPlot-backed time-series element: line, area, stacked columns, cumulative and share modes, cursor-synced scale groups, threshold markers, the frame/units/time basis, the accessible table and the `inspect()` testability surface.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-chart>` is a custom element with Shadow DOM and a constructable stylesheet that includes uPlot's CSS; it takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush`, and exposes `inspect()`. Colours come from CSS custom properties so a theme change is a re-read. It is uPlot for lines, area, stacked columns, cumulative and share modes and cursor-synced scale groups; numeric-x scatter and ECDF are 7-04's additions, not here.
- CONTRACTS.md 17.5 "Testability surface": every chart carries `data-chart`, `data-state` and `inspect()` returning window, selection, bucket, series visibility, plot rectangle, `xToPx`/`yToPx`, cursor and marks. Nothing branches on being under test.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline": one y scale per chart (a second measure is another linked chart or a scatter), a legend whenever two or more series, units and time basis in the frame, zero-based columns, a table view, and no animation. Badges are the 7-01 contract, not a new vocabulary.
- DESIGN.md Workspace shell: `data-state` uses `loading`, `ready`, `empty` (says what produced zero), `error`, `unsupported` (with the missing reason); threshold markers are part of this phase's requested chart-kit coverage and introduce no new measure, gesture or contract.
- uPlot 1.6.32 as vendored is the sole runtime dependency; do not change vendor files, add a library, or minify.

## Changes

- `yk-chart.js`: custom element, observed `spec`/`data` properties, Shadow DOM, adopted stylesheet from 7-01's cached loader, `ResizeObserver` calling uPlot's `setSize`, one y scale, frame with units/time basis, legend/table/tooltip composition, threshold rendering, `data-chart` and `data-state`, `inspect()`, and `select`/`inspect`/`brush` events. Set `data-state` to `ready`, `empty` (with the producing filter/selection) or `unsupported` (with its reason).
- `series.js`: mode transforms: absolute, cumulative (running sum) and share (per-bucket 100 percent); stacking for columns; stable series order and keys; do not invent values for missing points beyond what the spec supplies.
- `scales.js`: time x scale, numeric x scale, one y scale, cursor-synced scale groups keyed by a spec string, pixel/data conversions used by `inspect().xToPx`/`yToPx`, and zero-based y for column/stacked modes.
- `thresholds.js`: spec-provided threshold lines/bands with label and tone, drawn in the plot and listed in the table; no interaction is attached to them.
- Gallery: `time-series.html`/`time-series.js` external modules only, deterministic data from `tests/gallery/fixture.js`, cases for line, area, stacked columns, cumulative, share, two charts in one scale group, thresholds and empty/unsupported.
- `tests/charts-time/time-series.test.mjs`: browser spec driven by `inspect()` coordinates; waits on `data-idle`/`data-state`, never sleeps.

### Keep untouched

Do not implement gestures beyond emitting the primitive events (7-03 owns them), scatter/ECDF (7-04), the gallery index (7-05), panels or routes. Do not edit the 7-01 modules except to import them; if a 7-01 contract is insufficient, report a contradiction. Do not edit `web/index.html`, `web/js/app.js`, `web/contract/url-state.js`, the vendored uPlot files or Go code. Do not add a dependency or a product sample-data path.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test packages/yakka-analytics/tests/charts-time/time-series.test.mjs` → passes, or skips with the exact named browser reason.
- Mode checks → line, area, stacked columns, cumulative and share produce the expected table values and `inspect().mode`; stacked columns are zero-based; a second y measure is not drawn on a dual axis.
- `inspect()` check → window, selection, bucket, visible series, plot rectangle, working `xToPx`/`yToPx`, cursor and marks are present and change after a real mouse move.
- Scale-group check → moving the cursor on one chart updates the other chart's `inspect().cursor` when both name the same group, and not when they do not.
- Threshold check → the threshold is drawn in the plot frame and present in the table with its label; it adds no selectable mark.
- State check → `ready` with data, `empty` with a zero-producing filter/selection, and `unsupported` with a reason; no chart animates.
- `node --test packages/yakka-analytics/tests/*.test.mjs` → the earlier suite and 7-01's checks still pass.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
