# Brief: phase1-01 — Token-only availability, claims and orchestration

Consumer: a build worker on `packages/yakka/internal/review`, dispatched by Plan 28 `execute`.
Owned paths: `packages/yakka/internal/review/availability.go`, `packages/yakka/internal/review/orchestrator.go`, `packages/yakka/internal/review/provider.go`, `packages/yakka/internal/review/availability_test.go`, `packages/yakka/internal/review/orchestrator_test.go`; report `docs/plans/28-review-token-only-gating/reports/phase1-01-review-core.md`. Touch nothing else.

`provider.go` is required by the Phase 1 outcome ("a failed attempt with usage carries its real cost") but is absent from DESIGN's Phase 1 Surfaces line; treat it as owned here and say so in the report. Do not edit `provider_test.go` unless a changed exported shape forces a compile fix.

Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: unit 3 (`phase1-03-ingest-vocabulary`) and unit 5 (`phase1-05-stable-docs`). Unit 4 (`phase1-04-serve-wiring`) consumes this unit's API afterwards.
Budget: 5 files to read, about 450 lines to change including tests, 70 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Review availability and call contract (lines 27-40), Phase 1 (lines 219-224), Assumptions 2, 3, 4, 15 and 16. Binding.
2. `packages/yakka/internal/review/availability.go` — all of it. This unit rewrites its reservations and availability halves.
3. `packages/yakka/internal/review/orchestrator.go` — `Run` (lines 196-470), `resolveCallControls` (610-673), and `persistRecord`/`persistReviewUsage` (858-1009). The rest is context for `Request`, `Attempt`, `Receipt`, `RunConfig`.
4. `packages/yakka/internal/review/provider.go` — `ProviderError` and `Review` (31-188), specifically where usage is parsed and where validation fails.
5. `packages/yakka/internal/store/pricing.go` — only `CostAtInputSize`, `PricingTier`, `PricingTableID` (93-167). Read only; do not edit `store`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make review availability dependent only on authenticated remote mode and a non-empty `CLAUDE_API_TOKEN`, delete the Yakka spend gate from the reservation/orchestration path, keep durable duplicate claims, the two-call per-tenant in-flight limit and tenant attribution, and record only actual provider cost (null plus `cost_known:false` when the provider reported no usage).

## Contract

Cited from DESIGN.md; these decisions are settled:

- "**Availability** is exactly: authenticated remote mode (not `Config.Local()`) and a non-empty `CLAUDE_API_TOKEN`. `CheckAvailability` returns `authenticated remote mode required`, then `CLAUDE_API_TOKEN`, then the effort error for a bad per-call effort; it has no configuration-dependent refusal, and the runtime priced-model and reservation-state refusals are deleted (a store test asserts the constant is priced)."
- "The only other refusals are per-request or operational, not configuration: capture, disclosure and criteria refusals, the tenant in-flight limit, and `review claim state unavailable` when a durable claim cannot be written to disk. An unreadable `review-reservations.json` starts with empty claims instead of disabling review."
- "In dry-run the availability check runs before capture and criteria resolution, so an unconfigured server answers `unavailable` whatever the capture; dry-run receipts carry no `estimated_usd`."
- "**Model** is `review.LiveModel` (`claude-haiku-5-5`), the only source. A store test, not a runtime check, asserts it is in the pricing table."
- "**Effort** is the optional per-call `effort` (`high`, `xhigh`, `max`), default `high`, through the same REST and MCP paths as today; invalid values are refused before any effect. The `ReviewEffort` config disappears; the record and usage field `configured_effort` stays for compatibility and always carries the default constant `high`."
- "**No spend gating**: the rolling-spend ledger, `YAKKA_REVIEW_USD_CAP`, worst-case reservation estimates, `reserveRetry` and the retry-over-cap refusal are removed. The `skipped_budget` status is never emitted again but remains valid when reading or ingesting historical rows."
- "**Kept, because it is not spend**: durable duplicate claims and cached-duplicate returns; the per-tenant in-flight limit (two), now reported as `skipped_busy` with reason `tenant in-flight limit`; tenant-attributed claims and in-flight tracking used by synthetic-tenant reset/delete. Tenant residue becomes claims-only and the spend-anonymising branch of `PurgeTenant` is deleted."
- "**Actual cost** per attempt and per review is recorded as today from provider usage and the embedded pricing table (`cost_usd`, tokens, tier, `pricing_table_id`), including failed attempts that report usage. A failed attempt with no reported usage records `cost_usd: null` with `cost_known: false` (ingest accepts null only with that flag; sums ignore it; the trial report counts it as an unknown entry), never a worst-case estimate; `reservation_outcome` and `reservation_usd` are no longer written and remain accepted when ingesting older rows."
- "**Persistence compatibility**: the existing `review-reservations.json` (version 1 and 2, with `spent`) decodes without error; spend entries are ignored and dropped on the next save; claims are preserved."
- "Review records and usage facts still carry actual `cost_usd` and tokens, a failed attempt with usage carries its real cost and one without carries null, and a 24-hour run of calls totalling any amount is never refused; a third concurrent call for a tenant returns `skipped_busy`."

## Changes

### `availability.go`

- `Availability` becomes `{Token string; Local bool}`. Keep `AvailabilityError` and `LiveModel`.
- `CheckAvailability(c Availability, effectiveEffort string) error`: in order — `c.Local` → `authenticated remote mode required`; `c.Token == ""` → `CLAUDE_API_TOKEN`; effort not `high`/`xhigh`/`max` → `effort must be high, xhigh or max`. No model, cap, priced-model or repository check.
- `Reservations` keeps `claimed`, `active`, `inflight`, `limit`, `path`, `changed`, `mu`; delete `cap`, `spent`, `failed`, `spendEntry`, `expire` and all spend accounting.
- Constructors: `NewReservations(perTenant int) *Reservations` and `NewPersistentReservations(perTenant int, path string) *Reservations`. Delete `NewUnavailableReservations`. A missing, unreadable, corrupt or non-JSON file leaves empty claims and a usable object; keep the path for later saves.
- Load versions 1 and 2: v2 `claims` and v1 `claimed` both decode into `claimRecord`; ignore any `spent` array. Save version 2 with `claims` only, so the next save drops `spent`.
- `begin(key, id, tenant string) error`: duplicate claim → `ErrDuplicateClaim` as today; `inflight[tenant] >= limit` → `ErrBusy` (new, `errors.New("skipped_busy")`); otherwise claim, mark active, increment in-flight, persist; roll back memory on save failure with `ErrClaimState` (rename `ErrReservationState`; message `review claim state unavailable`). Remove the amount argument.
- `beginEphemeral(key, tenant string) error`: same busy/persist rules, no durable claim. Remove the amount argument.
- Delete `reserveRetry`, `settle` and `ErrBudget`.
- `TenantResidue` counts claims only. `PurgeTenant` deletes the tenant's claims and active entries, saves, is idempotent, and has no anonymous-spend branch.
- Keep `claimState`, `claimStatus`, `finish`, `finishClaim`, `notifyLocked`, `WaitTenant`, `tenantBusyLocked`, `duplicateReview`.

### `provider.go`

- Add `InputTokens`, `OutputTokens int` and `UsageReported bool` to `ProviderError` (no body, credential or content fields).
- When the 200 response JSON envelope parses but content/validation fails (`len(Content) != 1`, `ValidateReply` error), return `ProviderError{Status: ProviderInvalid, InputTokens:..., OutputTokens:..., UsageReported:true}`. Timeout, transport error, non-2xx and unparseable envelope stay usage-free (`UsageReported:false`). Credential rejection keeps its current error.

### `orchestrator.go`

- `resolveCallControls(req Request)` (drop the availability-effort argument): `configured = "high"` always; requested defaults to `high`; invalid requested effort still errors before any effect.
- `Run`: delete the `store.PricedModel` runtime refusal, `store.ReservationCost` calls, `reservation`, `spendKey`, the retry-over-cap refusal and the `reservation` argument to `begin`/`beginEphemeral`.
  - `ErrDuplicateClaim` behaviour is unchanged (`in_progress` / `outcome_unknown`).
  - `ErrBusy` → status `skipped_busy`, reason `tenant in-flight limit`.
  - `ErrClaimState` → status `unavailable`, reason `review claim state unavailable`.
  - Retry loop still makes at most two attempts on `timeout`/`api_error`, with no spend check.
- Dry-run: after `validateRequest`, tenant/repo/build-model/kind checks and `resolveCallControls`, before criteria resolution and `Build`, if `req.DryRun` then call `CheckAvailability`; on error return `Receipt{Status:"unavailable", Reason:safeReason(err)}` with no capture fields. If available, continue through criteria/build as today; the later dry-run return is `Receipt{Status:"dry_run", CaptureID:..., Coverage:..., Manifest:...}` with no estimate.
- `Receipt`: delete `EstimatedUSD` / `estimated_usd`.
- `Attempt`: add `CostKnown bool \`json:"cost_known"\``; keep `CostUSD float64 \`json:"cost_usd,omitempty"\``. Success sets `CostKnown:true` and prices from result usage as today. A failed attempt with `ProviderError.UsageReported` sets tokens, `CostKnown:true`, and prices with `store.CostAtInputSize("claude", LiveModel, store.Tokens{In:..., Out:...}, inputTokens, nil)`; a failed attempt without usage sets `CostKnown:false` and no cost. Never use a worst-case estimate.
- `persistRecord`: sum known attempt costs. Set `cost_known:false` and `cost_usd:nil` when attempts exist but none is known; otherwise `cost_known:true` and the summed `cost_usd`. Set `input_tokens`/`output_tokens` as the sum of attempt tokens (success already equals the result). Delete `reservation_outcome` and `reservation_usd`.
- `persistReviewUsage`: same cost/token rule; keep `configured_effort` at `high`; delete `reservation_outcome` and `reservation_usd`; keep the content-free field set.

### Tests

Update the two test files to the new API and add evidence for the Phase 1 outcome:

- Availability table: local → `authenticated remote mode required`; empty token → `CLAUDE_API_TOKEN`; `high`/`xhigh`/`max` accepted; anything else refused; tenant and repo never gate.
- Reservations: v1 (`claimed` + `spent`) and v2 (`claims` + `spent`) load with claims preserved and spend ignored; after a save the file has no `spent`; unreadable/corrupt file starts empty instead of unavailable; third `begin` for one tenant returns `ErrBusy`; `PurgeTenant` removes claims only and is idempotent; `TenantResidue` is claims-only.
- `Run`: many successful calls totalling any cost are never refused; `effort:"xhigh"` and `"max"` complete; third concurrent call returns `skipped_busy` (use `store=false` on those three requests so this evidence does not depend on unit 3); duplicate/claim behaviour still passes.
- Cost: invalid output with provider usage → attempt `cost_known:true` and real cost, record `cost_usd > 0`, `cost_known:true`; api_error and timeout → `cost_usd:null`, `cost_known:false`; api_error then success → total is the known success cost and `cost_known:true`.
- Dry-run: unconfigured server with an invalid capture returns `unavailable` reason `CLAUDE_API_TOKEN` before any capture/criteria refusal; a configured dry-run returns `dry_run` with no `estimated_usd` in the receipt JSON and performs no writes or provider calls.
- Delete tests for the removed cap, allowlist, model mismatch, `YAKKA_REVIEW_REPOS`, reservation totals and `reserved` timeout behaviour. Keep capture, disclosure and criteria refusal tests.

### Keep untouched

- Duplicate claim resolution and cached-duplicate bodies (`cachedReceipt`, execution keys, legacy fallback, tags, trial handling).
- Prompt, packet, criteria, validate and policy behaviour; `store` pricing table and functions; other packages.
- `skipped_duplicate`, `in_progress`, `outcome_unknown`, `cache_unavailable` vocabulary.
- The per-tenant limit of two and tenant attribution used by reset/delete.

## Done evidence

Identify or write the failing tests first; report their output before and after. Because `serve.go` still uses the old API until unit 4 lands, scope build commands to this package.

- `cd packages/yakka && go build ./internal/review` → succeeds.
- `cd packages/yakka && go test ./internal/review -count=1` → all pass, including the new tests above.
- `cd packages/yakka && go test ./internal/review -run 'TestAvailability|TestReservation|TestRun|TestDryRun|TestStoreFalse' -count=1 -v` → the named tests pass.
- `git diff --stat -- packages/yakka/internal/review` → only the five owned files (plus `provider_test.go` only if a compile fix was forced).

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why (including `provider.go` ownership), and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
