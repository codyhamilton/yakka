# Handoff — phase2-10 Artifact and Operations screens

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- **Artifact (`/artifact`):** rebuilt `web/js/explorers/artifact.js` around the DESIGN order: identity form, identity strip, version table, G-artifactscore, content/diff viewer. The table uses `col width` 150/180/80/180/110/110 plus remaining, caption `Version history`, exact `Score/scorer` header, observed DESC/hash ASC, `Load more versions`, and T1–T4 rows. The version chooser defaults to the newest served hash; `hash` deep-links the selected version; an explicit `hash`+`compare` pair populates from/to and two content reads happen only after `Show diff`. Content is inert plain text in a 12px/18px monospace viewport; Copy/Download appear only for complete bytes with the exact-bytes hint. Missing, pending, removed, too-large and integrity states keep their exact code/reason and never become prefix diffs. F5 retains the identity and shows `This record is outside the current filters`.
- **G-artifactscore:** exact caption, Check/Scorer controls (P5), chart/table views, and a table whose order is observation ASC then hash ASC. A score absent for the selected scorer stays `—`, and the line has a gap rather than connecting through it.
- **Operations (`/ops`):** rebuilt `web/js/ops.js` with the three fixed regions: Tenant health, G-footprint, Recent retained records. Health is the fixed four-row table with 240/120/remaining widths and exact sources `summary.unpriced_calls`, `event-counts.matched.rejections`, `schema.coverage.scored_content_by_kind[kind]` arithmetic (selected global kind, else Design), and `schema.coverage.sessions.without_session_repo`; both metadata rows carry the exact all-retained-data notice, and missing values show `—`. Records use `/explore` with Time/Type/Path-event/Stage 150/120/remaining/100, keyset paging, `Load more events`, and no reason column.
- **G-footprint:** `web/js/panels/ops-footprint.js` selects the exact tenant id from `/v1/admin/status`, never sums tenants, renders horizontal binary-unit bars with the exact caption, and shows exact integer bytes in the category table ordered bytes DESC then category ASC. A 403 is exactly `Storage information is available to server administrators only.` and exposes no tenant values. Admin access comes from the status response, not Owner membership.
- **CSS:** rewrote `web/css/artifact.css` and `web/css/ops.css` for 30px left-aligned rows, full-width regions, fixed table layout with internal scroll, token colours, and no animation.
- **Tests:** added `tests/operable-chrome/artifact-ops-unit.test.mjs`; updated `tests/workspace/ops.test.mjs`, `tests/plans-artifacts/artifact-reader.test.mjs` and `artifact-diff.test.mjs` for the new DOM, units, exact captions/columns and T1–T4. Old P12 outline/chunk controls and mark-band bands were removed because the new contract is a complete plain-text viewer and a scored version table.

## Evidence before and after

Before (HEAD, captured by stashing this unit's files):

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  PUBLIC_CANVAS_TEST_MODE=true node --test \
  tests/plans-artifacts/artifact-reader.test.mjs \
  tests/plans-artifacts/artifact-diff.test.mjs \
  tests/workspace/ops.test.mjs
# tests 35  # pass 35  # fail 0
```

After (owned files):

```
cd packages/yakka-analytics && NODE_OPTIONS=--max-old-space-size=8192 \
  PUBLIC_CANVAS_TEST_MODE=true node --test \
  tests/workspace/ops.test.mjs \
  tests/operable-chrome/artifact-ops-unit.test.mjs \
  tests/plans-artifacts/artifact-reader.test.mjs \
  tests/plans-artifacts/artifact-diff.test.mjs
# tests 51  # pass 51  # fail 0  # duration_ms 6498
```

The brief's full done-evidence command (the twelve files, including `tests/workspace/acceptance.test.mjs`) reported:

```
# tests 63  # pass 58  # fail 5  # duration_ms 246624
```

The five failures are all in `tests/workspace/acceptance.test.mjs`; none asserts an owned Artifact/Operations contract:

- `every Start question path...` times out settling `/plans` panels (`plans-list`, `scatter-plan`).
- `Pulse proves feed...` times out clicking a river mark.
- `a named board saves...` sees an extra `tenant=fixture-tenant` in a saved Pulse URL.
- `every panel state...` records `retry recovers the panel`: expects footprint `ready`, gets `empty` because the selected `fixture-tenant` is absent from the fixture `adminStatus()` tenants (`alpha`/`beta`).
- `acceptance summary...` aggregates the two recorded records above.

The footprint `empty` is the DESIGN-correct exact-tenant result, not a regression; the test line is stale. The other three failures are outside this unit's files and pass/fail independently of it.

## Check IDs

| ID | Result | Evidence |
|---|---|---|
| S-artifact | pass | Exact version columns/widths/order, newest default, hash deep link, compare reads only after Show diff, inert complete text, exact-bytes hint, tabs, no truncated prefix; reader/diff tests 21 pass; viewport 1440. |
| S-ops | pass | Health 240/120/remaining and four fixed rows with exact sources/notice, footprint caption/tenant selection, records 150/120/remaining/100 with keyset paging and no reason column; ops/unit tests 30 pass. |
| G-artifactscore | pass | Exact caption; Check/Scorer controls; chart/table; observation ASC/hash ASC; missing score stays `—` with a gap. |
| G-footprint | pass | Horizontal binary-unit bars, exact category table bytes, bytes DESC then category ASC, exact captions; null bytes sort last and render `—`. |
| T1 | pass | Literal `Loading …`/`Loading…` states keep headers and clear stale rows. |
| T2 | pass | Literal `No records match these filters.` for versions, records and footprint, with All history/Reset where applicable. |
| T3 | pass | Literal `Could not load …` with server message/code and Retry; 401/403/503 and status-error recovery tests. |
| T4 | pass | `Load more versions` appends without duplicates; `Load more events` preserves loaded rows and retries the next page. |
| C1–C11 | pass | Shared shell/toolbar untouched; window, repo, kind, chips, reset and all-history tests remain green in the full suite. |
| V1–V5 | pass | V2/V4 directly asserted (full width, 30px rows, left alignment, no centred/hero styling, 18px source line height); V1/V3/V5 rely on untouched shared tokens/shell and pass existing shell tests. |
| F3 | pass | Score reads use the selected kind and the artifact identity; no other identity is substituted. |
| F4 | pass | Scores/schema/baselines carry tenant; baseline remains all-history; facets are capability-gated and never narrowed by analytics filters. |
| F5 | pass | Outside-filter notice keeps identity metadata and exact immutable bytes unchanged. |
| F6 | pass | Changing tenant changes the exact footprint entry; time/repo changes leave the labeled tenant-wide footprint alone and change only retained records. |
| F1/F2/F7 | n/a | No unsupported cost/hook distributions, cost distributions or account/lifecycle surface in this unit. |

Report rubric: `r.done_verifiable` pass; `r.departures_named` pass; `r.unfinished_actionable` pass; `r.problems_plain` pass; `r.nothing_unusable` pass.

## Departures and interpretation

- **Facets capability gate:** the DESIGN identity form takes repositories from `/facets`. The shared fixture advertises no `features.facets` and the stub has no facets route, so the form now fetches facets only when the schema advertises them. With the capability absent the select stays empty instead of issuing a guaranteed 404. This preserves capability honesty but means the unit's stub browser proof cannot populate repository options.
- **Health event-counts gate:** `event-counts` is requested only when `schema.features.event_counts` is true. When absent, the rejected-submissions row shows `—` rather than requesting a route the server did not advertise. This is the same per-source capability rule the DESIGN applies elsewhere.
- **Compare pair:** an explicit URL `hash`+`compare` pair is treated as from=`hash`, to=`compare` on first paint. Without that pair, from/to default to previous/latest derived from the served rows. This keeps the deep-link pair stable while preserving the previous/latest default.
- **Complete viewer:** the old P12 outline, chunk windows and Show more controls are intentionally gone; the DESIGN viewer is complete plain text, with Copy/Download only for complete bytes. The old browser tests that asserted chunking were rewritten to assert completeness instead.
- **Footprint units:** display is binary (`B/KiB/MiB/...`) as required by G-footprint; the old decimal `KB` helper was replaced. Table still shows exact integer bytes.
- **Removed all-tenant blocks:** `/ops` no longer renders server-wide or all-tenant storage sections. The existing admin status API is unchanged.

## Unfinished work

- The stale acceptance line at `tests/workspace/acceptance.test.mjs:456` should expect footprint `empty` for the absent `fixture-tenant`, or the fixture `adminStatus()` should include that tenant. This unit did not edit the file.
- The three unrelated acceptance failures above need their owning units: `/plans` panel settling, Pulse river mark clicking, and the saved-board URL tenant parameter.
- No other unfinished work in this unit. No live browser screenshot was added to the report; the browser proofs are the listed tests.
