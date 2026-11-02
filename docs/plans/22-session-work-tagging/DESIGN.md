# Session work tagging

## Intent

User request, verbatim:

> Work only in ~/workspace/yakka-wt/22-session-work-tagging (branch docs/22-session-work-tagging, off origin/master). Don't touch any other checkout or worktree. Don't push, open a PR, merge, or touch master. Commit on the branch when done.
>
> Follow the Yakka design skill (plugins/yakka/skills/design/SKILL.md in this worktree), headless: no human sign-off step; record every judgement call in an assumption ledger with open questions for Cody. Write the design as docs/plans/22-session-work-tagging/DESIGN.md.
>
> Task: design GitHub issue #175 (codyhamilton/yakka), text in ~/workspace/yakka-design-logs/22-session-work-tagging/issue-175.md (or `gh issue view 175 -R codyhamilton/yakka --json body`). Yakka maps sessions to cost but not to the work they did. Design: an action-recording endpoint (several actions per session), SessionStart tagging from env vars that `harness pick` exports on queue launches, an MCP tool for manual tagging/changing mid-session, cost queries by plan/phase/issue/PR/kind via MCP and API, and support on all four harnesses (Claude Code, Codex, OpenCode, Cursor). The issue's env var contract is a draft: confirm or change it, giving the final names, formats, required/optional, and who sets each. Malformed values must never block a session. Keep the vars separate from YAKKA_ENDPOINT/YAKKA_KEY.
>
> Constraint: Plan 21 (branch docs/21-feedback-delivery, not yet merged; local only; read it read-only via `git show docs/21-feedback-delivery:docs/plans/21-feedback-delivery/DESIGN.md` once committed, or the files in ~/workspace/yakka-wt/21-feedback-delivery/docs/plans/21-feedback-delivery/ while it is in progress; never edit that worktree) changes client remote/fallback behaviour. Don't conflict with it; state the interaction.
>
> Phases must each close with a provable outcome. Name the earliest phase the harness side (Coding Harness Manager wiring `harness pick` to export the env vars) can start against. Finish with a short summary: commit hash, final env var contract, endpoint and MCP tool shapes, phases (with that harness-side phase marked), rough build size, and the ledger's open questions.
>
> Start recon, exploration and inventory subagents with model: haiku; use Sonnet subagents only for adversarial review or deep reasoning, at most two at a time.
>
> Decided input from Cody: session-to-work correlation events are submitted through the existing client queue/drain system. Tagging just enqueues an event, it drains with everything else, and the server processes it asynchronously. No separate synchronous action call is needed for submission.
>
> Decided input from Cody, the back-fill for existing sessions (see https://github.com/codyhamilton/yakka/issues/175#issuecomment-6569357390): pass 1 extracts subject and phase deterministically from plan files, issue and PR numbers in the prompt, files read, cwd and branch, and queue logs. Pass 2 runs TypeSafe on the prompt to classify kind from a small closed set, with a confidence score. Pass 3 is a human review of only the low-confidence results plus a check sample.

Issue #175 ("Link sessions to the work they did (plan, phase, issue, kind) for cost reporting") is the problem statement.

## Problem

Yakka already ties a session to its cost: every fact carries a `conversation_id`, and cost is priced at query time from per-fact tokens and model. Nothing ties a session to the work it did. So Yakka cannot report cost per plan, per phase, per defect fix or per kind of work. The weekly cost review guesses from prompt text, file paths and branch names, and the guesses leave gaps. Queue launches on codyh-ubuntu already know exactly what each session is for (plan, phase, action, issue); that knowledge is discarded at launch.

Two existing facts shape the design. The server already derives a `plan` dimension from `docs/plans/<name>/` file paths on artifact facts, but that is a property of a file, not of a session, and says nothing about phase or kind. And the client has no way to learn its own session id outside a hook, which matters for any MCP tool that must say which session it tags.

## Solution Shape

A new fact type, `session_action`, is projected asynchronously on the server into a `session_actions` table. Three sources write it. The SessionStart hook reads the `YAKKA_ACTION_*` environment that `harness pick` exports and writes it to the client queue, and a back-fill tool writes the same way; the Python drain sends both to `POST /v1/ingest` with everything else. The third source is the MCP tool `record_action` for interactive sessions, which is a tool on the server's MCP endpoint: the server validates the call against the action contract and records the fact through the same ingest and projection path. A session holds a sequence of actions; each owns the span of the session from its start until the next action begins, so cost splits cleanly when work changes mid-session. Cost is read by joining cost-bearing facts to the action in force at each fact's timestamp, through new dimensions on the existing `/v1/analytics/query` and an MCP tool `work_cost`, also on the server. Untagged, rejected and low-confidence cost is reported as its own bucket, never hidden or folded in.

There is no new write route. The "action-recording endpoint" the issue asks for is `/v1/ingest` accepting `session_action` facts (decided by Cody: correlation events go through the ingest path, with the projection asynchronous), reached from the queue by the drain and from the server's own `record_action` handler. The only new HTTP route is a read, `GET /v1/actions`. The MCP endpoint itself is not built here (see Constraints).

The Python client (`plugins/yakka/client/yakka.py`) is the only client, and the Go binary in `packages/yakka` is server-only (decided by Cody; see Decisions). What stays on the agent's machine is the hooks, the spool and the drain, and the MCP shim, which is a thin wrapper that holds no tool definitions or logic (decided by Cody, see Decisions): it adds the bearer key and the local context the server declares to a call, and forwards `initialize`, `tools/list` and `tools/call` to the server's MCP endpoint unchanged. This design adds no tool logic, description, schema, wording or validation to `yakka.py`; its only possible client-side addition for tools is one local-context provider (Domain "MCP tools"). All of that is on the server's MCP surface (domain "MCP tools").

### Domain: Action contract

- Owns: the closed vocabularies and validation rules for an action: kinds, subject types, id formats, normalisation, and rejection reason codes. One contract file in the Go server package (`internal/actions`) is the single source of truth. It is used for server-side validation in two places: the projection, which stores a rejected action with its reasons, and the `record_action` tool, which refuses an invalid call. No client holds a copy of the vocabulary or the validation: not `yakka.py`, not the MCP shim, not the OpenCode plugin. The only client-side rule is the length transport guard in Capture. Its cases sit in one fixture table (inputs and expected normalised action or reason codes) beside the contract file, which the server's contract test runs and the OpenCode plugin's test reads for the length cases only (Assumption 29).
- Contract:
  - `kind` ∈ `design, refine, build, review, fix, close-out, sync, escalation, triage, research`. (`unclear` is not a kind; an unclassifiable session gets no action.)
  - `subject_type` ∈ `plan, github`.
  - `subject_id`, lowercased as a whole after trimming: plan → `<owner>/<repo>:plan/<name>`, where `<name>` matches `[a-z0-9][a-z0-9._-]{0,99}` and is a `docs/plans/` entry name without `.md` (for example `22-session-work-tagging`); a name that is all digits (`…:plan/158`) is the bare-number form and is accepted and stored as given. github → `<owner>/<repo>#<number>` (issue or PR; the server does not tell which). Owner and repo match `[a-z0-9][a-z0-9._-]*`.
  - `phase`: integer 1–99, optional. `repo`: `<owner>/<repo>`, optional, lowercased, no host. `pr`: positive integer, optional. Integer strings may carry leading zeros.
  - **Which subject.** When the work belongs to a plan, the subject is the plan (`subject_type=plan`) and `pr` carries the PR, including for review, fix and sync on that plan's PR. `github` is for work not tied to a plan (a defect issue, an unplanned PR). Cost for a plan's PR work is then part of that plan's cost; a launcher that tags plan work with a `github` subject takes that work out of `action_plan` queries.
  - Length: no value may exceed 256 bytes (UTF-8, after trimming); a longer one is rejected `too_long`. `spool.sh` and the OpenCode plugin strip control characters, then, if a value is longer than 256 bytes, cut it at the first character boundary at or after byte 257 (so at most 260 bytes), which keeps it over 256. This is a transport guard that keeps queue files small, not a copy of the contract: a value that was over-length on the agent's machine is still over-length when the server sees it, so a truncated value is never accepted and a value of 256 bytes or fewer is never touched.
  - Rejection reason codes: `missing_required:<field>`, `unknown_kind`, `unknown_subject_type`, `bad_subject_id` (matches neither id form), `subject_type_mismatch` (the id is well formed for the other type), `bad_phase`, `bad_repo`, `bad_pr`, `too_long`. A rejected action stores every reason that applies.
- Non-goals: resolving whether a `#N` is an issue or a PR (that needs the GitHub API); merging `plan/158` with `plan/158-foo`; inferring `subject_type` from the id.

### Domain: Capture (client and hooks)

- Owns: reading the `YAKKA_ACTION_*` environment at session start and turning it into a queued fact. The hooks, the spool and the drain stay local. The queue-file parser and fact builder (`_parse_file`, `Build`) and a new enqueue writer are in `yakka.py`. The enqueue writer serves the back-fill and review tools only; none exists there today, since hooks enqueue through `spool.sh` and the OpenCode plugin writes its own queue files. `record_action` does not use it (the server records that action).
- Contract, **environment variables** (final; set by `harness pick` on the launched process only, never in a profile; a human may export them by hand for an ad-hoc session; the plugin and the client never set them):

  | Variable | Required | Format | Example |
  |---|---|---|---|
  | `YAKKA_ACTION_KIND` | yes | one kind from the closed list | `build` |
  | `YAKKA_ACTION_SUBJECT_TYPE` | yes | `plan` or `github` | `plan` |
  | `YAKKA_ACTION_SUBJECT_ID` | yes | per the Action contract | `codyhamilton/garcia-music:plan/158-ledger`, `codyhamilton/garcia-music#1025` |
  | `YAKKA_ACTION_PHASE` | no | integer 1–99 | `2` |
  | `YAKKA_ACTION_REPO` | no | `<owner>/<repo>` of the repo the work is done in (and where `YAKKA_ACTION_PR` lives); when absent the server resolves it, at query time, to the session's own repo | `codyhamilton/garcia-music` |
  | `YAKKA_ACTION_PR` | no | positive integer | `1083` |

  Rules: if none of the six is set (an empty value counts as unset), no action is recorded and the session is captured exactly as today. If any is set, one action is recorded; a missing required field or a malformed value gives a recorded `rejected` action with its reasons, never an error to the harness and never a changed exit code. The client does not judge a value: the server, not the client, rejects it. The vars are read once, in the harness's own environment, on the session-start event only; they are never read by the drain (a detached background process whose environment may differ). Nothing in the Python client's `Load()`, `ErrPartialEnv` or any config path reads them, and setting only `YAKKA_ACTION_*` never triggers the one-of-`YAKKA_ENDPOINT`/`YAKKA_KEY` error. The plan name given for one plan must be the same string on every launch: CHM sends the `docs/plans/` entry name consistently (Assumption 3).
- Contract, **queue form and fact**. A session-start tag rides on the session-start event's own queue file: the envelope's first line gains an optional `action` object of raw strings, and the Python drain emits the usual hook event plus one `session_action` fact. An action from the back-fill or review tools is its own queue file whose envelope names event `yakka.session_action`, carries `source`, `action` and the optional fields below, and whose payload is empty; for that event the fact builder emits only the `session_action` fact, never a `hook_event`, so no phantom hook events or conversations appear. The parser and builder decode `action` tolerantly: non-string members are read as their string form, invalid UTF-8 is replaced, and a bad `action` never makes the file unparseable. They do not validate it. The fact, which has the same shape whether the drain sends it or the server's `record_action` handler builds it (the handler stamps `ts` at receipt, sets `source:"mcp"` and `id` to `mcp:<conversation_id>:<ts in milliseconds>`, and takes `harness` from the conversation's existing facts, or `"unknown"` when the server holds none yet; ingest takes any non-empty `harness` string, so `unknown` is accepted):

  ```
  {"type":"session_action","id":"<queue file>#<n>","conversation_id":"…","harness":"claude|codex|opencode|cursor|unknown",
   "ts":<epoch seconds>,"source":"env|mcp|backfill|review",
   "action":{"kind":"…","subject_type":"…","subject_id":"…","phase":"…","repo":"…","pr":"…"},   // strings as received
   "method":"deterministic|typesafe|human",  // backfill and review only
   "confidence":0.0–1.0, "evidence":"≤300 chars, secret-scrubbed by the sender"}   // backfill only
  ```
- Non-goals: any network call at hook time; Python or JSON parsing in `spool.sh`; setting the vars; Cursor Cloud, which registers no `sessionStart` hook (documented limit).

### Domain: Record and projection (server)

- Owns: accepting `session_action` facts (from `/v1/ingest`, and from the `record_action` handler, which stores its fact through the same ingest function), the asynchronous projection into `session_actions`, and the read API.
- Contract:
  - Ingest accepts a `session_action` fact whenever it is structurally a fact with a `conversation_id`. It never answers 4xx or `rejected` for a bad action value; value errors surface only in the projection. Exceptions, as for every fact: a missing `conversation_id`, and the secret-scan precheck (a value that merely resembles a credential is refused, and its file lands in `rejected/` where `yakka status` shows it; the session is unaffected).
  - Existing views stay as they were: `session_action` facts are excluded from conversation counts, `hook_events` counts and the source and other facet queries, proven by a golden test that seeds them.
  - A projection step in the tenant worker handles unprojected `session_action` facts. It runs whether or not scoring is enabled and whether or not the scorer is reachable, on its own cadence (at most 10 seconds between runs, shortened by a setting for tests) rather than behind the screen step's backoff; a fact that fails to project is retried up to three attempts and then recorded as failed, never stalling screening or other facts. The store records each fact's projection state so `pending` is exact. A store migration adds `session_actions`, one row per fact: its conversation, `started_at`, `source`, `method`, `confidence`, `status` (`accepted|rejected`), `reasons`, the normalised fields and the raw strings.
  - **Segments** are a pure function of all of one conversation's `session_action` rows, recomputed for that conversation whenever one is projected, so arrival order never matters. Live actions (`env`, `mcp`) start at their fact `ts`; ties are ordered by the fact's hash. Each effective action is valid from its start to the next one's, the first from the beginning of time (so facts that arrive late, or earlier than the first tag, still fall in it). An action equal in all normalised fields to the one in force adds no segment (SessionStart re-fires on resume and compact).
  - **Whole-conversation actions.** `backfill` and `review` actions have no start: each labels the whole conversation. Within one source the latest `ts` wins (and for `backfill`, higher `confidence` first).
  - **Precedence.** If the conversation has any accepted `review` action, only it counts. Otherwise accepted `env`/`mcp` actions form the segments. Otherwise the accepted `backfill` action applies. Rejected actions never count, so a later back-fill can still label a conversation whose live tag was rejected. A session resumed under a different launcher's tag has all its earlier untagged or back-filled time billed to the new tag; `review` corrects it.
  - `GET /v1/actions?conversation_id=&plan=&kind=&status=&source=&max_confidence=&limit=` (bearer read scope) returns projected rows; `plan` is an exact match on the normalised plan name; `pending`, the count of the conversation's unprojected facts, is returned when `conversation_id` is given.
  - `GET /v1/admin/status` gains an `actions` block: conversations tagged and untagged in the last 7 days, rejected counts by reason code, and failed projections.
- Non-goals: a synchronous projection (a `record_action` call returns once its fact is stored, not once it is projected); a new write route; retroactively rewriting history when the contract changes (a new kind needs a server release, then re-projection from stored facts).

### Domain: Cost by work (server query and MCP)

- Owns: the join from cost-bearing facts to segments, and its exposure.
- Contract:
  - The cost measures (`cost_usd`, `tokens_*`, `model_calls`, `unpriced_calls`, plus a new per-bucket distinct-conversation `sessions`) gain dimensions and filters `action_kind`, `action_plan` (plan subjects only), `action_phase`, `action_subject` (the `subject_id`), `action_pr`, `action_source`. These are served on the existing in-memory usage aggregation, not the SQL dimension tables, and join each priced call to the segment whose span contains the call's `ts`. A call with no segment falls in `(untagged)`; a call whose conversation has only rejected actions falls in `(rejected)`. Any other measure given an `action_*` dimension or filter is an error, not an ignored filter. Queries using no `action_*` field return exactly what they did before.
  - A query may combine up to three dimensions when they are `action_*` (plan × phase × kind). `(untagged)` and `(rejected)` are exempt from top-N folding, and a result's buckets sum to the total of the same filters and window. A tagged call whose dimension has no value (no `phase`, no `pr`, a `github` subject under `action_plan`) falls in a `(none)` bucket. `(untagged)` and `(rejected)` appear whenever they have cost in the result; an `action_*` filter excludes them, since those calls carry no accepted action. A rejected action never ends a segment: its time stays with the accepted action before it, or in `(untagged)` if there is none; `(rejected)` holds only calls of a conversation that has no accepted action at all.
  - Cost is still priced on read; nothing is stored. `unpriced_calls` is reported per bucket so a harness with no per-session pricing is visible as unpriced, not as $0.
  - MCP tool `work_cost` (read-only) exposes the same query on the server's MCP endpoint; its definition is in the domain "MCP tools".
- Non-goals: a dashboard page; allocating cost within a segment; per-agent attribution inside a session; grouping by repo, harness or model through this tool (the existing dimensions already do).

### Domain: MCP tools (server surface)

- Owns: the two tools this design adds, `record_action` and `work_cost`, and the binding of a `record_action` call to its session. Every definition below lives on the server's MCP endpoint, in the tool registry the MCP shim issue (number to follow) builds. Nothing here is in `yakka.py` except, possibly, one local-context provider.
- Contract, **shim boundary** (decided by Cody; the MCP shim issue builds it). The shim holds no tool list, descriptions, schemas, instructions, argument validation, state logic or wording. It forwards `initialize`, `tools/list` and `tools/call` and relays replies unchanged. It may add two kinds of parameter to a forwarded `tools/call`: (a) auth, the bearer key from the one shared login that the drain also uses; (b) local context, which is a value that can only be read on the agent's machine (file content, a resolved path, git identity, local queue and drain facts). The server declares, per tool in its `tools/list` entry, which local context the shim must add; the shim hard-codes none per tool. This design fixes the context parameter names and meanings below. The carrier (how a definition declares them and where in the call they go) and the providers for `cwd` and `repo_id` are the shim issue's. The `session_hint` provider, and the hook-side pointer it reads, are Phase 4's, and are built only if Phase 4 keeps `session_hint`. A tool with no declared context gets auth only.
- Contract, **`record_action`** (not read-only; idempotent in effect: repeating the action already in force adds nothing, Record domain):
  - Description (as the server serves it): "Record what this session is working on, so its cost is reported against that work: the kind of work, and the plan or the GitHub issue or PR it belongs to. Call it again when the work changes; the earlier action ends where the new one begins. Kinds: design, refine, build, review, fix, close-out, sync, escalation, triage, research. A plan's subject_id is owner/repo:plan/<docs/plans entry name>; an issue or PR is owner/repo#N."
  - Input: `kind`, `subject_type`, `subject_id` (required), `phase`, `repo`, `pr` (optional), `session_id` (optional escape hatch). The definition's schema lists `kind` and `subject_type` as enums; the server validates every field against the Action contract regardless of the schema.
  - Declared local context, injected by the shim: `cwd` (absolute path of the shim's working directory), `repo_id` (the git repo identity the client computes for that cwd, as `artifact_feedback` does today: normalised remote, or `root:<sha>`), and `session_hint` (the session id the session-start hook recorded for this harness process and cwd, if it recorded one; absent otherwise). A call with none of them still works when `session_id` is given.
  - Instructions: the server's MCP `instructions` gain one sentence in the style of plan 21's feedback sentence: "When you start work on a plan, issue or PR, or change to a different kind of work, call record_action so its cost is attributed to it; call work_cost to see cost by plan, phase, issue, PR or kind."
  - Validation and behaviour: validates with the Action contract. Invalid input returns a tool error naming every reason code that applies and records nothing (the reply text: `not recorded: <codes>`, then one line of fix per code); the tool never records a `rejected` row. A value that trips the secret scan is refused the same way, naming the pattern and never the value. On success it builds a `source:"mcp"` fact, stores it through the ingest function, and returns `recorded` with the normalised action, the session it bound to, and the line "reported in work_cost once projected". Projection stays asynchronous. The call needs the server, so it does not work offline (Assumption 31).
  - Binding: with `session_id`, that id is used (the reply says so when the server holds no facts for it yet, since the session's own facts may still be queued). Without it the server resolves the calling session from the declared context by the mechanism Phase 4 settles; if it cannot do so unambiguously it returns `ambiguous_session` and the candidates it saw, and records nothing. It never writes to a guessed session.
  - Changing work mid-session is another `record_action`; the earlier action's segment ends where the new one begins.
- Contract, **`work_cost`** (read-only): description "Cost by the work it was spent on, from the session tags. Group by plan, phase, kind, subject, pr or source; filter by plan, subject, pr, kind and time. Untagged and rejected cost is shown as its own rows unless a tag filter excludes it." Input `group_by` (array of up to three from `plan, phase, kind, subject, pr, source`; default `["kind"]`), filters `plan`, `subject`, `pr`, `kind`, `since`, `until`. Declared local context: none, so the shim adds auth only. Output: one row per bucket (`cost_usd`, tokens, `sessions`, `unpriced_calls`), the untagged and rejected buckets present when they have cost and no tag filter is set, and a total that reconciles with the total of the same filters and window; the rows equal what `/v1/analytics/query` returns for the same filters, as it is a view over that query.
- Non-goals: editing or deleting a recorded action (a correction is a later action, or a `review` fact); a `list_actions` tool (`work_cost` and `GET /v1/actions` cover reads); any logic, wording or validation in `yakka.py` or the shim; a client-side session-id lookup other than `session_hint`.

### Domain: Back-fill

- Owns: classifying past sessions into `session_action` facts, in the three passes Cody decided.
- Contract:
  - Runs on codyh-ubuntu as a tool beside `tools/transcript/` and submits through the same enqueue writer and drain as everything else: facts carry `source:"backfill"`, `method`, `confidence`, `evidence`. One action per session; splitting a past session into several is out of scope. The conversation id of a past session is its own session id.
  - **A back-fill fact is a complete action or nothing.** The passes build up a local label (subject, phase, kind, each with its evidence); a fact is emitted when subject type, subject id and kind are all known, by whichever pass completes it. A session that never completes goes to the review file, not the server.
  - Pass 1, deterministic (`method:"deterministic"`): subject and phase, and kind where a queue log names it, from plan files and issue/PR numbers in the launch prompt, files read or written (`docs/plans/NN-*`, briefs, reports), cwd, branch and worktree name, and the queue logs in `~/workspace/.briefs/q` (`par-<plan>-<phase|action>-<harness>-N.log`, `par-status.log` for plan to PR). Confidence is 1.0 for a queue-log match and lower for inference.
  - Pass 2, TypeSafe (`method:"typesafe"`): a new TypeSafe schema, separate from the existing `jev_client.py` labels, classifying `kind` from the scrubbed, truncated prompt into the ten kinds or `unclear`, with a confidence. It supplies kind only; a session with no subject after Pass 1 stays incomplete. Prompts go through the client's existing secret scrub before leaving the machine.
  - Pass 3, human (`source:"review"`, `method:"human"`): every incomplete session and every result below the calibrated confidence threshold, plus a random check sample of the rest, exported to a file, edited, and imported as `review` facts.
  - Scope: Claude (~892 main and ~391 subagent transcripts), Codex (~1,871 rollouts), OpenCode (~2,670 top-level, excluding the 890 automated Flash runs from 6 Oct), Cursor (~1,030 agent transcripts), not de-duplicated across stores. Cost for a session shows in queries only where the server holds that session's facts (sessions after 23 Oct are on api.yakka.build).
- Non-goals: a local LLM (stays an option for what is still unclear after pass 2); a review UI; splitting sessions.

### Domain: Harness launch (external to this repo)

- Owns: Coding Harness Manager's `harness pick`: exporting the six vars on every queue launch, from what it already knows (plan, phase, action, harness, issue, PR), with the plan always given as its `docs/plans/` entry name and, for work on a plan's PR, the plan as subject and the PR in `YAKKA_ACTION_PR`. Validation of its own output is not required; the server records whatever arrives.
- Contract: the environment-variable table above. CHM can build and merge against it now; the vars are inert until Phase 2 ships, and a Phase 2 probe failure on a harness may add a channel to this contract by amendment (Assumption 8).
- Non-goals: anything in `plugins/`, `packages/` or `tools/`.

## Architectural Implications

- **Stable docs.** `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md` do not describe the capture and remote surface (they predate it and still say OpenCode is skills-only and Codex has no wiring); the capture contracts live in `docs/design/`. This design depends only on `docs/design/01`, `02`, `03`, `04`, `05`, which are current enough. Their sections to update, at the phase that changes them: `01` event model and normalised events, `02` queue envelope and the env contract, `03` the facts API and the read routes, `04` the MCP tool table (the server's MCP surface), `05` the environment-variable note. Plan 21 edits `02`, `04` and `05` in other sections (config resolution), so these edits are additive. Contracts that outlive the change are promoted at close-out to a new `docs/design/08-session-work-tagging.md`. The two stale docs are reported, not fixed here.
- **Constraint: depends on the MCP shim issue** (decided by Cody, 2 Nov 2026, about 10:57 PM AEST). The server has no MCP endpoint today: its routes are REST only, and all MCP logic (`_MCP_TOOL_LIST`, the `instructions` string, the `artifact_feedback` handler and its local reads) is in `plugins/yakka/client/yakka.py`, `# --- mcp ---`, about lines 1840-2514. The MCP shim issue (number to follow) builds the server's MCP endpoint and the thin shim, and moves the existing tools. This plan depends on it. Its two tools are registered on that endpoint, and no tool logic, description, schema, wording or validation is added to `yakka.py`. Phases 1, 2, 3, 5, 6 and 7 touch no MCP and can be built and closed before that issue lands. Phase 4 is the first to need it (the `record_action` and `work_cost` tools, which register on its endpoint) and cannot close until it has landed. Until then the tool contracts in domain "MCP tools" are the spec, and nothing is built against a guess at the endpoint's internals.
- **Constraint: one client; the Go binary is server-only** (decided by Cody, 2 Nov 2026, 10:45 PM AEST). The client side is `plugins/yakka/client/yakka.py` (queue-file parsing, the fact builder, the enqueue writer, the drain), the hook scripts, the OpenCode plugin and the shim. Go edits are server-side only: ingest, the projection, `/v1/actions`, the analytics and cost queries, the admin status block, and the two tool handlers on the MCP endpoint above. No phase edits `packages/yakka/internal/mcp`, `drain`, `facts` or `clientconfig`, the `drain`, `status` or `mcp` subcommands, or the serve-hosted drain in `internal/serve/host.go`. Those are being deleted under the Go client deletion issue (number to follow). This plan does not depend on that issue: if that code still exists when this plan is built, the build leaves it untouched, with no new features in it and no parity tests against it. `packages/hooklog/tests/fixtures` stay the Python client's fixtures (`test_facts.py` reads them, as the server's own tests read the ones they use).
- **Async by construction.** The projection is a worker step, not an ingest-path step (the existing `Derive` runs synchronously in ingest and is not used). It must run when scoring is off and when the scorer is unreachable, which today delays the screen step with a backoff of up to five minutes; the worker wiring in `serve.go` is a Phase 1 surface.
- **Cost depends on facts.** Cost per bucket is only as good as the per-session facts the server holds, and the segment split is only as exact as the timestamps on cost-bearing facts. Whether subagent usage carries the parent's `conversation_id`, whether Cursor sessions have per-session tokens (the Cursor usage export has no session join key), whether each harness's cost facts carry message time rather than import time, and how many of the ~6,500 older local sessions exist on the server are unverified and open (see Open Questions).
- **Rollout order.** A server without Phase 1 answers `invalid` to an unknown fact type, and the drain moves such a file to `rejected/` for good. The Phase 1 server must therefore be deployed before any plugin release carrying Phase 2 output (session-start tags) reaches a machine that drains to it, and before any Phase 5, 6 or 7 facts are enqueued. Phase 4's tools run on the server and emit no client fact, so they have no such ordering; its hook pointer for `session_hint` writes no fact.
- **Plan numbers are not keys.** `docs/plans/` already holds two plans numbered 13, and the design skill says the slug is the key. The issue's `plan/<NN>` form is therefore accepted but not recommended; the entry name is.

### Interaction with Plan 21 (feedback delivery)

Written against plan 21's `DESIGN.md` as merged to origin/master (6a757a8, seven phases), amended so that its client configuration conformance is Python-only (one table, run by the `yakka.py` tests). This section claims no shared Go file: this plan edits no client-side Go (Constraint above), and plan 21's client work is Python. Plan 21's build phases land separately. Plan 21 makes the client fail instead of falling back to `127.0.0.1:8770` when auth and a remote are configured (a `Resolve` contract returning Remote, Local or Error, with a new explicit `YAKKA_MODE=local`), reconciles written files at feedback and Stop, makes `delivered` say whether scoring ran, fixes how Codex calls feedback (the Yakka MCP already loads there; the gaps are `"cwd": "."` in `.codex-mcp.json` and no instruction to call it), retires the legacy MCP, and uploads the 37,931-event legacy Codex backlog once from a staged copy. Re-check this section against plan 21 as amended before Phase 4 is refined.

- **No new fallback path.** The hook, the back-fill and review tools and the drain add no config logic: tagging enqueues, and a drain with an Error config leaves queued files untouched, so `session_action` files stay queued like every other fact and are not moved to `rejected/`. `record_action` and `work_cost` are server tools, reached through the shim with the bearer key from the same login the drain uses. Which endpoint the shim contacts, and what it says when there is no login or the server is unreachable, is the shim issue's contract and plan 21's `Resolve` and failure contract. This plan adds neither, and carries no listener assertion on 127.0.0.1:8770.
- **Env vars stay out of config.** `YAKKA_ACTION_*` take no part in `Resolve`, the `YAKKA_ENDPOINT`/`YAKKA_KEY` pair rule, or the new `YAKKA_MODE`, and none of plan 21's rules read them. A `yakka.py` test sets only `YAKKA_ACTION_*` and asserts the resolved config is unchanged. The two plans' variable names do not overlap.
- **Fixtures.** Plan 21's conformance table covers config resolution only and is not used here. This plan's fixtures are the action-contract table (Action contract domain, server-side, with its length cases read by the OpenCode plugin test) and the Python client's `packages/hooklog/tests/fixtures`.
- **Shared files and ordering.** Both plans edit `plugins/yakka/client/yakka.py` and the hooks, in different places: plan 21 the drain and the fact builder (reconciliation at Stop and feedback) and the Stop and SessionEnd hooks; this plan the queue parser and builder for a new event and fact type, the enqueue writer, and `spool.sh` and `codex.json` (session-start only). Plan 21 also edits the MCP `instructions`, the `artifact_feedback` description and state wording, and `.codex-mcp.json`. Those edits are in `yakka.py` until the shim issue moves the tools to the server, and on the server after it; this plan edits none of them in either place, and adds only its own sentence and tools to the server's MCP surface. Where both plans touch that surface, `instructions` and the tool registry (files named by the shim issue), the edits are additive and whichever merges second rebases. Plan 21's Phase 4 surfaces scoring state from the service (the screen and score worker, `/v1/artifacts`, the admin operations page) and this plan's Phase 1 edits the worker wiring in `serve.go` and the admin status block; also additive. No phase is blocked on plan 21 except Phase 4's Codex row (its open question 1).
- **Codex.** MCP loading is not gated on plan 21 (it already loads). What plan 21 settles, and Phase 4 depends on, is its open question 1: whether Codex gives the MCP server the session's project directory. The shim's `cwd` context for `record_action` has the same dependency. If Codex does not give it, a cwd-based binding cannot work on Codex and Phase 4's Codex row falls back to the agent supplying `session_id` when the server returns `ambiguous_session` (Assumption 13). Env-based tagging (Phase 2) uses no MCP and is not affected.
- **Backlog.** Plan 21's upload sends the backlog's hook events through the same drain. These are old Codex events with no action envelope, so they carry no tags; Phase 5's back-fill of Codex sessions from 23 to 31 Oct should run after that upload so those sessions have cost facts to attach to. Out of order it is harmless: `session_actions` joins by `conversation_id` and counts once the facts arrive. Phase 5 must not read or move `~/.local/share/workflow/queue`.

## Decisions

Decided by Cody and carried in: (1) correlation events go through the ingest path and the projection is asynchronous; env tags and back-fill reach it through the existing client queue and drain, tagging only enqueues, no synchronous action call (Assumption 31 says how `record_action` fits); (2) the three-pass back-fill described above; (3) from Cody, 2 Nov 2026, 10:45 PM AEST, amending this design after it was committed: "The go server is only server side now so anything else has to go." The Go binary is server-only and the Python client is the only client, so every Go/Python client parity requirement is removed (Constraints in Architectural Implications; Assumption 15); in the same message, `record_action` and `work_cost` are server MCP tools and the `yakka.py` copy of the action contract is dropped (Assumptions 14, 29, 32); (4) from Cody, 2 Nov 2026, about 10:57 PM AEST, taking precedence: the local MCP shim in `yakka.py` is a thin wrapper, not a surface. It injects auth and declared local context and forwards to an MCP endpoint on the Go server, which holds every tool definition and all logic; the drain stays a separate local piece; a separate MCP shim issue (number to follow) builds the endpoint and the shim, and this plan depends on it (Assumption 30). The Intent section is left as originally written; this amendment is recorded here. Every other scope decision is in the ledger.

## Assumption Ledger

### Assumption 1

- Question: Are the draft env var names right?
- Answer chosen: Change them. All six share the prefix `YAKKA_ACTION_`: `KIND`, `SUBJECT_TYPE`, `SUBJECT_ID`, `PHASE`, `REPO`, `PR`.
- Rationale: The draft mixed `YAKKA_ACTION_KIND` with `YAKKA_SUBJECT_*`, `YAKKA_PHASE`, `YAKKA_REPO`, `YAKKA_PR`. A single prefix lets `spool.sh` and the plugin detect "any tag set" with one glob, makes accidental collision with other `YAKKA_*` names impossible (`YAKKA_REPO` and `YAKKA_PR` are generic enough to be taken later), and makes the separation from `YAKKA_ENDPOINT`/`YAKKA_KEY` visible by name. Formats and required/optional status are as drafted.
- If wrong: a rename in `harness pick` and one constant each in `spool.sh` and the OpenCode plugin. Nothing is released before Phase 2, so the cost is low if corrected before then.

### Assumption 2

- Question: Should `SUBJECT_TYPE` stay a required var, or be inferred from the id format (`:plan/` versus `#`)?
- Answer chosen: Keep it required and explicit; a type that disagrees with the id's format is rejected as `subject_type_mismatch`.
- Rationale: The issue asks for open-ended types later, where inference would not work; one launcher code path sets it; mismatches are caught instead of guessed at.
- If wrong: Make it optional with inference for the two known types. Server-only change plus one client default.

### Assumption 3

- Question: What is a plan's id, given the issue's `plan/<NN>` and the design skill's rule that NN is not a key (two plans here are numbered 13)?
- Answer chosen: Canonical is the `docs/plans/` entry name (`22-session-work-tagging`). Bare `<NN>` is accepted and stored as given. The server matches plan names exactly and never merges the two forms; `action_plan` and `GET /v1/actions?plan=` are exact on the normalised name. CHM must send the entry name consistently for a plan: the done-when query (one plan split by phase and kind) is only whole if every launch of that plan uses one string.
- Rationale: The garcia-music example uses a bare number, so rejecting it would reject real launches; merging forms needs a resolver that does not exist; ambiguity inside one repo is a harness-side fact to fix at the source, and it is a hard requirement in the Harness launch domain rather than an open nicety.
- If wrong: If CHM only holds numbers, add a resolver at the projection (a bare number joins the unique entry in that repo starting with it, with collisions such as the two 13s going to an ambiguous bucket). Rows keep their raw strings, so re-projection fixes history.

### Assumption 4

- Question: What do `REPO` and `PR` mean, and does Yakka distinguish an issue from a PR in `subject_id`?
- Answer chosen: `REPO` is the repo the work is done in, defaulting to the session's own repo; `PR` is a PR number in that repo. A `#N` subject is not resolved to issue or PR. "By issue" groups by `action_subject` where the type is `github`; "by PR" groups by `action_pr`. When the subject is itself a PR (review, sync), the launcher is expected to also set `PR`.
- Rationale: GitHub shares one number space, resolving needs the API and credentials, and the launcher already knows which it is.
- If wrong: Add a `subject_subtype`, or a server-side GitHub lookup, later; neither changes the env contract.

### Assumption 5

- Question: Is there a new write endpoint?
- Answer chosen: No. `POST /v1/ingest` accepts a new fact type, `session_action`. Several actions per session are several facts. The only new HTTP route is `GET /v1/actions`. The `record_action` tool is a tool on the MCP endpoint of the MCP shim issue (number to follow), not a route of this plan, and stores its fact through the same ingest function.
- Rationale: Cody's decided input. It also gives idempotency (canonical-fact hashing), offline operation and backoff for queued sources.
- If wrong: If an explicit `POST /v1/actions` is wanted later (for a non-queue caller), it is a thin route that wraps the same ingest path; nothing else changes.

### Assumption 6

- Question: Where is a malformed value rejected, and what does "rejected" mean?
- Answer chosen: Ingest accepts the fact; the async projection validates and stores `status=rejected` with all reason codes. Nothing at ingest, hook or tool level turns a bad value into an error for the session. The projection runs when scoring is off and when the scorer is unreachable, on its own cadence, with per-fact failure isolation.
- Rationale: The issue says "recorded as rejected with a reason" and "never block". A 4xx at ingest would push the queue file to `rejected/`, where it is invisible to the cost review. The existing worker always starts but its screen step backs off for up to five minutes while the scorer is unreachable; a projection placed behind it would be delayed with it.
- If wrong: The one remaining ingest-time refusal is the existing secret-scan precheck. A value that merely looks like a credential lands that one file in `rejected/` with its reason, visible in `yakka status`; the session is unaffected and the action is missing, not wrong.

### Assumption 7

- Question: When and how does the client read the env, given hooks must exit 0 quickly and run no Python?
- Answer chosen: `spool.sh` reads the six vars on session-start events only (Claude `SessionStart`, Cursor `sessionStart`, Codex via a new `--event SessionStart` in `codex.json`; OpenCode's plugin reads `process.env` on `session.created`) and adds the raw strings to that event's queue file without parsing, cutting before escaping so a huge value costs nothing. A value never reaches the server cut to a valid length (Action contract, Length).
- Rationale: Preserves the "no Python, no network, always exit 0" invariant. Reading at the first event only keeps every other event unchanged. Passing raw strings keeps validation in one place, so a new kind needs no client release for capture.
- If wrong: If a harness's session-start event fires late or not at all, the tag is lost for that session and it counts as untagged; the Phase 2 probe exists to find that.

### Assumption 8

- Question: Do the harnesses actually pass the launching process's environment to their session-start hook, and does the hook fire at all in headless mode?
- Answer chosen: Assume yes for Claude Code and OpenCode (in-process plugin); treat Codex and Cursor as unverified. Phase 2 starts by probing all four headlessly, separating two failures: the env is not forwarded, or the hook does not fire (Codex hooks need a trust review in `/hooks` that a headless `codex exec` may skip). If a harness fails, Phase 2 records which failure and does not close for that harness until Cody chooses between a contingency channel (a launcher-written file with the same six keys, added to this contract by amendment before CHM builds it) and a documented limit. Phase 2's approach is flagged open for that reason.
- Rationale: Recon found no repo doc, test or fixture showing any harness forwarding the user's environment to hooks (the tests inject it by hand). This is the single largest risk to the issue's done-when, and a file channel cannot help where the hook never fires.
- If wrong: Phase 2 grows by one channel per failing harness, and CHM must also write the file. The env table is unaffected for harnesses that pass.

### Assumption 9

- Question: How is cost divided when a session logs several actions?
- Answer chosen: By time. A live action owns the span from its start to the next action's; the first owns everything earlier. Repeats of the action already in force add no segment. The split is called exact only after Phase 3 confirms, per harness, that cost-bearing facts carry message time; where a harness stamps import time, the join (by the stamped `ts`) puts its calls in the action in force at the import time, usually the session's last, and the report says so.
- Rationale: Facts carry timestamps, so the split needs no estimates; it matches "triage and then a fix"; a session tagged at launch behaves as one segment. Equal splits or "last tag wins" both misstate cost.
- If wrong: A session whose first tag is applied late (`fix` recorded at minute 40 after untagged triage) overstates `fix`; the remedy is to tag triage first, or `review`. A resumed session billed entirely to the resume's tag is corrected the same way.

### Assumption 10

- Question: What wins when sources disagree?
- Answer chosen: `review` beats everything; live actions (`env`, `mcp`) beat back-fill; rejected actions are ignored; back-fill and review label the whole conversation and never split it. Back-fill rows count in cost and are always visible through `action_source`, so the reader can see how much cost rests on unreviewed labels.
- Rationale: Live tags come from the launcher or the agent that knows; review is a human correction; letting back-fill rescue a rejected tag avoids losing the session.
- If wrong: Change the precedence rule in the projection and re-project; stored facts are unchanged.

### Assumption 11

- Question: New cost endpoint, or extend `/v1/analytics/query`?
- Answer chosen: Extend it with `action_*` dimensions and filters, and add the MCP tool `work_cost` over it. The untagged and rejected buckets are returned whenever they have cost and no `action_*` filter is set.
- Rationale: The endpoint already prices cost, scopes tenants, and validates dimensions; `facts.plan` already exists as an unrelated file-derived dimension, so the new names carry the `action_` prefix to avoid a clash.
- If wrong: A thin dedicated route over the same store function; the MCP tool is unaffected.

### Assumption 12

- Question: Which MCP tools?
- Answer chosen: Two, both on the server's MCP surface: `record_action` (write) and `work_cost` (read). No `list_actions`.
- Rationale: The issue lists tagging and cost query; reads of actions are an API concern. Each tool is a registry entry, a definition and a test on the server pinning the tool list, so each one earns its place.
- If wrong: Add `list_actions` over `GET /v1/actions`; additive.

### Assumption 13

- Question: How does a `record_action` call learn its session id? (The MCP server is a child of the harness and gets no session id; `artifact_feedback` binds by file path and repo, not session. The shim has no session id either, and the server cannot read the agent's machine.)
- Answer chosen: Unsettled; Phase 4 is flagged open. The server declares the local context `cwd`, `repo_id` and `session_hint` (Assumption 33). Candidates: (a) the server resolves from `cwd` and `repo_id` against its own session facts (a recent session of that tenant with that cwd or repo and a live harness, with the caveat that its facts lag the drain); (b) `session_hint`, a pointer the session-start hook writes locally, keyed by harness process or cwd, that the shim reads and injects; (c) the id injected into the agent's context at session start; (d) a harness-provided env var if one exists. The outcome is fixed: correct session or `ambiguous_session`, never a guess.
- Rationale: No evidence in the repo favours one, the options differ in per-harness behaviour, and a wrong guess silently mis-tags cost, which is the failure the feature exists to remove.
- If wrong: If no candidate meets the outcome on some harness, binding there relies on the agent supplying `session_id` (candidate (c) tells it the id), and `ambiguous_session` asks for it. The tool definition is the same for every harness, so `session_id` is never a harness-specific required argument. Codex is the likely case: plan 21 found `.codex-mcp.json` runs the server with `"cwd": "."` (the plugin root) and does not yet know whether Codex exposes the project directory, so a cwd-based binding is unproven there.

### Assumption 14

- Question: Where does `record_action` validate?
- Answer chosen: On the server, strictly, against the Action contract (decided by Cody, 2 Nov 2026). Invalid input returns a tool error naming the reason codes and records nothing. There is no client-side copy of the contract in `yakka.py` or the shim. The env path is not validated by any client; the server rejects it in the projection.
- Rationale: An agent can act on an error; a launcher cannot. With one copy of the contract there is no stale client to reject a newly added kind.
- If wrong: Not a design option under the shim decision (the shim holds no validation); structure-only validation would just move the vocabulary check to the projection and lose the agent's immediate feedback.

### Assumption 15

- Question: Implement in both clients, or which one?
- Answer chosen: Decided by Cody (2 Nov 2026, 10:45 PM AEST), not assumed: the Python client `yakka.py` is the only client, and the Go binary in `packages/yakka` is server-only. Client-side work lands in `yakka.py` (parser, builder, enqueue writer, drain), the hook scripts and the OpenCode plugin; no tool logic lands in `yakka.py` (Assumption 30).
- Rationale: Cody: "The go server is only server side now so anything else has to go." This also matches what runs today: `plugins/yakka/.mcp.json` launches `python3 .../client/yakka.py mcp`, and the plugin's `spool.sh` kicks the Python drain.
- If wrong: Not open. Reversing it would mean re-amending this design.

### Assumption 16

- Question: Do subagents' costs follow their parent's action?
- Answer chosen: Assume subagent usage carries the parent's `conversation_id`, so it inherits. Phase 3 checks this on real data. If it does not, subagent cost shows as `(untagged)` and a parent mapping is added to the projection join.
- Rationale: Claude subagent hooks carry the parent session id, but the handling of the ~391 subagent transcripts in the usage back-fill was not traced.
- If wrong: Plan cost is understated by the subagents' share, which on build phases can be large; the untagged bucket makes it visible, and the done-when query is not met for Claude until the parent mapping lands. It is the first thing Phase 3 settles for that reason.

### Assumption 17

- Question: What accuracy bars make the back-fill passes provable?
- Answer chosen: Pass 1 is scored on the queue-log sessions with the log-derived label masked (prompt, files, cwd and branch only), so the check is not circular; agreement on subject type, id and phase is at least 95% of the sessions it labels, with coverage stated. Pass 2 sets its confidence threshold as the lowest value at which gold-set accuracy above it is at least 90%, with accuracy per kind. The check sample for Pass 3 is the larger of 5% of high-confidence rows and 50 rows, and its agreement rate is the estimate for interactive sessions.
- Rationale: Numbers are needed to prove an outcome; these are judgement calls Cody can move. The gold set is the queue-log sessions only, biased toward templated queue prompts, so only the Pass 3 sample says anything about interactive sessions.
- If wrong: Change the constants; if interactive accuracy is far below queue accuracy, lower the threshold for sessions without a queue log.

### Assumption 18

- Question: What surface does Pass 3 review use?
- Answer chosen: A file round trip: `review export` writes JSONL, a human edits verdicts, `review import` enqueues `review` facts. The admin status block shows counts. No UI.
- Rationale: One reviewer, a few hundred rows; the facts path already carries the result; a page is a larger build for no extra proof.
- If wrong: An admin-page list, reusing `RecentRejections` and the rescore pattern; additive.

### Assumption 19

- Question: Prompts go to TypeSafe in Pass 2. Is that acceptable?
- Answer chosen: Yes, after the client's secret scrub and truncation to a fixed prefix, because Cody decided Pass 2 runs TypeSafe on the prompt.
- Rationale: Prompts can carry secrets or private content; scrub-and-cap is the existing control. The scorer credential stays server-side per `docs/design/03`, so Pass 2 must call whichever TypeSafe path the existing `jev_client.py` uses and add no new credential to any client config.
- If wrong: If prompt egress is not acceptable for some repos, exclude them by an allow-list or run those through the local-LLM option.

### Assumption 20

- Question: Are the closed lists (kinds, subject types) extensible by the client?
- Answer chosen: No. Adding a value is a contract change in the server contract file and a server release. No client copy exists, so no plugin release is needed for it.
- Rationale: A closed list is what makes cost queries comparable week to week. `sync` covers rebase and sync; `escalation` is kept as listed in the issue.
- If wrong: Move the lists into tenant configuration; a larger change.

### Assumption 21

- Question: What if a tagged session launches another harness session (the phase driver, or a coordinator running `claude -p`)?
- Answer chosen: The child inherits the env and records the same action, and CHM is told in the harness-side notes that a launcher which spawns children with a different purpose must override or unset the vars.
- Rationale: Inheritance is the mechanism; stopping it would need yakka to unset vars in a hook, which does not reach children, and no design here controls the driver.
- If wrong: Children are mis-tagged with the parent's kind. The `source` and per-session rows make this auditable, and `review` can fix it.

### Assumption 22

- Question: Is Cursor Cloud, or an interactive Cursor GUI, in scope for automatic tagging?
- Answer chosen: No for Cloud (no `sessionStart` hook). A GUI launched outside `harness pick` has no env to read, so it is tagged by `record_action` only, and only if the user has merged the Yakka MCP into `~/.cursor/mcp.json`, as the plugin manifest does not declare it.
- Rationale: Queue launches use the CLI. The manifest gap is an install problem, not part of this design.
- If wrong: Add `mcpServers` to the Cursor manifest in a follow-up.

### Assumption 23

- Question: Is seven phases too many?
- Answer chosen: Keep seven. Phases 1–4 are the live path the issue's done-when needs; Phases 5–7 are Cody's back-fill. They depend on Phases 1 and 2 (Phase 2 delivers the queue-file builder for a tag-only file) and on Phase 3 to show the effect, so the tail is a clean split point if sign-off finds the count too large.
- Rationale: The back-fill is decided input and its passes each have a distinct provable outcome.
- If wrong: Cut after Phase 4 and give the back-fill its own design.

### Assumption 24

- Question: What is the queue form of an action that does not come from a session-start hook?
- Answer chosen: Its own queue file with event `yakka.session_action` and an empty payload, for which the fact builder in `yakka.py` emits only the `session_action` fact. Existing views exclude `session_action` facts from conversation, hook-event and facet counts.
- Rationale: The builder emits a hook event for every queue file, so a hook-shaped file carrying only an action would create phantom hook events and, for ~6,500 back-filled sessions with no other facts, phantom conversations.
- If wrong: Store actions outside `facts` entirely; the projection and read API are unchanged.

### Assumption 25

- Question: In what order do server and plugin ship?
- Answer chosen: The Phase 1 server is deployed before any plugin release that emits `session_action`. Phase 2's verification runs against a server built from Phase 1. Phase 4's tools run on the server and need no such order.
- Rationale: An older server answers `invalid` to an unknown fact type, and the drain then moves the file to `rejected/` permanently, losing the tag and the session-start event with it.
- If wrong: If a plugin ships first on some machine, its tagged session-start files sit in `rejected/` with a reason; they can be re-queued by hand after the server is upgraded.

### Assumption 26

- Question: Does a plan's PR work count toward that plan's cost?
- Answer chosen: Yes, if the launcher tags it with the plan as subject and the PR in `YAKKA_ACTION_PR`. Work tagged with a `github` subject is outside `action_plan` queries. This rule is in the Action contract and the Harness launch domain.
- Rationale: A second subject field would change the contract; the existing `pr` field already links the work to the PR. Without the rule, a plan's review and sync cost would silently fall out of "one plan's total cost".
- If wrong: If CHM tags PR work with a `github` subject, plan totals read low; a PR-to-plan join from `commit` and `artifact_version` facts can be added later.

### Assumption 27

- Question: What is the first-class set of cost groupings and filters?
- Answer chosen: The issue's five (plan, phase, issue or subject, PR, kind) plus `source`, so a reader sees how much cost rests on unreviewed labels. Grouping by repo, harness or model stays on the existing dimensions. `GET /v1/actions` and the admin block stay small and exist because Phases 1, 5 and 7 prove their outcomes through them.
- Rationale: Every extra dimension needs golden tests in the usage path and a field in the server's `work_cost` definition.
- If wrong: Add `action_repo` or `action_status` as dimensions; both are additive.

### Assumption 28

- Question: What happens when a tagged session is resumed or relaunched?
- Answer chosen: Nothing special: a resumed session fires session-start again and its tag is recorded like any other; an equal tag collapses, a different one starts a new segment and, if it is the first live action, takes the earlier untagged or back-filled time (Assumption 9).
- Rationale: The projection is a pure function of all of a conversation's actions, so retries, resumes and out-of-order arrival give one answer.
- If wrong: If resumes are common under a different launcher tag, add a `since` argument or a launcher rule that unsets the vars on resume.

### Assumption 29

- Question: With the Go client gone and the `yakka.py` copy dropped, does any client hold the Action contract, and where do the fixtures live?
- Answer chosen: No client holds it. The server's contract file in `internal/actions` is the only copy (Cody, 2 Nov 2026). The one client-side rule is the length transport guard: control characters stripped, cut, only when the value exceeds 256 bytes, at the first character boundary at or after byte 257, in `spool.sh` (bash) and the OpenCode plugin. The 256-byte maximum is itself an assumption of this ledger entry (the longest legitimate plan subject id is about 160 bytes). The guard exists to keep queue files small and to make an over-length value reach the server over-length, as `too_long`, never cut to a valid size; it is not validation and takes no vocabulary. One fixture table (inputs and expected normalised action or reason codes) is created in Phase 1 beside the contract file and read by the server's contract test and, by relative path for its length cases only, the OpenCode plugin test. `spool.sh`'s guard is covered by Phase 2's 10 KB fixture run. The table's exact location is Phase 1's call and it is not one of `packages/hooklog/tests/fixtures`.
- Rationale: Cody's shim decision leaves no argument validation outside the server, and the env path never validated vocabulary client-side. Keeping the new table out of `hooklog/tests/fixtures` leaves those as the Python client's fixtures.
- If wrong: If the OpenCode plugin should also reject bad vocabulary at capture, it takes a copy and the table already supports that. If the table's location is awkward for either test suite, move it in Phase 1 with no contract change.

### Assumption 30

- Question: What does the shim decision change for this plan, and which phases wait on the MCP shim issue?
- Answer chosen: Decided by Cody (2 Nov 2026, about 10:57 PM AEST), not assumed. The plan depends on the MCP shim issue (number to follow). Tool definitions, instructions, wording, validation and behaviour for `record_action` and `work_cost` are specified here on the server's MCP surface and none is put in `yakka.py`. Phases 1, 2, 3, 5, 6 and 7 can be built before that issue lands; Phase 4 is the first to need it and cannot close before it has.
- Rationale: The server has no MCP endpoint today and all MCP logic is in `yakka.py`; a design that put new tools there would be moved again by the shim issue, and would hold validation the shim must not have.
- If wrong: If the shim issue changes shape (a different carrier for declared context, say), only the carrier sentence in the shim-boundary contract and Phase 4's surfaces change; the tool contracts and the other six phases do not.

### Assumption 31

- Question: Does `record_action` still work offline and enqueue, as the first version said?
- Answer chosen: No. The server records the action through the same ingest function and the projection stays asynchronous, so a `record_action` call needs the server and fails with whatever the shim issue defines for an unreachable server when it is down. Env tags and back-fill still enqueue and drain, so Cody's decided input (correlation events go through the ingest path, no synchronous action call) holds for them; for `record_action` the call stores one fact and returns, with no synchronous projection and no new write route.
- Rationale: Cody's instruction for this plan: the server validates `record_action` against the contract and records through the async ingest and projection path. Validation on the server needs a round trip, so an offline queue would hold unvalidated input the agent cannot correct.
- If wrong: If an offline `record_action` matters, the shim would need to queue a call, which contradicts "holds no logic" and is for the shim issue to decide; the tool contract does not change.

### Assumption 32

- Question: Does `work_cost` stay in Phase 3?
- Answer chosen: No, it moves to Phase 4, with `record_action`. Phase 3 keeps the server query (`action_*` dimensions on `/v1/analytics/query`), and the back-fill phases check cost through that query instead of the tool.
- Rationale: `work_cost` is a registry entry on an endpoint that does not exist yet. Leaving it in Phase 3 would hold Phases 3, 6 and 7 behind the MCP shim issue, when only the tool needs it. This keeps the dependency to one phase.
- If wrong: If the tool should ship with the query, Phase 3 takes it and the dependency spreads to Phases 3, 6 and 7. Nothing else changes.

### Assumption 33

- Question: Which local context does each tool declare, and is `session_hint` allowed as local context?
- Answer chosen: `record_action` declares `cwd`, `repo_id` and `session_hint`; `work_cost` declares none (auth only). The names and meanings are in the shim-boundary contract. `session_hint` is a local fact the shim reads from a pointer the session-start hook writes (Phase 4 owns the pointer's path or key and the shim-side provider; the shim issue owns the mechanism and the `cwd` and `repo_id` providers); it is not a session id the shim invents, and Phase 4 may drop it if the server-side resolution in Assumption 13 passes the outcome without it. `session_id` stays an agent-supplied argument, not context.
- Rationale: Cody allows local context for values only readable on the agent's machine, and names file content, a resolved path, git identity and local queue and drain facts; `cwd` is a resolved path, `repo_id` is git identity and the pointer is a local spool fact. The server, not the shim, decides which of them a tool gets.
- If wrong: If a hook-written pointer is not acceptable local context, `session_hint` is dropped and binding relies on `cwd` and `repo_id` or a required `session_id`; the hook edit in Phase 4 goes with it.

### Assumption 34

- Question: How do plan 21's MCP wording edits and this plan's tools meet, now that the tools move to the server?
- Answer chosen: Plan 21 edits the `instructions` string, the `artifact_feedback` description and state wording; they are in `yakka.py` today and on the server after the MCP shim issue. This plan adds one sentence and two tools to the same surface and edits none of plan 21's. The edits are additive; whichever merges second rebases. How plan 21 sequences against the shim issue is not decided here.
- Rationale: The two plans cannot both be told to avoid the surface; additive edits to a string and a registry are the smallest overlap.
- If wrong: If plan 21's MCP edits are built first in `yakka.py` and the shim issue moves them, nothing here changes.

### Assumption 35

- Question: Which numbers and labels does the design fix that its sources do not?
- Answer chosen: The maximum value length is 256 bytes; the projection step runs at least every 10 seconds and gives a fact three attempts; a tagged call with no value for a dimension falls in `(none)`; a rejected action never ends a segment; a `record_action` fact has `id` `mcp:<conversation_id>:<ts in milliseconds>` and `harness` `unknown` when the server holds no facts for the session yet.
- Rationale: Phase outcomes must be checkable without asking, and these were the values a test would otherwise have to invent. The 256-byte maximum is about 1.6 times the longest plan subject id in the contract; the cadence, attempt count and `(none)` label are judgement calls with no data behind them.
- If wrong: Change the constants in the contract file or the worker and re-project; stored facts are unchanged. A different harness value for facts with no conversation yet is a one-line change.

## Open Questions

- **Env inheritance (blocks Phase 2 closing):** do the Codex (`codex exec`, with its hook trust review) and Cursor (`cursor-agent -p`) session-start hooks run headlessly and see the launching environment? Phase 2's first step answers it; if not, Cody chooses a contingency channel (with CHM work to feed it) or a documented limit per harness.
- **Plan id (blocks CHM's launcher mapping, not the server):** what does `harness pick` hold for a plan, an entry name or a number? If numbers, the two plans numbered 13 show that one repo can collide, and a resolver is needed.
- **Subagent cost (settled in Phase 3):** does subagent usage carry the parent `conversation_id`?
- **Cursor per-session cost (settled in Phase 3):** does the server hold per-session tokens for Cursor, or are those calls unpriced? This bounds what "cost by plan" can say for Cursor sessions.
- **Back-fill value (settled in Phase 5's dry run):** how many of the ~6,500 older local sessions have facts on the server? Sessions without facts get an action but no cost.
- **Accuracy bars and sample size** (Assumption 17) and **prompt egress to TypeSafe** (Assumption 19) are Cody's to confirm or move.
- **Phase count:** is seven acceptable, or should the back-fill (5–7) become its own design?
- **Plan 21:** its open question 1 (is the project directory exposed to the Codex MCP server?) decides Phase 4's Codex binding. The interaction section also needs one re-check against plan 21 as amended, before Phase 4 is refined.
- **MCP shim issue (blocks Phase 4 closing):** the carrier for a tool's declared local context, the registry the tools register in, and what the shim says when it has no login or the server is unreachable are that issue's to fix. Phase 4's refine reads its design and checks the three context names against it.
- **Session binding (settled in Phase 4):** which of the candidates in Assumption 13 meets the outcome on each harness, and whether `session_hint` is needed.

## Phases

Order and count fixed at sign-off. Phases 1–4 build the live path; 5–7 the back-fill. Dependencies are exact: a phase may be built once the phases it lists have closed. Only Phase 4 depends on the MCP shim issue (number to follow); Phases 1, 2, 3, 5, 6 and 7 can be built and closed before it lands.

### Phase 1 — Action record path

- Outcome: Against a local `yakka serve`, run with scoring enabled, with scoring disabled, and with the scorer configured but unreachable:
  1. `POST /v1/ingest` of a valid `session_action` fact (input `" Build "`, `"CodyHamilton/Yakka:plan/22-X"`) returns `accepted`. Within 30 seconds, `GET /v1/actions?conversation_id=C` returns one row with `status=accepted`, `kind=build`, a fully lowercased subject id, and `pending=0`.
  2. A fact with `kind=bogus` and `phase=two` also returns `accepted`; its row has `status=rejected` with reasons `unknown_kind` and `bad_phase`. A 300-byte `subject_id` is rejected `too_long`; a `plan` type with `owner/repo#5` is rejected `subject_type_mismatch`; `owner/repo` alone is `bad_subject_id`. No value error produces a 4xx. A fact whose value trips the secret scan is refused as every fact is, and nothing else about the session changes.
  3. Re-posting either fact returns `duplicate`.
  4. Segments are the same whatever the arrival order: two accepted live actions at t1<t2 give a first valid from the beginning to t2 and a second from t2; posting them in reverse order, or posting a third equal to the second, or two with identical `ts`, gives the same segments (ties by fact hash).
  5. A conversation with a rejected `env` action and an accepted `backfill` action takes the back-fill's; with an accepted `env` action as well, the `env` action wins; a `review` action overrides everything, and a second `review` later replaces the first.
  6. A projection forced to fail on one fact is retried three times and shown as failed in `GET /v1/admin/status`, while other facts and screening continue.
  7. With `session_action` facts seeded, the existing conversation counts, `hook_events` counts and facets return exactly the values they return without them (golden test).
  8. `GET /v1/admin/status` reports tagged and untagged conversation counts and rejected counts by reason.
  `go test ./...` passes and covers all eight.
- Surfaces: `packages/yakka/internal/ingest/ingest.go` (`validate`, type list), `internal/ingest/policy.go` (confirm the type is not dropped), a new `internal/actions` package holding the contract file, validation, projection and the contract fixture table (Assumption 29) with its test, `internal/store/store.go` (migration, `session_actions`, projection state), `internal/store` conversation, `hook_events` and facet queries (exclude the new type), `internal/serve/serve.go` (worker projection step independent of the screen backoff, `/v1/actions` route), `internal/serve/admin.go` and `packages/yakka-analytics/src/lib/api.ts` (status block), `docs/design/01`, `03`.
- Approach: known
- Depends on: nothing (not the MCP shim issue)

### Phase 2 — Session-start capture on all four harnesses  *(earliest phase the harness side can verify against)*

- Outcome: First, a probe table records for each of Claude Code, Codex, OpenCode and Cursor, launched headlessly, whether its session-start hook or plugin runs and whether it sees an exported variable, with the command used. Then, against a server built from Phase 1, for each harness launched headlessly (`claude -p`, `codex exec`, `opencode run`, `cursor-agent -p`):
  1. With all six `YAKKA_ACTION_*` set to a valid build action, after drain `GET /v1/actions?conversation_id=<the session>` returns that exact action with `source=env`, `status=accepted`, and the session's other facts are present.
  2. With none set, the session's facts are present and no action row exists.
  3. With `KIND=buidl` and `PHASE=x`, the harness process exits as it would without the vars, the session's facts are present, and the row is `rejected` with both reasons.
  4. A fixture run of `spool.sh` with 10 KB values containing quotes, backslashes, newlines and multi-byte characters straddling byte 257 (including a 257-to-260-byte value whose character straddles it) exits 0 and writes an envelope that the Python parser (`_parse_file`) accepts, with an over-length value arriving as `too_long`, never as a truncated accepted one; a non-string `action` member does not make the parser reject the file; and the OpenCode plugin's length guard gives the contract table's length-case outcomes. No client validates a value: a value judged invalid reaches the server as received.
  5. The Python fact builder, run over new envelope fixtures with and without an `action` object, emits the expected facts; a tag-only queue file (event `yakka.session_action`, empty payload) yields exactly one `session_action` fact and no `hook_event`; and resolving client config with only `YAKKA_ACTION_*` set is unchanged.
  A harness that fails 1–3 is recorded with the cause (env not forwarded, or hook not fired). The phase closes when each harness passes 1–3, or Cody has recorded that harness as a documented limit or approved a contingency channel by amendment to this design (Assumption 8). The phase carries the release precondition of Assumption 25.
- Surfaces: `plugins/yakka/script/spool.sh`, `plugins/yakka/hooks/codex.json` (`--event SessionStart`), `hooks.json`, `cursor.json` (verify only), `packages/opencode-yakka-hooks/src/index.ts`, the queue-file parser and fact builder (`_parse_file`, `Build`) in `plugins/yakka/client/yakka.py` with `test_facts.py` (the drain is unchanged; no MCP code is touched), `packages/hooklog/tests/fixtures` (new envelope fixtures, as Python-client fixtures), `docs/design/02`, `05`, `CHANGELOG.md`, plugin version bump.
- Approach: open for any harness that fails the probe (what carries the tag then); known otherwise
- Depends on: Phase 1 (not the MCP shim issue; it uses no MCP)

### Phase 3 — Cost by work

- Outcome: On a seeded tenant holding one plan across phases 1–3 with kinds build, review and fix, one session with two actions switching at a known timestamp, one untagged session, one session whose only action was rejected, and one session of an unpriced harness:
  1. `/v1/analytics/query` with `dims=[action_plan, action_phase, action_kind]` returns buckets whose `cost_usd` sums, to the cent, to that plan's total computed independently from per-conversation costs; the mid-session session splits at its boundary by call timestamp.
  2. `(untagged)` and `(rejected)` are present with no filter set, survive top-N folding, and reconcile with the plan's buckets to the unfiltered total; with `action_plan` set to the plan they are absent and the buckets sum to the plan's total; a session with a rejected action between two accepted ones keeps that time in the earlier accepted action; the unpriced harness shows `unpriced_calls`, not $0; `sessions` counts distinct conversations per bucket.
  3. An `action_*` dimension or filter on a measure that lacks it is an error, and queries without `action_*` fields return byte-identical results to before (golden test).
  4. On real data: a Phase 2 session's cost appears under its plan and kind; for each harness the report states whether cost-bearing facts carry message time or import time (and the split is called exact only where they carry message time); and the subagent and Cursor questions in Open Questions are answered with counts.
  5. Gated on CHM's change: one real `harness pick` build launch on each harness appears in `GET /v1/actions` as `source=env, accepted`, and an `action_plan` query returns its cost. Until CHM has landed, this item is recorded as gated, and the plan is not reported done against the issue's done-when.
- Surfaces: `packages/yakka/internal/store/usage.go` (the usage aggregation and its dimension and filter handling, which the cost measures use), `internal/serve/analytics_query.go` (dimension limit, measure validation, top-N folding), `docs/design/03`. No client file.
- Approach: known
- Depends on: Phase 1 and Phase 2 (not the MCP shim issue; the `work_cost` tool over this query is Phase 4)

### Phase 4 — MCP tools: manual tagging and cost query

- Outcome: First depends on the MCP shim issue (number to follow) having landed: the server's MCP endpoint, its tool registry and the shim. Then `record_action` and `work_cost` are registered with the definitions in domain "MCP tools", and:
  1. `tools/list` through the shim returns both tools with the description, schema, annotations and declared context in that domain (`record_action`: `cwd`, `repo_id`, and `session_hint` if Phase 4 kept it; `work_cost`: none), and the server's `instructions` carry the one added sentence. A diff of `yakka.py` shows no tool definition, description, wording or validation added for either tool (its only possible addition is the `session_hint` provider).
  2. In a live interactive session on each harness that loads the Yakka MCP, calling `record_action` for `triage`, then for `fix`, with no `session_id`, gives `GET /v1/actions` both actions on that session in order with `source=mcp`, and the server's `work_cost` splits the session's cost at the second call.
  3. With two concurrent sessions of one harness in the same cwd, each call lands on its own session or returns `ambiguous_session` and records nothing.
  4. Invalid input (`kind=buidl`, `phase=x`) returns a tool error naming the reason codes, matching the contract table, and records nothing; no `rejected` row appears. A call with an explicit `session_id` the server holds no facts for records and says so. With the server unreachable the call fails with the unreachable message that the shim issue defines (not asserted here) and records nothing.
  5. `work_cost` called through the shim carries auth only (a server-side test asserts no context parameter arrived), and returns the same rows as the direct `/v1/analytics/query` call for the same filters, with `(untagged)` and `(rejected)` present when no tag filter is set; a filter on a measure that lacks it is an error.
  The phase closes when Claude Code passes 2–3 and every other row is either passed or recorded as a documented limit with the observed reason: Codex depends on plan 21's answer to whether Codex gives the MCP server the session's project directory (if not, the Codex row passes when a call without `session_id` returns `ambiguous_session` asking for it, and a call with it records), and Cursor on the user-level MCP config. Items 1, 4 and 5 are proven by server tests that call the MCP endpoint directly, before the live runs. That the shim relays replies unchanged, adds only auth and declared context, and what it says with no login or no server are the shim issue's acceptance tests; Phase 4 only exercises them in the live runs.
- Surfaces: the two tool definitions and handlers in the server's MCP registry (files named by the MCP shim issue), `internal/actions` (the validation the handler calls), `ingest.Ingest` (the in-process call the handler uses to store its fact; `internal/serve/host.go` already calls it that way for the hosted drain, but this plan does not touch host.go), the session-binding mechanism chosen in this phase (server-side resolution from `cwd` and `repo_id`, and if needed a `session_hint` pointer written by the session-start path, which extends Phase 2's hook edits and is read by the shim only as declared context), `docs/design/04` (the MCP tool table). No tool definition, description, wording or validation in `yakka.py`; its only edit is the `session_hint` context provider, if kept.
- Approach: open for the session binding; the yardstick is checks 2–4 above and the candidates are in Assumption 13. The tool contracts and the rest are known.
- Depends on: Phases 1, 2 and 3, and the MCP shim issue (number to follow)

### Phase 5 — Back-fill pass 1: deterministic extraction

- Outcome: A dry run over the four local stores on codyh-ubuntu prints, per store, how many sessions are labelled (complete), partial (subject without kind), unresolved and excluded (the 890 Flash analysis runs are excluded). A real run enqueues `source=backfill, method=deterministic` facts for complete labels only, and writes a local label file for the rest. With the log-derived label masked, subject type, subject id and phase agree with the queue-log file-name truth on at least 95% of the gold sessions it labels, coverage is reported, and `evidence` is secret-scrubbed before it is written. Every in-scope session appears in the output as complete, partial with evidence, or unresolved. A second run enqueues nothing new. After drain, the count of `GET /v1/actions?source=backfill` rows equals the run's emitted count less the files the ingest secret scan refused, which the report itemises; and the dry run states how many labelled sessions have facts on the server.
- Surfaces: a new back-fill tool beside `tools/transcript/` (parsers for each store's transcripts, queue-log reader, label file), the new enqueue writer in `plugins/yakka/client/yakka.py` (first needed here; it is a queue-file writer, not an MCP tool) with its test, `docs/design/02`.
- Approach: known
- Depends on: Phases 1 and 2 (the queue-file builder for event `yakka.session_action`, Phase 2 item 5)

### Phase 6 — Back-fill pass 2: TypeSafe kind classification

- Outcome: A new TypeSafe schema (the ten kinds or `unclear`, with confidence) is run over every partial session from Pass 1 and every session with a subject but no kind. A report on the gold set gives overall and per-kind accuracy and a confusion matrix, and fixes the threshold as the lowest confidence at which gold-set accuracy above it is at least 90%. Results at or above the threshold complete the label and are enqueued as `method=typesafe` facts; results below it, and `unclear`, are written to the review file with the prompt prefix and the model's answer, and enqueue nothing. Prompts are shown by test to pass the secret scrub and truncation before any call. After drain, `GET /v1/actions?source=backfill&max_confidence=<T>` returns the rows whose confidence is below the threshold, matching the report's count, and `/v1/analytics/query` with `dims=[action_kind, action_source]` shows how much cost rests on each source.
- Surfaces: the back-fill tool, the TypeSafe schema and a client in the style of `tools/transcript/lib/jev_client.py`, the secret scrub.
- Approach: known
- Depends on: Phases 3 and 5

### Phase 7 — Back-fill pass 3: human review

- Outcome: `review export` writes every incomplete or below-threshold session plus a random check sample of the rest (the larger of 5% of high-confidence rows and 50) as JSONL; after a human edits verdicts, `review import` enqueues `source=review, method=human` facts and prints the sample's agreement rate. After drain, each reviewed conversation's projection shows the reviewed action, and an `/v1/analytics/query` over `action_kind` and `action_plan` before and after differs by exactly the cost of the reviewed conversations moving between buckets. Re-importing the same file changes nothing, and a second import with a different verdict replaces the first. The admin status block shows counts by source and sessions awaiting review.
- Surfaces: the back-fill tool (`review` subcommands), the enqueue writer in `yakka.py`, `packages/yakka/internal/serve/admin.go` and `src/lib/api.ts` (status block extension), `docs/design/03`.
- Approach: known
- Depends on: Phases 3 and 6

## Provenance Notes

- **Harness-side start.** CHM can write and merge its `harness pick` change at any time: the table is fixed and exporting unread variables is inert. Phase 2 is the earliest phase against which CHM can verify it by its own run (an exported action showing up in `GET /v1/actions` on each harness), conditional on the probe: a harness whose hook does not fire or does not see the environment changes what CHM must do for it. Phase 3 item 5 is the plan's own end-to-end check with CHM's real launches, and is recorded as gated until CHM lands.
- **Rough build size.** About 3,900 lines including tests (the phases sum to 3,890), about 57% of it tests and fixtures. Phase 1 ~800 (Go, server only; ~60% tests), Phase 2 ~320 (bash, Python, TypeScript, fixtures, probe; ~55%), Phase 3 ~460 (the Go usage-path join and its golden tests; ~65%), Phase 4 ~650 plus exploration (two server tool handlers and registry entries with their tests, the session binding, a small hook pointer and provider; ~50%), Phase 5 ~760 (Python, including the enqueue writer; ~55%), Phase 6 ~500 (~60%), Phase 7 ~400 (~55%). Seven phases, each its own PR. The back-fill tail (5–7) is 1,660, about 43% of the total. The shim issue's endpoint and shim are a separate issue and are not counted. The committed design said about 3,800 while its phases summed to 3,950 (Phase 1 ~800, Phase 2 ~450, Phase 3 ~700, Phase 4 ~400, Phases 5–7 ~1,600, roughly 60% tests); an interim amendment said 3,600. The change from the committed phases: the client-side Go edits and parity tests leave Phase 2 (about 130 lines); `work_cost` moves from Phase 3 to Phase 4 (about 240 lines out of Phase 3, mostly the tool and its twin); Phase 4 now holds two server tool handlers instead of client tools; Phase 5 takes the enqueue writer (about 60 lines). These are estimates, not measurements.
- **Rejected: a second Go-side client path, or a second client-side copy of the contract.** Parallel Go-side client edits would have kept the server-only Go binary's client half alive, and a `yakka.py` copy of the action contract would put validation in the shim's side of the boundary. Cody decided both go: no phase carries a Go client edit and the only copy of the contract is the server's.
- **Rejected: MCP tools in `yakka.py`, or a shim with a per-tool context table.** The shim is a thin wrapper that holds no tool list, wording or validation (Cody), and which local context a tool receives is declared by the server in its tool definition, not hard-coded in the shim.
- **Rejected: one env var carrying a JSON blob.** It needs quoting by every launcher shell and fails as a whole on one bad character; separate variables fail field by field and show which field.
- **Rejected: a `YAKKA_ACTION_RUN` correlation var** (the queue run name). It would link sessions to queue logs and help the gold set, but the back-fill already reads the logs by name, and a seventh variable is surface without an outcome.
- **Rejected: a dedicated record endpoint (`POST /v1/actions`).** Cody decided that submission uses the ingest path: the queue and the server's own `record_action` handler both feed it, and projection stays asynchronous. A dedicated route would add its own offline, retry and fallback behaviour, the surface plan 21 is tightening.
- **Rejected: splitting cost evenly across a session's actions, or letting the last tag win.** Both misstate cost whenever a session changes work; the timestamps are already on every fact.
- **Rejected: reading the env in the drain.** The drain is a detached background process started by a hook or MCP call; its environment is not the harness's.
- **Recon limits.** The server and client facts here come from reading code, not from running it. Verified in this worktree: no `internal/actions` package and no server MCP endpoint exist (the only MCP code is client-side: `yakka.py`'s `# --- mcp ---`, lines 1840-2514, plus Go client code this plan leaves untouched); `ingest.Ingest` is already callable in-process (`internal/serve/host.go`); `artifact_feedback` makes the local reads that the shim's declared context replaces (cwd, stat and content hash, `git rev-parse --show-toplevel`, `RepoID`, a queue-dir scan, the drain lock, `Load()`, the drain kick). Not verified: whether any harness passes its environment to hooks, whether OpenCode plugins run in the opencode process (the plugin reads `process.env` as if they do), whether Codex loads the plugin MCP live, Cursor's hook cwd, the worker wiring that installs the screen step, and whether subagent usage carries the parent id. Each is either a Phase 2/3/4 probe or a ledgered assumption.
