# 2-01 Review packet and prompt policy — execution report

Status: done

## Done against the brief

- Added `packages/yakka/internal/review` with a pure `Build` entry point, input/result types, and embedded `policy.json`. The policy exposes prompt/exclusion versions, 400,000-character packet and 60,000-character per-file caps, Phase 1 reader values (256 KiB/file, 2 MiB total, 200 files, 20 context lines), exclusions, and the code/tests/config/docs truncation order.
- `Build` checks the transport `diff_sha256`, derives file chunks from received unified diff bytes, applies server-side lockfile/generated/plan-run-artifact exclusions, computes omission counts and hashes, truncates whole files deterministically, and emits the fixed ROLE → OUTPUT CONTRACT → CRITERIA → COVERAGE SUMMARY → UNTRUSTED CONTEXT prompt. Criteria ids and manifest entries are sorted. `capture_id` hashes canonical filtered file paths/states/chunk hashes, repo and range identity, and embedded policy hash.
- Criteria, manifest metadata and assembled included context are checked with `internal/secrets`. Refusals expose only a code and pattern name. The package imports neither network nor environment packages; a Go AST fixture asserts this.
- Fixture tests cover deterministic prompt and identity, section order and omitted sentinels, lockfile and plan-artifact filtering, docs retention, whole-file truncation and partial coverage, oversize criteria, delimiter namespace refusal, secret refusals, capture hash validation, policy values, and no network/environment imports.

## Checks

- `prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review` — passed; final output `ok .../internal/review 0.486s`.
- `git diff --check` — clean (exit 0).
- An earlier test run failed only because the test expected insertion order while the implementation sorts manifest entries by path. The assertion was corrected to the deterministic order; the full package suite then passed.

## Deviations, contradictions, unfinished work, problems

- Deviations: none from the brief or cited Phase 2 outcome.
- Contradictions: none.
- Unfinished work: none for Phase 2. Phase 3 can consume the exported `Values`, `Capture`, `Criterion`, `Input`, and `Build` API; criteria resolution and provider calls remain in their designed later phases.
- Known problems: none.
- No credentials, environment configuration, provider calls, deployment, Fly, Wrangler, or paid/live steps were used.
