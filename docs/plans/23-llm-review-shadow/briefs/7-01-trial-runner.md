# Brief: 7-01 — Historical trial runner and dry-run estimates

Consumer: Plan 23 Phase 7 CLI and the later operator running a frozen historical trial.
Owned paths: `tools/shadow-review-trial/runner.py`, `tools/shadow-review-trial/test_runner.py`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/7-01-trial-runner.md` and include it in the commit.
Depends on: Phase 6 manifest; Phase 4 REST contract.
Runs alongside: 7-02, which owns separate report and adjudication paths.
Budget: 12 files to read, about 700 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Phase 7 outcome; Domain: Historical trial and alignment report; Assumptions 20–22; carried Phase 6 items under Phase 7.
2. `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` — Phase 6 implementation and carried section.
3. `tools/shadow-review-trial/manifest.py`, `cli.py`, and `README.md` — frozen manifest shape and existing command boundary.
4. `packages/yakka/internal/review/orchestrator.go` and `packages/yakka/internal/serve/serve.go` — REST request, `dry_run`, trial identity, receipt, duplicate and record-read behavior.
5. `packages/yakka/internal/review/orchestrator_test.go` and `packages/yakka/internal/serve/mcp_review_test.go` — fixture evidence for preflight resume, started-claim duplicates, and REST duplicate receipts.

## Goal

Implement the Phase 7 runner contract over the Phase 6 frozen manifest. Estimate cost without a provider call, and run/resume the shared case set at high, xhigh and max through the authenticated `POST /v1/reviews` entry.

## Contract

Binding: `DESIGN.md`, Phase 7 outcome and Domain: Historical trial and alignment report. The trial uses one common case set and fixed non-effort settings, with only `high`, `xhigh`, and `max` varying. Phase 4's `review.Trial` carries `manifest_hash`, `case_id`, and `effort`; `POST /v1/reviews` accepts `dry_run`, and `GET /v1/reviews` accepts `profile` and `manifest_hash` filters. A REST replay can return `skipped_duplicate` with `reason` pointing to the canonical review id. Only one valid `ok`/`ok_partial` with the required model counts per case and effort; failures, duplicates, and model mismatches do not. Keep retries, partial coverage, and duplicate receipts visible.

## Changes

- Implement a reusable runner module; leave `cli.py` to 7-03. Consume the manifest's frozen `manifest_sha256`, case order, captures, criteria source/content hash, settings, build-model provenance, and target. Do not refresh or edit the manifest.
- Build requests from each case's exact range capture and criteria at the recorded head. Preserve all frozen non-effort fields across arms; vary only trial effort. Set `allow_superseded` as required for historical criteria. Never fabricate missing criteria, captures, models, or case identities.
- Dry-run every selected case/effort with `dry_run:true`, make no provider calls, collect server estimates, include the bounded retry exposure from the Phase 4 reservation contract, calculate the all-three-arm projection, and refuse before any live run if it exceeds the caller-supplied cap. Print per-case/per-effort and aggregate projections.
- Persist a local, atomic run ledger bound to the manifest hash and request identity. Resume zero-call preflight results (`unavailable` or `skipped_budget`) when configuration/budget changes; never repeat an already-started case/effort request after interruption. Retain every attempt and receipt.
- Reconcile `skipped_duplicate` using its canonical id/reference and records from `GET /v1/reviews`; retain the duplicate receipt as evidence but do not count it as completion. Count only records whose manifest/case, effort, reviewer id, and status satisfy the design contract. Do not count a duplicate or mismatched returned model.
- Support an injected HTTP transport/base URL and auth provider so fixtures can use a loopback fake endpoint. Do not read, print, copy, or require real user/provider credentials during implementation or tests. No live provider request, paid call, deployment, Fly, or Wrangler action.
- Preserve the Phase 6 manifest and comparator files, Phase 4 idempotency, and the offline/no-environment guarantee scoped to `internal/review/build.go`.

### Keep untouched

Do not change `cli.py`, manifest implementation or schema, Go server/review code, `internal/review/build.go`, other plan folders, lab records, or provider configuration. The memory-bound `_capture_blob` issue is bounced to a future Phase 1 refinement and is not part of this unit.

## Done evidence

Identify or write the failing check before changing code and report its output before and after.

- `python3 -m unittest tools/shadow-review-trial/test_runner.py` → fake endpoint proves dry-run has zero model calls, per-case/per-effort estimates and retry-inclusive aggregate, and cap refusal precedes run requests.
- Runner fixtures prove identical frozen request inputs across effort arms except effort; 50 cases meet the per-arm target; 49 report a shortfall of one per arm without padding; asymmetric failures produce distinct arm completion counts and a paired completed intersection.
- Fixtures prove preflight/budget resume on the unchanged manifest without another started call; a duplicate receipt resolves to its canonical record but does not count twice; timeout retry, failed statuses, model mismatch and partial coverage remain visible in the ledger.
- Tests use only an injected fake endpoint and fixture auth. `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, contradictions, and any unfinished work specific enough for Phase 7 integration. Never resolve a contradiction silently.

A non-trivial bug outside this brief's evidence: report symptom, location, and root cause. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
