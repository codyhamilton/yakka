# phase3-02 — Full-width dense shell: execution report

## What was built

The centred 1120/1000 px column and padded card shell are gone. The workspace now uses the full viewport with a shared left/right edge, 12 px desktop and 8 px narrow gutters, 13 px/1.35 default type, compact scope/coverage/nav rows, a 12-column 8 px-gap panel grid, 6–8 px panel chrome, a compact adjacent inspector column and compact Start/saved/Follow controls.

Surfaces changed (only the brief's owned paths):

- `packages/yakka-analytics/web/index.html` — loads `/css/charts.css` after `workspace.css`; compact nav adds Cost, Quality, Tools, Workflow, Compare, Scatter while keeping Start, Pulse, Trends, Plans, Sessions, Ledger and Theme; theme bootstrap still first.
- `packages/yakka-analytics/web/css/app.css` — `font:13px/1.35`; legacy token names mapped to the canonical `--yk-*` family with light/dark fallbacks; `--gutter:12px` (8 px below 700 px); no `main` max-width or auto margin; topbar/main/footer use the gutter; 24–28 px desktop buttons with 2 px radius; shell card radii reduced to 2 px.
- `packages/yakka-analytics/web/css/workspace.css` — compact single-row scope/coverage/follow rows; ruled (not card) question/saved-board rows; `panel-grid` = `repeat(12,minmax(0,1fr))` with 8 px gap, ordinary panels `span 4`, table panels (`data-chart=""`) and lane/timeline panels (`data-chart="lanes"`) `span 12`, one column below 900 px; panel chrome `padding:6px 8px`, `gap:4px`, radius 2 px; `.workspace-layout` grid/inspector pair; inspector sticky side column and fixed bottom sheet below 900 px; `@media(pointer:coarse)` restores 44 px targets.
- `packages/yakka-analytics/web/js/app.js` — board grid and inspector wrapped in `div.workspace-layout`; selection tray remains after the layout. No request, route, loading, URL or selection logic changed.
- `packages/yakka-analytics/web/js/panels/panel-frame.js` — status/population/basis grouped in a presentation-only `.workspace-panel-meta` row. Existing `workspace-panel*` classes, `data-panel`, `data-chart`, `data-state`, `data-idle` and all state strings are unchanged.

No token values were defined; only consumed. `charts.css`, chart JS, per-panel CSS and Go code were not edited.

## Test commands and results

Run from the worktree with `GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true`.

Before (probe on `HEAD` shell CSS at 1920×1080):

- `main` width 1120 px, content 1080 px, `margin-left:400px`, body `16px/24px`.

After:

1. Geometry probe (real Go harness `startPlan29Harness()`, tenant `plan29-a`, `/b/pulse?win=1d` and `/ledger`; script in ignored `.scratch/phase3-02/geometry.mjs`):

```
GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true node .scratch/phase3-02/geometry.mjs
status: 0; failures: []
```

2. `node --test --test-concurrency=1 packages/yakka-analytics/tests/static-shell.test.mjs` → **PASS** 3/3.
3. `node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/acceptance.test.mjs` → **PASS** 5/5 (139.5 s).

Measured geometry (after, no document horizontal overflow):

| Viewport | Route | clientWidth | scrollWidth | gutter | main left / content | gutter pads | body font / line | grid | panel |
|---|---|---|---|---|---|---|---|---|---|
| 1920×1080 | `/b/pulse?win=1d` | 1920 | 1920 | 12 px | 0 / 1896 px | 12 / 12 px | 13 px / 17.55 px | 8 px gap, 12 tracks | 6px 8px, 1 px border, 2 px radius |
| 1920×1080 | `/ledger` | 1920 | 1920 | 12 px | 0 / 1896 px | 12 / 12 px | 13 px / 17.55 px | n/a | 6px 8px, 1 px border, 2 px radius |
| 1366×900 | `/b/pulse?win=1d` | 1366 | 1366 | 12 px | 0 / 1342 px | 12 / 12 px | 13 px / 17.55 px | 8 px gap, 12 tracks | 6px 8px, 1 px border, 2 px radius |
| 1366×900 | `/ledger` | 1366 | 1366 | 12 px | 0 / 1342 px | 12 / 12 px | 13 px / 17.55 px | n/a | 6px 8px, 1 px border, 2 px radius |
| 390×844 | `/b/pulse?win=1d` | 390 | 390 | 8 px | 0 / 374 px | 8 px | 13 px | 8 px gap, 1 track (374 px) | — |

Topbar and footer left edges were 0 at both desktop widths, equal to `main`. Inspector at 1920: `data-position="side"`, grid right 1536 px, inspector left 1544 px (adjacent, 8 px gap), columns `1524px 364px`. At 768: `data-position="sheet"`, full-width bottom sheet (`left:0`, `width:768`, `bottom:1024`). Coarse context (`hasTouch:true`, 390×844): every visible button ≥44 px (Theme = 44 px).

## Deviations from the brief

- **Not committed.** The work instruction for this run says the orchestrator commits the unit and the worker must leave changes and the report in the working tree. The brief's “commit when done” is overridden; no commit, push, merge or branch change was made.
- **Inspector opened through the frame's real `inspect` event.** The 1920 probe dispatches the frame event with a synthetic detail rather than clicking a drawn mark; the app's real inspector element, `data-position` logic, grid pairing and geometry are what is measured.
- **Shell-level containment added in `workspace.css`.** At 390 px `.pulse-coverage` (pulse.css, phase3-03's file) had a 447 px min-content grid track inside a 356 px panel body, producing 464 px document `scrollWidth`. Two presentation-only rules, `.workspace-panel-body > *` and `.workspace-panel-body > * > * { min-width:0 }`, let that grid shrink without editing `pulse.css`. This is the contract's prescribed `min-width:0` containment, not an `overflow-x:hidden` mask.
- **`panel-frame.js` gained a `.workspace-panel-meta` wrapper** so unit, time basis and population render in one short row. This is a presentation class addition permitted by the brief; no state vocabulary changed.

No contradiction was found between the brief and the design/contract text it cites.

## Unfinished / deferred

- None for this unit. Per-panel table density and panel-specific CSS remain `phase3-03`; cross-phase visual acceptance (all boards, 200% zoom, theme repaint) remains `phase3-04`.

## Known problems

- Dense table row height and numeric alignment are not complete on every panel until `phase3-03` lands; this unit only supplies the containing grid and compact frame.
- The coarse-pointer assertion was exercised on `/` (the only always-available visible button is Theme). The 44 px rule targets all `button` elements plus chip/inspector/tray actions and capability summaries, but board-level buttons were not separately enumerated.
- The geometry probe lives only in ignored `.scratch/phase3-02/` and is not committed, as the brief directs.

## Gates

- Geometry (real Go, 1920/1366/390, inspector, coarse): **PASS** (`failures: []`).
- Static shell contract: **PASS** 3/3.
- Workspace acceptance regression: **PASS** 5/5.
- Owned-path check: only `web/index.html`, `web/css/app.css`, `web/css/workspace.css`, `web/js/app.js`, `web/js/panels/panel-frame.js` changed by this unit.
