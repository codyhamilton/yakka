# Brief: 4-02 — Review record persistence

Consumer: Plan 23 Phase 4 review orchestration and Phase 6 trial tooling.
Owned paths: `packages/yakka/internal/ingest/` (review fact acceptance only), new review-input and review-record persistence files under `packages/yakka/internal/store/`, their focused tests, and `docs/plans/23-llm-review-shadow/reports/4-02-review-record-persistence.md`. Do not modify `internal/store/pricing.go`, `pricing_table.json`, pricing tests, or HTTP routes. Touch nothing else.
Commits: Commit implementation and report when done evidence passes, with a plain-summary title.
Report: Before committing, write the report named above (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: 4-01 and 4-03; keep changes to persistence-owned files and tests only.
Budget: 12 files to read, about 900 lines to change, 35 tool turns. Past the budget, stop and report an actionable handoff.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain: Review run (status and idempotency), Domain: Review record and tracking, and Phase 4 Outcome.
2. `packages/yakka/internal/ingest/ingest.go` and its tests — fact validation, secret precheck, and append path.
3. `packages/yakka/internal/store/store.go` — tenant writer, atomic file helpers, and directory layout; `packages/yakka/internal/store/reads.go` — read patterns.
4. `packages/yakka/internal/serve/reads.go` — existing tenant-bound query patterns for consumer context; do not edit HTTP routes.

## Goal

Provide durable tenant-scoped persistence for one `review_run` fact per accepted review, plus the exact post-scan, post-exclusion captured input, without routing that input through the artifact blob/screening area.

## Contract

Binding design text:

> “One `review_run` fact per call that got past argument validation (including every non-`ok` status, so a missing review is visible and not silent), stored through the existing ingest function in-process, without depending on Plan 22’s unbuilt `record_action`; no separate record-write route.” (Domain: Review record and tracking)

> “The post-scan, post-exclusion captured input is stored content-addressed in a separate review-input area of the tenant directory, not in `blobs/`” and “The record holds hashes. The tool reply never returns captured content.” (Domain: Review record and tracking, Captured input retention)

The review fact and captured input are tenant-bound. Reuse the existing ingest flow and tenant store writer. Keep the fact's serialized fields compatible with the keys enumerated in Domain: Review record and tracking.

## Changes

- Extend ingest's accepted fact types and validation for `review_run`, preserving generic raw fields while enforcing required identity/status fields and existing secret prechecks.
- Add content-addressed review-input write/read support under a separate tenant directory area; verify hashes and atomicity, and keep it outside `blobs/`, `pending/`, and screening queues.
- Add the bounded store APIs the Phase 4 orchestrator needs to persist a fact and retrieve/filter review records for the HTTP read route. Return only the requested tenant's records and apply the design's filter set.
- Keep result payload and attempt details as one fact per call; do not add a separate record-write endpoint or Plan 22 dependency.

### Keep untouched

- Do not change artifact screening, blob retention, unrelated fact types, conversation/facet aggregation semantics, or pricing implementation.
- Do not add expiry or an operator deletion policy; the design leaves retention unchanged.

## Done evidence

- Fixtures prove accepted and rejected review facts, duplicate/idempotent storage behavior as required by the tenant store, content-addressed input round-trip and hash mismatch refusal, tenant isolation, and absence from the blob screening inventory.
- Seeded `review_run` facts do not alter conversation, hook-event, or facet counts.
- Existing ingest and store focused suites pass under an 8 GiB address-space cap and Go `-p=3`.
- `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, stored API shape for the dependent Phase 4 unit, deviations, contradictions, unfinished work, and known problems. No credentials, provider calls, deploys, Fly, Wrangler, or paid/live review steps.
