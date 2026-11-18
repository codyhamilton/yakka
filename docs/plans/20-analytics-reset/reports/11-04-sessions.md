# 11-04 — Sessions list and detail

Status: `done`. `/sessions` is a real server-sorted, cursor-paged session
explorer and `/sessions/<id>` is the bounded `/conversation` timeline drawn by
a new `session-lanes` panel. The new spec passes 12/12, the rest of the Phase 11
scatter/sessions suite 37/37 sequentially, the Phase 9 engine/Start/acceptance
suite 16/16 and the whole workspace suite 72/72. All bodies are existing
routes/grains/joins/chart types; no Go, dependency, gesture or preset was added.

## What changed

- `web/js/core/router.js`: `/sessions` is an explorer (`EXPLORER_PATHS`) and
  `/sessions/<id>` is an explorer record carrying `sessionId`; both are removed
  from `NAMED_ROUTES`, which keeps `/plans` and `/artifact` as Phase 12 named
  destinations. `loadExplorer('sessions')` dynamically imports the new module.
- `web/js/explorers/sessions.js` (new): the list reads the URL scope, folds the
  session-specific filter names out of the codec's `unknown` bag into filters,
  builds `/entities?grain=session` from the schema-published measures/lenses,
  the frozen window, `exclude`, `sort`, `limit` (schema `page_max`) and the
  server cursor. The table offers only published measures in its sort control,
  pushes `sort=<measure>:asc|desc`, shows identity/measures/lenses, a typed
  "N of M sessions shown" line, page-local missing/unattributed/unpriced notes,
  a Load-more control and lens buttons that push a filter chip. Chips, tray and
  inspector are the shared modules; a row's identity is `conversation_id` and
  Open navigates to `/sessions/<id>`. Empty, error, cancelled and unsupported
  use the one panel-state vocabulary. The detail fetches
  `/conversation?id=<id>` with only absolute `from`/`to` (never `cohort=`),
  states header facts, whole-run and window totals, the 5,000-event cap and
  returned/total unpriced counts separately, renders the lanes and the
  returned-event table, and links `/ledger?conversation_id=`,
  `/artifact?repo_id=&path=&hash=` and `/plans/<repo>/<plan>` (each naming
  Phase 12 for the reader/detail).
- `web/js/panels/session-lanes.js` (new): the `session-lanes` panel (grain
  `session`, `charts: ['lanes']`, `table: true`, `requires:
  ['entities_session']`) composes the existing `<yk-lanes>`, classifies every
  returned event into a tool-kind, model-call, artifact, commit or other lane,
  computes cumulative cost over returned priced calls, draws `priced === false`
  calls hollow and renders a returned-event table. It is not named by any
  preset.
- `web/css/sessions.css` (new): list, lens chips, coverage, detail facts and
  event-table layout. No chart-base edit.
- `tests/workspace/fixture.mjs`: additive `p11SessionListRows`,
  `p11SessionList`, `p11ConversationEvents`, `p11Conversation`, `p11Entity`.
  Every existing P10/11-01/11-02/11-03 body is unchanged.
- `tests/workspace/stub-api.mjs`: P11 dispatch for session list paging,
  `/conversation`, `/entity?grain=session&id=` and a `sessionError` control.
  `cohort=` on `/conversation` and `/entity` is refused with
  `route_not_supported`.
- `tests/workspace/engine.test.mjs`: `/sessions` and `/sessions/<id>` are now
  explorer records (`explorer: 'sessions'`, `sessionId`), not a phase-11 named
  destination; `/plans` and `/artifact` remain named Phase 12.
- `tests/scatter-sessions/sessions.test.mjs` (new): 8 pure checks and 4
  Chromium checks.

## Fixture pages and cap arithmetic

- List: 40 deterministic rows, 20 per server page, opaque `p11:<offset>`
  cursors; the second page has no duplicate `conversation_id`, and the client
  appends pages without re-sorting or summing.
- Detail: `returned_events` 5,000, `total_events` 5,123 → 123 omitted;
  `returned_unpriced_calls` 10, `total_unpriced_calls` 13 → 3 omitted unpriced
  calls. The lanes draw exactly 5,000 markers, of which 10 are hollow; the
  stated returned/total unpriced lines are separate from the marker count. The
  unpriced call beyond the cap is only reachable through the paged ledger link.

## Checks: before and after

Before this unit the named spec did not exist. The tree was the green Phase 11
state recorded by 11-03 (scatter/sessions 16, workspace 72). The first run after
implementation failed 3/12: the fixture test parsed epoch-second `last_ts` with
`Date.parse`; a legacy server correctly renders `unsupported` (it advertises no
`entities_session`) rather than an error, so the spec now asserts unsupported
and uses a separate 500 control for the error state; and the unknown-conversation
404 intentionally logs one failed-resource console entry. Those three were
test-side expectations, not product defects.

After (workdir `packages/yakka-analytics`, 8 GiB heap,
`PUBLIC_CANVAS_TEST_MODE=true`, Playwright via the required `NODE_PATH`,
`--test-concurrency=1` unless stated):

```
$ node --test tests/scatter-sessions/sessions.test.mjs
# tests 12  # pass 12  # fail 0  # skipped 0

$ node --test --test-concurrency=1 tests/scatter-sessions/*.test.mjs
# tests 37  # pass 37  # fail 0  # skipped 0

$ node --test --test-concurrency=1 tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs
# tests 16  # pass 16  # fail 0

$ node --test --test-concurrency=3 tests/workspace/*.test.mjs
# tests 72  # pass 72  # fail 0
```

Chromium 1243 and `playwright-core` were reachable; no skip or gate is
recorded. The browser proof covers the settled list, a server-side sort in the
asserted order both ways, Load-more appending 40 unique rows, a lens chip that
pushes `harness=orca` and narrows the table, an empty state and a server error
with Retry, and a legacy server's `unsupported` state naming `entities_session`.
The detail proof covers 5,000 markers and 5,000 table rows, 10 hollow unpriced
markers, both cap lines, the ledger/artifact/plan links with their Phase 12
notes, no `cohort=` on `/conversation`, `maxInFlight <= 4` and clean page
diagnostics; an unknown id shows the server's `conversation not found` with
Retry.

`git diff --check` is clean; no `/tmp` writes, fixed sleeps, animation
assertions or Go edits. No agents were spawned.

## Deviations and contradictions

- **`session-lanes` registration:** the brief says "as a registered panel" but
  `web/js/panels/index.js` is outside the owned paths. The explorer registers
  the exported, validated entry on first detail render instead; it is in the
  registry whenever it is used and is named by no preset. This is the one
  departure from a literal reading, and it adds no catalog row.
- **Brief vs CONTRACTS 7.2 seam:** the brief lanes tool events by `tool_kind`,
  but the `/conversation` event shape in 7.2 publishes `tool`, not `tool_kind`.
  The mapper uses a server-supplied `tool_kind` when present and otherwise falls
  back to `tool`/`other`; it never invents a kind from a client-side table. The
  P11 fixture supplies `tool_kind`, so the delivered lane proof is exact.
- **Same seam for identities:** 7.2 does not publish `repo_id` or `plan` on a
  conversation event. Artifact links use an event `repo_id` when present, or the
  conversation's single repo, and derive `plan` from the stored
  `docs/plans/<plan>/` path; none is inferred beyond the response. The fixture
  carries both fields.
- `sort` is not a reserved URL key, so it stays in the codec's `unknown` bag and
  is read from the search string; it is pushed as `sort=<measure>:asc|desc`
  without changing the URL-state contract.
- The stub caps list pages at 20 server-side to prove Load-more; the client uses
  the schema's `page_max` (500) and hard-codes no page or cell limit.

No unresolved brief-vs-contract contradiction remains; the two seams above are
reported rather than silently resolved.

## Unfinished

None for this unit. 11-05 (phase acceptance) remains.
