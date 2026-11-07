# Session back-fill, pass 1

`backfill.py` reads only the roots passed with `--root STORE=PATH`. It supports Claude JSONL
transcripts, Codex `rollout-*.jsonl` files, OpenCode's session/message/part JSON storage, and Cursor
agent transcript JSONL files. It also reads queue logs from an explicit `--queue-logs` directory.
The first pass uses deterministic path, prompt, cwd and branch evidence; it never classifies a kind.
A kind is filled only when a matched queue log supplies it.

Codex conversation IDs come from the transcript's `session_meta.payload.id` (or
`payload.meta.id` for wrapped metadata), never the rollout filename. A rollout
with missing or invalid metadata stays in the label file as `unresolved` with an
empty `session_id` and its transcript path in `source_file`; it cannot be enqueued
until its identity is recovered.

Run a dry report and write a local label file:

```sh
python3 tools/session_backfill/backfill.py \
  --root claude="$HOME/.claude/projects" \
  --root codex="$HOME/.codex/sessions" \
  --root opencode="$HOME/.local/share/opencode/storage" \
  --root cursor="$HOME/.cursor/projects" \
  --queue-logs "$HOME/workspace/.briefs/q" \
  --repo owner/repo --labels session-labels.jsonl
```

A transcript that cannot be read, or has no parseable records, is still labelled `unresolved`
(evidence "transcript unreadable or has no parseable records") so it appears in the counts. Two
transcript files can carry the same conversation ID (Cursor files one chat under two project
directories); the report counts these as `duplicate_conversation_ids`, and `--enqueue` emits at
most one fact per conversation ID.

The tool prints per-store complete, partial, unresolved and excluded counts, coverage, the
masked queue-log gold agreement, and the unreadable and duplicate-ID counts. A prior `/v1/actions` snapshot can be supplied as newline-delimited
conversation ids with `--server-action-ids`, or its count with `--server-fact-count`; the tool makes
no request. `--enqueue` writes complete labels to the local Yakka queue only. The ordinary drain
later handles them with the other queued facts. Re-running the same labels creates no new event
files. The tool never reads or moves `~/.local/share/workflow/queue`.

Use temporary synthetic roots and a temporary `--queue-dir` for tests and dry-run checks. The
codyh-ubuntu data pass and any real queue drain are operational steps; they must be performed
separately from synthetic verification.
