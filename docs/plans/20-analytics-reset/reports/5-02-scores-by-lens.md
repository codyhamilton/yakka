# 5-02 score and distribution lens handoff

## Delivered

- `/scores` keeps its legacy response when the new parameters are absent. Its opt-in `dim`, `check`, and `scorer` path selects eligible facts, chooses the canonical fact per hash (`ts`, `row_hash`, `repo_id`, `path` ascending), selects the latest score per hash/check, then applies scorer and derived harness/session-model filters. It returns sorted lens groups with offset paging and omitted group/hash counts; missing selected checks return zero with null quartiles.
- `/score-series` keeps the legacy unsplit path. Its opt-in lens path applies the same canonical/latest-score rules independently per bucket, groups and pages lens values, and reports omitted observations for each check/bucket. Hashes may recur across buckets.
- `/baselines?population=content` computes latest score per retained hash/check, partitioned by that row's scorer. `check` and `scorer` filter after latest-row selection. Missing selected scorer/check pairs return `n: 0` and null quartiles. Omitted new parameters still use the unchanged latest-file-weighted baseline.
- `/distribution` accepts `harness`, `session_model`, and `session_repo` beside legacy `model`. Call grain uses call harness/model; conversation grain uses lifetime session harness mode, 80-percent model dominance and repo attribution. Returned rows retain priced and unpriced values; group and omitted coverage is explicit.
- `/schema.features.scores_by_lens` now reflects the route capability. No UI, new route, dependency, join, or contract was added.
- Session provenance reads are batched at 500 IDs, below the SQLite bind limit.

## Evidence

Before edits, the signed score lens and scorer-baseline checks had no focused assertions; existing route tests covered only unsplit score and file-weighted baseline behavior. Added tests prove canonical selection across repos/paths, latest scorer selection, distinct-content baseline population versus file weighting, grouped score and score-series results, and all three distribution lenses.

`GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 8.128s; serve 27.535s).

`git diff --check` — passed.

## Deviations and carried limits

- The score lens queries use bounded request contexts and existing SQLite temp-table/query behavior. Lens result pages are bounded, while exact score observation aggregation retains the score rows in memory as the legacy score path does; no population is silently truncated.
- 5-01's artifact aggregate `bucket` remains rejected and unadvertised: the design does not choose which timestamp represents a file whose versions span buckets. The 5-01 report records this ambiguity; selecting latest-version time or another timestamp would invent contract semantics.
- No live service, deploy, credentials, or production data were needed. No external gate is required for this unit.
