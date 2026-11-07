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

# Session back-fill, pass 2: TypeSafe kind

`kind_pass.py` classifies the kind of each partial pass-1 label (subject, no kind) with TypeSafe
System One. It uses the same explicit `--root` and `--queue-logs` inputs as pass 1. Gold items are
queue-log sessions whose kind is known; they set the confidence threshold.

Each request carries one prompt prefix and nothing else: the first non-empty line, secret-scrubbed
(assignment pattern, `yakka.Redact`), whitespace-collapsed, then cut to 1000 characters. The
request shape is `{"model", "state": {"prompt"}, "questions": {"work_kind": ...}}`, checked by
`validate_systemone_request` before any transport call.

```sh
# Dry run (default): no network call, no file written.
python3 tools/session_backfill/kind_pass.py --root claude="$HOME/.claude/projects" \
  --queue-logs "$HOME/workspace/.briefs/q" --repo owner/repo

# Live classification: sends prompt prefixes to TypeSafe. Needs TYPESAFE_API_KEY and --confirm-egress.
python3 tools/session_backfill/kind_pass.py ... --live --confirm-egress --review session-kind-review.jsonl

# Live, and write complete labels to the local queue. Needs --live.
python3 tools/session_backfill/kind_pass.py ... --live --confirm-egress --enqueue --queue-dir DIR
```

Threshold: the lowest gold confidence `c` at which accuracy over answers with confidence at or
above `c` is at least 0.90. `unclear` answers are excluded from the threshold. With no gold answers,
or no qualifying `c`, the threshold is `null` and no label completes.

Routing: a result at or above the threshold, not `unclear`, becomes a complete label with
`method=typesafe` and is enqueued under `--enqueue`. Everything else goes to the review JSONL with
its scrubbed prompt prefix and the reason: `below_threshold`, `no_threshold`, `model_unclear`,
`invalid_answer`, `transport_error`, or `empty_prompt`. A transport error or invalid answer on one
item does not stop the others. Unclear results never enqueue.

The report reports gold accuracy overall and per kind (an `unclear` or unusable answer counts as a
miss), a confusion matrix whose rows sum to the gold count, the threshold, and completed, review
and enqueued counts. The live transport is `jev_client.post_systemone`. Only `--live` reaches it,
and tests use fake transports only.
