# Brief: phase2-09 — Plan and session detail screens

Consumer: a product build worker for Plan 30 phase 2, detail screens.
Owned paths: `packages/yakka-analytics/web/js/explorers/plans.js` (detail mode only), `sessions.js` (detail mode only), `packages/yakka-analytics/web/js/panels/session-lanes.js`, append-only rules in `packages/yakka-analytics/web/css/plans.css` and `sessions.css`, new `packages/yakka-analytics/tests/operable-chrome/detail-screens-unit.test.mjs`, and `packages/yakka-analytics/tests/plans-artifacts/plan-detail.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-09-plans-session-detail.md` listing S-plan-detail, S-session-detail, G-planline, G-sessionlanes, T1–T4, C1–C11 and the F/identity exceptions with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`, `phase2-08-explorers-list`.
Runs alongside: `phase2-10-artifact-ops`, `phase2-11-tools-workflow` (disjoint paths).
Budget: about 18 files read, about 550 lines changed, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 674–695 — S-plan-detail region order, the four tables, exact sources, paging and Open links.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 712–730 — S-session-detail identity, selected/whole strips, lanes, records, total/event exceptions and Back link.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 364–379 and 452–459 — G-planline and G-sessionlanes exact captions/sources/tables.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 and 133–142 — F5 filtered-child identity, metadata exceptions, T1–T4.
5. `packages/yakka-analytics/web/js/explorers/plans.js` — everything from the detail render entry to the end (grep `plan-detail`, `renderPlan`, `collection`), plus its table helpers.
6. `packages/yakka-analytics/web/js/explorers/sessions.js` — detail render and `/conversation` + `/entities` composition paths.
7. `packages/yakka-analytics/web/js/panels/session-lanes.js` lines 1–200; `plan-timeline.js` lines 1–170 (read only; it belongs to `phase2-11`).
8. `packages/yakka-analytics/tests/plans-artifacts/plan-detail.test.mjs`.
9. `docs/plans/30-analytics-operable-chrome/mockups/plan-detail.png`, `session-detail.png` and matching `mockups/src/*.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Both detail screens reproduce their exact region order and tables, keep the exact parent identity and filtered-child semantics, label whole-session/all-history exceptions, and never use unfiltered collection rows or a filtered table's events as a whole-session total.

## Contract

Settled by DESIGN.md.

- **S-plan-detail:** identity/summary strip, G-planline, then Artifacts, Executions, Associated sessions, Plan events tables, each full width, in that order; back link and Open links scope-preserving. Artifacts columns Kind, Path, Latest version, Score/scorer/band, Content, Screen verdict, Writing session cost USD, Open; kind/path ASC. Executions columns Shape, Brief path, Time, Session cost USD, Brief/report scores, Session; time DESC/identity ASC. Sessions columns Conversation, Last observed, Cost USD, Unpriced calls; last observed DESC/id ASC. Events columns Time, Type, Event, Path, Conversation; time DESC/type/identity ASC. Identity/path columns 240px, time 150px, remaining split equally, minimum 1416px internal scroll. Sources exactly `/entities?grain=artifact&repo_id=&plan=`, `/entities?grain=execution&repo_id=&plan=`, then `/entity?grain=plan&repo_id=&plan=&collection=sessions` enriched by `/entities?grain=session&id={conversation_id}` per row, and `/entity?grain=plan&repo_id=&plan=&collection=events`. Each paged collection gets T4. No extra sort controls.
- **S-session-detail:** identity plus separate `Selected window` and `Whole session` measure strips, G-sessionlanes, then Session records. Records columns Time (150px), Event type (120), Repository (180), Path/event (remaining), Cost USD (110); event time DESC/type/identity ASC. Records/timeline source `/explore?conversation_id={id}&limit=100` plus shared scope; T4 `Load more session events`; lanes plot up to 5000 loaded matching marks and say `{n} loaded matching events plotted`; table may continue, with Open full ledger adding `conversation_id`. Selected-window totals from `/entities?grain=session&id={id}` with applicable global scope (never `conversation.window_totals` when repo/kind is active); whole-session totals from `/conversation?id=` and always labelled as the whole-session exception. P8/P9 only, no invented duration filter.
- **G-planline:** lines X=event-time bucket, Y=count; `entities?grain=plan&mode=aggregate&dim=time&stat=count&bucket=auto` (the plan-timeline module is implemented by `phase2-11`; here only its placement and proof). Caption from G-planline verbatim.
- **G-sessionlanes:** lanes X=event time, Y=event type, markers only, no inferred duration; exact identity; P8/P9. Caption exactly `Each marker shows a retained event in this session matching the filters; gaps between markers do not prove the session was idle.` Its chart table-view columns are Event time, Event type, Repository, Plan, Path, Conversation, Session cost (USD) where served, event time ASC then stable identity; the full-width Session records table uses the S-session-detail columns above. If sharing one renderer, configure both column sets explicitly rather than picking one silently.

Common: identity columns ellipsize with a title; `—` unavailable/`0` only real zero; 30px rows; header `scope=col`; T1–T4 vocabulary exact; each collection/table gives its own F refusal when another active scope cannot be applied faithfully (do not show unfiltered rows); tenant switch tears down all rows and in-flight requests; preserve parent identity and filtered-child semantics F5; Open links go to scoped artifact/session details.

## Changes

- Restore the four plan-detail tables with exact columns/widths/order/sources and per-collection paging; enrich associated sessions by exact session identity; keep collection rows filtered and labelled.
- Add the two measure strips and the records table to session detail; compose `/conversation` (whole-session) and `/entities?grain=session&id=` (selected-window) without substituting one for the other; label the whole-session exception visibly.
- Wire G-sessionlanes caption and 5000-mark statement; ensure no duration is inferred.
- Add the F/refusal, empty/error and paging states per region; do not fork the shared state helper.
- Update `plan-detail.test.mjs` and add the new unit test; append only to the two CSS files.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, all list-mode code in `plans.js`/`sessions.js` (owned by `phase2-08`; coordinate by keeping list render functions unchanged), `plan-timeline.js` (owned by `phase2-11`), every other panel/explorer, and every test not named above. No new API field, collection endpoint, duration inference, attribution or whole-session semantics change.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/plans-artifacts/plan-detail.test.mjs tests/operable-chrome/detail-screens-unit.test.mjs` → all pass. Assert exact region order, the four plan-detail table column lists/orders and sources, per-collection paging/refusal, the two session strips and their distinct sources, records columns/order, exact G-sessionlanes caption and 5000-mark sentence, Back/Open scope preservation, and T1–T4.
- `cd packages/yakka-analytics && node --test tests/plans-artifacts/plans-list.test.mjs tests/scatter-sessions/sessions.test.mjs` → report any failure; list-mode regressions belong to `phase2-08`.
- Observable: at 1440×900 each detail screen renders its regions full width in the prescribed order, every table row is 30±1px, and switching scope changes the filtered tables/timeline while the whole-session strip stays labelled as an exception.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. If the G-sessionlanes table and S-session-detail records columns cannot share one renderer without ambiguity, implement both column sets as specified and report that fact, not a silent choice.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
