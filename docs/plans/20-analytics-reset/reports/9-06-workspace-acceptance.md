# 9-06 — Workspace acceptance and phase proof

Status: `done`. Verified by an independent re-run on `feat/20-analytics-reset`
at `2e38ccd` (the 9-06b fixer commit). The three proof specs pass 70/70, the
whole workspace suite passes 86/86, both chart kits pass 68/68, and nothing
skips. The five product defects recorded in the earlier blocked run are fixed
and confirmed; the Phase 9 outcome holds entry point by entry point over the
fixture. This run edited only this report and committed nothing.

## What is proven

- `tests/workspace/acceptance.test.mjs` — one Chromium phase proof over the
  committed fixture/stub: all 15 Start paths and their destinations; legacy
  `/schema` disabling 10 paths with the missing-feature reason; `/b/pulse`
  five-frame settle; river inspect for session/artifact/execution provenance;
  calendar brush preview (no push) and zoom commit (`from`/`to`, clears `sel`);
  Follow off, probe counts without acknowledging, acknowledge advancing and
  refetching, a 500 probe holding the watermark; chips/tray/typed population;
  unknown URL key preserved; unsupported join and ignored filter named; all
  unpriced not `$0`; per-panel capability inspector and schema-driven movers
  chooser with the nearest supported choice; saved board URL round trip;
  ledger beyond 20,000; `/ops` admin vs member; every frame state; coarsened
  badge.
- `tests/workspace/deep-links.test.mjs` — all-history and a ten-year finite
  window with tz/filter/panel override/cohort across reload, Back and Forward;
  `cmp=period` disabled with `all`; unknown path in the shell; `maxInFlight <= 4`.
- `tests/workspace/degradation.test.mjs` — the `legacy` scene: the gated panel
  renders `unsupported` naming feature/source, the rest show `range too wide`
  verbatim with retry, no window rewrite, no page/CSP error.

## Verification output

Environment: Chromium 1243 via `playwright-core` under
`NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules`,
`PUBLIC_CANVAS_TEST_MODE=true`.

```
$ NODE_PATH=… node --test tests/workspace/acceptance.test.mjs \
    tests/workspace/deep-links.test.mjs tests/workspace/degradation.test.mjs
ok 1 - every Start question path opens its destination or names the missing capability
ok 2 - Pulse proves feed, brush, zoom, Follow, chips, tray, typed populations and the capability inspector
ok 3 - a named board saves and reopens from its URL, and the ledger and ops prove their bounds
# Phase 9 acceptance summary (70/70 cases)
ok 4 - every panel state and badge is reached through the harness scenes
ok 5 - acceptance summary names every case and its expected state
ok 6 - all-history, a long finite window, filters, a panel override and a saved cohort survive reload and history
ok 7 - a legacy server names the missing feature and shows range too wide verbatim with retry
# tests 7  # pass 7  # fail 0  # skipped 0
```

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… node --test \
    tests/workspace/*.test.mjs tests/*.test.mjs
# tests 86  # pass 86  # fail 0  # skipped 0
```

```
$ NODE_PATH=… node --test tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs
# tests 68  # pass 68  # fail 0  # skipped 0
```

`git diff --check` is clean (exit 0). `rg -n "data-test|__test|stub|fixture"
packages/yakka-analytics/web` matches only the pre-existing `data-testid`
attributes in `web/js/identity/flows.js`; the fix adds no product test branch.
The three new specs contain no `/tmp`, no fixed sleep and no animation/timing
assertion.

## Phase 9 outcome verdict

**Holds.** Start paths open their configured destinations or state the missing
capability; Pulse renders its complete preset with feed/brush/zoom/Follow and
late arrivals; all-history and long finite windows survive deep links/Back;
shared chips, tray and typed populations stay visible with unsupported joins
and ignored filters named; the chooser is `/schema`-driven; saved boards reopen
from their URL; the capability inspector explains provenance; `/ledger`
cursor-pages beyond 20,000; `/ops` shows only authorised status; loading/abort/
empty/error/unsupported and old-server cases are exercised; later preset
destinations are named. No remaining product finding.
