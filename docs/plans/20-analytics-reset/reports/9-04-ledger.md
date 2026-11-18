# 9-04 — Ledger explorer

Status: `done with concerns` (deliverable complete; the Chromium acceptance is
gated on a stub route this unit may not edit — see gates).

## What changed

- `web/js/panels/ledger-table.js` (new) — the `ledger-table` registry entry
  (`grain: 'event'`, `charts: []`, `table: true`, `requests()` =
  `GET /v1/analytics/explore`) plus pure helpers: `resolveWindow`,
  `filterToParameters` (only the ten declared shared filters are sent; from/to
  beat win; repeated `exclude` preserved; undeclared lenses dropped),
  `pageParameters` (cursor + limit over the frozen filter), `rowKey`,
  `entityKeyForRow`, `appendPage` (order-preserving append, dedupe by row
  identity), `displayedCount`, `pagingSummary`, `formatRowCost`/`unpricedCount`/
  `costNote`, `selectionGrain`, `mapExploreResponse` (ready/empty/error/409
  cursor/404 unsupported) and `mapLoadError` (abort → cancelled). A real table
  renderer (caption, scoped headers, row checkbox, Shift/Ctrl/Cmd/Alt click,
  arrow/Home/End navigation, Enter inspect, Space select, `x` exclude, visible
  focus) and the declared-filter/lower-bound footer.
- `web/js/explorers/ledger.js` (replaces the 9-01 placeholder) — loads
  `/css/ledger.css` idempotently, registers the entry, mounts one 9-01 panel
  frame, reads the page budget from `/schema.budgets` (no client hard-coded
  limit), follows `next` on “Load more”, appends + dedupes, keeps the frame’s
  one state vocabulary, and wires the 9-02 chips/tray/inspector. Chips removal
  and tray actions push history; Back restores through the app router.
- `web/css/ledger.css` (new) — table, sticky header, chip row, load-more,
  focus, 44 px targets, single-column/scroll layout below 900 px. No animation
  or transition.
- `tests/workspace/ledger.test.mjs` (new) — 11 pure checks and 3 Chromium
  specs (paging past 20,000, chip remove/Back, unsupported filter named,
  inspect, unpriced, empty/legacy, console/CSP/`maxInFlight`).

No route, grain, join, filter, gesture, storage key, dependency or server
change was added. `app.js`, `router.js`, core modules, the harness/stub, Go and
other explorers are untouched.

## Check output

Before (the brief’s command; test file absent):

```
$ NODE_PATH=… node --test packages/yakka-analytics/tests/workspace/ledger.test.mjs
Could not find '/…/tests/workspace/ledger.test.mjs'
```

After:

```
$ NODE_PATH=… node --test packages/yakka-analytics/tests/workspace/ledger.test.mjs
# tests 14  # pass 11  # fail 0  # skipped 3
   (3 Chromium specs skip: "the workspace stub has no /explore route (owned by 9-01, outside this unit); see gate")

$ NODE_PATH=… node --test packages/yakka-analytics/tests/workspace/engine.test.mjs
# tests 9  # pass 9  # fail 0
```

Manual verification (throwaway harness outside the repo, not committed): with
an `/explore` page of 20050 stub rows, `/ledger?win=all` settles `ready` and 40
“Load more” clicks reach 20,050 rows with 20,050 unique row keys and
non-increasing `ts`; removing a filter chip drops `harness` from the URL and
Back restores it; `exclude=screen_verdict:pass` shows “not applied here:
screen_verdict”; a row opens the inspector with time/conversation/repo/kind/
path/stage/cost; an unpriced row reads `unpriced` and no cost cell reads `$0`;
zero page/console errors, zero CSP violations, `maxInFlight` 1.

## Deviations

- The explorer passes `search: ''` to the shared chips/tray when building a new
  URL, so a removed filter is actually dropped (see the url-state bug below).
  This changes no contract and does not edit the core modules.
- Page size is `min(explore_page_max, page_max)` from `/schema.budgets`; when
  schema is unavailable it is omitted and the server default applies.

## Contradictions / gates

- The brief’s required reading says the workspace stub already has “`/explore`
  rows, cursor and scenes”, but `tests/workspace/stub-api.mjs` has no
  `/explore` handler and this unit may not edit the harness/stub (9-01 owns
  those paths). The Chromium specs therefore skip with the named reason above.
- `gate: add /v1/analytics/explore to tests/workspace/stub-api.mjs (+ fixture rows) with cursor paging over >20,000 rows and the existing empty/legacy scenes; then the three ledger Chromium specs run.`
- `gate: web/contract/url-state.js encodeUrlState preserves a prior filter key when the new state no longer contains that key, so removing a filter chip re-adds it from the old search. Root cause: the prior-copy loop tests `!(key in state.filters)` instead of “the state no longer carries this key at all”. 9-04 worked around it by rebuilding from state with an empty prior search; the core module still has the bug.`

## Known problems

- Selection is entity-level, per the interaction contract: picking one event of
  a conversation selects that session, so every row of the conversation shows
  selected. The tray predicate then uses the conversation id, which makes
  session cohorts correct.
- Artifact promotion uses `repo_id` + `path` as the artifact `id` value; the
  artifact `id` lens grammar is not confirmed by this brief, so an artifact
  cohort may need the canonical artifact identity from the server.
- Rows without a cost field render `unpriced` (the brief’s rule for absent
  cost), which includes event types that have no price concept; the footer
  lower-bound count is therefore wider than “usage calls”.
- The committed Chromium acceptance cannot run until the stub gate is closed;
  the proof above used an uncommitted throwaway harness and is not repeatable
  from the repo yet.

## Budget

Four owned files, roughly 1,000 changed lines (panel, explorer, CSS, spec) and
the report; no scope added. Within the brief’s 800-line target only loosely;
the overrun is the browser spec that is written but gated.

## Unfinished

None for this unit’s contract. Closing the two gates above is what makes the
committed browser evidence runnable.
