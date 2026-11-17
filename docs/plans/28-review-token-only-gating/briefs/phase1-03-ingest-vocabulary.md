# Brief: phase1-03 — Ingest status vocabulary and nullable cost

Consumer: a build worker on `packages/yakka/internal/ingest`, dispatched by Plan 28 `execute`.
Owned paths: `packages/yakka/internal/ingest/ingest.go`, `packages/yakka/internal/ingest/ingest_test.go`; report `docs/plans/28-review-token-only-gating/reports/phase1-03-ingest-vocabulary.md`. Touch nothing else.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: unit 1 (`phase1-01-review-core`) and unit 5 (`phase1-05-stable-docs`), both with disjoint paths.
Budget: 2 files to read, about 60 lines to change including tests, 20 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Review availability and call contract, the No spend gating bullet (line 36), the Actual cost bullet (line 38), Architectural Implications `Status vocabulary gains skipped_busy` (line 77), and Phase 1 Surfaces (line 222). Binding.
2. `packages/yakka/internal/ingest/ingest.go` — `validate` (129-224), especially the `review_run` and `review_usage` cases; and `ingestBatch`'s review branches (244-374).
3. `packages/yakka/internal/ingest/ingest_test.go` — the review_run acceptance/validation test and `usageFact`/`TestReviewUsageAcceptanceValidationAndIsolation` (around lines 120-238).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Teach review ingest the Phase 1 status vocabulary and the explicit unknown-cost encoding, while continuing to accept historical rows that carry the retired reservation fields.

## Contract

- DESIGN line 36: "The `skipped_budget` status is never emitted again but remains valid when reading or ingesting historical rows." Line 77: "Status vocabulary gains `skipped_busy`; `ingest` and `report.py` must accept it, and `skipped_budget` stays readable." (`report.py` is Phase 2; this unit is only ingest.)
- DESIGN line 38: "A failed attempt with no reported usage records `cost_usd: null` with `cost_known: false` (ingest accepts null only with that flag; sums ignore it...), never a worst-case estimate; `reservation_outcome` and `reservation_usd` are no longer written and remain accepted when ingesting older rows."
- DESIGN line 39 (persistence compatibility) does not change the fact schema.

Settled decisions:

- `skipped_busy` is added to the accepted `review_run` status list. `review_usage` statuses stay as they are (`skipped_busy` never reaches the provider, so no usage row exists).
- `cost_usd` may be a JSON number or JSON null. A null requires `cost_known` to be the boolean `false`. A non-number, non-null value is invalid. A `cost_known` that is present and not a boolean is invalid. When `cost_usd` is numeric, `cost_known` may be absent or any boolean (older rows have no flag).
- `reservation_outcome` and `reservation_usd` stay accepted and unvalidated; they are not added to the forbidden-key lists.

## Changes

- `validate`, `review_run` case: add `skipped_busy` to the accepted statuses; keep `skipped_budget` and `skipped_duplicate`.
- `validate`, both `review_run` and `review_usage` cases: add the cost rule above. Keep key order and error wording style (`invalid: ...`). Do not require `cost_usd` or `cost_known` to be present.
- `ingestBatch`: no structural change expected; the raw row still carries `cost_known` and a null `cost_usd` unchanged. Only change it if the decoded `map[string]any` handling needs the null to survive canonicalisation.
- Tests in `ingest_test.go`:
  - `review_run` with `status:"skipped_busy"` is accepted; `skipped_budget` is still accepted.
  - `review_run` with `"cost_usd": nil, "cost_known": false` is accepted; `cost_usd: nil` without the flag is rejected; `"cost_known":"no"` is rejected.
  - `review_usage` with `"cost_usd": nil, "cost_known": false` is accepted; null without the flag is rejected.
  - An older `review_usage` row carrying `reservation_outcome` and `reservation_usd` still ingests (the existing `usageFact` already has them; keep that coverage).
  - A numeric `cost_usd` with no `cost_known` still ingests.

### Keep untouched

- All other fact types, precheck, secret scanning, canonicalisation, row hashing and archive behaviour.
- `review_run` is server-authored; `review_usage` is server-authored — keep both rejections on the public `Ingest` path.
- Existing forbidden-key lists and content-free usage guarantees.
- Do not edit `store/review_usage.go`; `ReviewSpend`'s SQL sum already ignores nulls.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd packages/yakka && go test ./internal/ingest -count=1` → all pass.
- `cd packages/yakka && go test ./internal/ingest -run 'TestReview|TestUsage' -count=1 -v` → the review-run and review-usage tests pass, including the new cases.
- `cd packages/yakka && go vet ./internal/ingest` → no output.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
