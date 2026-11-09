Run: Codex execute, harness-dispatched unit 3-01; session: hlaunch build on feat/23-llm-review-shadow; started 2026-11-09 06:33 UTC.

# Implementation

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

- During Phase 4 refinement, clarify whether the design's two-repository ambiguity case applies only when no captured `repo_id` exists; Phase 3 keeps all reads scoped to the supplied repository.

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
