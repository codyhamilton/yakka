# Report: phase1-02 — Paged review store reads

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

`packages/yakka/internal/store/reviews.go`:

- Extended `ReviewRecordFilter` with `Tags []string` (conjunctive ALL; empty disables).
- Added `ReviewRecord.InsertionID int64` (selected as `rowid`, `json:"insertion_id,omitempty"`).
- Added `ReviewPageKey{TS, InsertionID}` and `BeginReviewWalk(ctx) (int64, error)`; absent table yields high-water `0`.
- Added `ReviewPage(ctx, filter, highWater, after, limit) ([]ReviewRecord, bool, error)`:
  - `rowid <= highWater`, shared existing filters, `EXISTS` per tag, strict `(ts,rowid)` keyset, `ORDER BY ts DESC, rowid DESC`, fetches `limit+1` and trims.
  - Rejects `limit < 1 || > 500` with an error (store does not clamp page size).
  - Validates every scanned `Raw` with `json.Valid`; a corrupt row returns an error.
- Extracted `reviewFilterClause` and `reviewRunsExist`; `ReviewRecords` now shares the clause builder and keeps its 500 default/clamp, ordering and return shape. No other file touched.

`reviews_test.go`: four new tests (walk/high-water/exact-once/late-insert exclusion/tenant scope; conjunctive tags + untagged handling; exact-multiple and empty completion; corrupt-raw error). Existing tests unchanged.

## Check output

Before (tests written first, implementation absent):

```
# github.com/codyhamilton/yakka/packages/yakka/internal/store [...test]
internal/store/reviews_test.go:144:15: a.BeginReviewWalk undefined ...
internal/store/reviews_test.go:153:13: undefined: ReviewPageKey
... unknown field Tags ...
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/store [build failed]
```

After:

```
$ cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/store -run 'Review'
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  0.116s

$ go test -count=1 -p=3 ./internal/store
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  4.753s

$ git diff --check
(no output)
```

Evidence per done criteria: 1,001 rows in tenant A plus 25 in tenant B, all `ts=100`; after page 1 two backdated rows (`ts=50`, `ts=1`) are appended. The walk with `limit=100` and high-water 1001 returns exactly 1,001 unique insertion ids, excludes both late rows and tenant B. `Tags:["a","b"]` returns only the row carrying both; `Tags:["a"]` excludes untagged/`b`-only rows; empty filter and `Tags:[]` return all five including untagged. 200 rows at `limit=100` end `hasMore=false`; empty population ends `hasMore=false`; first page reports `hasMore=true`. Invalid-JSON `raw` makes `ReviewPage` error.

## Deviations

None.

## Problems / unfinished

- `ReviewRecords` still ignores `InsertionID` (zero) and retains its 500 clamp by design; it is not the complete-read path.
- `ReviewPage` does not verify tags are within the 16 × 96 API bounds; that is transport validation (phase1-05), not a store primitive.
- Cursor encoding/validation, `complete`/`next_cursor` shaping and tenant/filter binding are deliberately out of scope (phase1-05).

## Contradictions

None found between the brief and the cited `DESIGN.md` contract.
