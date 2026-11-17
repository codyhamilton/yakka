# Brief: phase3-04 — Compare candidate extractors, integrate the selected one and gate eligibility

Consumer: a build worker on the trial manifest, dispatched by Plan 28 `execute`.
Owned paths: `tools/shadow-review-trial/manifest.py`, `tools/shadow-review-trial/cli.py`, `tools/shadow-review-trial/test_manifest.py`, `tools/shadow-review-trial/test_phase7.py`, `tools/shadow-review-trial/history_profile.py`, and whichever of `history_extract_a.py` / `test_history_extract_a.py` or `history_extract_b.py` / `test_history_extract_b.py` you select. Leave the unselected extractor pair untouched. Report `docs/plans/28-review-token-only-gating/reports/phase3-04-compare-integrate.md`. Touch nothing else; do not edit `runner.py`, `report.py`, `README.md` or `.gitignore`.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push or merge.
Depends on: units 1, 2 and 3.
Runs alongside: nothing.
Budget: 9 files to read, about 500 lines changed including tests, 120 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (42-64), Phase 3 (249-254), Assumptions 6, 7, 8, 10, 13 and 17 (122-155, 171-176, 199-204). Binding.
2. `docs/plans/28-review-token-only-gating/briefs/phase3-01-manifest-contract.md`, `phase3-02-extractor-a.md`, `phase3-03-extractor-b.md` — the seam each unit was given.
3. `tools/shadow-review-trial/manifest.py` — all 344 lines after unit 1.
4. `tools/shadow-review-trial/history_profile.py` — the profile and seam after unit 1.
5. `tools/shadow-review-trial/history_extract_a.py` and `history_extract_b.py` — both, to compare.
6. `tools/shadow-review-trial/test_manifest.py` — the fixture suite after unit 1.
7. `tools/shadow-review-trial/test_phase7.py` — 155-180 (`_historical_repo`) and 182-300 (the composed rehearsal).
8. The unit 2 and unit 3 reports — the real-clone counts each candidate produced.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Compare the two candidate extractors on the real history on the criteria the design names, select one, wire it into `create_manifest`, and turn on the full eligibility contract so the frozen manifest contains only cases with a base-criteria blob, a non-empty capture, at least one cited recorded outcome, and a closed or censored window. The phase's 300 floor is tested here on projected counts; the real freeze is unit 5.

## Contract

Cited from DESIGN.md; these decisions are settled:

- Tiers, preference and dedupe: lines 48-52. "Tiers are used in that order of preference until the pool reaches the target (phase first, then unit, then PR), and per-tier counts are reported. A commit belongs to at most one case."
- "**Eligibility** (all required): code-bearing diff that the existing capture policy accepts non-empty; plan criteria resolvable; at least one **recorded review outcome**; case window closed or flagged censored (below)." (line 53)
- "**Criteria** are the plan's `DESIGN.md` blob at the case's `base_sha`, not at `head_sha` ... A plan whose `DESIGN.md` is absent at `base_sha` is `criteria_unavailable`." (line 54)
- Outcomes and later fixes: lines 55-56. Each outcome has severity if stated, cited path and line range, blob or commit id, verbatim excerpt; each later fix has sha, subject, intersecting paths and hunk ranges; open windows are `censored` and excluded from fix-recall metrics.
- "**Sample**: the manifest freezes the eligible pool, capped at 360 cases by seeded, tier-stratified selection, and records `target` 360 and `floor` 300 ... Phase 3 closes only at 300 or more; if every tier is exhausted below 300 the phase stops with tier counts and blockers and the trial does not start." (line 57)
- Phase 3 outcome: "`cli.py manifest --repo <full clone of codyhamilton/garcia-music> --expected-repository codyhamilton/garcia-music --history-profile garcia-music-workflow --seed <n> --output <local path>` verifies a non-shallow, object-complete clone and writes a frozen, hashed manifest whose `cases` number at least 300 (at most 360; below 300 the phase is not closed) ... no commit in two cases; it records per-tier eligible counts and an exclusion count for every ineligible candidate reason; a fixture suite built from synthetic repos covers each tier, censoring, base-criteria leak avoidance, and a shortfall under 300 reported rather than padded". (line 251)
- "Approach: open ... Yardsticks are the real count and a hand-checked sample of 30 cases whose outcome citations and fix attributions must all resolve to the cited blobs/commits. Bound: two candidate extractors are built and compared; if neither reaches 300 after the tier fallback the phase stops and reports." (line 253)
- Declared approach (invoker, recorded at refinement): build and compare two candidate extractors; freeze at most 360 eligible cases with a floor of 300; never pad. If neither candidate reaches 300 after the phase → unit → PR tier fallback, the phase stops and reports the per-tier counts and blockers; it does not invent or pad cases.

Binding constraints:

- Nothing from the garcia-music clone is committed. The clone is `/home/codyh/workspace/garcia-music`; do not modify it. Read-only git commands only. The comparison report contains aggregate counts, rates, tier labels and an outcome-neutral method label; no diff, finding text, path list or case SHA.
- Tests must not use `/tmp`. Keep temporary directories under the repo (`tempfile.TemporaryDirectory(dir=ROOT / ".scratch")`). Python stdlib `unittest` only. No animation, timing or wall-clock assertions.
- Do not weaken the contract: base-`DESIGN.md` criteria (never head), per-reason exclusion counts for every candidate, later-fix censoring, at least one cited recorded outcome per case, no commit in two cases, never pad.

## Changes

- Compare both candidates with a deterministic, read-only scan of `/home/codyh/workspace/garcia-music`, without writing a manifest or touching the clone. Cache per-commit trailers, subjects and changed paths so both candidates read the history once; the comparison is metadata-only and must not capture diffs. For each candidate report: per-tier `{candidates, with_plan, with_outcome, with_later_fixes, censored}`; total candidates with at least one cited outcome; exclusion counts by reason; and, on a seeded sample of up to 30 outcome-bearing candidates, the share whose outcome path/sha/blobhash/line range resolves and whose excerpt matches, and the share of later fixes whose sha exists and intersects. Select the candidate with the higher resolved-citation rate among those whose projected eligible count is at least 300; if both are below 300, select the higher count, record the projected shortfall and blockers, and report `blocked` without wiring an unproven pipeline past a failing floor.
- Integrate the selected extractor into `create_manifest`: consume its metadata, enforce all four eligibility conditions, assign each commit to at most one tier, apply the phase → unit → PR preference and the seeded sample cap, and compute `exclusions`, per-tier counts, `target`, `floor`, `shortfall_against_floor`, `censored` and the window reference. Keep the manifest write-once rule and `manifest_sha256`.
- Update `test_manifest.py` so the suite covers each tier, censoring, base-criteria leak avoidance, no commit in two cases, per-reason exclusion accounting, and a synthetic shortfall under 300 reported rather than padded.
- Update `test_phase7.py`'s `_historical_repo` so each of its three phase commits carries a recorded outcome that the selected extractor accepts (for example append a verdict/finding to `REVIEW.md` or a review-fix subject at each phase head), keeping the 3-case, 3-effort rehearsal green. Do not change the rehearsal's assertions to hide a contract failure.
- Record in the report which capture import location the manifest uses (today `plugins/yakka/client/yakka.py`) and the Plan 27 note. Do not change it unless the file is gone.

### Keep untouched

- `runner.py`, `report.py`, `.gitignore`, the unselected extractor pair, and the clone.

## Done evidence

Write the failing checks first; report their red output and then the green output.

- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all tests pass, including the updated `test_phase7.py` rehearsal and `test_manifest.py`.
- The comparison command over the real clone prints both candidates' per-tier counts, outcome counts, exclusion counts and resolved-citation rates; the report states the selected candidate and why. Expected: the selected candidate's projected eligible count is at least 300, or the report records the tier counts and blockers and the unit is `blocked`.
- A fixture test proves each tier, censoring, base-criteria leak avoidance, no commit in two cases, every exclusion reason counted, and a shortfall under 300 reported rather than padded.
- `git -C /home/codyh/workspace/garcia-music status --short` → empty; `git -C ... rev-parse --is-shallow-repository` → `false`.
- `git diff --check` clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
