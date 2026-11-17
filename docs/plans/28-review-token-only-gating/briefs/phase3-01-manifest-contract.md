# Brief: phase3-01 — Manifest contract, history profile and candidate accounting

Consumer: a build worker on `tools/shadow-review-trial` manifest construction (Python 3 stdlib, `unittest`), dispatched by Plan 28 `execute`.
Owned paths: `tools/shadow-review-trial/manifest.py`, `tools/shadow-review-trial/cli.py`, `tools/shadow-review-trial/test_manifest.py`, new `tools/shadow-review-trial/history_profile.py`, new `tools/shadow-review-trial/test_history_profile.py`, new `tools/shadow-review-trial/synthetic_history.py`, `.gitignore`; report `docs/plans/28-review-token-only-gating/reports/phase3-01-manifest-contract.md`. Touch nothing else.
Do not edit `test_phase7.py`, `runner.py`, `report.py`, `history_extract_a.py`, `history_extract_b.py` or `README.md`. Unit 4 owns the end-to-end fixture update; units 2 and 3 own the extractor modules.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push or merge.
Depends on: nothing. Phase 1 and Phase 2 are closed with `Carried: None` (`IMPLEMENTATION.md` lines 8-63).
Runs alongside: nothing. Units 2 and 3 depend on the seam and fixtures this unit leaves.
Budget: 7 files to read, about 600 lines changed including tests, 100 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (lines 42-64), Phase 3 (249-254), Assumptions 6, 7, 8, 13, 17 and 18 (122-127, 129-134, 136-141, 171-176, 199-211), Architectural Implications (72-80). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 1 and Phase 2 closes and their `Carried:` sections (8-63).
3. `tools/shadow-review-trial/manifest.py` — all 344 lines.
4. `tools/shadow-review-trial/cli.py` — 94-172 (the `manifest` parser and dispatch).
5. `tools/shadow-review-trial/test_manifest.py` — all 230 lines.
6. `.gitignore` — the whole file (6 lines).
7. Capture client location check: `plugins/yakka/client/yakka.py` — grep `CaptureChange` and `CaptureError`; read around line 570 (`CaptureError`) and line 928 (`CaptureChange`). Record the answer in your report: today both live in `plugins/yakka/client/yakka.py`. Plan 27 exists only as a design on `design/27-yakka-client-consolidation` and is not built into this branch; that design's module map would move capture to `plugins/yakka/scripts/libs/` (indicatively `capture.py`). Keep the current `sys.path` + `import yakka` and add a comment naming that future move. If `plugins/yakka/client/yakka.py` is absent when you start, stop and report `needs context`.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Give the manifest a repository-agnostic contract that can express the three case tiers, criteria at the base commit, per-candidate exclusion accounting and the 360/300 sample, selected by a named history profile. Leave recorded-outcome extraction and eligibility gating to units 2-4.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "**Repository-agnostic manifest**: `--expected-repository` selects the repo; layout assumptions (trailer names, plan paths, comparator sources) come from a named history profile, `garcia-music-workflow` first. History is fetched full and verified non-shallow and object-complete before freezing, as now." (line 47)
- Case tiers, in preference order: "`phase` — the diff of one phase of a plan, from the previous phase's closing commit (or the plan's first implementation commit) to this phase's closing commit, located from `Workflow-Phase`/`Yakka-Phase` trailers and phase-close records in branch history (all remote refs, not only mainline)." "`unit` — the commit that landed one refined unit of a phase, identified by a unit handoff report under `docs/plans/<plan>/reports/` added in that commit." "`pr` — a squash-merged PR commit carrying a plan marker, with its review record." "Tiers are used in that order of preference until the pool reaches the target (phase first, then unit, then PR), and per-tier counts are reported. A commit belongs to at most one case." (lines 48-52)
- "**Criteria** are the plan's `DESIGN.md` blob at the case's `base_sha`, not at `head_sha` ... A plan whose `DESIGN.md` is absent at `base_sha` is `criteria_unavailable`." (line 54; Assumption 8 at 136-141)
- "**Sample**: the manifest freezes the eligible pool, capped at 360 cases by seeded, tier-stratified selection, and records `target` 360 and `floor` 300 (the old default of 50 is gone). Phase 3 closes only at 300 or more; if every tier is exhausted below 300 the phase stops with tier counts and blockers and the trial does not start." "Each frozen case also records per-reason exclusion counts for all candidates." (line 57; Assumption 17 at 199-204)
- "**Data handling**: ... Diffs, outcome text, review text and case lists exist only in locally held, gitignored files. Anything committed to `yakka` is aggregate and metric-only: counts, rates, intervals, costs, hashes, tier labels and anonymised case ordinals." (line 63)
- Declared approach (invoker, recorded at refinement): build and compare two candidate extractors; freeze at most 360 eligible cases with a floor of 300; never pad. If neither candidate reaches 300 after the phase → unit → PR tier fallback, the phase stops and reports the per-tier counts and blockers; it does not invent or pad cases.

Capture client (Assumption 18, checked at refinement): `CaptureChange` is a function at `plugins/yakka/client/yakka.py:928` and `CaptureError` is a class at `plugins/yakka/client/yakka.py:570`. `manifest.py` inserts that directory on `sys.path` and imports `yakka`; keep that import. Plan 27 is only a design on `design/27-yakka-client-consolidation` and is not built here; if it lands first, its lib map moves capture to `plugins/yakka/scripts/libs/` (indicatively `capture.py`) and the import path changes to that module, with no change to the `CaptureChange` call shape.

Binding constraints:

- Nothing from the garcia-music clone is committed. The real clone is `/home/codyh/workspace/garcia-music` (private `codyhamilton/garcia-music`, full and non-shallow); do not modify it.
- Add the `.gitignore` entry for the local trial data directory `tools/shadow-review-trial/.trial-data/` (manifest, ledger and export paths in Phase 3-5 use it). Do not create a committed file there.
- Tests must not use `/tmp`. Keep temporary directories under the repo; use `tempfile.TemporaryDirectory(dir=ROOT / ".scratch")` (`.scratch/` is already ignored) or an equivalent repo-local directory.
- Python stdlib `unittest` only. No animation, timing or wall-clock assertions.
- Do not weaken any contract above: base-`DESIGN.md` criteria (never head), per-reason exclusion counts for every candidate, per-tier counts, no padding, no commit in two cases.

## Changes

### `history_profile.py`

- Add a data profile named `garcia-music-workflow` (first) with: trailer keys `Workflow-Plan`, `Workflow-Phase`, `Yakka-Plan`, `Yakka-Phase`, PR marker keys `Pull-Request`, `PR`; plan-path resolution for folder and collapsed plan records; `DESIGN.md`, `REVIEW.md`, `IMPLEMENTATION.md` and `reports/` locations; phase-close and close-out markers; the 60-day later-fix window. Keep a generic fallback so the synthetic `docs/plans/demo` fixtures work.
- Add `--history-profile` to the `manifest` command, default `garcia-music-workflow`, and pass the profile through `create_manifest`. Keep `--remote`, `--expected-repository`, `--seed`, `--comparators` and `--pr-export`.
- Define the extractor seam the next units implement, without implementing extraction: `extract(repo, profile, *, now) -> dict[sha, metadata]`, where metadata carries `tier`, `plan`, `phase`, `pr`, `base_sha`, `outcomes`, `later_fixes`, `censored`, `window_end`. Document it in the module docstring. Keep a temporary default that preserves today's trailer-derived `phase`/`pr`/`unaccompanied` classification with empty outcomes/later fixes, so `test_phase7.py` stays green until unit 4 replaces it.
- `now` must be injectable and deterministic; never read the wall clock in the default path.

### `manifest.py`

- Change criteria to the base commit: `_criteria(repo, base, plan)` reads the plan `DESIGN.md` blob at `base_sha`, records `source: "base_blob"`, `path`, `content_hash` (blob id) and text. If it is absent at base, the candidate is ineligible with `criteria_unavailable`; never fall back to head.
- Walk all remote refs, not only the tip: enumerate commits reachable from `refs/remotes/<remote>` plus `HEAD`, dedupe, and verify non-shallow and object-complete across that set before freezing. Keep the existing `HistoryPreparationError` messages and the verified-count/enumeration agreement. Record the ref list and counts in `history`.
- Rename the case dimension to `tier` with values `phase`, `unit`, `pr`; a commit with none remains a candidate recorded only for exclusion accounting. Store both `tier` and `base_sha`/`head_sha` on every candidate and case.
- Add the frozen fields the contract requires: `target` (360), `floor` (300), per-tier `{candidates, eligible, frozen}`, `exclusions` (reason → count over all ineligible candidates; every ineligible candidate has exactly one reason), `excluded_total`, `censored` count, `shortfall_against_floor`, and the `window_reference` time used for censoring. Keep `cases`, `candidates`, `run_order`, `settings`, `comparators`, `manifest_sha256` and `ManifestFrozenError`.
- Seed the sample deterministically: take `phase`, then `unit`, then `pr` up to `target`; never pad; a commit appears at most once even if the extractor metadata overlaps. Keep `target`/`floor` in the frozen manifest as the source of truth. Keep `--target` (default 360) and add `--floor` (default 300) so fixtures can use small targets.
- Define an injectable extractor argument on `create_manifest`; the temporary default preserves current classification. Unit 4 wires the selected extractor and turns on outcome eligibility.
- Keep `_validate_curated` and `load_pr_export` behaviour; update their stratum checks for `unit` only if needed.

### `cli.py`

- Add `--history-profile`; change `--target` default to 360; add `--floor` default 300. Print `manifest_sha256`, `candidates`, `eligible`, `target`, `floor`, per-tier counts and `exclusions` so unit 5 can report them.

### `synthetic_history.py`

- Add a small fixture builder in the same folder that initialises a repo, writes a plan folder with `DESIGN.md`, `REVIEW.md`, `IMPLEMENTATION.md`, commits phases with `Workflow-Phase`/`Yakka-Phase`, adds unit handoff reports, PR squash markers and later commits. Keep it deterministic; no `/tmp`.

### `.gitignore`

- Add `tools/shadow-review-trial/.trial-data/`.

### Keep untouched

- `prepare_history`'s refusal on wrong remote, still-shallow, missing count and count mismatch; the manifest's write-once rule; the capture policy's exclusion of the whole `docs/plans/<plan>/` folder; `runner.py` and `report.py`.

## Done evidence

Write the failing checks first; report their red output and then the green output.

- `python3 -m unittest tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_history_profile.py -v` → all pass. Before changes the new base-criteria, tier, exclusion and 360/300 tests fail.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → full suite OK, including `test_phase7.py` under the temporary default extractor.
- `git check-ignore -v tools/shadow-review-trial/.trial-data/example.json` → prints the `tools/shadow-review-trial/.trial-data/` rule; `git status --short` shows nothing under it.
- A fixture whose `DESIGN.md` changes at head: the frozen case's `criteria.content_hash` equals `git rev-parse <base_sha>:docs/plans/demo/DESIGN.md` and `criteria.source` is `base_blob`.
- A fixture with three tiers and overlapping heads: each case carries `tier`, the union has no repeated commit, the per-tier `frozen` counts sum to `cases`, and the exclusion counts sum to `excluded_total` with `excluded_total + sum(tier.eligible) == candidates`.
- A fixture with fewer than 300 eligible cases and `floor` 300: `shortfall_against_floor` is positive and no case is invented.
- The report records the capture-client answer: `CaptureChange`/`CaptureError` at `plugins/yakka/client/yakka.py`, with the Plan 27 note.
- `git diff --check` clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
