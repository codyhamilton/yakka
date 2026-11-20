# Brief: phase3-03 — Dense component surfaces: tables, panels and explorer chrome consume the active-token family

Consumer: Phase 3 build worker.
Owned paths: `packages/yakka-analytics/web/css/artifact.css`, `cost.css`, `ledger.css`, `ops.css`, `plans.css`, `pulse.css`, `quality.css`, `scatter.css`, `sessions.css`, `tools.css`, `trends.css`, `workflow.css`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase3-03-component-density.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `phase3-01` for the canonical token names. They are pinned: `--yk-surface`, `--yk-surface-alt`, `--yk-text`, `--yk-muted`, `--yk-border`, `--yk-grid`, `--yk-focus`, `--yk-danger`, `--yk-warning`, `--yk-warning-bg`, `--yk-error-bg`, `--yk-selected`, `--yk-excluded`, plus the existing `--yk-chart-*` names. Do not invent a second family.
Runs alongside: `phase3-01`, `phase3-02` (disjoint paths), then `phase3-04`.
Budget: 20 files to read, about 300 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md` — Domain "Dense workspace and theme", lines 102–113; phase outcome 199–204. Binding quotes: "Compact ruled tables have 28–32 px rows, sticky headers and local horizontal scrolling. Long identifiers truncate with an accessible full value; keyboard focus and selected/error states remain visible."; "Panels use one thin border, square or at most 2 px corners, 6–8 px inner spacing and compact title/actions."; "Typical plot height is 200–260 px and responds to its panel's width."; "Panels, plots, table headers/alternation, controls, legends, tooltips, selections, axes and grids all derive from it [the token family]. … Remove white/light-only fallback surfaces from the data presentation path."
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md` — D16 (line 46): Ledger sticky headers are `rgb(255,255,255)` on `#1b2734` because `ledger.css` uses an undefined `--yk-surface`; alternate rows have light fallbacks too. Also "Theme and density proof" 87–91.
3. `docs/design/09-analytics-workspace-contracts.md` — lines 12–13.
4. Read each owned file. The concrete defects to fix are:
   - `ledger.css` 45, 60, 70, 83–88: `var(--yk-border|--yk-surface|--yk-row-alt|--yk-selected|--yk-excluded|--yk-focus, #light)` — six undefined family names with light literals; `thead th` is the D16 white header.
   - `pulse.css` 4–14, 30–42: undefined `--yk-text-muted`, `--yk-border` with light fallbacks.
   - `sessions.css` 3–35: legacy `--muted`/`--line`/`--focus`/`--selected`/`--excluded` with light literals, no table scroll container, 0.82 rem event table.
   - `plans.css` 7–40, 45–64, 123–165: `--yk-muted`/`--yk-border`/`--yk-warning`/`--yk-error-bg`/`--yk-mono` not in the canonical family; no table scroll container; 0.8–0.85 rem captions/cells.
   - `scatter.css` 15–26, 56–121: an entire `--wk-*` family; warning banner has `#fffbeb`/`#111827` light literals.
   - `artifact.css` 34–42, 117–139, 165–187: `--border`/`--surface`/`--accent`/`--success`/`--danger` with light fallbacks; 60vh body scroller is fine.
   - `trends.css` 17–27, 35–57; `cost.css` 8–53; `quality.css` 15–19; `workflow.css` 28–69; `tools.css`; `ops.css`: chart-token names are mostly the canonical ones but carry light literals and 0.85 rem labels; `ops.css` uses `--focus`/`--muted`/`--danger`.
5. Grep for the selectors before editing: `grep -nE "var\\(--|#[0-9a-fA-F]{3,8}|background:" packages/yakka-analytics/web/css/{artifact,cost,ledger,ops,plans,pulse,quality,scatter,sessions,tools,trends,workflow}.css`.
6. Read the explorers/panels only to confirm class names and table containers (grep, do not read whole files): `js/explorers/{ledger,sessions,plans}.js`, `js/panels/{ledger-table,pulse-strips,session-lanes,rank}.js`, `js/panels/panel-frame.js` (set `data-chart="table"`).

## Goal

Make every table, panel, explorer and control surface use the one inherited active-theme family from `phase3-01`, at the Phase 3 density: 28–32 px ruled rows, sticky headers in a local scroller, 12 px minimum data text, tabular right-aligned numbers, 6–8 px panel chrome and 200–260 px ordinary plots, with no white/light-only data surface left in either theme.

## Contract

Settled by DESIGN lines 102–113 and `docs/design/09` lines 12–13. This unit owns the light-DOM component CSS; it does not change tokens (owned by `phase3-01`), shell geometry (owned by `phase3-02`), chart internals, data, routes or requests.

- Tables: data rows 28–32 px; `thead th` sticky at the top of a local scroll container; local horizontal scrolling (`overflow-x:auto` on the wrapper/scroller, `max-width:100%`); numeric cells right-aligned and `font-variant-numeric:tabular-nums`; header/data text at least 12 px; full identifiers remain readable (wrap or local scroll; if truncating, the full value must remain accessible — do not add an inaccessible ellipsis).
- Panels/boxes: one thin border, 0–2 px radius, 6–8 px inner spacing. Ordinary chart panels 200–260 px tall; a treemap or scatter may use 240–260 px but not a 320 px decorative card.
- Controls: 24–28 px desktop; `(pointer: coarse)` 44 px; visible focus.
- Colour: table header/alternation, rows, selections/exclusions, banners, notes, controls, copy and empty/error/unauthorized text derive from the canonical tokens. No `#fff`/`#ffffff`/white RGB literal on a data-presentation surface; no undefined names (`--wk-*`, `--yk-text-muted`, `--yk-ink-muted`, `--yk-line`, `--yk-row-alt`, `--muted`/`--line`/`--focus`/`--selected`/`--excluded`/`--success` legacy literals). Use `--yk-surface-alt` for alternation.
- Responsive: below 900 px tables scroll locally, multi-column panel internals stack, and the document does not gain horizontal overflow.

## Changes

1. **Replace token names and literals** in every owned file with the canonical family. Keep semantic distinctions (warning banner, error background, selected/excluded rows, alternate rows) using the matching canonical token. A fallback is allowed only as `transparent`/`currentColor`; never a white/light data surface.
2. **Ledger D16.** `ledger-table thead th` background becomes `var(--yk-surface)` (dark `#1b2734`, light off-white); alternation `var(--yk-surface-alt)`; selected/excluded/focus use the canonical tokens. Keep the existing `.ledger-table-wrap` local scroll and `position:sticky`. Set row padding/line-height so a rendered row is 28–32 px; data text ≥12 px.
3. **Sessions/Plans/Ops/Pulse/Artifact tables.** Provide a local scroller without changing DOM: scope to `.workspace-panel[data-chart="table"] .workspace-panel-body{overflow:auto;max-height:70vh}` and add `thead th{position:sticky;top:0;background:var(--yk-surface);z-index:1}` to `.sessions-table`, `.plans-table`, `.plans-detail-table`, `.pulse-table`, `.ops-table`; for `.plans-detail-section`, give the section `overflow-x:auto`. Because `sessions.js`/`plans.js` already set `frame.element.dataset.chart = 'table'`, no JS change is needed. If a selector cannot reach a table, record it as a contradiction rather than editing the JS.
4. **Compact sizes.** Replace 0.8–0.9 rem table captions/cells with at least 12 px; reduce 0.5 rem+ paddings to 3–5 px vertical so rows land at 28–32 px; reduce chart min-heights in `cost.css`/`scatter.css`/`quality.css` to 200–260 px (ordinary plots; treemap may use 260). Compress `.pulse-note`, `.plans-detail-section`, `.artifact-*` boxes, `.ops-tenant`, `.scatter-marginal` padding to 6–8 px and radius ≤2 px. Keep the `scatter.css` 240 px marginal ranges as a secondary plot.
5. **Controls.** Set selects/buttons in these panels to 24–28 px desktop (`min-height:26px`), `@media (pointer: coarse){...min-height:44px}`; keep `:focus-visible` outlines.
6. **States.** Keep the existing text-plus-border cues for `[data-state=empty|error|unsupported|unauthorized|busy|timeout]`; ensure their text/background contrast from tokens in both themes.

### Keep untouched

- CSS class names and DOM structure; all JS, routes, requests, cursor/paging/sort semantics, board presets, URL state and saved-board identity.
- `charts.css`, chart JS, `app.css`, `workspace.css`, `index.html` (other units).
- Chart engines, data semantics, D01–D18 repairs and the panel state vocabulary.
- No new visualization, animation, transition or framework.

## Done evidence

Identify the failing check before changing code; report output before and after. Before: `grep` finds the light fallbacks/undefined names above; a dark Ledger header computes `rgb(255,255,255)` on a `#1b2734` panel.

- `grep -nE "#fff|#ffffff|rgba?\\(255,\\s*255,\\s*255|var\\(--wk-|var\\(--yk-text-muted|var\\(--yk-surface, #|var\\(--muted, #|var\\(--line, #" packages/yakka-analytics/web/css/{artifact,cost,ledger,ops,plans,pulse,quality,scatter,sessions,tools,trends,workflow}.css` → no matches on data-presentation surfaces; list any intentional non-data literal and why.
- A one-off Chromium probe under the ignored `.scratch/phase3-03/` using `startPlan29Harness()` + `loadBrowserEnvironment()` (real Go, tenant `plan29-a`, real data): open `/ledger`, `/plans`, `/sessions` in dark and light; wait `waitIdle`; in dark assert the first `thead th` computed background equals the resolved `--yk-surface` (`rgb(27,39,52)`), never `rgb(255,255,255)`; in light assert it equals the off-white token, not pure white. Measure the first `tbody tr` height (28–32 px), the scroller's `overflow-x` (`auto`/`scroll`) and the document `scrollWidth <= clientWidth + 1`.
- `node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/ledger.test.mjs packages/yakka-analytics/tests/plans-artifacts/plans-list.test.mjs packages/yakka-analytics/tests/scatter-sessions/sessions.test.mjs` → pass.
- `node --test --test-concurrency=1 packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs` → pass.

Run from the worktree with `GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192`; scratch stays under `.scratch/phase3-03/`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
