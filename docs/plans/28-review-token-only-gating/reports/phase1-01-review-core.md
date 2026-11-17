# Report: phase1-01 — Token-only availability, claims and orchestration

Status: done

## What changed

- `availability.go`: `Availability` is now `{Token, Local}`; `CheckAvailability(c, effort)` refuses only local mode, empty token and a bad effort (in that order). `Reservations` lost `cap`, `spent`, `failed` and all spend accounting. Constructors are `NewReservations(perTenant)` and `NewPersistentReservations(perTenant, path)`; `NewUnavailableReservations` is gone. Missing/unreadable/corrupt files yield empty claims and a usable object. Loading accepts v1 `claimed` and v2 `claims` (both into `claimRecord`) and ignores `spent`; saving writes v2 `claims` only. `begin`/`beginEphemeral` drop the amount, enforce duplicate → `ErrDuplicateClaim`, limit → new `ErrBusy`, save failure → `ErrClaimState` (message `review claim state unavailable`). `reserveRetry`, `settle` and `ErrBudget` are deleted. `TenantResidue` is claims-only; `PurgeTenant` removes claims plus active entries, has no anonymous-spend branch, and is idempotent.
- `provider.go`: `ProviderError` gained `InputTokens`, `OutputTokens`, `UsageReported`. A parsed 200 envelope that fails content/validation returns `ProviderInvalid` with usage; timeout, transport, non-2xx and unparseable envelopes stay usage-free.
- `orchestrator.go`: `resolveCallControls(req)` always configures `high`. `Run` no longer calls `ReservationCost` or refuses on model/spend; `ErrBusy` → `skipped_busy`/`tenant in-flight limit`, `ErrClaimState` → `unavailable`/`review claim state unavailable`. Dry-run checks availability right after `resolveCallControls` and before criteria/Build; the later dry-run receipt carries no estimate. `Receipt.EstimatedUSD` is deleted. `Attempt` gained `cost_known`; success and usage-carrying failures are priced from actual tokens, usage-free failures are unknown. Records and usage facts sum known costs, emit `cost_usd:null`/`cost_known:false` when nothing is known, sum attempt tokens, and drop `reservation_outcome`/`reservation_usd`. Model references use `LiveModel`.
- Tests: availability table; v1/v2 claim loading and spend dropping; corrupt/unreadable start; busy limit and duplicates; claims-only purge/idempotency; many paid calls never refused; `xhigh`/`max`; third concurrent call `skipped_busy`; usage-carrying invalid output cost; api_error/timeout null cost; retry-then-success total; unconfigured dry-run before capture refusal; no `estimated_usd`. Removed cap/allowlist/model/`YAKKA_REVIEW_REPOS`/reservation-total/reserved-timeout tests.

## Checks

Before (HEAD `ee3e2ec` snapshot, pre-change code): `go test ./internal/review -count=1` → `ok ... 2.908s` (the old suite encoded the spend gate). No literal first-failure run was captured: the new tests use the new API, so they could not compile against the old source. This is a process deviation from "write the failing tests first", not a gap in the after evidence.

After, scoped to the package as the brief requires:

```
$ go build ./internal/review            # succeeds
$ go test ./internal/review -count=1
ok  	.../internal/review	2.919s
$ go test ./internal/review -run 'TestAvailability|TestReservation|TestRun|TestDryRun|TestStoreFalse' -count=1 -v
--- PASS: TestAvailabilityTokenOnly
--- PASS: TestReservationLoadsLegacyAndVersionTwoClaims
--- PASS: TestReservationUnreadableOrCorruptFileStartsEmpty
--- PASS: TestReservationBusyLimitAndDuplicate
--- PASS: TestReservationPurgeIsClaimsOnlyAndIdempotent
--- PASS: TestReservationPurgeLeavesLegacyClaims
--- PASS: TestReservationWaitTenantQuiescence
--- PASS: TestReservationClaimsAreAtomic
--- PASS: TestRunNeverRefusesOnSpend
--- PASS: TestRunThirdConcurrentCallIsBusy
--- PASS: TestRunRecordsOnlyActualCost
--- PASS: TestDryRunValidatesReadinessWithoutEffects
--- PASS: TestStoreFalse*
ok  	.../internal/review	0.678s
$ git diff --stat -- packages/yakka/internal/review
 5 files changed, 527 insertions(+), 564 deletions(-)
```

Diff touches exactly the five owned files; `provider_test.go` needed no change.

## Deviations

- `provider.go` is owned here as the brief instructs, though DESIGN's Phase 1 Surfaces line omits it.
- Brief says "keep `CostUSD float64 json:"cost_usd,omitempty"`", but the source tag had no `omitempty`. I added `omitempty` so a usage-free failed attempt carries no cost; this follows the brief's stated intent and its "no cost" wording.
- Before-run caveat above.

## Unfinished / known problems

- Repo-wide `go build ./...` does not compile until unit 4 (`phase1-04-serve-wiring`) updates `serve.go`, which still calls `NewPersistentReservations(cfg.ReviewUSDCap, 2, ...)`, `NewUnavailableReservations` and `Availability{Model: ..., Effort: ..., USDCap: ..., Repositories: ...}`. Expected by the brief's unit ordering.
- No brief/DESIGN contradiction found. No out-of-scope bug found.
