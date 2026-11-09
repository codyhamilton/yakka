# Brief: phase2-07 — Synthetic isolation and lifecycle conformance fixtures

Consumer: a Go worker in `packages/yakka` who can build end-to-end `internal/serve` fixtures with the fake review provider, two authenticated tenants and restart/fault injection.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/lifecycle_conformance_test.go` (new), `packages/yakka/internal/serve/tenant_isolation_test.go` (new), `packages/yakka/internal/serve/mcp_lifecycle_test.go` (new), plus the lifecycle implementation files `registry_lifecycle.go`, `tenant_lifecycle.go`, `tenant_lifecycle_http.go` and the lifecycle sections of `serve.go`/`tokens.go`/`device.go`/`admin.go` only to fix defects these tests expose. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-07-isolation-lifecycle-conformance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-04, phase2-05 and phase2-06. Read their reports and the code they left.
Runs alongside: phase2-08 (analytics UI; disjoint package).
Budget: read 14 files, about 600 lines added (mostly tests), 85 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — review-call domain (99–119), synthetic tenancy and complete disposal (131–166), trial preparation conventions (168–182), Phase 2 outcome (270–275).
2. `packages/yakka/internal/serve/tenant_lifecycle.go`, `tenant_lifecycle_http.go`, `registry_lifecycle.go` and the phase2-01/03/04 reports.
3. `packages/yakka/internal/serve/reviews_test.go` (1–140) and `mcp_review_test.go` (1–150) — fake provider, keyed/remote servers, receipt assertions.
4. `packages/yakka/internal/serve/review_cursor_test.go` (1–120) and `mcp_list_reviews_test.go` — seeding review rows and walks.
5. `packages/yakka/internal/store/review_usage.go` (1–109) — `ReviewUsageRecords`/`ReviewSpend`.
6. `packages/yakka/internal/store/analytics.go` / `query.go` — the analytics read entry points used by the isolation test; grep the routes in `serve.go`.
7. `packages/yakka/internal/serve/admin.go` — status/footprint reads used to prove zero residue.
8. `packages/yakka/internal/serve/serve_test.go` — remote session/login helpers and restart pattern.

## Goal

Prove, with fixtures rather than implementation changes, that synthetic tenant activity cannot enter real-work reads/analytics/spend and that reset/delete satisfy the complete-disposal, crash, busy and isolation contracts.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- Phase 2 outcome: "Operator fixture creates fresh real-work and shadow-trial tenants via authenticated create/token routes; dedicated keys/allowlists select each. Synthetic stored/unpersisted review/tracking/search activity and costs never enter real-work REST/session-selected reviews, search or any analytics/review-spend path."
- "A real-work bearer or its selected owner-session tenant sees none of the synthetic reviews, findings, search, usage, analytics or costs. Shared owner identity never combines tenants. There is **no separate synthetic-spend counter**. The provider-wide rolling safety cap remains an operational shared budget, never a tenant analytics source or permission to reveal another tenant's spend."
- "Synthetic reviews use `store=true`: tags, caching, paging, tracking and costs work normally within that tenant."
- "Reset returns `204` with the same id/name/owner/marker, a fresh generation and no prior assets, keys, grants, claims, reservations, caches or journal… Delete returns `204` only after exhaustive disk/registry/global-state inspection finds zero target rows/objects/identity references, including tenant-bound sessions if any and journal. Other tenants' persisted data and auth are unchanged; anonymous rolling safety exposure survives without target identity and never enters tenant costs."
- "Both operations work for the current selected/only tenant, clear target selections and cached reads after success… Old keys/grants/cursors/queued work cannot resurrect deleted tenants or repopulate reset tenants; reset generation invalidates pre-reset walks."
- The full Phase 2 fixture sentence from line 272: non-owner (including admin), key/bearer, bearer+owner cookie+UI gates, invalid/expired key+cookie, MCP guessed tool, cross-origin (including Pages/configured origins), cross-site/same-site Fetch-Site, absent/null Origin, missing/wrong UI header, missing session, local mode, non-JSON, missing/wrong/mismatched confirmation and legacy-marker attempts yield their specified errors before effects; busy/partial/fault/crash tests prove `409`/`503`, operation-bound safe restart, exactly-once anonymous spend transfer, no premature `204` and no conflicting operation switch; missing/repeated delete `404`; repeated confirmed reset erases then-current assets.
- "Every new claim/reservation, including store=false unknown outcomes, carries explicit tenant id and format version."

## Changes

- Build a fixture with two fresh ownership-marked tenants (real-work and shadow-trial) created through the authenticated create/token routes, distinct keys and a `YAKKA_REVIEW_REPOS`-equivalent allowlist, using a deterministic fake provider endpoint. Do not call a live provider.
- Isolation tests: stored review, tags, findings, usage/`ReviewSpend`, search and analytics visible only to the owning tenant; a real-work bearer and a real-work session `?tenant=` see none of the synthetic rows; the synthetic tenant sees its own; the provider-wide cap is operational only and no response exposes another tenant's spend. Repeat for an unpersisted `store=false` call under the synthetic key.
- Lifecycle conformance: drive reset/delete through the HTTP routes with a valid owner cookie/Origin/UI header/typed id and assert the full outcome and residual proof, including that a post-reset lazy admission opens an empty store and a pre-reset cursor fails. Verify reset keeps id/name/owner/marker and a new generation; delete removes everything and a later admission does not recreate the directory.
- Exercise the refusal matrix from the contract at the HTTP level and the guessed MCP tool; each refusal must leave the target store, tokens, grants, claims and spend unchanged. Include a non-owner admin and a bearer+valid-cookie+valid-UI-header case.
- Exercise crash/restart and busy/partial faults: stop at each injected stage, reopen the server, resume the same operation, and assert no premature `204`, no operation switch, exactly-once anonymous spend transfer, and other tenants byte-equivalent with usable auth. Run concurrent ingest/review/token/device/cursor reads against the target and prove the contract.
- If a fixture exposes an implementation defect, fix it only in the owned implementation files and report the defect/root cause. Do not weaken a test to match a defect; if the fix exceeds the owned paths or the budget, report `blocked` with the symptom and location.
- Do not edit docs (phase2-09) or analytics UI (phase2-08).

### Keep untouched

Existing review/spend/analytics semantics outside the lifecycle, the `review_usage` content-free shape, cursor paging/filters, real provider/network paths, and the profile UI. No `/tmp`; tests use `TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`.

## Done evidence

Write the failing checks first, then report before/after output.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve ./internal/review ./internal/store -run 'Isolation|Lifecycle|Reset|Delete|Tenant|Conformance|Crash|Busy'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- New tests named for each contract area; each asserts its specified status/error and no effects on refusal.
- The full focused test set passes under the memory cap; no live provider, server, secret, deploy or `/tmp` used.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
