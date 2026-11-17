# Report: phase1-03 — Ingest status vocabulary and nullable cost

Status: done

## What changed

`packages/yakka/internal/ingest/ingest.go`
- Added `skipped_busy` to the accepted `review_run` status list; `skipped_budget` and
  `skipped_duplicate` remain accepted.
- Added `validateCost`, applied to both `review_run` and `review_usage`:
  `cost_known`, when present, must be a boolean; `cost_usd` may be a JSON number or null; a
  null requires `cost_known: false`; any other `cost_usd` value is invalid. Absent
  `cost_usd`/`cost_known` stays valid, so numeric historical rows without the flag ingest.
- `reservation_outcome`/`reservation_usd` remain accepted and unvalidated.
- No `ingestBatch` change was needed: canonicalisation operates on the raw bytes, so a null
  `cost_usd` survives unchanged.

`packages/yakka/internal/ingest/ingest_test.go`
- `TestReviewRunStatusVocabulary`: `skipped_busy`, `skipped_budget`, `skipped_duplicate` accepted.
- `TestReviewRunNullableCost`: null cost + `cost_known:false` accepted; numeric cost without
  flag accepted; null without flag, non-boolean flag and non-number cost rejected.
- `TestReviewUsageNullableCost`: null cost + `cost_known:false` accepted; null without flag
  rejected.
- Existing `usageFact`/`TestReviewUsageAcceptanceValidationAndIsolation` still cover an older
  usage row carrying `reservation_outcome`/`reservation_usd` and a numeric `cost_usd` with no
  `cost_known`; kept as is.

## Check output

Before (new tests added, implementation absent):
```
--- FAIL: TestReviewRunStatusVocabulary (0.01s)
    ingest_test.go:201: status skipped_busy = [{ID:s-skipped_busy Status:rejected Reason:invalid: review_run has unknown status}], <nil>
--- FAIL: TestReviewRunNullableCost (0.01s)
    ingest_test.go:231: non-number cost = [{ID:bad-non-number cost Status:accepted Reason:}], <nil>
--- FAIL: TestReviewUsageNullableCost (0.01s)
    ingest_test.go:247: null without flag = [{ID:q#1 Status:duplicate Reason:}], <nil>
FAIL
```
(The usage case read as `duplicate` because the unflagged null was accepted and matched an
existing usage row; the test now uses a distinct `usage_id` so the rejection is observable.)

After:
```
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/ingest	0.153s
```
`go test ./internal/ingest -run 'TestReview|TestUsage' -count=1 -v` → all five review
acceptance/usage tests PASS. `go vet ./internal/ingest` → no output.

## Deviations

None from the brief. `gofmt -l internal/ingest/` reported no files.

## Unfinished / known problems

None found in this unit. No contradiction between the brief and the cited DESIGN sections.
