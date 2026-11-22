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

## Gates

- gate: signed-in production check of Cody's live `default` tenant in the deployed shell is not automatable (Yakka has no automated sign-in); Phase 1 is proven against fixtures only.
- gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped (standing override, 22 Nov); Phase 1 touches no flag.
