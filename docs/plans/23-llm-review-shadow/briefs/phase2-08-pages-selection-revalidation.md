# Brief: phase2-08 — Pages profile lifecycle link and cross-origin selection revalidation

Consumer: a frontend worker in `packages/yakka-analytics` who knows SvelteKit runes, the session gate and the tenant-selected analytics client.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka-analytics/src/routes/profile/+page.svelte`, `packages/yakka-analytics/src/routes/+layout.svelte`, `packages/yakka-analytics/src/lib/api.ts`, `packages/yakka-analytics/src/lib/session-gate.ts`, `packages/yakka-analytics/src/lib/session-gate.svelte.ts`, `packages/yakka-analytics/src/lib/session-gate.test.ts`, `packages/yakka-analytics/src/lib/api.test.ts`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-08-pages-selection-revalidation.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-04 (lifecycle routes and `/me` lifecycle fields from phase2-01). Read its report.
Runs alongside: phase2-05, phase2-06 and phase2-07 (disjoint package).
Budget: read 10 files, about 450 lines changed, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — profile/selection (152–158), decisions 32, 36, 38 (236, 240, 242), Phase 2 outcome (270–275).
2. `docs/design/07-analytics-site.md` — pending lifecycle UI and hosting (55–90), browser access (261–276).
3. `packages/yakka-analytics/src/lib/api.ts` — `Tenant`/`MeResponse` (20–40), base/origin helpers (60–150), `apiGet`/`apiPost` and session routes (175–245), `fetchMe` (330–340).
4. `packages/yakka-analytics/src/lib/session-gate.ts` — gate, tenant choice and remembered tenant (1–143).
5. `packages/yakka-analytics/src/lib/session-gate.svelte.ts` — layout gate state (whole file).
6. `packages/yakka-analytics/src/lib/session-gate.test.ts` — existing selection tests.
7. `packages/yakka-analytics/src/lib/api.test.ts` — request/origin tests.
8. `packages/yakka-analytics/src/routes/+layout.svelte` — session gate, tenant switcher/fallback (1–150, 196–215).
9. `packages/yakka-analytics/src/routes/profile/+page.svelte` — existing profile actions (whole file).
10. `packages/yakka-analytics/src/lib/state.svelte.ts` and `src/lib/investigation/LandingView.svelte`/`InvestigationShell.svelte` — current tenant selection consumers; grep only.

## Goal

Make the Pages profile link to the API-origin lifecycle view and make the Pages origin revalidate identity/generation before tenant data reads, clearing stale selections and suppressing automatic fallback after a reset/delete.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Phase 2 additively extends each owned tenant in `GET /v1/me` with `lifecycle_state` (`active`, `resetting`, `deleting`, `unsupported`) and `lifecycle_generation` (opaque string for ownership-marked tenants, null for unsupported legacy)."
- "API-origin and Pages UI origins have separate localStorage. They cannot erase each other's browser state directly. Both must revalidate `/v1/me` on profile return, focus/pageshow and before issuing tenant data reads, compare the selected id/generation and clear selection/cached reads/cursors when the id is absent or generation changed. In-progress state suspends target reads and confirmation until recovery completes. Persist the remembered generation alongside selection; after lifecycle rollout a remembered eligible selection lacking a generation requires explicit re-selection, so it cannot silently adopt a post-reset generation. Suppress existing automatic-first-tenant fallback after invalidation, including with one remaining tenant. Same-origin tabs receive invalidation notifications; Pages or another browser observes it at its next validation before showing/issuing tenant data reads. No cross-origin message grants authority or carries credentials. Existing unrelated legacy selection behavior is retained."
- "The lifecycle view must be served at the **API origin** … Phase 2 supplies the bounded profile lifecycle view there; a Pages profile links the human to that view by navigation."
- "Deleting the final tenant does not recreate one during cleanup; existing later OAuth login may provision a fresh default under a new id."
- "Failed reads show completion unknown. Do not replay a destructive request automatically after an ambiguous response; refresh state before a new typed confirmation." (the destructive UI itself is the API-origin view; this unit must never call lifecycle routes from Pages)

## Changes

- Extend the `Tenant` type with `lifecycle_state` and `lifecycle_generation` (string or null). Keep parsing tolerant of a collector that predates the fields (treat missing as active/legacy-compatible) so a Pages build against an older API still works.
- Persist the remembered selection as id plus generation (keep the existing `yakka-analytics-tenant` id key for compatibility; add a remembered-generation key or a versioned record). A remembered eligible selection with no generation must not silently adopt the current generation after rollout; it requires explicit re-selection.
- Revalidate `/v1/me` on profile return, window `focus`/`pageshow`, and before a tenant-scoped data request when a dirty flag is set (set on those events). If the selected id is absent or its generation changed, clear the selected tenant, saved views/cached reads/cursors for that tenant and any notice state, mark invalidation, and suppress the existing `currentTenantFromMe` first-tenant fallback even when one tenant remains. Show an explicit re-selection state on the profile. While `resetting`/`deleting`, suspend target reads and confirmation until a later revalidation shows completion.
- Keep global login and other owned tenants usable. Do not use `postMessage` across origins; same-origin tabs may use `BroadcastChannel`/storage events, and the other origin discovers the change at its next validation. No credential or authority is carried.
- On `/profile`, add a navigation link to the API-origin lifecycle view at `resolvedBase()` + `/profile/lifecycle` (same-origin embed or production API as appropriate). Do not add reset/delete forms or any POST/DELETE lifecycle call from Pages. Keep tenant/token creation and existing token revocation unchanged.
- Do not change general CORS/base resolution or the collector bearer/session transport.

### Keep untouched

The Go server and all `docs/` files (other units). Analytics routes/data logic outside the gate/selection, charts, and the existing token/tenant creation forms. Do not perform lifecycle mutations from the Pages origin.

## Done evidence

Write the failing checks first, then report before/after output. Use the offline npm cache and a scratch cache outside `/tmp`.

- `cd packages/yakka-analytics && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp npm ci --offline --ignore-scripts` → installs from the local cache, then `npx vitest run src/lib/session-gate.test.ts src/lib/api.test.ts` → passes.
- New tests: a matching id/generation keeps the selection; an absent id or changed generation clears the selection/caches and suppresses first-tenant fallback even with one tenant; a remembered eligible selection lacking a generation requires explicit re-selection; `resetting`/`deleting` suspends target reads; a pre-lifecycle `/me` payload still yields a usable selection (legacy compatibility).
- New test: the profile link resolves to the API-origin lifecycle view for Pages production, a configured base, and embedded local mode; no lifecycle POST/DELETE is constructed by the Pages client.
- `npm run build` → succeeds (proves the Svelte changes compile).
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
