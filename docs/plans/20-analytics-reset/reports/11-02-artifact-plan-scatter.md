# 11-02 — Artifact and plan scatter

Status: `done`. The artifact and plan scatters exist as schema-valid panels on
the 11-01 request, marginal and rectangle-to-tray seam, and both register
without delivering the `scatter` preset. The new pure spec passes 9/9; the
11-01 spec 10/10, the Phase 9 workspace suite 72/72 and the Phase 10 suite
54/54. Browser proof of the board is deferred to 11-03, as the brief requires.
No Go, route, grain, join, dependency, gesture or contract was added.

## What changed

- `web/js/panels/scatter-artifact.js` (new): `artifactAxes(schema, catalogue)`
  offers only the 17.3 artifact measures (`versions`,
  `distinct_writing_sessions`, `first_ts`, `last_ts`, `content_bytes`,
  `score:<check>`, `writing_session_*`), validates `score:<check>` against the
  `/scores?kind=` catalogue (an unknown check is `unsupported` with the nearest
  check) and never offers `model`/`id` numerically. `artifactColours(schema)`
  returns only `kind`, `plan`, `repo_id`, `harness`, `session_model`, `source`,
  `screen_verdict`, `scorer`, `band:<check>`. `artifactIdentity(row)` is
  `{repo_id, path, hash}` and `artifactDestination` is
  `/artifact?repo_id=&path=&hash=`. `artifactPoint(row, spec)` maps to a chart
  point and marks a null axis `drawn:false` instead of zero. `artifactMissing`
  labels `unscored`, `content_unavailable`, null writing-session cost,
  lower-bound cost and unpriced calls separately. The panel defaults to x
  `writing_session_cost_usd`, y `score:<check>`, colour `session_model`, no
  size, with a kind/check chooser fed by `/scores?kind=`; it renders
  `<yk-chart type="scatter">`, both marginals, a table and the
  population/sample/basis sentences. Rectangle, union and Alt-subtraction are
  the 11-01 path, and the exact population is one bounded aggregate count.
- `web/js/panels/scatter-plan.js` (new): `planAxes(schema, catalogue)` offers
  only plan measures `/schema` publishes (with `design_score:<check>` validated
  when a catalogue is supplied), `planColours` returns only `repo_id`,
  `harness`, `session_model`, and `planPoint` keeps a null `associated_cost_usd`
  or `complete_share` out of the marks. `planOverlap` builds the non-additive
  banner with `shared_sessions` and `unpriced_calls`; `planIdentity`/
  `planDestination` name `/plans/<repo>/<plan>` (Phase 12). The panel defaults
  to x `associated_cost_usd`, y `artifacts`, colour `repo_id`, and reuses the
  same chooser, marginals, table, rectangle/tray and bounded count.
- `web/js/panels/p11-scatter.js`: appends `scatter-artifact` and
  `scatter-plan` to `P11_SCATTER_PANELS`; the preset stays unregistered.
- `web/css/scatter.css`: the overlap banner and note styles only.
- `tests/workspace/fixture.mjs` and `stub-api.mjs` (additive): P11 artifact and
  plan scatter bodies, a P11 `/scores` catalogue, and grain-aware P11
  entities/scatter dispatch. Every default and P10 body is unchanged.
- `tests/scatter-sessions/artifact-plan.test.mjs` (new): axis/colour offers,
  catalogue rejection, request fields, identity/point mapping, null and
  lower-bound labels, plan overlap, table/registration.

No edit was needed in `scatter-shared.js`, `scatter-session.js`, the
selection/tray seam, the chart kit, the presets or `app.js`.

## Fixture rows

- Artifact (6 rows, `unit: artifact`, `scope_n` 6, `eligible_n` 5, one null
  default axis): two kinds (design, brief), two checks (clarity, structure),
  two writing-session models (claude, gpt), one `unscored` (brief/gpt), one
  unpriced writing session (`writing_session_cost_usd` null, 3 unpriced calls),
  one `lower_bound` cost and one `content_unavailable` blob. Two design rows
  share the `score:clarity` check.
- Plan (2 rows, `unit: plan`, `scope_n` 2, `eligible_n` 1): two plans sharing
  a session (`shared_sessions` 1 each), `complete_share` 0.75 on one and null
  with `no_executions` on the other, one null (unpriced) `associated_cost_usd`
  with 5 `unpriced_calls`, `design_score:clarity` present (0.80) and null.

## Checks: before and after

Before this unit the named spec did not exist and the helpers were absent, so
the first run failed at import:

```
$ NODE_OPTIONS=--max-old-space-size=8192 node --test tests/scatter-sessions/artifact-plan.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../web/js/panels/scatter-artifact.js'
# tests 1  # pass 0  # fail 1
```

The tree before the change was green: scatter 10/10, workspace 72/72,
trends-quality 54/54.

After (workdir `packages/yakka-analytics`, `NODE_OPTIONS=--max-old-space-size=8192`):

```
$ node --test tests/scatter-sessions/artifact-plan.test.mjs
# tests 9  # pass 9  # fail 0  # skipped 0

$ node --test tests/scatter-sessions/scatter.test.mjs
# tests 10  # pass 10  # fail 0  # skipped 0

$ node --test tests/workspace/*.test.mjs
# tests 72  # pass 72  # fail 0  # skipped 0

$ node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 54  # pass 54  # fail 0  # skipped 0
```

`git diff --check` is clean; no `/tmp` writes; no fixed sleep or animation
assertion. The Phase 10 Tools route-interception spec is timing-sensitive: run
while the heavy workspace suite ran in another process it failed once (53/54),
and its standalone sequential run above is 54/54, matching the constraint
10-06 and 11-01 already recorded.

## Deferred browser proof

No browser spec was written or run: the brief defers the delivered-board proof
to 11-03, when the four-panel `scatter` preset is registered and `/b/scatter`
stops being a named destination. Nothing was unreachable, so no gate is
recorded. `playwright-core`/Chromium-1243 were not required by this unit.

## Deviations and readings

- `planAxes(schema, catalogue)` accepts an optional catalogue and validates
  `design_score:<check>` when one is supplied. The plan panel passes `null`
  because the brief's `requires` for `scatter-plan` is only `entities_plan`
  (no `scores_by_lens`), so it offers the design scores `/schema` publishes.
- The panel catalog prose says `model` is a colour/facet lens; the brief's
  shared-choices bullet lists `session_model` and excludes `model`, and
  CONTRACTS 17.3 publishes artifact lenses `kind`, `plan`, `repo_id`, `harness`,
  `session_model`, `source`, `screen_verdict`, `scorer`, `band:<check>`. I
  followed the explicit list: `model` is never numeric and the writing
  session's model is offered as `session_model`.
- `artifactAxes` and `planAxes` restrict to the measures CONTRACTS 17.3 defines
  for the grain (plus dynamic `score:`/`design_score:`/`artifacts:<kind>`), so a
  stray schema measure is not offered. This is stricter than "everything the
  grain publishes" but never offers anything the grain does not publish.
- `artifactMissing` reads row `flags` for the fixture's unscored,
  content_unavailable, lower_bound and unpriced counts and falls back to the
  response's `population.missing_by_reason` when no flag is present.

No contradiction between the brief and the contracts was found. The brief's
`model` prose and its explicit colour list are reconciled as above, not
silently resolved.
