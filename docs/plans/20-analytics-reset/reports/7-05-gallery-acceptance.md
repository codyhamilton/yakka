# 7-05 — Gallery and browser acceptance

Status: done.

## What changed

- `tests/gallery/index.html` + `index.js` — the Phase 7 index. External modules
  only; links the 7-01 foundations, 7-02 time series, 7-03 gestures and 7-04
  scatter pages with stable `data-case` names. It reads `readTheme()` and the
  `?case=` parameter into test-only `<output>` elements, shows the deterministic
  fixture sizes from `fixture.js` (series, entity keys, the 5,000 scatter
  budget, bucket count), and sets `html[data-idle=true]` once the page is built.
  It starts no charts, so there is nothing else to settle.
- `tests/charts-time/acceptance.test.mjs` — one end-to-end suite that opens
  every gallery page and proves the Phase 7 outcome. A pure check runs the
  committed `paletteReport()` thresholds in both themes and the named-neutral
  distinctness; the Chromium checks cover the index, foundations, time series,
  gestures and scatter, plus a below-900 px responsive pass. The scatter proof
  carries its own independent linear-scan nearest-point and inclusive-rectangle
  references (it imports neither `hit-test.js` nor any chart module), and it
  asserts the 7-04 declared first-party canvas fallback for scatter while the
  ECDF remains a uPlot step line. Waits are `html[data-idle]`, `data-state`, URL
  conditions and `waitForFunction` on the theme token; there is no fixed sleep.

No chart implementation, foundation, gesture engine, scatter module, CSS,
vended uPlot, `web/`, identity/e2e/hosted tree or dependency was edited.

## Check output

Before: neither owned file existed.

```
$ git cat-file -e HEAD:packages/yakka-analytics/tests/charts-time/acceptance.test.mjs
fatal: path '...acceptance.test.mjs' exists on disk, but not in 'HEAD'
$ echo $?
128
$ git cat-file -e HEAD:packages/yakka-analytics/tests/gallery/index.html
fatal: path '...index.html' exists on disk, but not in 'HEAD'
$ echo $?
128
```

After:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-time/acceptance.test.mjs
# tests 7 / pass 7 / fail 0 / skipped 0

$ NODE_PATH=... node --test \
  packages/yakka-analytics/tests/charts-time/{foundations,time-series,gestures,scatter}.test.mjs
# tests 23 / pass 23 / fail 0

$ node --test packages/yakka-analytics/tests/*.test.mjs
# tests 12 / pass 12 / fail 0
```

playwright-core 1.63.0 and the Chromium 1243 cache were present, so the suite
ran rather than skipping; there is no browser gate. Every gallery page opened by
the suite reached `html[data-idle=true]` and a settled `data-state`; no spec
contains a fixed sleep.

## Phase-outcome coverage matrix

| Outcome clause (DESIGN.md Phase 7) | Check in `acceptance.test.mjs` |
|---|---|
| line, area, stacked columns, cumulative and share reach the interaction settled state | `time-series gallery proves every mode…` — every id `ready`, `type`/`mode`/`stacked`, columns zero-based |
| ECDF and numeric scatter reach the settled state | `scatter gallery…` — scatter and ECDF `ready`, `type`, ECDF step line |
| table values equal the plotted data | time-series test compares `inspect().marks`/tables for line, area, columns, cumulative, share; scatter test compares every ECDF row with `formatValue(mark.values)` |
| hover and keyboard focus, inspect | gestures test — real mouse move and ArrowRight change `inspectedKey`/`highlight` across linked charts with no URL/history change; plain click emits `inspect` |
| selection union/subtraction | gestures test — Shift/Ctrl clicks, Alt-click exclusion, row checkbox; scatter test — Shift-drag rectangle union |
| brush versus zoom, pan, history/Back | gestures test — drag `sel`, zoom-to-selection pushes `from`, `history.back()` restores the brush and scope, double-click commits, Shift-drag pans, Ctrl-wheel zooms |
| legend toggle/focus/isolate | gestures test — hide replaces `hide`, focus pushes one filter, Ctrl-click isolates |
| keyboard grammar | gestures test — arrows, Space, `x`, `o`, `f`, `c`+`a`, `[`/`]`, Esc twice, `+`/`-` |
| touch tap, *Select* mode, pinch | gestures test — CDP touch tap inspects, Select-mode drag brushes, pinch changes the window |
| resolution/sample/coverage badges with labelled counts | foundations test — `resolution: time · day`, `sample of 5,000 of 12,000`, every coverage flag, no `%`; scatter test — `sample of 1,000 of 5,000` |
| both themes correct, entity colours stable, named neutrals distinct, palette check | pure palette test; foundations test reads light/dark `--yk-cat-1` and unchanged slots; time-series test keeps the same `--yk-swatch` across modes, a filter and a theme change; foundations lists all six neutral tokens |
| accessible table toggles open by keyboard and shows plotted values | time-series test — focus the `<summary>`, Enter closes and reopens, values still equal the fixture |
| below 900 px one column, targets ≥ 44 px | responsive test — computed one-track grid, stacked frames, 44 px gesture/legend/checkbox targets |
| no animation, no `console.error`/page error/CSP, ≤ 4 in flight | every browser test asserts `assertClean()`, `maxInFlight <= 4` and static `animation:none`/`transition:0s` |
| scatter reference at the 5,000-point budget; declared uPlot-or-canvas outcome exercised | scatter test — 5,000 marks, independent nearest and rectangle references, two canvas layers/no uPlot for scatter, uPlot for ECDF |
| gallery index links every case | index test — four `data-case` links, theme and case outputs, fixture sizes, idle |

## Deviations and interpretations

- The independent scatter reference lives in the acceptance file rather than
  importing the 7-04 test module. It is still an independent linear scan over
  `inspect().marks`, which keeps this suite self-contained and matches 17.7's
  testability-surface rule; the 7-04 spec remains the unit-level proof.
- The index displays fixture sizes and the current theme/case as test-only
  `<output>` elements; it does not switch themes itself, because both themes are
  driven directly by the existing foundation controls and `data-theme`.
- No assertion was weakened and no owning unit was edited.

## Contradictions

None found between this brief, CONTRACTS.md 17.5/17.7, and DESIGN.md Phase 7
outcome, Interaction model or Chart kit. The 7-04 declared canvas fallback is
the scatter path exercised, and the ECDF remains on uPlot.

## Unfinished / known problems

None in this unit. The selection tray, exact population count, cross-grain
requery and time-grain scatter axes remain later-phase work, as 7-04 reported;
they are outside this acceptance proof.
