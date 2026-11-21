# Brief: phase1-03 — Pulse and Ledger honest denominators, observations and table states

Consumer: a web build worker for Plan 30 phase 1.
Owned paths: `packages/yakka-analytics/web/js/panels/pulse-strips.js`, `packages/yakka-analytics/web/js/panels/river.js`, `packages/yakka-analytics/web/js/panels/ledger-table.js`, `packages/yakka-analytics/web/js/panels/panel-frame.js`, `packages/yakka-analytics/web/js/explorers/ledger.js`, `packages/yakka-analytics/web/css/ledger.css`, `packages/yakka-analytics/web/css/workspace.css` (extend the existing table/state base only), and new `packages/yakka-analytics/tests/operable-chrome/ledger-states-unit.test.mjs`, `packages/yakka-analytics/tests/operable-chrome/activity-population-unit.test.mjs`. Touch nothing else. Do not edit `app.js`, `event-counts.js`, `read-context.js` or any Go file.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase1-03-pulse-ledger.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `phase1-02-shell-scope` (the committed shell exposes `currentEventCounts()` and the frozen `readContext` to panels/explorers; it lands before this unit).
Runs alongside: nothing.
Budget: about 12 files read, about 650 lines changed, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 63–81 — counts body and **N1**; line 79 is the exact Pulse/Ledger denominator text.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 137–140 — **T1–T4**; these are the table state/paging acceptance checks.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 190–199 — **G-activity** and **G-metrics** source, units and exact captions.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 730–740 — **S-ledger** layout, caption and columns.
5. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 1015–1038 — Phase 1 outcome/boundaries; do not implement phase-2 caption/control completeness.
6. `packages/yakka-analytics/web/js/panels/ledger-table.js` — pure helpers, `mapExploreResponse`, `renderLedgerTable`, paging/basis.
7. `packages/yakka-analytics/web/js/explorers/ledger.js` — first page, empty/error branch, footer, paging button, counts integration point.
8. `packages/yakka-analytics/web/js/panels/river.js` — activity list mapping, `population`, and where the population line belongs.
9. `packages/yakka-analytics/web/js/panels/pulse-strips.js` — current strips/summary shape; do not change the summary measures.
10. `packages/yakka-analytics/web/js/panels/panel-frame.js` — how loading/empty/error states are currently conveyed so you can replace them with the exact T rows for the Ledger table without breaking other panels.
11. `packages/yakka-analytics/web/js/core/event-counts.js` (created by `phase1-02`) — `currentEventCounts()` shape and generation semantics.
12. `packages/yakka-analytics/web/css/ledger.css` and `workspace.css` table/state rules — extend, do not rewrite.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make Pulse’s activity population and Ledger’s displayed-versus-matched population tell the truth from their real server responses, with T1–T4 table states and 100-row cursor paging that never presents a loaded page as a total. This is the phase’s N1 UI half and the T1–T4 proof surface.

## Contract

Settled by DESIGN.md lines 63–81, 137–140, 190–199, 730–740. Do not reinterpret:

- **Three denominators, never conflated:** retained facts/rejections come from the shell count strip (`matched.events`, `matched.rejections`); activity observations come from the activity response’s typed observation population; Ledger rows come from the loaded `/explore` pages. Never label an event total as an ingestion total, never turn a missing population into `0`, and never call activity rows “events”.
- **Pulse activity line, exactly** `{loaded} observations displayed of {population.cohort_n} matching observations` (line 79). `loaded` is the number of activity rows returned/rendered; `population.cohort_n` is the server’s matching-observation population, falling back to `population.eligible_n` only when `cohort_n` is absent. If neither is supplied, show `{loaded} observations displayed; matching observation total unavailable.` — never `of 0`. The line sits with the activity panel, before or immediately after its lanes, and uses the unit word “observations”. Keep the literal G-activity caption: “Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.” The pulse summary measures keep their own units; do not add them together or relabel them as retained facts.
- **Ledger line, exactly** `{loaded rows} rows displayed of {matched.rows} matching records` when the shell count snapshot is ready for the current generation. While counts are loading: `{loaded} rows displayed; counting matching records…`. On counts error or legacy absence: `{loaded} rows displayed; matching record total unavailable.` If `loaded > matched.rows` (stale counts after new data), show `{loaded} rows displayed; counts may have changed — Refresh.` Do not change the matched total when appending pages; it is a snapshot for the committed generation.
- **All history (C8):** the same line uses `matched.rows` under `all=1`, which includes old facts and old rejections; activity keeps its typed-observation population and count strip keeps its matched/rejection split. Selecting All history clears the Ledger cursor and reloads page one; appending must never refetch the count.
- **T1 loading:** keep the table header; replace tbody with one full-span 30px status row `Loading Event ledger…`, `aria-busy="true"`. Remove prior-scope rows immediately; do not show prior counts or zeros. Do this on first page and on a scope/tenant change.
- **T2 empty:** header plus one full-span 30px row `No records match these filters.` with working `All history` and `Reset filters` actions that use the C8/C7 commits (call the shell/router callbacks; do not mutate scope locally). No “0 events” claim.
- **T3 error:** header plus one full-span 30px row `Could not load Event ledger.`, a sanitized API code and `Retry`. Retry repeats the committed scope, not a draft, and leaves prior same-scope rows only where T4 says so. 401 shows `Sign in`; 403 says `You do not have access to this tenant`; 503/busy and timeout are named separately. Never raw body HTML or a stack trace. Keep recovery focusable.
- **T4 paging:** initial `limit=100` unless the schema publishes a lower explore page max. Button label exactly `Load more events`, disabled with label `Loading…` while pending, hidden when there is no next. Append with the API `next` as `cursor` and the same frozen bounds, tenant, filter and sort. Do not treat the explore cap as a total. A failed next page leaves the loaded same-scope rows and offers `Retry next page`; a scope/tenant change clears cursor and rows. Show 100→200→… with each identity exactly once.
- **Read context:** page parameters come from the committed `readContext`/scope the shell passes. Do not resolve `Date.now()` inside the panel for a page after the first; do not send `win`. Keep `filterToParameters`, `appendPage`, `rowKey`, `pagingSummary` and the ordered constants as the single definitions; extend them, don’t fork them.
- **Pulse summary:** do not alter `summaryIsEmpty`, `stripModel`, `previousWindow` or the summary request. The summary remains the metrics source; only the activity population line, exact G-activity caption and truthful denominator labels change.
- This unit must **not** implement phase-2 caption/control completeness, the full S-ledger column rewrite, P1–P10 or new chart behaviour. Existing panel bodies stay. If an existing summary/activity surface cannot represent a measure truthfully, show a readable F refusal; do not invent a value.

## Changes

1. **`ledger-table.js`** — add pure helpers for the four denominator texts and the T1–T4 state rows, e.g. `ledgerPopulationText({loaded, counts})`, `ledgerStateRow(state, {code, retry, actions})`. Keep `renderLedgerTable` as the ready renderer; make the header reusable so loading/empty/error still show a caption/headers. Keep the existing 14 columns for phase 1; do not implement S-ledger’s new column set here (phase 2). Keep `pagingSummary` for other callers but make Ledger use the new matched-records line. Add `retryNextPage` classification for T4 failure. Keep `mapExploreResponse`/`mapLoadError` semantics.
2. **`explorers/ledger.js`** — read `currentEventCounts()` from `../core/event-counts.js`; render the denominator line in the footer from that snapshot; render T1/T2/T3 as table rows via `ledger-table` helpers instead of clearing the body or relying on `frame`’s generic status; keep header during all four states. Wire `All history`/`Reset filters` to the shell-provided URL actions. Rename the button to `Load more events` and the pending label to `Loading…`. On next-page failure keep rows and show `Retry next page`. Do not refetch counts on paging.
3. **`river.js`** — add the N1 activity denominator line with the exact template above, using `result.population` (`cohort_n` then `eligible_n`) and loaded row count; add the literal G-activity caption; ensure the line survives empty/error states without inventing `0`. Keep Follow, lanes, row mapping and ignored-filter behaviour. Do not turn activity into events.
4. **`pulse-strips.js`** — only if needed to pass the loaded/population wording through the activity panel context; keep `STRIP_MEASURES`, summary fetch and strip model unchanged. Do not relabel summary counts as retained facts.
5. **`panel-frame.js`** — make the Ledger’s `setState` path able to show exact T rows without changing other panels’ vocabulary. Prefer adding an opt-in renderer/status slot used by `ledger.js`; do not globally replace the generic loading/empty/error wording that other phase-1 panels rely on.
6. **CSS** — `ledger.css`/`workspace.css`: one full-span state row at 30px, header preserved, `aria-busy` row styling, footer/population line and paging button minimum 28px. No white surfaces, shadows, pills or animations. Do not change chart tokens or panel padding.
7. **Unit tests** — `ledger-states-unit.test.mjs`: denominator text for ready/loading/error/legacy/stale; 100→200→N append with unique identities; T1/T2/T3 row text and ARIA; T4 disable/retry/scope reset; All history uses `all=1` and no `win`. `activity-population-unit.test.mjs`: `cohort_n` preferred, `eligible_n` fallback, absent population never zero, loaded text and exact caption; empty result keeps the line honest.

### Keep untouched

- `event-counts.js`, `read-context.js`, `app.js`, the shell controls and Go files.
- `STRIP_MEASURES`, `stripModel`, `summaryIsEmpty`, `previousWindow`, summary/scores request shapes.
- Other panels/explorers and chart internals; `view-spec.js`; `schema-adapter.js`.
- No phase-2 caption registry, P controls, full S-ledger columns or phase-3 account work.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/ledger-states-unit.test.mjs tests/operable-chrome/activity-population-unit.test.mjs` → all denominator/state/paging assertions pass.
- `cd packages/yakka-analytics && node --test tests/plan29/harness.test.mjs tests/workspace/ledger.test.mjs tests/pulse.test.mjs` → existing ledger/pulse behaviour still passes; if a test name differs, run the nearest existing ledger/pulse suite and name it in the report.
- Observable with a real fixture served by `phase1-04` (or the Plan 29 harness plus the new counts capability): Ledger shows `100 rows displayed of 8410 matching records` on first page, appends to `200 rows displayed of 8410 matching records`, and All history changes the denominator to `12489` without changing it on append. Pulse activity shows `16 observations displayed of 16 matching observations` and never calls them events. Counts loading/error/legacy show the exact strings and no zero.
- A 1440×900 screenshot of Ledger and Pulse for your own check goes under gitignored `.scratch/plan30-chrome/screens/` (never `/tmp`), compared with `mockups/ledger.png` and `mockups/pulse.png`; record the comparison in the report.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
