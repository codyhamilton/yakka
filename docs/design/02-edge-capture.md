# Design Intent 2: Edge Capture

How hook events get from a harness to the remote: the spool, the drain, the local MCP shim, and
per-harness install. Part of [system-architecture.md](system-architecture.md); builds on the facts
and keys in [01-event-model-and-ingest.md](01-event-model-and-ingest.md).

## Problem

Hooks fire from several harnesses at once, often in bursts: Cursor runs one `postToolUse` per call
in a batched tool turn, and Claude runs `PostToolUse` per call in a parallel batch. Hooks must stay
cheap and never fail the agent, yet every event has to reach the remote, which may be local or
remote by config, may be down, and may refuse content.

## Shape

```
 hook ──spool.sh──▶ queue/<conv>-<ts>-<pid>-<rand>.evt ──▶ drain (one per user) ──▶ remote ingest
                         │                                    │ 4xx
                         └── kick: start drain if none        └──▶ rejected/<same name> + reason
 agent ──MCP (stdio)──▶ shim ──▶ remote advisory API
                         └── reads queue/ and rejected/ for this conversation
```

One queue directory per user serves every harness: `$YAKKA_QUEUE`, default
`~/.local/share/yakka/queue`, with `tmp/` and `rejected/` inside it. The harness is in the envelope, not the path.
The queue is transit, not storage: a file is deleted once the remote accepts it.

## Spool

`spool.sh` stays bash and does no parsing and no network.

- Writes the envelope plus raw payload to `tmp/`, then renames into `queue/`. The rename is atomic,
  so concurrent hooks need no lock and a reader never sees a partial file.
- File name starts with the conversation ID: `<conversation_id>-<ts>-<pid>-<rand>.evt`. Any
  per-conversation check is then one directory listing, with no JSON parsing. The hook extracts the
  ID with a bounded text match on the payload; a payload without one is not spooled (design 1,
  decision 4).
- `--harness` is a literal from the adapter. `auto` is removed.
- Never snapshots a file and never fails: exit 0 always.

## Drain

The plugin drain is `python3 plugins/yakka/client/yakka.py drain`. One instance per user, holding
an exclusive flock on `queue/.drain.lock` for its lifetime. In local mode the lock may instead be
held by `yakka serve`, which hosts the Go drain module
([design 3](03-remote-service.md#local-serve-hosts-the-drain)); the two drains exclude each other
with the same lock.

**Start.** After its rename, a hook probes the lock non-blocking. Held means a drain is running and
the hook returns. Free means it starts `python3 plugins/yakka/client/yakka.py drain` in the
background (with `setsid` when available). `YAKKA_BIN` set and executable starts that program with
`drain` instead. The probe takes
the lock for an instant, so the drain acquires with a short blocking wait (about 1 s), not `-n`. A
burst that beats the first drain to the lock starts a few extra processes that fail to acquire and
exit; this is accepted, and measured (see Tests).

**Batch window.** After the first file appears, wait about 1.5 s before building a batch. This turns
a burst into one POST and coalesces repeated writes to one `(repo_id, path)` into one file read.
Cursor's `postToolUse` and `afterFileEdit` for the same write coalesce here.

**Linger.** Exit after about 60 s with an empty queue (configurable). Active agent work keeps one
drain alive; it exits about a minute after the agent goes quiet. A sleeping drain costs a few MB;
the linger exists to avoid a process per event.

**Idle exit without stranding.** Release the lock, rescan the queue, and if files exist, try to
retake the lock and continue; if another drain holds it, exit. Because a hook renames before it
probes, either the hook sees the lock free or the rescan sees the file.

**Building facts** (design 1):

- `hook_event` from each envelope, normalised and scrubbed.
- `artifact_version` for write events on the write-surface table below whose path matches a kind
  pattern. Content is read and hashed at drain time. A missing file produces nothing.
- `commit` from `git commit` tool calls (below).
- **Commit catch-up.** For every design, brief or report path touched by a commit, the drain also
  sends an `artifact_version` with source `commit`, read from the committed blob. A worktree write
  that was missed is recovered when the agent commits it, with the right conversation ID.

Keys, paths and hashes follow design 1 (Keys). The drain and the shim use the same functions.

**Commit facts.** A shell tool call is a commit when its command matches `git` (with any `-C dir`
or `-c k=v` options) followed by `commit`, anywhere in the command, including after `&&` or `;`.
The SHA comes from the tool's output (`[branch abc1234] …`), resolved to a full SHA with
`git rev-parse` in the envelope's `cwd` (or the `-C` directory). No SHA in the output, or a failed
tool call, means no commit fact; the drain never guesses from `HEAD`. Touched paths and rename
pairs come from `git diff-tree -M --name-status -r --root <sha>`, run by the drain.

**Scrub outcome.** Hook event payloads are redacted in place before sending. Artifact content is
never redacted: a hit means the artifact is not sent, and its file moves to `rejected/` with the
pattern name and line, so the agent can rewrite it. Content hashes are always of the raw file.

**Delivery.** One queue file can yield several facts (a write yields `hook_event` and
`artifact_version`; a commit yields `hook_event`, `commit` and catch-up versions). Each fact's ID is
`<file name>#<n>`. A file's outcome is its worst fact's.

| Response | Action |
|---|---|
| 200 with per-fact results | a file whose facts are all `accepted` or `duplicate` is deleted; a file with any `rejected` fact moves to `rejected/` with those reasons (its accepted facts are already stored, and a resend dedupes) |
| 5xx, network error, 401/403/408 | retry with backoff; files stay |
| 429 | retry after `Retry-After` |
| 400, 413 | split the batch and resend in halves; a single file that still gets 400 or 413 moves to `rejected/` with the status as its reason |

Backoff is exponential with jitter, capped at about 5 min, and held in memory only. "Idle" means an
empty queue, so a backlog keeps the drain alive, and while it lives its lock stops hooks starting
another. Once backoff is at its cap and no new file has arrived for about 15 min, the drain exits;
the next hook restarts it, and it tries once immediately. That is at most one extra attempt per
restart, and restarts only follow 15 quiet minutes.

Delivery is at-least-once: a crash between a 2xx and the delete resends the batch, and ingest
dedupes by row hash, which is computed from the envelope alone.

**Scrub.** The light client scrub from design 1 (known key prefixes, private key blocks, `*_KEY=`
assignments) runs on every fact before it leaves the machine.

**No local archive.** The remote is the record. The per-session JSONL archive via `hooklog.append`
is dropped from the drain path. `rejected/` is the only thing kept locally.

**No queue cap** for now, since all data is kept. `yakka status` reports queue size, oldest file,
`rejected/` count and whether a drain is running.

**macOS.** No `flock(1)`. The hook-side probe falls back to a `mkdir` lock with a PID check; the
drain uses `flock(2)` as on Linux.

## Config

The drain and the shim resolve endpoint and bearer key the same way on every batch (no restart
needed to pick up a change):

1. **`YAKKA_ENDPOINT` and `YAKKA_KEY` both set** — remote mode with those values. They win over
   `client.toml`.
2. **Exactly one of them set** — bad config. `yakka drain`, `yakka mcp`, and `yakka status`
   exit before any request; they do not read the file and do not contact loopback.
3. **Neither set, and `client.toml` present** — remote mode from the file (`endpoint`, `key`), mode
   0600, default path `~/.config/yakka/client.toml`.
4. **Neither set, and no file** — local mode: `http://127.0.0.1:8770` with no bearer.

`YAKKA_CLIENT_CONFIG` overrides only the file path (tests and explicit installs).

```toml
endpoint = "https://collector.example"
key = "wk_…"                           # issued bearer for the collector (read or read_write)
```

- **`yakka login`** writes `client.toml` after the collector's device page issues a token (optional
  `--endpoint` for the collector origin). There is no `yakka init`.
- A hand-written `client.toml` still works. A remote agent with no browser (for example Claude or
  Codex in the cloud) uses the env pair instead of a file.
- The key is an issued service bearer, never `TYPESAFE_API_KEY`, which stays on the server only.
- If nothing listens at the resolved endpoint the queue grows and nothing is lost; `status` shows the
  mode and the failure.
- An invalid config is never guessed past: the drain retries, then gives up, and the shim reports
  `bad config`.

The drain never starts or manages the quality service, local or remote (principle 8).

## MCP shim

The advisory MCP is registered with every harness as a local stdio command, not a URL. The shim
reads the shared config and forwards to the remote's advisory API. Design 4 owns what it exposes;
design 2 fixes two things it relies on:

- **Endpoint by resolution.** Local or remote comes from the env pair, `client.toml`, or the local
  default above. No harness config holds an endpoint or a key.
- **Queue awareness.** Before answering about a file, the shim checks `queue/` and `rejected/` for
  envelopes that refer to it. If files are pending, it kicks the drain and waits up to about 1.5 s.
  If they are still pending, the answer says so ("3 events for this file still queued, oldest 40 s,
  remote unreachable"). If any are in `rejected/`, the answer gives the reason; the agent's fix is
  to rewrite the file, which fires a new hook. The rewrite is the repair. Matching is by path, not
  conversation, because an MCP server is not told which conversation spawned it
  ([design 4](04-advisory-surface.md#artifact_feedback)).

A pre-tool hook could do the same check, but whether MCP calls reach a pre-tool hook differs per
harness, and the shim behaves identically everywhere.

## No repair submit

Design 1 had an explicit, synchronous repair submit. It is dropped. Its cases are covered by:

1. **Transient failure:** the drain retries.
2. **Missed write:** commit catch-up.
3. **Refused content:** the reason surfaces through the shim; the agent rewrites the file.
4. **Never captured and never committed by an agent:** stays a gap. The derived view reports gaps as
   findings (a brief whose design has no version, a write event with no artifact version, a commit
   touching a design path with no version). Content is never backfilled with an invented
   conversation link. A maintainer backfill, if ever needed, is a lab tool.

There is no dependency failure to repair: ingest does not check that a brief's design exists. A
missing design is a gap in the view, not a refused post.

`capture_gap` is removed from the fact types; gaps are computed by the view.

## Write surfaces

Carried from plan 08. These decide which spooled events produce an `artifact_version`.

| Harness | Events | Notes |
|---|---|---|
| Claude Code | `PostToolUse` on Write, Edit, MultiEdit | If a batch hook carries `tool_input` for every call, register it instead and drop `PostToolUse` (see Tests) |
| Codex | `PostToolUse` on apply_patch and write tools | |
| Cursor | `postToolUse`, `afterFileEdit` | coalesced in the batch window |
| OpenCode | `tool.execute.after` | bus events excluded |
| all | — | `FileChanged`, `afterTabFileEdit` excluded |

Kind patterns: `docs/plans/<plan>/DESIGN.md` (design), `docs/plans/<plan>/briefs/*.md` (brief),
`docs/plans/<plan>/reports/*.md` (report).

## Per-harness install and trust

Each harness ships its own hook config, passing a literal `--harness`.

| Harness | Config | Trust step |
|---|---|---|
| Claude Code | `plugins/yakka/hooks/hooks.json` | none beyond plugin install |
| Codex | `plugins/yakka/hooks/codex.json`, selected by `plugins/yakka/.codex-plugin/plugin.json` | the user approves hooks in `/hooks`; until then nothing is captured |
| Cursor | `plugins/yakka/hooks/cursor.json` | none |
| OpenCode | plugin calling `spool.sh` | none |

The OpenCode plugin does not forward the `remove` events of the ingest policy
([design 1](01-event-model-and-ingest.md#hook-event-policy)): `experimental.chat.system.transform`,
`chat.params`, `chat.headers`, `shell.env`, `message.part.delta`, `message.part.updated`,
`message.updated`, `session.status`, `session.updated`, `session.diff`, `tool.execute.before` and
`PostToolBatch`, by event name, so hook and bus forms alike. The list is declared once in the plugin between `remove-list` markers, and a test
asserts it equals the ingest table's.

The `artifact_submit.py hook` registrations are removed from all four. Codex hook timeouts stay
within its 3 s ceiling. Pinned plugin copies (the Codex copy at `451e009`) are design 5's problem,
but until updated they keep running the old hooks.

## Changes from what exists

`spool.sh` and `plugins/yakka/client/yakka.py` already do one file per event, the tmp-then-rename
write, the flock probe and kick, and a `bad/` folder. The plugin path runs that Python drain;
`yakka serve` still hosts the Go drain behind the same `.drain.lock`. Remaining:

- File names lead with the conversation ID; payloads without one are not spooled.
- `--harness auto` removed.
- Drain: batch window, idle exit with rescan, in-memory backoff, `Retry-After`, `rejected/` with
  reasons (replacing `bad/`), commit facts and commit catch-up, artifact versions, config file
  instead of `WORKFLOW_QUALITY_URL`/`TOKEN`, archive dropped.
- Retire the systemd timer and service; the hook kick is the only trigger.
- `artifact_submit.py hook` registrations removed; `test_artifact_submit_surfaces.py` rewritten.

## Tests

Cheap, in a `mktemp -d` queue, never the live one.

1. Fire 20 concurrent spools; count drain starts and confirm exactly one keeps the lock and every
   file is delivered once.
2. Idle-exit race: spool during the drain's release-and-rescan; no file is stranded.
3. Remote down, then up: nothing is lost; 4xx goes to `rejected/` with a reason.
4. Capture one real payload per harness for: a write, a `git commit`, a batch hook (Claude), and an
   MCP call (to record which harnesses expose MCP calls to pre-tool hooks).
5. Cursor `postToolUse` plus `afterFileEdit` for one write yields one artifact read.
