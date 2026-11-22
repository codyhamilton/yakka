# Brief: phase2-02 — Phase 2 real-browser acceptance (C1–C6)

Consumer: the build worker that implements this unit.
Owned paths: `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`, `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase2-02-browser-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `phase2-01` (the lifecycle dialog product code and Go contract tests; this unit changes no product code and its C1–C6 real-browser checks cannot pass until 01 lands).
Runs alongside: nothing.
Budget: 6 files to read, about 250 changed lines, 70 tool turns. Past the budget, stop: write a handoff under this brief’s name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 2 specification” 2.1, 2.2 and 2.3 (C1–C6); the Phase 2 outcome under “Phases”; Assumption Ledger 10, 14, 16 and 17. Binding: the exact copy, counts stub contract, C1–C6 observables and the instruction that C1–C6 are real-browser checks.
2. `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs` — the header 1–15, `installHold` at 117–143, `installLifecycleStub` at 281–339, and the shared `jsonHeaders`/`capture` helpers at 94–115. (DESIGN writes `tests/operable-chrome/…`; the real path is `packages/yakka-analytics/tests/operable-chrome/…`.)
3. `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs` — helpers at 41–65, the A6 lifecycle flows at 365–443, the Phase 1 A2–A7 block and the `analytics.splice(plan31Start)` line at 445–554, and the final analytics guard at 969.
4. `docs/plans/31-legacy-tenant-adoption/mockups/lifecycle-confirm.png` and `mockups/src/lifecycle-confirm.html` — the dialog drawn open. Match its structure/copy; where the mockup and DESIGN.md differ, DESIGN.md wins (2.1(2) places `#op-scale` after `#op-effect`, and no scale-colour rule is added).
5. `packages/yakka/internal/serve/lifecycle_profile.html` — read only the dialog markup and `loadScale`/`paintScale`/`updateConfirm` so the checks use the real selectors and copy. Do not edit it.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (carried from the run instructions; apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 2 spec (sections 2.1–2.3) and acceptance check IDs C1–C7. Do not reopen any decision in the Assumption Ledger; no invented scope, no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- Do not set `YAKKA_ADOPT_UNMARKED_TENANTS` true in `fly.toml` in this plan (standing override, 22 Nov); Phase 3 handles the flag with the code default off. This unit touches no server flag.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in unit or browser tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8G memory cap, `vitest --maxWorkers=3`, Playwright/Chromium with `PUBLIC_CANVAS_TEST_MODE=true`, no animation/timing tests, no `/tmp` (use a gitignored directory under the worktree for screenshots and temp registry copies; Chromium needs a short `TMPDIR`, and `.scratch/t` under the worktree works). This package has no `package.json`/vitest runner (DESIGN Assumption 14); use the design’s `node --test` command with the 8G cap below. The vitest clause applies only where a vitest runner exists.
- Signed-in production checks are not automatable: do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as a line `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.

## Goal

Stub the lifecycle page’s existing `GET /v1/analytics/event-counts` read in the browser harness and prove in one real Chromium that the Phase 2 dialog names the scale of loss, requires the second typed phrase exactly when records exist or the count is unreadable, sends the unchanged destructive request, and drops a stale count result. This unit closes C1–C6. C7 is the real Go test closed by `phase2-01`; rerun it here as integration evidence only.

## Contract

Cited from DESIGN.md §2.2–2.3; settled and not to be re-derived:

- The lifecycle stub also fulfils only the page’s `GET /v1/analytics/event-counts` read. No other analytics surface is intercepted. Counts requests are recorded in `state.countRequests`, never `state.requests`, because `phase3-acceptance.test.mjs:395–396` asserts opening and typing issue no lifecycle request.
- `state.counts` defaults to `{ status: 200, body: { matched: { events: 0, rejections: 0, rows: 0 }, tenant_total: { events: 0, rejections: 0, rows: 0 }, unit: 'retained_record' } }`; `state.counts.abort = true` aborts; `reset()` restores the defaults and clears `state.countRequests`.
- C1: delete shows exactly `This tenant holds 1,418,544 stored records (1,418,332 events, 212 rejected). Deleting erases all of them and cannot be undone.` for counts `{ events: 1418332, rejections: 212, rows: 1418544 }`; `op-effect` is the 2.1(1) delete string; the phrase label reads `Type delete all data to confirm`. Reset shows the same numbers with `Resetting erases all of them and cannot be undone.` and phrase `reset all data`.
- C2: Confirm stays disabled while counts load, with only the id, with only the phrase, and with the phrase one character wrong (`delete all dat`); it enables only when both match exactly; changing either box disables it again.
- C3: exactly one `DELETE /v1/tenants/default` with `Content-Type: application/json`, `X-Yakka-UI: tenant-lifecycle` and body `{"confirm_tenant_id":"default"}`; Cancel sends no destructive request.
- C4: zero counts → `This tenant holds no stored records.`, phrase label hidden, typing only the id enables Confirm.
- C5: counts failure (network error, 500, or non-numeric body) → `The size of this tenant could not be read. Assume it holds data.` and the phrase is required.
- C6: cancel a dialog, open another while the first count is still pending; the first count’s result must not change the second dialog.
- C1–C6 are real-browser checks; a stub-only test cannot close them. Do not add `default` to the shared fixture lists or change existing row counts; a C group assigns `lifecycle.state.tenants` after `lifecycle.reset()`.
- Carried from Phase 1: the final “account routes performed no analytics read” guard is preserved by the `analytics.splice(plan31Start)` line, which drops only A2–A4’s intentional `/b/pulse` reads. That splice is a test-harness accommodation, not a product invariant; leave it exactly as it is. `/sessions` was probed separately and is not added to this shared test.

## Changes

Lines are as of this branch after Phase 1 landed; search the named strings because your edits shift them. No product code in this unit.

### `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`

1. Amend the header comment at 7–9 and 15: the lifecycle helper stubs `/v1/me`, the destructive reset/delete calls, and the lifecycle page’s own `GET /v1/analytics/event-counts` read, and nothing else analytics. Keep “no production fixture mode, no fixed sleeps”; the counts reply is the page’s confirmation read, not an analytics surface.
2. In `installLifecycleStub` state (around 288–293): add `countRequests: []` and
   `counts: { status: 200, body: { matched: { events: 0, rejections: 0, rows: 0 }, tenant_total: { events: 0, rejections: 0, rows: 0 }, unit: 'retained_record' }, abort: false, gate: null }`.
   In `reset()` restore exactly those defaults and clear `state.countRequests` (and null `gate`).
3. Register a second route alongside `page.route(API_ROUTE, handler)` (the existing `API_ROUTE` at 159 does not match `event-counts`). Its handler must not call `capture(state.requests, …)`; it records into `state.countRequests` and fulfils `state.counts`:
   - capture the request into `state.countRequests` (use `capture(state.countRequests, request, '')`);
   - snapshot `status`, `body` and `abort` before any gate so a held request replies with the values from when it was made;
   - if `state.counts.gate` is a function, `await state.counts.gate(entry)` (this is the deterministic C6 hold; no sleeps);
   - `abort` → `route.abort('failed')`; otherwise `route.fulfill({ status, headers: jsonHeaders(request), body: JSON.stringify(body) })`.
4. Do not change the lifecycle stub’s `/v1/me`, reset/delete semantics, `state.requests`, `hold`, or the shared `initialLifecycleTenants` list.

### `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`

1. Add the helper `openDialogReady()` near `openLifecycle` (around 377):
   `const openDialogReady = async () => { await lifecyclePage.waitForFunction(() => { const text = document.querySelector('#op-scale')?.textContent || ''; return text !== '' && !text.startsWith('Checking'); }); };`
   Call it after every dialog open in the existing A6 lifecycle flows (after the clicks at 386, 400, 419 and 436) before typing or asserting `#confirm-action`. With the default zero counts those flows still type only the id.
2. Add the C1–C6 groups after the Phase 1 A7 block (after the `analytics.splice(plan31Start)` line at 554), leaving that splice and the final `assert.deepEqual(analytics, [])` untouched. Use the existing `group(id, fn, evidence)`, `lifecycle.reset()`, `lifecyclePage`, `lifecycle`, `harness` and `analytics`. Add small local helpers so each group is readable:
   - `defaultActive = { id: 'default', name: 'default', lifecycle_state: 'active', lifecycle_generation: '3f9a0c1d7e22b4a65c80d1e9f2a7b304' }` and a counts-body builder with `matched` zero and the requested `tenant_total`; do not add `default` to the shared lists.
   - `openDefaultLifecycle(tenantTotal)`: `lifecycle.reset()`; `lifecycle.state.tenants = lifecycle.state.tenants.concat([defaultActive])`; set `lifecycle.state.counts.body`; `await lifecyclePage.goto(harness.lifecycleUrl('default'))`; wait for `#tenants tr[data-tenant-id]` length 4.
   - `openDefaultOp(op)`: click the `Reset tenant` or `Delete tenant` button on the `default` row and wait for `#confirm-dialog`; then `await openDialogReady()` unless the check deliberately holds the count.
   - `phraseLabelText()`: normalise `#phrase-label` text with `.replace(/\s+/g, ' ').trim()`.
3. **C1** counts `{ events: 1418332, rejections: 212, rows: 1418544 }`; delete: assert `#op-scale` exact delete sentence, `#op-effect` equals `Permanently remove this tenant, all its data and keys, and your ownership link. Every key for this tenant stops working, including the key your sync uses.`, and the phrase label is `Type delete all data to confirm`. Cancel; reset: assert `#op-scale` is the same numbers with `Resetting erases all of them and cannot be undone.` and the phrase label is `Type reset all data to confirm`.
4. **C2** hold the count with `lifecycle.state.counts.gate = () => new Promise(done => { release = done; })` (resolve a `firstHeld` signal when the gate is entered so the test never sleeps); open delete; wait for `#op-scale` to start with `Checking`; assert Confirm disabled; release; `openDialogReady()`. Then assert disabled with only the id, disabled with only the phrase, disabled with `delete all dat`, enabled with both exact, disabled again when either box changes, enabled when restored.
5. **C3** counts `{ events: 5, rejections: 0, rows: 5 }`; open delete, Cancel, assert no `DELETE /v1/tenants/default` and no new `state.requests`; reopen, fill id and phrase, Confirm, wait for the `default` row to disappear. Assert exactly one `DELETE /v1/tenants/default`, `content-type` matches `application/json`, `x-yakka-ui` is `tenant-lifecycle`, and `JSON.parse(body)` deep-equals `{ confirm_tenant_id: 'default' }`.
6. **C4** zero counts; open delete; assert `#op-scale` is `This tenant holds no stored records.`, `#phrase-label` is hidden, fill only `default`, assert Confirm enabled.
7. **C5** exercise all three failures, each with a fresh `openDefaultLifecycle`: `state.counts.abort = true`; `state.counts.status = 500`; and a 200 with `tenant_total: { events: 'x', rejections: 0, rows: 0 }`. For each assert `#op-scale` is `The size of this tenant could not be read. Assume it holds data.`, the phrase label is visible, id-only is disabled and both exact enables Confirm.
8. **C6** with the default lifecycle tenants (`t-a`, `t-b` active): set `state.counts.body` to a first large count, set `state.counts.gate = entry => entry.search.includes('tenant=t-a') ? new Promise(done => { releaseFirst = done; }) : undefined` and resolve a `firstHeld` signal when that gate is entered. Open `t-a` reset, wait for `firstHeld`, cancel; change `state.counts.body` to a distinct second count; open `t-b` reset and `openDialogReady()`; assert `#op-scale` is the second text. Register `waitForResponse` for the held `tenant=t-a` counts request, release the first, await that response, then a double `requestAnimationFrame` settle; assert `#op-scale` is still the second text and Confirm is still disabled. No fixed sleeps.

### Keep untouched

- The shared `initialAccountTenants`/`initialLifecycleTenants` lists and every existing row-count assertion; the A1–A7 flows (apart from adding `openDialogReady()` after their dialog opens); the `analytics.splice(plan31Start)` line; the final analytics guard; `/sessions` is not added.
- The lifecycle stub’s `state.requests` semantics: counts requests must not appear there. Do not intercept any other analytics route.
- No product code in this unit. If a check exposes a product gap, report `done with concerns` or `blocked`; do not patch `lifecycle_profile.html` here.
- No animation/timing assertions; wait on DOM state, the gate promise, the response and frame settles, not sleeps.

## Done evidence

Record the current passing baseline with `phase2-01` landed. Then add the counts route and the C1–C6 groups and record the final pass. If you can show a check failing before the stub/groups are complete (for example the existing A6 flows racing on `#confirm-action` while counts load), paste that output; do not manufacture a failure.

- `cd packages/yakka-analytics && mkdir -p ../../.scratch/t && TMPDIR="$PWD/../../.scratch/t" PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs` → passes with the amended header, counts stub, `openDialogReady`, and C1–C6. Paste the group results/evidence lines for C1–C6. No `/tmp`.
- `cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1` → `ok` (C7, owned by `phase2-01`; rerun here as integration evidence, do not claim it as this unit’s close).
- C1–C6 are real-browser checks against the real Go lifecycle template; a stub-only or unit test cannot close them. C7 is the real Go test; neither is closed by a mock harness alone.
- No signed-in production check is attempted. If the Playwright/Chromium path in `tests/charts-time/browser.mjs` or the Go fixture toolchain is unavailable, record `gate: <tool> unavailable on this machine`; do not substitute a stub for C1–C6.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.
