# 7-02 — Time-series uPlot element

Status: done.

## What changed

- `web/js/charts/series.js` — mode transforms for absolute, cumulative and
  share (per-bucket ratios), plus stacked-column cumulative tops. Series order
  and keys stay stable; a missing point stays `null` and is never carried
  forward or turned into zero. Stacked columns keep slice values in the table
  while the plot uses cumulative tops.
- `web/js/charts/scales.js` — time or numeric x scale, exactly one y scale,
  scale-group key from `spec.scaleGroup`, zero-based y range for columns, and
  the plot-relative pixel/data conversions used by `inspect()`.
- `web/js/charts/thresholds.js` — spec threshold lines and bands with label,
  tone and unit; a uPlot draw hook paints them in the plot frame; the same
  model is listed in a `tfoot` appended to the 7-01 table element. No
  interaction and no selectable mark.
- `web/js/charts/yk-chart.js` — the `<yk-chart>` custom element: Shadow DOM,
  cached 7-01 stylesheet plus uPlot CSS, observed `spec`/`data` properties,
  `ResizeObserver` → `setSize`, one y scale, frame units/time basis,
  7-01 legend/table/tooltip/badges, thresholds, `data-chart`/`data-state`,
  `inspect()`, and `select`/`inspect`/`brush` events. States are `loading`,
  `ready`, `empty` (with the producing filter/selection) and `unsupported`
  (with the reason). Colours are re-read from CSS custom properties on theme
  change; a minimal `:host { display: block }` constructable sheet fixes host
  layout without editing 7-01's `charts.css`.
- `tests/gallery/time-series.html` + `time-series.js` — external modules only,
  deterministic 60-day fixture data, and cases for line, area, stacked
  columns, cumulative, share, two charts in one scale group, thresholds,
  empty and unsupported.
- `tests/charts-time/time-series.test.mjs` — pure transform/scale/threshold
  checks plus a Chromium spec driven by `inspect()` coordinates; it waits on
  `data-idle`/`data-state` and uses real mouse moves, never a sleep.

The 7-01 modules were imported only; their contracts are unchanged.

## Check output

Before:

```
$ node --test packages/yakka-analytics/tests/charts-time/time-series.test.mjs
Could not find 'tests/charts-time/time-series.test.mjs'
$ git cat-file -e HEAD:packages/yakka-analytics/tests/charts-time/time-series.test.mjs
fatal: path '...time-series.test.mjs' does not exist in 'HEAD'
```

After:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-time/time-series.test.mjs
# tests 9
# pass 9
# fail 0

$ node --test packages/yakka-analytics/tests/*.test.mjs
# tests 12
# pass 12
# fail 0

$ node --test packages/yakka-analytics/tests/charts-time/foundations.test.mjs
# tests 8
# pass 8
# fail 0
```

The browser spec ran (playwright-core 1.63.0 and Chromium 1243 were present),
so there is no browser gate. It proves: line/area/stacked-columns/cumulative/
share table values and `inspect().mode`/`type`; columns zero-based; one y scale
per chart and no dual axis (two measures are two linked charts); working
`xToPx`/`yToPx`, window, bucket, visible series, plot rectangle, marks and a
cursor that changes after a real mouse move; same-group cursor sync in both
directions and no sync outside the group; a drawn threshold present in the
table with no selectable mark; `ready`/`empty`/`unsupported`; no animation; no
console error, page error or CSP violation.

## Deviations and interpretations

- uPlot 1.6.32 takes bands as `{ series: [from, to] }`, not `{ from, to }`;
  `series.js` emits that shape. The visible stack still follows series order.
- For stacked columns the table shows each segment's value (the plotted slice),
  not its cumulative top; the plot data holds the tops the stack needs. For
  cumulative and share modes the table shows the transformed values.
- Share values are ratios (0–1) with an effective `percent` series kind, so the
  existing formatter and table render `25%` without a second formatting path.
- Thresholds are listed in a `tfoot` appended to the table element returned by
  7-01's `createTable`, because editing `table.js` is outside this unit. The
  draw hook also records the threshold count on the uPlot root as product
  metadata, not a test-only branch.
- `select` is emitted from the plot overlay click, `brush` from uPlot's
  `setSelect`; drag zoom is disabled (`setScale: false`) because 7-03 owns the
  gesture grammar. No other gesture is added.
- A theme change re-renders the element, which re-reads the CSS custom
  properties, rather than recolouring in place.

## Contradictions

None found between this brief and CONTRACTS.md 17.5/17.7 or DESIGN.md.

## Unfinished / known problems

None in this unit. Gestures (7-03), scatter/ECDF (7-04) and the gallery index
and acceptance proof (7-05) are out of scope and untouched.
