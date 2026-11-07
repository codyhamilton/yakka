# 6-01d — Derived plan measure sorting

Status: done

## Before and after evidence

Before implementation, `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'AnalyticsPlanDerivedSortMeasures' -count=1` failed: each requested derived measure returned HTTP 400 (`artifacts:design` and `design_score:clarity` failed sort grammar; `associated_cost_usd`, `unpriced_calls`, and `complete_share` were unsupported).

After implementation:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'AnalyticsPlan' -count=1` — passed.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 7.351s; serve 26.539s).
- `git diff --check` — passed.

Plan sorting now supports every declared plan measure, with validated dynamic kind/check names, a single computed sort value for ordering and continuation, explicit nulls-last ordering, and `(repo_id, plan)` ties. Fixtures exercise both directions, equal values, a missing score, and complete cursor traversal. `/schema` now advertises the supported sort dimensions.

The brief's owned paths were amended in a separate commit to include the existing plan sort declaration in `analytics_query.go`; no contract changed. No live system or external dependency was needed.
