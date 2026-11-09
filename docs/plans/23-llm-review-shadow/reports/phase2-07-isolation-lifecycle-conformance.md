# Report: phase2-07 — Synthetic isolation and lifecycle conformance fixtures

Status: `over budget`

Branch: `feat/23b-review-controls-trial`

## What changed

No production files changed. The contract was already sound under fixtures; the three new fixture files are:

- `packages/yakka/internal/serve/tenant_isolation_test.go` — two fresh ownership-marked tenants (`real-work`, `shadow-trial`) created through the authenticated create/token routes, distinct `wk_` keys, a tenant-qualified `YAKKA_REVIEW_REPOS`-equivalent allowlist, deterministic fake provider, and a shared owner session. Proves a stored tagged review with findings, its search activity and its analytics appear only in the synthetic tenant and never in the real-work keyed or `?tenant=`-selected session reads; the stored call writes no `review_usage`. Repeats for `store=false`: only the synthetic tenant holds the content-free usage fact and positive `ReviewSpend`; the real-work tenant stays at zero; provider-wide spend is attributed only to the synthetic tenant; no real-work response exposes the synthetic usage identity.
- `packages/yakka/internal/serve/lifecycle_conformance_test.go` — drives reset/delete through the owner HTTP routes with cookie/Origin/UI-header/typed-id. Reset keeps id/name/owner/marker, advances the generation, clears the journal, purges tokens/grants/claims/spend, moves the amount into anonymous provider-wide exposure without changing the total, and leaves the other tenant byte-equivalent and usable. A post-reset lazy admission opens an empty store; a pre-reset cursor returns `400`; a repeated reset erases then-current assets. Delete removes identity/name/marker/tokens/grants/state and a repeat is `404`; later admission refuses without recreating the directory. Also covers the HTTP refusal matrix (bearer, bearer+owner cookie+UI, expired key, non-owner, admin non-owner, Pages/configured origins, same-site/cross-site, absent/null Origin, missing/wrong UI header, missing session, non-JSON, malformed/missing/wrong-type/mismatched confirmation, absent id, legacy marker, local mode) with unchanged state digests, plus crash/restart at all eight injected stages and a held-busy run with concurrent ingest/review/cursor/token/device refusals.
- `packages/yakka/internal/serve/mcp_lifecycle_test.go` — guessed `reset_tenant`/`delete_tenant` are unknown-tool errors with no effects; MCP reads are `tenant_busy` during cleanup and a deleted tenant's key is refused without recreating the directory.

## Check output

Before the fixes (test-authoring failures, no production defect):

```
--- FAIL: TestMCPLifecycleBusyAndDeletedTenantRefused
    panic: close of closed channel   (fault seam reused on the post-reset delete)
--- FAIL: TestSyntheticTenantIsolationStoredActivity
    stored synthetic review: 415 {"error":"content type must be application/json"}
--- FAIL: TestSyntheticTenantIsolationUnpersistedActivity
    ... receipt has no persisted id by design ...
--- FAIL: TestLifecycleConformanceResetDeleteThroughHTTP
    reset = 401 {"error":"session_required",...}   (helper omitted the owner cookie)
--- FAIL: TestLifecycleConformanceCrashRestartExactlyOnce/* (8)
    resume changed the other tenant's bytes   (measured across SQLite close/checkpoint)
```

After (`TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`):

```
$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve ./internal/review ./internal/store \
    -run 'Isolation|Lifecycle|Reset|Delete|Tenant|Conformance|Crash|Busy'
ok  .../internal/serve  2.870s
ok  .../internal/review  1.837s
ok  .../internal/store   0.218s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve ./internal/review ./internal/store
ok  .../internal/serve  16.209s
ok  .../internal/review  6.224s
ok  .../internal/store   9.072s

$ go vet ./internal/serve && go build ./...
(no output)
$ git diff --check
(no output)
```

No live provider, server, secret, deploy, Fly/Wrangler command or `/tmp` was used.

## Departures

- **Line budget:** 926 added lines (three test files) against ~600. All required scenarios are present and every done-evidence check passes, so I finished rather than truncating coverage; this is the reason for `over budget` and matches earlier Phase 2 precedents (2-03 1,036, 2-04 839).
- **Byte-equivalence point:** the other tenant's digest is fixed after `Close` and before restart, because SQLite checkpoints WAL files on close. The assertion is still byte equality of the on-disk tenant; only the measurement point moved.
- **Stored vs unpersisted usage:** a `store=true` review does not write `review_usage` by contract, so the stored test asserts no usage leak and the `store=false` repeat (the brief's own instruction) proves positive synthetic spend with zero real-work spend. No test was weakened.
- No implementation defect was exposed, so no owned production file was edited.

## Contradictions

- The brief lists "usage/`ReviewSpend`" among stored-review isolation items, while the cited contract puts `review_usage` only on `store=false` calls. Resolved by the brief's explicit "Repeat for an unpersisted `store=false` call", not silently.
- The pre-existing `localGuard` `415` for local non-JSON POSTs (vs the contract's `403`) is unchanged; the local-mode check here uses `DELETE`, which returns the specified `403 tenant_lifecycle_ui_only`.

## Problems / unfinished

- None in implementation. No non-trivial bug outside this done evidence was found.
- The busy test holds a real cleanup gate and refuses concurrent REST ingest/reviews/cursor/token/device plus MCP reads; it does not drive an actual concurrent provider call, matching the deterministic fault-seam approach of 2-03/2-04.
