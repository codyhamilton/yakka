# Brief: phase1-02 — Priced live model test and reservation-cost removal

Consumer: a build worker on `packages/yakka/internal/store`, dispatched by Plan 28 `execute`.
Owned paths: `packages/yakka/internal/store/pricing.go`, `packages/yakka/internal/store/pricing_test.go`; report `docs/plans/28-review-token-only-gating/reports/phase1-02-store-pricing.md`. Touch nothing else. Do not edit `pricing_table.json`.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: unit 1 (`phase1-01-review-core`), which removes the last non-test callers of `ReservationCost`.
Runs alongside: unit 4 (`phase1-04-serve-wiring`), which has disjoint paths.
Budget: 2 files to read, about 45 lines to change including tests, 20 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Review availability and call contract, the Model bullet (line 32), the No spend gating bullet (line 36), and Phase 1 Surfaces/Outcome (lines 219-224). Binding.
2. `packages/yakka/internal/store/pricing.go` — all of it; `ReservationCost` (113-123) and the pricing lookup it uses.
3. `packages/yakka/internal/store/pricing_test.go` — `TestHaiku55ConservativeReservations` (125-148) and the nearby table tests.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the store assert once, statically, that the live review model is priced, and delete the worst-case reservation estimate helper that existed only for the removed spend gate.

## Contract

- DESIGN line 32: "**Model** is `review.LiveModel` (`claude-haiku-5-5`), the only source. A store test, not a runtime check, asserts it is in the pricing table."
- DESIGN line 36: "**No spend gating**: the rolling-spend ledger, `YAKKA_REVIEW_USD_CAP`, worst-case reservation estimates, `reserveRetry` and the retry-over-cap refusal are removed."
- DESIGN line 38: actual cost comes "from provider usage and the embedded pricing table (`cost_usd`, tokens, tier, `pricing_table_id`)"; no worst-case estimate is recorded.

Settled decisions:

- `store` cannot import `review` (the dependency runs the other way). The test uses the literal `"claude-haiku-5-5"` with a comment naming `review.LiveModel` as the mirrored constant, so the test fails if the embedded table loses that model.
- Keep `PricedModel`, `Cost`, `CostAtInputSize`, `PricingTier`, `PricingTableID` and `rateForInputSize`; only `ReservationCost` is removed.

## Changes

- Add `TestLiveReviewModelIsPriced` to `pricing_test.go`: it fails unless `PricedModel("claude-haiku-5-5")` is true. Comment that this mirrors `review.LiveModel` and exists because review no longer checks pricing at runtime.
- Remove `ReservationCost` from `pricing.go` and `TestHaiku55ConservativeReservations` from `pricing_test.go`.
- Before deleting, run `grep -rn 'ReservationCost' --include='*.go' .`; expected after unit 1: only `pricing.go` and `pricing_test.go`. If any non-test caller remains, stop and report `blocked` naming the file — unit 1 has not landed.
- Do not change pricing values, tier boundaries, `pricing_table.json`, or any other store function.

### Keep untouched

- `pricing.go`'s embedded table bytes, `PricingTableID` stability and all cost/tier arithmetic.
- `PricingTier(model, size, uncertain)` and its `uncertain` branch, which other callers and tests still use.

## Done evidence

Identify or write the failing test first; report its output before and after.

- `grep -rn 'ReservationCost' --include='*.go' .` → no matches.
- `cd packages/yakka && go test ./internal/store -count=1` → all pass.
- `cd packages/yakka && go test ./internal/store -run 'TestLiveReviewModelIsPriced' -count=1 -v` → passes.
- `cd packages/yakka && go vet ./internal/store` → no output.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
