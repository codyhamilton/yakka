# Implementation: Plan 31 — Legacy tenant adoption

## Run

- Tool: opencode (deepseek-v4.1-flash build orchestrator; hlaunch build-tier sub-runs)
- Session: Plan 31 build queue run `31-p1` (refine log `/home/codyh/workspace/.briefs/yakka/logs/31-p1-refine.log`)
- Start: 2026-11-22T15:52:00+10:00
- Branch: feat/31-legacy-tenant-adoption (from master at 1f253940)
- Invocation: Phase 1 only, then stop. No phase review, terminal review or close-out.

## Phase 1 — An unmarked tenant is selectable everywhere in the UI

Status: closed, 2026-11-22 (closing commit carries `Yakka-Phase: 31-legacy-tenant-adoption:1`).

Refine verdict: PROCEED, three units. Briefs in `briefs/`, Units list under Phase 1 in `DESIGN.md`, committed at `d2088fb9`.

Units:

1. `phase1-01-lifecycle-page-selection` — landed `214a3b5b`. Worker report `reports/phase1-01-lifecycle-page-selection.md`. Built the deny-list `tenantSelectable`/`selectableTenants`, cleanup-only option suffix/disable, selectable URL tenant, `not assigned yet`, the exact unmarked note, and the new `legacy_tenant_cleanup_unsupported` copy in `lifecycle_profile.html`; renamed the Go contract string in `lifecycle_profile_phase3_test.go`. Deviation: none. Closes A8.
2. `phase1-02-web-ui-selection` — landed `b77ce082`. Worker report `reports/phase1-02-web-ui-selection.md`. Built `CLEANUP_STATES`/`tenantCleanupState`/`tenantSelectable`/`selectableTenants`, the cleanup-specific shell copy, the account-console Active/`—` and disabled-Use rules, the token-line copy, and the A1 unit fixture/assertions. Deviation: none. Closes A1.
3. `phase1-03-browser-acceptance` — landed `ab5f55d1`. Worker report `reports/phase1-03-browser-acceptance.md`. Renamed the shared `pending` fixtures to `resetting`, updated the C1 tuples/row assertion, and added real-browser A2–A7 to `phase3-acceptance.test.mjs`. Deviation: the existing final account-route guard (`analytics` empty) is preserved by splicing only A2–A4's intentional `/b/pulse` reads after the A2–A7 section; recorded in the report as a test-harness accommodation, not a product change. Closes A2–A7 and A9.

Gofmt realignment of `lifecycle_profile_phase3_test.go` (the longer map key changed the alignment) folded into the closing commit.

### Verification (Phase 1)

Phase outcome, verified against the real implementation:

- Entry point: the analytics shell at `/b/pulse` (also `/profile`, `/sessions`) and the API-origin `/profile/lifecycle`. Action: owner `/v1/me` lists `default` with `lifecycle_state` `unsupported`/`unmarked`/absent and `lifecycle_generation: null`, alone or beside other tenants. Result: `default · default` is enabled, chosen by URL `?tenant=default`, remembered selection, Use tenant and the select; no `.tenant-unavailable`; the token form targets it; only `resetting`/`deleting` is greyed; no server change and the flag stays off.
- Real browser: `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs` → `ok 1`, pass 1, fail 0; `results.json` failures `[]`, A2–A7 all `pass`.
- Real Go: `cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1` → ok; full `go test ./internal/serve -count=1` → ok (266 s). `gofmt -l` clean.
- Unit: `node --test tests/operable-chrome/scope-unit.test.mjs` → 7/7 pass. Account regression `tests/identity/browser.test.mjs` → 18/18 pass.

Per-check status:

| ID | Result | Evidence |
| --- | --- | --- |
| A1 | pass | `scope-unit.test.mjs` 7/7: unsupported/unmarked/absent URL tenants resolve `{source:'url'}`, `tenant-c` gives `{reason:'cleanup'}`, foreign keeps shape, `selectableTenants` order `[a,b,u,m,x]`, `ME_ONLY` first and remembered. |
| A2 | pass | Real browser: single-tenant `default` (`unsupported`, null gen) selected, enabled, `default · default`, URL gains `tenant=default`, `.tenant-unavailable` 0, every analytics read carries `tenant=default`. |
| A3 | pass | Real browser: same with `unmarked` and with the `lifecycle_state` key absent. |
| A4 | pass | Real browser: remembered `default`, deep-linked `?tenant=default`, then select `t-new` then `default`; URL follows each change. |
| A5 | pass | Real browser: `tenant-p` option disabled `Resetting · tenant-p · resetting`; cleanup copy and foreign copy exact. |
| A6 | pass | Real browser `/profile`: `default` row `Active`/`—`, Use tenant enabled and stores `default`, token line `Selected tenant: default · default`, create-token enabled, resetting Use disabled, none-selectable shows `Choose a tenant to issue a token.` |
| A7 | pass | Real browser lifecycle page: `default` selected, `unsupported`/`unmarked`, generation `not assigned yet`, exact note, no Reset/Delete, foreign `?tenant=` still shows the selection note. |
| A8 | pass | `go test ./internal/serve -run LifecycleProfile -count=1` ok with `option.disabled = !tenantSelectable(tenant)` and the renamed key. |
| A9 | pass | The exact grep over `packages/yakka-analytics/web` and `lifecycle_profile.html` returns no tenant-selection hit (exit 1); the only `"active"` comparison is the Reset/Delete row branch. |

### Screens and mockup comparison

Captured with the real app on the Plan 30 Go fixture, 1440×900 dark theme, under the gitignored `.scratch/31-p1/`:

- `tenant-selector.png` vs `mockups/tenant-selector.png`: identity/nav bands, brand/Theme order, `default · default` enabled and selected, `Old build · t-81c3e2d9a0b4 · resetting` disabled (DOM-verified; a native select cannot be drawn open in a screenshot, so the mockup's open list is represented by the closed select plus the disabled option). Page body differs only because the fixture has no `default` data (A2 explicitly does not assert analytics bodies). Written spec wins.
- `profile-tenants.png` vs `mockups/profile-tenants.png`: same table columns/order, `default` Active with generation `—` and Use tenant enabled, Scratch Active with a generation, Old build Resetting with Use tenant disabled, token line `Selected tenant: default · default`. The real page additionally renders the token form/table; the mockup is a partial reference.
- `/sessions?tenant=default` probed additionally (same shell): select value `default`, enabled, one option `default · default`, `.tenant-unavailable` 0, URL preserved.

### artifact_feedback

Called on all three reports and all three briefs. All six: state `delivered`, screen `pass` by jev-1.13.0 (scoring off on the service).

### Phase 1 — Carried

1. The Plan 30 acceptance test's final "account routes performed no analytics read" guard is kept by splicing only the intentional A2–A4 `/b/pulse` reads; Phase 2/3 refinements should not treat that splice as a product invariant.
2. The browser tests need a short `TMPDIR` (Chromium `SingletonSocket` limit); `.scratch/t` under the worktree works. Not a code problem.
3. `/sessions` was probed separately rather than added to the shared acceptance test; it uses the same shell contract and is covered structurally.

## Phase 2 — Reset and delete name the scale of loss and need a second phrase

Status: closed, 2026-11-22 (closing commit carries `Yakka-Phase: 31-legacy-tenant-adoption:2`).

Run: `31-p2` (build orchestrator; refine log `/home/codyh/workspace/.briefs/yakka/logs/31-p2-refine.log`).

Refine verdict: PROCEED, two units. Briefs in `briefs/`, Units list under Phase 2 in `DESIGN.md`, committed at `1ca363cf`. Unit 01 and 02 own disjoint paths but run in sequence because C1–C6 need 01's product code.

Units:

1. `phase2-01-lifecycle-dialog-guard` — landed `b616cb93`. Worker report `reports/phase2-01-lifecycle-dialog-guard.md`. New `RESET_EFFECT`/`DELETE_EFFECT` copy and `PHRASES`; `dialog [hidden]{display:none}`; `#op-scale` after `#op-effect`; `#phrase-label`/`#phrase-text`/`#typed-phrase`; `openConfirm` loading state and `loadScale`; `paintScale`; `updateConfirm` on both inputs; `submitConfirmed` phrase re-check; `close` listener drops `state.pending`. Request URL/method/headers/body unchanged. Both Go contract tests updated. Deviation: none; the mockup's scale-above-effect order and mockup-only danger/bold styling were not copied (DESIGN 2.1(2) is explicit). Closes C7.
2. `phase2-02-browser-acceptance` — landed `3dc18983`. Worker report `reports/phase2-02-browser-acceptance.md`. `installLifecycleStub` gains `countRequests`/`counts` and a second route for `GET /v1/analytics/event-counts` (snapshot before an optional harness-only `gate`); `openDialogReady()` added after the four existing A6 dialog opens; real-browser C1–C6 groups added after the Phase 1 `analytics.splice(plan31Start)` line. Deviations: results group ids are `P2-C1`…`P2-C6` so the later Plan 30 `C1` groups cannot overwrite the Phase 2 evidence; `TMPDIR` is the canonical `.scratch/t` (the `../..` path is too long for Chromium). Closes C1–C6.

### Verification (Phase 2)

Phase outcome, verified against the real implementation at `/profile/lifecycle`:

- Dialog for a tenant holding records: `op-scale` reads `This tenant holds 1,418,544 stored records (1,418,332 events, 212 rejected). Deleting erases all of them and cannot be undone.` (reset uses `Resetting`), `op-effect` is the 2.1(1) string, the phrase label reads `Type delete all data to confirm` / `Type reset all data to confirm`, Confirm is disabled until both the immutable id and phrase match exactly. Empty counts show `This tenant holds no stored records.` with the phrase box hidden; an unreadable count shows `The size of this tenant could not be read. Assume it holds data.` and requires the phrase. The request is still one `DELETE /v1/tenants/default` with `Content-Type: application/json`, `X-Yakka-UI: tenant-lifecycle` and `{"confirm_tenant_id":"default"}`.
- Real Go (C7): `cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1` → `ok … 0.009s`; `gofmt -l` on both changed Go test files → empty.
- Real Chromium (C1–C6): `cd packages/yakka-analytics && TMPDIR=/home/codyh/workspace/yakka-build/31/.scratch/t PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs` → `ok 1`, pass 1, fail 0; `results.json` failures `[]` with `P2-C1`…`P2-C6`, `A6`, `A7` and Plan 30 `C1` all `pass`.

Per-check status:

| ID | Result | Evidence |
| --- | --- | --- |
| C1 | pass | Real Chromium `P2-C1`: delete scale sentence, delete effect string and `Type delete all data to confirm`; reset shows `Resetting erases all of them and cannot be undone.` and `reset all data`. |
| C2 | pass | Real Chromium `P2-C2`: disabled while counts load, id-only, phrase-only and phrase one character wrong; enabled only when both match; changing either disables again. |
| C3 | pass | Real Chromium `P2-C3`: Cancel sends no destructive request; Confirm sends exactly one `DELETE /v1/tenants/default` with the JSON content type, `X-Yakka-UI: tenant-lifecycle` and `{"confirm_tenant_id":"default"}`. |
| C4 | pass | Real Chromium `P2-C4`: zero counts → `This tenant holds no stored records.`, phrase label hidden, id-only enables Confirm. |
| C5 | pass | Real Chromium `P2-C5`: network abort, 500 and non-numeric body each → `The size of this tenant could not be read. Assume it holds data.` and the phrase is required. |
| C6 | pass | Real Chromium `P2-C6`: a cancelled dialog's late count result does not change the next dialog (held first count, stale-result guard). |
| C7 | pass | Real Go: `go test ./internal/serve -run LifecycleProfile -count=1` ok with the updated copy constants and required substrings; `setTimeout` absent. |

### Screens and mockup comparison

Captured with the real app (Plan 30 Go lifecycle fixture + lifecycle stub, 1440×900) under the gitignored `.scratch/31-p2/`:

- `lifecycle-confirm.png` vs `mockups/lifecycle-confirm.png`: MATCH on dialog title `Delete tenant`, `Display name: default`, `Immutable id: default`, the exact scale sentence with `1,418,544` / `1,418,332` / `212`, the 2.1(1) delete effect copy, the bold human-owner line, the typed-id label/input, `Type delete all data to confirm` with its input and the disabled Confirm. Differences all follow the written spec, which wins: the real dialog is the existing modal anchored at left 12px and 600px wide (the mockup draws it inline below the table); `#op-scale` follows `#op-effect` per DESIGN 2.1(2) (the mockup draws scale first); and the scale line uses the explicit `.effect` styling (the mockup's danger/bold `.scale` class is mockup-only and was not copied). Reset light capture confirms `Resetting erases all of them and cannot be undone.` and `reset all data`.

### artifact_feedback

Called on both Phase 2 reports and both briefs: all four `delivered`, screen `pass` by jev-1.13.0 (scoring off on the service).

### Phase 2 — Carried

1. Results group ids are `P2-C1`…`P2-C6` in `results.json`; they assert DESIGN C1–C6 exactly. The `P2-` prefix is only to avoid the later Plan 30 `C1` groups overwriting the evidence.
2. The C6 stale-result check adds a harness-only `state.counts.gate` hook (snapshot status/body/abort before the gate). It is test scaffolding, not a product contract.
3. The real dialog is a left-anchored 600px modal; the mockup renders the dialog inline. Future refinements should keep the existing modal and treat the inline rendering as a mockup-only choice.

## Gates

- gate: signed-in production check of Cody's live `default` tenant in the deployed shell is not automatable (Yakka has no automated sign-in); Phases 1 and 2 are proven against fixtures only.
- gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped (standing override, 22 Nov); Phases 1 and 2 touch no flag.
