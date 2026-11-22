# Brief: phase1-03 — Phase 1 real-browser acceptance (A2–A7, A9)

Consumer: the build worker that implements this unit.
Owned paths: `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`, `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase1-03-browser-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `phase1-01` and `phase1-02` (both product units must be landed first; this unit exercises their behaviour and changes no product code).
Runs alongside: nothing.
Budget: 6 files to read, about 220 changed lines, 60 tool turns. Past the budget, stop: write a handoff under this brief’s name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 1 specification” 1.5, 1.6 (A2–A7 and A9), and the 1.2–1.4 copy and predicates the checks assert. Binding.
2. `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs` — lines 130–170 (account fixtures/stub), 260–320 (lifecycle fixtures/stub), and the `go`/`lifecycleUrl` helpers.
3. `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs` — lines 55–135 (setup, `group`, `clean`, `openProfile`), 360–460 (`openLifecycle` and lifecycle flow style), 630–660 and 755–785 (C1 tuples).
4. `docs/plans/31-legacy-tenant-adoption/mockups/README.md`, and view `tenant-selector.png` and `profile-tenants.png` for the states A2–A6 assert.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (carried from the run instructions; apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 1 spec (sections 1.1–1.5) and acceptance check IDs A1–A9. Do not reopen any decision in the Assumption Ledger; no invented scope, no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- Do not set `YAKKA_ADOPT_UNMARKED_TENANTS` true in `fly.toml` in this plan (standing override, 22 Nov); Phase 3 owns the flag, default off. This unit touches no server flag.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in unit or browser tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8G memory cap, `vitest --maxWorkers=3`, Playwright/Chromium with `PUBLIC_CANVAS_TEST_MODE=true`, no animation/timing tests, no `/tmp` (use a gitignored directory under the worktree for screenshots and temp registry copies). This package has no `package.json` or vitest runner (DESIGN Assumption 14); use the design’s `node --test` per file with the 8G cap below. The vitest clause applies only where a vitest runner exists. Screenshots, if any, go under the gitignored `.scratch/` in the worktree, never `/tmp`.
- Signed-in production checks are not automatable: do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.

## Goal

Turn the Phase 1 acceptance checks A2–A7 into real-browser checks and rename the leftover `pending` test fixtures to `resetting`, so a marker-less tenant is provably selectable in the shell, on `/profile`, and on the real Go lifecycle page, while only `resetting`/`deleting` stay unselectable. Close A9 with the final grep.

## Contract

Cited from DESIGN.md §1.5–1.6; settled and not to be re-derived:

- A2–A7 are real-browser checks against the harness; a stub-only or unit test cannot close a browser check. A8 is a real Go test (closed by `phase1-01`). A9 is a grep.
- Do not add `default` to the shared tenant lists: existing assertions count rows (`phase3-acceptance.test.mjs` profile at 94, 111, 144, 191, 217, 450 and lifecycle at 380, 413, 422). A test that needs `default` assigns `account.state.tenants = [...]` or `lifecycle.state.tenants = [...]` before navigating.
- The `default` fixture shape is `{ id: 'default', name: 'default', lifecycle_state: 'unsupported', lifecycle_generation: null }`, the same with `'unmarked'`, and the same with the `lifecycle_state` key absent.
- Fixture renames are exactly: harness `pending` → `resetting` and the display name `Pending` → `Resetting`; the acceptance tuple text follows. Row counts stay as they are.
- Required visible states match `tenant-selector.png` (shell: `default · default` chosen and enabled, a `resetting` option greyed with a `· resetting` suffix) and `profile-tenants.png` (`/profile`: `default` Active with generation `—` and Use tenant enabled; the resetting row’s Use tenant disabled). Where a mockup differs from DESIGN.md, DESIGN.md wins.

## Changes

Lines are as of `6f0a88e5`; search the named strings because your edits shift them.

### `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`

1. Line 148: `{ id: 'tenant-p', name: 'Pending', lifecycle_state: 'pending', lifecycle_generation: 1 }` → `{ id: 'tenant-p', name: 'Resetting', lifecycle_state: 'resetting', lifecycle_generation: 1 }`.
2. Line 284: `{ id: 't-p', name: 'Pending', lifecycle_state: 'pending', lifecycle_generation: 1 }` → `{ id: 't-p', name: 'Resetting', lifecycle_state: 'resetting', lifecycle_generation: 1 }`.
3. Do not add `default` to `initialAccountTenants` or `initialLifecycleTenants`. No row counts change. If you add a fixture helper, it must not alter those lists or the stubs’ default state.

### `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`

1. Update the row assertion at line 97 to `['Resetting', 'tenant-p', 'Owner', 'Resetting', '1']` (the harness rename forces it).
2. Line 645 tuple → `['Resetting · tenant-p · resetting', true]`; line 773 tuple → `['Resetting · t-p · resetting', true]`. Update the evidence word “pending” in the adjacent `group` labels to “resetting”; keep the row counts and every other assertion.
3. For A2’s request assertion, extend the existing `accountPage.on('request', …)` near line 75 so each recorded analytics entry carries the query as well as the path (e.g. `{ path: url.pathname, search: url.search }`). This is additive; existing uses read `.length` only.
4. Add real-browser groups A2–A7 in the same test, using the existing `group(id, fn, evidence)`, `clean()`, `openProfile()`, `accountPage`, `lifecyclePage`, `account`, `lifecycle`, `harness` and `analytics`. Reset state with `clean()` / `lifecycle.reset()` at the start of each group and leave the shared lists as the harness defaults afterwards.
   - **A2** `clean()`; `account.state.tenants = [{ id: 'default', name: 'default', lifecycle_state: 'unsupported', lifecycle_generation: null }]`; open `/b/pulse`: `#tenant-select` is not disabled, has exactly one option `default · default`, enabled and selected; the URL gains `tenant=default`; `.tenant-unavailable` count is 0; every analytics request recorded since this navigation (zero allowed) carries `tenant=default`. Do not assert analytics response bodies (the upstream fixture has no `default` tenant).
   - **A3** Repeat A2 with `lifecycle_state: 'unmarked'` and with the `lifecycle_state` key absent. Use a parameterised helper; all three variants assert the same enabled/selected/URL/no-unavailable/request-tenant facts.
   - **A4** `account.state.tenants = [{ id: 't-new', name: 'Aaa', lifecycle_state: 'active', lifecycle_generation: 1 }, <default unsupported fixture>]`; with `yakka-analytics-tenant=default` remembered, `/b/pulse` shows `default` selected; opening `/b/pulse?tenant=default` selects it; choosing `t-new` then `default` from the select updates the URL each time.
   - **A5** The unchanged shared fixture’s `tenant-p` (`resetting`): its option is disabled with text `Resetting · tenant-p · resetting`; opening `/b/pulse?tenant=tenant-p` shows exactly `This tenant is being reset or deleted. Choose it again when that finishes.`; a foreign `?tenant=foreign` still shows `This tenant is unavailable to your account.`
   - **A6** `/profile` with the `default` fixture appended to `account.state.tenants`: the `default` row shows `Active` and `—`; `use-tenant-default` is enabled; clicking it stores `yakka-analytics-tenant=default`; the token section reads `Selected tenant: default · default` and `create-token` is enabled; the `resetting` row’s `use-tenant-tenant-p` is disabled. Then a list of tenants with none selectable (e.g. only the `resetting` fixture) renders the token line `Choose a tenant to issue a token.`
   - **A7** Lifecycle page via the real Go template, as `phase3-acceptance` does: `lifecycle.reset()`; append the `default` fixture to `lifecycle.state.tenants`; open `/profile/lifecycle?tenant=default`: `#tenant-select` value is `default`; `#selection-note` is hidden; the `default` row shows state `unsupported` (and, in a second pass with the `'unmarked'` fixture, `unmarked`), generation `not assigned yet`, the exact §1.4(6) note `No lifecycle marker yet, so reset and delete are not offered. This tenant can still be selected and used. It gets a marker when the server next starts with adoption enabled.`, and no Reset/Delete buttons; a `?tenant=` naming a tenant the owner does not own still shows the selection note.

### A9 (grep, final)

Run the exact command after both product units are landed:

```
grep -rn "activeTenants\|lifecycle !== 'active'\|lifecycle !== \"active\"\|=== 'active'" packages/yakka-analytics/web packages/yakka/internal/serve/lifecycle_profile.html
```

Expected: no tenant-selection hit. The only allowed `"active"` comparison is the Reset/Delete row branch at `lifecycle_profile.html:291`; it uses double quotes and does not match this pattern.

### Keep untouched

- The shared tenant lists and every existing row-count assertion.
- The account and lifecycle stubs’ request routing, status codes and `state.requests` semantics; do not add `default` to the stubs.
- No product code in this unit. If a check exposes a product gap, write it up as `done with concerns` or `blocked`; do not patch the product here.
- No animation/timing assertions; wait on DOM state, not sleeps.

## Done evidence

Start by recording the current passing baseline with both product units landed. Then apply the harness rename and the row/tuple updates and record the failure that rename causes before the acceptance expectations catch up. Then add A2–A7 and record the final pass.

- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs` → passes with A2–A7 and the renamed rows/tuples. Paste the group results/evidence lines for A2–A7.
- `cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1` → `ok` (A8, owned by `phase1-01`; rerun here as integration evidence, do not claim it as this unit’s close).
- A9 grep command above → empty output.
- A2–A7 are real-browser checks; a stub-only test cannot close them. A8 is a real Go test and A9 is the grep; neither is closed by a stub.
- No signed-in production check is attempted. If the Playwright/Chromium path in `tests/charts-time/browser.mjs` or the Go fixture toolchain is unavailable, record `gate: <tool> unavailable on this machine`; do not substitute a stub for A2–A7.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.
