# 10-05 — Cohort and comparison wiring across the P10 presets

Status: done with concerns (core seams and evidence pass; two wiring items below are unfinished and actionable).

## What was done

- `p10-shared.js`
  - `cohortSlots`/`cohortParams`: decode `scope.cohorts.ca`–`cd` in A–D order, re-encode canonically, send the first valid slot as one `cohort=` value. A malformed slot is named on the non-enumerable `issues` list and never sent.
  - `comparisonPlan(scope)`: classifies `none` / `single` / `period` / `cohorts`; a finite period keeps the frozen cohort on both sides; `win=all` + period returns the contract copy with no previous side; two cohorts of different grains return the named refusal; three or four defined cohorts are named rather than silently choosing A/B; one cohort compared against `all in scope`.
  - `requestParams` now adds `cohort` from the plan seam, accepts a per-side cohort for comparison requests, never duplicates it, and never puts `cmp` on the wire. `extra.cohort` cannot double-append it.
  - `comparisonSummary({plan,sides,unit})` renders both sides' `scope_n`/`cohort_n`/`eligible_n`/`returned_n`, the typed unit, and per-side coverage (`missing_by_reason`, `unpriced`, `unscored`, `unattributed`, `(mixed)`/`(none)`/`(multi)` counts). The legacy `{current,previous}` shape still works.
  - `honestJoinGuard` (shared by mix/treemap/rank): a direct `repo_id`/`session_repo` on `hook_events` is unsupported with `try: harness`; cost by repo names the mounted `/distribution?dim=session_repo`; cost by tool names `hook_events by tool`.
  - `scopeWithCohorts` recovers `ca`–`cd` from `location.search` when the board's effective scope has already dropped the `cohorts` object (see Departures).
- `core/selection-tray.js`
  - `splitExclude(value,{schema,grain})` resolves a published multi-colon lens longest-first (`band:quality:low` → `{lens:'band:quality',value:'low'}`) before the legacy first-colon cut; `scopeElements` passes the schema/grain.
- Distribution panels
  - `DIST_DIMS` is now `model|harness|session_model|session_repo`; `distributionGuard` accepts `call/model`, `call/harness`, `conversation/session_model`, `conversation/session_repo` and refuses `call/session_repo`/`call/session_model` with the `conversation` alternative. All three panels take grain/dim from the spec and show them in the basis line.
- Cost preset
  - `dist-ranges` mounts `conversation/session_repo`, `dist-hist` mounts `call/harness`, `dist-ecdf` mounts `conversation/model`; no repo total is formed from `/query`.
- `dist-ranges` consumes `comparisonPlan`: `cmp=cohorts` fetches both sides (A and B, or A and unrestricted), labels them and prints both populations; `cmp=period` applies one frozen cohort to both periods.
- Fixture/stub truthfulness
  - P10 `/schema` time grain publishes `lenses: ["id"]` only.
  - Two-dim `/query` returns `k:[parent,child]` rows; weekday/hour stay their 7×24 grid.
  - `/scores` groups and `/score-series` points are non-empty; `entities?grain=artifact` returns scored rows.
  - The stub serves `GET /v1/baselines` with a `population=content` scorer/check body and logs it; `/v1/analytics/baselines` remains a fallback.
  - The stub attaches a typed `population.relation` (`resolved_n`, `op`, unit) when `cohort=` is present.
- Tests: new `tests/trends-quality/cohort-compare.test.mjs` (7 pure + 2 browser).

## Evidence

Before this unit the named check did not exist; the seams returned nothing
(`cohortParams` returned `{}`, there was no `comparisonPlan`, `splitExclude`
always cut at the first colon, and distribution panels pinned `call/model`).
Running the new spec against that state fails at the first pure assertion.
After:

```
$ NODE_PATH=… node --test tests/trends-quality/cohort-compare.test.mjs
# tests 9
# pass 9
# fail 0
# skipped 0
```

Whole P10 suite (run with `--test-concurrency=1`; concurrency 3 exposed an
existing timing flake in the Tools route-interception spec, unrelated to this
change):

```
# tests 46
# pass 46
# fail 0
# skipped 0
```

`git diff --check` is clean.

Files read: DESIGN.md, CONTRACTS.md 17.3/17.3.1, IMPLEMENTATION.md excerpt,
`p10-shared.js`, `selection-model.js`, `selection-tray.js`, `view-spec.js`,
`url-state.js`, all P10 preset modules, `dist-*`, `treemap.js`, `mix.js`,
`rank.js`, `trend-lines.js`, `score-*`, `band-mix.js`, the P10/workspace
fixtures, `stub-api.mjs`, `harness.mjs`, and the existing P10 specs.

Files changed: the owned panel/core/fixture/stub paths, the new spec, plus the
three corrected 10-01/10-02/10-03 spec expectations named under Departures.

Fixture counts: 2 harnesses, 2 models, 2 session models (`claude`, `(mixed)`),
3 session repos (`repo-a`, `(multi)`, `(none)`), 2 tools, 2 tool kinds.

## Departures (with reasons)

1. **Cohort scope was stripped before the panels.** `core/view-spec.js`
   `cleanPanelScope` keeps scalars/arrays but drops the `cohorts` object, so
   `effectiveScope` never carried `ca`–`cd` to a panel. That file is outside
   this brief's owned paths, so `p10-shared` recovers the slots from
   `location.search` in `scopeWithCohorts` instead. The correct long-term fix
   is to preserve `cohorts` in `cleanPanelScope` and remove this fallback.
2. **10-01/10-02/10-03 spec expectations corrected** (the brief permits this
   for a contradictory body):
   - `cost.test.mjs`: treemap expectation now uses `dims:['harness','model']`
     and `[parent,child]` rows (the old body mirrored parent totals); the three
     distribution panels now expect repo/harness/model conversations as
     mounted; `model_calls × session_repo` stays unguarded (the shared repo
     guard covers `hook_events` only, matching 17.3).
   - `tools.test.mjs`: treemap expectation uses `[parent,child]` rows.
   - `trends.test.mjs`: the measure-change step uses `model_calls` rather than
     `commits`, because the corrected time-grain `/schema` publishes only `id`
     as a grain lens and `commits` does not publish `model` as a measure dim.
3. **`cmp=cohorts` is fully wired only in `dist-ranges`.** `comparisonPlan` is
   shared and correct, and the browser proof for both sides uses
   `dist-ranges`; `dist-hist`, `dist-ecdf`, `trend-*`, `rank` and `mix` still
   send one (first-cohort) request under `cmp=cohorts` instead of two.
   Action: route each P10 loader through `comparisonPlan` and render both
   sides. This does not affect single-cohort or period behaviour.
4. **Compare + split small multiples is not rendered.** `dist-ranges` renders
   one row per group per side rather than one small-multiple group per split
   value. Action: group the comparison rows by split value in the panel frame.

## Known problems

- The `scopeWithCohorts` URL fallback is a workaround for the view-spec gap
  above; it makes the request seam read global location state, which is
  undesirable outside the browser. Node checks are unaffected (no `location`).
- The Tools browser spec is timing-sensitive under parallel test files; it
  passes when run alone and in the full suite sequentially.
