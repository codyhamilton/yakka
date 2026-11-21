# Brief: phase2-03 — Pulse and activity panels answer their displayed question

Consumer: a product build worker for Plan 30 phase 2, Pulse board.
Owned paths: `packages/yakka-analytics/web/js/panels/river.js`, `pulse-strips.js`, `movers.js`, `calendar.js`, `coverage.js` (under `packages/yakka-analytics/web/js/panels/`), `packages/yakka-analytics/web/css/pulse.css`, new `packages/yakka-analytics/tests/operable-chrome/pulse-captions-unit.test.mjs`, and `packages/yakka-analytics/tests/workspace/pulse.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-03-pulse-activity.md` listing G-activity, G-metrics, G-movers, G-calendar, G-coverage, P1–P10 as they apply, T1–T5 and S-pulse with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`.
Runs alongside: `phase2-04-trends-cost-time`, `phase2-05-distribution-compare`, `phase2-06-quality`, `phase2-07-scatter`, `phase2-08-explorers-list` (disjoint paths).
Budget: about 16 files read, about 450 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 188–227 — G-activity, G-metrics, G-movers, G-calendar, G-coverage verbatim captions, defaults, sources and table columns.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–182 — V1–V5, C1–C11, T1–T5, P1–P10, the templates and label dictionary.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 — filter applicability F1, F3, F4, F5 and the metadata exceptions.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 498–516 — S-pulse region order, DOM order and acceptance.
5. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 145–159, 182 — P controls/P8/P10 and the P10 proof.
6. `packages/yakka-analytics/web/js/panels/river.js` lines 13–85, 226–274 — current caption/population/lanes and load.
7. `packages/yakka-analytics/web/js/panels/pulse-strips.js` lines 12–135, 258–412 — strips, table, summary and those windows.
8. `packages/yakka-analytics/web/js/panels/movers.js` lines 14–123, 238–318; `calendar.js` lines 16–123, 157–215; `coverage.js` lines 12–160, 276–357.
9. `packages/yakka-analytics/tests/workspace/pulse.test.mjs` — the assertions to update.
10. `docs/plans/30-analytics-operable-chrome/mockups/pulse.png` and `mockups/src/pulse.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Each Pulse panel states, in one literal sentence, what it shows and how to read it; renders the prescribed chart and table with exact units, colours and 30px rows; offers only its prescribed controls; and refuses an unsupported filter with no marks.

## Contract

Settled by DESIGN.md. Register the literal captions exactly (copy from DESIGN, do not paraphrase):

- G-activity: `Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.`
- G-metrics: `These totals describe the selected period; each label names its own unit and the values must not be added together.`
- G-movers: `Each bar shows priced spend for a harness or model; longer bars mean more dollars spent in the selected period.`
- G-calendar: `Each square shows priced spend on one day; use the labelled colour scale to compare dollars spent.`
- G-coverage: `These rows show the latest retained records and missing prices or scores; missing data is not zero activity.`

Per item:

- **G-activity** (`river`): default **table** with an optional `lanes` chart (P3); unit observations; source `activity?mode=list&limit=100` with `rows[].event_time,type,identity,repo_id,path,conversation_id,kind,plan,stage` and `population.cohort_n/returned_n`, `next`. Table columns Time (selected timezone), Type, Repository, Plan, Kind, Path, Conversation, Stage, Open; `event_time DESC, type ASC, identity ASC`; Type labels exactly `Session start`, `Artifact version`, `Brief execution`, `Rejection`; initial 100 and `Load more observations` (T4). Population line stays `{loaded} observations displayed of {cohort_n} matching observations` and never calls them events.
- **G-metrics** (`pulse-strips`): seven labeled numeric cells with units USD, calls, events, versions, commits, sessions, unpriced calls. Table columns Metric, Selected period, Previous period, Change, Unit in the fixed order priced spend, model calls, hook events, artifact versions, commits, sessions, unpriced calls. Previous unavailable for All history; no meaningless percentage when prior=0. Mixed summary counters are individually gated: a counter whose measure cannot apply the active filter is unavailable, not mislabeled as filtered.
- **G-movers** (`movers`): horizontal bars X=USD zero origin, Y=harness then model value desc, with sparklines; fixed cost/dims and no extra selectors beyond P8/P9. Table columns Harness/model, Current priced spend (USD), Previous priced spend (USD), Change (USD), Unpriced calls; harness rows then model rows, spend DESC, identity ASC.
- **G-calendar** (`calendar`): heat calendar X=day of week Mon–Sun, Y=week start, colour=USD/day with `--yk-seq-1..5`; P1/P8/P9, default `cost_usd`. Table Date, Value (USD); date asc.
- **G-coverage** (`coverage`): table only, no percentage combining fact types. Columns Source, Latest retained timestamp, Age, Missing-data count, Unit; source codepoint ascending; unknown ages/denominators `—`. It reads tenant metadata: do not date-filter schema/baselines, and warn that missing data is not zero activity.

All panels use V3 tokens (`--yk-bg/surface/surface-alt/text/muted/border`, chart surface/text/muted/grid, categorical `--yk-cat-1..8`, sequential `--yk-seq-1..5`, status tokens), no white chart surface, panel order title → caption → compact controls → chart/table → population/coverage; chart minimum height 160px; no decorative chips or fake filter controls; T1–T5 states exact, caption visible in error.

## Changes

- Call `registerCaption('river', …)` etc. (or set `panel.caption`) from each module with the literal strings above selected by `spec.scope.captionKey` (`G-activity`, …); call `captionFor` through the frame contract from phase 2-01.
- Replace each panel's inline chart+table with `mountPanelViews` (chart default, table toggle) except G-activity whose default is table; keep the chart kit calls (`yk-lanes`, `yk-bars`, `yk-matrix`, the existing table helper).
- Set the prescribed defaults: calendar `cost_usd`; movers fixed `cost_usd`; metrics fixed summary; coverage metadata only. Remove or disable controls the G item does not list (for example the extra movers measure selector and one-item chooser rows), but keep the shared C controls in the shell.
- On `ignored_filters` or an active filter outside a panel's supported set, return the applicability refusal with no marks and the exact sentence; keep the caption. Implement F1 (summary cost/hook cells gated for Brief), F3, F4 (facets/baselines metadata) and F5 (exact identity) only where these panels touch them.
- Ensure tables render 30px single-line rows with ellipsis/title, left alignment, `scope=col`, explicit units and stable nulls last; T4 paging uses the server `next` as cursor.
- Keep the Activity `Follow` control as a local follow affordance; it is not a filter.

### Keep untouched

`web/js/app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, every other panel, every explorer, `scope-controls.js`, and every Phase 1 test. Do not change the scheduler, transport, tenant or URL contract. Do not add an API field or a new chart type.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/pulse-captions-unit.test.mjs tests/workspace/pulse.test.mjs` → all pass. The new test must assert each literal G caption via the registry/frame, each panel's declared caption key, the exact table column lists/orders, G-activity default table + lanes alternative, G-metrics seven-cell order and all-history previous-unavailable, G-movers/calendar fixed defaults, G-coverage units and metadata warning, and the exact F refusal text with no body marks.
- `cd packages/yakka-analytics && node --test tests/trends-quality/trends.test.mjs` → still passes its calendar/rhythm checks (calendar is shared with Trends); report any failure that belongs to `phase2-04`.
- Observable: at 1440×900, Pulse renders metrics full width then two 704px columns in the S-pulse order, each panel caption is one sentence above its chart/table, and every table row measures 30±1px.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
