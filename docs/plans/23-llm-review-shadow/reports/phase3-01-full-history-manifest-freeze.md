# Report: phase3-01 — Full-history preparation and verified manifest freeze

Status: `done with concerns`

## What changed

- `tools/shadow-review-trial/manifest.py`
  - Added `HistoryPreparationError`, `_repository_identity` and `prepare_history`.
  - `prepare_history` resolves the configured remote URL, normalizes and compares its identity to `expected_repository` (default `codyhamilton/yakka`), fetches or unshallows `remote`, fetches its `HEAD`, re-checks `--is-shallow-repository=false`, collects remote-tracking refs, checks `--missing=print` for missing objects, and requires a numeric `git rev-list --count <tip>` that agrees with a full `git rev-list <tip>` enumeration. It takes an injectable `run` seam.
  - `create_manifest` prepares history before enumeration, enumerates the resolved tip, cross-checks the manifest enumeration against the verified count, and freezes `repository`, `remote`, `remote_url`, `tip_sha`, `fetched_refs`, `shallow:false`, `object_complete`, `enumerated_commits`, `verified_count` in `history`. Refusal happens before `mkdir`/`open`; no partial manifest is written.
- `tools/shadow-review-trial/cli.py` — `manifest` gained `--remote` and `--expected-repository`, passed through. No offline/no-fetch escape.
- `tools/shadow-review-trial/test_manifest.py` — fixture repos now push/fetch a local bare `origin`; existing tests pass the fixture identity; replaced the shallow-freeze test with refusal coverage and added the unshallow/evidence, fetch-failure, wrong-identity, still-shallow, missing-count, count-mismatch and old-shallow-relabel tests.

Kept untouched: schema version, create-only output, eligibility reasons, capture policy, criteria/comparator validation, PR-export hashing, seeded order, runner/report/approval, README, plugin/shim.

## Checks (before / after)

Before (unchanged tree):
```
Ran 6 tests in 1.178s
OK
```

After writing the new tests, before implementing:
```
Ran 12 tests in 1.173s
FAILED (errors=11)
# e.g. AttributeError: module 'shadow_manifest' has no attribute 'HistoryPreparationError'
```

After implementation, exact done-evidence command:
```
cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_manifest.py
Ran 12 tests in 2.336s
OK
```

`git diff --check` → clean (`DIFF_CHECK_OK`).

Positive evidence test: a `--depth 1` clone of a local file remote is unshallowed, reports `shallow:false`, `object_complete:true`, `verified_count == enumerated_commits == len(candidates)`, non-empty `fetched_refs`, and the frozen `history` persists. Refusal tests each assert `output` does not exist.

## Deviations

- `create_manifest` also accepts the `run` seam (not only `prepare_history`). Needed so refusal tests exercise the real `create_manifest` path and assert no file is written.
- Object completeness checks only `?`/`!`-prefixed `rev-list --objects --missing=print` lines. The brief's "is empty" is not literally true: `--objects` prints every reachable object.
- The fixture temp root honours `TMPDIR` (falling back to the repo root) so runs keep temp data under the assigned brief tmp directory.
- "Old shallow checkout" is tested with a shallow bare remote: fetch/unshallow exits 0 but the checkout stays shallow, so `create_manifest` refuses and writes nothing.
- Tip is the selected checkout `HEAD`; the remote default branch tip is also fetched (`git fetch <remote> HEAD`).

## Contradictions

- Required reading item 7 says the README's "no network" statement changes, but the owned paths and **Keep untouched** forbid editing the README. I did not edit it; README wording remains stale for a later owner.
- The contract's missing-object example (`git rev-list --objects --missing=print` empty) conflicts with Git behaviour as above; resolved by checking missing markers.

## Concerns / known problems

- Identity comparison normalizes to the repository path and ignores host, so a different host with the same `owner/repo` path would match. Acceptable for the `codyhamilton/yakka` default, but it is not a full remote-identity proof.
- `prepare_history` fetches on every `create_manifest`; an existing output is still rejected before any fetch, preserving create-only behaviour.

## Gates

- gate: fetching full history from the live `codyhamilton/yakka` GitHub remote and freezing a real trial manifest requires network/operator action; not performed here.
- gate: any live trial execution, deployed server/provider call or paid spend requires Cody's explicit approval; out of scope for this unit.
- Unfinished: update `tools/shadow-review-trial/README.md` (Manifest section) to describe fetch, remote identity and the new flags. Left untouched per the brief's owned paths.
