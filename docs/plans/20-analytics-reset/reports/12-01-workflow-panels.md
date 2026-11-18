# 12-01 — Workflow process-shape and plan-timeline panels

Status: `done with concerns`. The two Phase 12 panels are registered and settle
ready on the additive P12 stub scene: `shape-bars` draws a stacked
complete/unreported/started bar per plan from the served plan measures and opens
`/plans/<repo>/<plan>`; `plan-timeline` draws artifact-version and execution
lanes from the plan events and execution routes, tables non-version events, and
pages both collections. Harness/repo grouping renders a named unsupported
state. The `workflow` preset remains a named destination (12-02 owns it).

## What changed

- `web/js/panels/shape-bars.js` (new): `SHAPE_BARS_PANEL`, pure `shapeRows`,
  `shapeTop`, `shapePopulationText`, `completeShareText`, `observedAge`,
  `groupingState`, and the stacked `<yk-bars>` table with an inspectable plan
  entity. One `/entities?grain=plan&sort=executions_unreported:desc` request
  through the shared window/filter/cohort seam; null measures stay out of the
  marks and are never zero.
- `web/js/panels/plan-timeline.js` (new): `PLAN_TIMELINE_PANEL`, pure
  `timelineModel`, `artifactKind`, `tsToMs`, `executionCostText`, `fixedPlan`,
  `chooserFallback`, `isMissingPlan`. Composes `<yk-lanes>`; one lane per
  observed artifact kind plus one execution lane; marker entities are the plan
  destination. Fixed plans come from `spec.plan`; without one, a plan chooser
  defaults to the first served plan.
- `web/js/panels/p12-workflow.js` (new): `P12_WORKFLOW_PANEL_IDS`,
  `registerP12WorkflowPanels()` (idempotent, two panels only; no preset).
- `web/js/panels/index.js`: imports and calls the registration, re-exports the
  two panel constants and the id list.
- `web/css/workflow.css` (new): layout only, loaded once by
  `ensureWorkflowStyles` in `shape-bars.js`.
- `tests/workspace/fixture.mjs`, `tests/workspace/stub-api.mjs`: additive
  `state.p12` scene and `p12*` helpers; existing default/P10/P11 bodies
  untouched.
- `tests/plans-artifacts/browser.mjs` (new): re-exports the shared loader and
  P12 helpers. `tests/plans-artifacts/workflow.test.mjs` (new): 9 pure checks
  and 3 Chromium checks.

## Done evidence

Before: the suite did not exist — `node --test tests/plans-artifacts/workflow.test.mjs`
failed with `Cannot find module .../tests/plans-artifacts/workflow.test.mjs`.

After:

- `NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/workflow.test.mjs`
  → `tests 12, pass 12, fail 0, skipped 0`.
- `node --test tests/plans-artifacts/workflow.test.mjs` (no NODE_PATH) → same
  12 passing here; the suite still skips with `SKIP_REASON` when Chromium or
  `playwright-core` is unavailable.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs`
  → `tests 16, pass 16`.
- `node --test tests/workspace/*.test.mjs` → `tests 72, pass 72`;
  `node --test tests/scatter-sessions/*.test.mjs` → `tests 42, pass 42`.
- `git diff --check` → clean. Chromium checks report `maxInFlight <= 4`, clean
  diagnostics and `data-idle` settlement; no fixed sleeps, no `/tmp`.

## Served fields used

- Plan rows: `id.{repo_id,plan}`, `m.{executions_complete,executions_unreported,
  executions_started,complete_share,last_ts}`, `l.{repo_id,harness,
  session_model}`, `flags.complete_share_null_reason`; `population.{returned_n,
  scope_n}`.
- Plan events: `path`, `conversation_id`, `event`, `event_type`, `ts`,
  `next`, `population`.
- Executions: `id.{repo_id,conversation_id,brief_path}`, `m.{ts,
  session_cost_usd,...}`, `l.shape`, `flags.session_cost_lower_bound` /
  `session_cost_null_reason`, `next`, `population`.

## Deviations from the brief

- The chooser choices are panel-local configuration kept in the panel spec's
  `scope` (`p12_grouping`, `p12_plan`) because a canonical panel spec only
  carries `grain/measures/split/chart/scope`. This never writes the board scope
  or adds a filter; the request builders ignore both keys.
- `shape-bars` requires only `entities_plan` because it issues no execution
  request; `entities_execution` is not claimed for an unused route.
- `ensureWorkflowStyles` is defined in `shape-bars.js` (and re-exported by
  `p12-workflow.js`) to avoid an import cycle between the registration module
  and its panels.
- The timeline table deliberately includes non-version events, labelled
  `not drawn (not an artifact_version)`, as the brief's fixture requirement
  asks; the chart lanes still contain only version and execution markers.

## Contradictions and carries

- DESIGN's catalog row lists `shape-bars` under the `execution` grain and offers
  harness/repo grouping; the brief and CONTRACTS serve process shape from plan
  measures only and forbid an invented execution aggregate. The panel follows
  the brief: grain `plan`, plan grouping implemented, harness/repo named
  unsupported. The Phase 12 verdict should record this carry.

## Known problems / unfinished

- `plan-timeline`'s load-more repaint addresses the first
  `[data-panel="plan-timeline"]`. The delivered preset has one timeline panel;
  a board with two would repaint the first. Fixing that needs a per-instance
  host handle, not a new contract.
- 12-02 still owns registering the `workflow` preset and plan-cost `rank`; 12-03
  and 12-05/12-06 own `/plans` and `/artifact`. The Open destination is the
  named Phase 12 route until then.
- No server, Go, route, grain, join, dependency or gesture change was made.
