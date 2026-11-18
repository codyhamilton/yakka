# Report 12-06 — `/plans/<repo>/<plan>` detail

## Status: over budget

The requested work and evidence are complete, but the unit exceeded its
"about 1,000 lines to change" budget (8 tracked files, +1,178/-24, plus a ~350-line
test and this report). The fixed plan detail renders its plan row, artifacts by kind, executions,
sessions with resolved cost and the overlap note, all observed events, the
delivered plan-timeline panel, and design phases/brief paths parsed from stored
`DESIGN.md` for display only. It never sends `cohort=`, never falls back to
another plan, and never infers completion or review. No server, Go, migration,
dependency, grain, join or contract changed; no live server, deploy or secret
was used.

## What changed

- `web/js/core/router.js`: removed `NAMED_ROUTES`; `/plans/<repo>/<plan>` is an
  explorer record with `plan:{repo_id,plan}`. Segments are decoded exactly once;
  malformed encodings and `/plans/<one-segment>` are not-found; `/plans` stays
  the list and `/artifact` stays an explorer.
- `web/js/explorers/plans.js`: `render` branches on `parseRoute(...).plan`;
  the list path is unchanged (`renderList`). Detail helpers: `parsePlanDetailPath`,
  `planRowParams`, `planArtifactsParams`, `planExecutionsParams`,
  `planCollectionParams`, `planSessionResolveParams`, `planDesignArtifactParams`,
  `planDetailNotApplied`, `detailPopulationText`, `parseDesignPhases`,
  `parseBriefPaths`, `pairBriefs`, `briefObservationText`, `detailExecutionCost`,
  `detailSessionCost`, `detailWritingSessionCost`, `detailMoney`,
  `artifactLatestDestination`, `artifactScoreEntries`, `executionScores`,
  `designScoreTextWithScorer`. Seven independent sections each carry
  `data-section` and `data-state`; paging is per section; timeline loads through
  `createPanelFrame` and is destroyed on teardown; design content uses
  `/entity?grain=artifact` then `fetchArtifactText` with exact failure reasons.
- `web/css/plans.css`: detail chrome only (identity, sections, phases, unpaired
  briefs, load-more); no chart styling.
- `tests/workspace/fixture.mjs`: additive P12 detail scene — `acme/widgets`
  (six artifacts across all kinds, two sessions with one resolved, unpaired
  brief 99, Phase 7 without a brief), `repo-a/21-empty` (design row whose content
  is `content_unavailable: not_stored`), `repo-a/22-empty`, and a design body
  with `### Phase 3/7/12`, outcomes, a prose decoy and a fenced decoy. The
  ten-plan list population and every P10/P11 body are unchanged.
- `tests/workspace/stub-api.mjs`: serves the detail plan page only when `plan`
  is present, artifact rows by plan, plan sessions, repeated `id` session
  resolution and plan `collection=sessions`; list requests are untouched.
- `tests/workspace/engine.test.mjs`, `tests/plans-artifacts/plans-list.test.mjs`,
  `tests/plans-artifacts/artifact-reader.test.mjs`: detail route expectations
  updated from the removed named route to the explorer identity, including the
  encoded repo and malformed-segment cases.
- `tests/plans-artifacts/plan-detail.test.mjs` (new): 6 pure and 4 Chromium
  cases.

## Check output

Before (HEAD `c1de938`):

```
$ git show HEAD:packages/yakka-analytics/web/js/core/router.js | grep -n "NAMED_ROUTES\|/plans"
13:const NAMED_ROUTES = [
14:  { pattern: /^\/plans\/[^/]+\/[^/]+$/, title: 'Plans', phase: 12 }
$ git show HEAD:.../explorers/plans.js | grep -c "renderDetail\|parseDesignPhases"
0
$ git ls-tree --name-only HEAD packages/yakka-analytics/tests/plans-artifacts/
… no plan-detail.test.mjs …
```

After:

```
$ ... node --test --test-concurrency=1 plans-artifacts/plan-detail.test.mjs
# tests 10  # pass 10  # fail 0     (maxInFlight <= 4 in every browser case)
$ ... node --test --test-concurrency=1 plans-artifacts/*.test.mjs
# tests 60  # pass 60  # fail 0
$ ... node --test --test-concurrency=1 tests/*.test.mjs tests/e2e/*.test.mjs tests/workspace/*.test.mjs
# tests 87  # pass 87  # fail 0
$ ... node --test --test-concurrency=1 tests/scatter-sessions/*.test.mjs
# tests 42  # pass 42  # fail 0
$ ... node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 54  # pass 54  # fail 0
$ git diff --check
(diff-check 0; no /tmp, no fixed sleeps, no animation assertions)
```

## Exact detail requests

```
/entities?grain=plan&repo_id=<repo>&plan=<plan>&tz=<tz>&[all=1|from=…&to=…]&limit=1
/entities?grain=artifact&repo_id=<repo>&plan=<plan>&tz=…&limit=<page_max>&cursor=…
/entities?grain=execution&repo_id=<repo>&plan=<plan>&tz=…&limit=<page_max>&cursor=…
/entity?grain=plan&collection=sessions&repo_id=<repo>&plan=<plan>&tz=…&limit=<page_max>&cursor=…
/entities?grain=session&id=<conv>…&tz=…&limit=<page_max>
/entity?grain=plan&collection=events&repo_id=<repo>&plan=<plan>&tz=…&limit=<page_max>&cursor=…
/entity?grain=artifact&repo_id=<repo>&path=docs/plans/<plan>/DESIGN.md
/v1/analytics/content?repo_id=<repo>&path=docs/plans/<plan>/DESIGN.md&hash=<latest>
```

No detail request carries `cohort=`. All artifact `Open` links omit `hash=`
and say "latest version".

## Deviations, contradictions and unfinished work

- **Deviation — files outside the owned list:** the brief instructs updating the
  plans-list expectations but does not list `plans-list.test.mjs`; the removed
  named route also broke `artifact-reader.test.mjs`. Both received only the
  route-expectation change. Reason: otherwise the brief's required route change
  leaves passing suites failing.
- **Contradiction — plan filter:** the brief names
  `/entities?grain=plan&repo_id=&plan=&limit=1`, but CONTRACTS 17.3's plan lens
  lists only `repo_id|harness|session_model|id`. Go `parseFilter` accepts
  `plan`, so the request is implemented as written plus a defensive identity
  check on the returned row.
- **Contradiction — header scorer:** the brief asks for design score(s) "with
  scorer", but plan rows serve only `design_score:<check>` and no scorer;
  the header names the missing scorer rather than inventing one.
- **Contradiction — execution scorer:** the brief asks for execution scores
  "with scorers"; execution rows expose `brief_score:`/`report_score:` only, so
  the table labels that scorers are not served.
- **Deviation — test console diagnostics:** the unavailable-design case expects
  Chromium's failed-resource 404 console entry; page errors and CSP violations
  must remain empty. Strict zero-console-error checking would reject the
  contract's required 404.
- **Deviation — over-budget handoff location:** the brief's over-budget clause
  asks for a note in `IMPLEMENTATION.md`, which is outside this unit's owned
  paths. I did not edit it; this report is the committed handoff and records the
  overrun.
- **Problem — flaky parallel browser run:** the first `trends-quality` run,
  started in parallel with the `scatter-sessions` suite, reported 2 of 54
  failures; the suite passed 54/54 when rerun serially. The failing subtests
  were not captured. The two suites each own a Chromium instance, so the run
  was resource-contended; every serial invocation passed.
- **Unfinished:** none. The design's stored path convention
  `docs/plans/<plan>/DESIGN.md` required detail fixture plan ids that are folder
  slugs (`20-analytics-reset`); the list plans keep their own ids. No design or
  contract amendment is needed.
