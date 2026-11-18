# 10-04 — Tools preset

Status: `done with concerns`. `/b/tools` registers and settles its four frames,
its evidence passes, and the other P10 units in this worktree stay green. The
concerns are the shared-seam gaps and the one-line test adjustment under
**Problems / deviations**; none is a new grain, join, route or dependency.

## What changed

- `web/js/panels/p10-tools.js` — registers the shared `mix`, `treemap`, `rank`
  and `rhythm` panels (idempotent; `mix` was the only one not already
  registered) and the `tools` preset with canonical specs:
  `mix` = `hook_events` by `tool_kind` × `harness`, stacked;
  `treemap` = `hook_events`, parent `harness`, child `tool`;
  `rank` = `hook_events`, split `tool`, ranked;
  `rhythm` = `hook_events`, `weekday` × `hour_of_day` heatmap.
  Exports `toolsJoinGuard` (cost and repo refusals with `reason`/`try`),
  `toolsChooserModel` (only `hook_events` and non-repo tool lenses),
  `toolsTreemapChild`/`toolsTreemapSpec` (schema-aware `tool` → `tool_kind`
  fallback), `toolsMixSplits`, `TOOLS_NOTES` and
  `assertToolsRegistered(panels, lookup)` (throws when a named panel is not in
  the registry). Loads `/css/tools.css` in the browser only.
- `web/css/tools.css` (new) — notes/labels only; no colour value is declared.
- `tests/trends-quality/tools.test.mjs` (new) — four unit checks and one
  Chromium acceptance spec.
- `tests/trends-quality/cost.test.mjs` — one stale assertion corrected (see
  deviation 1); this is outside the brief's owned paths.

## Evidence

Before (workdir `packages/yakka-analytics`): no Tools spec existed
(`Could not find 'tests/trends-quality/tools.test.mjs'`), and the other P10
units were green:

```
$ NODE_PATH=… node --test tests/trends-quality/{trends,compare,quality,cost}.test.mjs
# tests 32  # pass 32  # fail 0
```

After:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test tests/trends-quality/tools.test.mjs
1..5
# tests 5
# pass 5
# fail 0
# skipped 0
```

```
$ NODE_PATH=… node --test tests/trends-quality/trends.test.mjs \
  tests/trends-quality/compare.test.mjs tests/trends-quality/quality.test.mjs \
  tests/trends-quality/cost.test.mjs
1..32
# tests 32
# pass 32
# fail 0
# skipped 0
```

Browser (Chromium under the same `NODE_PATH`): `/b/tools` settles `mix`,
`treemap`, `rank`, `rhythm` as `ready`; the treemap, rank and mix tables equal
`p10Query`/`buildMix` over the committed P10 fixture; changing rank split
`tool` → `tool_kind` regroups from `Bash`/`Read` to `shell`/`read` and the
surviving `hook_events` series key holds; a two-level mix fixture keeps
`unknown` and `(mixed)` as separate series and never `(other)`; the rhythm
frame has 168 weekday/hour rows and the shared-key note; a cost-by-tool treemap
renders `unsupported` with the `hook_events by tool` alternative; the module's
exact cost refusal and repo refusal are exercised in Chromium; `maxInFlight <= 4`;
no console, page or CSP error. `git diff --check` is clean.

Files read: DESIGN Phase 10/preset matrix, CONTRACTS 7.2/17.3/17.3.1/17.5,
`p10-shared.js`, `mix.js`, `treemap.js`, `rank.js`, `rhythm.js`,
`boards/{presets,board}.js`, `core/view-spec.js`,
`tests/workspace/{fixture,harness,stub-api}.mjs`,
`tests/trends-quality/{browser,fixture,cost}.test.mjs`, IMPLEMENTATION phase 3.

Fixture counts used (phase 1): tools `Bash`/`Read`, tool kinds `shell`/`read`,
harnesses `orca`/`claude-code`; 2 groups per categorical table; `rhythm` 7 × 24
= 168 cells.

## Problems / deviations

1. **The brief's "all four panels already registered" premise is false, and its
   owned-path list excludes the file that has to change.** 10-03 deliberately
   did not register `mix` (`MIX_PANEL` is exported for Tools), and
   `cost.test.mjs` asserted `hasPanel('mix') === false` against the *global*
   registry. A Tools preset that names `mix` cannot load without registering it.
   I registered `mix` in this unit and changed that one assertion to the
   assertion's stated intent, `COST_PANELS.some(panel => panel.id === 'mix') ===
   false` (mix is not part of Cost). This is the only outside-path edit; without
   it the required "other P10 units stay green" evidence is impossible.
2. **The exact cost refusal wording lives in this module, not in the rendered
   panel.** The shared `treemap`/`mix` (10-03) own cost-by-tool and say
   `cost is not derived from hook events or tool counts` with the same
   `hook_events by tool` alternative. The brief's exact sentence
   `hook_events and cost_usd are different measures; use hook_events by tool or
   cost by model/harness` is implemented in `toolsJoinGuard`/`toolsChooserModel`
   and proven in Node and in Chromium via the module, but the shared panels
   cannot adopt it without editing another unit's path.
3. **The repo rule cannot be applied by the shared chooser/loader.** For
   `hook_events`, `/schema` publishes `repo_id`, and `mix`/`treemap`/`rank` do
   not refuse it. `toolsJoinGuard` and `toolsChooserModel` return
   `hook facts carry no repo_id` / `try: harness`, and the test proves that in
   Chromium; the shared panels still offer the lens. Reported as a shared seam,
   not edited. A genuine shared fix is owed before a UI caller can rely on it.
4. **Treemap fallback is a helper, not a load-time behaviour.** The registered
   static spec names `tool` (the real schema publishes it). If a server omits
   `tool`, `toolsTreemapChild`/`toolsTreemapSpec` return `tool_kind` and are
   tested, but the shared `treemap` cannot consult the helper at assembly time;
   it would name `tool` unsupported instead of falling back.
5. **Preset capability notes are data, not rendered.** `TOOLS_NOTES` is attached
   to the `tools` preset (`lookupPreset('tools').notes`) because the shared
   capability inspector reads only `panel.caveats`; surfacing per-preset notes
   would need an inspector/app seam this unit does not own.

Contradiction named, not resolved silently: DESIGN/CONTRACTS say hook facts
carry no `repo_id`, while `/schema` still publishes `repo_id` for `hook_events`.
The module refuses it; the server and shared panels do not.

## Gates

- `playwright-core` and the Chromium 1243 cache are outside the worktree under
  `NODE_PATH`; the spec skips with a named reason if absent (they were present).
- No animation-timing or motion-feel test was added or changed.
- No Go change, no new route/grain/join/dependency, no client-side join, no
  deploy or secret access.

## Commit

Committed to `feat/20-analytics-reset` with a plain-summary title; this report is
included. No push, merge, deploy, rebase, or other branch/worktree touched.
