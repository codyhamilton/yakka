# Brief: phase4-05 — Comparisons (a)–(e) and matching/adjudication controls

Consumer: a build worker adding the outcome-comparison and matching-validation sections to the Plan 28 Phase 4 report, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/test_report.py`; report `docs/plans/28-review-token-only-gating/reports/phase4-05-comparisons.md`. Touch nothing else.
Do not edit `cli.py`, `test_report_export.py`, `runner.py`, `manifest.py`, `README.md` or another unit's module — `phase4-04` and `phase4-06` own `report.py` at other times; this unit runs after `phase4-04` and before `phase4-06`.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: `phase4-01-matching` (imports `matching`), `phase4-02-leak-check` (imports `leak_check`), `phase4-04-manifest-population` (tier/target/floor bookkeeping).
Runs alongside: nothing (same `report.py` path as units 4 and 6).
Budget: 8 files to read, about 500 lines to change including tests, 90 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Report comparison (a)–(e) (line 61), Validation controls (line 62), Assumption 10 (152-155), Data handling (63), Phase 4 Outcome (269). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 3 close and `Carried:` (65-100); Phase 4 stub (102-106).
3. `tools/shadow-review-trial/matching.py` — the committed interface: `normalise_text`, `classify`, `tag_method`, `shuffled_case_map`, `cohen_kappa`, `bootstrap_interval`.
4. `tools/shadow-review-trial/leak_check.py` — `check_requests` and its returned aggregate shape.
5. `tools/shadow-review-trial/report.py` — `_validate_manifest`/`_validate_export`/`_validate_ledger`, `build_report` canonical/valid/finding rows (512-714), `_outcome_summary`, and the `population`/`arms` output added by `phase4-04`.
6. `tools/shadow-review-trial/test_report.py` — the fixtures and the Phase 3-shaped manifest added by `phase4-04`.
7. `tools/shadow-review-trial/history_extract_a.py` — outcome kinds `review_finding`, `review_verdict`, `fix_commit` (236-308, 550-600) and `_hunks` (343-365).
8. `packages/yakka/internal/review/validate.go` — `Finding` (25-38).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Emit the five outcome comparisons and the matching/adjudication validation controls: finding recall, fix recall (uncensored only), corroboration, verdict agreement and severity agreement, each per effort and tier, with deterministic method tags, a shuffled-comparator null beside every recall figure, the adjudication file's double labels and Cohen's kappa, and the request leak-check result.

## Contract

Cited from DESIGN.md; these decisions are settled and must not be weakened:

- (a) "*finding recall* — share of recorded review findings matched by a review finding";
- (b) "*fix recall* — share of later-fix hunks whose file and line neighbourhood a review finding flags, uncensored cases only";
- (c) "*corroboration* — share of review findings matching a recorded finding or later fix, with the uncorroborated remainder sampled for adjudication as valid, invalid or unknown";
- (d) "*verdict agreement* — review verdict against recorded verdict (confusion matrix)";
- (e) "*severity agreement where both state one*";
- "matching is deterministic (path, line-range overlap, normalised-text similarity) with every match tagged `structural` or `adjudicated`, and an adjudication file for the uncertain band, with sampled double-labelling and Cohen's kappa; a **shuffled-comparator null** (the same matcher run against another case's outcomes) reported beside every recall figure";
- Assumption 10: "deterministic matcher for clear matches and non-matches; the uncertain band goes to the adjudication file, labelled by an agent with a different model from the reviewer, with a sampled second label and kappa reported; every match is tagged by method so structural-only figures are always available."

Settled definitions (do not re-derive, do not widen):

- **Recorded review findings** are `case["outcomes"]` entries with `kind == "review_finding"` and an integer `line_start`/`line_end` and a `path`. `implementation_note`, `review_verdict` and `fix_commit` are not finding-recall inputs.
- **Review findings** are `record["payload"]["findings"]` of completed canonical records: `id`, `severity`, `path`, `line_start`, `line_end`, `title`, `evidence`.
- **Match**: call `matching.classify(review, target)` for a candidate target. `structural` counts as a match with method `structural`. `uncertain` counts only when the adjudication file supplies a corroboration label for that review finding; then method is `adjudicated` and the category decides. `non_match` never matches. A review finding may match at most one recorded finding and one later-fix hunk; prefer the highest `text_similarity`, then the lowest target path/line, for determinism.
- **Adjudication schema** (extend version 1, keep it readable): the existing `{"version": 1, "low_sample_rate": float, "findings": [...]}` rows keep their fields and categories. Add optional top-level `"labeler_model"` and `"second_labeler_model"` strings, and an optional per-row `"second_label": "<category>"` string. Add `"valid"`, `"invalid"` and `"unknown"` to the accepted review-finding categories alongside the existing `NEW` categories; the old categories keep their current meaning. Historical/comparator categories stay `matched`/`partial`/`unmatched`. Kappa is computed with `matching.cohen_kappa` over rows where both `category` and `second_label` are present; report `None` when none are. Report `labeler_model`/`second_labeler_model` as given or null; do not enforce model identity beyond recording it.
- **Corroboration**: numerator is review findings with a structural or adjudicated match to a recorded finding or a later-fix hunk; denominator is all review findings. The remainder is counted as `valid` (adjudicated valid), `invalid`, `unknown`, or `unadjudicated` (no decision). `corroboration_rate = (numerator + valid) / denominator` with all four counts alongside; never hide the remainder.
- **Verdict**: the review verdict for a completed record is `fail` when any of its findings has severity `blocker` or `high`, else `pass`. A recorded verdict comes from `review_verdict` outcomes: normalise the excerpt; contains `pass` → `pass`; contains `fail`/`blocked`/`request changes`/`changes requested` → `fail`; otherwise `unknown`. The confusion matrix is over cases that have a completed record at that effort and a non-unknown recorded verdict; rows are review `pass`/`fail`, columns recorded `pass`/`fail`, plus agreement rate.
- **Severity agreement**: over matched review/recorded finding pairs where both severities are non-null, compare the lower-cased severity strings; report n, agree count and rate per effort.
- **Null**: for every recall figure (finding recall, fix recall), also run the same matcher against the outcomes of another case from `matching.shuffled_case_map(sorted(case_ids), manifest["seed"])` and report the same numerator/denominator/rate under `null`. Do not omit the null because it is low.
- Deltas (f), cost/latency (g), reproducibility and reconciliation are `phase4-06`'s; do not add them here.

## Changes

### `report.py`

- Import `matching` and `leak_check`.
- Add private helpers for: building finding/target records; matching a review finding to recorded findings and later-fix hunks; per-effort/per-tier ratio assembly; verdict extraction; severity pairs; null runs; method counts.
- Extend `_adjudication_index`/`validate_inputs` for `second_label`, `valid`/`invalid`/`unknown` review categories, and the two labeler fields. Keep the existing "adjudication does not match an input finding" refusals.
- Exclude censored cases from fix-recall denominators only; they stay in finding recall and corroboration. Count the excluded hunks/cases so the report says why the denominator shrank.
- Add a top-level `comparisons` object and a `validation` object with the shapes below. Keep all existing keys, the `population` object and `arms`; keep the function signature and determinism.
- Gain/loss deltas (f) are not here; leave a clearly named placeholder-free structure — do not emit empty `paired_deltas`.

Required shapes (field names are consumed by the summary unit; do not rename):

```
"comparisons": {
  "finding_recall": {"by_effort": {e: {"matched": n, "recorded": n, "recall": float|null, "null": {"matched": n, "recorded": n, "recall": float|null}}},
                      "by_tier": {tier: {"matched": n, "recorded": n, "recall": float|null, "null": {...}}}},
  "fix_recall":     {"uncensored_cases": n, "censored_excluded": n,
                      "by_effort": {e: {"matched": n, "hunks": n, "recall": float|null, "null": {...}}},
                      "by_tier": {tier: {...}}},
  "corroboration":  {"by_effort": {e: {"findings": n, "corroborated": n, "valid": n, "invalid": n,
                                        "unknown": n, "unadjudicated": n, "rate": float|null}}},
  "verdict_agreement": {"by_effort": {e: {"cases": n, "matrix": {"pass": {"pass": n, "fail": n},
                                                                  "fail": {"pass": n, "fail": n}},
                                          "agreement": float|null}}},
  "severity_agreement": {"by_effort": {e: {"pairs": n, "agree": n, "rate": float|null}}}
},
"validation": {
  "matching": {"matches": n, "method_counts": {"structural": n, "adjudicated": n}, "uncertain_band": n},
  "adjudication": {"double_labelled": n, "kappa": float|null,
                    "labeler_model": str|null, "second_labeler_model": str|null},
  "shuffled_null": {"seed": int, "method": "shuffled_case_map"},
  "leak_check": <the `leak_check.check_requests(manifest, export["run_id"])` result, aggregate counts only>
}
```

`by_tier` keys are the tiers actually present in the frozen cases. A zero denominator reports `null`, never 0.0.

### `test_report.py`

- Add fixture review findings with `path`/`line_start`/`line_end`/`severity`/`title`/`evidence` and Phase 3-shaped outcomes/later-fix hunks to the Phase 3 manifest helper (or a new helper) — enough to exercise each comparison.
- Add `test_comparisons_a_to_e_report_rates_and_nulls`: one recorded finding matched structurally, one missed; one uncensored later-fix hunk matched and one censored case excluded; corroboration splits matched/valid/invalid/unknown; verdict matrix and severity agreement correct; every recall figure carries a `null` with the same denominator.
- Add `test_validation_method_tags_kappa_and_leak_check`: every emitted match has a method tag; an uncertain-band review finding with an adjudication `second_label` produces `method_counts.adjudicated` and a non-null kappa; a leak-check fixture with an outcome excerpt in the request makes `validation.leak_check.pass` false.
- Add `test_deterministic_report_bytes_and_censored_fix_recall`: two builds from the same inputs are equal; a censored case's later-fix hunks are in `censored_excluded`, not the denominator.
- Keep every existing assertion and refusal test.

### Keep untouched

- `_validate_manifest` hash/history rules, `_validate_export` pages/cursors/digests, `_validate_ledger` canonical binding, cost/unknown-cost rules and no-provider-call zeros.
- `population`, `arms`, `denominators`, `provenance`, `excluded_records`, `paired_intersection`, `outcomes`, `historical_findings`, `new_findings`, `usage` and their meanings.
- Comparator normalisation and the existing adjudication categories/refusals.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all pass (91 + 01/02/03/04/05 tests; `test_phase7.py` is updated by unit 7).
- A read-only assembly check shows every recall figure has a sibling `null` with the same denominator, every emitted match has `structural` or `adjudicated`, and kappa is non-null only when `double_label` rows exist.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's two files.
- No network, no provider call, no live server, no `.trial-data/` read in tests: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
