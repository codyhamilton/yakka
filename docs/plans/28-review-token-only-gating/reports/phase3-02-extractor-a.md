# Phase 3 unit 2 — candidate extractor A

Status: done with concerns.

## What changed

- New `tools/shadow-review-trial/history_extract_a.py` (`NAME = "trailer-commit"`) implementing `extract(repo, profile, *, now)` and a read-only aggregate `scan(...)`.
- New `tools/shadow-review-trial/test_history_extract_a.py` (stdlib `unittest`, repo-local `.scratch`, injected `now`).

Behaviour: one `git log` over `HEAD` plus remote refs yields commits; `Workflow-Phase`/`Yakka-Phase` trailers group phase closures (base = previous numbered phase head, else the plan's earliest attributed commit, else the parent); commits adding `docs/plans/<plan>/reports/*.md` are `unit`; squash/plan-marker commits with a resolvable `REVIEW.md` are `pr`. Preference `phase > unit > pr`; one tier per commit. Outcomes cite `REVIEW.md` verdict/findings, `IMPLEMENTATION.md` verification/concern/carried notes and `blocking review findings`/`address review` subjects with path, blob/commit, line range, severity and verbatim excerpt. Later fixes are plan-attributed commits after head, within `min(close-out, head + 60d)`, intersecting the case diff, with hunk ranges; open windows are `censored`.

## Red then green

Red before the module existed:

```
ERROR: test_history_extract_a (unittest.loader._FailedTest...)
ModuleNotFoundError: No module named 'history_extract_a'
Ran 1 test ... FAILED (errors=1)
```

Green:

```
python3 -m unittest tools/shadow-review-trial/test_history_extract_a.py -v
Ran 8 tests in 0.133s
OK
```

Full suite: `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → 89 tests, OK. `git diff --check` clean.

## Real-clone aggregate scan

Read-only over `/home/codyh/workspace/garcia-music`, `now` = tip committer time, 3819 commits, no excerpts/SHAs/paths printed or committed:

| tier | candidates | with_plan | with_outcome | with_later_fixes | censored |
|---|---|---|---|---|---|
| phase | 235 | 235 | 222 | 212 | 90 |
| unit | 467 | 467 | 411 | 5 | 57 |
| pr | 2 | 2 | 2 | 0 | 2 |

Extractor-level exclusions: `no_tier` 3115, `no_recorded_outcome` 69. Combined with-outcome cases 635, above the 300 floor. Scan wall time ≈ 4m46s.

## Deviations and contradictions

- Clone status was **not empty before work**: `M .cursor/settings.json`, `?? .cursor/mcp.json`, `?? pid`; identical after. Left untouched (no clean/reset permitted). `is-shallow-repository` = false.
- Vocabulary: the brief's list omits `no_tier`, while unit 1's manifest uses `no_tier`/`shallow_history_boundary`. The scan follows unit 1 for tier-less commits and reports only extractor-level reasons; capture, criteria and comparator gates remain manifest work (`empty_capture`, `capture_<code>`, `criteria_unavailable`, `missing_comparator_source`). This unit does not wire eligibility.
- Requiring a resolvable `REVIEW.md` for `pr` (per the tier definition) leaves only 2 PR candidates; most closing squash commits no longer carry the plan folder at head. Phase+unit still clear the floor.
- A case head may also be another case's later fix (the fixture PR commit is a later fix of the phase case); the contract forbids only a commit belonging to two cases.
