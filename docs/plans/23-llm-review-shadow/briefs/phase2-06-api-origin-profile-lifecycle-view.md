# Brief: phase2-06 — API-origin bounded profile lifecycle view

Consumer: a Go worker in `packages/yakka` who knows `internal/serve` routing and can write a small self-contained HTML/JS view without a frontend build step.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/lifecycle_profile.go` (new), `packages/yakka/internal/serve/lifecycle_profile.html` (new, embedded), `packages/yakka/internal/serve/serve.go` (only `Handler` route registration), `packages/yakka/internal/serve/lifecycle_profile_test.go` (new). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-06-api-origin-profile-lifecycle-view.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-04 (lifecycle routes and `/me` fields from phase2-01). Run after phase2-05 because both edit `Handler` in `serve.go`.
Runs alongside: phase2-08 (analytics UI; disjoint package).
Budget: read 10 files, about 350 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — profile UI (152), recovery (154–158), recommended cleanup path (166), decisions 31–38 (235–242), Phase 2 outcome (270–275).
2. `docs/design/07-analytics-site.md` — "Pending owner lifecycle UI" (55–90), especially the exact reset/delete copy and API-origin hosting requirement.
3. `docs/design/03-remote-service.md` — pending lifecycle API/error section (201–230).
4. `packages/yakka/internal/serve/site.go` — embedded-site pattern and placeholder behaviour (whole file).
5. `packages/yakka/internal/serve/serve.go` — `Handler` (536–582), `withSession`/`sessionOnly` from `session.go` (241–288).
6. `packages/yakka/internal/serve/tenant_lifecycle_http.go` — routes, gate and error codes.
7. `packages/yakka/internal/serve/registry_lifecycle.go` and `session.go` — `/me` fields and lifecycle states.
8. `packages/yakka/internal/serve/tenants_test.go` and `serve_test.go` — session cookies and remote test setup.
9. `packages/yakka-analytics/src/routes/profile/+page.svelte` — existing profile actions the view may link to; do not edit it.
10. `packages/yakka-analytics/src/lib/api.ts` — `resolvedBase()`/Pages origin rules for the back-link.

## Goal

Serve a bounded, self-contained profile lifecycle page from the API origin, including the production collector that has no analytics bundle, so a human owner can see lifecycle state and confirm reset/delete with the exact typed id and copy.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "The lifecycle view must be served at the **API origin**, including the production collector where the current image lacks the analytics bundle. Phase 2 supplies the bounded profile lifecycle view there; a Pages profile links the human to that view by navigation. Do not relax the lifecycle gate for Pages, proxy a key-authenticated call or depend on paused analytics work."
- "Both actions may target the session's currently selected owned tenant, including its only tenant, with the same explicit id confirmation. The modal names the action, display name and immutable id, requires the user to type that id, and includes: **“Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.”** Reset copy adds “Erase all tenant data and revoke its keys. Keep this tenant and your ownership; issue a new key to reuse it.” Delete copy adds “Permanently remove this tenant, all its data and keys, and your ownership link.” Cancellation or any rejection leaves data and selection unchanged."
- "After either `204`, clear target selections, cached tenant reads and cursors in the acting UI origin (and notify its same-origin tabs); reload `/v1/me`, stay on profile and require explicit re-selection or creation, without automatically choosing a fallback even if only one tenant remains."
- "A lost/non-success response never implies success; refresh the owner lifecycle state below before offering any fresh confirmed retry, never automatically replay the destructive request."
- "Disable lifecycle confirmations while resetting/deleting or while recovery reads fail; after recovery any subsequent mutation requires fresh typed confirmation."
- "On ambiguous response, show the observed state or “completion unknown” if the read fails; do not claim a successful receipt from uncertainty."
- The lifecycle requests use "only the owner cookie, exact API `Origin`, `Sec-Fetch-Site: same-origin` when present, `X-Yakka-UI: tenant-lifecycle`, JSON and exact `confirm_tenant_id`. It sends no bearer."

## Changes

- Add a new embedded single-page view at a dedicated path such as `GET /profile/lifecycle` and register it before the site fallback. Use a Go `//go:embed` of a new self-contained HTML file (inline CSS/JS); do not depend on `siteFS`, Node, npm or the analytics bundle. It must load in a production collector whose `site/index.html` is still the placeholder.
- The page is same-origin with the API: fetch `/v1/me` with `credentials: 'include'` and no `Authorization` header. Show the signed-in owner and every owned tenant with display name, immutable id, `lifecycle_state` and generation. Link unauthenticated users to the API-origin sign-in page (or show the 401 hint) and link to the Pages profile for token creation after a reset.
- For `active` tenants show separate Reset and Delete actions; `unsupported` shows the legacy reason and no actions; `resetting`/`deleting` show the in-progress state and disable actions. If `/me` cannot be read, show “completion unknown” and disable actions until a later successful read.
- Each action opens a distinct confirmation: name the operation, display name and immutable id, require typing that exact id, include the mandatory human-owner sentence verbatim plus the reset/delete effect copy above. Cancelling or a rejection leaves state unchanged. Only the typed-id match enables the confirm button.
- Send `POST /v1/tenants/<id>/reset` or `DELETE /v1/tenants/<id>` with JSON `{"confirm_tenant_id":"<id>"}`, `Content-Type: application/json`, `X-Yakka-UI: tenant-lifecycle`, `credentials: 'include'`, and no bearer. Do not use a form navigation; the custom header is required.
- On `204`, clear this origin's remembered tenant id/generation and any cached reads/cursors, notify same-origin tabs (for example `BroadcastChannel` and a storage event), re-fetch `/me`, stay on the page and require explicit re-selection or create. Never auto-select the first remaining tenant. On network/ambiguous failure, show “completion unknown”, re-fetch `/me`, and never auto-retry the destructive call. Surface `403 tenant_lifecycle_ui_only`, `401 session_required`, `403 tenant_owner_required`, `409 tenant_busy`, `409 legacy_tenant_cleanup_unsupported` and `503 tenant_cleanup_incomplete` as messages.
- Do not add reset/delete forms anywhere that calls them cross-origin; Pages links here by navigation.
- Test-only helpers may be added in the new test file. Do not modify the analytics Svelte package (phase2-08).

### Keep untouched

The lifecycle engine/routes, `/me` implementation, general site serving and CORS, token/device flows, and the analytics bundle. Do not relax Origin checks for this page or add a bearer/key path.

## Done evidence

Write the failing checks first, then report before/after output. Use `TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`; never `/tmp`.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'LifecycleProfile|ProfileView'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- Test: in remote mode with the placeholder `siteFS`, `GET /profile/lifecycle` returns the view (not the “analytics bundle not embedded” error), and the HTML contains both exact confirmation copies, the mandatory human-owner sentence, the two route paths, `X-Yakka-UI: tenant-lifecycle`, typed-id input, and no `Authorization`/bearer construction.
- Test: unauthenticated access shows a sign-in path and does not issue lifecycle effects; a session with `/me` failing shows the completion-unknown/disabled state.
- Test: the page's script contains same-origin `credentials: 'include'`, a same-origin invalidation notification, and no automatic retry after an ambiguous failure. (Content assertions are acceptable; state the observable browser check you performed for the modal flow.)
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
