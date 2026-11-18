# Brief: 10-05 — Cohort and comparison wiring across the P10 presets

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/p10-shared.js`, `trend-columns.js`, `trend-lines.js`, `trend-multiples.js`, `rhythm.js`, `dist-ranges.js`, `dist-hist.js`, `dist-ecdf.js`, `rank.js`, `score-ranges.js`, `score-trend.js`, `score-strips.js`, `band-mix.js`, `treemap.js`, `mix.js`, `p10-trends.js`, `p10-compare.js`, `p10-quality.js`, `p10-cost.js`, `p10-tools.js`, `packages/yakka-analytics/web/js/core/selection-tray.js`, `packages/yakka-analytics/tests/trends-quality/cohort-compare.test.mjs`, and `docs/plans/20-analytics-reset/reports/10-05-cohort-compare.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/10-05-cohort-compare.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 10-01, 10-02, 10-03 and 10-04.
Runs alongside: nothing; it runs after every panel exists.
Budget: 16 files to read, about 650 lines to change, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 10 outcome, the Interaction model, the preset matrix, and the Carry notes from Phases 8 and 9.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 `cohort=`, time-cohort resolution and typed populations; 17.3.1 in full (scope elements, Boolean meaning, identity, routes, relation and association reporting).
3. `docs/plans/20-analytics-reset/CONTRACTS.md` — 7.2/17.1 for the window and `/query`, `/distribution`, `/scores`, `/score-series`, `/entities`; `/baselines` refuses a cohort.
4. `packages/yakka-analytics/web/js/panels/p10-shared.js` and the P10 panels — the `requestParams`/`comparisonPlan` seams and how each panel renders its population.
5. `packages/yakka-analytics/web/js/core/{selection-model,selection-tray,chips}.js` and `contract/url-state.js` — cohort encode/decode, build, slot, chip and scope state.
6. `packages/yakka-analytics/tests/trends-quality/{fixture,browser}.mjs`, `packages/yakka-analytics/tests/workspace/{harness,stub-api}.mjs` — the P10 fixture, request log and browser pattern.
7. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — Phase 6 Carried on the single `content_hash` population and the legacy `exclude=band:<check>` cut; Phase 9 Carried on cohort forwarding.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Wire the `ca`–`cd` cohorts and the two comparison modes into every P10 panel request so cohort chips and deep links actually requery, comparisons show both typed populations and coverage, a mismatched cohort grain is refused with a reason, and the legacy band-exclude ambiguity cannot silently change the selected population.

## Contract

- CONTRACTS.md 17.3.1: `cohort=` is canonical JSON `{v:1, grain, scope:{from,to,tz,include,exclude}, predicate, op, source?}`. It is accepted by `/query`, `/distribution`, `/summary`, `/series`, `/conversations`, `/executions`, `/scores`, `/score-series`, `/explore`, `/activity` and `/entities`; `/baselines`, `/facets`, `/entity`, `/conversation`, `/content` and `/schema` refuse it. A cohort with `op=include` restricts the target to the resolved sessions; `op=exclude` subtracts them after resolution; `scope.exclude` narrows the source before the predicate and is not the same as `op`.
- CONTRACTS.md 17.3.1: scope elements are `{lens, values}` arrays; a lens name can contain a colon (`band:<check>`). The legacy `exclude=<dim>:<value>` string cuts at the first colon, so it must not be used for a multi-colon lens. A known lens outside the grain's `filters` is `unsupported_join`, never ignored.
- CONTRACTS.md 17.3: typed populations are `{grain, unit, scope_n, cohort_n, eligible_n, returned_n, missing_by_reason, relation}` per check/measure; `relation` carries `source_grain`, `target_grain`, `mapping`, `op`, `resolved_n`, `resolved_unit`, `associations`, and `target_sessions` where the target unit is not sessions. Counts in different units are never equated.
- DESIGN.md Phase 10: finite period/cohort comparisons show both populations and coverage; different grains are not compared and the panel says so; compare plus split is small multiples; `cmp=period` is disabled for `all` with the existing copy.
- Carried from Phase 9: cohort forwarding to panel requests belongs here.
- Phase 6 Carried: every quality request selects one check, so one `content_hash` population is enough; `band:<check>` chips must use the structured scope path.

## Changes

- `p10-shared.js`:
  - `cohortParams(scope)`: decode `scope.cohorts.ca`–`cd` with `decodeCohort`; return the primary cohort text (first defined slot in A–D order) or null. A malformed slot is named by slot and not sent; it never silently disappears.
  - `comparisonPlan(scope)`: return one of:
    - `{mode:'none'}` when no compare mode and no cohort is defined;
    - `{mode:'single', cohort}` when a cohort exists and `scope.cmp !== 'cohorts'` (the cohort drives one restricted queried population);
    - `{mode:'period', current, previous}` for `cmp=period` over a finite window; `previous` is null and `{unsupported:'Choose a finite period to compare periods.'}` for `all`/unbounded;
    - `{mode:'cohorts', a, b, aLabel, bLabel}` for `cmp=cohorts`; with one cohort defined, compare it with the unrestricted scope and label the second population “all in scope”; with two, A is `ca` and B is `cb`; more than two defined is named “compare shows A and B; clear unused cohorts” rather than silently choosing.
    - Both defined cohorts must share `grain`; if not, return `{unsupported:'Cohort A is <grain> and Cohort B is <grain>; compare cohorts from the same source grain.'}` and issue no request.
  - `requestParams({scope, spec})` adds `cohort` from `cohortParams` for every route that accepts it. `/baselines` is explicitly excluded. Do not append a cohort twice (one slot or A/B only).
  - `comparisonSummary({plan, sides, unit})`: render both sides' `scope_n`/`cohort_n`/`eligible_n`/`returned_n`, the population unit, and each side's coverage facts (`missing_by_reason`, `unpriced`, `unscored`, `unattributed`, `(mixed)`/`(none)`/`(multi)` counts when supplied). A difference may be shown only next to both sides; never as a lone value. If a side is missing, say so rather than treating it as zero.
  - Ensure every P10 panel obtains its `URLSearchParams` through `requestParams`; if a panel bypasses it, route it through the seam now. Do not change the panels' chart choices or table values.
- `core/selection-tray.js`: make `splitExclude(value)` resolve a known multi-colon lens before cutting:
  - pass the current `{schema, grain}` (or the known lens set) to the splitter; if a published lens name `L` (for the grain or the shared filter list) has `value === L || value.startsWith(L + ':')`, split as `{lens:L, value:value.slice(L.length+1)}`, longest first;
  - otherwise keep the first-colon behaviour.
  This makes `exclude=band:quality:low` produce `{lens:'band:quality', value:'low'}` when the grain publishes `band:quality`. Keep `scope.include`/`scope.exclude` as arrays of structured `{lens,values}`; never parse a `band:<check>` chip back through a delimiter that loses the check.
- Cohort-driven requery:
  - A single cohort restricts all P10 panels via `cohort=`; the population line shows `relation.resolved_n` and the typed unit.
  - `cmp=cohorts` issues two requests per panel (A and B) through `comparisonPlan`; the panel renders both populations and their coverage, not a single delta. A cost panel's unpriced/lower-bound fact is per side; a quality panel's `missing_by_reason.unscored` is per side; a distribution's `omitted_unpriced` and `(mixed)/(none)/(multi)` counts are per side.
  - `cmp=period` keeps the equal-length previous window; it must not use the cohort parameter. A panel with a cohort plus `cmp=period` applies the same frozen cohort to both periods; if the cohort grain differs from the panel's target grain, the server resolves it per 17.3.1 and the panel labels the relation.
  - Compare plus a non-empty split renders small multiples (one current/previous group per split value), not an overlay. If a panel cannot produce that shape for a supported split, it is a defect; report it.
  - `win=all` + `cmp=period` shows the existing “Choose a finite period to compare periods.” copy, has no previous side, and sends no previous-window request.
- Do not send `cohort` to `/baselines`. Do not send `cmp`, `win`, `cohorts`, `pick`, `sel` or `hide` as shared filters; only the contract's filter names and `cohort` go on the wire.

### Keep untouched

- The cohort grammar, predicate budgets, `cohortDefinition`/`encodeCohort`/`decodeCohort`, the tray labels and the four-slot limit. This unit routes requests; it does not change what a cohort means.
- The panels' chart types, measures, labels, preset lists and table renderers except where the request must be routed through the shared seam.
- The inspector, chips and router contracts; the chart elements' defaults.
- No Go change, no new grain/join/route/dependency/gesture/contract.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test tests/trends-quality/cohort-compare.test.mjs` (workdir `packages/yakka-analytics`) → pass, including Chromium:
  - a cohort chip made from a panel selection causes `/query`, `/distribution`, `/scores`, `/score-series` and/or `/entities` requests to carry the same canonical `cohort=` (proved from the test-only stub URL log), with `op` preserved; `/baselines` carries none;
  - the panel population line names `relation.resolved_n` in sessions and the target unit, and shows both sides for `cmp=cohorts` and both periods for `cmp=period`;
  - an `exclude=band:<check>` chip becomes the structured lens `band:<check>` and a band cohort resolves; a legacy first-colon split would have changed the population, so the fixture includes a check with a colon-sensitive name;
  - A and B with different source grains show the named refusal and issue no comparison request; `win=all&cmp=period` shows the existing copy and issues no previous-window request; a single cohort plus `cmp=period` applies to both periods;
  - compare + split renders more than one small-multiple group; no console/page/CSP error; ≤4 requests in flight.
- Pure checks: `comparisonPlan` for none/single/period/cohorts/different-grain/all; `splitExclude` for `band:quality:low`, `repo_id:r1` and an unknown two-colon value; `requestParams` never duplicates `cohort` and never includes `cmp`.
- `NODE_PATH=… node --test tests/trends-quality/*.test.mjs` → the whole P10 suite stays green.
- `git diff --check` clean; the report records the exact before/after outputs, files read/changed, fixture counts and any deviation.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
