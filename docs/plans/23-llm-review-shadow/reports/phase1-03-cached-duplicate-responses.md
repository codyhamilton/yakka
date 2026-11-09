# Report: phase1-03 — Cached duplicate responses

Status: `done with concerns`

Branch: `feat/23b-review-controls-trial`

## What changed

- Replaced the newest-500 persisted-claim scan with tenant/repo/execution-key lookup backed by a SQLite expression index. Existing tables create the index on first lookup. Duplicate audit rows are followed to their canonical original where possible; audit/preflight/budget rows with no provider attempt do not mask a later eligible call.
- Cached duplicates now return the original review payload and metadata (`cached`, original id/status, findings/counts, coverage, model, effort, tags, attempts and cost evidence). Duplicate audit rows carry the original id and no attempts or cost.
- New persisted rows retain `review_id`, because canonical ingestion removes the reserved top-level `id`. Reservations distinguish active calls from durable claims: duplicates report `in_progress` or `outcome_unknown` without a second provider call. Missing IDs, corrupt stored payloads and otherwise unusable cache rows return `cache_unavailable`.
- Restricted legacy-adapter fallback to pure adapter tags and verified stored manifest/case/effort/profile. Added REST/MCP cached receipt parity coverage.

## Check output

The first implementation attempt exposed two defects: cache rows were not resolved into full receipts (`cache_unavailable`), and budget refusal audit rows were mistaken for completed originals. Those tests failed before the corrections above.

After:

```
$ cd packages/yakka && TMPDIR=$PWD/.test-scratch prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/serve
ok  .../internal/review  5.561s
ok  .../internal/store   8.499s
ok  .../internal/serve   12.571s

$ TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./...
(all 16 packages ok; `cmd/yakka` 59.767s)

$ git diff --check
(no output)
```

Tests cover full cached duplicate contents and audit accounting; active and restarted durable claims; malformed cached payloads; a completed original beyond the newest 500 rows after tenant reopen; pure legacy fallback and extra-tag bypass; plus REST/MCP cached receipt parity. Focused tests used a temporary directory inside the repository, then removed it; the full suite used scratch under the briefs directory, outside the worktree, and that directory was removed. No `/tmp` path, paid provider call, live server, credential or deployment was used.

## Deviations and concerns

- The brief said not to change stored raw shape. New rows add the additive `review_id` field because canonical storage removes `id`, while the response contract requires the original public ID. Existing canonical rows cannot recover that ID: their conversation id is capture-derived. A legacy match without `review_id` therefore returns `cache_unavailable` without replay. This follows the design's explicit missing/corrupt-original behavior, but narrows full cached compatibility for historical rows.
- The implementation and report change about 700 lines, above the brief's ~300-line guide. The added store lookup, claim-state distinction, full-receipt projection, transport parity, restart/large-store and legacy fallback tests required the extra coverage.
- The first worker attempt tried to create a `/tmp` debug file; automatic review rejected the path and it was not created. No `/tmp` path was used afterward.

## Problems / unfinished

- Historical canonical rows without `review_id` cannot return a complete cached response. They fail explicitly and safely; no provider replay occurs.
- `gate: owner confirmation of historical cache_unavailable behavior for canonical rows without review_id`.

## Contradictions

The brief's unchanged-raw-shape instruction conflicts with the full cached response's original-ID requirement because canonical ingestion strips `id`. The additive field applies only to new rows; old rows follow the design's cache-unavailable path. No live-trial or external-system work was performed.
