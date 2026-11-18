# 11-03 — Time scatter, time cohorts and the Scatter preset

Status: `over budget`; the unit work is complete and green. The four-panel
`scatter` preset is delivered, time rectangles resolve to contributing sessions
on the response's frozen bucket grid, and rejection associations stay in their
own unit. The overrun is tool turns and files read while adding the Chromium
proof and fixing its first-run failures; no product scope was added.

## What changed

- `web/js/panels/scatter-day.js` (new): `scatter-day` (`grain: time`,
  `charts: ['scatter']`, `requires: ['entities_time']`) plots two published
  numeric time measures on one server bucket grid, default `cost_usd` against
  `commits`. The request is the 11-01 builder plus `bucket=auto`, or the scope
  unit when one is named. `bucket`, `bucket_step`, `coarsened`, `window` and
  partial flags come from the response. `timeBucketInfo`, `bucketInterval` and
  `bucketIntersectsWindow` treat a bucket as half-open `[start, start+step)`
  intersected with the inclusive source window; `timePoint` keeps a null axis
  undrawn but counted and only plots a server-supplied zero. The table shows
  bucket time, timezone, both measures with units, optional size and `partial`;
  marginals are the whole population. A rectangle produces a canonical range
  predicate, counts through `/entities?grain=time&mode=aggregate&stat=count`,
  and emits a session-unit selection from `population.relation.target_sessions`
  with the frozen `source`, associations and target-window expansion. A 400
  naming an unsupported pairing becomes `unsupported` with the server reason.
- `web/js/panels/p11-scatter.js`: registers the four panels and the `scatter`
  preset (`Scatter`) with the canonical specs: session `cost_usd`/`commits`,
  colour `session_model`, size `unpriced_calls`; artifact
  `writing_session_cost_usd`/`score:clarity`, colour `session_model`; plan
  `associated_cost_usd`/`artifacts`, colour `repo_id`; time
  `cost_usd`/`commits`.
- `web/js/core/selection-model.js`: added `timeCohortSource` (response
  `bucket`/`bucket_step` with the plotted fields), `associationTotals` and
  `associationLines`. Source lines appear only when `source.fields` includes
  `rejections`; every line names associated, `no_conversation_id`, orphan
  `orphan_conversation_id`, total unit and `treatment`. Existing
  `cohortDefinition` already forwards an optional `source`.
- `web/js/core/selection-tray.js`: time selections render
  `N contributing sessions of M in scope; S sampled marks visible`, not bucket
  counts. The target expansion and association lines render after the predicate
  and before the actions. A zero-session bucket that holds only unassociated
  rejections says `valid empty selection`.
- `web/css/scatter.css`: association note styling only.
- `tests/workspace/fixture.mjs` (additive): five daily half-open buckets from
  `2026-09-01T00:00:00Z` to `2026-09-05T00:00:00Z`; cost
  1/2/3.5/5/9.5, commits 2/3/1/null/0, rejections 1/0/2/0/4; first and last
  partial; last all-rejection. `p11TimeAggregate` returns 7 contributing
  sessions of 1,880 by default and 0 for the all-rejection bucket, with source
  associations `9 = 5 + 2 + 2` selected and target `11 = 8 + 1 + 2` dropped
  (`4 = 0 + 2 + 2` and `5 = 0 + 1 + 4` empty). Every P10 and 11-01/11-02 body
  is unchanged.
- `tests/workspace/stub-api.mjs`: routes `grain=time` scatter and aggregate to
  the new bodies.
- `tests/scatter-sessions/scatter.test.mjs`: five pure checks (request/axes,
  source freeze, half-open boundary, canonical cohort source, association
  unit/totals/tray text) and the Chromium board proof.
- Phase 9 expectations: `start.test.mjs` now asserts the legacy `/b/scatter`
  page is the delivered `Scatter` board (four panels, no
  `Delivered in Phase 11`); `acceptance.test.mjs` names only `/b/workflow` and
  `/plans` as later destinations and expects 2.

## Checks: before and after

No pre-change baseline was captured; the first run of the new spec after
implementation failed 4/16: request window text used `.000Z`, `auto` was
misreported as coarsened, the browser expected milliseconds in the frozen
cohort, and the table selector also counted marginal rows. Those were fixed.

After (workdir `packages/yakka-analytics`, 8 GiB heap,
`PUBLIC_CANVAS_TEST_MODE=true`, Playwright via the required `NODE_PATH`):

```
$ node --test --test-concurrency=1 tests/scatter-sessions/scatter.test.mjs
# tests 16  # pass 16  # fail 0  # skipped 0

$ node --test --test-concurrency=1 tests/workspace/engine.test.mjs
# tests 9  # pass 9  # fail 0

$ node --test --test-concurrency=1 tests/workspace/start.test.mjs
# tests 2  # pass 2  # fail 0

$ node --test --test-concurrency=1 tests/workspace/acceptance.test.mjs
# tests 5  # pass 5  # fail 0

$ node --test --test-concurrency=3 tests/workspace/*.test.mjs tests/scatter-sessions/*.test.mjs tests/*.test.mjs
# tests 111  # pass 111  # fail 0  # skipped 0

$ node --test --test-concurrency=3 tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs
# tests 68  # pass 68  # fail 0

$ node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 54  # pass 54  # fail 0
```

Chromium 1243 was reachable, so no skip or gate is recorded. The browser spec
proves the four panels settle `ready` in preset order; axis/colour/size offers;
the labelled session sample and marginal totals; rectangles on all four panels
with union and Alt-subtraction; tray session counts and sampled marks
separately; `Make cohort A`, `Filter all` and `Exclude this` writing canonical
cohorts with frozen absolute `source` and exactly one `cohort=` per peer
request; time associations, expansion, valid empty selection and a named
unsupported 400; fixture table rows; `maxInFlight <= 4`; page errors and CSP
clean. The only console entry is the deliberately induced 400.

`git diff --check` is clean. No `/tmp` writes, fixed sleeps, animation/timing
assertions or Go edits. No agents were spawned.

## Deviations and contradictions

- **Brief contradiction (resolved, reported):** the brief's owned paths omit
  `tests/scatter-sessions/artifact-plan.test.mjs`, but that 11-02 spec asserted
  the preset `panels.length === 0` and `named` delivery, so it necessarily
  fails once 11-03 delivers the preset. I changed only that final assertion to
  expect all four panel ids and a `board` destination; no product code was
  changed to satisfy a test. This is outside the owned paths and is the one
  edit outside them.
- **Budget:** more than 40 tool turns and more than 20 files were read while
  iterating on the browser proof. The handoff is recorded under this brief in
  `IMPLEMENTATION.md`. The product change remains within the brief.

## Unfinished

None for this unit. 11-04 (Sessions list/detail) and 11-05 (phase acceptance)
remain, as planned.
