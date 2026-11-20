# Brief: phase2-02 — Batched plan list, detail, scatter and workflow reads

Consumer: the execute worker for phase2-02; the Phase 2 verifier reads the retained-scale plan evidence.
Owned paths: `packages/yakka/internal/store/plan_entities.go`, `packages/yakka/internal/serve/analytics_entities.go` (plan region only: `analyticsPlanEntities` around 198-354, `planMeasure` 393-420 and `analyticsPlanDetail` 523-617), `packages/yakka/internal/store/store.go` (only if a measured plan requires a new index), `packages/yakka/internal/store/phase2_plan_scale_test.go` (new), `packages/yakka/internal/serve/analytics_plan_scale_test.go` (new). Do not edit the session-scatter region (around 1064-1220) or any other part of `analytics_entities.go`; phase2-03 owns that surface. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase2-02-plan-reads.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-01 for the retained-scale performance table; the correctness tests do not need it. Runs alongside: phase2-01, phase2-04, phase2-05.
Budget: read about 9 files, change about 300 lines, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:177` — Phase 2 outcome; `:96-98` — plan identity, batching and the performance contract; `:89-100` — the retained-analytics domain.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:40` — D10 amplification and the required fix; `:48` — D18 identity/filter conflation; `:75,78-79` — Workflow/Plans/plan-detail observations.
3. `docs/design/09-analytics-workspace-contracts.md:63-64` — session cost and `plan → sessions`; `:85` — typed populations; `:24-25` — deadline/cancellation and work bounded by aggregation.
4. `packages/yakka/internal/store/plan_entities.go:22-49` — `PlanAssociatedCost`; `:57-90` — sort expressions; `:117-200` — `PlanEntitiesPage` and its per-plan enrichment; `:202-263` — `PlanArtifactKinds`, `PlanDesignScores`, `PlanSessionIDs`; `:292-413` — count and detail collections.
5. `packages/yakka/internal/serve/analytics_entities.go:198-354` — plan handler, especially the per-plan loop at 280-328 and the error mapping at 261-264; `:393-420` — `planMeasure`; `:523-617` — plan detail.
6. `packages/yakka/internal/store/usage.go:82-93` — deduplicated `kept` source; `packages/yakka/internal/store/session_entities.go:200-290` — `SessionProvenanceFor`.
7. Existing tests: `packages/yakka/internal/store/plan_entities_association_test.go:13-48`; `packages/yakka/internal/serve/analytics_plan_execution_test.go:13-51,116-220`; `packages/yakka/internal/serve/analytics_plan_conversation_parity_test.go:12-44`.
8. `packages/yakka/internal/serve/analytics_retained_bench_test.go` and `packages/yakka/internal/serve/testdata/retained-request-shapes.json` from phase2-01 — the retained-scale runner and plan shapes.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make plan lists, plan detail, plan scatter and the plan-derived Workflow reads complete at retained-history scale within the performance contract, while preserving plan grain, lifetime association, in-window measures, cursor snapshots and overlapping associated cost.

## Contract

- `DESIGN.md:96`: "Plan identity selects lifetime associated sessions; it is not an additional raw repo/plan filter on their usage or events. Associated cost includes those sessions' in-window usage with empty raw repo, and plan events include their hooks. Explicit genuine event filters still apply; keep page/count predicates identical and costs overlapping across plans."
- `DESIGN.md:97`: "Preserve counts, lifetime-derived provenance, in-window measures, scorer identity, cursor snapshots, sample/marginal semantics and overlapping associated plan cost while eliminating repeated scans. Derive candidate sessions/plans once and batch their associations/provenance; load only the provenance a distribution needs."
- Performance acceptance, verbatim: "Retain the existing p95 ≤500 ms target over at least 20 warm requests per affected request shape, measured alone and with a four-request board load; no timeout in either run. Record cold/migration latency separately. The one-second deadline is not increased as the acceptance mechanism."
- `EVIDENCE.md:40`: "Correctly distinguish query failures from unsupported-sort400."

## Changes

- **Page-wide enrichment** (`plan_entities.go`): replace the per-plan `PlanArtifactKinds` + `PlanDesignScores` loop in `PlanEntitiesPage` with one grouped read keyed by the page's `(repo_id, plan)` set. Preserve `artifacts_by_kind` (distinct `path` in window) and each check's latest design score for the lifetime-latest design version per path (latest score by `(content_hash, check)`), including no-score absence.
- **Association batch**: derive the page's associated `conversation_id` set per plan in one query, starting from the plan artifact associations and joining window membership. Replace `PlanSessionIDs`' fact-driven scan with a correlated lifetime artifact lookup per fact. Call `SessionProvenanceFor` once for all associated IDs and compute each plan's `harness`/`session_model` lenses from the returned lifetime provenance with the existing mode and 80%-dominance rules, including `(mixed)`, `unknown`, `(none)`.
- **Cost batch**: compute `associated_cost_usd`/`unpriced_calls` for every plan on the page from one grouped read over the deduplicated usage source joined to the page's plan associations. Keep null/all-unpriced/partial lower-bound semantics and keep the sort value consistent with the returned measure. Keep the `associated_cost_usd` and `unpriced_calls` sort expressions correct for every candidate plan before `LIMIT`; if a correlated expression remains for ordering, prove with `EXPLAIN QUERY PLAN` and the retained workload that it is within the bound.
- **Error mapping** (`analytics_entities.go` around 261-264): unsupported sort is validated before the query. A `PlanEntitiesPage` error is a read/query failure (500, or 503 through the existing deadline wrapper), never `400 unsupported plan sort` and never an empty page. Apply the same rule in plan detail.
- **Plan detail**: keep `PlanDetailCount`/`PlanDetailPage` count and page predicates identical. If measurement shows the associated-conversation subquery is re-derived per collection, derive it once per request and reuse it; preserve keyset order and every collection's cursor/unavailable outcome.
- **Indexes**: `store/store.go` is owned only for a new migration (10) if the measured plans require one. Append; never edit migrations 1–9. If no measured plan needs an index, do not touch `store.go`.

### Keep untouched

- The plan population (in-window artifact facts), sort grammar, null ordering, keyset cursor and `PlanExecutionSnapshot` revision check.
- Lifetime association, in-window measures, original raw repo values, overlapping plan cost and `shared_sessions`.
- Session scatter, conversation distributions, artifact aggregates and the artifact band path.
- Public field names/wire shapes, auth, one-second deadline.
- Production parity, deployment and the Plan 28 trial.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after. Retained-scale harness data lives under the worktree's ignored `.scratch/`, never `/tmp`; ordinary unit fixtures may use `t.TempDir()`. Use `GOTOOLCHAIN=auto` and `GOMEMLIMIT=8GiB`.

- Keep the D18 acceptance green: `cd /home/codyh/workspace/yakka-build/29/packages/yakka && GOTOOLCHAIN=auto GOMEMLIMIT=8GiB go test ./internal/store -run '^TestPlanAssociatedCostUsesAssociatedSessions$' -count=1` and `… go test ./internal/serve -run '^TestPlanDetailEventIdentity$' -count=1` → pass; associated cost is `$0.10` and both the artifact and the raw-repo-empty usage event are present.
- New `TestAnalyticsPlanPageBatchesEnrichment` (or equivalent) asserts the page-wide path equals a per-plan reference oracle for artifact kinds, latest design scores, associated cost/unpriced and harness/model lenses, including an all-unpriced plan (null + lower bound) and a shared session across two plans. Pre-fix this is a correctness/parity check; the failing acceptance is the retained-scale case below.
- Retained scale (phase2-01): `YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20 go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -timeout 30m` filtered to plan shapes. Report before/after for: plan list limit 1/10/100, `last_ts:desc`, `associated_cost_usd:desc`, `executions_unreported:desc`; plan scatter; plan detail collections; Workflow plan rank. Expectation: p95 ≤500 ms alone and under the four-request load, zero 503, non-empty and oracle-equal. Before the fix these shapes time out or exceed the bound.
- Cursor continuation: the second page's rows and `next` match the oracle sequence; a changed snapshot still returns `cursor_stale`.
- Error distinction: force a store query failure (for example a closed tenant or a cancelled context) on plan list/detail and assert 500/503 with a query error, not `400 unsupported plan sort` and not a 200 empty body.
- Regressions: `… go test ./internal/store -run 'TestPlan' -count=1` and `… go test ./internal/serve -run 'TestAnalyticsPlan' -count=1` → pass.
- `gofmt -l` clean on changed files; `go vet ./internal/store ./internal/serve` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
