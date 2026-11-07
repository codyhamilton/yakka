# Brief: 6-03 — Cohort target-route integration

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/` analytics route/filter handlers and focused route tests, `packages/yakka/internal/store/` only where target reads require cohort predicates, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-03-cohort-target-integration.md` and include it in the commit.
Depends on: 6-02; 6-01; Phases 1–5.
Runs alongside: Nothing; this unit changes shared route and schema surfaces.
Budget: 18 files to read, about 1,200 lines to change, 24 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3 `cohort=` target semantics and typed populations.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 6 outcome and assumptions 28–29.
3. `packages/yakka/internal/serve/` handlers named in the contract, current shared-filter implementation, and the 6-02 resolver/report.

## Goal

Apply resolved cohorts to every existing contract-listed target route so the same fixed source cohort consistently filters analytics reads and entity rows without changing their unfiltered behavior.

## Contract

For the existing routes `/query`, `/distribution`, `/summary`, `/conversations`, `/executions`, `/scores`, `/score-series`, `/explore` and `/entities` (the full Phase 6 target set except the activity route introduced by 6-04), apply each target's own scope first, then include or subtract the resolved session set; report typed population/relation and cross-grain expansion. Exclusion is subtraction after positive resolution, never predicate complement before resolution. Unsupported filters/joins remain named errors. No new routes or joins.

## Changes

- Thread the 6-02 cohort resolver through all existing target handlers and preserve ordinary shared includes/excludes, pagination, receive watermark/revision, cancellation and deadlines.
- Ensure aggregate/count/baseline populations are filtered server-side before aggregation; do not browser-join independently truncated lists.
- Ensure empty-source include/exclude behavior is 200 with the contract's set semantics; invalid/over-budget definitions fail before partial output.
- Leave `/activity` to 6-04, which owns its route and applies this same cohort contract.

### Keep untouched

Keep existing no-cohort payload fields/defaults stable. Preserve legacy direct `repo_id` behavior and the distinct identity units for files, hashes, executions, calls and sessions.

## Done evidence

Identify or write a failing check before changing code. Report its output before and after.

- Fixture-backed route tests send the same cohort to every listed endpoint and assert target scope/cohort/eligible/returned counts and relation labels agree with contract semantics.
- A session writing both low- and high-score artifacts proves exclusion subtracts the resolved positive selected session set (not the complemented artifact predicate).
- Invalid/unsupported/over-budget requests return named errors and no partial result; unfiltered legacy response tests pass.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Cohort|Query|Distribution|Conversation|Execution|Score|Explore|Entity|Activity)' -count=1` → passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
