# Brief: 2-01 — Identity flows

Consumer: Phase 2 outcome and the static workspace shell.  
Repo: `/home/codyh/workspace/yakka-build/20`, branch `feat/20-analytics-reset`.  
Owned paths: `packages/yakka-analytics/web/js/identity/`, `packages/yakka-analytics/web/js/core/` session gate wiring, `packages/yakka-analytics/web/contract/`, `packages/yakka-analytics/tests/identity/`, `packages/yakka/internal/serve/` only for the local `/oauth/callback` shell/API route distinction. Touch no other plans, worktrees or branches.  
Commits: commit this unit and its report on the current branch; do not push, merge, deploy, or touch master.  
Report: before committing, write `docs/plans/20-analytics-reset/reports/2-01-identity-flows.md` and include it in your commit. Use `packages/yakka/catalogue/checks/execution-report.json` as the report rubric.  
Depends on: Phase 1.  
Runs alongside: nothing.  
Budget: 25 files to read, about 1,200 lines to change, 50 tool turns. If over budget, leave a precise handoff in IMPLEMENTATION.md and report.

## Required reading

1. `docs/plans/20-analytics-reset/DESIGN.md`, Phase 2 outcome and Workspace shell and state domain.
2. `docs/plans/20-analytics-reset/CONTRACTS.md`, sections 2, 3.3–3.7, 4, 5, 6, and 9.
3. `packages/yakka-analytics/web/` shell, `contract/transport.js`, current tests and test harness.
4. `packages/yakka/internal/serve/serve.go` and site handler tests for the callback route seam.

## Goal and contract

Implement the Phase 2 identity experience in the framework-free static app. The user must be able to reach the correct sign-in, callback, device approval, profile and settings flows through the existing shell. Follow the cited contract exactly; do not add API fields, routes, credential behavior, or browser storage keys.

- Session gate: call `/v1/me` once per page load; preserve `/login`, `/oauth/callback`, `/settings`, local embedded mode, signed-in state, bearer-plus-base fallback, safe return-path redirects, no-tenant recovery, and connection hints exactly as CONTRACTS.md section 5 specifies. Do not start analytics requests before the gate allows the destination.
- Sign-in: use full browser navigation to `/oauth/login?return=...`; callback performs credentialed fetch forwarding `code` and `state`, rejects a redirected final URL, displays failures in place, and navigates only to a `safeReturnPath` result.
- Device approval: preserve and uppercase/trim the entered user code; keep it in sign-in return paths; fetch the displayed host; send only the documented approval or denial fields; support tenant, scope, lifetime, optional name and failure messages from sections 2.3 and 3.5. A device token must never enter browser storage, page text, URL, or reload state.
- Profile and settings: support tenant selection/creation, token list/mint/revoke, and base/key save/clear under sections 3.3–3.7 and 4. Tokens are shown once when minted and never persisted; bearer Settings requests follow `authFor` and never put credentials in URLs.
- Route seam: local embedded `/oauth/callback` must resolve to the static shell; remote collector `/oauth/callback` must remain the JSON API endpoint for GitHub's callback exchange. Keep account routes served by the static site as contracted.

Do not add analytics panels, backend analytics routes, new dependencies, live OAuth/production calls, secrets, or credentials. Plans 21/22/23 features remain schema-detected and absent unless the API reports them.

## Done evidence

- Identity checks against fixtures/stubs cover signed-out deep-link sign-in and return, safe-path rejection, denied/failed/redirected callback staying in place, normalized device code and host, exact approval/denial bodies, preserved return code, tenant and lifetime choices, verbatim API failures, profile tenant/token operations, empty-tenant recovery, bearer Settings, and sign-out.
- Credential checks prove one-time issued tokens are absent from localStorage, URL, and reload; session endpoints use cookies without bearer; bearer requests use the documented header; no analytics request starts before the gate.
- Route test proves local `/oauth/callback` serves the app shell while remote mode retains the API JSON callback handler.
- Run focused tests with the repository's 8 GiB memory cap and at most 3 Vitest workers if Vitest is used. Browser tests must use `PUBLIC_CANVAS_TEST_MODE=true`; no animation/timing tests. Use fixtures/fakes only; no production data, live deploy, credentials, or human confirmation.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State what changed, verification commands and results, deviations and why, unfinished work, known problems, and any contract contradiction. Include any required external/human dependency as a `gate: <what>` line in the report.
