# Phase 4-04 — stable docs and plugin release metadata

Status: done with concerns.

Updated the stable architecture docs to describe the shipped `/v1/mcp` client boundary: the server owns tool definitions, validation, state and wording; the shim forwards requests, injects declared local facts and reports its own transport/config errors. Documented the v2 bounded pointer enqueue, refreshed context, the existing spool/drain ownership, and that enqueue acknowledgment alone proves neither current queue coverage nor delivery. Updated the API row to identify the active stdio shim client. Bumped all three plugin manifests from `3.4.0` to `3.4.1`; harness registrations and plugin functionality were not changed.

### Evidence

- Before edits, docs 02/04 described the shim as parsing queue entries, kicking the drain, producing local queue answers while offline, and marked the Phase 4 behavior “proposed/not built”; doc 03 said no client used `/v1/mcp` until Phase 4.
- After edits, a Python stale-claim scan across docs 02/03/04 passed. It found none of those stale claims and confirmed the server-owned tools, bounded `enqueue_file_snapshot`, acknowledgment-versus-delivery distinction, active shim client, and no local synthesized answer descriptions.
- Python `json.loads` parsed all three manifests; each reported version `3.4.1`. `git show HEAD:<manifest>` confirmed all three starting versions were `3.4.0`.
- `git diff --check` over the six owned documentation/manifest paths passed.

### Concern

The global `git diff --check` also sees concurrent Phase 4-03 changes outside this unit and currently reports `plugins/yakka/client/test_mcp.py:4: new blank line at EOF`. This unit did not modify that path. The docs and manifest scoped check passes; the phase runner should rerun the global check after Phase 4-03 settles.

Deviations: none. The unrelated pre-existing layout test was not run or investigated.
