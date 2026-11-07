# Brief: 1-02 — Framework-free shell

Consumer: Phase 1 release/serving worker, then Phase 2 identity and Phases 7–13 UI workers.
Owned paths: `packages/yakka-analytics/` except `wrangler.toml`. Touch nothing else.
Commits: Leave changes in the working tree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/1-02-framework-free-shell.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: 1-01 — Deterministic fixture ledger.
Budget: 20 files to read, about 1,000 lines to change, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 1 outcome, Workspace shell and state, interaction model, chart kit and test harness domains.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — sections 1, 3.4, 9, 10.2, 11.5, 11.6, 14, 17.5, 17.6 and 17.7 as they apply to the static client.
3. `packages/yakka-analytics/src/lib/` — inspect only existing URL state, API/request and theme logic that can be carried as framework-free ES modules.
4. `packages/yakka-analytics/tests/e2e/fixture.ts` — existing fixture behavior to replace or preserve only where the target contract requires it.

## Goal

Replace the SvelteKit application with the contract's no-build static shell and establish the shared browser test harness base needed by later UI phases.

## Contract

Phase 1 in DESIGN.md requires direct URLs to render the shell with unknown paths showing not-found, URL state to round-trip, identical requests to deduplicate, superseded requests to abort, at most four requests in flight, legacy-server limits to remain visible without a clipped retry, and stored theme to apply before first paint through a CSP-compatible external bootstrap. The URL codec preserves unknown keys and supports `win` (`<n><h|d|w|m|y>` or `all`, default `30d`), `from`/`to`, `tz`, repeated `exclude`, `ca`–`cd`, `pick`, `sel`, `hide`, `cmp`, `v` and `p<n>` as described in the Workspace shell and state contract; do not invent alternate keys or rewrite windows. The scheduler adds `tz` and collector `tenant`, follows CONTRACTS.md 3.4 credential rules, and retries only `busy` with `Retry-After`. CONTRACTS.md 17.5 and 17.6 define the permitted no-build assets and uPlot 1.6.32 as the sole runtime dependency. CONTRACTS.md 17.7 defines Chromium-only settled-state browser testing, test-only stubs, no fixed sleeps, and the four-request assertion.

## Changes

Remove framework/build runtime files and old application routes; create the framework-free `web/` layout, native ES modules, CSS, the external theme bootstrap, and vendored uPlot 1.6.32 with integrity evidence. Implement only the shell, URL codec, request scheduler, legacy-limit display, capability read/detection base, and observable idle/state hooks needed by Phase 1. Add the static/browser checks for this brief, including a stub legacy response (`/schema` absent and `range too wide`) and a test-only way for the browser to read the deterministic fixture summary produced by 1-01. The fixture summary must remain test-only; do not add a product route or sample-data feature.

Keep package `README.md` with the four required headings/fields checked by `tools/release/test_layout.py`. Keep `wrangler.toml` unchanged here; the release worker owns it.

### Keep untouched

Do not implement identity flows beyond preserving the shell destinations, analytics pages/panels, new API routes or joins, or any chart interaction beyond a static shell state. Do not invent capabilities for Plans 21/22/23: read `/schema`; absent features remain absent/unsupported. Keep the four-field package README contract. Do not ship tests, fixture ledgers, secrets, or test values.

## Done evidence

Identify the failing/missing shell checks before implementation and report their output before and after.

- Static/browser shell check → direct route loads render the shell, unknown route renders not-found, URL state round-trips, theme bootstrap runs before first paint without inline script/style, and idle state is observable.
- Request scheduler check → identical in-flight requests collapse, superseded requests abort, and concurrent requests never exceed four.
- Legacy stub check → absent/old `/schema` plus `range too wide` is rendered as received; no client window rewrite, clipping, or automatic retry occurs.
- Fixture summary browser check → browser reads the deterministic test fixture summary from the test harness produced by 1-01; no product route is introduced.
- Static package checks → no SvelteKit/build/bundler runtime remains, no forbidden secret/token literal is present in `web/`, uPlot files match the pinned version and integrity, and the README retains the layout-check fields.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.
