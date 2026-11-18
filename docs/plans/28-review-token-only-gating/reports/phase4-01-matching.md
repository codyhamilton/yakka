# Phase 4 unit 1 — deterministic matcher, null, kappa and bootstrap

Status: done with concerns.

## What changed

- Added `tools/shadow-review-trial/matching.py`: `normalise_text`, `text_similarity`
  (Jaccard over normalised word sets), `classify` with `STRUCTURAL_SIMILARITY`
  (0.60) and `UNCERTAIN_SIMILARITY` (0.30), `tag_method`, `shuffled_case_map`
  (seeded derangement over sorted distinct ids), `cohen_kappa` and
  `bootstrap_interval` (seeded percentile bootstrap, sorted resampled means).
  Pure, I/O-free, no module state, no time or environment reads.
- Added `tools/shadow-review-trial/test_matching.py` (29 tests) covering the
  done-evidence cases plus normalisation, point-inside overlap, text fallbacks
  and empty inputs.
- Nothing else edited.

## Red / green evidence

Before (new tests, before the module existed):

```
$ python3 -m unittest tools/shadow-review-trial/test_matching.py
ERROR: test_matching (unittest.loader._FailedTest.test_matching)
ModuleNotFoundError: No module named 'matching'
Ran 1 test ... FAILED (errors=1)
```

Before (full suite at HEAD with this unit's two files moved aside): 100 tests,
1 failure — `test_manifest.ManifestFixtures.test_cli_freezes_fixture_repository`,
pre-existing and outside this unit.

After (unit file):

```
$ python3 -m unittest tools/shadow-review-trial/test_matching.py
Ran 29 tests in 0.009s
OK
```

After (full suite, run while unit 4 was editing `report.py`/`test_report.py` in
this shared worktree):

```
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 131 tests in 14.764s
FAILED (failures=1, errors=2)
```

The two errors are transient unit 4 work-in-progress
(`test_report.py` expects `population`, absent from its in-progress
`report.py`). The failure is the pre-existing `test_manifest` item below. On
the immediately preceding full run with unit 4's edits mid-save: 129 tests,
only the same 1 failure. No failure is in this unit's files.

```
$ git diff --check        # clean
$ git status --porcelain tools/shadow-review-trial
?? tools/shadow-review-trial/matching.py
?? tools/shadow-review-trial/test_matching.py
 M tools/shadow-review-trial/report.py        # unit 4's concurrent edits
 M tools/shadow-review-trial/test_report.py   # unit 4's concurrent edits
$ python3 -m py_compile matching.py test_matching.py   # OK
```

No network, provider call, live server, `/tmp`, timing or wall-clock assertion
was used. Tests do no file I/O.

## Deviations

- `classify`: the brief's `non_match` rule says "different path" while its
  `uncertain` example says "path differs, text very similar". Implemented
  `non_match` as (path differs and similarity < 0.60) or (no line overlap and
  similarity < 0.30), so a very similar moved finding is `uncertain` and the
  same-path/distant-lines/unrelated-text example is still `non_match`.
  Documented in the module docstring.
- `shuffled_case_map` returns `{}` for fewer than two distinct cases (no
  derangement exists); distinct ids are used so duplicate input cannot collapse
  the mapping.
- `text_similarity` returns 0.0 when both texts are empty; `cohen_kappa`
  returns `None` when fewer than two pairs or only one distinct label.

## Contradictions / concerns

- Target shape: the settled interface takes `target.line_start`/`line_end`,
  but `later_fixes` hunks from `history_extract_a._hunks` use
  `start`/`end` (`history_extract_a.py:357-361`). Unit 5 must map hunk fields;
  I followed the brief and accepted `excerpt` or `text` for the target text.
- The brief says the suite "currently 91"; HEAD baseline is 100 because unit 3
  (`20f54ee`) already added 9 tests. The brief's dependency map did not reflect
  that landed unit.
- Pre-existing bug outside this unit: `test_manifest.py:223` asserts
  `"eligible": 2`, while `cli.py:158` prints `"frozen"` (Phase 3 cosmetic
  carried item, owned by unit 7). Root cause: the label changed in the CLI but
  not the test. Not fixed here.
- Unit 4 is editing `report.py`/`test_report.py` in this shared worktree while
  this unit ran; commit excludes those paths.
