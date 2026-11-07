# Brief: 3-03 — Paged reads and honest coverage

Consumer: Plan 20 Phase 3 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_conversation.go`, `packages/yakka/internal/serve/analytics_distribution.go`, `packages/yakka/internal/serve/analytics_score_series.go`, `packages/yakka/internal/store/conversation.go`, `packages/yakka/internal/store/analytics.go`, and directly corresponding tests. Touch nothing else.
Commits: Leave changes in the working tree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/3-03-paged-reads-and-coverage.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the phase commit.
Depends on: 3-01 Range resolution and budget responses; 3-02 Bounded aggregate storage reads.
Runs alongside: nothing.
Budget: 8 files to read, about 500 lines to change, 12 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 3 outcome.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.1 list paging, deterministic order and honest carry-overs.
3. Owned server/store files — current cursor and response fields.

## Goal

Complete Phase 3's read-side pagination and consistency details so long event traversals have no gaps/duplicates and time, pricing and partial-coverage metadata remain honest.

## Contract

`CONTRACTS.md` 17.1 requires `/explore` keyset paging on `(event_time desc, source_type asc, source_key asc)` and stable cursor filters/window; the existing conversation cap remains explicit with `truncated` and whole-run totals. It also requires route-wide `partial`/`partial_reasons`, `/series` timezone correctness, and `priced` booleans on explore/conversation events. Phase 3 outcome requires cursor traversal past 20,000 without gaps/duplicates and consistent timezone, pricing and partial coverage.

## Changes

Compare the current cursor strategy with a receive-watermark/keyset strategy against stable ordering, late arrivals and the fixed cursor contract; use only the contract-required design. Implement the contracted behavior in owned paths. Preserve the 5,000 conversation response cap and whole-run totals. Do not implement entity activity feeds, derivation revisions or new populations (Phase 4/6).

### Keep untouched

Do not change the general filter parser or schema (owned by 3-01); coordinate through the phase owner if a shared contract contradiction appears. Do not change money eligibility or infer `priced` from zero cost.

## Done evidence

Identify or write failing checks before changing code. Report output before and after.

- Cursor tests traverse more than 20,000 fixture events with no gaps or duplicates and deterministic ties.
- `/series` timezone, `partial_reasons`, and priced/unpriced event cases match fixture values; conversation truncation and whole-run totals reconcile.
- Focused Go tests pass under the 8 GiB memory cap.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include candidate comparison, checks before/after, deviations and contradictions.
