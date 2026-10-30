# Design Intent 7: Analytics Site

The person-facing view of one tenant's yakka ledger: read-only aggregate routes on `yakka
serve`, and a static Svelte site that renders them. Part of
[system-architecture.md](system-architecture.md); it reads the service in
[03-remote-service.md](03-remote-service.md) and is a separate surface from the agent's
[04-advisory-surface.md](04-advisory-surface.md).

## Shape

`packages/yakka-analytics` is a SvelteKit site built with the static adapter to `build/` (HTML,
CSS, JS; no SSR). Locally, and in release binaries, `yakka serve` embeds that build and serves it
on the same origin as `/v1`. The production Fly image does not embed it. Pages hosts
`https://yakka.build` and `https://www.yakka.build`; the API is `https://api.yakka.build`
(`YAKKA_PUBLIC_URL`). Sign-in starts at `/login`. On Pages that link navigates to the API
`GET /oauth/login`, which sets the host-only state cookie and sends the browser to GitHub.
GitHub's registered callback stays `https://yakka.build/oauth/callback`. That Pages page shows
status and sends a credentialed request to the API `/oauth/callback`. The API sets the host-only
`workflow_session` cookie and returns status JSON. It does not redirect. Dashboard session routes
use `credentials: 'include'` and no bearer. `GET /v1/me` supplies the GitHub identity and owned
tenant list; data routes carry `?tenant=` from that response. Analytics `GET`s may still send a
pasted bearer from `/settings`. Aggregation stays in SQLite; the browser receives JSON aggregates and
one capped tabular slice. The site never receives hook bodies. Analytics is HTTP for a person, not an MCP tool: a dashboard does not
change what the agent does in a run (principle 2).

| Route | Surface | Lens |
|---|---|---|
| `/` | Landing and investigation | With an empty query string, two `ask: trend` charts for `hook_events` and `cost_usd`, same window and bucket. With investigation query params (`ask`, measures, dimensions, bucket, window, shared filters), the interactive analysis shell: trend and breakdown charts, usage, quality, conversations, and saved analyses as tools — not the nine KPI tiles or a twelve-tile dashboard grid. |
| `/trends`, `/usage`, `/repos`, `/hooks`, `/quality`, `/executions`, `/conversations`, `/conversation`, `/explore`, `/builder`, `/dashboards` | Retired report URLs | Paths remain routable but render a short retirement notice; they do not mount the pre-redesign report UIs. The jobs those pages covered are reached from investigation on `/` (breakdowns, tools, pasted URLs). There is no dedicated `/explore` pivot or multi-tile dashboard. |
| `/settings` | Connection | API base URL and bearer token for a cross-origin deployment |
| `/device` | Device approval | Shows the `user_code` large with "check this matches your terminal"; the signed-in user picks tenant, scope and expiry and approves or denies; entry field when no code is given; signed out, it links to sign-in and returns with the code |
| `/login` | Sign-in | Collector only: GitHub OAuth entry and denied-admission message |

Investigation on `/` holds one filter set and analysis spec in the page URL: window presets or
`from`/`to`, `ask` and chart fields (`measure`, `dim`, `bucket`, `kind`, …), and shared dimensions
`repo_id`, `harness`, `kind`, `plan`, `norm_event`, `event`, `tool`, `model`, `source`,
`conversation_id` (including exclude keys `x.<dim>`). Pasting the query string reproduces the
analysis. **Saved analyses** live in `localStorage` under `yakka-analytics-saved-analysis` as
`{"id","name","spec"}` where `spec` is the same aggregate request shape the URL encodes (not a
`{report, params}` dashboard tile). The collector knows the signed-in GitHub user via the session,
not via a server-side view store.

What the request's words mean on the ledger: an **agent** is a `conversation_id`; a **hook** is a
`hook_event` split by `event` and `payload.tool_name` (no cross-harness tool taxonomy); **build /
design usage** is the design → brief → commit → report shape, not CI or driver cost; **usage and
cost** are the model calls, tokens and cost the harnesses report; an **analysis
type** is the artifact kind plus its check distributions.

## Analytics reads

Additive `/v1` routes. Every analytics `GET` resolves the tenant exactly as `GET /v1/artifacts`
does: local mode maps to tenant `local` and ignores any token and any session; remote collector mode
accepts either `Authorization: Bearer` (issued token) or a `workflow_session` cookie with `?tenant=`
for a tenant the session owns; a cross-origin Pages client sends only the pasted bearer from
`/settings`. `GET /v1/health` stays unauthenticated and is not an analytics route. Unknown routes
under `/v1/` are JSON 404; errors are `{"error":"<text>"}`. The routes read only the ledger's columns: no payload bodies (the ledger holds none, design 1), no
artifact text and no search snippets. Model, token and cost fields are served as aggregates and as
per-call rows in the conversation timeline.

### Shared filter

- `from`, `to`: RFC3339, inclusive. Omitted `to` is now; omitted `from` is `to` minus 30 days
  (**judgement**: a default, not a measured workflow length). `all=1` replaces `from` and means the
  whole ledger (`/query` only; the other routes reject windows over 400 days, so the site clamps All
  time to 399 days there and says so).
- `tz`: IANA name, default `UTC`. Bucket boundaries and the `hour_of_day` and `weekday` dimensions
  use it; an unknown name is 400 `{"error":"invalid tz"}`.
- More than 400 buckets of the requested unit is 400 `{"error":"range too wide"}` (**judgement**: a
  response-size cap).
- `repo_id`, `harness`, `kind`, `plan`, `norm_event`, `event`, `tool`, `model`, `source`,
  `conversation_id`: repeatable; OR within a parameter, AND across. `kind` is `design`, `brief` or
  `report`, else 400. `/scores` instead requires exactly one `kind` (else 400 `{"error":"kind
  required"}`).
- On `/query`, a filter on a dimension the requested measure does not carry is ignored and its key is
  listed in `ignored_filters`, instead of silently dropping the measure to zero.
- `kind` and `plan` are columns filled at ingest from the path with the rules of `keys.Kind`:
  `docs/plans/<plan>/DESIGN.md`, `docs/plans/<plan>/briefs/<file>.md`,
  `docs/plans/<plan>/reports/<file>.md`. Nested brief paths have no kind and count as `other`.
- Usage clocks use `facts.ts` (event time). Rejection counts and rejection rows use `rejections.at`.
- Reads use indexed columns and, for whole interior hours of a time-only window, the hourly rollup
  tables ([design 3](03-remote-service.md#tables)); the two partial edge hours read base rows, so the
  result equals aggregating base rows alone. While the ledger is uncompacted (`/v1/health`
  `compaction` is `required`), `/query` responses carry `"partial": true`.

### Routes

- `GET /v1/analytics/facets` — `{"repos","harnesses","kinds","plans","events","norm_events","models","tools":[{"name","n"}],"checks":[{"kind","name"}]}`.
  Distinct values on in-window facts (called with the window only); `tools` is the 100 most frequent
  `tool` on hook events; `checks` is the whole catalog from `GET /v1/checks`.
- `GET /v1/analytics/summary` — `from`, `to`, `conversations` (distinct), `hook_events`,
  `artifact_versions`, `distinct_content`, `by_kind {design,brief,report,other}`, `by_source
  {worktree,commit}`, `commits`, `rejections {precheck,screen}`, `screens {pass,unscreened}`
  (distinct in-window content hashes by latest screen verdict), and the usage totals `model_calls`,
  `unpriced_calls`, `cost_usd` and `tokens_*`. Health's `pending` and
  `screen_gaps` stay point-in-time gauges.
- `GET /v1/analytics/series` — `metric` and `bucket` (`day`, or `week` = ISO Monday, UTC) required;
  `group` defaults to `none` (one series keyed `"all"`). Allowed pairings, anything else 400:
  `hook_events`: `harness`, `repo_id`, `event`, `tool`; `artifact_versions`: `harness`, `repo_id`,
  `kind`, `plan`, `source`; `commits`: `harness`, `repo_id`; `conversations` (distinct per bucket):
  `harness`; `rejections`: `stage`. Missing values key as `""`. Series are sparse: a bucket with no
  rows has no point. These metrics are counts; the site zero-fills a gap only on count series, and
  leaves a score-series gap (see Site).
  Response `{"bucket","series":[{"key","points":[{"t","n"}]}]}`.
- `GET /v1/analytics/scores` — `{"kind","checks":[{"name","n","min","p25","median","p75","max"}]}`,
  one object per catalog check for the kind. Population: distinct in-window content hashes of that
  kind, latest score per `(content_hash, check)`. Percentiles use the baseline method (sorted values,
  position `(n-1)*q` with linear interpolation, rounded to 3 places); empty is all zeros. This never
  writes or replaces `GET /v1/baselines`, which stays all-time; `/quality` shows the two side by side.
- `GET /v1/analytics/distribution` — `measure` is required: one of `cost_usd`, `tokens_in`,
  `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `tokens_reasoning`; else 400
  `{"error":"unknown measure <m>"}`. `grain` is `call` (default) or `conversation`; else 400
  `{"error":"unknown grain <g>"}`. `dim` is omitted or `model`; any other dimension is 400
  `{"error":"unsupported dimension <d> for <measure>"}`. Call grain: one value per model call in the
  window (the same call identity `model_calls` uses). Conversation grain: one value per conversation,
  the sum of that measure over its calls; the conversation's `model` is the most frequent model on
  those calls, ties to the smaller name, `""` when it has none (same rule as the conversation list).
  For `cost_usd`, `n` is priced calls, `unpriced` is the rest, and percentiles and bins use priced
  calls only; for a token measure, `unpriced` is 0 and every call is in `n` and in the bins.
  `repo_id`, `harness`, `model`, and `conversation_id` apply; `kind`, `plan`, `norm_event`, `event`,
  `tool`, and `source` are ignored and listed in `ignored_filters`. Response
  `{"measure","grain","dim","rows":[{"k","n","unpriced","min","p25","median","p75","p95","max","bins":[{"lo","hi","n"}]}],"truncated"?,"ignored_filters"?}`.
  `k` is the model, or `"all"` when `dim` is omitted. `top` defaults to 20, max 100, orders rows by
  `n` descending; there is no `__other__` row; `truncated` is true when keys were dropped. Percentiles
  use the `/scores` method; cost is rounded to 6 decimal places, token measures to 1. Bin edges are
  fixed so models share an axis: tokens — a zero bin, then `[2^i, 2^(i+1))` for `i` from 0 through
  19, then overflow at `2^20`; cost — a zero bin, `(0, 10^-4)`, then `[10^i, 10^(i+1))` for `i` from
  -4 through 1, then overflow at `100`; `lo` inclusive, `hi` exclusive, except the overflow bin has
  no `hi`. Scans existing columns; no hourly rollup and no `partial`. Wider than 400 days is 400
  `{"error":"range too wide"}`.
- `GET /v1/analytics/score-series` — `kind` is required, exactly one of `design`, `brief`, `report`.
  `bucket` is required: `day`, `week`, or `month`. Wider than 400 days, or more than 400 buckets, is
  400 `{"error":"range too wide"}`. `t` is the bucket start, RFC3339 in `tz`; `week` starts Monday
  and `month` starts on the first, both in `tz` (same `t` rule as the executions `series`). A
  point's population is distinct content hashes with a version timestamp in that bucket; several
  versions of one hash in the bucket contribute the latest; a hash can appear in more than one
  bucket (not the same population as `GET /v1/analytics/scores`, which is latest per hash over the
  whole window). Response
  `{"kind","bucket","checks":[{"name","points":[{"t","n","p25","median","p75"}]}]}`. Points are
  sparse; checks with no points are omitted. Percentiles use the `/scores` method, rounded to 3
  decimal places; no `partial`.
- `GET /v1/analytics/executions` — grain is one brief `(repo_id, conversation_id,
  docs/plans/<plan>/briefs/<stem>.md)` with an in-window version. Row `shape` is `complete` (the
  conversation has a commit in that repo and a version of `reports/<stem>.md` exists in that repo),
  `unreported` (commit, no report) or `started` (no commit); commit and report facts count even
  outside the window. Repeatable query `shape` (`complete`, `unreported`, `started`; else 400
  `{"error":"unknown shape <s>"}`) OR's values; omitted means all rows. `shape` filters `rows` and
  the cursor only; `counts` stays the three window totals with `shape` ignored. Other filters apply to
  both. Optional `bucket` `day`, `week`, or `month` adds `series` of exactly three objects, `key`
  `complete`, `unreported`, `started`, in that order, each with sparse `points` of `{"t","n"}`; `t`
  is bucket start in `tz` as for score-series; `shape` does not change `series`. Response
  `{"counts":{complete,unreported,started},"rows":[{repo_id,plan,conversation_id,brief_path,harness,shape,ts}],"series"?,"next"}`. The cursor binds `shape` and `bucket` with the other filters. This is
  [design 1](01-event-model-and-ingest.md)'s derived execution view applied per brief and computed at
  read time; it is not an ingest-side table.
- `GET /v1/analytics/conversations` — conversations with any in-window fact; counts and
  `first_ts`/`last_ts` from in-window facts only; `harness` is the most frequent (ties to the smaller
  name); `repos` and `kinds` distinct. Each row adds `model` (most frequent model on in-window calls,
  same tie rule), `model_calls`, `unpriced_calls`, `cost_usd`, `tokens_in`, `tokens_out` (counts
  in-window). Ordered `last_ts` desc, `conversation_id` asc.
- Paging (executions, conversations) is keyset in SQL: `limit` default 100, max 500 (**judgement**), `cursor` from a
  previous `next`; `next` absent on the last page. Executions order `ts` desc, `conversation_id`,
  `brief_path` asc. The cursor is opaque, bound to the route, the filters and the first page's
  resolved window; a cursor used with different filters is 400 `{"error":"cursor mismatch"}`.
- `GET /v1/analytics/explore` — one row per in-window fact plus in-window rejections (`type`
  `rejection`), newest first, with only the columns `type`, `ts`, `harness`, `repo_id`, `plan`,
  `kind`, `event`, `norm_event`, `tool`, `model`, `cost_usd`, `path`, `conversation_id`, `source`,
  `sha`, `screen_verdict`, `rejection_stage`. At most 20,000 rows (**judgement**: browser memory), `truncated` true when more
  matched. Paths and tool names are not redacted: this is the same trust boundary as the other tenant
  reads.
- `GET /v1/analytics/query` — the generic aggregate. `measure` is required; `dim` is given 0 to 2
  times; `bucket` is `none` (default), `hour`, `day`, `week` (ISO Monday) or `month`; `top` defaults
  to 20, max 100, and ranks each dimension's keys independently by the measure's total over the
  window. Keys outside the top N fold into `"__other__"`, which is not a valid filter value. Response
  `{"measure","bucket","dims":[…],"rows":[{"t"?,"k":[…],"v"}],"ignored_filters"?,"partial"?,"truncated"?}`,
  capped at 20,000 rows (**judgement**); rows are sparse and `t` is RFC3339 in `tz`. An unsupported
  measure × dimension pairing is 400 `{"error":"unsupported dimension <d> for <measure>"}`.
- `GET /v1/analytics/schema` — the matrix below, verbatim: `{"measures":[{"name","unit","dims":[…]}],"buckets":[…]}`.
  The builder is driven only by this, so it cannot offer a pairing the server rejects.

  | Measure | Dimensions |
  |---|---|
  | `hook_events` | `harness`, `repo_id`, `norm_event`, `event`, `tool`, `tool_kind`, `conversation_id` |
  | `conversations` (distinct) | `harness`, `repo_id`, `model` |
  | `artifact_versions`, `distinct_content` | `harness`, `repo_id`, `kind`, `plan`, `source`, `conversation_id` |
  | `commits` | `harness`, `repo_id`, `conversation_id` |
  | `rejections` | `stage` |
  | `model_calls`, `tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `tokens_reasoning`, `cost_usd`, `unpriced_calls` | `harness`, `repo_id`, `model`, `conversation_id` |

  `tool_kind` groups tool names into `shell`, `read`, `edit`, `search`, `web`, `agent`, `plan`, `mcp` and `other`, so tool use compares across harnesses. It is computed from `tool` at query time (the table is in `internal/store/toolkind.go`), so editing the table changes old rows too; it is a dimension only, not a filter. Codex has no read tool and reads files through its shell, so those calls count as `shell`.

  Every measure also takes `hour_of_day` and `weekday`.
- `GET /v1/analytics/conversation` (`id` required; unknown id is 404) — optional `from` and `to`,
  RFC3339, inclusive; `from` after `to` is 400 `{"error":"from after to"}`. Dimension filters from
  the shared set are not sent to this route. `events` is the whole run in time order, capped at 5,000
  (**judgement**); `from` and `to` do not drop events. `truncated` applies to `events` only.
  `totals` is the whole conversation, including events past the cap. When `from` or `to` is present,
  `window_totals` is that range's full totals (not the capped slice); when both are omitted,
  `window_totals` is absent. Response
  `{"conversation_id","harness","repos","models","first_ts","last_ts","totals":{tokens…,cost_usd},"window_totals"?,"events":[…],"truncated"?}`.
  It returns no bodies.

Phase 2 leaves existing `/query` fields unchanged; `/schema`, `/summary`, `/series`, `/scores`, and
`/baselines` are likewise unchanged.

**Count semantics.** `hook_events` counts stored hook events. Events on the ingest policy's `remove`
list are never stored, so they are not counted; a streamed message part counts once, through its
`message.part.updated` event. A model call is counted once (a Claude message ID repeated across
transcript lines counts once).

**Cost.** `cost_usd` is computed at read time: a call's reported cost when the harness gave one,
otherwise its tokens × the model's price in a pricing table that `serve` embeds, generated from
`tools/transcript/pricing.json` (a test asserts the two are equal). A call with neither is counted in
`unpriced_calls` and adds 0; the site shows such cost as unpriced, never as `$0`. Repricing needs
only a new binary. Codex input tokens include cached input, so cached tokens are not charged twice.

**Performance bound.** A committed benchmark (`analytics_bench_test.go`, run against any ledger path
via `YAKKA_BENCH_DIR`) times every route, each preset (24h, 7d, 30d, 90d, all time), every measure
with 0, 1 and 2 dimensions and every bucket within the cap. The bound is p95 under 500 ms per case, met
on a compacted copy of the real ledger.

### Browser access

- Local mode: when the request `Origin` host is loopback (`localhost`, `127.0.0.1`, `::1`), the
  response carries that exact origin in `Access-Control-Allow-Origin`, plus `Allow-Headers:
  Authorization, Content-Type`, `Allow-Methods: GET, OPTIONS` and `Vary: Origin`; `OPTIONS` is 204.
  Other origins get no CORS headers, so a public page cannot read a keyless loopback ledger.
  `localGuard` (loopback `Host`, JSON-only POST) runs first.
- Keyed mode: the same headers only for an origin listed exactly in `YAKKA_SERVE_CORS_ORIGINS`
  ([design 3](03-remote-service.md#configuration-first-round)). No wildcard, no reflected origin.
- Remote collector: state-changing `Origin` checks and credentialed CORS allow
  `https://yakka.build`, `https://www.yakka.build`, the public API origin, and each exact entry
  of `YAKKA_SERVE_CORS_ORIGINS`. Credentialed responses set `Access-Control-Allow-Credentials: true`
  and allow `GET`, `POST`, `PUT`, and `OPTIONS`. The session cookie stays host-only on the API
  (no `Domain`). Local and keyed modes stay without credentials, `GET` and `OPTIONS` only.

## The site

- After the document loads, the layout calls `GET /v1/me` once. Loopback with an empty configured
  base stays on the opened route even when `/v1/me` is 401. A 200 stays and analytics requests send
  `?tenant=` from the first `tenants[].name` when present. A 401 with a stored bearer and non-empty
  base stays. A 401 with no bearer on any other host navigates to `/login?return=` the opened path
  and query; `/login`, `/oauth/callback`, and `/settings` stay, and the GitHub link on `/login`
  passes `return` through when it is a same-origin path. Route children render only when that
  decision for the current pathname is stay, so a redirect does not also start analytics. A later
  client navigation re-evaluates the remembered `/v1/me` result and does not call it again. A
  query-string change on the same path does not refetch `/v1/me`. A 403 `no such tenant` sends the
  browser to `/profile` only when `/v1/me` returned no tenant. After GitHub admission, the cookie
  backs same-origin reads; a 403 `no such tenant` means the session owns no matching `?tenant=` yet
  (not a logged-out 401). `POST /logout` clears the session.
- `/settings` stores an API base URL and a bearer token in `localStorage` under
  `yakka-analytics-base` and `yakka-analytics-key`. An empty base on an embedded serve is
  same-origin `/v1`. An empty base on `yakka.build` or `www.yakka.build` is
  `https://api.yakka.build`. Session routes (`/v1/me`, tenants, tokens, device authorize) use the
  session cookie and no bearer when the base is empty or is that API origin. Analytics `GET`s send
  a stored bearer when the base is non-empty and a key is set. The token is never written into the
  build or the repo; the build's bundle check fails if a key appears in it.
- That token is as sensitive as the tenant key and is not rotated or expired: any script on the
  origin can read it. A later design may issue a short-lived browser token; the routes keep
  accepting `Authorization: Bearer`.
- Charts render with Apache ECharts, tree-shaken, reading computed theme tokens (no hard-coded
  colours). **Theme.** The analysis frame (`src/lib/analysis/tokens.css`) defines non-solarized
  `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--danger`, an eight-colour
  `--series-*` scale, and space tokens 4/8/16/24/32 px on the document root. `localStorage` key
  `yakka-analytics-theme` holds `system`, `light`, or `dark`; an absent key means `system`. The
  document root carries `data-theme="light"` or `data-theme="dark"`. `system` follows
  `prefers-color-scheme` and later OS changes; `light` and `dark` pin the analysis palette. Body
  type stays `system-ui`. The shell, main, landing, investigation, identity routes, and the retired
  report stubs all use these analysis tokens on the document root. The analysis chart frame does not
  offer a data-table toggle. The site works down to 1024 px wide. Perspective and the old `/explore` pivot are retired. No second
  chart grammar, no SQL editor, no BI shell (Evidence, Observable Framework, Rill, Grafana,
  Metabase, Superset, Lightdash, Cube and Tinybird each need a build-time snapshot or a second
  always-on service).
- **Window.** Presets Today, 24h, 7d, 30d, 90d, This month, YTD and All time, a custom range, and
  brush-to-zoom on any time-axis chart. Presets stay relative in a shared URL. Times display in the
  browser's zone, which is sent as `tz`. Each chart uses the finest bucket within the cap unless one
  is set.
- **Data layer.** Landing and investigation read through `aggregate` in `packages/yakka-analytics`:
  one request in and one result out. Those callers do not name `/v1/analytics/*` or
  `GET /v1/baselines`; the boundary may compose those reads. The server has no exclude parameter, so
  an exclude is the complement of the facet values; an exclude on `conversation_id` is unsupported
  and the investigation shell lists it in `ignored_filters`. The shell does not show `clamp`,
  `partial`, or `truncated`.
- **Drill-down.** Every chart mark and table row for a shared-filter dimension value applies it as a
  filter (shift-click excludes it). `__other__`, the empty key, `hour_of_day`, `weekday`, and check
  names are not clickable. Active filters show as removable chips. Any conversation ID opens its
  timeline. `/` does not show those KPI tiles and does not link them to `/conversations`, `/hooks`,
  `/trends`, or `/usage`. The site zero-fills a gap only on count series (`/query` measures whose unit is a
  count, and the executions shape series); a score series leaves the gap.
- **Investigation charts.** Trend and breakdown asks on `/` choose measure, dimension, and bucket
  from the aggregate boundary; chart kinds follow the analysis frame (line, bar, and related types
  where the ask fits). Usage, quality, and conversation tools are separate panels in the same shell,
  not standalone report routes.
- **Saved analyses.** Named snapshots live in `localStorage` at `yakka-analytics-saved-analysis` as
  `{"id","name","spec"}` with `spec` an `AggregateRequest` (window, filters, and `ask`). Opening one
  replaces the investigation URL with that spec. There is no twelve-tile dashboard grid and no
  `{report, params}` saved-view record for the new tool; legacy `yakka-analytics-views` entries may
  remain in the browser but are not surfaced in the shell.
- A response that is not JSON (a static host answering `/v1` with HTML) is a connection error
  pointing at `/settings`.

## Hosting

- **Fly.io remote collector:** `fly.toml` app `yakka`, `YAKKA_PUBLIC_URL` `https://api.yakka.build`.
  That value is the device-token `endpoint`, the `Secure` cookie flag, and the 401 login hint.
  It is not the GitHub `redirect_uri`. GitHub's callback stays `https://yakka.build/oauth/callback`.
  One machine runs the image built from the repo `Dockerfile`, which does not embed the analytics
  site, and listens on internal port 8080. A fly volume `workflow_serve_data` mounts at `/data`;
  `YAKKA_SERVE_DATA=/data` holds the registry and tenant ledgers across restarts.
  `YAKKA_SERVE_KEYS` is unset. `YAKKA_SERVE_CORS_ORIGINS` is
  `https://yakka.build,https://www.yakka.build`. `GITHUB_OAUTH_CLIENT_ID` and
  `GITHUB_OAUTH_CLIENT_SECRET` are fly secrets, not in the repo. `yakka login` against
  `https://api.yakka.build` `start` prints the Pages `/device` URL and code; the page `fetch`es the API with credentials, and `wait`
  writes that API `endpoint` plus the minted token into `client.toml`.
- The site's build output is copied into `packages/yakka/internal/serve/site/` before `go build`
  embeds it (`//go:embed all:site`). `tools/release/build.sh` builds the site first and fails if
  `index.html` is missing or is the placeholder, then restores the committed placeholder on exit.
- The committed placeholder `index.html` contains the marker `yakka-analytics-placeholder`. While
  it is embedded, every non-`/v1` path is 404 `{"error":"analytics bundle not embedded"}`, so `go
  test` needs no Node.
- With the real build embedded: `GET`/`HEAD` only (else 405). An existing file is served with its
  type; `/`, `/index.html` and any non-file path return `index.html` (client routes) with
  `Cache-Control: no-cache`; files under `_app/immutable/` are `public, max-age=31536000,
  immutable`. `/v1` and `/v1/*` are never HTML. In keyed mode the static files need no key; they
  carry no tenant data.
- **Cloudflare Pages:** `packages/yakka-analytics/wrangler.toml` declares
  `pages_build_output_dir = "./build"`, the same artifact release binaries embed. Custom domains
  are `yakka.build` and `www.yakka.build`. No site env vars and no token in the build. With no
  `404.html`, Pages serves unknown paths as `/` (`fallback: 'index.html'`). `/oauth/callback` is a
  Pages page: it shows status and `fetch`es the API callback with credentials. The API returns JSON
  and `Set-Cookie`; it does not redirect. `/device` is the same Pages page; its form posts to
  `https://api.yakka.build/v1/device/authorize` by credentialed `fetch` and stays on the page.

## Open issues

1. Precheck rejection rows carry empty `repo_id`/`harness`, so any `repo_id` or `harness` filter
   drops rejections to zero in `summary` and `explore` (`rejWhere`,
   `packages/yakka/internal/store/analytics.go`). `/query` reports the filter in `ignored_filters`
   instead, but the other routes still need a decision on whether a rejection belongs to a repo (for
   example through its conversation's facts).
2. The hosted site sends no `X-Frame-Options` / `frame-ancestors`; a framed remote `/settings` could
   be clickjacked into redirecting the stored token.
3. `cors` sets `Vary: Origin` only for allowed origins (a shared cache could serve a header-less
   response to an allowed origin); `YAKKA_SERVE_CORS_ORIGINS` entries are never validated, so a
   trailing slash silently never matches.
4. `build.sh` runs `npm ci` only when `node_modules/` is absent, so a release can embed stale
   dependencies; a SIGKILLed run leaves the built site in `site/`, which the next run then saves as
   its "placeholder".
5. Cursor window bounds use `UnixNano`, which overflows outside 1678–2262.
6. Site: `/settings` does not warn on an `http:` remote base or strip a trailing `/v1`; `/explore`
   keeps stale rows beside its error panel after a failed re-fetch.
7. `svelte-check` is not installed, so component types are unchecked (charts are exercised by
   Playwright). Perspective's viewer carries an opt-in LLM-chat feature that could send explore rows
   to a third-party provider if a user supplies a key.
8. Live Claude usage is not deduplicated: only backfilled facts carry the message id, so a repeated live `message_id` is counted twice. Fix: capture the id into a column at ingest and dedupe on it.
9. Usage measures aggregate in Go over every kept row, so an All-time window is unbounded in memory and the usage read sorts and parses JSON per row (benchmark headroom is 464 ms of 500 ms). Fix: group in SQL or add a usage rollup.
10. Compaction and the archive: `Read` stops at a torn frame until `Repair` runs; compaction re-archives already-slim rows as lossy lines; the `complete` shortcut can skip rows before `compact_cursor`; the disk check ignores the VACUUM copy.
11. The OpenCode `config` hook is captured and is not on the remove list, and it can carry provider keys. Decide whether to add it to the remove list in ingest and the plugin.
12. `partial` is emitted only by `/query`; `time/tzdata` is not imported in serve, `tz=Local` is accepted, filter value counts and `top` are unbounded, and the locked-tenant 503 echoes the tenant path.
13. Builder: `data-ready` is true while the previous chart is still shown. Dashboards: the saved-view store does not validate stored entries on read.
14. Closed: an executions sankey edge sets `shape` on the URL. `counts` stay the window totals, and the next page of rows uses that `shape`.
15. Pricing: Claude and Codex rates were added on 2026-10-11 (15 models). Remaining unpriced calls are local and free OpenCode models, codex calls with an empty model, and `<synthetic>`. GPT long-context (>272K) surcharges are not modelled. A `serve` built without the site build first reports "analytics bundle not embedded".
16. Closed: the shell no longer mounts the filter bar, chips, or save-view control.
17. Closed: `/` no longer links KPI tiles to the old report routes.
18. Client registration leftovers: collector-mode `?tenant=` is still only on the overview and `/profile`; `Server.New` panics if the registry cannot be opened or persisted; analytics e2e seeds `registry.json` instead of logging in and calling `POST /v1/tokens`; the profile expiry field is prefilled in the browser; a device code keeps the token plaintext in `registry.json` until exchange.
19. Choosing executions in the investigation runs `aggregate`, and the shell draws only trend and breakdown charts, so that ask fetches and shows nothing.
20. `tests/e2e/area.spec.ts`, `builder.spec.ts`, `executions.spec.ts`, `filter-bar.spec.ts`, and `hooks.spec.ts` still drive retired reports. `settings.spec.ts` still waits for `GET /v1/analytics/summary` and the old summary tiles on `/`.
21. The investigation shell shows `ignored_filters` and does not show `clamp`, `partial`, or `truncated`, so a clamped window looks complete.
22. Trend and quality options set an ECharts toolbox, and the chart host does not register `ToolboxComponent`. Drag-to-brush still works.

## Live cutover record (2026-10-11)

The local `workflow-serve.service` (systemd user unit) moved from build ace7370 to master b9034da with the site embedded.

- Backup: a zstd tar of the whole tenant dir under `/var/tmp/wf-cutover-<stamp>/`, checked against the live ledger by sha256 and `integrity_check` (ok). The old tenant dir is kept at `~/.local/share/yakka/cutover-hold/local.pre-cutover` for rollback.
- Compaction ran on a restored copy because `/home` lacked the roughly 8 GiB the in-place check needs. Rows went from 9,276,949 to 438,910 and the ledger from 12.99 GB to 338 MB (13m42s). `purge-deltas` then removed 0 rows (23.6 s). The result was copied back into `serve/local`.
- Downtime was about 26.5 minutes. Hooks buffered events to the queue, and the new serve's hosted drain ingested them.
- Checked: health `compaction: complete`, `/v1/analytics/schema`, a 7-day query (unpriced calls 1, down from 84.7% of calls before pricing), `/` and `/usage` returning 200, new events ingested, a `message.part.delta` POST accepted with no fact stored, `integrity_check` ok, and the hook_events rollup equal to the facts count.
- Gotchas: the unit's old ExecStart path no longer existed, so it now points at `~/.local/lib/workflow/<commit>/workflow-linux-amd64` (the previous binary is kept beside it as `.bak`). Do not leave a stray tenant dir inside `serve/`, because health then reports compaction "required". A hook-kicked standalone `drain` can hold the drain lock and block the hosted drain.
