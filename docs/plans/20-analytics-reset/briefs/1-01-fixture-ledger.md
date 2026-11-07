# Brief: 1-01 — Deterministic fixture ledger

Consumer: the Phase 1 shell and release workers, then the later analytics phase workers consuming the committed fixture manifest.
Owned paths: `packages/yakka/internal/analyticsfixture/`. Touch nothing else.
Commits: Leave changes in the working tree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/1-01-fixture-ledger.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: 1-02 — Framework-free shell.
Budget: 12 files to read, about 500 lines to change, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 1 outcome and Phase 3–6 outcomes that consume fixture populations.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — sections 11.3 and 17.7; exact fixed fixture and manifest contract.
3. `packages/yakka/internal/store/` — existing store write APIs used by test fixtures; inspect targeted APIs, do not read the package wholesale.
4. `packages/yakka/internal/serve/analytics_bench_test.go` — current local fixture/serve harness conventions.

## Goal

Provide the non-shipping Go fixture generator and checked manifest that give browser and later analytics tests deterministic synthetic data across every population, chronology and resource boundary named by CONTRACTS.md 17.7.

## Contract

CONTRACTS.md 17.7 is binding: generate a test-only ledger with fixed timestamps, multi-year coverage, multiple harnesses/models/repos/scorers, priced and unpriced calls, required session/repo relationships, artifact kinds/bodies/versions, shared plans and sessions, every execution shape, both rejection stages, scores, the >5,000-event and >32,766-scored-hash cases, shared bytes across paths/plans/repos, scorer-specific rescores, pre-epoch and multi-century bounds, and unpriced events beyond the conversation cap. A committed manifest records each shape and count, and a test checks it. Synthetic data must not enter a product sample-data path.

The design leaves the way to write the fixture ledger open. Compare at least two local generator candidates against the same contract-derived manifest oracle (for example, direct store writes versus appending valid source facts through the store). Record the observed resource and fidelity tradeoffs in the report, select the candidate that satisfies the fixed contract, and do not change the required fixture populations to fit a candidate. This is an implementation choice inside the stated generator surface, not permission to alter schemas, routes, joins, or production behavior.

## Changes

Implement a non-shipping generator callable by the test harness to create a fresh fixture ledger, plus its committed manifest and manifest verification. Keep all generated runtime ledger files in temporary test directories. The manifest must be sufficient for a browser test harness to read the expected fixture summary without adding a production endpoint or product sample-data path.

### Keep untouched

Do not change analytics contracts, serving routes, stored production schemas, fixtures outside this new generator surface, or real/production data. Do not read credentials or live ledgers. Do not add a product route to expose fixture summaries.

## Done evidence

Identify the failing/missing manifest check before implementation and report its output before and after.

- Generator and manifest check → deterministic success on repeated fresh temporary ledgers; exact shape/count manifest matches.
- Contract coverage check → every required 17.7 population and boundary is present, including body/version/hash sharing and the numeric event/hash limits.
- Observable check → the test harness can read the generated fixture summary and manifest using test-only files/interfaces; no production route or shipped fixture data is involved.
- Candidate comparison → report both local candidates against the same fixed manifest and the measured resource/fidelity evidence used to choose one.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, candidate comparison, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.
