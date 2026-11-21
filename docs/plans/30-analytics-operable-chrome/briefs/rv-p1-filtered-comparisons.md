# Plan 30 — Blocking review fix: filtered Pulse comparisons

## Consumer and context

Executor, implement the single blocking finding in `/home/codyh/workspace/.briefs/yakka/30-rv-p1.md` in repository `/home/codyh/workspace/yakka-build/30`, branch `feat/30-analytics-operable-chrome`. Read the review finding and the cited design contracts before editing. This is a focused follow-up to the already closed Phase 1. Change only what is needed to ensure Pulse previous-period summary and Movers reads preserve the selected repository and document kind. Do not edit other worktrees or branches.

## Binding UI direction

Implement every binding contract exactly as written in DESIGN.md. Treat the written DESIGN.md as authoritative and literal. Implement every applicable binding contract in its named sections, including V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen including detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units, and literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts, and the “Files and components Executor must change” list. Treat every per-item acceptance check ID named by the phase outcome as a checklist; each needs a test or recorded browser evidence, and the result file must list each applicable ID with pass/fail and evidence. Match the mockup PNG for each screen touched (layout, order, density, controls, captions, colours); open the PNG and matching `mockups/src/*.html` and compare them with an own 1440×900 Chromium screenshot of the real implementation. Where image and text disagree, the text wins. Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen Assumption Ledger decisions. Add no scope, IAM/attribution architecture, invites/roles/membership-write API, lifecycle engine, or auth gate changes. Diagnose and fix failures; report only a genuine design contradiction as `design-change: <what>`.

## Spec sections, checks, and visual reference

- `DESIGN.md` — Domain: shell and scope, especially Proof S1; Domain: filter applicability, especially query/summary and F1; C3/C4; G-movers; S-pulse; shared layout V and table/status rules T where the existing Pulse surfaces use them.
- Applicable acceptance IDs: S1, C3, C4, F1, G-movers, S-pulse. Report each with pass/fail and evidence. Re-run/check the design's existing Pulse and scope behavior needed to prove the change; do not claim unrelated Phase 2 checks.
- Visual reference to open and compare: `mockups/pulse.png` and `mockups/src/pulse.html`.

## Work

1. Trace read-context construction for Pulse previous-period summary and Movers current, series, previous, and unpriced requests. Preserve tenant and the committed supported scope filters while replacing only the time bounds for a previous-period read. Keep request parameters consistent with the chosen read adapter and its declared applicability; never drop repository or kind and then render unfiltered results.
2. Add regression coverage that captures actual outgoing requests for a filtered Pulse view, asserting tenant, repository, kind, and correct previous-period absolute bounds on applicable comparison reads. Assert current-window requests remain unchanged and that no unrelated filter is added to the previous window. Include a real Chromium/browser assertion if the existing harness supports it.
3. Open the Pulse mockup PNG and matching HTML, then compare both with an own 1440×900 Chromium screenshot after the fix. Store evidence under `.scratch/` (never `/tmp`) and record paths and visual conclusion.
4. Run relevant unit/acceptance tests under the stated constraints: `PUBLIC_CANVAS_TEST_MODE=true`, `vitest --maxWorkers=3` if Vitest is involved, 8 GiB memory cap using the existing supported mechanism (do not use a virtual-memory ulimit that prevents Node startup), no animation/timing tests. Do not run signed-in production checks. Do not deploy, push, merge, rebase, force-push, reset/delete a tenant, or use the default tenant; never run fly or wrangler or read/print secrets/trial token.

## Files and components

Expected product surface: `packages/yakka-analytics/web/js/panels/pulse-strips.js`, `packages/yakka-analytics/web/js/panels/movers.js`, and focused tests/harness only if necessary. Do not edit API semantics or other chart/read paths. If another file is required, explain why in the report.

## Done evidence and handoff

- Fix only the blocking C3/C4 issue described above; no unrelated UI changes.
- Write `docs/plans/30-analytics-operable-chrome/reports/rv-p1-filtered-comparisons.md` before your product commit. It must list S1, C3, C4, F1, G-movers, and S-pulse individually with pass/fail plus concrete test/browser/screenshot evidence; record departures, remaining gates, and known problems.
- Commit the product fix and report as `fix: Plan 30 blocking findings (rv-p1)` on this branch. Do not add a Yakka-Phase trailer: Phase 1 already has its closing commit, and this is a targeted review fix.
- Report the resulting commit SHA and exact test commands/results to Executor.
