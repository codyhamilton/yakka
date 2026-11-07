status: done with concerns
reason: Local implementation and fake-backed checks pass. Runtime hook execution and environment forwarding remain unverified; documented as a per-harness limit until safe probes are available.

# Phase 2 — Session-start capture

Implemented session-start-only action capture in `spool.sh` and OpenCode's `session.created` path. The Codex hook now names `SessionStart`; Claude and Cursor already had session-start registrations, with Cursor's `cursor.json` verified unchanged. Queue values remain unvalidated, control characters are stripped, JSON quoting is preserved, and over-length values stop at the first UTF-8 character boundary at or beyond byte 257. Python parsing tolerates malformed/non-string action envelopes and replacement UTF-8, adds one `session_action` beside normal hook facts, and emits only the action for a tag-only queue file. Added fixture coverage, config-isolation tests, docs, changelog and plugin version bumps.

## Checks

Before changes, `python3 plugins/yakka/script/test_kick.py` passed (6 tests). The brief's client command failed because `test_config` does not exist (`ModuleNotFoundError`); `npm test` failed because no `test` script exists. After changes, using the actual names:

- `python3 plugins/yakka/script/test_kick.py` — 7 tests passed, including quoted/backslash values, 10 KB input, UTF-8 boundary truncation, and exit zero.
- `cd plugins/yakka/client && python3 -m unittest test_facts test_clientconfig` — 22 tests passed, including fixtures, malformed values, tag-only facts, no-action compatibility and config isolation.
- `cd packages/opencode-yakka-hooks && npm run test:hooks` — 11 tests passed, including a one-time `session.created` tag and byte guard.
- `git diff --check` — clean.

## Harness probes and documented limits

No harness was launched: the required headless commands can run prompts that classify or egress, which this execution is prohibited from doing. No live or real server egress was made. The following per-harness limits are recorded under Design Assumption 8: the implementation captures action tags in its local hook/plugin path, but runtime hook/plugin execution and visibility of the launching process's environment are not established. Do not treat any harness as runtime-verified or rely on launch-time tags in it until a safe, non-classifying and non-egress probe records those observations. No contingency channel is approved.

| Harness | Required command | Hook/env observation |
|---|---|---|
| Claude Code | `claude -p` | Documented limit: runtime hook execution and exported-variable visibility unverified; no runtime support claim. |
| Codex | `codex exec` | Documented limit: runtime hook execution and exported-variable visibility unverified; no runtime support claim. |
| OpenCode | `opencode run` | Documented limit: runtime plugin execution and exported-variable visibility unverified; no runtime support claim. |
| Cursor | `cursor-agent -p` | Documented limit: runtime hook execution and exported-variable visibility unverified; no runtime support claim. |

gate: Before relying on session-start tags from any harness, record hook/plugin execution and exported-variable visibility with a safe, non-classifying and non-egress headless probe; verify Phase 1 projection if that can be done without real egress.

Departure: substituted the repository's actual test names for the two incorrect brief commands; the brief is being corrected. The unrelated layout-test failure noted in the design was not rerun or investigated. No other unfinished implementation work is known.
