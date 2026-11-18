# 11-05 — Scatter lab and Sessions acceptance

Status: `done with concerns`. The Phase 11 outcome passes end to end in
Chromium on the committed deterministic fixture: the four-panel Scatter preset
settles ready in order, every offered numeric axis/size and colour is published
by `/schema`, rectangles on all four grains become canonical data-space
predicates, union/Alt-subtraction canonicalise, the tray counts reconcile with
one bounded aggregate, time cohorts freeze their source and association counts,
Sessions sorts and pages server-side, and the session detail reconciles the
5,000-event cap. No product code, unit spec or Go file was changed.

## What changed

- `tests/scatter-sessions/acceptance.test.mjs` (new, only changed file): three
  Chromium tests plus two pure contract checks.
  - Scatter board: preset order and `ready` states; X/Y/Size option values are
    published grain measures and never `model`; Colour values are published
    lenses (`session_model`, `band:clarity`); the session sample carries
    `n=38`, `total=1,880` and the fixture hash rule; each marginal table sums
    to the whole-population fixture; each panel's population line names its own
    unit; plan overlap/`not plan-exact spend`, artifact unscored/
    `content_unavailable`/lower-bound/unpriced labels and a no-`$0` check.
  - Exact selection: a rectangle on session, artifact, plan and time yields the
    canonical `and(range,range)`; session union and Alt-subtraction equal
    `canonicalPredicate` of `unionRegion`/`subtractRegion`; the tray shows
    `143 sessions of 1,880 in scope; 38 sampled marks visible`; the bounded
    aggregate's `cohort_n` is the tray count.
  - Peer linkage: `Make cohort A`, `Filter all` and `Exclude this` write
    `ca`/`cb`/`cc` (distinct slots) with one canonical positive predicate, a
    frozen absolute scope and `op` include/include/exclude; every peer request
    carries exactly one `cohort=`; the time source is frozen to
    `fields:[cost_usd,commits,rejections]`, `bucket:day`, `bucket_step:1`.
  - Time cohorts: `7 contributing sessions of 1,880`; source associations
    `9 = 5 + 2 + 2` and target `11 = 8 + 1 + 2` render separately with
    expansion language; the all-rejection bucket is a valid empty selection
    (`0 contributing sessions`, `4 = 0 + 2 + 2`, `5 = 0 + 1 + 4`).
  - Uncertainty: an unknown `score:mystery` / `design_score:mystery` is
    `unsupported` with the nearest published check (clarity/structure).
  - Sessions list: every offered measure sorts by server `sort=<measure>:desc`
    and the rendered page equals the fixture's sorted page; ascending cost;
    Load-more appends the second cursor page with 40 unique ids; a lens chip
    pushes `harness=orca`, narrows the table and removes back to 40; the typed
    line keeps the server total rather than summing a page.
  - Session detail: 5,000 rows and 5,000 lane markers of 5,123 (10 hollow of
    13 unpriced, 3 beyond the cap), the cap lines, `/ledger?conversation_id=`,
    the observed `/artifact?...hash=hash-design` and
    `/plans/repo-a/20-analytics-reset` destinations with their Phase 12 notes,
    and no `cohort=` on `/conversation`.
  - Half-open buckets: a bucket ending at `from` is outside, the bucket
    starting at inclusive `to` is inside, the next bucket is outside.
- No fixture or stub extension was needed: the committed P11 scene already has
  the sampled session scatter, the all-rejection bucket, the top-of-window
  half-open edge, the 40-row two-page list and the capped conversation.

## Fixture fractions, associations and pages

- Session scatter: `population_n` 1,880, `eligible_n` 1,700, `returned_n` 38
  sampled marks, rule `sha256(conversation_id) mod 100 < 3`; marginal sums
  1,880 (cost, unpriced) and 1,700 (commits).
- Exact bounded count: 143 sessions. Artifact scatter: 6 rows, 5 eligible, one
  unscored, one `content_unavailable`, one null writing-session cost, one
  lower-bound cost, 3 unpriced calls. Plan scatter: 2 plans, 1 eligible, 2
  shared-session reports, 7 unpriced calls, non-additive associated cost.
- Time: five daily buckets over `2026-09-01T00:00:00Z`–`2026-09-05T00:00:00Z`;
  7 contributing sessions; source rejection associations `9 = 5 + 2 + 2`,
  target `11 = 8 + 1 + 2`; empty bucket `4 = 0 + 2 + 2` / `5 = 0 + 1 + 4`.
- Sessions list: 40 rows, 20 per opaque cursor page, two pages, 15 offered
  measures. Detail: 5,000 returned / 5,123 total events, 10 returned / 13
  total unpriced calls, 3 unpriced calls beyond the cap.

## Checks: before and after

Before the unit the named check did not exist:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/acceptance.test.mjs
Could not find 'tests/scatter-sessions/acceptance.test.mjs'
```

After (workdir `packages/yakka-analytics`, `NODE_OPTIONS=--max-old-space-size=8192`,
`PUBLIC_CANVAS_TEST_MODE=true`, Playwright via the required `NODE_PATH`):

```
$ node --test tests/scatter-sessions/acceptance.test.mjs
# tests 5  # pass 5  # fail 0  # skipped 0

$ node --test --test-concurrency=1 tests/scatter-sessions/*.test.mjs
# tests 42  # pass 42  # fail 0  # skipped 0

$ node --test tests/workspace/*.test.mjs
# tests 72  # pass 72  # fail 0  # skipped 0

$ node --test tests/trends-quality/*.test.mjs tests/charts-*/*.test.mjs
# tests 122  # pass 122  # fail 0  # skipped 0

$ git diff --check
(clean)
```

Chromium 1243 and `playwright-core` were reachable at
`/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules` and
`~/.cache/ms-playwright/chromium-1243`; no skip was needed and no browser gate
is recorded. The Pages automation gate remains Phase 13. The artifact `id`
lens/reader gate remains Phase 12. Every page asserted `maxInFlight <= 4`,
empty page errors/CSP violations, and only the induced 400 console entry. No
fixed sleep, animation/timing assertion, `/tmp` write or agent was used.

## Carried unit concerns

- 11-01: chart `select` detail carries `selection` and `region`; the panel
  re-emits `.predicate` and the frame ignores raw rectangles. Handled, no gap.
- 11-02: `model` is never numeric; the writing session's model is the
  `session_model` lens. No gap.
- 11-03: the unit edited `artifact-plan.test.mjs` (outside its owned paths)
  because that spec asserted the preset was undelivered; it also ran over
  budget. Both are recorded in its report and remain true here.
- 11-04: `session-lanes` registers on first detail render rather than in
  `panels/index.js`; `/conversation` supplies `tool_kind`/`repo_id`/`plan` in
  the P11 fixture while 7.2 publishes `tool` only. The acceptance detail uses
  the fixture shape and confirms the Phase 12 destinations.

## Deviations and contradictions

- No `acceptance-browser.mjs` was added: the helpers fit in the one acceptance
  file, so the harness did not need a split.
- No fixture/stub edit was made; the existing deterministic edges sufficed.
- A first acceptance draft asserted `40 of 40 sessions shown` after Load-more.
  The product renders 40 unique rows but keeps the typed population line at
  the cursor page's `returned_n` (20 of 40). `returned_n` is defined as page
  size in 17.3, and the brief requires that a sort/filter change never sums a
  partial page (it does not); the assertion was corrected to the contract, not
  the product.
- Brief vs delivered sample labelling: the sampled scatter visibly states
  `sample of 38 of 1,880; marginals are the whole population` and carries the
  hash rule on `yk-chart.spec.sample.rule`, but no visible element prints the
  hash rule itself. If "states its sample rule" means the visible algorithm,
  that wording is unmet; it is not patched here. This is the concern the phase
  verdict should carry.
- The Load-more typed line saying "20 of 40 sessions shown" beside 40 rows is
  the same page-metadata behaviour; it is reported, not patched.

## Unfinished

None for Phase 11. Phase 12 owns the artifact reader and plan detail the
detail links name; Phase 13 owns the Pages automation gate.
