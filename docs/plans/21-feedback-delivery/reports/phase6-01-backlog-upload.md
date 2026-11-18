# Report — phase6-01: staged legacy backlog, dry-run manifest and hook-events-only upload

## Done against the brief

- **Hook-events-only mode (`plugins/yakka/client/yakka.py`).** `Options` gained `EventsOnly` (default `False`) and `OnResult` (default `None`). `Build(ctx, files, hook_events_only=False)` skips the whole ref-collection pass when true, emits exactly one `hook_event` fact per parsed file (`id` `<name>#0`, `payload = _redact_payload(p.payload)`), never calls `_build_commits`, and never takes the `artifact_snapshot` read path. Parse failures keep their existing reasons. `_Runner.batch` calls `Build(..., hook_events_only=self.o.EventsOnly)` and skips the Stop/SessionEnd sweep loop when events-only. `_Runner.apply` calls `OnResult(fact id, fact type, status, reason)` once per result; the single-item 400/413 branch calls it per fact as `rejected` / `http_<status>`. `_MAX_DRAIN_FILES`, `_MAX_DRAIN_BYTES`, `Window`, retry/429 and `Run` semantics are unchanged, and the live path is byte-for-byte unchanged when `EventsOnly` is false.
- **`_POLICY_REMOVE`.** A module frozenset with the 15 `Remove` pairs read from `packages/yakka/internal/ingest/policy.go:27-43`, with a comment naming that file. The test extracts the pairs from the Go file with a regex and asserts set equality.
- **`backlog` command (`yakka.py`).** Added to `main()`; `bin/yakka` untouched. `stage` requires `--source` and `--stage`, refuses a stage inside the source, refuses a non-empty `<stage>/queue`, copies only top-level non-dot `.evt` files by name, records the source block plus a second source measurement, and fails if the source count/bytes moved or the staged copy differs. `manifest` parses the staged queue through `Build(..., hook_events_only=True)`, computes `files`, `bytes`, `facts`, `facts_by_type`, `local_rejected_files` by reason class, `distinct_row_hashes`, `duplicate_facts`, `policy_dropped`, `expected_stored`, `source`, `staged` and `rejected_dir`, asserts zero `artifact_version`/`commit`, writes `<stage>/manifest.json`. `upload` refuses a missing or stale manifest and an existing `report.json`, runs the existing `Run` with `Options(Dir=<stage>/queue, EventsOnly=True, OnResult=..., Sink=ConfigSink, ...)`, tallies results, writes `<stage>/report.json` and prints the same counts. First and re-run shapes are accepted exactly as the brief specifies; anything else writes `verified: false` with an itemised difference and exits 2.
- **Tests (`plugins/yakka/client/test_backlog.py`, new).** 9 tests: stage selection/source-unchanged guards, stage-inside-source and non-empty-queue refusals, manifest counts with `_read_file` patched to raise (proving no artifact read for the `apply_patch` event), first upload, re-run with zero new rows, missing/stale manifest and existing-report refusals, and Go/Python policy parity. Fixtures live under `~/workspace/.briefs/q` and are removed in `tearDown`; no `/tmp`.

## Tests and checks

Before: `test_backlog.py` did not exist, so `python3 -m unittest test_backlog` failed by absence; the unchanged suites were the existing baseline. After (all in `plugins/yakka/client`, no live upload/network/egress):

```
python3 -m unittest test_backlog -v
  Ran 9 tests ... OK   (3.628s)

python3 -m unittest test_clientconfig test_status test_keys test_facts test_drain \
  test_http test_mcp test_mcp_guard test_mcp_shim test_secrets
  Ran 149 tests ... OK   (45.093s)

python3 -m py_compile yakka.py    # clean
git diff --check                  # clean
```

- Upload run 1 in the fake: `accepted=5`, `duplicate=0`, `rejected=1`, `stored=3`, `facts_sent=6`, `files_sent=5`, `files_local_rejected=1`, `verified=true`, `run_kind="first"`, exit 0; fake stored 3 rows.
- Upload run 2 on a fresh stage: `accepted=2`, `duplicate=3`, `rejected=1`, `stored=0`, `zero_new_rows=true`, `verified=true`, `run_kind="rerun"`, exit 0; fake stored set unchanged.
- The report text contains no payload marker, key, `Authorization` or `Bearer`.

## Real stage / manifest (read-only recon, no egress)

```
backlog stage --source ~/.local/share/workflow/queue --stage ~/workspace/yakka-backlog-stage/plan21-recon
  source_file_count=37931  source_bytes=167853844
  source_after_file_count=37931  source_after_bytes=167853844
  staged_files=37931  staged_bytes=167853844

backlog manifest --stage .../plan21-recon
  files=37931  bytes=167853844  facts=37931
  facts_by_type={"hook_event": 37931}  local_rejected_files={}
  distinct_row_hashes=37931  duplicate_facts=0
  policy_dropped=18306  expected_stored=19625
  rejected_dir={"evt": 19, "reason": 19}
```

Original queue before and after: 37,931 `.evt`, 167,853,844 bytes, max mtime `1793399032.5220295980` unchanged, 0 files newer than that mtime. Nothing was written under the original. The staged copy remains at `~/workspace/yakka-backlog-stage/plan21-recon` for Cody's gate.

## Deviations

- The `source` block also records `after_file_count`/`after_bytes` (the second measurement) so the untouched proof travels with the manifest; the brief listed the four primary fields only.
- `_backlog_upload` takes an optional `sink` factory defaulting to `ConfigSink`, so tests can supply the fake without adding a sender; the command itself always uses `ConfigSink`.
- `files_sent` counts every file whose fact was answered `accepted` or `duplicate`, so policy-dropped files are included (the server answers them `accepted` and they leave the queue). The brief's wording ("accepted or duplicate") reads this way; the report also carries `policy_dropped` separately.
- The fake checks its designated rejection after policy `Remove` but before RowHash dedupe. See the contradiction below for why.

## Contradiction (not silently resolved)

The brief's upload acceptance rule requires `stored == manifest.expected_stored` for `verified: true`, exit 0. The brief's test fixture also requires "one fact the fake rejects", so a kept `hook_event` is answered `rejected` on run 1. A distinct kept fact that is rejected lowers `accepted − policy_dropped` by one, so `stored` can no longer equal `expected_stored` (the manifest cannot know a server rejection). The cited DESIGN clause allows this case ("... equals the manifest's expected stored count **or the report explains the difference**"), but the brief's exit-0 rule omits that escape.

I did not relax the code's verification. Instead the fixture's designated-rejected fact is a within-copy duplicate of another kept fact (same row hash, different file name), rejected before dedupe. Its twin is stored, so `stored` still equals `expected_stored` on run 1 and run 2's `duplicate == expected_stored`, `accepted == policy_dropped` both hold. A genuine server rejection of a distinct kept fact would still produce `verified: false`, exit 2, with the difference itemised — the design's "or explains the difference" path is not accepted by this brief's rule.

## Unfinished / gates (Cody)

- **Live upload** of the staged copy to the configured remote after review and deployment state: `python3 yakka.py backlog upload --stage <stage>`. Not run (egress).
- **Independent server-side count** of the tenant's stored hook events before/after, risen by `stored`. The report writes `server_side_count: "gate"` and never queries it.
- **Second live run** on a fresh staged copy of the same original, exiting 0 with zero new rows.
- `artifact_feedback` checks on this brief and report (egress). Not run.
- Archiving or deleting the original queue is never authorised here; it stays untouched.

## Known problems

- No other known problems in the owned surface. The pre-existing `tools/release/test_layout.py::test_repo_passes_layout_check` failure was not run, per the brief.
