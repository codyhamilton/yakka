status: closed
reason: Phase 2 implementation and fake-backed checks pass; four live harness probes remain gated for Cody.

# Phase 2 — Session-start capture

Implemented session-start-only action capture in `spool.sh` and OpenCode's `session.created` path. The Codex hook now names `SessionStart`; Claude and Cursor already had session-start registrations, with Cursor's `cursor.json` verified unchanged. Queue values remain unvalidated, control characters are stripped, JSON quoting is preserved, and over-length values stop at the first UTF-8 character boundary at or beyond byte 257. Python parsing tolerates malformed/non-string action envelopes and replacement UTF-8, adds one `session_action` beside normal hook facts, and emits only the action for a tag-only queue file. Added fixture coverage, config-isolation tests, docs, changelog and plugin version bumps.

## Checks

Before changes, `python3 plugins/yakka/script/test_kick.py` passed (6 tests). The brief's client command failed because `test_config` does not exist (`ModuleNotFoundError`); `npm test` failed because no `test` script exists. After changes, using the actual names:

- `python3 plugins/yakka/script/test_kick.py` — 7 tests passed, including quoted/backslash values, 10 KB input, UTF-8 boundary truncation, and exit zero.
- `cd plugins/yakka/client && python3 -m unittest test_facts test_clientconfig` — 22 tests passed, including fixtures, malformed values, tag-only facts, no-action compatibility and config isolation.
- `cd packages/opencode-yakka-hooks && npm run test:hooks` — 11 tests passed, including a one-time `session.created` tag and byte guard.
- `git diff --check` — clean.

## Harness probes and gate

No harness was launched: the required headless commands can run prompts that classify or egress, which this execution is prohibited from doing. No live or real server egress was made.

| Harness | Required command | Hook/env observation |
|---|---|---|
| Claude Code | `claude -p` | Not run; unverified |
| Codex | `codex exec` | Not run; unverified |
| OpenCode | `opencode run` | Not run; unverified |
| Cursor | `cursor-agent -p` | Not run; unverified |

gate: Cody must run or authorize a safe, non-classifying and non-egress headless probe for `claude -p`, `codex exec`, `opencode run`, and `cursor-agent -p`, recording hook execution and exported-variable visibility; then verify Phase 1 action projection for each harness if that can be done without real egress.

Departure: substituted the repository's actual test names for the two incorrect brief commands; the brief is being corrected. The unrelated layout-test failure noted in the design was not rerun or investigated. No other unfinished implementation work is known.
