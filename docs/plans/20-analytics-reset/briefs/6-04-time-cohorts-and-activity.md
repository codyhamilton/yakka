# Brief: 6-04 — Time cohorts and activity feed

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/` existing analytics entity/activity route and schema code, `packages/yakka/internal/store/` time-contributor and activity reads, focused fixture tests under `packages/yakka/internal/{serve,store}/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-04-time-cohorts-and-activity.md` and include it in the commit.
Depends on: 6-01, 6-02 and 6-03; Phases 1–5.
Runs alongside: Nothing; both additions use the shared cohort, entity, activity and schema surfaces.
Budget: 18 files to read, about 1,200 lines to change, 24 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3 time-cohort resolution, activity/probe contract and shared runtime budgets.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 6 outcome and assumptions 28–29.
3. Existing `/entities` time mode, `/explore` receive-watermark paging, rejection/session facts, and 6-02/6-03 reports.

## Goal

Complete the time-grain source mapping and the merged, cursor-paged activity/probe API required by Phase 6, using only existing ledger facts.

## Contract

For time cohorts, follow CONTRACTS.md 17.3: carry source fields/effective bucket/step; reproduce the frozen bucket grid; resolve distinct existing contributing sessions over half-open bucket intervals intersected with inclusive source bounds; deduplicate usage identities; report missing/orphan rejection associations; apply the target window and report expansion. For activity, return only the specified session-start, artifact-version, brief-execution and rejection observations with deterministic order and type-qualified identity. Probe returns counts by type and a new receive watermark, including late arrivals, never raw history. Both obey typed coverage, unsupported-filter reporting and the shared deadline/cancellation limits.

## Changes

- Extend the 6-02/6-03 resolver for time sources; never infer causal pairings or contributors from sample marks.
- Implement `/v1/analytics/activity` list and `mode=probe` using existing facts; register only the route already named in the contract and apply the 6-02 cohort resolver with 6-03's target-filter semantics.
- Publish matching schema capabilities only when both behaviors are complete.
- Do not add a new observation type, persisted event, route, grain or source.

### Keep untouched

Preserve the existing time aggregate measures/bucket rules and `/explore` semantics. Plans 21/22/23 remain absent unless a real `/schema` feature exists; no fake records.

## Done evidence

Identify or write a failing check before changing code. Report its output before and after.

- Time cohort fixtures verify frozen field/resolution, shared bucket grid, half-open edges, deduplicated contributors, distinct session membership, missing/orphan rejection counts and target expansion.
- Activity fixtures page equal-time records deterministically with no gaps/duplicates; probe counts late arrivals by receive watermark without returning event rows.
- Deadline, cancellation, tenant binding and unsupported-filter tests pass under `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Activity|Cohort|Entity)' -count=1`.
- `/schema` publishes only implemented Phase 6 features; design-only neighbor features remain absent.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
