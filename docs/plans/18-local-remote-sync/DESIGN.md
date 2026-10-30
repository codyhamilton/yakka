# Local to remote sync

## Intent

User request, verbatim:

> Now that we have the yakka service running on fly, I want to be able to migrate the local tenancy to the remote one. There's a few things to consider here. First I think we should establish this as a supported pattern, allowing local to remote sync, which we use our cli for. This doesn't change remote much - it just permits a sync method, and it's up to the local to decide when and if they want to. The matching criteria is the local user is authenticated and sets the target tenancy they want to sync to. The second issue is what actually is stored, and this should be assessed - what are the forms of artifacts, how much space do they need, what's the value of each. We should have the set of object types aligned in local and remote.

> Yes let the tenant decide in configuration, this is a data retention setting. /design a plan for implementation, including both the sync mechanism and the discussed archive. You can split them into separate designs and use subagents to put together

## Problem

**Scope.** This plan covers sync, the assessment of what is stored, and keeping object types aligned. How long the archive is kept, the retention setting and the cold tier belong to [plan 17](../17-archive-retention/DESIGN.md), and this plan's phases do not try to resolve them.

The problem has four parts, each closed by the phase named:
1. History can't leave a local tenant (Phase 2).
2. Migrating to the hosted service has to be possible (Phase 3).
3. Mirroring to a remote has to be possible (Phase 2).
4. Object types must match between local and remote, without storing dead weight (Phase 1, plus the per-type match in Phase 2).

A local tenant's history cannot reach a remote tenant. The drain only delivers what is still in the spool, so once a fact is ingested locally it stays local. That blocks two things:
- moving to the hosted service at api.yakka.build
- keeping local as the primary store while mirroring it to the remote

### What is stored

Measured on the local tenant `local` on 2026-10-18, 1.8 GB in total:
- Sizes come from `du` over `~/.local/share/workflow/serve/local` and SQLite `dbstat`.
- Counts come from read-only queries on `facts` and from `find blobs -type f`.
- Diff sizes come from decoding every archive line with `zstd -dc` and measuring `info.summary.diffs`, compressed at zstd level 3.

| Form | Where | Size | Count | Value | Synced |
|---|---|---|---|---|---|
| Hook event envelope and extracted columns | `ledger.db` `facts` | 373 MB table, about 400 MB indexes | 1.04M (OpenCode 917k) | Analytics, conversations, cost | Yes. Remote ingest re-derives the columns |
| Hook payload | `archive/` | 795–814 MB on disk; 442 MB as single streams | One line per hook fact | The only source for re-extraction and lab work | Yes. It is the wire body of the hook fact |
| OpenCode `message.updated` `info.summary.diffs` | Inside the payload | About 1.5 GB of 4.9 GB uncompressed; about 120 MB compressed | 35,844 lines | None. These are cumulative patches repeated on every update, and artifact versions and commits already cover them | No. Trimmed (Phase 1) |
| Artifact content | `blobs/` (and `pending/`) | 29 MB | 1,643 blobs, 2,048 versions | High: designs, briefs, reports | Yes |
| Commit facts | `facts` | Small | 677 | Edges | Yes |
| Screens, scores, rejections | `ledger.db` | Small | 1,643 / 15,901 / 2 | Derived, and tied to the scorer version | No. The remote recomputes them |
| Hourly rollups, FTS | `ledger.db` | Included in the index figure | — | Derived | No. Remote ingest rebuilds them |
| `legacy/` (`quality.db`, `bodies.db`) | Tenant directory | 202 MB | — | Pre-ledger, superseded | No |

Local and remote already hold the same object types, because the same binary and the same ingest code run in both. Sync keeps them aligned by sending only the three wire fact types (`hook_event`, `artifact_version`, `commit`). Everything the remote holds is then derived by the remote's own ingest.

## Solution Shape

`yakka sync --to <tenant>` reads a local tenant directory and posts its facts to the remote's existing `/v1/ingest`.

**Its own credential.** Sync authenticates with a credential separate from the drain's. `yakka login --sync` puts a `read_write` token for the tenant the user picks into `sync.toml`, and leaves `client.toml` (the drain's target) unchanged. A user can therefore mirror to a remote while the drain keeps feeding local, or migrate by also pointing the drain at the remote.

**Resuming.** Ingest is idempotent by row hash, so a sync can be repeated, interrupted and resumed. A local cursor over `rowid` keeps reruns incremental.

**Remote changes.** The remote gains two things, both additive. Everything else it does is unchanged.
- A bearer introspection route, so sync can confirm which tenant the token is bound to.
- A diff trim rule in ingest policy, so the remote does not store dead weight. Sync calls the same function before sending.

### Domain: sync credential (`internal/login`, `internal/clientconfig`)

- Owns: where sync sends to, kept apart from where the drain sends to.
- Contract:
  - **Login.** `yakka login --sync [--endpoint URL]` runs the existing device flow, in which the user picks the tenant and scope. It writes `endpoint` and `key` (the same format as `client.toml`, mode 0600) to `$YAKKA_SYNC_CONFIG` or `$HOME/.config/yakka/sync.toml`. It never writes `client.toml`.
  - **Resolution.** `clientconfig.LoadSync()` resolves `YAKKA_SYNC_ENDPOINT` and `YAKKA_SYNC_KEY` (both or neither) first, then `sync.toml`. With neither, it returns an error. It never falls back to `client.toml` or to local mode.
- Non-goals: changing how the drain resolves its target.

### Domain: sync client (`yakka sync`, `internal/sync`)

- Owns: choosing what to send from a local tenant, the cursor, and the run report.
- Contract:
  - **Invocation.** `yakka sync --to <tenant> [--tenant-dir <dir>] [--dry-run]`.
    - `--tenant-dir` defaults to `<YAKKA_SERVE_DATA or ~/.local/share/yakka/serve>/local`.
    - The target comes from `clientconfig.LoadSync()`.
  - **Preflight.** Sync refuses, exits non-zero and sends nothing in any of these cases:
    - There is no sync credential.
    - The sync endpoint is a loopback address.
    - `GET /v1/whoami` returns 404 (the remote is too old) or 401.
    - The tenant it names differs from `--to`.
    - Its scope is not `read_write`.
    - The local ledger's schema version differs from the binary's.
    - The source tenant has used plan 17's `cold` tier and this process has no cold configuration. `archive.Read` fails closed in that case.
  - **Source read.** The source is read under the shared flock, so sync runs while local `yakka serve` is up. `store.OpenReadOnly` opens `ledger.db` with `mode=ro`, never `immutable`.
    - It does not migrate, backfill, start a writer goroutine or `MkdirAll`.
    - SQLite may create or update `-wal`/`-shm` for a WAL reader. These are the only files sync may touch.
    - Artifact content comes from `blobs/` or `pending/`. Hook bodies come from `archive.Read`, so sync never depends on the archive's file layout.
  - **What is sent.** Facts are sent in local `rowid` order, which is local receipt order. That order matters because the remote stamps `received_at` and orders "latest artifact" by it. Per page of rows past the cursor:
    - `commit`: the stored `raw`.
    - `artifact_version`: the stored `raw` with `content` added back, so its row hash equals the local one. A row with neither a blob nor a pending file (dropped after screening) is counted as `no_content` and skipped.
    - `hook_event`: the page's rows are grouped by conversation. `archive.Read` is called once per conversation, and the lines whose `row_hash` is in the page are sent, after `ingest.Trim`. A hook row with no line is counted as `no_body` and skipped.
    - Each fact gets the `id` `sync:<rowid>`.
  - **Batching and errors.**
    - At most 500 facts or 8 MiB per request. Both are *judgements*. 8 MiB is half of serve's 16 MiB `maxBody` (`internal/serve/serve.go:27`), which leaves headroom for a few large facts.
    - A 429 waits for `Retry-After`. 5xx responses and network errors back off from 500 ms to 5 min, the drain's defaults (`BackoffMin` in `internal/drain/drain.go`).
    - A 400 or 413 response is split in half. A single fact that still gets 413 is counted as `too_large` and skipped.
    - A 401 or 403 after preflight exits non-zero with the cursor saved.
    - A `rejected` result goes to the run report (id, stage, pattern; never content) and does not stop the run.
  - **Cursor.**
    - It is stored at `$XDG_STATE_HOME/yakka/sync/<endpoint host>_<tenant>.json` as `{"rowid": N}`, and advanced only after a batch's results arrive.
    - Compaction, Filter, Repair and sealing don't change `rowid`, so the cursor survives them.
    - A local compaction that deletes rows leaves nothing to resend.
    - Deleting the cursor forces a full resend. That is correct but slow, and every fact comes back `duplicate`.
  - **Report.** At exit, the report gives:
    - per fact type: accepted, duplicate and rejected counts, plus `no_body`, `no_content` and `too_large`
    - bytes sent
    - the number of distinct artifact content hashes sent, which is an upper bound on screening calls on the remote

    `--dry-run` prints the same counts and bytes but sends nothing.
- Non-goals:
  - Remote-to-local sync.
  - Carrying screens, scores, rejections or `received_at`.
  - Syncing `legacy/`.
  - A daemon or schedule.
  - Deleting anything locally.

### Domain: remote ingest (`internal/ingest`, `internal/serve`)

- Owns: what a tenant stores from any client, whether that is the drain or sync.
- Contract:
  - **Introspection.** `GET /v1/whoami` takes a bearer token only.
    - Its handler uses just the bearer branch of `authorizeRequest`. It does not use the cookie fallback, and it does not open the tenant, so it can't return `503 ErrLocked`.
    - On success it returns `200 {"tenant":"…","scope":"read|read_write","expires_at":<unix>}`. This needs a registry accessor for the expiry.
    - A keyed-mode key, and local mode, give `scope:"read_write"` and `expires_at:0`. Local mode always gives `tenant:"local"`.
    - A missing or invalid bearer gives `401`.
  - **Trim policy.** The hook-event policy table gains a third action, `trim`, alongside `keep` and `remove`.
    - It is defined for (`opencode`, `message.updated`) and deletes `payload.event.properties.info.summary.diffs`. Phase 1 checks this path against real archive lines.
    - `ingest.Trim(obj) bool` is exported. Ingest applies it to the decoded object before precheck. The row hash and the archive `Fact` are both computed from `Canonical` of the re-encoded, trimmed object, never from the received bytes, so a trimmed event hashes the same however it arrived.
    - The OpenCode plugin applies the same trim before spooling. A test asserts the plugin's trim list equals the table's, as the remove-list test does.
    - Compaction treats `trim` as `keep`, so existing local rows keep their untrimmed hashes.
    - A spool record delivered both before and after the upgrade leaves one duplicate local row. This is accepted.
  - **Ingest itself.** Validation, precheck and asynchronous Jev screening of new content hashes are unchanged. The remote makes one or more Jev calls for each artifact content hash it doesn't already hold. For the first sync of `local` that is about 1,643, the blob count in the storage table.
- Non-goals:
  - A sync-specific ingest route.
  - Keeping the client's `received_at`.
  - Re-trimming the local archive's existing lines.

### Steady state

The same command supports both.

- **Mirror.** Run `yakka login --sync` once. After that, run `yakka sync --to <t>` whenever you want. `client.toml` is unchanged, so the drain keeps feeding local.
- **Migrate.**
  1. Run `yakka login --sync`, then `yakka sync --to <t>`.
  2. Run `yakka login` for the same tenant. The drain now posts to the remote.
  3. Wait for local serve to log `not hosting the drain`.
  4. Run `yakka sync --to <t>` once more. It picks up facts that reached local between the first sync and the switch.

  From then on, the local tenant receives nothing new, and it can be archived or deleted by hand.

## Architectural Implications

- **[system-architecture.md](../../design/system-architecture.md).** The seams table gains "local tenant → remote ingest (sync): wire facts rebuilt from the ledger, blobs and archive; idempotent by hash; client-driven". Principle 8 is unchanged: sync is a client of the drain's contract.
- **[01-event-model-and-ingest.md](../../design/01-event-model-and-ingest.md).** The hook-event policy gains `trim`. "Row-hash identity is the full received envelope's" becomes "that of the envelope after policy, re-canonicalised".
- **[03-remote-service.md](../../design/03-remote-service.md).** The API table gains `GET /v1/whoami`. Sync is listed as a client of `/v1/ingest`.
- **[05-distribution.md](../../design/05-distribution.md).** It gains `sync.toml`, `login --sync`, and both recipes.
- **[Plan 17](../17-archive-retention/DESIGN.md).** Sync reads hook bodies only through `archive.Read`, so sealing and rewrites don't affect it. A source tenant that has used `cold` needs cold configuration in the sync process. The two plans can be built in either order.
- **Volume.** These are *estimates* derived from the storage table:
  - A first sync of `local` adds about 0.4 GB of hook bodies to the target tenant's archive. That is the 442 MB of single-stream files less about 120 MB of compressed diffs, so it assumes the files are compacted or sealed.
  - The ledger adds about 0.8 GB: 373 MB of facts plus about 400 MB of indexes. Both fit on the 10 GB volume.
- **Remote version.** The remote reports `"version":"dev"` because the Fly build passes no ldflags. Sync relies on the `/v1/whoami` route rather than the version string. Passing build args at deploy is a one-line chore in Phase 3.

## Decisions

- **Supported pattern.** Local-to-remote sync is supported. The client starts it and it can be repeated. The remote only permits it (user, turn 1).
- **Target matching.** The target tenant is the one bound to the sync credential's `read_write` token, and `--to` must name it (user, turn 1, made explicit by the agent).
- **Steady state.** Both mirror and one-shot migration are supported (user, turn 4). That support requires a sync credential separate from `client.toml` (agent, after review).
- **Diff trim.** The trim runs at the edge and on the remote, and sync applies it before sending (user, turn 4). It is one function, `ingest.Trim`, and every path calls it.

## Assumption Ledger

None — see PROVENANCE.md.

## Open Questions

- None blocking.

## Phases

Each outcome below carries two notes:
- **Guards:** the failure it rules out.
- **Basis:** where its need comes from. A Problem part (P1–P4) is the list at the top of Problem; a section name points into this design; anything else is a file or a measurement.

Numbers marked *judgement* or *estimate* are advisory: missing one is something to report, not a failed phase.

### Phase 1 — Diff trim

- Outcome:
  - An OpenCode `message.updated` fact with `info.summary.diffs` is posted to `/v1/ingest`. Its stored archive line has no `diffs`, and its row hash equals that of the same fact posted with `diffs` already removed.
    - Guards: storing the cumulative diffs, and one event getting two hashes depending on how it arrived.
    - Basis: P4; the diffs are about 1.5 of 4.9 GB, measured 2026-10-18. Also the hash rule in the Trim policy.
  - The OpenCode plugin's spooled record for that event has no `diffs`.
    - Guards: the edge still shipping the dead weight.
    - Basis: the user's "trim at the edge" answer (turn 4).
  - The trim-list parity test passes.
    - Guards: the plugin and server trim lists drifting apart.
    - Basis: the existing `TestRemoveListMatchesPlugin` in `internal/ingest/policy_test.go`.
  - Every other event's stored payload and row hash are unchanged.
    - Guards: the trim reaching beyond its one path.
    - Basis: the Trim policy is defined for one (harness, event) pair only.
  - `yakka ledger compact` leaves the row hashes of existing local rows unchanged.
    - Guards: compaction rehashing history, which would make every later sync resend it.
    - Basis: "Compaction treats `trim` as `keep`".
- Surfaces:
  - `internal/ingest/policy.go`: the `Trim` action and the exported `Trim`.
  - `internal/ingest/ingest.go`: trim before precheck, and hash the re-canonicalised object.
  - `internal/ingest/policy_test.go`: the trim-list parity test.
  - `internal/compact/compact.go`: `trim` treated as `keep`.
  - `packages/opencode-yakka-hooks/src/index.ts` and `packages/opencode-yakka-hooks/tests/test_hooks.mjs`.
  - `docs/design/01-event-model-and-ingest.md` and `docs/design/02-edge-capture.md`.
- Approach: known
- Depends on: nothing

### Phase 2 — `yakka sync`

- Outcome:
  - **Setup.** A test runs a local serve whose tenant has commits; artifacts in blobs, in pending and dropped; and hook events across several archive files, one with a torn tail. A remote serve has an empty tenant `t`.
  - **First sync.** `yakka login --sync` against the remote leaves `client.toml` untouched, and the local drain keeps feeding local.
    - Guards: logging in for sync switching the drain over, which would make mirroring impossible.
    - Basis: P3, found in review.
  - `yakka sync --to t` then exits 0, and the remote's facts match the source per type, minus the reported `no_body`, `no_content` and `too_large` counts.
    - Guards: lost facts, or object types that don't match.
    - Basis: P1 and P4; the user's "object types aligned" (turn 1).
  - Artifact and commit row hashes are identical.
    - Guards: sync changing an identity, which would make every rerun create duplicates.
    - Basis: ingest's idempotency by row hash.
  - Every synced artifact's content hash has a pending file or blob.
    - Guards: artifact versions arriving without their content, the highest-value form.
    - Basis: the storage table's Value column.
  - Each conversation's archive line set equals the source's after trim.
    - Guards: losing hook bodies, the only replay source.
    - Basis: the storage table's Value column for hook payloads.
  - **Reruns.** A second run sends only facts added since the first. So does a run after `yakka ledger compact` or `purge-deltas` on the source.
    - Guards: reruns resending everything, and file rewrites breaking the cursor.
    - Basis: the Cursor contract, found in review.
  - **Interruption.** Killing the process mid-run and rerunning reaches the same end state, with no extra remote facts.
    - Guards: a partial run leaving the remote in a different state.
    - Basis: the user's "up to the local to decide when" (turn 1), which means a run can be interrupted.
  - **Source unchanged.** Apart from `-wal` and `-shm`, the source tenant's files are unchanged, even while the source serve runs.
    - Guards: sync migrating or corrupting the live local tenant.
    - Basis: the Source read contract; the drain keeps writing during a mirror.
  - **Refusals.** Each of these exits non-zero and sends nothing:
    - `--to` naming another tenant
    - a `read` token
    - no sync credential
    - a loopback sync endpoint
    - a remote without `/v1/whoami`

    Guards: sending a whole history to the wrong place or with the wrong rights. Basis: the matching criteria (user, turn 1) and Preflight.
  - **Dry run.** `--dry-run` prints the counts and sends nothing.
    - Guards: a first sync whose size and screening cost are unknown before it runs.
    - Basis: the Report contract.
- Surfaces:
  - `cmd/yakka/main.go`: the `sync` subcommand and `login --sync`.
  - `internal/sync/sync.go` (new): the reader, the batcher and the cursor.
  - `internal/login/login.go`: the `--sync` target path.
  - `internal/clientconfig/clientconfig.go`: `LoadSync`.
  - `internal/store/store.go`: `OpenReadOnly` and a paged read by `rowid`.
  - `internal/serve/serve.go`: `GET /v1/whoami`.
  - `internal/serve/tokens.go` and `internal/serve/registry.go`: the expiry accessor.
  - `internal/drain/http.go`: the reused sink.
  - `docs/design/03-remote-service.md`, `docs/design/05-distribution.md` and `docs/design/system-architecture.md`.
- Approach: known
- Depends on: Phase 1 (`ingest.Trim`)

### Phase 3 — Hosted migration

- Outcome:
  - `https://api.yakka.build/v1/health` reports a real version, because the deploy passes `VERSION` and `COMMIT`.
    - Guards: migrating onto a remote whose build can't be confirmed to include Phases 1–2.
    - Basis: today it reports `"version":"dev"` (`GET /v1/health`, 2026-10-18).
  - The migrate recipe, run from this machine's `local` tenant against the owner's tenant, completes all four steps as written in design 5.
    - Guards: the documented recipe not working when it is run.
    - Basis: P2.
  - Its run reports list only precheck-stage rejections, by pattern.
    - Guards: rejections other than secret patterns silently dropping data.
    - Basis: an ingest response's only synchronous rejections come from precheck. Jev screens afterwards and returns no ingest result ([design 1](../../design/01-event-model-and-ingest.md)).
  - The remote tenant then reports at least as many conversations as local holds at the final sync, and per-type fact counts at least equal to the local counts at that point, minus the reported skips.
    - Guards: an incomplete migration.
    - Basis: P2. The local count is taken at the final sync because it grows: `count(DISTINCT conversation_id)` was 6,955 on 2026-10-18 and 7,016 on 2026-10-19.
  - `/v1/health` reaches `pending:0`.
    - Guards: screening backlog left unprocessed.
    - Basis: ingest's asynchronous screening of about 1,643 content hashes.
  - New hook events from this machine appear on the remote, not locally.
    - Guards: the drain still feeding local after migration.
    - Basis: P2, migrate step 2.
- Surfaces:
  - `fly.toml`, or the deploy command, with the `VERSION` and `COMMIT` build args.
  - `Dockerfile`, where the build args reach the ldflags.
  - `docs/design/05-distribution.md`.
  - The rest is an operational run, with no new code.
- Approach: known
- Depends on: Phase 2

## Provenance Notes

- **Why reuse `/v1/ingest` rather than a bulk-import route.** It keeps "this doesn't change remote much". The remote re-runs precheck, screening and derivation, so a synced tenant is indistinguishable from one fed by the drain. A bulk route would need its own trust model for derived rows.
- **Why a separate sync credential.** `client.toml` is the drain's target. If it were also sync's, logging in to the remote would switch the drain over, and mirroring would be impossible (found in review).
- **Why a `rowid` cursor, not per-file offsets.** Archive files are rewritten (Filter, Repair, compaction re-encode) and, under plan 17, renamed away when sealed. Offsets into them go stale. `rowid` is stable, and `archive.Read` hides where a line lives (found in review).
- **Why rebuild from the ledger, blobs and archive, not the spool.** The spool is deleted after delivery. These three are complete, and the archive is lossless: every hook fact had a line, measured on 2026-10-18.
- **Why the trim is one function on the server.** If only the plugin and sync trimmed, older plugins would keep sending diffs. Trimming in policy before the hash gives one rule and one hash for every path in. Sync calls the same function, which saves about 1.5 GB of upload and keeps single facts under the 16 MiB body cap.
- **Why `received_at` is not carried.** A wire field for it would let any client forge it for any tenant. Sending in local `rowid` order keeps "latest version" correct, and that is the only reader that depends on `received_at`.
- **Why the cursor is client-side.** The remote stays stateless about clients, as ingest's "no session state" rule requires. Losing the cursor costs bandwidth, not correctness.
- **Rejected: copying the tenant directory onto the volume.** It needs operator access, skips screening under the remote's scorer version, and cannot merge into a tenant that already has data.
