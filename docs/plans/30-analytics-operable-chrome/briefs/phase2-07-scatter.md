# Brief: phase2-07 — Scatter panels

Consumer: a product build worker for Plan 30 phase 2, Scatter board.
Owned paths: `packages/yakka-analytics/web/js/panels/scatter-session.js`, `scatter-artifact.js`, `scatter-plan.js`, `scatter-day.js`, `scatter-shared.js`, `packages/yakka-analytics/web/css/scatter.css`, new `packages/yakka-analytics/tests/operable-chrome/scatter-captions-unit.test.mjs`, and `packages/yakka-analytics/tests/scatter-sessions/scatter.test.mjs`, `tests/scatter-sessions/artifact-plan.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-07-scatter.md` listing G-sessionxy, G-artifactxy, G-planxy, G-dayxy, P5/P6/P8/P9, T1–T5, F1–F7 as they apply, and S-scatter with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`.
Runs alongside: `phase2-03-pulse-activity`, `phase2-04-trends-cost-time`, `phase2-05-distribution-compare`, `phase2-06-quality`, `phase2-08-explorers-list` (disjoint paths).
Budget: about 16 files read, about 450 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 380–411 — the four G scatter contracts, exact captions, size/colour defaults and whole-population marginals.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 143–182 — P5 (artifactxy's check/scorer), P6, P8/P9 and the scatter row in the P10 template table (including the exact size sentence).
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 — F1–F7 as they apply to entity/scatter sources (repo, kind, time grain, exact identity).
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 638–655 — S-scatter layout, DOM order and acceptance.
5. `packages/yakka-analytics/web/js/panels/scatter-shared.js` lines 1–220 — field specs, marginals and table builder.
6. `packages/yakka-analytics/web/js/panels/scatter-session.js` lines 14–150; `scatter-artifact.js` lines 14–150; `scatter-plan.js` lines 12–145; `scatter-day.js` lines 16–155.
7. `packages/yakka-analytics/tests/scatter-sessions/scatter.test.mjs` and `artifact-plan.test.mjs` — old assertions to replace.
8. `docs/plans/30-analytics-operable-chrome/mockups/scatter.png` and `mockups/src/scatter.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Each scatter states the exact entity, X, Y and size meaning in one literal sentence; defaults to its prescribed axes/size/colour; uses whole-population marginals; and refuses unsupported filters or incompatible axis choices without inventing a claim (especially the artifact-page spend/quality non-causation note and the time-bucket-is-not-a-day wording).

## Contract

Settled by DESIGN.md. Register these literals verbatim and select them by `spec.scope.captionKey`:

- G-sessionxy (`scatter-session`, `G-sessionxy`): `Each dot is a session, with priced spend across and commit count up; larger dots mean more calls without prices.`
- G-artifactxy (`scatter-artifact`, `G-artifactxy`): `Each dot is a file, with its writing session’s spend across and its clarity score up; this association does not prove that spending improves quality.`
- G-planxy (`scatter-plan`, `G-planxy`): `Each dot is a plan, with associated session spend across and file count up; plans can share the same session costs.`
- G-dayxy (`scatter-day`, `G-dayxy`): `Each dot is a time bucket, with priced spend across and commits up; buckets without prices remain marked as incomplete.`

Per item:

- **G-sessionxy:** X=priced USD, Y=commits integer, size=unpriced calls, colour default None; `entities?grain=session&mode=scatter&fields=cost_usd,commits,unpriced_calls`; marginals are histograms of whole eligible values, Y=count; tooltip identity/session_model. P6/P8/P9; table Identity, X (USD), Y (commits), Size (unpriced calls), Colour if selected; canonical identity asc; marginal Axis, From, To, Count, Missing count, X then Y, bin lower edge asc.
- **G-artifactxy:** X=writing-session USD, Y=clarity 0–1, size None, colour default None; `grain=artifact&fields=writing_session_cost_usd,score:clarity`; P5 (check/scorer for clarity, default clarity/selected scorer, single-kind refusal) plus P6/P8/P9; table Identity, X (USD), Y (normalized score 0–1) as above; the caption's non-causation sentence is mandatory and must not be replaced by the generic scatter template.
- **G-planxy:** X=associated USD, Y=files integer, size None, colour default repository; `grain=plan&fields=associated_cost_usd,artifacts`; shared-session lower-bound wording stays; table Identity, X (USD), Y (files), Colour (repository); identity asc.
- **G-dayxy:** X=USD per time bucket, Y=commits/bucket integer, size None, colour None, focus selected; `grain=time&mode=aggregate&fields=cost_usd,commits&bucket=auto`; tooltip names the actual bucket and interval; never claim every bucket is a day; incomplete/price-missing buckets stay marked, not zero-filled; table Identity, X (USD), Y (commits).

Common:

- P6 selects X axis, Y axis, Size (None then numeric fields) and Colour (None then categorical lenses), ordered as the panel's advertised list intersected with schema scatter_fields/predicate; numeric-only X/Y (no id/model), size and colour measured independently. Changing P6 writes `scope.x/y/size/colour`, keeps measures by codec, and reloads only that panel.
- Axis/caption/table headers/units all come from the selected P6 fields through the controlled label dictionary; no stale labels, no raw snake_case prose, no percentage for the score.
- Use V3 tokens (no white surface), minimum 160px chart, T1–T5 states with caption visible, local chart/table toggle, 30px rows; stable nulls last and identity ascending.
- Applicability: an active filter outside the scatter entity source's supported set returns the F refusal with no marks and the exact singular/plural sentence, caption unchanged; F1 exact identity, F3 repo only where the route declares it, F4 metadata.

## Changes

- Add caption registration/key selection to the four modules using the exact strings; keep the non-causation and shared-cost sentences literal.
- Replace inline chart+table with `mountPanelViews`; keep the scatter chart and marginal helpers.
- Implement P6 controls (X/Y/Size/Colour) in the shared scatter helper and the P5 check/scorer path for artifactxy only; remove one-item/extra choosers and any fixed-field selectors the contract does not list.
- Make defaults exact (session: size unpriced_calls; artifact: size None; plan: colour repository; day: colour/size None), make marginals whole-population, and add the exact F refusal with no marks.
- Update only the two named scatter test files and the new unit test.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, every other panel and explorer, `tests/scatter-sessions/sessions.test.mjs` (owned by `phase2-08`) and `tests/scatter-sessions/acceptance.test.mjs` (belongs to `phase2-12`). No new API field, entity grain, attribution model or marginal calculation change.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/scatter-captions-unit.test.mjs tests/scatter-sessions/scatter.test.mjs tests/scatter-sessions/artifact-plan.test.mjs` → all pass. Assert the four literal captions/keys, each panel's exact defaults (axes/size/colour), P6 option intersection and numeric-only X/Y, P5 clarity check/scorer on artifactxy, whole-population marginals, table columns/units/sort, the score's normalized unit, and exact F refusal with no marks.
- Observable: at 1440×900, Scatter renders session/artifact in row 1 and plan/day in row 2, each caption one sentence above its chart/table, marginals align to their axes, and every row is 30±1px.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
