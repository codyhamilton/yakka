# Implementation: Plan 31 — Legacy tenant adoption

## Run

- Tool: opencode (deepseek-v4.1-flash build orchestrator; hlaunch build-tier sub-runs)
- Session: Plan 31 build queue run `31-p1` (log `/home/codyh/workspace/.briefs/yakka/logs/31-p1-refine.log`)
- Start: 2026-11-22T15:52:00+10:00
- Branch: feat/31-legacy-tenant-adoption (from master at 1f253940)
- Invocation: Phase 1 only, then stop.

## Phase 1 — An unmarked tenant is selectable everywhere in the UI

Status: in progress.

Refine verdict: PROCEED, three units. Briefs in `briefs/`, Units list committed at `d2088fb9`.

Units:
1. `phase1-01-lifecycle-page-selection` (no dependencies). Owns `lifecycle_profile.html`, `lifecycle_profile_phase3_test.go`. Closes A8.
2. `phase1-02-web-ui-selection` (no dependencies). Owns `session-gate.js`, `app.js`, `account-console.js`, `scope-unit.test.mjs`, `identity/browser.test.mjs`. Closes A1.
3. `phase1-03-browser-acceptance` (depends on 01 and 02). Owns `phase3-harness.mjs`, `phase3-acceptance.test.mjs`. Closes A2–A7 and A9.

Dispatch order: 01 and 02 together (disjoint paths), then 03.
