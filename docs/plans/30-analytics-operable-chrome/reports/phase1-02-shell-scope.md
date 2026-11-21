# Handoff — phase1-02 shared shell, reserved tenant scope and truthful count strip

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- `index.html` now has the V1/V5 shell: 46px identity row (brand, 260px tenant select, Theme), two 32px nav rows in the exact V5 order and hrefs, then the unchanged footer. `scope-controls.css` loads after `workspace.css`.
- `contract/url-state.js`: `tenant` is a reserved field, decoded and encoded canonically, never a filter or unknown key.
- `contract/session-gate.js`: `activeTenants` and `authorizedTenant` implement URL → remembered → first-active precedence, and return `{tenant, unavailable, source}`. A foreign/deleted/pending URL tenant is a strict refusal. `rememberedTenant`/`formTenant` are unchanged.
- `contract/transport.js`: `invalidateTenant()` clears the schema cache. `core/request-scheduler.js`: `supersedeAll()` aborts in-flight and queued work.
- `core/read-context.js`: accepts the authorized tenant plus generation; still freezes absolute `from`/`to`, `all=1` plus frozen `to`, never sends `win`, and callers with no `/me` keep the Plan 29 behaviour.
- New `core/scope-controls.js`: C1–C11 native controls, local draft until Apply, exact “Unapplied changes”, custom From/To with IANA conversion and DST refusal, Reset/All history/Refresh, Advanced scope exact-key removal, facet loading/failure/empty states, panel-override promotion/conflict helpers.
- New `core/event-counts.js`: `createEventCountStrip` and `currentEventCounts()`; exact loading/success/error/legacy text, server-matched and tenant totals, local checked time, prior snapshot discarded per generation, Retry repeats committed scope.
- `core/chips.js`: C11 advanced rows, exact single-key removal, C7 reset. `app.js`: header tenant control and immediate tenant commit, canonical `replaceState`, single-push scope edits, unavailable/no-tenant views, V5 active marking, tenant-change teardown/navigation rules, panel-override promotion/conflict blocking, count strip on every analytics route, Follow destroyed on teardown, focus/pageshow `/me` revalidation.
- CSS: V1/V2 dimensions, full-width main/12px gutters, 30px rows, 8px panel padding/gap, 28px control minimums, new scope-controls layout.
- New unit tests `tests/operable-chrome/{scope-unit,event-counts-unit}.test.mjs`.

## Evidence before and after

Failing check first: `tests/operable-chrome/scope-unit.test.mjs` did not exist; `authorizedTenant`, `supersedeAll`, tenant codec and the strip classifier were absent, so the new suite failed to import/assert.

After:

```
node --test tests/operable-chrome/scope-unit.test.mjs tests/operable-chrome/event-counts-unit.test.mjs tests/url-state.test.mjs tests/request-scheduler.test.mjs
→ 19 pass, 0 fail
node --test --test-concurrency=1 tests/plan29/read-context.test.mjs tests/plan29/harness.test.mjs
→ 2 pass, 0 fail
node --test tests/workspace/deep-links.test.mjs tests/workspace/start.test.mjs tests/workspace/ledger.test.mjs
→ 17 pass, 0 fail
```

Chromium 1440×900, scale 1, `PUBLIC_CANVAS_TEST_MODE=true`, real Plan 29 Go fixture: identity 46px, both nav rows 32px, heading 32px, filter row 44px, count line 32px; `main.left=0`, region `left=12 right=1428 width=1416`, `scrollWidth=1440`; nav order and hrefs exactly V5; tenant B selection made 6 requests, all tenant B, none tenant A. Screenshots: `.scratch/plan30-chrome/screens/{start,pulse,ledger,trends}.png`, compared with `mockups/{start,pulse,ledger}.png` (same band order, tenant/theme placement, filter/count widths, 30px ledger rows; production chart minimum stays 160px, not the mockup's 112px).

Acceptance IDs evidenced here: S1, N1 (shell/strip half), C1–C11, V1–V5, T base (rows/alignment/units), S-start/S-pulse/S-ledger chrome. F/P/A/G/T1–T5 panel-state items are phase 2 and were not built.

## Departures and known problems

- The brief says remove `renderScopeBar`; the committed `.scope-bar` summary is retained because the unchanged done-evidence tests (`deep-links`, `start`) assert its text. It is text only, has no removable chips, and does not replace the C controls.
- Facets are requested only when `/schema` advertises a Plan 30 capability (`event_counts`, `record_filters` or `facets`). `/schema` has no facets flag and the legacy workspace stub has no facets route; requesting it would add a 404 console error to existing specs. On a Plan 30 server (as the real harness now is) facets load; otherwise repo/kind keep URL values and All options.
- Top-nav hrefs stay exactly V5 instead of carrying the committed query, because done evidence requires exact hrefs. Tenant survives via `tenant` canonicalization and remembered storage.
- A new-data notification does not drive a refresh; Refresh does. Follow still owns probe semantics and is destroyed on teardown/tenant change.
- Known test-harness problem outside owned paths: running both `tests/plan29/*.test.mjs` files with default parallel test-file concurrency makes one harness claim and delete the peer's `.scratch/plan29-harness` data root, so the artifact baseline times out. Serial (`--test-concurrency=1`) passes; this is a `tests/plan29/harness.mjs` race, not product behaviour.

## Unfinished work

None in this unit. Phase 2 owns captions, panel/explorer scope refusals, Pulse/Ledger denominators and T1–T5 panel states; phase 3 owns the account console.
