# 6-01 Historical manifest and comparator evidence — execution report

Status: done with concerns

## Done against the brief

- Added the offline `manifest` CLI and frozen manifest builder. It enumerates reachable commits, records eligibility and reasons, explicit shallow boundaries, phase/PR/unaccompanied candidate and eligible counts, per-effort eligible/completed shortfalls, shared fixed settings, and seeded persisted run order. Existing output paths are create-only; no case set is refreshed or padded.
- Selected cases use Phase 1 `CaptureChange` in range mode with recorded full base/head SHAs and `diff_sha256`. The fixture proves a later object is absent from an earlier capture and phase/PR comparator files are excluded from captured input. Criteria are pinned to `DESIGN.md` blob content at the case head; missing criteria remains an explicit ineligible reason. Build models are retained from curated comparator evidence or recorded as `unknown`.
- Added curated comparator citation validation against plan path, commit, Git blob and line bounds, and bound the exact curated file SHA-256 into the manifest. Local PR-review exports are separately hashed and keyed only to local PR candidate head SHAs; phase and PR comparator pointers remain distinct.
- Added the tool README with `Consumers`, `Build`, `Test`, and `Release`, and indexed it in `tools/README.md`.

## Checks

Before implementation:

- `python3 tools/shadow-review-trial/cli.py manifest --help` — failed, exit 2: `can't open file .../tools/shadow-review-trial/cli.py`.
- `python3 -m unittest tools/shadow-review-trial/test_manifest.py` — failed, exit 1: `FileNotFoundError` for the not-yet-created `manifest.py`.

After implementation:

- `python3 -m unittest tools/shadow-review-trial/test_manifest.py` — 5 tests passed (`OK`), covering CLI invocation, eligibility reasons and strata, shortages, pinned head criteria, unknown/curated build-model provenance, deterministic frozen order, shallow boundary, object-only range capture, comparator exclusion and citation/export hashes.
- `python3 -m py_compile tools/shadow-review-trial/manifest.py tools/shadow-review-trial/cli.py tools/shadow-review-trial/test_manifest.py` — passed (exit 0).
- `tools/release/test_layout.py` package-README required-field scan — `tool README required-field/layout check: OK`.
- `TMPDIR=tools/shadow-review-trial/.test-tmp python3 -m unittest tools.release.test_layout` — 6 passed, 1 failed. The remaining violation is `packages/yakka-analytics/src/lib/investigation/InvestigationShell.svelte: tools/ConversationsTool.svelte`, outside this brief's owned paths. The failure is unrelated to the new tool README. The temporary directory was removed after the run.
- `git diff --check` — passed (exit 0).

## Departures, contradictions, unfinished work, problems

- The first full layout-suite run used Python's default temporary directory before I redirected `TMPDIR`; its fixture directory was automatically removed. I reran the suite with `TMPDIR` inside the owned tool directory and removed it afterward. This was an unintended deviation from the instruction not to use `/tmp`. No implementation departure or contract contradiction. The full repository layout suite has the unrelated existing violation listed above; it was left untouched per scope.
- Unfinished work: none for Phase 7 to act on. No provider calls, credentials, network services, deploys, Fly or Wrangler actions were used.
