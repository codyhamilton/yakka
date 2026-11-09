# Report: phase2-08 — Pages profile lifecycle link and cross-origin selection revalidation

Status: `done with concerns`

Branch: `feat/23b-review-controls-trial`

## What changed

- `src/lib/api.ts`
  - `Tenant` gains optional `lifecycle_state` (`active|resetting|deleting|unsupported`) and `lifecycle_generation` (`string|null`). `tenantLifecycleState()` defaults a pre-lifecycle collector to `active`; `isLifecycleTracked()` marks ownership-marked tenants.
  - `fetchMe()` normalises each tenant: known state kept, explicit `null` generation kept, absent fields left absent so an older API stays usable.
  - `lifecycleProfileUrl(hostname?)` returns `resolvedBase(hostname) + '/profile/lifecycle'` (Pages production API, configured base, or same-origin local).
  - A `setTenantReadGuard()` hook is awaited in `apiGet` for non-session, collector-mode reads. No lifecycle mutation helper exists.
- `src/lib/session-gate.ts`
  - Remembered selection now persists id (`yakka-analytics-tenant`, unchanged), generation (`yakka-analytics-tenant-generation`) and an invalidation marker (`yakka-analytics-tenant-invalidated`).
  - `validateSelection()` compares remembered id/generation with `/v1/me`: matching → selected; absent/changed/no-generation → invalidate; resetting/deleting → pending; recorded invalidation → unselected (no first-tenant fallback). Pre-lifecycle payloads keep the old usable selection.
  - `INVALIDATED_TENANT` makes `currentTenantFromMe` return null, suppressing fallback for every existing consumer.
  - `selectionReadBlock()` and `TenantSelectionError` express why a read must not be issued.
- `src/lib/session-gate.svelte.ts`
  - Gate state adds `invalidated`, `pending` and `notice`; `finishSessionGate`/`reconcileTenantSelection` apply the validation result.
  - `chooseTenant(id, tenant?)` stores the observed generation and clears invalidation; an invalidated selection clears cached reads (`client.clearCache()`), notices and the error.
  - `markTenantReadsDirty()`, `revalidateTenantSelection()` and `ensureTenantReadable()` revalidate `/v1/me` and block tenant reads on invalidate/pending/unknown. A failed revalidation keeps the dirty flag (completion unknown) and clears nothing.
  - `startSelectionSync()` broadcasts and receives same-origin invalidation over `BroadcastChannel`; no `postMessage` or credentials cross origins.
- `src/routes/+layout.svelte`: installs the read guard, sync, `focus`/`pageshow` revalidation and `/profile`-return revalidation.
- `src/routes/profile/+page.svelte`: adds the API-origin lifecycle navigation link and, when invalidated/pending, an explicit re-selection panel (works even with one tenant) plus re-selection after creating a tenant. No reset/delete form or lifecycle request is added.

## Check output

Before (new checks written first; package deps absent, see gate below):

```
$ npx --no-install vitest run --config <scratch>/vitest.noweb.config.mjs \
    src/lib/session-gate.test.ts src/lib/api.test.ts --maxWorkers=3
Test Files  2 failed (2)
     Tests  13 failed | 39 passed (52)
  TypeError: validateSelection is not a function
  TypeError: readRememberedGeneration is not a function
  ... (new selection/lifecycle/profile-link tests missing)
```

After:

```
Test Files  2 passed (2)
     Tests  52 passed (52)
```

Also:
- `tsc --noEmit --strict` over the changed `api.ts` and `session-gate.ts`: exit 0.
- Svelte compiler `parse()` over the changed `+layout.svelte` and `profile/+page.svelte`: both parsed.
- `git diff --check`: no output.

Build gate: `npm run build` cannot run. `packages/yakka-analytics/node_modules` is absent and the wrapper instruction forbids installing/fetching, so `vite build` fails with `sh: 1: vite: not found`. The Svelte parse and TypeScript checks above are the available static evidence; a real `vite build` remains unproven here.

## Departures

- **Line budget:** 683 changed lines (about 440 production incl. tests fixture wiring, 193 tests) against the ~450 guidance. Done-evidence checks pass, so I finished rather than stopping; following phase2-01/2-04 precedent this is flagged, not hidden.
- **npm/vitest gate:** the brief's `npm ci --offline` was not run because dependencies are absent and the invocation forbids installing/fetching. Tests ran with the locally cached `vitest@5.1.0` from `~/.npm/_npx` and a scratch config without the SvelteKit plugin; a generated, gitignored `.svelte-kit/tsconfig.json` was required for the transform. Nothing was added to the commit from these scratch artifacts.
- **Saved views/cursors:** no tenant-scoped saved-view or cursor store exists in the Pages app; saved analyses deliberately strip `tenant`, and review walk cursors live server-side. On invalidation the unit clears the in-memory aggregate read cache, notices, error and the selection rather than unrelated user-global views.
- **Revalidation failure:** `/v1/me` failure leaves state intact and marks reads blocked ("completion unknown") instead of guessing completion. This is stricter than the existing silent-stale behavior and consistent with the contract's uncertainty rule.

## Problems / unfinished

- `npm run build` is unverified because dependencies are absent (gate above). CI or a dependency-present run must prove the Svelte compile.
- `client.clearCache()` clears all cached reads, not only the invalidated tenant's; the query cache is not tenant-keyed. This is safe (only refetch cost) but broader than the literal wording.
- Same-origin notification is `BroadcastChannel` only; there is no storage-event fallback if `BroadcastChannel` is unavailable (the code then relies on focus/pageshow revalidation).

## Contradictions

- None found between the brief and the cited contracts. The brief's "clear saved views/cached reads/cursors for that tenant" has no tenant-scoped saved-view/cursor store in this package (noted above), so the unit clears the selection and read cache and leaves user-global saved views untouched under "existing unrelated legacy selection behavior is retained".
