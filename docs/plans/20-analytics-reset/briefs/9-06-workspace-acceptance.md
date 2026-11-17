# Brief: 9-06 — Workspace acceptance and phase proof

Consumer: the Phase 9 acceptance worker; this unit closes the phase outcome.
Owned paths: `packages/yakka-analytics/tests/workspace/{acceptance.test.mjs,deep-links.test.mjs,degradation.test.mjs}` (new), and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/9-06-workspace-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 9-01, 9-02, 9-03, 9-04, 9-05.
Runs alongside: nothing; it owns the phase proof over the other five units.
Budget: 30 files to read, about 900 lines to change, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 9 outcome line (the acceptance checklist), Workspace shell and state, Interaction model, Panels/boards and question paths, preset mapping and question paths, Scope vocabulary.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.2, 17.3, 17.3.1, 17.5, 17.6, 17.7 — capabilities/typed populations/cohorts/chart testability/serving/test discipline; 7, 10.1, 12 — routes, embedded serving fallback and the four-in-flight concurrency.
3. The five Phase 9 unit briefs and their reports, then the code they landed: `web/js/{app.js,core/,panels/,boards/,explorers/,contract/url-state.js}`, `web/css/{workspace,pulse,ledger,ops}.css`, and `tests/workspace/` (harness, fixture, stub API, all specs).
4. `packages/yakka-analytics/tests/workspace/{harness.mjs,fixture.mjs,stub-api.mjs,browser.mjs}` — the scenarios and controls you must drive; do not edit them.
5. `packages/yakka-analytics/tests/charts-time/acceptance.test.mjs` and `tests/charts-cat/acceptance.test.mjs` — the phase-proof pattern.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Prove the Phase 9 outcome end to end in the browser over the committed fixture: Start's question paths, the complete Pulse preset with feed/brush/zoom/Follow, deep links and Back including all-history and long finite windows, shared chips/tray/typed populations and named unsupported joins/ignored filters, the schema-driven chooser, saved boards and capability provenance, `/ledger` cursor paging beyond 20,000, `/ops` authorised-only status, every panel state and old-server degradation, and named later destinations.

## Contract

The Phase 9 outcome line is the checklist, quoted here in the done evidence. Supporting rules:
- `/schema` drives every chooser; no client hard-coded window/bucket/row/cell limit. An older server is normal: absent features render `unsupported` naming the missing feature and what supplies it; `range too wide` is shown verbatim with its retry.
- Panel states are `loading`/`ready`/`empty`/`error`/`unsupported`/`cancelled` plus `partial`/`sampled`/`coarsened`/`clipped`/`lower-bound`; `cancelled` has retry and is not an error; `empty` names the producing filters/cohort/selection and offers to clear each.
- Every panel names its grain, units, time basis, coverage and caveats; every applicable chip is shown and every ignored filter/missing join is named; totals come from typed populations; unpriced is never `$0`.
- URL is the state: window/filter/cohort/compare changes push; hover and in-progress drag do not; a committed brush replaces `sel`; zoom pushes and clears `sel`; Back restores the full prior scope/cohorts/panels; compare-period is disabled for `all`. Follow is off by default, probes `/activity?mode=probe&after=<watermark>` only while visible, advances only on acknowledge, and a cancelled/error probe advances nothing.
- Saved boards live in `yakka-analytics-boards` as named URLs; the URL stays the source of truth. Later preset/explorer destinations (`/b/trends`, `/b/compare`, `/b/scatter`, `/b/quality`, `/b/cost`, `/b/tools`, `/b/workflow`, `/plans*`, `/sessions*`, `/artifact`) render named destinations, never not-found and never a fake board. `/ledger` pages beyond 20,000; `/ops` shows only authorised `/v1/admin/status`.
- Test discipline: Chromium only via `playwright-core`, test-only and never committed as a dependency; `NODE_PATH` and the Chromium 1243 cache may be absent, in which case specs skip with the named `SKIP_REASON` and the run records a gate; no fixed sleeps, no `/tmp`, no animation/timing assertions; wait on `data-state`/`data-idle`, explicit URL end state and `inspect()`; any console error, page error or CSP violation fails; at most four analytics requests in flight; nothing in the product branches on being under test.
- This unit is read-only over the product. If a check fails, report the failing entry point, action, expected vs actual and the owning unit; do not weaken a check and do not edit another unit's files.

## Changes

- `tests/workspace/acceptance.test.mjs`: one phase-proof spec covering:
  - every Start question path opens its configured state or is disabled with the reason `/schema` lacks; delivered paths reach Pulse/ops/ledger, later destinations are named;
  - `/b/pulse` settles all five panels; river feed inspect opens the matching session/artifact/execution provenance; a calendar/river time brush shows the labelled peer preview with no URL push; zoom commits `from`/`to` and clears `sel`; Follow is off by default, a probe reports late counts without moving the acknowledged watermark, acknowledge advances and refetches, an injected probe failure leaves it unchanged;
  - shared scope chips, the selection tray and typed populations are visible; an unsupported join and an ignored filter are each named, not dropped; an all-unpriced value is not `$0`;
  - the panel chooser offers only `/schema`-listed combinations and an unsupported choice names the nearest supported one and the capability source; the capability inspector lists each panel's route+parameters, grain, units, time basis, budgets, coverage and caveats;
  - a named board saves to `yakka-analytics-boards` and reopens from its URL; unknown URL keys survive a round trip;
  - `/ledger` pages beyond 20,000 without duplicates/gaps; `/ops` as admin shows status and as member shows only "administrator only";
  - every panel state is reached through the harness scenes (`loading` held and released, `empty`, `error` with code/retry, `unsupported`, `cancelled`), with the badge vocabulary where a response supplies it;
  - later preset destinations are named and resolve through the shell; no dead links in the Start list.
- `tests/workspace/deep-links.test.mjs`: direct loads of `/b/pulse?win=all`, a long finite `from`/`to` (ten years), a filtered scope, a panel override `p<n>` and a saved cohort; reload and Back/Forward restore the full scope/cohorts/panels; `cmp=period` with `all` is disabled with "choose a finite period"; an unknown path renders the in-shell not-found view.
- `tests/workspace/degradation.test.mjs`: the `legacy` stub scene (old `/schema` without a Phase 9 feature) and a `range too wide` error: panels render `unsupported` naming the missing feature/source, the old limit is shown verbatim with retry, no panel clips or rewrites the window, and no console/page/CSP error occurs. Use the harness/stub scenarios; do not add a product branch.
- Keep the acceptance files external-module-only, deterministic, and free of sleeps/timers; assert `maxInFlight <= 4` on every page visited.

### Keep untouched

Do not edit product code, any other unit's tests, the harness/stub/fixture, chart modules/CSS, Go code, or `tests/e2e/*`, `tests/hosted/*`, `tests/identity/*`. If the acceptance proof finds a defect, report it as an owning-unit finding rather than repairing it here. No new route, grain, join, gesture, dependency, storage key or scope.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/workspace/acceptance.test.mjs packages/yakka-analytics/tests/workspace/deep-links.test.mjs packages/yakka-analytics/tests/workspace/degradation.test.mjs` → all pass, or browser tests skip with `SKIP_REASON` and the run records the gate.
- `NODE_PATH=… node --test packages/yakka-analytics/tests/workspace/*.test.mjs packages/yakka-analytics/tests/*.test.mjs` → the whole workspace suite and existing non-browser suite pass in one run.
- `NODE_PATH=… node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs packages/yakka-analytics/tests/charts-time/*.test.mjs` → no chart-kit regression from Phase 9 composition.
- `git diff --check` clean; `rg -n "data-test|__test|stub|fixture" packages/yakka-analytics/web` shows no test hook in shipped code (the only matches allowed are ordinary words in comments/styles, not branches); no `/tmp`, no fixed sleep, no animation/timing assertion in the new specs.
- Observable: the Phase 9 outcome line holds entry point by entry point over the fixture; every later destination is named; the run prints a single acceptance summary naming each case and its `ready`/expected state.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
