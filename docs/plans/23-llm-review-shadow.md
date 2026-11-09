# Single-call LLM review, shadow mode

Plan 23 added an advisory, single-call Claude review path to Yakka. It captures a bounded local change, resolves review criteria, builds a deterministic role-first packet, calls the provider through the authenticated server, validates and stores the result, and exposes it through MCP beside existing reviews. It also added offline tooling to freeze historical cases, run fixture-backed trial workflows, and calculate alignment reports. All seven designed phases were proved with fixtures and fake endpoints; the later paid historical trial and deployed smoke test remain operator work.

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

## Why This Existed

Existing workflow reviews used agent sessions, and there was no measured comparison against a cheaper stateless review. This plan built the review instrument and offline trial harness so alignment, coverage and cost can be measured before deciding whether the approach is useful. Live reviews default to `claude-haiku-5-5` at high effort; high, xhigh and max are reserved for the later historical comparison.

## What Was Built

The Python shim captures uncommitted or resolved-range changes with bounded content, safe Git invocation, disclosure scans and omission reasons. Go code re-filters the capture, resolves stored criteria, assembles the prompt, calls Claude through an injectable standard-library client, validates findings and persists tenant-scoped review records and captured inputs. Authenticated REST orchestration is shared with the conditional `review_change` MCP tool. Execute, post-build and comprehensive-review skills call it as advisory evidence. Shared Haiku tier pricing and the `tools/shadow-review-trial` manifest, runner, smoke, and alignment-report commands complete the offline trial instrument.

Changed surfaces include `packages/yakka/internal/{review,serve,store,ingest}`, `plugins/yakka`, `tools/shadow-review-trial`, transcript pricing, and stable architecture and contract documentation. Long-lived contracts are documented in `docs/design/01-event-model-and-ingest.md`, `docs/design/03-remote-service.md`, `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, and `docs/design/system-architecture.md`.

### Phase 1 — Local change capture

Added deterministic uncommitted/staged and range capture, safe bounded Git reads, checkout identity, omission manifests and secret scanning. The focused capture/secrets fixtures passed 23 tests; the recorded full client suite passed 114.

### Phase 2 — Review packet and prompt policy

Added pure, deterministic packet and prompt construction, server-side re-filtering, policy values, disclosure refusal and capture identity checks. The capped `internal/review` package suite passed; packet fixtures cover ordering, stable identity, exclusions, caps and refusal paths.

### Phase 3 — Criteria resolution

Added repo- and tenant-scoped versioned criteria resolution with stable IDs and explicit refusal codes. The capped review/store/ingest suites passed, including historical versions and screening states.

### Phase 4 — Review handler, single call, record and availability

Added shared tier-aware Haiku pricing, provider validation, review-run persistence, cost reservations and authenticated REST routes. Fake-endpoint fixtures covered statuses, retries, idempotency, budgets, tenancy, dry-run and explicit model/effort behavior; the capped review/serve/ingest/store suite passed.

### Phase 5 — MCP tool, shim registration and stage wiring

Added typed `change` reader policy, shim capture forwarding, conditional MCP registration, REST/MCP orchestration coverage and advisory stage calls. Final capped server tests passed; Python shim/capture suites passed 36 tests. Skill, documentation and plugin-version checks passed.

### Phase 6 — Historical case manifest and comparators

Added a frozen manifest with eligibility, criteria and comparator provenance, seeded order and per-effort shortfalls. Six manifest tests passed. The local shallow history produced one eligible reviewed case, leaving a 49-case shortfall per effort; no cases were padded.

### Phase 7 — Trial runner and alignment report

Added dry-run cost estimates, cap checks, resumable authenticated runner, fake smoke, adjudication/report logic and direct frozen-manifest integration. The final combined fixture suite passed 22 tests, including 50/49, asymmetric failures, paired comparisons and the three-case × three-effort fake rehearsal. The repository layout suite retained one unrelated existing Svelte import failure (six of seven checks passed).

## Deviations

No phase outcome remains incomplete. Plan 24's typed-policy gap was implemented within Phase 5. Phase 3 follows the settled repo-scoped lookup contract: ambiguity is checked within the selected repository. The MCP tool is conditionally registered when review configuration and timeout permit, and repeated REST/MCP input returns a `skipped_duplicate` reference to the original record. Phase 7's initial manifest/runner head-field mismatch was fixed and directly fixture-proved. The historical dataset is insufficient for the target, as reported by the manifest rather than padded.

## Review

Terminal review verdict: PASS. No Critical or High findings remain. Mechanical review fixes were committed as `chore: Plan 23 review touch-ups`. Non-blocking findings are tracked in [#211](https://github.com/codyhamilton/yakka/issues/211), [#212](https://github.com/codyhamilton/yakka/issues/212), [#213](https://github.com/codyhamilton/yakka/issues/213), [#214](https://github.com/codyhamilton/yakka/issues/214), [#215](https://github.com/codyhamilton/yakka/issues/215), [#216](https://github.com/codyhamilton/yakka/issues/216), and [#217](https://github.com/codyhamilton/yakka/issues/217).

## QA

Phase checks were recorded with the 8 GiB memory cap and at most three Go workers where applicable. Fixture suites and `git diff --check` passed for the implemented outcomes. No paid or live provider review, deployment, or authenticated deployed smoke test was performed. The full repository layout check has the one unrelated Svelte import violation noted above.

## Residual Risks

The working-tree capture reads candidate content before enforcing its per-file cap (#211). Phase 2 capture/path consistency and rename-only diff cases remain tracked (#213–#215); shallow-history child eligibility and unrelated-record usage totals remain tracked (#216–#217). The review listing endpoint returns at most 500 records, so a large trial needs a complete retrieval path before claiming complete denominators. Capture content is client-asserted and review-input retention has no automatic expiry, as recorded in the design.

## Follow-ups

Resolve the seven filed issues before relying on affected edge cases. A future refinement must clarify whether REST/MCP parity means a duplicate reference or a byte-identical receipt; current idempotency behavior remains. The separate large-trial retrieval limit is recorded in the carried gates.
