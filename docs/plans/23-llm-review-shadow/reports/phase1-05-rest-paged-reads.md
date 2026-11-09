# Report: phase1-05 — REST complete paged reads

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

`packages/yakka/internal/serve/reviewsGetRoute` now serves a complete, cursor-paged,
tenant-bound read:

- Parses repeated `tag` values (`q["tag"]`), validates each against the DESIGN regex
  (`^[A-Za-z0-9][A-Za-z0-9._:/=-]{0,95}$`), caps at 16 filters, deduplicates and sorts.
  Tags are conjunctive with each other and every other filter. Invalid tag → 400.
- `limit` defaults to 100 and stays 1–500; `detail` remains `""` or `full`.
- First page calls `BeginReviewWalk` and fixes the high-water mark. Later pages decode a
  cursor and pass through its high-water and strict `(ts, insertion_id)` last key.
- Response keeps the `reviews` array and adds `next_cursor` (string or null) and
  `complete` (bool). Nonterminal pages are `complete=false` with a cursor; exhausted
  pages are `complete=true,next_cursor=null`, using the store `hasMore`, so exact
  multiples and empty populations terminate correctly.
- A row whose `raw` cannot be decoded now fails the page with 500 instead of `continue`.
- Auth and read/read_write scope behavior unchanged; receipts still strip `payload`,
  `detail=full` keeps it.

`packages/yakka/internal/serve/review_cursor.go` (new): tag parsing/canonicalization,
`reviewCursorFilter` with exact equality, and an opaque base64url cursor envelope binding
version, authenticated tenant, route (`GET /v1/reviews`), canonical filters (sorted tags,
detail), high-water and last key, with a SHA-256 checksum over the payload. `limit` is not
bound. Decode/validate rejects malformed, checksum-mutated, unsupported-version, foreign-
tenant, route- and filter-mismatched cursors as 400.

`packages/yakka/internal/serve/review_cursor_test.go` (new): six tests — fixed 1,001-row
walk with changing page sizes and late backdated inserts; page-size-independent selection;
conjunctive tags and untagged handling; malformed/foreign/mutated-filter/detail/unsupported
cursor rejection; completion metadata for partial, exact-multiple and empty populations;
corrupt-row failure at 500.

No changes to `POST /v1/reviews`, the store, MCP, analytics, docs or plugin files.

## Check output

Before (HEAD state, `git stash -u` of this unit's changes):

```
$ cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'Review'
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.080s
```

After:

```
$ cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'Review'
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.251s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  9.709s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve \
    -run 'TestReviewREST(CursorWalk|PageSize|TagFilters|CursorRejects|Completion|CorruptRow)' -v
--- PASS: TestReviewRESTCursorWalkIsFixedAndComplete (0.06s)
--- PASS: TestReviewRESTPageSizeDoesNotChangeSelection (0.02s)
--- PASS: TestReviewRESTTagFiltersConjunctive (0.01s)
--- PASS: TestReviewRESTCursorRejectsMismatch (0.03s)
--- PASS: TestReviewRESTCompletionMetadata (0.03s)
--- PASS: TestReviewRESTCorruptRowFailsPage (0.01s)

$ git diff --check
(no output)
```

The walk test seeds tenant A with 1,001 rows at identical `ts=100` (tenant B with 20),
varies `limit` per page (37/150/500/10/91/333), and appends `ts=50` and `ts=1` rows after
the first page. It collects every row exactly once in descending `(ts,insertion_id)` order,
excludes the late rows and tenant B, and ends `complete=true,next_cursor=null`.

## Deviations

- Tag validation duplicates the small DESIGN regex in `serve` rather than exporting the
  unexported `review.validReviewTag`; the brief's owned paths do not include
  `internal/review`. Bounds and pattern are identical; `secrets.Scan` is not re-applied to
  filters because filters only select already-validated stored tags.
- Tag count is enforced as at most 16 submitted values (counted before dedupe), matching
  phase1-01's submission bound. Duplicates still collapse to one canonical filter.
- New tests live in `review_cursor_test.go`; `reviews_test.go` needed no change and its
  existing assertions still pass.

## Problems / unfinished

- None in this unit's scope. Reset/generation invalidation and "a reset cannot revive a
  tenant" remain Phase 2 by the brief; this unit only proves tenant/filter binding.
- Cursor integrity is a checksum, not a MAC. A holder of a valid tenant key can rewrite
  their own cursor (tenant/filters/high-water) and pass validation; this cannot select
  another tenant's rows, and cross-tenant cursors are rejected. If cursors must resist
  a tenant's own tampering, that needs a server secret and is not in this contract.

## Contradictions

None found between the brief and the cited DESIGN contract.
