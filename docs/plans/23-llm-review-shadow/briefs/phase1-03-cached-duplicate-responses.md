# Brief: phase1-03 — Cached duplicate responses

Consumer: a Go worker in `packages/yakka` who knows `internal/review`, the reservation state and the review store.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/review/orchestrator.go`, `packages/yakka/internal/review/orchestrator_test.go`, `packages/yakka/internal/review/availability.go`, `packages/yakka/internal/store/reviews.go`, `packages/yakka/internal/store/reviews_test.go`, `packages/yakka/internal/serve/reviews_test.go`, `packages/yakka/internal/serve/mcp_review_test.go`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-03-cached-duplicate-responses.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-01 (call controls and execution identity) and phase1-02 (paged store reads). Read both reports and the code they left before editing.
Runs alongside: phase1-05 (REST paged reads; it owns the GET route and cursor code, not these files).
Budget: read 10 files, about 300 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — the duplicate paragraph (103), the claim-state paragraph (105), the zero-call/audit paragraph (107); decisions 3, 5, 8, 9 (lines 177–183).
2. `docs/plans/23-llm-review-shadow/briefs/phase1-01-call-controls-identity.md` and its report — the new `effort`/`tags`/`store` fields, the preserved pre-upgrade key and the legacy-key helper.
3. `packages/yakka/internal/review/orchestrator.go` — `Run` claim path (214–240, 309–312), `persistedClaim` (465–481), `persistRecord` (517–585), `Receipt` (73–85).
4. `packages/yakka/internal/review/availability.go` — `Reservations` fields and `begin`/`finish`/`duplicateReview` (61–254).
5. `packages/yakka/internal/store/reviews.go` — the page API from phase1-02 and the table DDL.
6. `packages/yakka/internal/serve/mcp_review_test.go` — `TestReviewMCPAndRESTShareOrchestrationAndReceipt` (79–148), the current reference-only parity assertion (130–142).
7. `packages/yakka/internal/serve/reviews_test.go` — the POST/GET receipt test (27–69).

## Goal

Make a repeated stored request return the original review in full, without a second provider call, a 500-record scan, or a follow-up GET, and make pending/unknown/missing cache outcomes explicit.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "For `store=true`, lookup the original review by tenant and execution key directly, without a 500-row scan."
- "A cache hit returns the **full cached review in the fresh response shape**, even when `detail` is omitted/receipt: `status=skipped_duplicate`, `cached=true`, `original_review_id`, and `original_status`, with original result, coverage, finding counts, model/effort, tags, attempts and usage/cost evidence. `reason` remains the original id for old clients. Original payload/status are never misrepresented as a new successful review; no new provider cost is incurred. Fresh default receipts retain their existing size; `detail=full` gives their full review. `store=false` always gives full review regardless of detail. Captured content is never returned."
- "A claim whose original request is still running or whose provider outcome is unknown cannot invent a cached review. Return `in_progress` or `outcome_unknown` with original id and `cached=false`, no result, no second provider call; reserve `skipped_duplicate` for a completed stored original, including stored terminal errors whose result may be absent. Missing/corrupt originals fail explicitly (`cache_unavailable`), never become an empty successful cache hit. Completed duplicate responses have REST/MCP parity in every payload field."
- "Zero-call refusals do not consume execution claims. Stored duplicate audit rows may remain for compatibility, but are marked as references with no new attempts or charge; reports count the canonical original once. A returned original's historical cost is evidence, never incremental duplicate spend. Changing effort creates independent identity. Concurrent equal stored calls and restarts preserve the original claim."
- Legacy fallback: "Legacy-key fallback is allowed only for a legacy-adapter request whose canonical merged tag set equals exactly the three deterministic adapter tags (no extra caller tag), with matching stored legacy manifest/case/effort and every other old identity field. A request with any additional tag uses only the new tag-sensitive key and must not fall back to a legacy key. New requests without the legacy object never use this fallback."

## Changes

- Add a direct store lookup by execution key, for example `ReviewByExecutionKey(ctx, repo, key) (ReviewRecord, bool, error)`, matching `repo_id` and `json_extract(raw,'$.key')`. Add a supporting expression index on `json_extract(raw,'$.key')` in `AppendReviewRuns` so the lookup is not a table scan, and create it for existing tables. Do not change the stored raw shape.
- Replace `persistedClaim`'s `ReviewRecords{..., Limit: 500}` scan with this direct lookup. Keep the `len(Attempts) > 0`-style completion rule where it correctly means "completed with a provider attempt", and treat stored terminal non-duplicate errors and refusals that are complete originals as completed. Ignore rows whose own status is `skipped_duplicate` (audit rows) when resolving the canonical original, or follow their canonical id once; never let an audit row satisfy the lookup.
- Classify a hit:
  - completed stored original → `status=skipped_duplicate`, `cached=true`, `original_review_id`, `original_status`, and the full original payload/coverage/finding counts/model/effort/tags/attempts/usage-cost. `reason` = original id for old clients.
  - durable claim with an active in-process call → `status=in_progress`, `cached=false`, original id, no result, no provider call.
  - durable claim with no active call (for example after restart) → `status=outcome_unknown`, `cached=false`, original id, no result, no provider call.
  - stored original exists but its raw is unparseable or its payload is missing where required → `status=cache_unavailable` (or a 4xx if you find the codebase's convention is an error; record the choice), never an empty success.
- Extend `Receipt` with the fields named above (`Cached`, `OriginalReviewID`, `OriginalStatus`, plus model/effort/tags/attempts if not already present) and build it from the stored raw. Keep the optimistic path's fresh receipt behavior: default non-duplicate receipts stay the small shape, `detail=full` adds the full review.
- Legacy fallback: when the request is a pure legacy-adapter request (canonical merged tags exactly `effort:<level>`, `manifest:<hash>`, `case:<sha256-of-case-id>` with no extra caller tag), also compute the pre-upgrade key via the phase1-01 helper and try it when the new tag-sensitive key misses. Require the stored legacy manifest/case/effort and every other old identity field to match. If the caller added any tag, do not try the legacy key. Never use the fallback for a request without `trial`.
- Duplicate persistence: keep the compatibility audit row if it exists today, but ensure it has no attempts, no charge, and points at the canonical original; reports must count the canonical original once. Do not call the provider and do not settle new cost.
- Concurrency/restart: two equal stored calls must make one provider call; after a restart the durable claim or stored original must still resolve. Do not replay ambiguous transport calls.

### Keep untouched

Argument parsing/validation from phase1-01, the store page API from phase1-02, the REST/MCP read routes, criteria/packet/prompt/provider policy, and the store's review-input objects. Do not edit files owned by phase1-04/05/06 or stable docs.

## Done evidence

- `cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/serve -run 'Review|Duplicate|Cache|Trial|Effort'` → passes. (Fall back to `GOMEMLIMIT=8GiB GOMAXPROCS=3`.)
- New test: a duplicate with `detail` omitted returns `result` with findings, `cached=true`, `original_review_id`, `original_status`, and original model/effort/tags/attempts/cost; the fake provider is called exactly once.
- New test: REST and MCP duplicate responses are byte-equivalent in every payload field (compare decoded JSON, not just `reason`).
- New test: a completed original stored beyond the newest 500 rows is found after opening a fresh tenant/server (restart) with no 500-row dependency.
- New test: an active claim returns `in_progress` with `cached=false` and no provider call; a durable claim with no active call returns `outcome_unknown`; an unparseable original returns `cache_unavailable`; none fabricates a result.
- New test: a pure legacy-adapter request finds the old untagged stored key; adding any caller tag skips the legacy key and creates independent evidence; conflicting effort already refuses (phase1-01).
- New test: duplicate audit rows add no attempts/charge and the canonical original is counted once.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
