# Report: phase3-03 — Dense component surfaces

Status: **done with concerns**.

## What was built

Every panel/explorer table, panel box and control in the unit's 12 CSS files now
consumes the canonical active-theme family defined by `phase3-01`
(`--yk-surface`, `--yk-surface-alt`, `--yk-text`, `--yk-muted`, `--yk-border`,
`--yk-grid`, `--yk-focus`, `--yk-danger`, `--yk-warning`, `--yk-warning-bg`,
`--yk-error-bg`, `--yk-selected`, `--yk-excluded`, plus the existing
`--yk-chart-*` names). No fallback literal remains: the only fallbacks left in
these files are none (every `var()` names a token defined in `charts.css`).

- **Ledger D16 fixed.** `ledger-table thead th` background is `var(--yk-surface)`
  (dark `#1b2734`, light off-white `#f4f6f8`); alternate rows use
  `var(--yk-surface-alt)`; selected/excluded/focus use the canonical tokens.
  `.ledger-table-wrap` keeps its local `overflow-x:auto` and sticky header.
- **Dense rows.** Table data text is 12 px, rows 29–31 px, numeric cells
  right-aligned with `font-variant-numeric:tabular-nums`.
- **Sticky headers + local scrollers.** Added `thead th{position:sticky;top:0;
  background:var(--yk-surface);z-index:1}` to `.sessions-table`, `.plans-table`,
  `.plans-detail-table`, `.pulse-table`, `.ops-table`, `.p10-cost table`.
  Added `.workspace-panel[data-chart="table"] .workspace-panel-body{overflow:auto;
  max-height:70vh}` in `ledger.css`, `plans.css`, `sessions.css`, `pulse.css`,
  `ops.css` (per-route CSS is lazy-loaded by the explorers/panels, so the rule
  must be present in each file that renders a table panel). `.plans-detail-section`
  gets `overflow-x:auto`; `.ledger-table-wrap` keeps its own scroller.
- **Panel chrome.** Radii reduced to 0–2 px and inner spacing to 6–8 px on
  `.ledger-table-wrap`, `.river-follow`, `.scatter-marginal`,
  `.p11-scatter-banner`, `.artifact-version-mark`, `.artifact-body`,
  `.artifact-content-status`, `.ops-tenant`, `.p12-timeline-more button`,
  `.plans-overlap-banner`, `.plans-detail-section` and notes/banners.
- **Plot heights.** `cost.css` treemap 320→260 px; `scatter.css` scatter
  280→240 px; `quality.css` plot min-height 200 px; existing 220/240 px plots
  left in range. `.scatter-marginal` ranges stay a secondary 140 px plot and the
  240 px grid column is untouched.
- **Controls.** Panel/chooser selects `min-height:26px`, in-row action buttons
  24 px (see departures), `@media (pointer:coarse)` raises selects/buttons to
  44 px, `:focus-visible` outlines preserved.
- **States.** Existing `[data-state=…]` text/border cues kept; their colours are
  now `--yk-muted`/`--yk-danger`/`--yk-text`, readable in both themes.

Surfaces/files: `web/css/{artifact,cost,ledger,ops,plans,pulse,quality,scatter,
sessions,tools,trends,workflow}.css`. No JS, DOM, route, request, paging/sort,
board preset or URL-state change.

## Done-evidence checks

All commands from the worktree root with
`GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192`.

### Grep gate

```
grep -nE "#fff|#ffffff|rgba?\(255,\s*255,\s*255|var\(--wk-|var\(--yk-text-muted|var\(--yk-surface, #|var\(--muted, #|var\(--line, #" \
  packages/yakka-analytics/web/css/{artifact,cost,ledger,ops,plans,pulse,quality,scatter,sessions,tools,trends,workflow}.css
```

- Before (HEAD versions of the owned files): **28 matching lines**.
- After: **0 matches** (exit 1). An additional grep for any
  `#hex`/`rgb()`/`rgba()` literal in the owned files also returns **0**, so
  there is no intentional non-data literal to list.

### Chromium probe (real Go harness, tenant `plan29-a`)

Script: ignored `.scratch/phase3-03/probe.mjs` (uses `startPlan29Harness()` +
`loadBrowserEnvironment()`; measures computed styles only, never row contents).
Routes `/ledger`, `/plans?win=all`, `/sessions?win=all`.

Measured after (identical geometry in dark and light):

| route | theme | header bg | resolved `--yk-surface` | row px | text | scroller | doc overflow |
|---|---|---|---|---|---|---|---|
| /ledger | dark | `rgb(27,39,52)` | `#1b2734` | 29 | 12px | auto | 0 |
| /ledger | light | `rgb(244,246,248)` | `#f4f6f8` | 29 | 12px | auto | 0 |
| /plans?win=all | dark | `rgb(27,39,52)` | `#1b2734` | 31 | 12px | auto | 0 |
| /plans?win=all | light | `rgb(244,246,248)` | `#f4f6f8` | 31 | 12px | auto | 0 |
| /sessions?win=all | dark | `rgb(27,39,52)` | `#1b2734` | 31 | 12px | auto | 0 |
| /sessions?win=all | light | `rgb(244,246,248)` | `#f4f6f8` | 31 | 12px | auto | 0 |

Dark Ledger first `thead th` is **never** `rgb(255,255,255)`; light is the
off-white token, not pure white. Dark alternate Ledger rows are
`rgb(34,49,65)` (`#223141` = `--yk-surface-alt`).

Before (HEAD CSS, same harness/tokens): the grep found the light fallbacks;
Ledger dark alternate rows were `rgb(247,248,249)` (light literal `--yk-row-alt`
fallback leaking into the dark theme); rows were **61.8 px** Ledger,
**41.69 px** plans and **34.78 px** sessions; text was **11.7 px**; plans and
sessions headers had transparent backgrounds and no local scroller
(`overflow-x:visible`). (The dark Ledger *header* already resolved to
`#1b2734` in this tree because `phase3-01`'s token is now defined; the original
D16 white header required the token to be undefined. The defect this unit owns —
undefined sibling names and light fallbacks on alternation/rows — is still
visible in the before run and gone after.)

### Test gate

```
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/workspace/ledger.test.mjs \
  packages/yakka-analytics/tests/plans-artifacts/plans-list.test.mjs \
  packages/yakka-analytics/tests/scatter-sessions/sessions.test.mjs
```
Before (HEAD CSS): not separately run — the checks are structural/functional and
are not CSS-value assertions; the before failure was the grep/probe above.
After: **38 tests, 38 pass, 0 fail.**

```
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs \
  packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs
```
After: **9 tests, 9 pass, 0 fail.**

## Deviations from the brief, and why

1. **Probe routes carry `?win=all`.** The brief names `/plans` and `/sessions`;
   the `plan29-a` fixture rows are dated 2024 while the app's default window is
   30 days, so the bare routes render empty tables with no data rows to measure.
   `?win=all` is the route the existing acceptance specs use and exercises the
   populated tables.
2. **The `data-chart="table"` body scroller is duplicated per CSS file.** The
   brief describes one global rule; per-panel CSS is lazy-loaded (`ledger.js`,
   `plans.js`, `sessions.js`, `ops.js`, `pulse-strips.js` inject their own
   stylesheet), so a rule in `ledger.css` does not exist on `/plans` or
   `/sessions`. It is copied into each table-owning file instead of edited into
   shared/unowned CSS.
3. **In-row action buttons are 24 px, not 26 px; desktop panel controls stay
   26 px.** A 26 px inline row button plus cell padding pushed the measured row
   to 37 px, contradicting the 28–32 px row requirement in the same brief. The
   row requirement wins: `.plan-open`/`.session-open` are 24 px with 3 px cell
   padding (31 px rows); selects/choosers are 26 px; all become 44 px under
   `(pointer:coarse)`. This is the brief's controls-vs-rows tension, resolved
   explicitly rather than silently.
4. **Ledger row checkbox is 18 px (`display:block`) on desktop.** Its former
   44 px box forced 61.8 px rows; a block-level 18 px checkbox keeps the row at
   29 px. The 44 px target is restored under `(pointer:coarse)`.
5. **Sessions/plans list cells are `white-space:nowrap`.** Full identifiers stay
   readable through the local horizontal scroller (no ellipsis and no JS needed),
   while rows stay at 31 px instead of wrapping to 47 px.
6. **Alternation was only normalised where it exists (Ledger).** No new
   zebra-striping was added to tables that had none.

## Unfinished / deferred

- None required by the brief. Optional follow-up (not this unit): `phase3-04`
  can re-run the same probe at 768/390 px and 200 % zoom; this unit only proves
  the desktop geometry above.
- A deeper visual pass on pulse/ops/cost/workflow populated charts belongs to
  the phase acceptance unit, not this CSS-only unit.

## Known problems

- Bare `/plans` and `/sessions` (no `win=all`) are empty under the Plan 29
  fixture because fixture timestamps predate the default 30-day window; this is
  a fixture/window fact, not a density defect.
- Sticky `.plans-detail-table thead th` sticks within `plans-detail-section`
  (which is `overflow-x:auto` but has no fixed max-height), so it does not stay
  pinned against page scroll the way the panel-body tables do. The brief asked
  for sticky headers on these tables; the DOM has no table-scoped body wrapper
  to attach a bounded scroller to without a JS change, which is out of scope.
- Under `(pointer:coarse)` the in-row action buttons and checkboxes grow to
  44 px, so touch rows exceed 32 px by design (the contract says coarse targets
  retain 44 px).
- Token values (`#1b2734`, `#f4f6f8`, `#223141`, …) are owned by `phase3-01`;
  this unit consumes them and will follow any later token change.

## Contradictions reported, not silently resolved

- The brief's row density (28–32 px) and its control rule (24–28 px, explicitly
  `min-height:26px`) cannot both hold for a button inside a row at the stated
  cell padding. Resolved as in departure 3 (24 px in-row, 26 px panel-level,
  44 px coarse) and surfaced here.
- The brief's "before" description expects a dark Ledger header of
  `rgb(255,255,255)`. In the current worktree `phase3-01` has already defined
  `--yk-surface`, so the old `var(--yk-surface, #ffffff)` header resolves to
  `#1b2734` even before this unit's edit. The white-header repro therefore only
  holds against the pre-`phase3-01` tree; the light-fallback/row-density
  failure is reproduced in the before run above.

## Gates

- Grep gate: PASS (28 → 0 matches).
- Probe gate: PASS in dark and light (header = resolved `--yk-surface`, never
  white; rows 29–31 px; scrollers `auto`; document overflow 0).
- Unit tests: PASS (38/38).
- Acceptance tests: PASS (9/9).
- Verticals untouched: no JS/DOM/routes/requests/paging/sort/board/URL changes;
  no commit, push, deploy, tenant reset or default-tenant use; concurrent units'
  files were left untouched.
