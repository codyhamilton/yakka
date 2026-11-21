# Brief: phase1-04 — Real-Go two-tenant fixture and Chromium proof

Consumer: a proof/test build worker for Plan 30 phase 1.
Owned paths: new `packages/yakka/internal/serve/plan30_harness_test.go`, new `packages/yakka-analytics/tests/plan30/harness.mjs`, new `packages/yakka-analytics/tests/plan30/phase1-acceptance.test.mjs`, new `packages/yakka-analytics/tests/plan30/legacy-counts.test.mjs`. Touch nothing else. Do not modify Plan 29 harness/tests, product code or Go production code.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase1-04-proof-harness.md`, listing every phase acceptance ID with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase1-01-go-event-counts`, `phase1-02-shell-scope`, `phase1-03-pulse-ledger` (all landed).
Runs alongside: nothing.
Budget: about 20 files read, about 1,100 lines changed, 70 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 63–81 — the counts body and **N1**; line 81 is the fixture population and the three-denominator assertion.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–160 — **V1–V5, C1–C11, T1–T4**; these are the checks you prove.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 498–516 and 730–740 — **S-pulse** and **S-ledger** region order and acceptance.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 1015–1038 — the phase outcome’s exact proof list; do not add phase-2/3 checks.
5. `packages/yakka-analytics/tests/plan29/harness.mjs` — the spawn/static/proxy/cookie/delay-free pattern to copy.
6. `packages/yakka/internal/serve/plan29_harness_test.go` — the build-tag/real-Server/control-route/seed pattern to copy; `mockGitHub`, `loginRemote`, `remoteCreateTenant` live in `serve_test.go`.
7. `packages/yakka-analytics/tests/charts-time/browser.mjs` — `loadBrowserEnvironment`, `launchBrowser`, `SKIP_REASON`; use these, do not invent a launcher.
8. `packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs` lines 1–140 and its `waitIdle` usage — structure, diagnostics, no fixed sleeps.
9. `packages/yakka/internal/store/activity.go` — the exact activity observation definition (session start + artifact version + brief execution + rejection).
10. `packages/yakka/internal/store/store.go` lines 560–585 and `internal/store/analytics.go` lines 90–130 — `AppendRejection` sets `at=now`, facts accept `TS`; you will update seeded rejection times through `Tenant.Raw()`.
11. `packages/yakka-analytics/web/js/panels/river.js` and `explorers/ledger.js` — the labels/DOM your browser checks query (read after phases 1–3 land).
12. `packages/yakka-analytics/web/js/app.js` and `core/scope-controls.js` — control labels, nav ids and state attributes your checks query.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

One test-only real-Go, cookie-session, two-tenant fixture and one real-Chromium suite that prove Phase 1 end to end: S1, N1, C1–C11, V1/V4/V5, T1–T4. No request interception, no fake API, no fixed sleeps.

## Contract

Settled by DESIGN.md lines 63–81, 99–160, 498–516, 730–740, 1015–1038. The proof must be honest:

- **No stubs or interception.** Do not use `page.route`, `route.fulfill`, `route.continue` or synthetic API responses. Delays and busy states come from the real Go server through test-only control routes. The only unit-stub is the legacy-capability test in `legacy-counts.test.mjs`, which exercises the client state machine with no `event_counts` flag and never pretends to be a browser/API proof.
- **No fixed sleeps.** Wait on URL, request counts, rendered attributes/text and `harness.waitIdle`; use `page.waitForFunction`/locators with explicit predicates. Delay only through the control route and then await the real completion.
- **No `/tmp`.** The Go fixture roots at `.scratch/plan30-harness/<pid>` and deletes it; screenshots go to `.scratch/plan30-chrome/screens/`. Never log cookies, tokens or row dumps.
- **Viewport:** 1440×900, device scale 1, for every layout screenshot and V1/V4/V5 measurement. Set `PUBLIC_CANVAS_TEST_MODE=true` for the harness child and browser.
- **Fixture is the single source of expected numbers.** The Go harness exposes `/__plan30/fixture` with tenant ids/names, marker ids and the exact expected counts below. Browser assertions read that JSON; never hard-code a count in two places.

### Fixture population (binding arithmetic)

Tenant A, all timestamps relative to seed time: in-window facts are between now−20d and now−1h; old facts are before now−45d. The browser’s 30d window therefore includes exactly the in-window set.

- **12,480 facts total, exactly 8,406 in the 30d window:**
  - 4,000 `hook_event` tool_call facts, repo-a, sessions s1–s3 (marker s1 = `plan30-a-only`).
  - 4,000 `hook_event` usage facts, repo-b, sessions s4–s6.
  - 200 `session_action` facts repo-a, 200 repo-b, distributed across the same six sessions.
  - 2 `artifact_version` brief facts, repo-a/plan-a (two distinct `repo:conversation:path` groups).
  - 2 `artifact_version` design facts, repo-b/plan-b.
  - 2 `commit` facts repo-a.
  - Sum: 4,000+4,000+200+200+2+2+2 = 8,406.
  - Old facts: 4,074 `hook_event` usage facts before now−45d (repo-c, conversations old-1/old-2). Total 8,406+4,074 = 12,480.
  - Every fact type above must be present in the in-window set: `hook_event`, `usage`, `artifact_version`, `commit`, `session_action`.
  - Repo/kind intersection: repo-a + kind brief = 2 events; repo-b + kind design = 2; repo-a alone = 4,204 events; repo-b alone = 4,202.
- **9 rejections total, exactly 4 in-window** (use `AppendRejection`, then set `at` through `ts.t.Raw()`; old five before now−45d). In-window rejections:
  1. conversation `plan30-a-only`, path `docs/plans/plan-a/briefs/01.md`, stage `screen`.
  2. conversation `s2`, path `docs/plans/plan-a/reports/01.md`, stage `precheck`.
  3. conversation empty, path `docs/plans/plan-b/briefs/02.md`, stage `screen`.
  4. conversation `plan30-a-only`, path `docs/plans/plan-a/briefs/03.md`, stage `screen`.
  Repo/harness/model/source are absent on rejections, as the store has no such columns. Path-derived kind/plan: 1/2/4 → plan-a (brief, report, brief), 3 → plan-b/brief. In-window `conversation_id=plan30-a-only` must include rejections 1 and 4 and exclude 2 and 3; `repo_id=repo-a` must include 0 rejections because the field is absent.
- **16 activity observations in 30d:** 6 session starts + 4 artifact versions + 2 brief executions + 4 rejections. All-history from the same population is 23 (8 session starts + 4 artifact versions + 2 brief executions + 9 rejections); the UI must still call them observations, never events.
- **Derived counts:** 30d matched events 8,406 / rejections 4 / rows 8,410; tenant total events 12,480 / rejections 9 / rows 12,489; All history matched = tenant total. Empty custom window 2020: matched 0/0/0, tenant total unchanged.
- **Tenant B is disjoint:** 3 facts (1 usage hook, 1 artifact_version design, 1 commit) + 1 in-window rejection = 3 events/1 rejection/4 rows, all repo/kind/conversation `plan30-b-only`. Activity 3 observations. Appending one usage fact through the control route gives 4 events/1 rejection/5 rows and still 3 observations.
- **Foreign tenant:** an unowned UUID, not `plan30-*`; direct analytics request returns 403 and the UI shows the literal unavailable state, with no read and no fallback.
- **Marker:** `plan30-a-only` appears only in tenant A data; `plan30-b-only` only in B. Use them to prove no prior-tenant data returns after a switch.

### Go harness (`plan30_harness_test.go`, build tag `plan30harness`)

- Real `New(Config{...}, Options{DisableWorker:true, GitHubHTTPBase: gh.URL, PollInterval: time.Hour})` remote-auth server, one mock GitHub owner, two owned tenants created via `remoteCreateTenant`, real session cookie installed by the control route. Ports/origins loopback; no external calls.
- Seed tenant A and B exactly as above, batched; assert the seeded counts against direct queries before printing ready; fail the harness if the arithmetic is wrong. Write artifact content only if a promoted blob is needed; activity counts artifact_version facts, so content is not required for N1.
- Control routes (GET unless noted, all loopback, no auth, `Cache-Control: no-store`):
  - `/__plan30/session?tenant=` → installs the real cookie, 204.
  - `/__plan30/fixture` → `{tenants:[{id,name}], markers:{a,b}, expected:{...}}`.
  - `/__plan30/delay?tenant=&ms=` → set/clear a real per-tenant handler delay (ms 0 clears); delay only inside the wrapped app handler, never the control routes.
  - `/__plan30/hold?tenant=&on=1|0` → occupy/release all `tenantState.analyticsSlots` tokens for that tenant, forcing real 503 busy; release must drain safely and be idempotent.
  - `/__plan30/append?tenant=` → append one real usage fact to tenant B and return the new fact count.
- Print `PLAN30_HARNESS_ORIGIN=` and `PLAN30_HARNESS_READY`; stay up until stdin closes or signalled; shut down cleanly. Do not modify `plan29_harness_test.go`.

### Node harness (`tests/plan30/harness.mjs`)

Copy the Plan 29 pattern: spawn `go test -tags plan30harness -run '^TestPlan30Harness$' -count=1 -v ./internal/serve`, parse origin/ready, fetch the fixture, serve `web/` from the same-origin static server with `_headers` CSP, proxy `/v1/`, and expose `installSession(context, tenant)`, `attach(context)`, `waitIdle(page)`, `control.delay`, `control.hold`, `control.append`. Do not set `localStorage` for the main suite: tenant selection must go through C1. Clean the child process group on failure. Diagnostics: fail on pageerror/console error except expected 401/403/503 resource messages.

### Browser suite (`phase1-acceptance.test.mjs`)

One top-level test, subtests per ID; collect failures so one failure does not hide the rest. Use `loadBrowserEnvironment`/`launchBrowser`; skip with `SKIP_REASON` when Chromium is unavailable.

- **S1:** install session A (no remembered tenant), go to `/ledger?win=30d`; set delay A 400ms; start the A load, immediately choose tenant B in C1; await B ready. Assert: all subsequent `/v1/analytics/` requests carry tenant B (or no tenant for `/me`), URL tenant is B, counts show B (3 events), no `plan30-a-only` text/row/attribute; capture the delayed A response with `waitForResponse`, await two animation frames after it settles, and assert it did not paint (no A row, count, caption or inspector), then Back restores A with a fresh request and no stale B, Forward restores B. Assert no prior-tenant data is visible after either direction and the history entry count changed only on the committed tenant selections.
- **N1:** in the same browser, assert the exact visible labels:
  - counts strip `Events matching filters: 8,406 · Rejections: 4 · All retained events in tenant: 12,480`;
  - Pulse activity `16 observations displayed of 16 matching observations`, and the G-activity caption verbatim;
  - Ledger `100 rows displayed of 8,410 matching records` after page one and still `… of 8,410 …` after `Load more events`;
  - All history → counts matched `12,480`, Ledger denominator `12,489`, activity still labelled `observations` and equal to `/activity`’s population (23), never `12,480`; Ledger appends to 200 without changing the event total.
  - In-page fetch the real API: `/event-counts` body equals the expected matched/total triples, `unit=retained_record`, `rows=events+rejections`; a full `/explore` cursor traversal under the same filter equals `matched.rows`; `/schema.features.event_counts=true` and `record_filters=true`. Cross-check every value against the fixture manifest.
  - Repo/kind/empty/foreign/record-filter cases: repo-a counts 4,204/0; kind brief 2/0; repo-a+kind brief 2/0; `conversation_id=plan30-a-only` includes exactly the expected facts plus rejections 1 and 4 (not 2/3); empty 2020 window shows 0 matched and non-zero tenant total without claiming a fake zero; unowned tenant URL shows “This tenant is unavailable to your account.” and direct API 403; no A fallback.
- **C1:** selector always visible at 1440, current tenant when single, options labelled name+ID, pending/foreign disabled; selecting B issues one new authorized generation and no A request; reload remembers B; URL B wins over remembered A.
- **C2:** each window chip persists to `win` and refetches with frozen absolute `from`/`to`; old `24h` renders as 24 hours; custom blank/invalid shows “Enter a start before the end.” with Apply disabled; valid custom applies once; DST-invalid wall time shows “Use an unambiguous time in the selected timezone.”
- **C3/C4:** repository/kind native selects show served facets, preserve an unknown URL value as `{value} (not in this window)`, apply on Apply only, and change requests/counts; repeated values use the multiple form and a nonempty include maps to the exact filter.
- **C5:** timezone list contains browser zone, UTC, Australia/Brisbane and the URL zone; changing it changes `tz` and calendar labels without changing retention math.
- **C6:** change 3 controls, assert zero analytics reads before Apply and visible “Unapplied changes”; Apply issues one request set and one history entry; a second Apply with no change issues none; Back restores inputs without a push.
- **C7:** Reset removes filters, cohorts, exclusions, selection and custom window; preserves tenant, timezone and panel chart/measure selections; Compare keeps `cmp=period` when on that route; default state has no removable chips.
- **C8:** All history sets `win=all`, clears `from/to`, keeps tenant/repo/kind, discards draft, clears cursor, and changes counts/Ledger totals as above.
- **C9:** append one fact to B via control, click Refresh, assert new generation, new counts (4 events), Ledger reset to page one, and no stale rows.
- **C10:** Theme toggles light/dark, persists, and leaves no white chart/surface in dark; no layout shift.
- **C11:** open a deep link with `exclude=stage:screen` and `tool=Read`; the Advanced scope shows both rows; create a real cohort by selecting a session row and using the tray’s Add cohort action, reload that URL as the deep link, then Remove one row and assert the exact URL delta, no window reset, and related `pick`/`sel` cleared. Never choose a different cohort.
- **V1/V4/V5:** at 1440×900 measure identity row 46px, analytics nav 32px, account nav 32px, heading 32px, filter row ≥44px, count line 32px; `<main>` full width (left 0, 12px inner gutter, right ≤1440, no horizontal page scroll). Assert nav orders/hrefs exactly; Start→`/`, all 13 analytics entries and the 5 account entries; brand→Start; active link `aria-current=page`, anchor `aria-current=location`; Theme right of the tenant field; no lifecycle nav entry; keyboard tab order starts with brand→tenant→theme→nav.
- **T1:** with A delayed, navigate Ledger; header remains and one full-span 30px row says `Loading Event ledger…`, `aria-busy=true`, and no prior-tenant/scope rows or zeros remain; later the real rows replace it.
- **T2:** custom 2020 empty window shows the header plus `No records match these filters.` with working All history and Reset filters; each recovery produces a real request and correct counts.
- **T3:** hold A’s analytics slots, load Ledger/counts; assert `Could not load Event ledger.`, a sanitized `busy` code, a focusable Retry and the busy wording; release and Retry succeeds with the committed scope. Assert 401 renders `Sign in` and 403 renders `You do not have access to this tenant` through the client classifier unit path (real request for the foreign-tenant 403), never raw body/stack.
- **T4:** Ledger first page limit 100; `Load more events` appends via the API next cursor with the same frozen filters/tenant; button disabled and labelled `Loading…` while pending; 100→200 identities unique; denominator unchanged; force a next-page failure (release/hold or delay then abort via a real navigation) and assert rows stay with `Retry next page`; scope change clears cursor/rows.
- **Legacy (`legacy-counts.test.mjs`):** import the client count-strip state machine with a schema that lacks `event_counts`; assert the literal “This server cannot report retained-event totals.” and the Ledger link, and no fabricated zero. This is a unit check, not browser interception.
- **Screenshots:** save full-page 1440×900 PNGs for Start, Pulse, Ledger and one board under `.scratch/plan30-chrome/screens/`; compare each with `mockups/start.png`, `pulse.png`, `ledger.png` and the shell in the mockups (region order, density, counts, nav rows, no white surfaces), and record the comparison in the report. Screenshots are not proof of behaviour; the assertions above are.

## Done evidence

- `cd packages/yakka-analytics && node --test tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs` → every subtest passes (or Chromium skip reason recorded); failures collected with ID names.
- `cd packages/yakka && go test -tags plan30harness ./internal/serve -run '^TestPlan30Harness$' -count=1` → fixture starts, asserts its own seed arithmetic and shuts down cleanly (run it once directly; the Node suite also spawns it).
- `cd packages/yakka-analytics && node --test tests/plan29/phase3-acceptance.test.mjs` → the Plan 29 suite is not broken by the new test-only files (it may skip without Chromium; report which).
- Observable: the harness prints the fixture manifest and the browser logs no unexpected pageerror/console error; every numeric assertion matches the manifest rather than a duplicated literal.
- The report lists S1, N1, C1–C11, V1, V4, V5, T1–T4 each with pass/fail and the specific assertion/evidence, plus any skip reason and the screenshot file list.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
