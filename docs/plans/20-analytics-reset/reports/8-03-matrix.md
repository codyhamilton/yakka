# 8-03 — Matrix heatmap and calendar

Status: **over budget** (deliverable complete and all owned done evidence passes; budget exceeded — 1,110 changed lines against about 700, and more than 10 files read / 40 tool turns).

## What changed

- `packages/yakka-analytics/web/js/charts/yk-matrix.js`: `<yk-matrix>` for `spec.type` `heatmap` and `calendar`, built on the 8-01 `SvgChartElement`. Pure exports `dayStart`, `weekdayIndex`, `weekStart`, `rampStops`, `rampStopValues`, `rampIndex`, `valueRange`, `snapBrush`, `moveBrushEdge`, `calendarLayout`, `buildMatrixModel`. Heatmap is row × column cells on the registry mark model, fill from the named sequential/diverging ramp, value text in every cell, and a labelled five-stop ramp legend. Calendar lays day cells out by week column and weekday row over a real week time domain; drag calls the base `setBrush`, `[`/`]` move an edge, `Esc` clears selection then brush through the base, and a `Select` button turns touch drag into the same brush.
- `tests/gallery/{matrix.html,matrix.js,fixture-matrix.js}`: deterministic fixture using `model:atlas`, `harness:orca`, `repo:core`, `kind:test`; heatmap, calendar, empty and unsupported elements; event log and per-chart brush counts; settles every element then sets `data-idle`.
- `tests/charts-cat/matrix.test.mjs`: pure row/column mapping, ramp selection, day-to-week layout and brush conversion checks, plus the Chromium spec.

## Check before and after

- Before (at HEAD): `git cat-file -e HEAD:packages/yakka-analytics/web/js/charts/yk-matrix.js` → exit 128 (not in HEAD); same for the spec. There was no matrix element or spec to pass.
- After: `NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test --test-concurrency=3 packages/yakka-analytics/tests/charts-cat/matrix.test.mjs` → 5/5 pass (4 pure + 1 Chromium, no skip).
- Accumulated: same command over `packages/yakka-analytics/tests/charts-cat/*.test.mjs` → 23/25. Bars 8/8 and matrix 5/5 pass; `lanes.test.mjs` #14 and `ranges.test.mjs` #25 fail. Both files are untracked sibling-unit work in the shared worktree, outside this unit's owned paths; I did not edit them. So the brief's "accumulated Phase 8 specs all pass" is not demonstrable from this unit while 8-02/8-04 are mid-flight.
- `git diff --check` clean. No `/tmp`, dependency, package file, deploy, Fly/Wrangler or credential use.

## How the calendar brush uses the 8-01 wiring

`supportsBrush()` returns true only for `calendar`. Pointer drag converts the axis pixel through the geometry `xToData`, snaps to whole UTC days with `snapBrush`, then calls the inherited `this.setBrush({ from, to, aligned: true })`. The base stores the brush, emits `brush`, and `inspect().brush` reads it; the base `Escape` clears selection first and then calls its own brush clear. The subclass listens to its own `brush` event to mirror the range for the overlay and for `[`/`]` edge moves. The heatmap leaves `supportsBrush()` false, so `inspect().brush` is `null` and a drag emits no `brush`.

## Shared-base assumptions that did not hold

The base exposes no model/rows accessor and no hook for `[`/`]` or table arrow keys. The element keeps `_matrixModel` for anchor/range and a capture-phase `keydown` listener: table `ArrowUp`/`ArrowDown` move row focus, table `Space` toggles the row checkbox (the base root would otherwise toggle the same selection a second time), and `[`/`]` move a calendar brush edge. No foundation file was edited.

## Deviations and contradictions

- Budget clause says to write a handoff in `IMPLEMENTATION.md`; the brief's Owned paths and the shared-worktree instruction say touch nothing outside owned paths. I did not edit `IMPLEMENTATION.md` and report **over budget** here instead. This contradiction is flagged, not resolved silently.
- Calendar fixture assigns the shared entity keys to day cells cyclically so both modes use the shared keys as the brief requires; each day is still a distinct `x`.
- The calendar uses week columns on a real time domain rather than one column per day; a continuous day axis with weekday rows would not form a week grid. Brush output is day-snapped timestamps.
- The table identifies the unit in the column header rather than the cell because the shared `createTable` formats values without the series unit. Row, column, value and unit are all present.

## Known problems and unfinished work

- Sibling `lanes` and `ranges` browser specs fail in the accumulated run; they are untracked and unowned here. 8-05 must re-run the accumulated suite when all three land.
- Heatmap cells and calendar days share an entity key by design, so selecting/highlighting a key marks every cell for it; the table therefore shows duplicate entity keys.
- The diverging ramp is implemented and pure-tested but no gallery element uses it; only the sequential heatmap is browser-proven.
- No unfinished work in owned paths. 8-05 still owns the gallery index, treemap and phase acceptance.
