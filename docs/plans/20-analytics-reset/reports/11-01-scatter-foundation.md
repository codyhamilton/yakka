# 11-01 — Scatter foundation, session scatter and the P11 fixture scene

Status: `done`. The shared scatter vocabulary, session scatter and the P11
stub/fixture scene are implemented; the pure specs pass 10/10, the Phase 9
workspace suite 72/72 and the Phase 10 suite 54/54. No P11 preset is
registered, `/b/scatter` stays a named destination, and the browser proof of
the panel is deferred to 11-03 as the brief requires.

## What changed

- `web/js/panels/scatter-shared.js`: schema-only `scatterAxes` /
  `scatterColours` with `reason` + `try` unsupported entries, `scatterParams`
  (`grain`, `mode=scatter`, `fields`), canonical row keys (session
  `conversation_id`; sorted-JSON identity objects elsewhere), `scatterRows`
  (null axes excluded from marks, never zero-filled; null size preserved),
  `marginalModel` + `renderMarginals` (existing `<yk-ranges type="histogram">`,
  labelled “whole population”, table each), `regionPredicate` /
  `unionRegion` / `subtractRegion`, `countSelection` (one bounded
  `/entities?mode=aggregate&stat=count&predicate=` request over the frozen
  window), `scatterCaveat` / `scatterPopulationText`, and
  `renderScatterChooser` (numeric x/y, optional colour/size, chart).
- `web/js/panels/scatter-session.js`: panel `scatter-session` (grain
  `session`, `charts:['scatter']`, `requires:['entities_session']`), defaults
  x `cost_usd`, y `commits`, colour `session_model`, size `unpriced_calls`.
  It draws one composed `<yk-chart type="scatter">` with entity keys and a
  session destination, the marginals, the sample/population sentences and the
  unsupported list. A rectangle becomes a canonical range predicate, is
  counted by `countSelection`, and is handed to the tray; additive drags
  union, Alt-drag subtracts; point/checkbox selection keeps the chart's
  existing `in(id)` path.
- `web/js/panels/p11-scatter.js` + `panels/index.js`: registers
  `scatter-session` only. No `scatter` preset is registered.
- `web/js/core/selection-tray.js`: the tray model prefers an explicit
  `selection.predicate` over `decodePick`, prints the exact selected count and
  sampled marks when supplied, and keeps key-selection text byte-identical.
  `buildCohort` accepts a ready `predicate` + `source`, canonicalises and
  budget-validates it, and freezes the absolute scope as before.
- `web/js/app.js`: a frame `select` whose selection carries an explicit
  predicate is stored in `runtime.selection`, refreshes the tray and writes no
  URL `pick`; raw `scatter-rectangle` events are ignored until the panel's
  bounded count re-emits them. `Clear` also drops the stored predicate.
- `web/css/scatter.css`: the scatter panel, chooser, marginal strip and table
  layout. No chart-base edit.
- `tests/workspace/fixture.mjs` + `stub-api.mjs`: additive `p11Schema`,
  `p11Scatter`, `p11Entities`, `p11Aggregate` (opt-in `state.p11`); default
  and P10 bodies are untouched. The stub keeps the existing per-request log.
- `tests/scatter-sessions/{browser,fixture}.mjs` re-export the committed
  Chromium loader and fixture helpers; `scatter.test.mjs` holds the pure specs.

## Verification

Before: the named spec did not exist, so the command failed at import (the
helpers and the `p11SessionId` export were absent). The three commits ahead of
the Phase 10 closure are docs-only (`git show --stat c863b22 acd114f e34f132`),
so the workspace and trends-quality suites were the Phase 10 green tree before
this unit.

First failing run of the new spec (before the helpers existed):

```
$ node --test tests/scatter-sessions/scatter.test.mjs
SyntaxError: The requested module '../workspace/fixture.mjs' does not provide an export named 'p11SessionId'
# pass 0  # fail 1
```

After (`NODE_OPTIONS=--max-old-space-size=8192`):

```
$ node --test tests/scatter-sessions/scatter.test.mjs
# tests 10  # pass 10  # fail 0  # skipped 0

$ node --test tests/workspace/*.test.mjs
# tests 72  # pass 72  # fail 0  # skipped 0

$ node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 54  # pass 54  # fail 0  # skipped 0
```

A plain parallel-file run of the Phase 10 suite reproduces the carried Tools
route-interception race (`tools settles four panels…`, 53/54); the sequential
run above is the evidence run, exactly as 10-06 recorded.

`git diff --check` is clean; no `/tmp` writes; no sleep or animation assertion.
The Chromium loader resolves (`ok:true`, chromium-1243), but no browser spec
was run: the brief defers the panel's browser proof to 11-03, when `/b/scatter`
becomes a delivered board. No gate is recorded because nothing was unreachable.

Fixture counts: 40 deterministic session rows (2 with a null `commits` axis →
38 drawn marks), `population_n` 1,880, `eligible_n` 1,700, `returned_n` 38;
one fixed-bin marginal per axis whose bins sum to the whole/eligible
population.

## Deviations and unresolved seams

- `core/selection-model.js` is unchanged: its existing `canonicalPredicate` /
  `canonicalJson` / `validateCohort` already provide what the new path needs,
  so no additive edit was necessary.
- Axis roles (`x`, `y`, `size`, `colour`) ride in the panel spec's `scope` bag,
  not only `measures`, because `canonicalPanelSpec` sorts `measures` and would
  otherwise lose which measure is the x axis. `scatterParams` still sends the
  explicit `fields` list; the request builder ignores the extra scope keys.
- The brief says `scatterRows` maps “each” row; null-axis rows are mapped and
  then excluded from the drawn marks (kept in the typed population), which is
  the null-axis rule stated two sentences later in the same bullet.
- `scatterAxes` / `scatterColours` take only `(panel, schema)`, so “every
  requested name” is read as the panel's declared measures/lenses (the only
  names available at that seam). `id` and `model` are named unsupported with a
  reason and a `try`.
- The P11 fixture publishes the session grain plus artifact, plan, time,
  execution and content grains at their 17.3 lists so later units extend one
  scene. Only the session bodies exist at this commit.
- Seam mismatch, not a contract contradiction: the chart's existing `select`
  detail carries `selection` as a predicate node and a separate `region`,
  while the brief describes a selection that “carries a `predicate`”. The
  panel re-emits a selection object with `.predicate` and the frame ignores the
  raw rectangle event, so both shapes are handled without changing the chart
  kit. No brief-vs-contract contradiction was found.
