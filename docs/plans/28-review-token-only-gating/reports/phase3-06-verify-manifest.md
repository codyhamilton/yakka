# Phase 3 unit 6 — independent manifest verification

Status: done with concerns. All nine checks pass against
`tools/shadow-review-trial/.trial-data/manifest-28.json` (seed 28). No code, tests or
manifest changed; the throwaway checker stays under the gitignored `.trial-data/` and
is not committed. Interpretation notes and contradictions are recorded below.

## Checks

1. **PASS** — canonical hash: recomputed `manifest_sha256` equals the stored value
   `10f8d4d3e0c08a1e2a4883fc8f653f37cc61fefe54e8effe824f285f896d482f`.
2. **PASS** — size and history: `cases` 360 (`300 <= 360 <= 360`), `target` 360,
   `floor` 300, `shallow` false, `object_complete` true, `enumerated_commits` 3815 =
   `verified_count` 3815.
3. **PASS** — case shape (360/360): all carry a valid `tier`, non-empty `base_sha` and
   `head_sha`, a non-empty capture whose `base`/`resolved_head` equal the case shas,
   `criteria.source` `base_blob` with a hash resolving at `base_sha`, at least one
   outcome (total 10667, minimum 1 per case), a `later_fixes` list (total 466), and a
   boolean `censored` (100 true). 173 captures are truncated but non-empty.
4. **PASS** — accounting: per-tier `{candidates, eligible, frozen}` sums are 701, 534
   and 360; `no_tier` 3114; 701 + 3114 = 3815 candidates; exclusion counts sum to
   3281 = 3815 - 534, and the per-candidate reason tally matches the manifest for all
   3281 ineligible candidates (5 reasons); `shortfall_against_floor` 0. 142 uncensored
   cases have an empty `later_fixes` (recorded negatives, as designed).
5. **PASS** — uniqueness: 360 distinct `head_sha`, 0 duplicates in two cases; 0
   repeated `(base_sha, head_sha)` pairs, across all tiers.
6. **PASS** — 30-case sample (seeded from 28, labelled `case-01`..`case-30`; 17 phase,
   13 unit, 0 pr): 931 outcomes and 51 later fixes, 0 failures. Every outcome's
   path/blob/line range resolves at its cited commit and its text matches the cited
   lines; every fix sha exists, follows `head_sha`, falls within the window, and
   intersects at least one recorded path in that commit's diff; 0 censoring
   mismatches (10 censored, 20 uncensored).
7. **PASS** — base-criteria leak: 30/30 `criteria.content_hash` equal the blob at
   `base_sha`; 13 cases changed `DESIGN.md` between base and head, and all 13 carry
   the base hash, never the head blob.
8. **PASS** — local-only: `git ls-files` under `.trial-data/` is empty (0 files),
   `git check-ignore -v` matches `.gitignore:6`, `git log --all` over the directory is
   empty (0 commits), and 0 tracked artifacts match.
9. **PASS** — clone unchanged: `HEAD` `30e033973a68fabd64fc96c2d35b9febf5fbc9b9` and
   commit count 1897 match unit 5; `status --short` holds the same 3 pre-existing
   entries recorded before this phase (not empty; see contradiction 3).

## Interpretation notes and contradictions

1. **Check 4 wording vs manifest shape.** The brief says per-tier `candidates` sums
   equal "the totals", but the top-level `candidates` list includes 3114 `no_tier`
   commits that by definition belong to no tier; per-tier candidates can therefore
   only sum to 3815 - 3114 = 701. The checks that are meaningful and were verified are:
   per-tier eligible sums to the 534 eligible pool, per-tier frozen sums to 360 cases,
   tier candidates plus `no_tier` equals 3815, and exclusion reason counts match the
   per-candidate reasons. Recorded, not resolved silently.
2. **Check 6 excerpt matching.** Manifest excerpts collapse whitespace (newlines
   become spaces), so membership was checked after whitespace normalisation, the same
   rule the manifest resolver uses. No textual content differs; strict raw substring
   would fail only on whitespace. Likewise, "after `head_sha`" was verified by
   committer timestamp because later fixes are squash/cherry-picks, not descendants of
   `head_sha` (0 fixes satisfied strict ancestry while all 51 are temporally after and
   inside the window).
3. **Check 9 empty-status expectation.** The dispatch states the clone was already
   dirty with `M .cursor/settings.json`, `?? .cursor/mcp.json` and `?? pid`; those are
   the 3 entries observed after verification, unchanged from the unit 5 baseline. The
   check passes on the "unchanged" contract, not on literal emptiness.

No non-trivial bug was found outside these notes.
