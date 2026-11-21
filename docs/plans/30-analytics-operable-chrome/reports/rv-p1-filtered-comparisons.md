# rv-p1 — filtered Pulse comparisons

Focused fix for the blocking C3/C4 finding in `.briefs/yakka/30-rv-p1.md` on branch `feat/30-analytics-operable-chrome`. No API semantics, IAM, lifecycle, or chart-layout work was changed.

## Finding and change

The Pulse previous-period `summary` read and the Movers previous-period `query` read were built from `windowParams(prev)`, which contains only `from`/`to`. They therefore dropped the committed `repo_id` and `kind` (along with excludes, cohorts, and timezone) while still rendering the unfiltered comparison results.

`pulse-strips.js` now exports `previousParams(baseParams, prev)`: it copies the current read's parameters, removes `all`/`from`/`to`, and sets only the previous equal-length bounds. `pulse-strips.js` uses it for the previous summary read; `movers.js` uses it for each previous Movers lens read. Current, series, and unpriced reads are unchanged and still use `scopeParams(scope)`. Tenant remains the transport argument on every read.

Files changed:

- `packages/yakka-analytics/web/js/panels/pulse-strips.js`
- `packages/yakka-analytics/web/js/panels/movers.js`
- `packages/yakka-analytics/tests/plan30/previous-filter-scope.test.mjs` (new regression coverage; required by the brief)

## Evidence

- Request trace and screenshot script: `.scratch/plan30-rv-p1/capture.mjs`
- Screenshot (1440×900 viewport, full page, dark): `.scratch/plan30-rv-p1/pulse-filtered.png`
- Visible body text: `.scratch/plan30-rv-p1/pulse-filtered.txt`
- Actual outgoing requests for the filtered view: `.scratch/plan30-rv-p1/pulse-requests.json`
- Rerun acceptance screenshots: `.scratch/plan30-chrome/screens/pulse.png`, `pulse-light.png`

The trace for `/b/pulse?win=7d&repo_id=fixture-repo&kind=brief` shows:

- current summary `2026-11-14T14:45:43.630Z → 2026-11-21T14:45:43.630Z`;
- previous summary `2026-11-07T14:45:43.630Z → 2026-11-14T14:45:43.630Z`;
- previous Movers query per lens with `bucket=none` and the same bounds;
- every summary and query carries `tenant=fixture-tenant`, `repo_id=fixture-repo`, `kind=brief`.

## Check results

| ID | Result | Evidence |
|---|---|---|
| S1 | **pass** | Re-ran `tests/plan30/phase1-acceptance.test.mjs` (S1 green): tenant B switch, frozen bounds, delayed-A isolation, Back/Forward. New Chromium test additionally captures every filtered Pulse summary/query and asserts tenant, repository, kind, and frozen current/previous bounds. |
| C3 | **pass** | New unit test asserts `repo_id=repo-a` on both current and previous Pulse summary reads and on Movers current, daily-series, previous, and unpriced reads. New Chromium test asserts `repo_id=fixture-repo` on every Pulse summary/query request. |
| C4 | **pass** | Same tests assert `kind=brief` on both current and previous summary reads and on every Movers read; no comparison request renders without the selected kind. |
| F1 | **pass (scope slice only)** | The applicable half for this fix — an active filter must not be dropped from the comparison read — is proven by the C3/C4 tests. The separate F1 unsupported-cost/hook refusal with `ignored_filters` messaging is Phase 2 and is not claimed here. |
| G-movers | **pass (read-contract slice only)** | Previous Movers reads are `bucket=none` totals with the committed scope; current totals and daily series are unchanged. Full bar/caption/table catalogue work belongs to Phase 2 and is not claimed. |
| S-pulse | **pass (comparison-filter slice only)** | `tests/workspace/pulse.test.mjs` still verifies the five-panel Pulse order (`river`, `pulse-strips`, `movers`, `calendar`, `coverage`); the new Chromium test verifies the filtered view's panels all issue scope-preserving reads. Remaining S-pulse catalogue/F refusal checks are Phase 2 and are not claimed. |

## Commands and results

From `packages/yakka-analytics`, with `PUBLIC_CANVAS_TEST_MODE=true` and `NODE_OPTIONS=--max-old-space-size=8192` (the existing 8 GiB mechanism; no `ulimit -v`):

```text
node --test --test-reporter=spec tests/plan30/previous-filter-scope.test.mjs
→ 3 tests, 3 pass, 0 fail

node --test --test-reporter=spec \
  tests/workspace/pulse.test.mjs tests/plan30/phase1-fixes.test.mjs \
  tests/plan30/previous-filter-scope.test.mjs
→ 22 tests, 22 pass, 0 fail

node --test --test-reporter=spec tests/plan30/phase1-acceptance.test.mjs
→ 19 tests, 19 pass, 0 fail (35.4s)
→ subtests S1, N1, C1, C2, C3/C4, C5, C6, C7, C8, C10, C11,
  V1/V4/V5, T1–T4, C9, screenshots all green
```

Also ran `node --check` on both changed modules and the new test.

## Visual comparison

Opened `docs/plans/30-analytics-operable-chrome/mockups/pulse.png` and `mockups/src/pulse.html`, then compared them with `.scratch/plan30-rv-p1/pulse-filtered.png` (1440×900 viewport, dark).

- Shell, both nav rows, heading, filter row, count row, panel order and dark surfaces match the reference.
- The filtered run shows `Repository: fixture-repo (not in this window)` and `Kind: Brief` in the shared bar, and each panel carries `repo: fixture-repo` / `kind: brief` chips.
- As recorded in `reports/phase1-05-verification.md` and the Phase 1 review, the Pulse panel bodies remain the pre-Phase-2 stacked layout rather than the mockup's compact board. This fix changes request scope only; it adds no visual departure.

## Departures, gates, known problems

- No design contradiction. No `design-change:` item.
- A new focused test file was added; the brief permits focused tests/harness, and the change needed request-level regression coverage.
- Gates remain: `gate: signed-in production check tenant switch, counts and cohort creation against the deployed API and real sign-in`; `gate: signed-in production check screenshot comparison at 1440×900 on deployed data`.
- Known Phase 2 gaps, deliberately not claimed or changed here: unsupported-filter (`ignored_filters`) refusal on mixed summary counters/query measures (F1), full G-movers/S-pulse catalogue and caption contracts, and the other Phase 2 panels that build previous windows with `windowParams(previous)`. This brief scoped the fix to Pulse previous-period summary and Movers reads.
