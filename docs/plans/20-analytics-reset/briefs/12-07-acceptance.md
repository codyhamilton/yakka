# Brief: 12-07 — Phase 12 acceptance and stale-notice cleanup

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs`, `packages/yakka-analytics/tests/plans-artifacts/browser.mjs`, `packages/yakka-analytics/web/js/panels/score-strips.js`, `packages/yakka-analytics/web/js/panels/scatter-artifact.js`, `packages/yakka-analytics/web/js/panels/scatter-plan.js`, `packages/yakka-analytics/web/js/explorers/sessions.js`, `packages/yakka-analytics/tests/trends-quality/quality.test.mjs`, `packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs`, `packages/yakka-analytics/tests/scatter-sessions/sessions.test.mjs`, `packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, `packages/yakka-analytics/tests/workspace/acceptance.test.mjs`, and `docs/plans/20-analytics-reset/reports/12-07-acceptance.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-07-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 12-01 through 12-06.
Runs alongside: nothing; it owns the phase-wide proof.
Budget: 18 files to read, about 600 lines to change, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome (all clauses), panel catalog table, preset table, Entity explorers (Sessions, Plans, Artifact reader), Interaction model, and the Phase 12 Units/Carried/verdict once refine has inserted them.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 (plan/artifact/execution/session rows and routes), 17.4 content states, 17.5 chart rules, 17.7 harness.
3. `packages/yakka-analytics/web/js/panels/{score-strips,scatter-artifact,scatter-plan}.js`, `web/js/explorers/sessions.js` — the stale "Phase 12" notices and destination links.
4. `packages/yakka-analytics/tests/plans-artifacts/{workflow,rank-preset,artifact-reader,artifact-diff,plans-list,plan-detail}.test.mjs` — the phase's unit evidence and fixture helpers.
5. `packages/yakka-analytics/tests/workspace/{harness,fixture,stub-api,acceptance.test}.mjs` — P10/P11/P12 controls, Start paths, the Phase 9 acceptance expectations.
6. `packages/yakka-analytics/tests/trends-quality/{quality,acceptance}.test.mjs`, `tests/scatter-sessions/{sessions,acceptance}.test.mjs` — the assertions that encode the old notices.
7. `packages/yakka-analytics/web/js/panels/p10-quality.js`, `p11-scatter.js`, `p12-workflow.js`, `panels/index.js` and `web/js/core/router.js` — delivered presets/explorers and the panel registry.
8. `packages/yakka-analytics/web/js/core/panel-state.js`, `web/js/panels/panel-frame.js`, `tests/plans-artifacts/browser.mjs` — settlement, states, browser loader.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Prove the whole Phase 12 outcome end to end and remove every stale "Phase 12 / arrives in Phase 12" claim now that the workflow preset, Plans explorer and artifact reader are delivered.

## Contract

- Phase 12 outcome, in full (DESIGN.md lines 760–762): grouped process shapes, plan cost ranking/scatter and version/execution timelines open the relevant plan; plan detail pages artifacts/executions/sessions/events and shows stored design phase headings/outcomes and brief paths as content context without inferring completion/review; artifact reader navigation, per-version metadata and bounded text-only content connect bidirectionally to plans/sessions; a two-version line diff matches the fixture, declines above its stated ceiling and never diffs unavailable/incomplete text; malicious HTML/script is inert; missing/oversized bodies show exact reasons; every catalog panel and all three explorers are delivered.
- CONTRACTS 17.3/17.4/17.5/17.7 are binding for every probe. In particular: exact content reasons/statuses and no prefix body; 413 no diff; no inference from `IMPLEMENTATION.md`/`REVIEW.md`; plan-scoped cards use `(repo_id, plan)`; rectangle selections resolve server-side; totals come from populations; every chart has a table; malicious content is text.
- Stale-notice cleanup is a Phase 12 completion requirement. The UI must not say the artifact reader, plan explorer or plan detail "arrives in Phase 12" or "is Phase 12" after they are delivered. Replace those strings with neutral, factual text (for example "opens the artifact reader", "opens the plan detail") and update the P10/P11 test assertions that pinned the old wording. Historical code comments that mention the phase are not user-facing notices and need no change unless they feed UI text.
- Enabling `p12` in the stub must not disable any P10/P11 schema feature or body the earlier suites use. If `p12Schema` is not a superset, fix the fixture here, not the earlier tests.
- CONTRACTS 17.7: real Chromium only; `html[data-idle="true"]` and explicit end states (URL, `data-state`, `inspect()`); real mouse/keyboard; at most 4 requests in flight; no fixed sleeps; no `/tmp`. Diagnostics rule for deliberate error probes (settled here, consistent with Phases 9–11): page errors and CSP violations must be empty, and the harness must not hide any application console error. Chromium records a deliberate non-2xx fetch (404/413/500) as a `Failed to load resource` console entry; those entries, and only those matching the exact probed statuses, are allowed for the test that triggers them. Every other console error fails. Do not use unfiltered `assertClean()` in a spec that deliberately probes an error status, and do not suppress errors globally.
- Fixture-hash boundary (settled here): the P10/P11 fixtures carry short artifact hashes (`h1`, `hash-a`, `hash-design`). CONTRACTS 17.4 requires a 64-hex content hash for `/content`, and the reader's client-side identity state names that requirement. Do not change the P10/P11 stub bodies and do not loosen the reader to accept a non-64-hex hash. The P10/P11 destinations must reach `/artifact` and render that exact named `identity-required` state; the P12 64-hex identity proves content, metadata and diff. Record this fixture limitation as a carry, not a product bug.

## Changes

### Stale notices

- `score-strips.js`: `READER_NOTICE` and the caveat no longer claim a Phase 12 arrival; state that the identity opens the artifact reader. Keep the file-weighted/content-hash distinction.
- `scatter-artifact.js`: `ARTIFACT_READER_NOTICE` and the entity `reader` label become neutral ("artifact reader"); keep the destination and version identity semantics.
- `scatter-plan.js`: `PLAN_EXPLORER_NOTICE` and the entity `reader` label become neutral ("plan explorer"/"plan detail"); keep the non-additive cost banner.
- `explorers/sessions.js`: replace " — artifact reader is Phase 12" and " — plan detail is Phase 12" with neutral link text; keep the links and identities.
- Update assertions in `tests/trends-quality/{quality,acceptance}.test.mjs` and `tests/scatter-sessions/{sessions,acceptance}.test.mjs` to assert the new text and the preserved destinations. Do not weaken any count, link or population assertion.
- Grep the shipped `web/` tree for `arrives in Phase 12`, `is Phase 12`, `Phase 12 artifact destination` and `Plan 12`; no user-facing occurrence may remain (comments may remain only if they never reach the DOM; prefer neutral wording anyway).

### Fixture alignment

- Add additive P12 rows for the exact artifact `(repo_id, path, hash)` and plan `(repo_id, plan)` identities that the P10 score-strips/scatter-artifact and P11 scatter-plan/sessions fixtures link to, so every rendered destination resolves instead of 404. Keep P10/P11 bodies byte-identical and p12 opt-in.
- Ensure `p12Schema()` is a superset for the grains/features/lenses those pages request, or make the P12 branch fall through to the P10/P11 schema where needed.

### Phase 12 acceptance spec

- Add `tests/plans-artifacts/acceptance.test.mjs` with deterministic Chromium checks:
  1. Workflow: `/b/workflow` settles `shape-bars`, `plan-timeline`, `rank`, `scatter-plan`, `river`; process shape has three series and an overlap/lower-bound label where applicable; a plan mark's inspect/Open reaches `/plans/<repo>/<plan>` with that plan's heading (no fallback).
  2. Plans: `/plans` sorts server-side, pages, settles the scatter; Open reaches the detail; the detail shows artifacts/executions/sessions/events and the timeline; design phase headings/outcomes and brief paths render; a no-brief phase is not marked complete; "complete" in an outcome produces no completion state; an absent plan shows the named no-plan state and never another plan.
  3. Reader: the P10 score-strips and scatter-artifact links and the P11 sessions artifact link click into `/artifact` in the real reader and render the named `identity-required` state for their short fixture hashes; the P12 64-hex identity proves a selected version round-trips through the clean URL, per-version score+band, harness/model, screen verdict and scorer, and plan/session links resolve back.
  4. Plan links from P11 sessions and P11 scatter-plan resolve to the real plan detail, not a named destination.
  5. Content: a malicious `<script>`/`<img onerror>` body produces no script/img element and no dialog; `not_stored`, `pending`, `removed_by_screen`, generic not-found, 413 (with size/limit and no prefix) and 500 integrity each show their exact state.
  6. Diff: the known two-version diff matches; an unavailable side and an oversized side are declined with the stated reason/ceiling and no diff.
  7. Unknown deep links (`/artifact` with a bogus identity/hash, `/plans/<repo>/<missing>`, `/plans/a/b/extra`) land in one named state each; `/plans/<one-segment>` is not-found.
  8. Delivery completeness: `/plans` and `/artifact` are explorers; `/b/workflow` is a board; every preset resolves to a board; every catalog panel id is registered (enumerate the DESIGN catalog table; include `shape-bars`, `plan-timeline`, `session-lanes`; account for the compound rows `calendar`+`rhythm`, `dist-hist`+`dist-ecdf`, and `mix`); no shipped notice claims a missing Phase 12 surface.
  9. No stale "Phase 12" text is visible on any probed page.
  10. `maxInFlight <= 4`; page errors and CSP violations empty everywhere; console errors empty on ordinary pages and, on the deliberate 404/413/500 probes, only the matching `Failed to load resource` entries; no fixed sleeps.
- Update `tests/workspace/acceptance.test.mjs` only if the final `/plans` expectation still names Phase 12 or the `/b/workflow` board needs the p12 control; keep Start at 15 links and legacy disabled at 10.

### Keep untouched

- Unit implementations beyond the notice text and fixture alignment; do not change reader/diff/plan semantics to make acceptance easier. If a probe exposes a product bug, report it (and fix only if it is within the owned notice/fixture scope); a unit bug outside it is a handoff, not a silent redesign.
- P10/P11 bodies except additive P12 rows; the P10/P11 panel behaviour and counts.
- No server, Go, migration, dependency, route, grain, join, gesture or contract change.
- No deployment, Pages rig, credential or secret action; Phase 13 owns release readiness.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/acceptance.test.mjs` → all Chromium checks pass; a missing browser dependency skips with the named reason (and the phase cannot be called accepted).
- `NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/*.test.mjs` → the whole Phase 12 suite passes sequentially, including the acceptance spec.
- `node --test tests/workspace/*.test.mjs`, `node --test tests/scatter-sessions/*.test.mjs`, `node --test tests/trends-quality/*.test.mjs` → green with the updated notice assertions and the preserved counts.
- `node --test tests/plans-artifacts/workflow.test.mjs tests/plans-artifacts/rank-preset.test.mjs tests/plans-artifacts/artifact-reader.test.mjs tests/plans-artifacts/artifact-diff.test.mjs tests/plans-artifacts/plans-list.test.mjs tests/plans-artifacts/plan-detail.test.mjs` → each unit's evidence still passes after the notice/fixture changes.
- `cd packages/yakka && go test ./...` → green if the Go toolchain is available; if not, record the exact missing-toolchain reason as a gate (no Go file changed by Phase 12).
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the exact before/after outputs, every probed destination, the malicious/limit/reason evidence, the delivery-completeness enumeration, and any deviation, gate or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
