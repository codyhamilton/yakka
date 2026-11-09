# Brief: 7-02 — Alignment report and adjudication inputs

Consumer: Plan 23 Phase 7 CLI and the later human adjudicator reviewing the historical trial.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/test_report.py`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/7-02-alignment-report.md` and include it in the commit.
Depends on: Phase 6 manifest; Phase 4 `GET /v1/reviews` record shape.
Runs alongside: 7-01, which owns the runner and dry-run paths.
Budget: 12 files to read, about 700 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Phase 7 outcome; Domain: Historical trial and alignment report; Assumptions 20–22.
2. `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` — Phase 6 manifest evidence and carried items.
3. `tools/shadow-review-trial/manifest.py`, `README.md`, and `test_manifest.py` — frozen comparator and candidate schemas.
4. `packages/yakka/internal/review/orchestrator.go` and `packages/yakka/internal/serve/serve.go` — stored review fields, `payload`, attempts, cost/token/latency fields, and full-detail REST response.
5. `packages/yakka/internal/store/reviews.go` — manifest/profile/effort filters and record retrieval semantics.

## Goal

Produce the fixed Phase 7 alignment report from the frozen manifest, review records obtained through `GET /v1/reviews`, comparator evidence, and supplied human adjudications. Keep every denominator and model/effort/stratum comparison visible.

## Contract

Binding: `DESIGN.md`, Phase 7 outcome and Domain: Historical trial and alignment report. The fixed rubric is: historical findings `matched`, `partial`, or `unmatched` (with context-limitation tags); new findings `matched`, `partial`, `disputed`, `new-valid`, or `unadjudicated`. Adjudication covers every new finding at medium or higher and a seeded fixed-rate sample of low findings. State denominators for attempted, eligible, each status, historical findings, new findings, and adjudicated. Include cost, tokens and latency against the cap; outcomes by build model, reviewer model, and effective effort, with `unknown` a separate build-model row. Compare high/xhigh/max on both common completed cases and each arm's available cases.

## Changes

- Implement report calculation and its input validation in `report.py`; do not edit the CLI. Accept frozen manifest content, full review records (the caller obtains them from `GET /v1/reviews` with `detail=full`, `profile=historical_trial`, and the manifest hash), the separate Phase 6 curated/PR comparator evidence, and a manual adjudication file.
- Preserve comparator strata: phase and PR comparators remain separately linked. Do not infer historical truth from comparator presence or merge the two sources.
- Validate adjudications against finding identity and the fixed category vocabulary. Missing required adjudications remain `unadjudicated`; do not infer a human decision. Record context-limitation tags where supplied and retain the underlying evidence references.
- Exclude failed, duplicate, wrong-manifest/case/effort, and mismatched-model records from completed-valid counts, while reporting their status/attempt accounting. Use only valid `ok`/`ok_partial` records with the required reviewer id. Preserve partial coverage as its own visible limitation.
- Produce explicit denominators, eligible/completed counts and shortfalls per arm, the paired intersection, available-case comparisons, findings by rubric category, latency distributions, tokens/cost totals and cap comparison. Stratify outcomes by build model (including `unknown`), returned reviewer model and effective effort; do not make causal claims from build-model correlations.
- Keep output deterministic for identical inputs and clearly distinguish missing data from zero. No paid or live provider calls, credentials, deployment, Fly, or Wrangler actions; all tests are local fixtures.

### Keep untouched

Do not change `cli.py`, runner/manifest code, Go server/review code, `internal/review/build.go`, other plan folders, or Phase 6 artifacts. Do not implement an automatic/LLM adjudicator or expand the rubric.

## Done evidence

Identify or write the failing check before changing code and report its output before and after.

- `python3 -m unittest tools/shadow-review-trial/test_report.py` → fixtures cover all fixed historical/new categories, required denominators, attempt/status accounting, distinct phase and PR evidence, partial coverage and unknown model rows.
- A 50-case-per-effort fixture proves target attainment; 49 proves shortfall one per level; asymmetric failures prove per-arm counts and paired intersection. Duplicate and mismatched-model records never pad completion.
- A three-case fixture combines records, comparators and adjudications into deterministic output with token/cost/latency totals and distributions; missing required adjudication is reported as `unadjudicated`.
- Tests use fixture records only. `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, contradictions, and any unfinished work specific enough for Phase 7 integration. Never resolve a contradiction silently.

A non-trivial bug outside this brief's evidence: report symptom, location, and root cause. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
