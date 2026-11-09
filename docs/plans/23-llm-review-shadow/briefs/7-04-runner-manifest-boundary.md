# Brief: 7-04 — Reconcile frozen capture and runner range identity

Consumer: Plan 23 Phase 7 integration and the next operator running the frozen manifest.
Owned paths: `tools/shadow-review-trial/runner.py`, `tools/shadow-review-trial/test_runner.py`, `tools/shadow-review-trial/test_phase7.py`. Touch nothing else except this brief's report and the phase implementation record.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/7-04-runner-manifest-boundary.md` and include it in the commit.
Depends on: 7-01, 7-03.
Runs alongside: nothing.
Budget: 8 files to read, about 150 lines to change, 20 tool turns. Past the budget, stop and hand off the specific unresolved contract.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Phase 7 outcome and Domain: Historical trial (evidence).
2. `docs/plans/23-llm-review-shadow/reports/7-03-cli-smoke-rehearsal.md` — observed integration failure.
3. `tools/shadow-review-trial/manifest.py`, `runner.py`, `test_phase7.py` — frozen capture shape and the failing adapter.
4. `plugins/yakka/client/yakka.py` — `CaptureChange` range metadata (`head` checkout state and `resolved_head` selected range tip).

## Goal

Run the Phase 6 frozen manifest unchanged through the Phase 7 runner. Preserve the exact `base..head` range that the manifest captured, without a fixture-only schema rewrite.

## Contract

The design's Historical trial contract requires each case's recorded base and head and a range capture over those commits. Phase 6 records `head_sha` as the selected case tip and preserves the Phase 1 capture response, where `resolved_head` is the selected range tip and `head` is checkout state. The Phase 7 runner must validate and send the selected range tip; it must not treat checkout state as the range tip or mutate/re-hash a frozen manifest.

## Changes

- Reconcile `build_request` with the Phase 6 capture schema: validate the range tip using `resolved_head` when present, retain support for runner fixtures whose capture already has the frozen tip in `head`, and send the canonical case `head_sha` as the REST capture `head`.
- Keep all other frozen capture data and the manifest hash unchanged. Do not refresh, rewrite, or re-hash the manifest in production code.
- Replace the Phase 7 fixture adapter with the unchanged manifest produced by `manifest`; assert the manifest bytes/hash are unchanged and the fake REST request carries the frozen base/head.
- Do not edit the manifest generator, REST server, CLI, report calculator, provider config, or any other plan.

### Keep untouched

Do not change Phase 6 manifest output or server semantics. Preserve the current manifest hash validation, dry-run, retry, resume, duplicate, effort-arm, and fake-endpoint behavior.

## Done evidence

Before changes, run `python3 -m unittest tools/shadow-review-trial/test_phase7.py`; report the observed `RunnerError: capture differs from its frozen range`.

- After changes, `python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` passes.
- The rehearsal uses the direct frozen manifest with no capture rewrite, completes all nine fake-endpoint case/effort reviews, and proves request `base` and `head` match the manifest's `base_sha` and `head_sha`.
- `git diff --check` passes. Use only local fixtures; no live provider call, credentials, deployment, Fly, or Wrangler.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include the failing check output before and after, changes, deviations, contradictions, and any unfinished work. Do not fix unrelated issues.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
