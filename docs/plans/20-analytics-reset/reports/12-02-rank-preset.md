# 12-02 — Plan-cost rank mode and the Workflow preset

Status: `done with concerns`. The `rank` panel has an explicit plan-grain mode
over `/entities?grain=plan` and the `workflow` preset is now a delivered
five-panel board (`shape-bars`, `plan-timeline`, `rank`, `scatter-plan`,
`river`). `/b/workflow` settles all five panels from the P12 stub; plan Open
reaches `/plans/<repo>/<plan>`. The two concerns are named under Deviations.

## What changed

- `web/js/panels/rank.js`: explicit `spec.grain === 'plan'` (or
  `spec.scope.grain`) branch; the time-grain path is untouched. Plan mode:
  published plan measures only (default `associated_cost_usd`), unsupported
  names render `unsupportedState` naming `server /schema`; per-row canonical
  identity, `<repo>/<plan>` label, lenses, flags; null measures stay out of the
  marks and are counted; overlap banner and lower-bound/all-unpriced notes for
  associated cost; plan table (identity, chosen measure, associated cost,
  shared sessions, unpriced calls, sessions, executions, last seen); plan
  entity destination; plan-measure chooser; period/cohort comparison refuses
  with "period comparison is time-grain only".
- `web/js/panels/p12-workflow.js`: registers the five panels idempotently,
  overwrites the named `workflow` preset with the board, exports
  `WORKFLOW_PRESET_ID`, `WORKFLOW_PANEL_IDS` and `WORKFLOW_SPECS`.
- `web/css/workflow.css`: layout for the plan-rank panel, banner and chooser.
- `tests/plans-artifacts/rank-preset.test.mjs` (new): 4 pure checks and 1
  Chromium check.
- `tests/workspace/acceptance.test.mjs`: `/b/workflow` turns the P12 scene on,
  settles its five panels and no longer asserts "Delivered in Phase 12";
  `/plans` remains the one named destination (named count 1).
- `tests/plans-artifacts/workflow.test.mjs`: 12-01's preset assertion updated
  from "stays named" to the delivered five-panel board (see Deviations).

## Exact plan request

`GET /v1/analytics/entities?grain=plan&sort=associated_cost_usd:desc&limit=4`
plus the shared window (`all=1`, or `from`/`to`), `tz`, the `repo_id`,
`harness`, `session_model` includes, `exclude`, and the first valid
`cohort` when present. No `measure`, `dim` or `bucket` is sent. `limit` is
`top_max` capped by `page_max` (P12: `min(100, 4) = 4`).

## Done evidence

Before (first check): `node --test tests/plans-artifacts/rank-preset.test.mjs`
→ `Could not find 'tests/plans-artifacts/rank-preset.test.mjs'`. The P12
acceptance path already passed by asserting `/b/workflow` showed "Delivered in
Phase 12" (16/16); that assertion is the one this unit retires.

After:

- `NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/rank-preset.test.mjs tests/plans-artifacts/workflow.test.mjs`
  → `tests 17, pass 17, fail 0, skipped 0`.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs`
  → `tests 16, pass 16`; `/b/workflow` settles `shape-bars`, `plan-timeline`,
  `rank`, `scatter-plan`, `river`, `/plans` still names Phase 12, and the
  static engine `presetDestination('workflow').phase === 12` check is unchanged.
- `node --test tests/workspace/*.test.mjs` → `tests 72, pass 72`.
- `node --test tests/scatter-sessions/*.test.mjs` → `tests 42, pass 42`.
- `git diff --check` clean; no `/tmp`, fixed sleeps or animation assertions;
  Chromium checks report clean diagnostics and `maxInFlight <= 4`.

Rendered overlap/lower bound: the P12 top page by associated cost is
`repo-b/26 $9.50`, `repo-a/20 $5.50`, `repo-b/28 $4.25`, `repo-b/24 $3.00`; the
banner reads `1 shared-session report across 4 plans touch more than one plan`.
The full-page pure check also covers the lower-bound row (`$2.00+`) and the
all-unpriced null row (`all unpriced`, never `$0`).

## Deviations from the brief

- **Banner noun.** The brief asks for "N sessions touch more than one plan".
  The contract serves only per-plan `shared_sessions`; a session can appear
  under several plans, so summing that column is a report count, not a distinct
  session count. With no server change allowed, the banner says "N
  shared-session reports across M plans touch more than one plan (a session may
  be shared by more than one plan)" and still never totals plan cost. This is
  the brief/contract tension named in the report back.
- **`workflow.test.mjs` edited outside the owned-path list.** That file is in
  the brief's required reading ("the expectations that change") but omitted
  from Owned paths. 12-01 asserted the preset stays named and
  `P12_WORKFLOW_PANEL_IDS` is exactly the two Phase 12 panels. I kept
  `P12_WORKFLOW_PANEL_IDS` unchanged and updated only the stale preset-length
  assertion to the delivered board; leaving it would fail the suite this unit
  must keep green.
- **Fixture untouched.** The P12 scene already serves every plan measure, the
  `associated_cost_usd` sort, lens filters, `page_max`, a shared session, a
  lower-bound row and an all-unpriced null row; no additive fixture change was
  needed and none was made.
- **Extra table facts.** The plan table adds repo/plan, sessions and the
  execution split beyond the brief's list so the inspect facts and the table
  carry the same identity, overlap and execution information; no new measure,
  route or gesture.
- **`WORKFLOW_PANEL_IDS`.** Added beside 12-01's
  `P12_WORKFLOW_PANEL_IDS` so 12-01's exported constant keeps its meaning.

## Unfinished / known problems

- 12-05 still converts `/plans/<repo>/<plan>` into the plan detail explorer;
  until then Open lands on the named Phase 12 destination. The preset itself
  names no delivering phase.
- No non-trivial bug outside the done evidence was found.
