# Brief: phase3-05 — Spend authorization gate and approved execution rehearsal

Consumer: a Python worker who knows `tools/shadow-review-trial/runner.py`, its CLI and the fake-endpoint rehearsal.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/approval.py` (new), `tools/shadow-review-trial/test_approval.py` (new), `tools/shadow-review-trial/runner.py`, `tools/shadow-review-trial/cli.py` (only the `run`/`smoke` command wiring and imports), `tools/shadow-review-trial/test_runner.py`, `tools/shadow-review-trial/test_phase7.py`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-05-spend-approval-rehearsal.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase3-03 and phase3-04. Read their reports and the code they left.
Runs alongside: nothing.
Budget: read 10 files, about 400 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — hard paid-spend gate and estimates (178–182), Decisions 23–24 (227–228), Phase 3 outcome and surfaces (291–296).
2. `tools/shadow-review-trial/runner.py` — the post-3-03 `run`, ledger, projection/cap, claim-before-I/O and no-replay path.
3. `tools/shadow-review-trial/cli.py` — `run` parser/handler (106–119, 142–146) and the loopback `smoke` fixture (30–91, 129, 159–160).
4. `tools/shadow-review-trial/test_runner.py` — `FakeREST`, cap, no-replay, duplicate and 50/49/asymmetric fixtures.
5. `tools/shadow-review-trial/test_phase7.py` — the fake endpoint and composed manifest→run→adjudication→report rehearsal.
6. `tools/shadow-review-trial/report.py` — the post-3-04 certified-export/ledger input; do not edit it here.
7. `docs/plans/23-llm-review-shadow/briefs/phase3-02-general-call-runner-tenant-check.md` and `phase3-03-complete-paged-evidence.md` — run identity, ledger, paging and duplicate contracts.
8. `docs/plans/23-llm-review-shadow/briefs/phase3-04-report-provenance-canonical-cost.md` — the report input this rehearsal uses.
9. `tools/shadow-review-trial/README.md` — current Run/Smoke sections (39–71); do not edit the README here (3-06 owns it).
10. Phase 1 `briefs/phase1-04-ephemeral-usage-dry-run.md` and its report — dry-run readiness/estimate behavior.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Require an explicit local Cody approval record before any provider-reaching execution (including resume), enforce its identity/expiry/ceiling, and complete the existing manifest→run→adjudication→report rehearsal against a fake endpoint.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "**Hard paid-spend gate:** Cody must explicitly authorize spend **before any live provider call**, including a paid smoke test, retries or resumed unfinished work. `--execute` alone is not authorization. The runner requires a local authorization record naming Cody's approval reference, tenant id, endpoint, manifest/run and preflight digests, maximum authorized estimated spend and expiry; it never creates approval itself. This is an auditable operator acknowledgement, not a claim that the server can authenticate a chat quotation. Invalid/missing/expired/mismatched authorization aborts before review execution. Resume includes prior charges and unknown-outcome reservations against the same ceiling; exceeding it or changing the plan needs renewed explicit approval. A real-server `dry_run` preflight makes zero provider calls and is allowed before approval; test fixtures require no paid approval."
- "The authoritative **estimate** before sign-off is real-server dry_run output for every case/effort plus retry-inclusive aggregate exposure. Preflight must validate configuration/allowlist/effort and return explicit readiness/refusal without spending or writing records; it is an estimate, not a budget reservation or proof of credential acceptance. The runner refuses execution if projection exceeds either its supplied cap or approved amount."
- Phase 3 outcome: "Approved fixture execution respects prior spend/unknown reservations and caps, preserves no-blind-replay claims, and completes the existing manifest→run→adjudication→report rehearsal on a fake endpoint."
- "A fake counter proves missing/expired/mismatched/exceeded Cody approval prevents every execute/smoke/provider attempt, including resume."
- "A dry-run-only or fixture-only run can never claim a completed live trial or deployed smoke."
- "Default real-server dry_run validates readiness and prints per-case/per-level and retry-inclusive aggregate estimates with zero provider calls."

## Changes

- Add `approval.py` with a loader/validator for the local authorization JSON. It must read, never create, an approval with at least: `schema_version`, Cody's `approval_reference`, `tenant_id`, exact `endpoint`, `manifest_sha256`, `run_id`, a `preflight_sha256` digest of the canonical dry-run summary, a finite non-negative `authorized_max_usd`, and an `expires_at` UTC timestamp. Provide an injected clock for deterministic tests; invalid/missing/malformed/expired records raise explicit errors.
- In `runner.run`, require the approval whenever `execute=True`. Dry-run preflight is allowed without approval. Validate the approval before any provider-reaching POST, including resumed work: endpoint/tenant/manifest/run/preflight digest must match, the record must be unexpired, and the approved ceiling must cover prior spend plus unknown-outcome reservations plus the new retry-inclusive projection. Compute prior charges from recorded attempt costs and conservatively reserve unknown/started-unfinished outcomes (use the retry-inclusive preflight estimate); refuse when the ceiling is exceeded or the plan changed. Keep the independent supplied cap, atomic/claim-before-I/O behavior, and no replay of `started`/`started_unknown` entries.
- In `cli.py`, add `--approval <path>` to `run`; `--execute` without a valid approval fails before any request. Keep the loopback `smoke` fixture unchanged in behavior: it starts a local fake server, makes no provider call, and needs no paid approval. Do not add a live smoke command; if any provider-reaching smoke path is added later it must use the same gate.
- Make the dry-run summary include per-case/per-level retry-inclusive estimates and the aggregate projection/readiness, suitable for the approval's preflight digest; it still makes zero provider calls.
- Update `test_phase7.py` to run the composed manifest→run→adjudication→report rehearsal with the new tags/effort/store, whoami, paged export and approval inputs against a fake endpoint. Update `test_runner.py` and add `test_approval.py` for the gate and record contract.
- Add tests proving a fake provider counter stays at zero for missing, expired, mismatched (tenant/endpoint/manifest/run/preflight) and exceeded-ceiling approvals, including resume. Add tests that an approved fixture execution respects prior spend/unknown reservations and the cap, preserves no-blind-replay, and completes the rehearsal. None may claim a live trial or deployed smoke.

### Keep untouched

The 3-02 request/tag/whoami contract, the 3-03 paged reader, the 3-04 report semantics, the README/docs, the shim/plugin and server code. No live Yakka, provider, credential, deployment, Fly/Wrangler or paid execution. Do not edit `report.py`, `manifest.py`, `test_report.py` or `test_manifest.py`.

## Done evidence

Write the failing checks first, then report before/after output.

- `cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_approval.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` → passes. (Pure-Python tests; no memory cap expected. Do not use `/tmp`; do not add timing/sleep-based tests, inject the clock instead.)
- New test: missing, expired, mismatched and exceeded-ceiling approvals each abort with zero provider attempts, including a resume with prior spend/unknown reservations.
- New test: an approved fixture execution stays within the approved ceiling/cap, never replays a started/unknown request, and completes the manifest→run→adjudication→report rehearsal on the fake endpoint.
- New test: the loopback `smoke` fixture still makes no provider call and needs no approval.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
