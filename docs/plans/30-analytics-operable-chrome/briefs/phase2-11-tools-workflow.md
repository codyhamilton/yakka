# Brief: phase2-11 — Tools and Workflow boards

Consumer: a product build worker for Plan 30 phase 2, Tools and Workflow boards.
Owned paths: `packages/yakka-analytics/web/js/panels/mix.js`, `shape-bars.js`, `plan-timeline.js`, `packages/yakka-analytics/web/css/tools.css`, `workflow.css`, new `packages/yakka-analytics/tests/operable-chrome/tools-workflow-unit.test.mjs`, and tests `packages/yakka-analytics/tests/trends-quality/tools.test.mjs`, `tests/plans-artifacts/workflow.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-11-tools-workflow.md` listing G-mix, G-toolsmap, G-toolsrank, G-rhythm, G-shapes, G-planline, G-planrank, G-planxy, G-activity, P7/P8/P9, T1–T5, and S-tools/S-workflow with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`, `phase2-03-pulse-activity`, `phase2-04-trends-cost-time`, `phase2-07-scatter`.
Runs alongside: nothing (wave 3).
Budget: about 18 files read, about 500 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 332–387 — G-mix, G-toolsmap, G-toolsrank, G-rhythm, G-shapes, G-planline, G-planrank, G-planxy and G-activity relationships.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 356–379 — G-shapes/G-planline/G-planrank exact captions, tables and non-inference rules.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 577–617 — S-tools/S-workflow region order, plan selector and precedence rules.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 143–182 — P7 (Plan only, Harness/Repo absent) and P8/P9.
5. `packages/yakka-analytics/web/js/panels/mix.js` lines 10–140; `shape-bars.js` lines 10–150; `plan-timeline.js` lines 120–310.
6. `packages/yakka-analytics/web/js/panels/index.js` — Tools/Workflow registration order (read only; `phase2-02` owns registrations).
7. `packages/yakka-analytics/tests/trends-quality/tools.test.mjs`, `tests/plans-artifacts/workflow.test.mjs`.
8. `docs/plans/30-analytics-operable-chrome/mockups/tools.png`, `workflow.png` and matching `mockups/src/*.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Tools shows mix, tools treemap, tools rank and rhythm in the exact order with their literal captions and no extra selectors; Workflow shows shapes, plan timeline, plan rank, plan scatter and activity in the exact order, with only the Plan selector where allowed, correct plan precedence and no inferred duration.

## Contract

Settled by DESIGN.md.

- **G-mix** (`mix`): stacked bars X=hook-event count from 0, Y=tool category, series=harness; fixed `hook_events/tool_kind/harness/stacked`; P8/P9 only. Caption exactly `Each bar counts hook events for a tool category, split by harness; longer segments mean more events.` Caption/table use the P10 stacked row: Group, Series, Value (events); group asc/series asc.
- **G-shapes** (`shape-bars`): stacked horizontal bars X=execution count, Y=plan, unreported DESC/identity ASC, top 12 explicitly labelled; `entities?grain=plan&sort=executions_unreported:desc&limit=12` and fields `executions_complete,executions_unreported,executions_started,complete_share,last_ts`; P7/P8/P9 with only Plan enabled (Harness and Repo absent because no execution aggregate API; no clickable unsupported grouping). Status good=complete, warn=unreported, info=started; caption exactly `Each bar counts a plan’s complete, unreported and started executions; completion describes recorded steps, not whether the work succeeded.` Table Repository, Plan, Complete executions, Unreported executions, Started executions, Complete share (%), Last observed; unreported DESC/identity ASC.
- **G-planline** (`plan-timeline`): lanes X=event timestamp, Y=plan, marker style=event type, no continuous duration; `entity?grain=plan&collection=events` plus execution rows for context; native Plan select from the served first plan page sorted unreported DESC/identity ASC labelled repo/plan, default first eligible plan, `scope.plan/repo_id` selects the exact timeline; empty → T2; a selected global plan wins over the local selection and making a local choice changes only the timeline identity within global scope. Caption exactly `Each marker shows a recorded plan event at its event time; rows separate plans and do not imply continuous work between markers.` Table Event time, Event type, Repository, Plan, Path, Conversation, Session cost (USD) where served; event time ASC/stable identity.
- **Reused panels on these boards:** G-toolsmap/G-toolsrank are `treemap.js`/`rank.js` with `spec.scope.captionKey` from `phase2-04`; G-rhythm from `phase2-04`; G-planrank from `phase2-04`; G-planxy from `phase2-07`; G-activity from `phase2-03`. Verify their defaults/captions appear correctly here; fix them only in their owning module (report a cross-unit defect rather than editing another unit's file).
- Board order is owned by `phase2-02` registrations/presets: S-tools DOM order G-mix, G-toolsmap, G-toolsrank, G-rhythm; S-workflow G-shapes, G-planline, G-planrank, G-planxy, G-activity (last full width). Do not edit registrations/presets; prove the order and report a defect if wrong.
- Common: V3 tokens (no white surface), minimum 160px chart, T1–T5 states with caption visible, local chart/table toggle, 30px rows, exact units and nulls, F refusal with no marks for unsupported filters, no fake selectors.

## Changes

- Wire captions and `mountPanelViews` in the three owned modules; remove one-item/extra choosers the G items do not list (mix measure/split, shape grouping).
- Add the Plan-only P7 control semantics to shape-bars and the Plan selector/precedence logic to plan-timeline; implement the T2 empty-plan-list path.
- Keep mix's fixed stacked tool-category chart and table; keep shapes' top-12 label and status tokens; keep timeline markers as markers with no duration inference.
- Update only the two named test files and the new unit test; append only to `tools.css`/`workflow.css`.

### Keep untouched

`app.js`, boards/presets/registrations (including Tools/Workflow panel order), `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, `rank.js`, `treemap.js`, `rhythm.js`, `scatter-plan.js`, `river.js`, and every other panel/explorer/test. If an order or shared-panel defect appears, report it with the owning unit name; do not edit across ownership.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/trends-quality/tools.test.mjs tests/plans-artifacts/workflow.test.mjs tests/operable-chrome/tools-workflow-unit.test.mjs` → all pass. Assert G-mix/G-shapes/G-planline literal captions and keys, P7 Plan-only option set, shape top-12 label/status tokens/table sort, timeline selector options/default/global-plan precedence and T2 empty list, exact table columns/units, no duration inference, and exact F refusal with no marks.
- `cd packages/yakka-analytics && node --test tests/workspace/acceptance.test.mjs` → report only board-order failures (owned by `phase2-02`) and any Tools/Workflow assertion here.
- Observable: at 1440×900 S-tools shows mix/toolsmap in row 1 and toolsrank/rhythm in row 2; S-workflow shows shapes/planline, planrank/planxy, then activity full width; every caption is one sentence above its chart/table and every row 30±1px.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
