# Report 12-05 — `/plans` list explorer

## Status: done

`/plans` is now a real explorer: a server-sorted, cursor-paged ranked plan table
plus the delivered `scatter-plan` panel over the same scope, with plan inspect,
Open to `/plans/<repo>/<plan>`, and a rectangle that becomes a typed plan cohort
in the shared tray. No server, Go, migration, dependency, route, grain, join,
gesture or contract was added; no live server, deploy or secret was used.

## What changed

- `web/js/core/router.js`: `/plans` moved from `NAMED_ROUTES` to
  `EXPLORER_PATHS` (`explorer: 'plans'`), `loadExplorer('plans')` imports the new
  module, and `^/plans/<repo>/<plan>$` stays a Phase 12 named destination for
  12-06. `/plans/<one-segment>` stays not-found; `/artifact` and every account
  route are unchanged.
- `web/js/explorers/plans.js` (new): `title = 'Plans'`, `phase = 12`, `render`,
  its own scheduler/transport, one route-scoped `AbortController`, one `/me`
  for tenant and one `/schema` for `budgets.page_max`. Pure helpers:
  `parseSort`, `allowedMeasures`, `allowedFilters`, `readScope`,
  `unappliedFilter`, `planListParams`, `planPageParams`, `cohortParam`,
  `mapPlanListResponse`, `mergePlanRows`, `planRowKey`, `isMalformedPlanRow`,
  `identityFromKey`, `formatPlanCost`, `completeShareText`,
  `executionShapeText`, `designScoreText`, `populationText`,
  `planCoverageNotes`, `planScatterSpec`, `scatterSampleNote`, `flatScope`.
  Ranked table columns: `repo/plan`, associated cost (lower-bound / all-unpriced
  / `$0.00` distinct), sessions, shared sessions, artifacts, versions,
  complete/unreported/started, complete share (`no executions` when null),
  latest `design_score:<check>` values, last observed. Server sort control over
  the published plan measures with a named `by associated cost`
  (`associated_cost_usd:desc`) option that shows the overlap banner. Server
  `Load more` cursor; appending never re-sorts or sums. "N of M plans" from the
  server population; null measures are counted, never zero-filled; a malformed
  composite id renders an error row, not a silent skip.
- Scatter: mounts the registered `scatter-plan` panel through
  `createPanelFrame` with `planScatterSpec()` and a flat scope (window, lenses,
  excludes, first valid cohort). `inspect` parses the canonical key
  (`{"plan":…,"repo_id":…}`) and opens one `createInspector` with grain `plan`,
  plan facts, `planDestination(identity)` and population. `select` ignores the
  raw `scatter-rectangle` event and keeps the panel's re-emitted
  `source: 'scatter-predicate'` predicate with its server counts on one
  `createSelectionTray` for grain `plan`; Make cohort/Filter all/Exclude/Clear
  write the standard `ca`–`cd` slots and the table/scatter refetch under the new
  scope. No second scatter code.
- `web/css/plans.css` (new): explorer chrome only (sort bar, overlap banner,
  table, footer, scatter notes); no chart styling.
- `tests/workspace/fixture.mjs`: additive P12 plan scene — `p12PlanScatter`
  (whole population, sampled variant with fixed rule and whole-population
  marginals) and `p12PlanAggregate` (bounded count, `cohort_n: 3` with a
  predicate), plus a cohort `relation` on `p12PlanEntities`. P10/P11 bodies are
  byte-identical.
- `tests/workspace/stub-api.mjs`: P12 plan `mode=scatter|aggregate`, a
  `planSampled` control, `planError` and `empty` plan-list scenes, and `cohort`
  forwarding for the plan list.
- `tests/workspace/engine.test.mjs`: `/plans` is an explorer; detail stays named
  Phase 12; `/plans/one-segment` is not-found.
- `tests/workspace/acceptance.test.mjs`: `/plans` settles `plans-list` and
  `scatter-plan` with the P12 scene; both `/plans` and `/b/workflow` are asserted
  delivered (no `Delivered in Phase` text); `named` count is 0; Start links stay
  15 and legacy disabled stay 10.
- `tests/plans-artifacts/plans-list.test.mjs` (new): 8 pure and 4 Chromium
  checks.

## Check output

Before (identified failing check at HEAD `f8b06b4`):

```
$ git show HEAD:packages/yakka-analytics/web/js/core/router.js | grep -n "NAMED_ROUTES\|/plans"
12:const NAMED_ROUTES = [
13:  { pattern: /^\/plans(?:\/[^/]+\/[^/]+)?$/, title: 'Plans', phase: 12 }
$ git ls-tree --name-only HEAD packages/yakka-analytics/tests/plans-artifacts/
… no plans-list.test.mjs …
```

After:

```
$ node --test tests/plans-artifacts/plans-list.test.mjs
# tests 12  # pass 12  # fail 0
$ NODE_OPTIONS=--max-old-space-size=8192 \
  NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 \
  tests/plans-artifacts/plans-list.test.mjs
# tests 12  # pass 12  # fail 0        (maxInFlight <= 4 in every browser case)
$ node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs
# tests 16  # pass 16  # fail 0        (/b/workflow stays delivered)
$ node --test tests/workspace/*.test.mjs
# tests 72  # pass 72  # fail 0
$ node --test tests/scatter-sessions/*.test.mjs
# tests 42  # pass 42  # fail 0
$ node --test tests/trends-quality/*.test.mjs
# tests 54  # pass 54  # fail 0
$ node --test tests/plans-artifacts/*.test.mjs
# tests 50  # pass 50  # fail 0
$ git diff --check
(diff-check 0; no /tmp; no fixed sleeps or animation assertions)
```

## Exact request parameters

Plan list (`transport.get('entities', …)`):

```
grain=plan&tz=<tz>&[all=1|from=…&to=…]&repo_id=…&harness=…&session_model=…
&exclude=<lens:value>…&cohort=<canonical JSON>&sort=<measure>:<asc|desc>
&limit=<budgets.page_max>&cursor=<opaque>
```

Only the declared plan filters (`repo_id`, `harness`, `session_model`), the
frozen window, the first valid cohort, `sort`, `limit` and `cursor` are sent; an
undeclared filter/`tool` is never forwarded.

Plan scatter (the delivered `scatter-plan` seam):

```
grain=plan&mode=scatter&fields=associated_cost_usd,artifacts&tz=<tz>
&[all=1|from=…&to=…]&repo_id=…&harness=…&exclude=…&cohort=…
```

The rectangle count is `grain=plan&mode=aggregate&stat=count&predicate=<canonical
AND of the two ranges>`, and the tray shows the server's `cohort_n`.

## Cohort URL written by a rectangle

Make cohort A on a scatter rectangle pushes `/plans?win=all&ca=<encoded>` where
the decoded cohort is `{v:1, grain:"plan", op:"include",
scope:{from, to, tz, include:[…], exclude:[…]},
predicate:{and:[{range:{measure:"associated_cost_usd",lo,hi}},
{range:{measure:"artifacts",lo,hi}}]}}`. The table then refetches with that
`cohort=`.

## Sampled state

With the `planSampled` control the scatter response is `sampled: true`,
`sample_rule: "lowest SHA-256 of repo_id and plan"`, `population_n: 10`,
`returned_n: 5`, whole-population `marginals`. The panel renders
"sample of 5 of 10; marginals are the whole population" and the frame shows the
`sampled` badge; the null-axis plan stays in the population and out of the
marks (4 drawn of 5 returned).

## Deviations from the brief and why

- **Design score "with scorer"**: plan list rows carry `design_score:<check>` but
  no per-check scorer (17.3's plan lenses are `repo_id`, `harness`,
  `session_model`, `id`). The table shows each check and score and labels
  "scorer not served on plan rows"; it does not invent a scorer or add a
  join/request. This is a brief/contract contradiction, reported rather than
  resolved silently.
- **Scatter `session_model`**: the brief says the scatter takes the same lenses.
  The shared `requestParams` seam carries only its `FILTER_KEYS` (which omit
  `session_model`); the modules that would carry it are outside this unit's
  owned paths. The explorer therefore forwards repo_id/harness/excludes/cohort
  and renders an explicit "session_model is not applied here" note instead of
  dropping it silently.
- **Test fixture import**: `plans-list.test.mjs` imports `p12PlanScatter` from
  `tests/workspace/fixture.mjs` directly because
  `tests/plans-artifacts/browser.mjs` is not an owned path and does not export
  it; that file was not modified.

## Unfinished / deferred

- `/plans/<repo>/<plan>` detail, design parsing, collections and timeline are
  12-06's work; the route stays named Phase 12 and Open reaches it.
- The `scatter-plan` "the plan explorer arrives in Phase 12" notice is retained
  as the brief requires; 12-07 updates it.

## Known problems

- None beyond the two deviations above.
