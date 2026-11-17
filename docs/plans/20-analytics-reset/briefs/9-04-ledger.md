# Brief: 9-04 — Ledger explorer

Consumer: the Phase 9 ledger worker.
Owned paths: `packages/yakka-analytics/web/js/explorers/ledger.js` (new), `packages/yakka-analytics/web/js/panels/ledger-table.js` (new), `packages/yakka-analytics/web/css/ledger.css` (new), `packages/yakka-analytics/tests/workspace/ledger.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/9-04-ledger.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 9-01, 9-02.
Runs alongside: 9-03, 9-05.
Budget: 15 files to read, about 800 lines to change, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 7.1 (`parseFilter` dimensions), 7.2 (`/explore` route and row shape), 7.3 (count/cost semantics), 17.3 (typed population, time basis for rejections and commit-sourced versions), 17.5 (testability, no chart without a table), 17.7 (browser discipline).
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 9 outcome; panel catalog row `ledger-table`; Interaction model (row checkbox/Shift-click selection, inspect, chips, keyboard, honest uncertainty, time basis, money); Workspace shell and state (panel states, reconciliation).
3. `packages/yakka-analytics/web/js/core/{router,panel-state}.js`, `web/js/panels/{registry,panel-frame}.js`, `web/js/core/{chips,selection-tray,inspector}.js`, `web/js/app.js` — the seams; read the router's expected explorer module path and use it; do not edit the router.
4. `packages/yakka/internal/serve/analytics.go:996-1072` — `/explore` request, cursor `next`, `truncated`, row fields; `internal/store/query.go` event ordering if needed.
5. `packages/yakka-analytics/tests/workspace/{harness.mjs,fixture.mjs,stub-api.mjs,browser.mjs}` — the stub's `/explore` rows, cursor and scenes.
6. `packages/yakka-analytics/tests/charts-cat/bars.test.mjs` for the Chromium spec's wait/settle pattern.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Deliver `/ledger`: a windowed event table over `/explore` with cursor paging that traverses beyond 20,000 rows without gaps or duplicates, every applied filter as a removable chip, ignored filters named, row inspect/selection through the shared tray and inspector, honest units and time basis, and the one panel-state vocabulary.

## Contract

- **Route and grain.** `/ledger` is a Phase 9 route rendered inside the shell; the `ledger-table` catalog entry is an `event`-grain panel. It reads `/v1/analytics/explore` with the shared filter (`from`/`to` or `win`, `tz`, `repo_id`, `harness`, `kind`, `plan`, `norm_event`, `event`, `tool`, `model`, `source`, `conversation_id`, repeated `exclude`) and `limit` at most the server's page budget. Rows are `{type, ts, harness, repo_id, plan, kind, event, tool, norm_event, model, path, conversation_id, source, sha, screen_verdict, rejection_stage, cost_usd, priced}`; `next` is an opaque cursor; `truncated` is true when more rows remain.
- **Cursor paging beyond 20,000.** Follow `next` page by page (a "Load more" control and a count of rows shown); never stop at the first page, never re-request page one, never drop or duplicate a row. If the server returns `truncated` without `next`, say so; never present a counted total from a partial page. A cursor error is the server's `code`/message with retry, not a silent restart.
- **Every filter as a removable chip; ignored filters named.** Use 9-02's chips: each applied scope filter/exclusion is a removable chip (removal pushes history, Back restores). The panel declares the filters it sends; any scope filter outside that set is shown as "not applied here: X" and never claimed as applied. Do not add `ignored_filters` to the server; if `/explore` cannot name an ignored filter, the panel names it from its own declared filter set.
- **Selection and inspect.** Shift/Ctrl/Cmd-click a row or the row checkbox toggles it in the shared selection; Alt-click toggles exclusion; Enter/click inspects the row in the shared inspector with its event facts (type, time, conversation, repo, plan, kind, path, stage, cost/priced). Tray actions resolve the selected event rows through the contract's entity mapping (session via `conversation_id`; artifact via repo/path; rejection with missing/orphan association named); "Open as list" is already this list; "Zoom" for time selections commits `from`/`to`.
- **Basis and money.** Name the basis: event `ts` for facts and rejections' server `at`; commit-sourced artifact versions carry Bash-hook time; late arrivals can appear after their event time. `cost_usd` is per row; `priced:false`/absent cost is `unpriced`, never `$0`; a lower bound names the unpriced count.
- **States.** The 9-01 frame's `loading`/`ready`/`empty`/`error`/`unsupported`/`cancelled` plus badges; `empty` names the filters that produced zero and offers to clear each; `cancelled` offers retry; no hidden clipping.
- **Accessibility.** A real table with a caption, scoped headers, keyboard row navigation and visible focus; touch targets at least 44 px; no animation/transition.

## Changes

- `web/js/panels/ledger-table.js`: registry entry and request descriptor (`/explore` plus parameters), the paging model (cursor append, dedupe by row identity, `truncated`/error handling), the table renderer, chips via 9-02, row selection/inspect events, unpriced rendering, basis/caveat text and state mapping. Export pure helpers (cursor append, row key, filter-to-parameters, displayed count) for unit tests.
- `web/js/explorers/ledger.js`: replace the 9-01 named-destination placeholder with the `/ledger` page module the router lazy-loads: mount the panel frame with the `ledger-table` panel, wire the shared scope/tray/inspector, and idempotently load `/css/ledger.css`. Do not edit `app.js` or `router.js`.
- `web/css/ledger.css`: table, sticky header if useful, chip row, load-more, focus and 900 px single-column styles. No animation/transition.
- `tests/workspace/ledger.test.mjs`: pure checks for filter parameter mapping (including repeated `exclude` and `from`/`to` precedence), cursor append/dedupe, displayed count vs page count, `truncated` without `next`, and unpriced rendering; a Chromium spec that opens `/ledger` against the stub's >20,000-row dataset, pages with "Load more" past 20,000, asserts no duplicate row keys and strictly non-increasing `ts`, removes a filter chip and restores it with Back, sees an unsupported scope filter named "not applied here", opens a row in the inspector, checks an unpriced row never shows `$0`, exercises empty/error/cancelled through harness controls, and asserts no console/page/CSP error and `maxInFlight <= 4`.

### Keep untouched

Do not edit any chart module or CSS, `web/js/core/*`, `web/js/panels/{registry,panel-frame,index}.js`, `web/js/boards/*`, `web/js/app.js`, `web/js/explorers/ops.js`, the harness/stub, Go code, or `tests/e2e/*`, `tests/hosted/*`, `tests/identity/*`. No new route, grain, join, filter, gesture, storage key or dependency; do not add `ignored_filters` server-side.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/workspace/ledger.test.mjs` → all pass, or the browser test skips with `SKIP_REASON` and the run records the gate.
- `NODE_PATH=… node --test packages/yakka-analytics/tests/workspace/engine.test.mjs` → no regression.
- Observable: `/ledger` settles `ready` with rows and a row count; "Load more" pages beyond 20,000 with no duplicate keys and no missing rows; every applied filter is a removable chip and Back restores it; an inapplicable filter is named; a row opens the inspector with its provenance; an unpriced row shows `unpriced`; empty/error/cancelled states are the frame's vocabulary; no console/page/CSP error and `maxInFlight <= 4`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
