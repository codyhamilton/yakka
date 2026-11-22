# Brief: phase1-02 — Web UI: an unmarked tenant is selectable

Consumer: the build worker that implements this unit.
Owned paths: `packages/yakka-analytics/web/contract/session-gate.js`, `packages/yakka-analytics/web/js/app.js`, `packages/yakka-analytics/web/js/identity/account-console.js`, `packages/yakka-analytics/tests/operable-chrome/scope-unit.test.mjs`, `packages/yakka-analytics/tests/identity/browser.test.mjs`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase1-02-web-ui-selection.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: `phase1-01` (disjoint paths: the Go lifecycle page and its Go test).
Budget: 8 files to read, about 60 changed lines, 40 tool turns. Past the budget, stop: write a handoff under this brief’s name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 1 specification” 1.1, 1.2, 1.3, 1.5 (scope-unit only) and 1.6 (A1 and, for context, A2–A6); Assumption Ledger 5, 6, 11. Binding: the exact predicates, copy and A1 assertions.
2. `packages/yakka-analytics/web/contract/session-gate.js` — lines 34–66.
3. `packages/yakka-analytics/web/js/app.js` — the import at line 6, `mountTenantHeader` lines 103–126, and the unavailable paragraph at line 976.
4. `packages/yakka-analytics/web/js/identity/account-console.js` — lines 1–3, 65–66, 169–182, 256–266.
5. `packages/yakka-analytics/tests/operable-chrome/scope-unit.test.mjs` — lines 1–60.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (carried from the run instructions; apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 1 spec (sections 1.1–1.5) and acceptance check IDs A1–A9. Do not reopen any decision in the Assumption Ledger; no invented scope, no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- Do not set `YAKKA_ADOPT_UNMARKED_TENANTS` true in `fly.toml` in this plan (standing override, 22 Nov); Phase 3 owns the flag, default off. This unit touches no server flag.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in unit or browser tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8G memory cap, `vitest --maxWorkers=3`, Playwright/Chromium with `PUBLIC_CANVAS_TEST_MODE=true`, no animation/timing tests, no `/tmp` (use a gitignored directory under the worktree for screenshots and temp registry copies). This package has no `package.json` or vitest runner (DESIGN Assumption 14); use the design’s `node --test` per file with the 8G cap below. The vitest clause applies only where a vitest runner exists.
- Signed-in production checks are not automatable: do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.

## Goal

Make the analytics shell and the `/profile` account console treat only `resetting` and `deleting` as unselectable. An unmarked tenant (missing marker, `/v1/me` `unmarked` or an old API’s `unsupported`) is selectable and usable, with no data-aware auto-selection change. Closes A1.

## Contract

Cited from DESIGN.md §1.1–1.3; settled and not to be re-derived:

- Selectability is a deny-list of exactly `resetting` and `deleting`; every other value, including a missing `lifecycle_state` and `unsupported`, is selectable; a null generation never affects selection (Domain: Selection; Assumptions 5 and 6). The UI fix is unconditional, not flag-gated (Assumption 5).
- `activeTenants` is retired and no longer exported; `selectableTenants`, `tenantSelectable` and `tenantCleanupState` replace it (§1.1(2), §1.2(1), §1.3(1)). `lifecycle()` itself is unchanged.
- The shell labels an unmarked tenant `default · default`, enabled, with no suffix; a cleanup tenant reads `Name · id · resetting` and is disabled (§1.2(2)).
- Auto-selection stays URL, then remembered, then first selectable in `/v1/me` order; `rememberedTenant` and `formTenant` are unchanged (Requirement 1.1(8), Assumption 11).
- The foreign-tenant copy and class stay exactly as they are; a mid-cleanup URL tenant gets the cleanup copy instead (§1.2(4)). The generation-revalidation rule at `app.js:241-260` is untouched.
- In the account console, an unmarked tenant shows **Active** and `—`; its Use tenant button is enabled; only a cleanup tenant’s Use tenant button is disabled; the token line says `Choose a tenant to issue a token.` when tenants exist but none is selected, and keeps `Create a tenant to issue a token.` when the list is empty (§1.3(3)–(6)).

Mockups this unit must match: `docs/plans/31-legacy-tenant-adoption/mockups/tenant-selector.png` (shell selector: `default · default` chosen and enabled, a `resetting` row greyed) and `docs/plans/31-legacy-tenant-adoption/mockups/profile-tenants.png` (`/profile` table: `default` Active, generation `—`, Use tenant enabled; the resetting row’s Use tenant disabled). Where a mockup differs from DESIGN.md, DESIGN.md wins.

## Changes

Lines are as of `6f0a88e5`; search the named strings because your edits shift them.

### `packages/yakka-analytics/web/contract/session-gate.js`

1. After `lifecycle()` (line 36) insert exactly:

   ```js
   // Only these two states are mid-cleanup: the server answers tenant_busy for them.
   // Every other value, including a missing marker (unmarked, unsupported, unknown),
   // is selectable. Policy: Plan 31, 22 Nov 2026.
   const CLEANUP_STATES = new Set(['resetting', 'deleting']);

   export function tenantCleanupState(tenant) {
     const state = lifecycle(tenant);
     return CLEANUP_STATES.has(state) ? state : '';
   }

   export function tenantSelectable(tenant) {
     return Boolean(tenant && tenant.id) && !tenantCleanupState(tenant);
   }
   ```

2. Replace `activeTenants` (lines 38–41) with exactly:

   ```js
   export function selectableTenants(me) {
     const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
     return tenants.filter(tenantSelectable);
   }
   ```

3. Replace the comment at lines 43–45 with: `// S1 collector precedence: a URL tenant found in /me.tenants wins, then a valid remembered tenant, then the first selectable owned tenant. A supplied tenant that is foreign or mid-cleanup stops reads instead of falling back. A tenant with no lifecycle marker is selectable.`
4. In `authorizedTenant`: line 52 becomes `if (found && tenantSelectable(found)) return { tenant: found.id, unavailable: false, source: 'url' };`; line 53 becomes `return found ? { tenant: '', unavailable: true, source: 'url', reason: 'cleanup' } : { tenant: '', unavailable: true, source: 'url' };` (the foreign result keeps its exact current shape); line 55 becomes `const validRemembered = tenants.find(tenant => tenant.id === remembered && tenantSelectable(tenant));`; line 57 becomes `const first = tenants.find(tenantSelectable);`. Lines 48, 56, 58, 59, 62–66 are unchanged.

### `packages/yakka-analytics/web/js/app.js`

1. Line 6: replace `activeTenants` in the `../contract/session-gate.js` import with `selectableTenants, tenantCleanupState`; keep the other names.
2. Replace the option loop at lines 109–116 with exactly:

   ```js
   for (const tenant of tenants) {
     const cleanup = tenantCleanupState(tenant);
     const option = element('option', '', cleanup ? `${tenantOptionLabel(tenant)} · ${cleanup}` : tenantOptionLabel(tenant));
     option.value = tenant.id;
     option.selected = tenant.id === selected;
     option.disabled = Boolean(cleanup);
     tenantSelect.append(option);
   }
   ```

3. Line 118: `activeTenants(me)[0]` → `selectableTenants(me)[0]`.
4. Line 976: the paragraph becomes `auth.reason === 'cleanup' ? 'This tenant is being reset or deleted. Choose it again when that finishes.' : 'This tenant is unavailable to your account.'`. Keep the class `tenant-unavailable` and the foreign copy exactly.
5. Do not change lines 103–108 (the `${selected} · unavailable` option), 186–209 (`changeTenant`, `selectAccountTenant`) or 237–260 (`revalidateSession`).

### `packages/yakka-analytics/web/js/identity/account-console.js`

1. After line 2 add `import { tenantSelectable, tenantCleanupState } from '../../contract/session-gate.js';`.
2. Delete lines 65–66 (`tenantState`, `activeTenant`).
3. Line 171: `const state = tenantCleanupState(tenant) || 'active';`. Line 175 text stays `stateLabel(state)` with class `account-state account-state-${state}`; line 176 (null generation renders `—`) is unchanged.
4. After line 179 (the `use.addEventListener` line) insert `if (!tenantSelectable(tenant)) { use.disabled = true; use.title = 'Reset or delete in progress'; }`. The lifecycle link on line 182 stays on every row.
5. Line 262: `activeTenant(tenant)` → `tenantSelectable(tenant)`.
6. Line 265: the else branch becomes `tenants.length ? 'Choose a tenant to issue a token.' : 'Create a tenant to issue a token.'`. The empty-list text is unchanged (asserted by `tests/identity/browser.test.mjs`).

### `packages/yakka-analytics/tests/operable-chrome/scope-unit.test.mjs`

1. Import `selectableTenants` instead of `activeTenants`.
2. Change the `ME` fixture at lines 13–19 to: `tenant-a` (`active`), `tenant-b` (`active`), `tenant-c` (`resetting`), plus `tenant-u` (`lifecycle_state: 'unsupported'`, `lifecycle_generation: null`), `tenant-m` (`'unmarked'`), and `tenant-x` (no `lifecycle_state` key). Names may be any value; A1 asserts ids only.
3. Replace lines 44–46 with the A1 assertions in §1.6, keeping the existing `localStorage` stub. In particular, inside the stubbed store:
   - `authorizedTenant({ me: ME, urlTenant: 'tenant-u' })`, `'tenant-m'` and `'tenant-x'` each deepEqual `{ tenant: <id>, unavailable: false, source: 'url' }`.
   - `authorizedTenant({ me: ME, urlTenant: 'tenant-c' })` deepEquals `{ tenant: '', unavailable: true, source: 'url', reason: 'cleanup' }`; `urlTenant: 'foreign'` still deepEquals `{ tenant: '', unavailable: true, source: 'url' }`.
   - `selectableTenants(ME).map(t => t.id)` deepEquals `['tenant-a','tenant-b','tenant-u','tenant-m','tenant-x']`.
   - With `ME_ONLY = { tenants: [{ id: 'default', name: 'default', lifecycle_state: 'unsupported', lifecycle_generation: null }] }`: with no remembered value, `authorizedTenant({ me: ME_ONLY })` deepEquals `{ tenant: 'default', unavailable: false, source: 'first' }`; with `yakka-analytics-tenant=default` remembered it deepEquals `{ tenant: 'default', unavailable: false, source: 'remembered' }`.
   - Keep the existing URL > remembered > first precedence assertions, updating only what the new fixture makes wrong.

### `packages/yakka-analytics/tests/identity/browser.test.mjs`

No edit is expected: its fixture has only `active` tenants and its empty-list token sentence is unchanged. Run it as a regression. If an assertion there genuinely contradicts DESIGN.md, report the contradiction; do not weaken the product copy to satisfy a stale test.

### Keep untouched

- `lifecycle()`, `rememberedTenant`, `formTenant`, `changeTenant`, `selectAccountTenant`, `revalidateSession`.
- The foreign-tenant copy and `.tenant-unavailable` class, and the `${selected} · unavailable` option.
- Account-console table structure, the row-level lifecycle link, token form fields and request bodies.

## Done evidence

Write the A1 fixture and assertions first and record the failure (the old module exports `activeTenants`, not `selectableTenants`, and an `unsupported` tenant is refused); then implement and record the pass.

- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/scope-unit.test.mjs` → fails before, passes after. This is A1, a unit test.
- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/identity/browser.test.mjs` → passes (real-browser regression for the account console; requires the Playwright/Chromium path in `tests/charts-time/browser.mjs`).
- `grep -rn "activeTenants\|lifecycle !== 'active'\|lifecycle !== \"active\"\|=== 'active'" packages/yakka-analytics/web` → no output. (A9’s full grep also covers the lifecycle page, which is `phase1-01`; `phase1-03` closes A9.)
- A2–A6 are real-browser checks owned by `phase1-03`. This unit implements the behaviour and closes A1 only; a stub or unit test cannot close a browser check. A6 is not closed here.
- No live checks are needed; record none. If Playwright/Chromium is unavailable, record `gate: Playwright/Chromium unavailable on this machine` and keep the unit test evidence.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.
