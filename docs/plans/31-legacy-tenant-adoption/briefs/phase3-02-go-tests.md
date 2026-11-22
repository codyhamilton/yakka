# Brief: phase3-02 — Go tests for adoption, the flag and the unmarked regression lock

Consumer: the build worker that writes and runs the Go tests.
Owned paths: `packages/yakka/internal/serve/registry_lifecycle_test.go`, `packages/yakka/internal/serve/adopt_startup_test.go` (new), `packages/yakka/internal/serve/serve_test.go`, `packages/yakka/internal/serve/lifecycle_http_test.go`. Touch nothing else. Do not edit product code; if a test exposes a product bug, report it (symptom, location, root cause) and stop — do not fix product code here.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase3-02-go-tests.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `phase3-01` (new symbols `lifecycleStateUnmarked`, `AdoptUnmarkedTenants`, `newActiveLifecycleRecord`, `Config.AdoptUnmarkedTenants`, `envTruthy`). The package’s tests do not compile before that unit lands.
Runs alongside: `phase3-03` (docs) — disjoint paths, and both need `phase3-01` landed for the combined B2 grep.
Budget: 10 files to read, about 450 changed lines, 60 tool turns. Past the budget, stop: write a handoff under this brief’s name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 3 specification” §3.8 and §3.9 (B1, B3, B4); the Phase 3 outcome under “Phases”; Assumption Ledger 8, 9, 12 and 14. Binding: the exact test names, fixtures, assertions and commands.
2. `packages/yakka/internal/serve/registry_lifecycle_test.go` — the whole file, especially `TestLegacyTenantReportsUnsupported` (88–120), `TestNewTenantsHaveActiveLifecycle` (16–30) and `TestLifecycleSaveFailureRestoresMemory` (252 onward, for the blocked-save technique).
3. `packages/yakka/internal/serve/lifecycle_http_test.go` — `putLifecycleSession` (20–30), `lifecycleStateDigest` (115–134), `assertLifecycleError` (135–158), `TestLifecycleHTTPLegacyTenantRefused` (482–507) and `TestLifecycleHTTPResetAndDeleteSucceed` (509 onward, for the request shape and headers).
4. `packages/yakka/internal/serve/lifecycle_engine_test.go` — `lifecycleConfig` (22–30), `seedTenantAssets`, `lifecycleRecord`, `digestTree`; `newLifecycleServer`.
5. `packages/yakka/internal/serve/serve_test.go` — `TestLocalModeConfig` (152–182), `TestCORSConfig` (1052–1066), `remoteTestConfig` (433), `do` (23–31), `doWithCookies` (473), `remoteIssueToken` (837).
6. `packages/yakka/internal/serve/tenants_test.go` — `getTenants` and `meTenants` (10–25).
7. `packages/yakka/internal/serve/mcp_conformance_test.go` — `mcpRequest`, `mcpDecode`, `mcpCallBody` (22–60); `packages/yakka/internal/serve/mcp_lifecycle_test.go` for the MCP shape.
8. `packages/yakka/internal/serve/registry.go` — `TokenHashRecord` (51–62), `registryDoc` (74–83), `hashTokenPlaintext` (261), `OpenRegistry`/`Persist`/`saveLocked`/`Close` (101–210).
9. `packages/yakka/internal/serve/lifecycle_conformance_test.go` 344–359 and `mcp_lifecycle_test.go` — these stay unchanged; read only to avoid breaking them.
10. `packages/yakka/internal/serve/serve.go` — `Config`, `ConfigFromEnv`, `New` (read only; the product code is `phase3-01`’s).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 3 specification (3.1–3.9), the Phase 3 outcome, and acceptance check IDs B1–B5. Do not reopen any decision in the Assumption Ledger (notably Assumptions 2, 3, 4, 5, 8, 9, 12, 13, 14, 15, 17, 18). No invented scope: no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`. Do not weaken a test to make it pass.
- **OVERRIDE signed off 22 Nov (Solution Designer / Executor standing rule):** do **not** set `YAKKA_ADOPT_UNMARKED_TENANTS = "true"` in `fly.toml` and do **not** add the `fly.toml` comment. DESIGN.md §3.6 is skipped entirely for this plan. **No brief may edit `fly.toml`.** The orchestrator records `gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped`.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in Go tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8 GiB memory cap. No vitest, Playwright or Chromium in this unit (this Go package has no such runner). No animation or timing tests. No `/tmp`: run every `go test` with `TMPDIR=/home/codyh/workspace/yakka-build/31/.scratch/t` (create it first) so `t.TempDir()` stays under the worktree, and put any manual registry copy under `.scratch/`. Run `gofmt` on every changed Go file.
- Signed-in production checks are not automatable (Yakka has no automated sign-in): do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as a line `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.
- Mockups are **not applicable** to this unit. Phase 3 touches no screen, no HTML, no web UI and no mockup. Do not edit or copy `mockups/tenant-selector.png`, `mockups/profile-tenants.png`, `mockups/lifecycle-confirm.png` or anything under `mockups/src/`. If you believe a screen is touched, stop and report why; otherwise there is none.

## Goal

Lock the Phase 3 product behaviour with real Go tests: the `/v1/me` `unmarked` rename, `AdoptUnmarkedTenants` (selection, idempotence, save-failure restoration), the `Config` env flag, startup adoption on/off (including the reading that an unmarked tenant still serves analytics, MCP and token minting), and that an adopted tenant keeps every reset/delete confirmation. This unit closes B1, B3 (inspection plus `TestNewLeavesUnmarkedWhenFlagOff` as the regression lock) and B4. B5 and B2 are shared with `phase3-01` and `phase3-03`; do not claim them alone.

## Contract

Cited from DESIGN.md §3.8 and §3.9. Settled, not to be re-derived.

### §3.8 test changes

- `registry_lifecycle_test.go`: rename `TestLegacyTenantReportsUnsupported` to `TestUnmarkedTenantReportsUnmarked`; expect `lifecycleStateUnmarked`; everything else in it stays (null generation, no record, reset/delete return `ErrLegacyTenantCleanupUnsupported`, owner and not-found errors).
- New `TestAdoptUnmarkedTenants` in the same file: write `registry.json` with `owners` `{"default":"204","t-legacy":"204","t-marked":"204"}`, `names` for all three, and a `lifecycle` entry only for `t-marked` with fixed marker/generation strings. `OpenRegistry`; call `AdoptUnmarkedTenants`. Assert: returns `["default","t-legacy"]`; each now has a 32-character hex marker and generation, state `active`, empty `Operation`; the two markers differ and the two generations differ; `t-marked` equals its original record; re-open from disk gives identical records; a second call returns `nil, nil` and `registry.json` bytes are identical before and after; `BeginTenantReset(204, "default")` returns nil; `tenantsOwnedBy(204)` lists all three as `active` with a non-nil generation.
- New `TestAdoptSkipsNamesWithoutOwner`: a `names` entry with no `owners` entry gets no lifecycle record.
- New `TestAdoptSaveFailureRestoresMemory`: follow `TestLifecycleSaveFailureRestoresMemory`’s blocked-path technique to force `saveLocked` to fail; assert the error, no new lifecycle entries, `r.dirty` as before, and a later successful call adopts.
- New `adopt_startup_test.go` using the legacy-registry setup of `lifecycle_http_test.go:482–507`:
  - `TestNewAdoptsWhenFlagOn`: `Config.AdoptUnmarkedTenants = true`; after `New`, `GET /v1/me` as the owner lists the tenant `active` with a non-empty `lifecycle_generation`; a token record seeded into the original `registry.json` (`token_hashes: [{id, tenant: <id>, scope: "read", hash: hashTokenPlaintext(<plaintext>), github_id: <owner>, expires_at: <future>, revoked: false, created_at}]`) still authorizes `GET /v1/analytics/event-counts?tenant=<id>` with 200.
  - `TestNewLeavesUnmarkedWhenFlagOff`: default `Config`; `/v1/me` lists `unmarked` with null generation; the same tenant still serves an analytics read and an MCP `tools/list` for a token bound to it, and an owner `POST /v1/tokens` for it succeeds, and `registry.json` is unchanged. Because `New` ends with `reg.Persist()` in remote mode and the fixture is compact JSON, first normalise the fixture (`OpenRegistry`, `Persist`, `Close`) and compare bytes against that normalised file.
  - `TestConfigAdoptFlag` in the file that tests `ConfigFromEnv` (this is `serve_test.go`; found by `grep -n "ConfigFromEnv(" packages/yakka/internal/serve/*_test.go`): unset is false; `"true"`, `"1"`, `" TRUE "` are true; `"false"`, `"0"`, `"maybe"` are false.
- `lifecycle_http_test.go` `TestLifecycleHTTPLegacyTenantRefused` stays (flag off, 409). Add `TestLifecycleHTTPAdoptedTenantKeepsConfirmations` on the same fixture with the flag on and the owner cookie from `putLifecycleSession`: reset with the right id, Origin and `X-Yakka-UI` returns 204; a body id that differs returns 400 `tenant_confirmation_mismatch`; a missing `X-Yakka-UI` returns 403 `tenant_lifecycle_ui_only`; an `Authorization: Bearer` header with a valid owner cookie returns 403 `tenant_lifecycle_ui_only`; a non-owner session returns 403 `tenant_owner_required`. Each refusal leaves the tenant directory and registry untouched.
- `lifecycle_conformance_test.go:344–359` stays (flag-off 409 case); do not edit it.

### §3.9 B4 evidence

B4 is “starting the server twice with the flag on over one copy of the same legacy `registry.json` (a temp dir, never production) leaves `registry.json` byte-identical after the second start.” §3.8 names no test for it; add one B4-evidence test in `adopt_startup_test.go` (name it `TestNewAdoptSecondStartIsByteIdentical`): write one legacy fixture, `New` once with the flag on, read `registry.json` bytes, `Close`, `New` again with the same config and dir, read bytes again, assert `bytes.Equal`; also assert the first start adopted the tenant (`active`, 32-hex marker and generation) and the second start did not change the marker. Run it with `TMPDIR` under `.scratch/t`. This is evidence for B4, not a new product contract.

### §3.9 B3 inspection

Inspect the AI/MCP surface: `mcp.go:792–804`, `internal/mcp/mcp.go:212,217`, `cmd/yakka/sync.go`, `internal/drain/cli.go`, `plugins/yakka/skills/*` and `plugins/yakka/client/yakka.py`. Confirm no MCP tool, CLI command or plugin skill refuses, hides or words a tenant by `lifecycle_state`; the only “unsupported” wording an agent could read lived in the comments and design docs fixed by `phase3-01`/`phase3-03`. `TestNewLeavesUnmarkedWhenFlagOff` is the regression lock. Record the inspection result in the report.

## Changes

Line numbers are as of this branch after Phase 2 landed; search the named strings.

### `packages/yakka/internal/serve/registry_lifecycle_test.go`

1. Rename the legacy test and use `lifecycleStateUnmarked` (this is also what makes the package compile after `phase3-01`). Keep every other assertion in that test unchanged.
2. Add `TestAdoptUnmarkedTenants` with a fixture of the shape `{"version":1,"policy":{"mode":"everyone"},"sessions":{},"owners":{"default":"204","t-legacy":"204","t-marked":"204"},"names":{"default":"default","t-legacy":"old","t-marked":"kept"},"token_hashes":[],"lifecycle":{"t-marked":{"marker":"<fixed>","generation":"<fixed>","state":"active"}}}`. Assert exactly the §3.8 list, including the sorted return, 32-hex validation, distinctness, disk re-open, second-call `nil, nil` and byte equality, the successful `BeginTenantReset`, and `tenantsOwnedBy`.
3. Add `TestAdoptSkipsNamesWithoutOwner`: an owner entry plus a separate `names` entry that has no owner; after adoption only the owned id has a lifecycle record.
4. Add `TestAdoptSaveFailureRestoresMemory`: load a legacy fixture, capture `r.dirty`, block saves (the `TestLifecycleSaveFailureRestoresMemory` trick of pointing `r.path` at a `missing-parent` directory), assert the error, assert no lifecycle entry was added and `r.dirty` is unchanged, restore the path, call again, assert adoption succeeded and persisted.

### `packages/yakka/internal/serve/adopt_startup_test.go` (new)

Build the fixture locally (a small helper is fine) with `owners`, `names` and `token_hashes`. Use `lifecycleConfig(dir, "http://127.0.0.1:1")` as the base config, set `cfg.AdoptUnmarkedTenants = true` only where the test needs it, and `New(cfg, Options{DisableWorker: true, PollInterval: time.Hour})` as the existing lifecycle tests do.

- `TestNewAdoptsWhenFlagOn`: seed the read token in the fixture; after `New`, `getTenants` shows `active` with a non-empty generation, and `do(t, h, "GET", "/v1/analytics/event-counts?tenant=t-legacy", plaintext, "")` returns 200.
- `TestNewLeavesUnmarkedWhenFlagOff`: normalise the fixture (`OpenRegistry`, `Persist`, `Close`) and read its bytes; `New` with the flag off; compare `registry.json` bytes to the normalised file **before** issuing any new token (the later `POST /v1/tokens` necessarily writes); `getTenants` shows `unmarked` with `LifecycleGeneration == nil`; then the seeded token serves the analytics read and an MCP `tools/list` (`mcpRequest` + `mcpDecode`, `result.tools` non-empty), and `remoteIssueToken` (owner session) succeeds with 201.
- `TestNewAdoptSecondStartIsByteIdentical`: the B4 evidence described in Contract.
- `TestConfigAdoptFlag` goes in `serve_test.go`, not here.

### `packages/yakka/internal/serve/serve_test.go`

Add `TestConfigAdoptFlag` next to the existing `ConfigFromEnv` tests. Use a loopback `YAKKA_SERVE_ADDR` (`127.0.0.1:0`) and `YAKKA_SERVE_DATA` so no OAuth is required; table-drive unset, `"true"`, `"1"`, `" TRUE "`, `"false"`, `"0"`, `"maybe"`.

### `packages/yakka/internal/serve/lifecycle_http_test.go`

1. Leave `TestLifecycleHTTPLegacyTenantRefused` unchanged.
2. Add `TestLifecycleHTTPAdoptedTenantKeepsConfirmations`: same legacy fixture, but `cfg.AdoptUnmarkedTenants = true` before `New`. Use `putLifecycleSession` for the owner (`204`) and a second session for a non-owner (`999`). Send each request with `Origin: https://collector.example`, `Sec-Fetch-Site: same-origin`, `Content-Type: application/json`, the `X-Yakka-UI: tenant-lifecycle` header where the case does not deliberately omit it, and the cookie. Run the four refusal cases **before** the success case, and for each refusal capture `lifecycleStateDigest` immediately before and after and assert equality plus `os.Stat(filepath.Join(dir, "t-legacy"))` is `os.IsNotExist`. Then the correct reset returns 204.

### Keep untouched

- `lifecycle_conformance_test.go` (344–359 stays), `mcp_lifecycle_test.go`, `lifecycle_engine_test.go` helpers, and every product file. Do not rename or relax existing assertions.
- `TestLifecycleHTTPLegacyTenantRefused` and its flag-off 409 `legacy_tenant_cleanup_unsupported`.
- The wire contract: reset/delete request shape, `X-Yakka-UI`, Origin and typed-id confirmation.
- No browser acceptance file. Phase 3 touches no `tests/operable-chrome/*`, so the Phase 2 `P2-C1`…`P2-C6` groups, the harness `state.counts.gate` hook and the lifecycle dialog stay inert. Do not edit them.
- No `fly.toml`.

## Done evidence

Fix the compile first (the rename), then add the tests. Report before/after where a check failed before the change.

- `mkdir -p /home/codyh/workspace/yakka-build/31/.scratch/t` once.
- `cd packages/yakka && gofmt -l internal/serve/registry_lifecycle_test.go internal/serve/adopt_startup_test.go internal/serve/serve_test.go internal/serve/lifecycle_http_test.go` → no output.
- `cd packages/yakka && TMPDIR=/home/codyh/workspace/yakka-build/31/.scratch/t go test ./internal/serve -run 'TestUnmarkedTenantReportsUnmarked|TestAdopt|TestNewAdopt|TestNewLeavesUnmarked|TestConfigAdoptFlag|TestLifecycleHTTPAdopted|TestLifecycleHTTPLegacyTenantRefused' -count=1` → `ok`.
- **B1:** `cd packages/yakka && TMPDIR=/home/codyh/workspace/yakka-build/31/.scratch/t go test ./internal/serve -count=1` → `ok` (the full suite; allow several minutes). `cd packages/yakka && go vet ./...` → clean. A stub, grep or browser-only check cannot close B1.
- **B4:** `TestNewAdoptSecondStartIsByteIdentical` passes; report the two SHA-256 values of `registry.json` (they must be equal) and confirm the run used `TMPDIR` under `.scratch/t`.
- **B3:** report the inspection commands and their output for the MCP/CLI/plugin paths in Contract, and state that `TestNewLeavesUnmarkedWhenFlagOff` is the regression lock.
- `git diff --check` → no output.
- `gate: B2’s combined grep also needs phase3-03’s docs; B5’s Plan 23 amendment is phase3-03’s and the dated code comment is phase3-01’s.`
- `gate: signed-in production check of Cody’s live default tenant is not automatable; this unit proves the flag on/off paths against fixtures only.`

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
