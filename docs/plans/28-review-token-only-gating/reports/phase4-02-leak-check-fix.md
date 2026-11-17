# Phase4-02 leak-check precision fix

Status: done.

## Defect corrected

The first build searched raw diff text. It counted bare path strings as own-plan
document hits and searched outcome excerpts inside other plans'
`IMPLEMENTATION.md` sections. Against the real Phase 3 manifest it reported
`own_plan_document_hits: 36`, `outcome_text_hits: 396` and
`foreign_plan_document_captures: 93`.

## Changes

- `leak_check.py` resolves capture diff sections from their `diff --git` path.
  A hit is an own-plan `REVIEW.md`, `IMPLEMENTATION.md` or `DESIGN.md`
  **section**, not a mention of its path in code or prose.
- Sections under any other plan's `docs/plans/` folder increment
  `foreign_plan_document_captures` once per case and do not fail. Every
  `docs/plans/` section body is excluded from the outcome-excerpt search.
- Outcome excerpts are searched only when their normalised form has at least
  `MIN_EXCERPT_WORDS = 5` words. Shorter excerpts are counted in the new
  `short_excerpts_skipped` key; `min_excerpt_words: 5` is also returned.
- Existing keys and `scope: "case_plan_and_outcome_excerpts"` are unchanged.
  `pass` is still true only when `request_errors`, `own_plan_document_hits` and
  `outcome_text_hits` are zero.
- A diff with no parseable `diff --git` section is treated as non-plan content
  and searched wholesale, preserving the existing `report.py` fixture
  behaviour without weakening the section rule.
- `summary.py` renders the section-based scope, the `>= 5`-word floor and
  `short_excerpts_skipped`, printing no path, SHA, excerpt or diff line.
- `test_leak_check.py`, `test_summary.py` and `README.md` cover and document
  the amended rules.

## Red evidence

New tests were run against the pre-fix `leak_check.py` and `summary.py`
(implementation reverted to `HEAD`, new tests kept). Result:

```
Ran 15 tests in 0.052s
FAILED (failures=3, errors=3)
```

Failures included `test_bare_own_plan_path_reference_does_not_fail`,
`test_outcome_excerpt_in_foreign_plan_document_is_foreign_not_a_leak`,
`test_short_verdict_excerpt_is_skipped_and_counted`,
`test_whitespace_only_excerpt_is_skipped` and the summary wording assertion.

## Green evidence

```
python3 -m unittest tools/shadow-review-trial/test_leak_check.py
Ran 12 tests ... OK

python3 -m unittest tools/shadow-review-trial/test_summary.py
Ran 3 tests ... OK

python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 152 tests ... OK
```

`git diff --check` is clean. Only the owned unit files, README and this report
are modified.

## Read-only real-manifest proof

Ran `leak_check.check_requests` over the local gitignored
`tools/shadow-review-trial/.trial-data/manifest-28.json` with run id
`readonly-proof`; nothing from the manifest is committed, quoted or used by a
test. Aggregate result only:

```
pass True
requests_checked 1080
request_errors 0
own_plan_document_hits 0
outcome_text_hits 0
foreign_plan_document_captures 54
short_excerpts_skipped 1458
min_excerpt_words 5
scope case_plan_and_outcome_excerpts
```

`short_excerpts_skipped` is summed across the three effort requests per case,
so 1458 is 486 per effort, matching the amendment's real-manifest figure.

## Deviations and contradictions

- The original brief's raw-path/whole-diff search rules are superseded by the
  binding amendment; the amendment is implemented, not the earlier rules.
- `short_excerpts_skipped` is an aggregate across all reconstructed requests
  (three efforts per case), consistent with the per-request summation of
  `outcome_text_hits`. The amendment quotes "486 per effort", which is
  1458 aggregate; no contradiction, only the chosen aggregation unit.
- No other deviation. `runner`, `manifest`, `report`, `cli`, `matching` and
  their tests are untouched.

## README wording to forward

The Leak check section now carries this scope wording:

> **Leak check.** The trial reconstructs every request the runner would send
> from the frozen manifest (`runner.build_request`) and resolves each capture
> diff section by its `diff --git` path. It fails the report when a diff
> *section* is the case's own `docs/plans/<plan>/REVIEW.md`,
> `IMPLEMENTATION.md` or `DESIGN.md`, or when a distinctive recorded outcome
> excerpt appears in the non-plan diff bodies or criteria text
> (`scope: case_plan_and_outcome_excerpts`). A code or prose line that merely
> names an own-plan document is not a leak. Outcome excerpts are searched only
> when normalised to at least `min_excerpt_words` (5) words; shorter boilerplate
> is counted in `short_excerpts_skipped` and not searched. Sections under any
> other plan's `docs/plans/` folder are counted once per case as
> `foreign_plan_document_captures` and never fail the check, and their bodies
> are excluded from the outcome-excerpt search.
