# Analytics workspace: the contract the server, the release build and the hosts hold any UI to

The SvelteKit + ECharts analytics site in `packages/yakka-analytics` is being replaced by a static,
no-build workspace (web components, native ES `import`, uPlot as published): see
[DESIGN.md](DESIGN.md). This file is the evidence and contract record that design builds on. It is
about what the server, the release build and the hosts require of whatever UI exists, and what the
UI may rely on; it says nothing about the old UX, layout, components or chart choices.

**Basis.** Every server fact below was read from the Go and Python source at master `b2094eb`
(files named per section); no test was run for this file and no production ledger or credential was
read. Where `docs/design/07-analytics-site.md` and the code differ, this file follows the code and says
so. Statements labelled **Current** describe master. Statements labelled **Target** define what
DESIGN.md changes in the named phase; implementation progress is recorded in the plan's phase reports.
At close-out this file is promoted
into `docs/design/07-analytics-site.md`.

## Contents

1. [Framework-free logic to carry](#1-framework-free-logic-to-carry)
2. [Identity: sign-in, device login, sessions](#2-identity-sign-in-device-login-sessions)
3. [Auth, tenants, base URL, transport](#3-auth-tenants-base-url-transport)
4. [Browser storage](#4-browser-storage)
5. [Session gate and tenant switching](#5-session-gate-and-tenant-switching)
6. [Account and admin endpoints](#6-account-and-admin-endpoints)
7. [Analytics read endpoints](#7-analytics-read-endpoints)
8. [Other `/v1` routes](#8-other-v1-routes)
9. [CORS and browser access](#9-cors-and-browser-access)
10. [Serving: embedded and hosted](#10-serving-embedded-and-hosted)
11. [What the repo expects of the package](#11-what-the-repo-expects-of-the-package)
12. [Server-side performance contract](#12-server-side-performance-contract)
13. [Known issues on the server side](#13-known-issues-on-the-server-side)
14. [Deployment notes](#14-deployment-notes)
15. [Operational record: live cutover 2026-10-11](#15-operational-record-live-cutover-2026-10-11)
16. [Evidence basis](#16-evidence-basis)
17. [Target domain contracts](#17-target-domain-contracts)

---

## 1. Framework-free logic to carry

**Current.** The pure, framework-free logic of the old client lives in `packages/yakka-analytics/src/lib/`
(none of these files imports Svelte, except the thin `session-gate.svelte.ts` wrapper):

| Master file | Holds |
|---|---|
| `src/lib/api.ts` | The `localStorage` keys, `API_ORIGIN`, `isPagesHost`, `resolvedBase` (`:79-84`), `isCollectorMode` (`:98-102`), `oauthApiBase`, `sessionRoute` (`:212-215`), `apiInit` (`:183-191`, bearer or cookie), `apiGet`/`apiPost` (`:218-241`) with `ApiError`, `TOKEN_LIFETIMES`, `TOKEN_SCOPES`, `safeReturnPath` (`:121-140`), `oauthLoginPath` (`:170-175`), `oauthCallbackTarget` (`:143-167`) |
| `src/lib/session-gate.ts` | The post-`/v1/me` gate decision (`:56-86`), the `no such tenant` rule (`:89-99`), tenant helpers (`:101-129`), `TENANT_KEY` (`:131`) |

**Target (Phase 1, Phase 2).** The same behaviour re-expressed as plain ES modules under
`packages/yakka-analytics/web/contract/` (`transport.js`, `return-path.js`, `session-gate.js`), written
from this document and from those files' logic, with the request scheduler of DESIGN.md added around
`apiGet`. This document is authoritative where they differ. (A local, unpushed reset commit holds an
earlier port of these modules; it is not a source for this plan and its hashes are not cited.)

Not carried, because they were the old UI's own abstractions and not server contracts: the typed
analytics-response definitions (written out as shapes in section 7), `AdminStatus` (section 6), the
saved-analysis store (storage format only, section 4), the debounce and cache client `query.ts`,
`aggregate.ts` / `AggregateRequest`, theme and ECharts code, `isValidLoopbackRedirectUri` (obsolete:
the server rejects `redirect_uri` and `state` on device authorize, section 2.3), Svelte components and
routes, ECharts and Perspective, the Playwright and vitest suites, `scripts/check-bundle.mjs` (its rule
survives as 11.5), `package.json`, `package-lock.json`, `svelte.config.js`, `vite.config.ts`,
`tsconfig.json`.

---

## 2. Identity: sign-in, device login, sessions

Source: `session.go`, `oauth.go`, `device.go`, `device_grants.go`, `device_limits.go`, `serve.go`.

### 2.1 Server modes (decide what auth exists)

| Mode | When | Tenant | Tokens / sessions / OAuth |
|---|---|---|---|
| Local | loopback bind, or keyless non-remote | always `local` | tokens and cookies ignored; no OAuth; `/v1/me` is 401 |
| Keyed | `Config.Keys` set (code and tests only; the `YAKKA_SERVE_KEYS` env path is refused at startup) | key's tenant | `Authorization: Bearer <key>` required |
| Remote collector | non-loopback bind and `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `YAKKA_PUBLIC_URL` (an https origin, no path) | per token or per session | bearer token, or `workflow_session` cookie |

Other env: `YAKKA_SERVE_ADDR` (default `127.0.0.1:8770`), `YAKKA_SERVE_DATA`, `YAKKA_SERVE_CORS_ORIGINS`
(comma-separated exact origins). Device routes (`/v1/device/*`) are registered **only** in remote collector mode.

### 2.2 GitHub sign-in (browser redirect flow)

1. The UI navigates the browser (a real navigation, not `fetch`) to
   `<oauthApiBase>/oauth/login?return=<path>`. `oauthApiBase` is `https://api.yakka.build` on the Pages hosts and
   same-origin elsewhere. `return` must pass `safeReturnPath` (section 3.6); the server independently falls back to `/` for
   anything that is not a safe same-origin path.
2. `GET /oauth/login` sets two host-only cookies on the API origin, `workflow_oauth_state` and
   `workflow_oauth_return`, each valid 10 minutes, then 302s to GitHub (`scope=read:user user:email`). The
   `redirect_uri` is `githubRedirectURI()`: **`https://yakka.build/oauth/callback`** when the public origin is
   `https://api.yakka.build`, otherwise `<YAKKA_PUBLIC_URL>/oauth/callback`. That URL is registered with GitHub and must not change.
3. GitHub redirects the browser to that **UI page** `/oauth/callback?code=…&state=…`. The UI must serve a page there. It
   does a **credentialed** `fetch` (`credentials: 'include'`) to `<api>/oauth/callback?code&state` (forwarding the query exactly).
4. The API answers JSON and never redirects:
   - 200 `{"ok":true,"return":"<path>"}` plus `Set-Cookie: workflow_session=…`.
   - `{"ok":false,"error":"…"}` with status 401 `unauthorized` (bad state, missing code, failed exchange or identity fetch),
     403 `denied` (domain policy refused this user), 500 `tenant setup failed` or `persist failed`.
5. The UI then navigates to `return` if `safeReturnPath` accepts it, else `/` (`oauthCallbackTarget` in `contract/return-path.js`). `denied`
   and any other failure show a message and do not navigate. A response whose final URL differs from the request is a failure.

Session cookie `workflow_session`: host-only (no `Domain`), `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` when `YAKKA_PUBLIC_URL`
is https. Lifetime 14 days, **not refreshed** (no sliding expiry; after 14 days the user signs in again). An unknown or expired
session clears the cookie; a session the policy no longer admits is deleted server-side. Because it is host-only and `HttpOnly`, the UI
cannot read it; it only sends it with `credentials: 'include'`.

`POST /logout` (origin-guarded, JSON-only content type) returns 204 and clears the cookie. The old UI never called it; a new UI
should offer sign-out.

The admin is the user with the verified GitHub email `codyh@ctzns.net` (constant in the server). Policy modes are everyone
and allow-list by domain.

A first sign-in ensures a default tenant for the user (`EnsureDefaultTenant`), so a signed-in user normally owns at least one tenant.

### 2.3 Device-code login (CLI to browser)

Used by `yakka login`. The CLI gets a code, the user approves it in the UI at `<site>/device`, and the CLI exchanges it for a token.
Design record: `docs/plans/19-device-login/`. Routes in `device.go`; all JSON; remote mode only.

**CLI side (not the UI, listed so the UI knows what it is approving):**

- `POST /v1/device/code`, optional body `{"host": "<hostname>"}` (1 KB limit). 200
  `{"device_code","user_code","verification_uri","verification_uri_complete","expires_in":600,"interval":5}`.
  `verification_uri` is `<site>/device`, where `<site>` is `https://yakka.build` when the public origin is `https://api.yakka.build`, else
  the public origin. `verification_uri_complete` is that plus `?user_code=<code>`.
  Limits: 10 codes per minute per IP, 5 live per IP, 1000 live in total; 429 `rate_limited`, 503 `busy`.
- `POST /v1/device/token`, body `{"device_code"}`. 200 `{"token","name","endpoint","tenant","scope","expires_at"}`, or 400 with
  `expired_token`, `slow_down`, `authorization_pending` or `access_denied`.

**UI side, the `/device` page:**

- The page lives at `/device` and may be opened as `/device?user_code=XXXX-XXXX` or without a code (the user types it).
- A user code is `XXXX-XXXX` (4-4, dash). The old client trimmed and uppercased before sending.
- Signed out: send the user to sign-in with `return` set to the current `/device?user_code=…` so the code survives sign-in.
- `GET /v1/device/grant?user_code=<code>` (session cookie, no bearer): 200 `{"host":"<name>"}` (may be empty) so the user can check the code
  matches their terminal; 404 `unknown_code`. Unknown codes count against the limit below.
- `POST /v1/device/authorize` (session cookie only; any bearer is 401; origin-guarded; JSON or form-urlencoded):
  - Approve: `{"user_code","tenant","scope","lifetime","name"?}`. `scope` is `read` or `read_write`; `lifetime` is one of the six values in 3.5; `tenant` is a
    tenant id the session user owns; `name` is optional.
  - Deny: `{"user_code","action":"deny"}`.
  - Forbidden fields: `redirect_uri`, `state`, `expires_at` give 400. (An older design let the device pick a loopback redirect; it is gone.)
  - 200 `{"approved":true}` or `{"denied":true}`; 404 `unknown_code`; 403 `forbidden` (not the owner of that tenant); 429 `rate_limited`
    (more than 10 unknown codes per session per 10 minutes); 400 `invalid body`, `invalid lifetime` or `invalid token name`.
- After approval the CLI's `device/token` call returns the token; the browser never sees it on this path.

---

## 3. Auth, tenants, base URL, transport

### 3.1 Resolving the tenant (`authorizeRequest`, `serve.go`)

Every route that wraps `auth` (all analytics routes, ingest, artifacts, checks, baselines, search) resolves a tenant like this:

1. **Local mode:** tenant `local`; token, session and `?tenant=` are ignored.
2. **`Authorization: Bearer <token>` present:** the token resolves to its tenant. A `?tenant=` that differs from the token's tenant is 401.
3. **No bearer, non-remote:** 401 `unauthorized: this service requires a key; run yakka login`.
4. **No bearer, remote, no session:** 401 `unauthorized: this service requires a token; sign in at <login>`, where `<login>` is
   `https://yakka.build/login` when the public origin is `https://api.yakka.build`.
5. **Remote with a session:** `?tenant=<id>` must be a tenant the session user owns, else 403 `{"error":"no such tenant"}`.

"Session-only" routes (`/v1/me`, `/v1/tenants*`, `/v1/tokens*`, `/v1/admin/*`, `/v1/device/authorize|grant`) reject any request carrying a bearer with 401.

### 3.2 Auth headers

- `Accept: application/json` on every request.
- `Content-Type: application/json` on every request with a body. A POST without it is 415 (`localGuard` in local mode; JSON-only
  routes elsewhere). `device/authorize` also accepts `application/x-www-form-urlencoded`.
- `Authorization: Bearer <token>` for token auth.
- Session auth is the cookie, so the request must be sent with `credentials: 'include'` (cross-origin) and the origin must be allowed (section 9).
- Errors are `{"error":"<text>"}` with an HTTP status. 204 has no body. A 200 that is not JSON means the base URL points at something that is not the yakka API.

### 3.3 Base URL (`resolvedBase`)

1. A stored `yakka-analytics-base` (trimmed, trailing slashes removed) wins.
2. Otherwise, on the hostnames `yakka.build` and `www.yakka.build`, it is `https://api.yakka.build`.
3. Otherwise empty: same-origin (`/v1/...`), which is how an embedded serve works.

Requests go to `<base>/v1/<path>?<params>`.

### 3.4 Which credential a request carries (`authFor`)

- **Collector mode** is true when the stored base is empty, or its origin is `https://api.yakka.build`, or the page host is a Pages host.
- A route is a **session route** when its path (relative to `/v1`) is `me`, starts with `device/`, `tenants`, `tokens` or `admin/`.
- Collector mode and a session route: cookie (`credentials: 'include'`), **no bearer**.
- Otherwise a stored bearer (`yakka-analytics-key`) is sent only when both a key and a non-empty base exist; with no bearer the request falls back
  to the cookie (`credentials: 'include'`).
- Consequence worth knowing: with a stored base on a foreign origin, session routes get the bearer and the server answers 401. Sign-in and
  device approval therefore only work against the production API or the same origin.

### 3.5 Tokens and tenants (session-only; POSTs are origin-guarded)

- `POST /v1/tenants` `{"name"}` gives 201 `{"id","name"}`. Name is 1 to 64 runes, no control characters; 400 `invalid tenant name`; 409
  `you already have a tenant with that name`. `id` is immutable and unique; `name` is a label, unique per owner only.
- `POST /v1/tokens` `{"tenant","scope","lifetime"?,"name"?}` gives 201 `{"id","name","token","tenant","scope","expires_at"}`. `scope` is `read` or `read_write`.
  `lifetime` defaults to `3m`; `name` defaults to `token`. `expires_at` in the request is 400. 403 `forbidden` (not the owner), 400 `invalid lifetime`,
  `invalid token name`, `invalid body`. **The token is returned in plaintext once**; it is not stored in plaintext.
- `GET /v1/tokens` gives an array of `{"id","name","tenant","tenant_name","scope","expires_at","revoked","created_at"}`. (`name` is absent on tokens issued before names existed.)
- `POST /v1/tokens/{id}/revoke` (empty JSON body) gives 204; 404 `not found`; 403 `forbidden`.
- Lifetimes, server-computed: `1d` 24h, `1w` 7d, `1m` 30d, `3m` 90d, `6m` 180d, `1y` 365d. The default is `3m`.
- Refresh and expiry: tokens do not refresh. At `expires_at` the token stops working (401 on use); mint a new one. Sessions expire after 14 days (2.2).
  The pasted bearer in `localStorage` is as sensitive as a tenant key; any script on the origin can read it.

### 3.6 `safeReturnPath` rules

A return path must start with `/` but not `//`; contain no backslash, U+2028, U+2029 or control characters (below 0x20, or 0x7f); be at most 4096
characters; resolve against a placeholder origin without leaving it; have no userinfo. The result is `pathname + search + hash`. `null` means do not navigate.

### 3.7 Tenant switching

- `GET /v1/me` returns the user's tenants sorted by name, then id.
- Every analytics request in collector mode carries `?tenant=<id>`: the remembered id (`yakka-analytics-tenant`) if the user still owns it, else the first tenant.
- Choosing a tenant writes the id to `yakka-analytics-tenant`. A tenant picker is needed only when there is more than one tenant. A tenant-taking form (create token, approve
  device) starts on the explicit choice, then the remembered one, then the sole tenant, else empty.
- A token is tied to one tenant; with a bearer, `?tenant=` is unnecessary and a different value is 401. In local mode there is exactly one tenant, `local`.

---

## 4. Browser storage

All keys are `localStorage`, read on every use (no caching) so a settings change needs no reload. All reads tolerate `localStorage` throwing.

| Key | Value |
|---|---|
| `yakka-analytics-base` | API base URL override; trimmed, trailing `/` stripped. Absent or empty: see 3.3 |
| `yakka-analytics-key` | Pasted bearer token. Never write it into a build, the repo, or a URL |
| `yakka-analytics-tenant` | Remembered tenant id |
| `yakka-analytics-theme` | `system`, `light` or `dark`. Absent means `system` |
| `yakka-analytics-saved-analysis` | **Current:** saved analyses; when the signed-in identity is known the key is `yakka-analytics-saved-analysis:<github_id>`. **Target:** reserved and unused (a bookmarked URL is the saved view) |
| `yakka-analytics-entity-colours` | **Target (Phase 7):** entity-to-colour-slot assignments so a model, harness or repo keeps its colour across pages and sessions; colour slots only |
| `yakka-analytics-boards` | **Target (Phase 9):** a list of named board URLs; the URL stays the source of truth |
| `yakka-analytics-follow-seconds` | **Target (Phase 9):** interval of the opt-in Follow probe; default 30 |

**Theme:** the document root carries `data-theme="light"` or `data-theme="dark"`, set before first paint (inline script) to avoid a flash. `system` follows
`prefers-color-scheme` and later OS changes. The old CSS custom properties (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--danger`,
`--series-1` to `--series-8`, spacing 4/8/16/24/32 px) were a design choice and are not part of the contract; only the key and the attribute are.

**Saved analyses** (storage format only): a JSON array of `{"id","name","spec"}`, at most 50 entries; `name` at most 120 characters with control and bidi
characters stripped; `id` formatted `sa_<base36 time>_<random>`; `spec` is whatever the new UI defines, but must not store `tenant` (the old code stripped
it so a saved analysis is portable across tenants). The server never reads this. The legacy keys `yakka-analytics-views:views` and
`yakka-analytics-views:dashboards` are dead; do not read or write them.

---

## 5. Session gate and tenant switching

The rules (`contract/session-gate.js`):

1. After the document loads, call `GET /v1/me` **once** and remember the result. Do not refetch on navigation or on a query-string change.
2. Decide, in this order:
   1. Path is `/login`, `/oauth/callback` or `/settings`: stay; these never wait on `/v1/me` (they are how a person signs in or fixes a base that never answers).
   2. Hostname is `localhost`, `127.0.0.1` or `::1` and the stored base is empty (embedded local serve): stay.
   3. `/v1/me` returned 200: stay.
   4. `/v1/me` returned 401: stay only if a bearer **and** a stored base are both set; otherwise go to `/login?return=<safeReturnPath(path + search)>`.
   5. Any other outcome (network error, 5xx, non-JSON): stay, and show a hint pointing at `/settings`.
3. Render page content only after the decision is stay, so a redirect does not also start analytics requests.
4. A data call that fails 403 `no such tenant` goes to `/profile` (a place to create a tenant) only when `/v1/me` returned **zero** tenants, and never when already on `/profile`.
   Otherwise it is an ordinary error (for instance a stale remembered tenant).
5. A 401 or network error on a data call shows a hint to check the connection settings.

The UI therefore needs these paths to exist: `/login` (sign-in entry; shows a denied message), `/oauth/callback`, `/settings` (base URL and pasted bearer), `/device`, `/profile` (tenants and tokens;
can be any path the new UI chooses, but the rule in 4 must target it), and `/` (the default landing, also the fallback return path).

---

## 6. Account and admin endpoints

All session-only (cookie, no bearer). State-changing ones are origin-guarded (the browser's `Origin` must be allowed, section 9).

`GET /v1/me` gives `{"github_id","github_login","admin","tenants":[{"id","name"}]}`. 401 when not signed in (and always in local mode).

Tenant and token routes are in 3.5; device routes in 2.3.

`GET /v1/admin/tokens` (admin only; 403 `forbidden` otherwise) gives every token as in `GET /v1/tokens`, plus `github_id`.

`GET /v1/admin/status` (admin only) gives:

```text
{ version: string,
  scoring: { scorer: bool, checks: bool, rescorable: bool },
  volume?: { total_bytes, free_bytes },
  tenants: [{
    id, name, facts: number, compaction: string,
    footprint: { ledger_bytes, wal_bytes, archive_bytes, archive_files, blob_bytes, blobs,
                 pending_bytes, pending, other_bytes },
    screens: { verdicts: {<verdict>: n}, scored_content, score_rows,
               rejections: [{stage, pattern, count, last}] | null, total_rejections },
    failures: [{ stage, pattern, reason, path, content_hash, at }],
    rescore: { running, total, done, failed, started, finished, error? },
    error?: string }] }
```

(`started`, `finished` and `at` are Unix seconds; sizes are bytes.) `error` on a tenant means that tenant could not be read; the rest of the list is still valid.

`POST /v1/admin/rescore` `{"tenant":"<id>"}` (admin only, origin-guarded) starts a background rescore of unscored content. 202 returns the `rescore` object above. Errors:
400 `tenant is required`; 409 `scoring is off: set TYPESAFE_API_KEY and YAKKA_CHECKS_DIR and restart`; 409 `a rescore is already running`; 404 `no such tenant`; 503.

`PUT /v1/admin/policy` (admin only, origin-guarded) takes `{"Mode":…,"Domains":[…]}` (the Go struct field names, capitalised). The old UI never called it.

---

## 7. Analytics read endpoints

All are `GET /v1/analytics/<name>`, wrapped in `auth` (section 3.1), JSON, read-only. **Current:** they read only ledger columns: no payload bodies, no artifact text.
**Target (DESIGN.md Phase 5):** a content route extends the same tenant and scope boundary to stored artifact bodies; all other new analytics routes stay columns/metadata-only.
Source: `analytics.go`, `analytics_query.go`, `analytics_conversation.go`, `analytics_distribution.go`, `analytics_score_series.go`, `reads.go` (all under `packages/yakka/internal/serve/`), and `packages/yakka/internal/store/`. Routes are registered at `serve.go:497-508`.

### 7.1 Shared filter (`parseFilter`)

| Param | Meaning |
|---|---|
| `from`, `to` | RFC3339, inclusive. Omitted `to` is now. Omitted `from` is `to` minus 30 days. Bad value: 400 `from and to must be RFC3339`. `from` after `to`: 400 `from is after to` |
| `all=1` | Before Phase 3, `from` became the Unix epoch and time-bucketed routes refused wide windows. **Phase 3 / 3-01:** shared filters now begin at the inclusive signed-nanosecond minimum, preserving pre-epoch rows; width-only refusals are removed. Full route coverage, effective-window reporting and adaptive year/multi-year grouping remain Phase 3 work; see section 17.1 |
| `tz` | IANA zone name, default UTC. Drives bucket boundaries and `hour_of_day` / `weekday`. Unknown: 400 `invalid tz` (note `Local` is accepted) |
| `repo_id`, `harness`, `kind`, `plan`, `norm_event`, `event`, `tool`, `model`, `source`, `conversation_id` | Repeatable. OR within a parameter, AND across parameters |
| `kind` | Must be `design`, `brief` or `report`: 400 `kind must be design, brief or report` |
| `tenant` | See 3.1 |

- **Phase 3 progress (3-01):** the shared filter, `/query`, `/series`, `/executions` and `/score-series` no longer refuse requests solely because their window or bucket count is wide. `all=1` starts at the representable minimum to include pre-epoch data. `/query` accepts `bucket=auto` and a lower-only `max_cells` override, reports requested/effective bucket and cell metadata, and converts visible over-budget/truncated results to `too_many_cells` or `too_many_series` with suggestions. This unit currently resolves through month; year and multi-year storage grouping plus automatic retry after cell overflow are carried to 3-02. The legacy `/schema.buckets` array remains unchanged. The exact accepted inclusive time range is specified in section 17.1.
- `kind` and `plan` are columns filled at ingest from the path: `docs/plans/<plan>/DESIGN.md` (design), `docs/plans/<plan>/briefs/<file>.md` (brief), `docs/plans/<plan>/reports/<file>.md`
  (report). Nested brief paths have no kind and count as `other`.
- Usage clocks use `facts.ts` (event time); rejection counts and rows use `rejections.at`.
- The server has no exclude parameter. The old UI sent the complement of the facet values for an exclude; an exclude on `conversation_id` was unsupported.
- Unknown routes under `/v1/` are JSON 404 `{"error":"not found"}`. Server read failures are 500 `read failed`.

### 7.2 Routes

Every `range too wide`, 400-day and 400-bucket statement below describes **Current** behaviour and is removed by Phase 3 (7.5).

**`/facets`**: takes only `from`/`to`/`tz`. Returns distinct in-window values:
`{"repos":[],"harnesses":[],"kinds":[],"plans":[],"events":[],"models":[],"norm_events":[],"tools":[{"name","n"}],"checks":[{"kind","name"}]}`.
`tools` is the 100 most frequent tool names on hook events; `checks` is the whole catalog (same as `GET /v1/checks`). Arrays are never null.

**`/summary`**: shared filter. Returns
`{"from","to","conversations","hook_events","artifact_versions","distinct_content","by_kind":{design,brief,report,other},"by_source":{worktree,commit},"commits","rejections":{precheck,screen},"screens":{pass,unscreened},"model_calls","unpriced_calls","cost_usd","tokens_in","tokens_out","tokens_cache_read","tokens_cache_write","tokens_reasoning"}`.
`screens` counts distinct in-window content hashes by latest screen verdict. Precheck rejection rows carry empty `repo_id`/`harness`, so a `repo_id` or `harness` filter drops them to zero here and on `/explore` (13.1).

**`/series`**: `metric` and `bucket` required. `metric` is one of `hook_events`, `artifact_versions`, `commits`, `conversations`, `rejections`; otherwise 400
`metric must be hook_events, artifact_versions, commits, conversations or rejections`. `bucket` is `day` or `week` (ISO Monday, UTC), else 400 `bucket must be day or week`.
`group` defaults to `none` (one series keyed `"all"`); allowed pairings: `hook_events`: harness, repo_id, event, tool; `artifact_versions`: harness, repo_id, kind, plan, source;
`commits`: harness, repo_id; `conversations`: harness; `rejections`: stage; else 400 `group not allowed for metric`. Returns
`{"bucket","series":[{"key","points":[{"t","n"}]}]}`, series sorted by key; points are sparse (a bucket with no rows has no point; the old UI zero-filled count series only). A missing group value keys as `""`.
The old UI did not call this route (it used `/query`); it is kept for API consumers.

**`/scores`**: exactly one `kind` required (else 400 `kind required`). Returns `{"kind","checks":[{"name","n","min","p25","median","p75","max"}]}`, one entry per catalog check for that kind
(zeros when empty). Population is distinct in-window content hashes of that kind, latest score per `(content_hash, check)`. Percentile: sorted values, position `(n-1)*q`, linear interpolation, rounded to 3 places.

**`GET /v1/baselines`** (outside `/analytics`): `kind` required (same 400). Returns `{"kind","checks":{"<name>":{"n","p25","median","p75"}}}`, all-time and ignoring the window, from each `(repo_id,path)`'s latest version and that hash's latest score per check (`store/reads.go:98-122`). The population is file-weighted: identical hashes at different files can contribute repeatedly. It is not the distinct-hash population of `/scores`. Target scorer-aware content baselines are separately opted into in section 17.3.

**`/score-series`**: `kind` required (`kind required`; `kind must be design, brief or report`), `bucket` required (`bucket required`; `bucket must be day, week, or month`). 400 `range too wide` over 400 days or 400 buckets.
Returns `{"kind","bucket","checks":[{"name","points":[{"t","n","p25","median","p75"}]}]}`. `t` is the bucket start in RFC3339 in `tz` (week starts Monday, month on the 1st, both in `tz`). A point's population is distinct content
hashes with a version in that bucket (latest version of a hash within the bucket); a hash may appear in several buckets, so this is not the population of `/scores`. Points are sparse and checks with no points are omitted.
Never `partial`.

**`/executions`**: one row per brief `(repo_id, conversation_id, docs/plans/<plan>/briefs/<stem>.md)` with an in-window version. `shape` per row: `complete` (the conversation has a commit in that repo and a version of
`reports/<stem>.md` exists in that repo), `unreported` (commit, no report), `started` (no commit); commit and report facts count outside the window. Params: shared filter; `shape` repeatable (`complete|unreported|started`,
else 400 `unknown shape <s>`; OR'd; omitted means all) filters `rows` and the cursor only; `bucket` `day|week|month` optional (else 400 `bucket must be day, week, or month`); `limit` (default 100, clamped to 1..500; non-integer: 400
`limit must be an integer`); `cursor`. Returns
`{"counts":{"complete","unreported","started"},"rows":[{"repo_id","plan","conversation_id","brief_path","harness","shape","ts"}],"next"?,"bucket"?,"series"?}`. `counts` is always the three window totals (ignoring `shape`).
With `bucket`, `series` is exactly three objects keyed `complete`, `unreported`, `started` (in that order) of sparse `{"t","n"}`; `shape` does not change `series`. Rows are `ts` desc, then `conversation_id`, `brief_path` asc.
Doc 07 says `next` is always present; the Go code omits it on the last page.

**`/conversations`**: conversations with any in-window fact. Shared filter plus `limit` and `cursor`. Returns
`{"rows":[{"conversation_id","harness","model","repos","first_ts","last_ts","hook_events","artifact_versions","commits","kinds","model_calls","unpriced_calls","cost_usd","tokens_in","tokens_out"}],"next"?}`.
Counts and `first_ts`/`last_ts` are in-window. `harness` and `model` are the most frequent on in-window facts/calls (ties to the smaller name; `""` if none). `repos` and `kinds` are distinct arrays. Order: `last_ts` desc, `conversation_id` asc.

**Paging** (`/executions`, `/conversations`): keyset. The `next` cursor is opaque base64; pass it back as `cursor` with the **same filter parameters**. It binds the route, the filter (`canonFilter`: the filter params plus `shape`, `bucket`, `tz`,
`all`), and the first page's resolved window (which replaces `from`/`to`). A mismatch or a malformed cursor is 400 `cursor mismatch`. `next` is absent on the last page.

**`/conversation`**: `id` required (400 `id required`; unknown id 404 `conversation not found`). Shared dimension filters are not sent. Optional `from`/`to` (RFC3339; bad: 400 `from and to must be RFC3339`; `from` after `to`: 400
`from after to`) set `window_totals` only. Returns
`{"conversation_id","harness","repos","models","first_ts","last_ts","totals":{…},"window_totals"?,"events":[…],"truncated"?}` where totals are
`{"model_calls","tokens_in","tokens_out","tokens_cache_read","tokens_cache_write","tokens_reasoning","cost_usd","unpriced_calls"}` and each event is
`{"ts","type","norm_event","event","tool","model","path","kind","source","sha","tokens"?:{in,out,cache_read,cache_write,reasoning},"cost_usd"?}`. `events` is the whole run in time order, capped at 5,000 (`truncated:true` when cut; `from`/`to` do not drop events);
`totals` covers the whole conversation including past the cap. `window_totals` is absent when neither bound is given. No bodies.

**`/explore`**: shared filter. One row per in-window fact plus in-window rejections (`type` `rejection`), newest first, at most 20,000. Returns `{"rows":[…],"truncated":bool}`; a row is
`{"type","ts","harness","repo_id","plan","kind","event","tool","norm_event","model","path","conversation_id","source","sha","screen_verdict","rejection_stage","cost_usd"?}` (`cost_usd` only when priced). Paths and tool names are not redacted: the same trust boundary as the other reads.

**`/schema`**: no filter. Returns `{"measures":[{"name","unit","dims":[…]}],"buckets":["none","hour","day","week","month"]}`: the matrix below, verbatim. A UI that builds queries should be driven by this response so it cannot offer a pairing the server rejects.

| Measure (unit) | Dimensions (every measure also takes `hour_of_day` and `weekday`) |
|---|---|
| `hook_events` (count) | `harness`, `repo_id`, `norm_event`, `event`, `tool`, `tool_kind`, `conversation_id` |
| `conversations` (count, distinct) | `harness`, `repo_id`, `model` |
| `artifact_versions`, `distinct_content` (count) | `harness`, `repo_id`, `kind`, `plan`, `source`, `conversation_id` |
| `commits` (count) | `harness`, `repo_id`, `conversation_id` |
| `rejections` (count) | `stage` |
| `model_calls`, `unpriced_calls` (count); `tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `tokens_reasoning` (tokens); `cost_usd` (usd) | `harness`, `repo_id`, `model`, `conversation_id` |

`tool_kind` groups tool names into `shell`, `read`, `edit`, `search`, `web`, `agent`, `plan`, `mcp`, `other`, so tool use compares across harnesses. It is computed from `tool` at query time (table in `internal/store/toolkind.go`), so changing the table changes
old rows too. It is a dimension only, not a filter. Codex has no read tool, so its file reads count as `shell`.

**`/query`**: the generic aggregate. `measure` required (400 `measure required`; 400 `unknown measure <m>`). `dim` 0 to 2 times (400 `at most two dim`). `bucket` is `none` (default), `hour`, `day`, `week`, `month` (400 `unknown bucket <b>`). `top` defaults to 20, max 100
(400 `top must be an integer`, 400 `top must be at most 100`); it ranks each dimension's keys independently by the measure's total over the window, and keys outside the top N fold into `"__other__"` (not a valid filter value). Shared filter applies, plus `all=1`.
An unsupported measure/dimension pairing is 400 `unsupported dimension <d> for <measure>`; 400 `measure not available`. Over 400 buckets: 400 `range too wide`. Returns
`{"measure","bucket","dims":[…],"rows":[{"t"?,"k":[…],"v"}],"ignored_filters"?:[…],"partial"?:true,"truncated"?:true}`. Rows are sparse; `t` is RFC3339 in `tz`; at most 20,000 rows (`truncated`).
A filter on a dimension the measure does not carry is ignored and its parameter name is listed in `ignored_filters` rather than silently zeroing the measure. `partial:true` is present whenever the ledger's compaction state is not `complete`
(see `GET /v1/health` `compaction`); only `/query` emits `partial`.

**`/distribution`**: `measure` required, one of `cost_usd`, `tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `tokens_reasoning` (400 `measure required` / `unknown measure <m>`). `grain` is `call` (default) or `conversation` (400 `unknown grain <g>`). `dim` is omitted
or `model` (400 `unsupported dimension <d> for <measure>`). `top` defaults to 20, max 100 (a value of 0 or below keeps 20; same integer/max errors as `/query`). Shared filter: `repo_id`, `harness`, `model` and `conversation_id` apply; `kind`, `plan`, `norm_event`, `event`, `tool` and `source` are ignored and
listed in `ignored_filters`. Returns
`{"measure","grain","dim"?,"rows":[{"k","n","unpriced","min","p25","median","p75","p95","max","bins":[{"lo","hi"?,"n"}]}],"truncated"?,"ignored_filters"?}`. `k` is the model, or `"all"` when `dim` is omitted. Rows are ordered by `n` descending; there is no `__other__` row; `truncated`
is true when keys were dropped. Call grain: one value per model call in the window (same identity as `model_calls`). Conversation grain: one value per conversation, the sum of the measure over its calls. For `cost_usd`, `n` counts priced calls, `unpriced` the rest, and percentiles and bins use priced calls only; for token measures
`unpriced` is 0. Percentiles use the `/scores` method; cost is rounded to 6 decimals and tokens to 1. Bin edges are fixed so models share an axis:

- tokens: a zero bin, then `[2^i, 2^(i+1))` for `i` = 0..19, then an overflow bin from `2^20`;
- cost: a zero bin, `(0, 1e-4)`, then `[10^i, 10^(i+1))` for `i` = -4..1, then an overflow bin from `100`;
- `lo` inclusive, `hi` exclusive; the overflow bin has no `hi`. No `partial`; a window over 400 days is 400 `range too wide`.

### 7.3 Count and cost semantics

- `hook_events` counts stored hook events. Events on the ingest policy's `remove` list are never stored, so never counted: this includes OpenCode's `message.part.delta`, `message.part.updated` and `message.updated`.
  A model call is counted once (a Claude message ID repeated across transcript lines counts once; live ingest does not yet dedupe, see 13.5).
- `cost_usd` is computed at read time: a call's reported cost when the harness gave one, otherwise tokens × the model's price in a pricing table embedded in the binary (generated from `tools/transcript/pricing.json`; a test asserts they are equal). A call with neither is counted in
  `unpriced_calls` and contributes 0. A UI must show unpriced cost as unpriced, never as `$0`. Repricing needs only a new binary. Codex input tokens include cached input, so cached tokens are not charged twice.

### 7.4 Capability inventory: grains, lenses, measures, joins (Current, master `b2094eb`)

What a UI can honestly slice, trend, scatter or drill into today, and what it cannot. "Grain" is what one
row of an answer is. Citations are repo-relative.

| Grain | Served by | Measures available | Lenses available | Not available today |
|---|---|---|---|---|
| Time bucket | `/query` (`hour`, `day`, `week`, `month`, `none`), `/series`, `/summary` | all 15 measures of the matrix in 7.2 (`store/query.go:32-47`) | per matrix: `harness`, `repo_id`, `norm_event`, `event`, `tool`, `tool_kind`, `conversation_id`, `model`, `kind`, `plan`, `source`, `stage`, `hour_of_day`, `weekday` | `repo_id` on hook, usage and model-call measures is the empty string for every row (hook facts carry no repo, `facts/facts.go:132-134`, `plugins/yakka/client/yakka.py:556-563`; only artifact and commit facts do, `:581,989`); `kind` and `plan` are ignored by usage measures (listed in `ignored_filters`); no duration measure exists; no exclude filter |
| Model call (distribution only) | `/distribution` (`grain=call`) | `cost_usd`, `tokens_*` as percentiles and fixed bins; rows are never listed | `model` | cannot list calls; no `harness` or repo lens; `model_calls` and `unpriced_calls` are not distribution measures |
| Session | `/conversations` (keyset, `last_ts desc`), `/conversation` (one session), `/distribution` (`grain=conversation`) | per session in the window: `hook_events`, `artifact_versions`, `commits`, `model_calls`, `unpriced_calls`, `cost_usd`, `tokens_in`, `tokens_out`, `first_ts`, `last_ts` | dominant `harness` and `model`, `repos` and `kinds` as sets | no sort by a measure (order is fixed), no cache or reasoning tokens in rows, no score, no plan, no scatter-sized listing; `/query dim=conversation_id` ranks the top 100 only |
| Artifact | `/explore` rows, `GET /v1/artifacts` (latest version metadata), `/scores`, `/score-series`, `/baselines` | scores only as distributions per check (`/scores`: min, p25, median, p75, max, `n`); `versions` count and latest scores per artifact via `/v1/artifacts` | `kind`, `plan` (from path), `source` | no artifact listing, no per-artifact score history, no scores split by harness, model or repo (no group-by), no content, no diff, no version history (`serve/serve.go:771-801`) |
| Plan | `/query artifact_versions dim=plan`, `/executions` | `artifact_versions` and `distinct_content` per plan; execution shape counts | `plan` | no plan entity or listing, no cost per plan (usage measures ignore `plan`), no phase entity (no commit messages are captured, `facts/facts.go:523-525`; `IMPLEMENTATION.md`, `REVIEW.md`, `QA.md`, pre-rename `PLAN.md` are never stored, `keys/keys.go:168-186`) |
| Brief execution | `/executions` | shape (`complete`, `unreported`, `started`) | `repo_id`, `plan`, `harness`, shape | no cost or score join |
| Rejection | `/query rejections`, `/explore` | count | `stage` (`kind`, `plan`) | `repo_id` and `harness` filters zero precheck rejections (13.1) |

Joins that exist: conversation to artifact version and to commit by `conversation_id` on the fact; version to score by
`content_hash` only (`store/store.go:80-83`, `store/reads.go:98-122`); execution by commit and report existence in the same
conversation and repo (`store/analytics.go:521-551`); screen verdict per content hash. **No route joins cost or tokens to
a score at any grain**, and no store query does (the scores table is never read by `query.go`, `usage.go`, `distribution.go`
or `conversation.go`). Authorship: the ledger records no model, agent or user for an artifact or a commit; only the models of
a session's own calls can be derived. Scorer identity is a string on the score row (`jev-1.13.0`, `scorer/jev.go:17-21,62`);
prompt and rubric versions are not recorded (`scorer/jev.go:64-76`). No review, outcome, merged-PR or CI data is ingested
(`ingest/ingest.go:130` accepts `hook_event`, `artifact_version`, `commit`).

**Time bases.** Windows use client event time `facts.ts`; `received_at` is server ingest time and is not used for windows; rejections
use `rejections.at` (server time); `screens.at` and `scores.at` are scoring time, not artifact time; score-series buckets on the
artifact fact's `ts`; commit-sourced artifact and commit facts carry the Bash hook's `ts`, not the git commit time
(`store/store.go:66-70`, `store/analytics.go:122-146,493-520`; `store/score_series.go:51-80`; `facts/facts.go:523,538`).

**Neighbouring plans (shipped versus design only, at `b2094eb`).** Plan 24 MCP: built (`POST /v1/mcp`, `serve/serve.go:490`; registry
`serve/mcp.go:132`), the agent surface, sharing no analytics code. Plan 22 session actions and cost by work: design only on master;
a partial build exists on the unmerged `feat/22-session-work-tagging`. Plan 21 feedback delivery: design only on master (a build
exists on `feat/21-feedback-delivery`). Plan 23 shadow review: design only, on the unmerged branch `origin/docs/23-llm-review-shadow`.
Their dimensions and entities are not in `/schema` and the UI must not assume them.

### 7.5 Where the 399-day window comes from (Current)

- **A server policy constant.** `maxBuckets = 400` (`serve/analytics.go:20`); `tooWide` counts inclusive UTC days (or ISO weeks) against it
  (`:82-91`) and `parseFilter` applies it to every route except `/query` (`:154-156`); `/query`, `score-series` and `executions` also check
  buckets (`bucketSpan`, `serve/analytics_query.go:118-142`). Inclusive counting makes the longest day window 399 days. The design record
  calls it "a response-size cap (judgement)" (`docs/design/07-analytics-site.md`).
- **The old client mirrors it.** `MAX_REST_DAYS = 399` (`packages/yakka-analytics/src/lib/params.ts:19`) and `BUCKET_CAP = 400`
  (`src/lib/buckets.ts:6`), hard-coded because `/schema` returns only `measures` and `buckets`.
- **Not retention.** Nothing deletes facts, archive or blobs by age (no TTL or prune code); compaction and migration 9 remove rows by event
  type and do not hide older data. The archive is monthly but is read only by sync.
- **Not what bounds the work.** Usage measures load every kept row into Go memory with no LIMIT (`store/usage.go:189-212`); no query
  deadline exists (only `r.Context()` is passed; `ReadHeaderTimeout` is the only server timeout, `cmd/yakka/main.go:119`); the reader pool is
  unbounded (`store/store.go:224-227`). Hourly rollups cover only `hook_events`, `conversations` and facets (`store/rollup.go`).
- **Hard limits that do exist.** `UnixNano` overflow outside 1678 to 2262; the SQLite bound-parameter limit (32,766) hit by
  `ScoreSeries`, which binds one parameter per distinct content hash (`store/score_series.go:94-99`); the `/query` output row cap of 20,000
  (`store/query.go:94`), which drops the newest buckets when hit because rows sort ascending before the slice (`:306-309,670-677`).
- **Target (Phase 3).** The window cap is removed; see section 12.

---

## 8. Other `/v1` routes

Not used by the UI today but part of the server's surface (the UI may use them):

- `GET /v1/health`: unauthenticated. `{"ok","version","pending","screen_gaps","compaction"}`. `compaction` is `required` or `complete`; `pending` and `screen_gaps` are point-in-time gauges.
- `GET /v1/whoami`: bearer only. `{"tenant","scope","expires_at"}`.
- `POST /v1/ingest`, `GET /v1/artifacts`, `GET /v1/checks`, `GET /v1/search`: the agent and CLI surface; `auth`-wrapped like the analytics routes.

---

## 9. CORS and browser access

Wrap order is `withSession(cors(mux))`, then `localGuard` in local mode (`serve.go`). All modes: `Access-Control-Allow-Headers: Authorization, Content-Type`, `Vary: Origin`; `OPTIONS` returns 204.

- **Local:** only loopback origins (`localhost`, `127.0.0.1`, `::1`, any port) get `Access-Control-Allow-Origin` (the exact origin), `Allow-Methods: GET, OPTIONS`, no credentials. `localGuard` first refuses a non-loopback `Host` with 403
  `{"error":"local mode accepts only loopback hosts"}` and a POST without `application/json` with 415. A public page therefore cannot read a keyless loopback ledger.
- **Keyed:** the same headers, only for origins listed exactly in `YAKKA_SERVE_CORS_ORIGINS`. No wildcard, no reflection, no credentials.
- **Remote collector:** allowed origins are `YAKKA_PUBLIC_URL`, `https://yakka.build`, `https://www.yakka.build` and each exact `YAKKA_SERVE_CORS_ORIGINS` entry. Responses set `Access-Control-Allow-Credentials: true` and `Allow-Methods: GET, POST, PUT, OPTIONS`. State-changing routes also check
  `Origin` against that list (`originGuard`). The session cookie stays host-only on the API (no `Domain`).
- A UI served from any other origin (for example a static host on a different domain) cannot use the cookie flow. It must be added to `YAKKA_SERVE_CORS_ORIGINS` (a deploy change; section 14) or use a bearer.
- Entries in `YAKKA_SERVE_CORS_ORIGINS` are exact: a trailing slash never matches, and `Vary: Origin` is set only for allowed origins (13.3).
- The hosted site sends no `X-Frame-Options` or `frame-ancestors`; a framed `/settings` could be clickjacked into redirecting the stored token (13.2). A new UI should deny framing (a `<meta>` cannot; it needs a header such as a Pages `_headers` file).

---

## 10. Serving: embedded and hosted

### 10.1 Embedded (`yakka serve`, release binaries) — `packages/yakka/internal/serve/site.go`

`//go:embed all:site` embeds the directory `packages/yakka/internal/serve/site/`. The handler is mounted at `/` (after every API route), and its mode is decided once at construction.

- **Placeholder mode** (the committed state): `site/index.html` contains the marker `yakka-analytics-placeholder`, or `index.html` is missing. Every path outside `/v1` answers 404 `{"error":"analytics bundle not embedded"}`. This is what `go test`, the Docker image and
  the release binaries serve today.
- **Embedded mode** (`index.html` exists and lacks the marker):
  - Only `GET` and `HEAD`; anything else is 405 with `Allow: GET, HEAD`.
  - An existing regular file is served via `http.ServeContent` with its type by extension (including `application/wasm` for `.wasm`).
  - **Target cache rules (Phase 1) are generic, not tied to any framework layout.** The handler must give: (a) `index.html` and the fallback to it `Cache-Control: no-cache`; (b) any file whose path is version-stamped by directory (the rule the new layout uses is `vendor/<name>-<version>/…`, see
    `docs/plans/20-analytics-reset/DESIGN.md`) `Cache-Control: public, max-age=31536000, immutable`; (c) every other file `Cache-Control: no-cache` plus a content `ETag`, so an unchanged file revalidates to 304.
    A no-build UI has no content-hashed filenames, and the embed FS has no modification time (so `ServeContent` alone emits no `Last-Modified` and nothing could revalidate), which is why (c) needs the `ETag`.
    **Current (master):** `site.go:51-58` special-cases the SvelteKit prefix `_app/immutable/` (`public, max-age=31536000, immutable`); every other file gets no `Cache-Control` (`site_test.go:98-100`), and the handler sets no security headers at all (no CSP, `X-Frame-Options`, nosniff or referrer policy). `TestSiteBuiltMode` hard-codes that prefix.
    `site.go` and `site_test.go` change to the target rules in Phase 1.
  - `/`, `/index.html` and any path that is not a file (including `/_app`, `/quality/`, `/device`, `/oauth/callback`) return `index.html` with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`: client-side routes need no server config.
  - `/v1` and `/v1/*` are never HTML: unknown ones are JSON 404 `{"error":"not found"}`.
  - Static files need no key and carry no tenant data. In local mode `localGuard` still wraps the handler (a non-loopback `Host` is 403).
- **Routes the server owns, which a UI must not shadow:** everything under `/v1/`, plus `/oauth/login`, `/oauth/callback` and `/logout`. These are registered on the API mux before the site handler, so on an embedded **remote** serve `/oauth/callback` is the API's JSON callback, not a UI page. This is why the
  GitHub redirect URI points at the Pages host, not at the API (2.2). On an embedded local serve there is no OAuth, so none of these matter.
- The Fly production image (`Dockerfile`, `fly.toml`) does **not** embed a UI: it copies only `packages/yakka/` and so serves the placeholder; the UI is hosted separately.

### 10.2 Hosted: Cloudflare Pages

- Pages serves `https://yakka.build` and `https://www.yakka.build`; the API is `https://api.yakka.build` (Fly app `yakka`). The UI calls the API cross-origin with credentials (section 9) and has no secret: no env vars, no token in the build.
- The UI must be a static site. Pages serves unknown paths as `/` when there is no `404.html`, so client routes (`/login`, `/device`, `/oauth/callback`, `/settings`, `/profile`) work without a redirects file. Adding a `404.html` would break that.
- `/oauth/callback` on Pages is a UI page (2.2). `/device` is the page `verification_uri` points at (2.3).
- GitHub's registered callback is `https://yakka.build/oauth/callback`. Changing the UI's host or path breaks sign-in until the OAuth app and `githubRedirectURI()` are updated together.
- `packages/yakka-analytics/wrangler.toml` is the Pages project config and holds only `name = "yakka-analytics"` and `pages_build_output_dir = "./build"` (`:1-2`). The repo has no `.github`, no deploy script, no `_headers`, `_redirects` or `_routes.json`; `tools/release/build.sh` "never uploads". **The Pages deploy automation is outside this repo.** The project owner states that merging to master deploys Pages automatically through the automation job; what that job runs (a build command, an output directory) is not visible from the repo.
  **Current:** `npm run build` (`vite build`, adapter-static, `pages: 'build'`, `fallback: 'index.html'`) produces `./build`. **Target (Phase 1):** `pages_build_output_dir = "./web"` and nothing builds; see section 14.

### 10.3 Fly (`fly.toml`, unchanged by this plan)

App `yakka`, internal port 8080, volume `workflow_serve_data` at `/data`. Env: `YAKKA_SERVE_ADDR=0.0.0.0:8080`, `YAKKA_SERVE_DATA=/data`, `YAKKA_PUBLIC_URL=https://api.yakka.build`, `YAKKA_SERVE_CORS_ORIGINS=https://yakka.build,https://www.yakka.build`.
Secrets (not in the repo): `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`. `YAKKA_SERVE_KEYS` is unset (and refused). `YAKKA_PUBLIC_URL` is also the device-token `endpoint`, the cookie `Secure` flag and the 401 login hint; it is not the GitHub `redirect_uri`.

---

## 11. What the repo expects of the package

### 11.1 The embed directory and the placeholder

`packages/yakka/internal/serve/site/index.html` is committed with the marker `yakka-analytics-placeholder` and must stay committed: `//go:embed all:site` fails to compile on an empty or missing directory. Current content:

```html
<!doctype html>
<title>workflow analytics</title>
<p>yakka-analytics-placeholder: the analytics bundle is copied in by the release build.</p>
```

(The text still says "copied in by the release build"; it is only visible to someone who opens the placeholder's file, since in placeholder mode the handler answers 404 JSON and never serves it.) **Target (Phase 1):** the release build embeds `packages/yakka-analytics/web/`; the placeholder stays committed as the default for `go test` and the Docker image.

### 11.2 `tools/release/build.sh`

- **Current (master):** `build.sh` requires `npm` and exits otherwise (`:18`); runs `npm ci` when `node_modules` is absent and `npm run build` in `packages/yakka-analytics` (`:30`); fails if `build/index.html` is missing or still the placeholder (`:31-33`); copies `build/` into `internal/serve/site/` (`:34-35`); a trap restores the committed placeholder on exit (`:22-29`); cross-compiles `linux`/`darwin` × `amd64`/`arm64` into `OUT_DIR` (default `tools/release/dist`) and writes sorted `SHA256SUMS` to `SUMS_FILE` (default `plugins/yakka/bin/SHA256SUMS`).
- **Target (Phase 1):** no Node or npm. `build.sh` copies `packages/yakka-analytics/web/` (excluding `_headers`) into `internal/serve/site/` before compiling (an optional `SITE_SRC` overrides the directory), fails (exit 1) if `index.html` is missing or still contains the marker, and restores the placeholder on exit, success or not. `tools/release/test_release.py` `test_7_build_sh` stops requiring npm and asserts the site is embedded and `site/` is clean after the run. A killed run can leave the site in `site/`, which the next run would save as its "placeholder": do not commit `site/` in that state.

### 11.3 Go tests that pin the contract

- `internal/serve/site_test.go`: `TestSitePlaceholderMode`, `TestSiteMissingIndexIsNotEmbedded`, `TestSiteEmbeddedPlaceholder` (uses the real embedded placeholder), `TestSiteBuiltMode` (keyed and local; uses a versioned `vendor/` asset, ordinary JS/JSON assets and WASM in a `fstest.MapFS`), `TestSiteHandlerDirectCallbackFallback`, `TestSiteLocalGuardStillWraps`. They
  fix everything in 10.1. `TestSiteBuiltMode` covers generic cache rules, ETag revalidation and security headers equal to `web/_headers`; the direct callback fallback is tested at `siteHandler` level. The full server mux currently registers `/oauth/callback` before the site handler in local mode too, so that route-level integration remains for Phase 2.
- `internal/serve/analytics_pageset_test.go` (see 12), `analytics_bench_test.go` and the per-route tests (`analytics_test.go`, `analytics_query_test.go`, `analytics_conversation_test.go`, `analytics_executions_test.go`, `analytics_distribution_test.go`, `analytics_score_series_test.go`) pin section 7.
- Tests never need Node: they use the placeholder or an in-memory FS.

### 11.4 Docker

`Dockerfile` copies only `packages/yakka/` (go.mod/go.sum, then the tree) and builds `./cmd/yakka`; there is no Node stage (`Dockerfile:2-3` states the image does not embed the site). `.dockerignore` excludes `docs`, `*.md`, `**/*_test.go` and the like and, on master, still names `packages/yakka-analytics` entries that Phase 1 removes. The image serves the placeholder.

### 11.5 Security contract: no secret in the bundle

The old `scripts/check-bundle.mjs` (on master) fails the build if any built file contains `Bearer <16 or more token characters>` or a forbidden e2e value. The rule stands for any new UI: no token, key, `.env` value or `Bearer …` literal may appear in any file it ships (the UI is public static
content; the only credential is the one the user pastes into `localStorage` or the HttpOnly session cookie). Phase 1 adds the equivalent as a test over `web/` (a grep is enough).

### 11.6 Other repository checks

- `tools/release/scan_residual_names.py` lists `packages/yakka-analytics/` among its phase-5 path prefixes. The directory continues to exist (README, `web/`, `tests/`, `wrangler.toml`), so the prefix stays valid. Its `yakka-(…|analytics|…)` regex is about legacy product names and is unrelated.
- `tools/release/test_layout.py` requires every `packages/*/` directory to hold a `README.md` containing `**Consumers**`, `**Build**`, `**Test**` and `**Release**` (a substring check, `:22,155-170`). The new README keeps them.
- Master tracks one file under a `node_modules/`: `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`, a vitest result cache that names the old package's tests. Phase 1 removes it with the package; repo-root `node_modules/` is not in `.gitignore`, so Phase 1 adds it.
- No `.github` directory is tracked, so there is no CI workflow to update.
- Historical records that mention the old package, left untouched on purpose: `CHANGELOG.md`, and under `docs/plans/`: `13-monorepo-restructure`, `14-analytics-ui`, `15-rename-to-yakka` (PROVENANCE), `17-analytics-dashboard-redesign`, `19-device-login` (design, implementation, briefs, reports).

---

## 12. Server-side performance contract

`analytics_bench_test.go` (`TestAnalyticsBench`, skipped unless `YAKKA_BENCH_DIR` is set; `benchDefP95 = 500.0`, default 3 timed runs after a warm-up, nearest-rank p95) times every route, each preset (24h, 7d, 30d, 90d, all time), every measure with 0, 1 and 2 dimensions and every bucket **within the cap** (`:279-283,336-341` exclude the combinations the cap rejects), against a ledger named by `YAKKA_BENCH_DIR`. The bound is **p95 under 500 ms per case**; `docs/plans/12-analytics-dashboard-overhaul.md:28` records 2,063 cases with a maximum p95 of 464 ms on a compacted copy of the real ledger (undated; no bench output is committed).
That bound is the contract: any request a UI makes should fall inside what the benchmark covers.
**Target (Phase 3):** the bound is unchanged, the benchmark domain gains all-time and `bucket=auto`, and the 400-bucket exclusions are removed; the work per request is bounded by aggregation and budgets instead of by window (section 17.1), with these server budgets published in `/schema.budgets`: `max_cells` (default 20,000, the existing `queryRowCap`), `deadline_s`, `top_max`, `page_max`, `scatter_points`, `content_bytes`, and the one retained time boundary (the nanosecond-representable range). Exact error codes added: `too_many_cells` (400, with `suggested_bucket`), `time_out_of_range` (400), `query_timeout` (503, with `retry`), `busy` (503, `Retry-After`), `too_many_series`, `predicate_too_complex`, `cohort_invalid` and `unsupported_join` (400), `cursor_stale` (409), `content_unavailable` (404, with `reason`), `content_too_large` (413), `content_integrity` (500); each response also carries a machine-readable `code` beside the existing `error` text, which is unchanged.

`analytics_pageset_test.go` additionally runs **sample request sets** (up to 4 requests in flight at once, presets 7d, 30d, 90d and All time). The sets below are what the deleted Overview and Usage pages happened to send. They are **available endpoints and measured request
shapes, not a required page shape**: a UI may issue any combination of the routes in section 7. Phase 13 replaces these sets with the request shapes recorded from the shipped boards, so the smoke and profiling tests cover what ships. Current sets, with no filters:

- **Former Overview set:** one `/analytics/summary`; one `/analytics/query` per spark measure (`conversations`, `hook_events`, `artifact_versions`, `distinct_content`, `commits`, `model_calls`, `tokens_in`, `cost_usd`, `unpriced_calls`), each with the finest bucket among `hour`, `day`, `week`, `month` whose
  upper-bound bucket count is at most 400; and one heatmap `/analytics/query` (`hook_events`, `dim=weekday&dim=hour_of_day`, `bucket=none`).
- **Former Usage set:** five by-model `/analytics/query` calls (`cost_usd`, `model_calls`, `unpriced_calls`, `tokens_in`, `tokens_out`; `dim=model`, `top=20`, `bucket=none`), plus cost over time and tokens over time.
- Windows in the test: "now" is rounded up to the next full hour; All time is a **399-day** clamp, also on `/query` (the old pages never sent `all=1`); `tz` is the browser zone (the test uses UTC).

`TestAnalyticsPageSetSmoke` is ungated: it runs the whole set against the bench fixture and requires every request to return 200. `TestAnalyticsPageSet` (the profiler) runs only when `YAKKA_BENCH_DIR` is set. Headroom note: usage measures aggregate in Go over every kept row (13.6).

---

## 13. Known issues on the server side

Carried over from doc 07's open issues and extended with what the Ground for DESIGN.md found (13 to 19). UI-only items (stale e2e specs, ECharts toolbox, `svelte-check`, Perspective's LLM-chat feature, builder and dashboard bugs, the saved-view store) are dropped with the old UI. Issue numbers from doc 07 are not preserved.

1. Precheck rejection rows carry empty `repo_id`/`harness`, so any `repo_id` or `harness` filter drops rejections to zero in `summary` and `explore` (`rejWhere`, `internal/store/analytics.go`). `/query` lists the filter in `ignored_filters`. The other routes need a decision on whether a rejection belongs to a repo (for example through its conversation's facts).
2. The hosted site sends no `X-Frame-Options` or `frame-ancestors` (see section 9).
3. `cors` sets `Vary: Origin` only for allowed origins (a shared cache could serve a header-less response to an allowed origin). `YAKKA_SERVE_CORS_ORIGINS` entries are never validated, so a trailing slash silently never matches.
4. Cursor window bounds use `UnixNano`, which overflows outside the years 1678 to 2262.
5. Live Claude usage is not deduplicated: only backfilled facts carry the message id, so a repeated live `message_id` is counted twice. Fix: capture the id into a column at ingest and dedupe on it.
6. Usage measures aggregate in Go over every kept row (`store/usage.go:189-212`), so an All-time window is unbounded in memory and the usage read sorts and parses JSON per row (benchmark headroom was 464 ms of 500 ms). Fix: group in SQL or add a usage rollup (DESIGN.md Phase 3).
7. Compaction and the archive: `Read` stops at a torn frame until `Repair` runs; compaction re-archives already-slim rows as lossy lines; the `complete` shortcut can skip rows before `compact_cursor`; the disk check ignores the VACUUM copy.
8. The OpenCode `config` hook is captured and is not on the remove list, and it can carry provider keys. Decide whether to add it to the remove list in ingest and the plugin.
9. `partial` is emitted only by `/query`; `time/tzdata` is not imported in serve, `tz=Local` is accepted, filter value counts and `top` are unbounded on some routes, and the locked-tenant 503 echoes the tenant path.
10. Pricing: Claude and Codex rates were added on 2026-10-11 (15 models). Remaining unpriced calls are local and free OpenCode models, codex calls with an empty model, and `<synthetic>`. GPT long-context (above 272K) surcharges are not modelled.
11. Registration leftovers: `Server.New` panics if the registry cannot be opened or persisted; a device code keeps the token plaintext in `registry.json` until exchange.
12. `build.sh` copies the site into `internal/serve/site/` and restores the placeholder on exit; a SIGKILLed run leaves the built site there, which the next run saves as its "placeholder". Do not commit `site/` in that state (Current on master and unchanged by the target).
13. Hook and usage facts carry no `repo_id` (`facts/facts.go:132-134`; `plugins/yakka/client/yakka.py:556-563`; only artifact and commit facts set it, `:581,989`), so `dim=repo_id` on `hook_events`, `model_calls`, tokens and `cost_usd` groups every row under the empty string. `docs/design/01` and `03` said otherwise and are corrected in this plan. Addressed by the derived `session_repo` lens (Phase 4); a capture change would be a direct fix (DESIGN.md Open Question 2).
14. When the `/query` row cap is hit, rows sorted ascending by bucket are sliced, so the newest buckets are dropped (`store/query.go:306-309,670-677`). Addressed in Phase 3.
15. `/series` ignores `tz` (UTC `strftime`, `store/analytics.go:420-471`); `/executions` series and `/score-series` honour it. Addressed in Phase 3.
16. `ScoreSeries` binds one SQL parameter per distinct content hash and fails above 32,766 (`store/score_series.go:94-99`; the driver is built with `MAX_VARIABLE_NUMBER=32766`). Addressed in Phase 3.
17. `/explore` and `/conversation` events carry `cost_usd` but no `priced` flag (the store keeps it private, `store/conversation.go:34`, `store/analytics.go:971-979`), so an unpriced call looks like `$0`. Addressed in Phase 3.
18. `/scores` and `/facets` read their check catalogue from the server's startup configuration, and scores for check names not loaded are silently dropped (`serve/analytics.go:216-227,358-365`); `/facets` drops every filter but `from` and `to` without saying so.
19. Pre-rename plan folders with `PLAN.md` are not matched by the artifact kind rules (`keys/keys.go:172` matches only `DESIGN.md`), so they are not stored as design artifacts.

---

## 14. Deployment notes

This plan does not touch `fly.toml`, wrangler secrets, the Pages project, the Pages automation job or any deploy setting, and does not deploy.

1. **Pages deploys by merge, outside this repo.** The project owner states that merging to master deploys Pages automatically through the automation job. The repo declares only `packages/yakka-analytics/wrangler.toml`; what the job runs (a build command, an output directory) cannot be seen from here. **Target (Phase 1):** `pages_build_output_dir = "./web"`, nothing builds, and the PR states the directory. If the job runs a build command or expects `./build`, the first post-merge Pages build fails and the previous deployment keeps serving. Merge is deploy, so the new site must serve `/oauth/callback` and `/device` correctly before the PR is ready: sign-in and `yakka login` against `https://api.yakka.build` depend on the Pages site (2.2, 2.3).
2. **Pages security headers.** `web/_headers` carries `X-Frame-Options: DENY` and the CSP of section 17.6, identical to the embedded handler's (13.2, 10.1).
3. **Server deploy is separate and not automatic.** The API is served by Fly; a Pages deploy can precede or follow it. The UI therefore detects capabilities from `/v1/analytics/schema` and shows an unsupported state, not an error or a silent clip, when a feature is absent; an old server's `range too wide` is shown verbatim.
4. **Embedded UI.** The release binaries embed `web/` by default (11.2); the Docker image still serves the placeholder (10.1).
5. **Placeholder text.** The placeholder says "copied in by the release build"; it is unchanged unless Phase 1 rewords it.
6. **Manual evidence, only if unavoidable.** A real GitHub sign-in and a real `yakka login` against the deployed site cannot be exercised by the test rig (the rig uses a contract-faithful stub); they are checks a person may run after the automation deploys, not phase outcomes.

---

## 15. Operational record: live cutover 2026-10-11

Moved from doc 07; it is about the ledger, not the UI. The local `workflow-serve.service` (systemd user unit) moved from build ace7370 to master b9034da with the site embedded.

- Backup: a zstd tar of the whole tenant dir under `/var/tmp/wf-cutover-<stamp>/`, checked against the live ledger by sha256 and `integrity_check` (ok). The old tenant dir is kept at `~/.local/share/yakka/cutover-hold/local.pre-cutover` for rollback.
- Compaction ran on a restored copy because `/home` lacked the roughly 8 GiB the in-place check needs. Rows went from 9,276,949 to 438,910 and the ledger from 12.99 GB to 338 MB (13m42s). `purge-deltas` then removed 0 rows (23.6 s). The result was copied back into `serve/local`.
- Downtime was about 26.5 minutes. Hooks buffered events to the queue, and the new serve's hosted drain ingested them.
- Checked: health `compaction: complete`, `/v1/analytics/schema`, a 7-day query (unpriced calls 1, down from 84.7% of calls before pricing), `/` and `/usage` returning 200, new events ingested, a `message.part.delta` POST accepted with no fact stored, `integrity_check` ok, and the hook_events rollup equal to the facts count.
- Gotchas: the unit's old ExecStart path no longer existed, so it now points at `~/.local/lib/workflow/<commit>/workflow-linux-amd64` (the previous binary is kept beside it as `.bak`). Do not leave a stray tenant dir inside `serve/`, because health then reports compaction "required". A hook-kicked standalone `drain` can hold the drain lock and block the hosted drain.

---

## 16. Evidence basis

This file was written from source at master `b2094eb` (the Go server under `packages/yakka`, the Python client `plugins/yakka/client/yakka.py`, `docs/design/`, `docs/plans/`, `tools/release/`, `Dockerfile`, `packages/yakka-analytics/wrangler.toml` and the old client under `packages/yakka-analytics/src/`), by reading five narrow recon reports (analytics API, origin of the window cap, data model, neighbouring plans 21 to 24, hosting and auth) and spot-checking the load-bearing claims directly (the cap constants, the usage aggregation, the hook-fact builder). No test or build was run; no production ledger, database or credential was read; unmerged branches were read through git refs only.

Not determined, and stated as such rather than assumed: the Pages project's build command and branch (outside the repo); whether the SQLite driver interrupts a running statement on context cancel (Phase 3 proves it); the current ledger size and whether the p95 bound still holds (the bench needs `YAKKA_BENCH_DIR`); the share of real sessions with a derivable repo (Phase 4 measures it); the number of distinct scored content hashes against the 32,766 parameter limit; the live-corpus claim in `docs/plans/24-server-mcp-shim.md`.

An earlier version of this file recorded a test run on the local, unpushed `analytics-reset` branch; that run described a tree that is not on master and is not carried.


## 17. Target domain contracts

These contracts are proposed by Plan20, not shipped at the Ground revision. They are normative for refinement alongside DESIGN.md's workspace/state/catalog and phase outcomes; sections 1–16 retain the labelled Current evidence. The whole contract record is promoted to stable design docs at close-out. No implementation task briefs are specified here.

### 17.1 Range, resolution and budgets

- Owns: how every analytics route treats time windows and output size; the error vocabulary for budgets; deadlines and cancellation; the coverage and effective-window report.
- Contract:
  - **No window cap.** `tooWide`, `maxBuckets` as a window cap, and every `range too wide` response are removed. Every windowed analytics route accepts `all=1`; it starts at the earliest retained fact or rejection applicable to that route, including pre-1970 data, and ends at the resolved `to` (now when absent). `/schema` and exact-entity/content reads have no window to widen. Any ordered RFC3339 bounds within the nanosecond-representable interval are accepted: **1677-09-21T00:12:43.145224192Z through 2262-04-11T23:47:16.854775807Z**, inclusive. This is Go's signed-int64 `UnixNano` boundary used by cursors, `seconds()` and rejection comparisons (`store/analytics.go:122`; `serve/analytics.go:43-46,143`), not a product reporting policy; outside it is 400 `time_out_of_range`. `window: {requested, effective, clipped}` reports a start moved forward to `coverage.first_ts` as `before_first_data`; empty coverage has null bounds and an empty result. Coverage is route/population-specific, never a promise that an archive contains every historical event.
  - **Resolution instead of width.** Series requests explicitly accept `bucket=auto`; existing omission defaults stay unchanged (`/query` remains `none`, `/executions` remains rows-only, routes currently requiring `bucket` still require it). The server chooses the finest fitting unit among `hour`, `day`, `week`, `month`, `year`, then multi-year `bucket_step` values from the deterministic 1/2/5 × powers-of-ten ladder, aligned to calendar boundaries in `tz` (calendar arithmetic, not overflowing multi-century `time.Duration` subtraction). Thus monthly resolution is not a hidden long-history cap. One cell is one bucket × one returned dimension-key tuple × one returned measure/check; the bound uses the **product** of dimension cardinalities, including named unknown/mixed and `(other)` groups. `/schema.budgets.max_cells` defaults to 20,000 (existing `queryRowCap`), may be lowered per request and not raised. Responses report `bucket`, `bucket_step`, `requested_bucket`, `coarsened` (effective unit wider than hour for `auto`) and the cell count. An explicit over-budget unit is 400 `too_many_cells` with `suggested_bucket` and `suggested_bucket_step`; no rows are sliced. If one bucket already exceeds the budget, respond 400 `too_many_series` with `suggested_top` or a request to remove a split/check, instead of coarsening indefinitely or silently dropping a series. The client requests finer resolution after zooming with `bucket=auto`; it never changes a split or `top` without an explicit action.
  - **Lists page, they do not truncate.** `/explore` gains `limit` and a keyset `cursor` on `(event_time desc, source_type asc, source_key asc)`, where fact keys are `row_hash` and rejection keys are `id`; `/conversations` and `/executions` keep their cursors. Entity detail collections, activity and score groups also page, each with a published deterministic order. Cursors bind route, tenant, canonical filters, grain, sort, resolved window and a first-page receive watermark; later-arriving rows do not enter that traversal. Scores/derived values may change during rescoring or repricing: responses carry a derivation revision and a changed revision makes continuation 409 `cursor_stale`, offering restart, never gaps or duplicates. Aggregate series coarsen or refuse instead of slicing away newest buckets. The existing 5,000-event conversation cap remains explicit with `truncated` and the whole-run totals; the ledger link opens the cursor-paged events for that session.
  - **Deterministic order** is stated per route in the capability schema (each key and tie-break), including `/distribution` (n desc, key asc) and every entity route.
  - **Deadline, cancellation, concurrency.** Each analytics request runs under a server deadline (`budgets.deadline_s` in `/schema`; the default is set in Phase 3 from measured latency, not guessed here); on expiry the route answers 503 `query_timeout` with `retry` hints (a coarser bucket or narrower window), not a partial body. A cancelled request stops its statement and releases the reader (proved, not assumed: the driver's interrupt behaviour was not verified at Ground). Concurrent heavy reads per tenant are bounded, with 503 `busy` and `Retry-After` beyond it, so an all-time view cannot starve the writer or other readers.
  - **Work is bounded by aggregation, not by window.** Usage measures, summaries, score percentiles/series, distributions and entity/cohort reads aggregate in SQL or from rollups; no handler retains all scanned rows, hashes, scores or values in Go memory. Exact percentile/rank operations may spill bounded database working sets to disk under the same deadline; no approximate percentile is labelled exact. `ScoreSeries` uses joins rather than one bind parameter per hash. Detail histories are paged; scatter samples and population marginals are server-side bounded results. SQL grouping versus rollups and the driver's interruption strategy are open implementation choices; the fixed proofs are row-independent Go heap, cancellation releasing the reader, and the unchanged benchmark p95 contract.
  - **Honest carry-overs.** `partial` (compaction not complete) is emitted by every analytics route with `partial_reasons`, not only `/query` (`serve/analytics_query.go:109-111`); `/series` honours `tz` (it ignores it today, `store/analytics.go:420-471`); `/explore` and `/conversation` events carry a `priced` boolean so an unpriced call is never shown as `$0` by a tokens-and-zero-cost guess (the store keeps `priced` private, `store/conversation.go:34`, `store/analytics.go:971-979`). Responses add a machine-readable `code` beside the existing human `error` string; the existing strings are unchanged.
- Non-goals: a retention policy or deletion of data; changing the p95 bound (it remains the performance contract: a request any UI makes must fall inside what the benchmark covers, so the benchmark's presets gain all-time and the bucket domain gains `auto`); any new storage tier.


### 17.2 Capability schema and coverage

- Owns: the machine-readable statement of what the server can answer, which the UI is driven by, so no limit or capability is hard-coded in a client.
- Contract: `GET /v1/analytics/schema` keeps `measures` and `buckets` unchanged and adds, additively:
  - `budgets`: `max_cells`, `deadline_s`, `top_max`, `page_max`, `scatter_points`, `content_bytes`, `explore_page_max`, heavy-read concurrency, predicate/URL size limits and the retained time range. `resolutions` adds `auto`, year and multi-year step semantics without removing any entry from legacy `buckets`.
  - `grains`: for `time`, `session`, `artifact`, `content`, `plan`, `execution` (later `review`), the identity, measure units/null/time rules, lens domains, supported modes/routes and joins. Content is aggregate/cohort-only, with selected kind/check; it is not a file listing. Each grain has a bounded `id` identity lens for explicit manual mark selection; ordinary lens filters never accept another grain's identity.
  - `lenses`: each lens with its entity namespace, whether it is single-valued per entity (partitions the population) or set-valued, and the unknown and mixed values it can take.
  - `coverage`: first and last `ts` per fact type, last `received_at`, `compaction`, `pending`, `screen_gaps`, whether a scorer is configured, counts of scored and total distinct artifact content hashes per kind, sessions with and without a derived repo, and pricing/catalogue/tool-kind revisions. This is tenant-wide availability; each query also reports population-specific coverage and its time basis. Compaction/policy removals and unsupported capture are named; no retention-by-age guarantee is invented.
  - `features`: capability flags (`bucket_auto`, `entities_session`, `entities_time`, `entities_artifact`, `entities_plan`, `entities_execution`, `scores_by_lens`, `artifact_content`, `activity`, `cohort`, `exclude`, and, when those servers exist, `actions`, `reviews`). Flags are advertised only when their route/lens contracts are served; later-phase routes are not advertised in Phase 4.
  - The shared filter gains **`exclude=<dim>:<value>`** (repeatable; AND NOT IN, same dimensions as the include filter) so that an exclusion is a real server operation and never the old complement-of-facets workaround.
- Non-goals: a query language; making `/schema` a place to store policy.


### 17.3 Entities, populations, predicates and activity

- Owns: the entities the workspace explores, their identities, the joins between them, their measures and lenses, and the routes that list and describe them. This is the semantic core that makes scatter, drill-down and cohort links honest.
- Contract, **entities and identities** (all derived from stored facts; no new stored tables are required by the contract):

  | Grain | One row is | Identity | Derived from |
  |---|---|---|---|
  | `session` | an agent conversation | `conversation_id` | facts by `conversation_id` (existing `/conversations` semantics, extended) |
  | `artifact` | a plan file over its life | `(repo_id, path)` | `artifact_version` facts; kind and plan from path (`keys/keys.go:168-186`) |
  | `plan` | a `docs/plans/<plan>/` folder | `(repo_id, plan)` | artifact facts with that `plan` |
  | `execution` | one brief run | `(repo_id, conversation_id, brief_path)` | existing `/executions` rule (`store/analytics.go:521-551`) |
  | `time` | a bucket | `(t, tz)` | existing `/query` |
  | `content` | one scored-content observation for a selected kind/check | tenant-local `content_hash` | `/scores`, `/score-series`; distinct from artifact files |

  A *version* of an artifact is `(repo_id, path, content_hash)`. Scores attach to the tenant-local `content_hash`, which can be shared by several paths/repos (`store/store.go:80-83`); these are different populations, never interchangeable. Entity membership is an in-window fact for that entity (execution membership follows existing in-window brief versions). For a member artifact, latest version is selected over its lifetime by `received_at desc, rowid desc`, matching the existing artifact read; its version timestamp and whether it falls outside the window are shown. The reader exposes lifetime history through paged collections. A plan's associated sessions are sessions active in the scope window that have lifetime artifact facts under the plan. Session repo/model/harness and version attribution are derived over the lifetime before window and lens filters, so brushing does not reassign an entity's provenance; measures remain in-window and are labelled accordingly. Late facts can revise attribution, with the receive watermark/derivation revision making this visible.
- Contract, **joins** (each with cardinality, the attribution rule, and the label the UI must show):
  - *version → writing session*: `conversation_id` of the earliest `artifact_version` fact for that `(repo_id, path, content_hash)` (ties by `row_hash`). Single-valued, so every artifact-grain distribution partitions its population. A later session re-saving identical bytes is counted in `also_seen_sessions` and never moves the version. Label: "earliest observed writing session for this version"; this is captured provenance, not proven authorship.
  - *session → repo*: distinct nonempty `repo_id` values of its artifact and commit facts (never hook rows). The lens is named **`session_repo`** at every grain: the single repo when exactly one, `(multi)` with `repos` listing them when several, `(none)` when absent. `repo_attribution` is `single|multi|none`; these groups partition sessions and their additive measures. A direct artifact `repo_id` remains a separate lens. No session is dropped for missing provenance; unattributed coverage is reported.
  - *session → model*: `models` with shares over deduplicated calls (existing usage deduplication); `session_model` is a nonempty model holding at least 80 percent of all calls, `(mixed)` otherwise, `(none)` for no calls, `unknown` when every call lacks a model. Missing-model calls stay in the denominator. The policy and threshold are published in `/schema`; this is a session association, never author identity. A call's `model` remains a distinct lens.
  - *session → harness*: the most frequent harness over its facts, ties lexicographically, matching the existing mode rule; missing is `unknown`. `harnesses` and `harness_mixed` expose every observed harness when several occur, so a mode is never presented as exclusive provenance.
  - *session → cost*: the existing priced-at-read sum with `unpriced_calls`; a session with unpriced calls reports `cost_usd` as a lower bound with `cost_lower_bound: true`; a session whose calls are all unpriced reports `cost_usd: null`, never 0.
  - *plan → sessions*: sessions with at least one artifact fact under that plan (many to many). `associated_cost_usd` is the sum of those sessions' in-window costs and is **non-additive across plans**: `shared_sessions` counts sessions touching more than one plan, and any total over plans is labelled overlapping. When Plan 22 `action_plan` exists, an additive `attributed_cost_usd` (segment-exact) is offered beside it, never instead of it.
  - *artifact → score*: latest score by `id` per `(content_hash, check)` for the selected version; null with `unscored` when absent. `score_scorer:<check>` carries that row's scorer string (e.g. `jev-1.13.0`); it is not necessarily the screen's scorer or another check's scorer. A scalar `scorer` lens is valid only for a selected check; multi-check charts label each series independently. The model string is recorded, prompt/rubric revision is not, so even a common scorer cannot establish unchanged rubric comparability. Default charts facet different scorers; pooling requires an explicit action and banner. Bands use per-kind/check/scorer all-time baselines over distinct hashes, with strict below-p25/above-p75 and inclusive `mid`; missing baseline is `baseline_unavailable`, not `unscored`.
  - *execution → session*: `conversation_id`. Shape is `complete`, `unreported` or `started` by the existing rule (a commit in the conversation and repo; a report version for the brief's stem). It measures process completion, not success.
  - *cohort links* (below) are the only cross-grain filter, and they resolve through `conversation_id`.
- Contract, **measures by grain** (every measure states unit, `null` rule and time basis; the UI offers an axis or metric only when it is in this table for the grain, from `/schema`):
  - `session`: `cost_usd`, `unpriced_calls`, `model_calls`, `tokens_in|out|cache_read|cache_write|reasoning`, `hook_events`, `commits`, `artifact_versions`, `distinct_content`, `duration_s` (last minus first in-window fact `ts`; observed span, not active work time). Measures count over scope like `/conversations`; `spans_window` identifies facts outside it. Lenses: `harness`, `session_model` (+ shares), `session_repo`, `origin` (`agent`, `feedback` for `feedback-*`, `review` for `review:*`; convention-based, not verified authorship), `has_artifacts`. No-call cost is 0; calls with none priced have null cost; partially priced sums are lower bounds.
  - `artifact`: `versions`, `distinct_writing_sessions`, `first_ts`, `last_ts`, `content_bytes` (selected version's full blob length, null with `content_unavailable` when unstored), `score:<check>` for the kind's comparative checks (0 to 1, higher better), and `writing_session_cost_usd`, `_model_calls`, `_tokens_*`, `_hook_events` (the selected version's writing session, aggregated inside the current window; zero observed calls and missing pricing are distinguished). Lenses: `kind`, `plan`, `repo_id`, `harness`, `session_model` of that version's writing session, `source`, `screen_verdict`, and selected-check `scorer` and `band:<check>` (scorer-specific position among peers, never pass/fail). Version metadata exposes every check's scorer independently.
  - `plan`: `artifacts` by kind, `versions`, `sessions`, `shared_sessions`, `associated_cost_usd` (+ `unpriced_calls`), `executions_complete|unreported|started`, `complete_share` (complete / all executions, null with `no_executions` when denominator zero), `design_score:<check>` (latest design version), `span_days`, `first_ts`, `last_ts`. `span_days` is observed first-to-last artifact time, not work duration. Lenses: `repo_id`, `harness`, `session_model` (one vote per associated session, mode with lexical ties for harness, 80 percent dominance for model; `(mixed)`, `unknown`, `(none)` remain distinct). Null/lower-bound cost rules propagate from sessions; summed session cost never becomes plan-exact spend.
  - `execution`: `session_cost_usd`, `brief_score:<check>`, `report_score:<check>`, `ts`. Lenses: `shape`, `plan`, `repo_id`, `harness`, `session_model`.
  - `time`: every existing `/query` measure, with `session_repo` and `session_model` on fact-derived measures through their session join. Rejections have no such join and retain `stage`; missing joins return `unsupported_join`. The existing direct `repo_id` on hook/usage measures remains empty for compatibility. Additive sums partition by the single-valued session lenses; distinct counts such as conversations or content can overlap across call-model/time groups and carry `non_additive` plus the unsplit denominator. Numeric time-grain scatter obtains its two aggregate measures from `/entities?grain=time`, not a browser join of unrelated result sets.
- Contract, **routes** (proposed here and owned by this plan; names are the contract):
  - `GET /v1/analytics/entities?grain=<g>` for `session|artifact|plan|execution|time`: shared filter (with `exclude` and `cohort`), `sort=<measure>:asc|desc`, `where=<measure>:<lo>..<hi>` as an AND-only shorthand, `predicate=` for the Boolean grammar below, `fields=`, `limit` (at most `page_max`) and keyset `cursor`. Ties use the full identity. Defaults are session `last_ts desc, conversation_id asc`, artifact `last_ts desc, repo_id asc, path asc`, plan `last_ts desc, repo_id asc, plan asc`, execution `ts desc, conversation_id asc, brief_path asc, repo_id asc`, time `t asc, tz asc`. Rows are `{id, m: {measure: value|null}, l: {lens: value}, flags}`; null measures carry a reason. Every response includes typed `population` metadata described below; totals come from the server, never the returned page.
  - `…/entities?grain=<g>&mode=scatter&fields=<2..4 measures>`: returns every entity in the filter when the population is at most `budgets.scatter_points`, otherwise a **deterministic hash sample** (`sampled: true`, `sample_rule`, `population_n`, `returned_n`; the same query returns the same points), plus `marginals` (fixed-bin histograms of each field over the **whole population**, not the sample). A scatter is only drawn from a response that says what it is.
  - `…/entities?grain=<g>&mode=aggregate&stat=count|sum|percentiles|histogram`: a bounded grouping over that entity population (also `content` for selected kind/check), with `field=` for numeric operations, zero to two schema-supported `dim=` lenses and optional `bucket=auto|<unit>`. Count uses entity identity, sum only schema-marked additive fields within that declared population (plan-associated costs stay non-additive across plans), percentiles/bins use the same null/pricing eligibility as scatter. Responses report groups, typed populations and omitted-group coverage under cell/series budgets; exact percentile computation is server-owned. This supplies score-range predicate counts, artifact band composition and execution-shape grouping without fetching whole lists. At `grain=time`, two-to-four `fields` are aggregate measures over a common bucket/window, returned on a shared bucket grid; missing counts may zero-fill, missing scores never do. Only schema-listed operations are offered; no general expression language is introduced.
  - `GET /v1/analytics/entity?grain=artifact&repo_id=&path=` returns scalar metadata and **one** cursor-paged `collection=versions` ordered `received_at desc, content_hash asc`; each version includes event/receive times, writing session, harness/model, source/sha, screen and per-check scores/scorers. `grain=plan` returns metadata and one of `collection=artifacts|executions|sessions|events`, each with independent `limit`, `next` and population totals. Orders: artifacts `path asc`; executions and sessions as above; events `ts desc, event_type asc, identity asc`. It never embeds unbounded arrays. `grain=session&id=` aliases the bounded existing `/conversation`. Every collection is under the same deadline, receive watermark and revision rules as lists.
  - `/scores` and `/score-series` gain `dim=` (`harness`, `session_model`, `repo_id`, `plan`, `scorer`, `screen_verdict`), `scorer=` and a selected `check=`. Their observation remains **distinct content hashes**, per kind/check (per bucket for series), as on master. First select eligible artifact facts under the window/shared filters/cohort; choose the canonical representative per hash by `ts asc, row_hash asc, repo_id asc, path asc`; then derive its lens. Each hash contributes once to one group, including when identical bytes occur across paths/plans/repos. Lens filters on derived attributes are applied after that representative is chosen. A filtered repo view canonicalises within its eligible facts; it does not claim global authorship. Per-group `n` plus explicitly omitted groups equals the unsplit **same filtered hash population** for that check/bucket; series counts need not sum to window counts because a hash may recur in several buckets. Artifact entity/strip/scatter rows stay file-weighted and show their separate population unit. Scores select the latest row per `(hash,check)` before filtering by its scorer, without reviving historical scores. Group lists page rather than silently dropping top-N values.
  - `GET /v1/baselines?kind=&check=&scorer=&population=content` adds the **new** baseline mode needed by this plan: latest score per hash/check over all retained content of that kind, partitioned by that score's scorer, with `n` and null quartiles when absent. Omitted new parameters preserve the existing latest-file-weighted baseline. All new quality overlays and bands use the explicit content/scorer mode; pooling combines declared groups only on explicit request and retains the caveat that rubric revisions were not captured. `/distribution` gains `dim=harness|session_model|session_repo` beside `model`; call rows use their call harness/model, conversation rows use declared session attributes. Per-group counts only reconcile when all groups and the same eligibility are included; omitted groups and unpriced/lower-bound populations are reported.
  - **`cohort=`** on `/query`, `/distribution`, `/summary`, `/conversations`, `/executions`, `/scores`, `/score-series`, `/explore`, `/activity` and `/entities` is canonical URL-percent-encoded JSON: `{v:1, grain, scope:{from,to,tz,include,exclude}, predicate:<node>, op:include|exclude, source?}`; `op` defaults to `include`. Scope freezes absolute bounds when promoted, independent of the board's relative window. Resolve the **positive source predicate first** to a session set C: session → itself, artifact → selected-version writing sessions, content → canonical representative writing session, execution → its conversation, plan → associated sessions, time → contributing sessions as below. Target queries apply their own scope, then include sessions in C for `op=include` or remove sessions in C for `op=exclude`. Exclusion is set subtraction **after resolution**, never `resolve(not(predicate))`. Source Boolean `not` still complements inside its own grain and can intentionally resolve differently; the tray labels source subtraction separately from board exclusion. Valid empty C includes nothing or excludes nothing respectively, both 200; malformed/unsupported definitions are 400 `cohort_invalid`. Definitions are stateless/re-evaluated under the same budgets; late-data changes carry the derivation revision.
  - **Time-cohort resolution.** A time-scatter cohort carries `source:{fields:[measure names],bucket:<effective unit>,bucket_step:<effective step>}` from its response; the fixed source window/tz and resolution reproduce its bucket grid. Evaluate the predicate over whole-population aggregate bucket rows, then resolve distinct existing sessions with at least one eligible contributing fact/call in a selected bucket for any named field. Bucket intervals are half-open, intersected with the inclusive source window; deduplicated usage follows the usage measure's identity. Selecting daily cost/commit buckets therefore means “sessions contributing to these buckets”, not a causal pairing of calls with commits. Receipt-time rejection contributors require a recorded conversation ID that resolves to an existing session; missing/orphan associations are counted separately, never invented. The target applies its own window to C and explicitly reports expansion to those sessions' other facts/artifacts/plans. Unsupported source operations are disabled with the missing join/reason. Time-cohort evaluation, including bucket aggregation, is inside the same deadline/memory/predicate budgets.
  - **Predicate grammar.** A node is exactly one of `{"and":[nodes]}`, `{"or":[nodes]}`, `{"not":node}`, `{"range":{"measure":name,"lo":number|null,"hi":number|null}}` (inclusive), `{"in":{"lens":name,"values":[strings]}}`, or `{"is_null":{"measure":name}}`. Ranges on null values are false; `not` complements within declared grain/scope. Keys are lexically sorted, numbers normalised, commutative children/values sorted and deduplicated for canonical URLs/cache keys. No executable expressions, recursive cohort references, cross-grain predicates or arbitrary SQL; names are schema-validated. Defaults: 64 leaves, 64 values per `in`, depth 8, four cohorts, 8 KiB **total encoded view URL**, all published. Over-budget selection leaves scope unchanged and offers a smaller region/simpler predicate; never clips. Rectangle union uses `or`, Alt-subtraction `and(previous,not(rectangle))`, additive categories `in`; exclusions negate the same predicate. Explicit individual clicks may use bounded `in(id,…)`; rectangles/cohort regions never expand sampled marks into identity lists. Content cohorts resolve through the same filtered hash representative as `/scores`, to its writing session; file cohorts keep their selected-version rule. The resulting association and possible expansion are named in the tray.
  - **Typed populations.** Each result reports `{grain, unit, scope_n, cohort_n, eligible_n, returned_n, missing_by_reason, relation}` per check/measure where needed. Scope is base window/include/exclude, cohort is after cohort restriction, eligible is after non-null axis/check requirements; `returned_n` is page/sample size. `relation` names a cross-grain mapping and distinct resolved sessions/expanded entities. A selection of 143 sessions can contain 400 artifacts and 12 plans: those counts are labelled and reconcile within their own units. Hash-weighted quality, file-weighted scatter, execution shape, calls, and priced versus unpriced/lower-bound session distributions never share an unlabeled denominator.
  - **Activity and Follow.** `GET /v1/analytics/activity` returns a tenant-bound, shared-filtered, cursor-paged union of session-start, artifact-version, brief-execution and rejection observations (identity includes observation type), ordered `event_time desc, type asc, identity asc`. Session starts and execution rows derive from existing facts; no claim of a session's completion is made. `mode=probe&after=<opaque receive watermark>` returns only counts by observation type and a new watermark, including late arrivals by receive time; it is not an unbounded raw fetch. Both modes obey population coverage, unsupported-filter reporting, deadlines and cancellation. This owned Phase 6 route supplies `river` and Follow instead of a browser merge of independently truncated lists.
  - A measure or lens asked of a grain that does not have it, or a join the table above does not define, is 400 `unsupported_join` with `reason` and `try` (the nearest supported combination). Nothing is silently coerced.
- Conversation timeline coverage: return `returned_events`, `total_events`, `returned_unpriced_calls` and `total_unpriced_calls` alongside existing totals/truncation; returned-event pricing uses the same deduplicated usage identity. UI markers reconcile to returned events, not omitted calls. The paged `/explore?conversation_id=` route reaches omitted events.
- Non-goals: per-call or per-event entity rows (calls appear only as distributions and in a session's timeline); phase entities (no server data exists); reviews and actions (design-only, below); a stored cohort or saved-query table; any composite "quality score" across checks (checks are not commensurable and each is shown alone).


### 17.4 Artifact content

- Owns: read access to the text and history of the artifacts the ledger already stores.
- Contract: `GET /v1/analytics/content?repo_id=&path=&hash=` (bearer `read` scope or session, tenant-bound like every analytics route) returns **complete** version bytes as `text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. A 64-hex hash must be referenced by that tenant's exact `(repo_id,path)`; unknown or other-tenant-only hashes are indistinguishable 404. Verify the full blob's SHA-256 before returning it; a mismatch is 500 `content_integrity`. A blob exceeding `budgets.content_bytes` (default 16 MiB, grounded in the ingest body limit, not a guaranteed artifact size) is 413 `content_too_large` with full byte count and limit; **no prefix body** is returned or diffed. Missing bodies are 404 `content_unavailable` with `removed_by_screen`, `pending`, or `not_stored`; pending paths are never served. Screened-pass and explicit `unscreened` blobs remain distinguishable in metadata; the latter are not claimed secret-free. Only design, brief and report are stored; `IMPLEMENTATION.md`, `REVIEW.md`, `QA.md`, `PROVENANCE.md` and legacy `PLAN.md` remain unavailable. Content verification/read obeys the same deadline and cancellation budgets.
- Trust change, stated: analytics reads previously returned no bodies (CONTRACTS.md 7). This deliberately extends tenant/read-scope access to promoted blobs, the material search already exposes as snippets. Some blobs have only deterministic precheck and an explicit `unscreened` verdict when no scorer exists; none is claimed safe merely because it is present. Pending/rejected bytes remain unavailable. Assumption 9 records this boundary.
- Non-goals: a diff route (diffs are computed in the browser from two fetched versions, bounded by size); markdown or HTML rendering on the server; content for unstored files; write access.


### 17.5 Chart kit

- Owns: the chart elements, tooltip, legend, colour registry, gesture handling, accessible table view and the testability surface.
- Contract:
  - **uPlot as published**, vendored verbatim: `uPlot.esm.js` 1.6.32 (145,423 B as published, not minified) and `uPlot.min.css` (1,857 B) under `vendor/uplot-1.6.32/` with a `NOTICE` recording name, version, source, licence (MIT), sha256 of each file (`5dd9b3281aa64b461b42d9945f6adb2649d346502b12281a9ae0d46599a80eba`, `df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04`, measured from the npm tarball on 2026-11-02) and the reason it is there; a test compares the files to the hashes. Size and minification are settled (the user confirmed uPlot as published) and are not a product question. Runtime dependencies: 1, with none transitive.
  - **Elements** (custom elements, Shadow DOM, a constructable stylesheet that includes uPlot's CSS, colours read from CSS custom properties so a theme change is a re-read): `<yk-chart>` (uPlot: lines, area, stacked columns, cumulative and share modes, cursor-synced scale groups, **numeric-x scatter** with point colour, shape and size, **ECDF** step lines), and SVG elements for the shapes a time-series engine does not do: `<yk-bars>` (ranked, stacked, 100 percent, lollipop, slope), `<yk-ranges>` (box and whisker with p95 and an optional baseline band, histogram, strip or dot plot), `<yk-matrix>` (heatmap, calendar), `<yk-lanes>` (timeline and gantt lanes, with markers), `<yk-treemap>`. Each takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush` events, and exposes `inspect()` for tests.
  - **Scatter** is two-dimensional nearest-point hover and rectangle selection over up to `budgets.scatter_points` points, built on uPlot's hooks. If uPlot as published cannot carry 2-D hit-testing and rectangle brushing at that size, the fallback is a first-party canvas scatter element behind the same element contract; no second library is added.
  - **Colour registry.** Each entity (a model, harness, repo, kind, scorer, stage, tool kind, cohort) takes a slot in a fixed categorical order, keyed `namespace:name`, kept in `yakka-analytics-entity-colours`; eight hue slots, then distinct labelled/patterned neutral styles for additional keys and `(other)`; `(mixed)`, `(none)`, `(multi)`, `unknown` and `unscored` have fixed neutral styles of their own and are never merged into grey `(other)`. A filter or toggle never repaints a surviving series. Palette (eight categorical hues, a sequential ramp, a diverging ramp for deltas, status colours) is validated by a committed first-party check for contrast and adjacent-slot distance in both themes; any optional external validator is supplementary; the first-party check is the acceptance proof.
  - **Rules from the dataviz discipline that bind every panel:** no dual axes (two measures are two linked charts or a scatter); a legend whenever there are two or more series; units and the time basis in the frame; zero-based axes for bars; no chart without a table view; no chart that is a picture of something the interaction model cannot act on.
  - **Testability surface.** Every chart carries `data-chart`, `data-state` and exposes `inspect()` returning window, selection, bucket, series visibility, plot rectangle, `xToPx`/`yToPx`, cursor and marks, so tests convert data to mouse coordinates and read outcomes; the tooltip carries the key under the cursor. Nothing in the app branches on being under test.
- Non-goals: chart types no panel uses, animation, export to image, a charting API for third parties, a second charting library.


### 17.6 Serving, release and Pages

- Owns: embedding and serving the site from the binary, the Pages configuration the repo declares, the release build, the headers.
- Contract:
  - **Layout** (`packages/yakka-analytics/web/`): `index.html`, `_headers`, `css/`, `js/` (`app.js`, `core/`, `charts/`, `panels/`, `boards/`, `explorers/`, `identity/`), `contract/` (the framework-free transport, return-path and session-gate logic as ES modules), `vendor/uplot-1.6.32/`. Asset URLs are absolute (the same `index.html` answers every client route). No `404.html` (Pages would stop falling back to `/`). The package holds no `package.json`, lockfile or bundler config, and `tools/release/build.sh` needs no Node: it embeds `web/` by default, excluding `_headers`, and restores the committed placeholder on exit.
  - **Cache and headers**: `index.html` and the fallback `no-cache`; any path under `vendor/<name>-<version>/` `public, max-age=31536000, immutable`; every other file `no-cache` with a content `ETag` so it revalidates to 304; `site.go` and `TestSiteBuiltMode` change from the SvelteKit `_app/immutable/` rule to these generic rules (CONTRACTS.md 10.1). One CSP and frame policy, identical in `_headers` and the embedded handler (a test compares them): `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'` plus `X-Frame-Options: DENY`. `connect-src` is wide because Settings accepts any collector base.
  - **Pages deploys by merge, outside this repo.** The repo declares only `packages/yakka-analytics/wrangler.toml` (`name`, `pages_build_output_dir`); it holds no `.github` and no deploy script (`tools/release/build.sh` "never uploads"). The user states that merging to master deploys Pages through the automation job. The plan therefore ends at a ready, tested PR: `wrangler.toml` names `./web`, nothing builds, and nothing in this plan deploys, changes the job or touches a secret. Because merge is deploy, identity (Phase 2) is complete before the PR is ready. What the job executes (a build command, an output directory) cannot be seen from the repo; a mismatch fails the Pages build and leaves the previous deployment serving (Open Question 1).
  - **Server deploy is separate and not automatic.** Fly serves the API; the workspace feature-detects (shell contract) so a Pages deploy that precedes a server deploy shows unsupported states, never errors or silent clips.
- Non-goals: deploying, changing `fly.toml`, the Docker image, the automation job or any secret.


### 17.7 Test harness and fixtures

- Owns: `packages/yakka-analytics/tests/` (not shipped), the deterministic fixture ledger and its Go generator, the stub identity API, the legacy-server stub, the chart gallery.
- Contract: real-browser tests (Chromium only, `playwright-core` as the single test-only dependency driving the system browser, Node's built-in runner, no bundler or framework) against a real `yakka serve` on a fixture ledger written by a non-shipping Go generator in `packages/yakka`; fixed timestamps; **multi-year** so unbounded windows are real; several harnesses, models, repos, scorers; priced and unpriced calls; sessions that touch one, several and no repos; artifacts of all kinds with stored bodies and several versions each; plans that share sessions; executions in every shape; rejections at both stages; scores per kind; one session above 5,000 events; more than 32,766 scored hashes for the parameter-limit proof; identical bytes across paths/plans/repos, rescores with different scorers per check, pre-epoch and multi-century timestamp bounds, exact population manifests, and unpriced events beyond the conversation cap; a committed manifest of every shape and count that a test checks. Fixtures are synthetic by construction and exist only in tests and the generator; the product has no sample-data path. Identity runs against a contract-faithful stub on a Pages-faithful topology (Chromium host-mapping `yakka.build` and `api.yakka.build` to loopback with a throwaway certificate generated at test time). A legacy-server stub (old `/schema`, `range too wide`) proves graceful degradation. Tests wait on `html[data-idle="true"]` and explicit end-state conditions only (URL, `data-state`, `inspect()`); charts are driven with real mouse and keyboard events at coordinates from `inspect()`; no fixed sleeps; any `console.error` or CSP violation fails a spec; the harness asserts at most 4 requests in flight on every page.
- Non-goals: visual-regression screenshots, performance tests of the server beyond the Go bench, cross-browser automation (the code uses only evergreen features; only Chromium is exercised).
