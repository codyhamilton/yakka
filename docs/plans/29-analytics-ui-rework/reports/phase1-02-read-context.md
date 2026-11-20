# Execution report — phase1-02 read context

Unit: Plan 29 Phase 1 unit 02. Branch `feat/29-analytics-ui-rework`. The
orchestrator commits this unit, so every change and this report are in the
working tree.

## What was built

- **One resolved read context.** New `web/js/core/read-context.js` exports
  `resolveReadContext({ me, state, now })` returning `{ base, authMode, tenant,
  tz, scope, window, paramsFor }`. It resolves a relative/All window exactly
  once (absolute `from`/`to`, or `all=1` with a frozen `to`), removes `win`,
  and builds request parameters with the selected tenant-independent scope:
  declared filters, supported excludes and cohorts. `paramsFor` never emits
  `win`.
- **Tenant on every follow-on read.** `app.js` resolves the context after
  `/v1/me`, passes `tenant`/`readContext` to board panels, coverage and
  explorers. Ledger first page, load-more and schema; Sessions first page,
  load-more, schema and conversation detail; Plans first page, load-more and
  plan detail; artifact content and `/v1/baselines` now carry the selected
  tenant. Baseline and artifact text/band caches include the tenant in their
  keys. No path retries under another tenant.
- **One scope for Pulse and Coverage.** `pulse-strips.scopeParams` now resolves
  through the read context; Pulse summary, the computed previous period, the
  design quality headline and Coverage's summary use the same resolved window.
  All-history sends `all=1&to=<frozen>` and has no previous period.
- **Coverage truth.** `coverage.js` replaces the `>1e12` heuristic with explicit
  unit conversions: event bounds are Unix seconds, `last_received_at` is Unix
  nanoseconds. It renders per-fact-type rows plus a retained-observation summary
  (latest event and age, latest usage separately, available range, scored/total
  hashes, sessions with/without a derived repo) and never claims completeness.
  The Start/board coverage strip reads `schema.coverage.facts` and shows the
  latest observation, its age, usage and range.
- **Empty finite window.** Coverage adds the
  `{ kind: 'window', label: 'No observations in this window — view all history' }`
  cause; `app.js clearPanelCause` sets `win=all` and clears `from`/`to`, then
  routes. It never widens automatically.

Surfaces/files: `web/contract/` transport/url-state/session-gate unchanged in
behaviour; `web/js/core/read-context.js` (new); `web/js/app.js`;
`web/js/panels/{pulse-strips,coverage,ledger-table}.js`;
`web/js/explorers/{ledger,sessions,plans,artifact-content,artifact}.js`;
`tests/plan29/read-context.test.mjs` (new). No Go, schema-normalization, panel
field-list, chart-theme or other panel files changed.

## Checks

Before the change the new spec failed at the first Ledger read:

```
explore carries tenant=<t-a>
+ actual: null   - expected: '<t-a>'
fail 1
```

Commands and final results:

```
cd /home/codyh/workspace/yakka-build/29 && PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto \
  NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/workspace/ledger.test.mjs \
  packages/yakka-analytics/tests/plans-artifacts/plans-list.test.mjs
# pass 26, fail 0

PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/read-context.test.mjs
# pass 1, fail 0

PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/pulse.test.mjs
# pass 13, fail 0 (regression check, not a brief-mandated check)
```

The new spec starts the real-Go two-tenant harness and asserts: direct
`?tenant=plan29-a` returns 200 and omitted tenant 403; Ledger, Sessions list +
continuation + detail, Plans list + continuation and an artifact baseline each
carry `tenant=plan29-a`; no windowed request sends `win`; each carries absolute
`from`/`to` or `all=1&to`; continuations keep the first page's `to`; Pulse
summary/previous/headline and Coverage share the scope; switching to
`plan29-b` reads B and never falls back to A; the Coverage panel has no
1970/overflow date; the Start strip shows an age; an empty finite window shows
the All-history action and clicking it changes only the URL window.

## Deviations

- The brief says "commit when done"; the orchestrator instruction says not to
  commit and to leave the report in the working tree. This report is uncommitted.
- The brief's citation `sessions.js:250-260` for `fetchConversation`'s tenant
  parameter is actually `panels/session-lanes.js:257`. `session-lanes.js` is not
  an owned path, so `sessions.js` passes `tenant` at its call sites instead.
- The All-history empty cause was added in Coverage's empty branch (the brief
  allows "pulse-strips.emptyCausesFor (or coverage's empty branch)"), because
  changing `emptyCausesFor` would alter an existing, out-of-scope Pulse unit
  assertion.
- The read context reaches panels through the existing wrapped `load` in
  `app.js`; `panels/panel-frame.js` is not an owned path and was not changed.

## Known problems / gates

- `gate: movers session_model 400 (D05)` — visiting Pulse still logs the known
  later-unit movers request `query?dim=session_model`. It is outside this unit
  and deliberately not fixed; the new spec excludes that one request shape.
- `gate: production parity not run` — the verification-time read-only replay
  against the deployed server with trial tenant `test` was not attempted in this
  build unit; no credentials, deployment or tenant mutation were used.
- `gate: latest-usage browser proof` — `schema.coverage.usage` is rendered when
  present, but the latest-usage browser proof belongs to phase1-05's check and
  may land after this unit.

## Unfinished work

None in this unit's owned paths. The remaining D04/D05/D07 surfaces belong to
later units; the read-context seam exported here is ready for phase1-03 to
import.
