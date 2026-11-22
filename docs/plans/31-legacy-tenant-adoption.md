# Plan 31 — Legacy tenant adoption and a selector that never refuses an unmarked tenant

Plan 31 made an owned tenant with no lifecycle marker a normal, selectable `unmarked` tenant until a startup migration gives it a fresh marker and generation. It removed the UI predicate that refused such tenants, added a stored-record scale line and a second typed phrase to reset/delete, and added the flag-gated, idempotent `AdoptUnmarkedTenants` startup migration with the `unsupported` to `unmarked` rename. All three phase outcomes were met and every acceptance check A1–A9, C1–C7 and B1–B5 passes against the real implementation; the signed-off 22 Nov override kept the Fly environment flag off in this plan.

## Intent

User request, verbatim:

> Cody (22 Nov 2026), verbatim: "Just make it a normal tenant, and stop the ui from refusing to select them if they have no marker"
>
> Cody (22 Nov 2026), decided: the migration should simply mark ALL currently unmarked tenants as normal `active` (fresh marker plus generation). Make it a one-time idempotent migration, with no owner-confirmed adopt action. Drop the alternatives from scope and record his decision in the ledger.
>
> Cody (22 Nov 2026): the UI refuses to select the `default` tenant at all and doesn't understand why.
>
> Scope (fixed; do not reopen alternatives)
>
> 1. One-time idempotent migration, run through a built product mechanism (startup / registry open — pick the exact hook and justify it in the ledger). When the feature flag is on, every currently unmarked tenant that has an owner/name record receives a fresh random marker and generation and `state=active`. Already-marked tenants are unchanged. Re-running is a no-op. There is no owner-confirmed adopt action. Drop every alternative (manual adopt API, per-tenant confirmation, inferring a marker from the id, migrating only `default`) from scope, and record Cody's 22 Nov 2026 decision in the ledger. Update the comments in `registry_lifecycle.go` and the Plan 23 docs to record the changed policy and its date (22 Nov 2026).
> 2. After adoption, reset and delete on `default` (and any other adopted tenant) must keep their normal confirmations (typed immutable id, `X-Yakka-UI: tenant-lifecycle`, human-owner-only). Data safety matters because `default` holds all of Cody's data (11,024 sessions). If the current confirmations are thin, add an explicit extra guard or confirmation copy that names the scale of loss; do not weaken the existing typed-id gate.
> 3. Find every place in the UI and the AI/MCP surface that refuses, greys out, or blocks selecting a tenant whose `lifecycle_state` is `unsupported` or whose marker is missing, and make all of them selectable. Cover any remaining marker-less state defensively (flag off, or a tenant that has not yet been migrated): the UI must never refuse to select that tenant. Do not wait for the migration alone to fix selection.
> 4. Fix the copy and the AI wording so they stop calling the tenant "unsupported". Decide whether the `/v1/me` `lifecycle_state` value changes, and record it as a contract decision in the ledger. After a successful migration the adopted tenants should report as normal `active` with a generation. Recommend: the UI selection fix is unconditional (not flag-gated) so a marker-less tenant remains selectable; the feature flag gates the server migration that writes markers. Confirm or replace this split in the ledger.
> 5. Gate the migration (and any server contract change you flag-gate) behind a feature flag. Discover any existing Yakka flag pattern and use it; if none exists, specify a single named flag, default, how it is set on Fly, and tests for on/off/idempotent behaviour. Yakka UI follows Cody's dense, old-school style (full width, left-aligned, no decorative chips, no centre alignment, no white chart backgrounds).
>
> Out of scope: building or merging the implementation; production registry edits by hand, fly ssh, or any non-product mechanism; printing secrets; reopening Plan 30 as a new design (this is Plan 31, amending the live Plan 30 chrome and the Plan 23 lifecycle policy).

## Why This Existed

Plan 23's follow-up gave a lifecycle record only to tenants created after it and ruled that older tenants with an owner/name entry must not be migrated or given an inferred marker. Plan 30 then treated only `lifecycle_state === 'active'` as selectable, so Cody's `default` tenant — which holds his whole ledger and has no marker — could not be selected anywhere in the shell. The server never refused it: analytics reads, MCP tools and token minting already worked. The refusal was a client predicate plus the policy label `unsupported`.

## What Was Built

**Changed:** the analytics session gate and shell (`session-gate.js`, `app.js`), the account console (`account-console.js`), the API-origin lifecycle page (`lifecycle_profile.html`), the Go serve registry and lifecycle paths (`registry_lifecycle.go`, `registry.go`, `session.go`, `serve.go`, `review_cursor.go`, `device_grants.go`, `tenant_lifecycle.go`), the Plan 23 record, design docs 03, 07 and 09, and the Go and Chromium acceptance tests.

The durable contracts now live in [design 03](../design/03-remote-service.md), [design 07](../design/07-analytics-site.md) and [design 09](../design/09-analytics-workspace-contracts.md). Design 07 also records the lifecycle dialog's scale line and second phrase.

### Phase 1 — An unmarked tenant is selectable everywhere in the UI

Selectability became a deny-list of `resetting` and `deleting`; every other value, including a missing marker, `unmarked`, the old `unsupported` and unknown values, is selectable. The shell and lifecycle page select `default`, show it without an "unavailable" message, and suffix and disable only mid-cleanup tenants. The account console shows `Active` and `—` for it, enables Use tenant, and offers token creation. A1–A9 pass: the unit precedence test, real Chromium A2–A7, the Go lifecycle profile test (A8), and the no-active-only-predicate grep (A9).

### Phase 2 — Reset and delete name the scale of loss and need a second phrase

The lifecycle dialog reads `GET /v1/analytics/event-counts?tenant=<id>` and prints the stored-record scale, then requires a second exact typed phrase (`reset all data` or `delete all data`) whenever the tenant holds records or its size is unknown. An empty tenant asks only for the id. The existing owner cookie, Origin, `X-Yakka-UI: tenant-lifecycle`, `{confirm_tenant_id}` body and typed-id gate are unchanged. C1–C7 pass in real Chromium and Go, including loading, empty, unreadable, stale-result and request-contract cases.

### Phase 3 — The server adopts every unmarked tenant once, behind a flag

`Registry.AdoptUnmarkedTenants` gives every owned tenant with no marker a fresh random marker and generation and `active`, saves once, restores memory on a save error, and is idempotent. `serve.New` calls it immediately after `OpenRegistry` when `YAKKA_ADOPT_UNMARKED_TENANTS` is truthy; `ConfigFromEnv` parses `1`, `true`, `yes` and `on`, default off. `/v1/me` now reports `unmarked` instead of `unsupported`, and adopted tenants report `active` with a generation. Plan 23 and the design docs carry the dated 22 Nov 2026 policy amendment. B1–B5 pass; the Fly flag line was deliberately not added under the signed-off override.

## Deviations

- The signed-off 22 Nov override skipped the `fly.toml` flag line and its comment. The code flag, docs and tests are complete and the flag default is off; `fly.toml` is unchanged.
- The lifecycle confirm dialog keeps the existing 600px left-anchored modal, and `#op-scale` follows `#op-effect` as the written spec requires. The mockup draws the dialog inline with the scale above the effect; the text wins.
- Browser acceptance result groups added by Plan 31 are prefixed `P1-A2`–`P1-A7` and `P2-C1`–`P2-C6` so they do not overwrite the Plan 30 `A2`–`A6` and `C1` evidence. The DESIGN acceptance ids remain A1–A9 and C1–C7.
- The Phase 1 browser test splices out only the intentional `/b/pulse` reads so the pre-existing final "account routes performed no analytics read" guard keeps its meaning.
- The C6 stale-result check uses a harness-only count gate; it is test scaffolding, not a product contract.
- Three Phase 3 test-ordering choices (all-active assertion before the reset flip, flag-off byte compare immediately after `New`, and the B4 token-bearing fixture) preserve every asserted contract and weaken none.

## Review

Each phase had an independent review: Phase 1 PASS, Phase 2 PASS with one LOW visual finding (the scale line was muted instead of danger-coloured, issue #333, fixed in `303760cc`), Phase 3 PASS with no findings. The terminal review covered all three outcomes and every A, C and B id, re-ran the unit, Chromium, targeted Go and full Go suites, re-checked both required greps, and compared the three screens with their mockups. It found one LOW evidence-reporting issue — the Phase 1 groups overwrote Plan 30 `A2`–`A6` results — filed as #334 and fixed by prefixing the Plan 31 groups. No CRITICAL or HIGH finding stands.

## QA

Rerun at the terminal review with `PUBLIC_CANVAS_TEST_MODE=true`, an 8 GB heap cap and `TMPDIR` under the gitignored `.scratch/`:

- `node --test tests/operable-chrome/scope-unit.test.mjs`: 7/7 pass.
- `node --test tests/operable-chrome/phase3-acceptance.test.mjs`: 1/1 test, `failures: []`; Plan 31 `P1-A2`–`P1-A7` and `P2-C1`–`P2-C6` pass, and the Plan 30 `A1`–`A6`, `C1`, `C10`, `F7`, `S-*` and `V1`–`V5` results still pass.
- `go test ./internal/serve -count=1` (GOMAXPROCS=3): pass in 310.741s. An earlier run hit the pre-existing load-sensitive `TestAnalyticsPageSetSmoke` one-second `query_timeout`; the isolated rerun and full suite then passed, and no Plan 31 code was implicated.
- Targeted Go tests for adoption, the flag, start idempotence, unmarked reporting and adopted-tenant confirmations: pass. `go vet ./...` clean; `gofmt -l` clean; `git diff --check` clean.
- A9 grep over the analytics web and lifecycle page, and the B2 grep over the four Go files and three design docs: both empty.
- Real Chromium screenshots of the shell selector, the profile tenant table and the lifecycle delete dialog match the mockups on layout, copy and enabled/disabled state within the written-spec differences above.

## Residual Risks

- `YAKKA_ADOPT_UNMARKED_TENANTS` remains unset in `fly.toml`, so production tenants stay `unmarked` until a later change enables migration. The Phase 1 UI already makes them selectable; adoption is not live.
- No signed-in production check, live registry read, deploy or process-level double start was performed. B4 proves idempotence by calling the production `New` hook twice over one fixture.
- Adoption cannot be undone (Assumption 12). A client holding a review cursor from before adoption loses one walk to `cursor generation mismatch` and restarts.
- Mockup counts and tenant data are synthetic; Cody's exact live session count was not re-read.
- Screenshot comparisons are top-of-page references at 1440×900, not pixel-diff goldens; the written contracts and DOM assertions are authoritative.

## Follow-ups

- Enable `YAKKA_ADOPT_UNMARKED_TENANTS` in `fly.toml` (and add the dated comment) in a later change, now that the Phase 2 guard has shipped. This plan recorded `gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped`; the flag row is documented in [design 03](../design/03-remote-service.md).
- #333 (scale-line colour) fixed in `303760cc`; #334 (Phase 1 result-id collision) fixed in the terminal review touch-up. Both remain open for tracker hygiene.
- The pre-existing `TestAnalyticsPageSetSmoke` load sensitivity is unrelated to Plan 31 and was not changed.

## Decisions Worth Keeping

- Selectability is a deny-list of exactly `resetting` and `deleting`; a missing or unknown lifecycle value never refuses a tenant.
- The UI fix is unconditional; the flag gates only the server write.
- The marker-less `/v1/me` value is `unmarked`; `unsupported` is retired, while the `legacy_tenant_cleanup_unsupported` wire error keeps its name.
- Every existing server-side reset/delete gate stays; the scale line and second phrase are UI-only speed bumps.
- An owned tenant with no marker is a normal tenant adopted once at startup, not legacy data to be guessed at.
