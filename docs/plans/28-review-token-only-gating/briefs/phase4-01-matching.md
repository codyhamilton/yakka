# Brief: phase4-01 — Deterministic matcher, null, kappa and bootstrap

Consumer: a build worker adding the deterministic matching/statistics library for the Plan 28 Phase 4 report, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/matching.py`, `tools/shadow-review-trial/test_matching.py`; report `docs/plans/28-review-token-only-gating/reports/phase4-01-matching.md`. Touch nothing else.
Do not edit `report.py`, `cli.py`, `runner.py`, `manifest.py`, `README.md` or their tests — other Phase 4 units own them.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: `phase4-02-leak-check`, `phase4-03-evidence-check`, `phase4-04-manifest-population` (disjoint paths).
Budget: 6 files to read, about 450 lines to add including tests, 80 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Report item (lines 59-62) and Assumption 10 (152-155). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 3 close and `Carried:` (65-100); Phase 4 stub (102-106).
3. `packages/yakka/internal/review/validate.go` — `Finding` struct (25-38): review findings carry `path`, `line_start`, `line_end`, `severity`, `evidence`.
4. `tools/shadow-review-trial/history_extract_a.py` — `_outcome` (236-238), `_parse_review` (270-308), `_hunks` (343-365). This is the recorded-outcome and later-fix-hunk shape the matcher consumes.
5. `tools/shadow-review-trial/test_history_extract_a.py` — outcome and hunk assertions for shape.
6. `docs/plans/28-review-token-only-gating/DESIGN.md` — Data handling (line 63): committed evidence is aggregate and metric-only.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Give the Phase 4 report one deterministic, testable library for deciding whether a review finding matches a recorded outcome or a later-fix hunk, for the shuffled-comparator null, for Cohen's kappa on a double-labelled sample, and for seeded paired bootstrap intervals — with no randomness outside an explicit seed and no model call.

## Contract

Cited from DESIGN.md; these decisions are settled and must not be weakened:

- "matching is deterministic (path, line-range overlap, normalised-text similarity) with every match tagged `structural` or `adjudicated`, and an adjudication file for the uncertain band, with sampled double-labelling and Cohen's kappa; a **shuffled-comparator null** (the same matcher run against another case's outcomes) reported beside every recall figure".
- Assumption 10: "deterministic matcher for clear matches and non-matches; the uncertain band goes to the adjudication file, labelled by an agent with a different model from the reviewer, with a sampled second label and kappa reported; every match is tagged by method so structural-only figures are always available."
- Comparison (a) "finding recall — share of recorded review findings matched by a review finding"; (b) "fix recall — share of later-fix hunks whose file and line neighbourhood a review finding flags"; (c) corroboration matching "a recorded finding or later fix"; (e) "severity agreement where both state one"; (f) "paired high-vs-xhigh-vs-max deltas on the same cases with bootstrap intervals".

Settled interface (other units import these names; do not rename after commit):

- `normalise_text(text: str) -> str` — casefold, collapse all whitespace to single spaces, strip surrounding whitespace; no stemming, no synonym table.
- `classify(review: dict, target: dict) -> dict` where `review` has `path`, `line_start`, `line_end`, `title`, `evidence` (missing `evidence` falls back to `title`); `target` has `path`, `line_start`, `line_end`, `excerpt` (or `text`). Returns `{"band": "structural"|"uncertain"|"non_match", "path_match": bool, "line_overlap": bool, "text_similarity": float}`.
  - `structural`: same path, line ranges overlap or one range is a point inside the other, and normalised-text similarity is at or above `STRUCTURAL_SIMILARITY` (set 0.60 and export it).
  - `non_match`: different path, or no line overlap and text similarity below `UNCERTAIN_SIMILARITY` (set 0.30 and export it).
  - `uncertain`: every other case (e.g. path matches, lines miss, text similar; or path differs, text very similar). The report sends only this band to adjudication.
- `text_similarity(a: str, b: str) -> float` — deterministic token-overlap (e.g. Jaccard over normalised word sets); documented in the module docstring.
- `tag_method(band: str, adjudicated: bool) -> str` — `"structural"` for a structural band, `"adjudicated"` when an uncertain band carries an adjudication category, otherwise `""`. Every match the report emits therefore has a method tag.
- `shuffled_case_map(case_ids: list[str], seed: int) -> dict[str, str]` — a seeded derangement: each case maps to a different case where the list has at least two entries; no fixed points. Sort the input first so the result does not depend on caller ordering. This is the other-case mapping for the shuffled-comparator null.
- `cohen_kappa(pairs: list[tuple[str, str]]) -> float | None` — labels are strings. Return `None` when fewer than two pairs or when the observed agreement is degenerate (all one label); otherwise the standard Cohen kappa with the empirical marginals. Deterministic, no randomness.
- `bootstrap_interval(values: list[float], seed: int, resamples: int = 2000, alpha: float = 0.05) -> dict` — seeded `random.Random(seed)` percentile bootstrap of the mean; deterministic. Returns `{"n": int, "mean": float|None, "low": float|None, "high": float|None, "resamples": int}`; empty input returns `n` 0 and nulls. Sort the resampled means before taking percentiles so output is stable.

## Changes

Create `matching.py` with only the functions and constants above, pure and I/O-free. Use `math`, `random`, `re` and type hints consistent with `report.py`. No module-level mutable state, no time, no environment reads.

### Keep untouched

- `report.py`, `cli.py`, `runner.py`, `manifest.py` and every other module. This unit is additive.
- The outcome/hunk field names produced by `history_extract_a.py`; consume them, do not change them.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_matching.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all pass (currently 91; this unit adds tests only).
- Tests assert: same path with overlapping lines and similar text is `structural`; same path with distant lines and unrelated text is `non_match`; the middle case is `uncertain`; `tag_method` yields `structural`/`adjudicated`/empty as above; `shuffled_case_map` has no fixed point and is identical for the same seed and different for another; `cohen_kappa` is 1.0 for identical labels, 0.0 for the classic chance-agreement table, and `None` for a degenerate sample; `bootstrap_interval` on the same values and seed returns identical bounds across two calls and a bracketed mean.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's two files.
- No network, no provider call, no live server: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
