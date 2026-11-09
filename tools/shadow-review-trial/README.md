# Shadow review historical trial

Offline tools for freezing Phase 6 historical cases and separately linked comparator evidence. The manifest command uses local Git objects and the Phase 1 `CaptureChange` range API. It makes no network or provider calls and needs no credentials.

## Manifest

```bash
python3 tools/shadow-review-trial/cli.py manifest \
  --repo . --output tools/shadow-review-trial-data/manifest.json --seed 23
```

The command enumerates reachable commits, records every candidate and its eligibility reason, and records shallow history plus boundary SHAs. Each candidate capture uses its first parent as base and the commit as head. Criteria come from the plan `DESIGN.md` blob at that head and carry its Git blob id; candidates without historical criteria are retained as ineligible with `criteria_unavailable`. Build-model provenance remains explicitly `unknown` unless supplied as curated evidence. Phase comparator pointers use the phase `IMPLEMENTATION.md` and `REVIEW.md`; PR pointers use `REVIEW.md`. Comparator paths are excluded from the captured change. The output includes eligible phase, PR, and unaccompanied counts, separate `high`, `xhigh`, and `max` eligible and completed shortfalls, fixed shared-case settings, and a persisted deterministic run order.

The output path is create-only. If it already exists, the command refuses to refresh the frozen case set. Choose a new output path to create a new manifest after changing local history or evidence.

## Comparator evidence

`--comparators` accepts JSON with this shape:

```json
{
  "version": 1,
  "findings": [{
    "id": "phase-1-f1",
    "stratum": "phase",
    "head_sha": "<full commit SHA>",
    "text": "A curated historical finding",
    "citations": [{
      "path": "docs/plans/example/IMPLEMENTATION.md",
      "sha": "<same full commit SHA>",
      "blobhash": "<Git blob id>",
      "line_start": 12,
      "line_end": 13
    }]
  }],
  "build_models": {"<full commit SHA>": ["curated-model-id"]}
}
```

Every citation is checked against the cited commit's Git blob and line range, and must point into the candidate plan's phase or PR review source. The curated file's SHA-256 is bound into the manifest. A local PR review export can be supplied separately with `--pr-export`; it is keyed by a PR candidate `head_sha`, independently SHA-256 hashed, and kept distinct from curated phase and PR comparators.

## Layout contract

**Consumers**: Plan 23 Phase 7 trial runner and alignment report.

**Build**: Python 3 standard library, Git, and the Phase 1 `CaptureChange` API.

**Test**: `python3 -m unittest tools/shadow-review-trial/test_manifest.py`; no external services or credentials.

**Release**: Maintainer-only local tooling; freeze the manifest before any historical trial run.
