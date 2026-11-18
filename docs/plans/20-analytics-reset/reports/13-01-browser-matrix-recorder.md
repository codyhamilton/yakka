# 13-01 Browser matrix and request-shape recorder handoff

Status: done with three named departures (see Departures). Both release topologies pass all four shipped acceptance entry points, and the committed browser request-shape record is deterministic.

## What changed

- `packages/yakka-analytics/tests/release-matrix/origins.mjs` — builds the local binary with `tools/release/build.sh` into `.scratch/p13/release/dist` (local `OUT_DIR`, `SUMS_FILE`, `TMPDIR`), starts it in local mode over a temporary data directory, and sanity-checks that the embedded binary serves `index.html` and `js/app.js`. It refuses any scratch path under `/tmp` and never deploys or reads a tenant.
- `packages/yakka-analytics/tests/release-matrix/matrix.test.mjs` — two target runs. Each spawns the four shipped acceptance files as separate `node --test --test-concurrency=1` runs, unchanged, with the 8G heap cap. `pages` uses the default Pages-style static harness; `embedded` sets `YAKKA_RELEASE_STATIC_ORIGIN` to the binary origin and keeps the deterministic first-party stub API.
- `packages/yakka-analytics/tests/release-matrix/recorder.mjs` — records only `GET` method, `/v1/analytics/*` path and sorted query pairs for all eight shipped presets, with fixed absolute windows plus all-history states for Pulse, Trends, Scatter and Cost. It emits no response body, no tenant data and no clock-derived value.
- `packages/yakka-analytics/tests/release-matrix/record.test.mjs` — one test; canonical output must equal the committed JSON, contain the all-history `all=1` shape, and carry only `method`/`path`/`query`.
- `packages/yakka/internal/serve/testdata/browser-request-shapes.json` — the record 13-02 consumes. SHA-256 `420015134d2d3ee8861ee97e449a06e7bed3268d30492e34cdcd0b74012a5c2c`.
- `packages/yakka-analytics/tests/workspace/harness.mjs` — 16-line opt-in seam (Departure 1): when `YAKKA_RELEASE_STATIC_ORIGIN` is set, static reads proxy to that origin; the default Pages-style path is unchanged.

## Evidence

Before this unit the new checks did not exist: `node --test .../browser-request-shapes.json` had no file, and `node --test .../matrix.test.mjs` and `.../record.test.mjs` failed with “no such file”. The baseline acceptance command on the closing tree produced (per file) workspace 5/5, trends-quality 6/6, scatter-sessions 5/5, plans-artifacts 4/4: total 20 pass, 0 fail, 0 skipped.

After the exact brief commands:

```
# baseline: 20 tests, 20 pass, 0 fail, 0 skipped
# matrix:   tests 2  pass 2  fail 0  cancelled 0  skipped 0
# matrix pages:    workspace 5/5, trends-quality 6/6, scatter-sessions 5/5, plans-artifacts 4/4
# matrix embedded: workspace 5/5, trends-quality 6/6, scatter-sessions 5/5, plans-artifacts 4/4
# record:   tests 1  pass 1  fail 0  cancelled 0  skipped 0
```

The recorder was run twice; the second output was byte-identical to the first (`diff -q` clean). The record contains nine `all=1` pairs and only fixed ISO bounds (`2026-08-28`, `2026-09-01`, `2026-09-05`), with no body or volatile field. The reused suites keep their own `data-idle`/`data-state`/URL/`inspect()` settled-state checks, `console.error`/CSP gates and the at-most-4-in-flight assertion; all passed in both targets. Embedded smoke: `/js/app.js` 200 `text/javascript`, `/b/trends` 200 `text/html`. Build output stayed under `.scratch/p13`; no deploy, secret, tenant reset/delete or migration occurred.

## Departures

1. `packages/yakka-analytics/tests/workspace/harness.mjs` is outside this unit's owned paths. The brief's Changes requires the origin seam (“Add only the origin/fixture seam needed by the current acceptance suites”) and the recorder mode; the owned-path line omits the shared rig. The edit is opt-in via an env var, does not alter the default Pages path, and reuses the existing stub, headers and stats.
2. The brief's baseline counts (4/4, 4/4, 5/5, 4/4) do not match the tree; the four files have 5, 6, 5 and 4 top-level tests on this branch (20 total). The matrix uses the measured baseline, with a comment recording the discrepancy.
3. The embedded target exercises the binary's embedded **asset serving** while the API remains the deterministic first-party stub, and its temporary data directory is an empty local tenant (no ingest). Running the shipped acceptance bodies against the binary's real API is impossible without rewriting those suites (forbidden here); the record and matrix therefore prove the two serving topologies with one fixed API fixture. The Go/API side is 13-02's scope.

## Contradictions

- “Touch nothing else” (owned paths) versus “add only the origin/fixture seam” and “add a recorder mode to the browser rig”, which require the shared `tests/workspace/harness.mjs`.
- The done-evidence baseline counts cited above are stale.

## Carried items

- 13-02 consumes `browser-request-shapes.json`; rerun `node packages/yakka-analytics/tests/release-matrix/recorder.mjs` only when the shipped request shapes intentionally change, then review the diff.
- The build is cached under `.scratch/p13` during a run and removed before this commit; a clean run rebuilds it.

## Gates

`gate: the external Pages automation must accept ./web as its output directory (carried; owned by 13-04/13-05).`
