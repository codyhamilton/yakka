# Design Intent 3: Remote Service

The service that accepts facts from the drain, holds them, screens and scores content, and answers
the advisory shim. Part of [system-architecture.md](system-architecture.md); accepts the envelope
types in [01-event-model-and-ingest.md](01-event-model-and-ingest.md) from the drain in
[02-edge-capture.md](02-edge-capture.md).

## Problem

The current service (`tools/quality/server.py`) is a Python process tied to the agent-facing MCP
tools that are being retired, with session and lifecycle state the event model no longer has. The
replacement must run the same way on a laptop and on a server, cost as little as possible while
idle, and take a write-heavy, bursty stream without the hooks ever waiting on it.

## Runtime

The **collector** is one Go binary, `yakka`, with subcommands:

| Subcommand | Role | Design |
|---|---|---|
| `yakka serve` | this service, local or remote | 3 |
| `yakka ledger` | ledger routes on the collector | 3 |

In local mode `yakka serve` also hosts the drain in-process ([Local serve hosts the drain](#local-serve-hosts-the-drain)).

The **plugin client** is `python3 plugins/yakka/client/yakka.py` (via [design 5](05-distribution.md)'s wrapper):

| Invocation | Role | Design |
|---|---|---|
| `python3 plugins/yakka/client/yakka.py drain` | the drain | 2 |
| `python3 plugins/yakka/client/yakka.py mcp` | the stdio advisory shim | 2, 4 |
| `python3 plugins/yakka/client/yakka.py login [start\|wait]` | device-code login | 5 |
| `python3 plugins/yakka/client/yakka.py status` | queue and drain state | 2 |

- Collector targets: linux and darwin, amd64 and arm64. WSL is linux. No Windows-native build.
- No cgo. SQLite is the pure-Go `modernc.org/sqlite`, so all four collector targets cross-compile from one
  machine and the binary is static.
- HTTP is `net/http` from the standard library. No framework, no ORM.
- Go was chosen over Python, Node and Rust for the collector's idle footprint, a static binary with nothing to
  install on the host for `serve`, and one implementation for the collector service (API, hosted drain, ledger)—not
  the plugin tree. The plugin client is Python ([design 2](02-edge-capture.md), [design 4](04-advisory-surface.md),
  [design 5](05-distribution.md)). The cost is a build and release step for the collector binary, owned by
  [design 5](05-distribution.md).

Only `spool.sh` stays bash, because a hook must not pay a process start beyond `bash`.

## Local and remote

The same binary and code path in both. Differences are configuration only.

| | Local | Remote |
|---|---|---|
| Bind | `127.0.0.1:8770` | as configured, behind a TLS proxy |
| Data | `~/.local/share/yakka/serve` | as configured |
| Tenants | one | many |
| Drain | hosted in-process (below) | none; clients run their own |

Port 8770 avoids the legacy Python service's 8765 while both exist.

### Configuration

Server configuration is environment only:

| Variable | Meaning |
|---|---|
| `YAKKA_SERVE_ADDR` | listen address, default `127.0.0.1:8770` |
| `YAKKA_SERVE_DATA` | data directory; tenant facts at `<data>/<tenant>/`; the token registry, sessions, and admission policy live alongside, not inside a tenant directory |
| `YAKKA_SERVE_KEYS` | must be unset or empty; any non-empty value makes the process exit before it listens on loopback or remote. Legacy env-key credentials are not supported. |
| `YAKKA_SERVE_CORS_ORIGINS` | comma-separated exact origins allowed to call bearer-authenticated reads from a browser; unset or empty means no CORS headers; ignored in local mode, which allows loopback origins ([design 7](07-analytics-site.md#browser-access)) |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `YAKKA_PUBLIC_URL` | set together for remote collector mode (non-loopback bind); ignored on loopback ([design 5](05-distribution.md#local-bootstrap)) |
| `TYPESAFE_API_KEY` | scorer credential; server side only, never in any client config |

**Local mode** is loopback with no credential requirement, for one user on one machine:

- Every request maps to tenant `local`; any `Authorization: Bearer` token and any session cookie are
  ignored.
- The bind must be loopback; a non-loopback bind without the GitHub OAuth env is refused at startup.
- Browser guards: the `Host` header must be a loopback name (stops DNS rebinding), and a POST must
  be `Content-Type: application/json` (a cross-origin form cannot send it without a preflight).

**Remote collector mode** is a non-loopback bind with the GitHub OAuth env set. `YAKKA_PUBLIC_URL`
is the API origin. A person signs in with GitHub; the Pages site (or the embedded site in a local
or release binary) uses the session for the dashboard and profile ([design
7](07-analytics-site.md#shape)). On the profile they create tenants and issue API tokens.
Each issued token is plaintext `wk_` plus an unguessable body, belongs to one tenant, has scope
`read` or `read_write` chosen at creation, and expires at an `expires_at` the issuer set with no
server default. Clients and agents configure that plaintext as `Authorization: Bearer`. The
registry stores SHA-256 only; comparison is constant time and neither plaintext nor hash is logged.
The session cookie is not a bearer token and is not used for ingest.

`POST /v1/tenants`, `POST /v1/tokens`, `GET /v1/tokens`, and `POST /v1/tokens/<id>/revoke` are
session-only (a bearer on those routes is 401). Revocation and expiry take effect on the next
request without restart. A domain-policy change does not revoke tokens.

A remote ledger route with no bearer and no session is 401 and names sign-in at `{YAKKA_PUBLIC_URL}/login`.

## API

Versioned by path prefix. Within `/v1`, changes are additive only: new optional fields, new
endpoints. Unknown fields in a fact are kept in its raw payload, never rejected.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | none | liveness, version, pending count, screen gaps, `compaction` (`complete` or `required`) |
| `POST /v1/ingest` | local: none; remote: bearer `read_write` | a batch of facts from a drain |
| advisory reads (`/v1/artifacts`, `/v1/checks`, `/v1/baselines`, `/v1/search`) | local: none; remote: bearer `read` or `read_write`, or session with `?tenant=` for an owned tenant | defined by [design 4](04-advisory-surface.md#api) |
| analytics reads (`/v1/analytics/*`) | same as advisory reads | defined by [design 7](07-analytics-site.md#analytics-reads) |
| `GET /v1/whoami` | bearer only (local: none) | the tenant, scope and `expires_at` (Unix seconds, 0 for none) a bearer token resolves to; no cookie, never opens the tenant. `yakka sync` calls it before sending to check the target tenant and `read_write` scope. A 404 means a collector too old to be a sync target |
| `GET /v1/me` | session | signed-in GitHub identity and owned tenants (collector dashboard) |
| `POST /v1/tenants`, `POST /v1/tokens`, `GET /v1/tokens`, `POST /v1/tokens/<id>/revoke` | session (tenant owner) | create tenant; issue, list, or revoke tokens; plaintext `token` only in the `POST /v1/tokens` response |
| `POST /v1/device/code` | none (rate limited per IP) | start a device grant; returns `device_code`, `user_code`, `verification_uri_complete`, `interval`, `expires_in` |
| `POST /v1/device/authorize` | session (tenant owner), same-origin | approve or deny a `user_code` with tenant, scope and expiry; no token is minted here |
| `POST /v1/device/token` | none (the `device_code` is the credential) | the client polls; `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, or 200 with `token`, `tenant`, `endpoint`; the token is minted on the one successful poll |
| `GET /v1/admin/tokens` | session (admin) | list every token without plaintext |
| `GET /v1/admin/status` | session (admin) | per tenant: fact count, disk by part (ledger, WAL, archive, blobs, pending), latest screen verdicts, score counts, recent screen failures, rescore progress; plus data-volume total and free bytes and whether scoring is configured |
| `POST /v1/admin/rescore` | session (admin), same-origin, JSON | body `{"tenant"}`; screens every blob whose latest verdict is `unscreened` in the background and answers `202` with the job state. `409` when no scorer is configured or a rescore is already running for that tenant |

Admin operations are remote-only: local mode has no session, so `/v1/admin/*` answers `401`. A
rescore runs through the same screen step the worker uses, one blob at a time, and counts a
per-blob failure without stopping; an unreachable scorer aborts the job. The status page lists
screen failures but offers no retry, because content that fails five times is deleted from
`pending/` and has to be sent again.

Outside `/v1`, a binary with the site embedded serves it at `/`. The production Fly image does not
embed the site, so those paths are `analytics bundle not embedded`. Browsers follow the CORS rules
in [design 7](07-analytics-site.md#browser-access). `/v1` paths are never HTML.

### Ingest

Request: `{"facts": [fact, …]}`, each fact one design 1 envelope (`hook_event`,
`artifact_version`, `commit`) carrying the drain's `id` for that fact (`<queue file name>#<n>`,
design 2 Delivery).

Response: `200` with one result per fact, in order:

```json
{"results": [{"id": "…", "status": "accepted" | "duplicate" | "rejected", "reason": "…"}]}
```

- `accepted` and `duplicate` mean delivered: the drain deletes the file.
- `rejected` is per fact: the drain moves that file only to `rejected/` with the reason. One bad
  fact never rejects its batch.
- Whole-request errors: `400` for a body that is not a facts batch, `401` for missing, unknown,
  expired, or revoked bearer (and for bearer on session-only routes), `403` for `read` scope on
  ingest (`read-only token`), `413` above
  the size limit (16 MB), `429` with `Retry-After`, `5xx` for retry. The drain splits on `400` and
  `413` (design 2), so a whole batch is never rejected for one file.

The row hash is computed from the envelope alone (design 1), so a resent batch is all `duplicate`.
A hook event on the policy's `remove` list is answered `accepted` and stored nowhere (design 1).

### Deterministic precheck

On arrival, before anything touches disk, every fact's text fields and artifact content are matched
against a fixed pattern set: the client scrub's patterns plus provider key formats, JWTs,
connection strings with inline passwords, and `.env`-style assignments to names ending `KEY`,
`SECRET`, `TOKEN` or `PASSWORD`.

- A hit rejects the fact. The reason names the pattern and line, never the matched text.
- A record that a rejection happened (fact type, conversation, path, content hash, pattern name)
  is kept. The content is not.
- The rejection reaches the agent through the shim (design 2); the rewrite is the repair.

## Storage

One directory per tenant: `<data>/<tenant>/`.

- `ledger.db`: SQLite in WAL mode, `synchronous=NORMAL`.
- `blobs/<aa>/<hash>`: content stored by SHA-256, written once. Rows hold the hash, never the bytes.
- `pending/<hash>`: content awaiting the screen (below).
- `archive/<YYYY-MM>/<conversation_id>.jsonl.zst`: received hook bodies (below).

`yakka serve` takes a shared lock on the tenant directory while the tenant is open; offline
compaction takes it exclusively. Serve refuses to start on a tenant that compaction holds, and
compaction refuses while serve runs, so SQLite never has two writers.

Per-tenant files mean writes for different tenants never share a lock, and deleting a tenant is
deleting a directory.

### Writer

Each open tenant has one writer goroutine. Ingest requests hand their facts to it and wait. The
writer takes everything queued within a few milliseconds into one transaction (group commit), and
each request is answered after its commit. There are no concurrent writers, so no `SQLITE_BUSY`.
Readers use separate connections and run alongside under WAL.

### Tables

Ingest is append-only (principle 6): `INSERT OR IGNORE` keyed by row hash, never `UPDATE` on facts.
The one sanctioned exception is offline compaction (below).

| Table | Holds |
|---|---|
| `facts` | row hash, type, conversation ID, harness, event, ts, received at, repo ID, path, content hash, raw envelope JSON, and the columns below |
| `rejections` | the precheck and screen rejections described above |
| `screens` | content hash, verdict, scorer, at |
| `scores` | content hash, check, result, scorer, at |
| `meta` | key/value store state; `compaction` is `complete` or absent |
| `hook_events_hourly`, `conversations_hourly`, `facets_hourly` | hourly counts the analytics reads use for whole interior hours ([design 7](07-analytics-site.md#analytics-reads)); maintained in the fact insert's transaction and rebuilt by compaction |

A hook fact's `raw` is its envelope with no payload (design 1). Its analytics columns are filled at
insert: `norm_event`, `tool`, `model`, `tok_in`, `tok_out`, `tok_cache_read`, `tok_cache_write`,
`tok_reasoning` and `cost_reported` (null unless the harness reported a cost). Artifact and commit
facts carry `kind`, `plan`, `source` and `sha`. Schema migrations run in `Open()` and only add
columns, indexes and tables, so they never rewrite rows.

### Event archive

Each received hook body is written verbatim, after secret redaction, to
`archive/<YYYY-MM>/<conversation_id>.jsonl.zst`: one file per conversation per UTC month of the
fact's `ts`, one zstd frame per append. A line is `{"row_hash","received_at","fact"}`. A `remove`
event and artifact content (which lives in `pending/` and `blobs/`) are never archived. The archive
is not served over HTTP; a store function reads one conversation's lines in time order.

Delivery is at-least-once: ingest appends to the archive before it commits the fact rows, so a
redelivered event can appear twice and readers deduplicate by `row_hash`. A crash can leave a torn
final frame; readers ignore it and `archive.Repair` rewrites the file without it.

### Compaction

`yakka ledger compact --tenant-dir <dir>` brings a ledger written before the slim shape to it. It
is offline, takes the tenant's exclusive lock, and is resumable: a rerun after an interruption ends
in the same state. In batches it archives each body, deletes `remove` rows with no archive line,
strips the payload, fills the columns (and `kind`, `plan`, `source`, `sha` on artifact and commit
facts), then rebuilds the rollups, sets `meta.compaction` to `complete` and runs `VACUUM`. It prints
the free space it needs and refuses when that is unavailable, and reports rows and bytes before and
after. `yakka ledger purge-deltas --tenant-dir <dir>` is the same kind of offline pass for
history that predates the `message.part.delta` removal: it deletes those facts and archive lines
and rebuilds the rollups.

These deletes and rewrites are the one exception to append-only. Until compaction completes,
`/v1/health` reports `"compaction":"required"` and `/v1/analytics/query` responses carry `"partial": true`. A
remote tenant is compacted during a maintenance stop.

Derived views (execution, gaps, moves) are never built on the ingest path. The execution view is a
read: `/v1/analytics/executions` computes it per brief from `facts` at request time
([design 7](07-analytics-site.md#routes), following design 1). Any other derived view belongs to
design 4 and the lab.

### Behind an interface

`Store` exposes appending facts and the reads the API needs. SQLite is its only implementation.
Postgres replaces it if the service ever needs more than one app host; until then backups of a
remote are file copies of the tenant directory (Litestream later).

## Screening and scoring

Jev, through TypeSafe System One, is the last secret check before content is persisted (design 1,
decision 6), and the artifact scorer.

- Artifact content that passes the precheck is written to `pending/`, and its fact is stored with
  the content hash. The ingest reply does not wait for Jev.
- A worker per tenant takes pending content in arrival order and asks the scorer to screen it and,
  for artifact kinds with checks, score it.
  - Pass: the content moves to `blobs/`; a `screens` row and any `scores` rows are written.
  - Flag: the pending content is deleted; a `rejections` row records the hash and reason. The fact
    stays, with no content behind it.
  - Scorer unreachable: the content stays pending and the worker backs off. Pending count shows in
    `health`.
- Sending content to Jev for the screen means a secret the precheck missed does reach TypeSafe in
  that request. Jev is the last check before persistence, not before transmission (principle 9).
- No `TYPESAFE_API_KEY`: the screen verdict is `unscreened` and content moves to `blobs/` after
  the precheck alone. This is the expected local mode without a scorer, and the verdict says so in
  every read.
- The scorer sits behind a `Scorer` interface (`Screen`, `Score`). The model behind Jev is not part
  of any contract here.

The Jev implementation makes one System One request per content hash (`POST
https://api.typesafe.ai/v1/systemone`, as `tools/transcript/lib/jev_client.py` does today): the
kind's checks as `score` questions, plus one screen question asking whether the text contains a
credential. A screen score at or above its flag level is a flag.

Checks are the existing check definitions (`packages/yakka/catalogue/criteria.json` plus
`packages/yakka/catalogue/checks/*.json`), loaded from files at start; the execution report kind takes the
candidate checks in design 1. Rubric wording for the
execution report is defined once and shared with the skill (design 1).

## Local serve hosts the drain

In local mode `yakka serve` also drains the user's queue, as a long-lived drain.

- It takes `queue/.drain.lock` and holds it while running, so hooks find the lock held and start
  nothing.
- No hook kicks it, so it watches the queue directory (inotify on Linux, kqueue on macOS) with a
  slow poll as a fallback. The design 2 batch window still applies.
- It runs the Go drain module with an in-process sink in place of HTTP. The sink calls the same
  ingest function as the handler, so the precheck and screening apply. In process never means
  unchecked. Standalone drains on the plugin path use the Python client ([design 2](02-edge-capture.md)).
- It drains only when the client config's endpoint is this server (same host and port). Otherwise
  the queue is addressed elsewhere and it leaves it alone. Its tenant is always `local`.
- If it stops, the lock is released, the next hook starts a standalone Python drain, and that drain
  posts to the endpoint with backoff until `serve` returns.

This amends principle 8: the drain never starts or manages the service; the drain and ingest are
separated by a module boundary, not a process boundary, and a local service may host the drain.

## The legacy service

`tools/quality/server.py` and its ledger stay as they are, unmigrated and readable by the lab. The
agent-facing MCP tools it serves are retired by design 4. Nothing in this design writes to it.

## Tests

Cheap, in temp directories, never the live queue or data.

1. Ingest: a batch with one secret-bearing fact returns per-fact results; only that fact is
   rejected, with a reason that does not contain the secret; a resend is all `duplicate`.
2. Auth: on remote, no bearer, wrong bearer, `read` on ingest, and a bearer for tenant B never see
   tenant A's artifacts; session `?tenant=` is limited to owned tenants.
3. Writer: replay N tenants each sending bursts of about 20 facts; record p99 commit latency and
   database size with content stored by hash.
4. Screening: scorer pass, flag and unreachable each leave the stated state; no key gives
   `unscreened`.
5. Local hosting: while `serve` holds the lock, 20 concurrent spools start no drain; kill `serve`
   and a standalone drain delivers the rest; with the endpoint pointing elsewhere `serve` leaves the
   queue alone.
6. Compaction: a legacy-shaped fixture compacts to no payloads, no `remove` rows and an archive whose
   distinct row hashes equal the kept hook facts; an interrupted run resumes to the same state; serve
   refuses to start while compaction holds the lock.
7. Idle footprint: RSS and cold start of `yakka serve`; cold start of `python3 plugins/yakka/client/yakka.py mcp`.
