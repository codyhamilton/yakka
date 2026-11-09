# Brief: 2-01 — Review packet and prompt policy

Consumer: Plan 23 Phase 3 criteria resolver and Phase 4 review handler; Phase 5 MCP declaration and Phase 6 trial manifest also consume the embedded policy values.
Owned paths: `packages/yakka/internal/review/`, `packages/yakka/internal/secrets/` only for using its existing API (do not modify it), tests beside the new package, and this brief's report plus `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md`. Touch no other paths.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. The phase-closing record gets its own commit with `Yakka-Phase: 23-llm-review-shadow:2`.
Report: Before the implementation commit, write `docs/plans/23-llm-review-shadow/reports/2-01-review-packet-prompt.md`, using the rubric in `packages/yakka/catalogue/checks/execution-report.json`, and include it in the implementation commit.
Depends on: Phase 1 local `CaptureChange` implementation (`plugins/yakka/client/yakka.py`); this package accepts its canonical capture representation but does not import the Python client.
Runs alongside: nothing; this is the only unit in Phase 2.
Budget: one package, about 8 files to read, about 700 lines to change, 30 tool turns. Past the budget, record a handoff in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — the “Review packet” contract, prompt policy, capture identity, Phase 2 outcome and surfaces.
2. `docs/plans/23-llm-review-shadow/briefs/1-01-local-change-capture.md` and `reports/1-01-local-change-capture.md` — capture fields, canonical hashing, and Phase 1 deviations.
3. `plugins/yakka/client/yakka.py` — `CaptureChange` output and policy-compatible capture representation.
4. `packages/yakka/internal/secrets/secrets.go` — existing secret scan and redaction API; call it without changing it.
5. `packages/yakka/internal/keys/keys.go` — artifact/plan path classification conventions where available.

## Goal

Implement `packages/yakka/internal/review` as a pure, deterministic builder for a review packet and role-first prompt. It re-filters and bounds received capture data using one embedded, versioned policy values file shared later by the MCP declaration and trial manifest. This phase does not resolve stored criteria or call a provider.

## Contract

Binding: `docs/plans/23-llm-review-shadow/DESIGN.md`, “Review packet” and “Capture identity” contracts plus “Phase 2 — Review packet and prompt policy” Outcome and Surfaces. In particular:

- `Build` is pure; identical canonical capture, criteria and policy produce byte-identical packet and prompt.
- Prompt section order is exactly ROLE, OUTPUT CONTRACT, CRITERIA (stable ids), coverage summary, UNTRUSTED CONTEXT. Role and the full result schema precede repository-derived content. No build model, session, tenant, user or commit message appears.
- Server-side filtering moves lockfile hunks and plan run artifacts (`REVIEW.md`, `IMPLEMENTATION.md`, `QA.md`, `reports/`, `briefs/remediation-*`) into the omission manifest. Use the design’s policy values, versions, and documented whole-file truncation order; over-budget diff yields partial coverage. Criteria over budget, untrusted content containing the content-derived delimiter, and disclosure scans have the exact refusal outcomes in the design.
- Scan criteria text, paths, manifest and assembled prompt using `internal/secrets`; refusal names the matching pattern while output contains no secret bytes.
- Recompute `capture_id` from the server’s canonical post-filter form and reject a mismatching supplied `diff_sha256`.
- Keep policy values embedded and exported through a stable API for later consumers. Do not add provider, network, environment, handler, store, schema-resolution, or MCP behavior in this phase.

## Done evidence

- Fixture tests beside the package establish each Phase 2 observable, including repeat-build byte identity, ordering and stable criteria ids, lockfile/run-artifact exclusion, deterministic whole-file truncation and partial coverage, criteria budget refusal, delimiter refusal, secret refusal without leakage, excluded sentinels, recomputed capture identity/mismatch, and no network/environment access.
- `go test` for the new package passes under the repository’s 8 GiB memory cap and no more than three workers.
- `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, exact check commands and outputs, deviations, contradictions, unfinished work, and known problems. State explicitly if any are none.
