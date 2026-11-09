# Brief: 1-01 — Local change capture

Consumer: Plan 23 Phase 2 review-packet worker and Phase 6 trial-manifest worker.
Owned paths: `plugins/yakka/client/yakka.py`, `plugins/yakka/client/test_capture.py`, `plugins/yakka/client/test_secrets.py`, `docs/design/08-server-mcp-contract.md`, and `plugins/yakka/plugin.json`. Touch nothing else except this brief's report and the phase implementation record.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: Before committing, write `docs/plans/23-llm-review-shadow/reports/1-01-local-change-capture.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: nothing.
Budget: 8 files to read, about 700 lines to change, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Intent, Architectural Implications, settled Change capture and Safety design decisions, and Phase 1 outcome and surfaces.
2. `plugins/yakka/client/yakka.py` — client subprocess and MCP reader patterns; do not wire this reader into MCP before Phase 5.
3. `plugins/yakka/client/test_secrets.py` — Python secret pattern API and test style.
4. `packages/yakka/internal/secrets/secrets.go` — canonical Go pattern names exposed by `Patterns()`.
5. `docs/design/08-server-mcp-contract.md` — declared-context table and reader safety rules.

## Goal

Implement the local capture function that produces a bounded, deterministic change capture and a disclosure-safe omission manifest for later review and historical-trial phases. It remains unwired to MCP until Phase 5.

## Contract

Binding: `docs/plans/23-llm-review-shadow/DESIGN.md`, “Phase 1 — Local change capture” (the complete Outcome and Surfaces), together with its settled “Change capture”, “Safety”, and “Python mirror” decisions in the architecture/contracts sections. Satisfy the outcome as written: uncommitted and staged views; safe untracked inclusion; range resolution and object-only reading; validated arguments and structured errors; stable diff hash; pre/post state protection; checkout identity; linked worktree metadata; fixed no-shell subprocess arrays; exclusion, secret, filter-driver, encoding, symlink, ignored, and cap manifest reasons; no captured content for withheld paths; matching Go/Python secret-pattern names; and no network access.

## Changes

- Add the Phase 1 capture API and supporting local reader code to `yakka.py`; keep it independent of MCP registration and environment configuration.
- Add fixture-based tests beside `test_secrets.py` covering each observable in the Phase 1 Outcome, including canary external diff/textconv/fsmonitor/filter drivers, staged-plus-working-tree net change, staged-only, untracked policy, range/object-only mode, invalid revisions/arguments, deterministic hash, changed-during-capture, wrong checkout/no project directory, exclusions/secrets/size and total caps, subprocess arrays without shell, and no network sockets.
- Add a test that compares Python secret-pattern names to the canonical Go `secrets.Patterns()` names. Do not duplicate or alter the Go pattern set.
- Update the declared-context table and safety rules in `docs/design/08-server-mcp-contract.md` for this reader, without registering it in the shim or changing server behavior.
- Bump only the plugin version metadata required by this client capability.
- Preserve existing client behavior and tests. Do not add provider calls, credentials, deploy steps, MCP wiring, review behavior, or trial tooling.

### Keep untouched

Do not edit Go packages or tests, stable docs other than `docs/design/08-server-mcp-contract.md`, other plan folders, MCP declarations/registration, or any files outside the owned paths and required report/implementation record. Do not read secrets or access external providers.

## Done evidence

Identify or write the failing checks before changing code and report their output before and after.

- `python3 -m unittest discover -s plugins/yakka/client -p 'test_*.py'` → pass, including new capture cases and existing client tests.
- `python3 -m unittest plugins.yakka.client.test_secrets` (or the repository-appropriate invocation) → Python and Go pattern-name sets match.
- The capture test suite proves every Phase 1 Outcome behavior using temporary fixture repositories/worktrees and injected canaries, not live data or external services.
- `git diff --check` → clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, exact check commands and outputs, any deviation and why, any contradiction between this brief and cited contracts, and any unfinished work specific enough for Phase 2 to act on. State explicitly if no deviations, contradictions, unfinished work, or known problems.
