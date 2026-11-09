Run: Codex execute, harness-dispatched unit 1-01; session: hlaunch build on feat/23-llm-review-shadow; started 2026-11-09 05:55 UTC.

# Implementation

## Phase 2 — Review packet and prompt policy

### 2-01-review-packet-prompt

- Status: done; committed with this unit's report.
- Brief: `briefs/2-01-review-packet-prompt.md`.
- Report: `reports/2-01-review-packet-prompt.md`.
- Run: Codex execute, inline single-unit phase; started 2026-11-09.
- Built: added `packages/yakka/internal/review/{build.go,build_test.go,policy.json}`. The package revalidates the received diff hash, re-filters captures, constructs the deterministic role-first prompt, applies secret scans, derives the authoritative capture id, and exports embedded declaration/trial policy values. No provider, env, network, criteria resolver, persistence or MCP code was added.
- Checks: `prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review` passed (final run 0.486s); `git diff --check` passed. One initial assertion expected manifest insertion order; after correcting it to sorted order, the full suite passed.
- Deviations: none. Contradictions: none. Unfinished work and known problems: none.
- Brief feedback: `not delivered`; no stored version or queued artifact was available. Feedback was called by absolute path; the relative call resolved against the plugin cache and failed.
- Report feedback: `not delivered`; no stored version or queued artifact was available when called by absolute path.

### Phase 2 verification

The design outcome was checked through the fixture entry point `Build` → received-capture re-filtering → packet/prompt result. Tests establish byte-identical prompts and capture ids, fixed section order, stable criterion ids, lockfile and plan-run exclusion with manifest entries, retained docs, budget-driven whole-file truncation and `coverage: partial`, oversize criteria and delimiter refusals, secret refusal codes without matched bytes in errors, recomputed capture identity and diff-hash mismatch errors, and absence of network/environment imports. The package suite passed under the 8 GiB cap; `git diff --check` is clean. All unit artifacts and implementation are committed.

### Carried

None.

## Phase 1 — Local change capture

### 1-01-local-change-capture

- Status: done; committed with this unit's report.
- Brief: `briefs/1-01-local-change-capture.md`.
- Built the standalone `CaptureChange` API in `plugins/yakka/client/yakka.py`, with bounded diffs and omission manifests, ref validation and object-only range reads, stable diff hashes, checkout/worktree metadata, pre/post state checks with one retry, untracked policy, secret scanning, exclusion/filter/symlink/encoding/ignored/cap handling, fixed no-shell Git invocations, and no network access. Added 14 fixture tests in `plugins/yakka/client/test_capture.py`, including Python/Go secret-pattern parity.
- Updated the reader contract and safety rules in `docs/design/08-server-mcp-contract.md`; explicitly marked `change` registration as deferred to Phase 5. Bumped the Claude plugin manifest version to 3.4.2.
- Checks: baseline client suite 100 tests passed; unit report records the final client suite at 114 tests. Runner verification under the 8 GiB address-space cap, `prlimit --as=8589934592 -- python3 -m unittest test_capture test_secrets` from `plugins/yakka/client`, passed 23 tests. The 15 capture fixtures and 8 secrets tests include Python/Go name parity. Fixtures live inside this worktree; no `/tmp` path is used. `git show --check HEAD` and `git diff --check` passed. The initial helper-canary fixture failed because Git could run a configured clean filter during changed-path discovery; after disabling discovered clean filters before status and diff, the canary test passes and leaves no marker.
- Deviation: the brief names `plugins/yakka/plugin.json`, which does not exist; changed the existing `plugins/yakka/.claude-plugin/plugin.json` version field. This matches the design's request to bump plugin version metadata and changes no other plugin manifests.
- Contradictions: no behavioral contradiction with the cited Phase 1 outcome or capture/safety contract. The plugin manifest path mismatch above is the sole path discrepancy.
- Unfinished work: none. Known problems: none. No live provider calls, credentials, deploys, Fly or Wrangler commands, MCP registration, or MCP behavior changes were used.
- Runner feedback: brief and report both returned `delivered`, with Jev screening pass. Relative-path calls resolved against the plugin cache and failed; absolute repository paths returned these results.

### Phase 1 verification

The design outcome is verified through the fixture entry point `CaptureChange` → local Git capture → returned diff and manifest. Fixtures cover combined and staged diffs, ignored and untracked policy, linked and detached worktrees, range resolution and merge-base behavior, invalid refs, stable hashes, checkout identity, mutation detection, withheld secrets and unsafe files, file/total caps, declaration-supplied exclusions, canary helpers, fixed no-shell subprocesses, no sockets, and Go/Python secret-pattern parity. The runner reran the capture and parity tests under the 8 GiB cap; all 23 tests passed. The capture implementation remains unregistered with MCP, as Phase 5 owns that wiring.

### Carried

None.
