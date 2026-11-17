# Brief: phase3-06 — Independent manifest verification and 30-case hand-check

Consumer: a fresh verification worker, with no prior context on units 1-5, dispatched by Plan 28 `execute`.
Owned paths: `docs/plans/28-review-token-only-gating/reports/phase3-06-verify-manifest.md` and, if needed, a throwaway checker under the gitignored `tools/shadow-review-trial/.trial-data/`. Touch nothing else. Do not change code or tests.
Commits: commit only the report to `feat/28-review-token-only-gating` when the checks pass, with a plain-summary title. Never push or merge. Never commit the manifest, the checker or anything derived from the clone other than aggregate counts and pass/fail lines.
Depends on: unit 5 (`phase3-05-real-freeze`).
Runs alongside: nothing.
Budget: 3 files to read, no code changes, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (42-64), Phase 3 (249-254), Assumptions 6, 7, 8, 13 and 17 (122-141, 171-176, 199-204). Binding.
2. `docs/plans/28-review-token-only-gating/reports/phase3-05-real-freeze.md` — the seed, manifest path and reported counts.
3. The frozen manifest at `tools/shadow-review-trial/.trial-data/manifest-<seed>.json` — read it locally; never copy case content out.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Independently prove that the frozen real-clone manifest satisfies the Phase 3 contract: 300-360 cases, three tiers with per-tier and per-reason accounting, base-sha criteria, cited outcomes and later fixes that resolve, correct censoring, and no commit in two cases. Re-resolve citations directly from git; do not trust the extractor.

## Contract

Cited from DESIGN.md; these decisions are settled:

- Phase 3 outcome: "writes a frozen, hashed manifest whose `cases` number at least 300 (at most 360; below 300 the phase is not closed), every case carrying `tier`, `base_sha`, `head_sha`, a non-empty capture, criteria from `DESIGN.md` at `base_sha`, at least one cited recorded review outcome, a `later_fixes` list (possibly empty) with `censored` set where the window is open, and no commit in two cases; it records per-tier eligible counts and an exclusion count for every ineligible candidate reason". (line 251)
- "**Criteria** are the plan's `DESIGN.md` blob at the case's `base_sha`, not at `head_sha`." (line 54)
- Outcomes: "Each outcome stores severity if stated, the cited path and line range, blob or commit id, and a verbatim text excerpt held only in the local manifest." (line 55)
- Later fixes: "Each stores sha, subject, intersecting paths and hunk ranges. The window ends at the plan's close-out commit or 60 days after `head_sha`, whichever is earlier; a case whose window has not closed is marked `censored` ... An empty `later_fixes` on an uncensored case is a recorded negative." (line 56)
- "**Sample**: the manifest freezes the eligible pool, capped at 360 cases by seeded, tier-stratified selection, and records `target` 360 and `floor` 300 ... Phase 3 closes only at 300 or more." (line 57)
- "**Data handling**: ... Anything committed to `yakka` is aggregate and metric-only: counts, rates, intervals, costs, hashes, tier labels and anonymised case ordinals." (line 63)
- Declared approach (invoker, recorded at refinement): freeze at most 360 eligible cases with a floor of 300; never pad. If the eligible pool is below 300 after the phase → unit → PR tier fallback, the phase stops and reports tier counts and blockers.

Binding constraints:

- The real clone is `/home/codyh/workspace/garcia-music`. Do not modify it: read-only git commands only; no fetch, checkout, reset, clean, commit, push or branch change.
- The manifest and checker stay local and gitignored. Do not commit case SHAs, paths, diff text, finding text or excerpts. The report uses pass/fail lines and aggregate counts only; refer to sampled cases as `case-01` … `case-30`.
- No `/tmp`; any throwaway checker lives under `tools/shadow-review-trial/.trial-data/`. Python stdlib only. No animation, timing or wall-clock assertions.

## Changes

Run each check and record pass/fail with the observed number:

1. Recompute `manifest_sha256` from the canonical JSON excluding the hash field; it must equal the stored value.
2. `300 <= len(cases) <= 360`; `target == 360`; `floor == 300`; `history.shallow` false; `history.object_complete` true; `enumerated_commits == verified_count`.
3. Every case has `tier` in `{"phase","unit","pr"}`, non-empty `base_sha` and `head_sha`, a non-empty capture with `capture["base"] == base_sha` and `capture["resolved_head"] == head_sha`, `criteria.source == "base_blob"` with a `content_hash` that resolves at `base_sha`, at least one outcome, a `later_fixes` list, and a boolean `censored`.
4. Per-tier `{candidates, eligible, frozen}` sums equal the totals; the exclusion counts cover every ineligible candidate exactly once and sum to `candidates` minus the eligible pool; `shortfall_against_floor` is zero.
5. No commit is a `head_sha` in two cases, including across tiers; no case repeats the same `(base_sha, head_sha)`.
6. Deterministic sample of 30 cases (seeded from the manifest seed): for every outcome, `path`, `sha`/`blobhash` and `line_start`/`line_end` resolve in the clone at the cited commit and the excerpt matches the cited lines; for every later fix, the sha exists, is after `head_sha`, is within the window, and at least one recorded intersecting path appears in that commit's diff; for every uncensored case, `window_end <= window_reference`; for every censored case, `window_end > window_reference`.
7. Base-criteria leak check on the sample: `criteria.content_hash` equals `git rev-parse <base_sha>:<plan>/DESIGN.md`; where `DESIGN.md` changed between base and head, the criteria hash is not the head blob.
8. Local-only: `git ls-files` lists no manifest, ledger or export; `git check-ignore -v <manifest>` matches; `git log --all -- tools/shadow-review-trial/.trial-data` is empty.
9. Clone unchanged: `git -C /home/codyh/workspace/garcia-music status --short` empty; `HEAD` and commit count match the unit 5 report.

If any check fails, report `blocked` with the failing check number, the count of affected cases and the failure class only; do not paste the content. Do not fix the code or the manifest here.

### Keep untouched

- All code, tests and the manifest. The clone.

## Done evidence

- Every check above is run and its pass/fail and observed number appear in the report.
- All nine checks pass, or the report is `blocked` with the failing check and counts.
- `git status --short` in the Yakka worktree shows only the report; nothing under `.trial-data/` is tracked.
- `git -C /home/codyh/workspace/garcia-music status --short` → empty.
- `git diff --check` clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
