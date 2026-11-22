# Report: phase1-01 — Lifecycle page selects any non-cleanup tenant

Status: done

## What changed

Owned paths only:

- `packages/yakka/internal/serve/lifecycle_profile.html`
  - Replaced `activeTenants` with `tenantSelectable` (deny-list: `resetting`, `deleting`) and `selectableTenants`; `tenantLifecycle` unchanged.
  - `renderSelect`: option text drops the state suffix when selectable, and `option.disabled = !tenantSelectable(tenant)`.
  - `initSelection`: URL tenant accepted when found and selectable; comment now says "foreign, deleted or mid-cleanup".
  - Renamed the two remaining `activeTenants(` call sites (`initSelection`, delete-survivor path) to `selectableTenants(`.
  - `renderTenant`: generation `"none (legacy)"` → `"not assigned yet"`; the `unmarked`/`unsupported` branch uses the exact new note and renders no Reset/Delete buttons. The `active` branch is untouched.
  - `failureMessage`: new human copy for `legacy_tenant_cleanup_unsupported`; wire code unchanged.
- `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go`
  - Expected string `option.disabled = lifecycle !== "active"` → `option.disabled = !tenantSelectable(tenant)`; key renamed to `"C1 disabled mid-cleanup options"`.

## Check output

Before the HTML change (test expectation updated first):

```
--- FAIL: TestLifecycleProfilePhase3Page (0.00s)
    lifecycle_profile_phase3_test.go:90: lifecycle page missing C1 disabled mid-cleanup options ("option.disabled = !tenantSelectable(tenant)")
FAIL
```

After the HTML change:

```
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.013s
```

Other done evidence:

```
grep -n "activeTenants\|lifecycle !== \"active\"" packages/yakka/internal/serve/lifecycle_profile.html
(no output, exit 1)
grep -cF "No lifecycle marker yet, so reset and delete are not offered. This tenant can still be selected and used. It gets a marker when the server next starts with adoption enabled." ...   → 1
grep -cF "not assigned yet" ...  → 1
```

## Departures

None. Work followed the brief's change list literally.

## Unfinished / gate

`gate: A7 real-browser lifecycle page check is closed by phase1-03` — A7 is a real-browser check owned by `phase1-03`; this unit only wrote the markup it exercises and does not claim A7 closed.

## Problems

None found in this unit's surface. The server flag, dialog, confirmation and all server gates were left untouched as required.
