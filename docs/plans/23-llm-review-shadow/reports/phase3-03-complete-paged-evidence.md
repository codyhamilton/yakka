# Report: phase3-03 — Complete cursor-paged evidence retrieval

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `tools/shadow-review-trial/runner.py`
  - `TrialRunner.get_reviews(manifest_hash, run_id, tenant_id, *, limit=500)` now walks
    `GET /v1/reviews` to exhaustion with the fixed canonical filters
    `tag=manifest:<sha>` + `tag=trial:<run>`, `detail=full`, an explicit page size and the
    returned `cursor`. It no longer issues a single `limit=500` GET.
  - Every page is validated before use: object body, `reviews` list of objects, each row a
    non-empty string `id`, `next_cursor` string-or-null and a boolean `complete`. A terminal
    page must carry `next_cursor=null`; a nonterminal page must carry a cursor.
  - The walk fails (never silently skips) on a repeated cursor, a non-advancing cursor,
    duplicate row identity across pages, missing completion metadata, non-2xx / transport /
    JSON errors, and malformed rows. `EVIDENCE_MAX_PAGES` (10,000) and `EVIDENCE_MAX_ROWS`
    (1,000,000) are explicit operator safety ceilings that raise rather than return complete.
  - `get_reviews` returns a saved-export object: `schema_version`, `manifest_sha256`,
    `run_id`, `tenant_id`, `filters`, `detail`, `limit`, `pages` (each with `cursor_in`,
    `cursor_out`, `complete`, `row_count`, `row_ids_sha256`), terminal `complete` and the flat
    `reviews`. `run` consumes `["reviews"]` for resume reconciliation, intermediate refreshes
    and the final authoritative set; 3-02's duplicate-receipt resolution is unchanged.
- `tools/shadow-review-trial/test_runner.py`: `FakeREST` serves cursor pages and accepts a
  `get_handler` for injected responses. New tests cover >500 rows read exactly once with
  unique identities and page/export evidence; exact-multiple and empty populations ending
  `complete=true,next_cursor=null`; cycle, missing cursor, missing `complete`, duplicate
  identity, HTTP/JSON/row errors and the safety ceiling each fail; a legacy bare 500-row
  response cannot certify completeness.
- `tools/shadow-review-trial/test_phase7.py`: the fake endpoint now pages records
  (`min(requested, 3)` per page) with `cursor`/`next_cursor`/`complete`; a new test covers an
  empty population and an exact-multiple population; the composed 3×3 rehearsal run still
  completes all arms.

## Check output

Before (current working tests run against `HEAD`'s single-page `runner.py`, i.e.
`git stash push -- runner.py`):

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest \
  tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 23 tests in 12.573s
FAILED (failures=5, errors=4)
# composed rehearsal: {'high': 1, 'xhigh': 1, 'max': 1} != {'high': 3, ...} (only page 1 read)
```

After:

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest -v \
  tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 23 tests in 12.634s
OK
$ git diff --check
(no output)
```

## Deviations

- `get_reviews`' return type changed from a list to the saved-export object the brief
  requires; the three `run` call sites now use `["reviews"]`. This is the brief's stated
  shape, but it is a signature change for any other caller (none exist in the repo).
- Page size is the explicit constant `EVIDENCE_PAGE_SIZE=500` (valid 1–500). The server
  default of 100 is a server default, not a runner requirement; `limit` remains page size.
- `test_phase7`'s fake reports at most 3 rows per page even though the runner requests 500.
  The protocol permits a short nonterminal page; terminality is driven by `complete`, which
  this fake sets correctly, and it exercises exact-multiple/empty populations.
- `_review_page` treats a row without a non-empty string `id` as a malformed row, because
  duplicate-identity detection and `row_ids_sha256` are defined over `id`.
- Added a dedicated `test_phase7` paging test beside the composed run; no other paths touched.

## Contradictions

- DESIGN Decision 22 says saved exports carry "high-water identity"; the brief's export
  schema lists `cursor_in`/`cursor_out` but no separate high-water field. The high-water mark
  is bound inside the opaque server cursor, so the page chain carries it, but it is not a
  distinct runner field. Surfaced rather than resolved silently.

## Problems / unfinished

- `tools/shadow-review-trial/report.py` still reads a bare `reviews` list and reports
  `record_limit_may_truncate` from `len(reviews) >= 500`; it does not yet consume this saved
  export. That is 3-04's scope (brief says do not edit `report.py` here).
- `get_reviews` only implements new-run tag filters; historical `manifest_hash`/`profile`
  reads are not added because new rows are tag-only and the brief does not require them.
- No live evidence: the walk is proven only against fixtures/fakes.

## Gates

- gate: live paged reads need the deployed Yakka server, a dedicated `wk_` key with matching
  `/v1/whoami` tenant and `read_write` scope; not available or exercised here.
- gate: a real certified full-history manifest and dedicated-tenant provisioning (3-01 /
  Phase 2 operator acts); out of scope.
- gate: consuming the saved export in the report, canonical cost isolation and provenance
  (3-04) and any paid approval (3-05) remain separate units.
