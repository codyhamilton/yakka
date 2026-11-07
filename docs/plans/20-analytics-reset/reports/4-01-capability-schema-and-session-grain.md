# Phase 4 unit 4-01 handoff

Status: **done with concerns**. The unit is committed as `<commit>`.

## Candidate comparison

The fixture has 5,015 hook events and only three explicitly characterized session shapes (single repo, multiple repos, no repo). I chose bounded SQL grouping over existing `facts` and deduplicated usage for session measures and provenance. A persisted rollup would add write/compaction maintenance for a tiny session population, while the plan contract does not authorize a stored grain. Provenance lookup is restricted to the requested page identities. This is the simpler candidate for the measured fixture; no real-ledger performance claim was made.

## Implemented

- Added `/v1/analytics/entities` registration and session/time handlers. Session list supports SQL paging and sorts for the published session measures, including identity tie breaks. Session repo/model/harness provenance is lifetime-derived; in-window measures distinguish no calls, all-unpriced cost, and partial lower bounds.
- Added deterministic SHA-256 session sampling, whole-population marginal distributions, time aggregate rows on a shared bucket grid, shared `exclude` parsing/application, and typed population metadata.
- Added additive session token fields, registered the SQLite hash function, published Phase 1–4 schema capabilities only, and documented the served schema/entity contract.

## Checks

- Before implementation, the required `/v1/analytics/entities` route and session/time entity schema were absent from the Phase 3 server; this was the missing behavior identified from the brief.
- `gofmt` completed for touched Go files.
- `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` from `packages/yakka`: **passed** (`internal/store` 6.7s; `internal/serve` 23.9s).

## Unfinished / known problems

- The fixed Phase 4 outcome is **not complete**: session entity requests do not implement numeric `where=`/predicate filtering, and `grain=session&mode=aggregate` is not served. The schema intentionally does not advertise session aggregate mode. Add bounded numeric predicate population semantics and SQL-backed session aggregate operations with focused fixture tests before closing Phase 4.
- Coverage currently reports fact time ranges, compaction, screen gaps, scorer configuration and repo-attributed session counts, but does not yet provide all contract fields for pending work, per-kind scored/total content, or pricing/catalogue/tool-kind revisions.
- The suite passed, but it does not prove every fixed outcome item (including all scatter marginal populations or legacy-count reconciliation). Do not treat this handoff as phase verification.

Departures from the brief: the above omissions are incomplete work, not contract changes. There were no external-system dependencies or gates.
