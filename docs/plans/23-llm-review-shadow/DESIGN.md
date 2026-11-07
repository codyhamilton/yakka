# Single-call LLM review, shadow mode

## Intent

User request, verbatim:

> Let’s start by building a way to make this call - the call should try to optimise by providing the diff + context, dropping things like package locks and other noisy files. It should include the brief criteria and lead with role setting and defining the review outputs. 
>
> We will start by running this call alongside existing ones - each phase and on the final pr, producing a similar review. This will give us some alignment data - how aligned it is to the existing reviews. We can test it initially with 100 reviews on backdated changes that actually occurred and comparing against issues found in those reviews, and in the reviews that happened at pr time. This should be a feature added to the workflow system. I think we can keep it simple and dependency free for now since it’s really just one api call with no tool usage or advance harness features.

Additions to the request, verbatim, received while the first draft was being written:

> “Maybe this review can be done by the yakka remote? Since then we have authentication with yakka and the api key is not needed on individual systems, and the review is an mcp call”

> “The mcp call still has a shim yes? It could be told to use the current git uncommitted, or a git range”

> “Since the remote already has the plan and brief, it can just be told the brief or phase it is reviewing against rather than passed the doc, but this could be optional”

> “Then we also have correlation from a yakka tracking perspective”

> “The call should include the model used to write the change (as a way of correlating build models to outcomes)”

> “I’ll place the token in a CLAUDE_API_TOKEN secret in fly now, on next deploy it will be functional”

## Problem

Every review the workflow produces today is an agent session: per phase a cheap-tier outcome check plus `artifact_feedback` (non-gating), at the end `comprehensive-review` or `post-build`. That is the expensive path, and nothing says what a much cheaper review would find. A single stateless model call (role and output contract, criteria, a filtered change, no tools) may catch a similar set of issues at a fraction of the cost, but only measured alignment against real past reviews can say so. No way to assemble that call, run it from a session, or collect the evidence exists. Ground (twice) found:

- **The server has no outbound Claude call, no MCP endpoint and no review-shaped output.** Its one model-backed outbound call is the Jev scorer (`packages/yakka/internal/scorer/jev.go`), a fixed-schema scoring service whose response usage is discarded. `go.mod` has three direct dependencies and no LLM SDK; outbound HTTP is stdlib `net/http`. The server's routes are REST only (`serve.go:487-505`); tool lists, schemas and handlers live in the Python shim (`yakka.py:2350-2466`) and a legacy Go copy.
- **The mechanism this feature rides on is designed, not built.** Plan 21 as amended on its branch (`docs/21-feedback-delivery`, worktree `yakka-wt/21-feedback-delivery` at `6638459`; the version merged to master in `6a757a8`, which this tree holds, predates it and has no such text, and the newer remote branch head was not read) defines the MCP boundary: the server declares per tool the local context a thin shim injects under a reserved `_local` key and the local actions it may run, and the shim holds no tool logic. Plan 22 (design, branch `docs/22-session-work-tagging`, unmerged) adds the `cwd`, `repo_id` and `session_hint` context names and a `session_action` correlation model. Both name the MCP shim issue (#177) as the thing that builds the endpoint, registry and shim; nothing of it exists in code. This design therefore **depends on #177** for its MCP tool registration (Phase 5 only), and says exactly what it needs of it; the review itself is built first behind a REST entry that does not need #177.
- **The artifact store has no plan or phase entity, and holds only three kinds of file.** An artifact is a `facts` row (`type='artifact_version'`) identified by `(repo_id, path)`, versioned by content hash, "latest" being newest by receipt. Only `docs/plans/<name>/DESIGN.md` (design), `docs/plans/<name>/briefs/*.md` (brief) and `docs/plans/<name>/reports/*.md` (report) are ever captured (`internal/keys/keys.go:167-185`); `PLAN.md`, `REVIEW.md`, `IMPLEMENTATION.md` and `QA.md` never reach the store, so incumbent reviews are comparators held in git, not store artifacts. Also: the screen worker sweeps every blob in the tenant's `blobs/` area and sends it to the scorer (`serve.go:351`, `store.go:800`), and a flagged blob is dropped; `/v1/artifacts` returns a pending or flagged newest version that `/v1/search` silently skips; tenancy is one database per tenant directory with no repo-level ACL. Plan and phase are derived from path and `DESIGN.md` content, not stored.
- **Model identity is per call, not per session or subagent.** `facts.model` comes from each usage payload; a conversation's "model" is its dominant call model; subagents have no separate identity.
- **Credentials and config are environment-only on the server** (`ConfigFromEnv`, `docs/design/03-remote-service.md:60-71`); `CLAUDE_API_TOKEN` appears nowhere in the tree. The pricing table (`internal/store/pricing_table.json`) holds Claude entries, sourced from cursor.com on 2026-06-26, and prices on read.

The trial population is small (estimates from `git log --all` on a shallow local checkout, to be replaced by the manifest's counts): of 63 commits carrying phase trailers, about 14 change code; 18 plan folders ever held a `REVIEW.md`; about 9 have both phase records and a review. **A trial of 100 eligible real changes cannot be assembled from local history**, which is shallow, holds no GitHub PR review threads and no `Yakka-Plan:` marker. The shortfall is a reported result, not a defect to pad over, and the phases deliver the instrument, not the alignment data; the paid trial is a later operator act. Second, sending repository content to a third party is a disclosure act: it now leaves the machine twice (to the Yakka server, then to Anthropic), so disclosure control stays core.

## Solution Shape

A `review_change` tool on the Yakka server's authenticated MCP endpoint, backed by one server handler that is also reachable as an authenticated `POST /v1/reviews` (the transport-neutral entry the tool registers over and the trial drives, so the review is provable and usable before #177 builds the endpoint). A thin shim collects the change locally through one declared context reader, in one of two explicit modes: current uncommitted changes, or a resolved git range. The server, which alone holds the provider credential (`CLAUDE_API_TOKEN`, a Fly secret), resolves the criteria from the artifact store when told a brief or a plan and phase, builds one prompt (role and output contract first), makes one Claude API call with no tools, validates the reply against the supplied change, and stores the result as a tracked record linked to the repo, plan, phase, session, captured input, criteria version, reviewer model, build model and cost. Machines need only the Yakka login they already have; no machine holds a provider key. Stage skills call the tool beside the existing reviews, at each phase close and at the PR head; it is advisory and feeds no gate, verdict, commit or exit code. A maintainer tool freezes a manifest of historical changes, drives the same tool for the backtest, and produces the alignment report. Whether the capability is functional is proved only by a post-deploy authenticated smoke test, not by anything in this design.

### Ownership: where the work lands

Everything lands in this one tree. No other local repository holds any yakka code (the only local checkouts of this origin are this repository's worktrees, including `~/workspace/workflow-plugin` and the `yakka-wt/*` set; every other repo under `~/workspace` is an unrelated project), and `fly.toml` and `Dockerfile` here build `packages/yakka`. The local `origin` URL still reads `codyhamilton/workflow-plugin`; GitHub serves that name as the canonical `codyhamilton/yakka` (default branch `master`), verified on 2026-11-07 through the sanctioned GitHub connector, and every in-tree config names `codyhamilton/yakka` (Assumption 1). No rename or remote change is part of this design. Split by path:

| Owner | Paths | Holds |
|---|---|---|
| Server (Go, `packages/yakka`) | new `internal/review/` (including an embedded policy values file); `internal/serve/serve.go` (config, `POST` and `GET /v1/reviews`); the tool registration, declaration and route files that #177 names; `internal/ingest` (the `review_run` fact type); `internal/store` (reads, a separate review-input area, cost via `pricing.go`); `docs/design/03` env table | Prompt policy, exclusion and budget values, criteria resolution, the Claude call, validation, record, cost, caps, availability, tool definition |
| Client (Python, `plugins/yakka`) | `client/yakka.py` (one reader in the shim's fixed reader table, registered per #177) and its tests; skill text in `skills/{execute,post-build,comprehensive-review}`; plugin version | Local collection mechanics only: safe reading, the existing secret-pattern scan, and values the server declares. No tool definition, description, schema, prompt, or policy value of its own |
| Maintainer tooling (`tools/`) | new `tools/shadow-review-trial/` | Manifest, comparators, run driver (the Phase 1 capture function plus `POST /v1/reviews` with the user's existing Yakka login), report |
| External, not in this tree | Fly secrets and `[env]` for the production app; GitHub tracker | Provisioning (user-owned); issue filing |

The legacy Python quality service (`tools/quality/`) is not a home for this: plan 22 settled that the Go binary is server-only and the Python client is the only client, and the legacy service is being superseded.

### Domain: Local change capture (shim reader)

- Owns: reading one change from the agent's machine on the server's declaration, and nothing else. It is one reader in the shim's fixed table, so the shim still holds no tool list, descriptions, schemas, prompt or review policy. The split is explicit: **every policy value is the server's and arrives in the declaration** (the exclusion list and its version, the per-file, total and file-count caps, the truncation class order, `context_lines`, the rule that `docs/` paths are never noise); **the shim holds only mechanisms for reading safely** (the fixed git operation table, the filter, symlink, regular-file and UTF-8 refusals, and the existing secret-pattern scan the client already carries for the drain).
- Contract:
  - **Declared reader.** The server declares `change` in `review_change`'s context list with server-supplied parameters (the policy values above). The reader takes its inputs from the call's `mode`, `view`, `include_untracked`, `base`, `head` and `merge_base` arguments and writes under the reserved `_local` key, which the shim overwrites so the agent cannot supply it. Declared parameters and argument-fed readers are what this design needs added to #177's context mechanism (Architectural Implications). The tool declares `local_actions: []`: it runs nothing locally but collection.
  - **Allowed operations are a fixed table** of read-only git argument arrays, run without a shell, with no interpolation of agent text into a command string: toplevel and git-dir resolution, `rev-parse --verify --end-of-options <ref>^{commit}`, `merge-base`, `diff` with a fixed flag set, `ls-files --others --exclude-standard`, `status --porcelain=v2`, `check-attr`. Each has a timeout and a byte cap on output; pathspecs go in via a NUL-delimited stdin list with literal pathspecs. No command touches the network, writes the index or object database, or fetches. Environment is an allowlist (path, home, locale) plus `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`.
  - **No helper executes.** Every diff runs with `--no-ext-diff --no-textconv --no-color`, `diff.external` and `core.fsmonitor` overridden off, `GIT_EXTERNAL_DIFF` unset. Comparing a worktree file runs git's clean filter, which no flag disables, so in modes that read the worktree any path whose `filter` attribute is set is withheld with manifest reason `filter_driver` and its command is never run. Range and staged-only modes read objects and run no filter.
  - **Mode `uncommitted`.** `view=combined` (default) is `HEAD` to worktree for tracked paths: a file staged and then edited again appears once as its net change; `view=staged` is the index against `HEAD` only. Untracked files are **excluded by default** and counted in the manifest as `untracked_not_included`; with `include_untracked=true` only files that `ls-files --others --exclude-standard` lists (so never ignored files), that are regular, not symlinks, within the per-file cap, UTF-8 and free of secret patterns enter, as added-file content, read without following links. Every other untracked file is a manifest entry with its reason.
  - **Mode `range`.** `base` and `head` are resolved to full commit SHAs before anything is diffed; a value beginning with `-`, containing whitespace or control characters, or not resolving to a commit is the capture error `bad_ref` (naming which argument). `merge_base=true` diffs from the merge base of the two; otherwise it is `base` to `head`. Only objects are read, so the checked-out state is irrelevant to the content, and is reported but not part of it.
  - **State and wrong-checkout guard.** The capture reports `repo_id` (the drain's rule), whether the checkout is a linked worktree, branch or `detached`, `HEAD` SHA, counts of staged, unstaged and untracked paths, and the mode parameters. The base for locating the repository is `project_dir`, never `cwd`; with neither usable it is an error `no_project_dir`, so the plugin's own directory is never reviewed. An optional `repo_id` argument is an expectation: a different captured repository is `wrong_checkout`, as is a captured repository that differs from the resolved criteria's repository (checked on the server). The reader reads `HEAD` and a `status` fingerprint before and after gathering; a difference is `changed_during_capture` (one retry), never a mixed capture.
  - **Immutable identity.** The capture carries the exact diff bytes it sends and their SHA-256 (`diff_sha256`), a transport-integrity checksum the server verifies on receipt, before any re-filtering. The authoritative `capture_id` is computed by the server alone (Domain: Review run), so no canonicalisation exists in two languages. The capture is client-asserted: the server cannot verify that the bytes are what git holds, and records them as received.
  - **Capture error codes** (tool errors, nothing recorded): `bad_ref`, `no_project_dir`, `wrong_checkout`, `changed_during_capture`, `not_a_repository`, `git_unavailable`, and, from the server, `capture_unsupported` when the shim lacks the reader.
  - **Bounded, with a manifest.** Declared exclusions (lockfiles, vendored and generated code, minified and source-map files, build output, binaries, images, snapshots, files over the cap; plan run artifacts in Domain: Review run) appear only in the manifest, with reason, added and removed line counts and blob hash, and no content. Over the total or file-count cap, whole files are dropped from the tail in a fixed class order (code, tests, config, docs) and listed `truncated: budget`. The capture reports `complete: false` with reasons whenever anything was excluded of changed lines, withheld, truncated or untracked-not-included. A changed lockfile is called out in the manifest summary because dropping it hides new dependencies; a path in `docs/` is never excluded as noise.
  - **Secrets withheld before leaving the machine.** Each file's diff or content is scanned with the existing Python mirror of the secret pattern set; a hit withholds the whole file with a manifest entry naming pattern and line, never the matched text. Removed lines count (a deleted secret is still a secret).
- Non-goals: any tool policy, exclusion default, prompt or review logic in the client; full-file or cross-repo context; commit messages; network access of any kind; executing repository-configured helpers.

### Domain: Criteria resolution (server)

- Owns: turning an optional reference into criteria text and a recorded version, from the existing tenant-bound artifact store.
- Contract:
  - **Three ways, one optional.** `brief: {path, content_hash?}` names a stored brief; `plan: <slug>` with `phase: <N>` (and optional `content_hash`) names the plan's design and a phase in it; `criteria_text: [string]` is explicit text for standalone use. With none, the review carries a `criteria: none` marker and must say so in `limitations`. The repository is the captured `repo_id` (or an explicit `repo_id` when none was captured); resolution never searches across repositories.
  - **What is extracted.** From a design (`DESIGN.md`; a folder that has only a legacy `PLAN.md` is not in the store, so its criteria are supplied as explicit text): Intent, the phase's Outcome and Surfaces, and the ledger entries. From a brief: Goal, Contract, Done evidence, Owned paths. For a PR-kind review, every phase Outcome. Each criterion gets a stable packet-local id (`I1`, `O1`, `D1`, `A1`, …) the reviewer must cite. `plan` is the folder name under `docs/plans/` (the `<NN>-<slug>` entry name, as plan 22 settles); a bare slug matching more than one entry is ambiguous. Only artifacts of kind design or brief resolve. Of the run artifacts only `reports/` and `briefs/remediation-*` can be stored, and both are refused as criteria sources; `REVIEW.md`, `IMPLEMENTATION.md` and `QA.md` are never in the store at all, so no earlier answer can leak in through resolution.
  - **Version.** `content_hash` pins an exact stored version. Without it the newest stored version that is not rejected resolves, including one still awaiting or flagged by screening (screening is a quality signal, not a safety one), with its screen state in the record. The record stores `{repo_id, path, content_hash, source: store|explicit}` and, for explicit text, its own hash. A pinned version older than the newest stored is `criteria_stale` unless `allow_superseded=true`, which the historical trial sets so a case is judged against the criteria in force at its head and never a later revision.
  - **Explicit errors, never silent omission.** `criteria_not_found` (nothing stored at the path), `criteria_ambiguous` (a slug matching more than one plan folder, duplicate phase heading, more than one repository matches), `phase_not_found`, `criteria_version_unknown` (pinned hash not stored), `criteria_stale`, `criteria_unavailable` (newest version rejected, or its body no longer held). Each is a tool error naming the code and the fix and is also recorded as `refused_criteria` carrying the code; none yields an empty criteria set.
  - **Precedence.** When a reference and `criteria_text` are both supplied, the reference wins and the text is not sent; the reply and the record name it as `ignored: criteria_text`. Explicit text is for use without a reference.
  - Reads are bound to the bearer token's tenant; a second tenant's artifact never resolves.
- Non-goals: creating a plan or phase entity in the store; resolving from a PR or an issue; reading anything outside the artifact store; correcting a stale or unscreened artifact.

### Domain: Review run (server: packet, call, validation)

- Owns: the prompt policy, the exclusion policy, the single provider call, validation, the status vocabulary and availability.
- Contract:
  - **Prompt order is fixed, role first**: (1) ROLE, stating that everything after the criteria is untrusted data and no instruction; (2) OUTPUT CONTRACT, the result schema below in full; (3) CRITERIA; (4) a coverage summary (counts and paths only: included, excluded, truncated, withheld, not included); (5) UNTRUSTED CONTEXT: the change. Nothing derived from the repository precedes (3). The untrusted section sits behind a delimiter derived from the hash of that section's own content; content containing it is `refused_capture`. The prompt policy is a named, versioned server constant recorded in every record; it carries no build model, session, tenant, user or commit message.
  - **Server re-applies the exclusion and budget policy** to whatever the shim sent (it trusts the shim for nothing): a lockfile hunk that arrives is moved to the manifest; plan run artifacts (`REVIEW.md`, `IMPLEMENTATION.md`, `QA.md`, `reports/`, `briefs/remediation-*`) are excluded from the change in production and trial alike; a packet-wide character budget (default 400,000) applies; role, output contract and criteria are never truncated, and exceeding the budget alone is `refused_capture`. Any truncation, exclusion of changed lines, withheld file or untracked-not-included marks the packet `coverage: partial`. A secret pattern surviving anywhere in the assembled prompt (existing server scan) is `refused_disclosure`, naming the pattern. The reviewer's reply is scanned the same way before it is stored: a hit is redacted in place with the existing redaction and the record flagged `reply_redacted`, so ingest's secret precheck can never reject a review that has already been paid for.
  - **One call**: one HTTPS `POST` to the Claude Messages API, Go standard library, no tools, no streaming, no second call to repair output, no new dependency. The endpoint is a constant, not configuration; tests inject a fake through a constructor argument, never an environment variable, so a deployed server cannot be pointed elsewhere. `max_tokens` and a wall-time cap are bounded; response size is capped; provider error bodies are never echoed, only a status and a short classification.
  - **Credential and availability.** The credential is `CLAUDE_API_TOKEN`, read from the server's environment only, sent only in the authentication header, and appearing in no log, record, error, reply, prompt or fixture. The build verifies, against the provider's current documentation, which credential types and header the API accepts, and does not assume a subscription or session token works; a 401 or 403 is `unavailable: credential_rejected` and no other provider or credential is tried. The reviewer model is `YAKKA_REVIEW_MODEL`, an exact versioned id with no floating alias and no default in code; the response's own model id is recorded beside it. The tool is available only when all of these hold, else it answers `unavailable` naming the missing setting (never a value) and makes no outbound request: the credential and model are set; the configured model id is in the pricing table (an exact-match lookup, so cost is always known; the dated id the provider returns is recorded and a mismatch with the configured id is noted, not repriced); a spend cap `YAKKA_REVIEW_USD_CAP` is set; the repository is in `YAKKA_REVIEW_REPOS` (a comma list of `<tenant>/<repo_id>` entries; empty enables none; `repo_id` is client-asserted, so this is an operator consent control and not proof of which repository a capture came from). The caller must hold a `read_write` token, because the call spends money and writes a record. Local mode (no authentication) is always `unavailable`: there is no tenant to bind and no credential to hold.
  - **Capture identity, owned here.** The server computes `capture_id` as the SHA-256 of a canonical document over the repository, mode and view, resolved base, head and merge-base SHAs, the policy values file's own hash, and the files sorted by path with their state and the SHA-256 of each included diff chunk, **after** the server's re-filtering; the shim's `diff_sha256` is checked before it. The trial manifest records `diff_sha256` and the policy values file's hash, and a case is re-captured if that hash changes.
  - **Result schema** (what the reviewer is told to emit and the validator checks): `outcomes[]` of `{criterion_id, assessment: met | partial | not met | unassessable, evidence}`, one entry per criterion id (a missing or duplicate id is `invalid_output`, so an empty reply cannot read as a review); `findings[]` of `{id, severity: blocker | high | medium | low, lens, title, path, line_start, line_end, evidence, criterion_ids[], confidence, rationale}`, with `lens` one of `outcome`, `intent-assumptions`, `correctness`, `security`, `contract`, `tests`, `other`, and `path` and lines a location inside an included hunk or the literal `unsupported`; `evidence` a verbatim excerpt of the untrusted section of at least 20 characters; `limitations[]` and `coverage` beside the packet's own record.
  - **Validation is mechanical**: JSON parses; enums valid; each excerpt a substring of the untrusted section; each cited path and line inside an included hunk; each criterion id exists. A finding failing a support check is kept, flagged `unsupported` and counted separately, never repaired or dropped. A reply that fails to parse or validate is `invalid_output`.
  - **Two classes of outcome.** *Argument and capture errors* (malformed or missing arguments including a missing `build_models`, the capture error codes, a token without `read_write` scope) are tool errors and record nothing, since nothing was accepted to key a record on. Everything after that is a recorded run with exactly one status:
  - **Status**, exactly one of: `ok` (valid, coverage complete), `ok_partial` (valid, coverage partial), `timeout`, `api_error`, `invalid_output`, `unavailable`, `refused_capture`, `refused_disclosure`, `refused_criteria`, `skipped_budget` (the spend cap or the in-flight limit), `skipped_duplicate`. Only `ok` with zero findings, every criterion assessed and no limitation citing missing context may be read as "found nothing"; every other status is a non-review and is rendered as one.
  - **Idempotency, retry, spend.** The key is `(repo_id, kind, plan, phase, capture_id, criteria hash, build_models hash, reviewer model, prompt policy version)`; a repeat is `skipped_duplicate` naming the earlier review, with no call. Changing the model, the policy version or the declared build models is a new review, which is how a rerun is made. Transport retries (timeout, 429, 5xx) are bounded (default 1) and recorded as attempts within the one record, each with its own tokens and cost. The cap is one server-wide rolling-24-hour limit across all tenants, because the credential is shared. Before any request the worst-case cost (estimated input tokens at the input rate plus `max_tokens` at the output rate) is reserved atomically against the cap and settled to the reported usage afterwards; a call that times out with no reported usage stays charged at its reserved worst case, so a cap cannot be undercounted by failures. A small per-tenant in-flight limit bounds concurrent calls. `dry_run=true` builds everything, returns the estimate and the manifest, calls no model and records nothing.
- Non-goals: any tool use, agent loop, memory, multi-turn repair, ensemble or second-opinion call; a second provider; choosing what counts as a good review.

### Domain: Review record and tracking

- Owns: the stored result and its links into the existing Yakka correlation model. No parallel pipeline.
- Contract:
  - **One `review_run` fact per call** that got past argument validation (including every non-`ok` status, so a missing review is visible and not silent), stored through the existing ingest function in-process, as plan 22's `record_action` does, not through a new write route. Existing views exclude `review_run` facts from conversation, hook-event and facet counts (proved by a golden test seeding them).
  - **Keys**: `repo_id`, `kind` (`phase`, `pr`, `adhoc`), `plan` slug, `phase`, `pr` number (all as the caller named them, `Yakka-Plan:` and `Yakka-Phase:` being the stage's own source), `base_sha`, `head_sha` (range) or `head_sha` and `view` (uncommitted), `capture_id`, the captured input, the criteria record (above), reviewer model (configured and returned ids), prompt policy and exclusion-policy versions, status, attempts, validated payload.
  - **Session link.** `conversation_id` is the bound session. Binding follows plan 22's mechanism (`session_id` argument, else the declared `cwd`, `repo_id` and `session_hint` resolved by that plan's Phase 4) and, unlike `record_action`, never errors: the record carries `session_binding: bound | ambiguous | unbound`, and an unbound or ambiguous record takes a synthetic `review:<capture_id prefix>` conversation id, so nothing is written to a guessed session. Where plan 22's `session_actions` exists, the action in force at the call is copied into the record; where it does not, the field is absent and says why.
  - **Build model, separate from reviewer model.** `build_models` is a required argument: an array of `{id, role?}` for every contributor to the change, each an exact recorded model id as the caller knows it, or the literal `unknown`. Mixed contributors are kept as a list; the server infers nothing from the harness or from session facts, and an omitted argument is an argument error rather than a silent `unknown`. It is stored in the record and returned in reads; it is **never** placed in the prompt (a sentinel test on the outgoing request body), so the reviewer cannot be biased by it.
  - **Cost.** Provider-reported input and output tokens, latency, and cost computed from the pricing table via the store's existing price function, recording the table's own identity so a price-source error is visible; `unpriced` is impossible because an unpriced model is `unavailable`. Review cost is its own measure and is not added into session usage.
  - **Captured input retention.** The post-scan, post-exclusion captured input is stored content-addressed in a separate review-input area of the tenant directory, not in `blobs/`, because the screen worker sweeps `blobs/` and would send a diff to the scorer (a second third party) and could drop it. This lets a reviewer's finding and an adjudicator's reading refer to the same bytes even for an uncommitted capture. There is no expiry in this design and deletion is a manual operator act on the tenant directory; the area is counted in the admin disk-use page and retention is an open question for the user. The record holds hashes. The tool reply never returns captured content.
  - **Reads.** `GET /v1/reviews?repo_id=&plan=&phase=&kind=&status=&since=&limit=` (read scope, tenant-bound) returns records with the keys above, `build_models`, cost and, with `detail=full`, the validated payload. The tool's own reply is a receipt by default (id, status, finding counts by severity, coverage, cost, ignored inputs); `detail=full` adds the validated findings, for standalone use. The alignment report joins comparators to records by `(repo_id, plan, phase, head_sha)`; the incumbent phase and PR-time reviews (`IMPLEMENTATION.md`, `REVIEW.md`) are never in the store, so they are comparators held in git and pinned by `path@sha:blobhash` in the trial manifest, never copied into the record.
- Non-goals: new analytics dimensions or a dashboard; folding review cost into `work_cost`; a job queue; editing or deleting a record through a tool; labelling any review as truth.

### Domain: Tool surface and shadow invocation

- Owns: the tool definition and when stages call it.
- Contract:
  - **One handler, two entries.** `POST /v1/reviews` (bearer, `read_write`) takes the arguments and a capture in its body and runs the whole review; the MCP tool registers over the same handler. Both return the same receipt, and a caller of the REST entry supplies its own capture (the trial does, using the Phase 1 function).
  - **`review_change`**, defined on the server (description, schema, annotations, declared context and scope), holds one definition across harnesses. Arguments: `mode` (`uncommitted` | `range`), `view`, `include_untracked`, `base`, `head`, `merge_base`; `kind`, `plan`, `phase`, `pr`; `brief`, `criteria_text`, `allow_superseded`; `build_models`; `repo_id`; `session_id`; `detail`, `dry_run`. Declared context: `change` (above), `project_dir`, `cwd`, `git` and optionally `session_hint` (plan 22). Declared scope `read_write`; declared timeout longer than the server's wall-time cap; declared `local_actions: []`.
  - **Stage use.** The `execute` (after a phase's closing commit), `post-build` and `comprehensive-review` skill texts each name one non-gating call: `range`, with `base` and `head` the stage already resolves (previous closing commit or default-branch merge base to the commit carrying `Yakka-Phase: <slug>:<n>`; merge base to the candidate SHA at PR level), `kind`, `plan`, `phase`, and `build_models` listing the model ids the run record shows for the contributors or `unknown`, never a guess. If the tool is absent, `unavailable` or errors, the stage continues.
  - **Advisory and out of band.** No stage reads the result into a gate, verdict, commit, trailer, report fence or file in the plan folder; the tool writes nothing to the repository or the plan folder; its output is never committed. The guarantee is carried by the tool (read-only locally, record stored server-side only) and a mechanical presence check that the skill texts say non-gating.
- Non-goals: gating, blocking, replacing or second-signing any review; auto-fix; posting to a PR; any change to `execute`'s phase boundary or phase count; a per-user client key or any client provider configuration.

### Domain: Historical trial (evidence)

- Owns: the frozen case manifest, comparator evidence, rubric, adjudication records and the alignment report, in `tools/shadow-review-trial/`. It calls the Phase 1 capture function and `POST /v1/reviews` with the user's existing Yakka login, and holds no provider credential; the shim path is exercised in Phase 5.
- Contract:
  - **Case**: a real change with a reproducible `base..head` pair at the reviewed pre-fix SHA (PR-level: the SHA a `REVIEW.md` records as reviewed or the parent of its fix; phase-level: between consecutive phase closes), run in `range` mode with `allow_superseded=true`. Fields: case id, kind, plan, phase, base, head, both commits present, the capture's `diff_sha256`, the criteria used (a pinned `content_hash` the server holds, else explicit text built from the blob at `head`, so criteria are the version in force at the change), the build models as curated evidence or `unknown`, and comparator pointers as `path@sha:blobhash`. Phase-level and PR-level comparators are linked separately and never merged.
  - **Eligibility** (all required): both commits resolve; the filtered change is non-empty; comparator evidence exists and is not part of the captured input; the capture builds without refusal (refused cases listed with reason). Every excluded candidate is listed with its reason. The manifest reports eligible count per stratum against the target of 100 and states the **shortfall**; it is never padded, and changes without comparator evidence are `unaccompanied` and excluded from alignment denominators. It records the shallow-history boundary of the checkout and, per case, whether the criteria came from the store or from explicit text.
  - **No future leakage**: the capture reads objects at `head` only; comparator documents and plan run artifacts are excluded by the capture and server rules; criteria are pinned as above; model pre-training exposure to the public repository cannot be removed and is a limitation in every report.
  - **Frozen comparator file**: historical findings curated once, each citing blob and line, then hashed. Historical reviews are the baseline, not truth.
  - **Alignment rubric** (fixed before any paid run). Each historical finding is `matched`, `partial` or `unmatched` (with a context-limitation tag if its evidence lay outside the supplied change). Each new finding is `matched`, `partial`, `disputed` or `new-valid` after human adjudication; unadjudicated is reported as such; a path-and-line pre-pass may propose matches but a human confirms. Adjudication covers every new finding at medium or higher and a seeded fixed-rate sample of low. The report states every denominator (attempted, eligible, each status, historical findings, new findings, adjudicated), cost, tokens and latency per case and in total against the cap, **and outcomes by build model and by reviewer model** with `unknown` its own row, so build models are correlated to outcomes without any inference.
  - **Execution** is the same tool over the frozen manifest, gated by an explicit spend authorization and the server's cap, performed by an operator after implementation, with a lab record under `docs/lab/RESEARCH/`. A dry run uses the tool's `dry_run`.
  - **Smoke evidence.** The tool must not be called functional until a lab record shows an authenticated smoke run after the deploy that carries the credential: one small real review through the shim with a `read_write` token (review id, status, returned model id, tokens, cost), and a `read`-scope token refused. This design and its phases never claim it done.
- Non-goals: statistical significance on a small N; redesigning analytics; labelling any review as ground truth; fetching GitHub data itself (a locally supplied export of PR review comments is accepted as extra comparator evidence, with its own hash; producing it needs authenticated network access outside this design).

## Architectural Implications

- **Depends on the MCP shim issue (#177), which is unbuilt.** Phase 5 (the tool, the shim registration and the stage wiring) cannot close before it lands. Phases 1 to 4, 6 and 7 touch no MCP endpoint (the review is exercised through `POST /v1/reviews`) and can close first. Until then plan 21's MCP boundary and plan 22's tool contracts are the spec, and nothing is built against a guess at the endpoint's internals. This design needs four things of #177, to be checked when Phase 5 is refined and added there if absent: **(a)** a context entry may carry server-declared parameters and read named tool arguments (the `change` reader); **(b)** a tool declares a required scope (`read_write`), because plan 21 as amended says its feedback tool needs read scope only and adds no write-scope check to the MCP route, and `docs/design/04` says every tool is read-only; **(c)** a tool declares a call timeout longer than the shim's current 3-second reads and the route accepts a long synchronous call (the server has `ReadHeaderTimeout` only); **(d)** a tool may declare that its context carries bulk content, with a body cap on the MCP route (today 16 MiB exists only for ingest).
- **Interaction with plan 21.** Plan 21 as amended says the MCP route never carries file content and the service receives versions only from the drain; that rule is stated for `artifact_feedback`. The review needs the change in the same request that records and prices it, and a queued snapshot would be asynchronous and unordered, so this tool carries the change on the call. The scan-before-leave rule is kept in spirit: the shim scans and withholds before the content leaves the machine; the server rescans as a backstop. The two plans share `instructions` and the tool registry additively; whichever merges second rebases.
- **Interaction with plan 22.** `session_hint`, the `cwd` and `repo_id` names and `session_actions` are used if present and are never required (the record states `unbound` instead). No phase here blocks on plan 22.
- **Server-only Go, one client.** Per plan 22's decision, the Go binary is server-only and the Python client is the only client; nothing is added to `packages/yakka/internal/mcp`, `drain` or `clientconfig`, which are being deleted (#178).
- **Layering** (`tools/README.md`, `tools/release/test_layout.py`): plugin runtime may not resolve into `tools/`. The trial tool lives in `tools/`, imports the capture function and calls the server's REST entry; the shim never imports it.
- **Plugin version.** A plugin change requires a version bump in the same change (`docs/design/05-distribution.md:124`).
- **Secret patterns** exist twice (Go canonical, Python mirror) with no test that they agree. The disclosure gate now runs the Python mirror at the shim and the Go set at the server; the test pinning the two against shared pattern names is part of Phase 1.
- **Deploy and provisioning are external.** Fly secrets and `[env]` are the user's; this design's tool is inert (`unavailable`, no outbound request) until `CLAUDE_API_TOKEN`, `YAKKA_REVIEW_MODEL`, `YAKKA_REVIEW_USD_CAP` and `YAKKA_REVIEW_REPOS` are set, and a deploy has carried the build. Phase 4 adds these to the env table in `docs/design/03`.
- **Stable docs.** `ARCHITECTURE.md` and `OVERVIEW.md` do not describe the server surface or this tool and must not until it exists; Phase 5 adds the component and cross-skill entries. Contracts that outlive the change are promoted at close-out to a new `docs/design/` doc (number best-effort). `docs/automation/post-build.md` told pipelines the plan marker is `Workflow-Plan:`; skills write `Yakka-Plan:`; PR-level correlation relies on the marker, so the stale mentions were corrected in this change (readers still accept both).
- **Sequencing.** The paid trial cannot be meaningfully run before Phase 7 closes and the smoke evidence exists; its size is set by the manifest, not by the intent's 100.

## Decisions

None taken interactively (headless). The six additions to the Intent are requirements: they replaced the first draft's client-side provider, per-user key, local ledger and `shadow-review` command, and the design above is rewritten, not amended, to follow them. Every scope-shaping judgement is in the Assumption Ledger.

## Assumption Ledger

### Assumption 1

- Question: Which repository does this work belong to, given the local `origin` URL is `codyhamilton/workflow-plugin` and the user says it split from `codyhamilton/yakka`, and does the server change belong in another local repo?
- Answer chosen: This tree, under yakka naming, for both server and client. Evidence: `git worktree list` from the main checkout shows only worktrees of this origin (`~/workspace/workflow-plugin`, `workflow-plugin-stats-jev-dry`, `yakka-wt/*`); no other local repo has a yakka remote or `packages/yakka`; `fly.toml:7`, `install.sh:4`, `.cursor-plugin/marketplace.json:21`, `packages/yakka/go.mod:1` name yakka; `CHANGELOG.md:181,190` and `docs/plans/15-rename-to-yakka/DESIGN.md:50` make the GitHub rename and `git remote set-url` maintainer actions; `docs/lab/CONSUMING_REPO.md:15,49` still says workflow-plugin.
- Rationale: The design was drafted offline, where the name GitHub serves could not be checked. It is now verified (2026-11-07, sanctioned GitHub connector): `codyhamilton/workflow-plugin` resolves to the canonical `codyhamilton/yakka`, default branch `master`, SSH `git@github.com:codyhamilton/yakka.git`. The local `origin` URL is the old name and is left unchanged; the design branch is pushed to the canonical URL by explicit URL, not through `origin`.
- If wrong: only where the tracking issue is filed and what `install.sh` clones (it reads `origin` first, `install.sh:197-203`).

### Assumption 2

- Question: Plan number and branch?
- Answer chosen: `23-llm-review-shadow`, worktree `yakka-wt/23-llm-review-shadow`, branch `docs/23-llm-review-shadow` from the local `origin/master` ref (`6a757a8`).
- Rationale: 20, 21 and 22 exist on other refs; the sibling convention is `yakka-wt/<NN>-<slug>` on `docs/<NN>-<slug>`. `NN` is best-effort, the slug is the key.
- If wrong: a folder rename before the PR; nothing locates a folder by number.

### Assumption 3

- Question: Where does the feature live?
- Answer chosen: The review service, prompt policy, exclusion policy and tool definition on the Go server (`internal/review`); one capture reader in the Python shim; the trial in `tools/`. Supersedes the first draft's plugin-client `shadow-review` command.
- Rationale: the user's additions: the remote owns the credential and the call, the call is an MCP tool, and the shim only collects. Plan 22's decisions put all tool definitions and logic on the server and none in `yakka.py`.
- If wrong: moving policy into the client would reintroduce per-machine configuration and drift; not an option under the additions.

### Assumption 4

- Question: Which provider and model?
- Answer chosen: Claude through the Messages API, model from `YAKKA_REVIEW_MODEL`, an exact versioned id, no code default and no floating alias. The first value to try is `claude-sonnet-5-5`, which is priced in the table, as a recommendation for the operator, not a default. DeepSeek is dropped as a default and as a profile.
- Rationale: the user placed a Claude token on the server. A cheaper tier is the point of the experiment, but the right tier is an empirical question the trial's per-model rows can answer, so the model is configuration.
- If wrong: a config value; a model not in the pricing table makes the tool `unavailable` until the table has it.

### Assumption 5

- Question: Is `CLAUDE_API_TOKEN` usable as it stands?
- Answer chosen: Unknown, and not assumed. The user states they will set it in Fly and that it will be functional on the next deploy; neither is verified here, and nothing in this design reads or logs a credential. The build checks the provider's current documentation for accepted credential types and header, treats a subscription or session token as possibly invalid, and fails closed with `unavailable: credential_rejected`. Only the post-deploy smoke test supports a "working" claim.
- Rationale: the variable name does not say whether the value is an API key; a wrong assumption fails only at the first paid call.
- If wrong: a different credential type is a server change in one function; nothing client-side changes.

### Assumption 6

- Question: How does this depend on the not-yet-built local-context and tool mechanism?
- Answer chosen: Hard dependency on #177 for Phase 5 only (the MCP tool, shim registration and stage wiring), stated with the four additions this design needs of it. Phases 1 to 4, 6 and 7 are built and closed against fixtures and the review's own REST entry (`POST /v1/reviews`), so the review works end to end for the trial before #177 exists. Nothing is built against a guess at the endpoint.
- Rationale: recon found no server MCP endpoint, no declared-context carrier and no local-action directive in code; plans 21 and 22 specify them and name #177. Plan 22 made the same call.
- If wrong: if #177 declines an addition, Phase 5's refine either builds it there or bounces this design. A REST entry beside an MCP tool is a second route for one handler, the same shape as plan 22's REST reads beside its tools; if a single transport is preferred, drop the REST entry and Phases 4, 6 and 7 can no longer close before #177.

### Assumption 7

- Question: Synchronous call or asynchronous job?
- Answer chosen: Synchronous within a bounded wall time (default 120 seconds, `max_tokens` bounded), with the declared tool timeout above it. If the smoke test shows the Fly proxy or a harness's MCP tool timeout cuts it, the fallback is the existing pattern (an ingest fact processed by the tenant worker, read from `GET /v1/reviews`), not new job infrastructure.
- Rationale: a stateless call of this size is typically well under a couple of minutes, but the Fly proxy timeout is not in the repo and no harness timeout was measured. The server has no write timeout, so the Go side will not cut it.
- If wrong: the record shape and reads are already the async shape; only the trigger moves.

### Assumption 8

- Question: Who consents to sending repository content to a third party now that no machine holds a key?
- Answer chosen: The server operator, per repository: `YAKKA_REVIEW_REPOS` lists `repo_id`s and empty means none, alongside the configured credential, model and cap. A stage skill calling the tool from a repository not listed gets `unavailable` and sends nothing. Installing the plugin enables nothing.
- Rationale: stage skills are installed in consuming repositories, some private; with the client key gone, the server must refuse by repository. One env list is the minimum.
- If wrong: a looser rule widens disclosure; a stricter one (a tenant flag only) enables every repository the tenant has used.

### Assumption 9

- Question: What does `uncommitted` mean, and are untracked files included?
- Answer chosen: Default `combined` (net `HEAD` to worktree for tracked paths), with `staged` as the index-only alternative; untracked files excluded by default and counted in the manifest, included only on `include_untracked=true`, and then only safe files via the git ignore rules.
- Rationale: a reviewer of "what I have right now" wants net effect; untracked files are where stray credentials and scratch data live, so including them must be a deliberate act and a visible omission, never silent.
- If wrong: the default is one parameter; the manifest already says what was left out.

### Assumption 10

- Question: What if a reference and explicit criteria are both given?
- Answer chosen: The reference wins; explicit text is not sent and is named in the reply and record as ignored.
- Rationale: one authoritative source keeps criterion ids and the recorded version meaningful; mixing unverified text with a stored version blurs what the review was judged against.
- If wrong: explicit text could be appended under its own id range; additive.

### Assumption 11

- Question: Pinned criteria versus newest, and what is "stale"?
- Answer chosen: Unpinned resolves to the newest non-rejected stored version, recorded by hash. A pinned version older than the newest is `criteria_stale` unless `allow_superseded=true`; the trial sets it and pins to the version in force at each case's head. A live caller with an uncommitted design edit can still get a store version older than their working copy; the record names the hash, and `artifact_feedback`'s delivered state is the existing way to know the store is current.
- Rationale: the store has no "as of" notion and "latest" is receipt order. Pinning is the only exact answer for the historical case and forced freshness is the safe live default.
- If wrong: an `as_of` selector could be added to the resolver; the record already carries what it would need.

### Assumption 12

- Question: May the change travel on the MCP call, against plan 21's rule that the MCP route carries no file content?
- Answer chosen: Yes, for this tool only, under a declared bulk-content context and a route body cap on the MCP route (a #177 dependency, not yet specified there); the REST entry takes the same body under its own cap. Scanned and withheld at the shim, rescanned at the server.
- Rationale: the review must be recorded and priced against the exact bytes in one request; routing through the queue and drain would be asynchronous and loose the link between request and captured input.
- If wrong: capture could be enqueued as a snapshot and referenced by id, at the cost of ordering and a wait; the server contract above is unchanged.

### Assumption 13

- Question: How is a review recorded, and for how long is the captured input kept?
- Answer chosen: One `review_run` fact per call through the ingest function, with attempts inside the record; the post-scan captured input is stored content-addressed in a separate review-input area of the tenant directory, never in `blobs/`, with no expiry.
- Rationale: reuses the tracking pipeline and gives adjudicators the same bytes the reviewer saw, which uncommitted captures cannot otherwise reproduce. `blobs/` is swept by the screen worker, which sends content to the Jev scorer and can drop it, so a diff must not live there. A review diff is larger than a design body, so stored bytes grow; the admin disk-use page shows it. Retention is the user's to decide (Open Questions).
- If wrong: store only the hash and rebuild range captures from git; uncommitted captures would then be unreproducible.

### Assumption 14

- Question: Do results leave the machine and what comes back?
- Answer chosen: The record lives on the server; the tool returns a receipt by default and full findings only with `detail=full`; captured content is never returned.
- Rationale: stages must not be able to consume the result as a gate input by default, and the trial reads records through `GET /v1/reviews`.
- If wrong: a default flip in the tool definition.

### Assumption 15

- Question: Which token scope may call it?
- Answer chosen: `read_write` only.
- Rationale: it spends money and writes a record; plan 21's read-only MCP route rule was for read-only tools.
- If wrong: a read token could spend; the cap bounds it but does not remove the question.

### Assumption 16

- Question: How is the build model supplied and protected from bias?
- Answer chosen: A required `build_models` argument (list of `{id, role?}` or `unknown`), recorded, returned in reads, absent from the prompt, with nothing inferred from the harness or session facts. A server-observed model from session facts is not recorded.
- Rationale: the user wants build models correlated to outcomes; session facts carry only the dominant call model and no subagent identity, so inferring would blur exactly the dimension being measured. The caller can join by session later.
- If wrong: add an `observed_models` evidence field when the session is bound; separate from the declared one.

### Assumption 17

- Question: Is session correlation mandatory?
- Answer chosen: No. The record is bound to a session when plan 22's mechanism or an explicit `session_id` allows it, else `unbound` or `ambiguous` with a synthetic conversation id; never a guess.
- Rationale: a review should not be lost because a session could not be identified; mis-tagging would corrupt the correlation the user asked for.
- If wrong: make it an error like `record_action` does.

### Assumption 18

- Question: Where does the noisy-file policy live and who enforces it?
- Answer chosen: The server owns the versioned deny-list and budgets and declares them as reader parameters; the shim applies them mechanically to bound what leaves the machine; the server reapplies them to whatever it receives.
- Rationale: policy on the client would be a per-machine copy; trusting the shim for exclusion would let a stale plugin send a lockfile.
- If wrong: a plugin could ship its own list, which the user's additions rule out.

### Assumption 19

- Question: Fail closed how, when a secret-like string is found?
- Answer chosen: The shim withholds the whole file with a manifest entry; the server refuses the call as `refused_disclosure` if a hit survives anywhere in the assembled prompt (criteria text, paths, manifest). Pattern-based only; no environment is read by either scanner.
- Rationale: matches the repo's posture (a hit drops content, reasons name pattern and line only).
- Rationale addendum: the reviewer's own reply is scanned and redacted before storage so a paid review cannot be rejected by ingest's secret precheck. Pattern false positives on design prose (plan 21 notes an `env_assignment` hit) will show as `refused_disclosure` cases in the denominators rather than disappear.
- If wrong: a looser policy would send a hunk; a stricter one refuses on any hit and costs trial coverage.

### Assumption 20

- Question: What is "the existing phase review" the call is compared with?
- Answer chosen: The phase's `IMPLEMENTATION.md` Verification and Carried sections plus findings in any `REVIEW.md` revision attributable to the phase's range; at PR level the terminal `REVIEW.md`. Neither file is ever in the artifact store, so both are read from git and pinned by blob hash in the manifest. The uncommitted `post-build` report is not a comparator.
- Rationale: no per-phase review artifact exists distinct from verification, and no template for these files, so comparator extraction is curation, not parsing.
- If wrong: the phase stratum is thinner, which the manifest reports.

### Assumption 21

- Question: How are historical comparators extracted, and one output schema or two?
- Answer chosen: Curated once into a frozen hashed comparator file with blob and line citations; one schema for phase and PR calls, PR calls carrying every phase Outcome as criteria.
- Rationale: review formats vary across plan generations, and a parser would add error to the baseline; one schema keeps the validator and comparisons single.
- If wrong: a mechanical extractor feeds the same file; a lens-set tweak.

### Assumption 22

- Question: Does the 100-review trial stay at 100 if fewer real changes exist, and is history depth fixed here?
- Answer chosen: No to padding: run the eligible population, report shortfall and denominators. History depth is recorded, not changed; deepening needs a network fetch, an operator choice before the manifest is frozen.
- Rationale: about 14 code-bearing phase commits and 18 reviewed folders on a shallow checkout with no PR threads; alignment on changes with no comparator is not alignment. This design is offline.
- If wrong: a deeper fetch or a PR-review export raises the count through the same manifest code.

### Assumption 23

- Question: Who adjudicates new findings?
- Answer chosen: The repository owner, manually, against the rubric fixed before the run: every new finding at medium or above, a fixed-seed sample of low.
- Rationale: historical reviews are not truth, so a human rules on findings they did not contain; an LLM adjudicator would reintroduce the self-grading problem.
- If wrong: a second human or a calibrated cheaper adjudicator; categories and denominators do not change.

### Assumption 24

- Question: Default budgets and caps?
- Answer chosen: 400,000 characters per packet, 20 context lines, per-file cap 60,000 characters, one transport retry, 120-second wall time, `max_tokens` 8,000, an in-flight limit per tenant, and a spend cap that must be set explicitly (`YAKKA_REVIEW_USD_CAP`); with no cap set the tool is `unavailable`.
- Rationale: about 100k input tokens per call; numbers are server defaults recorded with every result; no implicit spend.
- If wrong: config or constants.

### Assumption 25

- Question: Is the pricing table adequate for review cost?
- Answer chosen: Use it, recording its identity. It is a Cursor price list (header: fetched from cursor.com on 2026-06-26), not Anthropic's own, and lookup is an exact match on the configured id; require the model to be in it.
- Rationale: it is the one place prices live and mirrors `tools/transcript/pricing.json` under an equality test; a second price list would be a parallel pipeline.
- If wrong: the build compares the entry with the provider's published rate and corrects the table (the equality test with `tools/transcript/pricing.json` moves with it), or records the difference.

### Assumption 26

- Question: Commit and tracker actions?
- Answer chosen: As drafted headless, nothing was committed, filed or pushed, and the design, the one stale-marker doc fix and an issue draft outside the repository were left uncommitted for approval. The user then reviewed and approved publishing the design (2026-11-07); it is committed on `docs/23-llm-review-shadow` as two commits (the marker fix, then the design) and pushed to the canonical repository. The tracking issue and pull request are created separately through the sanctioned GitHub connector.
- Rationale: no local rule authorizes a design commit from a headless session; the explicit approval does, for this design only. It authorizes no implementation, merge or deploy.
- If wrong: the branch is a docs-only commit pair that can be dropped.

### Assumption 27

- Question: Are seven phases too many?
- Answer chosen: Keep seven; the tail (Phases 6 and 7, the trial tooling) is the clean split point if sign-off finds the count too large, and only Phase 5 waits on #177.
- Rationale: each phase has a distinct provable outcome; the first draft's five phases grew by the criteria resolver and the tool surface that the additions introduce.
- If wrong: cut after Phase 5 and give the trial its own design.

### Assumption 28

- Question: Is a server-wide cap and a per-repository allowlist enough for a multi-tenant remote with one shared credential?
- Answer chosen: Yes for now: one global rolling-24-hour cap with atomic reservation (failures charged at worst case), a tenant-qualified repository allowlist as operator consent, and `read_write` scope. The allowlist is not authentication of repository identity (`repo_id` is client-asserted), so any `read_write` holder in the tenant could claim a listed id; the tenant boundary and the cap bound the harm.
- Rationale: the credential is the operator's and spend is the real exposure; per-tenant budgets and repository proof are larger designs than a shadow experiment warrants.
- If wrong: per-tenant sub-caps and a server-verified repository binding.

### Assumption 29

- Question: Why does a REST entry exist beside the MCP tool, and what was cut to keep the call a single call?
- Answer chosen: `POST /v1/reviews` is the same handler as the tool so the review, its record and the trial are provable and usable before #177 builds the MCP endpoint. Cut from the first draft's surface: `verdict_hint`, `force`, a client ledger and any client configuration. Kept because the Intent or a requirement needs them: `view` and `include_untracked` (combined versus index, untracked opt-in), `allow_superseded` (historical criteria), `detail` and `dry_run` (the trial's dry run and the receipt-by-default rule).
- Rationale: the first adversarial pass found Phases 5 and 7 unprovable without an unbuilt endpoint and the surface larger than "one API call".
- If wrong: drop the REST entry (Assumption 6 says what that costs).

## Open Questions

- ~~Does GitHub still serve `codyhamilton/workflow-plugin`?~~ Resolved 2026-11-07: it serves the canonical `codyhamilton/yakka`; the tracking issue is filed there.
- When will #177 land, and does it accept the four additions? Blocks Phase 5 only.
- How long are stored review inputs kept, and who deletes them? No expiry exists in this design; blocks nothing, but stored repository content grows until decided.
- Is `CLAUDE_API_TOKEN` a credential type the Messages API accepts, and has a deploy carried it? Blocks the smoke evidence and any "functional" claim, not any phase. The user states they will provision it; unverified.
- Which model id, spend cap and enabled repositories are set in Fly (`YAKKA_REVIEW_MODEL`, `YAKKA_REVIEW_USD_CAP`, `YAKKA_REVIEW_REPOS`)? Blocks the smoke test and the trial; user-owned, and not set by this design.
- Does the Fly proxy or any harness's MCP tool timeout cut a call of about two minutes? Settled by the smoke test; Assumption 7 holds the fallback.
- Will the operator deepen history or supply a PR-review export before the manifest is frozen? Blocks reaching 100, not any phase.
- Does plan 22's session binding land, and which candidate? Affects only how often `session_binding` reads `bound`.

## Phases

Phases 1 to 4, 6 and 7 are provable with no network and no spend, against fixtures and an injected fake Claude-shaped endpoint. Phase 5 needs #177. Trial execution and the post-deploy smoke test are deliberately not phases: they are operator acts after the build and after a deploy that carries the credential, under the server's cap, and their evidence is a lab record. Design acceptance is the union of the seven outcomes below; the 100-review comparison itself is the later trial.

### Phase 1 — Local change capture

- Outcome: In fixture repositories (a plain checkout, a linked worktree, and one configured with an external diff driver, a textconv driver, an `fsmonitor` command and a `filter` attribute, each set to a canary that writes a marker file), the capture function returns for `mode=uncommitted` the combined `HEAD`-to-worktree change (a file staged then edited again appears once as its net change, a staged-only file appears, `view=staged` returns only the index diff), with untracked files absent and counted `untracked_not_included` by default, and with `include_untracked=true` only regular, non-symlink, in-cap, UTF-8, non-ignored, secret-free files entering as added files and every other one a manifest entry with its reason; for `mode=range` it resolves `base` and `head` to full SHAs (with `merge_base` as an option) and reads objects only; an argument beginning with `-`, containing whitespace or control characters, or not resolving to a commit returns an error code; two runs on an unchanged repository give identical `diff_sha256`; a worktree change between the pre- and post-gather state check returns `changed_during_capture`; the result states `repo_id`, linked-worktree flag, branch or `detached`, `HEAD`, dirty counts and mode parameters; a `repo_id` expectation mismatch returns `wrong_checkout`; no usable `project_dir` returns `no_project_dir` and never falls back to `cwd`; no canary marker exists afterwards and `filter`-attributed paths are withheld with reason `filter_driver`; every subprocess call is one of the fixed argument arrays with no shell (asserted by test); declared exclusions, secret-pattern files (including a removed secret) and over-cap files appear only as manifest entries with reason, counts and blob hash, never content; a capture over the total or file-count cap drops whole files in the documented order and reports `complete: false` with reasons; the Python secret patterns agree with the Go pattern names (test); and the reader opens no network socket.
- Surfaces: `plugins/yakka/client/yakka.py` (a new reader section, with its entry in the shim's fixed reader table as #177 defines it, or a standalone function until then), new tests beside `test_secrets.py`, `docs/design/04` (the declared-context table), the plugin version.
- Approach: known
- Depends on: nothing

### Phase 2 — Review packet and prompt policy

- Outcome: A Go test over a fixture capture and criteria shows `Build` is a pure function whose output is byte-identical across runs and whose sections run ROLE, OUTPUT CONTRACT, CRITERIA with stable ids, coverage summary, UNTRUSTED CONTEXT; a lockfile hunk and a plan run artifact present in the received capture are moved to the manifest by the server's own policy; a diff above the budget truncates whole files in the documented order and marks `coverage: partial`; criteria above the budget are `refused_capture`; untrusted content containing the content-derived delimiter is `refused_capture`; a secret-shaped string in criteria text, a path or the manifest is `refused_disclosure` naming the pattern and no output byte contains it; sentinel build-model, session, tenant, user and commit-message strings appear in no byte of the prompt; `capture_id` is recomputed by the server from the received canonical form and a mismatching `diff_sha256` is an error; and the package makes no network call and reads no environment variable (asserted by test).
- Surfaces: new `packages/yakka/internal/review/` (packet, prompt policy, and the embedded policy values file the declaration and the trial manifest both read), `internal/secrets` (the scan it calls), tests beside them.
- Approach: known
- Depends on: nothing

### Phase 3 — Criteria resolution from the artifact store

- Outcome: Against a two-tenant fixture store, populated only through ingest so it holds only what the store can hold (several versions of a `DESIGN.md`, briefs, a `reports/` file, a `briefs/remediation-*` brief, a rejected version, a version awaiting screening and a flagged one), `plan` with `phase` returns the phase's criteria with stable ids and a recorded `{repo_id, path, content_hash, screen state}`; `brief` returns the brief's criteria; no reference with `criteria_text` returns explicit text with its own hash; neither returns the `criteria: none` marker; unpinned resolves the newest non-rejected version; a pinned version older than the newest is `criteria_stale` and resolves only with `allow_superseded`, its text equal to that version's text and containing nothing from a later revision; `criteria_not_found`, `criteria_ambiguous` (a slug matching two plan folders, a duplicate phase heading, two repositories), `phase_not_found`, `criteria_version_unknown` and `criteria_unavailable` each return their code with no criteria set; a `reports/` file or a `briefs/remediation-*` brief never resolves as a source (and a path for `REVIEW.md`, `IMPLEMENTATION.md`, `QA.md` or `PLAN.md` is `criteria_not_found`, since none can be in the store); a reference plus `criteria_text` resolves the reference and reports `ignored: criteria_text`; and the other tenant's artifact never resolves.
- Surfaces: `packages/yakka/internal/review/` (resolver), `internal/store` artifact reads (`Tenant.Artifact`, `store.go:929-938`, which exposes screen and rejection state) and the path classifier (`internal/keys`), tests with a two-tenant fixture.
- Approach: known
- Depends on: nothing

### Phase 4 — Review handler, single call, record and availability

- Outcome: Against an injected fake Claude-shaped endpoint, `POST /v1/reviews` with a `read_write` token and a Phase 1 capture runs the whole review, and every status in the contract has a scenario that yields exactly that status, only the valid-reply scenario with complete coverage yielding `ok`: a valid reply stores one `review_run` fact through the ingest function with validated findings, the configured and returned model ids, provider-reported tokens, latency and cost from the pricing table; timeout and 429/5xx give `timeout`/`api_error` with the bounded retry as a second attempt with its own cost inside the one record; unparseable JSON, missing or duplicate criterion ids and bad enums give `invalid_output`; a finding with unsupported or short evidence is kept and flagged `unsupported`; a reply containing a secret-shaped string is stored redacted and flagged `reply_redacted`, never rejected by ingest; a repeated key is `skipped_duplicate` naming the first review with no request, and a changed `build_models` or model is a new review; the cap reserves worst-case cost atomically (two concurrent calls that together exceed it cannot both proceed, and a timed-out call stays charged at its reservation), and an exceeded cap or in-flight limit is `skipped_budget` before any request; a missing credential, model, cap, an unlisted `<tenant>/<repo_id>`, an unpriced model or local mode each give `unavailable` naming the setting with zero outbound requests; a 401 gives `unavailable: credential_rejected` and no other credential is tried; the request is one body with no tools and no streaming and the credential appears only in the authentication header; a sentinel credential value appears in no record, log, error, reply or prompt, and a build-model sentinel is in no request body; `build_models` is required and stored (a list, or `unknown`) and omitting it is an argument error recording nothing; `refused_criteria` carries the Phase 3 code; `session_binding` is `bound`, `ambiguous` or `unbound` with a synthetic conversation id and never a guessed session; `review_run` facts are excluded from conversation, hook-event and facet counts (golden test); the captured input is stored by hash in the review-input area, is not seen by the screen worker or sent to the scorer, and is never returned in a reply; `GET /v1/reviews` filters by repo, plan, phase, kind, status and time under read scope, returns `build_models` and cost, and never returns another tenant's record; a `read` token is refused on `POST`; `dry_run` returns the estimate and manifest, calls no model and records nothing; and the env table in `docs/design/03` lists `CLAUDE_API_TOKEN` as server-only with `YAKKA_REVIEW_MODEL`, `YAKKA_REVIEW_USD_CAP` and `YAKKA_REVIEW_REPOS`.
- Surfaces: `packages/yakka/internal/review/` (client, validator, record, availability, spend reservation), `internal/ingest` (the `review_run` fact type), `internal/store` (reads, review-input area, `pricing.go`), `internal/serve/serve.go` (`ConfigFromEnv`, the `POST` and `GET /v1/reviews` routes and their body cap), `docs/design/03`.
- Approach: known
- Depends on: Phases 2 and 3

### Phase 5 — The MCP tool, shim registration and stage wiring

- Outcome: With #177 landed, `tools/list` through the shim returns `review_change` with its description, schema, required scope, timeout, `local_actions: []` and the declared context (`change` with its policy parameters, `project_dir`, `cwd`, `git`, and `session_hint` when plan 22 supplies it), and removing the tool from the server's registry removes it from the shim's list, so the shim holds no definition of it; from a fixture repository, an `uncommitted` call and a `range` call through the shim to a server wired to the fake endpoint each store a record and return a receipt (`detail=full` also returns validated findings, and no call returns captured content); the same arguments and capture sent to `POST /v1/reviews` yield the same receipt; a `read` token is refused; an agent-supplied `_local` is overwritten; a plugin lacking the reader gets `capture_unsupported` naming the update; a capture over the MCP route's body cap is an explicit error; across a call, in each status, the fixture repository and its plan folder are byte-identical before and after and the tool's absence, unavailability or failure leaves the calling stage's gate, verdict, commit and report unchanged; and the `execute`, `post-build` and `comprehensive-review` skill texts each name one non-gating `range` call with `build_models` taken from the run record or `unknown` (a presence check, since the stages are agent prose), with `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md` and `docs/design/04` describing the tool as existing and the plugin version bumped.
- Surfaces: the tool registration, declaration and route files #177 names, `internal/serve` (MCP route body cap, long-call handling), `plugins/yakka/client/yakka.py` (reader registration only), `plugins/yakka/skills/execute/SKILL.md`, `plugins/yakka/skills/post-build/SKILL.md` and its briefs, `plugins/yakka/skills/comprehensive-review/SKILL.md`, `plugins/yakka/.claude-plugin/plugin.json`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `docs/design/04`, `tools/driver/check_skills.py` where its checks apply.
- Approach: known
- Depends on: Phases 1 and 4, and the MCP shim issue (#177)

### Phase 6 — Historical case manifest and comparators

- Outcome: `tools/shadow-review-trial manifest` over this repository's local history writes a frozen, hashed manifest listing every candidate with its eligibility result and reason; eligible counts per stratum (phase, PR, unaccompanied) against the target of 100 with the shortfall stated; the shallow-history boundary; and per case the base and head, the capture's `diff_sha256`, the criteria used (a pinned `content_hash` or explicit text built from the blob at `head`, marked by source), the build models as curated evidence or `unknown`, and comparator pointers as `path@sha:blobhash`. A test shows a case's capture contains no object created after its head and never its comparator; a curated comparator file (finding, blob and line citation) validates against the manifest and is hashed into it; a locally supplied PR-review export is accepted as additional comparator evidence keyed by head SHA with its own hash (fixture-proved); and the phase and PR comparators stay linked separately.
- Surfaces: new `tools/shadow-review-trial/` (manifest, comparator format, README with the four-field layout `tools/release/test_layout.py` expects), the Phase 1 reader it imports, `tools/README.md` table.
- Approach: known
- Depends on: Phase 1

### Phase 7 — Trial run, dry run and alignment report

- Outcome: `tools/shadow-review-trial run --dry-run` over a manifest, calling `POST /v1/reviews` with `dry_run` on a server wired to the fake endpoint, makes zero model calls and prints per-case estimated tokens and projected cost, and refuses when the projection exceeds a supplied cap; `report`, fed review records read from `GET /v1/reviews`, a comparator file and manual adjudications, emits the fixed rubric categories (historical findings matched, partial, unmatched with context-limitation tags; new findings matched, partial, disputed, new-valid, unadjudicated) with every denominator (attempted, eligible, each status, historical findings, new findings, adjudicated), cost, token and latency totals against the cap, and outcomes by build model and by reviewer model with `unknown` as its own row; a `smoke` subcommand against the fake endpoint prints the evidence record (review id, status, returned model id, tokens, cost, a `read`-scope refusal) and no credential; and a three-case rehearsal against the fake endpoint completes manifest, run, adjudication fixture and report end to end.
- Surfaces: `tools/shadow-review-trial/` (run, report, smoke), the Phase 4 REST entry it drives with the user's Yakka login, a lab record location under `docs/lab/RESEARCH/` for the later trial and smoke reports.
- Approach: known
- Depends on: Phases 4 and 6

## Provenance Notes

- **What changed from the first draft**: the six Intent additions moved the provider credential, the call, the prompt and exclusion policy, the output validation and the record to the Yakka server, made the review an MCP tool with a collection-only shim, made criteria a server-side reference, tied tracking to the existing fact and correlation model, and added a required build-model field kept out of the prompt. The client-side provider config, per-user key, endpoint allowlist, proxy handling, local JSONL ledger, `yakka shadow-review` command and DeepSeek default are gone, not retained beside the new shape. Kept from the first draft, adapted: the fixed prompt order, the result schema and its mechanical validation, the status vocabulary, the exclusion manifest and truncation record, the disclosure gate, the trial's eligibility, leakage, comparator, rubric and shortfall rules, and the adjudication policy.
- **Why the dependency on #177 is stated rather than designed around**: recon found no endpoint, declared-context carrier or directive mechanism in code; plans 21 and 22 specify them and name #177 as their builder. Building a second mechanism would be a parallel pipeline; this design names what it needs of the first.
- **Why Phase 5's wiring stays in**: the offline backtest (Phases 1 to 4, 6, 7) answers the question only for the thin local history; live accrual at each phase and PR is the only way to grow the evidence, and it is the intent's "alongside existing ones".
- **Schema scope**: each result field traces to the intent's "similar review" and to alignment needs: severity, path, line, evidence and title are what matching needs; `confidence`, `criterion_ids`, `limitations` and `coverage` make the review comparable and honest; `lens` and `verdict_hint` map to the existing review vocabulary; `ok_partial` and `skipped_duplicate` serve the failure accounting. A field with no such trace should be cut at refine.
- **Per-phase "review" is thinner than the intent assumes**: the phase-level comparator is verification and carried items, not a review; the phase stratum may be small and the report will say so.
- **Rejected**: a per-machine provider key or client-side provider selection (the additions rule it out); reusing the Jev scorer for the review (a fixed-schema scoring service that discards usage); reusing the driver's provider layer (stubs); a second price list; padding the trial with squash-merge diffs lacking review records; a job queue for the call (the existing ingest and worker pattern is the stated fallback); copying comparators into review records.
- **Repository identity evidence** (Ground): `git remote -v` says `codyhamilton/workflow-plugin`; `install.sh:4`, `.cursor-plugin/marketplace.json:21`, `plugins/yakka/bin/RELEASE_URL:1`, `packages/yakka/go.mod:1`, `packages/*/package.json`, `fly.toml:7`, `README.md:118,170,356` say yakka. Residual `workflow-plugin` text: `docs/lab/CONSUMING_REPO.md:15,49`. Residual non-rename names: cookie `workflow_session` (`internal/serve/session.go:17`), Fly volume `workflow_serve_data` (`fly.toml:32`). The GitHub-side state, unverifiable while the design was drafted offline, was verified on 2026-11-07: `codyhamilton/workflow-plugin` resolves to the canonical `codyhamilton/yakka` (default branch `master`).
- **Discrepancies reported, not fixed** (none relied on): `docs/OVERVIEW.md:5` names live `PostToolBatch` signals that `CHANGELOG.md:11` removed; the `login` skill is missing from the overview and architecture tables; `tools/driver/report.py:67` writes a `workflow-report` fence while `CHANGELOG.md:176` says writers emit `yakka-report`; both marketplace manifests still say "Private workflow plugin marketplace"; `tools/driver/README.md:102,114` says run-record files are gitignored but the root `.gitignore` does not match them; `serverInfo.version` reads `bin/VERSION` (0.3.0) while `plugin.json` says 3.4.0; `docs/design/05-distribution.md:22` says VERSION is unused by the wrapper. The `Workflow-Plan:` mentions in `docs/automation/post-build.md` were fixed here because PR-level correlation relies on the marker.
- **Adversarial pass** (one clean-context Sonnet, on this revision) found 14 issues (2 blockers); all applied except where noted. Applied: criteria and comparators no longer assume `PLAN.md`, `REVIEW.md`, `IMPLEMENTATION.md` or `QA.md` are in the store (only design, brief and report paths are; comparators are git blobs pinned in the manifest); a REST entry (`POST /v1/reviews`) behind the same handler makes the review and the trial provable without #177, which now blocks Phase 5 only; the "no client policy" claim is split into server-declared policy values and client reading mechanisms; captured input moved out of `blobs/`, which the screen worker sweeps to the scorer; a server-wide cap with atomic worst-case reservation, tenant-qualified allowlist and an honest statement that `repo_id` is client-asserted; one status and error taxonomy (argument and capture errors record nothing, everything after is a recorded status, `refused_criteria` carries the code); `capture_id` and which bytes `diff_sha256` covers defined; plan 21 citations corrected to the amended branch; reply redaction so a paid review cannot be rejected by ingest; `verdict_hint` and `force` cut; behavioural replacements for string-diff outcomes; ledger 28 and 29 and a retention open question. Applied differently: the stale-marker doc fix is kept in this branch but as its own commit, separate from the design; making the trial's explicit-criteria path stricter, since the store cannot hold historical versions it never ingested.
- **Ground sources**: first draft, four Haiku recon reports (repo identity, review surfaces, code and conventions, historical data); this revision, four Haiku recon reports (server-defined tools and local context, artifact store and tracking, server LLM calls and Fly configuration, local client git and secrets) plus direct reads of plans 21 and 22. Phase and commit counts (14, 18, 9) are from local `git log --all` on a shallow checkout and are estimates until the manifest is built. Plan 21 and 22 are read as designs; plan 22 is unmerged and may change, and plan 21's amended boundary text is read from its local worktree branch, not from master.
