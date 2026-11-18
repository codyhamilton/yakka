# Report 12-03 — Artifact reader core and `/artifact`

## Status: done

The reader, the content/outline/chunk/band helpers, the `/artifact` route conversion,
the P12 fixture/stub scenes and the browser spec are built and committed on
`feat/20-analytics-reset`. No server, Go, migration, dependency, route, grain, join or
gesture was added.

## What changed

- `web/js/explorers/artifact-content.js` (new): `fetchArtifactText` (scheduler +
  `authInit`, complete `response.text()` on 200, one JSON parse on non-200),
  `mapContentError`, `parseOutline` (ATX only, fenced blocks excluded, 1-based
  lines), `chunkText` (400-line display windows), `bandFor`
  (strict p25/p75, missing baseline is `baseline_unavailable`), `baselineKey`,
  `createBaselineCache` (one `/v1/baselines?population=content` per
  kind/check/scorer), `artifactKind` (same path rule as `keys.Kind`; `other`
  for unstored kinds).
- `web/js/explorers/artifact.js` (new): `title`, `phase = 12`, `render`, and pure
  helpers `parseReaderIdentity`, `readerUrl`, `planOfPath`, `shortHash`,
  `checkChoices`, `defaultCheck`, `versionScore`, `contentStateText`. One `/me`
  for tenant, one schema read for `budgets.page_max`, its own scheduler/transport,
  one route-scoped AbortController. Version strip (per-version position,
  received-at, screen, every check's score+scorer, selected-check band, check
  chooser), clean URL selection via `history.pushState` (no re-render, cached
  content), selected-version header (path, kind, short+copyable hash, ts,
  received, source, sha, screen, harness, session model, writing-session link with
  the captured-provenance label, plan link, per-check score/scorer and selected
  band), inert chunked body, heading outline that jumps to its chunk, Show more,
  Copy link/Copy hash, all six content states with exact status/code and no prefix
  body, identity-required and version-not-found states.
- `web/js/core/router.js`: `/artifact` removed from `NAMED_ROUTES`, added to
  `EXPLORER_PATHS`, title and `loadExplorer` dispatch; `/plans` stays named.
- `web/css/artifact.css` (new): reader chrome, inert `pre-wrap` body, strip.
- `tests/workspace/fixture.mjs`: additive P12 artifact scene — design artifact
  (6 versions: two known bodies, removed_by_screen, pending, not_stored, generic
  not found; page 1 = 4, page 2 = 2), long 900-line brief, oversized report,
  integrity report, content bodies/headers, content baselines and one missing
  baseline.
- `tests/workspace/stub-api.mjs`: additive `/entity?grain=artifact`,
  `/v1/analytics/content` (exact headers/statuses/bodies) and content-mode
  `/v1/baselines` handlers.
- `tests/workspace/engine.test.mjs`: `/artifact` expectation is now an explorer.
- `tests/plans-artifacts/browser.mjs` and `artifact-reader.test.mjs`: re-exports
  and 15 pure + Chromium checks.

## Check output

Before (identified failing check):

```
$ node --test tests/plans-artifacts/artifact-reader.test.mjs
Could not find 'tests/plans-artifacts/artifact-reader.test.mjs'
$ node -e "import('./web/js/core/router.js').then(m=>console.log(JSON.stringify(m.parseRoute('/artifact','?repo_id=r&path=p'))))"
{"kind":"named","path":"/artifact","search":"?repo_id=r&path=p","title":"Artifact reader","phase":12,...}
```

After:

```
$ node --test tests/plans-artifacts/artifact-reader.test.mjs
# tests 15 # pass 15 # fail 0 # skipped 0
$ NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 \
    tests/plans-artifacts/artifact-reader.test.mjs
# tests 15 # pass 15 # fail 0   (every browser spec asserts stats.maxInFlight <= 4)
$ node --test --test-concurrency=1 tests/workspace/engine.test.mjs tests/workspace/start.test.mjs
# tests 11 # pass 11 # fail 0
$ ... tests/workspace/acceptance.test.mjs
# tests 5 # pass 5 # fail 0
$ ... tests/workspace/*.test.mjs
# tests 72 # pass 72 # fail 0
$ ... tests/scatter-sessions/*.test.mjs
# tests 42 # pass 42 # fail 0
$ ... tests/trends-quality/*.test.mjs
# tests 54 # pass 54 # fail 0
$ git diff --check
(clean; no /tmp, no fixed sleeps, no animation assertions)
```

The reader only requests after settle; the browser specs wait on
`[data-panel="artifact-reader"][data-idle="true"]` and explicit selectors.

## Content error mapping

`mapContentError` / `contentStateText`:

| Server | UI |
| --- | --- |
| 404 `{error:"not found"}` | "not found for this repo and path", `404 not_found` |
| 404 `content_unavailable` `reason=not_stored` | "not stored: this ledger has no blob for this version" |
| 404 `content_unavailable` `reason=pending` | "pending: not served until ingest completes" |
| 404 `content_unavailable` `reason=removed_by_screen` | "removed by screen" |
| 413 `content_too_large` | "content too large: 20,000,000 bytes exceeds the 16,777,216-byte limit; no prefix is shown" |
| 500 `content_integrity` | "content integrity check failed" |
| 400 identity codes | the server message (`400 content_identity_required`) |

Every failure path renders zero body chunks; the spec asserts `.artifact-chunk`
count 0 for each.

## Band computation

Per version and selected check, the score's own `scorer` keys the cache:
`/v1/baselines?kind=&check=&scorer=&population=content` →
`scorers[scorer][check]` → `bandFor`: `score < p25` low, `score > p75` high,
otherwise mid; `n` 0/null or null quartiles → `baseline_unavailable`. A version
missing that check is `unscored`, never zero. One request serves repeated
kind/check/scorer tuples (pure test asserts one call).

## Outline and chunk evidence

- `parseOutline` excludes fenced (` ``` `/`~~~`) headings and returns 1-based
  levels/lines; HTML is not parsed.
- `chunkText` on 900 lines gives `[1,400] [401,800] [801,900]`; joined chunks equal
  the input. Chromium shows "Showing lines 1–400 of 900", outline jump loads
  through 800, Show more through 900, and never says "truncated".

## Deviations from the brief

1. The check chooser's `plus scores from the schema/catalogue when available`:
   the P12 schema publishes no check list, so the union comes from observed
   version scores. The reader still calls `/scores?kind=` and merges any returned
   catalogue names; the P12 stub returns none.
2. Fixture reuses four hash values across the design and report artifact rows to
   keep the additive scene small. The stub still requires the requested
   `(repo_id, path)` to contain that hash before serving a state, so a hash is
   never served from another path.
3. `artifactKind` returns `other` where the Go helper returns `""`; the reader
   labels it "other (not stored)" and does not fetch content, matching "only
   design, brief and report are stored".
4. Version selection updates the URL with `history.pushState` and does not
   dispatch `popstate`, so the version list/identity is not refetched; content is
   cached per hash. This follows "refetches only content/metadata, not a new
   identity" over a full router re-render.

## Contradictions between brief and contracts

None found. The brief's "walk `next` only on Load more" plus "a hash not in the
version list is version not found" is consistent but has the consequence recorded
under known problems.

## Unfinished / deferred

- 12-04 (diff), 12-05/12-06 (plans), 12-07 (stale notices and phase acceptance)
  are untouched, per the brief. No disabled "Compare versions" affordance was
  added.

## Known problems

- A deep link whose `hash` is beyond the first `page_max` versions shows
  "version not found for this artifact" until the user clicks Load more; the
  brief forbids walking `next` automatically, so this is the literal reading.
  The fixture's deep-link hashes are on page 1.
- The reader does not dedupe content hashes across versions (the brief states no
  client dedupe is implied).

gate: none for this unit; the Phase 13 Pages/deploy automation gate is unchanged
and was not exercised here.
