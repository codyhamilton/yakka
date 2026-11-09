# Brief: phase1-04 — Ephemeral usage and dry-run readiness

Consumer: a Go worker in `packages/yakka` who knows `internal/review`, `internal/store` and `internal/ingest` fact handling.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/review/orchestrator.go`, `packages/yakka/internal/review/orchestrator_test.go`, `packages/yakka/internal/review/availability.go`, `packages/yakka/internal/store/review_usage.go` (new), `packages/yakka/internal/store/review_usage_test.go` (new), `packages/yakka/internal/ingest/ingest.go` (only the new `review_usage` branch and its validation), `packages/yakka/internal/ingest/ingest_test.go`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-04-ephemeral-usage-dry-run.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-01 and phase1-03. Read both reports and the code they left before editing.
Runs alongside: phase1-06 (MCP `list_reviews`; it owns new serve files and `cmd/yakka/main.go`, not these files).
Budget: read 9 files, about 260 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — the `store=false` paragraph (109); decisions 13 and 14 (lines 187–188).
2. `docs/plans/23-llm-review-shadow/briefs/phase1-01-call-controls-identity.md` and report — the `store=false` branch added there.
3. `packages/yakka/internal/review/orchestrator.go` — the current `dry_run` returns (179–194), the reservation/attempt path (224–312), `persistRecord` (517–585).
4. `packages/yakka/internal/review/availability.go` — `Reservations.begin`/`reserveRetry`/`settle`/`finish` and the durable claim map (61–243).
5. `packages/yakka/internal/ingest/ingest.go` — `IngestReviewRuns` and `ingestBatch`, especially the `review_run` special case (195–305).
6. `packages/yakka/internal/store/reviews.go` — `AppendReviewRuns` and the raw-fact conventions.
7. `packages/yakka/internal/store/usage.go` and `packages/yakka/internal/store/analytics.go` — show that normal aggregates read `facts`, not `review_runs`.
8. `packages/yakka/internal/ingest/ingest_test.go` lines 135–190 — the assertion that review rows leave `Summary`/`Facets` unchanged.

## Goal

Complete the unpersisted path: `store=false` leaves only a content-free, tenant-local review-usage fact and safety reservations, and `dry_run` validates readiness and writes/calls nothing for both store values.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "For `store=false`, keep only a **content-free `review_usage` fact in the caller's tenant**, outside `review_run` and quality/conversation/hook/facet aggregates: random usage id, configured/returned model, configured/requested/effective effort, tokens, estimated cost/pricing identity, timestamp, validated tags, `store=false`, attempt/status and unresolved-reservation accounting. No repo/plan/session/capture identity, prompt, criteria, findings, error bodies or content-derived hashes. It enters an explicitly named tenant review-spend measure, never work_cost or quality counts. Synthetic callers use the synthetic key even for these facts."
- "Spend reservations/in-flight limits still apply under fresh non-cache identifiers, attributed to the tenant, with conservative charge for unknown outcomes."
- "`dry_run` writes none of these facts or reservations and makes zero provider calls; it wins over store/detail and validates configuration, allowlist, effort and disclosure readiness first."
- Decision 13: "Spend visibility without retaining synthetic review content or inventing another synthetic counter." Decision 14: "No cache/claim lookup/write at all; fresh reservation identifier, full reply, bounded provider retries inside the call only; no automatic replay of ambiguous transport calls."

## Changes

- Add a tenant-local `review_usage` store surface in a new `internal/store/review_usage.go`: write one content-free fact per `store=false` call (success, provider error or timeout) and a test-facing read. Keep it outside `review_runs`, `review-inputs`, `facts` analytics measures, conversation/hook/facet aggregates and review quality counts. A separate table or a separate fact namespace is acceptable if the aggregates cannot see it; state which and why in the report.
- Persist exactly: random usage id, `configured_model`, `returned_model` when known, `configured_effort`, `requested_effort`, `effective_effort`, input/output tokens when known, estimated `cost_usd` plus `pricing_table_id`, timestamp, canonical validated `tags`, `store=false`, final attempt/status, and the reservation outcome (settled amount or conservative unknown charge). Do not persist repo, plan, session, capture id, input hash, prompt, criteria, findings, error body or any content-derived hash.
- Route it through the review/ingest path in the same style as `review_run` only if that keeps it out of the existing aggregates; otherwise keep the write in `internal/store` and call it from `Run`. Do not make `ingest.Ingest` accept it as an ordinary fact that feeds `facts`.
- Reservation behavior: `store=false` must not create a durable dedupe claim. Reserve spend/in-flight under a fresh unique non-cache identifier, settle actual cost on success, and keep the conservative reservation on timeout/unknown. Never reuse an execution key for this.
- `dry_run`: move readiness validation ahead of the early return so it validates configuration, repository allowlist, `effort`, `tags`/`store` argument validity and disclosure readiness. It must make zero provider calls and write no `review_usage`, no review row, no review input and no reservation/claim, for both `store=true` and `store=false`. `dry_run` still wins over `store`/`detail` and returns the existing `status=dry_run` estimate shape.
- Keep `store=true` unchanged except for any shared validation ordering.
- Add an explicitly named tenant review-spend read (used by tests and later phases) if needed to prove isolation; do not add an analytics HTTP endpoint or a conversation/work-cost measure.

### Keep untouched

The phase1-01 argument/identity behavior, phase1-03 duplicate lookup and cached response, page reads and cursor code (phase1-02/05), REST/MCP route code, stable docs, plugin files, and the existing `facts`/usage/quality measures.

## Done evidence

- `cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/ingest -run 'Review|Usage|DryRun|StoreFalse'` → passes. (Fall back to `GOMEMLIMIT=8GiB GOMAXPROCS=3`.)
- New test: a successful `store=false` call writes one content-free usage fact and zero `review_runs` rows, zero `review-inputs` objects, zero findings; the fact has no repo/plan/session/capture/prompt/criteria/findings/error/hash field (assert the exact key set or the absence of each forbidden key).
- New test: `store=false` provider error and timeout each write one status-carrying usage fact and keep the conservative reservation; neither writes a review row nor creates a durable claim.
- New test: `store=false` with `detail` omitted returns the full result, and `store=false` never reads a stored cache (an identical stored invocation still calls the provider).
- New test: for both `store=true` and `store=false`, `dry_run` makes zero provider calls and leaves usage rows, review rows, review-input objects and reservation/claim counts unchanged; a bad allowlist/effort/tag/disclosure input refuses during dry-run without effects.
- New test: after `store=false`, the existing `Summary`, `Facets` and conversation/hook aggregates are byte-identical to before.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
