# Phase 2 report — chart contract fixes (shared Y, dashes, horizontal stacks, grouped columns)

Status: done. Code commit: `d12e2d7c` on
`feat/30-analytics-operable-chrome`.

## What changed

Shared chart kit:

- `scales.js`: `normaliseYRange` validates an explicit `{min,max}`;
  `buildScales` pins `y.range` from `spec.yRange` and lets it override the
  zero-based default. `normaliseDash` maps `dashed`/`dash` to `[6,4]`,
  `dotted`/`dot` to `[2,3]`, passes a numeric array through, and returns no
  dash for solid/absent. `columnBarLayout` splits one category band when any
  series declares `align` (`size` `1/n`, per-series `align`), otherwise keeps
  the existing stacked width.
- `yk-chart.js`: series `dash` reaches uPlot; columns use the shared layout,
  and an `outline` series is drawn with a light fill plus a 1.5px stroke
  instead of a solid fill.
- `yk-bars.js`: `orientation: 'horizontal'` selects a new
  `#stackedHorizontal` renderer (X=count from 0, Y=category, value grid on X,
  category labels on Y, pattern overlays and full-row hit targets retained).
  Geometry lives in the pure `horizontalStackRects`, which also fixes an
  explicit-`max: null` default to mean “derive from the data”.
- `yk-ranges.js`: `rangePeriodStyle` marks previous rows for a `6 4` dash and
  an outlined (no-fill) box while current rows keep the solid 0.35 fill;
  geometry is unchanged and the pattern overlay is skipped for previous.

Panel wiring:

| G row | Change |
|---|---|
| G-multiples | `multiplesYRange` gives every model chart one `{min:0,max}` domain spanning all groups and both periods; previous series dashed. |
| G-scoretrend | No data change; the new dash propagation keeps median solid and quartile series dashed as already specified. |
| G-bands | `band-mix` stacked bars are horizontal. |
| G-mix | `mix` stacked bars are horizontal. |
| G-shapes | `shape-bars` stacked bars are horizontal. |
| G-compranges | Previous period rows are dashed and outlined via `rangePeriodStyle`; current rows unchanged. |
| G-comphist | `groupedHistogramCharts` produces one column chart per model group with current (align left) and previous (align right, outlined) series over the same fixed bins; non-compare single-series histograms stay `yk-ranges`. |
| G-compecdf | Previous series dashed. |
| G-complines | Previous compare series dashed. |
| G-columns, G-lines, G-scores, G-rhythm, G-footprint | No change needed; the shared additions are inert without `yRange`/`dash`/`orientation`/`align`. |

## G items

| ID | Result | Evidence |
|---|---|---|
| G-columns | pass | Chromium acceptance; zero-based columns unchanged. |
| G-lines | pass | Chromium acceptance. |
| G-multiples | pass | Unit: shared max over both series and all groups, null when empty; Chromium acceptance. |
| G-scoretrend | pass | Unit: `normaliseDash` array/solid behaviour; Chromium acceptance. |
| G-bands | pass | Unit: `buildBarsModel` horizontal orientation plus left-to-right segment geometry; Chromium acceptance. |
| G-mix | pass | Chromium acceptance; stacked horizontal spec wired. |
| G-shapes | pass | Chromium acceptance; stacked horizontal spec wired. |
| G-compranges | pass | Unit: current solid/0.35, previous dashed/0, cohort A current, empty current; Chromium acceptance. |
| G-comphist | pass | Unit: one chart per group, aligned current/previous series, shared bins, missing previous stays null; Chromium acceptance. |
| G-compecdf | pass | Chromium acceptance; previous dash wired. |
| G-complines | pass | Unit: `compareRows` previous series dashed; Chromium acceptance. |
| G-footprint | pass | Chromium acceptance; no chart change. |

## Tests and commands

Before: 64 focused tests across the chart and operable-chrome unit files.
After (final run, separate processes):

- `node --test tests/operable-chrome/trends-captions-unit.test.mjs tests/operable-chrome/quality-captions-unit.test.mjs tests/operable-chrome/distribution-captions-unit.test.mjs tests/operable-chrome/tools-workflow-unit.test.mjs tests/charts-time/time-series.test.mjs tests/charts-cat/bars.test.mjs tests/charts-cat/ranges.test.mjs`
  → **64 pass, 0 fail**.
- `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-reporter=spec tests/operable-chrome/phase2-acceptance.test.mjs`
  → **1 pass, 0 fail** (84 matrix IDs inside the suite).
- `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-reporter=spec tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs`
  → **21 pass, 0 fail**.

## Residual gaps / concerns

- The phase 2 and phase 1 Chromium suites must be run in separate `node --test`
  processes. Combining them in one invocation made both fixture servers fail
  with 500s before the tests reached the charts; each suite passes alone. This
  is a harness/port limitation, not a product regression.
- Grouped compare bars and horizontal stacks are proven by pure geometry tests
  plus the Chromium acceptance page; no pixel-level golden images were added.
- G-mix and G-shapes use the same horizontal renderer as G-bands, so a future
  change to `orientation` handling affects all three together.
