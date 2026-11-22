# Plan 30 — Analytics operable chrome

Plan 30 amended the closed Plan 29 analytics workspace into an operable console: a reserved and visible tenant scope, editable time/repository/document-kind filters with honest retained-event counts, a dense shell and board layout, a literal plain-language caption on every chart, and a discoverable account console that preserves the existing owner-only lifecycle. It met its three phase outcomes. Every phase acceptance check passes in real Chromium against a real-Go two-tenant fixture; authenticated production and deployment checks remain explicit gates.

## Intent

User request, verbatim:

> Work only in worktree /home/codyh/workspace/yakka-wt/30-analytics-operable-chrome (branch docs/30-analytics-operable-chrome, off origin/master). Don't edit other worktrees or checkouts. You may read them.
>
> Task: headless design amendment after Plan 29 was designed (PR #280, e5052a43), built and closed out (PR #282, aeacc24a, now docs/plans/29-analytics-ui-rework.md), and deployed. Cody is looking at the live Plan 29 UI and says it is still broken.
>
> Cody (21 Nov 2026, 8:24 PM AEST), verbatim: "We are clearly getting all events, yet the dashboard only shows like 16 - and there's no longer any way to manage tokens, tenancies etc. There's nothing in the dashboard to even select results by tenancy. Most of the graphs have gibberish descriptions that don't actually describe, in simple terms, what they actually are meant to be showing. It has fake filters everywhere saying 30d with an x that does nothing, and you can't actually filter anything anywhere. Am I missing something or is it actually all just broken"
>
> Cody (8:25 PM): build agents are Haiku, Luna or Composer and need explicit direction, especially for UI. The design or amendment must be prescriptive and leave no judgement to the builder. For every screen give: the route, the nav entry, a layout spec (regions, column widths, order) with an ASCII wireframe; every control (type, label, options, default, the exact query param or API field it sets, and what changes when it's used); every table's columns, sort order, row height and empty, loading and error states; and every chart's type, data source and endpoint field, axes, units, theme token, and the exact plain-language caption text. Also list explicit 'do not' rules (no decorative chips, no centre alignment, no white backgrounds), and give each item an acceptance check that can be tested with Playwright. Name the files and components to change.
>
> Cody (8:27 PM): include UI mockups as images. For each screen in the amendment, produce a PNG mockup and commit it under docs/plans/<plan>/mockups/<screen>.png, then reference it from DESIGN.md next to that screen's spec. The most reliable way: write a static HTML/CSS mockup per screen using the real theme tokens and realistic sample data, then screenshot it at 1440x900 with Playwright (headless Chromium on this machine). Commit the HTML sources too, under mockups/src/. The mockups must follow the density rules: full width, left-aligned, 28-32 px rows, dark or no-white chart surfaces, and a visible tenant selector and working filter bar. The written spec stays authoritative; the images are a visual reference.
>
> This is Plan 30, docs/plans/30-analytics-operable-chrome (better slug if the skill prefers). It amends Plan 29; do not reopen the closed-out 29 folder as the build source. Keep Cody's density rules: old-school, full width, no centre alignment, and no white chart backgrounds. Don't build product code, don't merge, and don't invent a new IAM system.
>
> The design must cover: restoring token, tenant and membership management in the nav; a global tenant selector that scopes every view; real working filters (time window, repo, tenant, kind) with no decorative chips; correct event counts; and a one-sentence plain-language caption on every chart saying what it shows and how to read it.
>
> The amendment must therefore be a new plan that specifies the missing chrome and the event-count/caption/filter behaviour, and names any Plan 29 leftovers only where they still apply. Be holistic about every board and explorer that uses the shared chrome.
>
> Follow the Yakka design skill. You are headless and no one will answer: keep an assumption ledger. If a question truly blocks the work and only Cody can answer it, stop and report it rather than assuming. Land the design (docs, mockup HTML, and mockup PNGs only) as its own ready PR into master, not draft. Write /home/codyh/workspace/yakka-design-logs/30-analytics-operable-chrome/done.md with the PR URL, a short verdict on whether the live UI is broken and why, mockup paths, and what Executor must build.

The design was signed off in PR #310 and built on `feat/30-analytics-operable-chrome`.

## Why This Existed

Plan 29 repaired analytics read correctness, density and theme propagation but did not design the chrome that makes the workspace operable. The live console had no visible tenant selector, no editable time/repository/document-kind scope, no route to token/tenant/membership management, and chart captions that described implementation rather than the question answered. Activity observations could be mistaken for ingestion totals, and an unusable 30-day chip implied a filter that did nothing. Plan 30 designed and built the missing shell, scope, exact counts, captions, panels and account surfaces without reopening Plan 29 or inventing new IAM or attribution.

## What Was Built

**Changed:** the analytics shell (`index.html`, `app.js`, `core/scope-controls.js`, `core/event-counts.js`, `contract/url-state.js`, session gate and transport), the Go analytics/store read contracts (`analytics_event_counts.go`, shared retained-record predicate in `store/analytics.go`), the panel/caption/applicability/board layer and every board and explorer, the identity account console and account routes, the API-origin lifecycle template, the shared theme/layout CSS, and the Plan 30 Chromium/Go proof harnesses.

### Phase 1 — One selected tenant and filter set, with honest totals

Added `GET /v1/analytics/event-counts` with `{matched, tenant_total, checked_at, unit}` and capability flags `event_counts` and `record_filters`. It parses filters exactly as `/explore` does, shares one retained-record predicate with ExplorePage, and returns `400 unsupported_filter` for unrecognized includes/excludes. The shell gained the 46/32/32px identity and nav rows, a reserved `tenant` URL field with strict authorized-tenant precedence, immediate tenant teardown and cache invalidation, and native window/repository/kind/timezone controls with a local draft, Apply, Reset, All history and Refresh. Pulse and Ledger now show retained events, rejections, activity observations and rows displayed as separate labelled denominators, with exact loading/empty/error/paging states. Proven by S1, N1, C1–C11, V1/V4/V5 and T1–T4 against a real-Go two-tenant fixture.

### Phase 2 — Every board and explorer answers its displayed question in plain language

Added the literal caption registry and filter-applicability rule: each panel renders title → one-sentence caption → compact controls → chart/table → population text, and any unsupported active filter removes marks and explains why instead of returning unfiltered data. Board assembly uses the prescribed panel order, spans and 30px rows; all eight boards and every list/detail screen implement their S contract, the G catalogue's literal captions and defaults, the P panel controls, and T1–T5 states. The chart kit gained explicit Y ranges, dash/outline comparison styles, shared multiple-chart Y domains, grouped compare histograms and horizontal stacked bars to close the unit-level chart gaps. Proven by 83 Phase 2 acceptance IDs, the sixteen 1440×900 light/dark screen comparisons, F1–F6, all G items, P1–P10, T1–T5 and V1–V5.

### Phase 3 — Account operations are discoverable and preserve existing authority

Added the account console at `/profile` for owned tenants and membership (Owner derived only from `/me`), tenant creation, and client-filtered token creation/revocation with one-time plaintext and no secret persistence. The account routes (`/settings`, `/login`, `/oauth/callback`, `/device`, not-found) use the exact titles, copy, payloads and safe-return behaviour, while the API-origin lifecycle page was restyled densely and linked per tenant without moving or weakening reset/delete authority. Proven by A1–A6, F7, the seven account screens, C1/C10 and V1–V5, with destructive writes stubbed and existing Go lifecycle security tests unchanged.

## Deviations

- The Phase 2 unit reports initially recorded chart-kit gaps (shared Y domain, dashed previous series, grouped compare bars, horizontal stacked bars); the subsequent chart-contract commit closed them in the shared chart kit. They are not standing deviations.
- The Phase 1 Ledger denominator was placed in the footer by the first unit and moved above the table to match S-ledger; that was a brief error, not a design change.
- The Phase 2 diff is materially over the ~450-line unit budget because captions, exact tables and applicability are one coherent contract per board family.
- `event-counts` is capability-gated; a Pages-first deployment without the API shows the truthful unsupported state rather than a zero or sample total. The Artifact identity form and Ops health row likewise request only capabilities their server advertises.
- Real owner lifecycle reset/delete writes are stubbed in the Phase 3 proof; the existing Go security and engine tests remain green and unchanged.
- The Phase 1 acceptance suite's C3/C4 assertion added during the terminal fix round assumed clearing Kind returns the draft to the committed scope, but the repository draft and the displayed timezone keep it pending; the assertion was corrected to the contract-correct enabled state (test-only change, product behaviour unchanged).

## Review

The design review (PR #310) passed with low follow-ups about production count evidence and promoting the contract at close-out. Per-phase reviews and one terminal review followed. The terminal review returned BLOCKING with high findings in the Pulse summary gating (F1), the Plan 29 regression suite, generic panel states (T1–T3), Kind clearing/validation (C4), unrecognized excludes (N1), the Quality and Scatter controls/captions (P5/P6, G-scores/G-scoretrend/G-strips/G-bands, G-sessionxy/G-artifactxy/G-planxy/G-dayxy), and the session-detail region order (S-session-detail). The single fix round resolved all eight: per-measure Pulse gating with Movers/Calendar refusal, an updated Plan 29 artifact acceptance, exact panel loading/empty/error rows with recovery, clearable Kind with draft validation, `400 unsupported_filter` for unknown excludes, published Check/Scorer and scatter option intersections with integer axes and artifact proof, and the ordered session-detail regions with separated links. The close-out rerun confirmed the fix round's suites and corrected the one bad Phase 1 assertion described under Deviations.

## QA

Rerun at close-out, each suite in its own process with `PUBLIC_CANVAS_TEST_MODE=true` and an 8 GB heap cap:

- `tests/plan30/phase1-acceptance.test.mjs` + `legacy-counts.test.mjs`: 21/21 pass.
- `tests/plan30/previous-filter-scope.test.mjs`: 4/4 pass.
- `tests/operable-chrome/phase2-acceptance.test.mjs`: 1/1 test, 83/83 result IDs pass, 16 light/dark 1440×900 comparisons, 0 failures.
- `tests/operable-chrome/phase3-acceptance.test.mjs`: 1/1 test, 23/23 result IDs pass, 7 comparisons, 0 failures.
- `tests/plans-artifacts/acceptance.test.mjs` (Plan 29 union regression): 3 pass, 0 fail, 1 intentionally retired version-mark reader skipped.
- `go test ./internal/serve ./internal/store -count=1`: both packages ok.

Screenshots and `results.json`/`comparisons.json` live under the gitignored `.scratch/plan30-chrome/`. The visual references are preserved at `docs/plans/30-analytics-operable-chrome-assets/mockups/` (PNG plus HTML sources and capture script) so the comparisons and regeneration commands survive close-out.

## Residual Risks

- No authenticated production read, signed-in screen check or deployment was performed; exact live totals, the deployed API image and the Pages side of the identity flow remain unverified.
- Screenshot comparisons are 1440×900 top-of-page captures of the real app against the references, not pixel-diff goldens; the written contracts and DOM assertions are authoritative where they differ.
- `tests/trends-quality/cost.test.mjs` keeps a pre-existing distribution-range expectation failure that reproduces outside Plan 30 and was not edited.
- The stale Playwright `.spec.ts` files under `tests/e2e/` still assert pre-Plan-30 account and shell shapes; they are not part of the documented runner and were not used as evidence.
- On a route whose URL has no `tz`, the first interaction adopts the displayed browser timezone into the draft, so returning every filter to the committed value still reads as "Unapplied changes". This is a low-severity interaction quirk, not a contract violation; the applied scope is correct.

## Follow-ups

Review follow-ups live as GitHub issues on `codyhamilton/yakka`: #318 (Follow/Saved-board chrome on Start/Pulse), #319 (basis text outside Data details and Tools titles), #320 (facet metadata loading/error states), #322 (inspector P9 labels/actions), #323 (account Retry does not re-read `/me`), #325 (generic Composition/Treemap titles), #327 (blank tool-kind category label), #329 (required tenant name), #330 (URL timezone Intl validation), plus comments on #312 and #316. The pre-existing `cost.test.mjs` failure and stale `tests/e2e/` specs are recorded above and remain open follow-ups.

## Decisions Worth Keeping

- The one-sentence caption registry and per-measure filter applicability are the durable rule: a chart either answers its named question or refuses with the literal reason, never silently drops a filter or shows a raw identifier.
- Retained-event counts are an additive, capability-gated API over the same retained-record predicate as `/explore`; activity observations, page rows and ingestion totals stay separate denominators.
- The authorized tenant is a reserved URL field with explicit precedence, immediate generation teardown and no silent fallback; tenant selection is visible on every analytics screen.
- Owner-only lifecycle reset/delete stays on the API origin with typed confirmation; the workspace restores its link rather than moving or weakening it.
- The design mockups are kept as durable visual references at `docs/plans/30-analytics-operable-chrome-assets/mockups/`, and the workspace contracts are promoted into `docs/design/09-analytics-workspace-contracts.md`.
