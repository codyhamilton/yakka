# Report: phase1-02 — Web UI: an unmarked tenant is selectable

Status: done

## What changed

Owned paths only:

- `packages/yakka-analytics/web/contract/session-gate.js`
  - Inserted `CLEANUP_STATES` (`resetting`, `deleting`), `tenantCleanupState` and `tenantSelectable`.
  - Replaced the exported `activeTenants` with `selectableTenants`; `activeTenants` is no longer exported. `lifecycle()` unchanged.
  - Rewrote the precedence comment; `authorizedTenant` now uses `tenantSelectable` for URL/remembered/first and returns `reason: 'cleanup'` only when the URL tenant is found but mid-cleanup. The foreign result keeps its exact old shape.
- `packages/yakka-analytics/web/js/app.js`
  - Import `selectableTenants, tenantCleanupState` instead of `activeTenants`.
  - `mountTenantHeader` option loop now disables and suffixes only cleanup tenants; an unmarked tenant reads `Name · id` and is enabled. Auto-selection uses `selectableTenants(me)[0]`.
  - The unavailable paragraph uses the cleanup copy when `auth.reason === 'cleanup'`, foreign copy otherwise.
- `packages/yakka-analytics/web/js/identity/account-console.js`
  - Import `tenantSelectable, tenantCleanupState`; deleted local `tenantState`/`activeTenant`.
  - Tenant row state is `tenantCleanupState(tenant) || 'active'`; a non-selectable tenant's Use tenant button is disabled with title `Reset or delete in progress`.
  - Token selection uses `tenantSelectable`; else line reads `Choose a tenant to issue a token.` when tenants exist, keeping `Create a tenant to issue a token.` for an empty list.
- `packages/yakka-analytics/tests/operable-chrome/scope-unit.test.mjs`
  - Import `selectableTenants`; new `ME` fixture (`tenant-a`/`tenant-b` active, `tenant-c` resetting, `tenant-u` unsupported + null generation, `tenant-m` unmarked, `tenant-x` no key).
  - Added the A1 assertions: `tenant-u`/`tenant-m`/`tenant-x` selectable by URL, `tenant-c` returns `reason: 'cleanup'`, foreign unchanged, `selectableTenants(ME)` order, and the `ME_ONLY` first/remembered cases.

`packages/yakka-analytics/tests/identity/browser.test.mjs` was not edited (its fixture is all `active` and its empty-list sentence is unchanged); it was run as a regression.

## Check output

A1 written first, before the module change:

```
SyntaxError: The requested module '.../web/contract/session-gate.js' does not provide an export named 'selectableTenants'
not ok 1 - tests/operable-chrome/scope-unit.test.mjs
# pass 0
# fail 1
```

After the implementation:

```
PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/scope-unit.test.mjs
# tests 7
# pass 7
# fail 0
```

Browser regression (account console):

```
PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/identity/browser.test.mjs
# tests 18
# pass 18
# fail 0
```

A9 web grep:

```
grep -rn "activeTenants\|lifecycle !== 'active'\|lifecycle !== \"active\"\|=== 'active'" packages/yakka-analytics/web
(no output, exit 1)
```

## Departures

None. The change list was applied literally. Environment note only: Chromium aborted with `Socket path too long` until `TMPDIR` was pointed at the short gitignored `node_modules/.t` under the worktree; no product or test file changed for this.

## Unfinished / gate

`gate: A2–A6 real-browser checks are owned by phase1-03` — this unit implements the behaviour and closes A1 (unit) only; a stub or unit test cannot close a browser check. No live check was needed or run.

## Problems

None found in this unit's surface.
