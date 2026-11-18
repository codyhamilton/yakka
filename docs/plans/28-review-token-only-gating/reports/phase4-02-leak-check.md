# Phase 4 unit 2: request-level leak check

Status: **done with concerns** (the required full suite fails one pre-existing test outside this unit's paths).

## What changed

- `tools/shadow-review-trial/leak_check.py`: new `check_requests(manifest, run_id)`.
  Rebuilds `runner.build_request` for every case in `run_order` at `high`, `xhigh`
  and `max`, records `RunnerError` as `request_errors`, and inspects only
  `request["capture"]["diff"]` and `request["criteria_text"]`. Counts own-plan
  `REVIEW.md`/`IMPLEMENTATION.md`/`DESIGN.md` hits, normalised outcome-excerpt
  hits (via `matching.normalise_text`, blank excerpts skipped), and cases whose
  diff carries a `docs/plans/` path outside the case plan. Returns only the
  exact contract keys and `scope: "case_plan_and_outcome_excerpts"`; no path,
  SHA, excerpt or diff line is returned or logged. No I/O, network or live
  server.
- `tools/shadow-review-trial/test_leak_check.py`: 9 offline tests on a synthetic
  `create_manifest`-shaped manifest in a `TemporaryDirectory` under the repo
  `.scratch/`. Covers clean pass, own `REVIEW.md`/`IMPLEMENTATION.md`, excerpt
  in diff, excerpt in criteria, whitespace-only excerpt skipped, foreign plan
  counted but passing, null plan treating all `docs/plans/` paths as foreign,
  and a capture-less case producing a request error.

## Done evidence

Before implementation (tests first):

```
$ python3 -m unittest tools/shadow-review-trial/test_leak_check.py
ERROR: test_leak_check (unittest.loader._FailedTest)
ModuleNotFoundError: No module named 'leak_check'
Ran 1 test ... FAILED (errors=1)
```

After:

```
$ python3 -m unittest tools/shadow-review-trial/test_leak_check.py
.........
Ran 9 tests ... OK

$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 140 tests ... FAILED (failures=1)
FAIL: test_manifest.ManifestFixtures.test_cli_freezes_fixture_repository
AssertionError: '"eligible": 2' not found in '{"candidates": 4, ..., "frozen": 2, ...}'

$ git diff --check
(clean)
$ git status --porcelain tools/shadow-review-trial
?? tools/shadow-review-trial/leak_check.py
?? tools/shadow-review-trial/test_leak_check.py
```

The single failure is pre-existing and outside this unit's owned paths: it is
the Phase 3 carried cosmetic item where `cli.py manifest` prints the frozen
count under the label `eligible`. Re-running `test_manifest.py` with this unit's
untracked files stashed reproduces the same failure. `cli.py` is another unit's
path, so it was not edited.

Network/provider/live-server commands: none. No read of `.trial-data/`.

## README leak-check scope wording for unit 7

> **Leak check.** The trial reconstructs every request the runner would send
> from the frozen manifest (`runner.build_request`) and fails the report when a
> case's own `docs/plans/<plan>/REVIEW.md`, `IMPLEMENTATION.md` or `DESIGN.md`
> path appears in a capture diff, or a recorded outcome excerpt appears in a
> diff or criteria text (`scope: case_plan_and_outcome_excerpts`). Changed paths
> under another plan's `docs/plans/` folder are counted as
> `foreign_plan_document_captures` and never fail the check.

## Deviations and contradictions

- No deviation from the settled scope decision. `strip_plan_documents`,
  `runner.build_request`, the frozen manifest, `report.py`, `cli.py` and
  `README.md` were not touched.
- Contradiction recorded, not silently resolved: the brief's done evidence says
  the full discovery run passes, but it fails one pre-existing `test_manifest`
  CLI-label assertion (the carried Phase 3 cosmetic item) that predates this
  unit and lives on another unit's path.
- Own-document hits and outcome hits are counted across the three effort
  requests (the reconstructed diff and criteria are identical per effort), so a
  single leaked occurrence is reported per request; `foreign_plan_document_captures`
  is counted once per case as specified.
