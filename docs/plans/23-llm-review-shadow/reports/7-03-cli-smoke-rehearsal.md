# 7-03 CLI, fake-endpoint smoke and rehearsal

Status: done with concerns.

## What changed

Added `run`, `report`, and `smoke` dispatch while retaining the `manifest` arguments and JSON summary. Runner endpoint and auth are explicit inputs; the command does not discover credentials. Smoke starts a loopback fake REST server, exercises a successful synthetic receipt and a `read`-scope POST refusal, and emits only the review id, status, model, token counts, cost, and refusal result. The README documents command usage, cost preflight, resume and duplicate handling, report inputs, fixture-only smoke, and the four layout fields.

The Phase 7 fixtures freeze three historical cases, exercise all three effort arms through a fake REST endpoint, save its GET records, create an adjudication fixture, and compare the CLI report with the deterministic report calculation. Smoke and rehearsal use synthetic auth and make no provider calls.

## Checks

Before changes, the required unittest command failed to import `tools/shadow-review-trial/test_phase7.py` (`ModuleNotFoundError`); the other 20 tests passed. After changes, the same command ran 21 tests and passed. `git diff --check` passed. The README contains all required `Consumers`, `Build`, `Test`, and `Release` fields. `python3 -m unittest tools.release.test_layout` ran 7 tests: 6 passed and the repository check failed on the existing unrelated violation `packages/yakka-analytics/src/lib/investigation/InvestigationShell.svelte: tools/ConversationsTool.svelte`, also recorded during Phase 6.

## Concerns and unfinished integration

The end-to-end rehearsal uses a test-only adapter between the frozen manifest and runner. Phase 6 `manifest.py` stores the range tip in `capture.resolved_head` and leaves `capture.head` as the checked-out HEAD; Phase 7 `runner.py` requires `capture.head == case.head_sha`. Passing a fresh manifest directly to `run` therefore fails with `RunnerError: capture differs from its frozen range` (observed on the first fixture attempt). Both module contracts are outside this brief and were left untouched. The phase's real manifest-to-run integration remains unfinished until their owners reconcile that field contract; the 3×3 CLI composition currently proves against the runner-compatible fixture form.

No other deviation or design contradiction was found. The 50-case/49-case, asymmetric failure, retry, duplicate, partial coverage, cap, and no-replay resume proofs remain covered by the 7-01 and 7-02 suites. No live endpoint, provider, credential, deployment, Fly, or Wrangler action was used.
