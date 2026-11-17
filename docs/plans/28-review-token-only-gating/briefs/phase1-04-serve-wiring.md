# Brief: phase1-04 — Server wiring and claims-only lifecycle residue

Consumer: a build worker on `packages/yakka/internal/serve`, dispatched by Plan 28 `execute`.
Owned paths: `packages/yakka/internal/serve/serve.go`, `packages/yakka/internal/serve/mcp_review.go`, `packages/yakka/internal/serve/tenant_lifecycle.go`, `packages/yakka/internal/serve/reviews_test.go`, `packages/yakka/internal/serve/mcp_review_test.go`, `packages/yakka/internal/serve/tenant_isolation_test.go`, `packages/yakka/internal/serve/lifecycle_engine_test.go`, `packages/yakka/internal/serve/lifecycle_http_test.go`, `packages/yakka/internal/serve/lifecycle_conformance_test.go`; report `docs/plans/28-review-token-only-gating/reports/phase1-04-serve-wiring.md`. Touch nothing else.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: unit 1 (`phase1-01-review-core`) — its `Availability`, `Reservations` and constructor API.
Runs alongside: unit 2 (`phase1-02-store-pricing`), which has disjoint paths.
Budget: 9 files to read (use the ranges below), about 400 lines to change including tests, 80 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Review availability and call contract (lines 27-40), Phase 1 (lines 219-224), Assumptions 2, 4, 5 and 15. Binding.
2. `packages/yakka/internal/serve/serve.go` — `Config` and `ConfigFromEnv` (39-121), `New` review wiring (293-330), `reviewAvailability` (763-765), `reviewsPostRoute` (770-840). Grep, do not read unrelated routes.
3. `packages/yakka/internal/serve/tenant_lifecycle.go` — `WaitTenant`/`PurgeTenant`/residue check (205-310).
4. `packages/yakka/internal/serve/reviews_test.go` — all 134 lines.
5. `packages/yakka/internal/serve/mcp_review_test.go` — `TestReviewMCPAndRESTShareOrchestrationAndReceipt` config and assertions (100-182); leave the schema tests alone.
6. `packages/yakka/internal/serve/tenant_isolation_test.go` — the fixture config and allowlist (55-85).
7. `packages/yakka/internal/serve/lifecycle_engine_test.go` — `seedTenantReservations` and `reservationSpent` (64-105), and the reset/delete assertions (160-290).
8. `packages/yakka/internal/serve/lifecycle_http_test.go` — `lifecycleStateDigest` (114-133), reset/delete assertions (520-610).
9. `packages/yakka/internal/serve/lifecycle_conformance_test.go` — reset conformance (50-125) and crash/restart (390-475).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Wire the server to token-only availability, register `review_change` from the token alone, and make tenant reset/delete residue claims-only while still loading v1 and v2 reservation files that carry spend entries.

## Contract

Cited from DESIGN.md:

- "**Availability** is exactly: authenticated remote mode (not `Config.Local()`) and a non-empty `CLAUDE_API_TOKEN`. ... `YAKKA_REVIEW_MODEL`, `YAKKA_REVIEW_EFFORT`, `YAKKA_REVIEW_USD_CAP` and `YAKKA_REVIEW_REPOS` are not read: a set value is ignored and an invalid `YAKKA_REVIEW_USD_CAP` no longer fails startup."
- "**MCP registration**: `review_change` is registered when `CLAUDE_API_TOKEN` is non-empty, the server is not local, and the MCP call ceiling is at least 150 seconds. `list_reviews` is unchanged. `tools/list` for a read_write caller is the non-spending observable availability signal; a dry-run review POST is the REST one."
- "**Kept, because it is not spend**: ... tenant-attributed claims and in-flight tracking used by synthetic-tenant reset/delete. Tenant residue becomes claims-only and the spend-anonymising branch of `PurgeTenant` is deleted."
- "**Persistence compatibility**: the existing `review-reservations.json` (version 1 and 2, with `spent`) decodes without error; spend entries are ignored and dropped on the next save; claims are preserved."
- Phase 1 Outcome: "a v1 and a v2 `review-reservations.json` (with spend entries) load, keep claims and reset/delete residue checks pass", and "reset/delete residue checks pass".

Settled decisions:

- `Config` keeps `ReviewToken` only; delete `ReviewModel`, `ReviewEffort`, `ReviewUSDCap`, `ReviewRepositories`.
- `ConfigFromEnv` reads only `CLAUDE_API_TOKEN` for review. Setting any of the four removed variables, including `YAKKA_REVIEW_USD_CAP=zero` or a malformed `YAKKA_REVIEW_REPOS`, must neither error nor change the config.
- Registration uses `cfg.ReviewToken != "" && !cfg.Local() && mcpTools.maxCall >= 150`.
- A review POST on a token-less server returns HTTP 200 with a receipt `status:"unavailable"`, `reason:"CLAUDE_API_TOKEN"`; in local mode the reason is `authenticated remote mode required` (even when a token is set).
- `New` calls `review.NewPersistentReservations(2, filepath.Join(cfg.Data, "review-reservations.json"))`; there is no unavailable fallback because unreadable files start with empty claims. Keep `Options.ReviewReservations` as the test seam.
- Residue wording in `tenant_lifecycle.go` becomes claims-only (e.g. `claim remains`); the purge call and quiescence wait stay.

## Changes

### `serve.go`

- Delete the four `Config` fields and their environment parsing, including the positive-float and `<tenant>/<repo>` validation and the startup error for an invalid cap. In the review area `ConfigFromEnv` reads only `CLAUDE_API_TOKEN`.
- Remove imports/uses that become unused (`math` / `strconv` only if nothing else uses them; `tenantRE` is still used by `ParseKeys`).
- Registration condition as above.
- `reviewAvailability` returns `review.Availability{Token: s.cfg.ReviewToken, Local: s.cfg.Local()}`.
- `New` reservations wiring as above.

### `tenant_lifecycle.go`

- Keep `WaitTenant`, `PurgeTenant`, and the location of the residue check; update the residue error text from claim-or-spend to claims only.

### `mcp_review.go`

- Keep untouched unless the changed API forces a compile fix. The registration condition lives in `serve.go`.

### Tests

`reviews_test.go`:

- Construct servers with `ReviewToken` only; drop model/effort/cap/allowlist fields.
- Keep the auth, tenant isolation, malformed-body, read-token and receipt assertions; the reviewed repo (`repo-a`) is now accepted without any allowlist.
- Rewrite `TestReviewEnvironmentConfigValidation`: setting `CLAUDE_API_TOKEN` plus all four removed variables (including `YAKKA_REVIEW_USD_CAP=zero` and `YAKKA_REVIEW_REPOS=not-qualified`) returns no error, reads the token, and does not error on the removed settings. Add a case with only the token.
- Add a token-less REST case: `status:"unavailable"`, `reason:"CLAUDE_API_TOKEN"`.
- Add a local-mode REST case: loopback `Addr` and a token set → `status:"unavailable"`, `reason:"authenticated remote mode required"`.

`mcp_review_test.go`:

- Replace the shared-orchestration fixture config with `ReviewToken` only.
- Add a `New`-level registration test: token + non-local + default call ceiling → `s.mcpTool("review_change") != nil`; no token → absent; local loopback + token → absent.
- Keep the direct `RegisterReviewMCPTool` schema/scope tests unchanged.

`tenant_isolation_test.go`:

- Drop the model/cap/allowlist fields and the allowlist assignment; keep the token and the two-tenant isolation assertions.

`lifecycle_engine_test.go`, `lifecycle_http_test.go`, `lifecycle_conformance_test.go`:

- Rewrite `seedTenantReservations` to write a version-2 document with `claims` for the named tenants **and** a `spent` array, then load it with `review.NewPersistentReservations(2, path)`. This proves spend entries are tolerated and ignored.
- Replace `reservationSpent` (spend totals) with a small helper for the raw file/claims (or drop it where only totals were asserted).
- Reset/delete: assert the target tenant's claims are gone (`TenantResidue` false), another tenant's claims remain, the other tenant's bytes are untouched, and the saved file contains no `spent` array. Do not assert a provider-wide spend total or anonymous spend transfer.
- Crash/restart: keep the exactly-once claim purge and other-tenant preservation assertions; delete spend-transfer/double-count assertions. A second restart must remain a no-op.
- Refusal cases: keep the "state unchanged" digest assertions; the digest still includes the reservations file because a refusal must not purge claims.
- Keep v1 coverage: if it is not already covered by unit 1, add one lifecycle-side load of a v1 `{claimed, spent}` file (or rely on unit 1 and state that in the report).

### Keep untouched

- All non-review routes, auth, MCP schemas/annotations, `list_reviews`, `mcp_review.go`'s handler unless a compile fix is forced.
- Reset/delete journaling, quiescence, token purge and the human-only gate.
- Tenant isolation semantics: each tenant sees only its own reviews.
- Do not edit `packages/yakka/internal/review` or `store`; unit 1 owns them.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd packages/yakka && go test ./internal/serve -count=1` → all pass (the whole package, including lifecycle tests).
- `cd packages/yakka && go test ./internal/serve -run 'TestReview|TestMCP|TestReset|TestDelete|TestLifecycle|TestSynthetic' -count=1 -v` → the review, registration, residency and lifecycle tests pass.
- `grep -rIE 'YAKKA_REVIEW_(MODEL|EFFORT|USD_CAP|REPOS)' packages/yakka` → no matches.
- `git diff --stat -- packages/yakka/internal/serve` → only the nine owned files.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
