# Brief: phase2-01 — Retained-history workload, measurement and oracle harness

Consumer: the execute worker for phase2-01; the Phase 2 orchestrator and verifier read its committed workload record.
Owned paths: `packages/yakka/internal/analyticsfixture/retained.go` (new), `packages/yakka/internal/analyticsfixture/retained_test.go` (new), `packages/yakka/internal/serve/analytics_retained_bench_test.go` (new), `packages/yakka/internal/serve/testdata/retained-request-shapes.json` (new), `packages/yakka/internal/serve/testdata/retained-workload.json` (new). Touch nothing else. Existing `analytics_bench_test.go`, `analytics_pageset_test.go` and `analyticsfixture/manifest.json` may be read and reused, not edited.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase2-01-retained-workload.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit. The report must contain the workload characteristics, the per-shape measurement table and the cancellation result so the orchestrator can cite them in `IMPLEMENTATION.md`.
Depends on: nothing.
Runs alongside: phase2-02, phase2-04, phase2-05.
Budget: read about 15 files, change about 1,000 lines, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:175-180` — Phase 2 outcome, surfaces, approach; `:89-100` — the retained-analytics contract, especially the acceptance-workload and p95 paragraphs; `:45-64` — Assumptions 4–6.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:17` — retained workload counts and fan-out; `:38,40-43,48` — D08, D10–D13, D18; `:76-80` — Plans, Sessions, workflow, distributions and artifact-band rows; `:93-107` — replay recipe and limits.
3. `docs/plans/29-analytics-ui-rework/REVIEW.md:33` — the unverified SQLite interrupt/deadline follow-up.
4. `docs/design/09-analytics-workspace-contracts.md:24-27` — deadline, cancellation, work bounded by aggregation; `:77-78` — scatter marginals and aggregate counts.
5. `packages/yakka/internal/serve/analytics_bench_test.go:30-140` — `TestAnalyticsBench`, env vars, copy helper and live-ledger guard; `:259-350` — presets and case construction; `:386-500` — runner, p95 and row count; `:502-680` — smoke test and fixture source.
6. `packages/yakka/internal/serve/analytics_pageset_test.go:1-27` — record and concurrency contract; `:53-65` — pinned counts; `:178-279` — fixture server and four-request run; `:281-400` — timing/classification and served/refused split; `:401-628` — EXPLAIN helpers.
7. `packages/yakka/internal/analyticsfixture/fixture.go:45-130` — how the current 5k-row fixture is built; `manifest.json` — oracle format.
8. Request-shape sources: `packages/yakka/internal/serve/testdata/browser-request-shapes.json` (read all of it; do not edit).
9. Store query paths the oracle must cover: `packages/yakka/internal/store/plan_entities.go:22-49,117-200,245-263,305-413`; `session_entities.go:23-43,200-290`; `distribution.go:66-223`; `usage.go:82-93`; `artifact_entities.go:70-137`.
10. Serve paths: `packages/yakka/internal/serve/analytics_entities.go:198-354,523-617,1064-1220`; `analytics_artifact_population.go:67-175,303-520`; `analytics.go:38-42,69-95`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make Phase 2 acceptance measurable: a reproducible retained-history-scale synthetic workload, an opt-in prepared-ledger path, and a harness that replays every EVIDENCE Phase 2 request shape and records workload characteristics, query plans, p95 alone and under a four-request board load, cold/migration latency, and cancellation behaviour.

## Contract

- `DESIGN.md:177`: "Replay every request shape in EVIDENCE against a retained-history-scale ledger, including plan lists/detail/scatter/workflow, conversation distributions, session scatter, two-dimension cost treemap and artifact bands → supported requests return complete, correctly populated results within the performance contract above, alone and under a four-request board load."
- `DESIGN.md:98`: "Ordinary supported requests in the EVIDENCE output inventory must complete without timeout on a ledger at least as large as the migrated diagnostic snapshot (235,496 retained facts, 20,805 scores, 7,417 sessions), including All history. Acceptance uses the diagnostic copy or a reproducible synthetic workload with at least its 257 plan identities, 1,339 artifact file identities, 823 plan/session associations, 32 usage harness/model groups, 57 sessions per highest-fan-out plan and 43 plans per highest-fan-out session. Preserve lifetime provenance and unscoped hook populations; record workload characteristics and query plans with results."
- Performance acceptance, verbatim: "Retain the existing p95 ≤500 ms target over at least 20 warm requests per affected request shape, measured alone and with a four-request board load; no timeout in either run. Record cold/migration latency separately. The one-second deadline is not increased as the acceptance mechanism."
- `09-analytics-workspace-contracts.md:24`: "A cancelled request stops its statement and releases the reader (proved, not assumed: the driver's interrupt behaviour was not verified at Ground)."

## Changes

- **Synthetic workload** (`analyticsfixture/retained.go`, new): add `CreateRetained(ctx, dir)` plus a `RetainedSummary`/oracle type. It must deterministically produce a tenant at least as large as the EVIDENCE snapshot and must reproduce association fan-out, not only counts: ≥235,496 facts, ≥20,805 scores, ≥7,417 sessions, ≥257 plan identities, ≥1,339 artifact file identities, ≥823 plan/session associations, 32 distinct harness/model groups, ≥57 sessions on one plan and ≥43 plans on one session. Include priced, partially priced and all-unpriced sessions; historical usage older than 30 days so All history is required; commits and artifact versions for scatter marginals; one mixed-attribution plan whose associated session has a priced usage call with empty raw `repo_id` and whose artifact supplies the lifetime association (`DESIGN.md:96`, D18). Record the exact generated counts and fan-out in the summary.
- **Request-shape record** (`testdata/retained-request-shapes.json`, new): one committed entry per Phase 2 shape from EVIDENCE, each with a stable label, path, expected outcome (`rows>0`, `rows==0` only where genuinely empty, or a named capability refusal), and an oracle key. Minimum set: plan list limits 1/10/100 and sorts `last_ts:desc`, `associated_cost_usd:desc`, `executions_unreported:desc`; plan scatter `fields=associated_cost_usd,artifacts`; plan detail `collection=sessions|events|artifacts|executions`; workflow plan rank/activity/River shapes; conversation distributions `measure=cost_usd&grain=conversation&dim=session_repo|model|harness|session_model`, `measure=tokens_in&grain=conversation`, `measure=cost_usd&grain=call&dim=harness`; session scatter `fields=cost_usd,commits,unpriced_calls` and a cost/tokens shape; two-dimension cost treemap `measure=cost_usd&bucket=none&dim=harness&dim=model&top=100`; artifact band mix `grain=artifact&mode=aggregate&stat=count&dim=band:<check>&dim=kind&check=<check>`. All Phase 2 shapes use `all=1&to=<frozen>` unless a lesson in EVIDENCE requires a finite window; never send `win`.
- **Harness** (`analytics_retained_bench_test.go`, new): reuse the package-`serve` helpers (`benchHarness`, `do`, `nearestRank`, `benchRowCount`) and the `analyticsfixture` package. Two paths:
  - Ungated synthetic scale: `TestAnalyticsRetainedWorkloadSmoke` builds the synthetic workload under the worktree's ignored `.scratch/plan29-phase2/` (never `/tmp`, never `t.TempDir()` for the large copy), replays every recorded shape once, and checks each response against the oracle. It records 500/503 as a query failure and does not fail the smoke for it on the pre-fix baseline. It fails on a 400 for a shape the record marks supported, on a 200 whose rows disagree with the oracle (including a non-empty shape returning zero rows), and on any query failure mislabeled as an unsupported sort or as empty data.
  - Opt-in full measurement: `TestAnalyticsRetainedWorkload` runs only when `YAKKA_RETAINED_PROFILE=1`; `YAKKA_RETAINED_SHAPE` is a case-name substring, `YAKKA_RETAINED_RUNS` defaults to 20. It records for each shape status, rows, nearest-rank p95 and max alone, then the same while four independent board request streams run concurrently (the p95 contract's load). A supported shape over 500 ms or non-200 is a failure.
  - Prepared-ledger path: `YAKKA_RETAINED_LEDGER` names a directory containing `ledger.db`; the harness copies only `ledger.db`/`-wal`/`-shm` into `.scratch/plan29-phase2/ledger-copy/` and measures that copy. Never open the source directly and never write it. When unset, use the synthetic workload. Do not touch the Plan 28 trial ledger or files.
  - Cold/migration: time the copy and `store.Open` migration separately from warm requests and record both; do not count them in p95.
  - Query plans: record `EXPLAIN QUERY PLAN` for the dominant reference statements the oracle uses (plan population and association, session provenance, conversation distribution, usage dedupe, artifact band). Mirror the store SQL at the revision you finish on; label each statement. Do not invent plans for SQL you did not run.
  - Cancellation: against the retained workload, issue an expensive supported request under a short test deadline derived from the server's one-second budget, assert it ends as `query_timeout`/context cancellation within a bounded time, then issue an ordinary request and assert it succeeds. Repeat enough times to show the reader and heavy-read slot are released. Record the observed statuses and timings; this closes the REVIEW.md:33 follow-up. Do not change `analyticsDeadline`.
- **Committed record** (`testdata/retained-workload.json`): the harness writes a compact record (workload characteristics, shape classifications, alone/load p95 and rows, cold/migration ms, cancellation result, EXPLAIN lines). Keep it small, deterministic and free of raw row/personal values. Commit the pre-fix baseline in this unit; the orchestrator refreshes the results block after phase2-02..05 and cites the final record in `IMPLEMENTATION.md`.
- **Kickoff split**: this unit's full real-ledger run is expected to exceed ten minutes. At kickoff the orchestrator may split it: one worker prepares the generator, shape record and harness and hands off a short summary; a fresh worker runs the full prepared-ledger measurement and verifies the record. The committed brief and paths do not change.

## Keep untouched

- Product query/store code and migrations. This unit is test-and-fixture only; it must fail on the current defects, not fix them.
- The pinned `analytics_pageset_test.go` record/counts and `analyticsfixture/manifest.json`.
- The one-second `analyticsDeadline`, auth, tenant isolation, source data, public grains and wire shapes.
- Production parity, deployment and the Plan 28 trial.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after. This harness's data lives under the worktree's ignored `.scratch/`, never `/tmp`; ordinary unit fixtures may use `t.TempDir()`. Go tests use `GOTOOLCHAIN=auto` and an 8 GiB memory cap (`GOMEMLIMIT=8GiB`).

- `cd /home/codyh/workspace/yakka-build/29/packages/yakka && GOTOOLCHAIN=auto GOMEMLIMIT=8GiB go test ./internal/analyticsfixture -run '^TestRetainedFixture' -count=1` → pass; the generated summary meets or exceeds every EVIDENCE count and both fan-out maxima, and the fixture is deterministic.
- `… go test ./internal/serve -run '^TestAnalyticsRetainedWorkloadSmoke$' -count=1` → pass on the harness contract. It records the *pre-fix* classifications: shapes that currently timeout are labelled query failures/timeouts, not empty data, and a mislabel (400 for a supported shape, or a 200 that disagrees with the oracle) fails the smoke. This smoke is the ungated synthetic-scale path; it must not require the 1.1 GB ledger.
- `… YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20 go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -timeout 30m` → produces the alone and four-request-load table. On the current tree, record which Phase 2 shapes exceed 500 ms or return 503; do not claim the bound is met.
- `… YAKKA_RETAINED_LEDGER=<prepared-copy-dir> YAKKA_RETAINED_PROFILE=1 … go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' …` → the same table against a copied real ledger, with cold/migration latency reported separately. If no prepared copy exists, record the synthetic result and `gate: prepared retained-ledger copy unavailable`.
- Cancellation check names a failing pre-fix behaviour if the driver does not interrupt or release; after the harness exists it must show the timed-out request ending and a following request succeeding.
- `testdata/retained-workload.json` and the report contain workload characteristics, per-shape p95 alone/load, statuses, rows, cold/migration ms, cancellation result and EXPLAIN lines.
- `gofmt -l` clean on new files; `go vet ./internal/analyticsfixture ./internal/serve` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
