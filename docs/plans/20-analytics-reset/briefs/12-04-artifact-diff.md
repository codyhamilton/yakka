# Brief: 12-04 — Artifact two-version line diff

Consumer: an execute worker.
Owned paths: `packages/yakka-analytics/web/js/explorers/artifact-diff.js`, `packages/yakka-analytics/web/js/explorers/artifact.js`, `packages/yakka-analytics/web/css/artifact.css`, `packages/yakka-analytics/tests/plans-artifacts/artifact-diff.test.mjs`, `packages/yakka-analytics/tests/workspace/fixture.mjs`, `packages/yakka-analytics/tests/workspace/stub-api.mjs`, and `docs/plans/20-analytics-reset/reports/12-04-artifact-diff.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/12-04-artifact-diff.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 12-03 (the reader, version selection and `artifact-content.js` fetch/error helpers).
Runs alongside: nothing; it edits the reader and the shared P12 scene.
Budget: 10 files to read, about 450 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 12 outcome ("Two-version line diff matches the fixture, declines above its stated size ceiling and never diffs unavailable/incomplete text"); Artifact reader contract; Assumption 24 (first-party line diff with a declared size ceiling).
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.4 (no prefix body, 413 no diff, complete bytes) and 17.3 version metadata; 17.7 fixtures.
3. `packages/yakka-analytics/web/js/explorers/artifact-content.js` — `fetchArtifactText`, error mapping, `bandFor`; do not duplicate the fetch logic.
4. `packages/yakka-analytics/web/js/explorers/artifact.js` — version state, clean URL, selected-version panel and CSS hooks.
5. `packages/yakka-analytics/tests/plans-artifacts/artifact-reader.test.mjs` and the P12 stub scene — the two known version bodies and error fixtures.
6. `packages/yakka-analytics/tests/scatter-sessions/sessions.test.mjs` — browser-spec style, `maxInFlight`, diagnostics.

Read ranges and grep; do not re-read files already in context, and truncate long tool output.

## Goal

Add a first-party line diff between any two versions of the selected artifact, with a declared ceiling, deterministic line output matching the fixture, and a hard refusal to diff unavailable, oversized or incomplete bodies.

## Contract

- DESIGN.md Phase 12: "Two-version line diff matches the fixture, declines above its stated size ceiling and never diffs unavailable/incomplete text."
- Assumption 24: "a first-party outline and plain-text renderer (text nodes only) and a first-party line diff with a declared size ceiling." No dependency; no HTML.
- CONTRACTS 17.4: the content route returns complete bytes; above `budgets.content_bytes` it is 413 `content_too_large` with **no prefix body**; pending/rejected bytes are unavailable. A diff must not use a prefix or a partial body, and must not fetch-and-diff when either side is unavailable.
- **Declared ceiling (settled by this unit; state it in the UI):** each side is at most 256 KiB (262,144 UTF-8 bytes) and 2,000 lines. Above either limit, the reader shows "Diff declined: <side> is <N> bytes / <L> lines; the ceiling is 262,144 bytes and 2,000 lines per side." No diff output is produced. This is a display ceiling, not a server limit; the server's 16 MiB remains the content limit.
- The diff is line-based, deterministic and dependency-free. Use a Myers O(ND) line diff or an equivalent first-party algorithm with stable ordering. Represent unchanged, added and removed lines with `+`/`-`/space prefixes so colour is never the only signal. Group into hunks with `@@ -a,b +c,d @@` headers. Empty/one-line bodies and no-final-newline differences are defined and tested.
- Diff inputs come from the two selected version hashes. If either fetch returns 400/404/413/500, the diff declines with that exact reason and sends no second content request when the first already failed (or cancels the other). Never show a partial diff.
- Only design/brief/report content is served; an `other` path has no diff control beyond the content-unavailable state.
- The diff is reader chrome, not a chart; no new gesture. The compare control is a button pair/selectors. The clean URL is `repo_id`, `path`, `hash=<selected version>` and `compare=<second version>`; selecting two versions writes exactly those keys and no others. The URL must round-trip and unknown hashes show a named state.

## Changes

### `artifact-diff.js`

- Export `DIFF_CEILING = { bytes: 262144, lines: 2000 }`.
- Export `diffLines(before, after)` → `{ hunks, added, removed, unchanged, truncated:false }`; `hunks` are `{oldStart, oldLines, newStart, newLines, lines:[{kind:'context'|'add'|'remove', text, oldLine, newLine}]}`. Strip a single trailing newline consistently; preserve all other text exactly.
- Export `diffWithinCeiling(beforeText, afterText)` → `{ok:true}` or `{ok:false, reason, side, bytes, lines}` using UTF-8 byte length (`TextEncoder`) and line count; a 413/unavailable content result short-circuits with its reason.
- Export `renderDiff(doc, result)` that builds a `<pre>` of text nodes only (no `innerHTML`), with `data-kind` per line, a summary ("N added, M removed"), and the ceiling statement. Include a table/accessible alternative (a `<table>` with kind/line text) or ensure the `pre` is readable to assistive tech; table view is required by the chart discipline only for charts, but add a `details`/summary text for long hunks.
- Do not fetch inside the pure diff module beyond an exported `loadDiff({scheduler, repo, path, a, b, tenant, signal})` that calls `fetchArtifactText` for both sides (in parallel or sequential with abort) and returns `{ok, result}` or `{ok:false, reason}`.

### Reader integration

- In `artifact.js`, add a "Compare" control beside the version strip. Two versions must be selected; default the left side to the selected version and the right side to the next-oldest version, or require explicit selection. The control is disabled with a named reason when fewer than two versions exist or the selected kind is not stored.
- On compare, parse the two hashes from the URL, fetch both bodies only through `fetchArtifactText`, apply the ceiling, and render the diff below the selected-version content. A changed selection refetches; leaving `/artifact` aborts.
- If one side is `content_unavailable`, `content_too_large` or has an integrity failure, render the exact reason and no diff. "Incomplete" means any non-200/complete body; do not diff a partial text.
- Keep the content panel and version strip behaviour; do not change `artifact-content.js` fetch semantics.

### Fixture and tests

- Extend the P12 scene with two deterministic known bodies with a controlled diff (one context line, one changed line, one added line, one removed line; include a no-final-newline case), plus an oversized side (> 262,144 bytes or > 2,000 lines, generated programmatically, not a 256 KiB literal), an unavailable side, and a non-design/brief/report path.
- Add `tests/plans-artifacts/artifact-diff.test.mjs`:
  - pure: expected hunks/prefixes for the known pair; added/removed counts; no-final-newline; empty bodies; ceiling at byte and line boundaries (just under/at/over); error short-circuit; stable deterministic output.
  - Chromium: open `/artifact` for the pair with `hash` and `compare`, click Compare, see the expected `+`/`-` lines and summary; an unavailable side shows its exact reason and no diff; an oversized side shows the ceiling refusal and no diff; malicious lines stay text; URL round-trips; `maxInFlight <= 4`; clean diagnostics; no fixed sleeps.
- Do not update the stale P10/P11 "Phase 12" notices; 12-07 does that.

### Keep untouched

- `artifact-content.js` fetch/outline/band logic except any additive export the reader needs; do not change its error mapping.
- The plan/session explorers and `/plans` routes (12-05/12-06).
- P10/P11 stub bodies and tests.
- No server, Go, dependency, route, grain, join, gesture or contract change; no server diff route.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test tests/plans-artifacts/artifact-diff.test.mjs` → pure and Chromium checks pass; a missing browser dependency skips with the named reason.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/plans-artifacts/artifact-diff.test.mjs` → browser checks pass and report `maxInFlight <= 4`.
- `node --test tests/plans-artifacts/artifact-reader.test.mjs` → the reader still passes.
- `node --test tests/workspace/*.test.mjs` and `node --test tests/scatter-sessions/*.test.mjs` → green.
- `git diff --check` clean; no `/tmp`; no fixed sleeps or animation assertions.
- The report records the before/after outputs, the exact diff fixture, the ceiling boundary evidence, and any deviation or contradiction.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
