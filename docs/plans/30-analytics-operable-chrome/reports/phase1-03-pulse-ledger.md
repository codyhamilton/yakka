# Handoff — phase1-03 Pulse/Ledger honest denominators, observations and T1–T4

Status: done. Branch `feat/30-analytics-operable-chrome`. Working tree before commit: six owned source/CSS files modified plus two new owned tests.

## What changed

- `panels/ledger-table.js`: added `LEDGER_CAPTION`, exact loading/empty/error/more/loading-more/retry-next constants, `ledgerPopulationText`, `sanitizeApiCode`, `ledgerStateModel`, `retryNextPage`, `ledgerPageLimit`, a reusable `createLedgerTableShell`, `ledgerStateRow`, `renderLedgerState` and `ledgerRowElement`. `renderLedgerTable` now builds on the same shell. `mapExploreResponse`/`mapLoadError` keep HTTP `status`; `resolveWindow` gives `win=all` precedence over `from`/`to`.
- `explorers/ledger.js`: reads `currentEventCounts()` only when the shell strip is `data-state="success"` for the current generation; footer line, T1–T4 rows, incremental append, `Load more events`/`Loading…`/`Retry next page`, All history and Reset filters through `router.pushScope`/`stateUrl`, first page from frozen `readContext.paramsFor()`, initial limit 100. No counts refetch on append.
- `panels/river.js`: `ACTIVITY_CAPTION` literal G-activity caption and `activityPopulationText` using `cohort_n`, then `eligible_n`, never a fabricated zero; line survives empty/error. Synthetic `eligible_n` population defaults removed. Follow, lanes and row mapping unchanged.
- `panels/panel-frame.js`: opt-in `renderStatus: false` so Ledger owns exact T rows without changing other panels' generic state vocabulary.
- CSS: one 30px full-span state row, busy styling, population/footer, 28px paging controls and activity caption, extending existing rules.
- Tests: `tests/operable-chrome/ledger-states-unit.test.mjs` (denominator ready/loading/error/legacy/stale, limit, T1–T3 text/ARIA, T4 100→200→237 unique identities, retry/scope reset, All history `all=1`/no `win`) and `activity-population-unit.test.mjs` (cohort/fallback/absent, caption, empty/error).

## Evidence before and after

Before: the two new suites did not exist; `ledger-table.js` had no denominator/state helpers, T1–T4 rows or paging-limit helper.

After:

```
node --test tests/operable-chrome/ledger-states-unit.test.mjs tests/operable-chrome/activity-population-unit.test.mjs
→ 12 pass, 0 fail (92ms)
node --test tests/operable-chrome/scope-unit.test.mjs tests/operable-chrome/event-counts-unit.test.mjs
→ 11 pass, 0 fail
node --test tests/workspace/pulse.test.mjs → 13 pass, 0 fail
node --test tests/plan29/harness.test.mjs → pass
Ledger Chromium: "the ledger pages beyond 20,000 retained rows…" → pass (~421s)
Ledger Chromium: "a removed chip…", "empty and error…" → pass
```

The 20k test takes ~7 minutes; the exact combined done-evidence command was therefore run per file (the first combined attempt hit the 600s command timeout after the plan29 file passed). All constituent files pass.

Observable, Plan 29 harness + intercepted Plan 30 schema/count/activity population (U4 fixture not landed): first page `100 rows displayed of 8,410 matching records`; append `200 rows displayed of 8,410 matching records`; All history `100 rows displayed of 12,489 matching records`; activity `16 observations displayed of 16 matching observations`; literal caption rendered. Counts strip line: `Events matching filters: 8,406 · Rejections: 4 · All retained events in tenant: 12,480`.

Acceptance IDs: **S1 pass** (U2 shell/tenant tests plus Ledger loading clears prior rows), **N1 pass** (new unit + observable strings), **C1–C11 pass** (U2 shell tests, unchanged here), **V1/V4/V5 pass** (U2 1440×900 measurements; no new surfaces), **T1 pass** (unit header/busy row/no prior rows), **T2 pass** (unit + Chromium empty/error), **T3 pass** (unit status families/sanitized code/focusable recovery + Chromium error), **T4 pass** (unit + 20k Chromium + observable 100→200; retry-next unit). F/P/G/T5 are phase 2.

Screenshots at 1440×900: `.scratch/plan30-chrome/screens/{ledger,ledger-footer,pulse}.png`. `ledger.png` matches the mockup's caption/header/row bands; `ledger-footer.png` shows the denominator and `Load more events`; `pulse.png` is scrolled to the River so the new line and caption are visible (top chrome is in U2's `pulse.png`). Production chart minimum stays 160px.

## Departures and contradictions

- **design-change: Ledger population placement.** The brief requires the line in the footer; DESIGN line 736/S-ledger mockup put the page count above the table. The brief wins, so it is in the footer. Consequence: at 1440×900 the locally scrolling table hides the denominator until its footer is visible.
- Existing Ledger browser tests require `/rows shown/` and `/No rows match/`. The exact new T2/T3 rows cannot contain those phrases, so the supporting note/hint carries them while the required row text remains exact.
- T1–T3 rows preserve headers and caption, but `aria-busy` is on the table body, not the row, so the 30px row remains one row.
- The ad-hoc observable used route interception because the real two-tenant fixture is U4. No product code or fixture was changed for it.
- `?tenant=tenant-a` resolved to an unavailable tenant in the ad-hoc run; omitting `tenant` canonicalized to `fixture-tenant`. This is shell behaviour, not a Ledger bug.
- `pulse-strips.js` was read but not changed; passing population through its context was unnecessary.

## Known problems / unfinished

- U4 still owns the real-Go two-tenant Chromium proof and the real `event_counts` fixture; this unit's observable counts were synthetic interception.
- The footer placement may need a design decision if the denominator must be visible without scrolling.
- Phase 2 still owns the full S-ledger columns, caption registry, P1–P10 and the remaining T5 surface. Nothing else in this unit is unfinished.
