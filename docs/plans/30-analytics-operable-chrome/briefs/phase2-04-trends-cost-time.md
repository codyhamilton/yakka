# Brief: phase2-04 — Trends and Cost time-series, rank and treemap panels

Consumer: a product build worker for Plan 30 phase 2, Trends and Cost time-series plus the four rank/treemap configurations.
Owned paths: `packages/yakka-analytics/web/js/panels/trend-columns.js`, `trend-lines.js`, `trend-multiples.js`, `rhythm.js`, `rank.js`, `treemap.js`, `packages/yakka-analytics/web/css/trends.css`, new `packages/yakka-analytics/tests/operable-chrome/trends-captions-unit.test.mjs`, and `packages/yakka-analytics/tests/trends-quality/trends.test.mjs`, `tests/trends-quality/cost.test.mjs`, `tests/plans-artifacts/rank-preset.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-04-trends-cost-time.md` listing G-columns, G-lines, G-multiples, G-rhythm, G-rank, G-costmap, G-toolsmap, G-toolsrank, G-planrank, G-slope, G-complines, P1–P3/P8–P10 as they apply, T1–T5, S-trends and the time/rank/treemap parts of S-cost with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`.
Runs alongside: `phase2-03-pulse-activity`, `phase2-05-distribution-compare`, `phase2-06-quality`, `phase2-07-scatter`, `phase2-08-explorers-list` (disjoint paths).
Budget: about 20 files read, about 600 lines changed, 65 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 228–275 — G-columns, G-lines, G-multiples, G-rhythm, G-rank, G-costmap exact captions/defaults/tables.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 340–355 and 372–379 — G-toolsmap, G-toolsrank and G-planrank (same treemap/rank modules, different fixed defaults).
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 436–451 — G-complines and G-slope (Plan 30 puts them on Compare).
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 143–182 — P1–P10, the template table, cumulative omission text and the P10 proof.
5. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 518–537 and 538–557 — S-trends and S-cost region order/acceptance.
6. `packages/yakka-analytics/web/js/panels/trend-columns.js` lines 1–155, `trend-lines.js` lines 44–275, `trend-multiples.js` lines 37–178, `rhythm.js` lines 19–123.
7. `packages/yakka-analytics/web/js/panels/rank.js` lines 20–141, 241–403, 403–594 — time, cohort/compare, plan-rank and slope paths.
8. `packages/yakka-analytics/web/js/panels/treemap.js` lines 20–171, 171–300.
9. `packages/yakka-analytics/tests/trends-quality/trends.test.mjs`, `cost.test.mjs`, `tests/plans-artifacts/rank-preset.test.mjs` — old assertions to replace.
10. `docs/plans/30-analytics-operable-chrome/mockups/trends.png`, `mockups/src/trends.html`, `mockups/cost.png`, `mockups/src/cost.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

The Trends and Cost time-series, rank, treemap and rhythm panels must answer exactly the question their literal caption states, with the prescribed defaults, units, controls, chart/table pair and refusals. `rank.js` and `treemap.js` are shared: their configuration comes from `spec.scope.captionKey` / preset specs set by `phase2-02`, not from a second implementation.

## Contract

Settled by DESIGN.md. Register these literals verbatim and select them by `spec.scope.captionKey`:

- G-columns (`trend-columns`, `G-columns`): `Each bar shows priced model spend in one time bucket; taller bars mean more dollars spent.`
- G-lines (`trend-lines`, `G-lines`): `Each line shows a model’s priced spend over time; higher points mean more dollars spent in that bucket.`
- G-multiples (`trend-multiples`, `G-multiples`): `Each small chart shows one model’s priced spend over time on the same scale; compare heights across charts.`
- G-rhythm (`rhythm`, `G-rhythm`): `Each square counts hook events for a weekday and hour in the selected timezone; use the labelled colour scale to compare event counts.`
- G-rank (`rank`, `G-rank`): `Each bar shows a model’s total priced spend; models are ordered from most to least dollars spent.`
- G-costmap (`treemap`, `G-costmap`): `Each rectangle shows priced spend for a model within a harness; larger rectangles mean more dollars spent.`
- G-toolsmap (`treemap`, `G-toolsmap`): `Each rectangle counts hook events for a tool within a harness; larger rectangles mean more events.`
- G-toolsrank (`rank`, `G-toolsrank`): `Each bar counts hook events for a tool; tools are ordered from most to least events.`
- G-planrank (`rank`, `G-planrank`): `Each bar shows spend from sessions associated with a plan; shared sessions can contribute to more than one plan, so do not add the bars.`
- G-slope (`rank`, `G-slope`): `Each segment joins a model’s previous and selected-period spend; an upward segment means that model cost more in the selected period.`
- G-complines (`trend-lines`, `G-complines`): `Each line shows priced spend in the selected or previous equal-length period; matching elapsed positions compare the same point within each period.`

Per item:

- **G-columns:** columns X=event-time bucket in selected timezone, Y=USD from 0, stacked by model; query `measure=cost_usd&dim=model&bucket=auto`; P1/P2/P3/P8/P9 with defaults cost_usd/model/columns. Table Bucket, Group, Value (USD); time asc then group asc.
- **G-lines:** lines X=event-time bucket, Y=USD, missing values are gaps; P1/P2/P3 with lines default; table Bucket, Group, Value; time asc/group asc.
- **G-multiples:** small-multiple lines, shared Y domain, groups lexical; P1/P2; table Group, Bucket, Value; group asc/time asc.
- **G-rhythm:** heatmap X=hour 0–23, Y=weekday Mon–Sun, `hook_events` fixed, `dim=weekday&dim=hour_of_day&bucket=none`; sequential tokens. Table Weekday (Mon=1), Hour (0–23), Hook events; weekday/hour asc.
- **G-rank:** horizontal rank X=USD from 0, Y=model value desc/identity asc; P1/P2/P3; table Group, Value (USD); value desc/group asc.
- **G-costmap:** treemap area=USD, parent=harness, child=model, no axes, spend desc; P1/P2 fixed parent; table Parent, Child, Value (USD); value desc/identity asc.
- **G-toolsmap:** same module, `hook_events`, parent=harness, child=tool (fall back to `tool_kind` only when `tool` is not published, with the title/caption replacing tool by tool category); table Parent, Child, Value (events).
- **G-toolsrank:** same rank module, `hook_events`, `dim=tool`, count desc; table Group, Value (events).
- **G-planrank:** rank module plan mode, `associated_cost_usd`, `unpriced_calls`, overlap/lower-bound note; never sum overlapping associated spend; table Group, Value (USD).
- **G-slope:** rank module slope, categorical Previous/Current, zero-based USD domain, end labels; requires `cmp=period` and a finite window, otherwise the Compare refusal; table Group, Previous (USD), Current (USD), Change (USD); current desc/group asc.
- **G-complines:** trend-lines with `cmp=period`, elapsed offset X with actual date in the tooltip, previous period dashed; table Bucket, Group, Value (USD).

Common: P controls are the deterministic ordered intersections of the panel registry list and server capabilities; never offer cumulative in this amendment — an old cumulative deep link renders `Cumulative display is unavailable; choose columns or lines.` with an explicit `Choose columns` action that writes `pN.chart=columns`. Slope alternatives refuse unless `cmp=period` and a finite window. Panel defaults/order are fixed by the preset; a change writes only that panel's `pN` in one push. All panels register a caption, use V3 tokens (no white surface), minimum 160px chart height, T1–T5 states and a local chart/table toggle. Table columns/units are exactly those listed above, with stable nulls last and identity ascending.

## Changes

- Add `registerCaption`/`panel.caption` wiring and `scope.captionKey` selection to the six modules; keep the exact strings above.
- Replace inline chart+table rendering with the shared `mountPanelViews` helper; keep chart kit calls (`yk-chart`, `yk-bars`, `yk-treemap`, `yk-matrix`, the existing table helper).
- Restrict each chooser to its fixed G controls (remove the one-item rhythm chooser, the treemap custom parent/child chooser where the G item fixes them, and trend-columns' cumulative/share; retain measure/split/chart only where P1–P3 list them).
- Make rank/treemap select their caption and defaults from `spec.scope.captionKey` and preset `measures`/`split`/`scope`; implement the Tools and Workflow variants here (the Tools/Workflow unit only supplies board proof). Keep plan-rank's non-additive and lower-bound text.
- Implement the F refusal for unsupported filters (for example a repo split on hook facts) with no marks and the exact sentence; keep the valid table/ledger usable.
- Update only the three named test files.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, `pulse.css`/`cost.css` (use `trends.css` for rank/treemap additions or existing classes), every other panel and explorer, and every test not named above. No chart-library rewrite, no new chart type, no API field.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/trends-captions-unit.test.mjs tests/trends-quality/trends.test.mjs tests/trends-quality/cost.test.mjs tests/plans-artifacts/rank-preset.test.mjs` → all pass. Assert each of the eleven literal captions via registry/frame and caption key, every fixed default (measure/split/chart/grain/bucket), the table column lists/orders, trend cumulative refusal text and Choose columns URL write, slope finite-window/`cmp=period` refusal, plan-rank non-additive text, Tools treemap `tool_kind` fallback, and the exact F refusal with no marks.
- `cd packages/yakka-analytics && node --test tests/workspace/acceptance.test.mjs` → passes or reports only the panel-order assertion changed by `phase2-02`; do not edit it here.
- Observable: at 1440×900, Trends renders columns, lines, multiples, calendar in two columns and rhythm full width; Cost renders six panels in three two-column rows; every panel caption is one sentence above its chart/table and every row is 30±1px.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
