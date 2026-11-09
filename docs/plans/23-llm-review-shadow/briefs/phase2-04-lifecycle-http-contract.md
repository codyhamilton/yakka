# Brief: phase2-04 — Owner lifecycle HTTP contract and refusal ordering

Consumer: a Go worker in `packages/yakka` who knows `internal/serve` routing, session/Origin guards and the lifecycle engine from phase2-03.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/tenant_lifecycle_http.go` (new), `packages/yakka/internal/serve/serve.go` (only route registration in `Handler`), `packages/yakka/internal/serve/lifecycle_http_test.go` (new). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-04-lifecycle-http-contract.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-03 (engine methods and typed busy/incomplete/legacy errors) and phase2-01 (registry lookup without lazy-open).
Runs alongside: nothing.
Budget: read 10 files, about 300 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — endpoint table and gate (141–150), profile/recovery (152–158), decisions 29–33, 36 (lines 233–240), Phase 2 outcome (270–275).
2. `packages/yakka/internal/serve/tenant_lifecycle.go` and the phase2-03 report — engine method signatures and typed errors.
3. `packages/yakka/internal/serve/registry_lifecycle.go` and the phase2-01 report — marker/ownership/generation reads.
4. `packages/yakka/internal/serve/serve.go` — `Handler` (536–582), `cors` (588–639), `auth` (684–715).
5. `packages/yakka/internal/serve/session.go` — `allowedOrigin`/`originGuardContentTypes` (195–239), `withSession` (241–273), `sessionOnly` (275–288), `authorizeRequest` (290–312), `publicOrigin` (129–134).
6. `packages/yakka/internal/serve/tokens.go` — `handleTenantsRoute`/`handleTokensRoute`/subpath patterns (180–229).
7. `packages/yakka/internal/serve/serve_test.go` — request/cookie helpers and remote test setup (23–60, 473–580).
8. `packages/yakka/internal/serve/tenants_test.go` — `remoteCreateTenant` and session helpers.
9. `packages/yakka/internal/serve/mcp.go` — `mcpCall` unknown-tool handling (575–584).
10. `docs/design/03-remote-service.md` — pending lifecycle API section (201–230) for the exact error text.

## Goal

Expose the two human-owner-only lifecycle routes with the exact credential/Origin/session/JSON/ownership/confirmation ordering, and map the engine's busy/incomplete/legacy outcomes without ever performing effects on a refusal.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf. Replace the proposed `/v1/admin/tenants/<tenant-id>/reset`; no admin reset alias, redirect or fallback is introduced. These remote-only routes authorize against the path tenant's registry owner, never an admin flag, display name, selected tenant or key scope."
- "`POST /v1/tenants/<tenant-id>/reset` | JSON `{"confirm_tenant_id":"<exact path id>"}` | `204` after erasing every tenant asset except the immutable tenant id, display name, owner link and trustworthy lifecycle marker; retain an empty reusable tenant with a new store generation."
- "`DELETE /v1/tenants/<tenant-id>` | Same required JSON confirmation | `204` only after removing the tenant entirely."
- "Both routes require **all** of the following before effects: a valid browser `workflow_session` cookie for the owner; exact `Origin` equal to the configured public API origin (reject absent, `null`, malformed or other origins); `Sec-Fetch-Site`, when present, equal to `same-origin`; fixed dedicated header **`X-Yakka-UI: tenant-lifecycle`**; `Content-Type: application/json`; and a nonempty string `confirm_tenant_id` exactly equal to the immutable path id. Do not accept `same-site` as `same-origin`. This tightens the existing admin JSON/Origin pattern for these routes only; the broader Pages/configured CORS allowlist does not grant lifecycle permission. If **any Authorization header or other API-key/token credential is supplied**, reject before cookie fallback, including invalid/expired keys and bearer + valid owner cookie + valid UI headers. No key-authenticated caller succeeds. Local keyless mode is also refused."
- "Reject key/token credentials first with `403 tenant_lifecycle_ui_only`, with JSON `{"error":"tenant_lifecycle_ui_only","message":"Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf. Open the profile UI."}`; local mode returns the same. A cookie-only request without a valid session returns `401 session_required` and a sign-in hint. Next reject Origin/Fetch-Site/UI-header failures with `403 tenant_lifecycle_ui_only`; reject non-JSON with `415 json_required`. For a valid UI session return `404 tenant_not_found` for absent ids and `403 tenant_owner_required` for any existing tenant not owned by that session, including an admin non-owner. Then malformed JSON/missing/wrong-type/mismatched confirmation returns `400 tenant_confirmation_mismatch`. Next legacy tenants without a trustworthy creation/ownership marker return `409 legacy_tenant_cleanup_unsupported`. All these refusals precede lifecycle locks, journals, lazy-open, spend, selection changes or destructive work; malformed/unknown ids never open storage."
- "A repeated delete of an absent id is `404`, with no tombstone or ownership bypass; a reset of an absent id is also `404`. A repeated confirmed reset of an existing eligible tenant wipes its then-current assets again; it never silently returns a cached earlier success."
- "There is **no MCP reset/delete tool** or CLI/runner lifecycle command; guessed tool calls remain unknown-tool errors without effects."
- "The header/session/same-origin gate is a **guardrail, not proof of a human**: headers and browser sessions can be spoofed or automated."

## Changes

- Register `/v1/tenants/` as a subtree route (keep `/v1/tenants` create unchanged) and accept only `POST /v1/tenants/<id>/reset` and `DELETE /v1/tenants/<id>`; other methods answer `405` with `Allow`, other subpaths `404`. Register both in remote and non-remote modes so local mode returns the specified refusal.
- Implement the gate in the exact contract order, each refusal a no-op. Credential check: any `Authorization` header is a credential and is rejected with the 403 message above before any cookie consideration; local/keyless returns the same 403. Then cookie session; then exact public-API Origin (not Pages, not `YAKKA_SERVE_CORS_ORIGINS`), Fetch-Site when present, UI header; then JSON content type; then registry existence/ownership without `s.tenant()`; then exact `confirm_tenant_id` body; then legacy marker; then engine.
- Use the mandatory human-owner sentence verbatim in the 403 body and in a short route doc comment. Do not add an admin alias/redirect/fallback, an MCP tool or a CLI.
- Map engine outcomes: success `204` with no body; busy `409 tenant_busy`; incomplete/fault `503 tenant_cleanup_incomplete`; legacy `409 legacy_tenant_cleanup_unsupported`. Never answer `204` on a timeout or before the engine's residual proof.
- Do not clear cookies or change the session on success; the user stays signed in. Do not touch local browser selection state (the UI units do that).
- Keep existing `/v1/tenants` create, `/v1/tokens` and CORS behaviour unchanged.

### Keep untouched

The engine internals, registry persistence, reservation/spend code, `/v1/me`, cursor code, the profile view and all UI files. Do not widen the general Origin allowlist or reuse `originGuard` for these routes; the lifecycle gate is stricter.

## Done evidence

Write the failing checks first, then report before/after output. Use `TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`; never `/tmp`.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'LifecycleHTTP|Lifecycle|Reset|Delete'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- Table test covering every refusal, each asserting the exact status/error (or 415/400/409 code) and that the tenant directory, registry tokens, grants, claims and spend are unchanged: non-owner (including an admin non-owner), bearer key, bearer plus a valid owner cookie plus valid UI headers, invalid/expired key plus cookie, guessed MCP reset/delete tool (`-32602 unknown tool`), Pages/configured CORS Origin, `same-site`/`cross-site` Fetch-Site, absent/`null` Origin, missing/wrong UI header, missing session, local mode, non-JSON, missing/wrong-type/mismatched confirmation, and a legacy unsupported tenant.
- Test: reset and delete with a valid owner cookie, exact API Origin, `same-origin`, UI header and confirmation return `204` only after the engine reports completion; repeated reset/delete semantics match the contract; a fault returns `503` and a timeout never returns `204`.
- Test: `?tenant=` or a display-name/admin flag cannot authorize a non-owned tenant.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
