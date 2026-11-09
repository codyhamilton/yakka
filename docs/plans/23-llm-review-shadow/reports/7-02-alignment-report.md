# 7-02 — Alignment report and adjudication inputs

Status: done with concerns

Implemented deterministic report calculation and input validation in `tools/shadow-review-trial/report.py`, with offline contract fixtures in `test_report.py`. The callable entry point is `build_report(manifest, reviews, comparator_evidence, adjudications, cost_cap_usd=None)`. Adjudications use version 1, a `low_sample_rate`, and finding identities; sources are `review`, `curated`, or `pr_export`. Historical phase comparators and PR exports remain separate. Output includes arm eligibility/completion shortfalls, paired and available-case outcomes, statuses and attempts, rubric categories, seeded low-finding selection, strata, per-case and aggregate usage/cap comparisons, partial coverage, and explicit missing-data fields.

## Checks

Before implementation, `python3 -m unittest tools/shadow-review-trial/test_report.py` failed with `ModuleNotFoundError: No module named 'tools.shadow-review-trial/test_report'` because the report test did not yet exist.

After implementation:

```text
python3 -m unittest tools/shadow-review-trial/test_report.py
Ran 5 tests in 0.007s
OK
```

`python3 -m py_compile tools/shadow-review-trial/report.py tools/shadow-review-trial/test_report.py` passed. `git diff --check` passed with no output.

## Deviations, contradictions, unfinished work

No departures or design contradictions. Phase 7 CLI wiring remains outside this unit. `GET /v1/reviews` returns at most 500 records; the report sets `record_limit_may_truncate` at that boundary, so the caller should supply the complete filtered record set and treat that flag as a possible incomplete denominator. No provider calls, credentials, deployments, Fly, or Wrangler actions were used.
