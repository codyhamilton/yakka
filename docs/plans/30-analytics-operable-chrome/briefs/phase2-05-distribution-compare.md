# Brief: phase2-05 — Distribution and Compare panels

Consumer: a product build worker for Plan 30 phase 2, distribution panels and Compare board proof.
Owned paths: `packages/yakka-analytics/web/js/panels/dist-ranges.js`, `dist-hist.js`, `dist-ecdf.js`, new `packages/yakka-analytics/tests/operable-chrome/distribution-captions-unit.test.mjs`, and `packages/yakka-analytics/tests/trends-quality/compare.test.mjs`, `tests/trends-quality/cohort-compare.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-05-distribution-compare.md` listing G-ranges, G-hist, G-ecdf, G-compranges, G-comphist, G-compecdf, P4/P8/P9, F2, T1–T5, the distribution parts of S-cost and S-compare with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`.
Runs alongside: `phase2-03-pulse-activity`, `phase2-04-trends-cost-time`, `phase2-06-quality`, `phase2-07-scatter`, `phase2-08-explorers-list` (disjoint paths).
Budget: about 14 files read, about 450 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 276–299 — G-ranges, G-hist, G-ecdf exact captions/defaults/tables.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 412–443 — G-compranges, G-comphist, G-compecdf and G-complines (the last two paragraphs, to know which module owns each).
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 143–182 — P4 (grain/dim/measure), P8, P10 template table and cumulative omission.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 — F2 and the distribution applicability row (kind/plan/event/tool/source unsupported; repo only when the route declares it).
5. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 538–557 and 617–636 — S-cost distribution layout and S-compare control/default/refusals.
6. `packages/yakka-analytics/web/js/panels/dist-ranges.js` lines 14–110, 110–245; `dist-hist.js` lines 16–87, 187–201; `dist-ecdf.js` lines 58–221.
7. `packages/yakka-analytics/web/js/panels/p10-shared.js` lines 160–201 (`comparisonPlan`) and 207–251 (`requestParams`).
8. `packages/yakka-analytics/tests/trends-quality/compare.test.mjs` and `cohort-compare.test.mjs`.
9. `docs/plans/30-analytics-operable-chrome/mockups/cost.png`, `mockups/src/cost.html`, `mockups/compare.png`, `mockups/src/compare.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

The three distribution panels must show the spread, histogram and cumulative share the caption names, with P4 grain/dim/measure controls, exact per-bin units and the prescribed current/previous pairing; an unsupported filter (notably kind) must erase marks and explain why.

## Contract

Settled by DESIGN.md. Register these literals verbatim and select them by `spec.scope.captionKey`:

- G-ranges (`dist-ranges`, `G-ranges`): `Each row shows the spread of session costs for a repository; the box covers the middle half and the line marks the median.`
- G-hist (`dist-hist`, `G-hist`): `Each bar counts model calls in a cost range for a harness; taller bars mean more calls in that range.`
- G-ecdf (`dist-ecdf`, `G-ecdf`): `Each line shows the percentage of sessions at or below a cost; read up from a dollar amount to find that percentage.`
- G-compranges (`dist-ranges`, `G-compranges`): `Each pair of rows compares call costs for a model in the selected and previous equal-length periods; compare medians and the middle-half boxes.`
- G-comphist (`dist-hist`, `G-comphist`): `Each bar counts calls in a cost range for the selected or previous equal-length period; compare bar heights within the same range.`
- G-compecdf (`dist-ecdf`, `G-compecdf`): `Each line shows the percentage of calls at or below a cost in one period; a higher line means more calls fall below that cost.`

Per item:

- **G-ranges:** horizontal box/whisker X=USD/session, Y=repository; whiskers min/max, marker p95, no zero substitution; `distribution?measure=cost_usd&grain=conversation&dim=session_repo` → `rows[].k,n,unpriced,min,p25,median,p75,p95,max`; default grain `conversation`, dim `session_repo`, measure `cost_usd`. Table Group, Period, Minimum, Lower quarter, Median, Upper quarter, 95th percentile, Maximum, Count, Unpriced; group asc, current before previous.
- **G-hist:** histogram X=USD/call fixed returned bins, Y=calls from 0, groups as separate small multiples, no overlapping bars; `grain=call&dim=harness`; `bins[].lo,hi,n` plus `unpriced`. Table Group, Period, From (USD), To (USD), Count, Unpriced; group asc, period, current first, bin lower edge asc.
- **G-ecdf:** step line X=USD/session bin upper edge, Y=cumulative percent 0–100, label binned approximation; `grain=conversation&dim=model`; cumulative bin n / sum bin n. Table Group, Period, Bin upper edge (USD), Cumulative count, Cumulative share (%); same order, edges asc.
- **Compare:** G-compranges/comphist/compecdf read both periods with the same fixed bins/edges; previous dashed/outlined. Compare control behavior is `phase2-02`'s; you own the panel-side refusal: All history shows `Choose a finite period to compare periods.` and zero comparison marks, never an arbitrary period. The shared boundary belongs to both periods and Data details says so.
- **P4:** a Grain select (`Model call`=`call`, `Session`=`conversation`), Group by (`model`, `harness`, `session_model`, `session_repo`, capability intersection) and Measure from `DIST_MEASURES`; options are the deterministic ordered intersection with the server's `/schema`; keep an incompatible selected option visible and refuse rather than silently changing it. Invalid call+session lens is disabled with an explanation. Defaults per item above; Compare defaults all three to call/model.
- **F2:** with `kind=brief` active, all three cost distribution panels refuse with the exact F sentence and no marks/table values; do not return unfiltered data. Same for plan/event/tool/source; repo only where the route's declared semantics support it.
- Common: V3 tokens, minimum 160px chart, no white surface, T1–T5 states with caption visible, local chart/table toggle, 30px rows, explicit units, `—` for unavailable and `0` only for real zero.

## Changes

- Wire captions and `scope.captionKey`, replace inline chart+table with `mountPanelViews`, keep `yk-ranges`/`yk-chart` calls.
- Replace the current measure-only chooser with the P4 Grain/Group by/Measure selects (and preserve the compare mode); make `distributionSpec`/`distributionParams` honor the selected grain/dim/measure.
- Apply the applicability check before fetching and to `ignored_filters`; return the no-marks refusal with the exact sentence for F2 and the other unsupported distribution filters.
- Make the current/previous pairing follow `comparisonPlan`, with the exact table Period column ordering (current first) and the finite-window refusal.
- Update only the two named test files and the new unit test.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js` (the comparison and request helpers are already shared; if you need a change there, report it rather than editing — it is owned by `phase2-01`), `panel-state.js`, `charts/*`, every other panel, every explorer, and `tests/trends-quality/cost.test.mjs` (owned by `phase2-04`; report a needed change instead of editing). No new API field, endpoint, attribution or cohort semantics.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/distribution-captions-unit.test.mjs tests/trends-quality/compare.test.mjs tests/trends-quality/cohort-compare.test.mjs` → all pass. Assert all six literal captions and caption keys, the P4 option intersections and defaults, the exact table column lists/orders, current-before-previous ordering, the finite-window refusal, the shared-boundary note, and the F2 no-marks refusal text.
- `cd packages/yakka-analytics && node --test tests/trends-quality/cost.test.mjs` → report any failure; it belongs to `phase2-04` if it asserts trend/rank text, or here if it asserts a distribution column/control you changed.
- Observable: at 1440×900, Cost shows the three distribution panels in the prescribed rows, Compare shows ranges/hist/ecdf/complines in two columns and slope full width, every caption is one sentence above its chart/table, and no table row exceeds 31px.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
