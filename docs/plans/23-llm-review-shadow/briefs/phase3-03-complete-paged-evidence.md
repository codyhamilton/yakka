# Brief: phase3-03 — Complete cursor-paged evidence retrieval

Consumer: a Python worker who knows `tools/shadow-review-trial/runner.py`, the Phase 1 REST review cursor contract and fake REST transports.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/runner.py`, `tools/shadow-review-trial/test_runner.py`, `tools/shadow-review-trial/test_phase7.py` (only the fake endpoint/paging sections). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-03-complete-paged-evidence.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase3-02.
Runs alongside: nothing.
Budget: read 8 files, about 250 lines changed, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — complete tenant-bound reads (121–129), trial resume/reporting (174–176), Decisions 5–6 and 22 (209–210, 226), Phase 3 outcome and surfaces (291–296).
2. `tools/shadow-review-trial/runner.py` — `TrialRunner.get_reviews`, `run` reconciliation and ledger transitions.
3. `tools/shadow-review-trial/test_runner.py` — `FakeREST` and the current record-return/duplicate fixtures.
4. `tools/shadow-review-trial/test_phase7.py` — `RehearsalHandler` GET and the composed run test.
5. `docs/plans/23-llm-review-shadow/briefs/phase1-05-rest-paged-reads.md` and its report — the settled REST `next_cursor`/`complete` semantics.
6. `docs/plans/23-llm-review-shadow/briefs/phase1-06-mcp-list-reviews.md` and its report — the shared walk, cursor binding and failure behaviour.
7. `packages/yakka/internal/serve/serve.go` — GET reviews handler (around 848–960), especially the response object and cursor/complete fields.
8. `packages/yakka/internal/store/reviews.go` — `ReviewPage`/`ReviewPageKey` ordering and tag filters.
9. `tools/shadow-review-trial/report.py` — how the current report reads `reviews` and `record_limit_may_truncate`; do not edit it here.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Read complete full-detail trial evidence by following REST cursor pages to exhaustion with fixed filters and completion evidence, and fail loudly on any cycle, gap, duplicate identity, error or safety ceiling instead of substituting a 500-row ceiling.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Both entries accept the existing repo_id/plan/phase/kind/status/effort/profile/manifest_hash/since filters, `detail=full`, `limit` and `cursor`; add exact tag filtering: repeated REST `tag=value`, MCP `tags:[value,...]`, with the same 16 × 96 bounds. Multiple tags mean **ALL**, conjunctive with all other fields."
- "Limit is page size (default 100, range 1–500), never a complete-read ceiling. Other analytics endpoints retain their limits."
- "Every nonterminal page has `complete=false` and a progressing cursor; the exhausted page has `complete=true,next_cursor=null`, including exact-multiple and empty populations. A decode/query/corrupt-row error fails the page; do not silently skip malformed stored review rows. No source row can be silently omitted. Consumers verify protocol consistency and unique row identities; cycles, missing completion metadata, request failures, early interruption or an operator safety ceiling produce a nonzero/incomplete result, never a complete report. Saved trial exports carry filters, high-water identity, exhausted-page evidence and counts; a legacy bare 500-row response cannot certify completeness. No fixed total row ceiling is substituted for paging."
- "Runner resume and reporting page GET reviews to exhaustion with `detail=full`, fixed filters and completion evidence, then validate all canonical identities against the frozen manifest/journal."
- Phase 3 outcome: "Report/resume consume >500 records over complete full-detail cursor pages, isolate the exact frozen run/canonical cost, reject missing/looping/truncated/error pages and uncertified legacy exports, and cannot claim completeness from partial data."

## Changes

- Replace `TrialRunner.get_reviews(manifest_hash)`'s single `limit=500` GET with a paged reader that:
  - sends fixed filters (new runs: the canonical trial tags; historical reads may use `manifest_hash`/`profile` only where the contract still supports them), `detail=full`, an explicit page size and the returned `cursor`;
  - follows `next_cursor` until the terminal page and validates every response: an object with a `reviews` list of objects, a `next_cursor` that is a string or null, and a boolean `complete`;
  - requires a progressing, non-repeating cursor for every nonterminal page and `complete=true,next_cursor=null` only on the terminal page;
  - detects a repeated cursor (cycle), duplicate row identities across pages, a missing/invalid completion field, a non-2xx/transport/JSON error, and a malformed stored row; each fails the read rather than silently skipping;
  - applies an explicit operator safety ceiling on pages/rows and returns an incomplete/failing result when it is reached, never a complete one;
  - returns a saved-export object with `schema_version`, `manifest_sha256`, `run_id`, `tenant_id`, `filters`, `detail`, `limit`, a `pages` array carrying each page's `cursor_in`, `cursor_out`, `complete`, `row_count` and `row_ids_sha256`, a terminal `complete` boolean, and the flat `reviews` array.
- Use the paged reader for resume reconciliation and for the final authoritative record set. Keep the duplicate-receipt resolution from 3-02; do not add a duplicate-only GET.
- Update `test_phase7.py`'s fake endpoint to serve the same rows over multiple cursor pages (including an exact-multiple and an empty population) and keep the composed run working.
- Add tests: a fake endpoint returns more than 500 records across pages and the runner reads them all exactly once; exact-multiple and empty populations end with `complete=true,next_cursor=null`; a cycle, a missing `complete`, a missing/repeating cursor, a duplicate row id, an HTTP/JSON/row error and the safety ceiling each fail/incomplete and never produce a complete export; the saved export carries the required page evidence. Do not rely on a single 500-row response.

### Keep untouched

The 3-02 request/tag/whoami/duplicate contracts, `report.py`, `approval.py`, `cli.py`, docs, the shim/plugin and server code. No live Yakka, provider, credential, deployment, Fly/Wrangler or paid execution. Do not edit `test_report.py`.

## Done evidence

Write the failing checks first, then report before/after output.

- `cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` → passes. (Pure-Python tests; no memory cap expected. Do not use `/tmp`.)
- New test: >500 records are consumed over complete full-detail cursor pages with unique row identities and terminal completion metadata.
- New tests: cycle, missing completion metadata, missing/repeating cursor, duplicate row identity, request/JSON/row error and the operator safety ceiling each fail or report incomplete; none can be reported complete.
- New test: the saved export records filters, detail, page evidence and counts, and a legacy bare 500-row response cannot be produced as a complete export.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
