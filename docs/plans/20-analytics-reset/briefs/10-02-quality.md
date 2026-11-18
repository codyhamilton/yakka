# Brief: 10-02 — Quality preset

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/panels/score-ranges.js`, `score-trend.js`, `score-strips.js`, `band-mix.js`, `p10-quality.js`, `web/css/quality.css`, `packages/yakka-analytics/tests/trends-quality/quality.test.mjs`, and `docs/plans/20-analytics-reset/reports/10-02-quality.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/10-02-quality.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 10-01.
Runs alongside: 10-03; owns the score panels, their registration, CSS and spec, disjoint from the cost and tool paths.
Budget: 12 files to read, about 900 lines to change, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 10 outcome, the Quality preset row and the panel catalog.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.3 `artifact → score`, the artifact and content measures/lenses, and 17.3.1's `band:<check>` and identity rules.
3. `docs/plans/20-analytics-reset/CONTRACTS.md` — 7.2 `/scores`, `/score-series`, `/baselines`, `/entities`, and 17.5's chart rules.
4. `packages/yakka-analytics/web/js/panels/p10-shared.js`, `trend-columns.js`, `dist-ranges.js` — the seams and request/chooser patterns from 10-01.
5. `packages/yakka-analytics/web/js/charts/{yk-chart,yk-ranges,yk-bars}.js` — model builders only.
6. `packages/yakka-analytics/tests/trends-quality/{fixture,browser}.mjs` and `packages/yakka-analytics/tests/workspace/{harness,stub-api}.mjs` — the P10 fixture and browser pattern.
7. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — Phase 6 Carried on the single `content_hash` population and the legacy `exclude=band:<check>` cut.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Deliver the Quality preset so check, scorer and hash-weighted observations are visibly separate from file-weighted observations, each check's all-time scorer baseline and band are shown, and an inspected artifact opens the correct artifact destination while the deferred reader is named.

## Contract

- Quality preset panels (DESIGN.md): `score-ranges`, `score-trend`, `score-strips`, `band-mix`, with a kind/check chooser and a scorer choice.
- CONTRACTS.md 17.3: `/scores` and `/score-series` are hash-weighted (distinct content hashes, latest score per hash/check, canonical representative per hash); `/entities?grain=artifact` is file-weighted. The two units are never equated. A scalar `scorer` lens is valid only for a selected check; multi-check charts label each series independently; a common scorer does not prove an unchanged rubric.
- Bands are per-kind/check/scorer all-time baselines over distinct hashes, strict below-p25/above-p75 and inclusive `mid`; missing baseline is `baseline_unavailable`, not `unscored`.
- CONTRACTS.md 17.3.1: `band:<check>` is a structured lens and may contain a colon. Do not write it as a legacy `exclude=band:<check>:value` string; 10-05 will resolve the structured cohort path. `score:<check>` and `band:<check>` are validated against the catalogue. An artifact identity is `(repo_id, path)` and a version is `(repo_id, path, content_hash)`.
- CONTRACTS.md 7.2: `/scores?kind=&check=&dim=&scorer=&limit=&offset=` returns `checks[].groups` with `n`, `min`, `p25`, `median`, `p75`, `max`, plus `omitted_groups`/`omitted_n`; `/score-series?kind=&bucket=&dim=&check=&scorer=` returns `checks[].points[].groups` with `n/p25/median/p75`; `/baselines?population=content&kind=&check=&scorer=` returns `scorers[scorer][check] = {n,p25,median,p75}`. Population is one `content_hash` unit per response; use it and label it.
- CONTRACTS.md 17.5: every chart has units, time basis and a table; no dual axes; no composite quality score across checks; no inferring a rubric revision.
- Phase 6 Carried: select one check per request, so the single top-level `content_hash` population is sufficient. The content grain has no `/entities` listing; hash observations come from `/scores`, graph observations from `/score-series`, and file observations from artifact entities.

## Changes

- `score-ranges.js`: hash-weighted box ranges. Load `/baselines?population=content&kind=<kind>&check=<check>` first to enumerate scorers and obtain each scorer's p25/median/p75. Choose a scorer (the first with n>0, named; a choice is offered when several exist). Then load `/scores?kind&check&scorer&dim=<harness|session_model|repo_id>&limit=<top_max>`; render one box per group with n, `<yk-ranges type="box" legend="entities">`, and the selected scorer's p25–p75 as `spec.baseline` labelled “all-time scorer baseline”. Show each check/scorer/n and the `content_hash` unit. If no baseline exists, say `baseline_unavailable`; never say unscored. Use the response's `omitted_groups`/`omitted_n` rather than dropping groups silently.
- `score-trend.js`: hash-weighted series. Pick a bucket from the finite scope (day for ≤90 days, week for ≤2 years, month otherwise); `/score-series?kind&bucket&check&scorer&dim=<lens>`; render p25, median and p75 as three named `<yk-chart type="lines">` series per group (or one small multiple per group), with the all-time baseline p25/median/p75 printed in the note. The panel names that a hash may recur in several buckets and that series n is not the window population. `win=all` uses the month bucket and reports the server's actual bucket; it never invents a shorter window.
- `score-strips.js`: file-weighted observations. `/entities?grain=artifact&check=<check>&fields=score:<check>&limit=<page_max>` (plus the selected lens field when the response supports it); render `<yk-ranges type="strip">` one mark per returned file, keyed by the canonical compact JSON identity `{"path","repo_id"}`. Put the identity map in `spec.entities` so the shared inspector destination is `/artifact?repo_id=…&path=…&hash=…`; the artifact reader is Phase 12, and the panel says so. Show `returned_n` of `eligible_n`, `missing_by_reason.unscored`, and label the population “files”, never content hashes. Do not request a content-grain list.
- `band-mix.js`: file-weighted band composition. `/entities?grain=artifact&check=<check>&mode=aggregate&stat=count&dim=band:<check>&dim=kind`; render `<yk-bars type="stacked">` (or percent) with `low`, `mid`, `high`, `unscored` and `baseline_unavailable` as distinct groups, each with its count and the response's omitted groups. Label the population “files” and show the selected check/scorer baseline provenance. A band-only selection may create an include filter on `band:<check>`; do not emit a legacy `exclude` string for it and do not promote an artifact `id` cohort in this phase.
- Chooser: use the 10-01 `renderChooser` for kind, check, scorer and split where the server publishes them. A check/scorer not in the catalogue or a lens not published for artifact is `unsupported` with reason and source; a panel never requests an unlisted pairing. Default kind `design`, first published check, first scorer with n>0.
- `p10-quality.js`: register the four panels and the `quality` preset with canonical preset specs, then return true. Keep the module importable by `panels/index.js` before this unit lands.
- `quality.css`: only the label/notes needed for population and baseline text; put no colour values that duplicate the chart kit's tokens.

### Keep untouched

- The four hash-weighted/file-weighted populations may be relabelled but never pooled into one denominator, one score, or one delta.
- The Phase 9 frame, inspector, tray and route contracts. The inspector destination is supplied through the 10-01 `spec.entities` seam, not by editing `inspector.js`.
- The chart elements' existing defaults. `legend="entities"` and the baseline band are options; no other chart behaviour changes.
- No Go change, no content route, no new grain, join, dependency or gesture.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test tests/trends-quality/quality.test.mjs` (workdir `packages/yakka-analytics`) → pass, including Chromium: `/b/quality` settles its four frames; score-ranges is labelled content hashes and score-strips files; a baseline band is drawn from the selected scorer and a missing baseline is named; band-mix shows low/mid/high/unscored/baseline_unavailable separately; an inspected strip mark produces `/artifact?repo_id=…&path=…&hash=…` and the Phase 12 reader notice; check/scorer changes regroup and surviving styles hold; no console/page/CSP error; ≤4 in flight.
- The same spec proves table values, `n`, omitted groups and population units against `tests/trends-quality/fixture.mjs`; unknown check/band is a named unsupported state.
- `NODE_PATH=… node --test tests/trends-quality/trends.test.mjs tests/trends-quality/compare.test.mjs` → 10-01 stays green.
- `git diff --check` clean; the report records the exact before/after outputs, files read/changed, fixture counts and any deviation.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
