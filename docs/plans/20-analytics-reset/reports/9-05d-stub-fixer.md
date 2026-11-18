# 9-05d — Ledger stub fixer

Status: `done with gate`. The `/v1/analytics/explore` stub gate is closed; two of
the three 9-04 Chromium specs pass and the third fails only on its clean-console
assertion after the deliberately failed legacy request (see gates). No product
code, test assertion or other spec was changed.

## What changed

- `tests/workspace/fixture.mjs` — added `EXPLORE_TOTAL` (20,050), a cached
  deterministic `exploreRows()` that emits one row per event with the
  CONTRACTS.md 7.2 fields (`type, ts, harness, repo_id, plan, kind, event, tool,
  norm_event, model, path, conversation_id, source, sha, screen_verdict,
  rejection_stage, cost_usd, priced`), and `explorePage({cursor, limit})`. Every
  row has a distinct `ts`, so rows are strictly newest-first and the row
  identity is unique. The set includes hook events, `artifact_version`,
  `commit` and `rejection` rows, plus unpriced rows (`priced:false` with
  `cost_usd:0`). Cursors are opaque base64url offsets; a page reports
  `truncated` and `next` only while rows remain.
- `tests/workspace/stub-api.mjs` — added `GET /v1/analytics/explore` after the
  legacy branch. It honours the request `cursor` and `limit`; when `limit` is
  absent it uses the schema's page budget (`min(explore_page_max, page_max)`,
  500 in default/missing-feature scenes). `state.empty` returns
  `{rows: [], truncated: false}`. The existing `legacy` scene still answers
  400 `range too wide`, which the ledger maps to `error`.
- `tests/workspace/harness.mjs` — unchanged; the existing `empty` control and
  `legacy` scenario already drive `/explore` empty and error.

## Check output

Before (9-04 report):

```
ledger.test.mjs: # tests 14  # pass 11  # fail 0  # skipped 3
  (all three Chromium specs skipped: no /explore route)
```

After (this unit; Chromium specs now run):

```
$ NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true \
  NODE_PATH=…/node_modules node --test …/workspace/ledger.test.mjs
# tests 14  # pass 13  # fail 1  # skipped 0
  ok 12 …pages beyond 20,000… (20,050 rows, 40 “Load more” clicks)
  ok 13 …removed chip pushes history, Back restores it…
  not ok 14 …empty and error follow the frame vocabulary…
    page diagnostics: console=["Failed to load resource: the server responded with a status of 400 (Bad Request)"]
```

The 11 pure checks pass. The empty state passes; the legacy response renders
`data-state=error` with `range too wide`; only the final `assertClean()` fails.

Other workspace specs (same environment):

```
# tests 51  # pass 50  # fail 1
  not ok start.test.mjs … /b/pulse expects "Delivered in Phase 9: Pulse"
```

The Pulse failure is outside this unit (Pulse is delivered) and the working
tree contained concurrent uncommitted edits to `app.js`, `url-state.js` and the
Pulse panels during the run; none were staged or committed here.

## Deviations

- None in the shipped surface. The stub ignores the shared filters and window
  (the data set is fixed and all rows fall inside any tested window); the specs
  exercise paging, identity, costs, chips and scenes, not server filtering.
- No harness control was added because `empty` and `legacy` already work.

## Gates

- `gate: ledger.test.mjs's third Chromium spec calls diagnostics.assertClean() after the intentional legacy 400; Chromium logs a console error for any failed fetch, so that assertion cannot pass while the panel is honestly in the error state. Fixing it is a spec change outside this unit (allow the single 400 entry, as ops/start/follow do) or a product change (map a body-level error on 200 to error), neither of which this unit may make.`
- `gate: start.test.mjs still expects /b/pulse to show "Delivered in Phase 9: Pulse" although Pulse is delivered; unrelated to /explore and outside this unit's owned paths.`
