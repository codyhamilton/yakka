# Phase 3 unit 5 — real-clone freeze at 360 cases

Status: done with concerns. The freeze exits 0, the frozen manifest holds 360 cases
(300 <= 360 <= 360), and the ineligible pool is accounted for with no padding. One
capture-policy concern and two reporting discrepancies are recorded below; no code
or clone change was made.

## Command and seed

Run once, no `--target`/`--floor` override:

```
python3 tools/shadow-review-trial/cli.py manifest \
  --repo /home/codyh/workspace/garcia-music \
  --expected-repository codyhamilton/garcia-music \
  --history-profile garcia-music-workflow \
  --seed 28 \
  --output tools/shadow-review-trial/.trial-data/manifest-28.json
```

Seed 28. Output is gitignored (`git check-ignore` matches
`.gitignore:6:tools/shadow-review-trial/.trial-data/`); `git ls-files` over that
directory is empty. The manifest and everything derived from the clone stay local.

## Frozen manifest

- `manifest_sha256`: `10f8d4d3e0c08a1e2a4883fc8f653f37cc61fefe54e8effe824f285f896d482f`
- `target` 360, `floor` 300, `shortfall_against_floor` 0, `seed` 28
- `window_reference`: `2026-11-17T15:37:08Z`
- `history`: repository `codyhamilton/garcia-music`, remote `origin`, 184 enumerated
  refs (183 fetched), `enumerated_commits` 3815, `verified_count` 3815,
  `shallow` false, `object_complete` true
- Totals: candidates 3815, eligible pool 534, frozen cases 360
- Censored among frozen: 100
- Every case has `tier`, `base_sha`, `head_sha`, `case_id`, non-empty capture,
  criteria (`base_blob`, 360/360), at least one recorded outcome (minimum 1) and a
  `later_fixes` list; 360/360 case ids are unique, so no commit is in two cases
- 173 of 360 captures are truncated (`capture.complete` false); all are non-empty,
  per the capture policy

Per-tier counts `{candidates, eligible, frozen}`:

| tier | candidates | eligible | frozen |
|---|---|---|---|
| phase | 235 | 193 | 193 |
| unit | 464 | 339 | 167 |
| pr | 2 | 2 | 0 |

Tier fill order is phase then unit, so the 360 cap is reached without PR cases.

Exclusions (one reason per ineligible candidate):

| reason | count |
|---|---|
| `no_tier` | 3114 |
| `no_recorded_outcome` | 69 |
| `no_code_change` | 88 |
| `empty_capture` | 8 |
| `criteria_unavailable` | 2 |

Exclusion counts sum to 3281 = 3815 candidates - 534 eligible. Per-tier eligible
sums to 534 and per-tier frozen to 360. `300 <= cases <= 360` holds at exactly 360.

## Clone checks

`/home/codyh/workspace/garcia-music`, before and after the run (identical):

- `remote get-url origin` = `git@github.com:codyhamilton/garcia-music.git`
- `rev-parse HEAD` = `30e033973a68fabd64fc96c2d35b9febf5fbc9b9` (also the manifest
  `history.tip_sha`)
- `rev-list --count HEAD` = 1897
- `rev-parse --is-shallow-repository` = false
- `status --short`: `M .cursor/settings.json`, `?? .cursor/mcp.json`, `?? pid` —
  the same three entries the phase found; the working tree is unchanged
- `HEAD` is detached (`git symbolic-ref` fails); this was already so and is
  unchanged

No checkout, reset, clean, commit, push, branch change, fetch or worktree edit was
issued against the clone; only the tool's permitted `prepare_history` ref refresh ran.

## Verification run

- Manifest command exit 0 and printed the hash and counts above.
- `python3` over the frozen manifest reproduced every tier, exclusion, censored and
  eligibility figure in this report.
- `git check-ignore -v` matches; `git ls-files tools/shadow-review-trial/.trial-data`
  is empty.
- Yakka worktree `git status --short` shows only this report; `git diff --check` is
  clean.

## Concerns and contradictions

1. **Other plans' plan documents reach captures.** 54 of 360 cases carry changed
   files under `docs/plans/` belonging to a *different* plan: 1031 changed plan
   files in total, of which 52 cases carry 290 sensitive plan documents
   (`DESIGN.md` 151, `IMPLEMENTATION.md` 100, `REVIEW.md` 38, `QA.md` 1). Files under
   the case's own plan folder: 0. `strip_plan_documents` is called with the case's
   plan prefix only (`manifest.py:125, 359-368`), so own-plan DESIGN/review text is
   removed but other plans' review text is not. This is literal compliance with
   "exclude the whole `docs/plans/<plan>/` folder" for the case's plan, but it puts
   other plans' `REVIEW.md`/`IMPLEMENTATION.md` text in packets and may trip the
   report-stage leak check. Not fixed here (no code change in this unit); unit 6
   should verify intent.
2. **CLI `eligible` label.** `cli.py:157` prints `eligible` as `len(frozen["cases"])`
   (360), while the manifest's per-tier `eligible` sums to 534 and `shortfall` uses
   the frozen count. The shape is right; only the printed label is misleading.
3. **Clone status expectation.** The brief expects an empty `status --short`; the
   clone was already dirty with the three entries above before this phase. The
   dispatch note said to record it unchanged, which is what happened. Recorded
   rather than resolved silently.
