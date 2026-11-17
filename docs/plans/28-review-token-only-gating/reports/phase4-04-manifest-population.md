# Phase 4 unit 4 — ingest the frozen manifest and report population

Status: done with concerns (one pre-existing failure outside this unit's paths; see below).

## What changed

- `report.py` `_validate_manifest`: accepts `tier` in `phase`/`unit`/`pr` and `stratum` in those plus legacy `unaccompanied`; a present `tier` must equal `stratum`. Every hash, schema, eligibility and history certification check is unchanged, and legacy stratum-only fixtures still pass.
- `report.py` `build_report`: reads `target = manifest.get("target", manifest.get("target_per_effort", 50))` and `floor = manifest.get("floor", target)`, validating both as positive non-bool integers. The `build_report(manifest, export, ledger, comparator_evidence, adjudications)` signature is untouched.
- `report.py`: added tier/effort population bookkeeping beside the existing attempted/completed bookkeeping; canonical, exclusion, cost and usage logic keep their behaviour. Each arm gains `floor` and `shortfall_against_floor`; `shortfall`, `target`, `eligible_shortfall` and `completion_shortfall` keep their target-based meaning.
- `report.py`: added the top-level `population` object in the brief's shape — `eligible`, `frozen`, `target`, `floor`, `censored`, `shortfall_against_floor`, `exclusions.manifest`/`exclusions.run`, `by_tier`, and per-effort `eligible`/`attempted`/`completed`/`failed`/`censored`/`shortfall_against_floor`/`by_tier`/`exclusions`. Existing top-level keys and `arms` are all retained.
- `test_report.py`: `make_manifest` keeps its legacy shape by default and gains `phase3=True` (plus `floor`, `censored`) producing `tier`+`stratum`, `target`/`floor`, `tiers`, `exclusions`, `excluded_total`, `censored`, `shortfall_against_floor`, per-case `outcomes`/`later_fixes`/`censored`, and `criteria.source: "base_blob"`. Added `test_phase3_manifest_population_and_floor_shortfall` and `test_legacy_manifest_aliases_still_read`. Existing assertions unchanged.
- `test_report_export.py`: unchanged; all provenance/refusal/cost tests still exercise the legacy fixture shape.

Behaviour choices within the brief:

- `failed` per effort is `max(0, attempted - completed)`. Exclusion reasons are attributed to an effort from the record's `effort:` tag and surfaced in `by_effort[effort].exclusions`; anything with no effort tag goes to an `unattributed` entry under `by_effort` (only when non-empty). They are not added to `failed` a second time, since attempted already counts tagged non-completed rows.
- `by_effort[effort].censored` counts manifest cases flagged `censored` that were attempted at that effort; the top-level `population.censored` reads `manifest["censored"]` when present, else counts `case["censored"]`, never from windows.
- `population.by_tier` uses `manifest["tiers"]` eligible/frozen when present and otherwise counts legacy cases by derived tier; `unaccompanied` appears only when a case actually has it. `by_effort.eligible` is the frozen case count, since the shared case set runs at every effort.

## Red then green

Red after adding the two tests and the Phase 3 fixture option, before the `report.py` change:

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py
ERROR: test_legacy_manifest_aliases_still_read (...)
KeyError: 'population'
ERROR: test_phase3_manifest_population_and_floor_shortfall (...)
ValueError: invalid stratum for case case-1   # tier: "unit" rejected
Ran 8 tests ... FAILED (errors=2)
```

Green:

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py
Ran 19 tests in 0.028s
OK
```

Read-only Phase 3-shaped check (stdlib, fixture-only, no `.trial-data` read, no network/provider/server):

```
$ python3 - <<'PY'   # make_manifest(3, target=6, phase3=True, floor=5, censored=2) via test_report
ok target 6 floor 5 censored 2 shortfall 2 tier unit accepted per-tier high
{'phase': {'attempted': 1, 'completed': 1}, 'unit': {'attempted': 1, 'completed': 1},
 'pr': {'attempted': 1, 'completed': 1}}
PY
```

It asserts `population.target`/`floor`/`censored`/`shortfall_against_floor`, per-tier attempted/completed, arms' floor, and that `_validate_manifest` accepts a real `tier: "unit"` case.

Full discovery:

```
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 131 tests in 14.695s
FAILED (failures=1)
FAIL: test_cli_freezes_fixture_repository (test_manifest.ManifestFixtures)
AssertionError: '"eligible": 2' not found in '{"candidates": 4, ... "frozen": 2, ...}'
```

This failure is pre-existing and outside this unit's paths: `test_manifest.py:246` still expects the old `cli.py manifest` label `"eligible"`, while `cli.py` prints `"frozen"`. Verified independently by extracting `git archive HEAD` (HEAD excludes this unit's changes) into a repo-local scratch tree and running `test_manifest` there: same single failure, 16 tests, `FAILED (failures=1)`. The cosmetic `eligible` label is Phase 4 unit 7's scope (carried in the Phase 3 record); I did not edit `cli.py` or `test_manifest.py`.

```
$ git diff --check        # no output, exit 0
$ git status --porcelain tools/shadow-review-trial
 M tools/shadow-review-trial/report.py
 M tools/shadow-review-trial/test_report.py
```

`test_report_export.py` needed no change. No tests or checks read `.trial-data/`; no network, provider call or live server was used; only the commands above were run.

## Deviations and contradictions

- The brief's done evidence says full discovery "all pass (91 + this unit's tests)". It does not: one pre-existing `test_manifest` assertion fails at HEAD and is owned by unit 7's cosmetic label. Reported, not fixed (outside owned paths).
- The brief's failure arithmetic ("attempted minus completed, plus the existing `excluded_records` reasons when they can be attributed") is read as `failed = attempted - completed` with the reasons reported in the per-effort exclusion map rather than added again, because attempted already counts tagged non-completed rows and adding them would double count. Unattributable reasons are bucketed under `unattributed` as the brief asks.
- `test_report_export.py` is listed as owned but required no edit; its legacy fixtures still validate and its guards are unchanged.

No other contradictions with DESIGN or the Phase 3 `Carried` item were found. No unrelated bug was encountered.
