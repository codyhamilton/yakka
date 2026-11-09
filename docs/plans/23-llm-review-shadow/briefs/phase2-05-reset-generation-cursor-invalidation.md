# Brief: phase2-05 — Reset-generation cursor invalidation for REST and MCP review walks

Consumer: a Go worker in `packages/yakka` who knows `internal/serve` review cursor binding and both complete-read transports.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/review_cursor.go`, `packages/yakka/internal/serve/serve.go` (only `reviewsGetRoute` generation binding), `packages/yakka/internal/serve/mcp_list_reviews.go`, `packages/yakka/internal/serve/review_cursor_test.go`, `packages/yakka/internal/serve/mcp_list_reviews_test.go`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-05-reset-generation-cursor-invalidation.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-01 (registry lifecycle generation read) and phase2-04 (reset changes that generation). Read the phase2-01 and phase2-03 reports and the code they left.
Runs alongside: phase2-08 (analytics UI; disjoint files).
Budget: read 8 files, about 160 lines changed, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — complete tenant-bound reads (121–129), especially "A reset or store generation change invalidates the walk rather than silently dropping rows"; cleanup (160–164); Phase 2 outcome (270–275).
2. `packages/yakka/internal/serve/review_cursor.go` — constants, filter, payload, encode/decode/validate (whole file).
3. `packages/yakka/internal/serve/serve.go` — `reviewsGetRoute` cursor path (792–899).
4. `packages/yakka/internal/serve/mcp_list_reviews.go` — argument parsing and `mcpListReviews` walk (52–300).
5. `packages/yakka/internal/serve/review_cursor_test.go` — existing cursor/walk fixtures.
6. `packages/yakka/internal/serve/mcp_list_reviews_test.go` — existing MCP walk/parity tests.
7. `packages/yakka/internal/serve/registry_lifecycle.go` — the generation read method.
8. `packages/yakka/internal/serve/tenant_lifecycle.go` — how reset advances the generation.

## Goal

Bind each review-walk cursor to the tenant's current lifecycle generation so a cursor issued before a reset fails explicitly instead of silently reading a new store incarnation.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "The first page fixes an insertion high-water mark in the tenant review store; subsequent pages use stable descending `(ts, insertion_id)` ordering with a strict last-key boundary, never offsets. Bind cursor version, authenticated tenant, route, canonical filters, detail and high-water mark."
- "A reset or store generation change invalidates the walk rather than silently dropping rows."
- "Malformed, mismatched or unsupported cursors fail explicitly (REST 400 / MCP invalid arguments); after reset they cannot revive a tenant."
- "Every nonterminal page has `complete=false` and a progressing cursor; the exhausted page has `complete=true,next_cursor=null`." (unchanged by this unit)
- Phase 2 outcome: "Old keys/grants/cursors/queued work cannot resurrect deleted tenants or repopulate reset tenants; reset generation invalidates pre-reset walks."

## Changes

- Add the tenant lifecycle generation to the cursor payload (not to the user filter set): a page keeps its existing version, tenant, route, filters, detail and high-water fields, and additionally binds the generation observed when the first page fixed its high-water mark.
- On a later page, read the tenant's current generation from registry metadata without lazy-opening storage and compare. A mismatch is an explicit argument error: REST `400`, MCP invalid-arguments tool error. Do not silently return an empty or re-selected page.
- Cursors issued before this change have no generation field; treat them as an empty generation. For an ownership-marked tenant they therefore fail against its nonempty generation; for an unsupported legacy tenant (empty generation) existing walks keep working. An unsupported tenant cannot be reset.
- Keep selecting the first page's generation atomically enough that a reset between pages is observed; do not fall back to a fresh walk or restart the cursor.
- Page-size changes, filter changes and tenant mismatch keep their existing behaviour. The cursor checksum remains a checksum, not a MAC; the generation is additional bound state.
- Apply the same binding to both REST and MCP so a cursor cannot cross transports with a stale generation.

### Keep untouched

The store page/high-water implementation, tag/filter parsing, review orchestration, lifecycle engine/routes, profile UI and docs. Do not change `reviewCursorVersion` in a way that makes the existing page-size/filter/tenant tests meaningless; prefer an additive bound field.

## Done evidence

Write the failing checks first, then report before/after output. Use `TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`; never `/tmp`.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'ReviewCursor|ListReviews|Review'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- New test (REST): take page one, reset the tenant through the lifecycle engine so the generation changes, reuse the cursor → `400` with no rows; a fresh walk after reset returns the empty/new store correctly.
- New test (MCP): the same sequence over `list_reviews` returns an invalid-arguments tool error; a fresh MCP walk works.
- New test: a cursor from a legacy unsupported tenant (empty generation) still completes; a second tenant's valid cursor is unaffected by another tenant's reset.
- New test: changing page size and repeating the same filters still returns the same selection after a generation match; tenant/filter/route mismatches remain explicit errors.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
