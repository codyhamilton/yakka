# Brief: 7-01 — Chart foundations, colour and accessibility

Consumer: the Phase 7 chart-kit worker; 7-02 to 7-05 import these modules and the gallery harness.
Owned paths: `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,styles}.js`, `packages/yakka-analytics/web/css/charts.css`, `packages/yakka-analytics/tests/gallery/{harness.mjs,fixture.js,foundations.html,foundations.js}`, `packages/yakka-analytics/tests/charts-time/{browser.mjs,foundations.test.mjs}`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/7-01-chart-foundations.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phase 1.
Runs alongside: nothing; it establishes the shared harness and the contracts the later units compose.
Budget: 12 files to read, about 900 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — the colour-registry, dataviz-discipline and testability bullets, quoted, not rewritten.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Chart kit; Interaction model (Compare, Accessibility and responsiveness baseline); Workspace shell and state (Panel states, Time basis, Money); Phase 7 outcome; "Scope vocabulary for `refine` and `execute`".
3. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.7 — Chromium-only, `playwright-core` test-only dependency, no fixed sleeps, `html[data-idle]`, console/CSP failure, four-in-flight assertion.
4. `packages/yakka-analytics/web/css/app.css`, `web/index.html`, `web/js/theme-bootstrap.js`, `web/contract/url-state.js` — existing tokens, theme attribute, key names.
5. `packages/yakka-analytics/tests/static-shell.test.mjs`, `tests/vendor-integrity.test.mjs`, `tests/url-state.test.mjs`, `tests/e2e/static-harness.mjs` — existing test style and test-only server shape (do not edit the stale `tests/e2e` files).

Read ranges and grep; do not read a whole file to find one section.

## Goal

Provide the one styling, tooltip, legend, badge, formatter and accessible-table contract the whole chart kit uses, plus the test-only gallery harness that later units drive, with the colour registry and both themes proven.

## Contract

- CONTRACTS.md 17.5 "Colour registry" is binding: fixed categorical slots keyed `namespace:name`, stored in `yakka-analytics-entity-colours`; eight hue slots then distinct labelled/patterned neutral styles for additional keys and `(other)`; `(mixed)`, `(none)`, `(multi)`, `unknown` and `unscored` keep fixed neutral styles and are never merged into grey `(other)`; a filter or toggle never repaints a surviving series; cohort slots A–D have fixed colours per DESIGN.md Compare; the palette check is first-party and committed, in both themes.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline" applies to every chart this kit serves: no dual axes, a legend whenever two or more series, units and time basis in the frame, zero-based bar axes, no chart without a table, and no chart for an action the interaction model cannot act on.
- DESIGN.md Interaction model "Accessibility and responsiveness baseline": native elements first, a keyboard-operable table showing plotted values, colour never alone (shape, pattern or label accompanies it), reduced-motion and both colour schemes honoured, no chart animates, single column below 900 px, visible focus.
- DESIGN.md Workspace shell: badges are the non-exclusive `partial`, `sampled`, `coarsened`, `clipped`, `lower-bound` flags beside the panel-state vocabulary; money never shows unpriced as `$0` (lower bound plus unpriced count, or `unpriced`); every frame names its basis.
- CONTRACTS.md 17.7: browser tests are Chromium only via `playwright-core`, use Node's runner, wait on `html[data-idle="true"]` and explicit end-state conditions, use no fixed sleeps, fail on `console.error` or CSP violation, and assert at most four in-flight analytics requests. Tests are not shipped and the product never branches on being under test.
- Settled and not open: uPlot 1.6.32 vendored verbatim, one runtime dependency, the element and badge names, the registry key, the testability surface and the no-animation rule. Do not add a dependency, route, panel, grain, join or gesture.

## Changes

- `colour-registry.js`: deterministic slot assignment and persistence; fixed neutral styles for the five named values; shape/pattern/label assignment so colour is never alone; stable assignment across filters, toggles and re-renders; no network access.
- `formatters.js`: units, time basis, counts, percentages/shares, and money with unpriced/lower-bound/all-unpriced rules. Null is never formatted as zero.
- `tooltip.js`: every visible series with unit, `n` and coverage flags; exposes the entity key under the cursor for CONTRACTS.md 17.5's testability rule.
- `legend.js`: toggle, focus and isolate controls with 44 px targets; emits intent only (no fetch); marks the active/isolated state.
- `badges.js`: resolution, sample and coverage badges from spec metadata, using the panel-state vocabulary; sample says "sample of N of M"; `(mixed)`/unknown/etc. are distinct.
- `table.js`: accessible table builder from the same spec/data as the chart; plotted values, units, keys; keyboard operable; a per-row selection control (checkbox) that emits selection intent for 7-03 to wire.
- `styles.js`: one cached loader that fetches `web/css/charts.css` and `web/vendor/uplot-1.6.32/uPlot.min.css` once per page and exposes a constructable stylesheet; chart colours are CSS custom properties and a theme change is re-read. Do not inject inline `<style>` or `style=` attributes (CSP `style-src 'self'`).
- `web/css/charts.css`: both theme token blocks (`:root, :host` and `html[data-theme=dark], :host-context(...)`), the eight categorical hues, sequential/diverging ramps, status colours, chart frame, legend, tooltip, table, badge and focus styles, 900 px single-column rule, and no transitions/animations.
- `tests/gallery/harness.mjs`: test-only static server for `web/` and `tests/gallery/`, the `_headers` CSP and security headers, no `/tmp` writes, an analytics in-flight counter, console/page-error/CSP-violation collection, and a settled-state wait helper.
- `tests/gallery/fixture.js`: deterministic test-only data for multi-year time series, 5,000 scatter points (the server's `scatter_points` budget, `serve/analytics_query.go:74`), entity keys and badge metadata. Product code must not import it.
- `tests/gallery/foundations.html` + `.js`: external module scripts only; a page that exercises tokens, registry, tooltip, legend, badges and table in both themes and sets `data-idle` when settled.
- `tests/charts-time/browser.mjs`: `createRequire` loader for `playwright-core`, Chromium launch at `~/.cache/ms-playwright/chromium-1243`, and a named skip reason when either is unavailable.
- `tests/charts-time/foundations.test.mjs`: pure Node palette/registry/formatter checks plus the browser spec.

### Keep untouched

Do not edit `web/index.html`, `web/js/app.js`, `web/js/theme-bootstrap.js`, `web/contract/url-state.js`, the vendored uPlot files, Go code, or the stale `tests/e2e`, `tests/hosted` and `tests/identity` trees. Do not add `package.json`, a lockfile, a bundler config, a route or a panel; do not ship test files; do not add sample data to the product.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test packages/yakka-analytics/tests/charts-time/foundations.test.mjs` → palette/registry/formatter checks pass; the browser test passes, or skips with the exact named reason.
- The first-party palette check → records its contrast and adjacent-slot thresholds and passes them in both themes for the eight hues, fixed neutrals and status colours.
- Registry check → eight slots then labelled/patterned neutrals; `(mixed)`, `(none)`, `(multi)`, `unknown`, `unscored` distinct from `(other)`; persistence key honoured; a toggle/filter leaves surviving assignments unchanged.
- Browser check → tooltip exposes the key under the cursor; legend toggle emits without a request; badges show resolution/sample/coverage; table shows plotted values and is keyboard operable; both themes computed from CSS custom properties; no `console.error`, page error or CSP violation; at most four in-flight analytics requests.
- `node --test packages/yakka-analytics/tests/*.test.mjs` → existing static, URL-state, scheduler, identity and vendor-integrity checks still pass.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it and never add it to a committed dependency file.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, the palette thresholds you committed, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
