# Brief: phase2-02 — Board assembly order, Start tables and shell wiring

Consumer: a product build worker for Plan 30 phase 2, board layout and Start.
Owned paths: `packages/yakka-analytics/web/js/app.js`, `packages/yakka-analytics/web/js/boards/board.js`, `packages/yakka-analytics/web/js/boards/presets.js`, `packages/yakka-analytics/web/js/panels/index.js`, `packages/yakka-analytics/web/js/panels/p10-trends.js`, `packages/yakka-analytics/web/js/panels/p10-cost.js`, `packages/yakka-analytics/web/js/panels/p10-compare.js`, `packages/yakka-analytics/web/js/panels/p10-quality.js`, `packages/yakka-analytics/web/js/panels/p10-tools.js`, `packages/yakka-analytics/web/js/panels/p11-scatter.js`, `packages/yakka-analytics/web/js/panels/p12-workflow.js`, `packages/yakka-analytics/web/css/app.css`, `packages/yakka-analytics/web/css/workspace.css`, new `packages/yakka-analytics/tests/operable-chrome/board-order-unit.test.mjs`, and `packages/yakka-analytics/tests/workspace/start.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-02-board-order-start.md` listing each owned check ID with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: nothing; wave 1 with `phase2-01-shared-caption-applicability` (disjoint paths).
Runs alongside: `phase2-01-shared-caption-applicability`.
Budget: about 18 files read, about 550 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 103–132 — V1–V5, C1–C11, including the exhaustive region rows and the two-column 704px rule.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 481–655 — S-start, S-pulse, S-trends, S-cost, S-quality, S-tools, S-workflow, S-compare, S-scatter: exact DOM order, first-full-width rule, odd final panel, per-screen controls.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 184–475 — each G item's controls/defaults, so the preset spec is exact.
4. `packages/yakka-analytics/web/js/app.js` lines 238–254 (QUESTION_PATHS), 344–373 (question paths), 394–434 (saved boards), 465–694 (board render) and 872–885 (Start dispatch).
5. `packages/yakka-analytics/web/js/boards/presets.js` lines 9–63 and `board.js` lines 24–53.
6. The seven registration files (`p10-trends.js`, `p10-cost.js`, `p10-compare.js`, `p10-quality.js`, `p10-tools.js`, `p11-scatter.js`, `p12-workflow.js`).
7. `packages/yakka-analytics/web/css/workspace.css` lines 17–21 and 94–97 — the current three-column grid you replace.
8. `packages/yakka-analytics/tests/workspace/start.test.mjs` and `tests/workspace/acceptance.test.mjs` — the assertions to update without weakening shell contracts.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the eight boards assemble in the exact DOM order, two-equal-column geometry and per-panel default spec the DESIGN names, and make Start an exact full-width Question paths table plus Saved boards table. Panels themselves are implemented by later units; this unit only sequences and configures them.

## Contract

Settled by DESIGN.md:

- **Boards and order.** Pulse: metrics (full width first), then activity, movers, calendar, coverage in that DOM order, two 704px columns (W−8)/2 with 8px gap, odd final panel spans W. Trends: columns, lines, multiples, calendar, rhythm with rhythm full width. Cost: columns, rank, costmap, ranges, hist, ecdf. Quality: scores, scoretrend, strips, bands. Tools: mix, toolsmap, toolsrank, rhythm. Workflow: shapes, planline, planrank, planxy, activity with activity full width. Compare: compranges, comphist, compecdf, complines, slope with slope full width. Scatter: sessionxy, artifactxy, planxy, dayxy. Panel height auto; production chart minimum 160px (CSS handles it in each panel unit; do not set a 112px height).
- **Preset specs.** Use the G-item defaults verbatim (measure, split, chart, grain, dimensions): Trends `cost_usd/model/columns|lines|lines`, calendar `cost_usd`, rhythm `hook_events`; Cost `cost_usd/model` for columns/rank/costmap and the three distribution grains on DESIGN lines 276–299; Quality `score` with `harness`, `session_model`, `kind`, `kind` and charts `ranges|lines|strip|stacked`; Tools `hook_events/tool_kind/harness/stacked`, `hook_events/harness/tool/treemap`, `hook_events/tool/rank`, `hook_events/rhythm`; Workflow plan `shape-bars`, `plan-timeline`, plan `rank` (associated cost), plan `scatter` (cost/artifacts), `river`; Compare call `ranges|histogram|ecdf` with `cmp=period`, `trend-lines` with `cmp=period`, `rank` with chart `slope` and `cmp=period`; Scatter the four SPECS already on disk. Every spec carries a literal caption key in `scope.captionKey` (`G-metrics`, `G-activity`, `G-movers`, `G-calendar`, `G-coverage`, `G-columns`, `G-lines`, `G-multiples`, `G-rhythm`, `G-rank`, `G-costmap`, `G-toolsmap`, `G-toolsrank`, `G-planrank`, `G-slope`, `G-ranges`, `G-hist`, `G-ecdf`, `G-compranges`, `G-comphist`, `G-compecdf`, `G-complines`, `G-scores`, `G-scoretrend`, `G-strips`, `G-bands`, `G-mix`, `G-shapes`, `G-planline`, `G-planxy`, `G-sessionxy`, `G-artifactxy`, `G-dayxy`) so the panel unit can select the exact registered literal. `scope.captionKey` must never reach the wire; requests already copy only declared filter keys.
- **Geometry.** `.panel-grid > *` spans 6 columns by default; add `data-span="12"` on the full-width panels above and on the final panel when a board has an odd panel count. Remove the current full-width rules for `data-chart=""`/`"table"`/`"lanes"` (they contradict Pulse's half-width River and hide the odd-final rule). Below 900px collapse to one column, wrap toolbars, never hide tenant/filters. No page max-width.
- **S-start.** Heading, then C1–C11 toolbar and counts, then a semantic full-width Question paths table with columns Area 140px, Question 380px, Explanation remaining (≈896px at 1440), fixed group order Cost/Quality/Plans/Activity/Health and existing `QUESTION_PATHS` order within groups; disabled rows name the missing capability and reason, never a dead link; scope/tenant preserved on every link. Then Saved boards: a table with Name 300px, Open 80px, Delete 80px, URL summary remaining, name input (blank default, trimmed required), Save current view writes the full canonical scope, Open restores the authorized URL, Delete removes the local entry, empty text `No saved boards yet.`, name ASC. No chart on Start.
- **Compare control.** On `/b/compare` render a labeled `Comparison` select: `Previous equal period`=`period` (default), `No comparison`=`off`, `Saved cohorts`=`cohorts` (enabled only with ≥2 valid cohort slots). It writes URL `cmp` and each panel's `pN.scope.cmp` in one push; All history keeps the control but panels refuse with the S-compare text (panel units own the marks refusal). Do not invent a server field.
- **Regions.** The S-screen ASCII is exhaustive. Remove the standalone coverage strip from Start and board render (keep the function for reuse); the counts line, Refresh and Advanced scope remain. Shell must keep Phase 1 nav order, 46/32/32px rows, tenant/theme placement and `aria-current`.
- **Account screens are untouched.** No Phase 3 screen here.

Settled by the code: `assembleBoard` already merges preset specs with `pN`; presets are data; `renderBoard` appends `h1`, scope controls, scope bar, coverage strip, then `.panel-grid`. `Start` currently renders grouped `<ul>` lists and a `<ul>` saved board list.

## Changes

1. Reorder each preset's panel array to the DESIGN order and set the exact specs above; keep registration idempotent.
2. In `renderBoard`, compute each entry's `data-span` from the board's prescribed full-width ids and odd-final rule; append panels in preset order; keep the conflict/missing-feature paths and all Phase 1 `spec`/`scope`/`select`/`inspect`/`filter`/`cohort`/`open` event wiring. Remove the coverage-strip call.
3. On the compare board, add the Comparison select before the grid and commit `cmp` via `router.pushScope`; synchronize panel specs as the design states.
4. Replace `renderQuestionPaths` with the semantic table and scoped links; replace `mountSavedBoards` with the specified table and canonical-scope save/open/delete.
5. Tighten `workspace.css`/`app.css` for two columns, full-width spans, 30px rows and the V1/V2 measurements; no shadows, gradients, centre alignment or white surfaces.
6. Update only `tests/workspace/start.test.mjs`; add the new board-order unit test.

### Keep untouched

All panel modules, explorers, charts modules, `contract/*`, `core/scope-controls.js`, `core/chips.js`, `core/event-counts.js`, `core/read-context.js`, `core/router.js`, `core/view-spec.js`, `core/panel-state.js`, `panels/registry.js`, `panels/panel-frame.js` and every Phase 1 test (`tests/plan30/*`, `tests/operable-chrome/{scope,event-counts,ledger-states,activity-population}-unit.test.mjs`). Do not change the shell's tenant/scope/URL/transport contract or account routes.

## Done evidence

Identify the failing check first. `tests/workspace/start.test.mjs` currently expects lists and old copy; the new board-order test must fail before the presets change.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/board-order-unit.test.mjs tests/workspace/start.test.mjs` → all pass. Assert the exact eight panel id orders, the Pulse metrics-first order, the odd-final full-width span map, `data-span` on rendered frames, each preset spec's caption key and G defaults, the Start region order and columns, and that `scope.captionKey` is absent from every built request URL.
- `cd packages/yakka-analytics && node --test tests/workspace/acceptance.test.mjs tests/workspace/deep-links.test.mjs` → pass with the updated expected panel order; if an assertion outside your owned files encodes the old order, report it rather than editing that file.
- Observable: at 1440px width a Pulse row is two panels of 704px with an 8px gap, the metrics panel is 1416px, and the final odd panel is 1416px; Start renders the three Area/Question/Explanation columns in five fixed groups and the four saved-board columns.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. This repo runs `node --test`; if a Vitest runner is used, `--maxWorkers=3`. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
