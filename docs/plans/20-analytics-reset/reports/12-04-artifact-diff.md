# 12-04 Artifact diff handoff

Status: **over budget**. The requested work and evidence are complete, but this unit exceeded its 35-tool-turn budget.

## Done evidence

- Added a dependency-free Myers line diff and a browser reader comparison using only `fetchArtifactText`. Output is deterministic and text-node-only, with hunk headers, `+`/`-`/space prefixes, summary counts, and an announced per-side ceiling.
- The exact fixture pair is `context line\nchanged old\nremoved line\n` → `context line\nchanged new\nadded line` (right side has no final newline). It yields 1 unchanged, 2 added, 2 removed. A single final newline is normalized away; empty bodies yield zero lines.
- Ceiling checks: UTF-8 byte lengths 262,143 and 262,144 pass; 262,145 declines. 2,000 lines pass; 2,001 declines with the side, actual bytes and line count named. The browser fixture generates the oversized 2,001-line body programmatically.
- Before: `node --test tests/plans-artifacts/artifact-diff.test.mjs` → `Could not find 'tests/plans-artifacts/artifact-diff.test.mjs'`.
- After: `node --test tests/plans-artifacts/artifact-diff.test.mjs` → 6 passed, 0 failed, 0 skipped; Chromium checks ran. The specified `NODE_PATH`/`PUBLIC_CANVAS_TEST_MODE=true` serialized invocation also passed 6/6, including `maxInFlight <= 4`.
- `tests/plans-artifacts/artifact-reader.test.mjs` → 15 passed, 0 failed.
- `tests/workspace/*.test.mjs` with `--test-concurrency=1` → 72 passed, 0 failed, 0 skipped.
- `tests/scatter-sessions/*.test.mjs` with `--test-concurrency=1` → 42 passed, 0 failed, 0 skipped.
- `git diff --check` → clean.

## Deviations, contradictions and follow-up

- The Chromium error-state case permits only expected 404 resource console messages; page errors and CSP violations must remain empty. Chromium logs a console error for the fixture's required `content_unavailable` 404, so strict zero-console-error checking would reject the expected contract response.
- The brief both says an `other` path has no diff control and says the control is disabled when the kind is not stored. The reader uses a disabled control with the named unavailable reason; it never sends a diff request for `other`. CONTRACTS 17.4 agrees that only design, brief and report content is served and does not prescribe this control detail. No brief/contract contradiction was found.
- The budget clause asks for a handoff in `IMPLEMENTATION.md`, which is outside this unit's explicit owned paths. I did not edit that file; this report records the over-budget state and completed evidence instead.
- No unfinished diff work or other known problems. No design/contract amendments are needed.
