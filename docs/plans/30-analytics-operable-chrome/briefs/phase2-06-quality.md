# Brief: phase2-06 — Quality score panels

Consumer: a product build worker for Plan 30 phase 2, Quality board.
Owned paths: `packages/yakka-analytics/web/js/panels/score-ranges.js`, `score-trend.js`, `score-strips.js`, `band-mix.js`, `packages/yakka-analytics/web/css/quality.css`, new `packages/yakka-analytics/tests/operable-chrome/quality-captions-unit.test.mjs`, and `packages/yakka-analytics/tests/trends-quality/quality.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-06-quality.md` listing G-scores, G-scoretrend, G-strips, G-bands, P2/P5/P8/P9, T1–T5, F1–F7 as they apply to score sources, and S-quality with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`.
Runs alongside: `phase2-03-pulse-activity`, `phase2-04-trends-cost-time`, `phase2-05-distribution-compare`, `phase2-07-scatter`, `phase2-08-explorers-list` (disjoint paths).
Budget: about 16 files read, about 500 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 300–331 — G-scores, G-scoretrend, G-strips, G-bands exact captions/defaults/table columns, content-version weighting and band tokens.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 143–182 — P2/P5/P8/P9, the score rows in the P10 template table and the normalized-score unit rule.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 — F1–F7, especially F1 exact identity and F4 metadata, and the score-source applicability rows.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 558–576 — S-quality layout, DOM order and acceptance.
5. `packages/yakka-analytics/web/js/panels/score-ranges.js` lines 15–120, 120–265.
6. `packages/yakka-analytics/web/js/panels/score-trend.js` lines 20–136; `score-strips.js` lines 16–150; `band-mix.js` lines 14–130.
7. `packages/yakka-analytics/tests/trends-quality/quality.test.mjs` — old assertions to replace.
8. `docs/plans/30-analytics-operable-chrome/mockups/quality.png` and `mockups/src/quality.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

All four Quality panels state one literal sentence each, count every content version once where the contract says so, use the published scorer and baseline consistently, keep scores as normalized 0–1 (never percentages), and refuse a repeated multi-kind scope with the exact sentence.

## Contract

Settled by DESIGN.md. Register these literals verbatim and select them by `spec.scope.captionKey`:

- G-scores (`score-ranges`, `G-scores`): `Each row shows design clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.`
- G-scoretrend (`score-trend`, `G-scoretrend`): `Each line shows design clarity scores over time for one session model; the middle line is the median and the outer lines bound the middle half.`
- G-strips (`score-strips`, `G-strips`): `Each dot is a file’s latest clarity score, grouped by document kind; dots farther right have higher scores.`
- G-bands (`band-mix`, `G-bands`): `Each bar counts files of one document kind by clarity band; unscored files are shown separately from scored files.`

Per item:

- **G-scores:** horizontal ranges X=clarity 0–1, Y=harness, content-version weighted (`content_version`), all-history baseline band from `/v1/baselines?population=content&kind=design&check=clarity`; axes P2/P5/P8/P9 with harness/ranges fixed and global kind else Design; P5 Check/Scorer selects; default clarity if present else first published check, and first lexical scorer with a positive baseline else first lexical else unsupported. Table Group, Count (content versions), Minimum, Lower quarter, Median, Upper quarter, 95th percentile, Maximum, Baseline lower quarter, Baseline median, Baseline upper quarter; group asc.
- **G-scoretrend:** lines X=event-time buckets day ≤90d, week ≤730d, else month (all uses schema retained span); Y=score 0–1, median solid, quartiles dashed, group session_model; P2/P5; table Bucket, Group, Count, Lower quarter, Median, Upper quarter; time/group asc.
- **G-strips:** dot strips X=score 0–1, Y=document kind, one dot per latest file (not per content hash); fixed `kind` and `score:clarity`; P5 check/scorer; table Repository, Path, Kind, Score, Scorer, Observed; identity asc.
- **G-bands:** stacked horizontal bars X=file count, Y=kind, series=published clarity band plus unscored plus baseline unavailable; derived from the selected P5 check (`band:{check}`); low `--yk-status-bad`, mid `--yk-status-warn`, high `--yk-status-good`, unscored `--yk-neutral-unscored`, unavailable `--yk-neutral-unknown`; table Kind, Band, Files; kind asc then existing band order, then unscored/baseline unavailable.

Common:

- P5 is the only panel control beyond P2/P8/P9: Check and Scorer, catalogue order, encoded in `scope.check`/`scope.scorer`, applied to `/scores`, `/score-series`, `/entities` and `/baselines` together. A missing baseline/missing scorer is labelled, not silently dropped.
- Global kind: repeated multi-kind scope is refused on these single-kind endpoints with exactly `Choose one document kind for this chart.`; default Design when no kind is active.
- Unit is `normalized score (0–1)`; never multiply by 100 or call it a percentage; table/formatter use this label.
- Use V3 tokens (no white surface), minimum 160px chart, T1–T5 states with caption visible, local chart/table toggle, 30px rows; `—` for unavailable, `0` only for a real zero.
- Applicability: an active filter outside a score source's supported set returns the F refusal with no marks and the exact singular/plural sentence, caption unchanged.

## Changes

- Add caption registration/key selection to the four modules with the exact strings.
- Replace inline chart+table with `mountPanelViews`; keep the chart kit calls.
- Replace the current score controls with the P5 Check/Scorer selects (remove any extra scorer/kind chooser, the one-item chooser rows and any band selector). Apply control changes through one `pN` push and reload only the panel.
- Query `/baselines` with the same kind/check/scorer as the scores request and draw the baseline neutral band; keep content-version weighting and latest-file strips distinct in copy and table.
- Add the multi-kind refusal and the filter-applicability refusal with no marks; keep caption and table usable for supported scopes.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, every other panel and explorer, and every test not named above. No API field, new scorer math, content-version weighting change, or baseline semantics change.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/operable-chrome/quality-captions-unit.test.mjs tests/trends-quality/quality.test.mjs` → all pass. Assert the four literal captions and caption keys, P5 option order/defaults and single-kind refusal text, content-version and latest-file counting, all-history baseline band, band colour tokens and table order, normalized-score unit, and exact F refusal with no marks.
- Observable: at 1440×900, Quality renders scores/trend in the first row, strips/bands in the second, each caption one sentence above its chart/table, every row 30±1px, and changing Check updates plot, baseline and caption label together.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
