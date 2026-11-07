# An exploratory analytics workspace for Yakka

## Intent

Original request, verbatim:

> Work only in ~/workspace/yakka-wt/analytics-reset (branch analytics-reset). Don't touch any other checkout or worktree. Don't push, open a PR, merge, or touch master. Commit on the branch when done.
>
> Follow the Yakka design skill (plugins/yakka/skills/design/SKILL.md in this worktree), headless: no human sign-off step; record every judgement call in an assumption ledger with open questions for Cody. Write the design into docs/plans/20-analytics-reset/ (DESIGN.md alongside the existing CONTRACTS.md and charting-research.md).
>
> Task: design a brand-new analytics web UI for Yakka from scratch. The old UX was judged unusable and has been deleted. Do NOT read or build on docs/plans/10, 12, 14 or 17, the deleted package, its git history, or the old copy of docs/design/07. The only inputs: docs/plans/20-analytics-reset/CONTRACTS.md, packages/yakka-analytics/contract/*.js, docs/plans/20-analytics-reset/charting-research.md, and the Go API in packages/yakka (plus the general docs OVERVIEW/ARCHITECTURE for what Yakka is).
>
> Hard technical line: pure HTML/CSS/JS, web components, native ES import, no build system, no bundler. Minimal runtime deps, no deep transitive graphs; every dependency vendored as a single file and justified (name, version, size min+gzip, licence, why). Research pick is uPlot (0 deps, ~23 KB gzip); interaction is built on top of it.
>
> Hard UX requirement: charts are genuinely interactive: hover tooltips, zoom/pan, brushing/range selection that drives other views, legend toggles, click-through to the underlying runs/events. Verified by real browser interaction tests (not tables standing in for charts, no animation-timing tests; settled end-state checks). Start from what a Yakka user needs to find out (list those questions), and derive the pages from them, not from any old page set. For each page, state the questions it answers, its charts, and exactly how each chart interacts and what it drives.
>
> Do first: fix two conflicts in CONTRACTS.md. (1) Section 10.1's SvelteKit _app/immutable/ cache prefix: make cache rules generic for the new static layout, and note that site.go/site_test.go need a matching change (a build phase item). (2) Section 12's pinned Overview/Usage request sets: reframe as available endpoints, not a required page shape.
>
> Also required: the new UI must serve /oauth/callback and /device so the login flows keep working before the Pages deployment is replaced.
>
> Stale guidance: docs/design/07 pointer is fine as is; fix "static Svelte site" in docs/design/system-architecture.md. Do not edit plugin skills; instead add notes in the design about the design skill reading docs/design first and the execute/refine "do not invent scope" wording.
>
> Phases must each close with a provable outcome. Finish with a short summary: commit hash, page set with chart interactions, dependency list with sizes, phases, and the ledger's open questions.

Clarified direction, verbatim (appended; the original request above stands):

> we should be able to slice and visualise data in multiple ways. E.g. quality by harness, by model, by repo, drilling down into plans and what they contained. for the dashboard give a range of things - what is recent, what are trends sliced over the various lenses - harnesses, models, repos, quality outcomes etc etc. Go more and genuinely different and we'll prune after.
>
> I'd like to see visualisations, and particularly as mentioned be able to trend, scatter, slice across all the lenses we have
>
> uplot as published is fine
>
> pages deploys automatically when the pr is merged to master by the automation job
>
> why have arbitrary max reporting window?

## Problem

Yakka's ledger holds what agents did (hook events, model calls with tokens, sessions, commits), what they wrote (design, brief and report artifacts, with their content), how that writing scored, and what the ingest screens rejected. People want to look across all of it: quality by harness, model and repo; cost and activity as trends; and the plans and artifacts underneath any number. Four things stand in the way, all established at Ground against master `b2094eb` (citations are repo-relative; the full inventory is in [CONTRACTS.md](CONTRACTS.md) section 7.4):

1. **There is no UI in the intended shape.** The SvelteKit site on master is judged unusable after three redesigns; a reset that removes it exists only as an unpushed local commit, so master still builds and embeds it (`tools/release/build.sh:18,30-35` needs npm). `yakka login` and GitHub sign-in end at pages that UI serves (`/device`, `/oauth/callback`).
2. **The API cannot answer the cross-lens questions.** Every analytics route is a count or sum along one dimension, a distribution of one measure, or a list. There is **no route that returns cost and score at the same grain**, no scores split by harness, model or repo (`/scores` and `/score-series` have no group-by), no listing of artifacts or plans, and no route that returns artifact content or a version history (bodies sit on disk as pending/blob files, `store/store.go:571,623-632,688-719`; `GET /v1/artifacts` returns the latest version's metadata only, `serve/serve.go:771-801`). Phases, reviews and authoring models are not recorded at all: commit facts carry no message (so no `Yakka-Phase` trailer), `IMPLEMENTATION.md` and `REVIEW.md` are never stored (`keys.Kind` matches only DESIGN, briefs and reports, `keys/keys.go:168-186`), and no field says which model wrote an artifact (only the models of the writing session's calls can be derived).
3. **The repo lens does not exist for cost or activity.** Hook events, including every model call, are built without `repo_id` (`packages/yakka/internal/facts/facts.go:132-134`; the live Python client sets `repo_id` only on artifact and commit facts, `plugins/yakka/client/yakka.py:581,989`). `dim=repo_id` on `cost_usd`, `model_calls` or `hook_events` therefore groups everything under the empty string. A repo for a session exists only through its artifact and commit facts.
4. **A reporting-window cap with no hard reason behind it.** "All time" was clamped to 399 days. Where that comes from, established at Ground:
   - It is a server policy constant, not retention and not a data limit: `maxBuckets = 400` (`serve/analytics.go:20`) and `tooWide`, which counts inclusive UTC days (`:82-91`) and is applied by `parseFilter` to every route except `/query` (`:154-156`), giving at most 399 days. `/query` instead caps buckets (`serve/analytics_query.go:81-84`, `bucketSpan` `:118-142`), so `all=1` works there only with `bucket=none`. `score-series` and `executions` re-apply it (`serve/analytics_score_series.go:31-34`, `serve/analytics.go:402-404`).
   - The old client mirrors it: `MAX_REST_DAYS = 399` (`packages/yakka-analytics/src/lib/params.ts:19`), `BUCKET_CAP = 400` (`src/lib/buckets.ts:6`). It hard-codes both because `/schema` advertises neither.
   - Nothing deletes data by age: no TTL, prune or tiering exists (compaction and migration 9 remove rows by event type, `compact/compact.go:218-220`, `store/store.go:144-148`). The cap hides nothing; it only bounds the work per request, and the docs call it "a response-size cap (judgement)" (`docs/design/07-analytics-site.md:63-68`).
   - It does not actually bound the work: usage measures load every kept row into Go memory with no LIMIT (`store/usage.go:189-212`), so a 399-day window is already expensive and an unbounded one would be unbounded in memory; there is no query deadline (only `r.Context()` is passed; `ReadHeaderTimeout` is the only server timeout, `cmd/yakka/main.go:119`); and `ScoreSeries` binds one SQL parameter per distinct content hash, which fails above 32,766 (`store/score_series.go:94-99`).
   - Real boundaries that do exist: `UnixNano` overflow outside 1678 to 2262 (cursor windows, `store/analytics.go:122`), the `/query` output row cap of 20,000 (`store/query.go:94`, which when hit drops the *newest* buckets because rows sort ascending before the slice, `:306-309`, `:670-677`), `top` at most 100, `/explore` at most 20,000 rows with no cursor, `/conversation` at most 5,000 events.

The two things at stake now are what the user asked for: an investigation workspace that can slice, trend and scatter across every lens the data really supports, drill from a number to the plans and artifacts behind it, and say honestly where it cannot; and a reporting window with no arbitrary maximum.

## Solution Shape

Two cooperating changes, one plan.

**A static, no-build analytics workspace** in `packages/yakka-analytics/web/`: `index.html`, CSS and native ES modules, web components, one runtime dependency (uPlot as published). The same directory is what Pages serves and what the Go binary embeds. It is organised as **questions, lenses and linked views**, not as one screen per endpoint:

- **Start** is a set of question paths, each a configured view ("How do design scores differ by harness?", "Do expensive sessions write better briefs?", "What did this week cost against last?", "Which brief runs have no report or commit yet?").
- **Boards** are recomposable sets of panels over one shared *scope* (time window and filters), with a shared *cohort* and *selection* model, so that brushing a scatter filters every other panel. `pulse`, `trends`, `compare`, `scatter`, `quality`, `cost`, `tools`, `workflow` are presets of one panel engine, not separate pages; any panel can be re-pointed at another measure, lens, grain or chart, and added to a board.
- **Explorers** drill into entities: plans (what they contain and how they evolved), artifacts (the actual content, versions, diffs, scores, the session that wrote it), sessions (timeline of tools, cost and artifacts), and a raw **ledger** of events as provenance. An **ops** view carries the existing admin status.
- **Honesty is structural.** Every panel declares its grain, units, time basis, coverage and caveats; shows every filter or cohort that applies and every one that did not; and shows *unsupported* with the reason when a measure and lens do not join. Nothing is hidden by a silent clip.

**A server contract that makes those views true**, owned by this plan because the UI cannot honestly fake it client-side: a bounded-range read contract with no window cap (adaptive resolution, cell budgets, cursors, deadlines, cancellation, visible coverage); a capability schema the UI is driven by; an **entity layer** (sessions, artifacts, plans, executions) with explicit identities, joins and measures, scores split by lens, a deterministic scatter mode with population marginals, a cohort predicate that links grains through `conversation_id`; and read access to artifact content and version history.

**Shipped versus design-only.** The workspace is built on what master ships plus the server work in this plan. Three neighbouring plans add lenses the UI will use *if their servers exist*, detected through the capability schema and never faked: Plan 22 session actions (`action_*` dimensions on cost; design on master, a partial build exists only on the unmerged `feat/22-session-work-tagging`), Plan 23 shadow reviews (`review_run`, reviewer model and `build_models`; design only, on the unmerged branch `origin/docs/23-llm-review-shadow`), and Plan 21 feedback deliveries (design on master; its `feedback-<repo_id>` synthetic sessions are why session rows carry an `origin` flag). Plan 24's MCP server is built on master (`serve/mcp.go:132`) and is the agent surface; it shares no analytics code and is not a UI dependency.

### What the user can find out (the question set the panels serve)

Recent: what just happened, by session, artifact and execution; what is new since I last looked.
Trends: any measure over any window, split by any lens, absolute or share, cumulative, against the previous period; movers (what changed most) per lens.
Quality: score distributions and trends per check, by harness, session model, repo, plan, kind and scorer, against the all-time baseline; the lowest and highest artifacts, openable.
Cost and usage: where it goes (cost by model/harness/session-repo, tool activity by tool kind), what is typical and what is an outlier, how much cannot be priced.
Relationships: session cost or size against what the session produced; artifact score against the cost, model and size of the session that wrote it; plan-level cost, artifacts and execution progress.
Plans: which exist, what they contain, how a design changed across versions, which briefs ran and reported.
Coverage: how much of the data a number rests on (scored of total, priced of total, repo-attributed of total, compaction, pending, rejections).

### Domain: Range, resolution and budgets (server)

Server-owned range/resolution, bounded aggregate/list work, cursor/revision rules, deadlines, cancellation and honest coverage. Every requested window is preserved within evidenced timestamp bounds; output/work budgets replace date policies. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.1](CONTRACTS.md#171-range-resolution-and-budgets).

### Domain: Capability schema and coverage (server)

Server-owned capabilities declare implemented measures, grains, modes, joins, provenance/null rules and budgets. The UI derives valid combinations from this schema; absent capture/features remain explicit. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.2](CONTRACTS.md#172-capability-schema-and-coverage).

### Domain: Entity layer (server)

Server-owned session, file, content-hash, plan, execution and time populations; explicit lifetime provenance versus in-window measures, scores/scorers, overlap, bounded scatter/aggregate modes, Boolean cohorts, typed denominators and activity/probe reads. No client joins reconstruct unavailable entities. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.3](CONTRACTS.md#173-entities-populations-predicates-and-activity).

### Domain: Artifact content (server)

Server-owned tenant/read-scope access to complete promoted design/brief/report blobs, with hash integrity, explicit unscreened/missing/pending/oversized states and paged version metadata. No unstored review/completion content is invented. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.4](CONTRACTS.md#174-artifact-content).

### Domain: Design-only dependencies

- Owns: the statement of what the workspace will do with data that does not exist on master, so nothing is promised or faked.
- Contract: each of these appears only as a capability row in the UI's capability inspector (with the source design cited) until `/schema.features` reports it; no speculative chart or invented metric is built.
  - **Plan 22 session actions** (design on master; partial build on `feat/22-session-work-tagging`, unmerged): lenses `action_kind`, `action_plan`, `action_phase`, `action_subject`, `action_pr`, `action_source` on cost measures only, with `(untagged)`, `(rejected)` and `(none)` buckets that must be shown (`docs/plans/22-session-work-tagging/DESIGN.md:92-100`); `GET /v1/actions`. Grain: session *segment*, joined to a call by timestamp. When present under the full published action contract: expose the cost lenses through the existing trend/compare/cost choosers and additive plan cost beside overlapping association cost; otherwise name the absent capability.
  - **Plan 23 shadow review** (design only, unmerged branch): `review_run` records with reviewer model, required `build_models` (a list, `unknown`, or mixed; never inferred), status, findings by severity, cost, session binding; `GET /v1/reviews`. When the full review contract is served: related review records link from their bound plan/session inspector, and reviewer model, build models and review status are distinct from `harness`, `session_model` and `scorer`; findings are comparative against historical reviews, which "are the baseline, not truth", so comparisons never claim those proxy findings establish real pass/fail outcomes; an actually captured review status is displayed as recorded.
  - **Plan 21 feedback delivery** (design on master): delivery states are not outcomes and are not charted as such; its synthetic `feedback-<repo_id>` sessions are what the session `origin` lens separates.
  - **Outcome data** (merged PR, CI, review verdicts, `Yakka-Phase` completion) is not ingested by any design; it is a capture problem, not a UI problem, and is out of scope here (Open Question 3).

### Domain: Workspace shell and state (UI)

- Owns: `index.html`, the router, the URL state codec, the request scheduler, the capability detector, the scope bar and coverage strip, theme, the session gate, the `_headers` file.
- Contract:
  - **Routes** (all client routes; unknown paths render a not-found view inside the shell): `/` Start, `/b/<preset>` (a board; presets `pulse`, `trends`, `compare`, `scatter`, `quality`, `cost`, `tools`, `workflow`), `/plans`, `/plans/<repo>/<plan>`, `/artifact` (`repo_id`, `path`, `hash` in the query), `/sessions`, `/sessions/<id>`, `/ledger`, `/ops`, and the account routes `/login`, `/oauth/callback`, `/device`, `/profile`, `/settings`.
  - **URL is the state.** One codec reads/writes every key, preserving unknown ones within the published encoded-URL budget. Scope: `win` (`<n><h|d|w|m|y>` or `all`, default `30d`, no reporting maximum), or RFC3339 `from`/`to` taking precedence, and IANA `tz`. Includes use server lens names, exclusions repeat `exclude`. `ca` to `cd` hold the cohort grammar in CONTRACTS.md 17.3; `pick` holds a transient grain/scope/predicate selection, `sel` a time brush, `hide` legend keys, `cmp=off|cohorts|period`, `v` the board preset, `p<n>` panel overrides. API times enforce their evidenced representable interval. Window/filter/cohort/compare changes push history; hover and an in-progress drag do not; a committed brush/selection replaces its transient parameter, zoom pushes and clears `sel`. Back restores the full prior scope/cohorts/panels; copied links include the committed selection and fixed cohort scopes. Compare-period is disabled for `all` with “choose a finite period”; no arbitrary finite-period cap is introduced.
  - **Request scheduler.** One module issues every request: at most 4 in flight (the concurrency the p95 bound was measured at, CONTRACTS.md section 12), identical in-flight requests collapsed to one, a request superseded by newer state aborted with `AbortController` (and the server stops it, Phase 3), `tz` and `tenant` (collector mode) added, the credential rules of CONTRACTS.md 3.4 applied, retries only for `busy` with `Retry-After`. It never splits, clips or rewrites a window to fit a limit: a 400 or 503 is shown as the server states it with its `retry` hint offered as an explicit action.
  - **Capability detection.** The UI reads `/schema` once per tenant and drives every chooser from it (measures, lenses, grains, budgets, features). Pages are deployed by merge to Pages while the API on Fly is deployed separately, so an older server is a normal condition: a panel whose feature is absent renders the **unsupported** state naming the missing feature and what supplies it, and an old server's `range too wide` is shown verbatim as the server's limit. The UI hard-codes no window, bucket, row or cell limit.
  - **Panel states**, one vocabulary in every chart frame, set as `data-state`: `loading` (with in-flight count), `ready`, `empty` (says which filters, cohort or selection produced zero and offers to clear each), `error` (the server's message, its `code`, retry), `unsupported` (grain, measure or lens not joinable, why, and the nearest supported choice), plus non-exclusive badges `partial`, `sampled`, `coarsened`, `clipped`, `lower-bound`. A cancelled request is `cancelled` with retry, not an error.
  - **Reconciliation, no hidden drops.** Every panel lists applicable scope/cohort/selection chips and “not applied here: X” for ignored filters or missing joins. Its “N of M” uses its response's typed population and names the unit; `/summary` can supply only the counts it actually owns. A cross-grain panel says “artifacts associated with 143 selected sessions”, never equates artifact count with session count. Missing axes/checks, unpriced, unattributed, omitted groups, sample/page size and overlapping relations are visible. Totals never come from summing a partial page.
  - **Time basis.** Fact windows and score-series buckets use artifact/event `facts.ts`; scores are **latest known**, not historical scores as of that bucket. Score/screen `at` is the evaluation timestamp displayed in metadata, not the score-trend bucket clock. Rejections use server `at`; activity/Follow additionally names receive time for late arrivals. Commit-sourced versions/commits carry Bash-hook time, not git commit time. Every panel names its basis, any mixed clocks and the latest derivation/receive revision; backfills and rescoring may change past buckets.
  - **Money.** Unpriced is never `$0`: a total shows the amount as a lower bound with the unpriced count; an all-unpriced value is `unpriced`; per-event `priced` comes from the server.
  - **Session gate, identity routes, storage and headers** follow CONTRACTS.md 2 to 5 and 9. New browser storage keys, all ledgered: `yakka-analytics-entity-colours`, `yakka-analytics-boards` (a list of named board URLs; the URL stays the source of truth), `yakka-analytics-follow-seconds`.
  - **Follow** is an off-by-default toggle polling `/activity?mode=probe&after=<watermark>` at `yakka-analytics-follow-seconds` (default 30) only while visible. It shows counts by observation type since the last acknowledged watermark, refetching the feed only on click and advancing that acknowledged watermark then. A cancelled/error probe does not advance it; there is no other auto-refresh.
- Non-goals: server-side rendering, offline mode, i18n, a build step, a demo mode or any data that is not the server's (fixtures exist only under `tests/` and the Go generator).

### Domain: Interaction model (UI)

- Owns: how the user narrows, compares and links across every panel; one grammar for all charts.
- Contract:
  - **Four distinct things.** *Scope* is the board window/filters. *Brush* (`sel`) transiently narrows linked peers to a time interval while its source retains context; clearing restores peers, zoom commits it to scope. *Selection* (`pick`) highlights marks by a Boolean entity predicate; it does not requery cross-grain peers until a tray action. *Cohort* A–D is a named URL-carried definition with fixed absolute source scope. A numeric scatter rectangle denotes every eligible entity in that region, including unsampled ones; the tray obtains the exact population count from a bounded server predicate query and labels sample marks separately.
  - **Selection tray.** It states grain, predicate and counts with units (“143 sessions of 1,880 in scope; 38 sampled marks visible”) and offers *Make cohort A to D*, *Filter all panels to this*, *Exclude this*, *Zoom* for time, *Open as list*, *Clear*. Source additions/subtractions use Boolean predicates, not inferred sample identities. `Filter all` resolves the selection to C then includes its sessions; `Exclude this` resolves the same positive selection then removes C from the target session population (`op=exclude`), rather than complementing artifacts before their join. Both name artifact/plan expansion. Time scatter means contributing sessions of selected aggregate buckets, with its source fields/resolution frozen and missing associations shown. Choosing a cohort slot stores the definition; compare/filters determine which peers query it. Only the time brush's labelled transient peer preview precedes an explicit action.
  - **Gestures** (every chart implements the subset that applies; each is a browser test case):

    | Gesture | Result |
    |---|---|
    | Hover or keyboard focus | Highlight that mark and the same entity key in every other panel that shows it (client-side, ids already loaded); tooltip with every visible series, unit, `n`, coverage flags. No URL change |
    | Click a mark | **Inspect**: opens the inspector (side panel, bottom sheet on narrow screens) with the entity's facts and actions: *Open* (its explorer), *Filter to*, *Exclude*, *Add to cohort*, *Copy link* |
    | Shift/Ctrl/Cmd-click, or the row checkbox | Toggle the mark in the selection (additive); Alt-click toggles it as an exclusion |
    | Drag on a time axis | Brush `sel`; Shift+drag pans; Ctrl/Cmd+wheel zooms around the cursor; double-click or *Zoom to selection* commits to `from`/`to` and re-asks at finer resolution |
    | Drag on a scatter | Rectangle selection over the two axes: an entity predicate (`where` ranges) that the tray offers as a cohort or filter; Alt+drag subtracts |
    | Legend click | Toggle series visibility (`hide`, no request); legend *focus* (button or Alt-click) filters the board to that value; Ctrl-click isolates |
    | Keyboard | Charts are focusable; arrows move across marks (up and down across series), Enter inspects, Space toggles selection, `o` opens, `f` filters, `x` excludes, `c` then `a` to `d` adds to a cohort, `[` `]` move a brush edge, `+` `-` zoom, Esc clears the selection then the brush |
    | Touch | Tap inspects; a *Select* mode button turns drag into brush or rectangle selection; pinch zooms a time axis; targets are at least 44 px |

  - **Linking.** Same-grain loaded marks highlight by entity key. After a tray action, peers requery the session-resolved `cohort=` with its explicit include/exclude operation: session rectangles, file/content selections and selected aggregate time buckets can restrict cost/quality/plan associations. Counts reconcile within typed units and explain expansion; sampled marks never define membership. Boolean subtraction inside a source selection and excluding its resolved sessions are distinct labelled actions. A missing join yields `unsupported` with its reason instead of dropping the selection.
  - **Compare.** `cmp=cohorts` draws every defined cohort in the panel with the cohort's fixed colour (A to D), which then replaces the lens colouring (colour encodes exactly one thing per panel); compare plus a split lens becomes small multiples, one column per cohort. `cmp=period` overlays the previous period of equal length (aligned by offset, labelled with both ranges). Every compared value carries its `n`, its coverage flags and its unscored, unpriced and unattributed counts; a difference between cohorts is shown with both sides, never as one bare delta. Cohorts of different grains are not compared; the panel says so.
  - **Honest uncertainty.** A banner states, per panel type, what the picture cannot say: quality panels carry "scored X of Y content hashes (or files, as labelled); scoring is comparative, not pass/fail; each check names its scorer"; scatters and correlations carry "association, not cause"; anything from a sample says "sample of N of M; marginals are the whole population"; plan cost says "overlapping across plans"; repo views say how many sessions are unattributed.
  - **Accessibility and responsiveness baseline.** Native elements first; every chart has a *Table* toggle showing the plotted values and is operable by keyboard alone; colour never carries meaning alone (marker shape, pattern or label accompanies it); `prefers-reduced-motion` and `prefers-color-scheme` are honoured and no chart animates; layout is a single column below 900 px with the inspector as a bottom sheet; focus order and visible focus are defined for the shell, tray and inspector.
- Non-goals: freehand lasso, 3D, drag-reordering of marks, a dashboard builder beyond adding and re-pointing panels from the registry.

### Domain: Chart kit (UI)

UI-owned interactive uPlot time/numeric-scatter elements plus first-party SVG categorical/distribution/matrix/lane/treemap elements; one stable styling/tooltip/legend/table/gesture contract. uPlot 1.6.32 as published is the sole runtime dependency (145,423 B JS / 41,650 B gzip; 1,857 B CSS / 772 B gzip, MIT, no transitive dependencies). Two-dimensional scatter has a first-party canvas fallback, not a second library. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.5](CONTRACTS.md#175-chart-kit).

### Domain: Panels, boards and question paths (UI)

- Owns: the panel registry, the board presets, the question paths and the capability inspector.
- Contract:
  - A **panel** is a module with a registry entry (`id`, `grain`, accepted measures, lenses, charts, requirements as `/schema` features, the caveat banner) and a view spec `{grain, measures, split, chart, scope overrides}` serialised in the URL. A **board** is an ordered list of panels (at most 12) over one scope; presets are data. The panel chooser offers only combinations `/schema` lists for the grain; anything else is shown in the capability inspector as unsupported, with the reason and the source of the missing capability (this plan's phase, or a design-only plan).
  - **Panel catalog.** Broad on purpose; any later user-authorised pruning removes registry entries/files and explicitly updates affected outcomes, not hidden acceptance scope, and a test fails if a preset names a panel that does not exist. "Now" means supported by master's contract; "P*n*" means it needs that phase of this plan.

    | Panel | Grain | What it shows | Needs |
    |---|---|---|---|
    | `river` | activity observation | Recent session starts, artifact versions, executions and rejections as a dense linked timeline; each clock and observation type labelled | P6 `/activity` |
    | `pulse-strips` | time | One strip per headline measure (cost, calls, sessions, events, artifacts, commits, rejections, quality median) with change against the previous equal period | Now |
    | `movers` | time | Ranked change per lens value, this period against the previous: bars with sparklines, `n` and unpriced counts | Now; repo lens P4 |
    | `trend-columns` | time | Any count or usage measure per bucket, stacked by a split lens, with absolute, share and cumulative modes | Now; `bucket=auto` and unbounded windows P3; repo and session-model lenses P4 |
    | `trend-lines` | time | Lines or areas by lens, period-over-period overlay, event markers | as above |
    | `trend-multiples` | time | Small multiples, one per lens value (shared or free y) | as above |
    | `calendar` and `rhythm` | time | Day-by-week calendar of any measure; weekday-by-hour matrix | Now |
    | `mix` | time, artifact or execution | 100 percent composition: tool kind by harness, execution shape by plan, screen verdict by artifact lens; each population labelled | Now for tools; entity aggregates P5/P6 |
    | `treemap` | time | Composition of a measure over two lenses (repo then model) | P4 for repo |
    | `rank` | time | Top N of a measure per lens with `(other)` | Now |
    | `dist-ranges` | session or call | Box and whisker with p95 per lens value for cost or tokens, with `n` and unpriced | Now for `model`; harness, session model, repo P4 |
    | `dist-hist` and `dist-ecdf` | session or call | Fixed-bin histograms and ECDF step lines per cohort or lens (binned, labelled) | Now for bins; lenses P4 |
    | `score-ranges` | content | Per-kind/check distinct-hash ranges with scorer-specific all-time baseline, split by `harness`, `session_model`, `repo_id`, `plan`, `scorer`, with scored-of-total hashes | P5 |
    | `score-trend` | content per time bucket | Per-kind/check median and quartile band over artifact event time, split by lens; latest known score, repeated hashes across buckets disclosed | P5 (unsplit: Now) |
    | `score-strips` | artifact | One dot per artifact on a lens axis (sample flagged), clickable to the reader | P5 |
    | `band-mix` | artifact | Share below p25, mid, above p75, unscored per lens | P5 |
    | `scatter-session` | session | Any two session measures (cost, tokens, calls, events, commits, artifacts, duration), colour by lens, size by a third, marginals | P4 |
    | `scatter-artifact` | artifact | Numeric `score:<check>` against writing-session cost/calls/tokens, another same-kind check, versions or `content_bytes`; model is a colour/facet lens, never a numeric axis | P5 |
    | `scatter-plan` | plan | Associated cost against artifacts, versions, design score, complete share | P6 |
    | `scatter-day` | time | Two measures on the same server bucket grid (e.g. daily cost and commits), with units and partial-bucket coverage | P4 time entity mode |
    | `shape-bars` | execution | Complete, unreported and started per plan, harness or repo; age of last observation, never inferred success | P6 aggregate mode (ungrouped counts Now) |
    | `plan-timeline` | plan | Artifact versions and executions of a plan in time lanes, markers sized by nothing and coloured by kind | P6 |
    | `coverage` | typed populations | Data by source/day, last receive, pending, scored/total hashes, priced/total calls, attributed/total sessions; no single blended percentage | P3/P4/P5 |
    | `session-lanes` | session | One session's tool events, model calls and artifacts in lanes, with cumulative cost | Now (`/conversation`) |
    | `ledger-table` | event | Windowed events with every filter as a removable chip and ignored filters named, paged by cursor | P3; cohorts P6 |
    | `ops-footprint` | tenant | Disk use, scoring state, failures, rescore | Now (`/v1/admin/status`) |

  - **Preset mapping and delivery.** Every board is a concrete starting composition; the registry keeps the full catalog available for adding/re-pointing panels. This mapping assigns every catalog entry to a phase outcome, rather than promising an unowned preset:

    | Preset / owner | Initial panels and configuration | Main investigation action and target |
    |---|---|---|
    | `pulse` / P9 | `river`, `pulse-strips`, `movers` by harness/model, `calendar`, `coverage` | Feed inspect → session/artifact/execution provenance; time brush previews peers; zoom refines scope |
    | `trends` / P10 | `trend-columns`, `trend-lines`, `trend-multiples`, `calendar`, `rhythm`; measure and schema-supported split chooser | Brush/zoom → shared time; legend focus → same supported lens filter; period overlay names both windows |
    | `compare` / P10 | `dist-ranges`, `dist-hist`, `dist-ecdf`, `trend-lines`, `rank` in slope mode; A–D or finite equal-period comparison | Add cohort → distribution/trend facets with separate units, sample sizes and coverage |
    | `quality` / P10 | `score-ranges`, `score-trend`, `score-strips`, `band-mix`; kind/check, then harness/session-model/repo/plan/scorer | Content-weighted range selection or file-weighted strip inspect → labelled predicate/inspector; artifact reader becomes available P12 |
    | `cost` / P10 | `trend-columns`, `rank`, `treemap` by session-repo then call-model, `dist-ranges`, `dist-hist`, `dist-ecdf` | Focus model/repo or cost interval → cohort; priced, lower-bound and all-unpriced populations remain separate |
    | `tools` / P10 | `mix` by tool-kind/harness, `treemap` and `rank` for hook counts, `rhythm` | Pick tool-kind/harness → compatible activity panels; unsupported cost join is named |
    | `scatter` / P11 | `scatter-session`, `scatter-artifact`, `scatter-plan`, `scatter-day`, population marginals | Rectangle/union/subtraction → tray → exact server cohort; x/y numeric, colour/size schema-constrained |
    | `workflow` / P12 | `shape-bars`, `plan-timeline`, `rank` by plan-associated cost, `scatter-plan`, `river` | Plan/execution inspect → plan contents and related session; overlapping cost and process shape are labelled |

    `session-lanes` belongs to session detail (P11), `ledger-table` to `/ledger` (P9), `ops-footprint` to `/ops` (P9); the P9 base and P10 investigation sets together own every remaining catalog entry. Hover/inspect/selection/legend/keyboard/touch behavior follows the common interaction contract, with no board-specific hidden gestures. Internal links whose explorer is delivered later show a named destination until that phase; all destinations resolve by P13.

  - **Question paths** on Start, each a link to a configured board or explorer state that states what it needs and is disabled with the reason when the server lacks it:
    - Cost: "Where did the money go this week against last?" (`cost`, `cmp=period`); "Which model gives the most output per dollar?" (session scatter, cost against commits or artifacts, by `session_model`); "How much of my spend cannot be priced?" (`pulse`, unpriced).
    - Quality: "How do design, brief and report scores differ by harness?" (`quality`, `score-ranges` by `harness`); "Quality by model and by repo over time" (`score-trend` by `session_model`, then `repo_id`); "Do expensive sessions write better artifacts?" (`scatter-artifact`, score against writing-session cost); "Which artifacts scored lowest?" (`score-strips`, sorted, open in the reader); "Am I better than my usual?" (`score-ranges` with the baseline).
    - Plans: "Which brief runs have no report or commit yet?" (`workflow`, `shape-bars`); "What did this plan contain, and how did the design change?" (plan explorer, version diff); "Which plans cost the most for what they produced?" (`scatter-plan`, with the overlap banner).
    - Activity: "What just happened?" (`pulse`, `river`); "When do I work?" (`calendar`, `rhythm`); "How do harnesses use tools?" (`tools`, `mix`).
    - Health: "What is unscored, unpriced, unattributed or rejected?" (`coverage`, `ops`).
  - **Capability inspector.** A drawer on every panel lists its queries (route and parameters, the "API explorer" as provenance and not as navigation), its grain, units, time basis, budgets, coverage, caveats, and any capability it is missing with the source of that capability.
- Non-goals: a page per endpoint, a free-form query builder, saved dashboards beyond named board URLs, any panel for a design-only capability.

### Domain: Entity explorers (UI)

- Owns: the sessions list and detail, the plans list and plan detail, and the artifact reader.
- Contract:
  - **Sessions** (`/sessions`): a sortable, cursor-paged table over `entities?grain=session` with lens chips and the scope tray, sorting by any session measure server-side; **detail** (`/sessions/<id>`) is lanes of tool events by `tool_kind`, model calls with cumulative cost (unpriced as hollow markers, from the server's `priced` flag), artifacts and commits written, with truncation stated (`/conversation` caps events at 5,000) and links to the plans and artifacts the session wrote.
  - **Plans** (`/plans`): a ranked table and scatter over `entities?grain=plan`; **plan detail** (`/plans/<repo>/<plan>`): the plan's artifacts by kind with latest version, score and band, the executions with shape, the sessions that touched it with cost and the overlap note, and a time-ordered timeline of versions and executions. The plan's **phases and briefs are read from the stored content**: phases from the design's `### Phase <n>` headings and their Outcome lines, briefs from the path pattern `briefs/<phase>-<NN>-<slug>.md`, both parsed in the browser for display only and never counted as measures. Phase completion, reviews and plan-level outcomes that live in `IMPLEMENTATION.md`, `REVIEW.md` or commit trailers are not stored and are not shown or inferred.
  - **Artifact reader** (`/artifact`): the version history of one `(repo_id, path)` as a strip with score and band per version; the selected version's content as plain text with a heading outline (rendered with text nodes only, no HTML, no markdown dependency; very long bodies render in chunks and say so); a **line diff between any two versions** computed in the browser by a first-party diff, with a stated size above which it declines; the writing session, harness, `session_model`, screen verdict, scorer and per-check scores, each linking to its explorer. A missing body shows the server's `content_unavailable` reason.
- Non-goals: editing, annotating, rendering rich markdown or links from content, showing files the ledger does not store.

### Domain: Identity (UI)

- Owns: Login, OAuth callback, Device, Profile, Settings, sign-out.
- Contract: CONTRACTS.md sections 2, 3.5, 3.6, 3.7, 5 and 6 are authoritative and are implemented as written (the shipped transport, return-path and session-gate logic carried as plain ES modules). UI behaviour: sign-in is a real navigation to `<oauthApiBase>/oauth/login?return=<safe path>`; the callback page forwards the query with `credentials: 'include'`, never waits on `/v1/me`, and on denial or error shows the message and stays; the device page normalises the code to `XXXX-XXXX`, preserves it through sign-in, shows the requesting host, offers approve (tenant, scope, lifetime, name) and deny, shows the server's messages verbatim and never sends `redirect_uri`, `state` or `expires_at`; profile lists tenants and tokens, creates tenants, mints tokens (shown once, never stored or in the URL) and revokes; settings take the base URL and a pasted bearer with no reload; sign-out posts `/logout`.
- Non-goals: any server change to identity, the admin policy editor, registering a different GitHub callback.

### Domain: Serving, release and Pages

Release-owned identical static web tree for Pages and embedded binaries, generic cache/CSP/frame rules and preserved account routes. Pages deploys automatically on merge per the owner; the external job is not visible in this repo. API deployment is separate, handled by feature detection; no new manual deployment/configuration/secrets task. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.6](CONTRACTS.md#176-serving-release-and-pages).

### Domain: Test harness and fixtures

Verification-owned non-shipping deterministic multi-year fixtures and real-browser settled-state interactions, identity/legacy-server rigs, population/resource boundaries and both serving topologies. Synthetic data is test-only, never product evidence. Precise contracts, compatibility and non-goals are in [CONTRACTS.md 17.7](CONTRACTS.md#177-test-harness-and-fixtures).

## Architectural Implications

- **Stable docs at the pivot.** `docs/design/07-analytics-site.md` still describes the SvelteKit site as current; it now carries a banner pointing here, Phase 1 corrects the statements that become false when the package is deleted (the "static Svelte site" wording there and in `docs/design/system-architecture.md` row 7), and close-out promotes [CONTRACTS.md](CONTRACTS.md) into it. Two stale statements this design depends on were fixed with it: `docs/design/01-event-model-and-ingest.md` said hook facts carry `repo_id` (they do not), and `docs/design/03-remote-service.md` said commit facts carry `kind` and `plan` (they do not). `docs/design/03`'s route and table sections are updated in the phase that adds each route (3 to 6).
- **Contract changes beyond the UI.** The target adds bodies, entity/activity reads, Boolean cohorts, typed populations, scorer-aware baseline mode and resolution/budget metadata. Existing field names, omission defaults, legacy population units and auth semantics are preserved on existing requests; compatibility checks compare those fields/semantics while permitting documented additive metadata. Deliberate changes are removal of window refusals, bounded over-budget errors instead of aggregate truncation, timezone correctness and explicit partial coverage. Legacy nullable/money behavior is preserved in legacy fields; new entity fields and the UI apply the explicit null/lower-bound contract.
- **The p95 bound stays the performance contract.** Its benchmark domain gains all-time and `auto`; the 400-bucket exclusion that kept all-time out of it (`serve/analytics_bench_test.go:279-283,336-341`) is removed.
- **Deploy order.** Pages deploys on merge and the API deploys separately; the UI's capability detection is what makes any order safe. Nothing in this plan assumes the server is deployed before the PR merges.
- **Neighbouring plans.** Plan 22 also edits `/query` (action dimensions and a three-dimension allowance when all are `action_*`); Plans 21 and 24 edit MCP. These are separate designs/build branches, not capabilities assumed on master. Integration reconciles overlapping server surfaces without altering this design's grains or meaning; `session_repo` and `session_model` count against the existing two-dimension limit. Non-session fact types such as `session_action` or `review_run` must not inflate ordinary session event counts. Publication here uses documentation-only commits, without rebasing another worktree or touching their implementation.
- **Plan number and slug.** The plan key is the slug `analytics-reset`; folder `docs/plans/20-analytics-reset/`. Number 20 is unused on master (the earlier draft lived only on the unpushed local branch `analytics-reset`, which is left as it is) and nothing else on master references it. Plans 23 and 25 are unmerged drafts in other worktrees and are untouched.
- **Scope vocabulary for `refine` and `execute`.** *In scope* is everything the domains and phases name: routes, parameters, grains, joins, panels in the catalog, gestures, states, URL keys and test cases. *Delegated, not invented*: how uPlot's hooks are composed, SVG geometry, module and file naming inside the named surfaces, formatter and tooltip layout, the fixture generator's internals, SQL versus rollup, the algorithm of the diff and outline parser, and the options of phases marked `open`. *Bounce to design*: a new grain, join, route, dependency or gesture, a change to a contract in CONTRACTS.md, a measure the table does not list.

## Decisions

Taken by this design in headless mode (the judgement calls are also in the ledger):

1. **Direction.** Expansive first, prune later: a broad panel catalog over a few distinct engines; later user-authorised pruning must reconcile presets and phase outcomes explicitly.
2. **One workspace, not pages.** Boards of recomposable panels over one scope, cohort and selection model; explorers for entities; a ledger as provenance. The API explorer survives only as the per-panel capability inspector.
3. **Real scatter, real joins, or unsupported.** Every scatter, correlation and cross-lens view rests on a grain and join the server defines and publishes; everything else is shown as unsupported with the reason.
4. **No reporting-window maximum.** The 399-day clamp, the 400-bucket window cap and `range too wide` are removed; output size, deadlines and concurrency are the limits, all published in `/schema`, none hard-coded in the client.
5. **Server work is in this plan** (Phases 3 to 6) because no client-side join of these grains is honest or affordable; each server phase is provable at the HTTP level before any UI depends on it.
6. **Native, no build.** Web components and ES modules; uPlot as published is the only runtime dependency; first-party code for diff, outline and SVG charts; the SvelteKit package is removed, not ported.
7. **Pages by merge, API by hand.** The plan ends at a ready PR; the UI feature-detects the server.
8. **Design-only data stays design-only.** Absent actions/reviews are named capabilities, with existing lens/inspector extension points when their complete contracts are present; no substitute data is fabricated. Feedback delivery and uncaptured phase/outcome data are not success metrics.

## Assumption Ledger

### Assumption 1

- Question: How broad is "go more and genuinely different, we'll prune after"?
- Answer chosen: about 28 panels and 8 board presets (catalog above), 16 question paths, three explorers, a ledger; built on seven engines (time series, categorical and distribution SVG kit, scatter, lanes, matrix, reader and diff, the shared interaction model). Pruning removes registry entries and files.
- Rationale: the user asked for breadth and to prune afterwards; the cost of a panel is mostly the shared engines, so breadth over engines is cheap and breadth of near-duplicate pages is not.
- If wrong: user-authorised pruning removes catalog entries and the affected presets/outcomes are amended explicitly. Broader grains, joins or measures return to design; a supported panel variation stays within the registry contract.

### Assumption 2

- Question: One plan or a design-intent doc with sequenced plans?
- Answer chosen: one plan, 13 finite outcomes, in two tracks (server 3 to 6; UI 1, 2, 7 to 13) with a stated dependency graph.
- Rationale: the server work exists only to serve this UI, the user's core exploration needs both, and a split would put the honest dependencies in a different PR from their only consumer. The one clean seam, if sign-off finds this too large, is server (3 to 6) against UI (the rest), joined by `/schema.features`.
- If wrong: cut at that seam; the phases move unchanged.

### Assumption 3

- Question: Does the reset (deleting the SvelteKit package) belong in this plan, and may the old client be read?
- Answer chosen: yes, as Phase 1, because master still builds and embeds the old site. The original request forbade reading the old client; the new direction required establishing where 399 comes from, so master's `params.ts` and `buckets.ts` were read for that single question and nothing of the old page set, components or UX was inherited.
- Rationale: a design on top of a tree that still ships the old UI has to say how it leaves.
- If wrong: the removal becomes a separate prior PR; Phase 1 starts from the result.

### Assumption 4

- Question: Remove the window cap entirely, or raise it?
- Answer chosen: remove it. Replace with `bucket=auto`, a `max_cells` output budget equal to the existing 20,000-row budget, `too_many_cells` for explicit over-budget buckets, cursors for lists, deadlines, cancellation, a concurrency bound, and SQL or rollup aggregation. The retained boundary is the nanosecond-representable range, evidenced by the cursor and store arithmetic.
- Rationale: nothing evidences a data limit (no retention by age); the cap protected an unbounded in-memory aggregation that the replacement removes; a raised cap would be as arbitrary as 399.
- If wrong: if Phase 3 cannot bound all-time work within the p95 contract for some measure, that measure's all-time answer is refused with 503 `query_timeout` and a coarser suggestion, which is visible and evidenced, not a day count.

### Assumption 5

- Question: Are `max_cells` (20,000), `top_max` (100), the scatter point budget, the deadline and the content size fixed here?
- Answer chosen: `max_cells`, `top_max` and the content size are the existing evidenced limits (`store/query.go:94`, `analytics_query.go:71-75`, `serve/serve.go:27`); the scatter budget starts at 5,000 points and the deadline is measured in Phase 3; all are published in `/schema.budgets` and tunable by a server release without a client change.
- Rationale: budgets on output size are legitimate and must be visible; publishing them is what removes the hard-coded 399 and 400.
- If wrong: change the published value.

### Assumption 6

- Question: How is the missing repo lens solved?
- Answer chosen: derive it at session grain from the session's artifact and commit facts (`session_repo`), with `(multi)` and `(none)` explicit and the unattributed share reported. Do not attribute repo to hook rows.
- Rationale: hook rows have no repo, and a session can span repos; stamping a guessed repo on rows would be a fabrication and would need a history migration. Making hooks carry `repo_id` is a capture change (Open Question 2) that would improve the lens later without changing the contract.
- If wrong: on real data the unattributed share may be large; the lens still works and says so.

### Assumption 7

- Question: What is "model" for an artifact, given authoring, reviewer, scorer and harness are distinct?
- Answer chosen: four separate lenses: `harness` (as recorded), `session_model` (the model with at least 80 percent of the writing session's calls, else `(mixed)` or `(none)`; derived, labelled as the session's model), `scorer` (the configured scorer identifier on each check's score row), and, only when Plan 23 exists, `reviewer_model` and `build_models`. These provenance roles are never merged; score populations are not pooled across scorers by default; `(mixed)` and unknown are groups of their own.
- Rationale: the ledger records no author model, and the 80 percent value is a stated policy, not a measurement, so it is published and visible.
- If wrong: a different threshold is a server release; the `models` shares are always available for a user to see.

### Assumption 8

- Question: How are cross-grain filters expressed?
- Answer chosen: a bounded canonical JSON Boolean cohort predicate resolved through sessions; rectangle regions remain predicates, while small explicit clicks may use identity predicates within published complexity/URL budgets.
- Rationale: URLs and deep links must work, ids in URLs do not scale, and a stored cohort adds state to a read-only service; every grain here already shares `conversation_id`.
- If wrong: stored cohorts are an additive route later.

### Assumption 9

- Question: Should the server expose artifact bodies?
- Answer chosen: read-scope, tenant-bound complete promoted blobs only, hash-verified, no-store/nosniff text. Pending/rejected bytes are unavailable; unscreened is labelled. Oversized bodies are refused, never silently prefixed.
- Rationale: "drilling down into plans and what they contained" is not possible without content; bodies were scanned and screened at ingest and `search_artifacts` already returns snippets; the alternative (a local-only reader) cannot serve a hosted site.
- If wrong: restrict to admin or drop the reader, leaving version metadata and scores; Phase 12's reader degrades to history only.

### Assumption 10

- Question: How is plan cost reported, given sessions touch several plans?
- Answer chosen: `associated_cost_usd`, labelled non-additive, with `shared_sessions`; an additive `attributed_cost_usd` is shown beside it only when Plan 22 exists.
- Rationale: summing whole-session costs over plans double-counts; hiding the overlap would be a false precision; the segment-exact figure needs Plan 22's tags.
- If wrong: none; the label is part of the contract.

### Assumption 11

- Question: Are phases and reviews shown?
- Answer chosen: phases and briefs are parsed in the browser from the stored design and brief paths, for display only; no phase completion, review verdict or plan outcome is shown or inferred because none is stored (no commit messages, `IMPLEMENTATION.md` and `REVIEW.md` not ingested).
- Rationale: inferring from paths would present guesses as data.
- If wrong: a capture change (Open Question 3) then adds the data and the panels.

### Assumption 12

- Question: What are "quality outcomes"?
- Answer chosen: per-check comparative scores, scorer-specific percentile bands, screen verdict, process execution shape and rejection stage, each with its typed denominator. They are proxies and states, never real success/failure outcomes or a composite score.
- Rationale: the criteria state ratings are comparative proxies and no absolute pass mark is claimed (`packages/yakka/catalogue/criteria.json:3`, `docs/lab/QUALITY-CRITERIA.md:7`); no ingested field is a real outcome.
- If wrong: none until outcome data exists.

### Assumption 13

- Question: Pool scores across scorers?
- Answer chosen: facet by selected-check scorer by default, with per-kind/check/scorer content-hash baselines and explicit pooling only; latest scorer can differ across checks. A scorer identifier does not disclose the underlying TypeSafe runtime model or rubric revision.
- Rationale: prompt and rubric versions are not recorded, so scores under different scorers are not comparable.
- If wrong: pool by default; the toggle flips.

### Assumption 14

- Question: Scatter beyond the point budget?
- Answer chosen: a deterministic hash sample with `sampled`, `population_n` and population marginals; never a silent top-N.
- Rationale: a top-N scatter is a biased picture; a stable sample plus whole-population marginals is honest and reproducible.
- If wrong: raise the budget or paginate by region; contract unchanged.

### Assumption 15

- Question: uPlot for scatter and ECDF?
- Answer chosen: uPlot as published for time series, numeric-x scatter and step lines; if 2-D hit-testing at 5,000 points cannot be made to work on its hooks, a first-party canvas scatter behind the same element contract, not a second library.
- Rationale: the user approved uPlot as published; its cursor finds the nearest point along x only.
- If wrong: the fallback is already named.

### Assumption 16

- Question: Compare-mode colour, given entity colours are stable?
- Answer chosen: colour encodes exactly one thing per panel: the lens, or the cohort in compare mode (then small multiples carry the lens).
- Rationale: two meanings for one colour channel is the classic misread.
- If wrong: local to the chart kit.

### Assumption 17

- Question: Exclusions?
- Answer chosen: a server `exclude=<dim>:<value>`.
- Rationale: the old complement-of-facets workaround broke on large or unlisted domains and `conversation_id`; the request is for additive, exclusion and multi-select.
- If wrong: change the server exclusion implementation while preserving Boolean negation and the visible selection contract; no client complement workaround is accepted.

### Assumption 18

- Question: New browser storage?
- Answer chosen: three keys (`yakka-analytics-entity-colours`, `yakka-analytics-boards`, `yakka-analytics-follow-seconds`); the URL remains the saved view and the legacy keys stay unused; `yakka-analytics-saved-analysis` stays reserved and unused.
- Rationale: colour stability, named boards without a server table, and a testable follow interval.
- If wrong: drop the key; behaviour degrades to per-load colours or none.

### Assumption 19

- Question: Auto-refresh?
- Answer chosen: an opt-in Follow probe that only announces new data; no other polling.
- Rationale: "what is recent" needs a way to notice change; silent refetch would move numbers under the user's hand.
- If wrong: remove the toggle.

### Assumption 20

- Question: Test stack and fixture strategy?
- Answer chosen: Chromium via `playwright-core` (test-only, pinned, system browser), Node's runner, a real `yakka serve` on a deterministic synthetic multi-year ledger from a non-shipping Go generator, identity on a contract-faithful stub with host mapping, a legacy-server stub.
- Rationale: real gestures, real server semantics for the data (stubs drift), and the identity flow needs GitHub which a test cannot have.
- If wrong: any Playwright-compatible driver; the surface is `page.mouse` and `page.evaluate`.

### Assumption 21

- Question: Where does the site live and how does Pages find it?
- Answer chosen: `packages/yakka-analytics/web/`, `wrangler.toml` names `./web`, no build step; the plan states the output directory and does not touch the automation job.
- Rationale: the job is outside the repo; the safest failure (a Pages build that cannot find what it expects) leaves the previous deployment serving.
- If wrong: rename the directory or add whatever the job expects; both are mechanical (Open Question 1).

### Assumption 22

- Question: Security headers and CSP breadth?
- Answer chosen: frame denial and one CSP, identical in `_headers` and the embedded handler (test-compared); `connect-src` wide so Settings can name any collector.
- Rationale: CONTRACTS.md 9 and 13.2; a narrower policy would break the contract's own Settings feature silently; content is rendered as text nodes only.
- If wrong: tighten both together; the equality test catches a one-sided change.

### Assumption 23

- Question: Browsers and touch?
- Answer chosen: evergreen Chromium, Firefox and Safari by construction; only Chromium exercised; touch via a Select mode button and tap-to-inspect; single column under 900 px.
- Rationale: one real browser is what the environment has; touch parity is a baseline, not pixel work.
- If wrong: add engines to the harness.

### Assumption 24

- Question: Markdown and diff without dependencies?
- Answer chosen: a first-party outline and plain-text renderer (text nodes only) and a first-party line diff with a declared size ceiling.
- Rationale: no dependency is allowed to enter for display of text that is user content; rendering it as HTML would be an injection surface.
- If wrong: a vendored single-file library by ledger entry and CSP review.

### Assumption 25

- Question: Is Plan 21 delivery state or Plan 24 MCP data part of analytics?
- Answer chosen: no. Plan 24 is the agent surface and shares no analytics code; Plan 21 states are delivery states, not outcomes; its synthetic sessions are labelled by `origin`.
- Rationale: stated non-goals of both plans and a risk of double counting otherwise.
- If wrong: additive later.

### Assumption 26

- Question: Does the earlier open Overview, window and product hold block this plan?
- Answer chosen: no; the new direction settles them (expansive workspace, no window cap, uPlot as published), so the earlier open questions on directory name, minification, window length and page set are closed by decisions above, and the priced flag and exclusion filter moved into scope.
- Rationale: the user answered them.
- If wrong: none.

### Assumption 27

- Question: Which observation does a quality split count?
- Answer chosen: aggregate quality keeps legacy distinct-hash observations, canonicalised within eligible facts; file/reader/scatter observations remain `(repo_id,path)` with separate counts. Baselines use explicit kind/check/scorer content mode.
- Rationale: duplicate bytes across paths/repos otherwise make split totals impossible to reconcile, and pooled baselines would defeat scorer separation.
- If wrong: changing an observation unit is a contract/design change, not client deduplication.

### Assumption 28

- Question: What makes unbounded-history exploration and selection finite?
- Answer chosen: calendar/year-step resolution, cell budgets, bounded Boolean predicates/URLs, cursor-paged details/activity, typed populations, deadlines and cancellation for every dependent read; full-content overflow is a visible refusal.
- Rationale: a point sample, monthly ceiling or clipped detail list cannot define a truthful population or preserve all available history.
- If wrong: tune measured resource budgets or the server aggregation strategy; preserve the selected date window, denominator and explicit error semantics.

### Assumption 29

- Question: What do cross-grain exclusion and time-scatter selection mean?
- Answer chosen: resolve a positive source predicate to sessions, then include or exclude those sessions in the target. Time buckets resolve to their observed contributing sessions, with source measures/resolution fixed and missing associations reported.
- Rationale: complementing artifact predicates before the join retains sessions that also wrote a nonselected artifact; aggregate bucket selection also needs an explicit membership rule. Neither operation establishes causation.
- If wrong: revise the join contract and affected phase outcomes explicitly; never silently switch complement order or infer pairings.

## Open Questions

None blocks a phase. Each has a default already designed in.

1. **What the Pages automation executes.** The job is outside the repo (no `.github`, no deploy script; `wrangler.toml` has only `name` and `pages_build_output_dir`). If it runs a build command or expects `./build`, the first post-merge Pages build fails and the previous deployment keeps serving. Resolved by one look at the Pages project settings or first deploy result; nothing in this plan can or should change it.
2. **Whether hooks should carry `repo_id`.** A capture change (hook events built without it, `facts/facts.go:132-134`, `yakka.py:556-563`) would give cost and activity a direct repo; the derived `session_repo` lens works either way. The size of its unattributed share on real data is unknown until Phase 4 measures it.
3. **Plan, phase and outcome data capture.** Phase completion, review verdicts and merged-PR or CI outcomes are not ingested by any design. Until a capture exists the workspace shows no plan outcome; this is a capture problem, not a UI one.
4. **Real-ledger benchmark evidence.** The p95 proof on the real ledger needs `YAKKA_BENCH_DIR` and the owner's data; the fixture bench is the gate, the real run is evidence the owner can add.

## Phases

The count/order is fixed at this headless checkpoint: 13 outcome phases. Phase 1 precedes the server track (3–6), identity (2) and chart track (7–8); integration starts only after their declared dependencies. Future execution refines one phase at a time; this design publication performs none of them. Open approaches use divergent candidates against the fixed outcome, not extra scope or a claim that a chosen algorithm already exists.

### Phase 1 — Reset and shell

- Outcome: From a clean checkout, the release process embeds the no-build `web/` tree without Node/npm and restores the committed placeholder. Direct URLs render the shell (unknown paths render not-found), the browser can read the deterministic fixture summary, and a legacy server's limits render without a clipped retry. URL state round-trips; requests deduplicate, abort when superseded and never exceed four in flight. A CSP-compatible external bootstrap applies stored theme before first paint. Generic cache/security headers and vendored uPlot integrity are verified; no shipped secret or framework remains. The fixture manifest covers every later population, chronology and resource boundary in the test contract.
- Surfaces: `packages/yakka-analytics/` (remove the SvelteKit package, add `web/`, `tests/`, a README keeping the four fields `tools/release/test_layout.py` checks), `packages/yakka-analytics/wrangler.toml`, `tools/release/build.sh` and `test_release.py`, `Dockerfile` and `.dockerignore`, `packages/yakka/internal/serve/{site.go,site_test.go,analytics_pageset_test.go}`, the fixture generator in `packages/yakka`, `.gitignore`, `docs/design/07-analytics-site.md` and `docs/design/system-architecture.md` (statements that become false), CONTRACTS.md sections 1, 10 and 11.
- Approach: open (generating the deterministic multi-year fixture ledger through the store with bodies and scores).
- Depends on: nothing.

**Units**

| Unit | Brief | Depends on | May run alongside |
|---|---|---|---|
| Deterministic fixture ledger | [1-01-fixture-ledger](briefs/1-01-fixture-ledger.md) | Nothing | Framework-free shell |
| Framework-free shell | [1-02-framework-free-shell](briefs/1-02-framework-free-shell.md) | Nothing | Deterministic fixture ledger |
| Release and embedded serving | [1-03-release-and-serving](briefs/1-03-release-and-serving.md) | Deterministic fixture ledger; Framework-free shell | Nothing |

### Phase 2 — Identity flows

- Outcome: On the Pages-faithful identity rig, a signed-out deep link signs in through the callback and returns to its safe original path; a denied/failed/redirected callback stays with its error. Device approval preserves and normalises the code, presents the host, approves or denies with exactly the current server fields and shows failures verbatim. Profile tenant/token operations, no-tenant recovery, bearer Settings and sign-out follow the preserved contract. The one-time issued token is absent from storage/URLs/reload; credential and secret checks pass.
- Surfaces: `web/js/identity/`, `web/js/core/` (session gate wiring), `web/contract/`, `tests/identity/`, `tests/stub-api/`.
- Approach: known (CONTRACTS.md specifies every route and message).
- Depends on: Phase 1.

### Phase 3 — Bounded range reads

- Outcome: Source/HTTP verification removes every width-only refusal. Representative all-history and ten-year requests succeed within resources; `auto` preserves their dates while choosing finer resolution on zoom, including a multi-century/two-dimension case requiring year steps. Explicit cell/series overflow reports the documented budget and suggestion; pre-epoch data and exact nanosecond bounds behave correctly. Event cursors traverse beyond 20,000 without gaps/duplicates. Cancellation/deadline/concurrency release readers and return the specified errors; usage/distribution/score reads allocate Go heap independently of scanned rows, including more than 32,766 scored hashes. Timezone, pricing flags and partial coverage are consistent. The benchmark includes all-time/auto under the existing p95 bound.
- Surfaces: `packages/yakka/internal/serve/analytics*.go`, `packages/yakka/internal/store/{query,usage,analytics,score_series,distribution,conversation,rollup}.go`, `analytics_bench_test.go` and the analytics tests, `docs/design/03-remote-service.md` and CONTRACTS.md sections 7 and 12.
- Approach: open (SQL aggregation, a day-grain rollup, or both, and how cancellation reaches the driver).
- Depends on: Phase 1 (the fixture generator).

**Units**

| Unit | Brief | Depends on | May run alongside |
|---|---|---|---|
| Range resolution and budget responses | [3-01-range-resolution](briefs/3-01-range-resolution.md) | Nothing | Nothing |
| Bounded aggregate storage reads | [3-02-bounded-aggregation](briefs/3-02-bounded-aggregation.md) | 3-01 | Nothing |
| Paged reads and honest coverage | [3-03-paged-reads-and-coverage](briefs/3-03-paged-reads-and-coverage.md) | 3-01, 3-02 | Nothing |
| Runtime bounds and benchmark | [3-04-runtime-bounds-and-benchmark](briefs/3-04-runtime-bounds-and-benchmark.md) | 3-01, 3-02, 3-03 | Nothing |

**Carried from Phase 2**

- Reuse the 32,767-hash fixture once per setup: absorbed into 3-02.
- Playwright identity-flow acceptance: bounced from Phase 3; it verifies Phase 2 UI behavior and does not bear on Phase 3 server outcomes.
- External Pages output-directory check: bounced from Phase 3 to release readiness; it is not a Phase 3 server dependency.

### Phase 4 — Capability schema and session grain

- Outcome: The schema advertises exactly the implemented session/time/entity modes, budgets, lens/null/time rules and typed coverage; later-phase capabilities remain absent. On the fixture, session repo/model/harness provenance is stable across window changes, unknown/mixed/multi groups are explicit, additive sums reconcile, and null/lower-bound/no-call money differs correctly. Session rows page and sort by every supported measure; legacy counts agree on matching eligibility, with documented lifetime-derived lens differences exposed. Numeric predicates, deterministic scatter samples, whole-population marginals, time-grain shared bucket grids and session aggregates match fixture populations. Exclusions work server-side. Existing response fields and defaults retain their legacy meaning, permitting the documented additive metadata and corrections.
- Surfaces: `serve/analytics_query.go` (schema), new `serve/analytics_entities.go` (including time-grain mode), `store/{query,distribution,analytics}.go` and new session-entity store code, golden tests, CONTRACTS.md 7, `docs/design/03-remote-service.md`.
- Approach: open (computing session attributes within the budgets: join, rollup, or both).
- Depends on: Phase 3.

### Phase 5 — Artifact entities, scores by lens, content

- Outcome: Artifact lists/history page by the declared identity and version order, expose selected-version writing sessions and per-check scores/scorers, and distinguish file populations from hashes. Fixtures with identical bytes across paths/plans/repos prove quality split counts partition the same eligible hash population; rescoring/different scorers across checks prove scorer-specific baselines and bands. Artifact aggregate/scatter/size modes report missing data honestly. Content reads return only authorised complete bytes matching their hash; other-tenant/unknown/pending/rejected cases, integrity failures and oversized refusals obey the contract. Unstored file kinds never appear as readable content.
- Surfaces: new routes in `packages/yakka/internal/serve/`, store artifact read paths (`store/store.go`, `store/reads.go`, `store/score_series.go`), tests, `docs/design/03-remote-service.md` and CONTRACTS.md 7.
- Approach: known (reads of existing tables; the observation/partition rules are fixed in CONTRACTS.md 17.3).
- Depends on: Phase 4.

#### Units

| Unit | Brief | Depends on | Runs alongside |
|---|---|---|---|
| 5-01 Artifact identity, history and observations | [briefs/5-01-artifact-entities.md](briefs/5-01-artifact-entities.md) | Phases 1–4 | Nothing; establishes artifact observation semantics for 5-02. |
| 5-02 Hash-weighted scores by lens | [briefs/5-02-scores-by-lens.md](briefs/5-02-scores-by-lens.md) | 5-01 | Nothing; shares score/read and schema surfaces with adjacent units. |
| 5-03 Bounded artifact content reads | [briefs/5-03-artifact-content.md](briefs/5-03-artifact-content.md) | 5-02 | Nothing; route registration and capability schema are already established. |
| 5-04 Artifact schema, score bands and writing-session measures | [briefs/5-04-artifact-schema-and-bands.md](briefs/5-04-artifact-schema-and-bands.md) | 5-01, 5-02, 5-03 | Nothing; closes capability publication and artifact-row integration after the routes land. |

Phase 4 carried items were reviewed. Null revision identifiers remain valid under CONTRACTS.md 17.2; stable local identifiers do not exist, and Phase 5 does not add a source or alter that contract. Session aggregate dimensions remain unsupported and are outside Phase 5's artifact/content contracts. Both remain documented Phase 4 limitations; no Phase 5 work is authorized to change them.

Refinement verdict: **Proceed**, three sequential units. The fixture ledger and existing schema, artifact, score and blob paths are available locally; no live service, production ledger or credential is needed. No additional orchestrator decision is required.

### Phase 6 — Plan and execution entities and the cohort predicate

- Outcome: Plan/execution entities and each independently paged detail collection match fixture identities, counts and process shapes. Shared-session plan costs show overlap and missing pricing. Cohort predicates support union, negation, subtraction and fixed source scopes across every listed route: empty source sets include nothing or exclude nothing respectively; invalid/over-budget/unsupported requests return named errors. A session writing both low- and high-score artifacts proves that board exclusion subtracts the resolved positive session set rather than resolving the complemented artifact predicate. Cross-grain responses explain expansion within typed units. Cursor watermark/revision changes are safe. The merged activity feed pages deterministically and the receive-watermark probe counts late arrivals without fetching raw history. Entity, aggregate, marginal and cohort operations meet the same memory/deadline/cancellation/benchmark contract.
- Surfaces: `serve/analytics_entities.go` and proposed activity handler, `store` plan, execution, activity and cohort resolution code, the analytics routes' filter parsing, tests, CONTRACTS.md 7.
- Approach: open (resolving a cohort inside one statement without materialising ids).
- Depends on: Phases 4 and 5.

### Phase 7 — Time-series chart kit

- Outcome: In the browser gallery, real mouse/keyboard/touch interactions on line, area, stacked columns, cumulative/share, ECDF and numeric scatter produce the interaction contract's settled states. Hover/inspect, selection union/subtraction, brush versus zoom, pan, legend behavior and history are verified using chart coordinates and the table view. Scatter hit-testing and rectangle membership match an independent reference at the point budget. Resolution/sample/coverage badges and both themes are correct. If uPlot cannot carry scatter, the declared first-party canvas fallback satisfies the same proof without another dependency.
- Surfaces: `web/js/charts/` (`yk-chart`, tooltip, legend, gestures, scale groups, colour registry, formatters), `web/css/`, `tests/gallery/`, `tests/charts-time/`.
- Approach: open (composing uPlot's hooks into the gesture table; 2-D scatter hit-testing).
- Depends on: Phase 1.

### Phase 8 — Distribution and categorical chart kit

- Outcome: The same gallery proves ranked/stacked/100-percent/lollipop/slope bars, ranges/histograms/strips, heatmap/calendar, lanes and treemap support applicable inspect/selection/legend and accessible-table behavior. Values match fixture data; entity colours/styles remain stable across chart engines and filters. Unknown/mixed/multi/unscored/other styles stay distinct and both themes pass the palette check. Keyboard and touch reach every action without hover dependence.
- Surfaces: `web/js/charts/` (the five elements), `tests/gallery/`, `tests/charts-cat/`.
- Approach: known (SVG with the shared tooltip, legend and registry).
- Depends on: Phase 7.

### Phase 9 — Workspace engine, Start and Pulse

- Outcome: Start question paths open their configured destinations or state the missing capability. Pulse renders its complete preset against the fixture; feed/brush/zoom/Follow probe and acknowledgment behave as contracted, including late arrivals. All-history scope and ordinary long finite windows survive deep links/Back. Shared state, chips, tray and typed populations stay visible, with unsupported joins/ignored filters named. The panel chooser is schema-driven, saved boards reopen from their URL, the capability inspector explains provenance, `/ledger` cursor-pages beyond 20,000, and `/ops` shows only authorised status. Loading/abort/empty/error/unsupported and old-server cases are exercised. Later preset destinations are named until delivered; P13 verifies all links.
- Surfaces: `web/js/core/`, `web/js/panels/` (registry and the Phase 9 panels), `web/js/boards/`, `web/js/explorers/ledger*`, `web/js/ops*`, `tests/workspace/`.
- Approach: open (the panel engine, view spec codec and the linking model are new).
- Depends on: Phases 1, 2, 3, 4, 5, 6, 7 and 8.

### Phase 10 — Trends, Compare, Quality, Cost and Tools

- Outcome: From each of Trends, Compare, Quality, Cost and Tools, changing a supported measure/lens/chart regroups the preset's panels with stable surviving styles. Every panel assigned to P10 in the preset matrix is delivered. Long-history auto resolution and zoom preserve dates; finite period/cohort comparisons show both populations and coverage. Quality separates check/scorer/hash versus file observations, displays scorer-specific baselines/bands and opens the correct artifact inspector (reader delivery is P12). Model/repo/harness cost and tool investigations preserve unpriced/unattributed/mixed groups, numeric eligibility and named unsupported joins. All modes, linked actions and table values match the fixture.
- Surfaces: `web/js/panels/` (trend, compare, quality, cost and tool panels), `web/js/boards/` presets, `tests/trends-quality/`.
- Approach: known.
- Depends on: Phases 3, 4, 5, 7, 8 and 9.

### Phase 11 — Scatter lab and Sessions

- Outcome: From Scatter, numeric axes/size and categorical colour are schema-valid across session/artifact/plan/time grains; samples are labelled and marginals match whole populations. Rectangle unions/subtractions and explicit tray actions produce server-resolved cohorts; peer costs/quality/plan associations reconcile within their own units and disclose expansion. Time-cohort fixtures prove frozen source fields/resolution, half-open bucket boundaries, distinct contributing sessions, missing rejection associations and expansion into the target window. Unsupported cross-grain pairings say why. Sessions sort/page server-side and detail links to observed artifacts/plans. The timeline distinguishes priced/unpriced returned events; when the 5,000-event cap applies, displayed markers reconcile only with returned-event counts, while omitted events and whole-run unpriced totals remain separate, with a paged ledger link. A fixture puts unpriced calls beyond the cap.
- Surfaces: `web/js/panels/` (scatter panels, session lanes), `web/js/explorers/sessions*`, `web/js/boards/`, `tests/scatter-sessions/`.
- Approach: known.
- Depends on: Phases 4, 5, 6, 7, 8, 9 and 10.

### Phase 12 — Workflow, Plans and the artifact reader

- Outcome: From Workflow and Plans, grouped process shapes, plan cost ranking/scatter and version/execution timelines open the relevant plan. Plan detail pages artifacts/executions/sessions/events and shows stored design phase headings/outcomes and brief paths as content context, without inferring phase completion or review outcomes. Artifact reader navigation, per-version metadata and bounded text-only content connect bidirectionally to plans/sessions. Two-version line diff matches the fixture, declines above its stated size ceiling and never diffs unavailable/incomplete text. Malicious HTML/script content stays inert; missing/oversized bodies show exact reasons. Every catalog panel and all three explorers are now delivered.
- Surfaces: `web/js/explorers/{plans,artifact}*`, `web/js/panels/` (plan panels), `tests/plans-artifacts/`.
- Approach: open (the diff algorithm, outline parsing and chunked rendering of long bodies).
- Depends on: Phases 5, 6, 8, 9, 10 and 11.

### Phase 13 — Release readiness

- Outcome: The complete preset/gesture/state/deep-link matrix passes against both the release binary and Pages-style static serving, including old-server capability degradation. Account flows pass the Pages-faithful rig; embedded local `/device` and `/oauth/callback` serve the shell while remote `/oauth/callback` retains the API JSON route. Browser-recorded request shapes including all-history are covered by server smoke/benchmark tests under the existing p95 contract; Go, release-layout/placeholder, residual-name and secret checks pass. Stable route/docs and package instructions describe the final no-build output, automation-on-merge Pages deployment and separate API release. The ready implementation PR carries the plan marker; no manual deploy/configuration/secrets action is a phase outcome.
- Surfaces: `packages/yakka/internal/serve/analytics_pageset_test.go` and its data, `tests/` (a mode that records request shapes and one that targets the embedded binary), `packages/yakka-analytics/README.md`, `docs/design/03-remote-service.md`, `docs/plans/20-analytics-reset/CONTRACTS.md`.
- Approach: known.
- Depends on: Phases 1 to 12.

## Provenance Notes

- **What changed from the earlier draft of this plan.** The earlier draft (local only, never pushed) specified eight pages derived from twenty questions, each a view of an endpoint, a 399-day maximum, no server change, and a client-side workaround for every gap. This design replaces it: the unit is a lens-and-grain workspace, the server gap list became owned scope, the window cap is gone, and the earlier open questions on directory, minification, window length and the priced flag are closed. What survives is the evidence and the parts that were right: CONTRACTS.md (corrected), the uPlot research, the brush-versus-zoom distinction, the gesture and settled-state test discipline, the Pages-faithful identity rig and the no-secret check.
- **Why server work is in scope.** Each of the three honest gaps (cost and score at one grain, artifact content, a repo lens for cost) is impossible to fix in the browser: the joins need row-level data the routes do not return, the content is only on the server's disk, and the repo is only recoverable through artifact and commit facts. Faking them client-side would produce the scatter the user asked not to have.
- **Why a cohort predicate.** Continuous regions and large cohorts stay as bounded Boolean predicates resolved through sessions. Small explicit mark selections may use bounded identity predicates; sampled scatter marks never stand in for the selected population.
- **Why `max_cells` is not a reporting-window cap.** It bounds output, is based on the existing row budget and is published. Calendar/year-step coarsening preserves the requested window; excess series or an expired query returns a visible resource error rather than a shorter hidden date range.
- **Why a derived `session_model` and not an author model.** The ledger records the models of a session's calls and nothing about who wrote a file; calling the dominant model "the author" would assert more than is known. The name, the 80 percent policy value and the `(mixed)` bucket keep the claim to what is measured.
- **Rejected alternatives.** ECharts (190 to 360 KB gzip; not needed; the research's named fallback is now first-party canvas for the one thing uPlot may not carry); Chart.js, Observable Plot, d3 modules (bare imports need a map or a bundle); a dashboard builder with saved server-side views (a URL and a list of URLs are enough); porting any Svelte component; a composite quality score (checks are not commensurable); inferring phase completion from paths.
- **If sign-off judges 13 phases too large**, the seam is server (3 to 6) against UI (1, 2, 7 to 13), consumed through `/schema.features`; the phases move unchanged.
- **Inputs and method.** Ground is source-based at verified remote master `b2094ebab597243bd7e22b7c9f7794e145b5d959`, reusing the prior session's five narrow recon reports and research; current schema, cap, usage aggregation, score/blob/identity and release contracts were checked in source. No production/private ledger or credentials were read. The final independent review used a clean-context inherited Codex subagent; its exact backend model was not exposed, and it is not represented as Sonnet or Haiku. Its findings on populations, predicates, budgets, scorer baselines, chronology, pagination, board ownership, sequencing and content integrity were applied. This is headless design sign-off only; it authorizes no product build or deployment.
