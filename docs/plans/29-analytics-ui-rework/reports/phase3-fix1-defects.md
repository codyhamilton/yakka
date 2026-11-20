# Report: phase3-fix1 — Enter-opened inspector and 390 px scatter overflow

Status: **done**. Both Phase 3 acceptance defects are fixed in owned files only.
The full Phase 3 acceptance suite and the requested regression set pass.

## Defect 1 — Enter-opened inspector closed immediately

**Symptom.** On `/b/scatter` or `/b/trends`, focusing a mark or the shadow table
row and pressing Enter opened the inspector and then closed it within ~20 ms.
Mouse open was unaffected.

**Root cause.** `openInspector()` moved focus to the Close `<button>` while the
Enter `keydown` was still being dispatched. The following Enter `keyup`
activated that focused button, calling `close()`.

**Change.** `packages/yakka-analytics/web/js/core/inspector.js`: set
`element.tabIndex = -1` on the `aside.workspace-inspector` and focus the panel
itself with `{ preventScroll: true }` instead of the Close button. `role=dialog`,
`aria-modal=false`, `aria-label`, opener restoration and all actions are
unchanged; Escape still closes via the existing document keydown handler; Tab
reaches Close and the action buttons.

**Evidence.** A probe focused the trends chart, pressed ArrowRight then Enter,
and waited 200 ms after keyup:

- After 200 ms: panel is open with the inspected mark recorded, the aside is the
  active element (tag `ASIDE`, `tabIndex -1`).
- After Escape: panel is closed and the trends chart host is the active element.

The panel stays open, holds focus, and Escape restores the opener. No timer,
sleep or animation was added to product code.

## Defect 2 — 390 px `/b/scatter?win=all` document overflow

**Symptom.** At 390 px, `documentElement.scrollWidth` was 704 against
`clientWidth` 390.

**Root cause.** `.scatter-marginals` used `grid-template-columns: 1fr`
(`minmax(auto, 1fr)`); the grid item kept the table's ~402 px min-content, so
the marginals never shrank to the 374 px content box and widened the document.

**Change.** `packages/yakka-analytics/web/css/scatter.css`: added `min-width: 0`
to `.scatter-marginals`, `.scatter-marginal` and `.scatter-marginal yk-ranges`;
under `@media (max-width: 900px)` changed the grid to `minmax(0, 1fr)` and made
`.scatter-marginal table` a bounded local scroller (`display: block;
max-width: 100%; overflow-x: auto`). No body overflow mask, no content or column
changes. Desktop declarations are untouched (`display` stays `table`,
`overflow-x` stays `visible`).

**Evidence.** Measured with the same harness after the change:

```
390  {"clientWidth":390,"scrollWidth":390,"marginalWidth":356,"tableDisplay":"block","tableOverflowX":"auto","tableClientWidth":338,"tableScrollWidth":338}
768  {"clientWidth":768,"scrollWidth":768,"marginalWidth":726,"tableDisplay":"block","tableOverflowX":"auto","tableClientWidth":708,"tableScrollWidth":708}
1920 {"clientWidth":1920,"scrollWidth":1920,"marginalWidth":609,"tableDisplay":"table","tableOverflowX":"visible","tableClientWidth":281,"tableScrollWidth":281}
```

390 px is now `390 <= 390 + 1`; the desktop marginal table remains a normal
table with no scroller. The committed-measurement subtest also passed, so the
recorded geometry/plot heights did not drift.

## Exact commands and counts

Phase 3 acceptance (both previously failing subtests now pass, no regressions):

```
GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
TMPDIR="$PWD/.scratch/phase3/tmp" node --test --test-concurrency=1 \
packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs
```

**10 tests, 10 pass, 0 fail** (9 subtests plus the aggregate; 15.6 s). Includes
`keyboard-open a mark opens the inspector` and `responsive, coarse pointer and
200% reflow` (390 px overflow assertion).

Requested regression set:

```
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/charts-time/acceptance.test.mjs \
  packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs
```

**13 tests, 13 pass, 0 fail** (42.8 s).

## Residual concerns

None for these defects. The acceptance test file and measurement record remain
untracked as supplied and were not modified. Changes are left uncommitted in the
working tree for the orchestrator.
