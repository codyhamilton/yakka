# Handoff — phase2-08 Plans, Sessions and Event ledger lists

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- **Ledger:** nine-column table (`LEDGER_COLUMNS`) replaces the 14+Select panel table; exact caption, `Time`/`Repository`/`Path/event`/`Cost USD` labels, 150/120/160/180/70/240/150/80/90 widths, 30px ellipsised rows, left numeric. `Path/event` shows path else event. Open resolves exact artifact only for repo+path, session only for conversation_id, otherwise no destination; committed scope rides along.
- **Plans:** table-only screen, no `scatter-plan` insertion, section or display-state hook. Exact 11 columns/widths; measures and labels in contract order; default `associated_cost_usd:desc`; URL sort round-trip; disabled legacy-record refusal removed only where no longer applicable; T1–T4 rows inside the table; scoped `/plans/{repo}/{plan}` Open; `Load more plans`, `Loading…`, `Retry next page`; empty/error recovery.
- **Sessions:** exact 13 columns/widths incl. Select; contract measures/labels, default `cost_usd:desc`, `sort=measure:dir`; Select toggles the tray predicate without a query/filter change; scoped `/sessions/{id}` Open; T1–T4 in-table states, paging retry and append; brief `fields` list on `/entities`.
- **CSS:** plans/sessions/ledger tables get internal horizontal scroll at 1416px, fixed layout, 30px single-line rows, left alignment and state-row styling. Widths are carried with `col width` attributes rather than inline `style` so the strict CSP is respected.
- **Tests:** updated the four owned files; added exact columns/widths/caption/default-sort/URL/Select/scoped-Open/T1–T4/no-chart assertions and next-page failure recovery for plans and sessions.

## Evidence before and after

Before: the four owned files reported 46 passing tests. After:

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  PUBLIC_CANVAS_TEST_MODE=true node --test \
  tests/workspace/ledger.test.mjs tests/operable-chrome/ledger-states-unit.test.mjs \
  tests/plans-artifacts/plans-list.test.mjs tests/scatter-sessions/sessions.test.mjs
# tests 49  # pass 49  # fail 0  # duration_ms 244185
```

`tests/plans-artifacts/plan-detail.test.mjs`: 10 pass, 0 fail (detail untouched). Browser evidence at 1440×900: plans 4→8→10 rows, sessions 20→40, ledger >20,000 with unique keys, no duplicates; all three tables computed `min-width:1416px`; rows 30±1px; ledger has nine headers and no Select.

## Check IDs

| ID | Result | Evidence |
|---|---|---|
| S-plans | pass | Exact columns/widths; default cost desc; URL `sessions:desc`→cost round-trip; no chart/`scatter-plan`; scoped Open; 4→8→10 append. |
| S-sessions | pass | Exact columns/widths incl. Select; default cost desc and direction change; Select leaves URL/rows unchanged; scoped Open; 20→40 append. |
| S-ledger | pass | Nine columns, no Select; exact caption; `Path/event` fallback; >20k unique keys; scoped artifact/session destinations and no destination otherwise. |
| T1 | pass | Headers kept, one 30px busy row, prior rows cleared; plans/sessions/ledger unit and browser checks. |
| T2 | pass | `No records match these filters.` plus All history/Reset filters, headers retained; empty fixtures. |
| T3 | pass | `Could not load {Plans|Sessions|Event ledger}.`, sanitized code, Retry; 401/403/503/timeout unit; legacy paths unchanged. |
| T4 | pass | Plans and sessions keep loaded rows on failure and retry appends; ledger unit proves 100→200→237 once, browser proves paging past 20,000. |
| C1–C11 | pass | Shared shell unchanged; list tests exercise window, repo/harness, filters, chips removal, All history, Reset and sort; no new control. |
| V1–V5 | pass | V2/V4 directly verified (full width, 30px, left, no centred/hero styling); V1/V3/V5 rely on untouched shell and shared tokens. |
| F3 | pass | Only declared filters sent; unsafe legacy record filters still refuse. |
| F4 | pass | Schema intersection keeps contract order/labels; no metadata-derived options. |
| F1/F2/F5/F6/F7 | n/a | These lists contain no chart distributions, exact-entity detail, storage or account surfaces. |

Report rubric: `r.done_verifiable` pass; `r.departures_named` pass; `r.unfinished_actionable` pass; `r.problems_plain` pass; `r.nothing_unusable` pass.

## Departures and interpretation

- Column widths are treated as declared minima: their pixels sum below 1416px, so the fixed table enforces the 1416px minimum and lets the browser distribute the remainder. Computed width is 1416px in all three.
- `col width` attributes replace inline width styles because the app CSP blocks `style-src-attr` (`style` assignments produced CSP violations in the ledger browser check).
- `planScatterSpec`/`scatterSampleNote` remain exported because the Scatter route and its unit checks still use them; only the Plans list mount and stale scatter CSS were removed.

## Unfinished work

None in this unit. Out-of-scope acceptance tests that assert the old list shapes (`tests/scatter-sessions/acceptance.test.mjs`, `tests/plans-artifacts/acceptance.test.mjs`, `tests/plan29/*`, the stale `/No rows match/` line in `tests/workspace/acceptance.test.mjs`) will need their owners to update them; they were not run or modified here.
