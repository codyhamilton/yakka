# Brief: phase2-01 — Lifecycle dialog names the scale of loss and needs a second phrase

Consumer: the build worker that implements this unit.
Owned paths: `packages/yakka/internal/serve/lifecycle_profile.html`, `packages/yakka/internal/serve/lifecycle_profile_test.go`, `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase2-01-lifecycle-dialog-guard.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: nothing. `phase2-02` owns disjoint paths but depends on this unit's product code for its real-browser evidence, so it runs after this unit.
Budget: 6 files to read, about 120 changed lines, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 2 specification” 2.1, 2.2 and 2.3 (C7); the Phase 2 outcome under “Phases”; Assumption Ledger 10, 14, 16 and 17. Binding: the exact copy, element ids, logic and test strings.
2. `packages/yakka/internal/serve/lifecycle_profile.html` — the constants at 147–155, the `<style>` block around 92–100, the dialog markup 135–143, and the script from `openConfirm` through `submitConfirmed` (317–367).
3. `packages/yakka/internal/serve/lifecycle_profile_test.go` — the copy constants at 10–14 and `TestLifecycleProfileScriptContract` at 110–139.
4. `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go` — the two contract maps at 48–92 and 102–125, and the trailing `setTimeout` check at 150–159.
5. `docs/plans/31-legacy-tenant-adoption/mockups/lifecycle-confirm.png` and `mockups/src/lifecycle-confirm.html` — the dialog drawn open (synthetic data). Match its structure, copy, left alignment and full-width box. Where the mockup and DESIGN.md differ, DESIGN.md is authoritative: 2.1(2) inserts `#op-scale` after `#op-effect` and adds no scale-colour rule, so the mockup’s scale-above-effect order and mockup-only danger/bold styling are not copied.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (carried from the run instructions; apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 2 spec (sections 2.1–2.3) and acceptance check IDs C1–C7. Do not reopen any decision in the Assumption Ledger; no invented scope, no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- Do not set `YAKKA_ADOPT_UNMARKED_TENANTS` true in `fly.toml` in this plan (standing override, 22 Nov); Phase 3 handles the flag with the code default off. This unit touches no server flag.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in unit or browser tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8G memory cap, `vitest --maxWorkers=3`, Playwright/Chromium with `PUBLIC_CANVAS_TEST_MODE=true`, no animation/timing tests, no `/tmp` (use a gitignored directory under the worktree for screenshots and temp registry copies). This Go package has no vitest runner; use the design’s `go test` command below. The vitest clause applies only where a vitest runner exists.
- Signed-in production checks are not automatable: do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as a line `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.

## Goal

Make every reset/delete dialog on the API-origin lifecycle page name how much data the tenant holds and require a second exact typed phrase (`reset all data` / `delete all data`) whenever the tenant holds records or its size could not be read, so deleting Cody’s large `default` tenant cannot happen from a single familiar word. The existing typed-id gate, the request shape and every server gate stay unchanged. This unit closes C7; C1–C6 are real-browser checks owned by `phase2-01`’s sibling `phase2-02`.

## Contract

Cited from DESIGN.md §2.1–2.3; settled and not to be re-derived:

- `RESET_EFFECT` becomes exactly `Erase all tenant data and revoke its keys, including the key your sync uses. Keep this tenant and your ownership; issue a new key to reuse it.` `DELETE_EFFECT` becomes exactly `Permanently remove this tenant, all its data and keys, and your ownership link. Every key for this tenant stops working, including the key your sync uses.` Add `const PHRASES = { reset: "reset all data", delete: "delete all data" };`.
- The scale line comes from the existing `GET /v1/analytics/event-counts?tenant=<id>` (`tenant_total.events`, `.rejections`, `.rows`) with `credentials: "include"`, `Accept: application/json` and `AbortSignal.timeout(15000)`. No `setTimeout` (the page contract forbids it) and no new endpoint.
- `paintScale` copy is exact: `ok` → `This tenant holds {rows} stored records ({events} events, {rejections} rejected). {Resetting|Deleting} erases all of them and cannot be undone.`; `empty` → `This tenant holds no stored records.`; `unknown` → `The size of this tenant could not be read. Assume it holds data.` Numbers use `toLocaleString("en-US")`. The phrase box is shown for `ok` and `unknown`, hidden for `empty`.
- Confirm is enabled only when `state.pending` exists, `pending.scale.status !== "loading"`, `typed-id` equals the immutable id exactly, and (for `ok`/`unknown`) `typed-phrase` equals `PHRASES[pending.op]` exactly, and the page is not busy or recovery-failed. Matching is exact and case-sensitive with no trimming.
- `submitConfirmed` re-checks both fields and returns without closing on failure. The request is unchanged: same URL/method/headers/body `{ confirm_tenant_id }`, `X-Yakka-UI: tenant-lifecycle`.
- The dialog stays `width:min(600px,calc(100vw - 24px))` and left-anchored. Cancel and Esc both drop `state.pending`; a late scale result is dropped by the `state.pending !== pending` guard.

## Changes

Line numbers are as of this branch after Phase 1 landed; search the named strings because your edits shift them.

### `packages/yakka/internal/serve/lifecycle_profile.html`

1. Constants (currently 148–149): replace with the exact §2.1(1) `RESET_EFFECT` and `DELETE_EFFECT` strings and add `PHRASES` exactly as quoted in Contract.
2. Style: add `dialog [hidden]{display:none}` directly after `dialog label{display:block;…}` (currently line 97). Do not change the 600px dialog width or add any other rule.
3. Dialog markup: insert `<p id="op-scale" class="effect" data-testid="op-scale"></p>` immediately after `<p id="op-effect" class="effect"></p>`; insert `<label id="phrase-label" hidden>Type <code id="phrase-text"></code> to confirm <input id="typed-phrase" data-testid="typed-phrase" autocomplete="off" spellcheck="false"></label>` immediately after the typed-id `<label>`. Keep every other dialog element in place.
4. `openConfirm`: after setting `op-effect`, set `byId("op-scale").textContent = "Checking how much data this tenant holds…"`; set `state.pending.scale = { status: "loading" }`; clear `typed-id` and `typed-phrase`; hide `phrase-label`; keep Confirm disabled; call `showModal()`; then call `loadScale(state.pending)`.
5. Add `loadScale(pending)` exactly as DESIGN §2.1(4) prints it, including the 15-second `AbortSignal.timeout(15000)`, the `tenant_total` finite-number check and the `if (state.pending !== pending) return;` stale-result guard.
6. Add `paintScale(pending)` implementing the exact Contract copy. Set `phrase-text` to `PHRASES[pending.op]` and toggle `phrase-label.hidden` as specified (`false` for `ok`/`unknown`, `true` for `empty`).
7. Replace the body of the `typed-id` `input` handler with `updateConfirm()` and register the same `updateConfirm` on the `typed-phrase` `input` event. `updateConfirm` implements the exact enable rule in Contract and is also called by `loadScale`.
8. `submitConfirmed`: keep the existing typed-id re-check and add the phrase re-check for `ok`/`unknown` before `state.pending = null` / `dialog.close()`. Everything else (lines after that: URL, method, headers, body, 204 handling) is unchanged.
9. Cancel keeps `state.pending = null`; add `byId("confirm-dialog").addEventListener("close", function () { state.pending = null; });` so Esc does the same.

### `packages/yakka/internal/serve/lifecycle_profile_test.go`

Update `lifecycleProfileResetCopy` and `lifecycleProfileDeleteCopy` (lines 12–13) to the new §2.1(1) strings. Keep the test structure and `lifecycleProfileHumanCopy` unchanged.

### `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go`

Extend the first contract map (currently 48–92) with the required substrings from DESIGN §2.2: `op-scale`, `typed-phrase`, `phrase-label`, `PHRASES`, `loadScale`, `/v1/analytics/event-counts?tenant=`, `AbortSignal.timeout`, `Checking how much data this tenant holds…`, `This tenant holds no stored records.`, `The size of this tenant could not be read. Assume it holds data.`, `reset all data`, `delete all data`. The page must still contain `confirm_tenant_id`, `X-Yakka-UI` and `tenant-lifecycle` (already in the second map) and must not contain `setTimeout` (already checked at 150–159); keep those checks and do not weaken them.

### Keep untouched

- `HUMAN`, the human-owner sentence, the typed-id input, the exact request URL/method/headers/body `{ confirm_tenant_id }`, the 204/ambiguous/reported-failure handling, and every server-side gate (`tenant_lifecycle_http.go` is not touched).
- The tenant selector, row rendering, unmarked note, refusal behaviour, invalidation channel, theme and `history.replaceState` from Phase 1.
- The no-`setTimeout` constraint and the `AbortSignal.timeout` approach.
- No telemetry/analytics change: the Plan 30 acceptance test’s final “account routes performed no analytics read” guard is preserved by a test-harness splice of A2–A4’s intentional `/b/pulse` reads; that splice is not a product invariant and is outside this unit.

## Done evidence

Identify the failing check before changing production code: update the two Go test files first (copy constants and required substrings), run the command, and record the failure against the unchanged page; then change the page and record the pass.

- `cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1` → before the page change, fails on the old copy/missing substrings; after, `ok`. This is C7, a real Go test: a stub, grep or JS-only check cannot close it.
- `grep -cF 'Permanently remove this tenant, all its data and keys, and your ownership link. Every key for this tenant stops working, including the key your sync uses.' packages/yakka/internal/serve/lifecycle_profile.html` → `1`.
- `grep -cF 'dialog [hidden]{display:none}' packages/yakka/internal/serve/lifecycle_profile.html` → `1`.
- `grep -cF 'AbortSignal.timeout(15000)' packages/yakka/internal/serve/lifecycle_profile.html` → `1`.
- `grep -n 'setTimeout' packages/yakka/internal/serve/lifecycle_profile.html` → no output.
- C1–C6 are real-browser checks owned by `phase2-02`; this unit only writes the markup and copy they exercise. Do not claim C1–C6 closed.
- `gate: C1–C6 real-browser dialog checks are closed by phase2-02`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.
