# Brief: phase2-12 — Phase 2 acceptance harness and proof

Consumer: a product build worker for Plan 30 phase 2, proof harness only.
Owned paths: new `packages/yakka-analytics/tests/operable-chrome/phase2-acceptance.test.mjs`, new `packages/yakka-analytics/tests/operable-chrome/harness.mjs`, and a test-only Go fixture file under `packages/yakka/internal/serve/` named `analytics_phase2_fixture_test.go` if the existing Plan 30 fixture lacks required shapes. You may extend `packages/yakka-analytics/tests/plan30/harness.mjs` only additively. Touch no product file.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase2-12-proof-harness.md` as the phase-2 evidence matrix: every F1–F6, G catalogue item, P1–P10, T1–T5, V1–V5 and every S-start…S-ops check with pass/fail, the exact request/URL or screenshot proving it, and any failure's owning unit. Include it in the commit.
Depends on: `phase2-01` through `phase2-11`.
Runs alongside: nothing (final wave).
Budget: about 20 files read, about 550 lines added, 70 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit what passes, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result. This unit proves; it does not fix product behaviour. A failure is reported against its owning unit.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 1031–1038 — the Phase 2 outcome and its proof set.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–182 — V1–V5, C1–C11, T1–T5, P1–P10 (the matrix you must fill).
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 184–475 — every G item and literal caption.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 477–784 — every S-start…S-ops route, region order, table and acceptance.
5. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 83–97 — F1–F6 and the exact refusal sentences.
6. `packages/yakka-analytics/tests/plan30/phase1-acceptance.test.mjs` — the harness/assertion idiom, `go`, `run`, request capture, `waitIdle`, screenshots and failure isolation.
7. `packages/yakka-analytics/tests/plan30/harness.mjs` lines 1–260 — `startPlan30Harness`, fixture API, wait predicates and expected shapes.
8. `packages/yakka-analytics/tests/charts-time/browser.mjs`, `tests/operable-chrome/*.test.mjs` — existing unit patterns to reuse.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

One reproducible Chromium acceptance test at 1440×900 against the real Go fixture proves the whole Phase 2 outcome, including deep links, saved boards, all-history comparisons, both themes, every literal caption, every control change and every refusal, and the report records each ID with its evidence.

## Contract

Settled by DESIGN.md. The suite must:

- Start the real Plan 30 fixture (`startPlan30Harness`) or an additive extension; no request interception, no synthetic API JSON, no production fixture mode, no fixed sleeps; wait on URL/request-count/render predicates or the harness idle signal.
- Capture every analytics request with method/path/query/status; assert the required `all`, `win`, `cmp`, `sort`, `bucket`, `grain`, `dim`, `measure`, encoded `pN`, `cursor`/`limit` and no silent filter dropping.
- Visit S-start, S-pulse, S-trends, S-cost, S-quality, S-tools, S-workflow, S-compare, S-scatter, S-plans, S-plan-detail, S-sessions, S-session-detail, S-ledger, S-artifact and S-ops directly; assert nav/toolbar, region DOM order and widths, exact table column lists/orders, 30±1px rows and the literal caption text from the G/S contract.
- Exercise every offered control once: P1–P9 where advertised (measure/group/chart/grain/check/scorer/scatter axes/table toggle/plan), C1–C11, sorting, row Open, Select, Copy, tabs, version and from/to selects, Load more/Retry/All history/Reset; assert the URL delta, request delta, caption expansion and exact-population count.
- Prove F1–F6: an unsupported filter removes marks/values and shows the exact sentence with the caption still visible; metadata exceptions and the whole-session exception are labelled; no unfiltered rows are shown under a filtered header.
- Prove T1–T5 with delayed/empty/error/≥237-row fixtures; T4 must reach 100→200→237 with exact identities once and frozen scope; failure leaves same-scope rows and retries the next page.
- Prove V1–V5 in both themes: 1440 width geometry, no white chart surface, stable categorical colours, no decorative pills/chips, nav order and `aria-current`, no Invite/Add member/Change role.
- Prove deep links/saved-board restore and all-history comparisons, not only defaults; include at least one plan-detail, session-detail, artifact version/diff and ops footprint path.
- Write screenshots to `.scratch/plan30-chrome/phase2-screens/` (gitignored) at 1440×900 for every board, each list and two detail screens, in both themes; reference the file names in the report.
- Fill the report matrix with every ID and evidence; group failures by owning unit; never weaken an existing phase 1 or unit test, never edit product code, and never mark an ID pass without an executed assertion or screenshot comparison.

## Changes

- Add the new suite and harness wrapper; reuse the fixture and browser helpers; add the minimal test-only fixture only if a shape is absent.
- Add only the assertions above (no product edits). If a check cannot pass, record it as fail with the owning unit in the report and still complete the rest of the matrix.

### Keep untouched

Every product file (`web/**`, `internal/**` except the new `_test.go`), every board/preset/panel/explorer/CSS file, every existing test (including `tests/plan30/*`), `IMPLEMENTATION.md`, and `DESIGN.md`. No fixture-mode hook in production code, no changed Go route, no deploy.

## Done evidence

- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-reporter=spec tests/operable-chrome/phase2-acceptance.test.mjs` → runs and reports per-ID pass/fail. All Phase 2 IDs pass, or each failure is tied to its owning unit.
- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs` → still passes (no regression, no edits).
- `git diff --stat` shows only the new test/harness files and the report; `go test ./packages/yakka/internal/serve/...` or the repo's documented test command passes if you added a Go test file.
- Observable: the screenshots show every board/list/detail at 1440×900 in both themes with the prescribed order and captions.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192`), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then the per-ID summary (counts pass/fail with owned failures named), the check output, screenshot paths, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
