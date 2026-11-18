# Brief: 13-05 — Phase 13 integrated acceptance

Consumer: the Plan 20 orchestrator, for independent phase closure.
Owned paths: `packages/yakka-analytics/tests/release-matrix/acceptance.test.mjs`, `docs/plans/20-analytics-reset/reports/13-05-acceptance.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/13-05-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 13-01, 13-02, 13-03 and 13-04.
Runs alongside: Nothing; run last.
Budget: 12 files to read, about 350 lines to change, 12 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — exact Phase 13 outcome and all five unit rows.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 11.2, 11.5–11.6, 12, 14, 17.1, 17.6–17.7.
3. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — Phase 12 closed record and carried list; then Phase 13 unit reports.
4. `packages/yakka-analytics/tests/release-matrix/` — matrix and recorder interfaces from 13-01.
5. `packages/yakka/internal/serve/analytics_pageset_test.go` and `testdata/browser-request-shapes.json` — 13-02 smoke/profile evidence.
6. `packages/yakka-analytics/tests/identity/` and `packages/yakka/internal/serve/site_test.go` — 13-03 account/route proof.
7. `packages/yakka-analytics/README.md`, `docs/design/03-remote-service.md`, CONTRACTS sections 14/17.6 and 13-04 report — release docs and gates.

## Goal

Run and record the complete Phase 13 evidence once all component units finish. This unit is the integrated phase record, not a second implementation of browser, account, server or release coverage; the orchestrator must independently verify the phase outcome.

## Contract

DESIGN.md Phase 13 full outcome applies verbatim: “The complete preset/gesture/state/deep-link matrix passes against both the release binary and Pages-style static serving, including old-server capability degradation. Account flows pass the Pages-faithful rig; embedded local `/device` and `/oauth/callback` serve the shell while remote `/oauth/callback` retains the API JSON route. Browser-recorded request shapes including all-history are covered by server smoke/benchmark tests under the existing p95 contract; Go, release-layout/placeholder, residual-name and secret checks pass. Stable route/docs and package instructions describe the final no-build output, automation-on-merge Pages deployment and separate API release. The ready implementation PR carries the plan marker; no manual deploy/configuration/secrets action is a phase outcome.”

CONTRACTS.md 17.7 supplies synthetic-only fixture/browser constraints; 17.6 and 14 make Pages automation and PR marker external gates, not verified deployment outcomes.

## Changes

Add one concise integrated acceptance test/report that runs component entry points and verifies there are no missing/skipped outcomes. Use the exact counts reported by component units, not guessed totals. Run browser suites serially with `--test-concurrency=1`; memory caps 8G; `TMPDIR` in-worktree and cleaned; fixture-only; no `/tmp`.

Run `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./... -count=1` from `packages/yakka`; `python3 -m unittest tools.release.test_release`; `python3 tools/release/test_layout.py`; `python3 tools/release/test_scan_residual_names.py`; the server page-set smoke and opt-in fixture p95 profile; the matrix against both hosts; and account browser/route checks. Include `git diff --check`. Respect exact repository commands in the component briefs. Do not add Python drizzle checks or any secret-read step.

Append a Phase 13 close-out record to `IMPLEMENTATION.md` only if the Plan 20 orchestrator explicitly owns that file after the worker handoffs. This acceptance worker itself does not edit it; its report captures evidence and gates.

### Keep untouched

Do not alter component code/tests to make a failing integrated run pass; return the failing unit/check and owning brief. Do not edit IMPLEMENTATION.md, DESIGN.md, CONTRACTS.md, product code, release config, external automation, secrets, live tenant data or any path outside the two owned paths.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `TMPDIR=/home/codyh/.cache/plan20p13 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/release-matrix/acceptance.test.mjs` → 1/1 integrated acceptance test passes; it verifies the 13-01 matrix's two targets and exact component counts, with zero skips and <=4 in flight.
- Server smoke + fixture profiler from 13-02 → smoke all recorded request shapes returns 200; profile exact same case count and p95 <=500 ms, including all-history.
- Identity/route command from 13-03 → identity browser subtests pass; local shell paths and remote callback JSON pass.
- Release and docs checks from 13-04 → release, layout, residual-name and bundle-secret checks pass with exact counts; README and stable docs match final release state.
- `TMPDIR=/home/codyh/.cache/plan20p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./... -count=1` from `packages/yakka` → all Go packages pass (report exact package/test totals from output).
- `git diff --check` → clean; report every check and output count, temporary scratch cleanup, deviations and contradictions.
- `gate:` external Pages automation must accept `./web`; `gate:` ready implementation PR body must carry `Yakka-Plan: docs/plans/20-analytics-reset`. No deploy or configuration action is performed or claimed.
- The 12-04 report feedback gap is recorded as a process carry: artifact feedback had no version/queued copy for `reports/12-04-artifact-diff.md`; it did not block product evidence and is not repaired here.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then integrated command outputs/counts, matrix hosts, p95 and shape count, account route evidence, doc state, deviations/contradictions, carried items and all `gate:` lines. List all 13-01 through 13-04 report paths.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
