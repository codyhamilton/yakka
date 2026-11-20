# Phase 2 unit 01 — retained-history workload, measurement and oracle

Status: **done with concerns**. The harness, synthetic workload, committed shape record and
pre-fix measurement record exist and run. The p95 bound is **not met** on the current tree: 19 of
24 committed shapes return 503 `query_timeout` alone and under load, and the two other served
shapes exceed 500 ms under load. A prepared real-ledger copy is unavailable, so the synthetic
workload is the recorded result.

## What changed

- `packages/yakka/internal/analyticsfixture/retained.go` (new): deterministic synthetic
  retained-history tenant (`CreateRetained`) with an exact `RetainedSummary`/`RetainedOracle` and
  `RetainedDigest()` for determinism checks.
- `packages/yakka/internal/analyticsfixture/retained_test.go` (new): ungated `TestRetainedFixture`.
- `packages/yakka/internal/serve/analytics_retained_bench_test.go` (new): ungated
  `TestAnalyticsRetainedWorkloadSmoke`, opt-in `TestAnalyticsRetainedWorkload`, prepared-ledger
  copy path, cancellation/release proof and EXPLAIN recording.
- `packages/yakka/internal/serve/testdata/retained-request-shapes.json` (new): 24 committed
  Phase 2 request shapes, all All-history with frozen `to`, never `win`.
- `packages/yakka/internal/serve/testdata/retained-workload.json` (new): pre-fix workload
  characteristics, per-shape alone/load p95 and rows, cold times, cancellation result and EXPLAIN
  lines.
- No product query/store code, deadline, auth, migration or wire shape was changed.

## Workload characteristics and oracle

Generated counts (all at or above the EVIDENCE migrated-snapshot figures):

| measure | generated | EVIDENCE floor |
|---|---|---|
| facts | 239,810 | ≥235,496 |
| hook_event facts | 236,000 | 231,915 |
| usage calls | 33,600 | 33,456 |
| artifact versions | 2,910 | 2,712 |
| commits | 900 | 869 |
| sessions | 7,440 | ≥7,417 |
| plan identities | 260 | ≥257 |
| artifact file identities | 1,400 | ≥1,339 |
| plan/session associations | 2,897 | ≥823 |
| usage harness/model groups | 32 | 32 |
| sessions on one plan | 60 | ≥57 |
| plans on one session | 50 | ≥43 |
| score rows | 21,000 | ≥20,805 |
| scored content hashes | 1,400 | - |

Priced, partially priced and all-unpriced sessions all exist (2,103 / 2,010 / 1,887 plus the
mixed priced session). Latest usage is `2026-09-30T12:00:00Z`, more than 30 days before the run, so
All history is required. Commits and two artifact versions per file populate scatter marginals.
The mixed-attribution plan is `repo-00`/`plan-000`; its associated session is `sess-00000`, whose
one priced usage call has empty raw `repo_id`; the plan's Oracle cost equals that session's cost
(computed from the embedded pricing table). Score checks include `clarity`; every latest artifact
version is scored by `jev-1.13.0`, so artifact bands are populated.

## Commands and results

Before (current product tree, before this unit's harness existed): the new retained shapes are not
yet executable. After writing the harness, the same tree shows:

```
cd packages/yakka
TMPDIR=…/.scratch/plan29-p2-tmp GOTOOLCHAIN=auto GOMEMLIMIT=8GiB \
  go test ./internal/serve -run '^TestAnalyticsRetainedWorkloadSmoke$' -count=1 -v -timeout 20m
→ PASS (20.1s), 24 shapes, 18 recorded pre-fix query failures (503).
```

```
… go test ./internal/analyticsfixture -run '^TestRetainedFixture$' -count=1 -v -timeout 20m
→ PASS (48.9s): counts, fan-out, price classes, mixed identity, determinism and ledger counts.
```

```
… YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=3 YAKKA_RETAINED_REBUILD=1 \
  go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -v -timeout 30m
→ completed (223.5s), wrote testdata/retained-workload.json; FAILs the bound as expected.
  generation 46,058.6 ms, copy 0 ms, store reopen 0.9 ms.
```

The first generator self-test failed with `retained fixture: harness/model groups >= 32` because
the harness and model index selected the same combination; the model index was decoupled before
the passing run. No product check changed state.

Prepared copy path (exercised against the synthetic ledger to prove copy isolation; not used as a
real-ledger result):

```
… YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=2 YAKKA_RETAINED_SHAPE=plan-detail-events \
  YAKKA_RETAINED_LEDGER=…/.scratch/plan29-phase2/synthetic/bench \
  YAKKA_RETAINED_OUT=…/.scratch/plan29-phase2/prepared-path-check.json \
  go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -timeout 10m
→ PASS (3.9s), copy 65.9 ms for 169 MB; source never opened or written.
```

`gofmt -l` is clean on the three new Go files; `go vet ./internal/analyticsfixture ./internal/serve`
passes.

## Per-shape p95, alone and under the four-in-flight board load

3 timed runs per shape, one discarded warm-up; load is the measured shape plus three board shapes
in flight (four total, the concurrency the existing p95 contract is measured at).

| shape | alone status | alone rows | alone p95 ms | load status | load rows | load p95 ms | classification |
|---|---|---|---|---|---|---|---|
| `plan-list-limit-1` | 503 | 0 | 1001.1 | 503 | 0 | 1000.6 | query_failure |
| `plan-list-limit-10` | 503 | 0 | 1000.7 | 503 | 0 | 1001.5 | query_failure |
| `plan-list-limit-100` | 503 | 0 | 1001.0 | 503 | 0 | 1001.0 | query_failure |
| `plan-list-sort-last-ts` | 503 | 0 | 1001.1 | 503 | 0 | 1001.4 | query_failure |
| `plan-list-sort-associated-cost` | 503 | 0 | 1001.4 | 503 | 0 | 1001.2 | query_failure |
| `plan-list-sort-executions-unreported` | 503 | 0 | 1001.3 | 503 | 0 | 1001.1 | query_failure |
| `plan-scatter-cost-artifacts` | 503 | 0 | 1001.3 | 503 | 0 | 1000.6 | query_failure |
| `plan-detail-sessions` | 503 | 0 | 1002.0 | 503 | 0 | 1002.0 | query_failure |
| `plan-detail-events` | 200 | 100 | 23.8 | 200 | 100 | 53.9 | served |
| `plan-detail-artifacts` | 200 | 6 | 23.8 | 200 | 6 | 53.5 | served |
| `plan-detail-executions` | 200 | 6 | 24.2 | 200 | 6 | 57.1 | served |
| `workflow-plan-rank` | 503 | 0 | 1001.0 | 503 | 0 | 1001.0 | query_failure |
| `workflow-activity-list` | 503 | 0 | 1001.2 | 503 | 0 | 1012.8 | query_failure |
| `workflow-river` | 503 | 0 | 1001.1 | 503 | 0 | 1012.0 | query_failure |
| `conversation-dist-cost-session-repo` | 503 | 0 | 1009.4 | 503 | 0 | 1017.5 | query_failure |
| `conversation-dist-cost-model` | 503 | 0 | 1008.9 | 503 | 0 | 1017.1 | query_failure |
| `conversation-dist-cost-harness` | 503 | 0 | 1009.2 | 503 | 0 | 1016.1 | query_failure |
| `conversation-dist-cost-session-model` | 503 | 0 | 1008.8 | 503 | 0 | 1016.5 | query_failure |
| `conversation-dist-tokens-in` | 503 | 0 | 1012.0 | 503 | 0 | 1015.1 | query_failure |
| `call-dist-cost-harness` | 200 | 4 | 414.8 | 200 | 4 | 668.0 | served, over bound under load |
| `session-scatter-cost-commits-unpriced` | 503 | 0 | 1001.7 | 503 | 0 | 1001.7 | query_failure |
| `session-scatter-cost-tokens` | 503 | 0 | 1001.9 | 503 | 0 | 1003.2 | query_failure |
| `cost-treemap-harness-model` | 200 | 32 | 375.9 | 200 | 32 | 471.2 | served |
| `artifact-band-mix` | 503 | 0 | 1003.1 | 503 | 0 | 1002.1 | query_failure |

A second smoke on the same tree served artifact-band-mix (200, 9 groups), so the tree was moving
under sibling Phase 2 edits during measurement; the committed record is the single 3-run snapshot.

## Cancellation result

`retainedCancellation` issues the supported heavy plan-associated-cost shape under a client
deadline derived from the unchanged one-second budget, then an ordinary plan-detail request and a
direct `SELECT 1`:

```
deadline=200.0 ms, context_canceled=true, elapsed=200.6 ms, status=0 (response discarded),
following request=200 (4 rows), reader_released=true
```

Status is 0 because `serveBoundedAnalytics` deliberately writes no response when the caller's
context is cancelled; the cancellation itself, the following successful request and the released
reader are the proof. This closes the REVIEW.md:33 “interrupt not verified” follow-up for a
client-cancelled retained read.

## EXPLAIN QUERY PLAN (dominant statements)

- `plan_population_and_association`: `SEARCH facts USING INDEX facts_type_ts (type=? AND ts>? AND ts<?)`; `USE TEMP B-TREE FOR GROUP BY`; three `USE TEMP B-TREE FOR count(DISTINCT)`.
- `plan_session_ids`: `SEARCH s USING INDEX facts_ts (ts>? AND ts<?)`; `SEARCH a EXISTS USING INDEX facts_artifact (type=? AND repo_id=?)`; `USE TEMP B-TREE FOR DISTINCT`.
- `session_provenance`: `SEARCH facts USING INDEX facts_conv (conversation_id=?)`; `USE TEMP B-TREE FOR GROUP BY`.
- `usage_dedupe`: `SEARCH facts USING INDEX facts_usage_ts (type=? AND norm_event=? AND ts>? AND ts<?)`; `USE TEMP B-TREE FOR ORDER BY`; co-routine scans.
- `conversation_distribution`: same usage scan/order; `USE TEMP B-TREE FOR GROUP BY`.
- `artifact_band_population`: `SEARCH facts USING INDEX facts_type_ts (type=? AND ts>? AND ts<?)`; `USE TEMP B-TREE FOR GROUP BY`; two `count(DISTINCT)`; `USE TEMP B-TREE FOR ORDER BY`.
- `artifact_latest_scores`: `SEARCH facts USING INDEX facts_usage_ts (type=?)`; `USE TEMP B-TREE FOR DISTINCT`; `SEARCH s USING INDEX scores_hash (content_hash=?)`; `USE TEMP B-TREE FOR ORDER BY`.

All 39 recorded lines are in `testdata/retained-workload.json`.

## Deviations

- **No commit** was made. The orchestrator instruction overrides the brief's commit line; all work
  is left uncommitted in the working tree.
- **No prepared real-ledger copy exists** under this worktree's `.scratch`; only the synthetic
  ledger is present. The copy path was exercised against that synthetic ledger with output under
  `.scratch`, not committed as a real-ledger result.
- **Load definition**: the brief says “four independent board request streams”; the existing
  pageset contract says “requests run at most four at a time”. This harness uses four in flight
  total (measured shape plus three board streams). Five in flight would self-inflict `busy` 503s
  against `analyticsHeavyConcurrency=4`.
- **3 pre-fix runs, not 20**: the full 20-run alone+load sweep is left to the orchestrator after
  Wave 2. A 3-run sweep with a 46 s rebuild already took 223 s; the record is explicitly marked
  `pre-fix baseline`.
- Measurements ran while phase2-02/04/05 were editing disjoint product files. The record is one
  snapshot, not a controlled before/after of those units.

## Unfinished work

- Orchestrator: run the final 20-run alone+load table after Wave 2 and refresh the results block
  in `testdata/retained-workload.json`.
- Orchestrator: run `YAKKA_RETAINED_LEDGER=<prepared-copy-dir>` if a real prepared copy appears,
  and record cold copy/open separately.
- Product owners: plan population/association, workflow activity, conversation distributions,
  session scatter and (variably) artifact bands still exceed the deadline on this workload.

## Known problems

- The synthetic ledger is ~169 MB and takes ~46 s to generate on this machine; the smoke reuses a
  completed marker-matched directory, while the profile run can force a rebuild with
  `YAKKA_RETAINED_REBUILD=1`.
- Recorded p95 values are machine- and tree-dependent, not reproducible numbers; only the structure
  and statuses are contractual.
- `retainedLedgerSummary` derives prepared-ledger counts from SQL; the mixed-attribution oracle is
  synthetic-only.

## Gates

- `gate: synthetic workload meets or exceeds every EVIDENCE floor and both fan-out maxima` — pass.
- `gate: prepared retained-ledger copy unavailable` — recorded; no real-ledger result claimed.
- `gate: p95 ≤500 ms not met on the current tree` — 19/24 shapes 503 alone and under load; the two
  served-but-slow shapes exceed 500 ms under load. Do not claim the bound.
- `gate: cancellation/release proof` — pass for client cancellation; following request 200 and
  reader released.
- `gate: no commit per orchestrator override` — all changes and this report are uncommitted in the
  working tree.
