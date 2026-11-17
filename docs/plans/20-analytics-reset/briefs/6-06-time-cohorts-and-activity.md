# Brief: 6-06 — Time cohorts and the activity feed

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/store/analytics_cohort.go` (time resolver only), `packages/yakka/internal/store/activity.go`, `packages/yakka/internal/serve/analytics_activity.go`, their focused tests, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-06-time-cohorts-and-activity.md` and include it in the commit.
Depends on: 6-05.
Runs alongside: Nothing.
Budget: 10 files to read, about 500 lines to change, 22 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3.1 — Meaning of a lens (time row), Routes, Association reporting, Invariants.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3 — Time-cohort resolution paragraph.
3. `packages/yakka/internal/store/analytics_cohort.go` (`timeCohortSessionSubquery`), `store/activity.go`, `serve/analytics_activity.go`.

## Goal

Complete the time-grain rules (inapplicable-filter refusal versus `ignored_filters`, frozen bucket grid, source and target rejection associations) and make the activity feed contract-complete and its fixtures deterministic.

## Contract

- At time grain, a scope filter that does not apply to one of `source.fields` (for example `tool` against `rejections`) is 400 `unsupported_join` naming filter and field in a cohort definition. An ordinary `/entities?grain=time` request keeps ignoring such a filter but reports it in `ignored_filters`.
- Time cohorts replay the frozen window, `tz`, bucket unit and step; contributors are distinct existing sessions with at least one eligible contributing fact/call in a selected bucket; receipt-time rejection contributors require a recorded conversation id that resolves to an existing session.
- Association counts: `side:"source"` for a time cohort whose `source.fields` include `rejections` (`total_n` rejections in selected buckets within source scope; only associated ones contributed sessions; `treatment:"selected"`). `side:"target"` on every route that can return a rejection count or row (`/query` and `/series` with `rejections`, `/entities?grain=time` with `rejections`, `/summary`, `/explore`, `/activity`), with `treatment` `dropped`/`kept`. Missing (no conversation id) and orphan (unknown conversation id) are counted separately and never inner-joined away.
- `/activity` carries `population.by_type`, one `{unit, scope_n, cohort_n}` per observation type (`session_start` sessions, `artifact_version` versions, `execution` executions, `rejection` rejections). The feed pages deterministically; the probe counts late arrivals by receive watermark without fetching rows.

## Changes

- Implement the cohort-definition time filter refusal and populate `ignored_filters` for ordinary time requests (the field is added by 6-04; wire the time-specific rule here if needed).
- Replace the rejection contributor inner join so unassociated rejections are reported, not dropped; compute associated/missing/orphan counts and the treatment.
- Add the association counts to the routes above via the shared target population/relation output from 6-05.
- Add `population.by_type` to `/activity`, computed from the cohort restriction, keeping the existing list/probe modes and cursor behaviour.
- Fix the two existing activity tests that use `time.Now()` with a fixed 2026-11-08 window: use fixed fixture timestamps inside the window so the suite is not wall-clock dependent. No animation/timing assertions.

### Keep untouched

Preserve probe watermark semantics (receive time; no row fetch), cursor paging, and every no-cohort response. Do not add an observation type or a route.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- A time cohort with `source.fields` including `rejections` returns source association counts whose identity `total_n = associated_n + no_conversation_id + orphan_conversation_id` holds, and only associated rejections contribute sessions.
- A time cohort with an inapplicable shared filter (e.g. `tool` against `rejections`) returns 400 `unsupported_join` naming filter and field; an ordinary time request reports it in `ignored_filters`.
- `/activity` returns `population.by_type` with the four units; probe counts a late arrival and returns no rows; paging is deterministic across equal event times.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → passes, including the two previously time-dependent activity tests.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contradiction. Never resolve a contradiction silently.
