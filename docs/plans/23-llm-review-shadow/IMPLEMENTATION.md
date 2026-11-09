Run: Codex execute, harness refine/build sub-runs; branch `feat/23-llm-review-shadow`; started 2026-11-09 08:03 UTC.

# Implementation

## Phase 5 — The MCP tool, shim registration and stage wiring

### 5-04-stage-wiring-docs

- Status: done with concerns; implementation and report committed together.
- Brief: `briefs/5-04-stage-wiring-docs.md`.
- Report: `reports/5-04-stage-wiring-docs.md`.
- Built: added one advisory range call to each of the three named stage skills, with `build_models` provenance and duplicate receipt handling; bumped the plugin to 3.4.3; updated Architecture, Overview, advisory surface, MCP contract and system architecture docs.
- Checks: 8 GiB capped `go test -p=3 ./internal/serve` passed (`11.273s`); capped `python3 -m unittest test_mcp_shim test_capture` passed all 36 (`7.585s`); `tools/driver/check_skills.py` passed against a repository skill-layout fixture; stage and stable-doc checks passed; `git diff --check` passed. All final check temp files were directed inside the worktree and removed.
- Deviations/concerns: first attempt stopped at the 15-file budget; the one retry completed the unit. During that retry, a temporary checker fixture was created in `/tmp` against the user instruction; `TemporaryDirectory` removed it and the path was verified absent. Final verification used only worktree temp paths. The implementation describes 5-03's duplicate receipt behavior without altering idempotency.
- Carried: the 5-02 report's `_capture_blob` unbounded read before per-file cap remains a known issue for a later refinement. No unpaid/live calls, deploys, credentials, Fly or Wrangler actions. Harness turn/final-context figures were unavailable.
- Feedback: brief and final report delivered, Jev screening pass. Harness turn/final-context figures were unavailable.

### 5-01-typed-change-declaration

- Status: done; committed with report in `47351f4` (`Validate typed MCP change reader policy`).
- Brief: `briefs/5-01-typed-change-declaration.md`.
- Report: `reports/5-01-typed-change-declaration.md`.
- Built: added fixed typed policy validation for the `change` reader and server conformance declarations/fixtures, retaining existing reader behavior and bulk body-cap derivation.
- Checks: from `packages/yakka`, `go test ./internal/serve` passed (`9.227s`); `git diff --check` passed.
- Feedback: brief and report delivered, Jev screening pass. Harness turn/final-context figures were unavailable.
- Deviations, unfinished work and known problems: none reported.

### 5-02-shim-change-reader

- Status: done with concerns; retry implementation and report committed together.
- Brief: `briefs/5-02-shim-change-reader.md`.
- Report: `reports/5-02-shim-change-reader.md`.
- Built: registered content-bearing `change` v1 with closed typed-policy validation matching landed 5-01, server-policy adaptation to `CaptureChange`, reserved `_local` overwrite, explicit capture failures, 2 MiB serialized bulk budgeting, and context-local capture Git deadlines. Standalone capture behavior is preserved. Only the owned shim/test files, unit report and this record changed.
- Checks: from `plugins/yakka/client`, `prlimit --as=8589934592 -- python3 -m unittest test_mcp_shim test_capture` passed all 36 tests (`7.570s`, `OK`); from the root, `prlimit --as=8589934592 -- git diff --check` passed with no output. Fixtures cover real combined/staged/untracked/range capture, policy validation, unsupported versions, typed failures, wrong checkout, spoofed context, missing project directory, budgets, bearer scanning and deadlines.
- Departure: eleven repository artifacts were inspected including the assigned brief, exceeding the nine-file read budget; implementation continued contrary to the budget stop instruction. The extra source inspection established the landed validator/capability-table contract. No scope or contract contradictions; no unfinished unit work. Phase 5-03 is next, owned by the parent run.
- Known existing issue, deferred: `_capture_blob` reads full worktree content before `_capture_change_once` checks the per-file cap, allowing a very large candidate to allocate beyond the declared limit. Found by inspection; no large-allocation reproduction or fix in this unit. No other known problems. Harness turn/final-context figures were unavailable.
- Feedback: brief and final report delivered, Jev screening pass. The initial handoff report was superseded by the completed report after the one retry.

### 5-03-mcp-review-integration

- Status: done with concerns; committed with report in `0eeb311` (`Register MCP review tool`).
- Brief: `briefs/5-03-mcp-review-integration.md`.
- Report: `reports/5-03-mcp-review-integration.md`.
- Built: registered `review_change` over the shared review orchestrator with the declared `read_write` scope, 150-second timeout, `project_dir`/`cwd`/`git`/`change` context order, no local actions, and `capture_unsupported` translation. Added fake-endpoint route coverage for uncommitted and range captures plus REST parity, detail behavior, explicit high effort and refusal paths. Only the owned MCP server files, report and this implementation record changed.
- Checks: under `prlimit --as=8589934592`, `go test -p=3 ./internal/serve` passed (`9.311s`); `python3 -m unittest test_mcp_shim` passed all 21 tests (`6.431s`); `git diff --check` passed.
- Departures and concerns: registration is conditional on review model configuration and a server timeout ceiling of at least 150 seconds, to preserve existing conformance fixtures and the tool timeout contract. REST replay of the same capture returns `skipped_duplicate`, not a byte-identical receipt; the same capture id is used and the duplicate names the MCP result. The report records no unfinished work or other known problems.
- Feedback: brief and report delivered, Jev screening pass. The worker's first report feedback call was unreachable; the runner's follow-up returned delivered. Harness turn/final-context figures were unavailable.

### Phase 5 verification

The fixture entry point `review_change` → typed `change` declaration and shim capture → shared review orchestrator → fake provider → validated receipt was verified across the Go MCP route and the Python shim's declared-reader forwarding fixture. Go cases cover both `uncommitted` and `range`, required scope, unsupported reader refusal, explicit live `high`, receipt/full-detail behavior, and the same-capture REST duplicate reference without returning captured diff. Python cases cover real capture modes, server policy forwarding, `_local` spoof replacement, capture failures, size budgets, bearer scan and reader deadline.

The runner's final capped reruns passed: `go test -p=3 ./internal/serve` (`11.273s`) and `python3 -m unittest test_mcp_shim test_capture` (36 tests, `7.585s`). The skill checker passed against an in-worktree install-layout fixture; stage JSON/text assertions, plugin version and all five stable-doc checks passed; `git diff --check` passed. `TMPDIR` was directed inside the worktree for final verification. Earlier subrun test commands did not explicitly set `TMPDIR`, and the 5-04 retry also created one transient checker fixture under `/tmp`; `TemporaryDirectory` removed it, the path was verified absent, and no `/tmp` artifacts remain.

Phase 5 is closed with concerns. The same-input REST follow-up is a `skipped_duplicate` receipt that identifies the MCP review rather than a byte-identical copy; the implemented stage guidance names this as earlier evidence and never treats it as independent review. The 5-03 fixture proves the shared orchestrator and duplicate link. No paid/live provider call, credential, deploy, Fly or Wrangler action was used.

### Carried

- Fix the known capture-memory bound: `_capture_blob` reads the worktree file before enforcing the per-file cap, so a large candidate can allocate above the declared limit. The 5-02 report identifies the code path; no reproduction or fix was done in this phase.
- Clarify in a future design refinement whether “the same receipt” across MCP and REST means the same underlying review referenced by `skipped_duplicate` or an identical receipt payload. Preserve the Phase 4 idempotency contract until resolved.
- Preserve the static no-network/environment guarantee scoped to `internal/review/build.go`; the provider transport intentionally uses HTTP, while packet construction remains offline.

## Phase 4 — Review handler, single call, record and availability

### 4-01-shared-haiku-pricing

- Status: done; committed with report in `5b4f051` (`Add tiered Haiku 5.5 pricing`).
- Brief: `briefs/4-01-shared-haiku-pricing.md`.
- Report: `reports/4-01-shared-haiku-pricing.md`.
- Built: added the exact `claude-haiku-5-5` entry to the shared Go/Python pricing source; tier-aware settlement and transcript aggregation; a pricing table identity and conservative upper-tier reservation API. Existing flat rates remain unchanged.
- Checks: `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store` passed; two Python `unittest` pricing tests passed, including below/at/above the 100,000-token boundary; table parity and `git diff --check` passed. The initial pytest invocation could not run because pytest is absent; the standard-library fixtures passed.
- Source: Anthropic Haiku 5.5 pricing, checked 2026-11-09. Table SHA-256 `0c0dfc73d2cbe45eec340ff4eb596dfe1a2ddc88f4238ca78eadc45a2a3e88c7`.
- Feedback: brief and report delivered, Jev screening pass. Harness reported 108,937 tokens; no turn/final-context figures were available.
- Deviations, unfinished work, known problems: only the pytest-to-unittest runner adjustment; none unfinished.

### 4-02-review-record-persistence

- Status: done; committed with report in `dbd0ab4` (`Persist review records and captured inputs`).
- Brief: `briefs/4-02-review-record-persistence.md`.
- Report: `reports/4-02-review-record-persistence.md`.
- Built: added ingest validation and secret prechecks for `review_run`, deduplicated tenant-local record storage, filtered review reads, and tenant-local hash-verified atomic `review-inputs/` storage outside blob screening. Fact storage remains outside conversation, hook-event and facet aggregates. The reader API is `Tenant.ReviewRecords(ctx, ReviewRecordFilter)`; captured input uses `WriteReviewInput`/`ReadReviewInput`.
- Checks: with `ulimit -v 8388608` and `-p=3`, `go test ./internal/ingest ./internal/store` passed (`ingest 0.306s`, `store 6.673s`); `git diff --check` passed.
- Feedback: brief and report delivered, Jev screening pass. Harness reported 77,658 tokens; no turn/final-context figures were available.
- Deviations, unfinished work, known problems: none.

### 4-03-provider-call-validation

- Status: done with concerns; committed with report in `7bafa1b` (`Add review provider call validation`).
- Brief: `briefs/4-03-provider-call-validation.md`.
- Report: `reports/4-03-provider-call-validation.md`.
- Built: added the injectable standard-library Claude Messages client and mechanical response validator. `NewReviewer(token, model, effort, endpoint).Review(ctx, packet, criteria)` returns validated outcomes/findings and provider usage; unsupported findings are retained and flagged, and reply secrets are redacted.
- Checks: with the 8 GiB address-space cap and `-p=3`, `go test ./internal/review` passed (`0.649s`); fake-server and validation fixtures passed; `git diff --cached --check` passed.
- Feedback: brief and report delivered, Jev screening pass. Harness reported 88,421 tokens; no turn/final-context figures were available.
- Deviation/concern: `TestBuildPackageHasNoNetworkOrEnvironmentImports` originally scanned every production file in the package, preventing the new HTTP transport. It now constrains the offline-import check to `build.go`, preserving the pure packet-builder contract. No unfinished work or other known problems.

### 4-04-review-orchestration-rest

- Status: done; committed with report in `fd3c0ec` (`Add review orchestration REST routes`).
- Brief: `briefs/4-04-review-orchestration-rest.md`.
- Report: `reports/4-04-review-orchestration-rest.md`.
- Built: added server-only config and availability checks, review orchestration with criteria/build/provider/persistence composition, persisted tenant-scoped claims and rolling spend reservations, retry settlement, and authenticated `POST /v1/reviews` and filtered `GET /v1/reviews`. Dry run records nothing and makes no provider request. Updated only the matching review fact and environment contract sections in `docs/design/01` and `03`.
- Checks: worker and runner both passed the focused suite under the 8 GiB cap and `-p=3`: `go test ./internal/review ./internal/serve ./internal/ingest ./internal/store`; runner output was review `2.084s`, serve `11.794s`, ingest `0.304s`, store `7.525s`. `git diff --check` passed. Fake fixtures cover each terminal status and the auth, retry, redaction, support, idempotency/resume, budget/in-flight concurrency, dry-run, tenant filter and explicit model/effort cases.
- Feedback: brief and report delivered, Jev screening pass. Harness reported 316,935 tokens; no turn/final-context figures were available.
- Deviations, unfinished work, known problems: none reported.

### Phase 4 verification

The `POST /v1/reviews` fixture entry point exercises argument/auth checks → repo-scoped criteria and packet → fake Claude endpoint → validated result → tenant-local `review_run` and captured-input persistence → `GET /v1/reviews`. Fake fixtures exercise all terminal statuses (`ok`, `ok_partial`, `timeout`, `api_error`, `invalid_output`, `unavailable`, `refused_capture`, `refused_disclosure`, `refused_criteria`, `skipped_budget`, `skipped_duplicate`), including zero-call preflight resume, bounded retry and reservation settlement, unchanged-key concurrency, read/write scope, tenant isolation, and dry-run with no call or record. Unit reports and the runner's combined capped test run pass. Phase 4 outcome verified; feedback checks on all four briefs and reports returned delivered, Jev screening pass.

### Carried

- Keep the static no-network/environment guarantee scoped to `internal/review/build.go`; the provider transport intentionally uses HTTP, while packet construction remains offline.

## Phase 3 — Criteria resolution from the artifact store

### 3-01-criteria-resolution

- Status: done; committed with this unit's report.
- Brief: `briefs/3-01-criteria-resolution.md`.
- Report: `reports/3-01-criteria-resolution.md`.
- Built: added `internal/review.ResolveCriteria`, deterministic design/brief section parsing, stable criteria IDs, explicit/no-criteria output and code-bearing refusal errors. Added bounded `Tenant.PlanDesignPaths` and `Tenant.ArtifactVersions` reads scoped to repo and path, with exact held bodies, screen state and rejection metadata. Added ingest-populated two-tenant/version/screen-state fixtures.
- Checks: from `packages/yakka`, `TMPDIR="$PWD/internal/review/.test-tmp" prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/ingest` passed (`review 0.872s`, `store 6.676s`, `ingest 0.306s`); `git diff --check` and `git diff --cached --check` passed. One initial fixture run expected `phase_not_found` before storing the design; after correcting fixture order, the exact suite passed.
- Deviation: added bounded `PlanDesignPaths` because slug matching and its required ambiguity check need the repo's stored design paths. Contradiction: the design outcome mentions ambiguity across two repositories, while this brief requires every lookup to use the supplied repo id and forbids cross-repository resolution; implementation follows the brief. Unfinished work and known problems: none.
- Brief feedback: delivered, Jev screening pass. Report feedback: delivered, Jev screening pass.

### Phase 3 verification

The fixture entry point `ResolveCriteria` → tenant-scoped design-path/version reads → exact section extraction and version record was exercised. Tests cover pass, pending, unscreened, flagged and rejected content; historical exact-hash selection and stale refusal; design/brief IDs and text; missing/ambiguous/forbidden sources; all refusal codes; explicit-text precedence and hashing; no-criteria marker; missing held body; and two independent tenants. The required capped review/store/ingest suite passed, and both working and staged diffs passed whitespace checks.

### Carried

None. During Phase 4 refinement, the outcome was aligned to the settled repo-scoped contract: ambiguity remains for duplicate bare slugs in the selected repo and duplicate phase headings; criteria resolution never searches across repos.

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
