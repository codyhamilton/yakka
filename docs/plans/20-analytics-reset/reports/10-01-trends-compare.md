# 10-01 — Trend and compare primitives, Trends and Compare presets

Status: `done`. Both presets render, both suites pass, and the workspace suite
is green. One process miss: the brief's tool-turn budget was already nearly
spent when this unit started, so the remaining work was compressed (see
Problems).

## What changed

- `web/js/panels/p10-shared.js` (new) — the one request/chooser seam for P10:
  schema grain/measure lookup, offered-measure and offered-lens filtering,
  `requestParams` (absolute `from`/`to`, or `all=1`; `cmp` is never sent),
  bucket choice and coarsening, population and coverage text, the two-sided
  comparison summary and delta formatting, query/rank row mapping, the panel
  stylesheet loader, and `renderChooser`. `cohortParams` is a named empty seam
  for 10-05.
- `web/js/panels/trend-columns.js` (new) — measure/split/chart chooser
  (columns → lines → cumulative → share), `<yk-chart>` model with axes/time
  basis/empty copy, sparse table rows, and a chart-zoom hook that re-emits
  absolute ISO `scope` bounds. Also exports `TREND_MEASURES`/`TREND_LENSES`.
- `web/js/panels/trend-lines.js` (new) — two-line period overlay aligned by the
  fixed window offset; all-history has no previous side and says so. `area` is
  the second offered chart.
- `web/js/panels/trend-multiples.js` (new) — one small line per split value,
  schema-limited measure/split chooser.
- `web/js/panels/rhythm.js` (new) — `/query?dim=weekday&dim=hour_of_day` rows
  into a weekday × hour matrix with padded hour labels.
- `web/js/panels/p10-trends.js` (new) — registers the four Trend panels plus
  Phase 9's `calendar`, and the `trends` preset (`trend-columns`,
  `trend-lines`, `trend-multiples`, `calendar`, `rhythm`) with starting specs.
  Registration replaces the empty named-destination row rather than skipping
  it when a preset shell already exists.
- `web/js/panels/dist-ranges.js` (new) — `<yk-ranges>` box rows for one or two
  periods, fixed current/previous order, quartiles/p95/n/unpriced in the shared
  table, and the all-history refusal copy
  `Choose a finite period to compare periods.` `DIST_DIMS` is `['model']`,
  matching CONTRACTS `/distribution` (`dim` omitted or `model`).
- `web/js/panels/dist-hist.js` (new) — one fixed server bin ladder per response,
  zero-filled absent bins, histograms for both periods.
- `web/js/panels/dist-ecdf.js` (new) — ECDF sampled from the server's fixed bin
  counts, current and previous as two series, n and the top edge named.
- `web/js/panels/rank.js` (new) — bucket-free totals into `<yk-bars
  type="slope">` with `previous` then `current` series; `deltaRamp` marks each
  change `up`/`down`/`flat`.
- `web/js/panels/p10-compare.js` (new) — registers `dist-ranges`, `dist-hist`,
  `dist-ecdf`, `trend-lines` and `rank`, and the `compare` preset. Every
  compare-capable starting spec carries `scope: { cmp: 'period' }`.
- `web/js/panels/p10-quality.js`, `p10-cost.js`, `p10-tools.js` (new) — empty
  `register*Panels()` seams so `panels/index.js` calls one function per P10
  preset; they register no preset and no panel.
- Chart-kit seams (opt-in; no default changed):
  - `web/js/charts/yk-ranges.js` — `legend: 'entities'` publishes every box row
    as a labelled legend series and hides a hidden entity's row.
  - `web/js/charts/svg-base.js` — `spec.legendSeries` overrides
    `spec.series` for the legend; isolate works on the published legend items.
  - `web/js/charts/yk-bars.js` — `#slope` honours `spec.deltaRamp`, sets
    `--yk-div-pos-2`/`--yk-div-neg-2` and `data-delta="up|down|flat"`.
- `web/js/panels/index.js` — imports and calls the five P10 registration
  functions after Phase 9's.
- `web/js/panels/panel-frame.js` — forwards `schema` into `panel.load`.
- `web/js/app.js` — defines the chart elements the P10 panels need, passes
  `schema` to every frame, and listens for `spec` (writes `p<n>` and pushes),
  `scope` (absolute ISO bounds → pushes `from`/`to` with `win:''`, `sel:''`) and
  `inspect` (adds the row's entity/destination when the spec supplies one).
- `web/js/boards/board.js` — `boardScope` keeps `state.cmp` when it is set and
  not `off`.
- `web/css/trends.css` (new) — layout only, theme tokens for colour, no
  animation.
- `tests/workspace/fixture.mjs` — new opt-in `p10Schema()`/`p10Fixture()` scene
  (time + session grains, all distribution measures, model lens on session) and
  deterministic query/distribution/score bodies. Default
  `makeSchema()`/`summary()` bodies are unchanged. Session grain now publishes
  the token measures and the `model` lens so the distribution panels' declared
  capabilities are honest.
- `tests/workspace/stub-api.mjs` — `p10` toggle, a per-request
  `requests: [{ path, search }]` log, and P10 `/query`, `/distribution`,
  `/entities`, `/summary`, `/scores`, `/score-series` and `/baselines` bodies.
- `tests/workspace/start.test.mjs` — Trends is now a delivered board, so the
  two old assertions that expected `Delivered in Phase 10: Trends` now assert
  the board renders. The legacy-server step moves to `/b/scatter` (still a
  Phase 11 named destination) so it keeps testing the named path instead of
  legitimately failing requests.
- `tests/trends-quality/` (new) — `browser.mjs` and `fixture.mjs` re-export the
  shared loaders; `trends.test.mjs` (8 pure + 1 Chromium) and
  `compare.test.mjs` (7 pure + 1 Chromium) cover preset registration, chooser
  limits, sparse rows, chart shapes, period alignment, comparison text,
  rhythm, spec encoding, fixed bins/histogram fill, slope sides, distribution
  params (including all-history → no previous), and box/table fields.
- `docs/plans/20-analytics-reset/reports/10-01-trends-compare.md` — this report.

## Check output

Brief command (from `packages/yakka-analytics`, with `NODE_PATH` set):

```
$ node --test tests/trends-quality/trends.test.mjs tests/trends-quality/compare.test.mjs
# tests 17
# pass 17
# fail 0
# skipped 0
```

Regression:

```
$ node --test tests/workspace/*.test.mjs
# tests 72
# pass 72
# fail 0
# skipped 0
```

`git diff --check` is clean; `node --check` passes on every new/modified JS and
MJS file.

## Browser observations

- `/b/trends?win=30d`: five frames settle `ready`; ids are
  `trend-columns`, `trend-lines`, `trend-multiples`, `calendar`, `rhythm`.
  Trend columns offers the schema-filtered measures and exactly
  `columns/lines/cumulative/share`. Choosing `commits` writes `p1` with
  `measures:["commits"]`. A chart `zoom` event with absolute milliseconds
  produces ISO `from`/`to`, clears `win` and `sel`, and re-settles the board.
- `/b/compare?win=30d&cmp=period`: five frames settle `ready`; ids are
  `dist-ranges`, `dist-hist`, `dist-ecdf`, `trend-lines`, `rank`. Distribution
  ranges renders current and previous group rows and an unpriced column; rank
  renders both `up` and `down` slopes with the committed diverging tokens; no
  request carries `cmp`.
- `/b/compare?win=all`: distribution ranges shows
  `Choose a finite period to compare periods.` and issues no previous-period
  request.
- `maxInFlight <= 4`; no page error, console error or CSP violation.

## Deviations from the brief, with reasons

1. **Chart element definitions moved to `app.js`.** The P10 panel modules
   originally imported `../charts/yk-chart.js` for its custom-element side
   effect, which made every pure `node --test` import of `panels/index.js` fail
   on the browser-only `/vendor/uplot-1.6.32/uPlot.esm.js` specifier. The
   imports now live in `app.js`, the only browser entry, and panel modules stay
   importable in Node. No chart behaviour changed.
2. **`trend-columns` declares four chart names** (`columns`, `lines`,
   `cumulative`, `share`) so the brief's chooser step can switch renderer
   without registering a second panel. It resolves to one `<yk-chart>` at a
   time; this is not four chart elements on screen.
3. **Distribution split is `model` only.** CONTRACTS `/distribution` allows
   `dim` to be omitted or `model`; the earlier harness text exposed harness and
   session dims that the route rejects. The panel now offers only the route's
   real dimension and says why in its request metadata.
4. **The Compare preset reuses `trend-lines`** as its fifth panel (current vs
   previous trend) because `cohort-compare` belongs to 10-05. When 10-05 lands
   it can replace that slot without changing the preset registration seam.
5. **Test count differs from the brief's "86/86".** The checked-in workspace
   suite currently runs 72 tests; all 72 pass. The brief's number appears to
   count an older suite revision.
6. **`start.test.mjs` was edited** (not in the brief's file list) because the
   Trends route changed from a named destination to a delivered board; leaving
   the old assertions would make a correct delivery look like a regression.

## Unfinished / known problems

- `cohortParams` in `p10-shared.js` returns `{}`; 10-05 must fill it and forward
  `cohort=` through `requestParams`. Until then P10 panels honour
  window/filter scope but not cohort scope.
- Compare has no cohort slot until 10-05 adds `cohort-compare`; the current
  fifth panel is `trend-lines`.
- The palette (`quality`), `cost` and `tools` presets are registered as empty
  seams only; 10-02/10-03/10-04 must fill them.
- `p10-shared.js` exports `formatP10Value`, `coverageFacts` and a few helpers
  that only the compare panels use today; no dead branch affects behaviour.
- The chart kit's own history write still stores zoom bounds as raw
  milliseconds briefly; the P10 `scope` listener immediately replaces that URL
  with ISO bounds. Other chart users keep their existing behaviour.
- If `/distribution` changes its fixed bins per group, `fixedBins()` takes the
  first row's ladder and `histogramRows()` reports absent bins as zero. That is
  the server contract today; a per-row ladder would need a separator.

## Commit

Committed to `feat/20-analytics-reset` with a plain-summary title; this report
is included. No push, merge, deploy, rebase, or other branch/worktree touched.
