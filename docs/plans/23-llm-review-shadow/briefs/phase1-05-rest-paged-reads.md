# Brief: phase1-05 — REST complete paged reads

Consumer: a Go worker in `packages/yakka` who knows `internal/serve` HTTP routes and the review store page API.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/serve.go` (only `reviewsGetRoute` and its helpers plus the route registration if needed), `packages/yakka/internal/serve/review_cursor.go` (new), `packages/yakka/internal/serve/reviews_test.go`, `packages/yakka/internal/serve/review_cursor_test.go` (new). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-05-rest-paged-reads.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-01 (serve config/route touch) and phase1-02 (store page API). Read both reports and the code they left.
Runs alongside: phase1-03 (duplicate responses; it owns `internal/review` and the store key lookup, not these files).
Budget: read 8 files, about 260 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain "complete tenant-bound reads" lines 111–119; decisions 1, 5, 6, 7 (lines 178–182).
2. `docs/plans/23-llm-review-shadow/briefs/phase1-02-paged-review-store-reads.md` and its report — the exact page API, high-water and `hasMore` behavior.
3. `packages/yakka/internal/serve/serve.go` — `reviewsRoute` and `reviewsGetRoute` (729–869), auth/scope checks (800–813), existing filter parsing (814–846).
4. `packages/yakka/internal/store/reviews.go` — the page API and filter type.
5. `packages/yakka/internal/serve/reviews_test.go` — `do` helper, `TestReviewRESTRoutesAuthTenantAndReceipt` (27–69) and the GET shape assertion.

## Goal

Turn `GET /v1/reviews` into a complete, cursor-paged, tenant-bound read whose first page fixes a high-water mark, with conjunctive tag filters and explicit completion metadata, without silently skipping rows.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Both entries accept the existing repo_id/plan/phase/kind/status/effort/profile/manifest_hash/since filters, `detail=full`, `limit` and `cursor`; add exact tag filtering: repeated REST `tag=value`, MCP `tags:[value,...]`, with the same 16 × 96 bounds. Multiple tags mean **ALL**, conjunctive with all other fields. An empty filter matches all tenant reviews, including old untagged records; a tag filter never matches an untagged record. Invalid filters return an explicit argument error. Preserve the existing REST `reviews` array and add `next_cursor` (opaque string or null) and `complete` (boolean); MCP returns the same data object. Limit is page size (default 100, range 1–500), never a complete-read ceiling. Other analytics endpoints retain their limits."
- "The first page fixes an insertion high-water mark in the tenant review store; subsequent pages use stable descending `(ts, insertion_id)` ordering with a strict last-key boundary, never offsets. Bind cursor version, authenticated tenant, route, canonical filters, detail and high-water mark. A cursor cannot select or authorize another tenant. Malformed, mismatched or unsupported cursors fail explicitly (REST 400 / MCP invalid arguments); after reset they cannot revive a tenant. Page size may change without changing selection."
- "Every nonterminal page has `complete=false` and a progressing cursor; the exhausted page has `complete=true,next_cursor=null`, including exact-multiple and empty populations. A decode/query/corrupt-row error fails the page; do not silently skip malformed stored review rows. No source row can be silently omitted."

Reset itself is Phase 2; here "a cursor cannot select or authorize another tenant" is proved by tenant identity binding, and reset-revival is proved in Phase 2.

## Changes

- Parse `tag` as a repeated query value (use `q["tag"]`), validate 1–96 ASCII bytes and the DESIGN regex, deduplicate, and treat multiple tags as ALL. Invalid `tag` → 400.
- Parse `cursor` as an opaque string; `limit` default 100, range 1–500; `detail` remains `""` or `full`.
- Build a cursor in the new `review_cursor.go`: encode version, authenticated tenant, route constant (`GET /v1/reviews`), canonical filters (including sorted tags and `detail`), high-water and last `(ts, insertion_id)`. Base64url an opaque payload; include a checksum over the bound material so a mutated/inconsistent cursor is detectably mismatched. Do not bind `limit` (page size may change).
- First page: call the store's `BeginReviewWalk`, query one page, return `next_cursor` from the last row when `hasMore`, else `null`, and `complete = !hasMore`.
- Later pages: decode and validate every bound field (version, tenant, route, filters, detail). A missing/malformed/mutated/unsupported cursor or any mismatch with the request (including tenant) → 400. A cursor from another tenant must never select this tenant's rows. Pass through the fixed high-water and after-key. Ignoring or overriding a bound filter is a 400, not a silent re-selection.
- Keep the existing auth and read/read_write scope behavior. Keep the existing `reviews` array shape; when `detail != full`, strip `payload` as today; when `detail=full`, include it.
- Do not silently skip a row: if any row cannot be decoded or the store returns a corrupt-row error, fail the page (500 for a stored row that cannot be decoded, 400 for a bad request/cursor). Do not `continue`.
- Use the store `hasMore` signal, not `len(rows) < limit`, so exact multiples and empty populations terminate correctly.

### Keep untouched

`POST /v1/reviews`, the store implementation (phase1-02 owns it), the MCP tool code (phase1-06), analytics endpoints and their limits, review orchestration, stable docs, and plugin files.

## Done evidence

- `cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'Review'` → passes. (Fall back to `GOMEMLIMIT=8GiB GOMAXPROCS=3`.)
- New test in two tenants: tenant A has >1,000 review rows with identical `ts`, plus a backdated-`ts` row appended after the first page. A REST walk with `limit` changing per page returns every row exactly once in `(ts,insertion_id)` order, excludes the appended row, and ends with `complete=true,next_cursor=null`.
- New test: two page sizes against the same cursor selection return the same rows; changing `limit` does not change selection.
- New test: repeated `tag=a&tag=b` returns only rows carrying both; an untagged row appears with no tag filter and never with a tag filter; invalid tag → 400.
- New test: malformed cursor, cursor from tenant B used on tenant A, cursor with a changed filter, and unsupported version each → 400 with no rows leaked.
- New test: exact-multiple population and empty population both end `complete=true,next_cursor=null`; a partial page ends `complete=false` with a non-null cursor.
- New test: a stored row with corrupt raw makes the page fail (500), not skip the row.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
