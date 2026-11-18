# Plan 20 implementation

Tool: opencode execute skill
Run ID: feat/20-analytics-reset phase 12 (2026-11-18)
Start time: 2026-11-18 21:36 Australia/Brisbane

Phase 11 (below) closed at `4867fb3` with the `Yakka-Phase: 20-analytics-reset:11` trailer. This run builds Phase 12 only.

## Phase 12 — Workflow, Plans and the artifact reader

The phase outcome is approach-open (the diff algorithm, outline parsing and chunked rendering of long bodies). This run uses the signed outcome and CONTRACTS.md 17.3, 17.3.1, 17.4, 17.5, 17.6 and 17.7 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized. Phase 12 has no Units list in DESIGN.md and is more than one worker's work, so `refine` is dispatched as its own context; its verdict decides the units.

Refinement commit `f95a8b8` (`docs: refine Plan 20 Phase 12 into seven units`) records seven sequential units and writes their briefs. Verdict **Proceed**: 12-01 workflow panels and P12 scene; 12-02 plan-cost rank and Workflow preset; 12-03 artifact reader core; 12-04 artifact diff; 12-05 Plans list; 12-06 plan detail; 12-07 acceptance. No units run in parallel: the router, P12 fixture/stub scene and shared registration module are common. The refine settled the formerly open choices (256 KiB and 2,000 lines per diff side, line-based outline skipping fences, 400-line display chunks). Carried: the artifact `id` lens stays unconfirmed; Pages gate stays Phase 13; browser evidence requires NODE_PATH playwright-core and Chromium 1243; P10/P11 stub bodies stay byte-identical; the one real shortfall is `shape-bars` harness/repo grouping, which has no served execution aggregate and is rendered unsupported while plan grouping is delivered. `artifact_feedback` on all seven briefs was unreachable (`local context unavailable: queue (invalid_context)`); no screen verdict is claimed.

### `12-01-workflow-panels.md`

- Outcome: committed as `2674a62` (`Add workflow process-shape and plan-timeline panels`). Added `shape-bars.js` (stacked complete/unreported/started per plan from one `/entities?grain=plan` request, zero-based, legend, table, plan Open, null omission, last-observed age, observable unsupported harness/repo grouping), `plan-timeline.js` (artifact-kind and execution lanes from plan events and execution rows, per-collection Load more, non-version events tabled as not drawn, named missing-plan state), idempotent `p12-workflow.js` registration, `workflow.css`, an additive `p12` stub scene and fixture helpers, and `tests/plans-artifacts/{browser,workflow.test}.mjs`.
- Surfaces: the brief's owned paths; no server, Go, route, grain, join or gesture change.
- Deviations / unfinished: worker reported **done with concerns**. Chooser state lives in the panel spec `scope` (`p12_grouping`, `p12_plan`) because canonical specs carry only grain/measures/split/chart/scope; `shape-bars.requires` is `['entities_plan']` only; `ensureWorkflowStyles` lives in `shape-bars.js` and is re-exported to avoid an import cycle. Known: `plan-timeline` load-more repaint targets the first timeline panel, so two on one board would collide (the delivered preset has one). The design catalog's execution-grain/harness/repo shape grouping remains the recorded carried shortfall. `gate: none` for this unit.
- Verification: `workflow.test.mjs` 12/12 with Chromium and no skip; engine/start/acceptance 16/16; workspace 72/72; scatter-sessions 42/42; `git diff --check` clean; `maxInFlight <= 4`, clean diagnostics, no sleeps or `/tmp`. `artifact_feedback` unreachable (`invalid_context`).

### `12-02-rank-preset.md`

- Outcome: committed as `f70634a` (`Add plan-cost rank mode and the Workflow preset`). `rank.js` gains an explicit plan-grain mode over `/entities?grain=plan` (published plan measures only, default `associated_cost_usd`, canonical plan identity, null marks omitted, overlap/lower-bound/all-unpriced notes, plan table, inspect facts, `/plans/<repo>/<plan>` destination, plan chooser; time path untouched; period/cohort comparison refused as time-only). `p12-workflow.js` registers the five panels and overwrites `workflow` with the delivered board; `workflow.css` and a new `rank-preset.test.mjs` (4 pure + 1 Chromium) added; the Phase 9 acceptance now settles five panels and stops expecting `/b/workflow` as named ( `/plans` still named).
- Surfaces: the brief's owned paths; `tests/plans-artifacts/workflow.test.mjs` was edited because 12-01 had asserted the preset stayed named (the brief names it as an expectation that changes).
- Deviations / unfinished: worker reported **done with concerns**. CONTRACTS 17.3 serves only per-plan `shared_sessions`, not distinct sessions across plans; the banner therefore says "N shared-session reports across M plans touch more than one plan (a session may be shared by more than one plan)" and never totals plan cost. `WORKFLOW_PANEL_IDS` is added beside 12-01's `P12_WORKFLOW_PANEL_IDS`. Open still lands on the named plan detail until 12-05/12-06. `gate: none`.
- Verification: rank+workflow 17/17 with Chromium and no skip; engine/start/acceptance 16/16; workspace 72/72; scatter-sessions 42/42; `git diff --check` clean; `maxInFlight <= 4`, clean diagnostics, no `/tmp` or sleeps. `artifact_feedback` unreachable (`invalid_context`).

## Phase 11 — Scatter lab and Sessions

The phase outcome is approach-known. This run uses the signed outcome, the panel catalog and preset mapping, the Interaction model, CONTRACTS.md 17.1, 17.2, 17.3, 17.3.1, 17.5 and 17.7 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized. Phase 11 has no Units list in DESIGN.md and is more than one worker's work, so `refine` is dispatched as its own context; its verdict decides the units.

Refinement commit `acd114f` (`docs: refine Plan 20 Phase 11 into five units`) records five sequential units and writes their briefs. Verdict **Proceed**: 11-01 scatter foundation, session scatter and the P11 fixture/stub scene; 11-02 artifact and plan scatters; 11-03 time scatter, time cohorts and the Scatter preset; 11-04 Sessions list and detail; 11-05 phase acceptance. No units run in parallel: all extend the same registration module and/or fixture/stub scene, and 11-03 finalises the preset before 11-04. Phase 10 carried items were placed: the artifact reader and unconfirmed artifact `id` lens stay Phase 12 and are named, not built; the Pages gate stays Phase 13; the browser-evidence gate is absorbed into every unit's done evidence; the P10 stub bodies stay byte-identical with P11 bodies additive; the two-sided compare boundary is unchanged; the Tools route-interception spec runs sequentially; charts paint after idle; the 8G cap is applied via the node heap limit as in Phases 9/10. `artifact_feedback` on all five briefs was unreachable (`local context unavailable: queue (invalid_context)`); no screen verdict is claimed, and the same unreachable service is recorded for the unit briefs and reports below.

### `11-01-scatter-foundation.md`

- Outcome: committed as `8a450b7` (`Add the Phase 11 scatter foundation and session scatter`). Added `scatter-shared.js` (schema-only axes/colours, request builder, canonical row keys, whole-population marginals on `<yk-ranges>`, region/union/subtraction predicates, bounded exact-count request, caveat text, chooser), `scatter-session.js`, `p11-scatter.js` (registers only `scatter-session`; no preset), `css/scatter.css`, additive predicate-backed tray and `app.js` selection seams, and the opt-in P11 fixture/stub scene with `tests/scatter-sessions` pure specs.
- Surfaces: the brief's owned paths; `selection-model.js` was read but not edited because existing canonical helpers sufficed.
- Deviations / unfinished: worker reported **done**. Axis roles ride in the spec `scope` bag because `canonicalPanelSpec` sorts `measures`; `scatterRows` maps every row but excludes null axes from marks while keeping whole-population counts; the chart `select` payload carries both a predicate node and a region and the panel re-emits the predicate without a chart-kit edit; the fixture also publishes execution/content grains additively for later units. Browser proof of the panel is deferred to 11-03 as the brief requires. `gate: none` for this unit (the Chromium loader resolved).
- Verification: `node --test tests/scatter-sessions/scatter.test.mjs` → 10/10; `node --test tests/workspace/*.test.mjs` → 72/72; `node --test --test-concurrency=1 tests/trends-quality/*.test.mjs` → 54/54 (the parallel Tools route-interception race is the known Phase 10 carry); `git diff --check` clean. Fixture: 40 session rows (2 null `commits` → 38 marks), population 1,880, eligible 1,700, returned 38. `artifact_feedback` unreachable (`invalid_context`), recorded above.

### `11-02-artifact-plan-scatter.md`

- Outcome: committed as `aed0b3c` (`Add the Phase 11 artifact and plan scatters`). Added `scatter-artifact.js` (catalogue-validated `score:<check>` axes, published artifact colours with `model`/`id` excluded from numeric axes, `{repo_id,path,hash}` identity and `/artifact` destination, null/lower-bound/unpriced labels) and `scatter-plan.js` (published plan measures, overlap banner with `shared_sessions`/`unpriced_calls`, null `complete_share`/`design_score` not drawn, `/plans/<repo>/<plan>` destination); registered both in `p11-scatter.js` without a preset; extended `css/scatter.css` and the additive P11 fixture/stub; added `artifact-plan.test.mjs`.
- Surfaces: the brief's owned paths; `scatter-shared.js`, `scatter-session.js`, the tray seam, the chart kit, presets, `app.js` and Go were untouched.
- Deviations / unfinished: worker reported **done**. `planAxes` takes an optional catalogue and the plan panel passes `null` because the panel requires only `entities_plan`; `session_model` is the colour lens while `model` is never numeric or a colour; `artifactMissing` prefers row flags and falls back to `population.missing_by_reason`. Browser proof of the delivered board stays 11-03. `gate: none`.
- Verification: `node --test tests/scatter-sessions/artifact-plan.test.mjs` → 9/9; `scatter.test.mjs` 10/10; `tests/workspace/*.test.mjs` 72/72; `tests/trends-quality/*.test.mjs` sequentially 54/54; `git diff --check` clean. `artifact_feedback` unreachable (`invalid_context`).

### `11-03-time-scatter.md`

- Outcome: committed as `a58481d` (`Add time scatter and the Scatter preset`). Added `scatter-day.js` plotting two published time measures on the response bucket grid with half-open bucket/window checks, frozen `source:{fields,bucket,bucket_step}` and absolute window, contributing-session counts from `population.relation.target_sessions`, source/target rejection associations in their own units, valid empty all-rejection selection and named unsupported pairings; registered the four-panel `scatter` preset; extended `selection-model.js`/`selection-tray.js`, `css/scatter.css`, the additive P11 fixture/stub, and the Phase 9 Start/acceptance expectations.
- Surfaces: the brief's owned paths plus one final assertion in `tests/scatter-sessions/artifact-plan.test.mjs` (it asserted the preset stayed undelivered); `app.js`, the chart kit and Go were untouched.
- Deviations / unfinished: worker reported **over budget** with the unit complete and green; the overrun was tool turns and files read while adding the Chromium proof, with no added scope. `auto` is not reported as coarsened when the server chose the effective unit. No brief/contract contradiction. `gate: none` (Chromium 1243 resolved, no skip).
- Verification: `NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/scatter.test.mjs` → 16/16 with the delivered `/b/scatter` board and no skip; `tests/workspace/*.test.mjs` + scatter + root 111/111; charts 68/68; trends-quality sequentially 54/54; engine 9/9, start 2/2, acceptance 5/5; `git diff --check` clean. `artifact_feedback` unreachable (`invalid_context`).

### `11-04-sessions.md`

- Outcome: committed as `24c288b` (`Sessions list and bounded session detail`). `/sessions` is a server-sorted, cursor-paged `/entities?grain=session` explorer with schema-driven measures/lenses, frozen window, `sort=<measure>:asc|desc`, `page_max`, shared chips/tray/inspector, Load-more and typed population; `/sessions/<id>` renders `/conversation` lanes and a returned-event table with cap and returned/total unpriced lines, `/ledger?conversation_id=` and Phase 12 artifact/plan destinations, and sends no `cohort=`. Added `explorers/sessions.js`, `panels/session-lanes.js`, `css/sessions.css`, additive P11 list/conversation stubs and `sessions.test.mjs`; updated `router.js` and the engine expectation.
- Surfaces: the brief's owned paths; `panels/index.js` was not edited and `session-lanes` is registered lazily by the explorer.
- Deviations / unfinished: worker reported **done**. `sort` is read from search because the existing codec treats it as unknown and pushed directly; the stub caps pages at 20 server-side to prove Load-more while the client uses schema `page_max`. Brief vs CONTRACTS 7.2: the design asks lanes by `tool_kind` with `repo_id`/`plan` identities, but the `/conversation` event shape publishes only `tool`/`path`/`sha`; the mapper uses server `tool_kind`/`repo_id`/`plan` when present and otherwise falls back to `tool`, the single conversation repo and a plan path, never inventing a kind. Reported, not silently resolved; carried below. `gate: none` (Chromium 1243 resolved).
- Verification: `NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/sessions.test.mjs` → 12/12; scatter/sessions sequentially 37/37; engine+start+acceptance 16/16; workspace 72/72; `git diff --check` clean. Browser: both sort directions in asserted order, Load-more 40 unique rows, lens chip pushes `harness=orca`, empty/error/unsupported named, detail 5,000 markers + 10 hollow + 5,000 table rows, cap and unpriced lines, ledger/artifact/plan links, no `cohort=`, `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`).

### `11-05-acceptance.md`

- Outcome: committed as `4bcce29` (`Add Plan 20 Phase 11 acceptance proof`). Added `tests/scatter-sessions/acceptance.test.mjs` (three Chromium proofs plus two pure contract checks) covering the four-panel Scatter preset, schema-only axes/colours, sampled labels and whole-population marginals, canonical rectangles and union/Alt-subtraction on session/artifact/plan/time, tray counts and cohort slots with a frozen absolute scope, one `cohort=` per peer, frozen time source and contributing/missing/orphan associations, valid empty all-rejection bucket, unpriced/lower-bound labels, unknown-check refusal, server-sorted Sessions with cursor paging and a lens chip, and the 5,000-event detail cap with hollow unpriced markers and Phase 12 destinations. No product code, unit spec or Go changed.
- Surfaces: the brief's owned paths; no fixture/stub edit was needed.
- Deviations / unfinished: worker reported **done with concerns**. The sample rule (`sha256(conversation_id) mod 100 < 3`) is on the chart spec but not printed in visible text; the visible label is `sample of 38 of 1,880; marginals are the whole population`. Load-more keeps the typed line at the cursor page `returned_n` (`20 of 40 sessions shown`) beside 40 rendered rows, which is 17.3 page semantics but can read ambiguously. A first draft asserted `40 of 40`; the acceptance was corrected to the contract, not the product. `gate: none` (Chromium 1243 resolved, no skip).
- Verification: `NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/acceptance.test.mjs` → 5/5; `tests/scatter-sessions/*.test.mjs` sequentially 42/42; workspace 72/72; trends-quality + charts 122/122; `git diff --check` clean. Fixture: session 1,880/1,700/38 sampled, 143 exact; artifact 6 rows/5 eligible; plan 2/1 eligible, 2 shared, 7 unpriced; time source `9 = 5 + 2 + 2`, target `11 = 8 + 1 + 2`, empty `4 = 0 + 2 + 2`; sessions 40 rows/20 per page; detail 5,000/5,123 events and 10/13 unpriced. Every page `maxInFlight <= 4`, clean diagnostics, no fixed sleeps. `artifact_feedback` unreachable (`invalid_context`).

### Phase 11 integrated verification — closed

- Independent cheap-tier check (fresh read-only verifier at HEAD `ddd0c15`; the worker reports were not trusted): entry point → action → observable result on the signed outcome. Required runs: `NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test tests/scatter-sessions/acceptance.test.mjs` → 5/5; `tests/scatter-sessions/*.test.mjs` sequentially → 42/42; `tests/workspace/*.test.mjs` → 72/72; `git diff --check` clean; Chromium 1243 and `playwright-core` resolved, no skip. Independent Chromium/request-shape spot-checks → 21/21: four `/b/scatter` panels `ready` in preset order; every numeric axis/size a published grain measure and every colour a published lens, `model` never numeric; `spec.sample={n:38,total:1880,rule}` with drawn marks = 38 and every marginal table summing to the whole population (1,880/1,700); each rectangle a canonical `and(range,range)` aggregate count, union `or`, Alt-subtraction `and(…,not(…))`, tray `143 sessions of 1,880; 38 sampled marks`, cohort slots with a frozen absolute scope and exactly one `cohort=` per peer; time cohort `source={fields,bucket,bucket_step}`, 7 contributing sessions, source `9=5+2+2`, target `11=8+1+2`, empty all-rejection `4=0+2+2`, half-open edges at inclusive `from`/`to`, unsupported pair `unsupported_join`; `/sessions` `sort=<measure>:asc|desc&limit=500`, server order, 40 unique ids over a cursor page, lens chip `harness=orca`; `/sessions/<id>` 5,000 markers/rows of 5,123 with 10 hollow unpriced of 13, cap and whole-run lines, `/ledger?conversation_id=`, Phase 12 artifact/plan destinations, no `/conversation` `cohort=`; `maxInFlight <= 4`, clean diagnostics. All twelve outcome clauses **PASS**; phase-outcome-met **yes**.
- Before closure, `artifact_feedback` on all five briefs and all five reports returned `local context unavailable: queue (invalid_context)`; no screen verdict is claimed and none is recorded.

Carried:

- `gate: the artifact reader is delivered in P12; Phase 11 names `/artifact` and identifies an artifact by repo_id/path/hash only.`
- `gate: the exact artifact id lens grammar is unconfirmed (Phase 9/10 carry); no Phase 11 unit promotes an artifact id lens to an axis or cohort.`
- `gate: the external Pages automation must accept ./web as its output directory; verified only in Phase 13.`
- `gate: browser evidence depends on playwright-core 1.63.0 under NODE_PATH and the Chromium 1243 cache, both outside this worktree; both were present, so no spec skipped.`
- The sampled session scatter labels the sample and whole-population marginals visibly but prints the hash sample rule only on `yk-chart.spec.sample.rule`; a later panel pass should print it as text for the brief's full wording.
- After Load-more the Sessions typed line keeps the cursor page `returned_n` (`20 of 40 sessions shown`) beside 40 rendered rows; 17.3 page semantics are honoured, but the wording should distinguish page size from loaded rows on a later pass.
- CONTRACTS 7.2 `/conversation` events publish `tool`/`path`/`sha`, not `tool_kind`/`repo_id`/`plan`; the session detail therefore uses those fields when present and otherwise falls back to `tool`, the single conversation repo and a plan path, never inventing a kind. A server addition or a 7.2 text clarification would complete the design's exact lane wording.
- `session-lanes` is registered lazily on first detail render rather than in `panels/index.js`; it is validated and named by no preset.
- A time cohort's source-side rejection associations appear only when `rejections` is one of the plotted `source.fields`; the target-side line is always shown. This matches 17.3.1 and is proved with a custom spec rather than the default preset.
- The shared transport appends `tz` to `/conversation`; CONTRACTS 7.2 lists only `id`/`from`/`to`. No `cohort=` is sent; the extra parameter is harmless and pre-existing.
- Process: 11-03 ran over its turn budget and edited `tests/scatter-sessions/artifact-plan.test.mjs` outside its owned paths (one final assertion); 11-05 corrected a draft expectation to the contract rather than changing product behaviour. No product code was changed to satisfy a test.

## Phase 10 — Trends, Compare, Quality, Cost and Tools

The phase outcome is approach-known. This run uses the signed outcome, the panel catalog and preset mapping, the Interaction model, and CONTRACTS.md 17.2, 17.3, 17.3.1, 17.5, 17.6 and 17.7 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized. Phase 10 has no Units list in DESIGN.md and is more than one worker's work, so `refine` is dispatched as its own context; its verdict decides the units.

Refinement commit `b3c513b` (`docs: refine Plan 20 Phase 10 into six units`) records six units and writes their briefs. Verdict **Proceed**: 10-01 trend/compare primitives and the Trends and Compare presets; 10-02 Quality; 10-03 Cost and shared categorical panels; 10-04 Tools; 10-05 cohort and comparison wiring; 10-06 phase acceptance. 10-01 runs first; 10-02 and 10-03 then run in parallel on disjoint quality and cost paths; 10-04 follows 10-03; 10-05 follows every panel; 10-06 closes the phase. Phase 9/8 carried items were placed: cohort forwarding into 10-05; the box-legend seam and diverging ramp into 10-01; the browser-evidence gate into every browser spec's done evidence; the artifact-id grammar, Pages automation and chart-base conventions recorded as gates/constraints. `artifact_feedback` on all six briefs was unreachable (`local context unavailable: queue (invalid_context)`); no screen verdict is claimed, and the same unreachable service is recorded for the unit briefs and reports below.

### `10-01-trends-compare.md`

- Outcome: committed as `75a1ac6` (`Deliver Trends and Compare presets with trend and distribution primitives`). Added `panels/{p10-shared,trend-columns,trend-lines,trend-multiples,rhythm,dist-ranges,dist-hist,dist-ecdf,rank,p10-trends,p10-compare}.js`, the empty `p10-{quality,cost,tools}.js` registration seams, `css/trends.css`, the opt-in `yk-ranges` entity legend and `yk-bars` diverging slope-ramp seams, the `p10` fixture/stub scene and request log, and `tests/trends-quality/{browser,fixture,trends,compare}`.
- Surfaces: the brief's owned paths plus `charts/svg-base.js` (legend-series seam) and `tests/workspace/start.test.mjs` (Trends is now delivered); nothing else.
- Deviations / unfinished: chart element definitions moved to `app.js` so panel modules stay importable under `node --test`; `trend-columns` offers four chart names that resolve to one element; `/distribution` split is `model` only per contract; Compare's fifth panel is `trend-lines` until 10-05 adds the cohort comparison; `start.test.mjs` assertions updated because the route stopped being a named destination. `cohortParams` is an empty seam for 10-05; Quality, Cost and Tools are empty registration seams. `gate: none` (playwright-core and Chromium 1243 present).
- Verification: `node --test tests/trends-quality/trends.test.mjs tests/trends-quality/compare.test.mjs` → 17/17 pass; `node --test tests/workspace/*.test.mjs` → 72/72 pass; `git diff --check` clean. Browser: `/b/trends` and `/b/compare` settle five `ready` frames, choosers follow `/schema`, zoom writes ISO bounds, all-history compare shows the finite-period copy and sends no previous request, `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`), recorded above.

### `10-02-quality.md`

- Outcome: committed as `9a2e4c7` (`Deliver the Quality preset with hash- and file-weighted score panels`). Added `panels/{score-ranges,score-trend,score-strips,band-mix}.js`, replaced the empty `p10-quality.js` seam, added `css/quality.css` and `tests/trends-quality/quality.test.mjs`. Ranges and trend are hash-weighted (`/scores`, `/score-series`, `/baselines?population=content`); strips and band-mix are file-weighted (`/entities?grain=artifact`); bands are separate low/mid/high/unscored/baseline_unavailable series; a strip mark links to `/artifact?repo_id&path&hash` and names the Phase 12 reader.
- Surfaces: the brief's owned paths; nothing else.
- Deviations / unfinished: worker reported **done with concerns**. Kind/check/scorer are kept in `spec.scope` because the shared canvas has no first-class fields for them. The workspace stub's P10 `/scores`, `/score-series`, `/baselines` and `/entities` bodies are empty placeholders and the stub serves baselines at `/v1/analytics/baselines` while the product contract route is `/v1/baselines`, so the Chromium spec route-mocks those bodies; a fixture fixer is owed. `gate: none` (playwright-core and Chromium 1243 present).
- Verification: `PUBLIC_CANVAS_TEST_MODE=true node --test tests/trends-quality/quality.test.mjs` → 7/7 pass; `trends`+`compare` 17/17; `git diff --check` clean. Browser: `/b/quality` settles four `ready` frames, baseline band drawn, `3 of 3 files` with one missing-unscored, all five bands named, check change regroups with a surviving colour, `jev-0` is `baseline_unavailable`, strip inspect opens the artifact destination, unknown check is a named unsupported state, `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`), recorded above.

### `10-03-cost.md`

- Outcome: committed as `5341f57` (`Deliver the Cost preset with the shared treemap and comfort composition`). Added `panels/treemap.js`, `panels/mix.js`, filled `p10-cost.js` with the `cost` preset, added `css/cost.css` and `tests/trends-quality/cost.test.mjs`. The preset is `trend-columns`, `rank`, `treemap`, `dist-ranges`, `dist-hist`, `dist-ecdf` at `cost_usd`, split `model`, treemap `harness`→`model`, distribution `grain=call`, `dim=model`; unpriced/lower-bound/real-zero are distinguished and `(mixed)`/`(none)`/`(multi)`/`unknown` stay separate; a repo cost total and a cost-by-tool are named unsupported with their alternatives.
- Surfaces: the brief's owned paths; nothing else.
- Deviations / unfinished: worker reported **done with concerns**. The Cost repo investigation is named unsupported rather than mounted: `dist-*` pins `DIST_DIMS=['model']` (10-01's path, untouched here) although CONTRACTS.md 17.3 gives `/distribution` `dim=harness|session_model|session_repo`, and the Cost catalog asks for a session-repo treemap; the treemap therefore refuses a repo `/query` total (the real `/schema.grains.time.lenses` publishes only `id`) and names the `/distribution?dim=session_repo` alternative without mounting it. The workspace stub also publishes `session_repo` for `cost_usd` on time grain and ignores a second `/query` dim, which contradicts the real schema and limits the browser two-level treemap proof; the unit test proves two-level mapping synthetically. Trend/rank totals do not print lower-bound/unpriced (10-01 panels). These are carried to the Phase 10 fixer. `gate: none` for the browser itself (playwright-core and Chromium 1243 present); `gate:` the workspace stub needs two-dim `/query` rows and a contract-shaped `/distribution`/`/baselines` for full browser proof.
- Verification: `node --test tests/trends-quality/cost.test.mjs` → 8/8 pass; `trends`+`compare`+`cost` 25/25; `git diff --check` clean. Browser: `/b/cost` settles six `ready` frames, treemap/rank tables equal the fixture, distinct special groups, `$4.25+ (3 unpriced)` lower bound, distribution tables equal the fixture in `call` units, surviving entity styles on a measure change, split change regroups, repo-cost and cost-by-tool render `unsupported` with alternatives, `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`), recorded above.

### `10-04-tools.md`

- Outcome: committed as `87d36f2` (`Deliver the Tools preset over hook-event tool lenses`). Filled `panels/p10-tools.js` with the `tools` preset (`mix` `hook_events` by `tool_kind`×`harness`, `treemap` `harness`→`tool`, `rank` by `tool`, `rhythm` `weekday`×`hour_of_day`), the join guards, the schema-aware treemap child helper and the registration assertion; added `css/tools.css` and `tests/trends-quality/tools.test.mjs`.
- Surfaces: the brief's owned paths plus one assertion in `tests/trends-quality/cost.test.mjs`; nothing else.
- Deviations / unfinished: worker reported **done with concerns**. `mix` had to be registered here (10-03 exported but did not register it), so the Cost spec's global-registry assertion was corrected to its stated intent (mix is not a Cost panel). The exact cost refusal lives in the module, while the shared panels use their own wording. The shared `mix`/`treemap`/`rank` still offer a `repo_id` split on `hook_events` although `/schema` publishes it and the facts carry none; the preset helper refuses it, and the amended 10-05 adds the shared guard. The treemap child fallback is a helper rather than load-time behaviour; the amended 10-05 makes it schema-aware. Preset notes are data, not rendered (no inspector seam here). `gate: none` (playwright-core and Chromium 1243 present).
- Verification: `node --test tests/trends-quality/tools.test.mjs` → 5/5 pass; `trends`+`compare`+`quality`+`cost` 32/32; `git diff --check` clean. Browser: `/b/tools` settles four `ready` frames, tables equal the fixture, split change regroups with a surviving series, `unknown`/`(mixed)` stay distinct, rhythm has 168 rows, cost-by-tool is `unsupported` with its alternative, `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`), recorded above.

The 10-05 brief was amended before dispatch with the Phase 9/10 contradictions the workers reported: shared distribution lens breadth and the mounted Cost repo investigation, fixture/stub truthfulness (`/v1/baselines`, non-empty P10 bodies, two-dim `/query`, distribution session dims, time-grain lenses `["id"]`), and the shared named-join guards. The amended brief is what 10-05 reads.

### `10-05-cohort-compare.md`

- Outcome: committed as `dc8d4c6` (`Wire P10 cohorts and comparisons through the shared request seam`). Added `cohortSlots`/`cohortParams`, `comparisonPlan`, per-side `requestParams`, `comparisonSummary`, `honestJoinGuard` and `scopeWithCohorts` to `p10-shared.js`; resolved multi-colon lenses in `selection-tray.js`; broadened `dist-*` to `model|harness|session_model|session_repo` with a grain/dim guard; mounted the Cost repo investigation at `conversation/session_repo` and a harness variant; made `dist-ranges` two-sided for `cmp=cohorts` and frozen-cohort `cmp=period`; corrected the P10 fixture/stub (`/v1/baselines`, non-empty scores/entities, two-dim `/query`, distribution session dims, time lenses `["id"]`, typed relation); added `tests/trends-quality/cohort-compare.test.mjs` and corrected three contradictory 10-01/10-02/10-03 expectations.
- Surfaces: the amended brief's owned paths plus the three corrected spec expectations; `view-spec.js` was read but not edited.
- Deviations / unfinished: worker reported **done with concerns**. `core/view-spec.js` `cleanPanelScope` drops `scope.cohorts`, so `p10-shared` recovers `ca`–`cd` from `location.search` as a fallback. `cmp=cohorts` is two-sided only in `dist-ranges`; `dist-hist`, `dist-ecdf`, `trend-*`, `rank` and `mix` still send one first-cohort request. Compare + split does not render small multiples. Both are carried to the 10-05b fixer before acceptance.
- Verification: `node --test tests/trends-quality/cohort-compare.test.mjs` → 9/9 pass; whole P10 suite sequentially 46/46; `git diff --check` clean. Browser: a cohort chip makes the P10 requests carry one canonical `cohort=` and `/baselines` none; populations render with `relation.resolved_n`; `band:<check>` stays structured; different-grain cohorts refuse with no request; `win=all&cmp=period` shows the copy and makes no previous request; `/b/cost` mounts repo/harness distribution views; `/b/tools` repo splits are `unsupported` with `try: harness`; `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`), recorded above.

Fixer for the two 10-05 gaps: committed as `c8efc76` (`Preserve cohort scope and compare cohorts across P10 panels`). `view-spec.js` now preserves `scope.cohorts` and lets a board `cmp` beat a preset default; the `location.search` fallback is removed; `dist-ranges`/`dist-hist`/`dist-ecdf`/`trend-lines`/`rank` are two-sided under `cmp=cohorts` and render one `[data-split]` small-multiple group per split value; `trend-columns` waits for chart settle before `data-idle`; `tests/trends-quality/cohort-compare.test.mjs` adds the cohort-scope retention and second-panel two-sided/small-multiple proofs. Report `reports/10-05b-fixer.md`. Two-sided compare remains limited to the five compare-preset panels; `trend-columns`, `trend-multiples` and `mix` keep single-cohort behaviour, which the phase outcome does not require outside the compare preset. Verification: `cohort-compare` 11/11; whole P10 suite sequentially 48/48; `git diff --check` clean; workspace suite per file green except the stale Phase 9 acceptance expectation below.

Runner fix (not a worker unit): `tests/workspace/acceptance.test.mjs` still expected `/b/cost`, `/b/quality` and `/b/tools` to be named later destinations after Phase 10 delivered them. Updated the Phase 9 acceptance to settle the delivered P10 panels (toggling the P10 stub scene) and to count only `/b/scatter`, `/b/workflow` and `/plans` as named later destinations (5, down from 11). No product code changed and no other assertion was weakened. Verified: `engine`+`start` 11/11; `acceptance.test.mjs` 5/5 under `NODE_OPTIONS=--max-old-space-size=8192`. The bare `systemd-run -p MemoryMax=8G` scope OOM-kills the ledger paging case (node peak is 222 MB; the Chromium DOM is charged to the scope), so the cap is applied as the Phase 9 record applied it, via the node heap limit.

### `10-06-acceptance.md`

- Outcome: committed as `6c3ebd3` (`Prove the Phase 10 analytics presets end to end`). Added `tests/trends-quality/acceptance.test.mjs` (six Chromium proofs over the committed P10 stub/fixture) and `tests/trends-quality/acceptance-fixture.mjs` (additive scene rows only).
- Surfaces: the brief's owned paths; nothing else.
- Deviations / unfinished: worker reported **done**. The quality probe supplies extra score/series/baseline/entity bodies through Playwright routes because the committed P10 stub carries one scores/artifact body; unit fixture defaults are unchanged. Back is asserted to keep the preset and the prior board state, Forward to restore the exact zoom dates, reload to preserve dates. One table per preset is asserted directly; the remaining tables are covered by the unit specs. The whole-P10 run uses `--test-concurrency=1` because of the pre-existing Tools route-interception race. `gate: none` for this unit; the external browser dependency is recorded in Carried.
- Verification: `NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test tests/trends-quality/acceptance.test.mjs` → 6/6 pass; P10 suite sequentially 54/54; workspace suite 72/72; chart kits 68/68; `git diff --check` clean. Browser: five presets settle exactly their catalog panel lists and every frame `ready`; measure/lens/chart changes regroup with surviving styles; `win=all`/`win=10y` coarsen to year and zoom writes absolute dates surviving reload/Back/Forward; finite period shows both sides and `win=all&cmp=period` refuses with the copy and no previous request; A/B cohorts show both labelled populations with both canonical cohorts on the wire; a mismatched cohort grain is refused with no B request; compare + split renders more than one `[data-split]` group; quality names content hashes vs files, draws the scorer baseline band, shows `baseline_unavailable`/`unscored`, and opens `/artifact?...&hash=…` naming Phase 12; cost keeps partial lower bound, all-unpriced and real zero distinct, special groups separate, and names repo-cost and cost-by-tool unsupported with their `try`; legend focus emits a published lens chip, an unmapped key is named, a cohort chip requeries every panel, and tables equal the fixture; `maxInFlight <= 4`, clean diagnostics. `artifact_feedback` unreachable (`invalid_context`), recorded above.

### Phase 10 integrated verification — closed

- Independent cheap-tier check (fresh read-only verifier at HEAD `6c3ebd3`; the worker reports were not trusted): entry point per preset → action → observable result. It ran `tests/trends-quality/acceptance.test.mjs` → 6/6, the P10 suite → 54/54, the workspace suite → 72/72, `git diff --check` clean, `git status` clean, and an independent Chromium spot-check → 9/9:
  - `/b/trends`, `/b/compare`, `/b/quality`, `/b/cost`, `/b/tools` each rendered exactly the matrix panel list, all `ready`; a measure/split/chart change regrouped with a surviving swatch and `p<n>` spec.
  - `cmp=period` on a finite window requested both absolute sides; `win=all&cmp=period` showed `Choose a finite period to compare periods.` and made no previous-window request; `cmp=cohorts` on `/b/cost` named Cohort A/B and put both canonical cohorts on the wire.
  - Cost requested real `/distribution?dim=session_repo&grain=conversation` and `dim=harness&grain=call` views and zero `/query` repo totals; the all-unpriced group never rendered `$0.00`.
  - Quality named content hashes vs files, drew the all-time scorer p25–p75 band, showed `baseline_unavailable`, and a strip inspect opened `/artifact?repo_id=repo-b&path=docs/b.md&hash=h2` while naming Phase 12.
  - Tools cost-by-tool was `unsupported` with `Nearest supported choice: hook_events by tool`.
  - Phase 10 outcome holds on evidence. `artifact_feedback` on all six briefs and the seven reports (including the 10-05b fixer) returned `local context unavailable: queue (invalid_context)`; no screen verdict is claimed.

Carried:

- `gate: the artifact reader is delivered in P12; P10 names it only and identifies an artifact by repo_id/path/hash.`
- `gate: the exact artifact id lens grammar is unconfirmed (Phase 9 carry); no P10 unit consumes an id lens.`
- `gate: the external Pages automation must accept ./web as its output directory; verified only in Phase 13.`
- `gate: browser evidence depends on playwright-core 1.63.0 under NODE_PATH and the Chromium 1243 cache, both outside this worktree; both were present, so no spec skipped.`
- The committed P10 stub carries one scores/artifact body; the quality acceptance extras are route-mocked. A later fixture pass could make them committed bodies.
- Two-sided `cmp=cohorts` covers the five compare-preset panels; `trend-columns`, `trend-multiples` and `mix` keep single-cohort behaviour outside the compare preset.
- The Tools route-interception spec is timing-sensitive under parallel test files; the evidence run uses `--test-concurrency=1`. Not a product defect.
- Charts paint on the frame after a panel goes idle; specs read through the public `inspect()` surface rather than sleeping.
- The `systemd-run -p MemoryMax=8G` scope OOM-kills the heavy ledger paging case on this host (node peak 222 MB, Chromium DOM charged to the scope); the cap is applied as in the Phase 9 record via `NODE_OPTIONS=--max-old-space-size=8192`.

## Phase 9 — Workspace engine, Start and Pulse

The phase outcome is approach-open (the panel engine, view spec codec and linking model are new). This run uses the signed outcome and CONTRACTS.md 17.3, 17.3.1, 17.5 and 17.7 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized. Phase 9 has no Units list in DESIGN.md and is more than one worker's work, so `refine` is dispatched as its own context; its verdict decides the units.

Refinement commit `cb51616` (`docs: refine Plan 20 Phase 9 into six units`) records six units and writes their briefs. Verdict **Proceed**: 9-01 workspace engine, view spec, route table, states, Follow, Start, stub API and harness; 9-02 chips, selection tray, inspector and capability inspector; 9-03 Pulse preset, river, feed, brush and movers; 9-04 ledger explorer; 9-05 ops explorer; 9-06 workspace acceptance and phase proof. 9-01 runs first. 9-02 and 9-05 then run in parallel; 9-03 and 9-04 follow 9-02 and run alongside each other and 9-05; 9-06 closes the phase outcome. `artifact_feedback` on all six briefs returned delivered / screen pass (`jev-1.13.0`), no flags. Phase 8 carried items were placed: the browser-evidence gate is absorbed into every Phase 9 browser spec's done evidence; the bars legend-focus mapping is absorbed into 9-02/9-03; the box-legend seam, `[data-shape]` selectors and diverging ramp belong to Phase 10 or a later element-adding phase; the chart-base conventions and shared heatmap/calendar keys are constraints on 9-03/9-04. Browser evidence depends on `playwright-core` outside the worktree and a first-party test-only stub API; both are recorded as gates below.

### `9-01-workspace-engine.md`

- Outcome: committed as `eaaf5b5` (`Add workspace engine, view spec, routes and Start paths`). Added `core/{router,view-spec,panel-state,follow,saved-boards}.js`, `panels/{registry,panel-frame,index}.js`, `boards/{presets,board}.js`, the `url-state.js` `p<n>`/`panelSpecs` extension, the router dispatch and Start question paths in `app.js`, a `workspace.css`, named-destination `explorers/ledger.js` and `ops.js`, and `tests/workspace/{harness,stub-api,fixture,browser,engine.test,start.test}.mjs`.
- Surfaces: the brief's owned paths plus one `index.html` stylesheet link; nothing else.
- Deviations / unfinished: worker reported **over budget** (about 2,035 added / 61 deleted lines across 23 files against ~1,500) with the deliverable complete and checks passing. The browser-level hidden-document Follow case is deferred to 9-03 because Follow's contracted home is the river panel; pure Follow semantics are proved now. Scope bar and coverage strip render on named later destinations so deep-link/Back is observable before a board exists. `/schema` publishes the activity feature as `analytics_activity` while CONTRACTS.md 17.2 names `activity`; accepted as an alias and recorded as a contradiction, not silently resolved. `gate: none` (playwright-core and Chromium 1243 present).
- Verification: `tests/workspace/engine.test.mjs` + `start.test.mjs` → 11/11 pass on a re-run (Chromium, real mouse/keyboard, `win=all`, ten-year `from`/`to`, Back, saved board, Follow ack, ≤4 in flight, no page error/CSP violation); existing `url-state`, `static-shell`, `request-scheduler` specs 9/9; non-browser suite 12/12. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `9-02-tray-inspector.md`

- Outcome: committed as `a2302af` (`Add workspace chips, selection tray, inspector and capability drawer`). Added pure `core/{selection-model,chips,selection-tray,inspector,capability-inspector}.js`, mounted them through the 9-01 frame seams in `app.js`, and added `tests/workspace/{tray,inspector,capability}.test.mjs`.
- Surfaces: the brief's owned paths plus `app.js` mount wiring and `workspace.css`.
- Deviations / unfinished: worker reported **done**. `Filter all`/`Exclude this` write the definition to the first free `ca`–`cd` slot and set `cmp=cohorts` because the published URL codec has no separate active-cohort key (named as a contradiction, not invented). Relative `win` is converted to fixed absolute bounds with fixed durations when promoting a cohort because the client has no server-resolved window yet. Chart brush/zoom wiring to `sel`/`from`/`to` is left to 9-03+ (no Phase 9 panel emitted brush yet). The capability drawer is appended to the frame because 9-01 exposes no drawer slot. `gate: none`.
- Verification: `tray`+`inspector`+`capability` → 13/13 pass on a re-run (Chromium; cohort chip, legend-focus lens mapping with no null filter, inspector actions/focus return, bottom sheet at 800 px, drawer provenance, ≤4 in flight, clean diagnostics); `url-state`+`engine` 12/12. `artifact_feedback` on the brief and report returned delivered / screen pass, no flags.

### `9-05-ops.md`

- Outcome: committed as `906bed9` (`Add ops explorer over admin status`). Added `panels/ops-footprint.js`, replaced the named-destination `ops.js`, added `css/ops.css` and `tests/workspace/ops.test.mjs`; `/ops` renders authorised `/v1/admin/status` per tenant with units, the server-capped failures, rescore state and member 403 as "administrator only", read-only.
- Surfaces: the brief's owned paths.
- Deviations / unfinished: worker reported **over budget** (885 changed lines against ~500) with the deliverable complete. It registered the table-only panel as `charts: ['bars']` to pass registry validation, which is a workaround for a real registry gap; the committed stub's `adminStatus()` is minimal, so full-shape proof uses a test-side intercepted response. Both are fixed by the small fixer below. Known problem reported, not fixed here: `app.js:renderExplorer` has no await/destroy seam, so a navigated-away `/ops` request finishes with no DOM leak.
- Verification: `ops.test.mjs` → 13/13 pass on a re-run (Chromium; admin ready, full status per tenant, member 403 unsupported, 500 + Retry recovery, real aborted load `cancelled`, ≤4 in flight, clean diagnostics); `engine.test.mjs` 9/9. `artifact_feedback` on the brief and report returned delivered / screen pass, no flags.

Fixer for the two 9-05 gates: committed as `bd80927` (`Fix ops table-only panels, status stub and route abort`). `panels/registry.js` now accepts a table-only panel as `charts: []` plus `table: true` (an unmarked empty list still fails); `ops-footprint` uses it; `tests/workspace/fixture.mjs` and `stub-api.mjs` now carry the full CONTRACTS.md 6 `/v1/admin/status` shape plus `statusError`/`statusDelayMs` scenes, and `ops.test.mjs` uses the committed stub for full-shape and error instead of interception. The reported teardown gap is closed: `app.js` keeps one route-scoped `AbortController` per explorer and a module may return a destroy function, so navigating away aborts the in-flight request. Verified 25/25 across `ops`, `start` and `engine` on a re-run; no check weakened.

### `9-03-pulse.md`

- Outcome: committed as `4df1acf` (`Add the Pulse preset, river feed, strips, movers, calendar and coverage`). Added `panels/{river,pulse-strips,movers,calendar,coverage}.js`, registered them and the `pulse` preset in `panels/index.js`, added `css/pulse.css` and `tests/workspace/{pulse,follow-ui}.test.mjs`. River is a `<yk-lanes>` activity timeline with Follow bound to 9-01; strips compare the current and previous equal windows and never show `$0` for unpriced; movers rank schema-supported measures and omit the repo lens when `/schema` lacks it; calendar uses `<yk-matrix>` with a labelled transient brush and a committed zoom; coverage shows typed groups and denominators with no blended percentage.
- Surfaces: the brief's owned paths plus `panels/index.js`.
- Deviations / unfinished: worker reported **over budget** (about 1,820 added lines against ~1,200) with the deliverable complete. Empty causes now clear each applied filter/cohort/selection through the wiring fixer below (the worker's own gap). Movers sparklines are labelled daily block text inside the table rather than a second chart element. Cohort forwarding to panel requests is not wired; the cohort chip and `ca`–`cd` state remain visible and deep-link-restorable, and cohort-driven requery belongs to Phase 10's compare wiring. Follow browser proof landed in `follow-ui.test.mjs`.
- Verification: `pulse` + `follow-ui` → 12/12 pass on a re-run (Chromium; five panels, river inspect, no-`$0` strips, chooser limits, calendar brush/zoom, Follow off/ack/failed-probe/hidden, ≤4 in flight, clean diagnostics); `engine` + `tray` 16/16. `artifact_feedback` on the brief and report delivered / screen pass, no flags.

### `9-04-ledger.md`

- Outcome: committed as `e38814b` (`Add ledger explorer over cursor-paged events`). Replaced the 9-01 ledger placeholder with `explorers/ledger.js`; added `panels/ledger-table.js`, `css/ledger.css` and `tests/workspace/ledger.test.mjs`. `/ledger` reads `/explore`, appends cursor pages past 20,000 with no duplicate keys, shows every applied filter as a removable chip and names inapplicable ones, opens row provenance in the shared inspector, renders unpriced rows as `unpriced`, and uses the one state vocabulary.
- Surfaces: the brief's owned paths.
- Deviations / unfinished: worker reported **done with concerns**; three Chromium specs skipped because the committed stub had no `/explore` route. That stub gate is closed by the fixer below and the specs now run. Selection is entity-level (one event selects its conversation), per the interaction contract; artifact promotion uses `repo_id` + `path`; absent-cost event types render `unpriced`, so the footer lower bound is wider than usage calls. `gate: the exact artifact id lens grammar is unconfirmed; the tray uses repo_id+path`.
- Verification: after the stub fixer and the spec's deliberate-400 console allowance, `ledger.test.mjs` → 14/14 pass on a re-run (Chromium; 20,050 rows via 40 Load-more clicks, unique keys, non-increasing `ts`, chip remove/Back, unsupported filter named, inspector, unpriced, empty/legacy error, ≤4 in flight); `engine` 9/9. `artifact_feedback` on the brief and report delivered / screen pass, no flags.

Wiring fixer for the 9-03/9-04 gates: committed as `5632a70` (`Wire Pulse panels into the shell and clear empty causes`). `app.js` now imports `panels/index.js`, so the shipped `/b/pulse` registers the preset and renders the five panels; the pulse spec no longer imports the barrel itself. `url-state.js` no longer resurrects a removed filter from the prior search, with a `url-state` regression. Empty Pulse panels now name each applied filter/cohort/selection and offer a working Clear through a router-backed context handle; `pulse.test.mjs` proves a filtered river clears to ready. A follow-up `9f1a636` updates the two stale spec assertions (the delivered `/b/pulse` board and the one expected legacy-400 console entry). The full workspace + codec suite then passed 75/75 in one run.

Stub fixer for the 9-04 `/explore` gate: committed as `ff58a31` (`Add explore rows and cursor paging to the workspace stub`). `fixture.mjs` now provides 20,050 deterministic event rows with the CONTRACTS.md 7.2 fields and opaque offset cursors; `stub-api.mjs` serves `/v1/analytics/explore` with cursor/limit, `truncated`/`next`, unpriced rows and the existing empty/legacy scenes. No product code or assertion was changed.

### `9-06-workspace-acceptance.md`

- Outcome: the first run was **blocked**: it wrote and committed `d79ffac` (`Add the Phase 9 acceptance proof, blocked on five product defects`) with `tests/workspace/{acceptance,deep-links,degradation}.test.mjs` and the report, then refused to pass. It found five genuine product defects: the frame never gated on `panel.requires`; returned `errorState`s carried no Retry; the scheduler shared one `Response` so a duplicate query parsed `{}` and the legacy coverage message became `The server returned 400. (400)`; `coarsened` from the calendar was dropped by the badge model; and `<yk-lanes>` discarded the river row's `conversation_id`/`path`/`repo_id` values. The 9-06b fixer committed as `2e38ccd` (`Fix the five Phase 9 workspace acceptance defects`) gated board panels in `app.js`, attached the frame retry to returned error/cancelled states, cloned the resolved `Response` per scheduler waiter, folded result badge flags into the existing coverage model, and preserved `item.values` in `buildLanesModel`. The fresh 9-06 re-run then passed and rewrote the report with the verified verdict.
- Surfaces: `tests/workspace/{acceptance,deep-links,degradation}.test.mjs`, `reports/9-06-workspace-acceptance.md`; the fixer also touched `web/js/{app,charts/yk-lanes,core/request-scheduler,panels/panel-frame}.js`, `tests/request-scheduler.test.mjs`, `tests/charts-cat/lanes.test.mjs`, `tests/workspace/{acceptance,capability}.test.mjs` and wrote `reports/9-06b-fixer.md`.
- Deviations / unfinished: the fixer corrected one unowned expectation — `capability.test.mjs` asserted the pre-gating `ready` state for a panel with a missing feature; the correct state is now `unsupported`, with the drawer's missing-feature/source checks unchanged. The acceptance diagnostic check now permits only the deliberate 500/403 console entries. No product assertion was removed or weakened. `gate: none`.
- Verification: the three proof specs → 7/7 tests and 70/70 named acceptance cases; workspace + codec suite 86/86; both chart kits 68/68; scheduler included in a 72/72 run; `git diff --check` clean. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### Phase 9 integrated verification — closed

- Entry point → action → result, run independently on the closing tree over the committed fixture/stub:
  - Start lists all 15 question paths; each opens its destination or names the missing capability, and the legacy `/schema` disables 10 with the feature-and-source reason. `/b/pulse` settles its five frames; river inspect opens session/artifact/execution provenance; the calendar brush previews without a push and zoom commits `from`/`to`; Follow off/probe/ack/failed-500 behaves and the watermark only advances on acknowledgement; chips, tray and typed populations render; an unsupported join and an ignored filter are named; unpriced values are never `$0`; the capability inspector explains provenance and the movers chooser follows `/schema`; a saved board round-trips; `/ledger` pages past 20,000; `/ops` distinguishes admin from member; every frame state and the coarsened badge are reached.
  - All-history and a ten-year finite window survive reload, Back and Forward with tz, filter, panel override and cohort; unknown paths stay in the shell; `maxInFlight <= 4`. The `legacy` scene renders the gated panel `unsupported` while the rest show `range too wide` verbatim with retry and no window rewrite or page/CSP error.
  - `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test tests/workspace/*.test.mjs tests/*.test.mjs` → 86/86 pass; `node --test tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs` → 68/68 pass; `git diff --check` clean. Browser specs drive Chromium with real mouse/keyboard at `inspect()` coordinates and wait on `data-idle`/`data-state`; no fixed sleeps, no `/tmp`, no animation/timing assertion, and no test branch in product code.
  - `artifact_feedback` on all six Phase 9 briefs and all six reports returned delivered / screen pass by `jev-1.13.0`, no flagged checks.

Carried:

- `gate: the exact artifact id lens grammar is unconfirmed; the tray uses repo_id+path (9-04).`
- Cohort forwarding to panel requests is not wired; the cohort chip and `ca`–`cd` state stay visible and deep-link-restorable, and cohort-driven requery belongs to Phase 10's compare wiring.
- Movers sparklines are labelled daily block text inside the table rather than a second chart element.
- The 8-02 box-legend seam, `[data-shape]` selector scoping and the browser-shown diverging ramp remain Phase 10 or later.
- `/schema` may publish the activity feature as `analytics_activity` while CONTRACTS.md 17.2 names `activity`; the client accepts both as an alias rather than silently resolving the contradiction.

## Phase 8 — Distribution and categorical chart kit

The phase outcome is approach-known (SVG with the shared tooltip, legend and registry). This run uses the signed outcome and CONTRACTS.md 17.5 and 17.7 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized. Phase 8 has no Units list in DESIGN.md and is more than one worker's work, so `refine` is dispatched as its own context; its verdict decides the units.

Refinement commit `2b246b9` (`docs: refine Phase 8 distribution and categorical chart kit`) records five units and writes their briefs. Verdict **Proceed**: 8-01 shared SVG foundation plus `<yk-bars>` (ranked/stacked/percent/lollipop/slope), 8-02 `<yk-ranges>` (box/histogram/strip/dots), 8-03 `<yk-matrix>` (heatmap/calendar), 8-04 `<yk-lanes>` (timeline/gantt), 8-05 `<yk-treemap>` plus the gallery index and phase acceptance. 8-01 runs first; 8-02, 8-03 and 8-04 then run in parallel on disjoint element, gallery-page, fixture and spec paths; 8-05 runs last. The only Phase 7 helper seam is `formatters.js` gaining a `text` kind. `artifact_feedback` on all five briefs returned delivered / screen pass (`jev-1.13.0`), no flags. Phase 7 carried items were placed: the browser-evidence gate is absorbed into every Phase 8 browser spec's done evidence; the `f`/tray, scatter-include-authority and legend-focus mapping items belong to Phases 9 to 11 and do not touch Phase 8. Browser evidence depends on `playwright-core` outside the worktree and is recorded as a gate below.

### `8-01-bars-svg-foundation.md`

- Outcome: committed as `32a8a51` (`Add the shared SVG chart foundation and bars element`), with `42e4185` correcting the report's budget status. Added `svg-base.js` (shared SVG element lifecycle, shell, registry, tooltip/legend/table/badges, selection, keyboard grammar, 44 px targets, `inspect()`, `select`/`inspect` events, guarded `setBrush()`), `yk-bars.js` (ranked, stacked, percent, lollipop, slope plus pure model helpers), the `formatters.js` `text` kind seam, a categorical `charts.css` section, and the bars gallery page, fixture and Chromium spec.
- Surfaces: `web/js/charts/{svg-base,yk-bars,formatters}.js`, `web/css/charts.css`, `tests/gallery/{bars.html,bars.js,fixture-bars.js}`, `tests/charts-cat/{browser.mjs,bars.test.mjs}`, and its report.
- Deviations / unfinished: worker reported **over budget** (about 1,969 changed lines against ~950) with the deliverable complete and all done evidence passing. Ranked/lollipop plot the first series; slope requires exactly two series or reports `unsupported`; existing `(other)` data absorbs the ranked tail; zero-total percent rows yield zero shares; bars legends list measures so legend focus emits `filter` with null filter/value (Phase 9/10 lens mapping); `svg-base.js` has a non-browser fallback for pure model tests. No known gaps in owned paths.
- Verification: `tests/charts-cat` 8/8 pass including Chromium (real mouse/keyboard/touch, six fixed neutrals, both themes, ≤4 in flight); accumulated `tests/charts-time` 30/30; `tests/*.test.mjs` 12/12; `git diff --check` clean. `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### `8-02-ranges.md`

- Outcome: committed as `71966c6` (`Add the ranges and distributions element`); `<yk-ranges>` now covers `box` (min/q1/median/q3/max/p95, labelled p95, optional named baseline band), `histogram` (fixed `spec.bins`, zero-based counts, zero-filled missing bins), `strip` (one mark per observation, sampled label) and `dots` (duplicate keys aggregated), with `brush: null` and no brush event.
- Surfaces: `web/js/charts/yk-ranges.js`, `tests/gallery/{ranges.html,ranges.js,fixture-ranges.js}`, `tests/charts-cat/ranges.test.mjs`, and its report.
- Deviations / unfinished: worker reported **over budget** (about 700 lines budgeted; more read/changed). Box derives six summary series so its legend lists summary statistics with summary colours rather than entity colours — a shared-base limitation needing a seam that separates tooltip series from legend series. Histogram follows `spec.bins` authoritatively; strip reuses an entity key across observations; p95 text is plot-level with `pointer-events: none`. No other owned-path gaps.
- Verification: `ranges.test.mjs` 6/6; combined `tests/charts-cat/*.test.mjs` 25/25 after all three sibling units landed (Chromium, real mouse/keyboard/touch); `git diff --check` clean.

### `8-03-matrix.md`

- Outcome: committed as `43fe650` (`Add the matrix heatmap and calendar element`); `<yk-matrix>` covers heatmap and calendar on the 8-01 base, with pure model/layout/ramp/brush exports, a ramp legend with stop values, per-cell values, `inspect()`, selection/inspect and calendar brush (whole-day snap through `setBrush`).
- Surfaces: `web/js/charts/yk-matrix.js`, `tests/gallery/{fixture-matrix.js,matrix.html,matrix.js}`, `tests/charts-cat/matrix.test.mjs`, and its report.
- Deviations / unfinished: worker reported **over budget** (~1,110 changed lines vs ~700). The shared base exposes no model/rows accessor and no table-arrow/`[`/`]` hook, so the element keeps `_matrixModel` and a capture-phase keydown listener without editing the foundation. Calendar uses week columns on a real time domain (day-per-column would not form a week grid); brush values are day-snapped. Table shows the unit in the header. Heatmap cells and calendar days share entity keys by design; the diverging ramp is pure-tested but not browser-shown. No owned-path gaps.
- Verification: `matrix.test.mjs` 5/5; combined `tests/charts-cat/*.test.mjs` 25/25 (Chromium); `git diff --check` clean.

### `8-04-lanes.md`

- Outcome: committed as `5a6796d` (`Add the timeline and gantt lanes element`); `<yk-lanes>` covers timeline and gantt lanes with kind-keyed colours/shapes, markers and spans, brush, priced/unpriced marking, keyboard and touch drag.
- Surfaces: `web/js/charts/yk-lanes.js`, `tests/gallery/{lanes.html,lanes.js,fixture-lanes.js}`, `tests/charts-cat/lanes.test.mjs`, and its report.
- Deviations / unfinished: worker reported **over budget** (~1,362 changed lines). `spec.lanes`/`spec.data.lanes` is an array because the base `data` setter only accepts arrays. Each lanes mark group opts out locally with `transform:none; clip-path:none` because the shared `[data-shape]` swatch selectors in `web/css/charts.css:258-265` would otherwise rotate/clip a plotted `<g>`. Lane table rows stop propagation so the base keyboard grammar and table do not both fire. Touch drags use `touchstart/move/end`. No owned-path gaps.
- Verification: `lanes.test.mjs` 6/6; combined `tests/charts-cat/*.test.mjs` 25/25 (Chromium); `git diff --check` clean.

### `8-05-treemap-acceptance.md`

- Outcome: committed as `f200ce5` (`Add the treemap and Phase 8 acceptance proof`). Added `<yk-treemap>` (squarified two-level layout, parent entity colouring, labelled `(other)`, parent legend, shared table/tooltip/selection/keyboard, `brush: null`), its gallery/fixture and Chromium spec, the five Phase 8 gallery index links, and the phase acceptance spec. The first attempt stopped uncommitted, correctly refusing to weaken its acceptance check; after the fixer below it re-ran the evidence and committed.
- Surfaces: `web/js/charts/yk-treemap.js`, `tests/gallery/{treemap.html,treemap.js,fixture-treemap.js,index.html,index.js}`, `tests/charts-cat/{treemap.test.mjs,acceptance.test.mjs}`, and its report.
- Deviations / unfinished: worker reported **done with concerns**. One known problem remains outside its owned paths: the 8-02 box legend lists summary statistics with summary colours rather than entity colours (carried below). The budget clause conflicted with its owned-path restriction, so its earlier handoff was supplied as the report rather than `IMPLEMENTATION.md`.
- Verification: `treemap.test.mjs` 5/5; `acceptance.test.mjs` 8/8; combined `tests/charts-cat/*.test.mjs` 38/38 (Chromium, real mouse/keyboard/touch); `tests/*.test.mjs` 12/12; `git diff --check` clean.

Fixer before the re-dispatch: 8-05 found two real defects while proving the phase. Committed as `3246525` (`Fix calendar matrix values and shared table keyboard bubbling`): `yk-matrix.js`'s calendar branch now reads `cell.data.value`/`n`/`coverage` after `calendarLayout()` moves the source row into `data` (the table had shown `—` and `inspect().marks[].values` was `{}`), and `table.js` now stops propagation for Space/Enter/Arrow keys so the row handler and the base root grammar no longer both toggle a selection. No check was weakened; the fix was verified by the full Phase 8 suite before 8-05 re-ran.

Second fixer: the combined suite then showed the Phase 7 index acceptance still asserting exactly the four Phase 7 links. Because 8-05 deliberately adds the five Phase 8 links to the same shared index (keeping the Phase 7 links intact), committed as `77945cb` (`Accept Phase 8 gallery links in the Phase 7 index check`): the Phase 7 spec now asserts its four cases are the first four links rather than the only links, and still validates every href. Phase 7's own outcomes are unchanged.

### Phase 8 integrated verification — closed

- Entry point → action → result, run independently on the closing tree (`tests/gallery/index.html` and every Phase 8 page through the committed harness):
  - The index exposes all nine cases (`foundations`, `time-series`, `gestures`, `scatter`, `bars`, `ranges`, `matrix`, `lanes`, `treemap`). Each Phase 8 page settles as designed: bars 5 `ready` plus the intended `empty`/`unsupported`, ranges 4 `ready`, matrix 2 `ready`, lanes 2 `ready`, treemap 1 `ready`. A real mouse click on each engine's first mark inspected the same shared key `model:atlas`, with no console error, page error or CSP violation. The probe printed `PROBE OK`.
  - `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs packages/yakka-analytics/tests/charts-time/*.test.mjs packages/yakka-analytics/tests/*.test.mjs` → 80/80 pass in one run (38 Phase 8, 30 Phase 7 time-series, 12 existing), all browser specs driving Chromium with real mouse/keyboard/touch at `inspect()` coordinates and waiting on `data-idle`/`data-state`; `git diff --check` clean. No fixed sleeps, no `/tmp`, no inline style attributes, no animation/transition, and no test branch in product code.
  - `artifact_feedback` on all five Phase 8 briefs and all five reports returned delivered / screen pass by `jev-1.13.0`, no flagged checks.
- Carried

- `gate: browser acceptance needs playwright-core 1.63.0 (under NODE_PATH) and the Chromium 1243 cache in CI; both live outside this worktree, and the specs skip with a named reason when absent.`
- `gate: the external Pages automation must accept ./web as its output directory (carried from Phase 1; verified only in Phase 13).`
- The 8-02 box legend lists the six summary statistics with summary colours rather than entity colours, because the shared base couples tooltip and legend to one series list; a seam that separates tooltip series from legend series is owed if a Phase 10 distribution panel shows a box legend.
- The shared `[data-shape]` swatch selectors (`web/css/charts.css:258-265`) match any plotted group carrying `data-shape`, not only `.yk-swatch`; lanes opts out locally with `transform:none; clip-path:none`. Future SVG elements that set `data-shape` on mark groups must do the same, or the selectors should be scoped.
- The shared base `data` setter only accepts arrays and exposes no model/rows accessor or table-arrow/`[`/`]` hook; matrix keeps `_matrixModel` and a capture keydown listener and lanes passes its lane list as an array. Phase 9 to 12 consumers must use the same conventions.
- Heatmap cells and calendar days share entity keys by design, so selecting or highlighting a key marks every cell for it and the table repeats the key.
- The diverging ramp is implemented and pure-tested but no gallery element renders it; only the sequential heatmap is browser-proven.
- Bars legends list measures, so legend focus emits `filter` with a null filter/value; Phase 9/10 board chips must map those series keys to contract lens names (carried from Phase 7's note, now also true of bars).

## Phase 7 — Time-series chart kit

The phase outcome is approach-open (composing uPlot's hooks into the gesture table; 2-D scatter hit-testing). This run uses the signed outcome and CONTRACTS.md 17.5 and 17.7 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized. Refinement decides the units.

Refinement commit `7b307ad` (`docs: refine Phase 7 time-series chart kit`) records five sequential units and writes their briefs. Verdict **Proceed**: 7-01 foundations (registry, formatters, tooltip, legend, badges, table, themes, gallery harness), 7-02 time-series `<yk-chart>`, 7-03 gestures and settled state, 7-04 numeric scatter/ECDF with an independent hit-test reference at the 5,000-point budget, 7-05 gallery and phase acceptance. No two units run in parallel because they compose the same elements. `artifact_feedback` on all five briefs returned delivered / screen pass (`jev-1.13.0`), no flags. Phase 6 carried items were placed: the two gates belong to Phases 13 and 3, and the remaining server-contract items belong to Phases 10 to 12; none touches or blocks Phase 7. Browser evidence depends on `playwright-core` outside the worktree and is recorded as a gate below.

### `7-01-chart-foundations.md`

- Outcome: committed as `5bdc0c2` (`Add chart foundations, colour registry and gallery harness`); added the colour registry with fixed neutral identities for `(mixed)`/`(none)`/`(multi)`/`unknown`/`unscored`/`(other)`, formatters (money never `$0` for unpriced), tooltip with `data-entity-key`, legend intents, badges, accessible table, cached constructable stylesheet, both-theme `charts.css`, and the test-only gallery harness with CSP/console/in-flight collection, `fixture.js` and the Chromium loader.
- Surfaces: `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,styles}.js`, `web/css/charts.css`, `tests/gallery/{harness.mjs,fixture.js,foundations.html,foundations.js}`, `tests/charts-time/{browser.mjs,foundations.test.mjs}`, and its report.
- Deviations / unfinished: slot batches sort before first assignment (stable for a key set, existing slots never reassigned); fixed-neutral adjacency threshold is ΔE 10 because label+pattern carry distinction; the harness adds test-only `/favicon.ico` and `/v1/analytics/*` routes. No known gaps.
- Verification: `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-time/foundations.test.mjs` → 8/8 pass including the Chromium test (playwright-core 1.63.0, Chromium 1243); `node --test packages/yakka-analytics/tests/*.test.mjs` → 12/12 pass. Committed palette thresholds: hue contrast ≥3.0 (light 5.02/dark 5.57), adjacent hue ΔE ≥20 (51.3/27.4), fixed-neutral contrast ≥3.0 (4.74/5.97), adjacent neutrals ΔE ≥10 (12.4/15.6), status contrast ≥3.0 (5.02/5.48), adjacent status ΔE ≥20 (27.1/69.0), cohorts ΔE ≥20 (84.3/96.5). `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### `7-02-time-series-element.md`

- Outcome: committed as `c5a2bfa` (`Add the uPlot time-series chart element and gallery`); `<yk-chart>` now renders line, area, stacked columns, cumulative and share from one spec/data, with one y scale, cursor-synced scale groups, threshold lines/bands (drawn and listed in the table, no selectable mark), the 7-01 legend/table/tooltip/badges, a frame naming units and time basis, `data-chart`/`data-state` (`loading`/`ready`/`empty`/`unsupported`) and `inspect()` with window, bucket, visible series, plot rectangle, `xToPx`/`yToPx`, cursor and marks.
- Surfaces: `packages/yakka-analytics/web/js/charts/{yk-chart,series,scales,thresholds}.js`, `tests/gallery/{time-series.html,time-series.js}`, `tests/charts-time/time-series.test.mjs`, and its report.
- Deviations / unfinished: uPlot bands use `{series:[from,to]}`; stacked-column tables show segment values while the plot uses cumulative tops; share is a 0–1 ratio rendered by the percent formatter; thresholds are appended to the 7-01 table as a `tfoot` because `table.js` is outside this unit; drag zoom stays disabled because 7-03 owns gestures; theme change re-renders rather than recolouring in place. No known gaps.
- Verification: `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-time/time-series.test.mjs` → 9/9 pass including Chromium; `foundations.test.mjs` 8/8; `node --test packages/yakka-analytics/tests/*.test.mjs` 12/12. `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### `7-03-gestures-settled-state.md`

- Outcome: committed as `6da9662` (`Add chart gestures, selection and settled URL state`), after an interrupted first attempt (permission-rejected tool call) left the work uncommitted; the retry resolved the one failing pinch/history assertion by converting settled intents through `currentWindowRange()` rather than weakening the test. `<yk-chart>` now has a Boolean include/exclude selection, hover/inspect with linked `yk-highlight`, click/Shift/Ctrl/Cmd/Alt selection, brush `sel` by `replaceState`, zoom/double-click commit pushing `from`/`to` and clearing `sel`, Shift-drag pan, Ctrl/Cmd-wheel zoom around the cursor, legend toggle/focus/isolate, the full keyboard grammar with `Esc` clearing selection before brush, touch tap/Select-mode/pinch, 44 px targets, `popstate` restore, and `inspect().selection`/inspected key.
- Surfaces: `packages/yakka-analytics/web/js/charts/{gestures,selection,history}.js`, the `yk-chart.js` composition seam, `tests/gallery/{gestures.html,gestures.js}`, `tests/charts-time/gestures.test.mjs`, and its report.
- Deviations / unfinished: `f` zooms to the inspected bucket when a following bucket exists and otherwise falls back to the legend filter; `o` and `c`+`a`–`d` emit `open`/`cohort` events and mirror state only (no tray/inspector UI, by scope); legend isolate replaces `hide`, focus pushes the matching contract filter and emits `filter` without a URL key when no lens name matches. No known gaps.
- Verification: `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-time/gestures.test.mjs` → 4/4 pass (Chromium); foundations+time-series+gestures 21/21; `node --test packages/yakka-analytics/tests/*.test.mjs` 12/12. `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### `7-04-scatter-ecdf.md`

- Outcome: committed as `7b34b18` (`Add numeric scatter, ECDF and 2-D hit-testing`); `<yk-chart>` now dispatches numeric-x scatter to a first-party Canvas 2D element and ECDF to uPlot stepped lines, with a pure nearest-point/rectangle hit-test module, an independent linear-scan reference at the 5,000-point budget, colour/shape/size and sampled marking, ECDF monotonic values and table, and rectangle union/subtraction carrying a `where` predicate with include/exclude keys.
- Surfaces: `packages/yakka-analytics/web/js/charts/{scatter,canvas-scatter,ecdf,hit-test}.js`, the `yk-chart.js` dispatch seam, `tests/gallery/{scatter.html,scatter.js}`, `tests/charts-time/scatter.test.mjs`, and its report.
- Deviations / unfinished: the declared fallback was used — uPlot's cursor is one-dimensional and its point styling is per series, so 2-D hit-testing and per-point colour/shape/size at 5,000 points use Canvas 2D behind the same element contract, with no dependency added; the rectangle extends the predicate with `where` composed in the element without editing `selection.js`; additive rectangles accumulate include keys while `where` records the latest region; scatter adds overlay arrow-key inspection for focus parity; the reference scans `inspect().marks` (public surface). Time-grain scatter axes, tray/exact population and cross-grain requery remain later phases.
- Verification: `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-time/scatter.test.mjs` → 2/2 pass (Chromium, 5,000 points); foundations+time-series+gestures+scatter 23/23; `node --test packages/yakka-analytics/tests/*.test.mjs` 12/12. `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### `7-05-gallery-acceptance.md`

- Outcome: committed as `1b4ae40` (`Add the Phase 7 gallery index and browser acceptance suite`); `tests/gallery/index.html`/`index.js` link the four Phase 7 pages, and `tests/charts-time/acceptance.test.mjs` proves the phase outcome across them, including the committed palette check in both themes, the 5,000-point independent scatter reference exercising the declared canvas fallback (ECDF stays on uPlot), all gesture rows, badges with labelled counts, keyboard-operable tables, the below-900 px one-column layout and 44 px targets, no animation, no console/page/CSP error and at most four in-flight requests.
- Surfaces: `packages/yakka-analytics/tests/gallery/{index.html,index.js}`, `tests/charts-time/acceptance.test.mjs`, and its report.
- Deviations / unfinished: the independent scatter reference lives in the acceptance file (a linear scan over the public `inspect().marks`) rather than importing the 7-04 test module; the index shows theme/case/fixture sizes as test-only outputs but does not switch themes itself. No assertion was weakened and no owning unit was edited.
- Verification: `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-time/acceptance.test.mjs` → 7/7 pass (Chromium); all charts-time specs 30/30; `node --test packages/yakka-analytics/tests/*.test.mjs` 12/12. `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### Phase 7 integrated verification — closed

- Entry point → action → result, run independently on the closing tree (`tests/gallery/index.html` and its four pages):
  - The index exposes four case links; the time-series page settles eight charts in `ready` (absolute line/area/columns, cumulative, share, two synchronised scale-group charts, thresholds) plus the intended `empty` and `unsupported` states; hover on a real mark in the linked gesture gallery sets `inspectedKey` and the linked chart's `highlight` to the same key with no URL or history change; the scatter page renders 5,000 marks on two canvas layers behind the `<yk-chart>` contract, and a real rectangle drag produces an include predicate with a `where` region (4,438 keys in the probe); no console or page errors. The probe prints `PROBE OK`.
  - `NODE_PATH=…/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-time/*.test.mjs` → 30/30 pass, including the four unit specs and the acceptance suite, all driving Chromium with real mouse/keyboard/touch events at `inspect()` coordinates and waiting on `html[data-idle]`/`data-state`; `node --test packages/yakka-analytics/tests/*.test.mjs` → 12/12 pass; `git diff --check` clean. No fixed sleeps, no `/tmp`, no inline style attributes, no animation/transition, and no test branch in product code.
  - `artifact_feedback` on all five Phase 7 briefs and all five reports returned delivered / screen pass by `jev-1.13.0`, no flagged checks.
- Carried

- `gate: browser acceptance needs playwright-core 1.63.0 (under NODE_PATH) and the Chromium 1243 cache in CI; both live outside this worktree, and the specs skip with a named reason when absent.`
- `f` zooms to the inspected bucket's window when the row has a following bucket and otherwise falls back to the legend filter; Phase 9's tray/inspector wiring must reconcile that gesture with the state it consumes.
- Scatter additive rectangles accumulate include keys while `where` records only the most recent region; Phase 11's tray must treat the include keys as the authoritative predicate (or request a region array) rather than infer union geometry.
- Legend focus emits `filter` without a URL change when no lens name matches the series key; Phase 9/10 board chips must map series keys to the contract lens names.

## Phase 6 — Plan and execution entities and the cohort predicate (rebuild against CONTRACTS.md 17.3.1)

The earlier Phase 6 units and briefs on this branch predate the 2026-11-18 amendment (PR #249, `cf87bf4`): their `[]string` scope lists, partial resolver, route set and missing association counts contradict 17.3.1 and are not carried forward. The plan/execution entity units 6-01 to 6-01d landed by the earlier run stay on the branch and are re-verified. Refinement commit `3317aa8` replaces 6-02 to 6-04b with 6-02 to 6-07. `artifact_feedback` on all six rebuilt briefs returned delivered / screen pass (`jev-1.13.0`).

Merge fallout fixed before the phase: master's Plan 23 `store.ArtifactVersion` collided with Phase 5's artifact history row name, so the tree did not build. Commit `58bcca5` renames only the Phase 5 row to `ArtifactHistoryVersion`.

The phase outcome is approach-open; this run uses the signed outcome and CONTRACTS.md 17.3.1 as the fixed yardstick. No new grain, join, route, dependency, gesture or contract is authorized.

### Baseline before the rebuild

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go build ./internal/...` → after `58bcca5`, passes.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → store passes; serve fails `TestAnalyticsActivityMergesAndPagesEqualTimeRows` and `TestAnalyticsActivityProbeCountsLateArrivalWithoutRows`, both because the test uses `time.Now()` against a fixed 2026-11-08 window. Owned by 6-06.

### `6-02-cohort-scope-elements.md`

- Outcome: committed as `657dd6d` (`Add structured cohort scope elements and canonical grammar`); the scope lists are now `{lens, values}` element objects with the 17.3.1 budgets, canonical merge/sort and key, a shared `cohortGrainFilters` table, and one `CompileCohortScope` Boolean compiler for the resolver unit. `CohortSessionSubquery` still rejects non-empty scope pending 6-03.
- Surfaces: `packages/yakka/internal/store/analytics_cohort.go`, focused store tests and `reports/6-02-cohort-scope-elements.md`.
- Deviations / unfinished: `band:<check>` accepts any non-empty check at parse; catalogue validation is left to 6-03. The untouched predicate `cohortLenses` table still lists `origin`/`has_artifacts`/`repo_id`/`model` for session `in` and lacks `id`; predicate alignment is owed by 6-03/6-04.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store -run 'Cohort' -count=1` passed; full store passed (6.807s) and serve failed only the two pre-existing activity tests; `git diff --check` clean. `artifact_feedback` on the brief returned delivered / screen pass before dispatch.

### `6-03-cohort-resolver-matrix.md`

- Outcome: committed as `986a146` (`Add full cohort resolver matrix`); the kernel now resolves the 17.3.1 matrix for session, artifact, content, execution and plan (dynamic checks, `band:<check>`, `id`, plan derived measures, lifetime session lenses, scope include/exclude through `CompileCohortScope`), and plan resolution follows 17.3's active-session + lifetime-artifact association.
- Surfaces: `packages/yakka/internal/store/analytics_cohort.go`, focused store tests and `reports/6-03-cohort-resolver-matrix.md`.
- Deviations / unfinished: time scope and the time `id` lens remain `unsupported_join` and are owned by 6-06; dynamic check validation only runs when the serve call supplies `CohortResolveOptions.Checks`; `content_bytes` needs `CohortResolveOptions.BlobDir`. 6-04/6-05 must wire both into `parseFilter`/resolution.
- Verification: store suite passed (6.75s); full store/serve failed only the two pre-existing activity tests; report records the new resolver cases.

### `6-04-schema-capability-publication.md`

- Outcome: committed as `ab1b95f` (`Publish capability schema filters and content grain`); `/schema.grains` now publishes `filters` and `predicate` for all six grains, adds the aggregate/cohort-only `content` grain and the scope budgets; `/entities?grain=session` filters on lifetime lenses in list mode; time entities report `ignored_filters`; the exclude whitelist comes from the shared filter table; artifact parses `session_model` with `model=` as alias.
- Surfaces: `packages/yakka/internal/serve/{analytics_query.go,analytics_entities.go,analytics.go,analytics_artifact_population.go}`, focused schema tests and `reports/6-04-schema-capability-publication.md`.
- Deviations / unfinished: session scatter and aggregate still apply fact-level filters (list only is lens-derived); `stage` is published for the time grain but not accepted as an include filter; filtered session paging scans in-window rows in 500-row chunks; artifact `cohort=` still rejects. 6-05 must close the scatter/aggregate lens filters, the `stage` publication/acceptance mismatch and artifact cohorts.
- Verification: focused schema/entity/time tests passed 8/8; store passed (6.913s); serve failed only the two pre-existing activity tests; `go build ./internal/...` and `git diff --check` clean.

### `6-05-cohort-target-population.md`

- Outcome: committed as `70387d0` (`Accept resolved cohorts on target routes`); wired `s.opts.Checks` and the tenant blob dir into resolution, applied session lens filters to scatter/aggregate, accepted artifact cohorts, added `refuseCohort` to the six refusing routes, and stopped publishing the unaccepted time `stage` filter (legacy `exclude=stage:` unchanged).
- Surfaces: `packages/yakka/internal/serve/` analytics handlers and shared filter code, `packages/yakka/internal/store/analytics_cohort.go`, focused route tests and `reports/6-05-cohort-target-population.md`.
- Deviations / unfinished: the typed `population.relation`/`associations`/`resolved_n` layer and its invariant evidence were **not implemented**; responses keep the pre-existing population objects. Follow-up brief 6-05b closes it before 6-06.
- Verification: focused cohort/session/artifact tests passed; store passed (6.979s); serve failed only the two pre-existing activity tests; `go build ./internal/...` and `git diff --check` clean.

### `6-05b-cohort-population-relation.md`

- Outcome: committed as `a0b4695` (`Report typed cohort population, relation and rejection associations`); added `CohortCount`, `RejectionAssociations` and `ContentHashCount`, a shared population/relation builder, session-unit populations on `/query`, `/distribution`, `/summary`, `/series`, `/explore`, entity-unit populations elsewhere, and target-side rejection associations with the identity and treatment.
- Surfaces: `packages/yakka/internal/{serve,store}/` cohort population paths, new `analytics_population.go`, focused tests and `reports/6-05b-cohort-population-relation.md`.
- Deviations / unfinished: non-session populations reuse the post-restriction count for `scope_n` and `cohort_n`; `/scores` and `/score-series` expose one content-hash population rather than one per check; no store-level unit test. 6-07 must check these against the invariants.
- Verification: focused cohort population tests passed; store passed (6.934s); serve failed only the two pre-existing activity tests.

### `6-06-time-cohorts-and-activity.md`

- Outcome: committed as `8123c1b` (`Resolve time cohorts and report activity observation types`); time scope include/exclude and the time `id` lens resolve, inapplicable time filters are 400 `unsupported_join`, `/entities?grain=time` reports `relation.target_sessions`, `/activity` reports `population.by_type` and a cohort `relation`, source and target rejection associations are counted without dropping unassociated rows, and the two activity fixtures are now deterministic.
- Surfaces: `packages/yakka/internal/store/{analytics_cohort.go,activity.go,analytics.go}`, `packages/yakka/internal/serve/{analytics_activity.go,analytics_entities.go,analytics_population.go,analytics.go}`, focused tests and `reports/6-06-time-cohorts-and-activity.md`.
- Deviations / unfinished: the own-path list in the brief omitted `serve/analytics.go`, `analytics_population.go` and `analytics_entities.go`, which the unit touched; recorded in its report. Non-session scope/cohort counts and the single content-hash population remain as 6-05b described.
- Verification: full `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.498s; serve 28.454s), including the formerly time-dependent activity tests.

### `6-07-cohort-proof-enumeration.md`

- Outcome: committed as `e238be6` (`Prove schema-driven cohorts and advertise the feature`); a schema-driven enumeration resolves 132 published measure/lens pairs across the six grains, the five 17.3.1 invariants pass on fixtures, and `features.cohort` is advertised only after that proof. Fixed in earlier units: artifact/plan/execution `scope_n` now reports pre-cohort with post `cohort_n`; session lens targets count the lens population; a hashless legacy artifact version reports `content_unavailable` instead of 500.
- Surfaces: new `analytics_cohort_proof_test.go`, `analytics_query.go`, `analytics_entities.go`, `analytics_artifact_population.go`, updated existing tests and `reports/6-07-cohort-proof-enumeration.md`.
- Deviations / unfinished: the proof expands dynamic `<check>`/`<kind>` families through one design check and the design kind (same resolver path); legacy `exclude=<name>:<value>` cannot name `band:<check>` because it cuts at the first colon (include is proved, structured cohort `scope.exclude` accepts it); `content` is proved through `/scores` because it has no `/entities` route; time uses two fields because its route requires 2–4.
- Verification: full `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 6.914s; serve 29.490s); report records the before/after invariant failures.

### Phase 6 integrated verification — closed

- Entry point → action → result, run independently on the closing tree:
  - `/v1/analytics/schema` publishes `filters` and `predicate` for `session`, `artifact`, `content`, `execution`, `plan`, `time`, the scope budgets, and `features.cohort: true`. `TestCohortSchemaEnumeration` reads those maps (not a literal list) and resolves 132 published measure/lens pairs across 6 source grains; `TestCohortFeatureAdvertisedAfterProof` confirms the flag.
  - `cohort=` on the eleven accepting routes resolves and on `/facets`, `/entity`, `/conversation`, `/content`, `/baselines`, `/schema` returns 400 `cohort_invalid`/`route_not_supported` (`TestAnalyticsCohortRouteAcceptance`). No-cohort requests keep their prior shapes (existing regressions).
  - `TestCohortInvariantFrozenScope` reproduces each `/entities?grain=g` population from the same include/exclude on a two-harness/`(mixed)`-model fixture for session, artifact, plan, execution and time. `TestCohortInvariantScopeExcludeDiffersFromOp` separates `scope.exclude` from `op=exclude`. `TestCohortInvariantSessionPartition` proves `cohort_n(include)+cohort_n(exclude)=scope_n`. `TestCohortInvariantAssociations` proves the rejection association identity and the `selected`/`dropped` treatments on `/query`, `/series`, `/summary`, `/explore`, `/activity` and time `/entities`.
  - Plan/execution entity lists, detail collections, shared-session cost overlap and paging cursors pass their focused suites; the formerly time-dependent activity tests are deterministic and the probe counts a late arrival without fetching rows.
- Integrated check on the closing tree: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → store `ok` 6.968s, serve `ok` 29.502s; `git diff --check` clean. No live deploy, production data, credentials, secrets or migrations were used.
- `artifact_feedback` on every Phase 6 brief and report returned delivered / screen pass (`jev-1.13.0`), no flagged checks.

Carried

- `gate: the external Pages automation must accept ./web as its output directory (carried from Phase 1; verified only in Phase 13).`
- `gate: real-ledger p95 evidence needs YAKKA_BENCH_DIR and owner data (carried from Phase 3; fixture bench is the gate).`
- The `content` grain has no `/entities` listing route, so invariant 4's frozen-scope equality is proved through `/scores` and not exercised against `/entities?grain=content`; a later bounded-query review should confirm the content source population stays equal if a content listing is ever added.
- `/scores` and `/score-series` expose one top-level `content_hash` population rather than one per check; `content_hash` unit holds, but per-check placement is owed if a consumer reads multiple checks from one response.
- Legacy `exclude=<name>:<value>` cuts at the first colon, so it cannot name `band:<check>`; include is proved and the structured cohort `scope.exclude` accepts it. Phase 10's board chips must use the structured path for that lens.
- The schema enumeration expands the dynamic `<check>`/`<kind>` families through one design check and the design kind; the resolver path is identical for other family members, so the proof is representative rather than exhaustive over the catalogue.

## Phase 6 (earlier run) — Plan and execution entities and the cohort predicate

Refinement commit: `c85e5b9` (`docs: refine Phase 6 analytics work`). Four sequential units; plan/execution entity rows, cohort resolution, target-route application, then time cohorts/activity and schema publication. The signed contract in CONTRACTS.md 17.3 supplies the implementation boundaries. `artifact_feedback` on all four briefs returned delivered / screen pass (`jev-1.13.0`). Phase 5 carried items remain outside this phase: artifact file-to-time-bucket assignment and score-lens memory-growth evidence.

Phase outcome is open for implementation approach, so this run uses the signed outcome as the fixed yardstick. No new grain, join, route, dependency, gesture, or contract is authorized.

### `6-01-plan-execution-entities.md`

- Outcome: committed as `2daf7c6` (`Add plan and execution analytics entities`); added plan/execution list grains and plan detail collections, shared-session cost coverage, process shapes, and schema metadata. Plan 21/22/23 features remain absent.
- Surfaces: `packages/yakka/internal/store/plan_entities.go`, `packages/yakka/internal/serve/analytics_entities.go`, focused store/serve tests and `reports/6-01-plan-execution-entities.md`.
- Deviations / unfinished: report status is done with concerns. It identifies missing plan `artifacts` by kind and `design_score:<check>`, execution `brief_score:<check>` and `report_score:<check>`, incomplete plan lenses and sort fields, missing receive-watermark/revision pinning, and limited order/cursor fixture coverage. These are required by CONTRACTS.md 17.3 and block phase verification; follow-up brief 6-01b is added before cohort work.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Entity|Execution|Plan|SessionTimeEntitiesAndExclusions)' -count=1` passed; full `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 6.970s; serve 25.565s); `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags. The unit commit had a premature phase trailer; it was removed by amending the local commit before any push.

### `6-01b-plan-execution-completion.md`

- Outcome: committed as `ad66bfe` (`Complete plan execution entity measures`); added plan artifact-by-kind counts, design scores, plan/execution model/harness lenses, and execution brief/report scores.
- Surfaces: existing plan/execution store and entity handlers, fixture tests, and `reports/6-01b-plan-execution-completion.md`.
- Deviations / unfinished: report remains done with concerns. Plan sort coverage, first-page receive-watermark pinning, detail execution/event tie coverage, and `/schema` measure/lens alignment remain incomplete. Follow-up brief 6-01c covers only those seams before cohorts.
- Verification: focused and full `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve` suites and `git diff --check` passed as recorded in the report. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `6-01c-plan-execution-paging-schema.md`

- Outcome: committed as `82e1137` (`Harden plan and execution paging`); plan/execution cursors now pin receive watermark, rowid and score revision, detail cursors preserve the resolved window and required deterministic orders, and schema declarations match the entity fields.
- Surfaces: plan/execution cursor handlers and store reads, schema declarations and focused fixture tests.
- Deviations / unfinished: report identifies missing keyset sort for `artifacts:<kind>`, `design_score:<check>`, `associated_cost_usd`, `unpriced_calls`, and `complete_share`. Follow-up brief 6-01d closes these signed measure sorts.
- Verification: focused and full bounded store/serve suites plus `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `6-01d-derived-plan-sort.md`

- Outcome: committed as `2e59ea2` (`Sort plans by derived measures`), after brief ownership amendment `2525382`; keyset sort now supports every signed plan measure, validates dynamic kind/check values, sorts nulls last and ties by full identity. `/schema` advertises all implemented sort dimensions.
- Surfaces: plan sort parsing and SQL in `analytics_entities.go` / `plan_entities.go`, existing schema declaration, and focused fixtures.
- Deviations: none. No contract changed.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'AnalyticsPlan' -count=1` and full bounded store/serve suites passed; `git diff --check` passed. `artifact_feedback` on the amended brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `6-02-cohort-predicates-and-resolution.md`

- Outcome: committed as `147d1f0` (`Add bounded cohort parsing and source resolution`); added canonical bounded predicate parsing and parameterized positive-source SQLite subqueries for session, artifact, execution and plan. Source subtraction retains positive-set semantics. Cohort capabilities remain unpublished.
- Surfaces: `packages/yakka/internal/serve/` cohort parser, `packages/yakka/internal/store/` source resolver, and focused fixture tests.
- Deviations / unfinished: report status is done with concerns. Source-specific derived fields/lenses and derivation revisions are incomplete. Contracts 17.3 does not define the shape/semantics of `scope.include` and `scope.exclude`, nor how content source predicates select kind/check; those are recorded as gates. Do not invent those fields or advertise unsupported cohort paths.
- Verification: the required command passed but initially selected no tests; new fixtures then covered canonicalization, malformed definitions, positive exclusion and four source subqueries. `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `6-03-cohort-target-integration.md`

- Outcome: committed as `755fb65` (`Apply resolved cohorts to analytics filters`); shared filter parsing resolves the cohort once and passes the parameterized positive session predicate through existing fact and rejection reads. Exclusion subtracts the resolved set. Rollups that cannot preserve cohort membership are bypassed; no capability flag is published.
- Surfaces: shared analytics filter parsing and store query/read paths, plus route regression tests.
- Deviations / unfinished: report status is done with concerns. Non-entity response shapes do not yet gain typed population metadata. Undefined scope filter elements, content source selection and unsupported derived/time predicates remain gates from 6-02/6-04. The unit commit carried a premature phase trailer; it was removed by amending locally before any push.
- Verification: the new `/query` red/green test proves one-session inclusion and positive-set exclusion; the required bounded analytics route check and `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `6-04-time-cohorts-and-activity.md`

- Outcome: committed as `e960fa7` (`Add analytics activity feed and time cohort resolver`); added fixture-backed time-source resolution and the authenticated activity list/probe. Activity publishes in `/schema`; cohort remains unpublished.
- Surfaces: activity route/store reads, time resolver, schema and focused tests.
- Deviations / unfinished: report status is done with concerns. Time source currently supports only some contributor types, uses UTC rather than the frozen requested timezone, and lacks deduplicated usage identities plus rejection missing/orphan counts. These are required by CONTRACTS.md 17.3; brief 6-04b closes them. Activity reports unsupported shared filters through `ignored_filters` as specified; its compatibility with each consumer is included in phase verification.
- Verification: focused `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Activity|Cohort|Entity)' -count=1` and `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### `6-04b-time-cohort-completion.md`

- Outcome: committed as `e50d5bc` (`Complete time cohort contributor resolution`); the time resolver now replays the frozen calendar unit, step and timezone, including DST and multi-year buckets, and adds deduplicated usage contributors with recorded-session-only rejection membership.
- Surfaces: time cohort store resolver and focused store/serve fixtures.
- Deviations / unfinished: report remains done with concerns. It cannot expose separate missing/orphan rejection counts without a defined response mapping, and non-empty source scope include/exclude lists remain unsupported because their element semantics are unspecified. Cohort remains unpublished.
- Verification: focused and full bounded store/serve suites passed (store 6.916s, serve 25.562s); `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`), no flags.

### Phase 6 integrated verification — unsuccessful, not closed

- Entry point checks: fixture-backed `/schema` and `/entities` cover plan/execution; `/activity` list/probe pages equal-time identities and reports receive-watermark arrivals; `/query` proves positive cohort inclusion and subtraction. Time-cohort fixtures cover deduplicated usage and timezone boundaries. Activity is published; cohort remains unpublished.
- Final integrated check on this tree: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 6.977s; serve 25.459s). `git diff --check` is run before recording. No live deploy, production data, credentials, secrets, or migrations were used.
- The signed Phase 6 outcome is not met: scope include/exclude source element semantics and a response mapping for separate missing/orphan rejection association counts remain unresolved, several cohort source predicates are explicitly unsupported, and cross-grain cohort relation/typed population reporting is incomplete. The cohort capability is not advertised. No closing trailer is recorded.

Carried

- gate: Cody define the element shape and semantics of `scope.include` and `scope.exclude` in a cohort definition before non-empty frozen source filters can be supported.
- gate: Cody confirm the existing `relation` / `missing_by_reason` response mapping for separate missing and orphan rejection associations, or define the required response placement before cohort publication.
- gate: implement and verify remaining cohort source measures/lenses, target-route typed population/relation reporting and activity rejection/filter behavior before the Phase 6 outcome can close.

### Phase 6 retry — unsuccessful, not closed

- Run: Codex execute retry on `feat/20-analytics-reset`, 2026-11-08 Australia/Brisbane. The worktree began clean at `0d8097e`; no implementation scope or contract was changed during this retry.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.562s; serve 26.797s); `git diff --check` passed. `artifact_feedback` on all eight Phase 6 briefs and eight reports returned delivered / screen pass (`jev-1.13.0`), with no flags.
- Outcome remains unmet: the contract does not define non-empty `scope.include` / `scope.exclude` elements or a response location for separate missing/orphan rejection counts. Target responses also lack required typed cohort population and relation/expansion metadata; unsupported source predicates and activity filter coverage are not fully verified. Cohort capability remains unpublished. No closing trailer is recorded.

Carried

- gate: Cody define the element grammar and semantics for frozen cohort `scope.include` and `scope.exclude`.
- gate: Cody confirm where separate missing/orphan rejection association counts belong within the existing `relation` / `missing_by_reason` response contract.
- gate: implement remaining supported cohort source measures/lenses, typed target population and relation/expansion reporting, and verify activity rejection/filter coverage before publishing cohort capability or closing Phase 6.

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 3 execution
Start time: 2026-11-08 09:10 Australia/Brisbane (2026-11-07 23:10 UTC)

Previous run: feat/20-analytics-reset phase 1 execution, started 2026-11-08 04:48 Australia/Brisbane (2026-11-07 18:48 UTC).

## Phase 1 — Reset and shell

Refinement commit: `d570de6` (`docs: refine Plan 20 Phase 1 briefs`). It records three units and their dependencies in `DESIGN.md` and adds the three dispatchable briefs. The fixture and shell units are independent; release/serving depends on both. The first-design coarse check found the phase surfaces, contracts, observable outcomes and dependency order in place. `artifact_feedback` on each brief returned `delivered` / awaiting screen, with no rejection. No product work has landed yet.

### `1-02-framework-free-shell.md`

- Outcome: committed as `505360a`; replaced SvelteKit with the static shell, URL codec, schema-driven transport, scheduler, theme bootstrap and vendored uPlot; added the test-only harness and package README.
- Surfaces: `packages/yakka-analytics/`.
- Verification: Node suite 13/13; `python3 tools/release/test_layout.py` 7/7; system Chrome confirmed deep-route shell rendering, fixture-summary probe, unknown-route fallback and verbatim legacy `range too wide` without retry. No animation/timing assertions.
- Deviations and carried items: Playwright-core is unavailable, so its Chromium acceptance remains outstanding. The worker left `wrangler.toml` unchanged per the brief although DESIGN/CONTRACTS specify `./web`; the release/serving unit must resolve this. Release embedding and headers remain unverified.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: provide Playwright-core in the phase test environment and run the Chromium shell harness.

### `1-01-fixture-ledger.md`

- Outcome: committed as `2b4d2c3a7a0c3690982e7131d9fae7fbe2744ee2`; added the non-shipping deterministic ledger generator and manifest covering the populations, relations, chronology and resource boundaries in the brief.
- Surfaces: `packages/yakka/internal/analyticsfixture/`.
- Verification: `GOMEMLIMIT=8GiB go test ./internal/analyticsfixture -count=1 -v` passed; generated-ledger assertions cover exact manifest counts, timestamp bounds, shared bodies, scorer-specific scores, session repo cardinalities, three execution shapes, rejection stages and the unpriced tail. Candidate comparison selected batch append: same 5,015-event oracle, 196 ms versus 11.855 s for single-row append.
- Deviations and carried items: none. The 32,767-hash fixture takes about 187 seconds to generate and verify; later tests should construct it once per setup and reuse it.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).

### `1-03-release-and-serving.md`

- Outcome: committed as `aacab5eb85827459043a7a2a13f92837fbec251e`; release embeds the framework-free `web/` tree without Node/npm, restores the placeholder on success/failure, and serves generic cache/security policy with ETag revalidation. Pages output is `./web`.
- Surfaces: `tools/release/`, `packages/yakka/internal/serve/site.go`, `packages/yakka/internal/serve/site_test.go`, `packages/yakka-analytics/wrangler.toml`, `.dockerignore`, `docs/design/07-analytics-site.md`, `docs/design/system-architecture.md`, and `docs/plans/20-analytics-reset/CONTRACTS.md`.
- Verification: release suite 11/11 with an isolated PATH lacking Node/npm; `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSite' -count=1` passed; Node shell suite 13/13; layout checks 7/7; `git diff --check` passed. Builds embed the app/uPlot but exclude `_headers`; placeholder restoration is checked for success and failure.
- Deviations and carried items: the brief's `./build` instruction conflicted with the signed design/contract; `./web` was applied. `GOTOOLCHAIN=auto` is needed for the release build because the installed local Go version is older than the module's declared version. The full-server OAuth API handler shadows the UI callback path in local mode; route integration remains for Phase 2, as stated in the updated contract.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: verify the external Pages automation accepts `./web` as its output directory.

### Phase 1 verification and closure

- Entry point → action → result: the committed test harness serves `/__test/fixture-summary-probe` from the embedded manifest; shell tests observe the summary, uncapped URL round-trip, legacy limit message without automatic retry, request deduplication/abort/four-request cap, and unknown-route fallback. The built Go site serves direct client routes with the committed app, generic cache/security headers and correct ETags; the release harness confirms no-Node embedding and placeholder restoration.
- Final checks on the integrated branch: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/analyticsfixture -count=1` passed (306.215 s); `GOMAXPROCS=3 python3 -m unittest tools.release.test_release` passed (11); `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs` passed (13); `python3 tools/release/test_layout.py` passed (7); `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSite' -count=1` passed. No animation or timing tests were used.
- Playwright-core is unavailable in this worktree, so the Playwright Chromium harness was not run; system Chrome smoke evidence is recorded in the shell report.

Carried

- Playwright-core browser harness run when available.
- Verify the external Pages automation accepts `./web` as its output directory.
- Phase 2 reconcile the local full-server `/oauth/callback` route collision while preserving the remote API callback.
- Reuse the 32,767-hash fixture once per test setup; its generation and verification take about 187 seconds.

## Phase 2 — Identity flows

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 2 execution
Start time: 2026-11-08 05:42 Australia/Brisbane (2026-11-07 19:42 UTC)

Inline refinement: Phase 2 is one unit. The brief `2-01-identity-flows.md` is committed before implementation and covers the session gate, account routes, device login, credential handling and local/remote OAuth callback routing under CONTRACTS.md. The Phase 1 carried callback collision is included in the route seam. `artifact_feedback` pending for the brief.
`artifact_feedback` on the inline brief returned `not delivered`: the service has no version and nothing is queued, even after retrying with an absolute path. Recorded; proceed with local contract verification.

### `2-01-identity-flows.md`

- Outcome: committed in the phase-closing commit; added safe return-path and session-gate contracts, credential-aware account requests, and Login, OAuth callback, Device, Profile and Settings UI flows. Local `/oauth/callback` serves the shell; remote collector mode retains the JSON callback API.
- Surfaces: `packages/yakka-analytics/web/contract/`, `web/js/identity/`, `web/js/app.js`, `packages/yakka/internal/serve/serve.go`, focused tests.
- Deviations: none identified against the brief or CONTRACTS.md. No Plan 21/22/23 capability was invented.
- Unit evidence: report `reports/2-01-identity-flows.md`; `artifact_feedback` on the report and brief both returned delivered / screen pass (`jev-1.13.0`). Worker-reported checks: Node identity/static-shell/scheduler 12 passed; focused Go callback routing passed; syntax checks passed.

### Phase 2 verification and closure

- Entry point → action → result: `GET /oauth/callback?code=x&state=y` through `Server.Handler()` returns the embedded static shell in local mode and the JSON callback handler's unauthorized response in remote mode. Focused browser-contract tests cover safe callback targets, sign-in returns, the session gate, tenant recovery, auth headers and normalized device approval fields. The Chromium UI smoke could not run because `playwright`, `@playwright/test`, `playwright-core` and Vitest are absent, and the installed Chromium Snap wrapper fails to start (`snap-confine` missing `cap_dac_override`).
- Independent checks: `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/identity/contracts.test.mjs packages/yakka-analytics/tests/static-shell.test.mjs packages/yakka-analytics/tests/request-scheduler.test.mjs` passed 12/12; `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely|TestSiteHandlerDirectCallbackFallback' -count=1` passed. No animation/timing tests or live systems were used.
- `artifact_feedback`: report and brief delivered / screen pass (`jev-1.13.0`).
- gate: provide a working Playwright/Chromium harness and verify the Pages-faithful callback, device approval, profile/token and Settings flows end to end.

Carried

- Playwright browser acceptance for the complete identity flow; runner/browser unavailable in this worktree.
- Verify that external Pages automation accepts `./web` as its output directory (Phase 13).
- Reuse the 32,767-hash fixture once per test setup; its generation and verification take about 187 seconds (Phase 3).

## Phase 3 — Bounded range reads

Refinement commit: `d46453e883a962681e5349286c4d96c3b689b651`; four sequential units. The 32,767-hash fixture reuse was assigned to 3-02. Identity browser acceptance and the external Pages output check were bounced as unrelated to Phase 3. Before closing, runner `artifact_feedback` on all four briefs and reports returned delivered / screen pass (`jev-1.13.0`), with no flagged checks.

### `3-01-range-resolution.md`

- Outcome: committed as `95e8c13`; removed shared width rejection, accepted `all=1` from the signed nanosecond minimum, added explicit time-bound errors, and added `/query` auto-range metadata and cell/series budget errors.
- Surfaces: `packages/yakka/internal/serve/analytics.go`, `analytics_query.go`, their focused tests, `CONTRACTS.md`, and `docs/design/03-remote-service.md`.
- Deviations and carried work: route-side only; year and multi-year grouping/auto retry and pre-slice cell planning remain for 3-02. Full serve tests identify two stale expectations outside this unit's ownership: `TestDistributionRangeTooWide` and `TestScoreSeriesRangeTooWide` still require legacy 400s.
- Verification: focused `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestAnalytics(Query|Schema|Outcome)' -count=1` passed; full serve suite failed only those two stale expectations. `git diff --check` passed. Before/after regression evidence and the candidate comparison are in `reports/3-01-range-resolution.md`.

### `3-02-bounded-aggregation.md`

- Outcome: committed as `f415d72`; usage, distribution and score-series scanned-row aggregation now runs in SQLite, including exact percentile/rank logic and a 32,767-hash score-series join. Internal year and multi-year bucket expressions were added without changing the legacy public bucket list.
- Surfaces: owned aggregate store paths (`usage.go`, `query.go`, `distribution.go`, `score_series.go`, and rollup files/tests).
- Deviations and carried work: no heap-growth measurement was recorded; the SQL shape removes input-row collections but allocation independence still needs direct evidence. Serve integration must connect auto retry to internal year buckets and executable suggestions. The two stale serve assertions remain to update in the serving unit. The 14-turn budget was exceeded.
- Verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store -count=1` passed, including 32,767 distinct scored hashes; focused store checks and `git diff --check` passed. Full report and candidate comparison: `reports/3-02-bounded-aggregation.md`.

### `3-03-paged-reads-and-coverage.md`

- Outcome: committed as `b49316f`; `/series` uses the requested IANA timezone for daily and Monday-start weekly buckets, conversation usage events expose pricing, and conversation/distribution/score-series report compaction coverage. The two stale wide-window expectations now accept successful responses.
- Surfaces: owned conversation/distribution/score-series handlers, store conversation/analytics paths and corresponding tests.
- Deviations and carried work at unit landing: `/explore` keyset traversal with receive watermark, explore-event `priced`, and route-wide partial metadata were left for 3-04 because the shared handler was outside this brief's owned paths. Unit 3-04 completed those items; the final 20,005-row traversal proof is recorded in `reports/3-04-runner-note.md`.
- Verification: before, the two stale wide-window tests failed with 400-vs-200. After, `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed; `git diff --check` passed.

### `3-04-runtime-bounds-and-benchmark.md`

- Outcome: committed as `492fc80`; added a one-second measured query deadline, driver cancellation and reader-release behavior, a four-request tenant heavy-read bound, `/explore` keyset traversal with first-page watermarks and `priced`, auto year-step retries, executable overflow suggestions, and route-wide partial reasons. The fixture benchmark now covers all-time and auto.
- Surfaces: `serve/{analytics.go,analytics_query.go,analytics_score_series.go,serve.go}` and focused analytics tests/benchmark; `store/{analytics.go,analytics_test.go}` for keyset page/watermark queries.
- Deviations and carried work: the brief's original path list omitted handler and store paths needed by its fixed outcome; it has been amended to record the clarified implementation ownership. Usage/distribution allocation comparisons were added in the runner follow-up; ScoreSeries has no cross-size allocation comparison. The optional real-corpus benchmark needs owner-provided data.
- Verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed; cancellation/deadline and heavy-read concurrency tests passed; fixture benchmark completed 2,647 cases (max observed p95 4.4 ms, all-time/auto max p95 4.1 ms) against the 500 ms target; `git diff --check` passed. Full evidence/candidate comparison is in `reports/3-04-runtime-bounds-and-benchmark.md`.

### Phase 3 verification and closure

- Entry point → action → result: `/v1/analytics/query` accepts all-history and ten-year ranges without changing requested bounds, coarsens the calendar resolution under cell pressure, and returns a documented budget error rather than clipped rows. `/v1/analytics/explore` pages a 20,005-row equal-time fixture in 20,000 + 5 rows with distinct keys and no omissions; route-level tests confirm cursor round-trips. Timezone, pricing and partial-coverage fields match fixtures. Runtime tests observe query deadline interruption, reader reuse, no partial response and tenant concurrency rejection.
- Independent integrated verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed after the histogram and 20,005-row cursor follow-ups (store 7.349s; serve 24.905s). Allocation-growth tests passed for usage and distribution at 16× input rows. `git diff --check` passed.

Runner note: the first allocation-growth check found distribution histogram binning scanned every SQLite sample into Go. A follow-up change moved bin counts into SQL and added 16x input-size allocation comparisons for usage and distribution (128 vs. 2,048 rows); both passed. ScoreSeries retains only result buckets and its 32,767-hash regression passes, but a cross-size Go allocation comparison is not recorded. See `reports/3-04-runner-note.md`.

Carried

- Usage and distribution allocation comparisons passed at a 16× scanned-row increase (usage 3,288 → 3,288 bytes; distribution 21,360 → 21,856 bytes). ScoreSeries succeeds with 32,767 distinct hashes and retains only bounded result buckets, but no cross-size allocation comparison was recorded; the peak-retention claim for that path remains based on its streaming SQL-temp-table implementation shape.
- Run the analytics benchmark against an owner-provided real ledger via `YAKKA_BENCH_DIR` for additional corpus evidence.
- Playwright browser acceptance for Phase 2 identity flows remains outstanding (carried from Phase 2; not a Phase 3 blocker).
- Verify the external Pages automation accepts `./web` as its output directory (release readiness).

## Phase 4 — Capability schema and session grain

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 4 execution
Start time: 2026-11-08 06:56 Australia/Brisbane (2026-11-07 20:56 UTC)

Inline refinement: Phase 4 is one server unit. Brief `4-01-capability-schema-and-session-grain.md` fixes the signed outcome, bounds the open implementation choice to session attribute derivation under the Phase 3 budgets, and explicitly excludes later-phase capabilities and any new grain/join/route/dependency/contract. Committed before dispatch as `bc74c12`. Runner `artifact_feedback` returned delivered / screen pass (`jev-1.13.0`); the initial relative-path call resolved against the plugin cache, so the absolute worktree path was used.

The worker identified two omitted integration seams in the first brief: route registration for the signed `/analytics/entities` route and parsing/application of the signed shared `exclude` filter. Brief amendment `ad42d3b` adds `serve.go` and `analytics.go` for those existing semantics only; it adds no route/filter behavior.

### `4-01-capability-schema-and-session-grain.md`

- Outcome: committed as `b9c9ca0`; added `/schema` Phase 4 metadata, session/time entity handlers and store reads, lifetime-derived session provenance, deterministic scatter/marginals, time aggregation, typed population metadata and shared exclusions.
- Surfaces: `serve/{analytics.go,analytics_entities.go,analytics_query.go,serve.go}`, `store/{analytics.go,query.go,session_entities.go,usage.go}`, focused tests and `docs/design/03-remote-service.md`.
- Deviations / unfinished: report `reports/4-01-capability-schema-and-session-grain.md` marks done with concerns. Session numeric filtering, session aggregate mode, and pending/scored-total/revision coverage are missing. The report's commit placeholder is malformed; runner records the actual commit here (`b9c9ca0`). Unit test command passed: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` (store 6.7s, serve 23.9s); `git diff --check` passed. Report `artifact_feedback`: delivered / screen pass (`jev-1.13.0`).

The fixed Phase 4 outcome is not yet verified or closed. Follow-up brief `4-02-session-outcome-remediation.md` covers only the three reported omissions, without changing the contract; it is committed before dispatch.

### Independent Phase 4 verification finding

Runner added `TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals` for a 5,005-session fixture. The baseline failed: deterministic sample metadata was correct, but both token marginals summed to 0 rather than the whole 5,005-session population because no-call sessions had no histogram bins. This is a Phase 4 outcome defect, not a contract change. Brief `4-03-zero-call-scatter-marginals.md` scopes the fix and regression assertion; Phase 4 remains open.

### `4-02-session-outcome-remediation.md`

- Outcome: committed as `dd66a06`; implemented numeric session `where` filtering, SQL-backed count/sum/percentiles/histogram aggregate modes, typed missing population for unpriced cost, pending and per-kind scored/total coverage, and explicit unavailable revision metadata.
- Deviations / carried: session aggregate dimensions are not supported and are advertised as an empty set; pricing/catalogue/tool-kind revision identifiers have no stable local sources and are null with reasons. `reports/4-02-session-outcome-remediation.md` records both. Verification command passed in the report. Report `artifact_feedback`: delivered / screen pass (`jev-1.13.0`).

### `4-03-zero-call-scatter-marginals.md`

- Outcome: committed as `839d1de`; included the runner's 5,005-session regression and adds no-call sessions to zero-value token/cost marginal bins while retaining all-unpriced cost exclusion. Focused and full bounded store/serve tests passed as recorded in `reports/4-03-zero-call-scatter-marginals.md`. Report `artifact_feedback`: delivered / screen pass (`jev-1.13.0`).

### Phase 4 verification and closure

- Entry point → action → result: `GET /v1/analytics/schema` returns the published session/time grains, modes, measures, budgets, null/time rules, typed coverage and only Phase 1–4 feature flags; HTTP assertions prove artifact/content/plan/execution/activity/cohort/action/review flags are absent. `GET /v1/analytics/entities` against fixtures lists and sorts sessions, returns lifetime-stable repo/model/harness provenance, applies numeric `where` and shared exclusions, serves session count/sum/percentile/histogram aggregates, and returns time measures on one shared day grid. HTTP checks prove no-call zero cost, all-unpriced null cost, partial lower-bound marking, single/multi/none repo groups, unknown/mixed model groups, filtered population counts and matching legacy count totals. A 5,005-session request returns the same deterministic 5,000-point sample twice and token/cost marginal counts over all 5,005 sessions.
- Independent integrated verification on this closing tree: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 8.026s; serve 27.913s); `git diff --check` passed. The separate zero-call scatter assertion first failed (empty marginal totals), then passed after `839d1de`. No animation/timing tests, live systems, production data or secrets were used.
- Before closure, `artifact_feedback` on `4-01`, `4-02`, and `4-03` briefs and reports all returned delivered / screen pass (`jev-1.13.0`); no checks were flagged.
- Runner note: `reports/4-runner-note.md` records the first report's commit placeholder, remediation history, initial scatter failure, independent assertions and artifact feedback.

Carried

- `/schema` reports null pricing, catalogue, and tool-kind revision identifiers with reasons because stable local IDs do not exist; populate them only when a source is added to the existing contract. gate: provide stable local revision identifiers for pricing, catalogue, and tool-kind if non-null revision values are required.
- Session aggregate dimensions remain unsupported; `/schema` explicitly advertises none, and requests for `dim` return a named error. The signed Phase 4 outcome is satisfied by the implemented scalar aggregate modes; any future grouped session aggregate capability must be reconciled against the existing schema contract before being offered.

## Phase 5 — Artifact entities, scores by lens, content

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 5 execution
Start time: 2026-11-08T07:51+10:00

Refinement commit: `d23bf4693bab93a79e32096cb830fbd301037341`; three sequential units. `artifact_feedback` on the briefs returned `not delivered` because the service had no version and nothing queued. Proceed verdict; no contract gaps identified.

### `5-01-artifact-entities.md`

- Outcome: closed after retry. `e3b48c8` added artifact identity/history and writing-session attribution; `f2a497d` amended the brief with uncovered signed requirements; `108d37e` added aggregate dimensions, bounded Boolean predicates, score/content numeric filters, nullable cursor paging, typed whole-population coverage and cell budget enforcement. `/entity` registration uses the already specified Phase 5 route. `/schema` capability remains unpublished until score/content integration is complete.
- Surfaces: `packages/yakka/internal/{serve,store}/` artifact entity paths and tests; Phase 5 brief and report.
- Deviations and carried: `bucket` on artifact aggregate is rejected and unadvertised because the design does not assign a version timestamp to a file spanning buckets; cohorts remain Phase 6. Aggregate exact sorting/statistics materializes enriched rows under the existing deadline, with no invented population truncation. 5-02 owns score-name catalogue validation, scorer/band lenses, baseline semantics, writing-session measures, and derived harness/model filters.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.470s; serve 25.989s); `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run TestArtifact -count=1` passed. `artifact_feedback` on the amended brief and report returned delivered / screen pass (`jev-1.13.0`).

### `5-02-scores-by-lens.md`

- Outcome: committed as `97ef99e`; added canonical hash observation and scorer-aware score and score-series lenses, content-hash baselines, and the declared distribution harness/session-model/session-repo lenses while preserving legacy defaults. `/schema.features.scores_by_lens` reflects the implementation.
- Surfaces: score/baseline/distribution handlers and store reads under `packages/yakka/internal/{serve,store}/`, focused tests and the report.
- Deviations and carried: exact score aggregation retains observations in memory as the legacy path does, under request context; group pages are bounded and no data is silently truncated. The artifact aggregate bucket ambiguity remains from 5-01.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 8.128s; serve 27.535s); `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`).

### Runner verification finding after `5-03-artifact-content.md`

The integrated store/serve tests passed, but `TestAnalyticsSchema` confirmed `entities_artifact` remains absent and the artifact row path does not return `band:<check>` or the contract's writing-session measures. Those are explicit Phase 5 §17.2/17.3 requirements. Added a focused integration unit 5-04 before closure; its brief is `briefs/5-04-artifact-schema-and-bands.md`.

### `5-03-artifact-content.md`

- Outcome: committed as `e5fcb50`; added the tenant-bound exact-version content route with complete-byte hash verification, read-scope/session authorization, size refusal, no-partial reads and explicit screening/missing states. `/schema` advertises `artifact_content` with its limit only alongside the route.
- Surfaces: `packages/yakka/internal/{serve,store}/` content path, auth/route registration, focused tests and remote-service documentation.
- Deviations and carried: none for the unit. The artifact time-bucket question remains separate and does not affect exact-version content.
- Verification: bounded store/serve tests passed (store 7.025s; serve 25.068s); focused content tests passed after the final refinement. `artifact_feedback` on the report and brief returned delivered / screen pass (`jev-1.13.0`).

### `5-04-artifact-schema-and-bands.md`

- Outcome: committed as `13a3a7e`; `/schema` now advertises the implemented artifact grain and `entities_artifact`; artifact rows expose scorer-specific bands and selected writer cost/call/token/hook measures; derived harness/model filtering follows lifetime writer selection. Design-only Phase 6 flags remain absent.
- Surfaces: schema and artifact population serving under `packages/yakka/internal/serve/`, bounded session aggregation, focused fixture tests and remote-service documentation.
- Deviations and carried: no contract changes. Artifact bucket grouping remains rejected and absent from advertised modes because no file-to-time-bucket timestamp rule exists. Score lens aggregation retains observations in memory under the request deadline; a cross-size memory-growth proof is not recorded.
- Verification: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.299s; serve 26.032s); focused artifact/schema tests and `git diff --check` passed. `artifact_feedback` on the brief and report returned delivered / screen pass (`jev-1.13.0`).

### Phase 5 verification and closure

- Entry point → action → result: fixture-backed HTTP tests exercise `/v1/analytics/schema`, artifact `/entities` and `/entity`, score and score-series lenses, content baselines, distribution lenses, and `/content`. The schema now reports artifact entities, scorer lenses and content with budgets, while plan/execution/cohort/activity/actions/reviews stay absent. Artifact fixtures prove file identity versus shared hash identity, lifetime selected-version and writer attribution, version paging, score/scorer/band behavior, grouped populations and missing coverage, windowed writer measures, and exact content authorization/integrity/refusal states.
- Integrated verification on the closing tree: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.495s; serve 26.640s); `git diff --check` passed. No animation/timing tests, live service, production data, credentials, deployment or migrations were used.
- Runner `artifact_feedback` on every Phase 5 brief and report returned delivered / screen pass (`jev-1.13.0`); no checks were flagged.

Carried

- `gate: Cody define the artifact file-to-time-bucket assignment in the design before artifact bucket grouping can be implemented or advertised.`
- Score lens exact aggregation retains observations in memory under request deadlines; no cross-size memory-growth proof is recorded. A later bounded-query review should measure or replace that retention without changing the signed population semantics.

## Follow-up fixes on the open branch

Phases 1–5 stay closed. These three review bugs are fixed on the same branch; phases 6–13 are not started. The workspace shell still names later-phase destinations and does not render their panels.

### Issue 207 — ScoreSeries retained heap

UTC `ScoreSeries` now groups bucket membership in SQL and returns only the bounded check/bucket result. A non-UTC zone still labels buckets one row at a time because the label includes that zone's offset. `TestScoreSeriesGoHeapDoesNotScaleWithScannedRows` measured Go allocations of 2,936 bytes for 128 scored hashes and 2,456 bytes for 2,048, inside the same 16× tolerance used for usage and distribution.

### Issue 208 — all-time coverage

`all=1` on `/query` and time entities resolves the effective start from the route population's earliest retained timestamp before `bucket=auto` is chosen. Empty coverage returns null effective bounds and no rows. An explicit `from`/`to` still keeps its requested span, including the multi-century auto case. Populated recent commits resolve to an hour bucket with `clipped: before_first_data`.

### Issue 209 — session scatter marginals

Conversation-grain distribution histograms and the no-call count now apply the same session `where` predicate as the scatter points and `population_n`. A two-session fixture filtered to `tokens_out:0..100` reports marginal `n` of 1.

### `9-05-ops.md` — over budget handoff

- Done: `/ops` now mounts an `ops-footprint` panel over `/v1/admin/status`; the panel renders version, scoring, optional volume and per-tenant facts, compaction, footprint bytes/counts, screens (verdicts, scored content, score rows, rejections, total), recent failures at the server cap and rescore state, all with units and no cross-tenant sums; 403 is "administrator only", absent fields are named and read-only behaviour is preserved. Report: `reports/9-05-ops.md`.
- Not done: none for the unit. Phase 9 acceptance remains 9-06.
- Learned: the shared panel frame has no body renderer, so an explorer with a table must render its own body while reusing frame state/idle/basis; the registry cannot describe a table-only panel without a chart name; the committed stub's `adminStatus()` is minimal, so full-shape browser proof needs an intercepted status response until the harness owner extends it.
- Gates: extend the workspace stub/fixture status shape and add status error/delay scenes; give the registry a table-only representation. Both are outside this brief's owned paths.
- Budget: 885 changed lines and more than 12 files read, against ~500 lines and 12 files. The overrun is the table renderer plus the pure and Chromium checks. No scope was added.
