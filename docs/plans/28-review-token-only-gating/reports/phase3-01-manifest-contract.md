# Manifest contract, history profile and candidate accounting

Status: done with concerns.

## What changed

- New `history_profile.py`: `garcia-music-workflow` (first) and `generic-workflow` profiles carrying plan/phase trailers, PR markers, folder and collapsed plan-record paths, `DESIGN.md`/`REVIEW.md`/`IMPLEMENTATION.md`/`reports/` locations, close markers and the 60-day later-fix window. `default_extract(repo, profile, *, now)` is the documented seam. It preserves the old trailer-derived phase/PR/unclassified classification, returns empty outcomes/later fixes, and never reads the wall clock.
- New `synthetic_history.py`: deterministic fixture builder (fixed identities and timestamps) writing a plan folder, phase trailers, unit handoff reports, a squash-PR marker and later commits; optional bare remote.
- `manifest.py`: criteria now come from `DESIGN.md` at `base_sha` only (`source: base_blob`); absent at base is `criteria_unavailable`. History enumerates `HEAD` plus every `refs/remotes/<remote>` ref, deduped, and verifies non-shallow/object-complete across that set, recording `enumerated_refs` and `ref_commit_counts`. The case dimension is `tier` (`phase`/`unit`/`pr`), with unclassified commits kept as `no_tier` candidates. The frozen manifest records `target` (360), `floor` (300), per-tier `{candidates,eligible,frozen}`, per-reason `exclusions`, `excluded_total`, `censored`, `shortfall_against_floor`, `window_reference`, and a seeded phase→unit→PR selection capped at target, never padded and never duplicating a commit.
- `cli.py`: `--history-profile` (default `garcia-music-workflow`), `--target` 360, `--floor` 300; prints target, floor, per-tier counts and exclusions.
- `.gitignore`: `tools/shadow-review-trial/.trial-data/`.
- Capture client answer: `CaptureError` is at `plugins/yakka/client/yakka.py:570` and `CaptureChange` at `plugins/yakka/client/yakka.py:928`. Plan 27 is design-only on `design/27-yakka-client-consolidation`; `manifest.py` keeps the current `sys.path` + `import yakka` with a comment naming the future `plugins/yakka/scripts/libs/` move.

## Red (before implementation)

`python3 -m unittest tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_history_profile.py -v`

```
TypeError: create_manifest() got an unexpected keyword argument 'floor'
TypeError: create_manifest() got an unexpected keyword argument 'extractor'
ModuleNotFoundError: No module named 'history_profile'
AssertionError: side commit not found in candidates
Ran 16 tests ... FAILED (failures=1, errors=6)
```

The other errors were the old `stratum`/`head_blob`/`shortages` shape and the missing tier fields.

## Green (after implementation)

```
$ python3 -m unittest tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_history_profile.py -v
Ran 19 tests ... OK

$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 65 tests ... OK

$ git check-ignore -v tools/shadow-review-trial/.trial-data/example.json
.gitignore:6:tools/shadow-review-trial/.trial-data/  tools/shadow-review-trial/.trial-data/example.json

$ git diff --check
(clean, exit 0)
```

Evidence fixtures cover: base-blob content hash equals `git rev-parse <base_sha>:docs/plans/demo/DESIGN.md` while head amends `DESIGN.md`; three tiers with overlapping refs and no repeated case; per-tier `frozen` summing to `cases`; `excluded_total + sum(tier.eligible) == candidates`; a positive `shortfall_against_floor` below 300 with no invented case; and remote-ref enumeration beyond the tip.

## Deviations and contradictions

- **Contradiction (resolved loudly).** The brief requires `criteria.source == "base_blob"` and also a green full suite without editing `runner.py`; `runner.py:130` only accepted `head_blob|explicit_text|pinned`. There is no way to satisfy both. I added `base_blob` to that whitelist (one-line change, no other runner behaviour). This touches a path the brief said not to edit; every other forbidden file is untouched.
- `report.py` and `runner.py` still require `stratum` and `target_per_effort`. To keep the full suite green without editing them, candidates carry `stratum` as a compatibility alias (`tier` or `unaccompanied`) and the manifest keeps `target_per_effort` as an alias of `target`. `tier`, `target` and `floor` remain the contract fields; unit 4 can drop the aliases when it updates those modules.
- The brief's temporary default preserves the old classification semantics but not the old `stratum` key alone; `tier` is the primary field.
- Tests now create temporary directories under repo-local `.scratch/`; none use `/tmp`.

## Bug outside this unit's evidence (not fixed)

- Symptom: the manifest's `docs/plans/<plan>/` capture exclusion does not exclude plan documents, so an amended `DESIGN.md` at head can appear in the captured diff.
- Location: `plugins/yakka/client/yakka.py` around lines 836-838 in `_capture_change_once`.
- Root cause: paths beginning `docs/` are hard-coded `excluded = False` before the policy globs run, so every `exclude` entry for a docs path is inert (the `docs_never_noise` design). Criteria leak avoidance itself is safe (`_criteria` reads only the base blob), but packet-level exclusion of the plan folder needs a client change or a manifest-side filter.
