# 7-01 — Chart foundations, colour and accessibility

Status: done.

## What changed

- `web/js/charts/colour-registry.js` — deterministic categorical registry keyed
  `namespace:name`, persisted under `yakka-analytics-entity-colours`. Eight hue
  slots (`h1`–`h8`) then labelled/patterned neutral fallbacks (`n0`…). The five
  named values plus `(other)` keep fixed neutral styles with their own CSS token,
  shape, pattern and label, so `(mixed)`, `(none)`, `(multi)`, `unknown` and
  `unscored` are never merged into `(other)`. Cohorts A–D and the four status
  colours are fixed. Assignment is sticky: registering a filtered subset cannot
  repaint a surviving key. The module has no network path.
- `web/js/charts/formatters.js` — counts with units, percentages and shares,
  money (never `$0` for unpriced: lower bound plus unpriced count, or
  `unpriced`), time-basis descriptions and `sample of N of M`. A missing value is
  `—`, never zero.
- `web/js/charts/tooltip.js` — one tooltip for every visible series, with unit,
  `n` and coverage flags; the element carries `data-entity-key` for the key under
  the cursor or keyboard focus.
- `web/js/charts/legend.js` — toggle, focus and isolate controls with 44 px
  targets, active/isolated marks, and intent events only. It never fetches.
- `web/js/charts/badges.js` — resolution, sample and the non-exclusive `partial`,
  `sampled`, `coarsened`, `clipped`, `lower-bound` badges; sample reads
  `sample of N of M`.
- `web/js/charts/table.js` — accessible table from the same spec/data as the
  chart: plotted values, units in headers, entity keys, per-row checkbox
  selection that emits intent for 7-03, Space/Enter and arrow-key operation.
- `web/js/charts/styles.js` — one cached fetch of `web/css/charts.css` and
  `web/vendor/uplot-1.6.32/uPlot.min.css`, exposed as a constructable stylesheet
  adopted by shadow roots; `readToken`/`watchTheme` make a theme change a re-read.
- `web/css/charts.css` — both theme token blocks (`:root, :host` and
  `html[data-theme=dark], :host-context(...)`), eight hues, sequential and
  diverging ramps, status/cohort/neutral tokens, chart frame, legend, tooltip,
  table, badge, visible focus, 900 px single column, and no transitions or
  animations.
- `tests/gallery/harness.mjs` — test-only static server for `web/` and
  `tests/gallery/`, reading the CSP/security headers from `_headers`, counting
  analytics requests in flight (peak included), collecting console/page/CSP
  diagnostics and waiting on `html[data-idle]`. No `/tmp` writes.
- `tests/gallery/fixture.js` — deterministic multi-year daily series, 5,000
  scatter points (the server budget), entity keys and badge metadata.
- `tests/gallery/foundations.html` + `.js` — external modules only; exercises
  tokens, registry, tooltip, legend, badges, table and the adopted stylesheet in
  both themes, then sets `data-idle`.
- `tests/charts-time/browser.mjs` — `createRequire` loader for
  `playwright-core` under `NODE_PATH`, Chromium 1243 executable path and the
  exact named skip reason when either is absent.
- `tests/charts-time/foundations.test.mjs` — pure palette, registry and formatter
  checks plus the Chromium browser spec.

## Check output

Before: the check did not exist on this branch.

```
$ git cat-file -e HEAD:packages/yakka-analytics/tests/charts-time/foundations.test.mjs
fatal: path '...foundations.test.mjs' exists on disk, but not in 'HEAD'
$ echo $?
128
```

After:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-time/foundations.test.mjs
# tests 8
# pass 8
# fail 0
```

The browser test ran (playwright-core 1.63.0 and Chromium 1243 were present), so
there is no browser gate. It proves the tooltip key, legend toggle with no
request, badges, table values and keyboard selection, both themes from CSS
custom properties, adopted stylesheet in a shadow root, no animation and a peak
of at most four in-flight analytics requests, with no console error, page error
or CSP violation.

```
$ node --test packages/yakka-analytics/tests/*.test.mjs
# tests 12
# pass 12
# fail 0
```

## Committed palette thresholds

`THRESHOLDS` in `colour-registry.js`; measured minima are shown in brackets.

| Threshold | Committed | Light | Dark |
|---|---|---|---|
| hue contrast against chart surface | ≥ 3.0 | 5.02 | 5.57 |
| adjacent hue slots (CIE76 ΔE) | ≥ 20 | 51.3 | 27.4 |
| fixed-neutral contrast | ≥ 3.0 | 4.74 | 5.97 |
| adjacent fixed neutrals (ΔE) | ≥ 10 | 12.4 | 15.6 |
| status contrast | ≥ 3.0 | 5.02 | 5.48 |
| adjacent status colours (ΔE) | ≥ 20 | 27.1 | 69.0 |
| adjacent cohorts (ΔE) | ≥ 20 | 84.3 | 96.5 |

`paletteReport()` returns `failures: []` for both themes. The test also matches
every committed light/dark hex to its token in `charts.css`.

## Deviations and interpretations

- Slot assignment sorts a batch of new keys before first assignment, so the same
  key set yields the same slots regardless of registration order; existing slots
  are never reassigned. The gallery sorts its registry display by slot.
- Fixed neutrals are not a categorical hue ramp, so their adjacent-slot ΔE
  threshold is 10 (distinction is carried by label plus pattern), while hue,
  status and cohort adjacency use ΔE 20.
- Swatch colours and tooltip coordinates are set through CSSOM custom properties
  (`element.style.setProperty`), not `style=` markup or `<style>`; the browser
  spec confirms no CSP violation under `style-src 'self'`.
- The harness answers `/favicon.ico` with 204 and `/v1/analytics/*` with `{}`
  purely so the counter and diagnostics have a clean, test-only route; no
  product code branches on any of it.

## Contradictions

None found between this brief and CONTRACTS.md 17.5/17.7 or DESIGN.md.

## Unfinished / known problems

None in this unit. 7-02–7-05 are expected to import these modules as written.
