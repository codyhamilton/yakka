# Brief: 7-05 — Gallery and browser acceptance

Consumer: the Phase 7 runner and the execute-phase verifier; this unit proves the phase outcome.
Owned paths: `packages/yakka-analytics/tests/gallery/{index.html,index.js}`, `packages/yakka-analytics/tests/charts-time/acceptance.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/7-05-gallery-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 7-04.
Runs alongside: nothing; it closes the phase outcome over every earlier unit.
Budget: 16 files to read, about 600 lines to change (mostly tests), 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` Phase 7 outcome and the Interaction model (Gestures, Compare, Accessibility and responsiveness baseline); Chart kit; Scope vocabulary.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 (testability and dataviz rules) and 17.7 (browser harness rules).
3. `docs/plans/20-analytics-reset/briefs/7-01` to `7-04` — the contracts each unit already proved, so this unit does not re-derive them.
4. `packages/yakka-analytics/tests/gallery/` and `tests/charts-time/` as they stand after 7-04; `tests/gallery/fixture.js`; `tests/charts-time/browser.mjs`.

Read ranges and grep; do not re-read a file already in context.

## Goal

Provide the gallery index that links every Phase 7 case and the browser acceptance suite that proves the phase's single outcome across every unit, including badges, both themes, the table view and the declared scatter fallback.

## Contract

- DESIGN.md Phase 7 outcome is the yardstick, quoted: real mouse/keyboard/touch interactions on line, area, stacked columns, cumulative/share, ECDF and numeric scatter produce the interaction contract's settled states; hover/inspect, selection union/subtraction, brush versus zoom, pan, legend behaviour and history are verified using chart coordinates and the table view; scatter hit-testing and rectangle membership match an independent reference at the point budget; resolution/sample/coverage badges and both themes are correct; if uPlot cannot carry scatter, the declared first-party canvas fallback satisfies the same proof without another dependency.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline" and "Testability surface" are acceptance criteria, not suggestions: data-chart/data-state, `inspect()`, units/time basis, legend, zero-based columns, table view, no dual axes, no animation.
- CONTRACTS.md 17.7: Chromium only via `playwright-core`, Node runner, no fixed sleeps, wait on `html[data-idle="true"]` and explicit end state, real events at `inspect()` coordinates, console/CSP failure, at most four in-flight analytics requests, tests not shipped.
- The phase's single outcome is unchanged. This unit adds no chart type, gesture, route, panel, dependency or contract.

## Changes

- `tests/gallery/index.html` + `index.js`: the gallery index linking the 7-01 foundations, 7-02 time-series, 7-03 gestures and 7-04 scatter pages; external modules only; each page sets `data-idle` only when its charts are settled; deterministic data from `fixture.js`; a test-only display of the current theme and case name.
- `tests/charts-time/acceptance.test.mjs`: one end-to-end suite that opens every gallery page and asserts the phase outcome:
  - every mode (line, area, stacked columns, cumulative, share, ECDF, numeric scatter) reaches `ready` and its table values equal the plotted data;
  - hover and keyboard focus, inspect, selection union/subtraction, brush versus zoom, pan, legend toggle/focus/isolate, keyboard grammar, touch tap/*Select*/pinch and history/Back;
  - resolution/sample/coverage badges appear with their labelled counts, not a blended percentage;
  - both themes read correct tokens, keep entity colours stable across modes and filters, keep `(mixed)`/`(none)`/`(multi)`/`unknown`/`unscored` distinct from `(other)`, and pass the committed first-party palette check;
  - the accessible table toggles open by keyboard and shows the plotted values;
  - below 900 px the gallery chart frames stack in one column and interactive targets are at least 44 px;
  - no chart animates; no `console.error`, page error or CSP violation; at most four in-flight analytics requests;
  - the scatter proof uses the 7-04 independent reference at the 5,000-point budget, and the declared uPlot-or-first-party-canvas outcome from 7-04 is the one exercised.
- Keep the suite resilient to per-unit specs: it may import shared helpers from `tests/gallery/harness.mjs` and `tests/charts-time/browser.mjs`; if it needs a new helper, add it to this unit's owned files only or report a contradiction.

### Keep untouched

Do not change chart implementation, the foundations, the gesture engine or the scatter modules; if an acceptance check exposes a genuine gap, report it against the owning unit instead of weakening the assertion or editing that unit's files here. Do not touch the stale `tests/e2e`, `tests/hosted` or `tests/identity` trees. Do not add a dependency, route, panel or product data path; do not ship tests.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test packages/yakka-analytics/tests/charts-time/acceptance.test.mjs` → the full phase-outcome matrix passes, or skips with the exact named browser reason.
- Every gallery page opened by the suite reaches `html[data-idle="true"]` and a settled `data-state`; no fixed sleep appears in the suite.
- Badge/theme/table checks → all resolution/sample/coverage badges and both themes pass; table values equal the plotted data; entity colours are stable across modes/filters; the named neutral values stay distinct.
- Scatter proof → the 7-04 independent reference matches at 5,000 points, and the suite exercises the uPlot-hook or first-party-canvas path 7-04 declared.
- Regression → `node --test packages/yakka-analytics/tests/*.test.mjs` and the 7-01 to 7-04 focused specs still pass; no `console.error`, page error or CSP violation; no animation.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, the phase-outcome coverage matrix (which check proves which outcome clause), any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
