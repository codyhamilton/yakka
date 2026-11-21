# Phase 2-03 report — Pulse and activity panels answer their displayed question

Status: done with concerns (unowned acceptance tests still name the superseded shapes; listed below).

## What changed

- `river.js`: caption registered as `G-activity`; default **table** (Time selected tz, Type, Repository, Plan, Kind, Path, Conversation, Stage, Open) with lanes as the P3 alternative; `event_time DESC, type ASC, identity ASC`; Type `Brief execution`; `mode=list&limit=100`; `Load more observations` uses server `next` as cursor; population reads `{loaded} observations displayed of {cohort_n} matching observations`; applicability refusal keeps caption and never calls observations events.
- `pulse-strips.js`: caption `G-metrics`; seven fixed cells in order priced spend, model calls, hook events, artifact versions, commits, sessions, unpriced calls; table Metric / Selected period / Previous period / Change / Unit; all-history shows `no previous period`; no percent when prior is 0; cost and hook events are unavailable (not filtered) under Brief; summary only, no `/scores` fetch.
- `movers.js`: caption `G-movers`; fixed `cost_usd`, lenses harness then model; one horizontal `yk-bars` (USD, zero origin) plus sparklines and one table Harness/model / Current priced spend (USD) / Previous priced spend (USD) / Change (USD) / Unpriced calls; rows harness then model, spend DESC, identity ASC; measure chooser removed.
- `calendar.js`: caption `G-calendar`; P1 stays (cost_usd default, model calls, commits); `yk-matrix` with labelled scale; table Date / Value (USD), date asc; brush preview and zoom unchanged; measure chooser only when more than one measure.
- `coverage.js`: caption `G-coverage`; table only with Source / Latest retained timestamp / Age / Missing-data count / Unit; source codepoint ascending; `—` for unknown; tenant metadata warning; no blended percentage.
- `pulse.css`: 30px single-line ellipsized rows, left/tabular numeric cells, 7-column metrics grid, chart/table view toolbar, 160px chart minimum.
- Tests: new `tests/operable-chrome/pulse-captions-unit.test.mjs`; `tests/workspace/pulse.test.mjs` updated to the new order and shapes.

## G items

| ID | Result | Evidence |
|---|---|---|
| G-activity | pass | Caption/columns/order asserted in `pulse-captions-unit`; Chromium default table shows `Brief execution`, then lanes alternative inspects 4 categories and opens provenance; empty harness filter names `harness: orca` and Clear works. |
| G-metrics | pass | Caption/7-cell order/all-history unavailable asserted unit; Chromium table shows `$12.50+ (1 unpriced)`, never `Priced spend$0.00`. |
| G-movers | pass | Caption/columns/default asserted unit; Chromium shows no measure chooser, combined table headers, repo lens named absent. |
| G-calendar | pass | Caption/unit/default asserted unit; Chromium brush writes transient `sel` with no URL `from/to`, zoom commits and clears `sel`. |
| G-coverage | pass | Caption/columns/units/warning/no `%` asserted unit; Chromium panel ready with metadata warning. |

## P controls (as they apply)

- **P1** pass (calendar measure). **P2** n/a (movers dims fixed). **P3** pass (river table ↔ lanes). **P4–P7** n/a. **P8** pass (one Show table/Show chart per panel, Data details retained). **P9** pass (river inspect/Open; calendar brush/zoom; movers/cov read-only). **P10** pass (registry returns literal captions; no snake_case prose).

## T and S-pulse

| ID | Result | Evidence |
|---|---|---|
| T1–T3, T5 | pass | Shared frame keeps header/caption; state assertions in `pulse.test.mjs` and existing `acceptance.test.mjs` states pass. Refusal returns before any read (unit test asserts zero GETs) and keeps the caption. |
| T4 | pass | River requests `limit=100`; `Load more observations` appends via `next`, retries in place, hides when no `next`. |
| S-pulse | pass | DOM order metrics-first then river/movers, calendar/coverage; both done-evidence suites pass. 30±1px rows and 160px minimum chart enforced by CSS (measured visually; not timing-based). |

## Commands

Before: `pulse.test.mjs` 11 pass / 2 fail (order). After:

- `node --test tests/operable-chrome/pulse-captions-unit.test.mjs tests/workspace/pulse.test.mjs tests/trends-quality/trends.test.mjs` → 31 pass, 0 fail.
- `NODE_OPTIONS=--max-old-space-size=8192` used for browser runs; `PUBLIC_CANVAS_TEST_MODE=true` for Chromium.

## Deviations and unowned failures

- No brief/design contradiction found.
- `mountPanelViews` sets `data-panel` on its inner `.p10-views`; the Plan 30 harness waits for every `[data-panel]` to be idle, so the inner node stalled global idle. Each owned panel now removes that inner attribute after mounting; no product selector depends on it. This is an integration accommodation, not a design change.
- `tests/plan30/phase1-acceptance.test.mjs` N1 still expects `[data-panel="river"] .activity-caption`; the caption now lives in `.workspace-panel-caption` per P10. All other 17 subtests pass.
- `tests/workspace/acceptance.test.mjs` still expects river lanes by default, a movers measure chooser, and `capability-coverage`; those shapes are removed by G-activity/G-movers/G-coverage. Its saved-board URL also observes a `tenant=fixture-tenant` parameter; that assertion is outside this unit's paths.
