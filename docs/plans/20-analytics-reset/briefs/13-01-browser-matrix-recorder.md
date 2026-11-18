# Brief: 13-01 — Browser release matrix and request-shape recorder

Consumer: the Phase 13 acceptance worker and 13-02 server pageset worker.
Owned paths: `packages/yakka-analytics/tests/release-matrix/`, `packages/yakka/internal/serve/testdata/browser-request-shapes.json`, `docs/plans/20-analytics-reset/reports/13-01-browser-matrix-recorder.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/13-01-browser-matrix-recorder.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Nothing.
Runs alongside: 13-03 identity and route proof; 13-04 release docs and checks.
Budget: 10 files to read, about 500 lines to change, 12 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 13 outcome and surfaces; Phase 1 outcome; Serving/release/Pages and Test harness and fixtures domains; scope vocabulary.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 17.6 (serving output and two hosts); 17.7 (browser harness and fixtures); 17.1 (all-history).
3. `packages/yakka-analytics/tests/workspace/{acceptance.test.mjs,deep-links.test.mjs,degradation.test.mjs,browser.mjs,harness.mjs}` — current matrix, old-server seam and settled-state conventions.
4. `packages/yakka-analytics/tests/{trends-quality,scatter-sessions,plans-artifacts}/acceptance.test.mjs` and each directory's `browser.mjs` — shipped acceptance entry points and request logs.
5. `packages/yakka-analytics/tests/e2e/static-harness.mjs` and `tests/hosted/hosted.spec.ts` — legacy/static and binary harness status; the `.spec.ts` tree targets the removed Svelte app and is not the release matrix.
6. `packages/yakka-analytics/web/{index.html,js/identity/,js/core/,contract/}` — route and request ownership only; grep/read ranges.

## Goal

Prove the shipped preset, gesture, state and deep-link acceptance against both Pages-style static serving and the embedded release binary, with the existing legacy-server degradation coverage. Add a browser-recording mode that writes a committed, deterministic list of request shapes the current workspace actually sends, including `all=1`/all-history; the record contains request method/path/query and stable scenario labels only, never response bodies or live tenant data.

## Contract

DESIGN.md Phase 13: “The complete preset/gesture/state/deep-link matrix passes against both the release binary and Pages-style static serving, including old-server capability degradation.”

CONTRACTS.md 17.7: “Tests wait on `html[data-idle="true"]` and explicit end-state conditions only (URL, `data-state`, `inspect()`); charts are driven with real mouse and keyboard events at coordinates from `inspect()`; no fixed sleeps; any `console.error` or CSP violation fails a spec; the harness asserts at most 4 requests in flight on every page.”

CONTRACTS.md 17.1: “Every windowed analytics route accepts `all=1`”; this tests the shipped client request shape and server behavior without adding or changing a route, grain, join, gesture or capability.

Settled: use the existing Node built-in test runner, `playwright-core` through `NODE_PATH`, Chromium 1243, `PUBLIC_CANVAS_TEST_MODE=true`, deterministic fixture/stub data, current browser helpers and suite entry points. The old `.spec.ts` tests are stale; do not activate, delete or rewrite them as part of this unit. The shared matrix runner must select a Pages-style static origin or a locally built `YAKKA_BIN` origin without deploying or reading production data.

## Changes

Add a small release-matrix driver that invokes or reuses the existing acceptance entry points and exposes two targets: a Pages-style static `web/` server with the first-party stub rig, and an embedded local binary built by `tools/release/build.sh` with a temporary fixture tenant. Add only the origin/fixture seam needed by the current acceptance suites; do not copy acceptance coverage into a new parallel suite. Preserve separate suite counts and settled-state checks. The matrix must include old-server degradation.

Add a recorder mode to the browser rig. Capture requests after browser pages settle for the shipped presets and relevant all-history states. Canonicalize query parameter order and exclude timestamps/volatile values only where the app resolves them from the test's fixed clock. Commit the deterministic shape record at `packages/yakka/internal/serve/testdata/browser-request-shapes.json`; make rerunning the recorder compare against the committed record and fail on unexpected drift. 13-02 consumes this exact file.

Use only the committed fixture and first-party stubs. Build locally into an ignored/scratch path, set `TMPDIR` to an in-worktree scratch directory (never `/tmp`), cap Go/Node at 8G, and set Node test concurrency to 1 wherever route logs are shared. Keep at most four browser requests in flight. No fixed sleeps, animation assertions, live data, credentials, deploy, tenant reset/delete, or new dependency.

### Keep untouched

Keep product files under `web/` unchanged. Do not touch `tests/e2e/*.spec.ts`, `tests/hosted/*.ts`, release scripts, Pages config, fly config, external automation, secrets, other worktrees or tenant data. Do not weaken or duplicate shipped acceptance tests.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `mkdir -p /home/codyh/.cache/plan20p13` → scratch directory exists outside `/tmp`.
- `TMPDIR=/home/codyh/.cache/plan20p13 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/acceptance.test.mjs packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs` → baseline counts 4/4, 4/4, 5/5, 4/4 respectively.
- `TMPDIR=/home/codyh/.cache/plan20p13 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/release-matrix/matrix.test.mjs` → 2/2 target runs pass (Pages-style static and embedded binary); each reuses those same four acceptance entry points/counts with no skips.
- `... node --test --test-concurrency=1 packages/yakka-analytics/tests/release-matrix/record.test.mjs` → 1/1 recorder test; its canonical output exactly matches `browser-request-shapes.json`, contains the all-history `all=1` request shape and no data payload or volatile timestamp.
- Matrix report → every existing acceptance suite completes against both selected origins; every page settles through `data-idle`/`data-state`/URL/`inspect()`, zero page/CSP/console errors except the existing deliberately asserted legacy 4xx, and maximum in-flight requests is at most 4.
- Build/matrix setup → build output is local and temporary; fixture is deterministic; `TMPDIR` is not `/tmp`; no deploy or tenant/credential action occurred.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Include the matrix target(s), exact suite counts, recorder output/hash, browser request maximum, carried items, and any `gate:` line.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
