# 8-04 — Timeline and gantt lanes

Status: `over budget` (deliverable complete; this unit's checks pass).

## Budget

About 1,241 changed lines across the five owned files (brief: ~750) and more
than the ten listed files read, because the required reading names the base,
the bars element, the gallery/harness pattern and every shared module export.
No product scope was added. The overrun is the element plus one Chromium spec.

## What changed

- `web/js/charts/yk-lanes.js` — `<yk-lanes>` for `timeline` and `gantt`:
  `createTimeScale` (linear, invertible `xToPx`/`xToData`), `formatLaneTime`,
  `toTime`, `buildLanesModel` and the element. Markers sit at `at`; gantt spans
  at `start`/`end`; overlapping spans in one lane are packed into sub-rows.
  Markers are a fixed 12 px shape, coloured and patterned from the registry by
  `kind` (never by the entity key), with a 44 px hit target. `priced:false` is
  hollow, named `unpriced` in the aria label and table, and never `$0`. The
  table lists time or start/end, lane, kind and a unit-carrying value for every
  plotted mark. The legend is the kinds when there are two or more. Brush uses
  the 8-01 wiring: `supportsBrush()` is true, drags call `setBrush({from,to,
  aligned:true})`, `[`/`]` move an edge, Esc is the base's clear; `inspect()`
  reports `brush`. A `Select` button (44 px) switches plot drags to brushing.
- `tests/gallery/{lanes.html,lanes.js,fixture-lanes.js}` — deterministic
  timeline and gantt data with `model:atlas`, `harness:orca`, `repo:core`,
  `kind:test`, one priced and one unpriced call, and overlapping gantt spans.
  External modules only; settles every element, then sets `data-idle`.
- `tests/charts-cat/lanes.test.mjs` — five pure model checks (mapping, timeline
  shape, gantt spans/packing, colour-by-kind, priced/unpriced) and one Chromium
  spec driving real mouse, keyboard and touch at `inspect()` coordinates.

## Check output

Before: the spec did not exist, so the brief's command reported
`Could not find 'packages/yakka-analytics/tests/charts-cat/lanes.test.mjs'`.

After, this unit:

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-cat/lanes.test.mjs
# tests 6
# pass 6
# fail 0
```

After, accumulated Phase 8 (max 3 workers, `PUBLIC_CANVAS_TEST_MODE=true`):

```
$ node --test --test-concurrency=3 packages/yakka-analytics/tests/charts-cat/*.test.mjs
# tests 25
# pass 24
# fail 1
```

The one failure is 8-02's `ranges.test.mjs:296`, not this unit: its Chromium
spec gets `cursor: null` instead of `repo:core` on a hover at `inspect()`
coordinates. It fails identically when that spec runs alone, so it is not
caused by the parallel lanes run. This unit's six checks and all eight bars
checks pass. Chromium 1243 and playwright-core 1.63.0 were present; no browser
gate.

The lanes Chromium spec proves: both modes ready; timeline marks at the fixture
times in the right lanes with fixed-size markers; gantt start/end widths and
lane assignment with overlapping spans on distinct rows; every table row and
unit; a real axis drag emitting finite `from`<`to`/`aligned:true` and
`inspect().brush`; `]` widening and `[` moving an edge; Esc clearing; touch
Select-mode drag brushing; hover/focus highlight and tooltip key; click/Enter
inspect; Space/checkbox select; Alt-click and `x` exclude; `o`/`f`/`c`+`a`
intents; touch tap inspecting a ≥44 px target; keyboard-operable table;
hollow/named unpriced mark; legend toggle by kind with no request and an
unchanged survivor slot; both themes keeping the slot/pattern while the token
value changes; no animation; no console/page/CSP error; ≤4 requests in flight.

## How the brush uses the 8-01 wiring

`supportsBrush()` returns true, so `inspect()` reports `brush`. Every committed
drag calls the inherited `setBrush({from,to,aligned:true})`, which stores the
value and emits `brush`; the base owns Esc's clear. `[`/`]` re-call `setBrush()`
with one edge moved 2% of the window. The element listens to its own `brush`
event only to repaint the selection band.

## Deviations and interpretations

- `spec.lanes` (and `spec.data.lanes`) carries the lane list; the shared `data`
  setter only accepts arrays, so the array is the item list. This is the
  brief's "in the spec or `data.lanes`" read against the base.
- Timeline and gantt kinds are registry keys (`kind:test`, `kind:call`, …), so
  colour and shape are stable by kind and the legend groups by kind.
- The shared `[data-shape]` swatch CSS rotates (`diamond`) and clips
  (`triangle`, `star`, …) any node it matches, including a plotted `<g>`. Each
  lanes mark group opts out locally with `transform:none; clip-path:none` so a
  span or marker keeps its geometry.
- The shared base listens for its keyboard grammar on the chart root while the
  shared table listens on the row, so Space/Enter/arrows acted twice. Lane
  table rows stop propagation after the table handles those keys. The shared
  base was not edited.
- Touch drags are handled as `touchstart/move/end` because Chromium delivered
  one `pointermove` and no `pointerup` for a CDP touch drag; pointer events
  remain the mouse path.
- The table uses text columns for time/end/lane/kind/value so a value can carry
  its unit in the cell (the base table has one formatted x column).

## Contradictions

None between this brief and CONTRACTS.md 17.5/17.7 or DESIGN.md. The one
shared-base assumption that did not hold is above: `data` is an array in
`svg-base.js`, not an object with `lanes`.

## Unfinished / known problems

- 8-02's `ranges.test.mjs` Chromium hover check fails (see above); it is outside
  this unit's owned paths and was not touched.
- Shared bug outside this unit's evidence: the global swatch selectors
  `[data-shape='diamond'|'triangle'|…]` in `web/css/charts.css:258-265` apply to
  every `[data-shape]` group. `<yk-bars>` sets `data-shape` on its mark groups
  (`yk-bars.js:235,296,375`), so a diamond-shaped bar group is rotated 45° and
  triangle/star groups are clipped. Root cause: selectors meant for `.yk-swatch`
  are not scoped to it. Not fixed here.
