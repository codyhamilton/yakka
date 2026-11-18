# Phase 3 unit 3 — candidate extractor B

Status: done with concerns.

## What changed

- New `tools/shadow-review-trial/history_extract_b.py` (`NAME = "document-report"`): document/report-led `extract(repo, profile, *, now)` plus a read-only aggregate `scan(...)`.
- New `tools/shadow-review-trial/test_history_extract_b.py` (stdlib `unittest`, repo-local `.scratch`, injected `now`).

Locators: `phase` from `IMPLEMENTATION.md` `Phase N` sections whose heading or status line records completion, with a plan close-out record ending the later-fix window; `unit` from a commit adding `docs/plans/<plan>/reports/*.md` and the report's own phase/commit attribution; `pr` from a squash/plan-marker commit whose `REVIEW.md` exists at that commit. Preference `phase > unit > pr`; one commit per case. Outcomes cite `REVIEW.md` verdict/findings, `IMPLEMENTATION.md` verification/concerns/carried/status, report findings and review-application subjects, with source, path, commit/blob, line range, severity and verbatim excerpt. Later fixes are plan-attributed commits after head inside `min(close-out, head+60d)` that intersect non-plan case paths, storing paths and hunk ranges; open windows are `censored`. Every candidate has one exclusion reason: `eligible`, `no_tier`, `no_base_commit` or `no_recorded_outcome`.

The inherited working tree already contained the two untracked files. I verified them, added the missing `scan()`, and fixed: (a) close-out matching, which compared a slug-only plan against `docs/...` paths and so never closed real windows; (b) phase-section detection, which matched only `**Status:** Complete` and found one real phase; (c) default-`now` tip lookup (`HEAD` was never a key in the commit map); (d) no-outcome vocabulary aligned to unit 2's `no_recorded_outcome`.

## Red then green

Red with the module absent:

```
FileNotFoundError: .../tools/shadow-review-trial/history_extract_b.py
Ran 1 test ... FAILED (errors=1)
```

New scan test before `scan()` existed:

```
AttributeError: module 'shadow_extract_b' has no attribute 'scan'
Ran 17 tests ... FAILED (errors=1)
```

Green:

```
python3 -m unittest tools/shadow-review-trial/test_history_extract_b.py -v
Ran 17 tests in 0.57s
OK
python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 90 tests in 14.4s
OK
```

Tests cover one case per tier, doc-located phase close and base, unit report attribution, PR squash base, no commit in two cases, citations/excerpts/line ranges, intersecting and non-intersecting later fixes with hunk ranges, open and closed windows, base-vs-head `DESIGN.md`, determinism for the same `now`, `now=None` = tip time, one exclusion per candidate, and scan aggregates. `git diff --check` clean; `py_compile` clean.

## Real-clone aggregate scan

Read-only over `/home/codyh/workspace/garcia-music`, `now = None` (tip committer time), 3819 commits. No content, paths or SHAs printed or committed:

| tier | candidates | with_plan | with_outcome | with_later_fixes | censored |
|---|---|---|---|---|---|
| phase | 23 | 23 | 23 | 16 | 14 |
| unit | 465 | 465 | 458 | 273 | 363 |
| pr | 94 | 94 | 92 | 10 | 77 |

Extractor-level exclusions: `no_tier` 3236, `no_recorded_outcome` 9, `no_base_commit` 1. Combined with-outcome cases 573, above the 300 floor; no manifest written. Clone `status --short` unchanged before/after (`M .cursor/settings.json`, `?? .cursor/mcp.json`, `?? pid`), `is-shallow-repository` = `false`.

## Deviations and contradictions

- The brief's done evidence says clone status is empty; the dispatcher and reality say it was already dirty. Left untouched.
- The brief's ~400-line budget is exceeded: the inherited files total 895 lines including tests. I finished rather than rewrite the inherited design; `done with concerns`, not `over budget`, because the unit outcome and evidence are complete.
- Unit 2's scan uses `no_recorded_outcome`; unit 1's manifest has no extractor-level equivalent. I followed unit 2's name and kept unit 1's `no_tier`/`no_base_commit`.
- Document-led phase extraction is sparse in this history: phase-trailer commits rarely retain the plan folder at that commit, so 23 phase candidates are reported rather than padded or derived from trailers (unit A, trailer-led, reports 235).
- Censoring is high (454 of 582 cases) because most heads sit within 60 days of the tip and many plans have no close-out record. Censored cases remain eligible per contract and are excluded only from fix recall.
