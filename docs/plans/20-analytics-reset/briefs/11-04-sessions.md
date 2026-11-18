# Brief: 11-04 — Sessions list and detail

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/explorers/sessions.js`, `packages/yakka-analytics/web/js/panels/session-lanes.js`, `packages/yakka-analytics/web/js/core/router.js`, `packages/yakka-analytics/web/css/sessions.css`, `packages/yakka-analytics/tests/scatter-sessions/sessions.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `stub-api.mjs`, `engine.test.mjs`, and `docs/plans/20-analytics-reset/reports/11-04-sessions.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/11-04-sessions.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 11-01 and 11-03 (the P11 stub scene and the delivered-scatter expectation updates).
Runs alongside: nothing; it shares the P11 fixture/stub scene with the earlier scatter units.
Budget: 20 files to read, about 1,000 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 11 outcome (sessions clauses), the entity-explorer **Sessions** contract, the panel catalog row `session-lanes`, and the Interaction model (selection/tray, gestures, linkage, honest uncertainty).
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 `session` grain measures/lenses, `/entities?grain=session` list/sort/cursor, `/entity?grain=session&id=` and **Conversation timeline coverage**; 17.1 paged lists and cursors; 17.3.1 the routes that refuse `cohort=` (`/conversation`, `/entity`); 17.5 lane/table rules; 17.7 the conversation-cap fixture.
3. `docs/plans/20-analytics-reset/CONTRACTS.md` — 7.2 `/conversations` and `/conversation` current response fields (`totals`, `window_totals`, `events`, `truncated`, event fields).
4. `packages/yakka-analytics/web/js/explorers/ledger.js` and `web/js/panels/ledger-table.js` — the lazy explorer module pattern, route adapter, chips/tray/inspector wiring, cursor paging and unpriced rendering.
5. `packages/yakka-analytics/web/js/charts/yk-lanes.js`, `packages/yakka-analytics/web/js/panels/river.js` — the lane element contract and an existing activity-lane composition.
6. `packages/yakka-analytics/web/js/core/{router,chips,selection-tray,inspector,panel-state}.js`, `web/js/panels/{panel-frame,registry}.js` and `web/js/app.js` — explorer dispatch, route-scoped abort, frames and shared state.
7. `packages/yakka-analytics/tests/workspace/{harness,fixture,stub-api,engine.test}.mjs` and `tests/workspace/ledger.test.mjs` — the P11 scene and the explorer browser-spec pattern.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Deliver `/sessions` as a real, server-sorted, cursor-paged entity list and `/sessions/<id>` as a bounded session timeline over `/conversation`, with priced and unpriced returned events reconciled to the returned-event counts and the 5,000-event cap stated rather than hidden.

## Contract

- DESIGN.md entity explorers — Sessions: `/sessions` is a sortable, cursor-paged table over `entities?grain=session` with lens chips and the scope tray, sorting by any session measure server-side. Detail `/sessions/<id>` is lanes of tool events by `tool_kind`, model calls with cumulative cost (unpriced as hollow markers, from the server's `priced` flag), artifacts and commits written, with truncation stated (`/conversation` caps events at 5,000) and links to the plans and artifacts the session wrote.
- CONTRACTS.md 17.3 session measures: `cost_usd`, `unpriced_calls`, `model_calls`, `tokens_*`, `hook_events`, `commits`, `artifact_versions`, `distinct_content`, `duration_s`, `first_ts`, `last_ts`; lenses `harness`, `session_model`, `session_repo`, `origin`, `has_artifacts`, `id`. A no-call cost is 0; all-unpriced is null; partially priced is a lower bound. `duration_s` is observed span, not active work.
- CONTRACTS.md 17.3 routes: `/entities?grain=session` takes `sort=<measure>:asc|desc`, `limit` at most `page_max`, keyset `cursor`, rows `{id,m,l,flags}` and typed `population`; totals come from the server, never the returned page. `/entity?grain=session&id=` aliases the bounded `/conversation`. Both `/conversation` and `/entity` **refuse `cohort=`** with `route_not_supported`; the detail must not send one.
- CONTRACTS.md 17.3 conversation coverage: `returned_events`, `total_events`, `returned_unpriced_calls` and `total_unpriced_calls` beside the existing totals/`truncated`; returned-event pricing uses the same deduplicated usage identity; UI markers reconcile to returned events, not omitted calls; `/explore?conversation_id=` reaches the omitted events. An unpriced call is never shown as `$0`.
- CONTRACTS.md 17.5: lanes/timeline expose `inspect()` and a table; no animation; units and time basis in the frame; colour never carries meaning alone.
- Carried from Phase 10: the artifact reader and plan detail are Phase 12; name those destinations (`/artifact?repo_id=…&path=…&hash=…`, `/plans/<repo>/<plan>`) without claiming they render. Browser evidence needs `playwright-core` under `NODE_PATH` and Chromium 1243 and skips with the named reason otherwise. The Go fixture already puts an unpriced call beyond the 5,000-event conversation; the stub must mirror the response fields deterministically.

## Changes

### Routing

- `core/router.js`: remove `/sessions` and `/sessions/<id>` from `NAMED_ROUTES`; add an explorer route for the list and a detail route carrying the conversation id (`EXPLORER_PATHS`/`parseRoute` may need a `session` record or an explicit pattern). `loadExplorer('sessions')` dynamically imports `explorers/sessions.js`. `/plans` and `/artifact` stay named Phase 12 routes. Keep the account routes and not-found behaviour unchanged.

### Sessions list

- Add `explorers/sessions.js` exporting `title`, `phase: 11` and `render(root, doc, { signal })`, following `explorers/ledger.js`'s route-scoped abort and one `createPanelFrame` (or a plain table frame) shape:
  - Read the URL scope with `decodeUrlState`; build `/entities?grain=session` parameters through the shared scope/window helpers (or an equivalent pure builder that emits only contract filter names, `exclude`, timezone, `from`/`to`/`all=1`, `sort`, `limit`, `cursor`). Fetch `schema` for `page_max`; hard-code no page or cell limit.
  - Sort control offers only session measures the schema publishes; changing it is a pushed scope change (`sort=<measure>:asc|desc`) and refetches from the first page. Lens chips and the shared scope tray use the existing `createChips`, `createSelectionTray` and inspector; a row's identity is `conversation_id`, and `Open` navigates to `/sessions/<id>`.
  - Render a table with identity/measures/lenses/flags, a Load-more cursor control, the typed population line ("N of M sessions") and honest missing/unattributed/unpriced counts. A sort or filter change never sums a partial page.
  - Empty, error, cancelled and unsupported states use the one vocabulary; removing a filter/cohort/selection cause works as in the ledger.

### Session detail and lanes

- Add `panels/session-lanes.js` as a registered panel (id `session-lanes`, grain `session`, `charts: ['lanes']`, watermarks/`table: true` if appropriate) that composes the existing `<yk-lanes>` element; it is not added to any preset. It exposes a loader over `/conversation?id=…` and maps:
  - tool events by `tool_kind` into lanes; model calls in a call lane with cumulative cost;
  - `priced === false` (or an absent/`null` cost on a call) as a hollow/unpriced marker, never `$0`;
  - artifacts and commits written with `repo_id`/`path`/`plan` identity;
  - a table of the returned events with time, type, tool/model, cost and priced flag.
- Extend `explorers/sessions.js` to detect `/sessions/<id>` and render detail:
  - fetch `/conversation?id=<id>` with the route-scoped signal (never `cohort=`), including optional `from`/`to` when the scope has absolute bounds;
  - header facts (conversation id, harness/models, repos, first/last), whole-run totals and `window_totals`, and the truncation line using `returned_events`/`total_events`; the displayed lanes/table reconcile only to returned events;
  - a separate line for `returned_unpriced_calls` vs `total_unpriced_calls` so omitted unpriced calls are not folded into the visible marker count;
  - a paged ledger link `/ledger?conversation_id=<id>` for the omitted events;
  - links to observed artifacts (`/artifact?repo_id=…&path=…&hash=…`) and plans (`/plans/<repo>/<plan>`), each naming Phase 12; no inferred completion or review state.
  - `/conversation` errors (`id required`, `conversation not found`) render as the server states them with retry; a truncated response never hides the cap.

### Fixture and tests

- Extend the `p11` stub scene additively with:
  - deterministic session list rows (several harnesses/models/repos, priced/unpriced/all-unpriced, `(multi)`/`(none)` groups), a stable `sort` response for several measures, opaque cursors with a second page and no duplicate keys;
  - a `/conversation` body with `returned_events: 5000`, `total_events > 5000`, `returned_unpriced_calls` less than `total_unpriced_calls` (the unpriced call is beyond the cap), returned `priced` flags, artifacts/commits with identities, and `truncated: true`.
  Keep every existing P10/11-01/11-02/11-03 body byte-identical.
- Add `tests/scatter-sessions/sessions.test.mjs` with pure checks (sort/param builder, row/measure mapping, truncation and unpriced reconciliation, cap arithmetic, detail links) and Chromium checks:
  - `/sessions` settles a table, a sort by a session measure refetches server-side in the asserted order, Load-more appends a unique second page, a lens chip narrows with a pushed URL, and an empty/error state is named;
  - `/sessions/<id>` renders the lanes and table; hollow unpriced markers exist; `returned_events`/`total_events` and returned/total unpriced are both shown; displayed markers equal returned events; the ledger link carries `conversation_id`; artifact/plan links name Phase 12; no `cohort=` is sent to `/conversation`; `maxInFlight <= 4`; clean diagnostics; no fixed sleeps.
- Update `tests/workspace/engine.test.mjs` for the delivered `/sessions` explorer and detail route (its old named-phase assertion is now wrong). Keep `/plans` and `/artifact` named assertions.

### Keep untouched

- The Phase 9/10/11 scatter panels, presets, Start paths and chart kit. No new chart type, route, grain, join, dependency or gesture; no server change and no Go edit.
- The shared chips/tray/inspector grammar beyond the additive reuse in this explorer; no change to cohort JSON or the term "session".
- The artifact reader and plan detail: name them, do not build them.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/sessions.test.mjs` (workdir `packages/yakka-analytics`) → all pure and Chromium checks pass; a missing playwright-core/Chromium skips with the named reason, never passes silently.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs` → the updated route expectations and the rest of the Phase 9 suite pass.
- `node --test tests/scatter-sessions/*.test.mjs` sequentially (`--test-concurrency=1`) → scatter and sessions checks stay green.
- `node --test tests/workspace/*.test.mjs` → the workspace suite is green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the exact before/after outputs, the fixture pages/cap arithmetic, the engine expectation change, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
