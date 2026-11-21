# Handoff — phase2-11 Tools and Workflow boards

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- **G-mix (`web/js/panels/mix.js`):** fixed to `hook_events` by `tool_kind × harness`, stacked, regardless of an incoming measure/split/mode preset. Registered the literal caption. Table is long-format `Group, Series, Value (events)`, group ASC then series ASC, absent value `—`. A refused filter is checked before the read and leaves no chart, table or chooser; preset keys `captionKey`, `mode` and `second` are not mistaken for filters. Removed the measure/split/mode chooser and the stale `costHonesty` path; `MIX_MODES`/`buildMix` remain exported for `cost.test.mjs`.
- **G-shapes (`web/js/panels/shape-bars.js`):** registered the literal caption; exact table `Repository, Plan, Complete executions, Unreported executions, Started executions, Complete share (%), Last observed`; server sort/limit then unreported DESC/identity ASC, `SHAPE_TOP=12`, explicit “Showing the top N plans by unreported executions.” label. Status tokens are declared on `SHAPE_SERIES` (`good`/`warn`/`info`). P7 now offers Plan only; Harness/Repo options are absent, not disabled.
- **G-planline (`web/js/panels/plan-timeline.js`):** registered the literal caption; one plan lane, series keyed by `event_type`, markers carry no duration, table `Event time, Event type, Repository, Plan, Path, Conversation, Session cost (USD)` in event-time ASC stable order. Plan list is served unreported DESC/identity ASC with `min(100,page_max)`; default is the first served plan; a fixed plan wins, then a global `scope.plan`/`repo_id`, then the local chooser. Empty plan collection uses T2 `No records match these filters.`; fixed unknown plans keep the named empty state and Plans link. P8/P9 views are mounted.
- **Tests:** added `tests/operable-chrome/tools-workflow-unit.test.mjs` (8 checks: literal registered captions, fixed mix dimensions/read fields, long-table order, pre-read refusal with zero reads, Plan-only/top ordering, budget-bounded top 12, exact timeline columns/no duration/event-time ASC, global/fixed/default precedence and T2). Updated `tools.test.mjs` for the new treemap/rank/caption expectations and `workflow.test.mjs` for the plan lane, event-type series and exact columns.

## Evidence before and after

Before (HEAD, stashed this unit's files):

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  node --test tests/trends-quality/tools.test.mjs tests/plans-artifacts/workflow.test.mjs
# tests 17  # pass 16  # fail 1   (stale treemap order)
```

After (owned files):

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  node --test tests/trends-quality/tools.test.mjs \
  tests/plans-artifacts/workflow.test.mjs \
  tests/operable-chrome/tools-workflow-unit.test.mjs
# tests 25  # pass 25  # fail 0
```

`tests/trends-quality/cost.test.mjs` imports `mix.js`; its mix check passes. That file still reports one failure, `cost settles six panels...`, in the distribution-ranges table. The same failure reproduces at HEAD with this unit stashed, so it is pre-existing and outside the owned files.

## Check IDs

| ID | Result | Evidence |
|---|---|---|
| G-mix | pass | Fixed request `measure=hook_events`, `dim=tool_kind`, `dim=harness`; literal caption; long table order/units; no measure/split/mode chooser. |
| G-shapes | pass | Literal caption; exact columns; unreported DESC/identity ASC; top 12 label; Plan-only P7; status tokens declared. |
| G-planline | pass | Literal caption; one plan lane; event_type series; no `start`/`end`; exact columns; event-time ASC; chooser precedence and T2. |
| P7 | pass | `SHAPE_GROUPINGS` is exactly Plan; harness/repo return a named unsupported state but are unreachable from the select. |
| P8/P9 | pass | Both panels mount the shared chart/table view seam and keep existing chart interactions; unit and browser tests pass. |
| T2 | pass | Literal `No records match these filters.`; fixed unknown plan keeps its named empty state with the Plans link. |
| T4 | pass | Timeline pages events/executions on opaque cursors without duplicate identities; population label is unchanged. |
| F | pass | Mix refuses an unsupported filter before reading and draws no marks; preset-only keys are not treated as filters. |
| S-tools | pass | Four panels settle ready; exact fixtures; unsupported cost/tool joins still named. |
| S-workflow | pass | Shape and timeline settle; shape opens the exact plan; timeline select changes only the exact identity. |

## Departures and interpretation

- **Orientation:** `yk-bars` renders stacked bars as vertical columns, not the horizontal stacked bars in G-shapes. The shared chart kit has no horizontal stacked mode and is outside this unit. Values, order, stacking and table agree; the orientation differs from the mock.
- **Global plan writes:** selecting a plan in the timeline writes the identity into the panel spec (`p12_plan` plus `plan`/`repo_id`), so the panel's exact reads carry the selected plan. A global plan still wins on the next load because `resolveTimelinePlan` checks fixed, then global, then local.
- **Cost test:** the one remaining `cost.test.mjs` failure is a distribution-ranges column/order mismatch that also fails at HEAD; no U11 file is involved.
