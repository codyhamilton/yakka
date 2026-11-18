# Brief: 12-03 — Artifact reader core and `/artifact`

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/explorers/artifact.js`, `packages/yakka-analytics/web/js/explorers/artifact-content.js`, `packages/yakka-analytics/web/js/core/router.js`, `packages/yakka-analytics/web/css/artifact.css`, `packages/yakka-analytics/tests/plans-artifacts/artifact-reader.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, `packages/yakka-analytics/tests/workspace/engine.test.mjs`, and `docs/plans/20-analytics-reset/reports/12-03-artifact-reader.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-03-artifact-reader.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 12-01 (the P12 fixture/stub scene and browser loader).
Runs alongside: nothing; it establishes the reader and content helper the diff and plan-detail units reuse.
Budget: 16 files to read, about 950 lines to change, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome; **Artifact reader** contract in Entity explorers (version strip with score and band per version; plain-text content with a heading outline, text nodes only; chunks for very long bodies; missing-body reason; bidirectional links); Assumption 24; Interaction model (clean URL, inspect, honest uncertainty).
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.4 Artifact content (complete bytes, headers, 404/413/500 states, stored kinds); 17.3 artifact identity/version metadata and `/entity?grain=artifact&repo_id=&path=`; artifact measure `score:<check>`, `score_scorer:<check>`, `band:<check>` and `/baselines?population=content`; 17.5 chart/table rules; 17.7 fixtures.
3. `packages/yakka/internal/serve/analytics_content.go` — exact statuses, error codes and details; `analytics_entities.go` `analyticsEntity` version row keys; `reads.go` `baselines` content-mode response.
4. `packages/yakka-analytics/web/js/explorers/sessions.js` — lazy explorer shape, own scheduler/transport, `/me` + `rememberedTenant`, route-scoped abort, inspector/links, state vocabulary.
5. `packages/yakka-analytics/web/contract/transport.js`, `web/contract/session-gate.js`, `web/js/core/{router,request-scheduler,panel-state}.js` — transport/auth/resolved base, tenant, route parsing, cancellation, states.
6. `packages/yakka-analytics/web/js/panels/scatter-artifact.js` and `score-strips.js` — the artifact identity and destination already used; do not edit their notices here.
7. `packages/yakka-analytics/tests/scatter-sessions/{browser,sessions.test,acceptance.test}.mjs`, `tests/workspace/{harness,fixture,stub-api}.mjs` — browser loader, P12 scene, stub response patterns.

Read ranges and grep; do not read a whole file to find one section, and truncate long tool output.

## Goal

Deliver `/artifact?repo_id=&path=&hash=` as a real read-only reader: a version strip with score and band, complete text rendered inertly with an outline and chunking, exact content-unavailable/oversized/integrity states, and links to the plan and writing session.

## Contract

- DESIGN.md Artifact reader: "the version history of one `(repo_id, path)` as a strip with score and band per version; the selected version's content as plain text with a heading outline (rendered with text nodes only, no HTML, no markdown dependency; very long bodies render in chunks and say so); ... the writing session, harness, `session_model`, screen verdict, scorer and per-check scores, each linking to its explorer. A missing body shows the server's `content_unavailable` reason."
- CONTRACTS 17.4: `GET /v1/analytics/content?repo_id=&path=&hash=` returns **complete** bytes as `text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. A 64-hex hash must be referenced by the tenant's exact `(repo_id,path)`; unknown/other-tenant hashes are indistinguishable 404. Verify SHA-256; mismatch is 500 `content_integrity`. Above `budgets.content_bytes` (default 16 MiB) is 413 `content_too_large` with `size_bytes` and `limit_bytes`; **no prefix body**. Missing bodies are 404 `content_unavailable` with `reason` one of `removed_by_screen`, `pending`, `not_stored`; pending is never served. Only design, brief and report are stored. The trust boundary is stated: this is promoted-blob read access, not a safety claim.
- CONTRACTS 17.3 `/entity?grain=artifact&repo_id=&path=` returns metadata and one cursor-paged `collection=versions` ordered `received_at desc, content_hash asc`; each version includes `content_hash`, `ts`, `received_at`, `writing_session`, harness/model, `source`, `sha`, `screen {verdict,scorer,at}` and per-check `scores {check:{score,scorer}}`; `latest.content_hash` is top-level; `next` and `population` are server-owned. It never embeds unbounded arrays.
- Bands: per-version band is not in the version row. Compute it in the browser from the existing `/v1/baselines` route (call it as `transport.request('baselines', { params })`, not `/v1/analytics/baselines`), whose content mode (`kind=&check=&scorer=&population=content`) returns `{kind, population:"content", scorers:{scorer:{check:{n,p25,median,p75}}}}`. Strict below p25 is `low`, strict above p75 is `high`, otherwise `mid`; missing baseline (`n` 0/null quartiles) is `baseline_unavailable`, not `unscored`. Never infer a band from another scorer.
- The reader URL is clean: `repo_id`, `path`, optional 64-hex `hash` (selected version); no hash means latest. A hash not in the version list shows "version not found" and does not substitute the latest; a missing `repo_id`/`path` shows a named "identity required" state. Unknown paths stay named; never broaden to another artifact.
- Links are bidirectional: plan `/plans/<repo>/<plan>` (derived from the artifact path's plan) and writing session `/sessions/<id>`; they carry no content-hash token. The plan/session pages already link here (P10/P11); their stale "Phase 12" notices are updated in 12-07, not here.
- Content is inert: build text nodes/textContent only; no `innerHTML`, no anchors or images from body text, no markdown parser, no external dependency. Similarly no HTML outline parsing.
- CONTRACTS 17.7: real Chromium, `data-idle`, real input, no fixed sleeps, `maxInFlight <= 4`, clean diagnostics, deterministic bodies.

## Changes

### Content helper (`explorers/artifact-content.js`)

- Export `fetchArtifactText({ scheduler, repo, path, hash, tenant, signal, stateKey })`:
  - Build `${resolvedBase()}/v1/analytics/content` with `repo_id`, `path`, `hash`, plus `tenant` in collector mode (reuse `isCollectorMode` or add no query when not needed).
  - Use `scheduler.request(url, { headers: authInit('analytics/content').headers, credentials, signal }, stateKey)`; do **not** use `transport.get`, which parses JSON and loses the body.
  - On 200 return `{ok:true, text, status:200, headers}` after `response.text()`.
  - On non-200 parse JSON once and return `{ok:false, status, code, reason, size_bytes, limit_bytes, message}`. Map: 400 identity codes, 404 generic "not found", 404 `content_unavailable` with `reason`, 413 `content_too_large`, 500 `content_integrity`; keep an unknown-status fallback. No prefix is displayed on failure.
- Export pure helpers used by tests and 12-04/12-06:
  - `parseOutline(text)` → `[{level, text, line}]` for ATX headings (`^#{1,6} `) outside fenced code blocks (``` or ~~~), line numbers 1-based; no HTML parsing.
  - `chunkText(text, { lines = 400 } = {})` → `{lines, chunks, totalLines}`; chunks are display windows, not truncation.
  - `bandFor(score, baseline)` → `low|mid|high|baseline_unavailable` per the rule above.
  - `baselineKey(kind, check, scorer)` and a cache helper so repeated versions with the same kind/check/scorer make one `/baselines` request.
- Export `artifactKind(path)` (design/brief/report/other) using the same path rule the server uses; do not serve other kinds.

### Router

- In `core/router.js`, remove `/artifact` from `NAMED_ROUTES`; add it to `EXPLORER_PATHS` as `artifact`; `parseRoute('/artifact')` returns `{kind:'explorer', explorer:'artifact', path:'/artifact', search}`. `loadExplorer('artifact')` dynamically imports `explorers/artifact.js`. Keep `/plans` named for 12-05 and every other route unchanged.
- Update `tests/workspace/engine.test.mjs` artifact expectation accordingly.

### Reader (`explorers/artifact.js`)

- Export `title = 'Artifact'`, `phase = 12`, `render(root, doc, { signal })`.
- Read the URL with `decodeUrlState`/`URLSearchParams`; derive `repo_id`, `path`, `hash`. Fetch `/me` once for tenant (`rememberedTenant`) and `schema` for `budgets.page_max`; use the explorer's own scheduler/transport as sessions does. One route-scoped `AbortController`; no request after abort.
- Version history:
  - Fetch `/entity?grain=artifact&repo_id=&path=` with `limit=page_max`; walk `next` only on "Load more". A 404 `artifact not found` is a named state.
  - Render a version strip (one mark per returned version, latest first) with position, `ts`/`received_at`, screen verdict, per-check scores/scorers, and the selected check's band. A check chooser lists the union of checks observed across versions (plus scores from the schema/catalogue when available); a version missing that check is `unscored`, never zero. Bands are fetched once per distinct `(kind, check, scorer)` and cached; a missing baseline is shown as `baseline_unavailable`.
  - Selecting a version pushes the clean URL with its `hash` (`history.pushState`/router), keeps `repo_id`/`path`, and refetches only content/metadata, not a new identity. Restore selection from `hash`.
  - Show `versions` total, `returned_n` and `next` honestly; no client dedupe of content hashes across versions is implied.
- Selected-version panel:
  - Fetch content with `fetchArtifactText` exactly when a version is selected. Render a status block naming: `not_stored` ("not stored: this ledger has no blob for this version"), `pending` ("pending: not served until ingest completes"), `removed_by_screen` ("removed by screen"), generic 404 ("not found for this repo and path"), 413 ("content too large: {size_bytes} bytes exceeds the {limit_bytes}-byte limit; no prefix is shown"), 500 integrity ("content integrity check failed"). Show the server's exact status/code beside the message; no retry loop beyond one button.
  - On 200: a header with `path`, kind, selected version hash (short + copyable full), `ts`, `received_at`, `source`, `sha`, screen verdict/scorer, harness, `session_model`, writing-session link (label "earliest observed writing session for this version; captured provenance, not proven authorship"), per-check score/scorer/band, and plan link (derived from path; absent if no plan).
  - Body: render complete text in a `pre`-like text node with `white-space: pre-wrap`, chunked at 400 lines; "Showing lines 1–N of M; Show more" appends the next chunk and is never labelled truncated. The outline (`parseOutline`) is a list of heading buttons that scroll the body to the target chunk; headings inside fences are excluded.
  - Malicious `<script>`, `<img onerror>`, HTML comments and markdown links are displayed as literal text. No element from the body is created; the only elements are the reader chrome.
  - Copy-link action copies the current clean reader URL (repo/path/hash) using the existing textarea fallback if clipboard is unavailable.
- States: loading, empty (no versions), unsupported (artifact grain not published), error, cancelled, and identity-required. A feature/schema miss names the server capability and phase; never an empty success. The reader is read-only: no Follow, no fetch/write controls.

### Fixture and tests

- Extend the P12 stub scene additively with:
  - artifact entity rows for an existing plan (design/brief/report) with versions, latest score/scorer/band data, content bytes and flags; deterministic page 1 + page 2.
  - `/entity?grain=artifact` version pages containing: two versions with known bodies for diff later, one version with a `removed_by_screen`, `pending`, `not_stored`, and one with generic not found; a large body whose declared size exceeds `content_bytes` for the 413 path.
  - `/v1/analytics/content` responses with the exact headers on 200 and exact JSON error bodies/statuses; a malicious body containing `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>`; a long multi-chunk body.
  - `/v1/baselines?population=content&check=&scorer=` responses with known quartiles and a missing baseline (`n:0`, null quartiles).
- Add `tests/plans-artifacts/artifact-reader.test.mjs`:
  - pure: outline excludes fenced headings; chunk counts; band rule incl. strict boundaries and missing baseline; error mapping; clean URL builder preserves repo/path/hash and drops unknown params.
  - Chromium: deep link with no hash selects latest; a hash selects that version and reloads with the same URL; the strip shows score and band; a check with no score is `unscored`; content renders as text and no `<script>`/`<img>` element exists; both "Show more" and outline work; all six content states show the exact reason/limits and no prefix body; plan and session links are correct; `maxInFlight <= 4`; clean diagnostics.
- Update `tests/workspace/engine.test.mjs` for the `/artifact` explorer route. Do not update P10/P11 notice assertions here.

### Keep untouched

- The diff: 12-04 owns `artifact-diff.js` and the compare UI; this unit may expose a disabled "Compare versions" affordance only if it names "not available yet", but do not implement diffing.
- Plan list/detail: 12-05/12-06 own them. Do not create `/plans` routes.
- P10/P11 panel notices and tests: 12-07 updates the stale "Phase 12" text.
- No server, Go, migration, dependency (including no markdown/diff library), route, grain, join or gesture change.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/artifact-reader.test.mjs` → pure and Chromium checks pass; a missing browser dependency skips with the named reason.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/artifact-reader.test.mjs` → browser checks pass and report `maxInFlight <= 4`.
- `node --test tests/workspace/engine.test.mjs tests/workspace/start.test.mjs tests/workspace/acceptance.test.mjs` → updated `/artifact` route passes; `/plans` and the rest stay green.
- `node --test tests/workspace/*.test.mjs`, `node --test tests/scatter-sessions/*.test.mjs`, `node --test tests/trends-quality/*.test.mjs` → green; P10/P11 bodies unchanged.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the before/after outputs, the exact content error mapping, the band computation, the outline/chunk evidence, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
