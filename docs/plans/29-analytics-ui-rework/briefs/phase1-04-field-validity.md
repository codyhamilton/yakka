# Brief: phase1-04 — Valid fields for Movers, session scatter, score strips and score trend

Consumer: the execute worker for phase1-04; the Phase 1 verifier reads these boards' request/response evidence.
Owned paths: `packages/yakka-analytics/web/js/panels/movers.js`, `packages/yakka-analytics/web/js/panels/scatter-session.js`, `packages/yakka-analytics/web/js/panels/scatter-shared.js`, `packages/yakka-analytics/web/js/panels/scatter-artifact.js`, `packages/yakka-analytics/web/js/panels/score-strips.js`, `packages/yakka-analytics/web/js/panels/score-trend.js`, `packages/yakka-analytics/web/js/panels/score-ranges.js`, `packages/yakka-analytics/web/js/panels/band-mix.js`, `packages/yakka-analytics/web/js/panels/calendar.js`, `packages/yakka-analytics/web/js/panels/rhythm.js`, `packages/yakka-analytics/web/js/panels/rank.js`, `packages/yakka-analytics/web/js/panels/p10-shared.js` (only `bucketForWindow` and any field-list helper), `packages/yakka-analytics/tests/plan29/field-validity.test.mjs` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-04-field-validity.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-01 (harness), phase1-03 (adapted schema/error states), phase1-06 (server publishes scatter fields and route-specific score-series capability).
Runs alongside: phase1-07.
Budget: read about 12 files, change about 250 lines, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:84-85` — mode-specific fields, `scatter_fields`, raw `model` for Movers, score-strip fields, same-kind catalogue.
2. `docs/plans/29-analytics-ui-rework/DESIGN.md:99` — route-specific resolution, `unsupported_resolution`, `too_many_cells`, `suggested_action`.
3. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:35,38,39,47` — D05, D08, D09, D17; `:58-68` — affected boards.
4. `packages/yakka-analytics/web/js/panels/movers.js:20-41` (`moverLenses`), `:168-240` (lens loop, `/query` dims, previous/unpriced handling).
5. `packages/yakka-analytics/web/js/panels/scatter-session.js:25-70, 185-200` and `scatter-shared.js:30-115, 341-404` — axes, `scatterSpecFields`, request `fields`, chooser.
6. `packages/yakka-analytics/web/js/panels/score-strips.js:13-70, 100-165` — lens list, `fields=score:<check>,kind`, grouping, chooser.
7. `packages/yakka-analytics/web/js/panels/score-trend.js:90-140, 185-200` and `p10-shared.js:278-300` — bucket selection and response bucket info.
8. `packages/yakka-analytics/web/js/panels/scatter-artifact.js:20-80, 190-210`; `score-ranges.js:60-90`; `band-mix.js:15-70`; `calendar.js:10-25`; `rhythm.js:35-55`; `rank.js:405-420` — other field/lens consumers.
9. `packages/yakka/internal/serve/analytics_entities.go:1064-1090` and `analytics_query.go:50-52` — server scatter whitelist/published fields (phase1-06 changes these); `analytics_score_series.go:19-60` — current refusal shape (phase1-06 changes it).
10. `packages/yakka-analytics/tests/scatter-sessions/scatter.test.mjs:30-120` and `tests/trends-quality/quality.test.mjs:120-190` — current stub assertions; `tests/plan29/harness.mjs`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make each panel ask for fields its route truly supports and show the server's actionable refusal when it does not: Movers uses raw `model` on `/query`, session scatter uses `scatter_fields`, score strips request numeric score fields only, and score trend follows the route-specific score-series capability.

## Contract

- `DESIGN.md:85`: "Session scatter must support its existing cost-versus-commits question: publish and serve `commits` and `unpriced_calls` alongside the currently supported usage fields, using the session grain's in-window values and null semantics. Choosers use `scatter_fields`. Movers' time-query model split uses raw `model`; derived `session_model` is offered only on a route that implements that grain. Artifact score strips request numeric score fields, derive categorical grouping from returned lenses, and use a same-kind check catalogue."
- `DESIGN.md:99`: "Unsupported units return 400 `unsupported_resolution` with `supported_buckets`. A cell-budget refusal returns 400 `too_many_cells` with `max_cells` and a supported `suggested_bucket` if one fits; if even month cannot fit, omit the suggestion and return `suggested_action: reduce_splits_checks_or_choose_window`. The UI presents that action without changing filters/window automatically."
- Phase 1 must end with Movers, score strips, session scatter and tool lanes using valid fields/taxonomy (`DESIGN.md:149`).

## Changes

- **Movers (`movers.js`)**: derive offered split lenses from the schema's `/query` capability (`grain.time` plus the selected measure's `dims`) instead of an unconditional `['harness','session_model']`. Use raw `model` for cost/call/time questions; label it “model”. Offer `session_model` only when a session-grain route is actually used; do not send `dim=session_model` to `/query`. Keep previous-period and unpriced reads on the same resolved scope; a failed previous period is “no previous period”, not zero.
- **Session scatter (`scatter-session.js`, `scatter-shared.js`)**: build the axis list from the session grain's `scatter_fields` (intersected with panel measures), not the general `measures`. Default the existing question to `cost_usd` vs `commits` with size `unpriced_calls` when published. Serialize only these published fields. The chooser's X/Y/Size/Colour lists use `scatter_fields`/`lenses` from the adapted schema; a non-scatter measure is not offered. Keep the 2–4 field bound and the server sample/population metadata.
- **Score strips (`score-strips.js`)**: request only numeric score fields (`score:<check>`); never include categorical `kind` (or any lens) in `fields`. Group rows by the returned `l.kind` or the requested dimension. Use the same-kind check catalogue (`schema.checks_by_kind`/grain checks) for the strip's check list and keep the resolved scope. If the selected check is unsupported for the kind, show `unsupported`, not empty.
- **Score trend (`score-trend.js`, `p10-shared.bucketForWindow`)**: read `schema.resolutions.routes['score-series']`. When present, use its `buckets` and honour `auto` only if true; when absent, use the known `['day','week','month']` set for this route and do not infer auto from global `resolutions.auto`. Remove the hardcoded `bucket:'day'` request metadata. On `unsupported_resolution`, render the server's `supported_buckets`; on `too_many_cells`, render `max_cells`, `suggested_bucket` when present, and `suggested_action` when present, without changing the URL/window.
- **Other consumers**: `calendar`, `rhythm`, `rank`, `score-ranges`, `band-mix`, `scatter-artifact` use adapted names/metadata and per-mode lists; no new field is invented and a field absent from the mode is `unsupported`.

## Keep untouched

- Server routes and `/schema` construction — phase1-06.
- Schema normalization/error states — phase1-03.
- Read context/tenant/scope resolution — phase1-02.
- The chart kit, theme, density and layout.
- Panel IDs, URLs and saved-view identity.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: this repo uses `node --test` (no vitest); keep `--test-concurrency=1` and `NODE_OPTIONS=--max-old-space-size=8192` within the 8G envelope. Browser specs wait on real end states and captured requests, with no fixed sleeps or animation/timing assertions. Write only inside the worktree's ignored `.scratch/`, never `/tmp`.

- `cd /home/codyh/workspace/yakka-build/29 && PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/field-validity.test.mjs` → pass, against `phase1-01`'s real Go harness:
  - Pulse Movers settles `ready`; its `/query` requests contain `dim=model` (never `dim=session_model`) and no 400.
  - Session scatter sends `grain=session&mode=scatter&fields=cost_usd,commits,unpriced_calls` and receives 200 with plotted marks/marginals.
  - Quality score strips requests `fields=score:<check>` only and settles `ready`; no `unsupported artifact field`.
  - Score trend requests a published bucket and settles `ready`; its request metadata names the effective bucket.
  - `GET /v1/analytics/score-series?kind=design&bucket=auto&all=1&tenant=plan29-a` → 400 with `code:'unsupported_resolution'` and `supported_buckets:['day','week','month']`; the UI presents the refusal.
  - A forced over-budget score-series request (small `max_cells`) → 400 `too_many_cells` with `max_cells` and either `suggested_bucket` or `suggested_action`; the UI shows it without mutating the URL scope.
- Regression: `… node --test --test-concurrency=1 packages/yakka-analytics/tests/scatter-sessions/scatter.test.mjs packages/yakka-analytics/tests/trends-quality/quality.test.mjs` → pass (update only assertions that encoded the old invalid request).
- Production parity (verification-time read-only): replay the Movers, session-scatter, score-strip and score-series shapes against the deployed server with trial tenant `test` and `/home/codyh/.config/yakka/trial.env` + `client.toml`. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
