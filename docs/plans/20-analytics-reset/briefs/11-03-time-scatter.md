# Brief: 11-03 — Time scatter, time cohorts and the Scatter preset

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/scatter-day.js`, `p11-scatter.js`, `packages/yakka-analytics/web/css/scatter.css`, `packages/yakka-analytics/web/js/core/selection-tray.js`, `packages/yakka-analytics/web/js/core/selection-model.js`, `packages/yakka-analytics/tests/scatter-sessions/scatter.test.mjs`, `packages/yakka-analytics/tests/scatter-sessions/acceptance-fixture.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `stub-api.mjs`, `packages/yakka-analytics/tests/workspace/start.test.mjs`, `acceptance.test.mjs`, and `docs/plans/20-analytics-reset/reports/11-03-time-scatter.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/11-03-time-scatter.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 11-01 and 11-02.
Runs alongside: nothing; it finalises the shared registration module and the P11 fixture/stub scene and updates the Phase 9 expectations.
Budget: 20 files to read, about 1,100 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 11 outcome (time-cohort clauses), the panel catalog row `scatter-day`, the Scatter preset mapping, and the Interaction model's time-cohort and linking paragraphs.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 `time` grain, `/entities?grain=time` scatter/aggregate modes and **Time-cohort resolution**; 17.3.1 predicate grammar, capability matrix (`time` row), population/relation and association reporting; 17.1 budgets; 17.5 scatter/table rules.
3. `packages/yakka-analytics/web/js/panels/{scatter-shared,scatter-session,scatter-artifact,scatter-plan,p10-shared,pulse-strips}.js` — the 11-01/11-02 helpers, request/window seams and the four required panels.
4. `packages/yakka-analytics/web/js/core/{selection-model,selection-tray}.js` and `web/js/app.js` — the predicate/cohort JSON and tray actions you extend.
5. `packages/yakka-analytics/tests/workspace/{fixture,stub-api,start.test,acceptance.test}.mjs` and `tests/trends-quality/acceptance.test.mjs` — the P11 scene and the Chromium proof pattern.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Complete the Scatter lab with the shared-bucket time scatter and make time rectangles resolve honestly to contributing sessions, so a frozen time cohort reproduces its source bucket grid, reports missing/orphan rejections separately, and expands into the target window without ever equating bucket counts with session counts.

## Contract

- DESIGN.md panel catalog: `scatter-day` plots two measures on the same server bucket grid (for example daily cost and commits), with units and partial-bucket coverage; it is Phase 11. The Scatter preset is exactly `scatter-session`, `scatter-artifact`, `scatter-plan`, `scatter-day` plus population marginals.
- DESIGN.md Interaction model: selecting time buckets means "contributing sessions of selected aggregate buckets"; the source fields and resolution are frozen; rejection associations are shown as associated, missing (no conversation id) and orphan (unknown session) in their own unit, never folded into a session count; the target applies its own window and reports expansion. Rectangle unions/subtractions and explicit tray actions produce server-resolved cohorts; unsupported cross-grain pairings say why.
- CONTRACTS.md 17.3 **Time-cohort resolution**: the cohort carries `source:{fields:[measure names],bucket:<effective unit>,bucket_step:<effective step>}` from the response; the fixed source window/tz and resolution reproduce the bucket grid; evaluate the predicate over whole-population aggregate bucket rows, then resolve distinct existing sessions with at least one eligible contributing fact/call in a selected bucket for any named field. Bucket intervals are half-open, intersected with the inclusive source window; deduplicated usage follows the usage measure identity. Missing/orphan rejection associations live in `population.relation.associations` (17.3.1). Unsupported source operations are disabled with the missing join/reason.
- CONTRACTS.md 17.3.1: `relation` is `{source_grain,target_grain,mapping,op,resolved_n,resolved_unit:"session",associations}` plus `target_sessions` where the route's own population is not sessions. `associations` is an array of `{side,contributor,unit,total_n,associated_n,missing_by_reason:{no_conversation_id,orphan_conversation_id},treatment}`, and `total_n = associated_n + no_conversation_id + orphan_conversation_id`. Source and target sides are distinct; `side:"source"` only for a time cohort whose `source.fields` include `rejections`.
- CONTRACTS.md 17.1: effective bucket, `bucket_step`, `coarsened` and `window` come from the response; the client never rewrites the window.
- Carried from Phase 10: the produce/compare two-sided cohort behaviour of the P10 compare panels is unchanged; Phase 11 does not extend it. Charts paint after idle, so specs read `inspect()`; browser evidence needs `playwright-core` under `NODE_PATH` and Chromium 1243 and skips with the named reason otherwise.

## Changes

### Time scatter

- Add `panels/scatter-day.js`:
  - Panel id `scatter-day`, grain `time`, `charts: ['scatter']`, `requires: ['entities_time']`, caveats: shared bucket grid, partial-bucket coverage, association-not-cause and contributing-session meaning.
  - Two aggregate measures from the time grain's schema measures (default x `cost_usd`, y `commits`, alternate numeric only when published); request `/entities?grain=time&mode=scatter&fields=…` through the 11-01 builder; use `bucket=auto` unless the scope carries a unit, and read `bucket`, `bucket_step`, `coarsened`, `window` and `partial`/coverage flags from the response.
  - Map each bucket row (`id` = `{t,tz}`, `m` = both measures) to a chart point; the table shows the bucket time, both measures with units and the partial-bucket flag. Null measures stay undrawn but counted; missing scores never zero-fill, missing counts may zero-fill only when the server supplied the zero.
  - `regionPredicate` uses the two measure names; the exact-population count request uses `/entities?grain=time&mode=aggregate&stat=count&predicate=…` and reads both `population` (bucket unit) and `population.relation.target_sessions` / `associations`.
- Extend the selection/cohort seam additively in `core/selection-tray.js`/`selection-model.js`:
  - `buildCohort` forwards an optional `source` object into the canonical cohort only when supplied; a time selection supplies `{fields, bucket, bucket_step}` frozen from the response, and the cohort scope stays the frozen absolute window/tz.
  - The tray renders the time selection in session unit: "N contributing sessions" from `relation.target_sessions`/the count request, "M sampled marks" where applicable, and a separate association line naming associated, missing (`no_conversation_id`) and orphan (`orphan_conversation_id`) rejections. These counts are never added to the session count.
  - The tray's `Filter all`/`Exclude this` use the same positive predicate and differ only by `op`, exactly as in 11-01.
- A time selection whose `source.fields` includes `rejections` displays the `side:"source"` associations; a target request's `side:"target"` associations are displayed beside the target population, with `treatment` (`dropped`/`kept`) named. A bucket whose only rejections are unassociated renders a valid empty selection and says so.

### Scatter preset

- In `p11-scatter.js`, register the four panels and the `scatter` preset with canonical specs:
  - `scatter-session`: x `cost_usd`, y `commits`, colour `session_model`, size `unpriced_calls`.
  - `scatter-artifact`: x `writing_session_cost_usd`, y `score:clarity`, colour `session_model`.
  - `scatter-plan`: x `associated_cost_usd`, y `artifacts`, colour `repo_id`.
  - `scatter-day`: x `cost_usd`, y `commits`.
  Use the same preset shape as `p10-*` (`id`, `title`, `panels`, `specs`), name only registered ids, and do not exceed 12 panels.
- Update the Phase 9 expectations that the delivery changes: `tests/workspace/start.test.mjs` (the old `Delivered in Phase 11: Scatter` assertion becomes a delivered-board/legacy behaviour assertion) and `tests/workspace/acceptance.test.mjs` (drop `/b/scatter` from the named later destinations and adjust the expected count; `/b/workflow` and `/plans` remain named). Change no product behaviour to satisfy a test.

### Fixture and tests

- Extend the `p11` scene additively with a deterministic time scatter body on a shared bucket grid (two measures, a partial bucket, a range of buckets including a half-open boundary case), a relation with `target_sessions` and `associations` that names associated, missing and orphan rejections, and at least one empty bucket-only selection. Keep every existing default, P10 and 11-01/11-02 body byte-identical.
- Extend `tests/scatter-sessions/scatter.test.mjs` with pure checks for the time request/axes, bucket/step freeze, half-open bucket boundary predicate, `source` in the canonical cohort, association totals and the session-vs-bucket units. Add the Chromium proof for the delivered `/b/scatter` board:
  - four panels settle `ready` in the preset order; each axis/colour/size is a schema offer;
  - a sample is labelled and each marginal's bins equal the whole-population fixture;
  - a rectangle on session, artifact, plan and time scatters produces ranges (union and Alt-subtraction canonicalise correctly), the tray shows the exact server population and sampled marks separately;
  - `Make cohort A`, `Filter all` and `Exclude this` write the canonical cohort with a frozen absolute scope and peers requery with one `cohort=`; bands/relations reconcile in their own units;
  - a time selection freezes `source.fields`/`bucket`/`bucket_step`, reports distinct contributing sessions, missing/orphan rejections separately and the target-window expansion; an unsupported cross-grain pair is `unsupported` with the server reason;
  - tables equal the fixture; `maxInFlight <= 4`; clean diagnostics; no fixed sleeps.

### Keep untouched

- The 11-01/11-02 panel behaviour and the chart kit. No new chart type, gesture, route, grain, join or dependency; do not edit Go files.
- The P10 presets and their two-sided compare behaviour; `trend-columns`, `trend-multiples` and `mix` keep single-cohort behaviour outside the compare preset.
- The Phase 9 Pulse, ledger and ops panels and the Start question paths.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/scatter.test.mjs` (workdir `packages/yakka-analytics`) → all pure and Chromium checks pass; a missing playwright-core/Chromium skips with the named reason, never passes silently.
- `node --test tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs tests/workspace/engine.test.mjs` → updated expectations pass on the delivered Scatter board.
- `node --test tests/scatter-sessions/artifact-plan.test.mjs tests/scatter-sessions/scatter.test.mjs` → P11 pure checks stay green; run the files sequentially (`--test-concurrency=1`) if the harness shares a route log.
- `node --test tests/trends-quality/*.test.mjs` and `node --test tests/charts-*/*.test.mjs` → Phase 10 and the chart kits stay green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the exact before/after outputs, the fixture fractions and association counts, the Start/acceptance expectation change, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
