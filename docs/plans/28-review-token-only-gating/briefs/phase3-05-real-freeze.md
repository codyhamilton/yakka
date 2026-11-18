# Brief: phase3-05 — Real-clone freeze at the 300 floor

Consumer: a run worker on the real garcia-music clone, dispatched by Plan 28 `execute`.
Owned paths: the gitignored local directory `tools/shadow-review-trial/.trial-data/` (manifest output only) and `docs/plans/28-review-token-only-gating/reports/phase3-05-real-freeze.md`. Touch nothing else. Do not change code.
Commits: commit only the report to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title. Never push or merge. Never commit the manifest, the clone or anything derived from the clone other than aggregate counts.
Depends on: unit 4 (`phase3-04-compare-integrate`).
Runs alongside: nothing.
Budget: 3 files to read, no code changes, 40 tool turns plus the freeze run. The freeze walks all remote refs (about 3,800 commits in this clone, not only the ~1,900 reachable from `HEAD`) and may take well over ten minutes; run it once with a generous timeout and let it finish. Unit 6 verifies the result from fresh context. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (42-64), Phase 3 (249-254), Assumptions 6, 7, 8, 13 and 17 (122-141, 171-176, 199-204). Binding.
2. `docs/plans/28-review-token-only-gating/briefs/phase3-01-manifest-contract.md` and `phase3-04-compare-integrate.md` — the interface and what was selected.
3. `tools/shadow-review-trial/cli.py` — the `manifest` parser and dispatch only.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Run the Phase 3 manifest command once against the private full clone of `codyhamilton/garcia-music`, write the frozen manifest to the local gitignored directory, and report the real per-tier count against the 300 floor and 360 cap. Nothing is padded; a floor miss stops the phase.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "`cli.py manifest --repo <full clone of codyhamilton/garcia-music> --expected-repository codyhamilton/garcia-music --history-profile garcia-music-workflow --seed <n> --output <local path>` verifies a non-shallow, object-complete clone and writes a frozen, hashed manifest whose `cases` number at least 300 (at most 360; below 300 the phase is not closed), every case carrying `tier`, `base_sha`, `head_sha`, a non-empty capture, criteria from `DESIGN.md` at `base_sha`, at least one cited recorded review outcome, a `later_fixes` list (possibly empty) with `censored` set where the window is open, and no commit in two cases; it records per-tier eligible counts and an exclusion count for every ineligible candidate reason ... running against the real clone reports the actual counts." (line 251)
- "**Sample**: the manifest freezes the eligible pool, capped at 360 cases by seeded, tier-stratified selection, and records `target` 360 and `floor` 300 ... Phase 3 closes only at 300 or more; if every tier is exhausted below 300 the phase stops with tier counts and blockers and the trial does not start." (line 57)
- "**Data handling**: garcia-music is private and `yakka` is public. Diffs, outcome text, review text and case lists exist only in locally held, gitignored files. Anything committed to `yakka` is aggregate and metric-only: counts, rates, intervals, costs, hashes, tier labels and anonymised case ordinals." (line 63)
- Declared approach (invoker, recorded at refinement): freeze at most 360 eligible cases with a floor of 300; never pad. If the eligible pool is below 300 after the phase → unit → PR tier fallback, stop and report the per-tier counts and blockers.

Binding constraints:

- The real clone is `/home/codyh/workspace/garcia-music` (private `codyhamilton/garcia-music`, full, non-shallow). Do not modify it: no checkout, reset, clean, commit, push, branch change or worktree edit. The tool's `prepare_history` may refresh remote-tracking refs and `FETCH_HEAD`; the working tree, local branches, commits and HEAD must be unchanged before and after. Take `git status --short`, `git rev-parse HEAD`, `git rev-parse --is-shallow-repository` and `git rev-list --count HEAD` before and after.
- The manifest, ledger and any export stay local and gitignored under `tools/shadow-review-trial/.trial-data/`. Do not commit them. Do not copy case SHAs, paths, diff text, finding text or excerpts into the report; counts, tier labels, exclusion reasons, the seed and the manifest hash only.
- Tests and scripts must not use `/tmp`. Python stdlib `unittest` only; do not add tests here.

## Changes

- Confirm the clone: `git -C /home/codyh/workspace/garcia-music remote get-url origin` names `codyhamilton/garcia-music`; `rev-parse --is-shallow-repository` is `false`; `rev-list --count HEAD` is about 1,900; `status --short` is empty. Do not fetch, pull or change anything yourself.
- Choose and record the seed (for example 28). Confirm `tools/shadow-review-trial/.trial-data/` is ignored (`git check-ignore -v`).
- Run once, with no `--target` override so the contract's 360/300 values apply:

```
python3 tools/shadow-review-trial/cli.py manifest \
  --repo /home/codyh/workspace/garcia-music \
  --expected-repository codyhamilton/garcia-music \
  --history-profile garcia-music-workflow \
  --seed 28 \
  --output tools/shadow-review-trial/.trial-data/manifest-28.json
```

- From the frozen manifest, report: `manifest_sha256`, `target`, `floor`, `seed`, `window_reference`, `verified_count`/`enumerated_commits`, `shallow`, `object_complete`, total candidates, total eligible, total frozen, per-tier `{candidates, eligible, frozen}`, every exclusion reason and its count, and the censored count. State explicitly whether `300 <= cases <= 360`.
- If the command exits non-zero or the count is below 300, do not pad, do not invent cases, do not re-run with a different seed to change the eligible pool, and do not start the trial. Write the counts, tier labels and blockers in the report, commit the report, and report `blocked`.
- Re-run the clone checks and confirm they are unchanged.

### Keep untouched

- All code and tests. The clone's working tree, refs, HEAD and commits. Everything under `.trial-data/` stays out of the commit.

## Done evidence

Write the report before committing; include the command, the seed, the aggregate counts and the clone checks.

- The manifest command exits 0 and prints a manifest hash and counts; `cases` is at least 300 and at most 360. A below-300 result is a `blocked` outcome with the tier counts, not a pass.
- `python3 -c` over the frozen manifest prints the per-tier and exclusion counts copied into the report; verify each exclusion count is present for every reason, the exclusion counts sum to `candidates` minus the eligible pool, and the per-tier frozen/eligible counts sum correctly.
- `git check-ignore -v tools/shadow-review-trial/.trial-data/manifest-28.json` → matches the ignored directory.
- `git status --short` in the Yakka worktree shows only the report; `git ls-files tools/shadow-review-trial/.trial-data` → empty.
- Clone before/after: same `HEAD`, same commit count, still non-shallow, `status --short` empty.
- `git diff --check` clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
