# Handoff — phase2-07 Scatter panels

Status: done with concerns. Branch `feat/30-analytics-operable-chrome`.

## What changed

- `scatter-session.js`, `scatter-artifact.js`, `scatter-plan.js`, `scatter-day.js`: registered the four literal G captions and selected them by `spec.scope.captionKey`; every alternate caption goes through the controlled scatter template. Added the exact F refusal before and after each entity read, with the P6/P5 role keys stripped from the effective scope first.
- `scatter-shared.js`: added the G defaults (`SCATTER_DEFAULTS`), `resolveScatterFields`, per-panel applies, controlled labels/units, the P10 table columns, the score unit (`normalized score 0–1`, never a percentage), and the one-row-per-axis marginal table (`Axis, From, To, Count, Missing count`, X then Y, bin lower edge ascending). Marginals remain whole-population.
- P6 chooser is now X axis / Y axis / Size (None then numeric) / Colour (None then categorical) only. The artifact chooser adds P5 Check and Scorer and no Kind selector. There is no Chart selector.
- Each panel now uses `mountPanelViews` for the local chart/table toggle, moves basis/caveat text into a closed `Data details`, sorts the identity table ascending, and marks incomplete day buckets with `· incomplete` instead of zero-filling.
- Artifact P5: single-kind refusal, catalogue check (default clarity), content baseline, first lexical scorer with a positive baseline (else first lexical), and `check`/`scorer` on the entities request.
- `scatter.css`: production chart minimum 160px, marginal strips laid out in a responsive row, one shared marginal table; stale per-strip table CSS removed.
- Tests: new `tests/operable-chrome/scatter-captions-unit.test.mjs`; updated `tests/scatter-sessions/scatter.test.mjs` for the new captions, table/column order, marginal table and day incomplete marking.

## Evidence before and after

Before the change the named unit test did not exist and the old browser test asserted the pre-G DOM; the three-file command reported 26 passing tests (the missing unit file was silently ignored). After:

```
cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node --test tests/operable-chrome/scatter-captions-unit.test.mjs \
            tests/scatter-sessions/scatter.test.mjs tests/scatter-sessions/artifact-plan.test.mjs
# tests 34  # pass 34  # fail 0
```

The unit file (8 tests) covers all four literal captions/keys, exact defaults, wire fields (`cost_usd,commits,unpriced_calls`; `associated_cost_usd,artifacts`; `cost_usd,commits`; artifact `writing_session_cost_usd,score:clarity` with `check`/`scorer`), P5 clarity/scorer and multi-kind refusal, numeric-only P6 intersections, whole-population marginals and the fixed table, table units/identity order, the normalized score unit, and exact singular/plural F refusals with zero entity reads.

Browser evidence at 1440×900: DOM order `scatter-session, scatter-artifact, scatter-plan, scatter-day`; panel widths `704px` each; one caption above each chart; chart/table toggle local; visible table rows 30px; day headers `Identity, X (USD), Y (commits)`; unsupported `rejections` time pairing settles `unsupported` with no marks. Screenshot checked against `mockups/scatter.png` and `mockups/src/scatter.html`; text contracts win where they differ.

## Check IDs

| ID | Result | Evidence |
|---|---|---|
| G-sessionxy | pass | Literal caption/key; defaults X cost, Y commits, size unpriced calls, colour None; request fields and table `Identity, X (USD), Y (commits), Size (calls)`; whole-population marginal table. |
| G-artifactxy | pass | Literal non-causation caption; X writing-session USD, Y clarity, size None, colour None; P5 clarity/selected scorer; table Y unit `normalized score 0–1`; no percentage. |
| G-planxy | pass | Literal shared-cost caption; X associated USD, Y files, size None, colour repository; overlap/lower-bound text retained; identity ascending. |
| G-dayxy | pass | Literal bucket caption; X USD, Y commits, size/colour None; actual bucket labels; partial, price-missing and missing-axis buckets marked `· incomplete`, never zero-filled. |
| P5 | pass | Artifact only: Check + Scorer, catalogue default clarity, baseline scorer resolution, multi-kind refusal `Choose one document kind for this chart.` |
| P6 | pass | X/Y/Size/Colour only; numeric-only axes (no id/model); no Chart or Kind selector; role changes write `scope.x/y/size/colour` and reload only that panel. |
| P8 | pass | `mountPanelViews` chart default, local Show table/Show chart, closed Data details, no fetch on toggle. |
| P9 | pass | Existing rectangle→predicate→exact-count→tray path retained; browser test still proves session/artifact/plan/day selections and cohorts. |
| T1–T3, T5 | pass | Shared frame states retained; caption registered independently of state; F refusal renders before any read with no marks; existing 400 unsupported path still settles without stale marks. |
| T4 | n/a | Scatter sources are one bounded response, not paginated. |
| F1 | pass | Tables use canonical identity keys; no sampled identity expansion; exact predicates retained. |
| F2 | n/a | Distribution panels are outside this unit. |
| F3 | pass | Per-source applies declarations (`repo_id`/`session_repo` where the scatter source declares them); unsupported filter tests return the exact F sentence and zero reads. |
| F4 | pass | Schema/scorer labels come from the controlled dictionary; no metadata narrowing or fake options. |
| F5–F7 | n/a | Exact-entity, operations and account screens are outside this unit. |
| S-scatter | pass | Two 704px columns, session/artifact then plan/day, captions above chart/table, marginals beside their axes, 30px visible rows, chart minimum 160px. |

Report rubric: `r.done_verifiable` pass (commands/evidence above); `r.departures_named` pass (below); `r.unfinished_actionable` pass (below); `r.problems_plain` pass; `r.nothing_unusable` pass.

## Departures and contradictions

- **Contradiction:** `p11-scatter.js` presets `colour=session_model` for session and artifact, while G-sessionxy/G-artifactxy say colour default None (the mockup also shows Session model). `p11-scatter.js` is not in this unit's owned paths. The panels implement the G default when the spec does not select a colour and honour the committed preset when it does; changing the delivered board to None needs the U2 owner to update the preset.
- **Interpretation:** the brief's artifact table says `Y (normalized score 0–1)` while the P10 dictionary names the unit `normalized score (0–1)`. The table uses the brief's literal without an extra pair of parentheses.
- **Test setup:** the browser fixture sets `p11` and `p10` so the artifact P5 baseline endpoint publishes a scorer; no product read was faked.
- **Chart height:** the shared `yk-chart` renders its own open `Table` details, which makes a panel taller than the mockup. `charts/*` is explicitly out of this unit; the scatter chart element itself now has the required 160px minimum.

## Unfinished work

None in this unit. If the `session_model` preset is meant to return to the G default None, the owner of `p11-scatter.js` must change `SCATTER_SPECS`; no further scatter-panel change is needed.
