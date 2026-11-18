# phase1-05 — Stable docs, changelog and Plan 23 pointer

Status: done with concerns

## What changed

- `docs/design/03-remote-service.md`: `CLAUDE_API_TOKEN` is now the sole review row and setting, with
  adjacent prose stating the code-constant model `claude-haiku-5-5`, per-call effort (`high`/`xhigh`/`max`,
  default `high`) and no Yakka spend cap. Tenant-lifecycle prose and the `DELETE` row now say
  claims-only, not reservations/claims.
- `docs/design/01-event-model-and-ingest.md`: `Review usage` row keeps actual cost/tokens/pricing
  identity and drops reservation accounting. Added that new rows carry no `reservation_outcome`/
  `reservation_usd`, that both remain ingestible for older rows, that a no-usage provider failure
  records `cost_usd: null` + `cost_known: false`, and that `skipped_busy` is a review-run status
  while `skipped_budget` stays readable.
- `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`,
  `docs/design/system-architecture.md`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`: removed the
  "spend limits" server-ownership claims (actual-cost recording now); registration now requires a
  non-empty `CLAUDE_API_TOKEN` in authenticated remote mode plus the 150-second ceiling; removed the
  `YAKKA_REVIEW_EFFORT` high-only-default sentences in favour of per-call effort defaulting to
  `high`, validated server-side and never capped; added the code-constant model, any-authenticated-
  tenant's-repo and `skipped_busy` in-flight-limit statements. `system-architecture` line 21 and
  design-table row 4 now say server-side provider call-and-record.
- `fly.toml`: header comment states `CLAUDE_API_TOKEN` is a `fly secrets` value and the only review
  setting.
- `tools/README.md`: `shadow-review-trial` row now reads "Full-history manifest, resumable
  real-server trial run, certified export/report".
- `CHANGELOG.md`: new `Unreleased` subsection records token-only availability, the constant model,
  per-call effort, removal of the four settings and the spend cap/ledger, actual-cost/`cost_known`
  behaviour, `skipped_busy`/`skipped_budget`, and the registration condition, without naming the
  four variables.
- `docs/plans/23-llm-review-shadow.md`: short Plan 28 pointer at the top and beside Follow-up
  Phase 3, Residual Risks and Follow-ups; historical outcomes untouched.

## Check output

Before:

- `grep -rIE 'YAKKA_REVIEW_(MODEL|EFFORT|USD_CAP|REPOS)' . --exclude-dir=.git --exclude-dir=plans --exclude-dir=shadow-review-trial` — 14 matches in `packages/yakka/internal/{serve,review}` (unit 1's paths).
- `grep -n 'spend limits' <five docs>` — 4 matches.
- `grep -n 'review model configuration' <five docs>` — 5 matches.
- `grep -n 'CLAUDE_API_TOKEN' docs/design/03-remote-service.md fly.toml` — only the 03 row; no `fly.toml` mention.

After:

- `grep -rIE 'YAKKA_REVIEW_(MODEL|EFFORT|USD_CAP|REPOS)' ...` — no matches under my owned paths; the
  same 14 matches remain in `packages/yakka/internal/{serve,review}` (unit 1's paths, not landed yet).
- `grep -n 'spend limits' <five docs>` — no matches.
- `grep -n 'review model configuration' <five docs>` — no matches.
- `grep -n 'CLAUDE_API_TOKEN' docs/design/03-remote-service.md fly.toml` — 03 row + prose and
  `fly.toml` lines 6–7.
- `git diff --check` — clean.
- `git diff --stat` — only the eleven owned files.

## Deviations and concerns

- The first done-evidence check still matches code under `packages/yakka/internal/`, which is unit 1
  (`phase1-01-review-core`)'s owned path and was not landed when this unit committed. No stable-doc
  file matches. This is the expected concurrent-unit state, not a widening of scope.
- `docs/design/04-advisory-surface.md` had a sixth "review model configuration" occurrence at line 46,
  outside the cited range; it is an owned path and was changed.
- No contradiction between the brief and the contracts it cites was found.

## Unfinished / known problems

- None in owned paths. Final global proof of the first check depends on unit 1 landing.
