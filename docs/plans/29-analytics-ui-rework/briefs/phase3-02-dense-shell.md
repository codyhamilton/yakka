# Brief: phase3-02 — Full-width dense shell, 12-column grid, compact scope/coverage rows and inspector column

Consumer: Phase 3 build worker.
Owned paths: `packages/yakka-analytics/web/index.html`, `packages/yakka-analytics/web/css/app.css`, `packages/yakka-analytics/web/css/workspace.css`, `packages/yakka-analytics/web/js/app.js`, `packages/yakka-analytics/web/js/panels/panel-frame.js`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase3-02-dense-shell.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `phase3-01` for the canonical token names it maps (`--yk-surface`, `--yk-text`, `--yk-muted`, `--yk-border`, `--yk-grid`, `--yk-focus`, `--yk-danger`). The names are pinned in both briefs; do not invent alternatives.
Runs alongside: `phase3-01`, `phase3-03` (disjoint paths), then `phase3-04`.
Budget: 18 files to read, about 250 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md` — Domain "Dense workspace and theme", lines 102–113; the representative arrangement 115–127; phase outcome 199–204. Binding quotes: "Use full viewport width: no centered max-width container, auto horizontal margins or centering calculations on header, main or footer. Desktop gutters are 12 px; below 700 px they are 8 px. At 1920 px the main content width is 1896 px, and at 1366 px it is 1342 px."; "Default desktop text is 13 px with approximately 1.35 line height; primary data stays at least 12 px. Use tabular numerals and right-aligned numbers."; "Use a 12-column desktop workspace with 8 px gaps. Ordinary panels span four or six columns; tables/timelines can span all twelve."; "Panels use one thin border, square or at most 2 px corners, 6–8 px inner spacing and compact title/actions."; "Typical plot height is 200–260 px"; "Compact desktop targets may be 24–28 px where spacing preserves access; coarse-pointer controls retain 44 px targets."
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md` — "Theme and density proof" lines 87–91. Before: at 1920×1080 Chromium measured `main.getBoundingClientRect().width === 1120`; `css/app.css` defines `margin:4rem auto`, centered header/footer padding and an overridden 1120 px cap.
3. `docs/design/09-analytics-workspace-contracts.md` — lines 12–13.
4. `packages/yakka-analytics/web/css/app.css` — all 8 lines. Note line 1 holds the root/dark tokens, centered `main`, topbar/footer padding; line 6 is the later `main{max-width:1120px}` override.
5. `packages/yakka-analytics/web/css/workspace.css` — all 88 lines. Scope/coverage rows 4–8, question group 10–15, `panel-grid` 17, panel base 18–23, saved/follow 36–43, inspector 61–70, responsive 82–88.
6. `packages/yakka-analytics/web/index.html` — all 18 lines. Theme bootstrap must stay before styles and the module app.
7. `packages/yakka-analytics/web/js/app.js` — shell render 112–169 (scope/coverage), question paths 171–200, saved/follow 221–286, board layout 292–318 and 359–501, explorers 522–536, theme toggle 630–635.
8. `packages/yakka-analytics/web/js/panels/panel-frame.js` — all 194 lines. It owns the panel class names, `data-panel`, `data-chart`, state and `data-idle`; keep that vocabulary.
9. `packages/yakka-analytics/web/js/core/inspector.js` — read 1–45 and 140–170 only. It already sets `data-position="side"` above 899 px and `"sheet"` at/below 899 px.
10. `packages/yakka-analytics/tests/static-shell.test.mjs` — all 28 lines (index contract).
11. `packages/yakka-analytics/tests/workspace/acceptance.test.mjs` — read 1–120 and the shell-idle helpers; reuse its harness/`watchPage` patterns for a one-off geometry probe.

## Goal

Remove the centred 1120/1000 px column and the padded card spacing, and give the workspace a full-width dense operational shell: 12 px desktop/8 px narrow gutters, 13 px/1.35 type, compact scope/coverage/nav rows, a 12-column 8 px-gap panel grid, 6–8 px panel chrome, a compact inspector column, and compact Start/saved/Follow controls, without changing routes, URL semantics or chart data.

## Contract

Settled by DESIGN lines 102–113 and 199–204 and `docs/design/09` lines 12–13. The geometry is measurable, not aspirational:

- 12 px desktop gutters; 8 px below 700 px. At 1920 the content width is viewport minus 24 when no vertical scrollbar; the assertion must use `documentElement.clientWidth - 2*gutter` and also record the raw `clientWidth` so a scrollbar is not mistaken for a cap. There is no centred max-width, `margin:auto`, or `calc((100vw - 1120px)/2)`.
- Topbar, main and footer share one left edge and one right edge.
- 13 px/1.35 body; primary data at least 12 px; tabular numerals and right-aligned numeric cells (per-panel files own their tables; see `phase3-03`).
- 12-column desktop grid, 8 px gaps; ordinary panels `span 4` or `span 6`; table/timeline panels `span 12`; stack to one column below 900 px.
- Panels: one 1 px border, 0–2 px radius, 6–8 px inner spacing, compact header/title/actions; unit/time-basis/population in one short row (the classes already exist in `panel-frame.js`); verbose capability text stays in the existing disclosure.
- Typical plot height 200–260 px. `yk-chart`'s `CHART_HEIGHT` is 240 in `phase3-01`'s file; do not change it. Do not set a panel body min-height that exceeds 260 px for ordinary charts.
- Compact controls: 24–28 px desktop; `@media (pointer: coarse)` restores 44 px targets. Keep `:focus-visible` visible.
- Inspector: adjacent column on wide screens, overlay/bottom sheet below 900 px. It must not cover content on a 1920 layout when `data-position="side"`.
- No document horizontal overflow. Do not hide overflow with `overflow-x:hidden` on `body` as a mask; use `min-width:0` on grid/flex children and wrapping/local scroll.

## Changes

1. **`index.html`.** Add `<link rel="stylesheet" href="/css/charts.css">` after `workspace.css` and before the module script. This is the single document-level token family created by `phase3-01`; do not duplicate token values. Extend the existing nav with compact links to `/b/cost`, `/b/quality`, `/b/tools`, `/b/workflow`, `/b/compare`, `/b/scatter`, keeping Start, Pulse, Trends, Plans, Sessions, Ledger and Theme. Keep `/js/theme-bootstrap.js` first and no inline script.
2. **`app.css`.** Set `:root{font:13px/1.35 ...}` and keep the root/dark blocks but map the legacy names to the canonical family: `--surface:var(--yk-surface, #f4f6f8)`, `--bg:var(--yk-bg, #eef1f4)`, `--text:var(--yk-text, #18212f)`, `--muted:var(--yk-muted, #586579)`, `--border:var(--yk-border, #d6dde7)`, `--accent:var(--yk-focus, #176b87)`, `--danger:var(--yk-danger, #a3262a)` (and the dark equivalents). Remove the `main{max-width:1000px;margin:4rem auto;padding:0 1.25rem}` and the `main{max-width:1120px}` override. Use `--gutter:12px`; `main{margin:0;padding:8px var(--gutter) 24px;max-width:none;min-height:65vh}`, `.topbar`/`footer{padding-inline:var(--gutter)}`. Below 700 px set `--gutter:8px`. Compact `button` to 24–28 px desktop (`min-height:26px;padding:.15rem .45rem;border-radius:2px`) and restore 44 px under `(pointer: coarse)`. Remove the 0.6 rem card radii from shell surfaces (0–2 px).
3. **`workspace.css`.** Compact scope/coverage/follow rows: single flex row with `gap:.25rem .75rem`, `padding:4px 6px`, 12–13 px text, no thick card. `panel-grid` becomes `display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:8px;margin:8px 0`; add `.panel-grid > *{grid-column:span 4;min-width:0}`, `[data-chart="table"]{grid-column:span 12}`, and a wide-panel rule for timeline/lane panels (`span 12`) based on the existing `data-chart`/`data-panel` attributes; `@media(max-width:900px){.panel-grid{grid-template-columns:1fr}.panel-grid > *{grid-column:auto}}`. Panel chrome: `padding:6px 8px;gap:4px;border-radius:2px`. Compress question groups, saved boards and follow into ruled rows rather than cards. Keep the state border cues (error/unsupported/empty) as text-plus-border, and keep `:focus-visible`.
4. **Inspector column.** In `app.js`, wrap the board grid and inspector in a `div.workspace-layout` (grid first, inspector second) while leaving the selection tray after the layout. In `workspace.css`, make `.workspace-layout{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:8px}`; when `.workspace-inspector[data-position="side"][data-open="true"]` is a child, use `grid-template-columns:minmax(0,1fr) minmax(18rem,28rem)` and make the inspector `position:sticky;top:8px;height:auto;max-height:calc(100vh - 16px);overflow:auto` instead of fixed. Below 900 px restore the existing fixed bottom sheet. The `hidden` attribute must keep reserving no column.
5. **Compact Start/saved/Follow.** Reduce `question-group` padding to 6–8 px, question-path line height, saved-board form controls and the Follow bar to compact rows; do not remove any question path, saved-board action or Follow control.
6. **Presentation only in `app.js`.** The inspector wrapper and any class additions are presentation. Do not change request context, route dispatch, panel loading, event wiring, URL writes, selection/cohort logic or saved-board identity. `panel-frame.js` may gain presentation classes but must keep `workspace-panel`, `workspace-panel-*`, `data-panel`, `data-chart`, `data-state`, `data-idle` and every state string.

### Keep untouched

- `charts.css`, chart JS and the token family (owned by `phase3-01`); consume only.
- Per-panel/explorer CSS and table density (owned by `phase3-03`).
- Routes, board presets, panel registry, URL semantics, saved-board identity, read context, request wiring, Go code and D01–D18 repairs.
- The panel state vocabulary, `data-idle` settlement and the capability disclosure.
- No new route, navigation model, animation or chart engine.

## Done evidence

Identify the failing check before changing code; report output before and after. Before: `main` at 1920 is 1120 px and body font is 16 px/1.5.

- A one-off Chromium probe under the ignored `.scratch/phase3-02/` using `startPlan29Harness()` from `packages/yakka-analytics/tests/plan29/harness.mjs` + `loadBrowserEnvironment()` (real Go, tenant `plan29-a`, real data; no stubs): at 1920×1080 and 1366×900 open `/` and `/ledger`, wait `waitIdle`, and record `documentElement.clientWidth`, `#app.getBoundingClientRect()` left/width, computed `padding-left/right`, body `font-size`/`line-height`, `.panel-grid` computed `gap`, a `.workspace-panel` computed `padding`/`border-width`/`border-radius`, and `documentElement.scrollWidth` vs `clientWidth`. Expected after: main width = `clientWidth - 24` within 1 px at both widths (record the raw `clientWidth`); gutter 12 px; topbar/main/footer left edges equal; font 13 px/≈17.55 px; gap 8 px; panel padding 6–8 px; one 1 px border; radius ≤2 px; no document horizontal overflow. At 390×844 the gutter is 8 px and the grid is one column.
- Inspector: at 1920 open a mark/inspector and assert `data-position="side"` and that the inspector's left edge is at or right of the grid's right edge (adjacent, not overlapping); at 768 assert `data-position="sheet"`.
- Coarse pointer: launch a context with `hasTouch: true`; assert visible buttons have `getBoundingClientRect().height >= 44`.
- `node --test --test-concurrency=1 packages/yakka-analytics/tests/static-shell.test.mjs` → pass (external scripts, theme bootstrap order).
- `node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/acceptance.test.mjs` → pass (shell/route contract; stub API is fine for this regression, not for the geometry claim).

Run from the worktree with `GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192`; scratch stays under `.scratch/phase3-02/`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
