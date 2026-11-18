# Phase 4 unit 5 — outcome comparisons (a)–(e) and matching/adjudication controls

Status: done with concerns (two interpretations recorded below; one pre-existing failure outside this unit's paths).

## What changed

- `report.py` now imports `matching` and `leak_check` and emits two top-level objects beside every existing key: `comparisons` and `validation`. `build_report(manifest, export, ledger, comparator_evidence, adjudications)` and all existing guards, rows, `population`, `arms`, `denominators`, `provenance`, `excluded_records`, `paired_intersection`, `outcomes`, `historical_findings`, `new_findings` and `usage` keep their signature and meaning.
- Helpers added: payload review findings, recorded findings and later-fix hunk targets, deterministic best candidate (highest similarity then lowest path/line), structural-then-adjudicated matching, recorded/review verdict derivation, ratio assembly, per-effort/per-tier accumulators, shuffled-null runs and method counts. Later-fix hunks are mapped from `start`/`end` to `line_start`/`line_end`; the fix commit subject is the hunk's target text so `matching.classify` can reach the structural band.
- `comparisons` follows the brief's field names: `finding_recall` and `fix_recall` (each `by_effort` and `by_tier`, every row carrying a sibling `null`), `fix_recall.uncensored_cases`/`censored_excluded`, `corroboration`, `verdict_agreement` (confusion matrix and agreement) and `severity_agreement`. Zero denominators report `null`, never `0.0`. Censored cases leave the fix-recall denominators only; they stay in finding recall and corroboration.
- `validation` follows the brief's field names: `matching` (matches, structural/adjudicated method counts, uncertain-band count), `adjudication` (double-labelled count, Cohen's kappa, labeler models), `shuffled_null` (seed and method) and the aggregate `leak_check.check_requests(manifest, run_id)` result.
- Adjudication ingestion now accepts optional top-level `labeler_model`/`second_labeler_model` and per-row `second_label`, admits `valid`/`invalid`/`unknown` for review findings, and keeps every previous category, source, identity and "does not match an input finding" refusal. Kappa is computed over rows with both `category` and `second_label`; it is `null` with no such rows.
- `test_report.py` gains Phase 3-shaped fixtures (outcomes, later-fix hunks, captures, verdicts) plus `test_comparisons_a_to_e_report_rates_and_nulls`, `test_validation_method_tags_kappa_and_leak_check` and `test_deterministic_report_bytes_and_censored_fix_recall`. Every existing assertion and refusal test is unchanged.

Behaviour choices within the brief:

- An uncertain-band candidate becomes a match only under an adjudication category of `matched` or `partial`; `valid`/`invalid`/`unknown` are the corroboration remainder the rate formula adds separately, so no finding is counted twice.
- `matches` counts each tagged (review finding, target) match, split into `structural` and `adjudicated`; the two counts always sum to `matches`. `uncertain_band` counts review findings with at least one uncertain candidate.
- The null swaps in another case's outcomes (recorded findings and later-fix hunks) via `shuffled_case_map(sorted(case_ids), seed)`, keeping this case's review findings. Fix-recall nulls are emitted only for uncensored current-and-comparator pairs, matching the uncensored denominator rule.

## Red then green

Red: the three new tests run against the previous `report.py` (copied under a repo-local `.scratch/phase4-05-red`, removed afterwards):

```
$ python3 -m unittest discover -s .scratch/phase4-05-red -p 'test_report.py'
ERROR: test_comparisons_a_to_e_report_rates_and_nulls (...)  KeyError: 'comparisons'
ERROR: test_deterministic_report_bytes_and_censored_fix_recall (...)  KeyError: 'comparisons'
ERROR: test_validation_method_tags_kappa_and_leak_check (...)  KeyError: 'validation'
Ran 11 tests ... FAILED (errors=3)
```

Baseline before any change (pre-existing suite):

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py
Ran 19 tests ... OK
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 140 tests ... FAILED (failures=1)   # test_manifest.test_cli_freezes_fixture_repository, unit 7's stale label
```

Green after:

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py
Ran 22 tests ... OK
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 143 tests ... FAILED (failures=1)   # the same test_manifest CLI-label assertion, untouched
```

Read-only assembly check on a built report: every `finding_recall`/`fix_recall` row has a sibling `null` with `matched`/denominator/`recall`; `validation.matching.matches` equals the sum of `method_counts`, whose keys are only `structural` and `adjudicated`; `adjudication.kappa` is `null` when no row carries `second_label`.

No network, provider call, live server or `.trial-data/` read was used. Temporary red-run files lived under repo-local `.scratch/` and were deleted.

## Concerns and deviations

- Contradiction in the brief: Changes (line 49) says the null runs the matcher against another case's outcomes, while Done evidence (line 110) says each recall figure's null has the same denominator. Swapping targets changes the denominator to the comparator case's outcome count. This unit follows line 49; the null is present beside every figure but its denominator is the comparator's, not numerically equal to the figure's.
- The brief does not define target text for a later-fix hunk (manifest hunks carry only path/start/end). The fix commit subject is used, so `matching.classify` can mark a path-and-line match with similar text structural; otherwise hunk matches could only ever be uncertain.
- Fix-recall `uncensored_cases`/`censored_excluded` count distinct cases with a completed record at any effort; per-effort denominators count hunks of that effort's uncensored completed cases.
- `test_manifest.test_cli_freezes_fixture_repository` remains the one pre-existing failure (Plan 28 Phase 4 unit 7's stale `eligible`-label assertion); not touched here.
