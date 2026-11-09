# Brief: phase2-01 — Registry lifecycle foundation and `/me` recovery fields

Consumer: a Go worker in `packages/yakka` who knows `internal/serve` registry persistence, session ownership, token/device-grant tables.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/registry.go`, `packages/yakka/internal/serve/registry_lifecycle.go` (new), `packages/yakka/internal/serve/session.go` (only `TenantInfo`, `tenantsOwnedBy` and `handleMe`), `packages/yakka/internal/serve/device_grants.go` (only a tenant-purge helper), `packages/yakka/internal/serve/tenants_test.go`, `packages/yakka/internal/serve/registry_lifecycle_test.go` (new). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-01-registry-lifecycle-foundation.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: phase2-02 (it owns `internal/review`; do not edit that package).
Budget: read 10 files, about 350 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain "synthetic tenancy and complete disposal", lines 131–166; especially the endpoint table (143–146), validation ordering (150), profile/recovery (152–158) and execution/cleanup (160–164). Decisions 17–19 and 29–38 (lines 221–242). Phase 2 outcome and surfaces (270–275).
2. `packages/yakka/internal/serve/registry.go` — `registryDoc`/`Registry` (76–96), `load` and version check (113–156), `saveLocked` (165–188), creation (278–341), `TenantInfo` (343–354), token creation/revocation/resolution (379–504).
3. `packages/yakka/internal/serve/session.go` — `tenantsOwnedBy`/`ownsTenant` (104–127), `handleMe` (359–366).
4. `packages/yakka/internal/serve/device_grants.go` — grant shape and tables (25–52), sweep/drop (84–98), `decide` (126–146).
5. `packages/yakka/internal/serve/tenants_test.go` — first-login, backfill, unique-name and token-name tests (1–120).
6. `packages/yakka/internal/serve/serve_test.go` — `PutSession` use (220) and `loginRemote`/cookie helpers (473–520).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Add the persistent owner lifecycle record that proves creation/ownership coverage, owns the lifecycle state and generation reported by `GET /v1/me`, and provides the registry-side reset/delete mutations and grant purge that the execution engine will call.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Phase 2 additively extends each owned tenant in `GET /v1/me` with `lifecycle_state` (`active`, `resetting`, `deleting`, `unsupported`) and `lifecycle_generation` (opaque string for ownership-marked tenants, null for unsupported legacy). During cleanup, the owner's entry remains visible with its in-progress state; recovery authorization/identity metadata is retained until the final boundary. Completed reset becomes active with a different generation; completed delete disappears from the owned list. Read these fields from registry/journal metadata only, without lazy-opening tenant storage."
- "A trustworthy creation marker proves coverage; never guess, reverse-hash or bulk-clear opaque legacy claims."
- "The journal binds the operation (reset vs delete) and retained reset identity/generation; retries cannot switch operations or bypass ownership."
- "Reset retains only the explicitly listed identity/ownership metadata and advances the store generation; delete retains no target identity reference."
- "`POST /v1/tenants/<tenant-id>/reset` … `204` after erasing every tenant asset except the immutable tenant id, display name, owner link and trustworthy lifecycle marker; retain an empty reusable tenant with a new store generation. Revoke/remove every old token and grant; the owner must issue a new key before reuse."
- "`DELETE /v1/tenants/<tenant-id>` … `204` only after removing the tenant entirely: identity/name/owner/marker, tokens, tenant-bound sessions if any, all data and attributed global state, and cleanup journal. Future experiments require a new tenant id/key."
- "For a valid UI session return `404 tenant_not_found` for absent ids and `403 tenant_owner_required` for any existing tenant not owned by that session, including an admin non-owner. Then malformed JSON/missing/wrong-type/mismatched confirmation returns `400 tenant_confirmation_mismatch`. Next legacy tenants without a trustworthy creation/ownership marker return `409 legacy_tenant_cleanup_unsupported`."
- "A repeated delete of an absent id is `404`, with no tombstone or ownership bypass; a reset of an absent id is also `404`. A repeated confirmed reset of an existing eligible tenant wipes its then-current assets again; it never silently returns a cached earlier success."
- "Deleting the final tenant does not recreate one during cleanup; existing later OAuth login may provision a fresh default under a new id."

## Changes

- Extend `registryDoc` additively (keep registry `Version: 1`; unknown fields are already tolerated) with a per-tenant lifecycle map. Each record carries at least: a trustworthy creation marker, the opaque lifecycle generation, `lifecycle_state` (`active`/`resetting`/`deleting`), and the in-progress `operation` (`reset`/`delete`). A tenant with an owner/name entry but no lifecycle record is legacy: report `unsupported` and a null generation; never infer a marker or generation from its id/name/owner.
- New tenants created by `CreateTenant`/`EnsureDefaultTenant` must receive a fresh random marker and generation and `active`. Existing tenants are not migrated or backfilled.
- Add `TenantInfo` fields `LifecycleState` (`json:"lifecycle_state"`) and `LifecycleGeneration` (`json:"lifecycle_generation"`, `*string` so legacy serialises as `null`). Populate them in `tenantsOwnedBy` from registry memory; do not call `s.tenant()` or open a directory.
- Add registry operations used by later units: read a tenant's lifecycle record and generation; begin reset/delete after owner+marker verification, persisting the operation and state; complete reset by switching to `active` with a **new** generation and clearing the operation; complete delete by removing owner, name and lifecycle record. All mutations persist atomically through the existing `saveLocked` path.
- Add a registry method that removes every token record for one tenant, including revoked and expired records, and persists. Do not touch other tenants' token records or user-global sessions.
- Add `deviceGrants.purgeTenant(tenant string)` dropping every in-memory grant whose approved/decided tenant matches. Grants with no tenant identity (still pending) are not guessed at.
- Keep sessions user-global: reset/delete must not delete or invalidate `registry.sessions` records for the owner.
- Do not implement HTTP routes, disk erasure, store closing, reservation cleanup or the profile view here; later units call these registry methods.

### Keep untouched

Ownership checks for ordinary tenant creation/token issuance, token hashing/resolution, device-code polling/rate limits, `admitByPolicy`, session cookie/cookie expiry behaviour, and the existing `TenantName` fallback. Do not edit `internal/review` (phase2-02) or `serve.go`/engine files (phase2-03).

## Done evidence

Write the failing checks first, then report before/after output.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'Tenant|Registry|Lifecycle|Me'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- New test: `CreateTenant` and `EnsureDefaultTenant` create `active` tenants with nonempty marker and generation; `/v1/me` returns `lifecycle_state:"active"` and a non-null `lifecycle_generation` for them.
- New test: a registry file containing an owner/name but no lifecycle record reports `lifecycle_state:"unsupported"` and `lifecycle_generation:null`, and lifecycle begin operations refuse it.
- New test: begin reset → `/me` shows `resetting` with the old generation and retained name/owner; complete reset → `active` with a different generation, same id/name/owner/marker; begin delete → `deleting`, still listed; complete delete → absent from the owned list.
- New test: completing reset/delete removes all tokens for that tenant (revoked and expired included) while another tenant's tokens and the owner's other tenants survive; `sessions` still resolve.
- New test: `purgeTenant` removes only that tenant's grants and keeps another tenant's approved grant.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
