# Brief: phase1-02 — One read context: tenant, resolved scope and coverage truth

Consumer: the execute worker for phase1-02; phase1-03 imports the resolved-scope/read-context seam; every panel gains the tenant-carried requests proved here.
Owned paths: `packages/yakka-analytics/web/contract/transport.js`, `packages/yakka-analytics/web/contract/url-state.js`, `packages/yakka-analytics/web/contract/session-gate.js`, `packages/yakka-analytics/web/js/core/read-context.js` (new), `packages/yakka-analytics/web/js/app.js`, `packages/yakka-analytics/web/js/explorers/ledger.js`, `packages/yakka-analytics/web/js/explorers/sessions.js`, `packages/yakka-analytics/web/js/explorers/plans.js`, `packages/yakka-analytics/web/js/explorers/artifact-content.js`, `packages/yakka-analytics/web/js/explorers/artifact.js`, `packages/yakka-analytics/web/js/panels/ledger-table.js`, `packages/yakka-analytics/web/js/panels/pulse-strips.js`, `packages/yakka-analytics/web/js/panels/coverage.js`, `packages/yakka-analytics/tests/plan29/read-context.test.mjs` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-02-read-context.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-01 for browser done evidence (the code contract stands alone).
Runs alongside: phase1-01, phase1-05.
Budget: read about 14 files, change about 300 lines, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:82-87` — "Read context and capability interpretation" contract, every bullet.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:31-44` — D01, D04, D07, D14; `:56-62` — Start/Pulse/Coverage surfaces.
3. `docs/design/09-analytics-workspace-contracts.md:9-11` — tenant/scope/coverage read-context rules.
4. `packages/yakka-analytics/web/contract/transport.js:22-80` — current request builder, collector-mode tenant injection, per-tenant schema cache that caches failures.
5. `packages/yakka-analytics/web/contract/url-state.js:1-40` — `win`/`from`/`to` URL state; `packages/yakka-analytics/web/contract/session-gate.js:14-31` — remembered tenant and recovery rule.
6. `packages/yakka-analytics/web/js/app.js:120-165` — scope bar and coverage strip; `:300-320` — `clearPanelCause`; `:556-600` — route render, tenant and schema.
7. `packages/yakka-analytics/web/js/panels/pulse-strips.js:25-47` (`scopeParams` sends `win`), `:100-125` (`currentWindow`/`previousWindow`), `:331-370` (summary, previous period and the separate unscopped `/scores` call).
8. `packages/yakka-analytics/web/js/panels/coverage.js:9-18` (`timeText` heuristic), `:27-72` (facts/sessions groups), `:181-213` (load).
9. `packages/yakka-analytics/web/js/explorers/ledger.js:192-195, 274-283, 317, 341`; `sessions.js:95-104, 250-260, 620-690, 781`; `plans.js:94-103, 310-318, 467-475, 790-825, 1140-1145, 1475-1520`; `artifact-content.js:25-32, 125-150`; `artifact.js:580-615` — first/read/retry/more/detail/content/baseline call sites.
10. `packages/yakka-analytics/tests/workspace/ledger.test.mjs:30-75` and `tests/plans-artifacts/plans-list.test.mjs:30-70` — existing window/paging assertions; `tests/plan29/harness.mjs` (phase1-01) — real-Go two-tenant harness.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make every analytics read carry the selected tenant and one resolved scope, so changing tenant/window/filter, reloading and paging never sends a relative `win` or drops `tenant`, and Coverage reports event-time seconds, receive-time nanoseconds, recency and attribution honestly with an explicit All-history action.

## Contract

- `DESIGN.md:82`: "A tenant-bound view receives an explicit read context: API base, auth mode, selected tenant, validated lifecycle generation where available, timezone and resolved scope. Every analytics read and tenant-scoped `/v1/baselines` request uses it, including schema, paging, session detail, content and diff. Cookie-session requests always carry `tenant` … No fallback to another tenant after failure."
- `DESIGN.md:83`: "Resolve relative windows once per view refresh into absolute `from`/`to`; All uses `all=1` with a fixed `to`. Never send `win` to the API. Summary, quality headline, activity, comparisons and linked charts use the same resolution. Cursors retain their original window, filters and tenant; changing any scope starts a new traversal."
- `DESIGN.md:94`: "Coverage distinguishes event seconds from receive-time nanoseconds and reports per-fact-type bounds. The shell shows the latest retained observation and its age, available historical range, scored coverage and missing repo attribution without implying completeness. No observations in the selected window offers an explicit All-history action; it never changes the window automatically."
- `EVIDENCE.md` D07 lists the exact omissions: Ledger first/more/schema, Sessions first/more/schema/detail, Plans continuation, and the baseline cache that accepts tenant but never puts it in params. D04 lists `win=all`/`win=1d` from `pulse-strips.js:24-38` and the unscoped quality headline at `:349`.

## Changes

### A read context, resolved once

- Add `web/js/core/read-context.js`. Export `resolveReadContext({me, state, now})` returning `{base, authMode, tenant, tz, scope, window, paramsFor}` where:
  - `tenant` is `rememberedTenant(me)` and is never empty for a cookie-session view with tenants.
  - `window` is resolved once from `state.from/state.to/state.win` with a single captured `now`; a relative `win` becomes absolute `{from,to}`. `win: 'all'` becomes `{all: true, to: <frozen now>}`. An absolute window without `to` gets the same frozen `to`.
  - `scope` is a shallow copy with `from`/`to` replaced by ISO strings and `win` removed; `tz` stays. Cursors built from it keep the frozen bounds.
  - `paramsFor(extra)` produces `URLSearchParams` with `from`/`to` or `all=1` (plus `to` for all-history), `tz`, declared filters/excludes/cohorts, and never `win`.
- `app.js` builds the context once per route/board render after `/v1/me` and passes `{tenant, scope}` down. `renderBoard`, `renderCoverageStrip`, boards and `clearPanelCause` use that context; a scope change re-resolves and restarts paging. Do not carry the old cursor across a scope change.

### Tenant on every follow-on request

- `transport.get` already adds `tenant` in collector mode when given; the explorers must pass it. Fix:
  - Ledger: first page (`ledger.js:274-283`), load-more (`:317`), `schema('')` (`:341`). `fetchLedgerPage` already accepts tenant (`:192-195`); thread it.
  - Sessions: first page (`sessions.js:620-640`), load-more (`:650-665`), schema (`:683`), conversation detail (`:781`); `fetchConversation` already accepts tenant (`:250-260`).
  - Plans: load-more (`plans.js:1512`), plan detail (`:790-825`). The list's first page already passes tenant (`:1479`).
  - Artifact content/baselines: the baseline cache in `artifact-content.js:125-150` must include `tenant` in its key and its request params. Create caches only after tenant resolution; `plans.js:797` must not create a `tenant: ''` baseline cache before `:1142`.
  - Any request cache key that can cross tenants (`artifact.js:188,512,543` text cache; `plans.js:812-821` bands) includes the tenant in the key.
- Keep authorization strict: a failed read never retries under another tenant. `shouldRecoverTenant` keeps its zero-tenant-only behaviour.

### Scope on every request

- Replace the `win` branch in `pulse-strips.scopeParams` with the resolved context's `paramsFor`. `windowParams` is only for the computed previous window.
- Pulse summary, previous period, quality headline (`pulse-strips.js:349` `/scores?kind=design`) and Coverage summary all receive `{tenant, from/to or all=1, tz, filters}` from the same context. All-history uses `all=1&to=<frozen>`; the previous period is absent, never zero.
- Explorers' window builders (`ledger-table.resolveWindow`/`filterToParameters`, sessions/plans `readScope`) consume the resolved context so a reload and load-more send the same absolute bounds.

### Coverage truth

- `coverage.js`: replace the `>1e12` heuristic with explicit conversions. Event bounds (`first_ts`, `last_ts`) are Unix seconds; `last_received_at` is Unix nanoseconds. Render per-fact-type rows and add one short summary: latest retained observation (max event time and its age), latest usage separately from latest hook (`schema.coverage.usage` from phase1-05), available historical range, scored/total hashes, and sessions with/without a derived repo. Never imply completeness.
- `app.js renderCoverageStrip`: read `schema.coverage.facts` per type (not only top-level `first_ts`/`last_ts`), show the latest observation plus age and the `schema.coverage.usage` line, and keep the "no scorer configured" note.
- Empty selected window: `pulse-strips.emptyCausesFor` (or coverage's empty branch) adds a `{kind:'window', label:'No observations in this window — view all history'}` cause; `app.js clearPanelCause` handles `kind:'window'` by setting `win:'all'` and clearing `from`/`to`, then routes. Never widen automatically.

## Keep untouched

- Schema normalization, artifact-lens iteration, panel field lists, state taxonomy, and any Go file. Those are phase1-03/04/05/06.
- URL semantics for tenants, saved views, identity, theme, and the Plan 28 trial.
- Existing route names and panel IDs.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: this repo uses `node --test` (no vitest); keep `--test-concurrency=1` and `NODE_OPTIONS=--max-old-space-size=8192` within the 8G envelope. Browser specs wait on real end states and captured requests, with no fixed sleeps or animation/timing assertions. Write only inside the worktree's ignored `.scratch/`, never `/tmp`.

- `cd /home/codyh/workspace/yakka-build/29 && PUBLIC_CANVAS_TEST_MODE=true GOTOOLCHAIN=auto NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/workspace/ledger.test.mjs packages/yakka-analytics/tests/plans-artifacts/plans-list.test.mjs` → pass (no regression).
- `… PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 packages/yakka-analytics/tests/plan29/read-context.test.mjs` → pass. The new spec starts `phase1-01`'s harness, captures every `/v1/analytics/` request while visiting Ledger, Sessions (list + detail), Plans (list + continuation) and an artifact baseline, and asserts: each carries `tenant=plan29-a`; none carries `win`; each carries absolute `from`/`to` or `all=1` with a fixed `to`; load-more keeps the first page's `to` and tenant; switching to `plan29-b` switches the tenant and does not fall back to A. Before the fix this fails on the first Ledger load-more/baseline request with no tenant, and on the Pulse `win=all` request.
- Direct API control: `?tenant=plan29-a` 200, omitted tenant 403, and the browser shows an explicit unauthorized/error state rather than a zero/“no data” panel.
- Coverage observable: the Start page strip shows a latest event with an age; the Coverage panel's fact rows show event seconds and receive nanoseconds correctly (no 1970/overflow dates); an empty finite window shows the All-history action and clicking it changes only the URL window. Read `schema.coverage.usage` defensively when present; the latest-usage line is proved by phase1-05's browser check, which may land after this unit.
- Production parity (verification-time read-only): replay these request shapes against the deployed server using trial tenant `test` and `/home/codyh/.config/yakka/trial.env` + `client.toml`. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
