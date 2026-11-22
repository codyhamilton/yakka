# Brief: phase1-01 — Lifecycle page selects any non-cleanup tenant

Consumer: the build worker that implements this unit.
Owned paths: `packages/yakka/internal/serve/lifecycle_profile.html`, `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase1-01-lifecycle-page-selection.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: `phase1-02` (disjoint paths: the analytics web JS and its unit/browser tests).
Budget: 5 files to read, about 30 changed lines, 25 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 1 specification” 1.4 and 1.6 (A7, A8, A9); “Phases → Phase 1”; Assumption Ledger 6 and 13. Binding: the exact predicates, copy and test string.
2. `packages/yakka/internal/serve/lifecycle_profile.html` — search the named functions (`tenantLifecycle`, `activeTenants`, `renderSelect`, `initSelection`, `renderTenant`, `failureMessage`) and the line anchors below.
3. `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go` — the C1 contract list at lines 55–90.
4. `packages/yakka/internal/serve/registry_lifecycle.go` — lines 10–18 only, to confirm the four states the page can receive. Read-only; do not edit.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (carried from the run instructions; apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 1 spec (sections 1.1–1.5) and acceptance check IDs A1–A9. Do not reopen any decision in the Assumption Ledger; no invented scope, no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- Do not set `YAKKA_ADOPT_UNMARKED_TENANTS` true in `fly.toml` in this plan (standing override, 22 Nov); Phase 3 owns the flag, default off. This unit touches no server flag.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans' build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody's live `default` tenant in any test, probe or live check. Fixture objects named `default` in unit or browser tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8G memory cap, `vitest --maxWorkers=3`, Playwright/Chromium with `PUBLIC_CANVAS_TEST_MODE=true`, no animation/timing tests, no `/tmp` (use a gitignored directory under the worktree for screenshots and temp registry copies). This Go package has no vitest runner; use the design’s `go test` command below. The vitest clause applies only where a vitest runner exists.
- Signed-in production checks are not automatable: do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.

## Goal

Make the API-origin lifecycle page treat only `resetting` and `deleting` as unselectable, and stop calling a tenant with no lifecycle marker “legacy” or “unsupported”, so a marker-less owned tenant is selected and usable on `/profile/lifecycle` while reset/delete stay refused for it. This makes the markup that A7 exercises and makes A8 pass.

## Contract

Cited from DESIGN.md §1.4; these decisions are settled and must not be re-derived:

- A tenant is selectable unless its lifecycle state is `resetting` or `deleting` (§1.4(1), Domain: Selection; Assumption 6). A missing state, `active`, `unmarked`, `unsupported`, unknown or `pending` is selectable. A null generation never affects selection.
- Option text carries the state suffix only when unselectable; a disabled option belongs only to a cleanup state (§1.4(2), mockup `tenant-selector.png` shows the shell equivalent).
- The URL tenant is accepted when it is found and selectable; a foreign or mid-cleanup URL tenant still refuses and shows the selection note (§1.4(3)).
- A marker-less tenant’s row shows generation `not assigned yet`, the exact “No lifecycle marker yet…” note, and no Reset/Delete buttons (§1.4(5),(6)); the row branch for `active` (line 291) is the only allowed `"active"` comparison.
- The error copy for `legacy_tenant_cleanup_unsupported` changes only its human text; the wire error code and all server gates are unchanged (§1.4(7), Assumption 7).

Mockups: no Phase 1 PNG covers the lifecycle page (Phase 2 adds `lifecycle-confirm.png` for the dialog). `tenant-selector.png` and `profile-tenants.png` are not this unit’s surfaces. Where any mockup differs from DESIGN.md, DESIGN.md wins.

## Changes

Lines are as of `6f0a88e5`; search the named strings because your edits shift them.

1. Replace `activeTenants` (line 164) with exactly:

   ```js
   function tenantSelectable(tenant) { const s = tenantLifecycle(tenant); return s !== "resetting" && s !== "deleting"; }
   function selectableTenants(list) { return (list || []).filter(tenantSelectable); }
   ```

   Keep `tenantLifecycle` unchanged.

2. In `renderSelect` (lines 223–224) make the option text `tenantSelectable(tenant) ? tenantLabel(tenant) : tenantLabel(tenant) + " · " + lifecycle` and `option.disabled = !tenantSelectable(tenant);`.

3. In `initSelection` (line 238) replace `tenantLifecycle(tenant) === "active"` with `tenantSelectable(tenant)`. Update the comment at lines 236–237 to say “foreign, deleted or mid-cleanup”. The refusal behaviour for a foreign or mid-cleanup `?tenant=` is unchanged.

4. Rename the two remaining call sites: line 248 and line 359 `activeTenants(` → `selectableTenants(`.

5. In `renderTenant`, line 288: `"none (legacy)"` → `"not assigned yet"`.

6. Lines 294–297: the branch condition becomes `lifecycle === "unmarked" || lifecycle === "unsupported"`; replace the note text with exactly:

   ```
   No lifecycle marker yet, so reset and delete are not offered. This tenant can still be selected and used. It gets a marker when the server next starts with adoption enabled.
   ```

   No Reset or Delete button for that row. Lines 291–293 (active buttons) and 298–302 (mid-cleanup note) are unchanged.

7. In `failureMessage`, line 386: make the `legacy_tenant_cleanup_unsupported` text exactly:

   ```
   legacy_tenant_cleanup_unsupported: this tenant has no lifecycle marker yet, so reset and delete are not available. It can still be selected and used.
   ```

8. In `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go` line 75, change the expected string to `option.disabled = !tenantSelectable(tenant)` and rename the key `"C1 disabled pending options"` to `"C1 disabled mid-cleanup options"`.

### Keep untouched

- `RESET_EFFECT`, `DELETE_EFFECT`, the dialog, `PHRASES`-less Phase 1 state, the typed-id confirmation, the request body/headers and every server gate (Phase 2 owns the dialog and copy).
- The `lifecycle === "active"` branch at line 291 that renders Reset/Delete.
- `tenantLifecycle`, `PAGES_ORIGIN`, the BroadcastChannel invalidation, `history.replaceState` behaviour, and the page’s no-`setTimeout` constraint (`lifecycle_profile_test.go:110`).

## Done evidence

Identify the failing check before changing production code: update the Go test expectation first, run it, and record the failure against the unchanged HTML; then change the HTML and record the pass.

- `cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1` → before the HTML change, fails with the missing `option.disabled = !tenantSelectable(tenant)`; after, `ok`. This is A8, a real Go test: a stub or JS-only test cannot close it.
- `grep -n "activeTenants\|lifecycle !== \"active\"" packages/yakka/internal/serve/lifecycle_profile.html` → no output.
- `grep -cF "No lifecycle marker yet, so reset and delete are not offered. This tenant can still be selected and used. It gets a marker when the server next starts with adoption enabled." packages/yakka/internal/serve/lifecycle_profile.html` → `1`.
- `grep -cF "not assigned yet" packages/yakka/internal/serve/lifecycle_profile.html` → `1`.
- A7 is a real-browser lifecycle-page check owned by `phase1-03`; this unit only writes the markup it exercises. Do not claim A7 closed.
- `gate: A7 real-browser lifecycle page check is closed by phase1-03`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.
