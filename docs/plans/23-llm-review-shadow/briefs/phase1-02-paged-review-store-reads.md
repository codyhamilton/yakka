# Brief: phase1-02 — Paged review store reads

Consumer: a Go worker in `packages/yakka` who knows SQLite, `internal/store` and the review fact shape.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/store/reviews.go`, `packages/yakka/internal/store/reviews_test.go`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-02-paged-review-store-reads.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: phase1-01 (it owns `internal/review` and the review serve files; do not edit them).
Budget: read 6 files, about 220 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain "complete tenant-bound reads (Decisions 1 and 5)" lines 111–119; decisions 1, 5, 6, 7 (lines 178–182).
2. `packages/yakka/internal/store/reviews.go` — the whole file (199 lines): table DDL and insertion (38–76), current filtered read (78–132).
3. `packages/yakka/internal/store/reviews_test.go` — the whole file (87 lines), for the `store.Open` and raw-row fixture style.
4. `packages/yakka/internal/review/orchestrator.go` lines 517–565 — the persisted `review_run` raw fields (`ts`, `key`, `repo_id`, tags will be added by phase1-01).
5. `packages/yakka/internal/store/store.go` lines 169–200 — `Tenant` fields and `Open`.
6. `packages/yakka/internal/ingest/ingest.go` lines 195–305 — how a `review_run` row reaches `AppendReviewRuns`.

## Goal

Replace the hidden 500-record read ceiling for complete retrieval with a tenant-local, high-water-anchored keyset page API over `review_runs`, including conjunctive tag filters, so every source row is returned exactly once and appended rows cannot enter a fixed walk.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Both entries accept the existing repo_id/plan/phase/kind/status/effort/profile/manifest_hash/since filters, `detail=full`, `limit` and `cursor`; add exact tag filtering: repeated REST `tag=value`, MCP `tags:[value,...]`, with the same 16 × 96 bounds. Multiple tags mean **ALL**, conjunctive with all other fields. An empty filter matches all tenant reviews, including old untagged records; a tag filter never matches an untagged record. Invalid filters return an explicit argument error."
- "Limit is page size (default 100, range 1–500), never a complete-read ceiling."
- "The first page fixes an insertion high-water mark in the tenant review store; subsequent pages use stable descending `(ts, insertion_id)` ordering with a strict last-key boundary, never offsets."
- "Rows appended later, including backdated ts rows, cannot enter the fixed read. Existing review rows and tags are immutable during this walk."
- "Every nonterminal page has `complete=false` and a progressing cursor; the exhausted page has `complete=true,next_cursor=null`, including exact-multiple and empty populations. A decode/query/corrupt-row error fails the page; do not silently skip malformed stored review rows. No source row can be silently omitted."
- "No fixed total row ceiling is substituted for paging."

Cursor encoding and transport validation belong to phase1-05. This unit supplies the store primitives it needs.

## Changes

- Add a page API to `internal/store/reviews.go`. Keep the existing `ReviewRecords` and `WriteReviewInput`/`ReadReviewInput` behavior for current callers; do not make them the complete-read path.
- Add a filter type or extend `ReviewRecordFilter` with `Tags []string` (conjunctive ALL) and let the page call take an explicit `limit` in 1–500 (reject 0/negative/>500 at the caller; the store should clamp or return an error — state which in the report).
- Add `BeginReviewWalk(ctx) (highWater int64, err error)` (or equivalent): ensure the `review_runs` table exists (reuse the `sqlite_master` check), then `SELECT COALESCE(MAX(rowid),0) FROM review_runs`. `rowid` is the insertion id; the table is not `WITHOUT ROWID` and has `row_hash TEXT PRIMARY KEY`.
- Add `ReviewPage(ctx, filter, highWater, after *ReviewPageKey, limit) (rows []ReviewRecord, hasMore bool, err error)`. Query with:
  - `rowid <= highWater`;
  - the existing filters unchanged (`repo_id`, `plan`, `phase`, `kind`, `status`, `effective_effort`, `profile`, `manifest_hash`, `since`);
  - tag ALL: for each requested tag, `EXISTS (SELECT 1 FROM json_each(raw,'$.tags') WHERE value = ?)`; no tag filter when the list is empty; an untagged row can never satisfy a tag filter;
  - strict descending keyset: `(ts < ?) OR (ts = ? AND rowid < ?)` when `after` is set;
  - `ORDER BY ts DESC, rowid DESC`;
  - fetch `limit+1` to compute `hasMore` without a second query, then trim to `limit`.
- `ReviewRecord` should expose the insertion id (for example an `InsertionID int64` field selected as `rowid`) so the caller can build the next key.
- Reject corrupt rows: if a returned row's `Raw` is not valid JSON, return an error instead of returning or skipping it.
- Keep the existing default-limit/clamp semantics only for `ReviewRecords`; the new page API must never cap at 500 as a completeness ceiling.
- Add tests with >1,000 rows, deliberately identical `ts`, and interleaved later inserts with backdated `ts`. Prove: the fixed high-water walk returns every row exactly once; rows appended after the first page never appear; tag ALL filters are conjunctive; an empty filter includes untagged rows and a tag filter excludes them; a corrupt raw row returns an error; exact-multiple and empty populations report `hasMore=false`.

### Keep untouched

`AppendReviewRuns`, `WriteReviewInput`, `ReadReviewInput`, the review-input file layout, unrelated store tables and aggregates. Do not touch `internal/review`, `internal/serve`, `internal/ingest`, stable docs, or plugin files.

## Done evidence

Write the failing page tests first, then report before/after output.

- `cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/store -run 'Review'` → passes. (Fall back to `GOMEMLIMIT=8GiB GOMAXPROCS=3` if `prlimit` is unavailable.)
- New test: 1,001+ rows across two tenants, identical `ts`, plus a backdated `ts` row appended after the first page. Walking with `limit=100` returns each source row exactly once, the same high-water for every page, and excludes the appended row.
- New test: `Tags:["a","b"]` returns only rows containing both; `Tags:[]` returns untagged old rows; `Tags:["a"]` never returns an untagged row.
- New test: exact-multiple population (for example 200 rows, `limit=100`) and empty population both end with `hasMore=false`; a nonterminal page ends `hasMore=true`.
- New test: a row with invalid JSON `raw` makes `ReviewPage` return an error, not a skipped row.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
