# Charting library research — analytics dashboard (no bundler, web components)

> **Status in the plan.** The project owner has confirmed **uPlot as published** (1.6.32, unminified ES module, vendored verbatim); size and minification are settled and are not a question. This research is the evidence for that choice and for the rejections. Its ECharts fallback is not carried: if uPlot cannot carry two-dimensional scatter hit-testing and rectangle selection, [DESIGN.md](DESIGN.md) names a first-party canvas element behind the same contract instead of a second library. The 22.7 KB figure below is the gzip of an esbuild-minified copy; as published the ES module is 41,650 B gzip (145,423 B raw) and the stylesheet 772 B gzip.

Date: 2026-11-02. Scratch work: `/tmp/chart-research` (installs, test harness, raw results; not in this repo). No repo was touched.

## TL;DR

- **Primary: uPlot 1.6.32.** Zero dependencies, 22.7 KB gzip, MIT, canvas, 1e6 points in ~50 ms. Pan/zoom/hover/cursor/legend toggle are built in, and it loads from one vendored file with no import map. You hand-roll the tooltip, brush-to-callback, click-through and the non-time-series chart types (histogram and box need a little work; stacked bars need work).
- **Fallback: ECharts 6.1.0** (Apache-2.0). Covers everything out of the box (stacked area/bar, histogram, boxplot, dataZoom, brush, legend toggle, click events, tooltips). It costs 190-360 KB gzip depending on tree-shaking and needs a manual `resize()`. Its dependencies are just `zrender` and `tslib`, and the shipped `echarts.esm.min.mjs` is a single self-contained file.
- **Hand-rolled canvas on d3-scale/shape/array** is viable as a third path (16 KB gzip tree-shaken). It needs an import map or a one-off vendoring step, and it is the most work.
- **Reject:** Frappe (broken in shadow DOM, 1e6 stack overflow, no zoom), Chartist (no tooltip, 1e6 stack overflow), Billboard (d3 graph of 23 packages, 524 requests unbundled, 6.6 s at 1e6), Apex (revenue-gated, non-OSI licence, 280 KB gzip), Observable Plot (SVG, 2.4 s at 1e6, no built-in zoom, and its ESM does not load natively).

## Method and caveats

- Each library was installed in isolation under `/tmp/chart-research/inst/<lib>/`. Dependency trees come from `npm ls --omit=dev --all`. Version, release and activity data come from the npm registry and the GitHub API, queried on 2026-11-02.
- Sizes are min+gzip. For libraries that ship minified single-file ESM (ECharts, lightweight-charts) the shipped file was measured. For the rest, esbuild produced a minified bundle that approximates what a one-off vendoring step would give. A "bundle" in that sense is a one-time prep, not a runtime build. `work/sizes.md` has the full table.
- Behaviour was tested in headless Chromium via Playwright, with a static server and a generated import map (`tests/server.mjs`). Each library was mounted inside a shadow root. A "nomap" variant ran with no import map to see whether it loads natively.
- **Render times are indicative only.** Chromium was headless and software-rendered. Render time is JS start to the second `requestAnimationFrame`. Ratios between libraries are meaningful, and absolutes are not. Hover latency numbers were dominated by CDP overhead and are discarded.
- Silent failures (an uncaught error after the harness reported ok) are flagged via `window.__errs`. Chartist and Frappe at 1e6 were caught this way.
- **Not verified by my harness:**
  - Legend toggle and click-through were not exercised. The "yes" entries for them come from documentation.
  - Hover detection reads DOM text, so canvas-only crosshairs (lightweight-charts) show as "changed: false" although they render. Chartist's `false` is real, because it has no tooltip.
  - The synthetic drag-zoom did not change dygraphs' range, and it did not change Billboard's either (Billboard's wheel zoom did work). Dygraphs may be affected by shadow-DOM event retargeting, which I did not confirm. Treat both as unverified.
  - I did not compare against the 1e6 numbers on real hardware.

## Comparison table

Version and activity are as of 2026-11-02. Deps = transitive runtime packages, excluding the library itself. Size is min+gzip of what you would vendor. Perf is render ms for N points (single line series, shadow-DOM host).

| Library | Version (released) | Deps | Size gzip | Renderer | Native ESM, no map? | 10k / 100k / 1e6 ms | Licence | Activity |
|---|---|---|---|---|---|---|---|---|
| **uPlot** | 1.6.32 (2025-03-14) | 0 | 22.7 KB (+0.7 CSS) | canvas | **yes** (single file) | 55 / 34 / 50 | MIT | pushed 2026-10-30; 133 open issues+PRs; last release 8 months ago |
| **Chart.js** | 4.6.1 (2026-10-22) | 1 (`@kurkle/color`) | 61.5-69.4 KB | canvas | **no**, bare `@kurkle/color` import (map needed or bundle) | 56 / 76 / 304 | MIT | pushed 2026-10-23; 632 open |
| Chart.js + zoom plugin | plugin 2.2.0 (2024-11-26) | 4 (`hammerjs`, `chart.js`, `@kurkle/color`, types) | 73.7 KB | canvas | no (map + hammer shim) | 53 / 72 / 307 | MIT | plugin pushed 2026-10-18 |
| **ECharts** | 6.1.0 (2026-05-19) | 2 (`zrender`, `tslib`) | 360 KB full; 191-238 KB tree-shaken | canvas (or SVG) | **yes** (shipped `echarts.esm.min.mjs`, 1095 KB raw) | 114 / 192 / 754 | Apache-2.0 | pushed 2026-10-13; 1486 open |
| Observable Plot | 0.6.17 (2025-02-14); 0.6.18-alpha.1 on npm | 41 (d3 7.9) | 131 KB bundled; 67 KB UMD + d3 91 KB | SVG | **no** (bare `d3`; CJS `interval-tree-1d` breaks native import) | 64 / 253 / 2387 | ISC | pushed 2026-10-30; 351 open |
| d3 modules (hand-roll base) | scale 4.0.2, shape 3.2.0, array 3.2.4 | ~9 small | 16.5 KB tree-shaken; 45 KB incl. axis/brush/zoom | n/a | no (inter-module bare imports) | n/a | ISC | stable, low churn |
| Frappe Charts | 1.6.2 latest tag (2.0.0-rc31 on `next`) | 0 | 19.4 KB | SVG | yes | 484 / 4316 / **stack overflow** | MIT | pushed 2026-10-19; last stable release 2022 |
| ApexCharts | 8.7.0 (2026-10-31) | 1 (`apex-commons`) | 280 KB (core-only UMD 160 KB) | SVG | **no** (bare `apexcharts` import; map needed) | 115 / 206 / 1106 | **non-OSI, revenue-gated** | very active; 282 open |
| Chartist | 2.2.0 (2026-10-20) | 0 | 27.6 KB (+1.9 CSS) | SVG | yes | 37 / 150 / **stack overflow** | MIT | active |
| Billboard.js | 4.1.3 (2026-10-16) | 22 (d3 modules) | 105 KB (line/bar/area ESM) | SVG | no (d3 bare imports; 524 requests with a map) | 99 / 614 / 6621 | MIT | active |
| lightweight-charts | 5.2.1 (2026-08-12) | 1 | 60.7 KB | canvas | **yes** (single `standalone.production.mjs`) | 105 / 232 / 1858 | Apache-2.0 (needs TradingView attribution) | very active; 134 open |
| dygraphs | 2.2.2 (2026-07-27) | 0 | 36.4 KB | canvas | UMD side-effect import works; `index.js` ESM has extensionless relative imports and fails | 34 / 88 / 634 | MIT (GitHub shows NOASSERTION) | 252 open; 0 commits in 90 days |
| Hand-rolled canvas (d3-scale/shape/array + LTTB) | prototype | 3 | ~16 KB | canvas | needs map or one-off vendoring | 13 / 18 / 23 (with decimation); 17 / 61 / 493 (without) | n/a | n/a |

Also checked for completeness, not tested for interaction: Plotly (1456 KB gzip), Highcharts (99.8 KB, proprietary licence), `@antv/g2` (397 KB gzip, 86 packages), `@unovis/ts` (1261 KB gzip, 190 packages), Vega-Lite (79 packages), Toast UI Chart (archived 2023-10), c3 (last release 2020, d3 v5 with 37 packages). All fail the minimal-dependency brief.

## Interactivity matrix

"Built in" means it works without extra code. "Measured" means the harness changed the chart state. "Docs" means documented but not exercised by my harness.

| Library | Hover/tooltip | Zoom / pan | Brush / range select | Click / drill | Legend toggle | Stacked area/bar | Histogram / box |
|---|---|---|---|---|---|---|---|
| uPlot | cursor + hover points built in; **tooltip DOM is yours (plugin)**. Measured. | drag-zoom measured (600k → 132k range); wheel needs a plugin (the measured wheel change was nil). Pan via plugin | `select` hook gives a drag range (docs) | `setCursor`/click hooks, bring your own (docs) | built in (series show/hide, docs) | stacked via the `stack` helper/bands pattern in demos; **bars are a built-in path builder**, grouping by hand | histogram = bars you compute; **no box plot** |
| Chart.js | built in, measured | **needs plugin** (`chartjs-plugin-zoom`: drag + wheel measured) | plugin drag-zoom only | `onClick` + `getElementsAtEventForMode` (docs) | built in (docs) | built in | bar for histogram; box plot via third-party `@sgratzl/chartjs-chart-boxplot` |
| ECharts | built in, measured | `dataZoom` inside/slider (wheel measured; drag pans, so range stayed 100) | `brush` component + toolbox (docs) | `chart.on('click')` (docs) | built in (docs) | built in | `boxplot` series built in; histogram via bar with `ecStat` or your own bins |
| Observable Plot | pointer tip mark, measured | **none** (static render; you wire it yourself) | `brush`/interactions are manual | manual | manual | built in marks (`areaY`, `barY` with stack) | `rectY` + `binX` built in; `boxY` built in |
| Frappe | tooltip measured | none | none | `dataSelect` event (docs) | none (docs) | bars/axis-mixed only; stacked bar yes | none |
| ApexCharts | built in, measured | built in toolbar zoom, measured (599.9M → 147.7M) | selection zoom (docs) | click events (docs) | built in (docs) | built in | boxPlot + rangeBar types |
| Chartist | **no tooltip** (needs plugin); hover not measurable | none | none | `draw` event hooks (docs) | none | stacked bars/lines yes | none |
| Billboard | built in, measured | wheel zoom measured; drag range unchanged in my harness | subchart brush (docs) | `onclick` (docs) | built in (docs) | built in | none built in |
| lightweight-charts | canvas crosshair (not detectable by my DOM check) | built-in pan/zoom; wheel measured (1495 → 1359) | none | `subscribeClick` (docs) | none | no stacking | histogram series (volume style) only; no box |
| dygraphs | built in (hover changed: true) | drag-zoom + range selector built in (docs); **my synthetic drag did not change the range, unverified in shadow DOM** | built in | click callbacks (docs) | series toggle via checkbox (docs) | stacked graph option; no stacked bars | none |
| Hand-rolled | tooltip is yours (prototype confirms hover, bisector fixed) | wheel/drag measured (599,940 → 128,673) | yours | yours | yours | yours | yours |

## Native-import findings (no bundler)

| Library | Result | What was needed |
|---|---|---|
| uPlot | works | nothing; `uPlot.esm.js` is a single self-contained file |
| ECharts | works | nothing; `echarts.esm.min.mjs` shipped self-contained |
| lightweight-charts | works | nothing; `standalone.production.mjs` |
| Frappe | loads | nothing (but see shadow DOM) |
| Chartist | works | CSS adopted into the shadow root |
| dygraphs | UMD works as a side-effect import (then read `globalThis.Dygraph`) | `dist/dygraph.min.js`; ESM entry fails on extensionless imports |
| Chart.js | **fails without a map** (`@kurkle/color`) | import map entry, or vendor the pre-bundled `chart.umd.min.js`/an esbuild bundle |
| Chart.js zoom | map + hammerjs shim | `chart.js/helpers` and `hammerjs` entries; hammer needs a shim (11 requests) |
| ApexCharts | fails without a map (`apexcharts`); works with `apexcharts.esm.js` + map | map entries for `apexcharts` and `apexcharts/core` |
| Observable Plot | ESM **fails** (CJS `interval-tree-1d` has no default export, 654 requests); UMD alone fails (needs global d3) | `d3.min.js` then `plot.umd.min.js` as side-effect imports (works, 477 KB raw), or the jsDelivr `+esm` URL, which only works from the CDN |
| Billboard | fails without a map; with one, 524 requests, 851 ms load | d3 modules mapped |
| d3 modules | fail without a map (inter-module bare specifiers) | import map, or one-off vendoring |

## Shadow-DOM fit

| Library | Style injection | Resize | CSS-var theming | Verdict |
|---|---|---|---|---|
| uPlot | needs its 1.8 KB CSS adopted via `adoptedStyleSheets` | **manual** `setSize()` (measured: stayed 800 on container change, 500 after manual) | colours are canvas args, so read `getComputedStyle` and pass in | fine |
| ECharts | none (canvas/SVG inline) | **manual** `resize()` (same measurement) | read computed styles and pass to options | fine |
| Chart.js | none | **automatic** (ResizeObserver, 800 → 500) | read computed styles and pass in | fine |
| Plot | embeds `<style>` in the SVG | automatic (you re-render) | SVG `currentColor`/CSS vars work natively | fine |
| Apex | works (tooltip and toolbar verified by screenshot) | automatic | via options | fine |
| Chartist | needs 14.5 KB CSS adopted | automatic | SVG, so CSS vars work | fine |
| Billboard | needs CSS adopted | manual `resize()` | SVG, CSS vars work | fine |
| lightweight-charts | none | automatic (`autoSize`) | options only | fine |
| dygraphs | needs CSS adopted | manual `resize()` | options only | drag-zoom unverified |
| **Frappe** | **injects CSS into `document.head`, so shadow-DOM charts render unstyled** (screenshot confirmed) | automatic | no | **broken** without patching |

## Recommendation

### Primary: uPlot

- 0 dependencies, 22.7 KB gzip (+0.7 KB CSS), MIT, one self-contained ESM file: `import uPlot from './vendor/uPlot.esm.js'`.
- Fastest large-data path measured: 50 ms at 1e6 points, 34 ms at 100k.
- Active (pushed 2026-10-30), though the last tagged release was 2025-03-14.
- Drag-zoom works in a shadow root (measured). Hover cursor works (measured).
- Best fit for the time series, counts and durations that dominate event analytics.

What to hand-roll around it:
- **Tooltip.** uPlot ships a cursor and `setCursor` hooks but no tooltip UI. A ~50-line web component driven by the hook and a `<slot>`/positioned div.
- **Brush / range select.** Use the `select` hook, emit a `CustomEvent` with the range, and let the dashboard decide. Wheel zoom and pan also need small plugins (the harness saw no wheel zoom).
- **Click-through / drill.** Map `cursor.idx` to your row in a click hook, then emit an event.
- **Legend.** The built-in legend toggles series. Restyle it with CSS variables, or replace it with your own.
- **Non-time-series charts.** Histograms are precomputed bins drawn as bars. Stacked bars/areas need your own stacking (the demos show the pattern). Box plots are not available (draw them yourself, or use a small SVG component).
- **Shadow DOM and theming.** Adopt `uPlot.min.css` into the shadow root, add a `ResizeObserver` that calls `setSize`, and read CSS variables with `getComputedStyle` to feed series/axis colours (canvas cannot inherit them).

Trade-offs: no official stacked bar, no box plot, and the API is lower level than Chart.js. Accept this if time series dominate.

### Fallback: ECharts

- Zero hand-rolling for the missing pieces: boxplot, stacked everything, `dataZoom`, `brush`, legend, click events, tooltips.
- Loads natively as one file (`echarts.esm.min.mjs`, 360 KB gzip), with a 191-238 KB custom build if you do a one-off vendoring step. Only two dependencies (`zrender`, `tslib`).
- Canvas: 754 ms at 1e6 points, 192 ms at 100k. Apache-2.0. Actively developed (6.1.0, 2026-05-19).
- Costs: 8-16x the bytes of uPlot, a manual `resize()` in a `ResizeObserver`, and colours via options (read from CSS variables).

Choose ECharts instead if the dashboard needs box plots, brush selection across charts, or heatmaps. Use uPlot for the time-series panels and ECharts for the rest only if you accept two libraries.

### Third path: Chart.js (+ zoom plugin)

Chart.js is the fastest to productivity (61.5 KB gzip tree-shaken, automatic resize), but it needs an import map for `@kurkle/color`, a plugin with a hammerjs shim for zoom, and a date library with an adapter for time scales (https://www.chartjs.org/docs/latest/axes/cartesian/time.html). The map and plugin chain adds 4 dependencies and 11 requests when unbundled. A good option if you accept a single import map, and it is simpler than ECharts.

### Hand-rolled canvas

The prototype with d3-scale/shape/array and LTTB decimation rendered 1e6 points in 23 ms (493 ms without decimation) at 16 KB gzip tree-shaken. Zoom and hover worked. You own every feature: axes, tooltips, legend, brush, stacking and accessibility. Only worth it if you want full design control and are willing to maintain it. It needs an import map or a vendored bundle, since the d3 modules import each other by bare specifier.

## Rejected, with the deciding reason

| Library | Reason |
|---|---|
| Frappe | unstyled in shadow DOM; stack overflow at 1e6; no zoom or brush; last stable release 2022 |
| Chartist | no tooltip; stack overflow at 1e6; no zoom |
| Billboard | 23-package d3 graph; 524 requests unbundled; 6.6 s at 1e6 |
| ApexCharts | non-OSI, revenue-gated licence (`LICENSE.md` in the package); 280 KB gzip; map needed |
| Observable Plot | SVG (2.4 s at 1e6); no built-in zoom; ESM does not load natively (CJS dependency) |
| lightweight-charts | finance-oriented; no stacked/bar-group/box; attribution requirement; fine for a pure price-style time series |
| dygraphs | 0 commits in 90 days (252 open); ESM entry broken; drag-zoom unverified in shadow DOM |
| Plotly / Highcharts / G2 / Unovis / Vega-Lite / c3 / Toast UI | size, dependency count, licence or abandonment (see sizes) |

## Sources

- uPlot: https://github.com/leeoniya/uPlot · https://www.npmjs.com/package/uplot · README https://github.com/leeoniya/uPlot#readme
- Chart.js: https://github.com/chartjs/Chart.js · https://www.npmjs.com/package/chart.js · time scale https://www.chartjs.org/docs/latest/axes/cartesian/time.html
- chartjs-plugin-zoom: https://github.com/chartjs/chartjs-plugin-zoom · https://www.npmjs.com/package/chartjs-plugin-zoom
- ECharts: https://github.com/apache/echarts · https://www.npmjs.com/package/echarts · https://echarts.apache.org
- Observable Plot: https://github.com/observablehq/plot · https://www.npmjs.com/package/@observablehq/plot · interactions https://github.com/observablehq/plot/blob/main/docs/interactions
- d3: https://github.com/d3/d3 · https://github.com/d3/d3-scale · https://github.com/d3/d3-shape
- Frappe Charts: https://github.com/frappe/charts · https://www.npmjs.com/package/frappe-charts
- ApexCharts: https://github.com/apexcharts/apexcharts.js · https://www.npmjs.com/package/apexcharts (licence: `LICENSE.md` shipped in the package)
- Chartist: https://github.com/chartist-js/chartist · https://www.npmjs.com/package/chartist
- Billboard.js: https://github.com/naver/billboard.js · https://www.npmjs.com/package/billboard.js
- lightweight-charts: https://github.com/tradingview/lightweight-charts · https://www.npmjs.com/package/lightweight-charts
- dygraphs: https://github.com/danvk/dygraphs · https://www.npmjs.com/package/dygraphs
- jsDelivr (`+esm` bundles tested for Plot): https://www.jsdelivr.com/

Raw data: `/tmp/chart-research/work/results.json`, `run-final.log`, `sizes.md`, `repos.txt`, `repos2.txt`, `/tmp/chart-research/npmls.txt`; screenshots in `work/shots/`.
