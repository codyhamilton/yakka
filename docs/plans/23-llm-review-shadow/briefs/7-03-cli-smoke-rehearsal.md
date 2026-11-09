# Brief: 7-03 — CLI, fake-endpoint smoke and rehearsal integration

Consumer: Plan 23 Phase 7 operator interface and the Phase 7 closing review.
Owned paths: `tools/shadow-review-trial/cli.py`, `tools/shadow-review-trial/test_phase7.py`, `tools/shadow-review-trial/README.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/7-03-cli-smoke-rehearsal.md` and include it in the commit.
Depends on: 7-01 and 7-02; Phase 6 manifest.
Runs alongside: nothing; this unit composes both modules and owns the shared CLI surface.
Budget: 14 files to read, about 700 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Phase 7 full outcome, Domain: Historical trial and alignment report, and Phase 7 Units.
2. `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` — Phase 6 verification and carried decisions.
3. `tools/shadow-review-trial/cli.py`, `README.md`, `manifest.py`, `runner.py`, and `report.py` — command and module contracts from Phase 6 and 7-01/7-02.
4. `packages/yakka/internal/serve/reviews_test.go`, `mcp_review_test.go`, and `packages/yakka/internal/review/orchestrator_test.go` — REST scope, smoke evidence, dry-run and status fixtures.

## Goal

Expose the Phase 7 `run`, `report`, and `smoke` commands and prove them together against fixtures. The smoke/rehearsal path must use a fake endpoint and must not call a live model.

## Contract

Binding: `DESIGN.md`, Phase 7 outcome. `smoke` prints a fixture evidence record with review id, status, returned model id, tokens, cost, and a `read`-scope refusal, with no credential. A three-case by three-effort rehearsal completes manifest, run, adjudication fixture and report. The 50-case/49-case and asymmetric failure proofs are owned by 7-01/7-02 and are included in the composed verification. No external or paid trial is needed to close the phase.

## Changes

- Add command dispatch for `run`, `report`, and `smoke` while preserving the existing `manifest` command and its arguments/output. Delegate runner/report behavior to 7-01 and 7-02 modules rather than duplicating their logic.
- Make base URL and auth injection explicit for the runner. The fake endpoint and scope-refusal fixture use synthetic data only. The normal command may use the established Yakka login integration when later operated, but this unit must not read any real credential, contact a production host, or print a credential. No provider credential belongs in the client or tool.
- `smoke` uses a fake REST server to exercise success receipt fields and a `read`-scope POST refusal. Its output contains only the stated evidence fields and never auth headers or tokens.
- Add the three-case × three-effort fixture rehearsal: frozen manifest → runner requests to fake endpoint → saved GET-record fixtures → adjudication fixture → deterministic report. Keep all generated files under a test fixture directory and clean them up.
- Update the tool README with command usage, resume/duplicate behavior, report inputs, fixture-only smoke semantics, and the four layout fields `Consumers`, `Build`, `Test`, and `Release`.
- No live/provider calls, credentials, deployment, Fly, Wrangler, or real remote host access. Preserve `internal/review/build.go`'s scoped offline guarantee and do not edit it.

### Keep untouched

Do not modify the Phase 6 manifest contract, runner/report modules except to report a concrete integration defect to their owners, Go server/review code, `internal/review/build.go`, other plan folders, lab records, or provider configuration. Do not create a later operator lab record as part of this offline phase build.

## Done evidence

Identify or write the failing check before changing code and report its output before and after.

- `python3 -m unittest tools/shadow-review-trial/test_phase7.py tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_report.py` → the preserved manifest command and all Phase 7 command fixtures pass.
- Smoke fixture prints review id, status, model, tokens and cost, proves a read-scope POST is refused, and asserts no credential appears in output.
- Three-case × three-effort fake-endpoint rehearsal produces a report and has zero live/provider calls; the full fixture suite also asserts retries, duplicate receipts, partial coverage, no repeated started calls on resume, target and shortfall counts.
- README passes the relevant `tools/release/test_layout.py` check; `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, contradictions, and any unfinished Phase 7 outcome. Never resolve a contradiction silently.

A non-trivial bug outside this brief's evidence: report symptom, location, and root cause. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
