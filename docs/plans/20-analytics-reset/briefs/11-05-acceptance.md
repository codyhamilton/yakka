# Brief: 11-05 — Scatter lab and Sessions acceptance

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs`, `packages/yakka-analytics/tests/scatter-sessions/acceptance-browser.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `stub-api.mjs`, and `docs/plans/20-analytics-reset/reports/11-05-acceptance.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/11-05-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 11-01 through 11-04.
Runs alongside: nothing; it is the phase acceptance proof.
Budget: 22 files to read, about 700 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — the Phase 11 Outcome, the Scatter preset mapping, the panel catalog rows for the four scatter panels and `session-lanes`, the Sessions explorer contract, and the Interaction model.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.1 budgets, 17.3 scatter/plan/artifact/time/session measures and Conversation coverage, 17.3.1 population/relation/association and refused routes, 17.5 scatter/lane/table rules, 17.7 the conversation-cap fixture, and 7.2 `/conversation`.
3. `packages/yakka-analytics/tests/workspace/harness.mjs`, `fixture.mjs`, `stub-api.mjs`, `start.test.mjs`, `acceptance.test.mjs`, `engine.test.mjs` — the shared harness, the P11 scene and the existing browser-spec pattern.
4. `packages/yakka-analytics/tests/scatter-sessions/{scatter,artifact-plan,sessions}.test.mjs` — the unit proofs this brief composes; do not duplicate them, prove the phase outcome across them.
5. `docs/plans/20-analytics-reset/reports/11-0*.md` — the four unit reports and their stated concerns or deferred proofs.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Prove the Phase 11 outcome end to end in Chromium on the committed fixture: the Scatter board's sessions/artifacts/plans/time scatters are schema-valid, labelled where sampled, exact where resolved, and honest about time cohorts, associations, cap truncation, unpriced events and cross-grain support, and Sessions sorts/pages and opens a bounded, reconciled detail.

## Contract

- The four scatter panels and the Scatter preset are delivered by 11-01–11-03, and `/sessions` plus `/sessions/<id>` by 11-04. This unit changes no product code: a product defect is reported as a concern or blocker, never patched here.
- Acceptance uses only `/schema`, the deterministic fixture bodies and the first-party test-only stub API. No live server, production data, credential, deployment or migration.
- Browser evidence needs `playwright-core` under `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules` and the Chromium 1243 cache, both outside this worktree; a spec that cannot reach them skips with a named reason and records a gate, never a silent pass.
- Carried from Phase 10: dashboard charts paint after idle, so specs read `inspect()` rather than racing animation. Tools route interception must not parallelise unfiltered route handling; serve fixture responses deterministically and keep `maxInFlight <= 4`. The exact artifact `id` lens and the artifact/plan readers are Phase 12; acceptance names those destinations and does not require them to render. The Pages automation gate remains Phase 13.

## Changes

### Acceptance proof

Add `tests/scatter-sessions/acceptance.test.mjs` and, if the harness splits helpers, `acceptance-browser.mjs`. Cover the phase outcome in one run of the deterministic fixture:

- **Scatter board:** `/b/scatter` settles the four registered panels `ready` in preset order; every axis/size offered is a numeric schema measure and every colour is a published lens; `model` is categorical only; a sampled scatter states its sample rule and its marginals equal the whole-population fixture.
- **Exact selection, every grain:** a rectangle on the session, artifact, plan and time scatters yields canonical data-space `and(range,range)` predicates; union and Alt-subtraction canonicalise; the tray shows the exact bounded population and the sampled-mark count separately; a bounded aggregate count reconciles with the population.
- **Peer linkage:** `Make cohort A`, `Filter all` and `Exclude this` write the same positive canonical cohort (mutually exclusive with B/C) with a frozen absolute scope, and peers requery with one `cohort=`; cost/quality/plan associations and bands reconcile in their own units and disclose expansion; an unsupported cross-grain pairing is `unsupported` with the server reason.
- **Time cohorts:** a selected bucket range freezes `source.fields`, source `bucket` and `bucket_step`; the resolved population counts distinct contributing sessions, respects half-open bucket boundaries at the source-window edge, and reports missing (`no_conversation_id`) and orphan (`orphan_conversation_id`) rejection associations separately from the session count and from each other; a target window expands and says so; an all-rejection bucket renders a valid empty selection.
- **Uncertainty:** an unpriced artifact writing session and an all-unpriced plan/artifact point render a lower-bound/null label and are never shown as `$0` or dropped into a scored point; an unknown `score:<check>`/`design_score:<check>` is `unsupported` with the nearest check.
- **Sessions list:** `/sessions` sorts server-side by each offered session measure, Load-more appends a cursor page with no duplicate identity, a lens chip and the scope tray narrow through the pushed URL, and no sort or filter change sums a partial page.
- **Session detail:** `/sessions/<id>` renders lanes and the returned-event table, hollows every `priced:false` call, shows `returned_events`/`total_events` with the cap stated and `returned_unpriced_calls`/`total_unpriced_calls` separately, reconciles visible markers only to returned events, links the omitted events to `/ledger?conversation_id=…`, names the Phase 12 artifact/plan destinations with the observed identities, and sends no `cohort=` to `/conversation`.
- **Budget and diagnostics:** each page has `maxInFlight <= 4`, a clean diagnostics panel and no fixed sleeps or animation assertions; a missing `playwright-core`/Chromium skips with the named reason.

- Extend the `p11` fixture/stub additively only where this proof needs a missing deterministic edge (for example an all-rejection bucket or a top-of-window half-open boundary); every existing body stays byte-identical.
- Do not modify the four unit specs or any product file. If a proof fails, record the symptom, location and contract clause in the report with status `blocked` or `done with concerns` and let the phase verdict carry it.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/acceptance.test.mjs` (workdir `packages/yakka-analytics`) → the full Phase 11 outcome passes, or skips only with the named browser reason.
- `node --test --test-concurrency=1 tests/scatter-sessions/*.test.mjs` → acceptance and the four unit specs pass together.
- `node --test tests/workspace/*.test.mjs` → the Phase 9/10 workspace suite stays green on the delivered Scatter board and Sessions explorer.
- `node --test tests/trends-quality/*.test.mjs tests/charts-*/*.test.mjs` → Phases 10 and the chart kits stay green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the exact before/after outputs, the fixture fractions/associations/pages used, every gate line, the four unit concerns it carried, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
