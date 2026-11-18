# Report: phase4-03 — Metric-only evidence check

Status: done with concerns
Commit: see `git log` for this report's commit on `feat/28-review-token-only-gating`.

## What changed

Added `tools/shadow-review-trial/evidence_check.py` (pure, read-only):

- `check_folder(folder)` walks `folder.rglob("*")` in sorted order, counts files, and flags an
  offender when its name matches `manifest*.json`, `*manifest*.json`, `*export*.json` or
  `run-export*.json` (case-insensitive), or when a `.json` file parses to an object holding both
  `manifest_sha256` and `cases`, both `reviews` and `pages`, or both `manifest_hash` and `entries`.
  Name-matched but unreadable/non-JSON files are offenders; other unreadable files are ignored.
  Returns `{"pass", "folder", "files_checked", "offenders"}`, offenders relative and sorted.
- `require_metric_only(folder)` calls it and raises
  `ValueError("evidence folder contains local trial data: " + ", ".join(offenders))` on failure,
  otherwise returns the result. No contents echoed, no writes, no network, no environment reads.

Added `tools/shadow-review-trial/test_evidence_check.py`: 9 offline cases covering empty folder,
aggregate JSON/Markdown, name refusal (root + nested, unparseable content), the three shape
signatures, unreadable unmatched file ignored, and both `require_metric_only` paths.

No other module, `.gitignore` or fixture touched.

## Done evidence

Red (implementation file moved aside, test module cannot load it):

```
$ mv tools/shadow-review-trial/evidence_check.py /tmp/opencode/evidence_check.py.bak
$ python3 -m unittest tools/shadow-review-trial/test_evidence_check.py
...
FileNotFoundError: [Errno 2] No such file or directory: '.../evidence_check.py'
```

Green (this unit):

```
$ python3 -m unittest tools/shadow-review-trial/test_evidence_check.py
.........
Ran 9 tests in 0.004s
OK
```

Suite discover:

```
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 100 tests in 14.754s
FAILED (failures=1)
```

The single failure is pre-existing at HEAD and outside this unit (`test_manifest.py:246`), see
Concerns. The other 99 pass.

```
$ git diff --check
(no output, exit 0)
$ git status --porcelain tools/shadow-review-trial
?? tools/shadow-review-trial/evidence_check.py
?? tools/shadow-review-trial/test_evidence_check.py
```

No network, provider call or live server was used: only `python3 -m unittest`, `git status`,
`git diff --check`, `git log/show`, and local file moves.

## Deviations

- Tests use `ROOT / ".scratch"` as `dir=` for `tempfile.TemporaryDirectory`, matching every
  existing trial test, rather than a new `test-fixtures` folder. Both are repo-local; the brief's
  binding clause is "as existing tests do, never `/tmp`". No `/tmp` use in tests.
- The suite is 100 tests, not the brief's "91 + this unit's tests" (would be 100); the expected
  `91` base has already grown with other Phase 4 units' committed tests. This unit's 9 all pass.

## Concerns

- Pre-existing failure, not fixed here (outside owned paths): `test_manifest.py:246`
  `test_cli_freezes_fixture_repository` asserts `'"eligible": 2' in stdout`, but `cli.py:158`
  prints the frozen case count under the key `"frozen"`. This is the Phase 3 carry "cli.py prints
  the frozen count under the label eligible" in reverse: the label on HEAD is `frozen`, the test
  still expects `eligible`, so the suite is red at HEAD independent of this unit. Symptom: one
  discover failure; location: `tools/shadow-review-trial/test_manifest.py:246` vs
  `tools/shadow-review-trial/cli.py:158`; root cause: Phase 3 commit `dbef5d8`/`53ab02b` changed
  the CLI summary key without updating this assertion.

No contradiction found between the brief and the DESIGN.md contracts it cites.
