# Brief: phase1-03 — Schema adapter boundary and route error containment

Consumer: the execute worker for phase1-03; phase1-04 consumes the adapted per-mode fields; every board relies on the error containment proved here.
Owned paths: `packages/yakka-analytics/web/js/core/schema-adapter.js` (new), `packages/yakka-analytics/web/js/core/panel-state.js`, `packages/yakka-analytics/web/js/core/legacy-error.js`, `packages/yakka-analytics/web/js/core/capability-inspector.js`, `packages/yakka-analytics/web/contract/transport.js`, `packages/yakka-analytics/web/js/app.js`, `packages/yakka-analytics/web/js/panels/registry.js`, `packages/yakka-analytics/web/js/panels/p10-shared.js`, `packages/yakka-analytics/web/js/panels/panel-frame.js`, `packages/yakka-analytics/tests/plan29/schema-adapter.test.mjs` (new), `packages/yakka-analytics/tests/plan29/error-containment.test.mjs` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-03-schema-adapter.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-01 (harness), phase1-02 (read context/transport seam).
Runs alongside: phase1-06.
Budget: read about 10 files, change about 250 lines, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:84-86` — normalization, mode-specific fields, and the "failed schema/adapter request cannot abort the whole route or remain cached" contract.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:33` — D03 and the exact failing lines; `:56-75` — every surface affected.
3. `docs/design/09-analytics-workspace-contracts.md:10` — heterogeneous wire schema and explicit error states.
4. `packages/yakka/internal/serve/analytics_query.go:18-52` — real `/schema.measures` objects and `grains.time.measures`/`grains.session.scatter_fields`; `packages/yakka/internal/serve/analytics_artifact_schema.go:140-190` — artifact `lenses` is a keyed metadata object.
5. `packages/yakka-analytics/web/contract/transport.js:22-80` — schema cache at `:23,75-78` caches any promise including failures.
6. `packages/yakka-analytics/web/js/panels/registry.js:67-88` — `new Set(grain.measures)`/`new Set(grain.lenses)`; `p10-shared.js:43-111` — `schemaGrain`, `measureMeta`, `offeredMeasures`, `offeredSplit`; `capability-inspector.js:49-70`.
7. `packages/yakka-analytics/web/js/core/panel-state.js:1-110` — current six-state vocabulary and classification; `panels/panel-frame.js:73-160` — state rendering and loader catch; `app.js:556-567` — schema failure only writes a status line and still renders.
8. `packages/yakka-analytics/tests/workspace/engine.test.mjs:95-120` and `tests/workspace/degradation.test.mjs:40-65` — current state assertions; `tests/plan29/harness.mjs` — real-Go harness.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Normalize the one heterogeneous `/schema` wire shape at a single client boundary and make a schema/adapter failure a visible, retryable panel/route state rather than a route abort or a cached capability result.

## Contract

- `DESIGN.md:84`: "Normalize the existing heterogeneous schema at one client boundary. Time measures may be `{name,unit,dims}` objects; other measures may be names; artifact lenses may be keyed metadata objects. Consumers receive explicit name collections plus their metadata. Preserve per-measure dimensions and per-mode field sets. A measure available in list/aggregate mode is not automatically available in scatter mode. Do not rewrite the public wire shape solely to fit the old stub."
- `DESIGN.md:86`: "A failed schema/adapter request cannot abort the whole route or remain cached as a successful capability result. Keep navigation available, isolate panel errors, and offer a fresh read. States distinguish loading, ready, genuinely empty, unsupported, unauthorized, busy, timeout and other errors; an error is never rendered as zero or 'no data'."
- `09-analytics-workspace-contracts.md:10`: "Choosers respect per-mode fields and per-measure dimensions; general session measures do not imply scatter support. Failed reads are explicit errors/refusals, never empty observations."

## Changes

### Adapter — `core/schema-adapter.js`

- Export `adaptSchema(raw)` (idempotent) returning a new object with:
  - top-level `measures` kept as the existing `{name,unit,dims}` list plus `measure_metadata[name]` for consumers that want units/dims.
  - for every `grains[g]`: `measures` becomes an array of names; each original object contributes its `name` and metadata into `measure_metadata`; `lenses` becomes an array of names and keyed metadata objects contribute keys into `lens_metadata`. Merge, never discard, existing metadata.
  - preserve `modes`, `scatter_fields`, `aggregate_fields`, `aggregate_dimensions`, `predicate`, `filters`, `sort`, `identity`, `time_basis` and every other key unchanged.
  - preserve `resolutions` and `checks_by_kind`; do not synthesize a route-specific entry here (phase1-06 publishes it).
  - treat `null`/missing grains safely; never throw on an unexpected shape. Return `{schema, warnings}` or an equivalent explicit result so the shell can name an unreadable section.
- `transport.schema(tenant)` fetches, adapts and caches **only** a successful adapted schema. A non-OK response, network failure or adapter exception is returned to the caller but is not stored; a later call performs a fresh read. Keep the cache keyed by tenant. Export `invalidateSchema(tenant)`.

### Consumers

- `registry.js`, `p10-shared.js`, `capability-inspector.js`, scatter/score panels read the adapted `grain.measures`/`grain.lenses` name arrays and the metadata maps. `offeredMeasures`/`offeredSplit` use names and `measure_metadata[name].dims`; a mode-specific field list (`scatter_fields`, `aggregate_fields`) is never replaced by the general measure list.
- `app.js`: a schema failure leaves navigation and the current route rendered; the status line names the failure and offers a fresh read. Panels still mount and each settles to `unsupported`/`error` as appropriate; the route does not throw.

### States — `core/panel-state.js` and `panel-frame.js`

- Extend `PANEL_STATES` to `['loading','ready','empty','unsupported','unauthorized','busy','timeout','error','cancelled']` and add helpers used by loaders: `stateFromResponse({status, body})` mapping 401→`unauthorized`, 403→`unauthorized` (unless a route-specific unsupported signal), 503 with `code:'busy'`→`busy`, 503/504 with `query_timeout`/timeout→`timeout`, other non-OK→`error`.
- `panel-frame` renders each new state with its own message and retry; `error` and `empty` remain distinct. No missing/errored value is defaulted to `0` or “no data”.
- `classifyResult` must not turn `{error}` or a non-ready payload into `ready`.

## Keep untouched

- Go server output and wire field names.
- Panel field choices (Movers dims, scatter fields, score fields, score-series buckets) — phase1-04.
- Read context, tenant propagation and coverage conversions — phase1-02.
- Charts, theme and dense layout.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: this repo uses `node --test` (no vitest); keep `--test-concurrency=1` and `NODE_OPTIONS=--max-old-space-size=8192` within the 8G envelope. Browser specs wait on real end states, with no fixed sleeps or animation/timing assertions. Write only inside the worktree's ignored `.scratch/`, never `/tmp`.

- `cd /home/codyh/workspace/yakka-build/29 && PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/schema-adapter.test.mjs` → pass. It fetches the real `/schema?tenant=plan29-a` through `phase1-01`'s harness and asserts `grains.time.measures` is a name array with `cost_usd` present, `grains.artifact.lenses` is a name array with `kind` present and `lens_metadata.kind` retained, `grains.session.scatter_fields` survives, and per-measure `dims` survive. It also asserts a failed schema response is not cached (second call re-fetches).
- `… PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/error-containment.test.mjs` → pass. Against the real Go API, open Trends, Cost, Quality and Scatter; no `pageerror`, no `TypeError: object is not iterable`, and each board has mounted panel frames. Then force one panel route to 500 (request interception) and assert the route still renders, that panel shows `error` with retry, and other panels settle.
- Regression: `… node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/engine.test.mjs packages/yakka-analytics/tests/workspace/degradation.test.mjs` → pass or the assertions are updated only where the new state names are contract changes, not to hide a failure.
- Production parity (verification-time read-only): fetch `/v1/analytics/schema` from the deployed server with trial tenant `test` using `/home/codyh/.config/yakka/trial.env` + `client.toml` and confirm the adapter handles its shape. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
