# Brief: phase2-10 — Artifact and Operations screens

Consumer: a product build worker for Plan 30 phase 2, Artifact and Operations.
Owned paths: `packages/yakka-analytics/web/js/explorers/artifact.js`, `artifact-content.js`, `artifact-diff.js`, `packages/yakka-analytics/web/js/ops.js`, `packages/yakka-analytics/web/js/panels/ops-footprint.js`, `packages/yakka-analytics/web/css/artifact.css`, `ops.css`, new `packages/yakka-analytics/tests/operable-chrome/artifact-ops-unit.test.mjs`, and tests `packages/yakka-analytics/tests/workspace/ops.test.mjs`, `tests/plans-artifacts/artifact-diff.test.mjs`, `tests/plans-artifacts/artifact-reader.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-10-artifact-ops.md` listing S-artifact, S-ops, G-artifactscore, G-footprint, T1–T4, C1–C11 and the F/metadata/admin exceptions with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`.
Runs alongside: `phase2-09-plans-session-detail` (disjoint paths).
Budget: about 18 files read, about 550 lines changed, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 460–475 — G-artifactscore and G-footprint exact captions/tables/units.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 747–784 — S-artifact and S-ops region order, controls, sources, exact table columns, metadata notices and admin restriction.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 and 133–142 — F5 outside-filter notice, metadata exceptions, T1–T4.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 143–182 — P5/P8/P9 and the exact score/unit rules.
5. `packages/yakka-analytics/web/js/explorers/artifact.js` lines 1–200 and its version/content composition paths.
6. `packages/yakka-analytics/web/js/explorers/artifact-content.js` lines 1–180; `artifact-diff.js` lines 1–200.
7. `packages/yakka-analytics/web/js/ops.js` lines 1–220; `panels/ops-footprint.js` lines 1–180.
8. `packages/yakka-analytics/tests/workspace/ops.test.mjs`, `tests/plans-artifacts/artifact-diff.test.mjs`, `artifact-reader.test.mjs`.
9. `docs/plans/30-analytics-operable-chrome/mockups/artifact.png`, `ops.png` and matching `mockups/src/*.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Artifact shows the exact file identity, version history, score history and immutable content/diff with no invented score reads or prefix diffs; Operations shows the four fixed health measures, footprint and recent retained records with metadata exceptions and the admin-only refusal stated honestly.

## Contract

Settled by DESIGN.md.

- **S-artifact:** region order identity → version controls → version history → G-artifactscore → Content/Diff. Identity form when repo_id/path absent: Repository select from facets, required Path input, Open artifact sets exact repo_id/path; no aggregate artifact list. URL encodes repo_id/path exactly once; shared repo filter must match identity or show the F5 outside-filter notice. Version select default newest served version, labels timestamp/hash, URL `hash` → `content?repo_id=&path=&hash=`. Compare from/to default previous/latest, URLs respectively, two content reads only after Show diff. Version table Observed (150px), Hash (180), Kind (80), Score/scorer (180), Content state (110), Screen verdict (110), Writing session (remaining); observed DESC/hash ASC; T4 `Load more versions`. Text content is plain text, never rendered HTML. Missing/too-large/integrity errors keep the exact state and never diff prefixes. Viewer W, monospace 12px, line height 18px (not a data table); local Copy text and Download text only for complete available bytes; no secret in URLs. Content/Diff tabs local, default Content; Check/Scorer P5 govern the score chart only.
- **G-artifactscore:** line+markers X=version observation time, Y=clarity 0–1, gaps when score unavailable or scorer differs; fixed exact file; `entity?grain=artifact&repo_id=&path=` with `content_hash,ts,scores[check].score,scorer`; only plot entries whose scorer equals the selected scorer; no invented historical reads. Caption exactly `Each point shows this file version’s clarity score at its observation time; higher points mean a higher score under the selected scorer.` Table Observed, Version hash, Check, Scorer, Score; observation time ASC/hash ASC; `—` stays null; no line through missing scores.
- **S-ops:** region order Tenant health table → G-footprint → Recent retained records. Health columns Measure (240px), Count (120), Meaning (remaining); fixed order unpriced calls, unscored-kind content, rejected submissions, unattributed sessions; sources exactly `summary.unpriced_calls`, `event-counts.matched.rejections`, and the two metadata rows below. Second row label `Unscored {kind} content versions (all history)` = `schema.coverage.scored_content_by_kind[kind].total − .scored`, selected global kind else Design; never sum kinds. Fourth row `Sessions without repository attribution (all history)` = `schema.coverage.sessions.without_session_repo`. Both metadata rows carry `All retained data in selected tenant; analytics time and repository filters do not apply.` Missing fields `—`, never zero; denominators labelled; per-measure F applies.
- **G-footprint:** horizontal bars X=bytes binary display, Y=storage category, tenant lifetime; from `/v1/admin/status` selected by exact tenant id, `footprint.{ledger_bytes,wal_bytes,archive_bytes,blob_bytes,pending_bytes,other_bytes}`; P8 only. Caption exactly `Each bar shows retained bytes for one storage category in this tenant; longer bars mean more space used.` Table Storage category, Retained bytes, Display size; bytes DESC/category ASC; exact integer bytes in table.
- **Recent retained records:** columns Time (150px), Type (120px), Path/event (remaining), Stage (100px); `/explore` with global scope; keyset time DESC/source type ASC/source key ASC; T4 `Load more events`; includes facts and rejections, not a rejection-only query; no reason column; no manufactured type filter. Open rejected artifact only with a stored referenced identity; a rejection is not content.
- **Admin:** footprint is an administrator-session read, not an owner entitlement or new endpoint; 403 shows exactly `Storage information is available to server administrators only.`; never infer admin from Owner. Remove server-wide/all-tenant analytics panels; do not remove any server admin API.
- Common: T1–T4 exact vocabulary, 30px rows, `scope=col`, ellipsis/title, left alignment, `—` vs `0`, tenant switch teardown, V3 tokens, Refresh=C9/Retry=P8 only.

## Changes

- Restore the artifact identity/version/history/content/diff region order and exact tables; wire the version select and from/to selects to the encoded URLs; keep plain-text content and complete-bytes-only copy/download.
- Wire G-artifactscore caption/scorer filtering/gap rules and P5 selects.
- Restore the four-row health table with exact labels/sources/metadata notices and per-measure F; restore footprint caption/table/bytes formatting and the admin 403 message; restore the recent-records columns/order/paging.
- Remove all-tenant/server-wide panels from `ops.js` without touching server admin endpoints or Go code.
- Add caption registration/key selection and `mountPanelViews` wiring for footprint/score history; update only the three named test files and the new unit test.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, every other panel/explorer, Go code (including `/v1/admin/status` and auth), and every test not named above. No new endpoint, admin entitlement, content rendering of HTML, diff fallback, or secret in URL.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/workspace/ops.test.mjs tests/plans-artifacts/artifact-diff.test.mjs tests/plans-artifacts/artifact-reader.test.mjs tests/operable-chrome/artifact-ops-unit.test.mjs` → all pass. Assert both literal captions, artifact version/records table columns/orders, exact single-encode and outside-filter notice, scorer-only score history with gaps, complete-bytes copy/download and no prefix diff, the four health rows/sources/notices, footprint bytes order/display, admin 403 text, recent-record columns/order/paging, and T1–T4.
- `cd packages/yakka-analytics && node --test tests/workspace/acceptance.test.mjs` → report any failure; a board-order assertion belongs to `phase2-02`, an ops assertion here.
- Observable: at 1440×900 Artifact shows identity→versions→score→viewer full width in that order and Operations shows health→footprint→records full width, every row 30±1px, and the viewer line height is 18px.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
