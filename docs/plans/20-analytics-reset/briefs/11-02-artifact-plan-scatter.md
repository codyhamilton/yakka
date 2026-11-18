# Brief: 11-02 — Artifact and plan scatter

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/scatter-artifact.js`, `scatter-plan.js`, `p11-scatter.js`, `packages/yakka-analytics/web/css/scatter.css`, `packages/yakka-analytics/tests/scatter-sessions/artifact-plan.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `stub-api.mjs`, and `docs/plans/20-analytics-reset/reports/11-02-artifact-plan-scatter.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/11-02-artifact-plan-scatter.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 11-01.
Runs alongside: nothing; it appends to the shared scatter registration module and the same P11 fixture/stub scene.
Budget: 16 files to read, about 900 lines to change, 34 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 11 outcome, the panel catalog rows `scatter-artifact` and `scatter-plan`, the Scatter preset mapping, and the Interaction model.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 `artifact` and `plan` measure/lens tables and the artifact/plan joins (version → writing session, artifact → score, plan → sessions), 17.3.1 capability matrix (`artifact`, `plan` rows), and 17.5 scatter/colour/table rules.
3. `packages/yakka-analytics/web/js/panels/{scatter-shared,scatter-session,p10-shared,score-ranges,score-strips}.js` — the 11-01 helpers and the Phase 10 check/catalogue and artifact-identity patterns you reuse.
4. `packages/yakka-analytics/web/js/{app,core/view-spec,core/selection-tray}.js` — inspector/selection wiring and cohort JSON.
5. `packages/yakka-analytics/tests/workspace/{fixture,stub-api}.mjs` and `packages/yakka-analytics/tests/trends-quality/quality.test.mjs` — the P11 scene and the `/scores` catalogue stub pattern.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Deliver the two high-value relationship scatters — artifact score against the session that wrote it, and plan cost against what the plan produced — using only the grains, measures, lenses and joins CONTRACTS.md 17.3 publishes, with model kept categorical and every null/lower-bound/overlap labelled.

## Contract

- DESIGN.md panel catalog: `scatter-artifact` plots numeric `score:<check>` against writing-session `cost_usd`/`model_calls`/`tokens_*`, another same-kind check, `versions` or `content_bytes`; `model` is a colour/facet lens and never a numeric axis. `scatter-plan` plots `associated_cost_usd` against `artifacts`, `versions`, `design_score:<check>` or `complete_share`. Both belong to Phase 11.
- CONTRACTS.md 17.3 artifact measures: `versions`, `distinct_writing_sessions`, `first_ts`, `last_ts`, `content_bytes`, `score:<check>`, `writing_session_cost_usd`, `writing_session_model_calls`, `writing_session_tokens_*`; lenses `kind`, `plan`, `repo_id`, `harness`, `session_model`, `source`, `screen_verdict`, selected-check `scorer`, `band:<check>`. A null axis is `unscored`/`content_unavailable`/missing-cell, never zero. A partially priced writing session is a lower bound; an all-unpriced one is null.
- CONTRACTS.md 17.3 plan measures: `artifacts` (per kind), `versions`, `sessions`, `shared_sessions`, `associated_cost_usd` (+ `unpriced_calls`), `executions_complete|unreported|started`, `complete_share` (null with `no_executions`), `design_score:<check>`, `span_days`, `first_ts`, `last_ts`; lenses `repo_id`, `harness`, `session_model`. Associated cost is non-additive across plans: label overlap and `shared_sessions`; never present it as plan-exact spend.
- CONTRACTS.md 17.3.1: every offered numeric axis must be a `range` measure for the grain and every colour a published lens; a known check that does not apply yields null, not a fabricated point. `score:<check>`, `design_score:<check>` and `band:<check>` are catalogue-validated dynamic names.
- Carried from Phase 10: the artifact reader is Phase 12; identify an artifact by `repo_id`+`path`+`hash` and name the `/artifact?...` destination. The exact artifact `id` lens grammar is still unconfirmed, so this unit never promotes an artifact `id` lens to a cohort or axis. Browser evidence needs `playwright-core` under `NODE_PATH` and Chromium 1243; a spec that cannot reach them skips with the named reason. The committed P10 stub carries one scores/artifact body; extend only additively.

## Changes

### Shared choices

- In `scatter-artifact.js` export pure helpers:
  - `artifactAxes(schema, catalogue)` returning the numeric measure names the artifact grain publishes (including `score:<check>` and `writing_session_*`) and the check names the `/scores?kind=` catalogue offers. A requested `score:<check>` not in the catalogue is `unsupported` with the nearest check; never request an unknown check.
  - `artifactColours(schema)` returning only `kind`, `plan`, `repo_id`, `harness`, `session_model`, `source`, `screen_verdict`, `scorer`, `band:<check>` when the schema publishes them; explicitly exclude `model` and any `id` from numeric axes.
  - `artifactPoint(row, spec)` and `artifactIdentity(row)` mapping `{id,m,l,flags}` to a chart point and to the `{repo_id,path,hash}` the inspector/`/artifact` destination uses.
- In `scatter-plan.js` export `planAxes(schema, catalogue)` and `planColours(schema)` from the plan measures/lenses in 17.3, plus `planPoint(row)`. Never offer a plan measure the schema does not publish; `complete_share` with `no_executions` is a null point, not zero.
- Extend `p11-scatter.js` to register `scatter-artifact` and `scatter-plan`. The `scatter` preset stays unregistered until 11-03 creates it with all four panels.

### Panels

- `scatter-artifact` (`grain: 'artifact'`, `requires: ['entities_artifact', 'scores_by_lens']`):
  - Default spec: x `writing_session_cost_usd`, y `score:clarity`, colour `session_model`, no size; a kind/check chooser (using `/scores?kind=` like the Quality panel) supplies the selected check.
  - Load `/entities?grain=artifact&mode=scatter&fields=…` through the 11-01 request builder; render `<yk-chart type="scatter">`, the two marginals, the table and the population/sample sentence.
  - Label `unscored`, `content_unavailable`, null writing-session cost and lower-bound/unpriced counts separately in the basis and note; never print `$0` for an unpriced writing session.
  - `spec.entities` carries the artifact identity and `/artifact?repo_id=…&path=…&hash=…` destination; the inspector may name Phase 12 but must not claim the reader exists.
- `scatter-plan` (`grain: 'plan'`, `requires: ['entities_plan']`):
  - Default spec: x `associated_cost_usd`, y `artifacts`, colour `repo_id`; alternate x/y from the plan measures, alternate colour from the plan lenses.
  - Show the overlap banner: `associated_cost_usd` is the sum of associated sessions, non-additive across plans, with `shared_sessions` and `unpriced_calls` visible. A total over plans is never labelled spend.
  - Null `complete_share`/`design_score` points are counted in the population but not drawn, and the note says why.
  - `spec.entities` carries the plan identity `{repo_id, plan}` and a `/plans/<repo>/<plan>` destination (Phase 12 named).
- Both panels reuse the 11-01 rectangle/tray path: the rectangle yields ranges on the two numeric axes, a bounded aggregate count gives the exact population, and additive/Alt drags union/subtract ranges. Do not add a new gesture.

### Fixture and tests

- Extend `tests/workspace/fixture.mjs` and `stub-api.mjs` additively under the `p11` scene with deterministic artifact scatter rows (two kinds/checks, two writing-session models, one unscored, one unpriced writing session, same-check pairs) and plan scatter rows (two plans sharing a session, `complete_share` present and `no_executions`, unpriced associated cost, `design_score` present/null). Keep every existing P10 body byte-identical.
- Add `tests/scatter-sessions/artifact-plan.test.mjs`: pure checks for axis/colour offers (model never numeric; unknown check unsupported), request fields, row/identity mapping, null and lower-bound labels, plan overlap caveat, table values, and registration. Do not assert a `/b/scatter` board yet; 11-03 proves it in the browser.

### Keep untouched

- `scatter-shared.js`, `scatter-session.js` and the 11-01 selection/tray seam beyond additive imports or registration calls. If a shared helper genuinely needs a change, keep it backward-compatible and say why in the report.
- The Phase 9/10 panels, presets, routes, Start paths and chart kit. No new chart type, dependency, route, grain or join; do not edit Go files.
- The `scatter` named destination and Phase 9 workspace specs.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/scatter-sessions/artifact-plan.test.mjs` (workdir `packages/yakka-analytics`) → all checks pass.
- `node --test tests/scatter-sessions/scatter.test.mjs` → the 11-01 checks still pass.
- `node --test tests/workspace/*.test.mjs` → the Phase 9/10 workspace suite stays green; `/b/scatter` is still a named destination.
- `node --test tests/trends-quality/*.test.mjs` → Phase 10 stays green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps.
- The report records the exact before/after outputs, the fixture rows used, the deferred browser proof (11-03), and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
