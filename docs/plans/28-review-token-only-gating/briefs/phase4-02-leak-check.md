# Brief: phase4-02 — Request-level leak check

Consumer: a build worker adding the Plan 28 Phase 4 request leak check, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/leak_check.py`, `tools/shadow-review-trial/test_leak_check.py`; report `docs/plans/28-review-token-only-gating/reports/phase4-02-leak-check.md`. Touch nothing else.
Do not edit `report.py`, `cli.py`, `runner.py`, `manifest.py`, `README.md` or their tests — other Phase 4 units own them.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: `phase4-01-matching`, `phase4-03-evidence-check`, `phase4-04-manifest-population` (disjoint paths).
Budget: 6 files to read, about 300 lines to add including tests, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Criteria (line 54), Recorded review outcomes (55), Later fixes (56), Validation controls (62), Data handling (63). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 3 close and `Carried:` first and second bullets (65-100).
3. `tools/shadow-review-trial/runner.py` — `build_request` (113-160). The exact outbound request the runner posts; this unit must reconstruct it, not invent a second request shape.
4. `tools/shadow-review-trial/manifest.py` — `create_manifest` case shape (340-383) and `strip_plan_documents` (grep it). The frozen case carries `plan`, `base_sha`, `head_sha`, `capture` and `criteria`.
5. `tools/shadow-review-trial/history_extract_a.py` — `_outcome` (236-238) and the `review_finding` / `review_verdict` kinds (254-304).
6. `tools/shadow-review-trial/.trial-data/manifest-28.json` — read-only reconnaissance for shape only. It is gitignored; nothing from it may be committed, quoted or used as a test fixture.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Prove, from the frozen manifest plus the run id alone, that the requests the runner would send carry no plan-review text: no `REVIEW.md`/`IMPLEMENTATION.md` and no post-base `DESIGN.md` of the case's own plan reach the packet, and no recorded outcome excerpt appears in any request's capture diff or criteria text — failing the report when either does.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "a **leak check** (review packets contain no `REVIEW.md`/`IMPLEMENTATION.md`/post-base `DESIGN.md` content, and no outcome text appears in any request)".
- Criteria: "The manifest's trial-only capture policy also excludes the whole `docs/plans/<plan>/` folder from the diff (production policy unchanged), so amended DESIGN or review text cannot reach a packet."
- Later fixes and outcomes are "held only in the local manifest"; outcome `excerpt` is verbatim recorded review text.
- Data handling: "Diffs, outcome text, review text and case lists exist only in locally held, gitignored files."

Why reconstructing the request is equivalent to a packet leak check: the certified saved export rows hold `payload` findings, `attempts`, `criteria`, `manifest` packet metadata, status, tags and cost, but no capture diff, criteria text or request body. The only faithful source of what the packet contained is the frozen manifest plus the request the runner builds from it. `runner.build_request(manifest, case, effort, False, run_id)` is that builder; calling it (or the same field selection) is therefore the packet.

### Scope decision (settled; do not silently widen or silently fail the real manifest)

Phase 3 recorded that 54 frozen captures contain changed files under **another** plan's `docs/plans/` folder; the case's own plan folder is fully stripped by `strip_plan_documents`. Widening `strip_plan_documents` would change Phase 3's frozen-shape code and force a re-freeze outside Phase 4's surfaces. Therefore:

- Fail the check when the request contains any path under the **case's own** plan folder that is `REVIEW.md`, `IMPLEMENTATION.md` or `DESIGN.md`, or when any recorded outcome `excerpt` appears in the reconstructed capture `diff` or `criteria_text`.
- **Count, do not fail**, changed paths under a different plan's `docs/plans/` folder. Report the count as `foreign_plan_document_captures` with `scope: "case_plan_and_outcome_excerpts"`. This is the recorded reading; it must appear in the report's validation section and in the trial README (README is another unit's path; put the wording in your report so the orchestrator can forward it).

## Changes

Create `leak_check.py` with one public function and no I/O beyond reading the passed manifest object:

- `check_requests(manifest: dict, run_id: str) -> dict`
  - Iterate `manifest["cases"]` in `manifest["run_order"]` order and `EFFORTS = ("high", "xhigh", "max")`.
  - For each, call `runner.build_request(manifest, case, effort, False, run_id)`; catch `RunnerError` and record it as a request-build failure that fails the check (a manifest that cannot produce a request cannot be certified leak-free).
  - Inspect exactly `request["capture"]["diff"]` and `request["criteria_text"]`. Do not inspect or echo paths outside these two values.
  - `own_plan_document_hits`: count occurrences of the case's own plan prefix followed by `/REVIEW.md`, `/IMPLEMENTATION.md` or `/DESIGN.md` in the diff.
  - `outcome_text_hits`: for each outcome in `case["outcomes"]`, normalise the `excerpt` with `matching.normalise_text` (import it; do not duplicate it) and search the normalised diff and criteria text. An empty or whitespace-only excerpt is skipped. Count hits; do not return excerpt text.
  - `foreign_plan_document_captures`: count cases whose diff contains a `docs/plans/` path outside the case's own plan prefix. `plan` may be null; then no own-plan prefix exists and every `docs/plans/` path is foreign.
  - Return `{"pass": bool, "requests_checked": int, "request_errors": [case_id...], "own_plan_document_hits": int, "outcome_text_hits": int, "foreign_plan_document_captures": int, "scope": "case_plan_and_outcome_excerpts"}`. `pass` is true only when `request_errors`, `own_plan_document_hits` and `outcome_text_hits` are all zero.

Use field names exactly; `report.py` and `cli.py` consume them in later units. Return aggregate counts only; never return or log an excerpt, a diff line, a path or a SHA.

### Keep untouched

- `runner.build_request`, `runner.build_request`'s tag/field rules, and the frozen manifest. This unit calls them; it does not change them.
- `strip_plan_documents` and Phase 3's capture code. The scope decision above is the resolution, not a code change there.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_leak_check.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all passes (91 + this unit's tests; the full suite only if `phase4-01-matching` has landed, otherwise state which import it needs).
- Tests build a small synthetic manifest shaped like `create_manifest` output (tier/stratum, plan, base/head, capture with a small diff, criteria `base_blob`, outcomes with excerpts) inside a temp dir under the repo, never `/tmp`, and assert:
  - a clean manifest with no plan text and no outcome excerpt in the diff passes with zero hits;
  - injecting the case plan's `REVIEW.md` path or `IMPLEMENTATION.md` into the diff fails via `own_plan_document_hits`;
  - injecting one outcome excerpt into the diff fails via `outcome_text_hits`;
  - injecting an outcome excerpt into `criteria.text` fails;
  - another plan's `docs/plans/other/REVIEW.md` path increments `foreign_plan_document_captures` and still passes;
  - an ineligible/capture-less case yields a `request_errors` entry and fails.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's two files.
- No network, no provider call, no live server, no read of `.trial-data/`: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, any contradiction between this brief and the contracts it cites, and the exact leak-check scope wording the README unit should carry. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
