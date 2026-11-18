# Brief: 12-05 — Plans list explorer and `/plans`

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/explorers/plans.js`, `packages/yakka-analytics/web/js/core/router.js`, `packages/yakka-analytics/web/css/plans.css`, `packages/yakka-analytics/tests/plans-artifacts/plans-list.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, `packages/yakka-analytics/tests/workspace/engine.test.mjs`, `packages/yakka-analytics/tests/workspace/acceptance.test.mjs`, and `docs/plans/20-analytics-reset/reports/12-05-plans-list.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-05-plans-list.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 12-02 (the delivered Workflow preset and plan columns), 12-04 (the reader/diff state of the P12 scene).
Runs alongside: nothing; it edits the shared router, P12 scene and Phase 9 expectations.
Budget: 14 files to read, about 800 lines to change, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome; Entity explorers **Plans** (`/plans` is "a ranked table and scatter over `entities?grain=plan`"); Interaction model (inspect → Open, rectangle selection → cohort tray, honest populations, no browser sums).
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 plan measures/lenses, `/entities?grain=plan` list/sort/cursor, `mode=scatter` with marginals/sampling, typed populations and non-additive plan cost; 17.5 chart/table rules; 17.7 fixtures.
3. `packages/yakka/internal/serve/analytics_entities.go` — `analyticsPlanEntities` (list) and the plan scatter path; `packages/yakka/internal/serve/analytics_artifact_population.go` — plan scatter shape if shared. Use only served fields.
4. `packages/yakka-analytics/web/js/explorers/sessions.js` — lazy explorer, scheduler/transport, tenant, route-scoped abort, inspector and selection-tray pattern.
5. `packages/yakka-analytics/web/js/panels/scatter-plan.js` and `scatter-shared.js` — the existing plan scatter, canonical key (`canonicalRowKey`), `planIdentity`/`planDestination`, population text, marginals and the select event.
6. `packages/yakka-analytics/web/js/core/{router,panel-state,selection-tray,inspector,chips}.js`, `web/js/panels/{panel-frame,p10-shared,registry}.js` — routing, states, tray/inspector actions, cohort params, frame mounting.
7. `packages/yakka-analytics/tests/scatter-sessions/sessions.test.mjs`, `tests/workspace/{harness,fixture,stub-api,engine.test,acceptance.test}.mjs` — browser/explorer test pattern, P12 scene, Phase 9 expectations.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Convert `/plans` from a named Phase 12 destination into a real explorer: a server-sorted, cursor-paged ranked table of plans plus the existing plan scatter, with inspect → plan detail and a rectangle selection that becomes a typed plan cohort.

## Contract

- DESIGN.md Entity explorers — Plans: `/plans` is "a ranked table and scatter over `entities?grain=plan`". Plan detail (`/plans/<repo>/<plan>`) is 12-06's work; this unit may leave the detail route named until then.
- CONTRACTS 17.3: `/entities?grain=plan` takes the shared filter (including `exclude` and `cohort=`), `sort=<measure>:asc|desc`, `where` (not needed here), `limit` at most `page_max`, keyset `cursor`; rows `{id:{repo_id,plan}, m, l, flags}`; every response carries typed `population`; totals come from the server, never the returned page. Default `last_ts desc, repo_id asc, plan asc`.
- CONTRACTS 17.3 scatter: `mode=scatter` returns the whole population up to `budgets.scatter_points`, else a deterministic hash sample with `sampled:true`, `sample_rule`, `population_n`, `returned_n`, plus `marginals` over the whole population. A scatter is drawn only from a response that says what it is.
- Plan cost is non-additive: `associated_cost_usd` sums associated sessions, `shared_sessions` counts sessions touching more than one plan, and any total over plans is labelled overlapping. Unpriced is null; partially priced is a lower bound. Never sum a page.
- DESIGN.md Interaction model: a rectangle is an explicit predicate resolved by the server; its exact count comes from the server; the tray offers Make cohort A–D / Filter all / Exclude / Clear. `pick` (explicit identities) and rectangle predicates are transient; cohort promotion freezes the window. No browser join.
- CONTRACTS 17.5: every chart has a table; colour never alone; units/time basis; no chart that the UI cannot act on.
- Carried: the plan explorer's scatter reuses the delivered `scatter-plan` panel exactly (same axes/marginals/select semantics) and does not add a second scatter implementation. Its stale "arrives in Phase 12" notice stays until 12-07.
- Carried: the P12 period is cheap for tests; real evidence uses real Chromium and the P12 stub. No live server, deployment, migration or dependency.

## Changes

### Router

- In `core/router.js`, remove the exact `/plans` from `NAMED_ROUTES`; add `/plans` to `EXPLORER_PATHS` as `plans`. Keep `^/plans/<repo>/<plan>$` as a Phase 12 named route until 12-06 converts it. `loadExplorer('plans')` dynamically imports `explorers/plans.js`. `/plans/<one-segment>` remains not-found. Keep `/artifact` and every account/other route unchanged.
- `parseRoute('/plans')` returns `{kind:'explorer', explorer:'plans', path:'/plans', search}`; `parseRoute('/plans/acme/20-analytics-reset')` stays named phase 12 at this unit.

### `explorers/plans.js` list

- Export `title = 'Plans'`, `phase = 12`, `render(root, doc, { signal })`.
- Use its own `createScheduler`/`createTransport` and a route-scoped `AbortController`, like sessions. Fetch `/me` for tenant (`rememberedTenant`) and `/schema` once; use `page_max`, `top_max`, `scatter_points` from budgets.
- Read the URL with `decodeUrlState`. The shared window is `all/from/to/tz`; include filters are `repo_id`, `harness`, `session_model`; excludes are forwarded under their lens; the first valid cohort comes from `cohortParams(state)`/`decodeCohort` and is sent as `cohort=`. Forward no time-only or unknown parameter.
- Ranked table:
  - Server-sort control over published plan measures only; default `last_ts:desc`, plus a named "by associated cost" option (`associated_cost_usd:desc`) that shows the overlap banner. A sort change pushes the URL and refetches from the first page.
  - Columns: plan identity (`repo/plan`), associated cost with lower-bound/all-unpriced markers, sessions, shared sessions, artifacts, versions, executions complete/unreported/started, complete share (or `no_executions`), latest design score(s) with scorer, last observed time.
  - Server-side "Load more" cursor; appending never re-sorts or sums. Population line "N of M plans" from the server; a plan with null measures is counted, never zero-filled. Empty/error/cancelled/unsupported states use the one vocabulary.
  - Each row has `Open` → `/plans/<repo>/<plan>`; the identity is `(repo_id, plan)`. A plan whose `id` is malformed is an error row, not a silent skip.
- Scatter:
  - Mount the registered `scatter-plan` panel through `createPanelFrame` in a section inside the explorer, with the same state/scope (window, lenses, excludes, cohort) and the plan scatter spec (`associated_cost_usd` vs `artifacts`, colour `repo_id`). Call `frame.load()` after append; destroy on route teardown.
  - Wire `inspect`: parse the chart's canonical key (`canonicalRowKey` is compact JSON of `{repo_id,plan}`), build the identity, and open one `createInspector` with grain `plan`, plan facts, `destination: planDestination(identity)`, population and URL. The inspector's Open pushes the detail.
  - Wire `select`: ignore the raw `scatter-rectangle` event; when the panel re-emits `source:'scatter-predicate'` with `selection.predicate`, keep it as the tray's explicit selection with its server counts/associations. Render one `createSelectionTray` for grain `plan`; its Make cohort/Filter all/Exclude/Clear actions write the standard cohort slots (`ca`–`cd`) through the tray, and the table/scatter refetch under the new scope. Never convert marks into an identity list.
  - No second scatter code and no new chart type. A missing plan scatter capability names the phase/schema, never an empty chart.
- App chrome: the explorer is read-only; no Follow, no edit controls. Links to plan detail and (later) artifacts encode repo/path; no unencoded slashes in path segments.

### Fixture and tests

- Extend the P12 scene with plan list pages (stable deterministic order; opaque second page; no duplicate identities), plan scatter responses (whole-population + a sampled variant with fixed rule/marginals), and the measures/lenses the table/chooser need. Keep P10/P11 bodies byte-identical.
- Add `tests/plans-artifacts/plans-list.test.mjs`:
  - pure: plan list params include only contract names and the first valid cohort; sort parsing/defaults; row mapping (null/lower-bound/`no_executions`); identity/destination encoding (repo id with `/`); scatter spec/keys; population text; sampled caveat text.
  - Chromium: `/plans` settles a ranked table; a server sort refetches in the asserted order; Load more appends a unique page; the scatter settles with marginals and a labelled sampled state when applicable; clicking a mark and Open reaches `/plans/<repo>/<plan>`; a rectangle shows the tray with the server's exact count and Make cohort writes a `ca` URL that the table refetches; overlap banner present on cost sort; empty/error named; `maxInFlight <= 4`; clean diagnostics; no fixed sleeps.
- Update `tests/workspace/engine.test.mjs`: `/plans` is an explorer (`explorer:'plans'`); `/plans/<repo>/<plan>` remains named phase 12 at this unit.
- Update `tests/workspace/acceptance.test.mjs`: `/plans` no longer names "Delivered in Phase 12"; turn the P12 scene on for that path, settle `plans-list` (or the explorer table selector), and keep `/b/workflow` delivered. The `/plans` entry leaves `named`; the record count becomes 0 and the named-destination check is removed or rephrased to assert both paths are delivered. Start links stay 15; legacy disabled stays 10.

### Keep untouched

- `/plans/<repo>/<plan>` detail content: 12-06 owns design parsing, collections, timeline and detail layout.
- The `scatter-plan` panel internals, `plan-timeline`/`shape-bars`/`rank` internals, and the `workflow` preset.
- P10/P11 stub bodies and notices; 12-07 updates the stale "Phase 12" text.
- No server, Go, migration, dependency, route, grain, join, gesture or contract change.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/plans-list.test.mjs` → pure and Chromium checks pass; a missing browser dependency skips with the named reason.
- `NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/plans-list.test.mjs` → browser checks pass and report `maxInFlight <= 4`.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs` → updated `/plans` expectations pass; `/b/workflow` stays delivered.
- `node --test tests/workspace/*.test.mjs`, `node --test tests/scatter-sessions/*.test.mjs`, `node --test tests/trends-quality/*.test.mjs` → green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the before/after outputs, the exact plan list/scatter params, the cohort URL written by a rectangle, the sampled state, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
