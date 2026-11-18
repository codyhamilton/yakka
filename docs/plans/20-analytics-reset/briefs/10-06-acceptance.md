# Brief: 10-06 — Trends, compare, quality, cost and tools acceptance

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs`, `packages/yakka-analytics/tests/trends-quality/acceptance-fixture.mjs`, and `docs/plans/20-analytics-reset/reports/10-06-acceptance.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/10-06-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 10-01, 10-02, 10-03, 10-04 and 10-05.
Runs alongside: nothing; owns the phase acceptance proof and final browser suite.
Budget: 14 files to read, about 500 lines to change, 32 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 10 outcome, the panel catalog/preset matrix and the Interaction model.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.2, 17.3, 17.3.1, 17.5 and 17.7.
3. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — the nine Phase 9 closing proof and the Phase 8 acceptance structure this proof follows.
4. All six Phase 10 briefs and reports.
5. `packages/yakka-analytics/tests/trends-quality/*.test.mjs` and `{fixture,browser}.mjs` — the unit evidence you compose.
6. `packages/yakka-analytics/tests/workspace/{acceptance,deep-links,degradation}.test.mjs` and `tests/gallery/harness.mjs` — the phase-proof style, `watchPage`/`assertClean`, and the skip reason.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Prove the signed Phase 10 outcome independently on the closing tree over the five presets, so the phase can close on evidence rather than on the units' own claims.

## Contract

- DESIGN.md Phase 10: from each of Trends, Compare, Quality, Cost and Tools, changing a supported measure/lens/chart regroups the preset's panels with stable surviving styles; every P10 panel in the preset matrix is delivered; long-history auto resolution and zoom preserve dates; finite period/cohort comparisons show both populations and coverage; Quality separates check/scorer/hash versus file observations, displays scorer-specific baselines/bands and opens the correct artifact inspector (reader delivery is P12); model/repo/harness cost and tool investigations preserve unpriced/unattributed/mixed groups, numeric eligibility and named unsupported joins; all modes, linked actions and table values match the fixture.
- CONTRACTS.md 17.5/17.7: Chromium only through the shared loader; real mouse/keyboard at `inspect()` coordinates; wait on `data-idle`/`data-state` and settled conditions; no fixed sleeps, no `/tmp`, no animation/timing assertion, no test branch in product code; any `console.error` or CSP violation fails; ≤4 requests in flight; a missing browser skips with the named reason.
- No product code is owned here. If the outcome fails, record the failing case with its preset, panel, request and observed/expected values; do not edit another unit's path and do not weaken a check.

## Changes

- `acceptance.test.mjs`: one independent browser proof over `/b/trends`, `/b/compare`, `/b/quality`, `/b/cost` and `/b/tools` using the committed P10 stub/fixture, plus the named probes below. Use deterministic Chrome; assert with `inspect()`, table text and URL/state, not pixels.
  1. **Completeness and grouping.** Each preset has exactly its catalog panel list, every frame settles `ready` (or an intended named `empty`/`unsupported` where the fixture says so), and for each preset change one measure, one lens and one chart (where supported): the frames requery, the grouping changes, and a surviving series keeps its colour/style. Record the unsupported combinations the schema refuses.
  2. **Long history and linked time.** `win=all` and a ten-year finite window resolve the server's effective/coarsened bucket; brush/zoom writes absolute `from`/`to`; reload, Back and Forward preserve the dates and the selected preset; the table matches the fixture buckets. `cmp=period` with `all` shows the existing finite-period copy and makes no previous-window request.
  3. **Comparison.** A finite period comparison shows both periods' populations and coverage; a cohort comparison (A and B, and a single cohort against all-in-scope) shows both typed populations, `relation.resolved_n`, sample sizes and coverage, never a bare delta; a mismatched cohort grain is refused with its reason; compare plus split is small multiples.
  4. **Quality units.** Hash-weighted ranges/trend name `content_hash` and file-weighted strips/band-mix name files; the selected scorer's all-time p25/p75 baseline band is drawn; a missing baseline is `baseline_unavailable`, a null score is `unscored`; check/scorer changes regroup; an inspected strip mark opens `/artifact?repo_id=…&path=…&hash=…` and names the Phase 12 reader.
  5. **Cost and tools honesty.** A partially priced group says lower bound with N unpriced; an all-unpriced group says unpriced, never `$0`; a priced zero is zero; `(mixed)`/`(none)`/`(multi)`/`unknown` stay distinct; numeric eligibility matches the fixture; a repo cost total and cost-by-tool are named unsupported with their `try`; tool/kind groups and the rhythm grid match the fixture.
  6. **Linked actions and tables.** Legend focus emits a board chip for a published contract lens and an unmapped key is named; a pick updates the tray and a cohort chip requeries every panel with `cohort=`; every chart's table values equal the fixture and every panel shows its population unit; no console/page/CSP error and ≤4 in flight on every page.
- `acceptance-fixture.mjs` holds only the extra scene rows this proof needs (a long-history bucket, an all-unpriced and a partially priced group, a colon-sensitive check, two cohorts of the same and different grains). It must not change the unit fixtures' default values.
- Write `reports/10-06-acceptance.md` as a handoff: the command, the exact pass/fail counts, each probe's observed result, the fixture counts used, and any defect found. If a real defect remains, the report and the commit state it plainly; the phase is not called closed.

### Keep untouched

- Every product file and every other unit's test/fixture. If a probe fails, the acceptance test records it and stays red; the fix belongs to the owning unit or a follow-up fixer.
- The browser loader, skip reason and settlement helpers; import and reuse them.
- No Go change, no deploy, no migration, no live service, no production data, no credential.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test tests/trends-quality/acceptance.test.mjs` (workdir `packages/yakka-analytics`) → every named probe passes, or the failing probe and its owner are stated; a missing playwright-core/Chromium skips with the named reason.
- `NODE_PATH=… node --test tests/trends-quality/*.test.mjs` → the whole P10 suite green (unit + acceptance).
- `NODE_PATH=… node --test tests/workspace/*.test.mjs` → the Phase 9 suite stays green.
- `node --test tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs` → the chart kits stay green.
- `git diff --check` clean; the report records exact before/after outputs, the probes and their observed values, and any deviation.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
