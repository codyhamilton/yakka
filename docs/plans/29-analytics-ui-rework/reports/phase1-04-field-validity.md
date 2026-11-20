# Execution report — phase1-04 field validity

Unit: Plan 29 Phase 1 unit 04. Branch `feat/29-analytics-ui-rework`.
Brief: `docs/plans/29-analytics-ui-rework/briefs/phase1-04-field-validity.md`.

## What changed against the brief

- **Movers — `web/js/panels/movers.js`.** `moverLenses(schema, measure)` now
  derives the offered splits from the time grain's published measure `dims`
  (falling back to `harness` + `model` only when the schema carries no dims).
  The model split is raw `model`; `session_model` is no longer offered or sent
  to `/query`. `session_repo` remains conditional on the time grain publishing
  that lens. Previous-period and unpriced reads keep the same resolved scope; a
  failed previous read stays "no previous period" and never becomes zero.
  `MOVER_PANEL.lenses` and the `requests()` example name `model`.
- **Session scatter — `web/js/panels/scatter-shared.js` (plus no change needed
  in `scatter-session.js`).** Added `scatterNumericFields(grain)`: when the
  session/artifact grain publishes `scatter_fields`, that list is the only
  numeric-axis source (intersected with the grain's measures); older schemas
  fall back to `measures`. `scatterAxes`, `scatterSpecFields` and therefore the
  X/Y/Size chooser now use it, so `duration_s`/`first_ts`/`last_ts` are not
  axes on the real session grain. The default question remains `cost_usd` vs
  `commits` with size `unpriced_calls`, and all three serialize as
  `fields=cost_usd,commits,unpriced_calls`. Colour still comes from lenses.
- **Score strips — `web/js/panels/score-strips.js`.** `fields` is only
  `score:<check>`; no categorical lens rides in `fields`. Checks come from the
  artifact grain's adapted `checks_by_kind[kind]`, falling back to the existing
  `/scores?kind=` read for older schemas. Grouping already reads the returned
  `l` lens or `l.kind`; the requested lens is shown but not requested as a
  field. An unsupported selected check remains `unsupported`, not empty.
- **Score trend — `web/js/panels/score-trend.js` and
  `web/js/panels/p10-shared.js`.** Added `scoreSeriesRoute(schema)` and
  `SCORE_SERIES_BUCKETS`; `bucketForWindow` picks only from
  `schema.resolutions.routes['score-series'].buckets`, or the known
  `day/week/month` set when absent, and never infers global `resolutions.auto`.
  `auto` is exposed only when the route publishes `auto:true`; the panel sends
  an explicit published bucket. Removed the hardcoded `bucket:'day'` request
  example. `unsupported_resolution` renders the server's `supported_buckets`;
  `too_many_cells` renders `max_cells`, `suggested_bucket` and
  `suggested_action` when present, without changing the URL/window. Ready
  metadata now includes `requestedBucket`, `supportedBuckets`, `routeAuto` and
  the effective `bucket`.
- **Other consumers.** `scatter-artifact` axes iterate `scatter_fields` when
  published, falling back to artifact measures. `rank` derives valid splits from
  the selected measure's published dims (with the prior static set as the
  older-schema fallback) and returns `unsupported` for an explicitly requested
  non-dimension instead of sending it. `calendar`, `rhythm`,
  `score-ranges` and `band-mix` already consume the phase1-03 adapted
  names/metadata and per-kind/per-mode lists; no further change was required.

Surfaces: `web/js/panels/{movers,scatter-shared,scatter-artifact,score-strips,
score-trend,p10-shared,rank}.js`; `tests/plan29/field-validity.test.mjs` (new);
`tests/workspace/pulse.test.mjs` (one assertion only). No server, schema, read
context, chart, theme or layout file changed.

## Checks

All commands in `/home/codyh/workspace/yakka-build/29` with `--test-concurrency=1`,
`NODE_OPTIONS=--max-old-space-size=8192`, `PUBLIC_CANVAS_TEST_MODE=true` for
browser specs, `GOTOOLCHAIN=auto`, no fixed sleeps, no `/tmp` (scratch under
ignored `.scratch/`).

New done-evidence check
(`packages/yakka-analytics/tests/plan29/field-validity.test.mjs`):

- Before (tracked panel edits stashed, new spec still present):
  `# tests 6, # pass 1, # fail 5`; 4 subtests failed — Movers panel `error`
  (D05 `dim=session_model`), score strips response 400 (`unsupported artifact
  field kind`, D09), both score-series refusal presentations were `error` not
  `unsupported` (D17).
- After:
  `# tests 6, # pass 6, # fail 0` — Movers ready with `dim=model` and no 400;
  session scatter sends `fields=cost_usd,commits,unpriced_calls`, 200, marks and
  marginals; strips request `score:<check>` only and are ready; score trend
  requests a published bucket and names it; direct `bucket=auto` returns 400
  `unsupported_resolution` with `supported_buckets:['day','week','month']` and
  the UI shows it; forced `max_cells=1` returns 400 `too_many_cells`, UI shows
  `max_cells: 1` and a suggestion, URL scope unchanged.

Named regression (brief):

```
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/scatter-sessions/scatter.test.mjs \
  packages/yakka-analytics/tests/trends-quality/quality.test.mjs
# tests 23, pass 23, fail 0
```

Additional regression after the change: `tests/workspace/pulse.test.mjs`
together with the named pair — `# tests 36, pass 36, fail 0`; all
`tests/plan29/*.test.mjs` — `# tests 11, pass 11, fail 0`;
`tests/trends-quality/{acceptance,cost}.test.mjs` — `# tests 14, pass 14,
fail 0`.

## Deviations from the brief

- **Not committed.** The operator instruction says leave changes and this
  report in the working tree; the orchestrator commits the unit. The brief's
  "commit to the current branch" and "include it in the commit" were overridden.
- **One test outside the owned paths was edited.**
  `tests/workspace/pulse.test.mjs` asserted `moverLenses(plain)` equals
  `['harness','session_model']`, which encoded the old invalid D05 request.
  Changed to `['harness','model']` only. This follows the operator's "update a
  regression assertion only where it encoded the old invalid request".
- **Production parity not attempted.** The brief asks to replay shapes against
  a deployed server using trial tenant `test` and
  `/home/codyh/.config/yakka/trial.env` + `client.toml`. The operator
  instruction forbids reading those files, touching the running Plan 28 trial
  and using the default tenant. This is a direct brief/instruction
  contradiction; it is recorded, not resolved silently.

## Unfinished work

- Production parity replay: blocked by the operator instruction above; run it
  from an environment allowed to read the trial credentials and target a
  non-default trial tenant.

## Known problems

- None new found in the owned paths. The score-series `auto` capability is
  exposed as metadata but the panel always sends an explicit published bucket;
  that is intentional and does not claim unsupported auto.
- `read-context.test.mjs` still carries its pre-existing skip for Movers'
  `dim=session_model`; it is harmless now and was left untouched.

## Gates

- gate: unit done evidence — pass (`# tests 6, pass 6, fail 0`).
- gate: named regression — pass (`# tests 23, pass 23, fail 0`).
- gate: production parity not attempted — operator instruction forbids reading
  `trial.env`/`client.toml`, touching the Plan 28 trial, and using the default
  tenant.
- gate: commit — none, per operator instruction; changes and report left in the
  working tree.
