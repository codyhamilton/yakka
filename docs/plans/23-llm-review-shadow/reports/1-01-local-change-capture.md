# 1-01 Local change capture — execution report

Status: done

## Done against the brief

- Added standalone `CaptureChange` and local Git helpers in `plugins/yakka/client/yakka.py`. It captures combined and staged changes, optionally includes safe untracked files, resolves range refs to commit IDs, reads range content from objects, hashes exact returned diff bytes, reports checkout/worktree state, and checks pre/post state with one retry.
- Added bounded omission handling for declared exclusions, lockfiles, secrets in added or removed lines, filter drivers, invalid UTF-8, symlinks, ignored and default-excluded untracked paths, per-file limits, total limits and file-count limits. Withheld content is absent from `diff` and the manifest stores omission metadata only.
- Added 14 fixture tests in `plugins/yakka/client/test_capture.py`, covering staged plus working-tree net changes, staged-only, untracked policy, range/object reads and invalid refs, deterministic hashes, state changes, checkout identity, linked worktrees, secrets/exclusions/caps, Git helper canaries, subprocess arrays, no sockets, and Python/Go secret-pattern name parity.
- Updated the declared-context and safety contract in `docs/design/08-server-mcp-contract.md`. The text states that `change` registration is deferred to Phase 5; no shim or server registration was added. Bumped the existing Claude plugin manifest version from 3.4.1 to 3.4.2.

## Checks

Before implementation:

- `python3 -m unittest discover -s plugins/yakka/client -p 'test_*.py'` — 100 tests passed (`OK`).
- `python3 -m unittest test_secrets` from `plugins/yakka/client` — 8 tests passed (`OK`).

During implementation, the helper-canary test initially failed because changed-path discovery could invoke a repository clean filter. The reader now discovers filter attributes first and disables those clean commands before status and diff operations; the canary test passes and its marker is absent.

After implementation:

- `python3 -m unittest discover -s plugins/yakka/client -p 'test_*.py'` — 114 tests passed (`OK`).
- `python3 -m unittest test_secrets` from `plugins/yakka/client` — 8 tests passed (`OK`), including comparison to `secrets.Patterns()`.
- `python3 -m unittest test_capture` from `plugins/yakka/client` — 14 tests passed (`OK`).
- `git diff --check` — clean (exit 0).

## Deviations, contradictions, unfinished work, problems

- Deviation: the brief lists `plugins/yakka/plugin.json`, but that path is absent. The existing manifest is `plugins/yakka/.claude-plugin/plugin.json`; only its version was bumped. The design asks for the plugin version metadata and does not specify a manifest path.
- Contradictions with cited contracts: none beyond the manifest path mismatch.
- Unfinished work: none.
- Known problems: none.
- No provider calls, credentials, network sockets, deployments, Fly or Wrangler commands, or MCP wiring were used.
