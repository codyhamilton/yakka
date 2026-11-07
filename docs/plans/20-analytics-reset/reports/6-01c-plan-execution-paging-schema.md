Status: done with concerns

## Before and after evidence

Before implementation, the new snapshot regression failed as expected: adding a fact between plan pages returned HTTP 200 and a continuation instead of rejecting the traversal.

After implementation:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Plan|Execution|Entity|Schema)' -count=1` — passed.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 6.946s; serve 25.303s).
- `git diff --check` — passed.

Plan and execution list cursors, plus all plan detail collection cursors, now carry the first-page receive watermark, a fact rowid tie guard, and a derived-score revision. Continuations return HTTP 409 `cursor_stale` with a restart hint if these change. Detail cursors now retain their resolved window; execution detail continuation uses the full `(min_ts, conversation_id, path)` order; event ties continue on `(ts, type, rowid)`. Schema declarations now name plan/execution measures, lenses, sort fields, and deterministic orders. Fixtures cover sorting, stale fact and score revisions, execution detail ordering, and tied event paging. Plan 21/22/23 feature flags remain absent.

## Concern

Plan list keyset sorting supports the base timestamp/count measures exposed in its `sort` declaration. It still does not sort by dynamic `artifacts:<kind>` or `design_score:<check>`, nor by `associated_cost_usd`, `unpriced_calls`, or `complete_share`, although these are plan measures in CONTRACTS.md 17.3. Closing that gap needs corresponding keyset SQL for the derived metrics; this unit has not widened scope or changed the contract.

No live service, production data, credentials, deployment, migration, or external gate was used.
