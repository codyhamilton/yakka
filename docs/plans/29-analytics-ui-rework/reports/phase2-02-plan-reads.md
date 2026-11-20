# Phase 2 unit 02: batched plan list/detail reads

Status: **done with concerns** (retained-scale measurement deferred to the orchestrator).

## What changed

- `packages/yakka/internal/store/plan_entities.go`
  - `PlanEntitiesPage` no longer calls `PlanArtifactKinds`/`PlanDesignScores` per
    plan. It batches the page keys through the new `PlanArtifactKindsFor` and
    `PlanDesignScoresFor` grouped reads. `artifacts_by_kind` stays distinct
    in-window `path` counts; design scores stay the latest score per check for
    the lifetime-latest design version per `(repo_id, path)`, with absent checks
    still absent.
  - New `PlanAssociatedCosts` computes `associated_cost_usd`,
    `unpriced_calls` and `calls` for every plan on the page from one grouped read
    over the deduplicated `kept` usage source joined to lifetime plan-artifact
    associations intersected with the in-window conversation set.
    `PlanAssociatedCost` now delegates to it, so the D18 path is unchanged.
  - New `PlanSessionIDsByPlan` derives the page's associated `conversation_id`
    sets in one query, starting from lifetime plan-artifact associations and
    joining window membership. `PlanSessionIDs` delegates to it, replacing the
    fact-driven scan with a correlated lifetime artifact lookup per fact
    described in D10.
  - `associated_cost_usd` and `unpriced_calls` sort expressions now read a
    `plan_costs` CTE computed once from `kept` joined to lifetime associations
    (added only for those two sorts), instead of a correlated `EXISTS` scan of
    `kept` per candidate plan before `LIMIT`. The CASE/null/zero rules match the
    old expression exactly.
  - New `PlanSortValid` exposes sort-name validation without running a query.
- `packages/yakka/internal/serve/analytics_entities.go` (plan region only)
  - The plan handler validates the sort with `store.PlanSortValid` before the
    query, then maps any `PlanEntitiesPage` error to `readFailed` (500, or 503
    through the existing deadline wrapper). It no longer maps a store error to
    `400 unsupported plan sort`.
  - The per-row loop is replaced by three page-wide calls:
    `PlanAssociatedCosts`, `PlanSessionIDsByPlan`, and one
    `SessionProvenanceFor` over the deduplicated union of associated IDs. The
    existing mode/80%-dominance lens code (including `(mixed)`, `unknown`,
    `(none)`) is unchanged.
- Plan detail (`analyticsPlanDetail`) was not changed: its count/page error
  mapping already uses `readFailed`, and `PlanDetailCount`/`PlanDetailPage`
  predicates are untouched.
- No `store/store.go` change. No migration 10: the measured index decision is
  deferred with the retained measurement; existing `facts_artifact`,
  `facts_conv` and `facts_type_ts` indexes serve these associations/windows.
- New tests: `internal/store/phase2_plan_scale_test.go`,
  `internal/serve/analytics_plan_scale_test.go`.

## Before / after

The pre-fix failing acceptance is the retained-scale plan workload (D10): plan
list/scatter/detail/Workflow shapes at 503 `query_timeout` around 1 s, with
native SQLite at 23.271 s for two `PlanSessionIDs` IDs. I did not run a
second copy of that harness: unit 01 was actively executing the shared
retained harness against the same worktree and fixed `.scratch/plan29-phase2`
ledger while this unit finished, so running mine would collide. The correctness
guard (new parity test) is expected green before and after because the old path
was correct, only amplified; it was not replayed against HEAD for that reason.
Retained before/after is therefore a gate (below), not a claimed result.

All commands below ran with `GOTOOLCHAIN=auto GOMEMLIMIT=8GiB`, `TMPDIR` and
data under `.scratch/`.

```
store D18:  go test ./internal/store -run '^TestPlanAssociatedCostUsesAssociatedSessions$' -count=1
            ok .../internal/store 0.060s
store batch: go test ./internal/store -run '^TestPlanBatchReadsMatchPerPlan$' -count=1
            ok .../internal/store 0.083s
store regress: go test ./internal/store -run 'TestPlan' -count=1
            ok .../internal/store 0.110s
serve D18:  go test ./internal/serve -run '^TestPlanDetailEventIdentity$' -count=1
            ok .../internal/serve 0.045s
serve new:  go test ./internal/serve -run '^TestAnalyticsPlanPageBatchesEnrichment$|^TestAnalyticsPlanReadErrorsAreQueryFailures$' -count=1
            ok .../internal/serve 0.172s
serve regress: go test ./internal/serve -run 'TestAnalyticsPlan' -count=1
            ok .../internal/serve 0.437s
gofmt -l (four changed files): no output
go vet ./internal/store ./internal/serve: pass
```

The D18 checks confirm the mixed-attribution fixture still returns plan cost
`$0.10` from its associated session and includes both the artifact and the
raw-repo-empty usage event.

## Parity oracle

`TestPlanBatchReadsMatchPerPlan` (store) builds a fixture with a shared session
across two plans, a partial lower-bound plan and an all-unpriced plan, then
compares `PlanArtifactKindsFor`, `PlanDesignScoresFor`, `PlanAssociatedCosts`
and `PlanSessionIDsByPlan` against the per-plan reference functions
(`PlanArtifactKinds`, `PlanDesignScores`, `PlanAssociatedCost`,
`PlanSessionIDs`). `TestAnalyticsPlanPageBatchesEnrichment` (serve) compares the
HTTP page against that same per-plan reference for artifact kinds, flattened
`artifacts:<kind>`, latest `design_score:<check>` including absence, cost /
unpriced / null-and-lower-bound flags, and harness / session-model lenses. Its
fixture covers:

- a shared session in two plans (`shared_sessions = 1` for both);
- an all-unpriced plan (null cost + `associated_cost_null_reason:
  all_unpriced` + lower-bound flag);
- a partial plan (lower-bound cost);
- a no-usage plan (`harness = unknown`, `session_model = (none)`);
- an out-of-window artifact that must not enter in-window kind counts;
- design scores for two checks and absence on a third plan.

## Cursor and error distinction

- Cursor continuation with `limit=1` reproduces the full first-page order
  exactly and ends with no `next`; adding a fact after the first page returns
  `409 cursor_stale`.
- `TestAnalyticsPlanReadErrorsAreQueryFailures` closes the tenant and asserts
  plan list and plan detail return `500 {"error":"read failed"}` — never
  `400 unsupported plan sort` and never a 200 empty body. Genuinely unsupported
  sorts are still rejected before the query.

## Deviations

- The brief says to commit; the orchestrator directive says not to commit and to
  leave changes plus this report in the working tree. Nothing was committed,
  pushed, merged, rebased or branch-switched.
- Retained-scale before/after and an EXPLAIN record were not produced: unit 01
  was running the shared harness/scratch concurrently, so the measurement is
  deferred to the orchestrator's post-Wave-1 run.
- The short brief line "Replace `PlanSessionIDs`' fact-driven scan with a
  correlated lifetime artifact lookup per fact" conflicts with D10's "start
  from small plan-artifact associations; join window membership". I implemented
  the D10 direction (artifact-driven) because the literal wording describes the
  amplified query D10 removes.
- "plan scatter" is called out as an affected shape, but this server revision
  has no plan-mode scatter branch: `grain=plan` ignores `mode` and serves the
  list shape. Its cost therefore improves with the same batched list path; no
  separate scatter serializer was invented.
- Plan detail was left as-is (not re-derived once per request) because no
  measurement showed the associated-conversation subquery re-derived per
  collection within one query; count and page remain single statements with
  identical predicates.

## Unfinished work / known problems

- Run the orchestrator's 20-run alone+four-load retained measurement for
  `plan-list-limit-{1,10,100}`, `last_ts:desc`, `associated_cost_usd:desc`,
  `executions_unreported:desc`, plan scatter, plan detail collections and
  Workflow plan rank, and append it here.
- From that measurement, decide whether any new index (migration 10) is needed;
  none was added speculatively.
- Plan detail still issues separate count and page statements, each re-deriving
  the associated-conversation set. If the retained run shows that cost, derive
  the set once per request (for example a request-scoped temp table) while
  preserving every cursor.

## Gates

- `gate: retained-scale measurement deferred to orchestrator` — shared harness
  and `.scratch/plan29-phase2` were in use by unit 01 while this unit finished.
- `gate: no migration 10 added pending retained EXPLAIN/index measurement`.
