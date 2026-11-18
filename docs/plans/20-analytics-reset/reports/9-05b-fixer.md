# 9-05b — Ops fixer

Status: `done`.

## What changed

- `web/js/panels/registry.js` — a table-only panel is now expressible as
  `charts: []` plus `table: true`. Any non-empty `charts` array still has to
  name a real chart-kit chart. This was chosen over adding a `table` value to
  `CHART_NAMES`: the kit draws no table, so its chart-name list stays honest
  and no fake chart name is invented. Documented in the module comment.
- `web/js/panels/ops-footprint.js` — `ops-footprint` declares `charts: []`,
  `table: true` instead of the fake `charts: ['bars']`. No chart is drawn.
- `web/js/ops.js` — names the frame's representation as `data-chart="table"`
  after mounting. The route-scoped `signal` from `app.js` aborts the panel's
  local controller, so navigation aborts the status fetch.
- `web/js/app.js` — one route-scoped `AbortController` per explorer. `render()`
  tears it down before any new route, `renderExplorer` passes its signal to the
  module and awaits the module render, and a module may return a destroy
  function. Routes and public render calls are unchanged.
- `tests/workspace/fixture.mjs` — `adminStatus()` now returns the full
  CONTRACTS.md 6 shape: version, scoring, optional volume, and two separate
  tenants with facts, compaction, footprint, screens, failures and rescore.
- `tests/workspace/stub-api.mjs` — drives the committed status shape and adds
  controls for `statusError` (500 with `status read failed` / `read failed`) and
  `statusDelayMs`. `statusRequests` / `statusAborted` counters are readable from
  the existing control endpoint so an abort can be observed without timing
  assertions.
- `tests/workspace/ops.test.mjs` — the full-shape and 500 cases now use the
  committed stub instead of page-level interception; the 500 recovers by
  clearing the control. Added a navigation spec: with a delayed status request
  in flight, moving to `/ledger` aborts it (server observes `statusAborted`).
  The registry check now proves the table-only entry is accepted and that an
  unmarked empty chart list is rejected.

## Check output

Before (HEAD `153c5c3`, source facts):

```
$ git show HEAD:.../panels/ops-footprint.js | grep -n "charts:\|table:"
407:  charts: ['bars'],

$ git show HEAD:.../tests/workspace/fixture.mjs | sed -n '/export function adminStatus/,/^}/p'
  return { version: 'fixture', scoring: { scorer: true, checks: true, rescorable: true }, tenants: [{ id: 'fixture-tenant', name: 'Fixture' }] };

$ git show HEAD:.../web/js/app.js | sed -n '/async function renderExplorer/,/^}/p'
async function renderExplorer(container, record) {
  const module = await loadExplorer(record.explorer);
  module.render?.(container, document);
  ...
```

9-05 recorded 13 passing ops checks; the full shape and the 500 were proved by
test-side interception and the explorer had no abort seam.

After:

```
$ NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true \
  NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/workspace/ops.test.mjs
# tests 14
# pass 14
# fail 0
# skipped 0
```

```
$ ... node --test packages/yakka-analytics/tests/workspace/*.test.mjs
# tests 38
# pass 38
# fail 0
# skipped 0
```

Chromium 1243 was present, so no browser spec skipped; no fixed sleeps and no
animation/timing assertions were added. The product never branches on being
under test.

## Deviations

- The first admin browser spec previously asserted the minimal stub's absent
  fields. With the committed stub now full, that assertion became impossible;
  it now asserts the full values and that nothing is "Not supplied". This is
  stronger, not weaker. Absent-field mapping remains covered by the pure
  `absent fields are recorded as absent` check.
- The registry accepts `table: true` with an empty `charts` array rather than a
  `'table'` chart kind, as described above.

No other paths were touched.

## Gates

None. No external system or Cody action is required.
