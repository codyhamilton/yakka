# Brief: phase2-03 — Reset/delete execution engine, quiescence and crash-safe resume

Consumer: a Go worker in `packages/yakka` who knows `internal/serve` tenant state, workers, admission, admin rescore, registry lifecycle and the review reservation API.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/tenant_lifecycle.go` (new), `packages/yakka/internal/serve/serve.go` (only `tenantState`, `New`, worker lifecycle, `tenant()`, `Close`, admission helpers and the lifecycle resume hook), `packages/yakka/internal/serve/tokens.go` (only lifecycle refusal in token issue/revoke), `packages/yakka/internal/serve/device.go` (only lifecycle refusal in authorize/redeem), `packages/yakka/internal/serve/admin.go` (only stopping/refusing rescore during cleanup), `packages/yakka/internal/serve/lifecycle_engine_test.go` (new). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-03-reset-delete-execution-engine.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-01 (registry lifecycle records/mutations and grant purge) and phase2-02 (tenant-attributed reservations, quiescence read and purge). Read both reports and the code they left.
Runs alongside: nothing.
Budget: read 16 files, about 550 lines changed, 85 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain "synthetic tenancy and complete disposal", lines 131–166; endpoint table (143–146), error ordering (150), profile/recovery (152–158), cleanup/execution (160–164). Decisions 17–19 and 32–34, 37 (lines 221–223, 236–238, 241). Phase 2 outcome (270–275).
2. `packages/yakka/internal/serve/registry_lifecycle.go` and the phase2-01 report — exact lifecycle record, begin/complete and token-purge methods.
3. `packages/yakka/internal/review/availability.go` and the phase2-02 report — attribution fields, quiescence read and `PurgeTenant`.
4. `packages/yakka/internal/serve/serve.go` — `tenantState`/`Server` (251–284), `New` (286–329), worker lifecycle (331–480), `tenant()` (490–507), `Close` (509–533), `Handler` (536–582), `auth` (684–715).
5. `packages/yakka/internal/serve/tokens.go` — tenant/token creation and revocation (11–229).
6. `packages/yakka/internal/serve/device.go` — authorize (133–210) and redeem (240–258).
7. `packages/yakka/internal/serve/admin.go` — rescore state and run (23–90, 174–260).
8. `packages/yakka/internal/store/store.go` — `Tenant`, `Open`, `Close`, `Dir` (168–320) and `lock.go` (whole file).
9. `packages/yakka/internal/serve/reviews_test.go` (1–110) and `mcp_review_test.go` (90–150) — fake provider and server construction patterns.
10. `packages/yakka/internal/serve/admin_test.go` — how tenant directories and status are asserted.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Provide the server-side execution engine that safely quiesces one tenant, erases its complete assets, updates registry/claims/spend, survives crash/restart under the same journaled operation, and refuses rather than half-succeeds when it cannot quiesce.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Both operations block target admission, token issuance/device redemption and background writes before erasure; drain/cancel in-flight reviews and wait for final reservation settlement; stop screening/rescore/queues; close readers/writer/WAL/locks; evict store/claim/read caches. Erase the full tenant directory (facts, reviews, findings, captures, tags, usage, rollups, blobs, pending, archive, review-inputs and temporary files), every registry token including revoked/expired entries, approved device grants, attributed claims/reservations, tenant-bound sessions if any, and selection references. Preserve user-global sessions, other tenants' data/auth, shared admission policy and provider configuration. Reset retains only the explicitly listed identity/ownership metadata and advances the store generation; delete retains no target identity reference. An empty reset store may be created only after the erasure boundary, never repopulated by old credentials, grants, queued work or cursors."
- "Return `409 tenant_busy` before beginning when work cannot be safely quiesced; otherwise partial/faulted cleanup returns `503 tenant_cleanup_incomplete`, keeps the id unavailable and resumes durably after restart under the already-authorized operation. The journal binds the operation (reset vs delete) and retained reset identity/generation; retries cannot switch operations or bypass ownership. A conflicting lifecycle call while cleanup is running returns `409 tenant_busy`. Never return `204` before completion and journal removal. Delete proves zero target rows/objects/references everywhere; reset proves zero old assets/references except its enumerated identity/ownership/marker and new generation. No permanent deletion tombstone: every lazy-open/admission path refuses unregistered ids. Tests cover crash/restart and concurrent ingest/review/token issuance/grant redemption/cursor reads, with other tenants' persisted data byte-equivalent and auth usable."
- "Every new claim/reservation, including store=false unknown outcomes, carries explicit tenant id and format version." / "Before removing attributed rolling spend, atomically transfer only timestamp/amount into an anonymous provider-wide safety accumulator until expiry, with no tenant/key/review/usage/tag identity or reverse mapping."
- "Read these fields from registry/journal metadata only, without lazy-opening tenant storage."
- "Legacy tenants without a trustworthy creation/ownership marker return `409 legacy_tenant_cleanup_unsupported`." (the HTTP unit maps this; the engine must refuse before effects)
- "There is **no MCP reset/delete tool** or CLI/runner lifecycle command."

## Changes

- Add per-tenant quiescence: one target tenant's cleanup must prevent new target admission (HTTP data plane, MCP calls, token issuance/revocation, device authorize/redeem) and wait for work already inside the target to finish, without holding a global lock across other tenants. A per-tenant read/write gate (for example an `RWMutex` held read-side for a whole admitted request and write-side by cleanup) is acceptable; make sure every data-plane entry point that can reach the target store holds it. Document the entry points you covered.
- Add engine methods for reset and delete, taking the tenant id and the authenticated owner id, used by phase2-04. Sequence: verify registry ownership/marker; persist the journaled state (`resetting`/`deleting`) before effects; refuse a conflicting operation; stop the target worker and any rescore; take the target write gate; wait for the reservation/claim quiescence read; purge target tokens and grants; purge tenant-attributed claims/spend via the phase2-02 purge; close and evict the cached `tenantState`; erase the tenant directory and confirm it is gone. Reset then completes registry state to `active` with a new generation and retained id/name/owner/marker; delete removes owner/name/marker and journal. Never return success before the operation-specific residual check passes and the journal is removed.
- Erase through a single directory-removal boundary after close (for example rename to a data-directory quarantine name, then remove), with no `/tmp` use. A crash must leave either the journaled pre-state or a resumable post-state, never a resurrectable tenant.
- Resume on server start/worker start: registry `resetting`/`deleting` records are already-authorized operations. Finish them without an HTTP request, preserving the recorded operation and retained generation. A conflicting new lifecycle request while cleanup runs is busy.
- Refuse token issue/revocation, device approve/redeem and target data-plane admission while the tenant is `resetting`/`deleting`; reject local/keyed mode lifecycle in the route unit, not here.
- Residual proof: reset verifies zero old assets/references except owner/name/marker and the new generation; delete verifies zero target rows/objects/identity references, including the directory, tokens, grants, claims/spend, journal and registry ownership. Other tenants' persisted bytes and auth must remain usable.
- Add a test-only fault seam (an `Options` field is acceptable) to stop cleanup at named stages and simulate a crash/partial fault. Do not add production configuration or a CLI.
- Do not add HTTP routes, gate/error mapping, `/me` fields, cursor generation binding or profile UI; those are phase2-01/04/05/06.

### Keep untouched

Review orchestration/identity, `store=false` semantics, analytics reads, token hashing/scope rules, session cookie expiry, registry persistence shape beyond the additive lifecycle map, and other tenants' stores. Do not edit `internal/review` (phase2-02) or `review_cursor.go` (phase2-05).

## Done evidence

Write the failing checks first, then report before/after output. Use `TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`; never `/tmp`.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'Lifecycle|Reset|Delete|Tenant'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- New test: seed tenant A with facts/reviews/review-use/usage, a token, an approved grant, a cached `tenantState`, and attributed claims/spend; run reset; assert the directory was erased and is re-creatable empty, old tokens/grants/claims are gone, spend is now anonymous and the provider-wide total is unchanged, the journal is gone, the id/name/owner/marker survive, the generation changed, and tenant B's persisted bytes and auth still work.
- New test: delete asserts the directory is absent, registry identity/name/owner/marker and every target reference are gone, a later lazy admission for that id is refused (no directory recreated), and other tenants are unchanged.
- New test: fault injection at each cleanup stage leaves the id unavailable, returns the incomplete signal, and a fresh server resumes the same operation from the journal to completion; the operation cannot switch between reset and delete.
- New test: an in-flight review or a held target gate makes the call return busy before effects; a concurrent ingest/token issue/device redemption/cursor read either finishes before the erase or is refused, never recreating the tenant.
- New test: repeated reset after completion wipes the then-current assets again with another new generation; repeated delete is absent/not-found.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
