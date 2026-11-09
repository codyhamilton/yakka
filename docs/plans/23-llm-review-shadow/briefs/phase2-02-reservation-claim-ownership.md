# Brief: phase2-02 — Claim and reservation ownership plus anonymous spend transfer

Consumer: a Go worker in `packages/yakka` who knows the review reservation/claim file and the `internal/review` orchestration call sites.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/review/availability.go`, `packages/yakka/internal/review/availability_test.go` (new), `packages/yakka/internal/review/orchestrator.go` (only the reservation call sites and related types), `packages/yakka/internal/review/orchestrator_test.go`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-02-reservation-claim-ownership.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: phase2-01 (it owns `internal/serve` and does not edit `internal/review`).
Budget: read 8 files, about 250 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — review-call domain lines 99–119 (especially the `store=false` usage paragraph 119), synthetic tenancy lines 131–166 (isolation, no separate synthetic counter, global claims/reservations, anonymous transfer 162), decisions 13–14 and 18 (lines 217–218, 222).
2. `packages/yakka/internal/review/availability.go` — `Reservations` (75–98), persistence (100–161), `begin` (167–197), `claimState` (199–211), `beginEphemeral` (213–237), `reserveRetry` (239–256), `settle` (258–271), `finish`/`finishClaim` (273–290), `expire` (292–302).
3. `packages/yakka/internal/review/orchestrator.go` — reservation and spend-key path (330–405), retry reservation/settle (397–445), ephemeral usage persistence (951–995).
4. `packages/yakka/internal/review/orchestrator_test.go` — fake reservations and restart/duplicate tests; grep `Reservations`, `skipped_duplicate`, `outcome_unknown`.
5. `packages/yakka/internal/store/review_usage.go` — `AppendReviewUsage` and `ReviewSpend` (1–109), read only for the isolation contract.
6. `docs/plans/23-llm-review-shadow/briefs/phase1-04-ephemeral-usage-dry-run.md` — the `store=false` usage behaviour already landed.

## Goal

Make every new claim and spend reservation explicitly tenant-attributed and versioned, keep old unattributed records readable but never guessed at, and add an exactly-once purge that moves a tenant's attributed rolling spend into anonymous provider-wide safety exposure.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Every new claim/reservation, including store=false unknown outcomes, carries explicit tenant id and format version."
- "Before removing attributed rolling spend, atomically transfer only timestamp/amount into an anonymous provider-wide safety accumulator until expiry, with no tenant/key/review/usage/tag identity or reverse mapping. Both operations preserve conservative shared exposure without tenant cost residue; crash/retry cannot double-count or refund it."
- "A trustworthy creation marker proves coverage; never guess, reverse-hash or bulk-clear opaque legacy claims."
- "Shared owner identity never combines tenants. There is **no separate synthetic-spend counter**. The provider-wide rolling safety cap remains an operational shared budget, never a tenant analytics source or permission to reveal another tenant's spend."
- "Spend reservations/in-flight limits still apply under fresh non-cache identifiers, attributed to the tenant, with conservative charge for unknown outcomes."
- "`store=false` always gives full review regardless of detail." / "Each explicit call is independent paid work if it reaches the provider; transport ambiguity must never cause an automatic replay."

## Changes

- Version the persistent reservations document (for example `Version: 2`) and persist `tenant` plus that format version on every new spend entry and every new claim. Keep the current spend-key/attempt fields and the rolling-expiry meaning.
- Keep decoding version-1 files: old `claimed map[string]string` entries and old spend entries have no tenant/version. Treat them as unattributed legacy records: readable for duplicate detection under their existing keys, never assigned to a tenant and never removed by tenant cleanup. Do not reverse-hash, bulk-clear or refund them.
- Change the in-memory claim value from a bare id to an id/tenant/version record; `begin` records the tenant it already receives. `beginEphemeral` persists tenant/version on its spend entry but still creates no durable claim. Keep `reserveRetry`, `settle`, `finish` and `finishClaim` semantics.
- Add a wait/quiescence read for one tenant used by the cleanup engine: it must report/wait until no in-process call for that tenant remains (`active` claims and ephemeral in-flight). It must release when `finish`/`finishClaim` runs and respect a context deadline.
- Add `PurgeTenant(tenant string) error` that, under one lock and one atomic save, removes every claim belonging to the tenant and every attributed spend entry belonging to it, appending anonymous replacement spend entries carrying only the same `At` and `Amount` (no tenant, key, review, usage, tag or reverse mapping). The provider-wide total must be unchanged, anonymous rows must expire on the same schedule, and a second call must be a no-op rather than transferring or refunding again. On save failure restore the old in-memory state and return an error.
- Add a read-only residue check for the engine/tests: whether any claim or attributed spend remains for a tenant.
- Update the orchestrator call sites only as needed for the new claim value/tenant fields. Do not change review identity, statuses, duplicate taxonomy, retry policy or `review_usage` content.

### Keep untouched

`executionKey`/`PreUpgradeExecutionKey`, cached-duplicate behaviour, `store=false` cache bypass, `review_usage` row shape and its exclusion from facts/quality/work cost, provider retry count, and pricing. Do not edit `internal/serve` or `internal/store` (other units own them).

## Done evidence

Write the failing checks first, then report before/after output.

- `cd packages/yakka && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review -run 'Reservation|Claim|Review|Ephemeral|Duplicate|Restart'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- New test: after `begin`/`beginEphemeral`, the persisted document contains the tenant id and format version for each new claim/spend entry; a reload preserves them.
- New test: a hand-written version-1 document with `claimed` and spend entries loads and still answers its existing duplicate key; `PurgeTenant` does not remove or retarget those legacy entries.
- New test: `PurgeTenant("a")` removes tenant A's claims and attributed spend, leaves tenant B's entries, replaces A's spend with anonymous same-`At`/`Amount` rows, and the provider-wide total is exactly unchanged.
- New test: calling `PurgeTenant("a")` a second time, and reloading and calling it again, changes nothing and never double-counts or refunds.
- New test: the wait/quiescence call blocks while an active or ephemeral call is held, returns after `finish`/`finishClaim`, and honours a cancelled context.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
