# Brief: 8-02 — Ranges and distributions

Consumer: the Phase 8 chart-kit worker; 8-05 proves the combined gallery.
Owned paths: `packages/yakka-analytics/web/js/charts/yk-ranges.js`, `packages/yakka-analytics/tests/gallery/{ranges.html,ranges.js,fixture-ranges.js}`, `packages/yakka-analytics/tests/charts-cat/ranges.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/8-02-ranges.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 8-01.
Runs alongside: 8-03 and 8-04; each owns a disjoint element, gallery page, fixture and spec.
Budget: 10 files to read, about 700 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements" for `<yk-ranges>` (box and whisker with p95 and an optional baseline band, histogram, strip or dot plot; same `spec`/`data`, events and `inspect()` as the other elements), "Colour registry", "Rules from the dataviz discipline", "Testability surface".
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 8 outcome; Interaction model Gestures table, Accessibility and responsiveness baseline; Chart kit; the `dist-ranges`, `dist-hist` and `dist-ecdf` catalog entries.
3. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.7 — the Chromium, settled-state, no-sleep, console/CSP and in-flight rules.
4. `packages/yakka-analytics/web/js/charts/svg-base.js` and `yk-bars.js` from 8-01 — the shared element lifecycle, `inspect()` shape and mark model. Import the base; do not edit it.
5. `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,selection}.js` — exports only.
6. `packages/yakka-analytics/tests/gallery/{harness.mjs,fixture.js,bars.html,bars.js}` and `packages/yakka-analytics/tests/charts-cat/{browser.mjs,bars.test.mjs}` — the settled-page and spec patterns.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Deliver `<yk-ranges>` for box-and-whisker distributions with p95 and an optional baseline band, fixed-bin histograms, strip plots and dot plots, using the 8-01 shared SVG element contract and proving every mode in the gallery.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-ranges>` covers box and whisker with p95 and an optional baseline band, histogram, strip or dot plot; it takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush`, and exposes `inspect()`. Brush is only emitted where a continuous time axis applies; this element's x axis is a lens or measure axis, so it reports `brush: null` and emits no brush.
- CONTRACTS.md 17.5 "Testability surface" and "Rules from the dataviz discipline": `data-chart`/`data-state`, `inspect()` with plot, axes, series, marks and `xToPx`/`yToPx`, a tooltip carrying the key, units and the table view; a legend at two or more series; zero-based counts for histograms; no mark the interaction model cannot act on.
- DESIGN.md Interaction model: hover/focus highlights the key, click/Enter inspects, Space and the row checkbox select, Alt-click and `x` exclude, `o`/`f`/`c` then `a`–`d`/Esc emit the contract intents, and touch tap inspects with targets at least 44 px.
- DESIGN.md Workspace shell: money is never `$0` when unpriced; show the lower bound and unpriced count, or `unpriced`. A baseline band is context, not a selectable mark, and is listed in the table.
- CONTRACTS.md 17.7: real Chromium events at `inspect()` coordinates; no fixed sleeps; no animation; no `/tmp`; tests are not shipped; nothing branches on being under test.
- Settled: SVG with the shared tooltip, legend and registry; no new dependency, route, grain, join, measure or gesture; no palette change.

## Changes

- `yk-ranges.js`: `<yk-ranges>` with `spec.chart = 'ranges'` and `spec.type` `box`, `histogram`, `strip` or `dots`.
  - `box`: data rows `{ key, label, values: { min, q1, median, q3, max, p95 }, n?, unpriced?, coverage? }`; draw the box, whiskers, median, a labelled p95 mark and optional `spec.baseline = { from, to, label }` behind the marks. The table and tooltip name every summary value, `n` and any unpriced count.
  - `histogram`: `spec.bins = [{ from, to }]` (fixed, labelled) and rows `{ key, label, bin: { from, to }, values: { count } }`; zero-based counts; table shows the bin range and count.
  - `strip`: one mark per observation, `{ key, group, values: { <measure>: number }, sampled?, n? }`; sampled marks are labelled as a sample of N of M and never imply membership of the whole population.
  - `dots`: aggregated one dot per category or value, `{ key, label, values: { <measure>: number }, n? }`; size or count never encodes an inferred identity.
  - The spec carries `{ chart, type, title, units, x: { label, kind: 'number' | 'text' }, series: [{ key, label, unit, kind }], baseline?, bins?, timeBasis?, coverage?, sample?, resolution?, empty?, unsupported? }`. Marks carry `data-entity-key` and the 8-01 mark shape.
- `ranges.html`/`ranges.js`/`fixture-ranges.js`: deterministic test-only data for every mode, using the shared entity keys (`model:atlas`, `harness:orca`, `repo:core`, `kind:test`); external modules only; settle every element, then set `data-idle`.
- `tests/charts-cat/ranges.test.mjs`: pure checks for the five-number summary and p95, baseline inclusion, bin boundaries and counts, strip sample labelling and dot aggregation, plus a Chromium spec driving real mouse and keyboard at `inspect()` coordinates.

### Keep untouched

Do not edit `svg-base.js`, `yk-bars.js`, `yk-chart.js` or any Phase 7 module; if the shared base cannot carry this element, report it rather than editing the foundation. Do not edit `tests/gallery/index.html`/`index.js`, another unit's page, fixture or spec, the harness, the vendored uPlot files, Go code, or the stale `tests/e2e*`, `tests/hosted` and `tests/identity` trees. Add no dependency, route, panel, grain, join, gesture or sample data to the product; no `/tmp`; no animation or fixed sleep.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/ranges.test.mjs` → passes, or skips with the exact named browser reason.
- Each mode (`box`, `histogram`, `strip`, `dots`) → table and `inspect()` values match `fixture-ranges.js`; box exposes min/q1/median/q3/max/p95 and `n`, histogram exposes its fixed bin boundaries and zero-based counts, strip marks expose the sampled flag, and dots expose their aggregate.
- Baseline → the optional band is drawn and named in the frame or table but appears as no selectable mark and in no `inspect().marks`.
- Real interaction → hover/focus highlights the key; click/Enter emits `inspect`; Space/checkbox selects; Alt-click/`x` excludes; `o`/`f`/`c` then `a`–`d`/Esc emit their intents; touch tap inspects at a target of at least 44 px; no `brush` event is emitted and `inspect().brush` is `null`.
- Table → keyboard operable (ArrowUp/ArrowDown, Space, Enter), unit-labelled, with `n` and unpriced counts where the spec carries them.
- Both themes → the same entity keeps its slot and pattern; no animation; no `console.error`, page error or CSP violation; at most four analytics requests in flight.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs` → the bars spec and this spec both pass.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any shared-base assumption that did not hold, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
