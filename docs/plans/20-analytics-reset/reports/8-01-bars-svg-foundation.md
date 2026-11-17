# 8-01 — Bars and the shared SVG categorical element foundation

Status: done.

## What changed

- `web/js/charts/svg-base.js` — the shared Phase 8 SVG custom-element base.
  It owns `spec`/`data` setters, `connectedCallback`/`disconnectedCallback`,
  `whenSettled()`, style adoption (cached `charts.css` plus a tiny constructable
  host sheet), `data-chart`/`data-state` (`loading`, `ready`, `empty`,
  `unsupported`, `error`), the ready shell (title, units/time basis, badges,
  legend at two or more series, plot host, accessible table), the colour
  registry, tooltip/`data-entity-key` linking, the Boolean include/exclude
  selection, the keyboard grammar (`arrows`, Enter, Space, `o`, `f`, `x`,
  `c` then `a`–`d`, Esc), 44 px hit targets, `inspect()`, and `select`/`inspect`
  events. Brush wiring is exposed as `setBrush()` but only reported when a
  subclass overrides `supportsBrush()`; `<yk-bars>` reports `brush: null`.
- `web/js/charts/yk-bars.js` — `<yk-bars>` for `ranked`, `stacked`, `percent`,
  `lollipop` and `slope`, plus the pure model helpers (`sortRanked`,
  `applyOther`, `stackSegments`, `percentRows`, `lollipopModel`, `slopePairs`,
  `buildBarsModel`). Ranked sorts by the measure and aggregates the tail into a
  labelled `(other)` row; stacked/percent are zero-based; percent normalises
  each row to 1 and uses the percent kind; lollipop draws a zero-based stem and
  dot; slope pairs one start and one end mark per entity, ordered by change,
  with both values in the tooltip, table and `inspect()`.
- `web/js/charts/formatters.js` — one seam only: `formatValue` gains
  `kind: 'text'` (`return isMissing(value) ? NULL_TEXT : String(value)` inserted
  after the money branch at line 99). No existing kind, money or null rule
  changed.
- `web/css/charts.css` — one categorical section for the SVG plot, axis/grid,
  labels/ticks/values, mark focus/highlight/selected/excluded. No new tokens, no
  transitions or animations.
- `tests/gallery/{bars.html,bars.js,fixture-bars.js}` — external modules only;
  deterministic rows for every mode including `model:atlas`, `harness:orca`,
  `repo:core`, `kind:test` and all six fixed neutral keys; empty/unsupported
  cases; settles every element then sets `data-idle`.
- `tests/charts-cat/browser.mjs` — `export *` from `../charts-time/browser.mjs`
  (same loader, same named skip reason; no duplicate dependency).
- `tests/charts-cat/bars.test.mjs` — seven pure model checks and one Chromium
  spec driving real mouse, keyboard and touch at `inspect()` coordinates.

## Shared `svg-base.js` surface for 8-02 to 8-05

- `class SvgChartElement` (subclass it). Override `buildModel({ spec, data })`
  returning `{ state, reason?, rows, series, tableRows, tableSeries?, x,
  entityKeys?, window?, height?, spec? }`; `renderPlot({ svg, doc, model, spec,
  plot, margin, styleFor, hidden })` returning
  `{ marks, xToPx, yToPx, xToData, yToData, xScale, yScale }` where each mark is
  `{ key, index, x, y, values, px, py, style: { cssVar, shape, pattern }, label?,
  element }`; optionally `supportsBrush()` and `chartType(spec)`.
- Inherited: `setBrush(value)`, `whenSettled()`, `inspect()`, setters, events.
- Exports: `SvgChartElement`, `defineSvgChart(tag, Class)`, `svgNode`,
  `textNode`, `createShape`, `patternId`, `ensurePatternDefs`, `lensFilter`,
  `reasonText`, `DEFAULT_HEIGHT`, `MIN_TOUCH_PX`, `SVG_NS`.

## Check output

Before (the brief's check, no file yet):

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-cat/bars.test.mjs
Could not find 'packages/yakka-analytics/tests/charts-cat/bars.test.mjs'
```

After:

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true \
  node --test --test-concurrency=3 packages/yakka-analytics/tests/charts-cat/*.test.mjs
# tests 8
# pass 8
# fail 0

$ node --test --test-concurrency=3 packages/yakka-analytics/tests/*.test.mjs
# tests 12
# pass 12
# fail 0

$ node --test --test-concurrency=3 packages/yakka-analytics/tests/charts-time/*.test.mjs
# tests 30
# pass 30
# fail 0
```

The Chromium spec ran (playwright-core 1.63.0, Chromium 1243); no browser gate.
It proves: ready/empty/unsupported; ranked table/inspect values including the
`(other)` sum (174 sessions) and sort order; stacked values and zero-based y;
percent shares that sum to 1 and render as `%`; lollipop tip at `xToPx(value)`
and zero at the stem base; slope pairing `[0, 1]` and both table values; six
distinct fixed-neutral `cssVar/shape/pattern/label` combinations with none using
`--yk-neutral-other`; hover/focus highlight and tooltip key; click and Enter
inspect; Space, Shift/Ctrl/Cmd-click and the row checkbox include; Alt-click and
`x` exclude; legend toggle hides a series with no request and an unchanged
survivor style; `o`, `f`, `c`+`a` and Esc intents; a real touch tap at a 44 px
target; both themes keep the slot/pattern while the token value changes; no
animation; no console/page/CSP error; at most four analytics requests in flight;
`git diff --check` clean.

## Deviations and interpretations

- `ranked` and `lollipop` draw the first series (one plotted measure); `slope`
  requires exactly two series and returns `unsupported` with a named reason
  otherwise.
- When the incoming data already has an `(other)` row, the ranked tail is summed
  into that row instead of creating a duplicate key; the generated bucket is used
  only when no `(other)` row exists. `(mixed)`, `(none)`, `(multi)`, `unknown`
  and `unscored` are never folded into it.
- Percent with a zero row total yields zero shares for that row (no division by
  zero); missing components stay `null` and are never drawn as zero.
- The bars legend lists measures, not lens entities. Legend focus therefore
  emits `filter` with `filter: null`/`value: null` (the Phase 7 fallback);
  mapping legend series to contract lens names remains the Phase 9/10 board-chip
  work placed in DESIGN.md.
- `svg-base.js` falls back to an empty base class when `HTMLElement` is absent so
  the pure model tests can import `yk-bars.js` under Node; browser behaviour is
  unchanged and `defineSvgChart` is guarded by `customElements`.

## Contradictions

None found between this brief and CONTRACTS.md 17.5/17.7 or DESIGN.md.

## Unfinished / known problems

None in this unit's owned paths. `tests/gallery/index.html`/`index.js` and the
phase acceptance suite are 8-05's and were not touched. No bug outside the done
evidence was found.
