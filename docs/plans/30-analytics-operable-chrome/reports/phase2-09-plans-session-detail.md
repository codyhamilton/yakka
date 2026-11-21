# Handoff — phase2-09 Plan and session detail screens

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- **S-plan-detail (`web/js/explorers/plans.js`, detail only):** regions now render in the contract order — identity/summary strip, G-planline (`plan-timeline`), Artifacts, Executions, Associated sessions, Plan events. The out-of-contract “Stored design context” region and the blanket “not applied here” note are gone. `PLAN_DETAIL_COLUMNS` pins the exact labels: Artifacts `Kind, Path, Latest version, Score/scorer/band, Content, Screen verdict, Writing session cost USD, Open`; Executions `Shape, Brief path, Time, Session cost USD, Brief/report scores, Session`; Sessions `Conversation, Last observed, Cost USD, Unpriced calls`; Events `Time, Type, Event, Path, Conversation`. Identity/path columns are 240px, time 150px, the rest split equally under a 1416px fixed table. Sources stay exact (`/entities?grain=artifact|execution&repo_id=&plan=`, `/entity?grain=plan&collection=sessions|events`, then `/entities?grain=session&id=` enrichment); each collection keeps its own `Load more`. Back and Open links preserve the committed search scope and artifact Opens add no hash.
- **Per-region F:** `planRegionRefusal` refuses a region with the one literal sentence when a scope cannot be applied: artifacts accept `kind`/`harness`/`session_model`, executions accept `harness`/`session_model`, and the exact collections accept identity/window only. A conflicting `repo_id` or any active cohort refuses every region. No unfiltered rows are shown.
- **S-session-detail (`web/js/explorers/sessions.js`, detail only; `web/js/panels/session-lanes.js`):** identity strip, then separate **Selected window** and **Whole session** strips, G-sessionlanes, then the Session records table. Records/timeline read `/explore?conversation_id={id}&limit=100` (+ shared scope, T4 `Load more session events`); the selected strip reads `/entities?grain=session&id={id}`; the whole strip reads `/conversation?id=` and is visibly labelled `Whole session exception`. A whole-session 404 surfaces the server message and Retry. G-sessionlanes uses one lane per recorded event type, markers only (no duration), the verbatim caption, and `{n} loaded matching events plotted` capped at 5,000. Its chart table view has the 7 contract columns; the full-width records table has the 5 S-session-detail columns.
- **CSS (append only):** 30px left-aligned rows, fixed table layout with a 1416px internal scroll, ellipsised identities with titles, full-width regions, and the labelled whole-session strip.
- **Tests:** new `tests/operable-chrome/detail-screens-unit.test.mjs` (8 checks) and a rewritten browser/contract set in `tests/plans-artifacts/plan-detail.test.mjs`.

## Evidence before and after

Before the change the new unit file failed at import (`PLAN_DETAIL_COLUMNS` absent); the old plan-detail suite asserted the old design/timeline regions. After:

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  PUBLIC_CANVAS_TEST_MODE=true node --test \
  tests/plans-artifacts/plan-detail.test.mjs tests/operable-chrome/detail-screens-unit.test.mjs
# tests 18  # pass 18  # fail 0
```

Second required command:

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  PUBLIC_CANVAS_TEST_MODE=true node --test \
  tests/plans-artifacts/plans-list.test.mjs tests/scatter-sessions/sessions.test.mjs
# tests 27  # pass 26  # fail 1
```

The one failure is `tests/scatter-sessions/sessions.test.mjs:331` “the detail draws returned markers, states the cap and links artifacts, plans and the ledger”. It asserts the superseded `/conversation`-only detail (`.session-event-row` = 5000, cap coverage lines, `.session-written` links); the new contract reads records/timeline from `/explore`, so that test is stale, not a list-mode regression.

Browser observable at 1440×900 (recorded against the p11/p12 harness): session detail renders identity → Selected window / Whole session strips → lanes → records full width (1398px), every record row 30px, records headers `Time, Event type, Repository, Path/event, Cost USD`, caption and `100 loaded matching events plotted` present, 100 marks in the lane chart. Plan detail renders the six regions in order with 30px rows. The harvested stub does not filter `/explore` by `conversation_id`, so browser record rows are the first ledger page; the exact source/scope assertions are unit-tested.

## Check IDs

| ID | Result | Evidence |
|---|---|---|
| S-plan-detail | pass | Region order `[summary, planline, artifacts, executions, sessions, events]`; exact columns/widths/sources; 4+8 paged independently; scoped Back/Open; F refusal; browser order/30px/title. |
| S-session-detail | pass | Identity + two strips with distinct `/entities?grain=session` and `/conversation` sources; `/explore` records; exact 5 columns; back/ledger scope; whole-session exception label. |
| G-planline | pass | Placed second, one `plan-timeline` panel, verbatim caption asserted in the browser test. |
| G-sessionlanes | pass | Verbatim caption, lanes by event type, markers only, `{n} loaded matching events plotted`, 7-column chart table and 5-column records table both explicit. |
| T1 | pass | Region tables keep headers and show one full-span loading row; prior rows cleared. |
| T2 | pass | `No records match these filters.` for records/lanes; collection region empty text retained. |
| T3 | pass | `Could not load Session records.` with sanitized code; whole-session 404 shows the server message + Retry. |
| T4 | pass | Plan collections page independently; `Load more session events` appends with a frozen cursor, hides without `next`, keeps rows on failure and offers `Retry next page`. |
| C1–C11 | pass | Shared scope controls are still inserted by the shell; detail screens add no new control. |
| F1/F2/F6/F7 | n/a | No distributions, storage or account surface in this unit. |
| F3 | pass | Only declared filters ride the artifact/execution reads; unsupported regions refuse rather than return unfiltered rows. |
| F4 | pass | No metadata/facet override; schema only supplies the page budget. |
| F5 | pass | Plan identity is fixed; exact collections never broaden; the artifact Open is scoped and hash-free. Identity exceptions keep the parent identity. |

Report rubric: `r.done_verifiable` pass; `r.departures_named` pass; `r.unfinished_actionable` pass; `r.problems_plain` pass; `r.nothing_unusable` pass.

## Departures and interpretation

- **Design region removed / G-planline moved:** the old “Stored design context” section and its timeline-last placement are outside the written S-plan-detail region order, so they were removed rather than kept as extra scope.
- **Whole-session 404:** treated as a page-level error state (`conversation not found` + Retry) while the labelled strips/list regions remain visible; this preserves the old user-facing recovery without using whole-run events as filtered rows.
- **Chart vs records tables:** the 7-column chart table and 5-column records table cannot share one renderer unambiguously; both column sets are configured explicitly, as the brief requires.
- **Fixture gap:** the stub `/explore` ignores `conversation_id`, so the browser proof cannot show filter-driven change; scope/source/refusal is proven by the unit checks instead.

## Unfinished work

- `tests/scatter-sessions/sessions.test.mjs:331` still asserts the superseded `/conversation`-only detail and should be rewritten to the `/explore` records/timeline contract by its owner; it was not edited here.
- The harness needs a `/explore?conversation_id=` scene that filters by conversation before a browser test can prove the filtered-vs-whole change end to end.
