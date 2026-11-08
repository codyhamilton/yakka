# Brief: 6-04b — Time-cohort contributor and timezone completion

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/` cohort resolver and focused tests, `packages/yakka/internal/store/` time contributor query code and tests, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-04b-time-cohort-completion.md` and include it in the commit.
Depends on: 6-04; Phases 1–5.
Runs alongside: Nothing; this completes the time resolver introduced by 6-04.
Budget: 10 files to read, about 600 lines to change, 18 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3 time-cohort rules and measure identities.
2. `docs/plans/20-analytics-reset/reports/6-04-time-cohorts-and-activity.md` — exact remaining gaps.
3. Existing `/entities` time aggregation, usage deduplication and rejection/session association code.

## Goal

Complete time-source cohort membership for all supported signed measures and reproduce the frozen source bucket grid under its declared timezone.

## Contract

Follow CONTRACTS.md 17.3: reproduce the source window/tz/resolution grid; evaluate whole-population buckets; resolve distinct sessions with eligible contributions for any named field; usage follows the measure's deduplication identity; rejection contributors require an existing recorded conversation and missing/orphan associations are reported separately. Intervals are half-open and intersect the inclusive source window. No causal pairing or inferred identity is allowed.

## Changes

- Implement non-UTC bucket replay using the captured `tz`, unit and step, preserving calendar/DST boundaries.
- Add contributors for the deduplicated usage measures and rejection receipt-time measures, using their existing identities and association rules.
- Report missing/orphan rejection association counts separately; do not invent sessions.
- Add fixture coverage for non-UTC boundaries, deduplicated usage, rejected/orphan associations, half-open edges and distinct target expansion.
- Keep cohort schema capability unpublished until the supported source mappings are complete and tested.

## Keep untouched

Preserve activity behavior, existing time aggregate definitions and all no-cohort responses. No new route, grain, join, dependency or contract is authorized.

## Done evidence

Identify or write a failing check before changing code and record before/after output.

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Cohort|Entity)' -count=1` passes with the stated time-source fixture cases.
- Full bounded store/serve suites and `git diff --check` pass.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
