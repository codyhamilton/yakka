# Single-call LLM review, shadow mode

Plan 23 added an advisory, single-call Claude review path and a fixture-backed historical trial instrument. Its three-phase follow-up completed review controls and paged reads, synthetic-tenant isolation and disposal, and a full-clone trial workflow with an explicit spend gate. The implementation outcomes are proved with tests and fakes; the paid historical trial and deployed smoke remain operator work.

## Intent

User request, verbatim:

> Let’s start by building a way to make this call - the call should try to optimise by providing the diff + context, dropping things like package locks and other noisy files. It should include the brief criteria and lead with role setting and defining the review outputs.
>
> We will start by running this call alongside existing ones - each phase and on the final pr, producing a similar review. This will give us some alignment data - how aligned it is to the existing reviews. We can test it initially with 100 reviews on backdated changes that actually occurred and comparing against issues found in those reviews, and in the reviews that happened at pr time. This should be a feature added to the workflow system. I think we can keep it simple and dependency free for now since it’s really just one api call with no tool usage or advance harness features.

Additions to the request, verbatim, received while the first draft was being written:

> “Maybe this review can be done by the yakka remote? Since then we have authentication with yakka and the api key is not needed on individual systems, and the review is an mcp call”
>
> “The mcp call still has a shim yes? It could be told to use the current git uncommitted, or a git range”
>
> “Since the remote already has the plan and brief, it can just be told the brief or phase it is reviewing against rather than passed the doc, but this could be optional”
>
> “Then we also have correlation from a yakka tracking perspective”
>
> “The call should include the model used to write the change (as a way of correlating build models to outcomes)”
>
> “I’ll place the token in a CLAUDE_API_TOKEN secret in fly now, on next deploy it will be functional”

Owner decisions, Cody, 2026-11-09 ~1:25–1:26 PM AEST, chat (additional requests, verbatim):

> "The reviews should all be on haiku high, but test high vs xhigh vs max (at least 50 each)"
>
> "Lets get this one building despite the hold on other yakka work"

Additional requests, each attributed to Cody via Executor chat, 2026-11-09 ~10:17–10:21 PM AEST (Australia/Brisbane):

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "Sounds straight forward. Add paging. Why not use the real yakka server? For duplicates, returning a pointer just means a followup call is needed. better to just return the cached review? Why is YAKKA_REVIEW_TRIAL_ENABLED added, what does that env var mean."

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "sound to me like we should be adding params to the review call"

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "couldn't reviews just allow any tagging"

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "to allow filtering by tag"

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "Further don't you need a flag to prevent storing the review (for synthetic testing or other reasons)"

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "It's not just about caching, but about avoiding synthetic testing being treated and logged as real-work"

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "We could add a separate tenancy for the synthetic testing"

Cody, 2026-11-09 ~10:17–10:21 PM AEST:

> "does removing a tenancy auto clean up all its assets?"

Cody (owner), 2026-11-09 ~10:46 PM AEST, chat:

> admin reset? you mean a user can reset one of their own tenancies

Cody (owner), 2026-11-09 ~10:52 PM AEST, chat:

> Make tenancy reset a user only action, by having the API only permit it via the web UI (use headers). It would be good if there was some language specifying that only the user may reset their tenancy, not an agent on the user behalf. (We can turn this into a human captcha later)

## Why This Existed

Existing workflow reviews used agent sessions, and there was no measured comparison against a cheaper stateless review. The plan built the review instrument and offline trial harness so alignment, coverage and cost can be measured before deciding whether the approach is useful. Live reviews use `claude-haiku-5-5` at high effort; the historical comparison is intended to compare high, xhigh and max with at least 50 distinct valid cases per effort.

## What Was Built

The Python shim captures bounded local changes with safe Git invocation and disclosure checks. Go code re-filters captures, resolves criteria, builds a role-first prompt, calls Claude through the authenticated server, validates findings and stores tenant-scoped records. REST and MCP share review orchestration; workflow review remains advisory. The trial tools prepare manifests, run reviews, collect complete evidence and report alignment and cost. Follow-up controls add per-call effort, tags and storage choice; full cached duplicate responses; complete REST/MCP cursor reads; synthetic tenant lifecycle; and trial approval and provenance controls.

**Changed:** `packages/yakka/internal/{review,serve,store,ingest}`, `packages/yakka-analytics`, `plugins/yakka`, `tools/shadow-review-trial`, and architecture, API, advisory, analytics and operator documentation. Long-lived contracts are described in [event model and ingest](../design/01-event-model-and-ingest.md), [remote service](../design/03-remote-service.md), [advisory surface](../design/04-advisory-surface.md), [analytics site](../design/07-analytics-site.md), [server MCP contract](../design/08-server-mcp-contract.md), and [system architecture](../design/system-architecture.md).

### Original Phase 1 — Local change capture

Added deterministic uncommitted, staged and range capture, bounded Git reads, checkout identity, omission manifests and secret scanning. Focused capture/secrets fixtures passed 23 tests; the recorded full client suite passed 114.

### Original Phase 2 — Review packet and prompt policy

Added deterministic packet and prompt construction, server-side filtering, policy values, disclosure refusal and capture identity checks. The capped review suite passed; fixtures cover ordering, identity, exclusions, caps and refusals.

### Original Phase 3 — Criteria resolution

Added repository- and tenant-scoped versioned criteria resolution with stable IDs and explicit refusal codes. Capped review/store/ingest suites passed, including historical versions and screening states.

### Original Phase 4 — Review handler, single call, record and availability

Added tier-aware Haiku pricing, provider validation, review persistence, cost reservations and authenticated REST routes. Fake-endpoint fixtures cover statuses, retries, idempotency, budgets, tenancy, dry-run and model/effort behavior.

### Original Phase 5 — MCP tool and stage wiring

Added typed change reading, shim capture forwarding, conditional MCP registration and advisory stage calls. Server tests passed; Python shim/capture suites passed 36 tests. Skill, documentation and plugin-version checks passed.

### Original Phase 6 — Historical case manifest and comparators

Added a frozen manifest with eligibility, criteria and comparator provenance, seeded order and per-effort shortfalls. Six manifest tests passed. The available shallow history produced one eligible case, leaving a 49-case shortfall per effort; cases were not padded.

### Original Phase 7 — Trial runner and alignment report

Added dry-run cost estimates, cap checks, resumable authenticated runner, fake smoke, adjudication and report logic. The combined fixture suite passed 22 tests, including 50/49 cases, asymmetric failures, paired comparisons and a three-case by three-effort rehearsal. A repository-layout suite retained one unrelated Svelte import failure.

### Follow-up Phase 1 — Review controls and complete cached reads

Added strict per-call effort/tags/store validation, tag-sensitive execution identity with bounded legacy fallback, content-free ephemeral usage, full cached duplicate bodies, direct execution-key lookup, cursor-paged REST reads and matching read-only MCP `list_reviews`. All 16 Go packages passed under the 8 GiB cap. Fixed-high-water fixtures traverse 1,001+ rows with late/backdated writes and reject corrupt rows and invalid cursors.

### Follow-up Phase 2 — Synthetic activity is isolated and completely disposable

Added tenant-attributed claims and spend, owner-only reset/delete, cleanup journaling and restart recovery, complete residual checks, API-origin lifecycle UI and Pages selection revalidation without fallback. Two-tenant fixtures cover data isolation and cleanup; lifecycle tests cover refusal, busy work, crash recovery and stale cursors. All 16 Go packages and 52 focused Vitest tests passed; the offline production build passed. The required manual browser walkthrough remains a gate.

### Follow-up Phase 3 — Real-server trial workflow has complete evidence and an explicit spend gate

Added full-history fetch/unshallow and repository/object/count verification before manifest freeze; dedicated tenant and scope checks; full-body duplicate reconciliation; complete cursor-paged exports; exact-run canonical cost including failed billed attempts; and Cody approval binding before provider-reaching execution. Fake tests cover missing, expired, mismatched and over-ceiling approval, zero-call refusal and the composed manifest/run/adjudication/report workflow. The trial fixture suite passed 58 tests under the 8 GiB cap. No live server, paid call or provider credential was used.

## Deviations

The original Phase 5 MCP tool is conditionally registered when review configuration and timeout permit. Original Phase 7's manifest/runner head-field mismatch was corrected and fixture-proved. Follow-up Phase 2 gated MCP and admin data-plane entry points beyond the brief's owned-path list because they could lazy-open tenant storage during cleanup. A Phase 3 cost review found billed failed attempts missing from completed-row-only totals; the follow-up added ledger-based actual cost and unknown-outcome accounting. The Phase 3 surface list named a smoke module, while the existing fixture remains in the CLI/test module; no live smoke command was added.

## Review

The original Plan 23 terminal review passed, with non-blocking findings tracked in [#211](https://github.com/codyhamilton/yakka/issues/211) through [#217](https://github.com/codyhamilton/yakka/issues/217). The follow-up terminal review passed across all three signed-off outcomes; no critical or high finding stands. Low coverage finding [#225](https://github.com/codyhamilton/yakka/issues/225) tracks the untested injected persistence-failure rollback path in `Reservations.PurgeTenant`.

## QA

Recorded verification used an 8 GiB cap and at most three Go workers where applicable. Original phase fixture suites passed as recorded above. Follow-up Phase 1 and 2 each passed all 16 Go packages; Phase 2 also passed 52 Vitest tests with `--maxWorkers=3` and an offline production build. Phase 3 passed 58 Python fixture tests and a provider-free loopback smoke. `git diff --check` passed for the phase commits. This terminal review relied on those committed results and did not rerun tests.

## Residual Risks

No live historical population or paid trial is evidenced; the target of 50 distinct completed valid cases at each of high, xhigh and max remains unverified. The deployed server, server-held provider credential and a separate written spend approval are prerequisites before any paid run. Manual browser verification of reset/delete and tenant re-selection remains outstanding. Historical canonical rows without `review_id` return `cache_unavailable` without provider replay pending Cody's confirmation. Review cursors are checksummed, not MAC-protected, so same-tenant cursor tampering remains possible. The `Reservations.PurgeTenant` rollback restores memory on persistence failure but lacks an injected-save-failure test.

## Follow-ups

Resolve original findings #211–#217 before relying on their affected edge cases. Complete the historical clone/population proof, deployed-server readiness, server credential check, explicit spend approval and human lifecycle UI walkthrough before operator use. Consider a standalone high-water value only if audit consumers require it; current exports preserve the opaque cursor chain. Address #225 with a deterministic save-failure test for reservation purge.
