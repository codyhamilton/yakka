# Brief: phase2-08 — Plans, Sessions and Event ledger lists

Consumer: a product build worker for Plan 30 phase 2, explorer list screens.
Owned paths: `packages/yakka-analytics/web/js/explorers/ledger.js`, `plans.js` (list mode only), `sessions.js` (list mode only), `packages/yakka-analytics/web/js/panels/ledger-table.js`, `packages/yakka-analytics/web/css/plans.css`, `sessions.css`, `ledger.css`, and tests `packages/yakka-analytics/tests/workspace/ledger.test.mjs`, `tests/operable-chrome/ledger-states-unit.test.mjs`, `tests/plans-artifacts/plans-list.test.mjs`, `tests/scatter-sessions/sessions.test.mjs` only. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-08-explorers-list.md` listing S-plans, S-sessions and S-ledger, T1–T4, C1–C11, V1–V5 and the F exceptions that apply with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase2-01-shared-caption-applicability`, `phase2-02-board-order-start`.
Runs alongside: `phase2-03-pulse-activity`, `phase2-04-trends-cost-time`, `phase2-05-distribution-compare`, `phase2-06-quality`, `phase2-07-scatter` (disjoint paths).
Budget: about 20 files read, about 550 lines changed, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 657–674 — S-plans columns, widths, Measure/Direction sorting, T4 and Open link.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 695–712 — S-sessions columns, widths, Select semantics, sorting and Open link.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 730–747 — S-ledger nine columns, exact caption, served order, Open rules and no default chart.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 133–142 — T1–T5 (loading/empty/error/paging/chart errors), 30px rows, nulls and units.
5. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 113–132 — C controls and V constraints for stacked wide tables and internal scroll.
6. `packages/yakka-analytics/web/js/explorers/ledger.js` lines 1–170, 170–360; `ledger-table.js` lines 1–220.
7. `packages/yakka-analytics/web/js/explorers/plans.js` lines 1–180 and its list render/`load` paths; `sessions.js` lines 1–190.
8. `packages/yakka-analytics/tests/workspace/ledger.test.mjs`, `tests/operable-chrome/ledger-states-unit.test.mjs`, `tests/plans-artifacts/plans-list.test.mjs`, `tests/scatter-sessions/sessions.test.mjs`.
9. `docs/plans/30-analytics-operable-chrome/mockups/plans.png`, `sessions.png`, `ledger.png` and the matching `mockups/src/*.html`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

The three list screens match their exact region order, column list/widths, sorting, selection and paging contracts; the ledger is a nine-column table (not the frozen fourteen-column panel table) with its literal caption; and each screen shows T1–T4 honestly without treating a loaded page as a total.

## Contract

Settled by DESIGN.md.

- **S-plans:** full-width table (minimum 1416px, internal horizontal scroll), controls immediately above. Columns exactly Plan identity (220px), Associated cost USD (110), Sessions (70), Shared sessions (80), Files (60), Versions (70), Complete/unreported/started executions (160), Complete share % (100), Latest design score / scorer (180), Last observed (150), Open (70). Sort control Measure: `associated_cost_usd` default, then sessions, shared_sessions, artifacts, versions, executions, complete_share, last_ts only where the schema publishes; Direction Descending default/Ascending; URL `sort={measure}:{desc|asc}`, `/entities?grain=plan&sort=...`, clear cursor. No design-score sort without a server scalar scorer contract; label the scorer, never average scorers. T4 `Load more plans`; row Open to encoded `/plans/{repo}/{plan}` preserving scope; no centre-aligned metrics. Remove the `scatter-plan` (and any non-table) panel from the plans list: S-plans is a table screen.
- **S-sessions:** full-width table, controls above. Columns exactly Select (32px), Session ID (180), Harness (90), Model (140), Repository (180), Cost USD (100), Calls (70), Unpriced (70), Hook events (80), Commits (70), Artifact versions (80), Span seconds (90), Open (70); minimum 1416px internal scroll. Source `/entities?grain=session`, fields `id,l.harness,session_model,session_repo,m.cost_usd,model_calls,unpriced_calls,hook_events,commits,artifact_versions,duration_s`. Sort select Cost default, Calls, Unpriced, Hook events, Commits, Artifact versions, Span (capability intersection); Direction Descending default/Ascending; URL/API `sort=measure:dir`. Select checkbox default off changes the existing selection-tray predicate and never filters immediately. Open scoped `/sessions/{id}`. T4 `Load more sessions`.
- **S-ledger:** full-width header page count, ledger table, T4 `Load more events`. Source `/explore` with `limit=100` and cursor; rows are facts UNION rejections; fields `ts,type,repo_id,plan,kind,path,conversation_id,rejection_stage,cost_usd`. Columns exactly Time (150px), Type (120), Repository (160), Plan (180), Kind (70), Path/event (remaining, min 240), Conversation (150), Stage (80), Cost USD (90). Served keyset order event-time DESC/type/identity; no local page sort control. Row click/Enter opens inspector P9; Open artifact only with exact repo/path; Open session only with a conversation_id. Caption exactly `Each row is a retained event or rejection matching these filters; load more rows to continue through the same result set.` No chart in the default ledger.

Common: T1 loading keeps headers and shows one 30px `Loading {table caption}…` row with `aria-busy=true`; T2 exact empty sentence plus All history/Reset filters; T3 exact error sentence with sanitized code and Retry, 401/403/503 named; T4 `Load more {noun}` uses API `next` as cursor with frozen bounds/tenant/filter/sort, appends without duplicating identities, and never calls a loaded page a total; `—` for unavailable, `0` only real zero; text cells ellipsize with a full-identity title; left alignment; `scope=col`; 30px rows. A 1d/repo/Brief filter must update counts/rows or show the exact F refusal, never stale rows. Tenant switch clears rows immediately.

## Changes

- Rewrite the ledger list to use a dedicated nine-column table renderer (or a ledger mode in `ledger-table.js`) rather than the panel's 14+Select table; preserve the already-passing T1–T4 state tests and add the exact caption.
- Restore S-plans to a table-only list: exact columns/widths, Measure/Direction sort, T4, scoped Open, scorer-labelled score; delete the leftover `scatter-plan` panel insertion and any chart in the list.
- Restore S-sessions columns/widths/sort/Select semantics and scoped Open; keep selection as a tray predicate.
- Add `sort` URL/API round-trip and cursor reset on sort/scope; ensure row keys are stable and identity-unique.
- Add the exact F/empty/error/paging vocabulary already shared; do not fork a second state system.

### Keep untouched

`app.js`, boards/presets/registrations, `panel-frame.js`, `registry.js`, `p10-shared.js`, `panel-state.js`, `charts/*`, every panel (including `scatter-plan`, used on Scatter), detail renderers in `plans.js`/`sessions.js` (owned by `phase2-09`), `artifact.js`, `ops.js`, and every test not named above. No new API field/endpoint, paging semantics, selection model, or attribution change.

## Done evidence

Identify the failing check first.

- `cd packages/yakka-analytics && node --test tests/workspace/ledger.test.mjs tests/operable-chrome/ledger-states-unit.test.mjs tests/plans-artifacts/plans-list.test.mjs tests/scatter-sessions/sessions.test.mjs` → all pass. Add/keep assertions for the exact column lists/widths, ledger caption, default sort/direction and URL round-trip, Select-not-filter, scoped Open, T1–T4, and the plans list containing no chart/`scatter-plan`.
- `cd packages/yakka-analytics && node --test tests/plans-artifacts/plan-detail.test.mjs` → report any failure; it belongs to `phase2-09` if it touches detail rendering.
- Observable: at 1440×900 each list occupies full width with internal horizontal scroll at its minimum width, rows measure 30±1px, and the ledger shows nine columns plus no Select column.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
