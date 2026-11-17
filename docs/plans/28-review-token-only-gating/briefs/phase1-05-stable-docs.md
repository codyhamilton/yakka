# Brief: phase1-05 — Stable docs, changelog and Plan 23 pointer

Consumer: a documentation worker on the stable docs and deploy surfaces, dispatched by Plan 28 `execute`.
Owned paths: `CHANGELOG.md`, `fly.toml`, `tools/README.md`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `docs/design/01-event-model-and-ingest.md`, `docs/design/03-remote-service.md`, `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, `docs/design/system-architecture.md`, `docs/plans/23-llm-review-shadow.md`; report `docs/plans/28-review-token-only-gating/reports/phase1-05-stable-docs.md`. Touch nothing else.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: unit 1 (`phase1-01-review-core`) and unit 3 (`phase1-03-ingest-vocabulary`), both with disjoint paths.
Budget: 11 files to read (use the ranges below), about 70 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Stable and operator documentation (lines 66-70), Architectural Implications (72-79), Phase 1 (219-224). Binding.
2. `docs/design/03-remote-service.md` — the Configuration table (60-76) and the tenant-lifecycle note (190-215).
3. `docs/design/01-event-model-and-ingest.md` — the Facts table rows for `Review run` and `Review usage` and the paragraph after (22-36).
4. `docs/design/04-advisory-surface.md` — `review_change` (60-78) and the review POST sentence (105-110).
5. `docs/design/08-server-mcp-contract.md` — tool scopes (70-80), `review_change` (204-226).
6. `docs/design/system-architecture.md` — component/principle mentions (19-40), orchestration (63-86), design table row 4 (100-104).
7. `docs/ARCHITECTURE.md` — Advisory change review (75-102).
8. `docs/OVERVIEW.md` — the review paragraph (52-70).
9. `CHANGELOG.md` — the `Unreleased` section at the top.
10. `fly.toml` (33 lines) and `tools/README.md` (14 lines).
11. `docs/plans/23-llm-review-shadow.md` — intro paragraph and the Follow-up Phase 3 / Residual Risks / Follow-ups sections (1-15, 118-143).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the stable and operator documentation say what the code now does: review is available from the provider token alone, the model is a code constant, effort is per call defaulting to `high`, and Yakka enforces no spend limit. Point Plan 23's record at this plan where it is superseded.

## Contract

Cited from DESIGN.md:

- "Each states token-only availability, the code-constant model, per-call effort and no Yakka spend limit (the "spend limits" phrase in the server-ownership sentences of `04`, `08`, `system-architecture`, `ARCHITECTURE` and `OVERVIEW` is removed, and `01`'s `review_usage` row drops `reservation_outcome`/`reservation_usd` from what new rows carry); the agent skills' "spend and record" wording stays true and is unchanged; `docs/design/03-remote-service.md` lists `CLAUDE_API_TOKEN` as the sole review setting and `fly.toml` gains a header comment (it has none today) that it is a `fly secrets` value and the only review setting; `CHANGELOG.md` records the removal, `skipped_busy` and the registration condition; Plan 23's record gains a short pointer to this plan beside the sections it supersedes without rewriting history."
- "After this plan no file outside `docs/plans/` mentions any of the four variable names, and `docs/plans/` mentions them only in records of what was decided then."
- Non-goals: "rewriting historical plan records."

Settled decisions:

- The changelog and all stable docs describe the removal **without spelling any of the four variable names**. Name them only in `docs/plans/23-llm-review-shadow.md` if a pointer needs them, and never rewrite its history.
- Do not touch `tools/shadow-review-trial/README.md`; Phase 2 owns it. Do not touch `docs/plans/28-*`.
- Keep the true statements that review spends on a provider call, stores a tenant-local record, and has `readOnlyHint:false`; remove only the claim that Yakka enforces or owns a spend limit.

## Changes

### `docs/design/03-remote-service.md`

- Configuration table: `CLAUDE_API_TOKEN` becomes the sole review row — "review provider credential; set in remote mode and review is available to every authenticated tenant for any repo; server side only, sent only in the provider authentication header". Delete the four rows.
- State (in the row or adjacent prose) that the model is the code constant `claude-haiku-5-5`, effort is per call (`high`, `xhigh`, `max`, default `high`), and Yakka applies no spend cap.
- Change "review reservations/claims also live outside the tenant directory" and "attributed claims/reservations" (lines ~192, ~211) to claims-only wording.

### `docs/design/01-event-model-and-ingest.md`

- `Review usage` row: keep actual cost/tokens/pricing identity and drop "reservation accounting"; no `reservation_outcome` / `reservation_usd` in what new rows carry. State that a provider failure with no usage records `cost_usd: null` with `cost_known: false`.
- `Review run` row: no change unless it still implies reservation accounting; the `skipped_busy` status is a review-run status (can be named where statuses are described).

### `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, `docs/design/system-architecture.md`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`

- In each server-ownership sentence, replace "spend limits and tenant-local records" (or the local variant) with actual-cost recording and tenant-local records. Keep "spends on a provider call" and "spend-and-record boundary".
- Registration: replace "review model configuration" with a non-empty `CLAUDE_API_TOKEN` in authenticated remote mode plus the 150-second ceiling.
- Delete the `YAKKA_REVIEW_EFFORT` high-only-default sentence in each place it appears; say per-call effort defaults to `high`, is validated server-side and is never capped by a setting.
- Add one sentence where availability is discussed: the model is fixed in code (`claude-haiku-5-5`), any authenticated tenant's repo is reviewable, and `skipped_busy` reports the two-call per-tenant in-flight limit.
- `system-architecture` line 21 and the design table row 4: "server spend and record" → "server-side provider call and record" (or equivalent) so it does not read as a spend limit.

### `fly.toml`

- Add a header comment beside the existing OAuth comment: `CLAUDE_API_TOKEN` is set with `fly secrets set` (never in this file) and is the only review setting; with a non-loopback authenticated server it alone enables review.

### `tools/README.md`

- The `shadow-review-trial` row: replace "approval-gated trial run" with wording true after Plan 28 (e.g. "full-history manifest, resumable real-server trial run, certified export/report"). Do not describe the Phase 2 details beyond that.

### `CHANGELOG.md`

- Add an `Unreleased` bullet (new subsection) that records: review availability now needs only the provider token in authenticated remote mode; the model is the code constant `claude-haiku-5-5`; effort is the per-call `high`/`xhigh`/`max` control defaulting to `high`; the four review configuration settings and the Yakka spend cap/ledger are removed; actual cost is still recorded, with unknown cost as `cost_usd: null` + `cost_known: false`; `skipped_busy` is the new in-flight-limit status and `skipped_budget` remains readable; `review_change` registers from the token plus the 150-second MCP ceiling. Do not name the four variables.

### `docs/plans/23-llm-review-shadow.md`

- Add a short pointer near the top and beside the superseded follow-up/residual-risk statements: Plan 28 (`docs/plans/28-review-token-only-gating/DESIGN.md`) supersedes the four review settings, the USD cap and the trial spend-approval gate; availability is token-only. Do not rewrite the historical outcomes.

### Keep untouched

- Every other file, including agent skills' "spend and record" wording, `docs/design/{02,05,06,07,09,10}` and the trial tool README.
- Historical statements in Plan 23 other than the pointer.

## Done evidence

Identify or write the failing checks first; report their output before and after.

- `grep -rIE 'YAKKA_REVIEW_(MODEL|EFFORT|USD_CAP|REPOS)' . --exclude-dir=.git --exclude-dir=plans --exclude-dir=shadow-review-trial` → no matches.
- `grep -n 'spend limits' docs/design/04-advisory-surface.md docs/design/08-server-mcp-contract.md docs/design/system-architecture.md docs/ARCHITECTURE.md docs/OVERVIEW.md` → no matches.
- `grep -n 'review model configuration' docs/design/04-advisory-surface.md docs/design/08-server-mcp-contract.md docs/design/system-architecture.md docs/ARCHITECTURE.md docs/OVERVIEW.md` → no matches.
- `grep -n 'CLAUDE_API_TOKEN' docs/design/03-remote-service.md fly.toml` → the sole review setting is stated in both.
- `git diff --check` → no whitespace errors.
- `git diff --stat` → only the eleven owned files.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
