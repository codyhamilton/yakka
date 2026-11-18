# Report: phase1-02 — Priced live model test and reservation-cost removal

Status: `done`

## What changed

- `packages/yakka/internal/store/pricing.go`: removed `ReservationCost` (the
  worst-case reservation helper). No other function, rate, tier or table byte
  changed.
- `packages/yakka/internal/store/pricing_test.go`:
  - Added `TestLiveReviewModelIsPriced`, asserting `PricedModel("claude-haiku-5-5")`
    with a comment that it mirrors `review.LiveModel` and is now the only guard,
    since `store` cannot import `review` and review checks pricing at build time.
  - Replaced `TestHaiku55ConservativeReservations` with
    `TestPricingTiersAndTableIdentity`, keeping the non-empty `PricingTableID`
    check and the `PricingTier` table (`up_to_100k`, `over_100k`, uncertain
    branch) and deleting the reservation-cost assertions.

No changes to `pricing_table.json`, pricing values, tier boundaries, or any
other store function.

## Checks

Before (pre-change, captured from the worktree):

```
$ grep -rn 'ReservationCost' --include='*.go' .
./packages/yakka/internal/store/pricing_test.go:127,131,135
./packages/yakka/internal/store/pricing.go:113,116
```

No non-test caller remained, matching the brief's expectation after unit 1.

After:

```
$ grep -rn 'ReservationCost' --include='*.go' .
(no matches, exit 1)

$ go test ./internal/store -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  4.451s

$ go test ./internal/store -run 'TestLiveReviewModelIsPriced|TestPricingTiersAndTableIdentity' -count=1 -v
--- PASS: TestLiveReviewModelIsPriced (0.00s)
--- PASS: TestPricingTiersAndTableIdentity (0.00s)
PASS

$ go vet ./internal/store
(no output)
```

Tests and vet were run under
`systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0`.

## Deviations

None. The new test passes immediately because `claude-haiku-5-5` is currently in
the table; it fails if that entry is ever dropped, which is the intended guard.

## Unfinished work / known problems

None. Contract citations in the brief are consistent with `DESIGN.md`.
