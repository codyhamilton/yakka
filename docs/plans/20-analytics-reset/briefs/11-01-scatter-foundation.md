# Brief: 11-01 — Scatter foundation, session scatter and the P11 fixture scene

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/scatter-shared.js`, `scatter-session.js`, `p11-scatter.js`, `panels/index.js`, `packages/yakka-analytics/web/js/core/selection-tray.js`, `packages/yakka-analytics/web/js/core/selection-model.js`, `packages/yakka-analytics/web/js/app.js`, `packages/yakka-analytics/web/css/scatter.css`, `packages/yakka-analytics/tests/scatter-sessions/browser.mjs`, `fixture.mjs`, `scatter.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `stub-api.mjs`, and `docs/plans/20-analytics-reset/reports/11-01-scatter-foundation.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/11-01-scatter-foundation.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phases 4, 5, 6, 7, 8, 9 and 10.
Runs alongside: nothing; it establishes the P11 scene, the scatter request/model seam and the selection/tray range seam that 11-02 to 11-05 extend.
Budget: 24 files to read, about 1,600 lines to change, 52 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 11 outcome, the Interaction model (four distinct things, selection tray, gestures, linking, honest uncertainty), the panel catalog and preset mapping, and the entity-explorer sessions contract.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.1 (window/budgets), 17.2 (schema offers), 17.3 (`session` grain measures and lenses; `/entities` list, scatter and aggregate modes; typed populations), 17.3.1 (scope elements, predicate grammar, capability matrix, population/relation shapes) and 17.5 (scatter element, colour registry, table and `inspect()`).
3. `docs/plans/20-analytics-reset/CONTRACTS.md` — 7.1 and 7.2 for the shared filter and `/conversations` semantics that the session grain extends.
4. `packages/yakka-analytics/web/js/panels/{p10-shared,pulse-strips,panel-frame,registry,index}.js` and `packages/yakka-analytics/web/js/boards/{presets,board}.js` — the existing request, window, panel and preset seams.
5. `packages/yakka-analytics/web/js/core/{view-spec,selection-model,selection-tray,chips,inspector}.js` — the selection predicate, cohort JSON, tray actions and URL state.
6. `packages/yakka-analytics/web/js/app.js` — how a frame's `select`, `cohort`, `inspect` and `scope` events reach the tray and router.
7. `packages/yakka-analytics/web/js/charts/{yk-chart,scatter,canvas-scatter,hit-test,yk-ranges}.js` — read the scatter model, rectangle `onSelection` payload (keys plus data-space `region`) and `inspect()`/legend surfaces; do not edit the chart kit.
8. `packages/yakka-analytics/tests/workspace/{harness,fixture,stub-api}.mjs` and `packages/yakka-analytics/tests/trends-quality/{acceptance.test,fixture}.mjs` — the stub-scene and route-mocking pattern.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Give Phase 11 its shared scatter vocabulary — schema-valid numeric axes, categorical colour, numeric size, sampled marks, whole-population marginals, and a rectangle that becomes a canonical entity predicate with an exact server count — then prove it on the session grain and leave a P11 stub scene the later units fill without changing Phase 9 or Phase 10 behaviour.

## Contract

- DESIGN.md Phase 11: numeric axes/size and categorical colour are schema-valid across session/artifact/plan/time grains; samples are labelled and marginals match whole populations; rectangle unions/subtractions and explicit tray actions produce server-resolved cohorts; unsupported cross-grain pairings say why.
- DESIGN.md Interaction model: a numeric scatter rectangle denotes every eligible entity in that region including unsampled ones; the tray obtains the exact population count from a bounded server predicate query and labels sample marks separately; source additions/subtractions use Boolean predicates, never inferred sample identities; `Filter all` resolves the selection to C then includes its sessions, `Exclude this` resolves the same positive selection then removes C (`op=exclude`). Hover and an in-progress drag never change the URL; a committed tray action does.
- CONTRACTS.md 17.3: `…/entities?grain=<g>&mode=scatter&fields=<2..4 measures>` returns every entity when the population is within `budgets.scatter_points`, otherwise a deterministic hash sample with `sampled`, `sample_rule`, `population_n`, `returned_n`, plus `marginals` over the whole population. Session measures are exactly `cost_usd`, `unpriced_calls`, `model_calls`, `tokens_in|out|cache_read|cache_write|reasoning`, `hook_events`, `commits`, `artifact_versions`, `distinct_content`, `duration_s`, `first_ts`, `last_ts`; lenses are `harness`, `session_model`, `session_repo`, `origin`, `has_artifacts` (and `id` for explicit marks only). Model is never a numeric axis.
- CONTRACTS.md 17.3.1: predicate nodes are exactly `and`, `or`, `not`, `range` (inclusive), `in`, `is_null`; a rectangle is ranges on the two numeric measures; canonical JSON sorts keys and values; budgets are the published scope/predicate limits. A cohort is `{v:1, grain, scope:{from,to,tz,include,exclude}, predicate, op, source?}` with a frozen absolute scope.
- CONTRACTS.md 17.5: no dual axes, a legend whenever there are two or more groups, units and time basis in the frame, a table for every chart, and `inspect()` is the test surface. The existing `<yk-chart type="scatter">` canvas fallback already emits `select` with `keys` and a data-space `region`; compose it, add no chart type and no dependency.
- Carried from Phase 10: browser evidence depends on `playwright-core` under `NODE_PATH` and the Chromium 1243 cache, both outside the worktree; a spec that cannot reach them skips with the named reason and records a gate. Charts paint on the frame after a panel goes idle, so browser specs read `inspect()` rather than sleeping.

## Changes

### Shared scatter model and request seam

- Add `panels/scatter-shared.js` with pure helpers and one render seam:
  - `scatterAxes(panel, schema)` and `scatterColours(panel, schema)` returning only names the grain publishes in `/schema.grains[grain]` (`measures`/`predicate.measures` for numeric axes, `lenses`/`predicate.lenses` for colour); `id` is an identity lens, not a colour; `model` is categorical and never a numeric axis on the artifact grain. Return an `unsupported` entry with `reason` and `try` for every requested name the schema does not publish.
  - `scatterParams({scope, spec, grain, fields})` built on `p10-shared.requestParams`, adding `grain`, `mode=scatter` and `fields=<x,y[,size]>`. Never invent a measure, dim or window.
  - `scatterRows(body, spec)` mapping each `{id,m,l,flags}` row to `{key,x,y,group,size,sampled,values}`. The key is the canonical compact identity: a session's `conversation_id` string; the sorted-JSON `id` object for artifact/plan/time rows (`{"path","repo_id"}`, `{"plan","repo_id"}`, `{"t","tz"}`). Keep null axes out of the drawn points but leave them counted in the population; do not zero-fill a missing score.
  - `marginalModel(body.marginals, fields)` reading the server's fixed bins for each field, and a renderer that labels them "whole population" and offers a table. Use the existing `<yk-ranges type="histogram">` element, not a new chart.
  - `regionPredicate(region, xMeasure, yMeasure)` returning `{and:[{range:{measure:x,lo,hi}},{range:{measure:y,lo,hi}}]}` in the published grammar; `unionRegion(previous, rectangle)` → `or`; `subtractRegion(previous, rectangle)` → `and(previous, not(rectangle))`; an empty first rectangle is the rectangle itself. Never expand a rectangle into sampled `id` keys.
  - `countSelection({transport, grain, scope, predicate, tenant, signal})` issuing one bounded `/entities?grain=<g>&mode=aggregate&stat=count&predicate=<canonical JSON>` request over the same frozen window and reading `population` (and `relation.associations` when present). This is the tray's exact-population count; no client sum of a page.
  - `scatterCaveat(spec, body)` returning the sample sentence ("sample of N of M; marginals are the whole population") and the association-not-cause line, and `scatterPopulationText(body)` naming the unit and the sampled/returned/eligible counts.
  - A `renderScatterChooser` seam for numeric x, numeric y, colour (optional), size (optional) and chart, dispatching a composed `spec` event exactly like `renderChooser`; a measure/lens list comes from the schema, never a hard-coded contract.
- Extend `core/selection-tray.js` and `core/selection-model.js` additively:
  - `selectionTrayModel` prefers an explicit `selection.predicate` when present (a rectangle) over `decodePick(state.pick)`; its text says grain, entity unit, exact selected population when supplied, and sampled marks when supplied. Key selections keep the existing text exactly.
  - `buildCohort` accepts an optional ready `predicate` and optional `source`; when a predicate is passed it is canonicalised and budget-validated instead of being rebuilt from keys. The frozen absolute scope and the `scopeElements` include/exclude path are unchanged.
- Extend `app.js` additively: in the frame `select` listener, when `event.detail.selection` carries a `predicate` (a rectangle), store it in `runtime.selection`, refresh the tray and do not write `pick` — the transient predicate is not URL state. Key selections keep the existing `pick` path. The tray's `Filter all`, `Exclude this` and `Make cohort A–D` buttons must therefore act on the stored predicate; do not change the inspector action set or the router semantics.
- Add `panels/p11-scatter.js` with the scatter registration entry point; `panels/index.js` imports and calls it. It registers only panel ids that exist at this commit and does **not** register a `scatter` preset yet, so `/b/scatter` stays the Phase 11 named destination until 11-03. 11-02 and 11-03 extend the same module.

### Session scatter

- Add `panels/scatter-session.js`:
  - Panel id `scatter-session`, grain `session`, `charts: ['scatter']`, `requires: ['entities_session']`, caveats naming association-not-cause, sampled marks, unpriced/lower-bound cost and duration as observed span.
  - Default `scope`/spec: x `cost_usd`, y `commits`, colour `session_model`, size `unpriced_calls`; every alternate x/y/size comes from the published session measures and every colour from the published session lenses.
  - Load `/entities?grain=session&mode=scatter&fields=…` through the shared request builder, render one `<yk-chart type="scatter">` with entity keys, plus the marginal histograms, the table, the population/sample sentence and the unsupported list. Set `spec.entities` so the shared inspector can open a session destination.
  - On `select` with a rectangle, build the canonical range predicate from the event's `region` and the panel's measure names, call `countSelection`, and hand both the predicate and the exact count to the tray. Additive drags union ranges; Alt-drag subtracts. Explicit point clicks/checkbox behaviour remains the existing `in(id)` path.
  - On a renderer error, use the one panel state vocabulary; a missing feature or an unpublishable axis/lens is `unsupported` with its reason and nearest supported choice.
- Add `css/scatter.css` for the scatter panel, marginal strip and table; no chart-base edits.

### P11 fixture and stub scene

- Extend `tests/workspace/fixture.mjs` with a `p11Schema()` and `p11Fixture()` that are opt-in and leave the default and P10 bodies byte-identical. The schema publishes the 17.3 session measures/lenses above and the artifact/plan/time grains at their 17.3 measure and lens lists, with `predicate` covering every published axis/lens and the scope budgets from 17.2. Publish sample/population fields and non-empty `marginals` on the session scatter body.
- Extend `tests/workspace/stub-api.mjs` with a `p11` state flag: when true it serves `p11Schema()`, deterministic session list and session scatter bodies from the fixture, and the P11 bodies added by 11-02 to 11-04; when false every current response is byte-identical. Keep a per-request log (route and query) for later units.
- Add `tests/scatter-sessions/browser.mjs` re-exporting the existing Chromium loader and named skip reason, and `tests/scatter-sessions/fixture.mjs` re-exporting the committed fixture helpers. Do not duplicate the loader.
- Add `tests/scatter-sessions/scatter.test.mjs`: pure tests for schema-only axis/colour choices, request parameters (`mode=scatter`, `fields`), row-key canonicalisation and null handling, marginals from whole-population bins, region/union/subtraction predicates, canonical cohort JSON with a frozen scope, and the tray's explicit-predicate text. Browser proof of the panel itself is deferred to 11-03, when `/b/scatter` becomes a delivered board; say so in the report rather than skipping anything silently.

### Keep untouched

- The Phase 9 and Phase 10 panel ids, presets, Start paths, routes, chips/tray key grammar, inspector action set and frame state names.
- The chart kit: `<yk-chart>`, `<yk-ranges>`, `<yk-bars>`, `<yk-matrix>`, `<yk-lanes>` and `<yk-treemap>` behaviour, including their current `inspect()` shape when the new options are absent. No new chart type, gesture or dependency.
- `p10-shared.js` semantics, `pulse-strips.js` window parsing, `boards/presets.js` preset ids and the `scatter` named destination (it remains named until 11-03).
- No new server route, grain, join, dependency, gesture or contract; do not edit Go files.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/scatter-sessions/scatter.test.mjs` (workdir `packages/yakka-analytics`) → all pure checks pass, including region→range predicate, union/subtraction canonical JSON, frozen cohort scope, schema-only axis/colour offers, and the exact-count request shape.
- `node --test tests/workspace/*.test.mjs` → the Phase 9 and Phase 10 workspace suite stays green with no P11 preset registered and `/b/scatter` still a named destination.
- `node --test tests/trends-quality/*.test.mjs` → the Phase 10 suite stays green; the chart kit and `p10-shared` behaviour is unchanged when the new options are absent.
- `git diff --check` clean; no `/tmp` writes; no fixed sleeps or animation assertions.
- The report records the exact before/after outputs, the fixture counts used, the deferred browser proof (11-03), and any deviation from this brief and why.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
