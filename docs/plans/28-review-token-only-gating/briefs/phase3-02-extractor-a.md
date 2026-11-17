# Brief: phase3-02 — Candidate extractor A (trailer- and commit-driven)

Consumer: a build worker on garcia-music workflow extraction (Python 3 stdlib, `unittest`), dispatched by Plan 28 `execute`.
Owned paths: new `tools/shadow-review-trial/history_extract_a.py`, new `tools/shadow-review-trial/test_history_extract_a.py`; report `docs/plans/28-review-token-only-gating/reports/phase3-02-extractor-a.md`. Touch nothing else. In particular do not edit `manifest.py`, `cli.py`, `history_profile.py`, `test_manifest.py`, `test_phase7.py`, `synthetic_history.py`, `history_extract_b.py` or its test.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push or merge.
Depends on: unit 1 (`phase3-01-manifest-contract`) for the profile, the extractor seam and the fixture builder.
Runs alongside: unit 3 (`phase3-03-extractor-b`), whose module and test are disjoint.
Budget: 5 files to read, about 400 lines changed including tests, 80 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (42-64), Phase 3 (249-254), Assumptions 6, 7, 8 and 10 (122-141, 150-155). Binding.
2. `docs/plans/28-review-token-only-gating/briefs/phase3-01-manifest-contract.md` — the seam and fixture contract.
3. `tools/shadow-review-trial/history_profile.py` — the profile data object and the `extract` seam unit 1 left.
4. `tools/shadow-review-trial/manifest.py` — 227-344 only, to see how metadata is consumed. Read-only for this unit.
5. Real-clone conventions, read-only: `git -C /home/codyh/workspace/garcia-music log --all --format=%B -- docs/plans/06-media-player/REVIEW.md docs/plans/06-media-player/IMPLEMENTATION.md | head`; `git -C ... show d9617db1:docs/plans/06-media-player/REVIEW.md | head -60`; `git -C ... log --all --format='%H %s' | grep -E 'blocking review findings|address review' | head`; `git -C ... log --all --name-only --format= | grep '/reports/' | head`. If a path has moved, pick a similar current one.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Build one complete candidate extractor for garcia-music workflow history that uses commit trailers and commit subjects as the primary signal to locate phase, unit and PR cases, their recorded review outcomes and their later fixes. A second, materially different candidate is built by unit 3; unit 4 compares them, so do not hedge by copying a document-first approach.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "**Case** (garcia-music workflow history only): one of three tiers, each a real diff with `base_sha`/`head_sha`, never padded and never mixed with a differently-defined case": `phase`, `unit`, `pr` as defined at lines 48-52. "Tiers are used in that order of preference until the pool reaches the target (phase first, then unit, then PR), and per-tier counts are reported. A commit belongs to at most one case."
- "**Eligibility** (all required): code-bearing diff that the existing capture policy accepts non-empty; plan criteria resolvable; at least one **recorded review outcome**; case window closed or flagged censored (below)." (line 53)
- "**Recorded review outcomes** (`outcomes`): findings and verdicts the workflow actually recorded for that case — `REVIEW.md` findings and verdict for the plan or phase, phase verification/concerns/carried items in `IMPLEMENTATION.md`, and commits whose subject records review findings being applied (`blocking review findings`, `address review`). Each outcome stores severity if stated, the cited path and line range, blob or commit id, and a verbatim text excerpt held only in the local manifest." (line 55)
- "**Later fixes** (`later_fixes`): commits after `head_sha` and within the case window that are attributed to the same plan (marker, subject or issue reference) and whose diff intersects the files of the case diff. Each stores sha, subject, intersecting paths and hunk ranges. The window ends at the plan's close-out commit or 60 days after `head_sha`, whichever is earlier; a case whose window has not closed is marked `censored` and excluded from fix-recall metrics. An empty `later_fixes` on an uncensored case is a recorded negative." (line 56; Assumption 7 at 129-134)
- "**Sample**: ... capped at 360 cases by seeded, tier-stratified selection, and records `target` 360 and `floor` 300 ... never padded." (line 57)
- Declared approach (invoker, recorded at refinement): build and compare two candidate extractors; freeze at most 360 eligible cases with a floor of 300; never pad. If neither candidate reaches 300 after the phase → unit → PR tier fallback, the phase stops and reports the per-tier counts and blockers.

Binding constraints:

- Nothing from the garcia-music clone is committed. The clone is `/home/codyh/workspace/garcia-music` (private `codyhamilton/garcia-music`); do not modify it. Read-only git commands only; no checkout, fetch, commit, push, reset, clean or worktree change. Do not paste clone content, paths or case SHAs into committed files or the report; aggregate counts and tier labels only.
- The extractor returns verbatim excerpts in memory for the local manifest only. Unit 4 and unit 5 write the manifest, not this unit.
- Tests must not use `/tmp`. Keep temporary directories under the repo (`tempfile.TemporaryDirectory(dir=ROOT / ".scratch")`) or use `synthetic_history.py`. Python stdlib `unittest` only. No animation, timing or wall-clock assertions; `now` is injected.
- Do not weaken any contract: criteria at base, per-reason exclusions, outcomes citations, later-fix censoring, no commit in two cases.

## Changes

Implement `history_extract_a.py` with `NAME` (for example `"trailer-commit"`) and:

```python
def extract(repo, profile, *, now) -> dict[str, dict]:
    """sha -> {tier, plan, phase, pr, base_sha, outcomes, later_fixes, censored, window_end}"""
```

- Enumerate commits from all remote refs plus `HEAD` through the profile; dedupe.
- `phase`: locate `Workflow-Phase`/`Yakka-Phase` trailer commits and phase-close records; base is the previous phase's closing commit or the plan's first implementation commit; head is this phase's closing commit. Phases may live on branch refs, not only mainline.
- `unit`: a commit that adds a handoff report at `docs/plans/<plan>/reports/*.md` and carries plan identity; base is its parent (or the merge base the profile names). Keep the report path as the citation.
- `pr`: a squash-merged commit carrying a plan marker and a review record; base is its parent.
- Preference and dedupe: if a commit qualifies for more than one tier, assign the earlier tier in `phase > unit > pr` order and leave it out of the others.
- Outcomes: parse the plan/phase `REVIEW.md` verdict and findings tables/sections, `IMPLEMENTATION.md` verification/concerns/carried items, and subjects matching `blocking review findings` / `address review`. For each: source kind, path, commit or blob id, line start/end, severity when stated, verbatim excerpt. Do not include a heading or table header as a finding.
- Later fixes: for each case, walk commits after `head_sha` and at or before `max(close-out, head + 60 days)`; keep commits attributed to the plan by marker or subject and intersecting the case diff paths; record sha, subject, intersecting paths and hunk ranges. Mark `censored` when the window end is after the injected `now`; `now` defaults to the tip commit's committer time in the caller, not the wall clock.
- Every candidate gets exactly one exclusion reason from a fixed vocabulary: `no_base_commit`, `no_code_change`, `empty_capture`, `capture_<code>`, `criteria_unavailable`, `no_recorded_outcome`, `window_open` only when the contract says a case is excluded (it is not; open windows are censored), `duplicate_commit`, `missing_comparator_source`. Use the exact labels unit 1 and unit 4 read; if unit 1 names a different vocabulary, follow it and say so.
- Determinism: stable iteration order; no randomness, network or LLM.

### Keep untouched

- The clone's working tree, refs and objects. `git status --short` in `/home/codyh/workspace/garcia-music` must be empty before and after.
- Unit 1's profile, manifest assembly and tests; unit 3's module and test; `runner.py`, `report.py`.

## Done evidence

Write the failing checks first; report their red output and then the green output.

- `python3 -m unittest tools/shadow-review-trial/test_history_extract_a.py -v` → all pass. Before code, the new tests fail.
- Synthetic fixtures cover: one case per tier, a phase whose `REVIEW.md` carries a verdict and two findings, a unit handoff report commit, a PR squash commit, a later fix intersecting the case paths, a later commit that does not intersect, an open window (censored), and a base `DESIGN.md` that changes at head. Assert tier, base/head, citation line ranges, excerpts, hunk ranges and censoring.
- Determinism: two calls with the same `now` return equal metadata.
- A read-only real-clone scan over `/home/codyh/workspace/garcia-music` prints, per tier, `{candidates, with_plan, with_outcome, with_later_fixes, censored}` and the exclusion counts. Record the numbers; a zero tier is reported, not invented, and only the combined eligible count decides the floor. No manifest file is written and no clone content is printed.
- `git -C /home/codyh/workspace/garcia-music status --short` → empty; `git -C ... rev-parse --is-shallow-repository` → `false`.
- `git diff --check` clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
