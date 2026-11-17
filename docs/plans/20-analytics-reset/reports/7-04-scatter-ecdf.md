# 7-04 — Numeric scatter, ECDF and hit-test reference

Status: done.

## What changed

- `web/js/charts/hit-test.js` — pure 2-D nearest-point and inclusive
  rectangle-membership functions. They accept either data-space points with a
  caller projection or already-projected `{px,py}` marks. Nearest ties break by
  entity key then input order; membership is deduplicated and key-sorted.
- `web/js/charts/scatter.js` — scatter spec normalisation (numeric x/y, entity
  keys, colour field, shape field, numeric size field, sampled flag), extent,
  layout, projection, data/pixel conversion, named-shape mark drawing and the
  recorded uPlot-hook assessment.
- `web/js/charts/canvas-scatter.js` — the declared first-party Canvas 2D
  fallback: one base canvas for axes and all marks, one overlay for hover and
  rectangle feedback, real pointer/keyboard events, no per-point DOM. It keeps
  colours from CSS custom properties (read by the element), renders sampled
  marks hollow and exposes marks through the element.
- `web/js/charts/ecdf.js` — ECDF model: per-cohort/lens sorted samples, the
  union x grid, monotonic fraction values used by both the plot and the table,
  labelled percent series.
- `web/js/charts/yk-chart.js` — dispatches `chart/type: 'scatter'` to the
  canvas element and `ecdf` to the uPlot stepped path, with legend, table,
  tooltip, events, `inspect()`, URL selection state and highlight wiring. The
  7-02/7-03 line/area/column, threshold, table, tooltip, legend, gesture and
  `inspect()` paths are unchanged.
- `tests/gallery/scatter.html` + `scatter.js` — a 5,000-point scatter, a
  sampled-only scatter with a sample badge, and a two-cohort ECDF, all from
  `fixture.js` with deterministic shape/size assignment.
- `tests/charts-time/scatter.test.mjs` — independent linear-scan references for
  nearest point and rectangle membership, real mouse hover/drag at `inspect()`
  coordinates, tie and duplicate-key cases, ECDF value/table checks, and
  no-console/CSP/no-animation/in-flight assertions.

## Fallback decision

**The canvas fallback was used.** uPlot 1.6.32 as published cannot carry the
2-D work:

- its cursor index is one-dimensional, `idx = cursor.idx =
  closestIdx(valAtPosX, data[0], i0, i1)` from the x scale
  (`web/vendor/uplot-1.6.32/uPlot.esm.js:5353`), so a pointer cannot resolve
  nearest in both axes;
- series marks are configured per series: `points.size`, `points.stroke` and
  `points.fill` are single defaults (`uPlot.esm.js:3639-3657`), so per-point
  colour, shape and size at 5,000 points is not expressible;
- its built-in drag/select is a scale range, and 7-03 already owns the overlay
  pointer grammar.

`canvas-scatter.js` therefore sits behind the same `<yk-chart>` contract
(`spec`/`data`, `select`/`inspect`/`brush` surface, `inspect()`, table, legend,
tooltip, CSS-variable colours). No dependency was added; uPlot remains the only
runtime dependency and still draws the ECDF step lines.

## Check output

Before: the scatter spec did not exist, so
`node --test packages/yakka-analytics/tests/charts-time/scatter.test.mjs`
reported that the test file could not be found. The integration also exposed a
real coordinate bug during development: the canvas hit-test compared
canvas-absolute mark pixels with plot-local pointer coordinates, so hover
selected the wrong mark. Fixed by translating the pointer into the projected
mark space; the independent reference is what caught it, and no assertion was
weakened.

After:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-time/scatter.test.mjs
# tests 2 / pass 2 / fail 0

$ NODE_PATH=... node --test \
  packages/yakka-analytics/tests/charts-time/{foundations,time-series,gestures,scatter}.test.mjs
# tests 23 / pass 23 / fail 0

$ node --test packages/yakka-analytics/tests/*.test.mjs
# tests 12 / pass 12 / fail 0
```

Browser acceptance ran on playwright-core 1.63.0 and the Chromium 1243 cache;
there is no browser gate. It proves: 5,000 marks render on canvases with
spec-driven colour/shape/size, sampled marks flagged and distinguishable, no
per-point DOM; a real hover selects the same mark as the independent linear
scan; a real rectangle drag selects exactly the reference keys; Shift-drag adds
and Alt-drag subtracts; the `select` detail and `inspect().selection` carry the
`where` rectangle plus include/exclude; duplicate keys collapse to one predicate
member; ECDF marks and table values match the sorted input, are monotonic and
end at 100%; no console error, page error, CSP violation, animation or >4
in-flight request.

## Deviations and interpretations

- The fallback is the contract's declared option, not an extra deviation; the
  attempt and evidence are above.
- The scatter predicate extends 7-03's `{kind, include, exclude}` with `where:
  {x:{min,max}, y:{min,max}}` in data space, because DESIGN.md defines a
  rectangle as an entity predicate over the two axes. `selection.js` was not
  edited; the element composes its predicate from `selectionPredicate()`.
- Additive rectangles accumulate membership in `include`, but `where` records
  only the most recent rectangle. The keys are the authoritative Boolean
  predicate; a future tray that needs the union geometry should read an array,
  which is not invented here.
- The ECDF uses uPlot's published `paths.stepped({align:1})` for the step
  stroke; the values and table are first-party in `ecdf.js`.
- Scatter adds keyboard arrows on the overlay (same mark inspection) for focus
  parity with the other elements; no new gesture contract is introduced.
- The test's independent reference scans the documented `inspect().marks`
  pixel coordinates rather than reading raw data, so it is independent of
  `hit-test.js` and the scatter modules but still exercises the public surface.

## Contradictions

None found between this brief, CONTRACTS.md 17.5 (Elements, Scatter,
Testability surface), 17.7 and DESIGN.md Interaction model/Chart kit. The 5,000
`scatter_points` budget was read, not changed.

## Unfinished / known problems

- The tray, exact population count, cross-grain requery and sample identity
  inference remain later phases; the rectangle emits keys plus a region only.
- The time-grain scatter axes (`/entities?grain=time`) are not wired in this
  unit; the element accepts any numeric x/y rows.
- The gallery index and full phase acceptance matrix are 7-05.
