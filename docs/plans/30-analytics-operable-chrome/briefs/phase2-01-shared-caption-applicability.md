# Brief: phase2-01 — Shared caption, filter-applicability and panel-view infrastructure

Consumer: a product build worker for Plan 30 phase 2, shared panel infrastructure.
Owned paths: new `packages/yakka-analytics/web/js/panels/captions.js`, new `packages/yakka-analytics/web/js/core/filter-applicability.js`, `packages/yakka-analytics/web/js/panels/registry.js`, `packages/yakka-analytics/web/js/panels/panel-frame.js`, `packages/yakka-analytics/web/js/core/panel-state.js`, `packages/yakka-analytics/web/js/panels/p10-shared.js`, `packages/yakka-analytics/web/js/charts/table.js`, `packages/yakka-analytics/web/js/charts/legend.js`, `packages/yakka-analytics/web/js/charts/styles.js`, new `packages/yakka-analytics/tests/operable-chrome/captions-unit.test.mjs`, new `packages/yakka-analytics/tests/operable-chrome/filter-applicability-unit.test.mjs`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-01-shared-caption-applicability.md` listing each owned check ID with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: nothing.
Runs alongside: `phase2-02-board-order-start` (disjoint paths), and only those two run in wave 1.
Budget: about 14 files read, about 450 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–182 — V1–V5, C1–C11, T1–T5, P1–P10 including the exact caption templates and label dictionary. This unit owns the mechanism, not the per-panel literal strings.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 — the filter-applicability domain and F1–F6.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 184–475 — the G catalogue, so the registry can name every chart family and unit.
4. `packages/yakka-analytics/web/js/panels/registry.js` lines 13–108 — the panel shape and validation you extend.
5. `packages/yakka-analytics/web/js/panels/panel-frame.js` lines 36–199 — where the caption slot, T5 error text and body clearing go.
6. `packages/yakka-analytics/web/js/core/panel-state.js` lines 125–157 — `unsupportedState`/`classifyResult`; add the F refusal state without inventing a second vocabulary.
7. `packages/yakka-analytics/web/js/panels/p10-shared.js` lines 20–115 and 543–590 — measure labels/units and the chooser; reuse `measureMeta` for the dictionary.
8. `packages/yakka-analytics/web/js/charts/table.js` lines 1–132 — the generic table you extend with an explicit column model and optional row-select suppression.
9. `packages/yakka-analytics/tests/operable-chrome/activity-population-unit.test.mjs` — the node-test style and direct-module import pattern.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Give every panel exactly one shared way to carry a literal one-sentence caption, refuse an active unsupported filter with no marks, and toggle chart/table locally. Per-panel literal text and defaults are registered by the panel units; this unit owns the registry, templates, label dictionary and refusal mechanics.

## Contract

Settled by DESIGN.md:

- **P10 / T5 / F:** a caption is visible above the chart, is never hidden in a tooltip or replaced by generic basis text, and remains visible when the panel has no marks. Every registered panel must resolve to a caption. An unsupported active filter yields no data marks and the literal text `This chart cannot apply {labels}. Change the filters to view it.` with labels from the controlled dictionary, sorted alphabetically. `Edit filters` focuses the first relevant control and does not clear it.
- **P10 templates:** the exact family templates on DESIGN.md lines 163–180 and the measure/entity/bucket dictionaries on line 161. Never emit raw snake_case identifiers as prose; an advertised label with no dictionary entry is an explicit unsupported configuration, not a guessed word.
- **T:** every chart has a table view; `Show table`/`Show chart` is local display state only and makes no query/API change. Tables use a semantic caption, `scope=col`, 30px rows, left alignment and explicit units. `—` means unavailable; `0` means numeric zero.
- **P8:** `Show table`, `Show chart`, `Data details`, `Edit filters`, `Retry` are display/actions only; defaults are chart and details closed.
- **F metadata exceptions:** schema/facets/baselines are not date-filtered; exact identity/content reads are tenant+identity only. The applicability helper must accept a route/exception descriptor rather than invent one.
- **Assumption Ledger:** do not reopen Assumption 4 (refuse unsupported filters rather than invent attribution). No new API field, endpoint, chart library or CSS framework.

Settled by the code: `panel.load()` returns a state result; panels currently paint their own body DOM (for example `trend-columns.js:107–127`) and mix chart and table inline. The frame can own the caption element; panels adopt the shared view helper in their own units.

## Changes

- `captions.js` (new): export `registerCaption(panelId, caption)` where `caption` is a string or a function `({panel, spec, scope, schema, result}) => string`; `captionFor(panel, spec, context)`; `CAPTION_TEMPLATES` for the families `columns`, `lines/area`, `small multiples`, `rank/bars`, `stacked/share`, `treemap`, `ranges`, `slope`, `histogram`, `cumulative distribution`, `scatter`, `calendar`, `rhythm`, `score ranges/trend`, `strip`, `band mix`; `LABELS` for the exact measure labels and entity dictionary on DESIGN.md line 161. A missing caption returns an explicit readable refusal (`No plain-language caption is registered for {id}.`), never a generic “Recent observations”. Do not hard-code any G literal here; panel modules register their own.
- `filter-applicability.js` (new): pure `applicability({panel, spec, scope, schema, ignoredFilters})` returning `{applicable, labels, message, supportedFilters, unsupportedFilters}`. Compute supported filters as the intersection of the chosen measure's published dims and the route's declared scope filters; add any `response.ignored_filters` entries. Map `repo_id`/`session_repo` to `repository`, `kind` to `document kind`, and other filters to their visible advanced-filter name. Sort labels alphabetically and produce the exact refusal sentence. Provide `UNSUPPORTED_FILTER_MESSAGE` and `applicabilityState()` for the panel frame.
- `registry.js`: accept optional `caption` (string or function) and `applies`/`filterExceptions` declarations without adding required fields. Do not weaken the existing required-field or chart-name validation. `validateRegistry` must not fail a panel solely because its caption is registered later.
- `panel-frame.js`: add a dedicated caption element in the frame order title → caption → controls → body → population/coverage, sourced from `captionFor` and re-rendered on load. On an applicability refusal, clear the body (no marks), set `data-state="unsupported"` (or the shared unavailable state), keep the caption visible, and render the exact F sentence with a focusable `Edit filters` action supplied by the caller. A malformed or absent caption remains an explicit refusal. Keep T1/T3/T5 status vocabulary.
- `panel-state.js`: add one applicability classification that reuses `unsupportedState` semantics; do not add a competing state list.
- `p10-shared.js`: export `mountPanelViews({panelId, chart, table, doc, defaultView = 'chart'})` returning a host with `Show table`/`Show chart` buttons, `data-view` on the host, and local-only switching; export `panelViewsEnabled` so a panel can omit the toggle only when `panel.table === true` and has no chart. Preserve `measureMeta`, `chooserModel` and `renderChooser` behaviour.
- `charts/table.js`: extend `tableModel`/`createTable` to accept an explicit `columns` array (label, unit, key, numeric) and `select: false`, while preserving the current default model for existing callers. Do not change the chart kit.
- `charts/legend.js` and `charts/styles.js`: only add exported helpers the shared contract needs (for example a token reader for V3 assertions). No behaviour change to legend intent.
- Update only the two new tests named above.

### Keep untouched

`web/js/app.js`, `web/js/boards/*`, every `web/js/panels/p10-*`/`p11-*`/`p12-*` registration, every panel module, every CSS file, every explorer, and every existing test. The frame must not start reading URL/tenant state; it continues to receive `scope`, `spec`, `schema` and `tenant` from its caller. No chart library, vendored uPlot, router or transport change.

## Done evidence

Identify the failing check first; the new tests must fail before their modules exist.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/captions-unit.test.mjs tests/operable-chrome/filter-applicability-unit.test.mjs` → all pass. They must assert: every template expands with real measure/group/unit labels and no snake_case; `repository`/`document kind` labels; alphabetical label order; the exact F refusal sentence; a missing caption is an explicit refusal; chart default and `Show table`/`Show chart` toggle without a fetch.
- `cd packages/yakka-analytics && node --test tests/workspace/engine.test.mjs tests/operable-chrome/activity-population-unit.test.mjs` → still pass, proving the panel-state and table extensions did not break existing callers.
- Observable: a synthetic panel with no registered caption renders `No plain-language caption is registered for …`, and a panel with an unsupported active filter renders no body marks while its caption stays visible.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` when running browser work), `PUBLIC_CANVAS_TEST_MODE=true` for any Chromium use, no animation/timing tests, no fixed sleeps, no `/tmp` (use a gitignored `.scratch/` under the worktree), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. This repo runs `node --test`; if a Vitest runner is ever used, `--maxWorkers=3`. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
