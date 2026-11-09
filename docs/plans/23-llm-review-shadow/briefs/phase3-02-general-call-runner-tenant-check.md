# Brief: phase3-02 — General-call runner and dedicated-tenant identity

Consumer: a Python worker who knows `tools/shadow-review-trial/runner.py`, its fake REST transport and the Phase 1 review receipt shape.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/runner.py`, `tools/shadow-review-trial/cli.py` (only the `run` command parser/handler and imports), `tools/shadow-review-trial/test_runner.py`, `tools/shadow-review-trial/test_phase7.py` (the run/rehearsal request-shape sections only). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-02-general-call-runner-tenant-check.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase3-01.
Runs alongside: nothing.
Budget: read 10 files, about 350 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — review call controls (103–119), trial preparation/execution (168–182), Decisions 21–23 (225–227), Phase 3 outcome and surfaces (291–296).
2. `tools/shadow-review-trial/runner.py` — the whole file: `build_request`, `HTTPTransport`, `TrialRunner`, ledger save/load, `_completion`, `run`.
3. `tools/shadow-review-trial/test_runner.py` — `FakeREST` and all current runner fixtures, especially 50/49/asymmetric, duplicate and no-replay tests.
4. `tools/shadow-review-trial/cli.py` — `run` parser (106–119) and handler (142–146).
5. `tools/shadow-review-trial/test_phase7.py` — `RehearsalHandler` and the composed run test (26–176).
6. `docs/plans/23-llm-review-shadow/briefs/phase1-01-call-controls-identity.md` and its report — the settled effort/tags/store contracts and duplicate receipt fields.
7. `packages/yakka/internal/review/orchestrator.go` — `Receipt` (163–182), duplicate fields (175–177), and duplicate/cache handling (764–800).
8. `packages/yakka/internal/serve/serve.go` — `/v1/whoami` route (568) and `whoami` response (959–989).
9. `tools/shadow-review-trial/manifest.py` — the Phase 3-01 `history` evidence and manifest hash fields; read the 3-01 report.
10. `tools/shadow-review-trial/README.md` — Run section (39–50); update it only if this brief owns it (it does not, so leave it for 3-06).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Send new general review calls (`effort`, `tags`, `store=true`) with frozen trial tags, prove the configured key belongs to the dedicated tenant before any review call, and resolve duplicate receipts from their full cached body without a duplicate-only GET.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "New calls use `effort`, `tags`, `store=true`, never the trial object. Convention (not a special server type): `trial:<run-id>`, `effort:<level>`, `manifest:<sha256>`, `case:<sha256-of-case-id>`; use a 1–32 character `[A-Za-z0-9_-]` run id so every tag fits. The frozen run journal binds case id, manifest hash, capture/criteria/policy identities, effort, tenant id and canonical review id. General tag filters select the precise trial slice; old manifest_hash/profile filters remain useful for historical records. Cache identity includes tags, so new run ids intentionally mean new work; resume must reuse the same run id, tags and journal. Effort tags do not set effort: reject runner inputs whose tag convention disagrees with its actual effort param."
- "Synthetic reviews use `store=true`: tags, caching, paging, tracking and costs work normally within that tenant."
- "Confirm the key's identity with whoami before any capture; abort a real-work mismatch."
- "Duplicate replies already contain the canonical review, so no follow-up GET is needed to see findings. Reconcile original id exactly once; duplicate receipts do not add completed cases or cost."
- Phase 3 outcome: "Runner sends general tags/effort/store=true to the configured real-server interface, verifies the dedicated tenant and reconciles duplicate full bodies/resume without a duplicate-only GET."
- "The real deployed Yakka server remains the trial target; its provider credential stays server-side. Trial review tooling uses a dedicated Yakka `wk_` key. That key never authorizes reset/delete."
- The 3-01 contract requires a certified full-history manifest; refuse an uncertified/shallow manifest before any review call.

## Changes

- In `build_request`, remove the deprecated `trial` object. Emit `effort`, `tags` and `store:true` plus the existing capture/criteria/build-model/dry-run fields. Build the canonical tags `trial:<run-id>`, `effort:<level>`, `manifest:<manifest_sha256>` and `case:<sha256-of-case-id>`; validate the run id is 1–32 characters from `[A-Za-z0-9_-]`, every tag fits the Phase 1 bounds, and the `effort:<level>` tag equals the actual effort parameter. Reject a supplied tag set whose effort or run identity disagrees with the request.
- In `TrialRunner`, add a `whoami()` call to `/v1/whoami`. Before the first review POST in either dry-run or execute mode, assert `tenant` equals the expected dedicated tenant id and `scope` is `read_write`; on mismatch or unauthorized, abort with no review POST. Keep the token out of printed output and saved ledgers.
- Change `run()` to take the frozen `run_id` and expected `tenant_id`, and refuse a manifest whose `history` is not certified complete (from 3-01). Bind the ledger to case id, manifest hash, capture/criteria/policy identities, effort, run id, tenant id and canonical review id. Resume refuses a different run id, tenant, manifest or tag set; a started/`started_unknown` entry is never replayed.
- Match completed records by the canonical tags (`manifest:<sha>`, `case:<sha>`, `effort:<level>`, `trial:<run>`) plus `effective_effort` and `returned_model`; do not depend on `profile`/`manifest_hash`/`case_id` being present on new rows.
- Resolve a `skipped_duplicate` receipt from its full cached body: `original_review_id`, `original_status`, `result`, `coverage`, `finding_counts`, `model`, `effort`, `tags` and `attempts`. Do not issue a follow-up GET solely to resolve that duplicate. Count the canonical original once and never add duplicate cost.
- Keep the existing projection/retry exposure, cap refusal, claim-before-network-I/O, no-blind-replay and 50/49/asymmetric completion/shortfall behaviour.
- In `cli.py`, add `--run-id` and `--tenant-id` to the `run` command and pass them through. Do not add the approval gate in this unit (3-05 owns it).
- Update `test_phase7.py`'s fake handler to answer `/v1/whoami` and accept the new request shape; keep the report section for later units. Add or adapt runner tests for the request shape (no `trial`), tag convention, effort-tag disagreement, tenant/scope mismatch with zero review POSTs, duplicate full-body resolution without an extra GET, resume identity mismatch, and the existing 50/49/asymmetric counts.

### Keep untouched

`report.py`, `approval.py`, paged retrieval, docs, the shim/plugin, server code, `store=false` semantics and the provider boundary. No live Yakka, provider, credential, deployment, Fly/Wrangler or paid execution. Do not edit `test_report.py` or the README.

## Done evidence

Write the failing checks first, then report before/after output.

- `cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` → passes. (Pure-Python tests; no memory cap expected. Do not use `/tmp`.)
- New test: emitted requests have `effort`, `tags` and `store:true`, no `trial` object, and the canonical four tags; an effort-tag disagreement is refused before any POST.
- New test: `/v1/whoami` tenant/scope mismatch aborts with zero review POSTs; the matching tenant proceeds.
- New test: a duplicate receipt containing the full cached body resolves the canonical review and adds no duplicate-only GET or cost; a ledger resume with a different run id/tenant/manifest is refused.
- The 50/49/asymmetric completion, shortfall, retry, cap and no-replay tests still pass under the new request identity.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
