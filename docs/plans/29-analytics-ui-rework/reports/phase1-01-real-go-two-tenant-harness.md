# Phase 1 unit 01 — real-Go authenticated two-tenant browser harness

Status: done with concerns (brief/UI contradictions named below). No commit was made: the orchestrator asked for an uncommitted working-tree handoff, overriding the brief's "commit" line.

## What was built

A test-only, real-Go, cookie-session, two-tenant fixture and browser harness. No product handler, store, UI module, or existing test file was edited.

- `packages/yakka/internal/serve/plan29_harness_test.go` (new, `//go:build plan29harness`)
  - Builds a real `serve.Server` in remote auth mode against `mockGitHub`, `DisableWorker: true`, data root `.scratch/plan29-harness/<test-pid>/` (repo root from `runtime.Caller`, created and removed by the test; never `t.TempDir()` or `/tmp`).
  - Logs in once; creates `plan29-a` and `plan29-b` through the authenticated routes; `plan29-b` stays empty.
  - Seeds `plan29-a` through `s.tenant(id).t`: `sess-alpha` (repo-a/plan-a; $0.10 priced usage with empty raw repo, a commit), `sess-beta` (repo-b; unpriced usage, artifacts under plan-a and plan-b), `sess-gamma` (repo-c/plan-b; `Read`/`Bash` hook rows), six artifact versions across design/brief/report with stored bodies (`WritePending`+`Promote`) and retained `quality`, `clarity`, `legacy-check` scores from `legacy-scorer`, plus one precheck and one screen rejection. Latest usage `ts` is newer than the latest hook `ts`.
  - Adds `GET /__plan29/session?tenant=<id|name>` (Set-Cookie: Path=/, HttpOnly, SameSite=Lax, no Secure, unknown tenants 404) and `GET /__plan29/fixture` (tenant ids/names and fact count only), then delegates to `s.Handler()` on an ephemeral `127.0.0.1` listener.
  - Prints `PLAN29_HARNESS_ORIGIN=…` then `PLAN29_HARNESS_READY` and blocks until stdin closes (only when stdin is a pipe) or SIGTERM/SIGINT; then shuts down and removes the data root. It never prints the cookie, tokens, or rows.
- `packages/yakka-analytics/tests/plan29/harness.mjs` (new)
  - `startPlan29Harness()` spawns `GOTOOLCHAIN=auto go test -tags plan29harness -run '^TestPlan29Harness$' -count=1 -v ./internal/serve` detached in `packages/yakka`, parses the origin with a bounded (180 s) wait, and fails with captured output.
  - Serves `web/` same-origin on a second loopback port with the `_headers` CSP and client-route fallback, and reverse-proxies `/v1/` preserving method, headers, body and `Set-Cookie`.
  - Returns `origin, tenants, counts, dataRoots, diagnostics, attach, watch, waitIdle, cookie, installSession, selectTenant, tenantId, close`. `cookie` is never logged. `waitIdle` waits for `html[data-idle="true"]` and every `[data-panel][data-idle="true"]`. `pageerror` and non-401/403 `console.error` are captured. `close()` group-signals the child, waits, and removes any leftover scratch root.
- `packages/yakka-analytics/tests/plan29/harness.test.mjs` (new)
  - One `node:test`. Skips cleanly when Chromium 1243/`playwright-core` is unavailable. Asserts `/v1/me` lists both fixture tenants, `tenant=<id(plan29-a)>` schema is 200, omitted tenant is 403 `no such tenant`, `tenant=<id(plan29-b)>` is non-403 JSON, `/` settles with Start content and no diagnostics, and the Go child leaves no data root.

## Done evidence (exact commands, run from the worktree)

Before the files existed the spec could not start:

```
$ GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/harness.test.mjs
before_exit=1
Could not find 'packages/yakka-analytics/tests/plan29/harness.test.mjs'
```

After (same command): `after_exit=0`, `# tests 1`, `# pass 1`, `# fail 0`.

Real Go fixture starts and blocks, printing the two lines (killed after 10 s, as expected):

```
$ GOTOOLCHAIN=auto timeout --foreground -s TERM 10 go test -tags plan29harness \
  -run '^TestPlan29Harness$' -count=1 -v ./internal/serve
=== RUN   TestPlan29Harness
PLAN29_HARNESS_ORIGIN=http://127.0.0.1:42267
PLAN29_HARNESS_READY
# exit 124 (timeout killed it)
```

The tagged file stays out of normal runs:

```
$ GOTOOLCHAIN=auto go test ./internal/serve -run '^$' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.005s [no tests to run]
```

Observable in the Node smoke: `tenant=<id of plan29-a>` → 200; omitted tenant → 403 `{"error":"no such tenant"}`; `tenant=<id of plan29-b>` → non-403 JSON.

Browser/Chromium: the smoke ran (not skipped) against `~/.cache/ms-playwright/chromium-1243`.

## Departures from the brief, with reasons

1. **Tenant identifiers are opaque.** The brief says create `plan29-a`/`plan29-b` and query `tenant=plan29-a`. The authenticated create route returns a generated ID (`t-…`) and keeps the supplied string as the display name (`registry.go:333`); `authorizeRequest` only matches the ID. The harness therefore exposes both and resolves name→id in the control route and Node helpers. The literal `tenant=plan29-a` request cannot pass ownership; this is a brief/product mismatch, not a harness choice.
2. **Start is `/`, not `/start`.** `router.js:8` sets `START_PATH = '/'`; `/start` renders the in-shell not-found view. The smoke opens `/`.
3. **Start has no panel frames.** `/start` (now `/`) renders question paths and the coverage strip; it does not mount `[data-panel]` frames. The brief requires `/start` to "have panel frames". The smoke asserts Start content and no diagnostics instead. `waitIdle` fully checks panels for the board/explorer specs in later units; adding a board here would fail the "any console.error fails" rule today (e.g. `/b/pulse` emits a 400 from D05, and `/b/quality` throws D03).
4. **Unauthenticated login adds a `default` tenant.** OAuth sign-in calls `EnsureDefaultTenant`, so `/v1/me` lists the two fixture tenants plus `default`. The smoke asserts both fixture tenants are owned rather than an exact set. The default tenant is never selected or written to.
5. **Blocking/termination detail.** `go test` does not forward the harness's stdin or a bare SIGTERM to the compiled test binary. The Node harness spawns it detached and signals the process group; the smoke therefore closes it cleanly. Direct manual `go test` runs must be stopped with Ctrl-C or a process-group signal. The leftover root from a `kill <go test pid>` run was removed and is not present now.
6. **No commit.** Per the orchestrator instruction; the brief's commit line is superseded for this run.

## Unfinished / deferred

- Board, explorer, tenant/window/filter, reload, paging and drill-through specs belong to the later Phase 1 units and the verifier; they consume this harness.
- Production-parity replay is the orchestrator's verification-time read-only step; it was not run here.

## Known problems

- The harness depends on `GOTOOLCHAIN=auto` fetching/resolving Go 1.27.1 on first use (the module requires 1.27.1; the local default is 1.24.2). It resolved from cache in this environment.
- Current board pages emit known Plan 29 defects (D03 client exception, D05 400). The diagnostics contract intentionally fails them, so a board-level smoke is not part of this unit.
- `go test` signal-forwarding behavior above is a harness operational detail, not a product bug.

## Gates

- `gate: Go 1.27.1 toolchain` — satisfied via `GOTOOLCHAIN=auto` (`go env GOVERSION` → `go1.27.1`).
- `gate: Chromium 1243` — satisfied; smoke executed.
- `gate: production parity not attempted (verification-time, orchestrator)`
