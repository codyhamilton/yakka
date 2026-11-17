# Brief: 9-02 — Chips, selection tray, inspector and capability inspector

Consumer: the Phase 9 interaction worker.
Owned paths: `packages/yakka-analytics/web/js/core/{chips,selection-model,selection-tray,inspector,capability-inspector}.js` (new), `packages/yakka-analytics/web/js/app.js` (mount only), `packages/yakka-analytics/web/css/workspace.css`, `packages/yakka-analytics/tests/workspace/{tray.test.mjs,inspector.test.mjs,capability.test.mjs}`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/9-02-tray-inspector.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 9-01.
Runs alongside: 9-05.
Budget: 16 files to read, about 900 lines to change, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3 — predicate grammar, canonicalisation and budgets, typed populations, time-cohort resolution, activity/Follow; 17.3.1 — scope elements, Boolean meaning, source-reproduces-panel rule, capability matrix, routes accepting `cohort=`, population/relation/association reporting; 17.5 — tooltip/legend/selection/table testability surface.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Interaction model (four distinct things, selection tray, gestures table, keyboard, touch, linking, compare, honest uncertainty, accessibility/responsiveness baseline); Panels, boards and question paths (capability inspector); Workspace shell and state (chips, panel states, reconciliation).
3. `packages/yakka-analytics/web/js/core/{router,view-spec,panel-state}.js`, `web/js/panels/panel-frame.js`, `web/js/boards/{board,presets}.js`, `web/js/app.js` — the 9-01 seams you mount into; do not rewrite them.
4. `packages/yakka-analytics/web/js/charts/{svg-base,legend,selection,tooltip,table,badges}.js` — the existing selection/inspect/legend surface; read exports and events only, do not edit them.
5. `packages/yakka-analytics/tests/workspace/{harness.mjs,fixture.mjs,stub-api.mjs,browser.mjs}` — the harness, deterministic rows and scenes you drive.
6. `packages/yakka-analytics/tests/gallery/bars.js` and `tests/charts-cat/bars.test.mjs` — where legend focus currently emits a null filter (the carried Phase 8 seam you must map correctly).

Read ranges and grep; do not read a whole file to find one section.

## Goal

Make the shared narrowing and inspection grammar real: removable scope/filter/cohort/selection chips, a selection model and tray that build the contract's Boolean predicate and state its grain, predicate, counts with units and sample marking, an entity inspector that opens as a side panel and a bottom sheet below 900 px, and a per-panel capability inspector that explains provenance and missing capabilities.

## Contract

- **Four distinct things.** *Scope* is the board window/filters. *Brush* (`sel`) transiently narrows linked peers while its source retains context; clearing restores peers; zoom commits it to scope. *Selection* (`pick`) highlights marks by a Boolean entity predicate and does not requery cross-grain peers until a tray action. *Cohort* A–D is a named URL-carried definition with a fixed absolute source scope. Do not merge these.
- **Selection tray.** It states grain, predicate and counts with units ("143 sessions of 1,880 in scope; 38 sampled marks visible") and offers *Make cohort A to D*, *Filter all panels to this*, *Exclude this*, *Zoom* for time, *Open as list*, *Clear*. `Filter all` resolves the selection to C then includes its sessions; `Exclude this` resolves the same positive selection then removes C from the target session population (`op=exclude`), never complementing artifacts before their join. Both name artifact/plan expansion. A numeric scatter rectangle is Phase 11; do not implement one. Time selections are the time brush/`sel` and resolve to contributing sessions per 17.3, with missing/orphan rejection associations in their own unit from `population.relation.associations`, never folded into a session count. A mark a panel emits always resolves if the schema offers it; otherwise `unsupported` with the server's reason.
- **Cohort grammar.** `cohort=` is canonical URL-percent-encoded JSON `{v:1, grain, scope:{from,to,tz,include,exclude}, predicate, op:include|exclude, source?}`. A predicate node is exactly `and`, `or`, `not`, `range`, `in`, or `is_null`; ranges are inclusive, null ranges are false, `not` complements within the declared grain/scope; keys/values are canonicalised, commutative children and values sorted/deduplicated. Budgets: 64 leaves, 64 values per `in`, depth 8, four cohorts, 8 KiB total encoded view URL; over budget leaves scope unchanged and offers a smaller region, never clips. Source scope elements are `{lens, values}` over `/schema.grains[grain].filters`; include OR within a lens and AND across lenses, exclude AND NOT IN; `scope.exclude` and `op=exclude` are distinct and labelled separately.
- **Chips.** Render every applicable scope/filter/cohort/selection chip; name "not applied here: X" for ignored filters or missing joins; removing a scope/filter chip is a scope change and pushes history; cohort chips use the fixed A–D cohort colours. Legend **focus** must map a series key to a contract lens name before it emits a board filter. Bars/mover legends list measures, so a series with no lens name must not emit `filter` with a null value; leave the board unchanged and name the unmapped focus. Absorb the Phase 8 carried seam here.
- **Inspector.** Click a mark or press Enter: side panel on wide screens, bottom sheet below 900 px, with the entity's facts and actions *Open* (its explorer), *Filter to*, *Exclude*, *Add to cohort*, *Copy link*. *Open* for an explorer delivered later shows the named destination; for a delivered explorer it navigates. *Copy link* copies the current committed URL including the committed selection and fixed cohort scopes. Keyboard and touch reach every action without hover; focus is visible and order is defined; Esc closes.
- **Capability inspector.** A drawer on every panel lists its queries (route and parameters, provenance only, not navigation), grain, units, time basis, budgets from `/schema.budgets`, coverage, caveats, and any missing capability with its source (this plan's phase or a design-only plan). It reads the panel's `requests()` metadata from the 9-01 frame/registry; it does not invent a route or issue its own data request.
- **Honest uncertainty and accessibility.** Apply the panel-type banners named in DESIGN.md (quality comparative, association not cause, sample of N of M with whole-population marginals, overlapping plan cost, unattributed repo share). Colour never carries meaning alone; `prefers-reduced-motion` and `prefers-color-scheme` honoured; no animation; single column below 900 px.
- Settled: no new route, grain, join, gesture, panel or contract change. Do not edit chart modules; if the chart event detail lacks a needed field, report the contradiction.

## Changes

- `selection-model.js`: pure builder/normaliser for the predicate grammar, canonical JSON, selection objects `{grain, predicate, unit, counts, sampled}`, cohort JSON (scope freezes absolute bounds), op include/exclude, and budget validation. Export the tray's data model so it is unit-testable without a browser.
- `chips.js`: render applicable scope/filter/cohort/selection chips into the frame's chip slot; mark "not applied here"; wire removal to the router's push-history scope update; map a chart legend-focus `{filter, value}` or series `lens` to a real contract lens name and suppress null mappings. Keep unknown URL keys untouched.
- `selection-tray.js`: the tray UI and actions. "Make cohort" writes `ca`–`cd` in the URL (definition, fixed window) and pushes history; "Filter all" resolves to a cohort and applies it to the board; "Exclude" uses `op=exclude`; "Zoom" commits `from`/`to` and clears `sel`; "Open as list" routes to a delivered explorer (`/ledger` for event selections; a named destination otherwise); "Clear" removes the transient selection. Show counts from the panel's typed `population` and the sample label; never invent a count.
- `inspector.js`: side panel/bottom-sheet element with facts, actions and focus management. Mount it from `app.js`; listen to the frame's inspect events; open with the mark's entity key. No chart edits.
- `capability-inspector.js`: drawer rendered from the panel's `requests()`/registry entry and `/schema`; render budgets, coverage, caveats, unsupported reason and capability source. No request of its own.
- `app.js`: mount chips/tray/inspector/capability-inspector into the 9-01 frame slots and route their events; preserve Start, saved boards, Follow and the state machine. Do not re-implement the router.
- `workspace.css`: tray, inspector, bottom sheet at `max-width: 899px`, chip, drawer and focus styles. No animation/transition.
- `tests/workspace/tray.test.mjs`: pure predicate/canonical/cohort/budget checks, chip add/remove model, legend mapping (a series with `lens:'harness'` yields a harness filter; a measure-only series yields none), and count/unit/sample formatting.
- `tests/workspace/inspector.test.mjs`: Chromium spec over the harness: click and keyboard open the inspector with the expected entity; a 800 px viewport renders the bottom sheet (assert the element's role/position end state, not animation); actions are present and focus returns on close; Copy link contains the committed selection.
- `tests/workspace/capability.test.mjs`: Chromium spec: the drawer lists the panel's route and parameters, grain, units, time basis, `/schema.budgets`, coverage flags, caveat text, and for a missing feature the source; an unsupported combination names the nearest supported choice.

### Keep untouched

Do not edit `web/js/charts/*`, `web/css/charts.css`, `web/js/core/{router,view-spec,panel-state,follow,saved-boards}.js`, `web/js/panels/{registry,panel-frame}.js`, `web/js/boards/*`, the stub/harness, any Go file, or `tests/e2e/*`, `tests/hosted/*`, `tests/identity/*`. No dependency, route, chart, grain, join or storage key. No product branch on being under test; no fixture or `data-test` hook in product code.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/workspace/tray.test.mjs packages/yakka-analytics/tests/workspace/inspector.test.mjs packages/yakka-analytics/tests/workspace/capability.test.mjs` → all pass, or browser tests skip with `SKIP_REASON` and the run records the gate.
- `NODE_PATH=… node --test packages/yakka-analytics/tests/url-state.test.mjs packages/yakka-analytics/tests/workspace/engine.test.mjs` → no regression.
- Observable: selecting two marks shows "2 <unit> of N in scope" with the unit; Make cohort A writes a canonical `ca` definition and keeps the URL within 8 KiB; removing a filter chip pushes history and Back restores it; a bars/measure legend focus adds no null filter chip and the panel names the unmapped focus; clicking a mark opens the inspector and at 800 px the bottom sheet; the capability drawer lists the panel's route+parameters and the missing-feature source; no console error/page error/CSP violation and `maxInFlight <= 4`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
