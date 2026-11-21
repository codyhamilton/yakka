# Phase 2-12 evidence matrix — acceptance harness and proof

Status: **done with concerns**. Branch `feat/30-analytics-operable-chrome`; owned files are
`packages/yakka-analytics/tests/operable-chrome/harness.mjs`,
`packages/yakka-analytics/tests/operable-chrome/phase2-acceptance.test.mjs` and this report.
No product file, existing test or phase 1 assertion was edited. No Go fixture was added: the
existing Plan 30 fixture already exposes plan-detail (`repo-a/plan-a`), session-detail (`s1`),
artifact version, ledger, plans, sessions, both tenants and a real `/explore` conversation path.

## Command and gate

```
cd packages/yakka-analytics
PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-reporter=spec tests/operable-chrome/phase2-acceptance.test.mjs
```

The suite records 83 IDs in `.scratch/plan30-chrome/screens/results.json`:
**80 pass, 3 fail** (the top-level node:test case fails only because it re-asserts that list).
The 3 failures are named with their owning unit in [Failures](#failures-by-owning-unit).
Screenshots: 16 screens × light/dark at 1440×900 under
`.scratch/plan30-chrome/screens/S-<screen>-<theme>.png`; comparison records in
`.scratch/plan30-chrome/screens/comparisons.json`.

Phase 1 regression command from the brief:

```
node --test tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs
# tests 21  # pass 18  # fail 3
```

`legacy-counts.test.mjs` passes. The three phase 1 failures are phase 1 assertions that still
name the pre-phase-2 DOM/table shapes; they are listed under failures and were **not** edited
because this brief forbids weakening that suite.

Legend: **pass** = an executed browser assertion or screenshot comparison; **pass\*** = the
contract shape (caption, DOM order, request defaults, controls) was asserted, but the Plan 30
fixture has no rows of that shape so value-level marks/tables cannot be shown. These are
fixture-shape gaps, not claimed product passes.

## Phase 2 outcome IDs

| ID | Result | Evidence (request/URL, DOM or screenshot) |
|---|---|---|
| F1 | pass | `/b/pulse?kind=brief`: `pulse-strips`, `movers`, `calendar` have `data-state=unsupported`, empty bodies, captions visible and the exact `This chart cannot apply document kind. Change the filters to view it.`; coverage metadata retained. Observation: `pulse-strips` is refused as a whole rather than individually gating mixed counters (owner U3). |
| F2 | pass | `/b/cost?kind=brief`: all six panels `unsupported`, zero `/v1/analytics/distribution` reads, exact sentence on each, six captions still visible. |
| F3 | **fail** | `/b/trends?repo_id=repo-a` stays inside repo-a. `/sessions?repo_id=repo-a` sends `repo_id` and shows `repo_id: repo-a` plus `not applied here: repo_id`, but 4 of 6 rows are outside repo-a: `s3` (none), `s4` `repo-b`, `s5` `repo-b`, `s6` (none). Owner: U8 Sessions list / shared filter applicability. |
| F4 | pass | `/ledger?repo_id=repo-a`: facet select still offers `repo-b`; `/v1/analytics/facets` and `/schema` carry `tenant=<A>`. |
| F5 | pass | `/artifact?repo_id=repo-a&path=…briefs/01.md&from=2020…&to=2020…`: `.artifact-outside` is visible with `This record is outside the current filters` while repo/path identity stays. |
| F6 | pass | `/ops` for tenant A then B: `/v1/admin/status` 403 leaves `Storage information is available to server administrators only.` in both. Value-level footprint is reported as G-footprint fail. |

## G catalogue

| ID | Result | Evidence |
|---|---|---|
| G-metrics | pass | `/b/pulse` `pulse-strips` literal caption, `Metric/Selected period/Previous period/Change/Unit`, `/summary` read. |
| G-activity | pass | caption, 9 columns, `/activity?mode=list&limit=100`, person-level population text observed. |
| G-movers | pass | caption, 5 combined columns, `/query measure=cost_usd dim=harness bucket=none` and `dim=model`. |
| G-calendar | pass | caption, `Date/Value (USD)`, `/query measure=cost_usd bucket=day`. |
| G-coverage | pass | caption, `Source/Latest retained timestamp/Age/Missing-data count/Unit`, metadata warning text. |
| G-columns | pass | caption, `Bucket/Group/Value`, `/query measure=cost_usd dim=model bucket=auto top=100`. |
| G-lines | pass | caption, same request scope; chart toggle to lines keeps cost_usd/model. |
| G-multiples | pass | caption, `Group/Bucket/Value`, same query scope. |
| G-rhythm | pass | caption, `Weekday (Mon=1)/Hour (0–23)/Hook events`, `/query measure=hook_events dim=hour_of_day`. |
| G-rank | pass | caption, `Group/Value (USD)`, `/query measure=cost_usd dim=model bucket=none`. |
| G-costmap | pass | caption, `Parent/Child/Value (USD)`, `/query cost_usd dim=harness dim=model`. |
| G-ranges | pass | caption, 10 columns, `/distribution grain=conversation dim=session_repo`. |
| G-hist | pass | caption, `Group/Period/From/To/Count/Unpriced`, `/distribution grain=call dim=harness`. |
| G-ecdf | pass\* | caption and `/distribution grain=conversation dim=model` asserted; Cost/Compare panels are `empty` because the fixture has no priced session call bins, so the 5-column table is not rendered. |
| G-scores | pass\* | `/b/quality`: caption, first DOM position and `/scores?kind=design`; four panels are `empty` (no scorer/content scores in fixture). |
| G-scoretrend | pass\* | caption, `/b/quality` second position; no score points in fixture. |
| G-strips | pass\* | caption, third position; no `score:clarity` rows in fixture. |
| G-bands | pass\* | caption, fourth position; no band aggregate rows in fixture. |
| G-mix | pass | caption, `Group/Series/Value (events)`, `/query measure=hook_events dim=tool_kind dim=harness`. |
| G-toolsmap | pass | caption, `Parent/Child/Value (count)`, `/query hook_events dim=harness dim=tool`. |
| G-toolsrank | pass | caption, `Group/Value (count)`, `/query hook_events dim=tool`. |
| G-shapes | pass | caption, 7 columns, `/entities grain=plan sort=executions_unreported:desc limit=12`. |
| G-planline | pass | `/b/workflow` and `/plans/repo-a/plan-a`: caption, 7 columns, `/entity collection=events repo_id=repo-a plan=plan-a` and `/entities grain=execution`. |
| G-planrank | pass | caption, `Group/Value (USD)`, `/entities grain=plan sort=associated_cost_usd:desc`, overlap/lower-bound text. |
| G-sessionxy | pass | caption, `Identity/X (USD)/Y (commits)/Size (calls)` plus whole-population marginals, `/entities grain=session mode=scatter`. |
| G-artifactxy | pass\* | caption and `scores?kind=design` + entities source; panel `empty` (no artifact clarity scores). |
| G-planxy | pass | caption, `Identity/X (USD)/Y (files)/Colour`, `/entities grain=plan mode=scatter`. |
| G-dayxy | pass | caption, `Identity/X (USD)/Y (commits)`, `/entities grain=time mode=aggregate bucket=auto`. |
| G-compranges | pass | caption, current+previous equal-span `/distribution` reads. |
| G-comphist | pass | caption, same fixed bin source for both periods. |
| G-compecdf | pass\* | caption and both-period distribution source; ECDF remains `empty` (no priced bin rows). |
| G-complines | pass | caption, current+previous aligned `/query bucket=auto`; equal spans verified (<1s difference). |
| G-slope | pass | caption, `Group/Previous/Current/Change`; finite 30d comparison. |
| G-sessionlanes | pass | `/sessions/s1`: caption, 7-column marks table, 5-column records table, loaded-marks sentence; `/explore?conversation_id=s1&limit=100`. |
| G-artifactscore | pass\* | `/artifact?...briefs/01.md`: caption and 5-column table with one version; content/scorer absent so the line has no scored points. |
| G-footprint | **fail** | `/ops` footprint panel is `unsupported`; `/v1/admin/status` returns 403 and the panel shows `Storage information is available to server administrators only.` The bytes bars/table cannot be proven with the non-admin fixture session. Owner: U10 Operations / Plan 30 fixture admin shape. |

## P controls

| ID | Result | Evidence |
|---|---|---|
| P1 | pass | `/b/trends` `trend-columns` Measure→`model_calls`; pN URL changes, `/query measure=model_calls` read, caption contains `model calls`. |
| P2 | pass | Group by→`harness`; pN changes, `/query dim=harness`, caption names `coding tool`. |
| P3 | pass | Chart→`lines`; pN chart changes, caption becomes `Each line shows…`, no distribution/entities read. |
| P4 | pass | `/b/cost` `dist-ranges` Grain→`call`; `/distribution grain=call` observed. |
| P5 | pass\* | `/artifact` exposes `Check` then `Scorer` in catalogue order (plus Version/Compare); both option lists are empty because the fixture has no scorer catalogue, so no option change is offered. |
| P6 | pass | `/b/scatter` `scatter-session` X axis→`commits`; `/entities grain=session mode=scatter` fields include `commits`, caption names commits. |
| P7 | pass | `/b/workflow` `shape-bars` Group by offers exactly `plan`; no Harness/Repo option. |
| P8 | pass | `trend-columns` Show table→`data-view=table`, zero analytics requests, visible rows 30±1px; Show chart returns without a read. |
| P9 | pass | `/ledger` row pointer opens `.workspace-inspector`; Escape closes locally. |
| P10 | pass | Every default chart caption on all eight boards equals its literal G string, with no raw snake_case identifier. |

## T states

| ID | Result | Evidence |
|---|---|---|
| T1 | pass | Delayed A reads on `/b/pulse`: `[data-panel][data-state=loading]` keeps captions, clears prior data rows; headers stay. |
| T2 | pass | `/plans` 2020 empty: `No records match these filters.` with All history/Reset filters; All history issues `all=1` and restores rows. |
| T3 | pass | Held A on `/ledger`: `Could not load Event ledger.`, sanitized `busy`, focusable `Retry`; release + Retry restores rows with no HTML/stack. |
| T4 | pass | `/ledger`: `limit=100`, then 100→200→300 loaded rows (≥237 required by the brief; fixture has 8,410 so the third page is 300), all `data-row-key` unique; held next page keeps the loaded rows and `Retry next page` appends. |
| T5 | pass | `/b/cost?kind=brief`: six captions remain above empty bodies; no marks before valid data; T3 keeps caption/text through error. |

## V contracts

| ID | Result | Evidence |
|---|---|---|
| V1 | pass | `/ledger` at 1440: identity 46px, analytics nav 32, account nav 32, h1 32, filter row ≥44, counts 32; `main.left=0`, `.scope-controls.left=12`, right ≤1440, `scrollWidth ≤1440`. |
| V2 | pass | Ledger rows 30±1px; `td` text-align left; body 13px, h1 19px. |
| V3 | pass | All eight boards, both themes: no element background is `rgb(255,255,255)`; `--yk-bg/surface/text/muted/border/chart-surface/cat-1/cat-8` all resolve. |
| V4 | pass | No removable default scope chip; no `Invite`, `Add member` or `Change role`; no sign-in/loading-only opening block. |
| V5 | pass | Analytics nav exact 13-link order; account nav Tokens/Tenants/Membership/Settings/Device approval; brand→`/`; Theme after tenant; `aria-current=page` on every board and list/detail route except S-artifact (see failures). |

## S screens

| ID | Result | Evidence |
|---|---|---|
| S-start | pass | `/`: regions `h1/scope-controls/question-paths/saved-boards`; Question paths 15 rows `Area/Question/Explanation`; Saved boards 4 columns; no chart. |
| S-pulse | pass | Panel order metrics→activity/movers→calendar/coverage, metrics span 12, pairs 704px; captions/requests above. |
| S-trends | pass | columns/lines/multiples/calendar/rhythm order; rhythm full width; caption and request defaults above. |
| S-cost | pass | six panels in order; distribution/default request fields above; ecdf empty (fixture). |
| S-quality | pass | four panels in order with literal captions and empty states (no scores in fixture). |
| S-tools | pass | mix/treemap/rank/rhythm order, correct tool-family captions and requests. |
| S-workflow | pass | shapes/planline/planrank/scatter-plan/river order; plan selector offers `repo-a/plan-a` and `repo-b/plan-b`; P7 Plan only; timeline sources exact. |
| S-compare | pass | five panels in order; cmp=period default; current+previous equal spans. |
| S-scatter | pass | four panels in order; session/plan/day sources; artifact panel empty (fixture). |
| S-plans | pass | 11 exact columns/widths; default `associated_cost_usd:desc`; 2 real fixture plans. |
| S-plan-detail | pass | `plans-detail-identity`, summary, planline, artifacts, executions, sessions, events in order; four tables with exact columns; event/execution sources exact. |
| S-sessions | pass | 13 exact columns; 6 fixture sessions; sort Cost default; Open scoped. |
| S-session-detail | pass | `s1` identity + selected/window strips, lanes then Session records with exact 5 columns; `/explore?conversation_id=s1`. |
| S-ledger | pass | 9 exact columns, no Select; caption literal; 100 real rows; paging proven. |
| S-artifact | **fail** | Region order and version history/score history render, but `.analytics-nav a[aria-current=page]` is `[]`, expected `/ledger` (V5/S-artifact). Observed content is `404 content_unavailable (not_stored)` and one version, so Content/Diff bytes cannot be proven with this fixture. Owner: U10 artifact screen / Plan 30 fixture blob shape. |
| S-ops | pass | Tenant health 240/120/remaining with four fixed rows and both metadata notices; 4-column retained records; footprint shows the specified admin-only 403 wording. |

## Screenshot comparisons (1440×900, light and dark)

Every screenshot was captured from the real Go fixture and Chromium, viewport 1440×900; each
mockup PNG was read and confirmed 1440×900. `.scratch/plan30-chrome/screens/comparisons.json`
holds the machine record. Comparison notes:

| Screen | Screenshot | Mockup comparison |
|---|---|---|
| S-start | `S-start-{light,dark}.png` | region order, Question paths and Saved boards columns match; no production chart. |
| S-pulse | `S-pulse-{light,dark}.png` | metrics-first full row, then 704px pairs, then full odd panel; captions match; production charts are taller than the reference 112px (160px minimum). |
| S-trends | `S-trends-{light,dark}.png` | columns/lines, multiples/calendar, full-width rhythm; same layout/density; production chart height > reference. |
| S-cost | `S-cost-{light,dark}.png` | six panels in two columns; exact captions; ecdf is the fixture empty state. |
| S-quality | `S-quality-{light,dark}.png` | four panels/captions in order; all are fixture empty states (no scorer data). |
| S-tools | `S-tools-{light,dark}.png` | mix/treemap, rank/rhythm; tool captions and axes match. |
| S-workflow | `S-workflow-{light,dark}.png` | shapes/planline, planrank/planxy, full-width river; plan selector and captions match. |
| S-compare | `S-compare-{light,dark}.png` | comparison control above panels; five panels with current/previous captions; full-width slope. |
| S-scatter | `S-scatter-{light,dark}.png` | four 704px panels; marginals beside axes; artifact panel fixture empty. |
| S-plans | `S-plans-{light,dark}.png` | 11 exact columns and widths; two real plans versus mockup synthetic rows. |
| S-plan-detail | `S-plan-detail-{light,dark}.png` | identity/summary/planline then four tables; fixture plan `plan-a` rather than mockup `29-analytics-ui-rework`; order matches. |
| S-sessions | `S-sessions-{light,dark}.png` | 13 columns including Select; six fixture sessions. |
| S-session-detail | `S-session-detail-{light,dark}.png` | identity + two measure strips, lanes, records; fixture `s1` rather than `sess-c81e`. |
| S-ledger | `S-ledger-{light,dark}.png` | 9 exact columns, no chart, caption; 100 fixture rows. |
| S-artifact | `S-artifact-{light,dark}.png` | identity, version history, score history, content tabs/error; mockup's content bytes unavailable (`not stored`), one version. |
| S-ops | `S-ops-{light,dark}.png` | health, footprint, records order; footprint is the specified admin-only refusal instead of bars because the fixture session is not a server admin. |

## Failures by owning unit

| Failure | Owning unit | Observed vs expected | Evidence |
|---|---|---|---|
| F3 — repo filter leak | phase2-08 (Sessions list / shared filter applicability) | expected zero non-repo-a session rows under `repo_id: repo-a`; observed 4 of 6 rows outside repo-a (`s3` none, `s4`/`s5` repo-b, `s6` none) while the banner says `not applied here: repo_id` | `/sessions?repo_id=repo-a`, assertions in `F3` |
| S-artifact — missing active nav | phase2-10 (artifact screen) | expected `.analytics-nav a[aria-current=page]` = `['/ledger']`; observed `[]` | `/artifact?repo_id=repo-a&path=…briefs/01.md` |
| G-footprint — not provable | phase2-10 / Plan 30 fixture | expected bytes bars + Storage category/Retained bytes/Display size table; observed `data-state=unsupported` with `Storage information is available to server administrators only.` (403 `/v1/admin/status`) | `/ops` |
| phase1 N1 — `.activity-caption` missing | phase2-03 (Pulse) / phase1 test shape | phase 1 expects `[data-panel="river"] .activity-caption`; after the phase 2 frame the literal lives in `.workspace-panel-caption`; locator times out | `tests/plan30/phase1-acceptance.test.mjs` N1 |
| phase1 C11 — `.ledger-row-check` missing | phase2-08 (Ledger) / phase1 test shape | phase 1 clicks `.ledger-row-check`; S-ledger removed the Select column, so no such control exists; locator times out | phase1 C11 |
| phase1 T1 — status row colSpan | phase2-08 (Ledger) / phase1 test shape | phase 1 asserts `colSpan >= 14`; S-ledger defines 9 columns and the status row is `colSpan=9` | phase1 T1 |

## Fixture-shape gaps (not product failures)

- The Plan 30 fixture seeds no scorer/content scores and no baseline catalogue, so Quality,
  `scatter-artifact`, `dist-ecdf`, `G-artifactscore` value rows are `empty`; their captions,
  DOM order, request defaults and P5 control order were still asserted (`pass*`).
- The fixture session is an owner, not a server administrator, so `/v1/admin/status` is 403 and
  `G-footprint` bytes cannot be shown. The specified 403 wording and F6 tenant switch were proved.
- Artifact blobs are not stored (`404 content_unavailable (not_stored)`) and only one version is
  seeded, so S-artifact content/diff bytes and a real diff cannot be compared; the version
  history, completeness state and exact error are asserted.
- T4's third page is 300 rows rather than an exact 237 because the fixture ledger window has
  8,410 matching rows; the ≥237, unique-identity and frozen-scope requirements are met.

## Contradictions named, not resolved

- Phase 1's acceptance suite asserts the pre-phase-2 ledger table shape (14+ columns and
  `.ledger-row-check`) while DESIGN S-ledger fixes 9 columns and no Select. This unit must not
  weaken the phase 1 suite, so the mismatch is reported here rather than edited.
- F1 requires mixed summary counters to be individually gated, but the current shared frame
  refuses `pulse-strips` as one unit under `kind=brief`. F1's own proof sentence (no marks,
  exact explanation, caption visible) passes; the richer retention behaviour is a concern for U3.
