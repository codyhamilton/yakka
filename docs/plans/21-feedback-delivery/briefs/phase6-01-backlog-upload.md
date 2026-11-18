# Brief: phase6-01 — Staged legacy backlog, dry-run manifest and hook-events-only upload

Consumer: one build worker owning the Python client and its test.
Owned paths: `plugins/yakka/client/yakka.py`, `plugins/yakka/client/test_backlog.py` (new), `docs/plans/21-feedback-delivery/reports/phase6-01-backlog-upload.md`. Touch nothing else.
Commits: leave changes in the working tree. The orchestrator reviews and commits; it does not run the live upload (that is a Cody egress gate).
Report: write `docs/plans/21-feedback-delivery/reports/phase6-01-backlog-upload.md` before finishing, using the `execution-report` rubric (`packages/yakka/catalogue/checks/execution-report.json`). Counts only: no event payload, no content, no key, no bearer, no endpoint with credentials.
Depends on: nothing inside this phase (single unit). The phase's design dependencies 1, 2 and 3 are Cody's order and are already closed on this branch; the upload uses no shim and no effect.
Runs alongside: nothing.
Budget: 10 files to read, about 450 lines changed, about 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), and report `over budget`.

## Hard constraints (this run)

- No live upload, network, egress, deploy, `fly`, `wrangler`, tenant reset/delete or paid call. Do not call `artifact_feedback` (it is egress). Do not read or print secrets or keys.
- The remote upload and the independent server-side count are a **Cody gate**. Build and test the tooling against fixtures and in-process HTTP fakes only. Record the live upload and the server count as `gate:` in the report.
- `~/.local/share/workflow/queue` may be **read and counted**. Staging copies out of it. Never move, delete, archive, drain in place or write anything into it; the original must be byte-for-byte unchanged.
- No `/tmp` for working artifacts. Stage under a workspace/scratch location (below), never inside the original queue.
- Python only; no animation or timing assertions. Never touch `master`, another branch, Plan 22 / PR #184, or `/home/codyh/workspace/yakka-wt/`. No Go code, no legacy Go client, no plugin hooks, no `bin/yakka`.

## Required reading, in order

1. `docs/plans/21-feedback-delivery/DESIGN.md:486-491` — the Phase 6 outcome, quoted clause by clause in Contract below.
2. `docs/plans/21-feedback-delivery/DESIGN.md:241-260` — Assumptions 6, 7 and 8: tenant, expected stored count, `rejected/` entries not uploaded, drain limits.
3. `docs/plans/21-feedback-delivery/DESIGN.md:200, 410-418` — Decisions: "The backlog is uploaded from a staged copy, never by draining the original in place, and sends hook events only"; Assumption 28: the upload is a gate and no queue operation is authorised by the design.
4. `docs/plans/21-feedback-delivery/IMPLEMENTATION.md:171-201` — Phase 3's record and Carried, so you do not re-derive its drain behaviour.
5. `plugins/yakka/client/yakka.py:1844-1880` (`Options`), `2199-2290` (`_Runner.batch`), `2292-2374` (`send`/`apply`), `2414-2492` (`Run`), `2519-2547` (`RunStandalone`), `3993-4009` (`main`) — the drain path you are extending.
6. `plugins/yakka/client/yakka.py:1020-1097` (`Build`), `1151-1207` (`_parse_file`), `1210-1217` (`_redact_payload`), `1258-1290` (`_write_paths` start) — why old write-tool events become `artifact_version` today, and the exact hook-event fact form.
7. `plugins/yakka/client/yakka.py:287-311` (`Canonical`/`RowHash`), `1755-1841` (`HTTPSink`/`ConfigSink`), `1912-1916` (`QueueDir`), `1588-1589` (`_MAX_DRAIN_FILES`/`_MAX_DRAIN_BYTES`).
8. `packages/yakka/internal/ingest/policy.go:21-48` and `packages/yakka/internal/ingest/ingest.go:300-320` — the Remove policy runs before hashing and answers `accepted` without storing; the row hash is `ContentHash(Canonical(raw))` with top-level `id` and `content` removed.
9. `packages/yakka/internal/keys/keys.go:28-62` — the canonical form the client already mirrors in `Canonical`.
10. `plugins/yakka/client/test_drain.py:1-167` — the fake HTTP sink and `Options` helpers to reuse in `test_backlog.py`.

Read ranges and grep; do not read a whole file to find one section, and truncate long tool output. Never print an event payload; recon output is counts only.

## Goal

Add one explicit, one-time Python backlog command that stages a copy of the legacy queue, produces a dry-run manifest of exactly what an upload would send, and runs the existing Python drain over the staged copy in a hook-events-only mode that never builds an `artifact_version` or `commit`. The command writes a counts-only report and proves its own arithmetic; the live upload remains a Cody gate.

## Contract

Quoted from `DESIGN.md:488-491`; these are settled and are not open for reinterpretation.

- Manifest: "A manifest records the file count (37,931 at recon), total bytes, the expected stored count and the policy-dropped count for `~/.local/share/workflow/queue`."
- Staged copy and hook events only: "The build uploads a staged copy (the original is not moved or deleted) to the configured remote under the phase 1 contract, tenant of the configured key, and writes a counts-only report outside the queue: files sent, results by status, facts by type (every sent fact is a `hook_event`; zero `artifact_version` and zero `commit`), rejected itemised by reason."
- First-run verification: "The upload is verified when accepted plus duplicate plus rejected equals the manifest's fact count, the stored count (accepted minus the policy-dropped count, which the server answers `accepted` and does not store) equals the manifest's expected stored count or the report explains the difference, and an independent server-side count of the tenant's stored hook events rose by that stored count."
- Second run: "Running the same command a second time on a fresh staged copy of the same original (the drain deletes what it sends, so the first copy is spent) stores 0 new rows: every storable fact is `duplicate` (equal to the first run's stored count) and the policy-dropped facts are answered `accepted` again; it exits 0."
- Decision (`DESIGN.md:200`): "The backlog is uploaded from a staged copy, never by draining the original in place, and sends hook events only: the events are 3 to 11 days old, and building artifact versions from them would attach today's file content to old events."
- Assumption 6: the expected count is "distinct row hashes among hook events minus events the server's policy drops"; "The row hash excludes `id` and `content` and includes `ts`." Assumption 7: the `rejected/` entries are not uploaded and stay in place.
- Assumption 28: publishing the design authorises no queue operation; the original is never archived or deleted without a separate Cody decision.
- Build choice left open by the design (`DESIGN.md:490`): "staging method, a dry-run count and the hook-events-only mode are the build's to settle against the code." This brief settles them below.

### Recon already measured for you (not a test fixture)

Run against the current original queue, read-only, with the client's own `_parse_file`, `_redact_payload`, `_fact_json` and `RowHash`:

- 37,931 top-level `*.evt` files, 167,853,844 bytes; all envelopes carry `event: ""` and the real event in `payload.hook_event_name`; harness is `codex` for every file.
- Event mix: PreToolUse 18,306; PostToolUse 17,928; SessionStart 397; UserPromptSubmit 377; SessionEnd 376; Stop 353; SubagentStart 77; SubagentStop 77; PreCompact 20; PostCompact 20.
- 1260 PostToolUse events are `apply_patch`; 14,515 are `Bash`. That is exactly why the normal `Build` must not be used: it reads current files for write tools and scans Bash command text for commits.
- Policy Remove pairs present: `("codex","PreToolUse")` = 18,306. Row hashes: 37,931 distinct facts, zero in-copy duplicates, so expected stored = 37,931 − 18,306 = **19,625**.
- `rejected/` holds 19 `.evt` plus 19 `.reason` (the design's "38 entries"); none is uploaded.

**Do not use these numbers as constants in code.** They are recon for the report. The manifest computes every number from the staged copy. Note the trap: the three files that repeat a payload are distinct rows because the row hash includes `ts`; the design's "37,928 distinct payloads" is not the expected-stored input. Recompute from `RowHash`, as above.

## Changes

### 1. Hook-events-only mode in the drain (`yakka.py`)

- `Options` gains `EventsOnly: bool = False` and `OnResult: Optional[Callable[[str, str, str, str], None]] = None`. Both default off/None, so the live drain's behaviour is unchanged.
- `Build(ctx, files, hook_events_only: bool = False)`. When true: skip the whole ref-collection pass (no filesystem reads, no `RepoPath`/`Kind`/`RepoID`), emit exactly one fact per parsed file — the existing `common("hook_event")` fact with `payload = _redact_payload(p.payload)` and id `<name>#0` — and never call `_build_commits`. Parse failures keep their existing reasons. When false the current code path is untouched.
- `_Runner.batch`: call `Build(None, in_files, hook_events_only=self.o.EventsOnly)`; when `EventsOnly` is true, skip the Stop/SessionEnd `_sweep_snapshots` loop entirely. No sweep means no possible `artifact_version`.
- `_Runner.apply`: when `self.o.OnResult` is set, call it once per response result with `(fact id, fact type, status, reason)`; the type comes from the corresponding fact JSON. Keep the existing send/apply/remove/reject semantics.
- `_Runner.send`: on the single-item 400/413 reject branch, call `OnResult` for each fact in that item with status `rejected` and reason `http_<status>` so the report can reconcile; there is no server body to itemise.
- Do not change `_MAX_DRAIN_FILES`, `_MAX_DRAIN_BYTES`, `Window`, the retry/429 paths, `Run`'s idle/lock/give-up semantics, or any behaviour when `EventsOnly` is false.

### 2. The one-time `backlog` command (`yakka.py`)

Add `backlog` to `main()` with its own `argparse` and no wrapper change (`python3 yakka.py backlog …`; `bin/yakka` stays untouched because its usage string and dispatch are release-tested and this is a one-time command). Three subcommands:

- `backlog stage --source DIR --stage DIR`
- `backlog manifest --stage DIR`
- `backlog upload --stage DIR`

Stage layout: `<stage>/queue/` (the staged `.evt` files), `<stage>/manifest.json`, `<stage>/report.json`. No file content or payload ever goes into the manifest or report.

**Stage**

- Require both flags explicitly; no default source and no default stage.
- Refuse (exit 2, no writes) unless `realpath(stage)` is outside `realpath(source)`; refuse if `<stage>/queue` already contains any entry (each run needs a fresh copy); create nothing inside `source`.
- Read the source's top-level regular files whose names end `.evt` only. Do not descend into `rejected/`, do not copy dotfiles or `tmp/`, do not copy `rejected/*`. Copy by name with `shutil.copyfile` into `<stage>/queue/` (write to `<stage>/queue/tmp/` and rename if you prefer, but never inside the source).
- Record in `<stage>/manifest.json` a `source` block: `file_count`, `bytes`, `rejected_evt`, `rejected_reason`, plus the same two numbers measured again after staging; fail (exit 2) if they differ, which is the "original untouched" proof. Record `staged.file_count` and `staged.bytes` and fail unless they equal the source's `.evt` count and bytes.
- Print a counts-only JSON summary to stdout.

**Manifest (dry-run count)**

- Require `<stage>/queue/`; parse every staged `.evt` with `_parse_file`.
- Build the hook-events-only fact for each parsed file with the same `Build(..., hook_events_only=True)` path the upload uses, so the two cannot diverge.
- Write and print:
  - `files`, `bytes` (staged).
  - `facts` (parsed files that yield a hook_event) and `facts_by_type` (`{"hook_event": n}`); assert `artifact_version` and `commit` are both 0.
  - `local_rejected_files` itemised by reason class (`unparseable`, `invalid`; first token before `:`) — a file that yields no fact is not a fact and is reported separately.
  - `distinct_row_hashes` (over all facts), `duplicate_facts` = `facts − distinct_row_hashes`.
  - `policy_dropped` = count of facts whose `(harness, event)` is in the mirror of the server's Remove table.
  - `expected_stored` = distinct row hashes among kept facts = `(facts − policy_dropped) − duplicate kept facts`.
  - `source` block from the stage step, `rejected_dir` counts (present, not staged).
- Add a module constant `_POLICY_REMOVE` in `yakka.py` holding exactly the pairs at `policy.go:27-43`, with a comment naming that file as the source. It is the one server contract the client must mirror to produce the manifest's policy-dropped count; it is not a new registry. Do not guess: read the table.
- Refuse `upload` when the manifest is missing or its `files`/`bytes` no longer match `<stage>/queue/` (stale manifest → re-run `manifest`).
- Resolution of the fixture/acceptance tension, settled here: the strict `stored == manifest.expected_stored` rule stands for `verified: true` on a first run. If the server rejects a distinct kept fact, the command writes `verified: false`, `run_kind: "unverified"`, the itemised `difference` block (`stored`, `rejected`, `manifest_expected_stored`) and exits 2; that report is the design's "or the report explains the difference" path for operator review, and the code must not claim `verified` over an unexplained difference. The unit's fixture therefore makes its designated rejection a within-copy duplicate so the clean-run arithmetic and the rejected-status reporting are both covered; a distinct rejection remains a reported, non-verified result until a later decision changes the rule.

**Upload**

- Build `Options(Dir=<stage>/queue, EventsOnly=True, OnResult=recorder, Sink=ConfigSink, Log=sys.stderr, Window=0.03, Linger=0.5, Poll=0.05, GiveUp=60.0)` and run the existing `Run` with a `DrainContext()`. No new sender, no new retry loop.
- Recorder tallies per fact: `accepted`, `duplicate`, `rejected` (reason itemised and truncated to 120 chars; no ids, paths or payloads in the report), and `facts_by_type`. Count `files_sent` from staged files that left `queue/` for the server (accepted or duplicate) and `files_local_rejected` from files the drain moved to `queue/rejected/` without a send.
- Write `<stage>/report.json` (refuse if it exists) and print the same counts. Report fields at minimum: `staged_files`, `files_sent`, `files_local_rejected`, `facts_sent`, `facts_by_type`, `accepted`, `duplicate`, `rejected`, `rejected_by_reason`, `policy_dropped`, `stored` (= `accepted − policy_dropped`), `manifest_expected_stored`, `run_kind`, `verified`, `zero_new_rows`, plus the manifest's file/byte counts and the source signature before/after. A `server_side_count` field is written as `"gate"`; the tool never queries it.
- Accept either run shape:
  - **first run**: `facts_sent == manifest.facts` and `accepted + duplicate + rejected == manifest.facts` and `stored == manifest.expected_stored` → `run_kind: "first"`, `verified: true`, exit 0.
  - **re-run** (fresh staged copy of the same original): the same fact arithmetic holds, `stored == 0`, `duplicate == manifest.expected_stored`, `accepted == manifest.policy_dropped` → `run_kind: "rerun"`, `verified: true`, `zero_new_rows: true`, exit 0.
  - Anything else: write the report with the difference itemised, `verified: false`, exit 2. `Run` returning anything other than idle (lock held, give-up, error) is exit 2 with the partial report.
- No live endpoint in this build: `Sink` is injectable exactly as `Options.Sink` already is, and every test supplies a fake.

### 3. Tests (`test_backlog.py`, new)

Reuse the fake HTTP handler style from `test_drain.py` (in-process `HTTPServer` on 127.0.0.1). The fake must mirror the server's order: policy Remove first (answer `accepted`, store nothing), then RowHash dedupe (`duplicate` if the hash is already stored, else `accepted` and store), and a designated fact answered `rejected` with a reason.

- Fixture queue builder: a handful of `codex` `Stop`/`PostToolUse`/`PreToolUse` events, one `apply_patch` PostToolUse pointing at a temp file with distinctive content, one unparseable file, one fact the fake rejects, and a `rejected/` dir with an `.evt`. Assert `stage` copies only top-level `.evt`, the source bytes/count are unchanged, and a stage inside the source or a non-empty stage queue is refused.
- `manifest` on the fixture: expected values computed by hand; `facts_by_type` contains only `hook_event`; `policy_dropped` equals the PreToolUse count; `expected_stored` equals distinct kept rows; the `apply_patch` event yields **no** `artifact_version` and the temporary file is never read (prove it: point the payload at a path whose read would change an mtime counter or simply a nonexistent path and assert no read/reason).
- Upload run 1 against the fake: accepted/duplicate/rejected/`stored` match the manifest; the report file exists and contains no payload bytes, key or bearer; exit 0.
- Upload run 2 on a **fresh** stage of the same fixture: every storable fact `duplicate` (== first `stored`), policy-dropped facts `accepted`, `stored == 0`, `zero_new_rows: true`, exit 0, and the fake's stored set is unchanged.
- A tampered manifest (file count mismatch) refuses `upload`.
- Policy parity: read `packages/yakka/internal/ingest/policy.go`, extract every `{"<harness>", "<event>"}: Remove,` pair with a regex, and assert it equals `_POLICY_REMOVE`. This is the only cross-language assertion and it touches no Go code.
- No test starts a live drain against the user's queue; every drain uses a temp stage and a fake sink. No sleeps used as assertions.

### Keep untouched

- The default drain path for live queues (`EventsOnly=False`): same facts, same sweep, same send/apply/reject, same exit reasons.
- `plugins/yakka/script/spool.sh`, `plugins/yakka/hooks/*`, `plugins/yakka/bin/yakka`, the plugin manifests, Plan 24's shim/readers and its `queue` contract.
- Every Go file, the legacy Go client, `internal/serve`, and the server's policy table (the brief reads it, it does not change it).
- The original queue: no writer may open a path under `~/.local/share/workflow/queue` for writing. `QueueDir()` still points there by default; the command must always pass an explicit stage `Dir`, and must refuse a stage inside the source.

## Done evidence

Identify or write the failing checks before changing code. Report output before and after.

- `cd plugins/yakka/client && python3 -m unittest test_backlog -v` → all new tests pass, including run 1, run 2 (`zero_new_rows`), the no-artifact-version case, the stage guards and the policy parity assertion.
- `cd plugins/yakka/client && python3 -m unittest test_clientconfig test_status test_keys test_facts test_drain test_http test_mcp test_mcp_guard test_mcp_shim test_secrets` → unchanged suite passes (the live drain path is not regressed).
- `cd plugins/yakka/client && python3 -m py_compile yakka.py` → clean; `git diff --check` → clean.
- Real read-only recon (allowed, no egress): `python3 yakka.py backlog stage --source ~/.local/share/workflow/queue --stage ~/workspace/yakka-backlog-stage/plan21-recon` then `... manifest --stage ~/workspace/yakka-backlog-stage/plan21-recon`. The manifest shows source and staged file count and bytes equal (37,931 / 167,853,844 as measured, or the current values if events arrived), `facts_by_type` only `hook_event`, `policy_dropped` 18,306 and `expected_stored` 19,625 for the measured queue. Record the actual numbers in the report; do not fail the build if they moved.
- Observable: after staging, `find ~/.local/share/workflow/queue -maxdepth 1 -name '*.evt' | wc -l` and the byte total are unchanged; nothing under the original has a newer mtime.
- Observable in `test_backlog.py`: run 1 stores `expected_stored` rows in the fake and run 2 adds none while exiting 0.

## Boundaries

- Do not push, merge, change branches, touch master, Plans 22/23/24, PR #184 or `/home/codyh/workspace/yakka-wt/`.
- Do not run `fly` or `wrangler`, deploy, set/read/print secrets, touch production configuration, Cloudflare or Fly settings, or reset/delete a tenant.
- Do not call the live remote, `artifact_feedback`, a harness or a model session, or create any egress. Tests use a fake loopback sink only.
- Do not stage or drain into the original queue; do not archive or delete it. Do not use `/tmp` for anything, including unit-test fixtures: create scratch directories under `~/workspace/.briefs/q/` (for example `tempfile.mkdtemp(dir=os.path.expanduser("~/workspace/.briefs/q"))`) and remove them afterwards. The real stage goes under `~/workspace`.
- Do not change the normal drain's behaviour for live queues, the plugin hooks, the shim, or Go code.
- Do not run `tools/release/test_layout.py::test_repo_passes_layout_check` (pre-existing failure on ignored `packages/yakka-analytics/node_modules/**`).

## Gates (Cody; egress or operator evidence)

- The live upload of the staged copy to the configured remote, after review and deployment state is confirmed: `python3 yakka.py backlog upload --stage <stage>` against a staged copy produced by this brief. The report's `verified` flag and `run_kind: "first"` are the code-side evidence; the design's acceptance waits on the next two lines.
- An independent server-side count of the tenant's stored hook events before and after the upload, risen by `stored`; the tool never performs it and the report records it as `gate`.
- The second run on a fresh staged copy of the same original, exiting 0 with every storable fact `duplicate` and zero new rows.
- `artifact_feedback` checks on this brief and on the phase report (egress; not run here).

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, the real stage/manifest counts, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location and root cause if found. Do not fix it here. Do not spawn agents beyond read-only research helpers; if this unit needs one it was mis-sized, so report `blocked`.
