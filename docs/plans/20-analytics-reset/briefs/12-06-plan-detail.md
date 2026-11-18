# Brief: 12-06 — Plan detail, stored design context and collections

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/explorers/plans.js`, `packages/yakka-analytics/web/js/core/router.js`, `packages/yakka-analytics/web/css/plans.css`, `packages/yakka-analytics/tests/plans-artifacts/plan-detail.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, `packages/yakka-analytics/tests/workspace/engine.test.mjs`, and `docs/plans/20-analytics-reset/reports/12-06-plan-detail.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-06-plan-detail.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 12-05 (the Plans explorer and list), 12-03 (the reader and content/baseline helpers), 12-01 (the plan-timeline panel).
Runs alongside: nothing; it edits the shared plans explorer, router, P12 scene and engine expectations.
Budget: 18 files to read, about 1,000 lines to change, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome; Entity explorers **Plans** detail paragraph (artifacts by kind with latest version/score/band, executions with shape, sessions with cost and overlap note, time-ordered version/execution timeline; phases from `### Phase <n>` + Outcome; briefs from `briefs/<phase>-<NN>-<slug>.md`; display only, never measures; no completion/review inference); Interaction model.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 plan detail collections (`artifacts|executions|sessions|events`), exact orders, independent `limit`/`next`/population; plan measures/flags (`shared_sessions`, `associated_cost_usd`, lower bound, `no_executions`); artifact measures/band; execution shape; 17.4 content; 17.7 fixtures.
3. `packages/yakka/internal/serve/analytics_entities.go` and `packages/yakka/internal/store/plan_entities.go` — `analyticsPlanDetail`, `PlanDetailPage` rows for every collection, and the `events` scope (all facts in sessions with an artifact under the plan, not only plan files).
4. `packages/yakka/internal/serve/analytics_artifact_population.go` — artifact entity rows (`score:*`, `score_scorer:*`, `band:*`, `content_bytes`, writing-session measures/flags).
5. `packages/yakka-analytics/web/js/explorers/plans.js` (12-05) — list, scope/params, inspector/tray, state handling.
6. `packages/yakka-analytics/web/js/explorers/artifact-content.js` — `fetchArtifactText`, `parseOutline`, band helpers; reuse, do not duplicate.
7. `packages/yakka-analytics/web/js/panels/plan-timeline.js` (12-01) — fixed-plan spec and table/lane contract.
8. `packages/yakka-analytics/web/js/core/{router,panel-state,inspector}.js`, `web/js/panels/panel-frame.js`, `web/css/plans.css` — routing, states, frame mounting.
9. `packages/yakka-analytics/tests/plans-artifacts/{plans-list,workflow,artifact-reader}.test.mjs`, `tests/workspace/{fixture,stub-api,engine.test}.mjs` — explorer tests, P12 scene, route expectations.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Deliver `/plans/<repo>/<plan>`: the plan's artifacts by kind with latest version/score/band, executions with shape, sessions with cost and the overlap note, a version/execution timeline, and stored design phase headings/outcomes plus brief paths parsed for display only, with no completion or review inference.

## Contract

- DESIGN.md plan detail is quoted in full in the required reading. In particular: "The plan's **phases and briefs are read from the stored content**: phases from the design's `### Phase <n>` headings and their Outcome lines, briefs from the path pattern `briefs/<phase>-<NN>-<slug>.md`, both parsed in the browser for display only and never counted as measures. Phase completion, reviews and plan-level outcomes that live in `IMPLEMENTATION.md`, `REVIEW.md` or commit trailers are not stored and are not shown or inferred."
- CONTRACTS 17.3 `/entity?grain=plan&repo_id=&plan=&collection=artifacts|executions|sessions|events` returns one cursor-paged collection with independent `limit`, `next` and population. Orders: artifacts `path asc`; executions `ts desc, conversation_id asc, brief_path asc, repo_id asc`; sessions `conversation_id asc`; events `ts desc, event_type asc, identity asc`. It never embeds unbounded arrays. Events cover all facts of sessions that wrote an artifact under the plan; label that scope explicitly.
- CONTRACTS 17.3 plan measures: `artifacts` by kind, `versions`, `sessions`, `shared_sessions`, `associated_cost_usd` (+ `unpriced_calls`), `executions_complete|unreported|started`, `complete_share` (null with `no_executions`), `design_score:<check>`, `span_days`, `first_ts`, `last_ts`; lenses `repo_id|harness|session_model`. Associated cost is non-additive and overlapping; partially priced is a lower bound; all-unpriced is null, never `$0`.
- CONTRACTS 17.3 artifact rows expose latest `score:<check>`, `score_scorer:<check>` and `band:<check>` (latest version only), `versions`, `content_bytes` (null with `content_unavailable`), writing-session cost/flags, screen verdict and harness/model. Artifact entity rows do **not** expose a version `content_hash`; link the reader without a hash (latest) and label it "latest version". Do not invent a hash.
- CONTRACTS 17.3 execution rows expose `l.shape` (`complete|unreported|started`), `m.session_cost_usd` (null/lower-bound rules), `m.brief_score:<check>`, `m.report_score:<check>`, `ts`. Shape is process completion, not success.
- CONTRACTS 17.4 content: use `fetchArtifactText` from 12-03 for `docs/plans/<plan>/DESIGN.md`; a 404/413/500 state shows its exact reason. Only design/brief/report are stored.
- **Plan-identity truth:** a detail URL never broadens to another plan. If the plan row is absent, show "No served plan (repo, plan)" with a link to `/plans`; do not fall back to the latest or the list's first row. A plan with no artifacts/executions still shows its named empty sections, never a not-found.
- **No inference:** do not read or link `IMPLEMENTATION.md`, `REVIEW.md`, `QA.md`, `PROVENANCE.md`, commit trailers or brief contents for completion. A phase with no brief path is shown as "no brief path observed in the loaded artifact rows" (observed absence), not "incomplete"; a brief with no phase heading is listed under "unpaired briefs", not assigned. Never write a completion class, badge or count.
- CONTRACTS 17.7: deterministic fixture, real Chromium, `data-idle`, no fixed sleeps, `maxInFlight <= 4`, clean diagnostics.

## Changes

### Router

- Add `/plans/<repo>/<plan>` to `EXPLORER_PATHS` (or an explicit detail route) as `{kind:'explorer', explorer:'plans', plan:{repo_id, plan}}`; remove the remaining named `/plans/...` route. Decode percent-encoded segments exactly once, so a repo id containing `/` round-trips (`/plans/acme%2Fwidgets/20-analytics-reset`). `/plans/<one-segment>` stays not-found; `/plans` stays the list.
- Update `tests/workspace/engine.test.mjs`: list and detail are both explorer records with the parsed plan identity; the encoded repo test passes; `/artifact` stays an explorer.

### Detail layout

- Extend `plans.js` to branch on the parsed identity. Keep the list implementation unchanged when no identity is present; destroy the list frame/tray/inspector on navigation.
- Fetch with the shared window only. Plan detail is a fixed entity page: it does not send `cohort=` to `/entity` (which refuses it) and does not partially apply board lens/cohort filters. If the URL carries cohorts or lens filters, name them as not applied rather than narrowing some sections silently:
  1. Plan row: `/entities?grain=plan&repo_id=&plan=&limit=1`. Absent → named state described above.
  2. Artifacts: `/entities?grain=artifact&plan=&repo_id=&limit=page_max`, server-paged ("Load more").
  3. Executions: `/entities?grain=execution&plan=&repo_id=&limit=page_max`, server-paged.
  4. Sessions: `/entity?grain=plan&collection=sessions&repo_id=&plan=&limit=page_max`, server-paged; deduplicate the returned conversation ids, then resolve them with `/entities?grain=session&id=…&limit=page_max` to get cost, unpriced and lower-bound flags. Do not use the plan collection's `ts` as a session cost.
  5. Events: `/entity?grain=plan&collection=events&repo_id=&plan=&limit=page_max`, server-paged.
  6. Timeline: mount the registered `plan-timeline` panel with `spec.plan = {repo_id, plan}` and the same scope; call `frame.load()`; destroy on teardown.
  7. Design: find the artifact row whose path is `docs/plans/<plan>/DESIGN.md`; if present, fetch `/entity?grain=artifact&repo_id=&path=` for `latest.content_hash`, then `fetchArtifactText`. Bands/content baselines use `transport.request('baselines', …)` as in 12-03. If absent or unavailable, a named "no stored design content" / exact-reason state; still show brief paths.
- Header: repo/plan identity, associated cost (overlap/lower-bound), sessions/shared sessions/versions/artifacts, executions counts and `complete_share` or `no_executions`, span days/first/last, design score(s) with scorer. Use plan row measures/flags only; never re-sum sessions into plan spend.
- Artifacts section: kind, path, latest version count, latest score/scorer/band per visible check, content bytes or `content_unavailable`, screen verdict, writing session cost/lower-bound; `Open` → `/artifact?repo_id=&path=` (latest; no hash). A check-less artifact shows `unscored`.
- Executions section: shape, brief path, ts, session cost (null/lower bound), brief/report scores with scorers, session link. Label "execution completion, not success".
- Sessions section: conversation id, last observed ts from the collection, resolved cost/unpriced/lower-bound; link `/sessions/<id>`; show the plan's `shared_sessions` overlap note and "associated cost sums sessions and is non-additive across plans". A session whose session row is unavailable is listed with "session detail unavailable", not dropped.
- Events section: time-ordered table of event time, event type, event, path, conversation; label "all observed events in sessions that wrote an artifact under this plan, not only plan files". Paged independently; appending never resets other sections.
- Each section's population line uses its own server population; no cross-section totals.

### Stored design context (display only)

- Extract phases with a line-based parser (export it for tests):
  - `^###\s+Phase\s+(\d+)\s*(?:—|–|-|:)\s*(.+?)\s*$` → phase number and heading.
  - The first following line matching `^\s*-\s+Outcome:\s*(.+)$` before the next heading is the outcome (one line; preserve text; no markdown rendering).
  - Ignore headings inside fenced code blocks and `### Phase` text inside body prose.
- Extract brief paths from loaded artifact rows with `(?:^|/)briefs/(\d+)-(\d+)-(.+)\.md$`; show phase number, unit number, slug and the path as plain text (no link; the outcome requires paths, and a brief's content is not opened from here). Pair by the leading phase number; show unpaired briefs separately; show phases with no observed brief path as observed absence, never completion.
- Render the design body/outcomes as text nodes only, with a bounded list (first 100 phases; "more phases not shown" if longer) and an "Open design content" link to the artifact reader without a hash. Do not count phases or briefs as measures (no badge/population change).
- Tests must include a design body where the word "complete" appears in an outcome and no brief exists; assert no completion marker/class is produced and the phase still appears.

### Fixture and tests

- Extend the P12 scene additively with: a plan with artifacts of all three kinds, multiple versions and scores/bands; executions in all shapes with priced/unpriced and brief/report scores; sessions sharing another plan; events including artifact_version and non-artifact events; a stored DESIGN.md body with several `### Phase` headings, outcomes, a fenced `### Phase 99` decoy, a phase with no brief, and an unpaired brief path; unavailable/missing design content for a second plan; a percent-encoded repo id; a plan absent from the list. Keep P10/P11 bodies byte-identical.
- Add `tests/plans-artifacts/plan-detail.test.mjs`:
  - pure: encoded segment parsing; phase/outcome parsing (fences, decoys, missing outcome); brief-path pairing/unpaired; no inference helpers; section population mapping; cost/lower-bound/null formatting; artifact latest link without hash; session id request builder (repeatable `id`, no `cohort=`).
  - Chromium: `/plans/<repo>/<plan>` shows artifacts/executions/sessions/events and the timeline; a repo id with an encoded slash works; the design phases and outcomes render as text, the fenced decoy is absent, the no-brief phase is not marked complete, and "complete" in an outcome creates no state; an unavailable design shows its exact reason; the absent plan shows the named state and no other plan; each Load more appends without resetting another section; `maxInFlight <= 4`; clean diagnostics; no fixed sleeps.
- Update the plans-list test only where the detail route type changed; keep list expectations.

### Keep untouched

- The list's ranked table/scatter semantics beyond the route branch; the `scatter-plan`, `plan-timeline`, `shape-bars` and `rank` internals.
- The reader and diff internals; reuse `fetchArtifactText`.
- P10/P11 stub bodies and stale "Phase 12" notices (12-07).
- No server, Go, migration, dependency, route, grain, join, gesture or contract change; no reading `IMPLEMENTATION.md`/`REVIEW.md` from the app.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/plan-detail.test.mjs` → pure and Chromium checks pass; a missing browser dependency skips with the named reason.
- `NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/plan-detail.test.mjs` → browser checks pass and report `maxInFlight <= 4`.
- `node --test tests/plans-artifacts/*.test.mjs` sequentially → list, reader, diff, workflow and rank checks stay green.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs` → all route expectations pass.
- `node --test tests/workspace/*.test.mjs`, `node --test tests/scatter-sessions/*.test.mjs`, `node --test tests/trends-quality/*.test.mjs` → green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the before/after outputs, the exact collections/params, the phase/brief parsing evidence, the no-inference assertions, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
