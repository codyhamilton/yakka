# Brief: phase3-02 — Stop/SessionEnd sweep, artifact_snapshot drain and queue matching

Consumer: one build worker owning the Python client/drain and the two design docs.
Owned paths: `plugins/yakka/client/yakka.py`, `plugins/yakka/client/test_facts.py`, `plugins/yakka/client/test_drain.py`, `plugins/yakka/client/test_mcp.py` (queue/reader tests only), `plugins/yakka/client/test_mcp_shim.py` (only if a queue-matcher test belongs there), `docs/design/01-event-model-and-ingest.md`, `docs/design/04-advisory-surface.md`. Touch nothing else.
Commits: leave changes in the working tree. The orchestrator builds and closes Phase 3.
Report: write `docs/plans/21-feedback-delivery/reports/phase3-02-snapshot-sweep-drain.md` before finishing, using the `execution-report` rubric.
Depends on: nothing. Plan 24's shim and readers are already on this branch (`7be8aa3`, HEAD `f0cbec9`).
Runs alongside: `phase3-01-server-feedback-v2.md` (disjoint paths).
Budget: 9 files to read, about 300 lines changed, about 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), and report `over budget`.

## Required reading, in order

1. `docs/plans/21-feedback-delivery/DESIGN.md:108-112` — the Artifact capture domain: triggers, the `artifact_snapshot` form, the drain's one `artifact_version`, `ts` = mtime, `_write_paths`, and the rejected-entry rules.
2. `docs/plans/21-feedback-delivery/DESIGN.md:364-369` — Assumption 23: the sweep, the spool form, the payload keys and the 1 h default bound.
3. `docs/plans/21-feedback-delivery/DESIGN.md:339-344, 378-383` — Assumptions 20 and 25: row hash/`ts` dedupe, covering mtime, rejected-not-silent-delete.
4. `docs/plans/21-feedback-delivery/DESIGN.md:457-462` — the Phase 3 outcome, clauses (1)-(2) and (4); the sweep and drain half does not depend on Plan 24.
5. `docs/plans/21-feedback-delivery/DESIGN.md:171-176` — Architectural Implications: these client surfaces are Python; design docs 01 and 04 are the stable-doc surfaces.
6. `plugins/yakka/client/yakka.py:974-1088` (`Build`), `1091-1147` (`_parse_file`), `1160-1170` (`_read_file`), `1197-1273` (`_write_paths`) — the code you are changing.
7. `plugins/yakka/client/yakka.py:1948-2082` (`_list_queue`, `_Runner.scan/wait_for_work/batch`), `2130-2203` (`apply`/`reject`) — the drain path.
8. `plugins/yakka/client/yakka.py:2568-2649` (`_mcp_queue_entries`) — Plan 24's queue v2 matcher, which calls `_write_paths`.
9. `plugins/yakka/script/spool.sh:27-107, 150-154` and `plugins/yakka/hooks/hooks.json`, `plugins/yakka/hooks/codex.json` — read-only: the exact spool form and the fact that both harnesses already fire `Stop` and `SessionEnd`.
10. `plugins/yakka/client/test_facts.py:1-110, 400-520`, `test_drain.py:1-180`, `test_mcp.py` queue-reader tests — the test helpers you will extend.

Read ranges and grep; do not read a whole file to find one section, and truncate long tool output.

## Goal

Make the drain turn Stop/SessionEnd events into `artifact_snapshot` pointers for the scored files git reports modified or untracked, and make the drain and the queue v2 matcher handle an `artifact_snapshot` entry as exactly one content-bearing `artifact_version` whose `ts` is the file's mtime. No shell parsing, no repo-wide sweep, no content in the queue.

## Contract

Binding, quoted from the design; do not restate them as new scope.

- Queue entry (DESIGN.md:111): "one `.evt` file in the form the spool produces (written under `tmp/` then renamed, named `<conversation_id>-<ts>-<pid>-<rand>.evt`, one JSON envelope line `{"ts","harness","event":"artifact_snapshot"}` then a JSON payload carrying `session_id` `feedback-<repo_id>`, `cwd` (the repo top) and the file's absolute `path`)."
- Pointer, not content: "It holds a pointer, not the content: like every worktree write today, the drain reads the file at batch time (`_read_file`, `yakka.py:658-668`)." (DESIGN.md:111)
- Drained fact (DESIGN.md:111): "one `artifact_version` (source `worktree`, `conversation_id` `feedback-<repo_id>`, `ts` the file's mtime …) and no `hook_event`, through the existing scan, hash and conversation-ID rules, and the drain's path function (`_write_paths`, which Plan 24's `queue` reader also calls) recognises the kind."
- Eligibility (DESIGN.md:111): "an entry that yields no `artifact_version` (not UTF-8, outside the repo or a symlink out of it, not a scored kind, no repo identity) is moved to `queue/rejected/` with a `.reason` (`unreadable`, `not_in_repo`, `not_scored_kind`) instead of being deleted silently, so no call can loop on an entry that vanishes without a version."
- Sweep (DESIGN.md:111): "for each scored-kind file that `git status --porcelain --untracked-files=all` reports modified or untracked in the session's working repo (untracked directories are expanded to files), an `artifact_snapshot` entry is written in the same form." "The sweep runs in `yakka.py` … either on the Stop and SessionEnd hook events the drain reads from the queue or in a hook command the plugin adds, which the build settles." "an event whose envelope `ts` is older than a bound (default 1 h, ledger 23) is not swept, so a drain of a staged legacy queue never turns old Stop or SessionEnd events into snapshots of today's files."
- Dedupe (DESIGN.md:342, Assumption 20): "The drain is to set the snapshot's `ts` to the file's mtime … so the same unchanged content from the same conversation is `duplicate`." The row hash covers every top-level key except `id` and `content`, so `ts`, `conversation_id`, `repo_id`, `path`, `content_hash`, `source`, `harness` and `event` all count.
- Requested build choice (DESIGN.md:461): "how the drain handles the snapshot kind, how the Stop hook finds the working repo, and the `harness` and payload keys of the entry are the build's to refine against the code." This brief settles them below.

Settled build choices:

- **Where the sweep runs.** In the Python drain, on the `Stop`/`SessionEnd` entry it already reads from the queue. No hook config change and no second launcher. The sweep is bounded to events whose envelope `ts` is at most 3600 s old (Assumption 23's default 1 h).
- **How the sweep finds the repo.** The event payload's `cwd` (`_parse_file`'s `p.base`, `yakka.py:1137-1145`) is the session working directory. Resolve the repo top with `git -C <cwd> rev-parse --show-toplevel`; use that real path and the repo identity (`RepoID`) in the snapshot. If there is no `cwd`, no repo or no identity, write no snapshot.
- **Harness and payload keys.** Envelope `harness` is the event's harness (`p.harness`, `claude` or `codex`); `event` is `artifact_snapshot`; envelope `ts` is the enqueue time. Payload keys are exactly `session_id` (`feedback-<repo_id>`), `cwd` (repo top) and `path` (absolute file path). `_parse_file` already reads `session_id` as the conversation ID, so `p.conv` becomes `feedback-<repo_id>`.
- **One writer.** Add one small Python writer for the sweep that reproduces the spool form (umask/`0o600`, write under `<queue>/tmp/`, rename to `<conversation_id>-<ts>-<pid>-<rand>.evt`, envelope line then payload). It is not a generic shim or a new registry. Plan 22's shared writer is not on this branch; do not create a generic abstraction beyond this one helper.
- **Where the new entries go.** Write the sweep's snapshot entries after the batch's queue files are read and append their contents to the same batch, so the drain that processed the Stop/SessionEnd entry also processes the snapshots. A crash between write and send leaves them for the next drain; do not delete a snapshot the drain did not send.

### Keep untouched (and one known Plan 24 form)

- Do not change `plugins/yakka/script/spool.sh`, `plugins/yakka/hooks/*`, the shim's `_mcp_enqueue`/readers, or Plan 24's `queue` v2 contract.
- Plan 24's E1 shim already spools a pointer as a `PostToolUse`/`Write` entry (`yakka.py:2891-2959`), not an `artifact_snapshot` entry. That is Plan 24's form; leave it. The existing write-tool path must keep working. Do not "fix" the shim to emit `artifact_snapshot`. Record the mismatch in your report if the design's A1 wording matters to you; do not resolve it here.
- `_mcp_queue_entries` must keep its incomplete-queue, symlink, size, deadline and tenant-isolation rules. Only its dependence on `_write_paths` gains snapshot recognition.
- Keep `spool.sh`'s `YAKKA_SPOOL_PRINT` behaviour and hook stdout unchanged.

## Changes

### `Build`, `_parse_file`, `_read_file`, `_write_paths`

- Add `mtime` to `_ReadResult` and set it from `os.stat` when the read succeeds. Existing hook-write facts ignore it.
- Detect a snapshot by `p.event == "artifact_snapshot"` (the envelope event; `_parse_file` already falls back to `payload.hook_event_name`).
- For a snapshot, do all of the following and skip the hook path (no `hook_event`, no `_build_commits`):
  1. Take `payload["path"]`; if it is not a non-empty string, reject with `unreadable: <path-or-empty>`.
  2. If relative, join `p.base`; `normpath` it. Read it with `_read_file` at batch time. A failed/non-UTF-8 read is `unreadable: <abs>`.
  3. Resolve with `RepoPath`. Not in a repo, symlink escaping the repo, or a `RepoPath` error is `not_in_repo: <abs>`. A `Kind(rel) == ""` path is `not_scored_kind: <abs>`. A `RepoID(top)` failure is `not_in_repo: <abs>`.
  4. Scan the content with `Scan`; on a hit, emit no fact and the existing reason form `secret: <pattern> at line <N> in <rel>`.
  5. Emit exactly one fact: `type: artifact_version`, `conversation_id` = `p.conv` (`feedback-<repo_id>`), `harness` = `p.harness`, `event` = `artifact_snapshot`, `ts` = the read file's mtime (seconds, as a JSON number), `repo_id`, `path` = `rel`, `content_hash` = `ContentHash(raw)`, `content` = text, `source: worktree`. No `hook_event`.
- `_write_paths` gains an early snapshot branch: when `p.event == "artifact_snapshot"`, return the normalised payload path (absolute, or joined to `p.base`). This is what Plan 24's `_mcp_queue_entries` calls, so a snapshot entry must match the same `(repo_id, rel_path)` or absolute path as a hook write. Keep every existing write-tool/patch behaviour unchanged.

### Stop/SessionEnd sweep and drain

- Add one helper that, given a parsed Stop/SessionEnd entry and the queue directory, returns the snapshot entry names it wrote. Trigger only when `p.event` is `Stop` or `SessionEnd` and the envelope `ts` is numeric and `now - ts <= 3600`; otherwise write nothing. Old staged backlog events therefore emit no snapshot and no artifact_version (Phase 3 outcome (2)).
- Repo discovery: `cwd` from the payload; `git rev-parse --show-toplevel`; `RepoID`. Run `git status --porcelain=v1 -z --untracked-files=all` from the repo top. Expand untracked directories via `--untracked-files=all`. Take modified and untracked worktree paths (skip deletions; for a rename take the destination). Keep only paths whose repo-relative path has a scored kind (`Kind(rel)` non-empty). A path that stops existing or is unreadable between status and enqueue is skipped or left for the drain's rejection; the sweep itself must not fail the batch.
- Write one snapshot per eligible file using the one writer above, with the settled payload keys and `session_id = "feedback-" + repo_id`. The queue directory comes from the drain's `Options.Dir` (respect `YAKKA_QUEUE` through the existing `QueueDir`/options path; do not read config from the event).
- In `_Runner.batch`, after reading the batch's `File` objects and before `Build`, run the sweep for fresh Stop/SessionEnd entries, append the new files to the batch's `in_files`, and let the normal `Build`/`send`/`apply`/`reject` path delete or reject them. Log a sweep failure with `self.logf`; never raise it into the drain. Do not run the sweep for old events or for non-Stop/SessionEnd events.

### Tests

- `test_facts.py`: add a `TestArtifactSnapshot` (or equivalent) covering: one fact, no hook fact, `ts` equals the file mtime, `conversation_id`/`event`/`source` as above; two same-content/same-mtime snapshots produce equal `RowHash` (the second is `duplicate`); a non-UTF-8 file yields no fact and a reason containing `unreadable`; a path outside the repo yields `not_in_repo`; a non-scored path yields `not_scored_kind`; a secret yields no fact and a `secret: ... at line ... in ...` reason. Extend `TestWritePaths` so a snapshot entry returns the absolute payload path and a relative one joins `cwd`.
- `test_drain.py`: add a sweep test with a temp git repo: a modified design file, an untracked brief, a modified non-scored file and a deleted file; a fresh `Stop` event with `cwd`; run the drain against the fake sink and assert one snapshot entry per scored file, no entry for the non-scored/deleted file, and exactly one `artifact_version` per file with `ts` = mtime and no `hook_event` for the snapshot. Add the negative: the same Stop event with an envelope `ts` older than 3600 s writes no snapshot. Add a rejection case: a snapshot pointing at a non-UTF-8 file leaves `queue/rejected/<name>` with a `.reason` containing `unreadable`, and the entry is not silently deleted.
- `test_mcp.py` (or the existing queue-reader test file): a `queue` v2 coverage test where a snapshot entry matches `(repo_id, rel_path)` and the absolute path, is counted in `pending_covering`/`oldest_covering_age_s`, and a same-named path in another repo does not match. The v2 `coverage.complete` stays true only for a fully read queue.
- Do not weaken or delete existing drain, facts, MCP or shim tests. Where the sweep changes an existing fixture's meaning, make the fixture old enough not to sweep rather than changing its expected outcome.

### Design docs

- `docs/design/01-event-model-and-ingest.md`: the Artifact version fact now also comes from the drain's Stop/SessionEnd sweep; note the `artifact_snapshot` pointer, the read-at-drain-time content, `ts` = mtime, the 1 h bound and the rejected reasons in the drain section (`Who does what` / Decisions 2). Update the commit-catch-up sentence to say it is no longer the only recovery for a missed write. Do not claim the queue carries content.
- `docs/design/04-advisory-surface.md`: in `artifact_feedback`, record the Phase 3 order (delivered hash match before rejection/coverage; covering means entry mtime at or after the file's; 300 s bound; queue v2 complete coverage) and that an enqueue acknowledgment alone proves neither `queued` nor `delivered`. Keep the existing v2 local-action/read-only text.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `cd plugins/yakka/client && python3 -m unittest test_facts test_drain test_mcp test_mcp_shim -v` -> all pass; the new snapshot, sweep, rejection and queue-coverage tests appear and pass.
- `cd plugins/yakka/client && python3 -m py_compile yakka.py` -> clean.
- `git diff --check` -> clean.
- Observable in the test output: `Build` on an `artifact_snapshot` entry emits one `artifact_version` with `ts` = mtime and no `hook_event`; two unchanged snapshots have equal row hashes; the sweep produces one pointer per modified/untracked scored file and none for an old Stop/SessionEnd event; a non-UTF-8 snapshot lands in `queue/rejected/` with `unreadable` in its `.reason`; `_mcp_queue_entries` counts a snapshot entry in v2 coverage.

## Boundaries

- Do not push, merge, change branches, touch master, Plans 22/23/24, PR #184 or `/home/codyh/workspace/yakka-wt/`.
- Do not run fly or wrangler, deploy, set/read/print secrets, touch production configuration, Cloudflare or Fly settings, or run tenant reset/delete.
- Do not call the live remote, `artifact_feedback`, a harness/model session, or create egress. Tests use temp repos and the fake HTTP sink only.
- Do not change `spool.sh`, the hook JSON, the shim's `_mcp_enqueue`/readers, the server Go code, config, or the Plan 24 queue contract.
- Do not parse shell commands or scan the whole repo; the sweep is bounded by `git status` on the session's repo and the 1 h freshness bound.
- Do not run the unrelated layout test (`tools/release/test_layout.py::test_repo_passes_layout_check`).

## Gates (live, Cody)

- A live scratch repo with the released plugin and remote: write with Edit and rewrite with a Bash heredoc, end the turn, and observe the drain deliver the current hash (Phase 3 outcome (1)); the build can prove the drain half against a temp repo and fake sink only.
- A live `artifact_feedback` `queued` then `delivered` call, including the E1 enqueue path, after the server declaration is deployed (egress; ledger 28).
- The issue's own budget-repo case from a session there, by Cody (egress).
- `artifact_feedback` checks on this brief and the phase report (egress; not run here).
