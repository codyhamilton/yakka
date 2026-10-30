# Design Intent 1: Event Model and Ingest Contract

What the system records, how records are joined, and what the remote accepts. Part of
[system-architecture.md](system-architecture.md); read its principles first.

## Problem

Executions were reported by agents after the fact. The records lack the conversation ID, model and
cost; the harness label was a default (12 of 13 said "cursor"); hook events never joined the same
conversation; one execution is stuck "running". The cause is that state was requested from the
agent instead of derived from facts the harness already produces.

## Model

Everything is a recorded fact with a join key. State is a view over facts.

### Facts

| Fact | Source | Carries |
|---|---|---|
| Hook event | harness hook → spool | conversation ID, harness, event, normalised event, tool, timing, model, token usage and cost where the payload has them |
| Artifact version | write hook → drain reads file | `repo_id`, `path`, content hash, content, conversation ID, source (`worktree` or `commit`) |
| Commit | hook on `git commit` | SHA, touched paths, rename pairs, conversation ID |

Gaps (a brief whose design has no version, a write with no artifact version) are computed by the
view, not submitted.

### Keys

- **Conversation ID** comes from the hook payload. It is stamped on every fact in the envelope. It
  is never written into an artifact.
- **`repo_id`** is the normalised remote URL if one exists, otherwise the root commit SHA. A
  checkout path is never an identity.
- **`repo_id` algorithm.** The URL of remote `origin`, else of the first remote by name. Normalised:
  drop the scheme and any `user@`; rewrite `host:path` (scp form) to `host/path`; lowercase the
  host; drop a trailing `/` and `.git`. `git@github.com:a/b.git` and `https://github.com/a/b` both
  give `github.com/a/b`. With no remote: `root:` plus the lexically first root commit SHA.
  Worktrees of one repo share remotes, so they share an ID.
- **Path** is relative to the repo's top level (`git rev-parse --show-toplevel` from the file's
  directory), with `/` separators. A path outside any repo yields no artifact.
- **Content hash** is SHA-256 of the file's raw bytes, computed before any scrub, so the shim can
  compare it with the file on disk.
- **Row hash** is SHA-256 of the fact's canonical JSON, which includes the conversation ID, so the
  same content written in a new conversation is a new row and a new edge.
- **Artifact key** is `(repo_id, path)`. A version is keyed by content hash; re-posting identical
  content is a no-op. No frontmatter and no IDs inside files.
- **Server IDs** are an index only. Clients never depend on them.

### Edges

`conversation —produced→ artifact version`, `commit —touched→ artifact path`,
`commit —in→ conversation`, `artifact path —alias of→ artifact path`.

An artifact has many conversations and a conversation has many artifacts. Edges are append-only.

### Moves

Best effort. Two signals, applied when building views:

1. A rename pair reported with a commit (authoritative).
2. A new path whose content hash equals the latest version of an artifact whose path no longer
   exists.

Merges are conservative: hash match or git rename only, never fuzzy similarity alone. A detected
move adds an alias edge and rewrites nothing, so a wrong link can be removed. An undetected move
yields a duplicate artifact, which is acceptable.

### Derived execution view

An execution is a view: `conversation + brief + commits + report`. No start or stop events exist.

| Shape | Meaning |
|---|---|
| conversation + brief + commits + report | complete |
| conversation + brief + commits, no report | unreported (a finding in itself) |
| conversation + brief, no commits | started, nothing landed |

The report's presence is the completion signal the phase runner reads. The view is rebuilt from
facts, so it cannot go stale.

## Execution report

A handoff, not telemetry. It exists because the next phase consumes it.

**Consumers**

- The phase runner, which orchestrates a phase and its subagents, reads the reports directly.
- The review agent, to call out known issues.
- Design and refine agents, to pick up leftovers that need re-refining or redesign.

**Why an artifact.** The executing agent writes it at the time, so the runner reads the original,
not its own paraphrase of a subagent reply. It survives the runner's context compaction and is
readable from a later conversation.

**Authorship.** One report per executing subagent, beside its brief. The runner reads reports and
does not rewrite them. A runner-level phase note, if wanted, is a separate artifact with its own
author.

**Content.** What the next phase cannot get another way: what was done against the brief, departures
from the brief and why, unfinished or deferred work, problems hit, surprises. Nothing derivable:
commits, model, cost, duration, files touched, conversation ID.

**No required structure.** The skill defines what good looks like; the report is scored against it.

**Rubric (candidate checks)**

- Says what was done against the brief, verifiably (commits, test results).
- Names every departure from the brief with its reason.
- Leaves unfinished work specific enough to act on without reopening the whole execution.
- States known problems plainly.
- Contains nothing the consumer cannot use.

The wording is defined once and referenced by both the skill and the service's checks, so they
cannot drift.

**Usage measure.** A report whose leftover issues are later addressed by a brief or design is
being used; one that nothing follows up, or later work contradicts, is weak. This is an edge query,
needs no scorer, and waits for the linked dataset.

## Ingest contract

Envelope types accepted by the remote: `hook_event`, `artifact_version`, `commit`.

- Idempotent by row hash; at-least-once delivery.
- No session or lifecycle state on the server.
- An execution report is an `artifact_version` whose kind is inferred from its path.
- Artifact kind (design, brief, report) is inferred from path convention, not declared by the agent.

### Hook-event policy

One table in `internal/ingest` maps `(harness, event)` to `keep` or `remove`; a pair not listed is
`keep`.

- **`remove`** applies to OpenCode `experimental.chat.system.transform`, `chat.params`,
  `chat.headers`, `shell.env`, `message.part.delta`, `message.part.updated`, `message.updated`,
  `session.status`, `session.updated` and `session.diff`. The first is a redundant prompt body, the next two and
  `shell.env` carry request headers and environment secrets, and the rest are chatter that the
  other events already cover. The streamed deltas, `message.part.updated` and `message.updated` repeat a part or message as it
  builds; the finished text is `experimental.text.complete`, the prompt is `chat.message`, tool
  calls are `tool.execute.before` and `after`, and each assistant message with its tokens, model
  and cost is the transcript's `transcript.assistant_message`. `session.status` and
  `session.updated` repeat session state, and `session.diff` and `message.updated` repeat the
  cumulative patches that artifact versions and commits already hold. Together the last five were
  about 1.04M of 1.44M hook events in the first measured ledger. The OpenCode plugin does not forward them ([design
  2](02-edge-capture.md)); ingest answers any that arrive (older plugins, other clients)
  `accepted` and stores nothing: no fact and no archive line. A test asserts the plugin's remove
  list equals the table's. `yakka sync` applies the same table and skips rows stored before a rule.
  Stored rows are deleted by a store migration, not by compaction: compaction applies the table
  only to a ledger it has not yet compacted and never rescans one marked complete. Each migration
  holds a frozen copy of the pairs removed so far and deletes those `hook_event` facts when a
  tenant is opened, then rebuilds the rollups, so the purge runs on the first start after a
  release, for a local ledger and a hosted one alike. A test fails when the table gains a `remove`
  pair that no migration purges; the fix is a new migration. The archive is not rewritten: its
  lines for removed events stay, and ingest and sync skip them by the table. The file is not
  vacuumed, so it shrinks only when the operator vacuums it.

  The table also removes the tool-start and batch markers, because the end event already holds
  everything they do: OpenCode `tool.execute.before` and `PostToolBatch`, Claude `PreToolUse`
  and `PostToolBatch`, and Codex `PreToolUse`. `PostToolUse` and `tool.execute.after` carry the
  tool name, call ID, input and response, and artifact and commit extraction reads only them.
  A batch row held call IDs and nothing else. Before this change those events were about 167k of
  the 402k hook events left after the rules above. The Claude and Codex plugins no longer
  register the hooks; the entries cover older plugins. The OpenCode plugin keeps each call's
  start time and puts it on the `after` row as `started_at`. A call still open at `session.idle`
  is written as `tool.execute.incomplete` with `incomplete: true`, which normalises to
  `tool_fail`. Cursor's `preToolUse` is not on the table.
- **`keep`** stores the event as an envelope plus extracted fields. Row-hash identity is the
  full received envelope's, as above.
- **Stored form.** A hook fact's stored `raw` is its envelope (`type`, `harness`, `event`,
  `conversation_id`, `ts`, `repo_id`) with no `payload`. The body goes verbatim, after secret
  redaction, to the per-conversation archive ([design 3](03-remote-service.md#event-archive)), so
  a session whose hooks are the only transcript keeps its source outside the database.
  `artifact_version` and `commit` facts keep their full `raw`.

**Normalised event.** Each stored hook event gets a `norm_event` shared by all harnesses:
`session_start`, `session_end`, `prompt`, `tool_pre`, `tool_post`, `tool_fail`, `batch_end`,
`assistant_message`, `usage`, `turn_end`, `subagent_start`, `subagent_end`, `compact`,
`message_part` or `other`. The per-harness mapping is a table in `internal/ingest`, seeded from
`packages/hooklog/hooklog.py`'s kinds; the native `event` is kept beside it. Tool names are not
normalised across harnesses.

**Model, usage and cost.** Extracted at ingest where the payload has them:

| Harness | Source | Fields |
|---|---|---|
| Claude | `transcript.assistant_message` | `model`, `usage.{input,output,cache_read_input,cache_creation_input}_tokens`, `output_tokens_details.thinking_tokens` |
| Codex | `transcript.token_count` | `model`, `usage.{input,cached_input,output,reasoning_output,cache_write_input}_tokens` (`input` includes cached input) |
| OpenCode | `transcript.assistant_message` | `providerID`/`modelID` (as `provider/model`), `tokens.{input,output,reasoning,cache.read,cache.write}`, and `cost` as a harness-reported cost when above 0 |
| Cursor | none | nothing |

Tokens are stored as reported. Claude repeats a message ID on a few lines, so a call is counted
once at read time. Cost is not stored except when the harness reports it; it is computed at read
time ([design 7](07-analytics-site.md#analytics-reads)).

## Who does what

- **Hooks** write the spool envelope and nothing else. No git, no network, no file edits.
- **Drain** reads artifact files and hashes them together, scrubs, delivers. For a commit it runs
  `git diff-tree -M --name-status` itself (rules in design 2, Commit facts). For design, brief and
  report paths touched by a commit it also sends the committed blob (source `commit`), so a missed
  worktree write is recovered when the agent commits it.
- **No repair submit.** Dropped in [design 2](02-edge-capture.md#no-repair-submit): retries, commit
  catch-up and rewrites cover its cases, and what remains is a gap the view reports.

## Decisions

1. **One report per brief, beside it.** A brief is one piece of work and has one outcome; a
   re-run produces a new version of the same report, not a second report. Proposed path:
   `docs/plans/<plan>/reports/<brief-name>.md`, so the kind patterns cannot collide with
   `briefs/*.md`.
2. **`spool.sh` never snapshots.** It records the event only. If the file is gone at drain time,
   no `artifact_version` is produced; a failure log can be added later.
3. **Harness label comes from the adapter.** Each harness has its own hook config, which passes a
   literal `--harness` name. No `auto` and no default.
4. **Every submitted fact has a conversation ID.** All harness hook schemas carry one. Hook types
   without a correlation ID are not submitted. Commits are captured from the agent's `git commit`
   tool call, so they carry it too; commits made outside an agent are out of scope for now.
5. **Plan 08 is superseded** by this design and the ones that follow from it. See below.
6. **Secret checks are layered.** A light client scrub for obvious formats (known key prefixes,
   private key blocks, `*_KEY=` assignments) runs before anything leaves the machine. The server
   runs a deterministic precheck on arrival, and Jev is the last check before content is persisted.
   This does not stop a secret crossing the wire, but it reduces the chance it is stored. How
   content is held while awaiting the Jev check (pending store or quarantine) belongs to design 3.

## Plan 08 under this model

[plans/08-artifact-submit-hooks](../plans/08-artifact-submit-hooks/DESIGN.md) posts from inside the
write hook: it queries the service for a "submitted" predicate, then calls `POST /v1/designs` or
`/v1/briefs` synchronously (2 s timeout) and returns `posted design_id=…` as `additionalContext`.
That breaks three principles here: hooks do network work, server IDs are handed to the agent to
adopt, and the hash strips frontmatter IDs that no longer exist.

What carries over:

- The path rules for design and brief files, extended with the report pattern.
- The per-harness write-surface table: Claude and Codex `PostToolUse` on write tools, Cursor
  `postToolUse` plus `afterFileEdit`, OpenCode `tool.execute.after`; `FileChanged` and
  `afterTabFileEdit` excluded. The drain uses it to decide which spooled events produce an
  `artifact_version`.
- No file mutation, and a re-write in a new conversation still records an edge.

What goes:

- The `artifact_submit.py hook` registration on every harness, and its CLI form.
- The submitted predicate. Idempotent ingest makes it unnecessary.
- Synchronous `posted …` / `posting still owed` feedback.
- `packages/hooklog/tests/test_artifact_submit_surfaces.py`, which asserts the old shape and is
  rewritten for the drain.
