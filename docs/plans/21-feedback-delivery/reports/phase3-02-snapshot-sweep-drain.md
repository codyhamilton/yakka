# Phase 3 unit 2 report — Stop/SessionEnd sweep, artifact_snapshot drain and queue matching

Status: done.

## What was built

Against `briefs/phase3-02-snapshot-sweep-drain.md`:

- **Snapshot ingestion in `Build`.** A parsed entry whose envelope event is `artifact_snapshot`
  bypasses the hook path: no `hook_event`, no `_build_commits`. The drain reads the payload `path`
  at batch time, resolves the repo and kind, scans the content, and emits exactly one
  `artifact_version` (`source: worktree`, `conversation_id` = payload `session_id`
  `feedback-<repo_id>`, `event: artifact_snapshot`, `ts` = the file's mtime, `repo_id`, repo-relative
  `path`, `content_hash`, `content`). Any entry that yields no version gets a rejection reason:
  `unreadable: <path>`, `not_in_repo: <path>`, `not_scored_kind: <path>`, or the existing
  `secret: <pattern> at line N in <rel>` form.
- **Mtime on reads.** `_ReadResult` carries `mtime`, set from `os.stat` on a successful read. The
  fact's `ts` is serialised as a JSON number via `_Number`.
- **`_write_paths`.** An early snapshot branch returns the normalised payload path (absolute, or
  joined to `cwd`), so Plan 24's `_mcp_queue_entries` recognises the kind with no other change to
  its incomplete-queue, symlink, size, deadline or tenant rules.
- **Stop/SessionEnd sweep.** `_sweep_snapshots` triggers only for `Stop`/`SessionEnd` with numeric
  envelope `ts` at most 3600 s old, takes `cwd` from the payload, resolves the repo top with
  `git rev-parse --show-toplevel`, gets `RepoID`, runs
  `git status --porcelain=v1 -z --untracked-files=all` from the top, keeps modified/untracked
  scored-kind paths, skips deletions (renames use the destination), and writes one
  `artifact_snapshot` pointer per eligible file through `_write_snapshot` (write under
  `queue/tmp/`, `0o600`, rename to `<conv>-<ts>-<pid>-<rand>.evt`, envelope line then payload, no
  content). `session_id` is `feedback-<repo_id>`; payload keys are exactly `session_id`, `cwd`,
  `path`.
- **Drain integration.** `_Runner.batch` runs the sweep after reading the batch's files and appends
  the new entries to `in_files`, so the same batch builds, sends and deletes or rejects them. Sweep
  exceptions are logged with `self.logf` and never raised into the drain. Old Stop/SessionEnd events
  write nothing.
- **Design docs.** `docs/design/01-event-model-and-ingest.md` now records the sweep as a second
  trigger, the pointer/read-at-drain-time/`ts`=mtime/1 h bound/rejected reasons, and that commit
  catch-up is no longer the only recovery. `docs/design/04-advisory-surface.md` records the Phase 3
  order: service hash match before rejection/coverage, covering = entry mtime at or after the
  file's, 300 s bound, queue v2 complete coverage, and that an enqueue acknowledgment proves
  neither `queued` nor `delivered`.

Files changed (owned paths only):

- `plugins/yakka/client/yakka.py`
- `plugins/yakka/client/test_facts.py`
- `plugins/yakka/client/test_drain.py`
- `plugins/yakka/client/test_mcp_shim.py` (queue-coverage test; `test_mcp.py` wildcard re-exports it)
- `docs/design/01-event-model-and-ingest.md`
- `docs/design/04-advisory-surface.md`
- this report

`spool.sh`, hook JSON, the shim's `_mcp_enqueue`/readers, server Go code and Plan 24's queue
contract were not changed. The working tree also contains the other unit's Go changes
(`packages/yakka/internal/serve/*`); they were left untouched.

## Tests

Before: at HEAD there was no snapshot branch and no `TestArtifactSnapshot`, sweep or queue-coverage
test (declared methods: `test_facts.py` 9, `test_drain.py` 19, `test_mcp_shim.py` 31). After:

```
cd plugins/yakka/client && python3 -m unittest test_facts test_drain test_mcp test_mcp_shim -v
Ran 101 tests in 40.879s
OK
```

New tests: `TestArtifactSnapshot` (one fact with mtime and no `hook_event`; equal row hash for two
same-content/same-mtime snapshots; non-UTF-8 `unreadable`; outside-repo `not_in_repo`;
non-scored `not_scored_kind`; secret reason and no fact), extended `TestWritePaths` (absolute and
relative snapshot paths), three drain tests (fresh Stop sweep produces one snapshot per
modified/untracked scored file and none for the deleted/non-scored file, with `ts` = mtime and no
`hook_event`; old Stop writes no snapshot; non-UTF-8 snapshot lands in `queue/rejected/` with
`unreadable` in its `.reason` and is not silently deleted), and
`test_snapshot_entry_counts_in_v2_coverage` (`(repo_id, rel_path)` and absolute matching,
`pending_covering`/`oldest_covering_age_s`, `complete`, and a same-named path in another repo not
matching).

Other done-evidence checks:

```
cd plugins/yakka/client && python3 -m py_compile yakka.py   # clean
git diff --check                                             # clean
```

## Deviations from the brief

- The sweep records processed Stop/SessionEnd names in `_Runner.swept` so a send retry does not
  re-sweep the same event and enqueue duplicate pointers. The brief did not ask for this; it
  follows its "fresh" wording and its rule not to delete an unsent snapshot.
- The sweep skips a status path that is no longer a regular file at enqueue time (the brief allows
  either skipping or leaving it to the drain's rejection).
- A snapshot entry with a missing or empty payload `path` is rejected as `unreadable: ` with no
  path (the brief's `<path-or-empty>`).
- The queue filename sanitises the conversation ID to `[A-Za-z0-9._-]` and 128 characters, as
  `spool.sh` does, because a `repo_id` may contain `/`; the payload `session_id` keeps the exact
  `feedback-<repo_id>` value.

## Unfinished work

None in this brief's scope.

## Known problems

- Plan 24's E1 shim still spools a pointer as a `PostToolUse`/`Write` entry, not an
  `artifact_snapshot` entry. That is Plan 24's form and was left as-is per the brief; the write-tool
  path still works. The drain now separately accepts `artifact_snapshot` entries from its own sweep.
- A Stop/SessionEnd event that is retried after a partial sweep failure will not sweep again for
  that event name (the `_Runner.swept` guard). Files missed in that window are recovered by a later
  turn's event or by commit catch-up.
- The sweep shells out to `git` from the session's repo on every fresh Stop/SessionEnd; the bound is
  one `git status` per event, not a repo-wide scan.

## Gates (live, Cody)

- A live scratch repo with the released plugin and remote: write with Edit and rewrite with a Bash
  heredoc, end the turn, and observe the drain deliver the current hash (Phase 3 outcome (1)). This
  build proves the drain half against temp repos and a fake HTTP sink only.
- A live `artifact_feedback` `queued` then `delivered` call, including the E1 enqueue path, after
  the server declaration is deployed (egress; ledger 28).
- The issue's own budget-repo case from a session there, by Cody (egress).
- `artifact_feedback` checks on this brief and report (egress; not run here).
