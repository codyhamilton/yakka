# Brief: phase1-01 — Real-Go authenticated two-tenant browser harness

Consumer: the execute worker for phase1-01; afterwards every Phase 1 unit and the Phase 1 verifier.
Owned paths: `packages/yakka/internal/serve/plan29_harness_test.go` (new), `packages/yakka-analytics/tests/plan29/harness.mjs` (new), `packages/yakka-analytics/tests/plan29/harness.test.mjs` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-01-real-go-two-tenant-harness.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: phase1-02, phase1-05.
Budget: read about 8 files, add about 600 lines, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:149-152` — Phase 1 outcome and surfaces; `:82-87` — read-context contract; `:93-99` — retained-serving capability contract.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:26-48` — D02, D06, D07, D08, D15, D18 and their required fixes; `:98-105` — replay recipe and real-cookie requirement.
3. `docs/design/09-analytics-workspace-contracts.md:158-162` — test harness/fixture contract (real `yakka serve`, Chromium only, no fixed sleeps).
4. `packages/yakka/internal/serve/tenant_isolation_test.go:1-81` — real two-tenant cookie fixture pattern (`newIsolationFixture`, `loginRemote`, `remoteCreateTenant`, `remoteIssueToken`).
5. `packages/yakka/internal/serve/serve_test.go:473-527` — `doWithCookies`/`loginRemote` helpers; `:830-860` — tenant creation and token issuance.
6. `packages/yakka/internal/analyticsfixture/fixture.go:43-191` — deterministic store seeding patterns to copy.
7. `packages/yakka-analytics/tests/workspace/harness.mjs:54-123` — static/CSP serving seam to reuse; `packages/yakka-analytics/tests/charts-time/browser.mjs:1-59` — Chromium loader and skip contract.
8. `packages/yakka-analytics/tests/identity/browser.test.mjs:1-90` — Playwright cookie context and request/console capture; `packages/yakka-analytics/web/js/app.js:556-567` — shell waits on `/v1/me` and a tenant-scoped schema.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Provide the one real-Go, cookie-session, two-tenant browser fixture that Phase 1's done evidence runs against, so stub-only tests cannot close the phase. It is test-only code; it changes no product handler, store, or UI module.

## Contract

- Phase 1 outcome, `DESIGN.md:149`: "In a real Chromium browser against current Go handlers and an authenticated two-tenant fixture, open every existing board/explorer, change tenant/window/filter, reload, page and drill through to session/artifact/plan detail … A fresh empty tenant loads schema successfully."
- `DESIGN.md:151`: "Browser proof uses the real Go API with cookie sessions; stub-only tests cannot close this phase."
- `09-analytics-workspace-contracts.md:161`: real `yakka serve` on a fixture ledger; Chromium only; tests wait on `html[data-idle="true"]` and explicit end-state conditions, never fixed sleeps; any `console.error` or CSP violation fails a spec; at most 4 requests in flight.
- Remote cookie auth requires an explicit `tenant` even for one owned tenant (`packages/yakka/internal/serve/session.go:315-322`); a missing/foreign tenant is `403 no such tenant` (`serve.go:722`).

## Changes

### Go side — `plan29_harness_test.go`

- Start with `//go:build plan29harness` and package `serve`, so ordinary `go test ./...` does not compile or run it. It may call unexported test helpers in `tenant_isolation_test.go`/`serve_test.go` (`mockGitHub`, `loginRemote`, `remoteCreateTenant`, `remoteIssueToken`).
- Build a real `serve.Server` in remote auth mode with a mock GitHub host, `DisableWorker: true`, and a data root under the worktree's gitignored `.scratch/plan29-harness/<pid>/`. The `go test` process runs with its working directory at `packages/yakka/internal/serve`, so resolve the repo root from the test file path (or `git rev-parse --show-toplevel`) and join `.scratch/plan29-harness/<pid>`. Do not use `t.TempDir()`/`/tmp`; create and remove the directory yourself. Never print or commit the session cookie, tokens, or row dumps.
- Log in once (session owns both tenants), create `plan29-a` and `plan29-b` through the authenticated routes. `plan29-b` stays empty (it is the D02 fresh-tenant case).
- Seed `plan29-a` through `s.tenant(id).t` store calls, copying the minimal patterns from `analyticsfixture.Create`:
  - `sess-alpha`: repo-a/plan-a; one priced usage call ($0.10) whose raw `repo_id` is empty; a commit; one artifact write.
  - `sess-beta`: repo-b; associated with both plan-a and plan-b; one unpriced usage call.
  - `sess-gamma`: repo-c/plan-b; `hook_event` rows whose `store.FactRow.Tool` is `Read` and `Bash`.
  - Artifact versions of design/brief/report under plan-a/plan-b with stored bodies (`WritePending` then `Promote`).
  - Retained scores for `quality`, `clarity`, and a historical check `legacy-check` (scorer `legacy-scorer`) on those content hashes. Leave the active checks catalogue nil; do not read `YAKKA_CHECKS_DIR`.
  - One precheck and one screen rejection.
  - Make the latest usage `ts` newer than the latest hook `ts`, so recency display can be proved.
- Serve the handler on an ephemeral loopback listener and add control routes before delegating to `s.Handler()`:
  - `GET /__plan29/session?tenant=<id>` → `Set-Cookie` for the fixture session (Path=/, HttpOnly, SameSite=Lax, not Secure so plain-HTTP loopback works), with the owned tenant recorded. Reject unknown tenants.
  - `GET /__plan29/fixture` → JSON with tenant IDs/names and fixture counts only (no cookie/token).
- Print exactly `PLAN29_HARNESS_ORIGIN=http://127.0.0.1:<port>` then `PLAN29_HARNESS_READY` and block until stdin closes or SIGTERM, then close the server and remove the data root.

### Node side — `harness.mjs`

- Export `startPlan29Harness()`: spawn `GOTOOLCHAIN=auto go test -tags plan29harness -run '^TestPlan29Harness$' -v ./internal/serve` with cwd `packages/yakka`; parse `PLAN29_HARNESS_ORIGIN`; fail after a bounded wait with the child's captured output. Return `{origin, tenants, cookie(tenant), installSession(context, tenant), selectTenant(context, id), waitIdle(page), close()}` and never log cookie values.
- Serve `web/` from a same-origin loopback static server using the `web/_headers` CSP and client-route fallback (reuse the `harness.mjs` logic; do not copy the stub API). Reverse-proxy `/v1/` to the Go origin, preserving method, headers, body and `Set-Cookie`.
- `cookie(tenant)` calls the control route and parses `set-cookie`; `installSession` uses `context.addCookies` for host `127.0.0.1`; `selectTenant` writes `localStorage['yakka-analytics-tenant']` through `context.addInitScript` (the shell reads it at `web/contract/session-gate.js:17-19`).
- `waitIdle` waits for `html[data-idle="true"]` and every mounted `[data-panel]` to have `data-idle="true"`.
- Capture `pageerror` and `console.error` (excluding only expected 401/403 resource messages) and fail the caller's spec if any appear.

### Smoke — `harness.test.mjs`

- One `node:test` that starts the harness, opens Chromium through `../charts-time/browser.mjs` (skip cleanly when unavailable), installs the session, and asserts:
  - `/v1/me` with the cookie lists both tenants; an analytics request with `tenant=plan29-a` is 200.
  - The same request with no `tenant` is 403 `no such tenant`; with `tenant=plan29-b` it reaches the handler (not 403) and returns JSON.
  - `/start` with `plan29-a` settles (`html[data-idle=true]`), has panel frames, and produces no page/console error.
  - The harness closes the Go child and leaves the tree clean.

## Keep untouched

- No product code under `packages/yakka/internal/serve/*.go` (non-test) or `packages/yakka-analytics/web/`. No existing test file is edited.
- The running Plan 28 trial and any other worktree/ledger. No `/tmp`, no fly/wrangler, no deployed server, no tenant reset/delete.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: this repo uses `node --test` (no vitest); keep `--test-concurrency=1` and `NODE_OPTIONS=--max-old-space-size=8192` within the 8G envelope. Browser specs wait on real end states (`data-idle`, explicit DOM/URL state) with no fixed sleeps or animation/timing assertions. Write only inside the worktree's ignored `.scratch/`, never `/tmp`.

- `cd packages/yakka && GOTOOLCHAIN=auto go test -tags plan29harness -run '^TestPlan29Harness$' -count=1` starts and blocks, printing the origin/ready lines (run through the Node harness; kill at the end).
- `cd /home/codyh/workspace/yakka-build/29 && GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/harness.test.mjs` → pass; before the harness exists, the spec fails at import/startup.
- Observable: with the Node harness running, `curl` (or the test) shows `tenant=plan29-a` 200, omitted tenant 403, and `tenant=plan29-b` non-403 JSON.
- Production parity (verification-time read-only): the orchestrator replays these request shapes against the deployed server using trial tenant `test` and `/home/codyh/.config/yakka/trial.env` + `client.toml`. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
