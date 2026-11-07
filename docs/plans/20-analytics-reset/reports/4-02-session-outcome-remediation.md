# Phase 4 session outcome remediation

Status: **done with concerns**.

## Resolved

- Session entity list and scatter requests accept repeatable `where=<measure>:<lo>..<hi>` predicates. Measures are allowlisted; finite bounds and ordering are checked; open bounds are supported; SQL excludes null values (including all-unpriced session cost). Results and population counts use the filtered session set. Malformed, unsupported, and over-budget predicates return 400 errors.
- `/schema` advertises session `aggregate` with `count`, `sum`, `percentiles`, and `histogram`. Aggregates execute in SQLite and return at most ten histogram bins; no session population is materialized in Go. Fields are limited to the schema's session measures, and `sum` excludes `first_ts` and `last_ts`. The schema currently advertises no aggregate dimensions; requests with `dim` return a named 400.
- `/schema.coverage` now includes `pending`, distinct scored and total artifact content hashes by `design`, `brief`, and `report`, and a `revisions` object. Pricing, catalogue, and tool-kind revision values are null with `revision_gaps` explaining the exact limitation: the embedded price table has source/fetch metadata but no revision ID; the loaded catalogue has no stable revision identifier in serving configuration; the compiled tool-kind mapping publishes no revision identifier.

## Concerns and external gates

- Session aggregate dimensions remain unsupported, so aggregate results are currently whole-population scalars. No dimension was advertised without an implemented bounded grouping path.
- Revision identifiers are unavailable locally for pricing, catalogue, and tool-kind data. No external data source was available or consulted to fill them; the schema reports null and the local data gap rather than inventing IDs.
- Before this unit's edits, the worktree already had an unstaged `SessionRanges` field and `SessionRange{Measure, Lo, Hi}` type in `packages/yakka/internal/store/analytics.go`. I retained and wired that pre-existing change because it directly represents the brief's inclusive numeric predicate; I did not find evidence of its author or origin.

## Verification

Command, from `packages/yakka`:

`GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1`

Result: **passed** (`internal/store` 6.875s; `internal/serve` 24.002s). The serving tests assert exact numeric selection and totals, count/sum/percentile/histogram values, invalid predicates and operations, coverage keys, and the Phase 1–4 schema capability set.
