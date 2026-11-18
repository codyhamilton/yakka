# 12-07 Acceptance Handoff

Status: done. The two blockers from the prior attempt are settled by the amended brief and the unit evidence is green.

## What changed

- Replaced the shipped P10/P11 “Phase 12” destination notices with neutral wording: `score-strips` (`READER_NOTICE` + caveat), `scatter-artifact` (`ARTIFACT_READER_NOTICE`, `reader` label), `scatter-plan` (`PLAN_EXPLORER_NOTICE`, `reader` label) and `explorers/sessions.js` link text. Destination identities and links are unchanged.
- Updated the pinned notice assertions in `tests/trends-quality/{quality,acceptance}.test.mjs` and `tests/scatter-sessions/{sessions,acceptance}.test.mjs`; no count, link or population assertion was weakened.
- Made the P12 fixture additive over the P10/P11 schema: `p12Schema()` merges p10+p11 grains/measures/lenses (plan/execution/artifact), routes P12 artifact-scatter through the P11 artifact scatter fixture, and adds additive P12 artifact/plan rows for the `(repo_id, path, hash)` and `(repo_id, plan)` identities the P10/P11 links point at. P10/P11 stub bodies and the reader stay byte-identical and unloosened; `p12` is opt-in.
- Added `tests/plans-artifacts/acceptance.test.mjs`: deterministic Chromium coverage for workflow, plans list/detail, reader content/diff/reasons/links, unknown deep links and catalog/preset delivery.
- Applied the settled diagnostics convention: the reader acceptance spec (which deliberately probes 404/413/500) asserts page errors and CSP empty and allows only the exact `Failed to load resource` console entries for the probed statuses; every other spec keeps unfiltered `assertClean()`.

## Before / after

- `node --test tests/plans-artifacts/acceptance.test.mjs`
  - before: 3 pass / 1 fail. Reader test failed at `acceptance.test.mjs:219` `assertClean()` with `console=["Failed to load resource: ... 404" ×6, "... 413", "... 500", "... 404" ×2]; errors=[]; csp=[]`.
  - after: 4 pass / 0 fail.
- `NODE_OPTIONS=… node --test --test-concurrency=1 tests/plans-artifacts/*.test.mjs`
  - before (prior attempt): 63/64 (same reader diagnostics failure).
  - after: 64 pass / 0 fail.
- Explicit unit evidence `workflow + rank-preset + artifact-reader + artifact-diff + plans-list + plan-detail`: 60 pass / 0 fail (unchanged, still green after notice/fixture edits).
- `tests/workspace/*.test.mjs`: 72 pass / 0 fail.
- `tests/scatter-sessions/*.test.mjs`: 42 pass / 0 fail (three consecutive sequential runs; an earlier 41/42 came from running it concurrently with another browser suite, not a real regression).
- `tests/trends-quality/*.test.mjs`: 54 pass / 0 fail.
- `cd packages/yakka && go test ./...`: exit 0 (no Go file changed by Phase 12).
- `git diff --check`: clean. Stale-notice grep over `web/` for `arrives in Phase 12`, `is Phase 12`, `Phase 12 artifact destination`, `Plan 12`: no occurrences. No `/tmp`, no fixed sleeps, no animation/timing assertions in the new spec.

## Probed destinations and evidence

- Workflow: `shape-bars` (three series `executions_complete|started|unreported`), `plan-timeline`, `rank`, `scatter-plan` (overlap/non-additive banner), `river` all reach `ready`; a clicked plan mark opens `/plans/<repo>/<plan>` with the matching `.plans-detail-identity` heading.
- Plans: `/plans` sorts server-side (`sort=associated_cost_usd:desc`) and settles list + scatter; `/plans/acme/widgets/20-analytics-reset` settles summary/artifacts/executions/sessions/events/design, renders design phase headings/outcomes/brief paths, a no-brief phase shows `no brief path observed` with no completion marker; `/plans/acme/widgets/missing` names the absent state; `/plans/a/b/extra` and `/plans/a` are `not-found`.
- Reader: P10 score-strips and scatter-artifact marks and the P11 sessions artifact link click into `/artifact` and render the named `identity-required` state for their short fixture hashes. The P12 64-hex identity round-trips through the clean URL, shows per-version score/band, harness/model, screen verdict and scorer, and its plan/session links resolve back.
- Content: malicious `<script>`/`<img onerror>` renders as text with no script/img element and no dialog; `not_stored`, `pending`, `removed_by_screen`, generic not-found, 413 (20,000,000 vs 16,777,216 bytes, no prefix body) and 500 integrity each show their exact state/code.
- Diff: the known two-version diff matches (`2 added, 2 removed`); an unavailable side and an oversized side are declined with `content_unavailable` and the `262,144 bytes / 2,000 lines` ceiling and no diff.
- Delivery: every CATALOG id (including `shape-bars`, `plan-timeline`, `session-lanes`, and the compound `calendar`+`rhythm`, `dist-hist`+`dist-ecdf`, `mix`) is registered; `/plans` and `/artifact` parse as explorers, `/b/workflow` as a board, and every preset resolves to a board naming only registered panels.
- `maxInFlight <= 4` holds on every spec.

## Deviations, carries and contradictions

- Fixture limitation (recorded as a carry, not a product bug, per the amended brief): P10/P11 fixtures use short artifact hashes (`h1`, `hash-a`, `hash-design`). CONTRACTS 17.4 requires a 64-hex hash for `/content`, so those destinations reach the reader's named `identity-required` state rather than content. P10/P11 bodies were not changed and the reader was not loosened; the P12 64-hex identity proves content, metadata and diff.
- No contradiction remains between this brief and the cited contracts; the prior diagnostics conflict is resolved by the settled convention (page errors/CSP empty, only exact matching `Failed to load resource` entries for the deliberate probe).
- No product bug surfaced outside the owned notice/fixture scope. No other deviation.

gate: none.
