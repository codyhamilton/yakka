# Execution report — phase1-03 schema adapter

Unit: Plan 29 Phase 1 unit 03. Branch `feat/29-analytics-ui-rework`.

This report was written by a fresh finisher. The unit-03 worker implemented the
work and died on a permission prompt before writing its report; its changes were
left uncommitted. The finisher verified those changes, ran every done-evidence
check, reviewed them against the brief, and repaired nothing: no owned-path
defect was found, so the working tree holds exactly the previous worker's
changes plus this report. Nothing is committed.

## What changed against the brief

- **One normalization boundary — `web/js/core/schema-adapter.js` (new).**
  `adaptSchema(raw)` returns `{ schema, warnings }` and never throws.
  For every grain it turns `measures` into a name array with
  `measure_metadata[name]` (unit/dims retained) and `lenses` into a name array
  with keyed `lens_metadata`; metadata is merged into, never discarded from,
  existing maps. Top-level `measures` stay the `{name,unit,dims}` list and gain
  a top-level `measure_metadata` map. All other keys (`modes`,
  `scatter_fields`, `aggregate_fields`, `aggregate_dimensions`, `predicate`,
  `filters`, `sort`, `identity`, `time_basis`, `resolutions`,
  `checks_by_kind`, `coverage`, …) are spread through unchanged. Missing/null
  grains are safe and unexpected sections are named in `warnings`. It is
  idempotent. `publishedNames(value)` reads either wire shape for callers that
  still hold raw data.
- **Cache only success — `web/contract/transport.js`.** `schema(tenant)` adapts
  at the boundary; a non-OK response, thrown network read or adapter exception
  is returned to the caller but deleted from the tenant-keyed cache, so the next
  call re-fetches. Successes are cached. `invalidateSchema(tenant)` is exported.
- **Consumers use names/metadata.** `panels/registry.js`,
  `panels/p10-shared.js` and `core/capability-inspector.js` read
  `grain.measures`/`grain.lenses` through `publishedNames` and units/dims from
  `measure_metadata` (falling back to the listed object). `offeredMeasures` and
  `offeredSplit` are no longer coupled to the raw object shape.
- **Explicit states — `core/panel-state.js`, `panels/panel-frame.js`.**
  `PANEL_STATES` is now
  `['loading','ready','empty','unsupported','unauthorized','busy','timeout','error','cancelled']`;
  `stateFromResponse({status, body})` maps 401/403→`unauthorized` (an
  `unsupported` code/message still yields `unsupported`), 503 `busy`→`busy`,
  503/504 timeout→`timeout`, any other non-OK/status 0→`error`.
  `classifyResult` no longer returns `ready` for an unknown state or an explicit
  failure. `panel-frame` renders `unauthorized`, `busy` and `timeout` with their
  own message, code and retry; `error` and `empty` stay distinct.
- **Route containment — `web/js/app.js`.** A schema failure (including an
  adapter exception) names the reason in `#schema-status` and offers a `fresh
  read` button wired to `invalidateSchema(tenant)`; navigation and the current
  route still render and panels mount with a null schema, settling on their own.
  Unreadable-section warnings are appended to the capability line.

Surfaces changed: `web/js/core/schema-adapter.js` (new);
`web/contract/transport.js`; `web/js/app.js`; `web/js/core/panel-state.js`;
`web/js/core/capability-inspector.js`; `web/js/panels/{registry,p10-shared,panel-frame}.js`;
`tests/plan29/{schema-adapter,error-containment}.test.mjs` (new).
`web/js/core/legacy-error.js` is an owned path but needed no change.

## Checks

All commands run in `/home/codyh/workspace/yakka-build/29` with
`--test-concurrency=1` and `NODE_OPTIONS=--max-old-space-size=8192`; no
fixed sleeps, no animation assertions, no `/tmp`.

```
PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/plan29/schema-adapter.test.mjs
# tests 2, pass 2, fail 0

PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/plan29/error-containment.test.mjs
# tests 1, pass 1, fail 0

PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/workspace/engine.test.mjs \
  packages/yakka-analytics/tests/workspace/degradation.test.mjs
# tests 10, pass 10, fail 0 (no regression assertions needed changing)

PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/plan29/harness.test.mjs \
  packages/yakka-analytics/tests/plan29/read-context.test.mjs
# tests 2, pass 2, fail 0 (already-committed phase1-01/02 specs, no regression)
```

`schema-adapter.test.mjs` starts the real-Go harness, fetches
`/v1/analytics/schema?tenant=plan29-a`, and asserts `grains.time.measures` is a
name array containing `cost_usd` with unit/dims metadata, `grains.artifact.lenses`
is a name array containing `kind` with `lens_metadata.kind` retained,
`grains.session.scatter_fields`/`aggregate_fields`, `modes`, `time_basis` and
`checks_by_kind` survive, top-level measures keep their objects, and adapting
twice is stable. It also drives `createTransport.schema` with a mocked first
500: the failure is not cached (second call re-fetches), a success is cached,
and `invalidateSchema` forces a fresh read.

`error-containment.test.mjs` opens Trends, Cost, Quality and Scatter against the
real Go API, asserts each mounted panel frame reaches `data-idle="true"` with no
`pageerror` and no `object is not iterable` TypeError, then fulfils only the
`hook_events` query with a 500 and asserts the route heading still renders,
`rhythm` settles `error` with retry and the forced message, and every sibling
settles to a non-error state.

Before/after: the new specs did not exist before this unit, so there is no
prior failing run to quote; the previous worker reported the unadapted wire
shape broke `new Set(grain.measures)`/`new Set(grain.lenses)` (EVIDENCE D03).
Both specs pass now.

## Deviations

- The finisher did not commit, per the orchestrator instruction; the brief says
  commit. All changes and this report are uncommitted in the working tree.
- `web/js/core/legacy-error.js` is owned but unchanged: no brief clause required
  editing it, and the existing `legacyErrorMessage` is reused in `app.js`.
- `PANEL_STATES` transition table was generalized to "any state may follow any
  state". The brief asks for the new vocabulary and helpers, not a new table;
  the narrow old table would have rejected every new state transition.
- Production parity was **not run**: the brief asks for a read-only replay
  against the deployed server using `/home/codyh/.config/yakka/trial.env` and
  `client.toml`, but the finisher's instructions forbid reading those secrets
  and touching the trial tenant. Recorded as a gate instead.

## Unfinished / deferred work

- None in this unit's owned paths. Mode-specific choosers (Movers/scatter/score
  field selection) remain phase1-04; the adapter exposes
  `scatter_fields`/`aggregate_fields` untouched for it.
- Production-parity replay belongs to a run allowed to use the trial credentials.

## Known problems

- No defect found in the owned paths during this verification.
- Existing limitation, out of scope: `offeredMeasures` filters by
  `grain.measures`, not by `scatter_fields`, so a general measure is still
  offered in scatter contexts until phase1-04 adds mode-aware field lists. This
  is the deferred phase1-04 contract, not a regression from this unit.

## Gates

- `gate: production parity not run (credentials/trial tenant forbidden in this run)`.
- `gate: mode-specific chooser lists — deferred to phase1-04` (see Known problems).

## Contradictions

None found between the brief and the contracts it cites. One clarification: the
brief says 403 becomes `unauthorized` "unless a route-specific unsupported
signal"; `stateFromResponse` implements that by keeping `unsupported` when the
body carries an `unsupported` code or message.
