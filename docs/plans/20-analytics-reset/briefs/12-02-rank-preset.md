# Brief: 12-02 — Plan-cost rank mode and the Workflow preset

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/rank.js`, `packages/yakka-analytics/web/js/panels/p12-workflow.js`, `packages/yakka-analytics/web/css/workflow.css`, `packages/yakka-analytics/tests/plans-artifacts/rank-preset.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, `packages/yakka-analytics/tests/workspace/engine.test.mjs`, `packages/yakka-analytics/tests/workspace/acceptance.test.mjs`, and `docs/plans/20-analytics-reset/reports/12-02-rank-preset.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-02-rank-preset.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 12-01 (the two plan panels, their registration module and the P12 fixture/stub scene).
Runs alongside: nothing; it edits the shared registration module, CSS and P12 scene.
Budget: 12 files to read, about 550 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome; panel catalog `rank` row; the preset row for `workflow` (around line 195); the Boards/Interaction contract for named presets, inspect → Open and overlapping cost labels.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 plan measures/lenses, `/entities?grain=plan` list/sort/cursor and typed populations, plan→sessions cost overlap (`associated_cost_usd`, `shared_sessions`, lower bound/null rules), and 17.5 bar/legend/table rules.
3. `packages/yakka/internal/serve/analytics_entities.go` — `analyticsPlanEntities` sort validation and row fields; `packages/yakka/internal/store/plan_entities.go` — plan measures. Use only served names.
4. `packages/yakka-analytics/web/js/panels/rank.js` — the existing ranked bar/slope panel, its load branch, chooser and table.
5. `packages/yakka-analytics/web/js/panels/p12-workflow.js` and `panels/index.js` — the registration seam from 12-01.
6. `packages/yakka-analytics/web/js/boards/presets.js`, `panels/p11-scatter.js` and `panels/p10-*.js` — delivered preset/spec registration.
7. `packages/yakka-analytics/tests/workspace/{engine,acceptance,start}.test.mjs`, `tests/plans-artifacts/workflow.test.mjs`, `tests/workspace/{fixture,stub-api}.mjs` — the expectations that change and the P12 scene.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Add a plan-grain ranking mode to the existing `rank` panel (plan-associated cost and other plan measures) and register the five-panel Workflow preset that opens the relevant plan, so `/b/workflow` becomes a delivered board.

## Contract

- Preset row: `workflow` = `shape-bars`, `plan-timeline`, `rank` by plan-associated cost, `scatter-plan`, `river`; "Plan/execution inspect → plan contents and related session; overlapping cost and process shape are labelled".
- CONTRACTS 17.3 plan measures: `artifacts` by kind, `versions`, `sessions`, `shared_sessions`, `associated_cost_usd` (+ `unpriced_calls`), `executions_complete|unreported|started`, `complete_share`, `design_score:<check>`, `span_days`, `first_ts`, `last_ts`; lenses `repo_id|harness|session_model`. `associated_cost_usd` is the sum of associated sessions' in-window costs and is **non-additive across plans**; `shared_sessions` counts sessions touching more than one plan; any total over plans is labelled overlapping. All-unpriced is null; partially priced is a lower bound; never `$0` for unpriced.
- CONTRACTS 17.3 route: `/entities?grain=plan` takes the shared filter (including `cohort=` and `exclude`), `sort=<plan measure>:asc|desc`, `limit` at most `page_max`, keyset `cursor`, rows `{id:{repo_id,plan}, m, l, flags}` and typed `population`; totals come from the server, never the returned page. Sort by a measure only when the schema publishes it.
- DESIGN.md Boards: a delivered preset is a named board of registered panels with canonical specs; it stops resolving as "Delivered in Phase 12". Named destinations are data, never an empty board. The board caps at 12 panels.
- CONTRACTS 17.5: ranked bars are zero-based, a legend is present, units/time basis in the frame, and a table is always available. The existing `rank` behaviour, legend focus and inspect contract stay intact.
- Carried: `scatter-plan`'s non-additive cost banner is already delivered; this unit must not total plan costs or change its meaning. `river` is Phase 9's activity timeline, reused unchanged.

## Changes

### `rank` plan mode

- Keep the time-grain path byte-compatible. Add an explicit branch when `spec.grain === 'plan'` (or `spec.scope?.grain === 'plan'`); never infer plan mode from a measure name alone.
- In plan mode:
  - Read the plan grain from `/schema`; offer only published plan measures as the ranking measure, default `associated_cost_usd`. If the requested measure is not published, render `unsupportedState` naming `/schema`, never an empty chart.
  - Build request parameters for `/entities?grain=plan`: shared window (`all=1`, `from`, `to`, `tz`), `repo_id`, `harness`, `session_model` include filters, `exclude`, the first valid cohort from `cohortParams(scope)`, `sort=<measure>:desc`, and `limit` = `top_max` capped by `page_max`. Do not send time-only parameters.
  - Map rows to `{key: canonical plan JSON, label: "<repo>/<plan>", values:{measure}, lenses, flags, identity}`; keep nulls out of marks and count them. Bars rank by the chosen measure; the table shows identity, the measure, `associated_cost_usd`, `shared_sessions`, `unpriced_calls`, `sessions`, executions and `last_ts`.
  - For `associated_cost_usd`, render the overlap banner: "Associated cost sums sessions and overlaps across plans; N sessions touch more than one plan." Show a lower-bound marker when any row is flagged and "all unpriced" for null rows. Never sum the returned page into a plan-exact total.
  - Inspect facts name the plan identity, cost overlap/lower bound and executions; entity destination `/plans/<repo>/<plan>`; Open navigates there. Empty/error/cancelled states use the one vocabulary.
  - Period/cohort comparison modes are time-grain only. If `spec` asks for comparison in plan mode, render `unsupportedState` ("period comparison is time-grain only"), not a misleading slope.

### Workflow preset

- Extend `p12-workflow.js` to import/confirm `shape-bars`, `plan-timeline`, `rank`, `scatter-plan` and `river` are registered and, when `/b/workflow` is requested, register:
  - `workflow` with `panels: ['shape-bars','plan-timeline','rank','scatter-plan','river']`;
  - specs: `shape-bars` plan process shape, `plan-timeline` plan timeline, `rank` plan-grain associated cost, `scatter-plan` the delivered cost/artifacts scatter, `river` default activity.
- Ensure `registerP12WorkflowPanels()` remains idempotent and `panels/index.js` still imports it once. Export `WORKFLOW_PRESET_ID` and specs for tests.
- The board must settle all five panels from the P12 stub; no panel may be left as a named destination. Clicking `shape-bars`, `plan-timeline`, `rank` or `scatter-plan` marks opens the corresponding plan detail (12-05 serves the list/detail; at this unit Open may name `/plans/<repo>/<plan>` even before 12-05 converts the route — but the preset itself must not name a delivering phase).

### Fixture and tests

- Extend the P12 stub scene with any plan rows/measures, schema measures and sort responses the rank plan mode needs; keep P10/P11 bodies byte-identical and the P12 additions deterministic.
- Add `tests/plans-artifacts/rank-preset.test.mjs`:
  - pure: plan params contain no time-only keys; measure validation; row mapping/null handling; overlap/lower-bound text; plan destination; spec/preset panel ids and order; rank plan mode rejects comparison.
  - Chromium: `/b/workflow` settles `shape-bars`, `plan-timeline`, `rank`, `scatter-plan`, `river`; the rank panel shows plan labels and the overlap banner; Open reaches `/plans/<repo>/<plan>`; `maxInFlight <= 4`; clean diagnostics.
- Leave `tests/workspace/engine.test.mjs`'s static `presetDestination('workflow').phase === 12` expectation unchanged: that spec imports `boards/presets.js` without the registration modules, so it continues to test the declared named preset, not the app's registered board. Prove the delivered board through the browser app instead.
- Add a pure registration assertion in `rank-preset.test.mjs`: importing `panels/p12-workflow.js` registers the five panel ids and overwrites the `workflow` preset with a board; `presetDestination('workflow').kind === 'board'` after that import, and `validatePresets()` passes.
- Update `tests/workspace/acceptance.test.mjs`: for `/b/workflow`, turn the P12 scene on, settle the five panels, and no longer assert "Delivered in Phase 12" for that path. Keep `/plans` as the remaining named destination until 12-05 updates it. The Start link count stays 15 and the legacy-server disabled count stays 10.

### Keep untouched

- `shape-bars.js`, `plan-timeline.js` beyond the exported registration seam; 12-01 owns their internals.
- `scatter-plan.js`, `river.js`, `presets.js` and the P10/P11 specs; reuse them unchanged.
- `/plans` and `/artifact` route conversion and explorers (12-03/12-05/12-06).
- No server, Go, migration, dependency, route, grain, join or gesture change; no summing plan costs; no new panel id.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/rank-preset.test.mjs` → pure and Chromium checks pass; a missing browser dependency skips with the named reason.
- `NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/rank-preset.test.mjs` → `/b/workflow` settles five panels, the registration assertion shows a board, and `maxInFlight <= 4`.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs` → the updated `/b/workflow` browser expectation passes; `/plans` still names Phase 12; the static engine preset expectation is unchanged.
- `node --test tests/workspace/*.test.mjs` and `node --test tests/scatter-sessions/*.test.mjs` → green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the before/after outputs, the exact plan sort/params sent, the overlap/lower-bound rendering, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
