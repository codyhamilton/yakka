# Review — Plan 28 — Review token-only gating

## Verdict

**PASS_WITH_FOLLOWUPS** — reviewed `5ca99b17` (branch includes `3edb25db`: 120s provider HTTP client aligned under 150s review MCP ceiling; trial runner client timeout 150s).

Phases 1–4 meet their design outcomes on this branch. Phase 5 is correctly **not met** here: the non-spending deploy probe against production failed because master still requires `YAKKA_REVIEW_MODEL` for tool registration; merging this PR is the intended deploy path, after which the probe and (separately) the paid trial can proceed.

## Phase outcome assessment

| Phase | Status | Evidence |
|-------|--------|----------|
| 1 — Token-only review server | **met** | `go test ./internal/{review,ingest,store,serve}` OK; `TestReviewMCPRegistrationAvailability` and amendment tests show `review_change` registers with token only and uses `review.LiveModel` when `YAKKA_REVIEW_MODEL` is unset; optional override honored when set. |
| 2 — Trial tooling without spend gates | **met** | `approval.py` removed; `python3 -m unittest discover -s tools/shadow-review-trial` 153 OK; three-case three-effort rehearsal passes. |
| 3 — garcia-music manifest ≥300 | **met** | Frozen 360 cases (floor 300); independent verifier report `phase3-06`; manifest gitignored; latest commit hardens manifest writes (`0600`, remote URL without credentials). |
| 4 — Comparison and validation report | **met** | Report CLI, matcher, leak check (section-scoped), evidence check, population and paired deltas covered by 153 tests; real-manifest leak check passes with documented `foreign_plan_document_captures: 54`. |
| 5 — Real-server trial | **not met** (expected) | `IMPLEMENTATION.md` documents blocked probe on `api.yakka.build`; no fabricated trial evidence committed. |

## Findings

### Resolved in review (none required)

Independent re-run of Phase 1–4 verification suites on reviewed SHA succeeded without code changes.

### Follow-up (non-blocking)

- **low** — `history_extract_b.py` remains as comparison provenance; close-out may keep or delete.
- **low** — `cli.py manifest` prints frozen count under label `eligible` while tier-eligible pool is larger; cosmetic only.
- **medium** — Phase 5 deploy probe and dedicated trial tenant: operator gates documented in `IMPLEMENTATION.md`; must not run paid trial until tenant id is provided.
- **medium** — Design Assumption 15: unreadable `review-reservations.json` starts with empty claims (accepted trade-off vs fail-closed spend guard removal).

### Briefed

None.

## Intent and assumption ledger

Implementation matches verbatim intent and the 18 Nov optional-`YAKKA_REVIEW_MODEL` amendment: registration is token + remote mode + 150s ceiling; model defaults to `claude-haiku-5-5`; effort/cap/repos env vars are not read; Yakka spend gating is removed with in-flight limit retained. Architectural implication (any `read_write` tenant can incur provider spend) is explicit in the design and unchanged on the branch.

## Plan sufficiency

The design was sufficient to determine intent, place findings, and derive QA. Phase 5's deploy and tenant gates were correctly recorded as out-of-scope operator acts.

## Residual risks

- Post-merge: production deploy must pick up this build before Phase 5 probe can succeed.
- Trial manifest carries private diffs locally; `0600` write and credential stripping mitigate accidental leakage on disk; committed repo remains metric-only per Phase 4 evidence check.