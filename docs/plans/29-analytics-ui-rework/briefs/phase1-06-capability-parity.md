# Brief: phase1-06 — Catalogue parity, route score-series capability and session scatter fields

Consumer: the execute worker for phase1-06; phase1-04 reads the route capability and scatter fields, and the Phase 1 verifier reads these refusals.
Owned paths: `packages/yakka/internal/serve/analytics.go`, `packages/yakka/internal/serve/analytics_score_series.go`, `packages/yakka/internal/serve/analytics_query.go`, `packages/yakka/internal/serve/analytics_artifact_schema.go`, `packages/yakka/internal/serve/analytics_entities.go` (session scatter whitelist only), `packages/yakka/internal/serve/analytics_capability_parity_test.go` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-06-capability-parity.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing for the Go code; phase1-01 for the harness-backed observable.
Runs alongside: phase1-03.
Budget: read about 10 files, change about 250 lines, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:93` — one retained-plus-active catalogue and empty-ledger rules; `:99` — route-specific resolution and refusal shapes.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:36,38,47` — D06, D08, D17; `:63-72` — affected surfaces.
3. `docs/design/09-analytics-workspace-contracts.md:20-27` — resolution, `unsupported_resolution`, `too_many_cells`, `suggested_action`; `:33-38` — schema capability fields.
4. `packages/yakka/internal/serve/analytics.go:104-116` (`errJSON`/`errCodeJSON`), `:450-462` (`catalogChecks`), `:615-680` (`/scores` and `analyticsScoresByLens` check maps at `:634,662-670`), `:745-760`.
5. `packages/yakka/internal/serve/analytics_score_series.go:19-60` (bucket parse/refusal), `:75-90` (selected-check map), `:170-190` (output check names).
6. `packages/yakka/internal/serve/analytics_query.go:41-79` — `artifactChecks`, grains, global `resolutions`, budgets; `packages/yakka/internal/serve/analytics_artifact_schema.go:71-96` — retained-plus-active union helper; `:140-190`.
7. `packages/yakka/internal/serve/analytics_entities.go:1064-1090` — session scatter whitelist; `packages/yakka/internal/store/session_entities.go:19,28,35,137,146,187,406-427` — commits/unpriced already served.
8. `packages/yakka/internal/serve/analytics_query_test.go:281-331` — existing session scatter test; `analytics_score_series_test.go:19-30` — existing bucket refusal; `analytics_query_test.go:463-487, 625-640` — `errCodeJSON` patterns.
9. `packages/yakka/internal/store/analytics.go:685-712` — `WindowScores` returns retained check names; `:722-752` — `WindowScoreObservations`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Publish and enforce one honest capability surface: retained-plus-active checks work without a scorer, score-series advertises its own day/week/month set and returns the defined refusals, and session scatter serves the already-defined commits/unpriced fields.

## Contract

- `DESIGN.md:93`: "`/schema`, `/scores`, `/score-series` and selected-check validation use the same retained-plus-active names per kind. Querying history must not require a new scoring run."
- `DESIGN.md:99`: "Add `/schema.resolutions.routes[\"score-series\"] = {buckets:[\"day\",\"week\",\"month\"], auto:false}`; this entry takes precedence over legacy global flags. … Unsupported units return 400 `unsupported_resolution` with `supported_buckets`. A cell-budget refusal returns 400 `too_many_cells` with `max_cells` and a supported `suggested_bucket` if one fits; if even month cannot fit, omit the suggestion and return `suggested_action: reduce_splits_checks_or_choose_window`."
- `DESIGN.md:85`: publish and serve session `commits` and `unpriced_calls` in `scatter_fields`.

## Changes

- Add one retained-plus-active per-kind check helper (reuse `artifactChecks`/`LatestContentScores`). Use it for `/scores` output, `analyticsScoresByLens`'s checks map, and `analyticsScoreSeriesByLens`'s checks map. `/schema.checks_by_kind` keeps the same union, so discovery and validation cannot disagree. Keep active catalogue checks when present; do not drop them.
- `/schema.resolutions`: add `routes: {"score-series": {buckets:["day","week","month"], auto:false}}` while keeping the existing global `auto`/`year`/`multi_year_steps` for routes that do support auto. This entry is authoritative for score-series.
- `/score-series`:
  - Accept only `day`, `week`, `month`. Any other value, including `auto` and `hour`, returns `errCodeJSON(w, 400, "unsupported_resolution", <message>, map[string]any{"supported_buckets":[]string{"day","week","month"}})`.
  - Remove the `range too wide` refusal; there is no window cap.
  - Replace the implicit `maxBuckets` guard with an explicit cell budget: read `max_cells` (default `/schema.budgets.max_cells`, never raised above the default) and compute cells as returned buckets × returned check/series groups. On breach return `too_many_cells` with `max_cells` and the next supported coarser bucket that fits as `suggested_bucket`; if not even `month` fits, omit `suggested_bucket` and set `suggested_action: "reduce_splits_checks_or_choose_window"`. Do not clip series or buckets.
- Session scatter: add `commits` and `unpriced_calls` to the allowed whitelist and to `grains.session.scatter_fields` in `/schema`. They are already computed by the session entity query; do not add a new grain or a new measure.
- Do not change the ordinary `/scores`/`/score-series` response shapes beyond check discovery and the new refusals.

## Keep untouched

- Empty-ledger coverage scanning (phase1-05).
- Plan identity/associated cost/events and conversation serialization (phase1-07).
- Client bucket selection and field lists (phase1-04).
- Auth, tenant resolution, query budgets for `/query`/`/distribution`, and the one-second deadline.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: Go tests use generated fixtures and must not use `/tmp` for new harness data (use the worktree's ignored `.scratch/`). No fixed sleeps; assert responses and end states directly.

- `cd /home/codyh/workspace/yakka-build/29/packages/yakka && GOTOOLCHAIN=auto go test ./internal/serve -run 'TestAnalyticsCapabilityParity|TestAnalyticsRetainedChecks|TestScoreSeriesRouteCapability|TestSessionScatterCommits' -count=1` → pass. New tests seeded with retained scores and **no active checks catalogue** assert:
  - `/schema.checks_by_kind.design` contains `legacy-check`; `/scores?kind=design&all=1` returns it; `/score-series?kind=design&check=legacy-check&bucket=month&all=1` is 200.
  - `/schema.resolutions.routes["score-series"]` is exactly `{buckets:["day","week","month"], auto:false}` and takes precedence over global flags.
  - `/score-series?kind=design&bucket=auto&all=1` → 400 `code:"unsupported_resolution"` with `supported_buckets:["day","week","month"]`; `bucket=hour` gives the same.
  - `/score-series?kind=design&bucket=month&all=1&max_cells=1` → 400 `code:"too_many_cells"` with `max_cells` and either a fitting `suggested_bucket` or `suggested_action`.
  - `/entities?grain=session&mode=scatter&fields=cost_usd,commits,unpriced_calls&all=1` → 200 with rows; the old `unsupported session scatter field commits` is gone.
- Regression: `… GOTOOLCHAIN=auto go test ./internal/serve -run 'TestAnalyticsScores|TestAnalyticsScoreSeries|TestAnalyticsQuery' -count=1` → pass.
- Harness observable via `phase1-01`: direct HTTP from the Node harness shows the schema route entry, a retained historical check read, and a successful commits/unpriced scatter on `plan29-a`.
- Production parity (verification-time read-only): read `/v1/analytics/schema` and the score-series/scatter shapes for trial tenant `test` with `/home/codyh/.config/yakka/trial.env` + `client.toml`. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
