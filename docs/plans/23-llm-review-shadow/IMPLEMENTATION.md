Run: Codex execute, harness-dispatched unit 1-01; session: hlaunch build on feat/23-llm-review-shadow; started 2026-11-09 05:55 UTC.

# Implementation

## Phase 1 — Local change capture

### 1-01-local-change-capture

- Status: done; committed with this unit's report.
- Brief: `briefs/1-01-local-change-capture.md`.
- Built the standalone `CaptureChange` API in `plugins/yakka/client/yakka.py`, with bounded diffs and omission manifests, ref validation and object-only range reads, stable diff hashes, checkout/worktree metadata, pre/post state checks with one retry, untracked policy, secret scanning, exclusion/filter/symlink/encoding/ignored/cap handling, fixed no-shell Git invocations, and no network access. Added 14 fixture tests in `plugins/yakka/client/test_capture.py`, including Python/Go secret-pattern parity.
- Updated the reader contract and safety rules in `docs/design/08-server-mcp-contract.md`; explicitly marked `change` registration as deferred to Phase 5. Bumped the Claude plugin manifest version to 3.4.2.
- Checks: baseline client suite 100 tests passed; final client suite 114 tests passed. `python3 -m unittest test_secrets` from `plugins/yakka/client` passed 8 tests. `git diff --check` passed. The initial helper-canary fixture failed because Git could run a configured clean filter during changed-path discovery; after disabling discovered clean filters before status and diff, the final capture suite passed 14 tests and left no canary marker.
- Deviation: the brief names `plugins/yakka/plugin.json`, which does not exist; changed the existing `plugins/yakka/.claude-plugin/plugin.json` version field. This matches the design's request to bump plugin version metadata and changes no other plugin manifests.
- Contradictions: no behavioral contradiction with the cited Phase 1 outcome or capture/safety contract. The plugin manifest path mismatch above is the sole path discrepancy.
- Unfinished work: none. Known problems: none. No live provider calls, credentials, deploys, Fly or Wrangler commands, MCP registration, or MCP behavior changes were used.
