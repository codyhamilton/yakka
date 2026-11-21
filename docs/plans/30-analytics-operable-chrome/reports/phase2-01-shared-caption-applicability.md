# Handoff — phase2-01 shared caption, filter-applicability and panel-view infrastructure

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- New `web/js/panels/captions.js`: `registerCaption`, `clearCaptions`, `captionFor`, `CAPTION_TEMPLATES` for all sixteen named chart families and the controlled `LABELS` measure/entity/bucket/unit dictionary from DESIGN.md line 161. Captions accept a literal string or a `({panel, spec, scope, schema, result})` function. A missing, non-string, empty or raw snake_case caption returns the explicit refusal `No plain-language caption is registered for {id}.`
- New `web/js/core/filter-applicability.js`: pure `applicability({panel, spec, scope, schema, ignoredFilters})` returning `{applicable, labels, message, supportedFilters, unsupportedFilters}`. Supported filters are the chosen measure's published dims intersected with the panel's declared `applies`/`scopeFilters` route descriptor; response `ignored_filters` are added to the unsupported set. `repo_id`/`session_repo` map to `repository`, `kind` to `document kind`, other filters to their visible name; labels are deduplicated and sorted. Exports `UNSUPPORTED_FILTER_MESSAGE`, `refusalMessage`, `filterLabel` and `applicabilityState`.
- `web/js/core/panel-state.js`: added one `applicabilityState()` classification that reuses `unsupportedState` and the existing state vocabulary; it carries the exact refusal `message`, sorted `labels` and unsupported filters. No new state names.
- `web/js/panels/registry.js`: optional `caption` (string/function), `applies` and `filterExceptions` descriptors are validated only for shape. No new required fields; `validateRegistry` does not require a caption and existing chart/required-field validation is unchanged.
- `web/js/panels/panel-frame.js`: dedicated `.workspace-panel-caption` in the order title → caption → controls → body → population/coverage, re-rendered at frame creation and every load. On an applicability refusal it clears the body, sets `data-state="unsupported"` with the settled idle flag, keeps the caption, renders the exact F sentence and a focusable `Edit filters` button supplied by `editFilters`/`onEditFilters`. Panels that declare `applies`/`scopeFilters` are checked before fetch and again against response `ignored_filters`; other panels keep their current behaviour.
- `web/js/panels/p10-shared.js`: added `panelViewsEnabled(panel)` (false only for `panel.table === true` with no charts) and `mountPanelViews({panelId, chart, table, doc, defaultView})`. The host carries `data-view`, defaults to chart, and switches chart/table locally with `Show table`/`Show chart` without touching the transport. `measureMeta`, `chooserModel` and `renderChooser` are unchanged.
- `web/js/charts/table.js`: `tableModel`/`createTable` now accept an explicit `columns` array (`key`, `label`, `unit`, `numeric`) and `select: false`. The default series model and existing callers are unchanged; explicit rows keep `—` for unavailable values and `0` as numeric zero.
- New tests `tests/operable-chrome/captions-unit.test.mjs` and `tests/operable-chrome/filter-applicability-unit.test.mjs`.

## Evidence before and after

Before (failing check, modules absent):

```
node --test tests/operable-chrome/captions-unit.test.mjs tests/operable-chrome/filter-applicability-unit.test.mjs
ERR_MODULE_NOT_FOUND: .../web/js/panels/captions.js
ERR_MODULE_NOT_FOUND: .../web/js/core/filter-applicability.js
```

After:

```
node --test tests/operable-chrome/captions-unit.test.mjs tests/operable-chrome/filter-applicability-unit.test.mjs
# tests 13  # pass 13  # fail 0

node --test tests/workspace/engine.test.mjs tests/operable-chrome/activity-population-unit.test.mjs
# tests 14  # pass 14  # fail 0

node --test tests/operable-chrome/*.test.mjs
# tests 37  # pass 37  # fail 0
```

Observable coverage in the unit tests: every template expands with dictionary labels and no snake_case; repository/document-kind labels and alphabetical order; the exact sentence `This chart cannot apply document kind, source. Change the filters to view it.`; a missing caption refusal; a synthetic frame that refuses before fetch with an empty body and the caption still visible; and a local chart/table toggle that makes zero requests.

## Check IDs owned by this unit

| ID | Result | Evidence |
|---|---|---|
| F1–F3, F5–F6 mechanism (refuse unsupported active filters, no marks) | pass | `applicability` + `applicabilityState`; frame test asserts empty body, `data-state="unsupported"`, exact sentence. Per-screen proofs belong to the panel units. |
| F4 mechanism (metadata exceptions descriptor) | pass | `panel.applies`/`scopeFilters` and `filterExceptions` accepted by the registry without invention; helper consumes the descriptor. |
| P8 (local display/action state; chart and details default) | pass | `mountPanelViews` defaults to chart and never fetches; no details change. |
| P10 (one caption above every chart; controlled dictionary; explicit refusal; exact templates) | pass | `captions-unit` template, dictionary and refusal tests. |
| T / T5 (table view, units, caption survives errors/refusal) | pass | explicit `columns` + `select: false` model preserves units and `—`; frame keeps the caption through refusal. Row height/alignment remain CSS-owned and untouched. |
| V3 token helper | pass | existing `readToken` in `charts/styles.js` already reads computed tokens; no behaviour change needed. |

Report rubric: `r.done_verifiable` pass (commands above), `r.departures_named` pass (below), `r.unfinished_actionable` pass (below), `r.problems_plain` pass, `r.nothing_unusable` pass.

## Departures and interpretation

- The frame applies applicability automatically only to panels that declare `applies`/`scopeFilters`. Applying it to every existing panel would pre-empt the Phase 1 comparison reads that still send `kind` (for example `previous-filter-scope.test.mjs`), so unmodified panels keep their current behaviour until their owning phase registers a caption and declaration. This is the "panels adopt the shared view helper in their own units" split in the brief.
- Where `{labels}` is a list, the helper joins with `", "` (sorted) because the design fixes the sentence but not a conjunction.
- `charts/legend.js` and `charts/styles.js` were not edited: no new legend behaviour was needed and `styles.readToken` already satisfies the V3 token-reader example.

## Unfinished work

None in this unit. Per-panel literal captions/defaults, panel declarations and browser proofs are owned by the later panel units.
