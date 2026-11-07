# Brief: 2-01 — Session-start capture

Consumer: Plan 22 Phase 2. Owned paths are the Phase 2 surfaces named in `DESIGN.md`: `plugins/yakka/script/spool.sh`, `plugins/yakka/hooks/codex.json`, `plugins/yakka/hooks/hooks.json`, `plugins/yakka/hooks/cursor.json` (verify only), `packages/opencode-yakka-hooks/src/index.ts`, `plugins/yakka/client/yakka.py`, its tests, `packages/hooklog/tests/fixtures`, `docs/design/02`, `docs/design/05`, `CHANGELOG.md`, plugin version metadata, this plan's Phase 2 report and implementation record. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: Before committing, write `docs/plans/22-session-work-tagging/reports/2-01-session-start-capture.md` using `packages/yakka/catalogue/checks/execution-report.json`; include it in the commit.
Depends on: Phase 1.
Runs alongside: Nothing.
Budget: 18 files to read, about 500 lines to change, 12 tool turns. Past the budget, stop and report over budget.

## Required reading, in order

1. `docs/plans/22-session-work-tagging/DESIGN.md` — Domain: Action contract; Domain: Capture; Assumptions 7, 8, 25; Phase 2 outcome and surfaces.
2. `docs/plans/22-session-work-tagging/IMPLEMENTATION.md` — Phase 1 evidence and Carried.
3. `plugins/yakka/script/spool.sh` — queue envelope and hook invariants.
4. `plugins/yakka/client/yakka.py` — `_parse_file`, `Build`, config resolution.
5. `packages/opencode-yakka-hooks/src/index.ts` — session lifecycle recording.

## Goal

Capture the six `YAKKA_ACTION_*` values only at session start, queue them without client-side validation, and build the `session_action` fact through the existing drain. Malformed values must never change a hook or harness exit code.

## Contract

The authoritative environment table, formats, required fields, unset behavior, byte-length transport guard, non-validation rule and session-start events are in `DESIGN.md`, Domain: Capture and Domain: Action contract. Phase 2's specified test cases and four-harness probe are binding. The action server contract and accepted/rejected response are Phase 1's `/v1/actions` behavior. `YAKKA_ACTION_*` must not affect `YAKKA_ENDPOINT` / `YAKKA_KEY` config resolution.

## Changes

Implement the session-start-only queue capture for Claude, Codex, OpenCode and Cursor. Preserve other event payloads and capture behavior. Make queue encoding robust for quotes, backslashes, control characters, newlines and UTF-8 byte-boundary truncation. Teach the Python parser/fact builder to emit exactly one `session_action` fact for a tag-only action event, alongside existing facts when the normal session-start payload is present, and no action fact when no action is provided. Keep server validation authoritative. Add fixtures and tests for malformed/non-string action envelopes, exact and over-length values (including multibyte boundaries), config isolation, and normal capture. Record probe results and command for each harness. Do not run any live classification, egress or human review. If a real headless harness probe or server egress is required and is not safely runnable, add a `gate: ...` line to the phase result file naming what Cody must do.

### Keep untouched

Do not change the drain/network behavior, Phase 1 server logic, MCP tools, or any Plan 21/23/24 files or worktrees. `cursor.json` is verify-only unless a concrete Phase 2 defect is found and recorded. Do not make client-side vocabulary or semantic validation. Keep the hooks advisory and exit-zero.

## Done evidence

Identify the failing check before changing code and report output before and after.

- `python3 plugins/yakka/script/test_kick.py` → spool fixtures preserve JSON and always exit zero.
- `cd plugins/yakka/client && python3 -m unittest test_facts test_clientconfig` → action facts, no-action compatibility, malformed envelope, and config isolation pass.
- `cd packages/opencode-yakka-hooks && npm run test:hooks` → OpenCode session-start capture and length guard pass.
- `git diff --check` → clean.
- For each harness probe (`claude -p`, `codex exec`, `opencode run`, `cursor-agent -p`), record whether the hook/plugin runs and sees an exported test variable. Do not use a prompt/config that causes real classification or external egress. If that cannot be established safely, report the precise gate.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State changes, check output before/after, deviations, contract contradictions, and any probe gate. Keep all work in the owned paths.
