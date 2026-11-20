# Brief: phase1-05 — Empty-ledger schema and coverage facts

Consumer: the execute worker for phase1-05; phase1-02's Coverage panel and the Phase 1 fresh-tenant check consume the corrected coverage payload.
Owned paths: `packages/yakka/internal/store/session_entities.go`, `packages/yakka/internal/store/coverage_empty_test.go` (new), `packages/yakka/internal/serve/analytics_empty_schema_test.go` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-05-coverage.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing for the Go code; phase1-01 for the browser observable.
Runs alongside: phase1-01, phase1-02.
Budget: read about 5 files, change about 100 lines, 20 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:93-94` — empty-ledger `/schema` and coverage contract.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:32,44` — D02 (empty `schema` 500) and D14 (coverage units/recency); `:17-21` — retained/usage recency figures.
3. `docs/design/09-analytics-workspace-contracts.md:11` — "Empty ledgers return valid schema/zero coverage"; `:37` — coverage members.
4. `packages/yakka/internal/store/session_entities.go:438-495` — `AnalyticsCoverage`, the three nullable aggregates at `:489-493`, and the safe `sql.Null*` scans at `:446-462`.
5. `packages/yakka/internal/serve/analytics_query.go:25-40, 70-79` — `/schema` calls `AnalyticsCoverage` and nests it under `coverage`; a scan error becomes 500 `read failed`.
6. `packages/yakka/internal/serve/analytics_query_test.go:17-26` — `queryTenant` fresh-tenant helper; `analytics_test.go:573-589` — empty-tenant routes that do not include `/schema`; `analytics_cohort_proof_test.go:42-45` — the documented workaround.
7. `packages/yakka/internal/store/store.go:489-491, 563, 703` — `received_at` is written as `time.Now().UnixNano()`; `:994, 1044` — the matching `time.Unix(0, received)` reads.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make a fresh empty tenant answer `/schema` with 200 and a valid zero/empty coverage object, and make coverage expose per-fact-type event seconds and receive nanoseconds plus a separate latest-usage observation.

## Contract

- `DESIGN.md:93`: "An empty ledger answers `/schema` with 200, zero counts and absent/null time bounds."
- `DESIGN.md:94`: "Coverage distinguishes event seconds from receive-time nanoseconds and reports per-fact-type bounds. The shell shows the latest retained observation and its age, available historical range, scored coverage and missing repo attribution without implying completeness."
- `09-analytics-workspace-contracts.md:11`: "Empty ledgers return valid schema/zero coverage. Coverage distinguishes event seconds and receive nanoseconds and exposes recency and attribution gaps."

## Changes

- In `AnalyticsCoverage`:
  - Replace the `COUNT(*), SUM(CASE…), SUM(CASE…)` scan into plain `int` (`session_entities.go:489-493`) with `COALESCE(...,0)` or `sql.NullInt64`; an empty result must return zero sessions, zero with/without a derived repo, and no error.
  - Return `facts` as an empty object (not nil) when there are no facts; keep per-type `first_ts`/`last_ts` from `facts.ts` (Unix seconds) and `last_received_at` from `facts.received_at` (Unix nanoseconds).
  - Add one top-level `usage` recency entry (same three fields) derived from `hook_event` rows whose normalized event is usage, so the shell can show latest usage separately from the latest hook. Absent usage is null/absent, not zero-time.
  - Add an explicit unit statement such as `units: {ts:"unix_seconds", received_at:"unix_nanoseconds"}` so the client does not guess. Do not add a revision identifier that does not exist.
- Keep the existing `facts`, `sessions`, `scored_content_by_kind` keys and `/schema`'s additive `compaction`/`screen_gaps`/`scorer_configured`/`pending`/`revisions` mutation unchanged.

## Keep untouched

- `/schema` route construction beyond the coverage payload; catalogue, resolutions, scatter fields, plan and conversation code (phase1-06/07).
- Any migration, rewrite, or backfill of an existing ledger.
- The Plan 28 trial, `/tmp`, deployed servers and tables outside the test fixtures.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: Go tests use generated fixtures and must not use `/tmp` for new harness data (use the worktree's ignored `.scratch/`). Browser observables wait on real end states, with no fixed sleeps or animation/timing assertions.

- `cd /home/codyh/workspace/yakka-build/29/packages/yakka && GOTOOLCHAIN=auto go test ./internal/store -run '^TestAnalyticsCoverageEmpty$' -count=1` → pass. New test: a fresh store's `AnalyticsCoverage` returns no error, zero session counts, an empty `facts` object and null/absent usage bounds. Before the fix it fails on the `SUM` scan.
- `… GOTOOLCHAIN=auto go test ./internal/serve -run '^TestAnalyticsSchemaEmptyTenant$' -count=1` → pass. New test: a fresh tenant's `GET /v1/analytics/schema` is 200, `coverage.facts` is empty, session counts are zero, and no `read failed`. Before the fix it is 500 `read failed`.
- Regression: `… GOTOOLCHAIN=auto go test ./internal/store -run 'TestAnalytics|TestCoverage' -count=1` → pass.
- Browser observable via `phase1-01`: tenant `plan29-b` (empty) opens `/start`, the shell reports a valid schema and the Coverage panel shows explicit zero/empty state, not an error; tenant `plan29-a` shows both last-event and latest-usage times with plausible dates.
- Production parity (verification-time read-only): fetch `/v1/analytics/schema` for trial tenant `test` with `/home/codyh/.config/yakka/trial.env` + `client.toml` and confirm the added coverage fields do not break the deployed shape. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
