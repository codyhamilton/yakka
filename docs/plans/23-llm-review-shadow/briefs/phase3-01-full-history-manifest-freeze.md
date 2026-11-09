# Brief: phase3-01 — Full-history preparation and verified manifest freeze

Consumer: a Python worker who knows `tools/shadow-review-trial/manifest.py`, Git plumbing and the Phase 1 `yakka.CaptureChange` range API.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/manifest.py`, `tools/shadow-review-trial/cli.py` (only the `manifest` command parser and handler), `tools/shadow-review-trial/test_manifest.py`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-01-full-history-manifest-freeze.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: nothing.
Budget: read 8 files, about 300 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — trial preparation/execution domain (168–182), Decisions 20–24 (224–228), Phase 3 outcome and surfaces (291–296), and the manifest ground row (90).
2. `tools/shadow-review-trial/manifest.py` — the whole file: `_git`, `create_manifest`, eligibility, capture, criteria, comparators and create-only output.
3. `tools/shadow-review-trial/test_manifest.py` — all fixtures, especially `test_shallow_clone_boundary_is_frozen_as_ineligible` and `test_cli_freezes_fixture_repository`.
4. `tools/shadow-review-trial/cli.py` — the `manifest` parser (94–105) and handler (137–141).
5. `packages/yakka/internal/review/policy.json` — capture exclusions and limits used by `create_manifest`.
6. `plugins/yakka/client` — the `yakka.CaptureChange` interface as used by `manifest.py`; do not edit it.
7. `tools/shadow-review-trial/README.md` — Manifest section (28–37), whose current "no network" statement this unit changes.
8. Phase 1 report `reports/phase1-02-paged-review-store-reads.md` only if you need the complete-read vocabulary; do not reopen its contracts.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make manifest creation prove full, non-shallow history from the configured Git remote and freeze that evidence, refusing before it writes when preparation is incomplete or identity/count checks fail.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "History preparation is an explicit trial-tool/operator step: verify remote repository identity `codyhamilton/yakka`, unshallow/fetch full reachable history of the selected default-branch tip and needed refs, require `git rev-parse --is-shallow-repository=false`, check missing objects/boundaries, and record resolved tip, fetched refs and `git rev-list --count <tip>`. Refuse manifest creation when history is still shallow/incomplete, remote identity is wrong or the verified count is missing. The count must agree with enumeration; no arbitrary minimum count proves completeness. Freeze this evidence and the actual eligible population in the new manifest; an old shallow manifest cannot be certified by relabeling it. Fetching never belongs in the shim/change reader, which remains network-free."
- Phase 3 outcome: "Trial preparation from a deliberately shallow repository fetches full permitted history, verifies repository/tip/nonshallow/object/count evidence and freezes a new manifest; fetch failure/incomplete history/count mismatch refuses before freeze."
- "an old shallow manifest cannot be certified by relabeling it."
- "Freeze this evidence and the actual eligible population in the new manifest" and "The count must agree with enumeration".
- "Fetching never belongs in the shim/change reader, which remains network-free."

## Changes

- Add a history-preparation function in `manifest.py` (for example `prepare_history`) that:
  - resolves the configured remote URL and normalizes/compares its repository identity to an explicit expected identity (`codyhamilton/yakka` by default); support local `file://` remotes for fixtures by accepting the expected identity as an argument;
  - fetches/unshallows the configured remote (`git fetch --unshallow <remote>` when shallow, otherwise `git fetch <remote>`) and fetches the default-branch tip/needed refs;
  - resolves the default-branch tip and fetched refs, requires `git rev-parse --is-shallow-repository` to be `false`, checks for missing objects (for example `git rev-list --objects --missing=print` is empty), and computes `git rev-list --count <tip>`;
  - returns deterministic evidence with at least `repository`, `remote`, `tip_sha`, `fetched_refs`, `shallow`, `object_complete`, `enumerated_commits` and `verified_count`.
  - takes an injectable Git command seam so failure cases can be tested without live network.
- Wire preparation into `create_manifest`: perform it before enumeration (or consume the evidence produced by the same function) and refuse before writing if the fetch fails, the checkout is still shallow, objects are missing, the remote identity is wrong, the verified count is missing, or the count disagrees with enumeration. Do not write a partial manifest on refusal.
- Record the preparation evidence in the frozen manifest's `history` object with `shallow:false`, the remote/repository identity, resolved tip, fetched refs, `enumerated_commits`, `verified_count` and object completeness. Keep any boundary diagnostics only as diagnostics; they cannot certify a shallow manifest.
- Keep the existing manifest schema version, create-only output, eligibility reasons, capture policy, criteria resolution, comparator validation, PR-export hashing and seeded run order. The only intended behaviour change is that shallow/incomplete history now refuses instead of freezing boundary candidates as ineligible.
- In `cli.py`, add `--remote` and `--expected-repository` to the `manifest` command and pass them through. Do not add a `--no-fetch`/offline escape that can certify unverified history; fixtures should use local file remotes.
- Update `test_manifest.py`: replace the landed shallow-freeze expectation with a refusal test; add a deliberately shallow clone plus a local bare/file remote that can be fetched/unshallowed and frozen; assert the frozen `history` evidence; add refusal tests for fetch failure, wrong repository identity, still-shallow history, missing count and count mismatch, each asserting no output file was written. Add the local remote/helper the existing eligibility and comparator tests need so they still freeze complete repositories.

### Keep untouched

`_case_stratum`, `_plan_identity`, `_criteria`, `_comparators`, `_validate_curated`, `load_pr_export`, eligibility reasons, capture exclusions/limits, comparator semantics, PR-export hashing and the create-only manifest contract. Do not edit `runner.py`, `report.py`, `approval.py`, the README, the shim/plugin or any server code. No live Yakka, provider, credential, deployment, Fly/Wrangler or paid execution.

## Done evidence

Write the failing checks first, then report before/after output.

- `cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_manifest.py` → passes. (Pure-Python tests; no memory cap is expected. If one is needed, use `prlimit --as=8589934592`. Do not use `/tmp`.)
- New test: a deliberately shallow clone of a local file remote is fetched/unshallowed, reports `shallow:false`, object completeness and a count that matches enumeration, and freezes that evidence into the manifest.
- New tests: fetch failure, wrong remote identity, still-shallow history, missing verified count and count mismatch each refuse before writing; no manifest file is created.
- New test: a manifest made from an old shallow checkout cannot be relabeled as certified; `create_manifest` refuses the shallow checkout.
- Existing eligibility, capture, criteria, comparator, PR-export and seeded-order tests still pass with complete fixture remotes.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
