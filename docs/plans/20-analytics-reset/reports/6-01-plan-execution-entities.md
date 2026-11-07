# 6-01 Plan and execution entities

Status: **done with concerns**

## Delivered

- Added `plan` and `execution` list routes to `/v1/analytics/entities`, plus `plan` detail collections (`artifacts`, `executions`, `sessions`, `events`) at `/v1/analytics/entity`.
- Plan rows use `(repo_id, plan)` identity and report in-window artifact/version/session counts, shared-session overlap, execution process shapes, timestamps/span, complete share and associated session cost coverage. Associated costs reuse the existing deduplicated usage/pricing functions; shared sessions remain overlapping across plans. Null all-unpriced cost and partial lower-bound states are distinguished.
- Execution membership and complete/unreported/started shapes reuse the established in-window brief and process-completion rule. Execution cursor ties include conversation, path and repo identity; execution rows include in-window session cost coverage.
- Each plan detail collection uses keyset pagination and reports server-counted collection population totals. Detail filters remain window-scoped; session attribution checks lifetime plan artifacts.
- `/schema` now describes the plan/execution identities and measures, while capability flags for Plans 21/22/23 remain absent. Existing legacy execution route was not changed.

## Before and after evidence

Before implementation, the requested focused command passed in store but Serve had no matching tests. New plan and execution fixtures then failed as expected: both requests returned HTTP 400, `grain must be session or time`.

After implementation:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Entity|Execution|Plan|SessionTimeEntitiesAndExclusions)' -count=1` — passed.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 6.970s; serve 25.565s).
- `git diff --check` — passed.

The fixtures cover list paging and identity, execution ties/process shapes, independently selected plan sessions, overlapping shared-session cost, and missing pricing. Existing schema expectations were updated for the newly implemented grains. No live service, production data, credentials, deployment, migration, animation or timing test was used.

## Concerns and remaining contract gaps

The route surface is incomplete against all of CONTRACTS.md 17.3. The plan row does not yet return artifacts-by-kind or `design_score:<check>`; execution rows do not yet return `brief_score:<check>` or `report_score:<check>`. Plan repo/harness/session-model lenses are not fully populated. Plan list sort support is narrower than the complete listed measure table. Plan/execution cursors do not yet pin the fact receive watermark/derivation revision, so a late fact may alter a later page. The execution detail collection order and plan event cursor have less fixture coverage than the other paging paths. These gaps need closure before treating the published plan/execution capability as complete.

No external gate is required; the remaining work is local fixture-backed implementation and verification.
