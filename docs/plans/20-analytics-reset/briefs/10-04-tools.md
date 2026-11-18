# Brief: 10-04 — Tools preset

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/p10-tools.js`, `web/css/tools.css`, `packages/yakka-analytics/tests/trends-quality/tools.test.mjs`, and `docs/plans/20-analytics-reset/reports/10-04-tools.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/10-04-tools.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 10-01, 10-03.
Runs alongside: nothing; it reuses 10-03's categorical panels and owns only the tool registration and proof.
Budget: 8 files to read, about 450 lines to change, 20 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 10 outcome, the Tools preset row and the panel catalog.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 `hook_events` measure/lenses, 17.3.1 `unsupported_join`, and 17.5.
3. `docs/plans/20-analytics-reset/CONTRACTS.md` — 7.2 `/query` dims for `hook_events` and `/distribution`.
4. `packages/yakka-analytics/web/js/panels/p10-shared.js`, `rank.js`, `rhythm.js`, `treemap.js`, `mix.js` — the panels and helpers you compose.
5. `packages/yakka-analytics/web/js/charts/{yk-bars,yk-matrix,yk-treemap}.js` — model builders only.
6. `packages/yakka-analytics/tests/trends-quality/{fixture,browser}.mjs` and `packages/yakka-analytics/tests/workspace/{harness,stub-api}.mjs` — the P10 fixture and browser pattern.
7. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — Phase 3 Carried on hook facts carrying no `repo_id`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Deliver the Tools preset so tool use is investigated by the dimensions the server actually measures, with unknown/missing tool metadata kept distinct and any tempting but unsupported cost join refused by name.

## Contract

- Tools preset panels (DESIGN.md): `mix`, `treemap`, `rank`, `rhythm`. The panel ids are the shared 10-01/10-03 panels; this unit adds only their Tools preset specs and registration.
- CONTRACTS.md 17.3: `hook_events` is a `time` measure; its published dims are `harness`, `repo_id`, `norm_event`, `event`, `tool`, `tool_kind`, `conversation_id`, plus `hour_of_day`/`weekday`. Hook facts carry no `repo_id` (phase 3 Known issue), so a tool view must not present a repo split as if it had values.
- CONTRACTS.md 17.3.1: a measure/lens not published for the grain is `unsupported_join` with reason and `try`; the UI must not request it. There is no cost/tool join. A cost-by-tool view is refused with “hook_events and cost_usd are different measures; use hook_events by tool or cost by model/harness”, not rendered as zero or as a client-side join.
- CONTRACTS.md 17.5: zero-based bars, a legend for two or more series, units/time basis, a table for every chart, `(mixed)`/`(none)`/`(multi)`/`unknown` distinct.
- `rhythm` is the existing 10-01 heatmap panel over `hook_events` by `weekday`×`hour_of_day`; `rank` and `treemap`/`mix` are the shared panels with tool-specific specs.

## Changes

- `p10-tools.js`: register the four panel ids (all already registered by earlier units, so registration is a no-op lookup check) and the `tools` preset with canonical preset specs:
  - `mix`: time grain, `hook_events`, split `tool_kind` (stacked), with a `tool` alternative only when `/schema` publishes it.
  - `treemap`: time grain, `hook_events`, parent `harness`, child `tool` (or `tool_kind` when `tool` is absent), no cost.
  - `rank`: time grain, `hook_events`, split `tool`, ranked.
  - `rhythm`: time grain, `hook_events`, `weekday`×`hour_of_day` heatmap.
  If a panel id is missing the module must throw at registration, not register a preset that names an unregistered panel.
- Add the Tools-specific chooser restrictions in the module's preset specs and panel capability notes:
  - Do not offer `repo_id` as a tool split/tool treemap parent; if a user asks for it, the shared chooser returns the unsupported reason “hook facts carry no repo_id” with `try: harness`.
  - Do not offer a cost measure in any Tools panel. A cost-by-tool request is named unsupported as above; the panel's note offers the supported hook_events-by-tool view.
  - Keep `tool` and `tool_kind` distinct: a tool with no kind is `unknown`/empty as the server returns it, never folded into another group.
- `tools.css`: only the tool-specific notes/labels; no duplicate colour values.

### Keep untouched

- The shared panels (`mix.js`, `treemap.js`, `rank.js`, `rhythm.js`) and the 10-01 helpers. Configure them through preset specs; if a genuine shared defect appears, report it rather than editing another unit's path.
- The Cost, Quality, Trends and Compare presets and their specs.
- The chart elements' defaults and the frame/inspector/tray contracts.
- No Go change, no new route/grain/join/dependency, no client-side join across routes.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test tests/trends-quality/tools.test.mjs` (workdir `packages/yakka-analytics`) → pass, including Chromium: `/b/tools` settles all four frames; changing tool→tool_kind regroups and surviving styles hold; the mixed/unknown groups are distinct; the treemap, rank and mix tables match `tests/trends-quality/fixture.mjs`; `rhythm` shows the weekday/hour grid with the shared-key note; a cost-by-tool request and a repo tool split are named unsupported with their `try`; no console/page/CSP error; ≤4 in flight.
- `node --test tests/trends-quality/{trends,compare,quality,cost}.test.mjs` → the other P10 units stay green.
- `git diff --check` clean; the report records the exact before/after outputs, files read/changed, fixture counts and any deviation.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
