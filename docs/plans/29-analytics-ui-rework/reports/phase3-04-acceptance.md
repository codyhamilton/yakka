# Report: phase3-04 — Real-Go real-Chromium Phase 3 acceptance

Status: **done with concerns**. The acceptance suite and committed measurement
record are in the working tree. Seven of nine acceptance subtests pass; two
fail on real product defects this unit is forbidden to fix. The listed
regression set has one pre-existing failure outside this unit's files.

## What was added

- `packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs` — one
  `node:test` file over `startPlan29Harness()` (real Go, cookie session,
  `plan29-a` populated / `plan29-b` empty) and real Chromium. No stubs, no
  request interception, no fixed sleeps. Waits are `html[data-idle=true]`,
  `[data-panel][data-idle=true]`, `yk-chart[data-state=ready]`, or a rendered
  canvas pixel. It covers:
  1. full-width geometry for 16 routes at 1920×1080 and 1366×900 (including a
     session detail from `/sessions` rows and a plan detail from `/plans` rows);
  2. compact rows, sticky headers, local table scrollers, numeric alignment,
     8 px panel gap, panel chrome and 200–260 px plot frames on `/ledger`,
     `/plans`, `/sessions` and `/b/scatter`;
  3. one theme family across document/shadow/canvas on `/b/scatter`, with
     light→dark→light toggles, canvas pixels following the resolved token, and
     marks/hidden series/selection/URL/table rows surviving;
  4. real uPlot hover, keyboard navigation, Tab reach, time brush and legend
     hide/show on `/b/trends`, plus scatter hover, rectangle selection,
     click-to-inspector and the shadow table alternative on `/b/scatter`;
  5. 768 px one-column grid, 390 px gutter/local table scroll, coarse-pointer
     44 px targets, and 683×450 (200% zoom) reflow;
  6. explicit empty (`plan29-b` `/b/trends`), permission (`/ops` 403) and error
     (`/sessions/<unknown>`) states in both themes with ≥4.5:1 contrast;
  7. a committed record compared with tolerances for scrollbar/client width and
     zero tolerance for colour tokens.
- `packages/yakka-analytics/tests/plan29/phase3-measurements.json` — the
  committed baseline for geometry, resolved theme tokens, canvas pixels and
  Ledger header colours.

No product file and no other test file was changed. `tests/plan29/harness.mjs`
needed no change.

## Exact commands and counts

Acceptance, from `/home/codyh/workspace/yakka-build/29` with
`GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192`
and `TMPDIR="$PWD/.scratch/phase3/tmp"`:

```
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs
```

- Current tree: **10 tests, 7 pass, 3 fail** (two failing subtests plus the
  aggregate; 17.6 s). The two failures are the product defects below. The
  remaining seven subtests, including the committed-record comparison, pass.
- Baseline `877f8195` copy in `.scratch/phase3/base/` (same test file copied in,
  `YAKKA_PHASE3_RECORD=1`, TMPDIR pointed at the main worktree's
  `.scratch/phase3/tmp` because Chromium's singleton socket path exceeded the
  OS limit inside the deeper base path): **10 tests, 4 pass, 6 fail** (11.0 s).
  Red evidence:
  - `/ at 1920x1080: main left 420 != topbar 400` — the centered 1120 px cap.
  - `/ledger?win=all density: row height 66.609375` — legacy padded rows.
  - `one theme family…: lightSurface is not iterable` — `--yk-surface` was not
    defined at document level, so the canvas token could not resolve.
  - `responsive…: narrow gutter 20 !== 8`.
  - `keyboard-open a mark opens the inspector` already timed out at the base.

Regression set (same environment, no `TMPDIR` override):

```
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/charts-time/acceptance.test.mjs \
  packages/yakka-analytics/tests/charts-cat/acceptance.test.mjs \
  packages/yakka-analytics/tests/workspace/acceptance.test.mjs \
  packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs \
  packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs \
  packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs \
  packages/yakka-analytics/tests/static-shell.test.mjs \
  packages/yakka-analytics/tests/release-matrix/record.test.mjs \
  packages/yakka-analytics/tests/plan29/harness.test.mjs
```

Result: **41 tests, 40 pass, 1 fail** (209.7 s). The failure is
`release-matrix/record.test.mjs`: the committed request-shape record expects
`from`/`to` without milliseconds and scatter `dim=session_model`; the current
branch sends `.000Z` and `dim=model` (plus the same timestamp form elsewhere).
This unit adds only new untracked test files, so the drift is pre-existing on
the branch, not caused here. `release-matrix/matrix.test.mjs` was not run.

## Measured record (committed baseline)

Geometry (real Go, real Chromium, `documentElement.clientWidth`):

| viewport | clientWidth | mainWidth | gutter | ledger row | panel gap | plot frame |
|---|---|---|---|---|---|---|
| 1920×1080 | 1920 | 1896 | 12 | 29 | 8 | 240 |
| 1366×900 | 1366 | 1342 | 12 | 29 | 8 | 240 |
| 768×900 | 768 | 744 | 12 | 27 | 8 | 240 |
| 390×844 | 390 | 374 | 8 | 27 | 8 | 240 |

At both desktops every route had `mainLeft/mainRight` equal to the topbar and
footer content edges within 1 px, body `13px/17.55px`, and `scrollWidth ==
clientWidth`. `/plans` and `/sessions` rows measured 31 px; `/ledger` rows 29 px.

Resolved tokens (document-level, inherited by hosts/shadow roots):

| token | light | dark |
|---|---|---|
| `--yk-bg` | `#eef1f4` | `#111923` |
| `--yk-surface` | `#f4f6f8` | `#1b2734` |
| `--yk-surface-alt` | `#e9edf1` | `#223141` |
| `--yk-text` | `#18212f` | `#edf3f8` |
| `--yk-muted` | `#586579` | `#b5c0cc` |
| `--yk-border` | `#d6dde7` | `#405061` |
| `--yk-grid` | `#e6ebf2` | `#2a3948` |
| `--yk-focus` | `#176b87` | `#83c9df` |
| `--yk-chart-surface` | `#f4f6f8` | `#1b2734` |
| `--yk-selected` | `#dbeafe` | `#23445a` |
| `--yk-excluded` | `#f6dede` | `#3a2428` |

Canvas `(2,2)` and Ledger `thead th` background:

| surface | light | dark |
|---|---|---|
| scatter canvas RGBA | `[244,246,248,255]` | `[27,39,52,255]` |
| Ledger header | `rgb(244, 246, 248)` | `rgb(27, 39, 52)` |

Neither canvas nor Ledger header is pure white in either theme. Across
light→dark→light the scatter chart kept its mark count, hidden series,
rectangle selection, table rows and `location.search`; clicking the theme
toggle issued no data request.

## Known product defects (not fixed)

1. **Enter-opened inspector closes immediately.** Symptom: focusing a mark or
   the shadow table row and pressing Enter emits the `inspect` intent and opens
   the inspector, then it closes within ~20 ms; the keyboard-open subtest times
   out waiting for `data-open=true`. Location:
   `web/js/charts/yk-chart.js:404-405` (`onActivate` → `#inspectKey`) and
   `web/js/core/inspector.js:154-155` (`openInspector` focuses the Close
   button). Root cause: focus moves to the inspector Close button during the
   Enter keydown; the same native Enter keyup then activates that button and
   calls `close()`. Mouse-click opening is unaffected. This defect exists at
   `877f8195` too (red run), so units 01–03 did not introduce it. Gate:
   `keyboard-open a mark opens the inspector` fails.
2. **390 px scatter board has document horizontal overflow.** Symptom:
   `/b/scatter?win=all` at 390×844 has `documentElement.scrollWidth = 704` for
   `clientWidth = 390`; ledger, plans and sessions stay at 390 and scroll
   locally. Location: `web/css/scatter.css` `.scatter-marginals` /
   `.scatter-marginal` and their `yk-ranges`/table min-content;
   `web/css/workspace.css` containment covers only
   `.workspace-panel-body > *` and `> * > *`, not the marginal section two
   levels deeper. Root cause: `.scatter-marginal` is allowed its ~402 px
   min-content instead of shrinking to the 374 px content box. Gate:
   `responsive, coarse pointer and 200% reflow` fails with
   `390px scatter document overflow: 704 > 390`. The base red run stopped
   earlier on the 20 px legacy gutter, so this is a post-unit-01–03 gap against
   DESIGN “the document has no horizontal overflow”.

## Regression failure outside this unit

`release-matrix/record.test.mjs` fails as described above. It does not read or
execute this unit's files; the branch sends `.000Z` window bounds and a
different scatter dimension than the committed record. It needs a reviewed
`YAKKA_RECORD_WRITE=1` re-record or the product-side formatting/lens change that
caused the drift. Gate line: regression record check **FAIL**.

## Deviations from the brief, and why

1. **Data-bearing routes use `?win=all`.** The fixture facts are dated 2024 and
   the app default is 30 days, so bare `/plans`, `/sessions` and the populated
   scatter board would be empty. Geometry is still checked on every bare route
   listed in the brief; density, detail identities, interaction, themes and
   states use `?win=all` (the same convention as the phase3-03 report).
2. **The permission state is `unsupported`.** `/ops` maps the real 403 to
   `unsupportedState({feature:'Administrator status', reason:'administrator
   only'})`, not a state literally named `unauthorized`. The suite asserts that
   real permission state and its text rather than inventing a client role.
3. **390 px overflow is checked on `/b/scatter`; local table scroll and the 200%
   reflow are checked on `/ledger`.** This separates the failing board from the
   passing table behaviour and names the failing route.
4. **The baseline is authored by the suite.** `YAKKA_PHASE3_RECORD=1` wrote
   `phase3-measurements.json`; the normal acceptance run compares against it
   and passes that comparison.
5. **Line estimate exceeded.** The test is 719 lines against the brief's “about
   500 new lines”; the completed coverage (six acceptance areas plus the
   record/compare) needed that. Tool turns stayed within the 45-turn budget.
6. **Base red run used the main worktree's TMPDIR.** Chromium's singleton socket
   path was too long under `.scratch/phase3/base/.scratch/phase3/tmp`; the copy
   still ran entirely under `.scratch/phase3/`.

## Unfinished / deferred

- Fix or accept the two product defects above; both are outside this unit's
  owned paths.
- Re-record `packages/yakka/internal/serve/testdata/browser-request-shapes.json`
  and review the `.000Z`/`dim` change, or fix the branch-side cause.
- `release-matrix/matrix.test.mjs` was not run (optional per the brief).

## Known problems

- Narrow (768/390) Ledger rows measure 27 px, one pixel below the desktop
  28–32 px band; the brief's density case is asserted at desktop widths only.
- The scatter canvas is only 2 px from the plot edge in this fixture, so the
  pixel sample is a surface sample, exactly as the EVIDENCE methodology states.
- The fixture has only two session scatter marks; rectangle selection is
  asserted non-empty, not against a large population.

## Gates

- Full-width geometry, 16 routes × 1920/1366: **PASS**.
- Dense rows/headers/scrollers/numeric/panel/plot: **PASS**.
- One theme family, canvas pixels, header, survival across toggles: **PASS**.
- Real hover/brush/legend/rectangle/table select intent: **PASS**.
- Keyboard-open inspector: **FAIL** (defect 1).
- Responsive 390 document overflow: **FAIL** on `/b/scatter` (defect 2); 768
  one-column, 390 gutters/local table scroll, coarse 44 px, 200% reflow: **PASS**.
- Empty/permission/error states both themes and contrast: **PASS**.
- Committed measurement comparison: **PASS**.
- Regression set: **40/41 PASS**; release-matrix record **FAIL** (pre-existing).
- No product file, other test file, commit, push, deploy, tenant reset or
  default-tenant use in this unit.
