# Brief: 12-01 — Workflow process-shape and plan-timeline panels

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/shape-bars.js`, `packages/yakka-analytics/web/js/panels/plan-timeline.js`, `packages/yakka-analytics/web/js/panels/p12-workflow.js`, `packages/yakka-analytics/web/js/panels/index.js`, `packages/yakka-analytics/web/css/workflow.css`, `packages/yakka-analytics/tests/plans-artifacts/browser.mjs`, `packages/yakka-analytics/tests/plans-artifacts/workflow.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, and `docs/plans/20-analytics-reset/reports/12-01-workflow-panels.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-01-workflow-panels.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: nothing; it establishes the P12 fixture/stub scene and the registration module later units extend.
Budget: 16 files to read, about 900 lines to change, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome; the panel catalog rows `shape-bars` and `plan-timeline` (around lines 177–178); the preset row for `workflow` (around line 195); the Interaction model (inspect → Open, typed populations, honest uncertainty, no inferred success).
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 plan measures (`executions_complete|unreported|started`, `complete_share`, `last_ts`, lenses `repo_id|harness|session_model`), execution measures/lenses (`shape`, `session_cost_usd`, `ts`), `/entities?grain=plan` list/sort/cursor and `/entities?grain=execution` list, and the `/entity?grain=plan&collection=events` order; 17.5 chart rules; 17.7 fixtures.
3. `packages/yakka/internal/serve/analytics_entities.go` — `analyticsPlanEntities` row/measure names and `analyticsExecutionEntities`; `packages/yakka/internal/store/plan_entities.go` — `PlanDetailPage` `events` rows. Confirm what is served; do not assume an execution aggregate mode (there is none).
4. `packages/yakka-analytics/web/js/panels/rank.js` — a ranked `<yk-bars>` panel with a table, chooser, population line and inspect behaviour.
5. `packages/yakka-analytics/web/js/panels/scatter-plan.js`, `river.js` and `p11-scatter.js` — plan identity, `planDestination`, registration and preset-spec conventions.
6. `packages/yakka-analytics/web/js/panels/{panel-frame,p10-shared}.js`, `web/js/charts/yk-bars.js`, `web/js/charts/yk-lanes.js`, `web/js/core/panel-state.js` — frame, request/table helpers, bar/lane specs, one state vocabulary.
7. `packages/yakka-analytics/tests/scatter-sessions/{browser,fixture}.mjs`, `tests/workspace/{harness,fixture,stub-api}.mjs` and `tests/scatter-sessions/sessions.test.mjs` — browser loader, opt-in stub scenes and deterministic fixture patterns.

Read ranges and grep; do not read a whole file to find one section, and truncate long tool output.

## Goal

Deliver the two plan process panels the Workflow preset needs: a ranked stacked bar of plan execution shapes that opens the plan, and a plan version/execution timeline. Establish the additive `p12` fixture/stub scene that the rest of Phase 12 extends.

## Contract

- DESIGN.md Phase 12 outcome: "From Workflow and Plans, grouped process shapes, plan cost ranking/scatter and version/execution timelines open the relevant plan."
- Panel catalog `shape-bars`: "Complete, unreported and started per plan, harness or repo; age of last observation, never inferred success | P6 aggregate mode (ungrouped counts Now)".
- Panel catalog `plan-timeline`: "Artifact versions and executions of a plan in time lanes, markers sized by nothing and coloured by kind".
- Preset row: `workflow` names `shape-bars`, `plan-timeline`, `rank` by plan-associated cost, `scatter-plan`, `river`; "Plan/execution inspect → plan contents and related session; overlapping cost and process shape are labelled".
- CONTRACTS 17.3 plan rows carry `executions_complete`, `executions_unreported`, `executions_started`, `complete_share` (null with `no_executions`), `last_ts`; lens `repo_id|harness|session_model`; rows are `{id:{repo_id,plan}, m, l, flags}`. Use these served measures for process shape: one `/entities?grain=plan` request, never a browser count of execution rows.
- Execution shape is `complete`, `unreported` or `started` by the existing rule and measures process completion, not success (17.3). Label it that way.
- CONTRACTS 17.3 `/entity?grain=plan&collection=events` returns plan-associated events ordered `ts desc, event_type asc, identity asc`, rows carrying `path`, `conversation_id`, `event`, `event_type`, `ts`, cursor-paged `next` and a population. It does not expose a version `content_hash`; timeline markers therefore open the plan (and, inside plan detail later, the artifact's latest version), never an exact historical hash.
- CONTRACTS 17.3 `/entities?grain=execution` returns execution rows with `l.shape`, `id.{repo_id,conversation_id,brief_path}`, `m.ts`, `m.session_cost_usd` and score measures. Execution list filters accept `plan` and `repo_id`; they do **not** accept `shape`, and there is no execution aggregate mode. Do not invent either.
- **Design shortfall, carried:** the catalog row also offers harness/repo grouping for `shape-bars`, but no served route groups execution shape by harness or repo. Deliver plan grouping only (exact, from plan measures) and render an observable unsupported state for harness/repo grouping naming the missing execution aggregate; do not fetch execution pages and count them. The Phase 12 verdict records this carry.
- CONTRACTS 17.5: zero-based bars for bars, a legend with two or more series, units/time basis in the frame, a table for every chart, colour never alone, and `inspect()` testability. Inherit the `<yk-bars>`/`<yk-lanes>` contracts; add no chart type or gesture.
- CONTRACTS 17.7: deterministic stub bodies, fixed timestamps, real Chromium, `html[data-idle="true"]`, real mouse/keyboard, no fixed sleeps, at most 4 requests in flight, clean diagnostics. P10/P11 stub bodies stay byte-identical; the P12 scene is additive.

## Changes

### Workflow panel registration module

- Add `panels/p12-workflow.js` with `P12_WORKFLOW_PANEL_IDS` and a `registerP12WorkflowPanels()` that registers `shape-bars` and `plan-timeline` only (idempotent via `hasPanel`). Do not register the `workflow` preset here; 12-02 completes the preset after `rank` plan mode exists.
- Export the two panel constants for tests. Import the module from `panels/index.js` beside the existing registration calls and export nothing new from the index beyond the two panel constants if useful.
- Add `css/workflow.css` and ensure it is loaded from the panels (the established `ensureP10Styles`/`ensureSessionsStyles` pattern).

### `shape-bars`

- Panel id `shape-bars`, title "Process shape", grain `plan`, charts `['bars']`, measures the three execution-count measures plus `complete_share` and `last_ts` for the table, requires `entities_plan` and `entities_execution` only if actually used, `table: true`.
- Load `/entities?grain=plan&sort=executions_unreported:desc&limit=<top>` through the shared window/filter/cohort parameters (`from`/`to`/`all`, `tz`, `repo_id`, `harness`, `session_model`, `exclude`, `cohort`). Default top 12; use `schema.budgets.top_max`/`page_max` only as an upper bound, never a hidden clip. Population text is "top N of M plans" from the server's `population.scope_n`, never a sum of the returned page.
- Render stacked bars (complete, unreported, started) per plan with a legend and a table (plan identity, the three counts, `complete_share` or `no_executions`, `last_ts`). Zero-based axis. Label process shape "execution completion, not success"; show `last_ts` as age of last observation, never an inferred outcome.
- Bars are keyed by canonical plan identity; inspect facts use plan measures and an entity `{destination: planDestination(identity)}`. Open navigates to `/plans/<repo>/<plan>`. A missing/null measure stays out of marks, is counted, and is never drawn as zero.
- A grouping chooser offers Plan (implemented). Harness and Repo render `unsupportedState` with `missing: 'execution aggregate grouping'`, `reason: 'the server publishes no execution aggregate mode; process shape is served by plan measures only'`, `source: 'server /schema'`, `nearest: 'plan grouping'`. The chooser selection is panel-local and does not mutate the board scope.

### `plan-timeline`

- Panel id `plan-timeline`, title "Plan timeline", grain `plan`, charts `['lanes']`, `table: true`. It composes existing `<yk-lanes>` and adds no timeline element.
- Accept a fixed plan from `spec.plan = {repo_id, plan}` (used by plan detail in 12-06). Without a fixed plan, load `/entities?grain=plan&sort=last_ts:desc&limit=12` and offer a chooser (repo/plan labels); default to the first row. The chooser is panel-local; no board-scope mutation. Empty/failed chooser is a named empty/error state.
- For the selected plan, load `/entity?grain=plan&collection=events&repo_id=&plan=&limit=<page_max>` and `/entities?grain=execution&plan=&repo_id=&limit=<page_max>` with the shared window parameters. Draw one lane per observed artifact kind (`design`, `brief`, `report`; colour registry by kind) with markers at `event_type === 'artifact_version'` timestamps, and one execution lane with a marker per execution `ts`; markers are sized by nothing. Execution marker facts show `shape`, cost (lower-bound/all-unpriced flagged) and brief path.
- Show the version/execution totals from each response's population and a "Load more" control per collection when `next` is present; appending pages never relabels the population. An unknown fixed plan with no rows is a named empty state ("no served plan (repo, plan)") with links to `/plans`, never a silent fallback to another plan.
- Inspect/Open opens the selected plan (`/plans/<repo>/<plan>`). Inside plan detail (12-06) the artifact marker uses the plan's artifact destination at the latest version; no hash is invented. Do not claim a version hash the events collection does not serve.
- Table rows: time, lane/kind, path or execution shape, conversation id, lower-bound marker; no HTML content, no inferred phase completion.

### P12 fixture and stub scene

- Add `state.p12` to `tests/workspace/stub-api.mjs` (control `{p12:true}`) and additive `p12*` helpers in `tests/workspace/fixture.mjs`. Do not change any existing P10/P11 body. `schema()` returns `p12Schema()` when `p12` is on; it publishes the plan/execution/artifact grains, measures, lenses, modes and filters used by Phase 12, `budgets.page_max`, `top_max`, `content_bytes`, and `features.entities_plan/entities_execution/entities_artifact/artifact_content`.
- P12 plan rows: at least 8 plans across 2 repos, including one plan with no executions (`complete_share: null`, flag reason `no_executions`), one with all three shapes, one with unpriced associated cost and `associated_cost_lower_bound`, one with `shared_sessions > 0`, and two plans sharing a session. Deterministic `sort` for the fields used; opaque cursors with a second page and no duplicate identities.
- P12 events/execution rows: deterministic artifact-version events for three kinds over several timestamps, executions in every shape with fast/slow cost and preview/clean scores, and enough rows for a second page. Include an associated-session event that is not an artifact version so the events table is not mistaken for a version timeline.
- Re-export the browser loader in `tests/plans-artifacts/browser.mjs` following `tests/scatter-sessions/browser.mjs` (playwright-core under `NODE_PATH`, Chromium 1243, named `SKIP_REASON`).
- Add `tests/plans-artifacts/workflow.test.mjs` with pure checks (plan→bar mapping, stacking, null/`no_executions`, top/population text, timeline lane/marker mapping, chooser fallback, unsupported grouping reasons) and Chromium checks:
  - `/b/workflow` is not yet a delivered preset; mount the two panels directly on a P12 page or a test-only board wrapper in the spec, settle both, and assert stacked bars with three series, `Open` reaches `/plans/<repo>/<plan>`, the events/execution timeline has version and execution markers with a table, and the harness/repo grouping states are named.
  - Assert `maxInFlight <= 4`, clean diagnostics, `data-idle` settlement, no fixed sleeps, no `/tmp`.

### Keep untouched

- `rank.js`, `presets.js` and the `workflow` preset: 12-02 owns plan-cost rank and the preset. Do not register the preset here.
- `/plans` and `/artifact` routes and explorers: 12-03/12-05/12-06 own them.
- P10/P11 stub bodies and their tests; the P12 scene is additive.
- No server, Go, migration, dependency, route, grain, join or gesture change. No browser count of execution rows to fake grouping.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/workflow.test.mjs` (workdir `packages/yakka-analytics`) → pure and Chromium checks pass; missing playwright-core/Chromium skips with the named reason, never passes silently.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/workflow.test.mjs` → the browser checks pass and report `maxInFlight <= 4`.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs` → unchanged Phase 9 expectations still pass (the workflow preset remains named at this point).
- `node --test tests/workspace/*.test.mjs` and `node --test tests/scatter-sessions/*.test.mjs` → existing suites stay green; P10/P11 stub responses are byte-identical.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the before/after outputs, the served plan/execution fields used, the harness/repo grouping carry, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
