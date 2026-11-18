# Session back-fill

`backfill.py` labels past sessions with the kind of work they did, from the transcript's own
signals. It is deterministic and offline: no model call, no network request, no queue-log read. Dry
run is the default; `--enqueue` writes labelled sessions to the local Yakka queue only. The tool
never reads or moves `~/.local/share/workflow/queue`.

It reads only the roots passed with `--root STORE=PATH`: Claude JSONL transcripts, Codex
`rollout-*.jsonl` files, OpenCode's session/message/part JSON storage and Cursor agent transcript
JSONL files.

```sh
python3 tools/session_backfill/backfill.py \
  --root claude="$HOME/.claude/projects" \
  --root codex="$HOME/.codex/sessions" \
  --root opencode="$HOME/.local/share/opencode/storage" \
  --root cursor="$HOME/.cursor/projects" \
  --repo owner/repo --labels session-labels.jsonl
```

## The rule

A session is labelled only when it has exactly one signal class and a subject. The skill id is the
part after the last `:`, so `yakka:design`, `workflow:plan` and `design` all match.

| Signal | Where it is read | Kind | Class |
|---|---|---|---|
| skill id `design`, `plan` or `planning` | any point in the transcript | `design` | planning |
| skill id `refine` | any point | `refine` | refining |
| skill id `execute` or `plan-execution` | any point | `build` | executing |
| `docs/plans/<plan>/briefs/<file>.md` | the first user prompt only | `build` | brief |

Other skills (`close-out`, `comprehensive-review`, `post-build`, `iterate` and the rest) are not
signals: loading one neither labels a session nor makes it multi-signal.

Signals are counted by class, so the same skill twice, or `plan` and `design`, is one signal.
`execute` plus a brief path is two classes even though both give `build`. A session with more than
one class is `multi_signal`; with none it is `no_signal`; with one class but no subject it is
`no_subject`. None of these enqueues.

### Skill-load shapes per harness

- **Claude:** a `Skill` tool call (`input.skill`, `input.args`), or a user-message `<command-name>`
  slash command with optional `<command-args>`.
- **Cursor:** a `<manually_attached_skills>` block in a user `text` content block; each
  `Skill name <id>` line is a load.
- **Codex:** no skill-load form was found in read-only recon (2,862 of 2,863 `rollout-*.jsonl`
  files parsed; 715 `user_message` events, no skill tool call). It labels by brief path only.
- **OpenCode:** no skill-load form was found in read-only recon (926 storage JSON files, 13
  sessions, 159 messages, 562 parts; no skill tool, no slash command in user text). It labels by
  brief path only. The message `agent` field is mode metadata, not a skill load.

### First user prompt

The brief path is read from the store's own first user prompt, not from the concatenated transcript
text: the first Claude `type == "user"` / `role == "user"` text record (skipping tool-result-only
records); the first Codex `event_msg` `user_message` (falling back to a `response_item` user
message); the first Cursor `role == "user"` record's text blocks; and the first OpenCode user
message's `text` parts in order.

## Subject and confidence

Plan, phase and issue come from the signal's own text: the skill arguments or command arguments, or
the brief path (which names the plan folder and, from `<phase>-<NN>-<slug>.md`, the phase). `--repo`
is required for a plan or GitHub-issue subject; a PR alone is not a subject.

Where the signal gives nothing, the existing fallback extraction (`PLAN_RE`, `PHASE_RE`, issue and
PR numbers over the transcript, cwd, branch and files) may fill the subject. `confidence` is `1.0`
when the subject came from the signal text or the brief path and `0.65` when it came from the
fallback; no threshold uses it. `evidence` names the signal and the subject source (for example
`signal:claude_skill:execute; subject:fallback`), is secret-scrubbed and is at most 300 characters.

## Statuses and the count report

Every discovered session is exactly one of `labelled`, `multi_signal`, `no_signal`, `no_subject` or
`unreadable` (an unreadable transcript, or a Codex rollout with missing or invalid `session_meta`
identity). Only `labelled` carries an action and enqueues.

The tool prints, per store (`claude`, `codex`, `cursor`, `opencode`) and in `total`: `sessions`;
`labelled`; `multi_signal`, `no_signal`, `no_subject`, `unreadable`; and `labelled_by_signal` split
into `planning`, `refining`, `executing` and `brief`. Beside them it prints `skipped_subagent`
(Claude `subagents/` transcripts), `skipped_child` (Cursor `subagents/` transcripts), `duplicate_ids`
and `duplicate_transcripts` (a conversation id in two transcript files counts once and enqueues
once), and `transcripts_discovered`, so:

```
sessions == labelled + multi_signal + no_signal + no_subject + unreadable
labelled == sum(labelled_by_signal.values())
transcripts_discovered == sessions + skipped_subagent + skipped_child + duplicate_transcripts
```

A prior `/v1/actions` snapshot can be supplied offline as newline-delimited conversation ids with
`--server-action-ids`, or its count with `--server-fact-count`; the tool makes no request.

## Enqueue boundary

`--enqueue` writes labelled sessions to the local Yakka queue, at most one fact per conversation id,
through `yakka.EnqueueSessionAction`. Re-running the same labels creates no new event files. The
ordinary drain later handles them. Codex identity comes only from `session_meta`, never the rollout
filename; an unresolved rollout cannot enqueue. Transcripts that cannot be read are counted as
`unreadable`, never silently dropped.

Use temporary synthetic roots and a temporary `--queue-dir` for tests and dry-run checks. The
codyh-ubuntu data pass and any real queue drain are operational steps; they must be performed
separately from synthetic verification, and the real enqueue and drain need Cody's authorisation.
