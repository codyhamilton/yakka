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

The Python client (`plugins/yakka/client/yakka.py`) is the only client, and the Go binary in `packages/yakka` is server-only (decided by Cody; see Decisions). What stays on the agent's machine is the hooks, the spool and the drain, and the MCP shim, which is a thin wrapper that holds no tool definitions or logic (decided by Cody, see Decisions): it adds the bearer key and the local context the server declares to a call, and relays every message to the server's MCP endpoint unchanged. That endpoint, its registration seam, its declaration and carrier format and the shim's reader table are specified by Plan 24 (`docs/design/08-server-mcp-contract.md` on master, the design for #177; its endpoint and shim are not built); this design registers through that seam and restates none of it beyond what its two tools need (Domain "MCP tools"). It adds no tool logic, description, schema, wording or validation to `yakka.py`; its only client-side addition for tools is one reader-table entry, `session_hint` (Domain "MCP tools"). All of that is on the server's MCP surface.

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

  Amendment 19 Nov 2026: the simple back-fill emits only `source:"backfill"`, `method:"deterministic"` and `confidence` 1.0 or 0.65 (Domain "Back-fill"). `typesafe` and `human` stay in the vocabulary as built in Phase 1 and are unused; no change to the contract or the server is needed.
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

- Owns: the two tools this design adds, `record_action` and `work_cost`, and the binding of a `record_action` call to its session. Every definition below is a registration on the server's MCP endpoint, in the tool registry of Plan 24 (the design for #177). Nothing here is in `yakka.py` except one reader-table entry, `session_hint`.
- Contract, **shim boundary and registration seam** (decided by Cody; specified by Plan 24, whose names this design uses exactly). The shim holds no tool list, descriptions, schemas, instructions, argument validation, state logic or wording, and relays every JSON-RPC message to `POST /v1/mcp` unchanged apart from the bearer and `params.arguments._local` on `tools/call`. A tool registers by Plan 24's tool-definition seam: `name`, `description`, `inputSchema`, `annotations`, `scope`, `timeout_s`, `instruction`, `context`, `validate` and `handler`. Its `context` is a list of reader declarations (`{"reader","v","required","params"}`) naming readers from the shim's fixed table and the server's conformance file `internal/serve/testdata/mcp-readers.json`. The shim fills `_local` with one key per declared reader, each a value object or `{"_failed":{"code"}}`. `_local` and the arguments are claims, never identity: tenant and scope come from the credential alone, a handler may use a claim only to select a row inside the caller's own tenant, and the server never opens a path or runs a command from one. Absolute paths in `_local` are transient: neither tool logs, stores or echoes them. Plan 24's own errors (`bad config`, `unreachable`, `unauthorized`, `server unsupported`, `timeout`, `redirect refused`, `bad reply`), its `-32003` for insufficient scope and its `-32010` stale-declaration retry reach the agent as it defines them; this design words none of them.
- Contract, **declared context** (the names this design needs, mapped onto Plan 24's readers; the logical names `cwd`, `repo_id` and `session_hint` stay as they are cited by Plan 23):

  | Logical name | Plan 24 reader and param | Where the handler reads it | Provider |
  |---|---|---|---|
  | `cwd` | `cwd` (v1, none) | `_local.cwd.path` | Plan 24 |
  | `repo_id` | `git` (v1) with `of:"cwd"` | `_local.git.repo_id` (normalised remote, or `root:<sha>`); `_local.git.error` is `no_repo`, `no_commit` or `git_unavailable`, a fact and not a failure | Plan 24 |
  | `session_hint` | `session_hint` (v1, no params), new | `_local.session_hint.session_id` (string or null) | this design, Phase 4 |

  `record_action` declares `[cwd, git{of:cwd}, session_hint]` in that order (`git` after `cwd` as Plan 24 requires for a reader that depends on another), each `required:false`: a call with none of them still works when `session_id` is given, so no reader failure may block it. A handler treats a failed or absent reader as no value for that reader, binds from what remains, and names every failure code it saw when it returns `ambiguous_session`; a failure is never read as "not in a repository" or "no hint". `work_cost` declares no `context`, so its calls carry auth only and its `_local`, if an agent supplied one, is deleted by the shim. Declarations are at reader `v` 1 and declaration `v` 1, so every plugin that reads Plan 24's declarations sees both tools. A plugin released before Phase 4 has no `session_hint` in its table and injects `{"_failed":{"code":"unsupported_reader"}}` for it; because it is optional, `record_action` degrades to `cwd` and `repo_id` binding there and nothing fails. Phase 4 may amend the declaration (for example by adding Plan 24's `project_dir` reader and pointing `git` at it, if Plan 21's open question 1 shows a harness exposes it); that changes `rev` and no shim code.
- Contract, **the `session_hint` reader** (a reader-table entry added through Plan 24's seam: a table entry in `yakka.py`, a matching entry in `mcp-readers.json`, a declaration). It reads a fixed pointer that the session-start path wrote locally (the hook-side pointer is Phase 4's, and the pointer's key, location and write rule are settled there) and returns `{"session_id": <string or null>}`; the id must match `[A-Za-z0-9._:-]{1,256}`, otherwise the value is null, and null also when no pointer exists. Only the one fixed pointer file is opened, as a regular file, never through a symlink, with a size cap, so no other file content can reach the server. It takes no parameters from the server, and its inputs are only the shim's own working directory and parent process, which its table entry names. It returns no path, process id or pointer content other than the id, reads no environment variable (never `YAKKA_ACTION_*`), writes and deletes nothing, runs no process and touches no network. Its failure codes are Plan 24's closed set (`timeout`, `io_error`, `over_budget`, `secret_in_context`, `internal`), and the shim's bearer-key check applies to it as to every reader. The pointer edit is a Plan 22 change to the session-start hook path, outside Plan 24's own no-hook-change scope, and lands after Plan 24 Phase 4 has closed, so Plan 24's byte-identical-hooks check is never run against it. The pointer is not a queue file: it is kept out of the `*.evt` namespace, so neither the drain nor Plan 24's `queued_locally` count sees it. It is built only if Phase 4 keeps `session_hint`; if Phase 4 drops it, the declaration, table entry, conformance entry and hook pointer all go. `yakka.py` still holds no tool name, description or wording, so Plan 24's guard test passes unchanged.
- Contract, **`record_action`** (`scope: read_write`, because it stores a fact and `POST /v1/ingest` already refuses a `read` key; `readOnlyHint:false`, `idempotentHint:true`, `destructiveHint:false`; `timeout_s` 20, the default; default body cap. Idempotent in effect: repeating the action already in force adds nothing, Record domain):
  - Description (as the server serves it): "Record what this session is working on, so its cost is reported against that work: the kind of work, and the plan or the GitHub issue or PR it belongs to. Call it again when the work changes; the earlier action ends where the new one begins. Kinds: design, refine, build, review, fix, close-out, sync, escalation, triage, research. A plan's subject_id is owner/repo:plan/<docs/plans entry name>; an issue or PR is owner/repo#N. A call that fails with `unreachable`, is cancelled or times out may still have been recorded; repeating it is harmless."
  - Input: `kind`, `subject_type`, `subject_id` (required), `phase`, `repo`, `pr` (optional), `session_id` (optional escape hatch; at most 256 bytes, no control characters, otherwise a tool error before any reader matters; an injected `session_hint` that fails the same test is treated as no hint). The definition's schema lists `kind` and `subject_type` as enums; the server validates every field against the Action contract regardless of the schema.
  - Declared local context, injected by the shim as the table above sets out: `cwd` (absolute path of the shim's working directory), `repo_id` (`git.repo_id` for that cwd, as `artifact_feedback` computes it: normalised remote, or `root:<sha>`), and `session_hint` (the session id the session-start hook recorded for this harness process and cwd, if it recorded one; null otherwise). All three are optional. A call with none of them still works when `session_id` is given.
  - Instruction (the tool's `instruction` field, appended to the server's `instructions` in registry order and only for callers whose scope can call the tool, so a `read` key is never told to call it), in the style of plan 21's feedback sentence: "When you start work on a plan, issue or PR, or change to a different kind of work, call record_action so its cost is attributed to it."
  - Validation and behaviour: validates with the Action contract. Invalid input returns a tool error naming every reason code that applies and records nothing (the reply text: `not recorded: <codes>`, then one line of fix per code); the tool never records a `rejected` row. A value that trips the secret scan is refused the same way, naming the pattern and never the value. On success it builds a `source:"mcp"` fact, stores it through the ingest function, and returns `recorded` with the normalised action, the session it bound to, and the line "reported in work_cost once projected". Projection stays asynchronous. The call needs the server, so it does not work offline (Assumption 31).
  - Binding: with `session_id`, that id is used (the reply says so when the server holds no facts for it yet, since the session's own facts may still be queued). Without it the server resolves the calling session from the declared context by the mechanism Phase 4 settles, within the caller's own tenant only; if it cannot do so unambiguously it returns `ambiguous_session`, the candidates it saw (each a session id, its harness and the age of its latest fact, never a path), and every reader failure code it received, and records nothing. It never writes to a guessed session. `cwd` and `session_hint` are claims: the server compares them with values it already holds, opens no path from them, and neither stores nor echoes `cwd`. A `session_hint` or `session_id` naming a session the caller's tenant does not hold is the same case as one the server holds no facts for, so one tenant's session ids cannot be probed from another.
  - Changing work mid-session is another `record_action`; the earlier action's segment ends where the new one begins.
- Contract, **`work_cost`** (`scope: read`, `readOnlyHint:true`, `timeout_s` 20; the tool's `instruction` is the sentence "Call work_cost to see cost by plan, phase, issue, PR or kind."): description "Cost by the work it was spent on, from the session tags. Group by plan, phase, kind, subject, pr or source; filter by plan, subject, pr, kind and time. Untagged and rejected cost is shown as its own rows unless a tag filter excludes it." Input `group_by` (array of up to three from `plan, phase, kind, subject, pr, source`; default `["kind"]`), filters `plan`, `subject`, `pr`, `kind`, `since`, `until`. Declared local context: none, so the shim adds auth only. Output: one row per bucket (`cost_usd`, tokens, `sessions`, `unpriced_calls`), the untagged and rejected buckets present when they have cost and no tag filter is set, and a total that reconciles with the total of the same filters and window; the rows equal what `/v1/analytics/query` returns for the same filters, as it is a view over that query.
- Non-goals: editing or deleting a recorded action (a correction is a later action, or a `review` fact); a `list_actions` tool (`work_cost` and `GET /v1/actions` cover reads); any logic, wording or validation in `yakka.py` or the shim; a client-side session-id lookup other than `session_hint`.

### Domain: Back-fill

- Owns: labelling past sessions with the kind of work they did, by one deterministic rule, as `session_action` facts. Amended 19 Nov 2026 (Decisions (5)): the back-fill is a one-off on codyh-ubuntu, not an ongoing pipeline of staged passes. There is no model call, no confidence threshold and no human accuracy gate.
- Contract:
  - Runs on codyh-ubuntu as a tool beside `tools/transcript/` (`tools/session_backfill/`, first built as Pass 1) and submits through the same enqueue writer and drain as everything else: facts carry `source:"backfill"`, `method:"deterministic"`, `confidence` and `evidence`. One action per session; splitting a past session into several is out of scope. The conversation id of a past session is its own session id.
  - **The rule.** An agent's work kind is read from the transcript's own signals. A session is labelled only when it has exactly one matching signal. Signals, and the kind each gives (the kind names are the existing closed vocabulary; no kind is added):

    | Signal | Where it is read | Kind | Meaning |
    |---|---|---|---|
    | a load of the plan skill: skill id `design` (current), or `plan` (until 15 Sep 2026) or `planning` (until 26 May 2026), with or without a namespace prefix (`yakka:design`, `workflow:plan`) | any point in the transcript | `design` | planning |
    | a load of the `refine` skill | any point | `refine` | refining |
    | a load of the `execute` skill (or its old id `plan-execution`) | any point | `build` | executing a phase |
    | a brief path, `docs/plans/<plan>/briefs/<file>.md` (absolute or relative), in the session's first user prompt | the first user prompt only | `build` | a build worker handed a brief |

    The skill id is matched on the part after the last `:`. Those ids were verified in this repo: the current skills are `design`, `refine` and `execute` (`plugins/yakka/skills/*/SKILL.md`, `name:`); `plan` became `design` in `a0fb545` (15 Sep 2026); `planning` and `plan-execution` became `plan` and `execute` in `238e69b` (26 May 2026); and the plugin was `workflow` (so `workflow:plan`) until its rename to `yakka` (3.0.0, CHANGELOG 18 Oct 2026). Both `plan` and `design` mean planning. The table lives in one place in the tool. Other skills (`close-out`, `comprehensive-review`, `post-build`, `iterate` and the rest) are not signals: loading one neither labels a session nor makes it multi-signal.
  - **One signal labels; anything else does not.** Signals are counted by signal class (the Meaning column: planning, refining, executing, brief), so loading the same skill twice, or `plan` and `design` in one session, is one signal; `execute` and a brief path are two classes even though both give `build`. A session is **left unlabelled** when it has no signal, or more than one (several workflow skills, or a workflow skill and a brief path). The design does not invent a split, a dominant skill, a last-skill rule or any other rule for several signals; that remainder is shaped later (below). An unlabelled session enqueues nothing.
  - **Identity.** The plan, phase and issue come from the signal's own text: the skill arguments where the transcript carries them (the Claude `Skill` call's `args`, or the text after a slash command), and the brief path, which names the plan folder and, from the file name `<phase>-<NN>-<slug>.md`, the phase. Plan identity is read from the arguments or path with the tool's existing plan and phase patterns. Where those give nothing, the tool's existing subject extraction (a `docs/plans/<plan>` path touched, the branch, the cwd, an issue or PR number), taken as built with no new rule, may fill the subject at a lower confidence. Subject needs `--repo` (the existing option). A session with a single signal but no subject is **not** enqueued, because a fact is a complete action or nothing; it is counted as `no_subject` in the report. `confidence` is `1.0` when the subject came from the skill arguments or the brief path and `0.65` when it came from the fallback evidence; no threshold uses it. `evidence` names the signal and where the subject came from, secret-scrubbed, at most 300 characters.
  - **Skill-load shapes per harness.** Claude: a `Skill` tool call (`input.skill`, `input.args`), or a `<command-name>` slash-command line. Cursor: a `<manually_attached_skills>` block in the user message. Codex and OpenCode: no shape is documented in this repo; the rebuild looks at real transcripts read-only (shapes and counts only, no content printed) to find the recorded form. A harness either gets a recogniser, proven by a fixture built from the shape found, or the report records that no skill-load form was found there (what was inspected and how many transcripts, no content); it then labels by brief path only. The report then shows that harness's skill-based remainder as no-signal, which is what the follow-up review needs to see.
  - **Subagents fold into the parent.** A subagent transcript is not a session and is not labelled; its cost is assumed to ride on the parent's `conversation_id` (Assumption 16; the real-data check is Phase 3 item 4 and is still unverified). Discovery skips Claude `subagents/` transcripts (about 361 in the dry run), as it already skips Cursor's. A transcript that a store marks as another session's child is skipped the same way; none is known for Codex or OpenCode.
  - **The count report.** The dry run and the real run print, per store (claude, codex, cursor, opencode) and in total: sessions, `labelled` (a single signal and a subject; these are enqueued), and sessions left unlabelled, split by reason: `multi_signal` (more than one signal), `no_signal` (none), `no_subject` (one signal, no subject), `unreadable` (the existing unreadable-transcript and missing-identity rows). `labelled` is also split by signal (planning, refining, executing, brief), so a reader sees how much rests on each. Every discovered session appears in exactly one of those rows. Three counts sit beside the rows so the totals reconcile with discovery: Claude subagent transcripts skipped, transcripts skipped as another session's child in any other store, and duplicate conversation ids (a conversation id seen in two transcript files counts once and enqueues once). These counts are the outcome that the follow-up review works from; they did not exist before this amendment.
  - **The remainder is for a follow-up review with Cody.** After the counts are reported, Cody and the Solution Designer decide what, if anything, to do with `multi_signal`, `no_signal` and `no_subject` sessions. That is a review of the counts, not a classification pass designed here, and it may produce a later design or nothing.
  - Scope: the four local stores on codyh-ubuntu, not de-duplicated across stores. The inventory is whatever discovery finds; the live dry run found 3,623 sessions (about 3,260 once Claude subagent transcripts are skipped, an estimate), not the ~6,463 earlier estimated, so the earlier per-store figures are not used. Cost for a session shows in queries only where the server holds that session's facts (sessions after 23 Oct are on api.yakka.build).
- **Why the first design was dropped (evidence, not machinery).** Phase 5's live dry run (codyh-ubuntu, 8 Nov 2026, 1:04-1:06 AM AEST; `reports/5-03-live-dry-run.md`) under the old rules (kind only from queue logs or a later TypeSafe pass): 0 of 3,623 sessions were complete, so every session would have waited on TypeSafe or review. The raw label file is gone and no new scan was run for this amendment.

  | Store | Sessions | Complete | Partial | Unresolved |
  |---|---|---|---|---|
  | claude | 1,239 | 0 | 1,156 | 83 |
  | codex | 1,962 | 0 | 1,409 | 553 |
  | cursor | 409 | 0 | 78 | 331 |
  | opencode | 13 | 0 | 0 | 13 |
  | total | 3,623 | 0 | 2,643 | 980 |

  Further facts from that run: 2,321 plan subjects, 322 GitHub-issue subjects, 2,236 rows with a phase, 893 with a PR; 1,058 sessions match a Flash-analysis predicate (224 Claude, 824 Codex, 10 Cursor) but were labelled as ordinary work, because the exclusion was OpenCode-only; Claude discovery included about 361 subagent transcripts while Cursor discovery excluded 619; queue logs cannot join to sessions (1,158 `par-*.log` files, 9 with session-id-like text, 0 usable joins); the inventory was 3,623 against the design's ~6,463. These show why the queue-log gold set, the accuracy bars and the Flash gate failed. They are not skill-load counts; skill-load and multi-signal counts do not exist yet and are an outcome of the rebuilt pass.
- Non-goals: any model call or prompt egress (no TypeSafe pass); a queue-log join or gold set; accuracy bars or confidence thresholds; a human review export or import as a gate; a Flash exclusion rule; a rule for sessions with several signals; splitting sessions; reading `~/.local/share/workflow/queue`. The `typesafe` and `human` method values and the `review` source stay in the Phase 1 vocabulary as built; this back-fill emits none of them.

### Domain: Harness launch (external to this repo)

- Owns: Coding Harness Manager's `harness pick`: exporting the six vars on every queue launch, from what it already knows (plan, phase, action, harness, issue, PR), with the plan always given as its `docs/plans/` entry name and, for work on a plan's PR, the plan as subject and the PR in `YAKKA_ACTION_PR`. Validation of its own output is not required; the server records whatever arrives.
- Contract: the environment-variable table above. CHM can build and merge against it now; the vars are inert until Phase 2 ships, and a Phase 2 probe failure on a harness may add a channel to this contract by amendment (Assumption 8).
- Non-goals: anything in `plugins/`, `packages/` or `tools/`.

## Architectural Implications

- **Stable docs.** `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md` do not describe the capture and remote surface (they predate it and still say OpenCode is skills-only and Codex has no wiring); the capture contracts live in `docs/design/`. This design depends only on `docs/design/01`, `02`, `03`, `04`, `05`, which are current enough. Their sections to update, at the phase that changes them: `01` event model and normalised events, `02` queue envelope and the env contract, `03` the facts API and the read routes, `04` the MCP tool table (the server's MCP surface), `05` the environment-variable note. Plan 21 edits `02`, `04` and `05` in other sections (config resolution), so these edits are additive. Contracts that outlive the change are promoted at close-out to a new `docs/design/08-session-work-tagging.md`. The two stale docs are reported, not fixed here.
- **Constraint: depends on the MCP shim issue** (decided by Cody, 2 Nov 2026, about 10:57 PM AEST). The server has no MCP endpoint today: its routes are REST only, and all MCP logic (`_MCP_TOOL_LIST`, the `instructions` string, the `artifact_feedback` handler and its local reads) is in `plugins/yakka/client/yakka.py`, `# --- mcp ---`, about lines 1840-2514. The MCP shim issue (#177) builds the server's MCP endpoint and the thin shim, and moves the existing tools; its design is Plan 24 (`docs/design/08-server-mcp-contract.md` on master; the endpoint and shim themselves are not built). This plan depends on it. Its two tools are registered on that endpoint through Plan 24's seam (domain "MCP tools"), and no tool logic, description, schema, wording or validation is added to `yakka.py`. Phases 1, 2, 3 and 5 touch no MCP and can be built and closed before Plan 24 lands (Phase 6 is obsolete and Phase 7 is a follow-up review; the 19 Nov 2026 amendment). Phase 4 is the first to need it. Its server work (the two registrations and handlers, and the direct-endpoint clauses of outcome items 1, 4 and 5: the definitions and declarations as served, scope, validation, the error text, `work_cost` rows) needs Plan 24 Phase 1 (the endpoint and registry). Everything that needs the shim waits for Plan 24 Phase 4 (which in turn needs Plan 24 Phases 1-3): the `session_hint` reader-table entry and its test, the hook pointer, the through-the-shim clauses of items 1, 4 and 5, and the live runs. The `session_hint` entry in `mcp-readers.json`, its declaration and its `yakka.py` table entry land in one change, so the conformance check never sees one without the others. Nothing is built against a guess at the endpoint's internals: the contracts in Plan 24 are the spec, and if Plan 24 is amended before Phase 4 is refined, Phase 4's refine re-reads it and bounces any contradiction here to this design.
- **Constraint: one client; the Go binary is server-only** (decided by Cody, 2 Nov 2026, 10:45 PM AEST). The client side is `plugins/yakka/client/yakka.py` (queue-file parsing, the fact builder, the enqueue writer, the drain), the hook scripts, the OpenCode plugin and the shim. Go edits are server-side only: ingest, the projection, `/v1/actions`, the analytics and cost queries, the admin status block, and the two tool handlers on the MCP endpoint above. No phase edits `packages/yakka/internal/mcp`, `drain`, `facts` or `clientconfig`, the `drain`, `status` or `mcp` subcommands, or the serve-hosted drain in `internal/serve/host.go`. Those are being deleted under the Go client deletion issue (#178). This plan does not depend on that issue: if that code still exists when this plan is built, the build leaves it untouched, with no new features in it and no parity tests against it. `packages/hooklog/tests/fixtures` stay the Python client's fixtures (`test_facts.py` reads them, as the server's own tests read the ones they use).
- **Async by construction.** The projection is a worker step, not an ingest-path step (the existing `Derive` runs synchronously in ingest and is not used). It must run when scoring is off and when the scorer is unreachable, which today delays the screen step with a backoff of up to five minutes; the worker wiring in `serve.go` is a Phase 1 surface.
- **Cost depends on facts.** Cost per bucket is only as good as the per-session facts the server holds, and the segment split is only as exact as the timestamps on cost-bearing facts. Whether subagent usage carries the parent's `conversation_id`, whether Cursor sessions have per-session tokens (the Cursor usage export has no session join key), whether each harness's cost facts carry message time rather than import time, and how many of the ~6,500 older local sessions exist on the server are unverified and open (see Open Questions).
- **Rollout order.** A server without Phase 1 answers `invalid` to an unknown fact type, and the drain moves such a file to `rejected/` for good. The Phase 1 server must therefore be deployed before any plugin release carrying Phase 2 output (session-start tags) reaches a machine that drains to it, and before any Phase 5 facts are enqueued. Phase 4's tools run on the server and emit no client fact, so they have no such ordering; its hook pointer for `session_hint` writes no fact.
- **Plan numbers are not keys.** `docs/plans/` already holds two plans numbered 13, and the design skill says the slug is the key. The issue's `plan/<NN>` form is therefore accepted but not recommended; the entry name is.

### Interaction with Plan 21 (feedback delivery)

Written against plan 21's `DESIGN.md` as merged to origin/master (6a757a8, seven phases), amended so that its client configuration conformance is Python-only (one table, run by the `yakka.py` tests). This section claims no shared Go file: this plan edits no client-side Go (Constraint above), and plan 21's client work is Python. Plan 21's build phases land separately. Plan 21 makes the client fail instead of falling back to `127.0.0.1:8770` when auth and a remote are configured (a `Resolve` contract returning Remote, Local or Error, with a new explicit `YAKKA_MODE=local`), reconciles written files at feedback and Stop, makes `delivered` say whether scoring ran, fixes how Codex calls feedback (the Yakka MCP already loads there; the gaps are `"cwd": "."` in `.codex-mcp.json` and no instruction to call it), retires the legacy MCP, and uploads the 37,931-event legacy Codex backlog once from a staged copy. Re-check this section against plan 21 as amended before Phase 4 is refined.

- **No new fallback path.** The hook, the back-fill and review tools and the drain add no config logic: tagging enqueues, and a drain with an Error config leaves queued files untouched, so `session_action` files stay queued like every other fact and are not moved to `rejected/`. `record_action` and `work_cost` are server tools, reached through the shim with the bearer key from the same login the drain uses. Which endpoint the shim contacts, and what it says when there is no login or the server is unreachable, is Plan 24's contract (`bad config`, `unreachable` with the count of writes still queued, `unauthorized`, `timeout`) over plan 21's `Resolve`. This plan adds neither, and carries no listener assertion on 127.0.0.1:8770.
- **No local effect.** This plan declares no `local_actions` or `effects` and needs none. `record_action` writes on the server, through the server's own ingest function, and the shim does nothing but relay it; that is a server-side write, not a shim-run effect, and it is not the effect Plan 24 refuses. Plan 21's server-requested `enqueue_file_snapshot` effect (Plan 24 Open Question 1) is a product decision still pending for Plan 21 alone. No phase here waits on it, and no answer to it changes a contract here.
- **Env vars stay out of config.** `YAKKA_ACTION_*` take no part in `Resolve`, the `YAKKA_ENDPOINT`/`YAKKA_KEY` pair rule, or the new `YAKKA_MODE`, and none of plan 21's rules read them. A `yakka.py` test sets only `YAKKA_ACTION_*` and asserts the resolved config is unchanged. The two plans' variable names do not overlap.
- **Fixtures.** Plan 21's conformance table covers config resolution only and is not used here. This plan's fixtures are the action-contract table (Action contract domain, server-side, with its length cases read by the OpenCode plugin test) and the Python client's `packages/hooklog/tests/fixtures`.
- **Shared files and ordering.** Both plans edit `plugins/yakka/client/yakka.py` and the hooks, in different places: plan 21 the drain and the fact builder (reconciliation at Stop and feedback) and the Stop and SessionEnd hooks; this plan the queue parser and builder for a new event and fact type, the enqueue writer, and `spool.sh` and `codex.json` (session-start only). Plan 21 also edits the MCP `instructions`, the `artifact_feedback` description and state wording, and `.codex-mcp.json`. Those edits are in `yakka.py` until the shim issue moves the tools to the server, and on the server after it; this plan edits none of them in either place, and adds only its own two tools, each with its own `instruction` sentence, to the server's MCP surface. Where both plans touch that surface, `instructions` and the tool registry and the `instruction` fields (Plan 24's `internal/serve/mcp*.go`), the edits are additive and whichever merges second rebases. Plan 21's Phase 4 surfaces scoring state from the service (the screen and score worker, `/v1/artifacts`, the admin operations page) and this plan's Phase 1 edits the worker wiring in `serve.go` and the admin status block; also additive. No phase is blocked on plan 21 except Phase 4's Codex row (its open question 1).
- **Codex.** MCP loading is not gated on plan 21 (it already loads). What plan 21 settles, and Phase 4 depends on, is its open question 1: whether Codex gives the MCP server the session's project directory. The shim's `cwd` context for `record_action` has the same dependency. If Codex does not give it, a cwd-based binding cannot work on Codex and Phase 4's Codex row falls back to the agent supplying `session_id` when the server returns `ambiguous_session` (Assumption 13). Env-based tagging (Phase 2) uses no MCP and is not affected.
- **Backlog.** Plan 21's upload sends the backlog's hook events through the same drain. These are old Codex events with no action envelope, so they carry no tags; Phase 5's back-fill of Codex sessions from 23 to 31 Oct should run after that upload so those sessions have cost facts to attach to. Out of order it is harmless: `session_actions` joins by `conversation_id` and counts once the facts arrive. Phase 5 must not read or move `~/.local/share/workflow/queue`.

### Interaction with Plan 24 (server MCP shim) and Plan 23

Written against Plan 24's `DESIGN.md` as on master (f5a9f9e, PR #180: a design only, nothing built, no stable doc yet describing `/v1/mcp` as existing). Plan 24 owns the endpoint, registry, declaration, `_local` carrier, reader table, trust and budget rules and the shim's own errors; this plan owns two registrations and one reader.

- **Names.** `_meta["yakka/tool"]`, `arguments._local`, the readers `cwd`, `git` (`repo_id` is `git.repo_id`), `project_dir`, `session_hint` (this plan's, through Plan 24's three-step seam: a table entry in `yakka.py`, a `mcp-readers.json` entry, a declaration) and the codes `unsupported_reader`, `stale_declaration` (`-32010`), `insufficient_scope` (`-32003`) are Plan 24's words. The earlier text of this plan called `repo_id` a context parameter; it is the logical name for `git.repo_id`, kept because Plan 23 cites it.
- **Reconciled points.** The carrier and the `cwd`/`git` readers are Plan 24's, and the declared-context table binds to them. `instructions` is composed from one sentence per tool and filtered by scope, so each of the two tools has its own. `record_action` is `read_write` (Assumption 37). Transport and config failures reach the agent as Plan 24's own errors. A reader marked `required:false` has its failure handled explicitly by the handler. Each part of Phase 4 names the Plan 24 phase it needs. Nothing in Plan 24 needs amending for this plan.
- **Queue volume.** Phase 5 may enqueue thousands of `*.evt` files while Plan 24's `queue` reader (50 entries per list, a 5 s budget) and `queued_locally` count scan the same directory; Phase 5's refine checks that a feedback call stays within the reader's budget while a back-fill drains, and paces the enqueue if it does not.
- **Plan 24's rules this plan accepts without exception.** No `local_actions` or `effects`; the registry's required-reader gate (not used, all readers optional); the stripping of `_local` before the handler; claims are not identity; absolute paths are not logged or stored; body and time budgets at their defaults; `yakka.py` holds no tool name or wording and its guard test runs against this plan's reader entry.
- **Plan 23** ([landed record](../23-llm-review-shadow.md), local, not read by this design beyond its references to this plan) binds its review to a session by this plan's mechanism and the logical names `cwd`, `repo_id` and `session_hint`, never requires them, and does not change this plan's Intent or phases; a review's cost is not folded into `work_cost`. Phase 4 keeps those three names stable, so a rename here is a Plan 23 amendment.

## Decisions

Decided by Cody and carried in: (1) correlation events go through the ingest path and the projection is asynchronous; env tags and back-fill reach it through the existing client queue and drain, tagging only enqueues, no synchronous action call (Assumption 31 says how `record_action` fits); (2) the three-pass back-fill described above (superseded by (5)); (3) from Cody, 2 Nov 2026, 10:45 PM AEST, amending this design after it was committed: "The go server is only server side now so anything else has to go." The Go binary is server-only and the Python client is the only client, so every Go/Python client parity requirement is removed (Constraints in Architectural Implications; Assumption 15); in the same message, `record_action` and `work_cost` are server MCP tools and the `yakka.py` copy of the action contract is dropped (Assumptions 14, 29, 32); (4) from Cody, 2 Nov 2026, about 10:57 PM AEST, taking precedence: the local MCP shim in `yakka.py` is a thin wrapper, not a surface. It injects auth and declared local context and forwards to an MCP endpoint on the Go server, which holds every tool definition and all logic; the drain stays a separate local piece; a separate MCP shim issue (#177) builds the endpoint and the shim, and this plan depends on it (Assumption 30). The Intent section is left as originally written; this amendment is recorded here. Every other scope decision is in the ledger.

(5) **Amendment of 19 Nov 2026 (Solution Designer, landing on this branch and draft PR #184): the back-fill is one simple rule-based pass.** It supersedes decision (2) and the "three-pass back-fill" in the Intent's decided input; the Intent text is untouched. Cody, 19 Nov 12:09 AM AEST: "All it had to do was check past sessions and check if the agent was planning, refining, executing a phase, or build. I'm not sure why that's complicated - a plan agent has workflow:plan skill it loads, phase agent loads execute skill, build agents are provided a brief path". Cody, 12:10 AM AEST: "Yes start with simple. If an agent only loaded plan, it was planning. Make sense? You only end up with more complicated subset when the agents loaded multiple within the one transcript." Cody, 12:11 AM AEST (scope tightening; the amendment brief's paraphrase, not a verbatim quote): the back-fill is a one-off and stays simple; this plan carries the simple pass only, designs no rule for multi-skill transcripts, has the pass report how many sessions are left unlabelled or multi-skill with counts by harness, and leaves the remainder to a follow-up review with Cody after those counts exist. Where this document still names Phase 6 or Phase 7 as a build phase, or the old Pass 1, 2 and 3, the amendment governs (Domain "Back-fill", Phases, Assumptions 40-49).

Reconciled headlessly with Plan 24 (Assumptions 36-39); in that reconciliation no decision of Cody's was reversed and none was assumed past what the ledger already held. The 19 Nov 2026 amendment in (5) is separate and does supersede decision (2).

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
- Answer chosen: No. `POST /v1/ingest` accepts a new fact type, `session_action`. Several actions per session are several facts. The only new HTTP route is `GET /v1/actions`. The `record_action` tool is a tool on the MCP endpoint of the MCP shim issue (#177), not a route of this plan, and stores its fact through the same ingest function.
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
- Answer chosen: Runtime behavior is unverified for all four harnesses until a safe headless probe observes both hook/plugin execution and exported-variable visibility. Phase 2 may record a documented limit instead of making a runtime support claim when such a probe cannot be safely run; this does not approve a contingency channel. Codex may additionally require a trust review in `/hooks`, which headless `codex exec` can skip. Phase 2's approach is flagged open for that reason.
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

- **Superseded 19 Nov 2026 (Assumption 40):** the accuracy bars, the gold set and the check sample are removed. Kept below as history.
- Question: What accuracy bars make the back-fill passes provable?
- Answer chosen: Pass 1 is scored on the queue-log sessions with the log-derived label masked (prompt, files, cwd and branch only), so the check is not circular; agreement on subject type, id and phase is at least 95% of the sessions it labels, with coverage stated. Pass 2 sets its confidence threshold as the lowest value at which gold-set accuracy above it is at least 90%, with accuracy per kind. The check sample for Pass 3 is the larger of 5% of high-confidence rows and 50 rows, and its agreement rate is the estimate for interactive sessions.
- Rationale: Numbers are needed to prove an outcome; these are judgement calls Cody can move. The gold set is the queue-log sessions only, biased toward templated queue prompts, so only the Pass 3 sample says anything about interactive sessions.
- If wrong: Change the constants; if interactive accuracy is far below queue accuracy, lower the threshold for sessions without a queue log.

### Assumption 18

- **Superseded 19 Nov 2026 (Assumption 40):** no review export or import is built; the follow-up is a review of counts with Cody.
- Question: What surface does Pass 3 review use?
- Answer chosen: A file round trip: `review export` writes JSONL, a human edits verdicts, `review import` enqueues `review` facts. The admin status block shows counts. No UI.
- Rationale: One reviewer, a few hundred rows; the facts path already carries the result; a page is a larger build for no extra proof.
- If wrong: An admin-page list, reusing `RecentRejections` and the rescore pattern; additive.

### Assumption 19

- **Superseded 19 Nov 2026 (Assumption 40):** there is no TypeSafe pass and no prompt egress.
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

- **Superseded 19 Nov 2026 (Assumption 49):** Phase 6 is obsolete and Phase 7 is a follow-up review, not a build phase.
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
- Answer chosen: The issue's five (plan, phase, issue or subject, PR, kind) plus `source`, so a reader sees how much cost rests on unreviewed labels. Grouping by repo, harness or model stays on the existing dimensions. `GET /v1/actions` and the admin block stay small and exist because Phases 1 and 5 prove their outcomes through them.
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
- Answer chosen: Decided by Cody (2 Nov 2026, about 10:57 PM AEST), not assumed. The plan depends on the MCP shim issue (#177). Tool definitions, instructions, wording, validation and behaviour for `record_action` and `work_cost` are specified here on the server's MCP surface and none is put in `yakka.py`. Phases 1, 2, 3, 5, 6 and 7 can be built before that issue lands (as amended 19 Nov 2026: Phases 1, 2, 3 and 5; 6 is obsolete, 7 is a review); Phase 4 is the first to need it and cannot close before it has.
- Rationale: The server has no MCP endpoint today and all MCP logic is in `yakka.py`; a design that put new tools there would be moved again by the shim issue, and would hold validation the shim must not have.
- If wrong: The carrier is now fixed by Plan 24 (Assumption 36). If Plan 24 is amended (a different carrier for declared context, say), only the shim-boundary and declared-context contracts and Phase 4's surfaces change; the tool contracts and the other six phases do not.

### Assumption 31

- Question: Does `record_action` still work offline and enqueue, as the first version said?
- Answer chosen: No. The server records the action through the same ingest function and the projection stays asynchronous, so a `record_action` call needs the server and fails with the shim's own error when it is down (Plan 24: `unreachable`, which on a refused connection means nothing was sent, but on a reset or a `5xx` may follow a handler that ran; `timeout`, which says the call may have completed). Env tags and back-fill still enqueue and drain, so Cody's decided input (correlation events go through the ingest path, no synchronous action call) holds for them; for `record_action` the call stores one fact and returns, with no synchronous projection and no new write route.
- Rationale: Cody's instruction for this plan: the server validates `record_action` against the contract and records through the async ingest and projection path. Validation on the server needs a round trip, so an offline queue would hold unvalidated input the agent cannot correct.
- If wrong: If an offline `record_action` matters, the shim would need to queue a call, which contradicts "holds no logic" and is for the shim issue to decide; the tool contract does not change.

### Assumption 32

- Question: Does `work_cost` stay in Phase 3?
- Answer chosen: No, it moves to Phase 4, with `record_action`. Phase 3 keeps the server query (`action_*` dimensions on `/v1/analytics/query`), and the back-fill phases check cost through that query instead of the tool.
- Rationale: `work_cost` is a registry entry on an endpoint that does not exist yet. Leaving it in Phase 3 would hold Phases 3, 6 and 7 behind the MCP shim issue, when only the tool needs it. This keeps the dependency to one phase.
- If wrong: If the tool should ship with the query, Phase 3 takes it and the dependency spreads to Phases 3, 6 and 7. Nothing else changes.

### Assumption 33

- Question: Which local context does each tool declare, and is `session_hint` allowed as local context?
- Answer chosen: `record_action` declares `cwd`, `repo_id` and `session_hint`; `work_cost` declares none (auth only). The names, meanings and reader mapping are in the declared-context table (Assumption 36). `session_hint` is a local fact the shim reads from a pointer the session-start hook writes (Phase 4 owns the pointer's path or key and the shim's `session_hint` reader-table entry; Plan 24 owns the mechanism and the `cwd` and `git` readers, `repo_id` being `git.repo_id`); it is not a session id the shim invents, and Phase 4 may drop it if the server-side resolution in Assumption 13 passes the outcome without it. `session_id` stays an agent-supplied argument, not context.
- Rationale: Whether a hook-written pointer is acceptable local context is not covered by Cody's enumerated list (file content, a resolved path, git identity, local queue and drain facts) and is an Open Question; the headless default is yes, because Cody allows local context for values only readable on the agent's machine, and names file content, a resolved path, git identity and local queue and drain facts; `cwd` is a resolved path, `repo_id` is git identity and the pointer is a local spool fact. The server, not the shim, decides which of them a tool gets.
- If wrong: If a hook-written pointer is not acceptable local context, `session_hint` is dropped and binding relies on `cwd` and `repo_id` or a required `session_id`; the hook edit in Phase 4 goes with it.

### Assumption 34

- Question: How do plan 21's MCP wording edits and this plan's tools meet, now that the tools move to the server?
- Answer chosen: Plan 21 edits the `instructions` string, the `artifact_feedback` description and state wording; they are in `yakka.py` today and on the server after the MCP shim issue. This plan adds two tools, each with its own `instruction` sentence, to the same surface and edits none of plan 21's. The edits are additive; whichever merges second rebases. How plan 21 sequences against the shim issue is not decided here.
- Rationale: The two plans cannot both be told to avoid the surface; additive edits to a string and a registry are the smallest overlap.
- If wrong: If plan 21's MCP edits are built first in `yakka.py` and the shim issue moves them, nothing here changes.

### Assumption 35

- Question: Which numbers and labels does the design fix that its sources do not?
- Answer chosen: The maximum value length is 256 bytes; the projection step runs at least every 10 seconds and gives a fact three attempts; a tagged call with no value for a dimension falls in `(none)`; a rejected action never ends a segment; a `record_action` fact has `id` `mcp:<conversation_id>:<ts in milliseconds>` and `harness` `unknown` when the server holds no facts for the session yet.
- Rationale: Phase outcomes must be checkable without asking, and these were the values a test would otherwise have to invent. The 256-byte maximum is about 1.6 times the longest plan subject id in the contract; the cadence, attempt count and `(none)` label are judgement calls with no data behind them.
- If wrong: Change the constants in the contract file or the worker and re-project; stored facts are unchanged. A different harness value for facts with no conversation yet is a one-line change.

### Assumption 36

- Question: Do the context names this design cited survive Plan 24's registration seam, and what are the actual name shapes?
- Answer chosen: The logical names `cwd`, `repo_id`, `session_hint` stay (Plan 23 cites them), mapped onto Plan 24's shapes: reader `cwd` (`_local.cwd.path`); reader `git{of:"cwd"}` (`_local.git.repo_id`, with `error` a fact); reader `session_hint` (`_local.session_hint.session_id`). `record_action` declares them in that order, each `required:false`; `work_cost` declares nothing. Declaration `v:1`, reader `v:1`. Where the declaration says `of:"cwd"` a later amendment may point it at `project_dir` (Plan 24 allows it) with no shim change.
- Rationale: Plan 24 has no `repo_id` reader and says Plan 22's `repo_id` is `git.repo_id`; the readers must be optional because the tool works with `session_id` alone, and Plan 24 tells a handler to treat an optional reader's failure explicitly. Unknown or too-new readers degrade to a failure code under Plan 24's version rules, so an old plugin loses only `session_hint`.
- If wrong: a rename is a declaration change plus a table entry (Plan 24's own words); the tool contracts do not change.

### Assumption 37

- Question: Which scope does `record_action` declare, and where does its instruction sentence go?
- Answer chosen: `record_action` is `read_write`: it stores a fact, and `POST /v1/ingest` already answers 403 to a `read` token. `work_cost` is `read`. Each tool has its own `instruction`, so a `read` key neither sees nor is told to use `record_action`, and a direct call is `-32003`.
- Rationale: A `read` key that could write facts through MCP would be a scope widening the REST API refuses; Plan 24 leaves the declaration to this plan and lets the registry enforce it.
- If wrong: if read-only keys should be able to tag, `/v1/ingest` scope and the tool must move together, which is a product decision about key scopes, not a design detail.

### Assumption 38

- Question: Is `session_hint` an acceptable reader under Plan 24's safety rules, and what may the server do with it?
- Answer chosen: Yes, as a read-only table entry: fixed pointer, no server-supplied parameters, returns only a bounded id, reads no environment, writes nothing, runs no process, and is kept out of the `*.evt` namespace. The server treats it and `cwd` as claims: they select a session inside the caller's own tenant, are compared and never opened, and `cwd` is not stored, logged or echoed. A hint for a session another tenant holds looks like one the caller's tenant has no facts for.
- Rationale: Plan 24 names `session_hint` as a seam use and forbids server-chosen commands, paths and environment reads; this meets that and keeps cross-tenant probing out. The pointer's location and write rule stay Phase 4's because Phase 4 is open on binding.
- If wrong: if a hook-written pointer cannot meet the reader safety rules, `session_hint` is dropped with the pointer and the hook edit (Assumption 33), and binding rests on `cwd`, `repo_id` and `session_id`.

### Assumption 39

- Question: How much of Phase 4 waits on Plan 24, and when?
- Answer chosen: The two registrations, handlers and the direct-endpoint tests (the direct-endpoint clauses of outcome items 1, 4 and 5) need Plan 24 Phase 1 (endpoint and registry); the `session_hint` reader and hook pointer, the through-the-shim clauses and the live runs on each harness, and the close, need Plan 24 Phase 4, whose shim and readers are what the harnesses call. Plan 24 Phases 2 and 3 (the three existing tools) are prerequisites of its own Phase 4, not of any server work here.
- Rationale: The server tests call the endpoint directly; the readers and relay exist only after the shim cutover.
- If wrong: if Plan 24 is built in a different order, Phase 4's refine takes the order as built and changes nothing in the outcome.

### Assumption 40

- Question: Does the back-fill keep the three passes, the queue-log gold set, the accuracy bars and the human review gate?
- Answer chosen: No. Cody decided (19 Nov 2026, 12:09-12:11 AM AEST; Decisions (5)) the simple rule, single-signal labelling, the counts-by-harness report, no rule for the multi-skill remainder and the follow-up review; the amendment brief for his request directed the removals listed here. What follows in Assumptions 41-48 is the designer's, ledgered and open to Cody's change. One deterministic rule reads the work kind from the transcript's skill loads and brief path. Removed: the TypeSafe classification pass and its prompt egress, the queue-log ground-truth join and gold set, the accuracy bars (95% first-pass agreement, the 0.90 TypeSafe threshold, any per-kind minimum, the 5%/50 check sample), the confidence threshold, and the formal human-review export and import as a gate. The back-fill is a one-off on codyh-ubuntu, not a pipeline.
- Rationale: Those layers are why the back-fill never finished: under the old rules 0 of 3,623 sessions were complete (Domain "Back-fill", evidence), the gold set was empty because no queue log joins to a session, and every session waited on a model pass or a human. The workflow already records what the session was for.
- If wrong: if the simple pass leaves too much unlabelled, the follow-up review with Cody (Assumption 43) decides what to add; nothing here forecloses a later pass, and the server vocabulary still carries `typesafe` and `human`.

### Assumption 41

- Question: Which kind does each signal give, given the closed ten-kind vocabulary has no `execute`?
- Answer chosen: The plan skill gives `design`, `refine` gives `refine`, the `execute` skill gives `build`, and a brief path gives `build`. No kind is added. The report splits labelled sessions by signal (planning, refining, executing, brief), so a phase agent and a build worker are still told apart in the counts even though both are `build` in cost queries.
- Rationale: Adding a kind is a server contract change and release (Assumption 20), and Phases 1-3 are built against the ten. A phase agent is the build stage of a plan, and its cost is the cost of the phase it runs.
- If wrong: if executing a phase should be its own kind in `work_cost`, add `execute` to the contract file, its fixture row and a server release, then re-project; labels are re-emitted with the new kind for sessions whose signal is the `execute` skill. Raised for the follow-up review with Cody.

### Assumption 42

- Question: Which skill ids count, and do other workflow skills count?
- Answer chosen: Verified in this repo (recon of `plugins/yakka/skills/`, `CHANGELOG.md` and git history): the current ids are `design`, `refine`, `execute` (shown as `yakka:design` and so on when installed through the marketplace). Earlier ids: `plan` (renamed to `design` in `a0fb545`, 15 Sep 2026), `planning` and `plan-execution` (renamed `plan` and `execute` in `238e69b`, 26 May 2026), under the plugin name `workflow` until the 3.0.0 rename (CHANGELOG, 18 Oct 2026), so `workflow:plan` and `workflow:execute` appear in older transcripts. The id is matched on the part after the last `:`, and `plan`, `planning` and `design` all mean planning. Only these three families are signals. `close-out`, `comprehensive-review`, `post-build`, `login` and non-workflow skills are ignored: they neither label a session nor make it multi-signal.
- Rationale: The ids Cody named are plan, refine and execute; execute itself runs terminal review and close-out, so counting those would turn most execute sessions into multi-signal ones for no gain. The rename history is why both `plan` and `design` are accepted.
- If wrong: add or remove a row of the id table, which is one place in the tool. A session that only ran review or close-out is `no_signal` and visible in the counts. Known inflation risks, accepted and left to the counts: a bare slash command such as Claude Code's built-in `/plan`, or another plugin's skill with the same name, would count as a signal; and in a harness without separate subagent transcripts, `refine` run inside an `execute` session shows as `multi_signal`.

### Assumption 43

- Question: What happens to a session with several signals, or none?
- Answer chosen: Nothing: it is left unlabelled and enqueues nothing. Signals are counted by signal class (planning, refining, executing, brief), so the same skill loaded twice, or `plan` and `design` together, is one signal; a workflow skill plus a brief path in the first prompt is two, and `execute` plus a brief path is two even though both give `build`. The brief path counts only in the first user prompt (a worker is handed its brief at launch; an orchestrator mentions many paths later). No split, dominant-skill, last-skill or other rule is designed. The report counts `labelled`, `multi_signal`, `no_signal`, `no_subject` and `unreadable` per store, and the remainder is shaped in a follow-up review with Cody after those counts exist. That follow-up is recorded here and is not a designed classification pass.
- Rationale: Cody, 19 Nov 12:10 and 12:11 AM AEST: "You only end up with more complicated subset when the agents loaded multiple within the one transcript", and the scope tightening to the simple pass only. A rule written before the counts is a guess about a remainder nobody has measured.
- If wrong: if the remainder is small, the review may label it by hand or leave it; if large, it commissions a later design. A brief-path-only rule that over-fires (for example a Flash analysis whose prompt quotes a brief path) shows up as an inflated brief count, which is why labelled sessions are split by signal.

### Assumption 44

- Question: Where do plan, phase and issue come from, and what if the signal gives no subject?
- Answer chosen: From the signal itself: the skill arguments where the transcript carries them, and the brief path (the plan folder, and the phase from the file name). Where those give nothing, the evidence Phase 5 already extracts (a `docs/plans/<plan>` path touched, branch, cwd, an issue or PR number) may fill the subject at confidence 0.65, against 1.0 for a subject from the arguments or brief path. A session with one signal and no subject is not enqueued (a fact is a complete action or nothing) and is counted as `no_subject`. `--repo` stays required for a plan subject. Confidence carries no threshold; it only lets `GET /v1/actions?max_confidence=` separate the inferred rows.
- Rationale: A planning session on a new plan has a skill load but its arguments are problem text with no plan id, so the plan path it writes is the only subject. Keeping the already-built extraction costs nothing and its two confidence tiers become one.
- If wrong: if the fallback mislabels subjects, drop it and let those sessions be `no_subject`; one condition in the tool.

### Assumption 45

- Question: What does a Claude subagent transcript do, and what of the other stores?
- Answer chosen: Subagent transcripts fold into the parent session and are not labelled as their own work. Discovery skips Claude `subagents/` transcripts (the dry run counted about 361), as it already skips Cursor's. Codex and OpenCode have no known child marker, so no rule is built for them.
- Rationale: Subagent usage is assumed to carry the parent conversation id (Assumption 16, a Phase 3 check on real data, unverified). A subagent that loaded a skill is the parent's own execution, not a second piece of work, and counting it would also create multi-signal parents. The first build's dry run labelled subagent transcripts under their own ids, so this is a change from it.
- If wrong: if subagent facts do not carry the parent id, their cost stays `(untagged)` after the back-fill, because the skipped transcripts are not labelled either; Phase 3 item 4 reports it and the follow-up review decides.

### Assumption 46

- Question: Does the Flash exclusion rule stay?
- Answer chosen: No. Dropped, with its OpenCode-only gate and the 890 figure. The dry run showed the store-gated exclusion matched none and the predicate matched 1,058 sessions across Claude, Codex and Cursor, labelled as ordinary work. Under the simple rule a Flash analysis session that loads none of the three skills and has no brief path in its first prompt is `no_signal`, which needs no exclusion.
- Rationale: The exclusion existed to keep the classification and gold set clean; with no model pass it has no job. The count it was built on (890 against 1,058) did not hold.
- If wrong: a Flash prompt that quotes a brief path would be labelled `build`; it shows as an inflated brief count in the report and is for the follow-up review.

### Assumption 47

- Question: How is a skill load found in each harness's transcript?
- Answer chosen: Claude: a `Skill` tool call, or a `<command-name>` slash-command line. Cursor: a `<manually_attached_skills>` block. Both shapes are known from `tools/quality/interventions.py`, `tools/transcript/parsers/cursor.py` and one redacted fixture. Codex and OpenCode: unknown in this repo; the rebuild checks real transcripts read-only for the recorded form (shapes and counts only, no content printed). A harness with no recoverable skill load labels by brief path only, and the report says skill loads are unsupported there.
- Rationale: The counts by harness are the point of the pass; a harness that cannot show a skill load shows up as no-signal and the review sees why.
- If wrong: a harness whose shape is found late adds one recogniser and a rerun; nothing already enqueued changes except that an unlabelled session becomes labelled.

### Assumption 48

- Question: What of the built back-fill and what of the server contract is left in place?
- Answer chosen: Phases 1, 2 and 3 are unchanged. Phase 5's tool stays: discovery of the four stores, the Codex session-identity fix, unreadable-transcript rows, once-only enqueue per conversation, scrubbing, the enqueue writer and `Build`'s fields. It changes: skill and brief-path recognition replaces queue-log truth, queue logs and gold scoring are removed, the Flash predicate and its gate are removed, Claude subagent discovery is skipped, and the report becomes the count report. Phase 6's code (`typesafe_kind.py`, `kind_pass.py`, `tests/test_kind_pass.py`, the README Pass 2 section) is dropped; `jev_client.py` in `tools/transcript/` belongs to that tool and is untouched. The server's `typesafe` and `human` method values, the `review` source and its precedence rule stay as built: they are server contract, harmless and unused, and removing them is a server release for no gain.
- Rationale: Keep what fits; the obsolete layers are all outside Phases 1-3.
- If wrong: if leaving Phase 6 code in the tree is preferred over deleting it, it can stay unused, but it would carry a live-egress option and a private import of `_scrub_evidence`, which is why deletion is the default.

### Assumption 49

- Question: How are the phases reshaped, and how does the amendment land?
- Answer chosen: Phase numbers are kept so existing reports and references still resolve. Phase 4 is unchanged and stays held on Plan 24. Phase 5 is rewritten to the simple pass. Phase 6 is obsolete. Phase 7's human-review accuracy import and export is obsolete as a classification gate and is replaced by the follow-up review with Cody, which is a conversation about counts and not a build phase. The amendment is committed on `feat/22-session-work-tagging` and pushed to draft PR #184 (Solution Designer, 19 Nov 2026); no separate docs PR, no rebase onto master (the branch is 25 ahead and 24 behind `origin/master` and the PR is currently dirty), no application code touched.
- Rationale: Cody asked for the simple pass only; renumbering would orphan the briefs, reports and commit trailers that cite phase numbers.
- If wrong: a renumbering is a docs-only edit later.

## Open Questions

- **Env inheritance (runtime limit until verified):** do the Claude Code, Codex (`codex exec`, with its hook trust review), OpenCode and Cursor (`cursor-agent -p`) session-start hooks/plugins run headlessly and see the launching environment? Phase 2 records a documented limit for each harness whose behavior cannot be safely probed; CHM must not rely on that harness's launch-time tag until a safe probe records the observation. A contingency channel requires a separate design amendment.
- **Plan id (blocks CHM's launcher mapping, not the server):** what does `harness pick` hold for a plan, an entry name or a number? If numbers, the two plans numbered 13 show that one repo can collide, and a resolver is needed.
- **Subagent cost (settled in Phase 3):** does subagent usage carry the parent `conversation_id`?
- **Cursor per-session cost (settled in Phase 3):** does the server hold per-session tokens for Cursor, or are those calls unpriced? This bounds what "cost by plan" can say for Cursor sessions.
- **Back-fill value (settled in Phase 5's dry run):** sessions without facts on the server get an action but no cost; counting them needs the network step, which is part of the gated real run, not the dry run. (The ~6,500 figure did not hold; the dry run found 3,623.)
- **The unlabelled remainder (follow-up review with Cody, after the Phase 5 counts):** what to do with `multi_signal`, `no_signal` and `no_subject` sessions, and whether executing a phase should be its own kind (Assumption 41). Not designed here (Assumption 43).
- **Authorisations (Cody's):** the Phase 5 dry run and the read-only look at Codex and OpenCode transcript shapes are label-only and make no enqueue or network call, but Cody's 8 Nov authorisation was for the first build, so Cody is asked to confirm it covers the rebuilt tool; the real run enqueues and drains facts from codyh-ubuntu and needs its own authorisation.
- Withdrawn by the 19 Nov 2026 amendment: accuracy bars and sample size (Assumption 17), prompt egress to TypeSafe (Assumption 19), and the phase-count question (Assumption 49).
- **Plan 21:** its open question 1 (is the project directory exposed to the Codex MCP server?, which is also Plan 24's open question 4) decides Phase 4's Codex binding; until it is answered `project_dir` returns null and this plan declares `cwd` and `git{of:cwd}`. The interaction section was written against plan 21 as merged and amended; re-check it against plan 21 as it then stands before Phase 4 is refined.
- **Plan 24 (the design for #177; blocks Phase 4 closing, nothing earlier):** its carrier (`_meta["yakka/tool"]`, `arguments._local`), registry, scope rule and error set are settled and used here (Assumption 36). What it leaves for this plan is built in Phase 4: the `session_hint` reader, and the binding mechanism. Its open question 2 (whether Claude Code, Codex and Cursor tolerate `_meta` and what each does after a failed `initialize`) is measured in its Phase 4 and decides where the declaration is read from on that harness (its fallback is a separate declaration route). Its open question 1 (local effects for Plan 21) does not touch this plan.
- **Hook-written pointer as local context (Cody's to confirm; blocks only `session_hint`):** may a pointer the session-start hook writes locally be declared as local context through Plan 24's reader seam? The headless default (Assumption 33) is yes; if no, `session_hint` and its hook edit are dropped and binding rests on `cwd`, `repo_id` and `session_id`.
- **Session binding (settled in Phase 4):** which of the candidates in Assumption 13 meets the outcome on each harness, and whether `session_hint` is needed.

## Phases

Order and count fixed at sign-off; amended 19 Nov 2026 (Decisions (5)): numbering is kept, Phase 5 is the simple back-fill, Phase 6 is obsolete and Phase 7 is a follow-up review. Phases 1–4 build the live path; Phase 5 is the back-fill. Dependencies are exact: a phase may be built once the phases it lists have closed. Only Phase 4 depends on the MCP shim issue (#177, designed in Plan 24); Phases 1, 2, 3 and 5 can be built and closed before it lands.

| Phase | Depends on | Independent of Plan 24 (#177) | Holds that are not dependencies |
|---|---|---|---|
| 1 Action record path | nothing | yes | none |
| 2 Session-start capture | 1 | yes | closing waits on Cody only for a harness that fails the probe (Assumption 8) |
| 3 Cost by work | 1, 2 | yes | item 5 is gated on CHM's change |
| 4 MCP tools | 1, 2, 3 and Plan 24 | no: server registrations and direct-endpoint tests after Plan 24 Phase 1; `session_hint`, shim-relayed clauses, live runs and close after Plan 24 Phase 4 | session binding is open; Codex row waits on Plan 21's open question 1 |
| 5 Back-fill, simple skill and brief-path pass | 1, 2 | yes | a real enqueue and drain waits on Cody's authorisation (Open Questions) |
| 6 TypeSafe kind pass | obsolete | n/a | withdrawn 19 Nov 2026; nothing depends on it |
| 7 Follow-up review with Cody | 5 | n/a (not a build phase) | needs Cody, after Phase 5's counts |

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

Units:

- `2-01-session-start-capture.md` — all session-start capture surfaces, queue parsing/fact building, fixtures and version/docs updates; depends on Phase 1; runs alongside nothing.

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

- Units:
  - `3-01-cost-by-work-query` — brief `docs/plans/22-session-work-tagging/briefs/3-01-cost-by-work-query.md`; depends on Phases 1 and 2; runs alongside nothing. The usage aggregation and HTTP query contract are one unit because their dimensions, filters, measure validation, top-N folding, and reconciliation tests share the same query behavior.

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

- Outcome: First depends on Plan 24 (the design for #177) having been built: for the registrations and the direct-endpoint clauses of items 1, 4 and 5, its endpoint and registry (Plan 24 Phase 1); for the `session_hint` reader and pointer, the through-the-shim clauses and the live runs, and the close, its shim and readers (Plan 24 Phase 4). Then `record_action` and `work_cost` are registered through Plan 24's seam with the definitions in domain "MCP tools", and:
  1. `tools/list` through the shim returns both tools with the description, schema, annotations and declaration in that domain (`record_action`: scope `read_write` and `context` `[cwd, git{of:cwd}, session_hint]` with `session_hint` only if Phase 4 kept it, all `required:false`; `work_cost`: scope `read` and no `context`), a `read` key's `tools/list` omits `record_action` and its `instructions` omit that tool's sentence, a `read` key calling it directly gets `-32003` `insufficient_scope` and records nothing, and the `instructions` of a `read_write` key carry each tool's own sentence. Every reader the declaration names is in `mcp-readers.json` (Plan 24's start-up check), and a call whose `_local` marks `session_hint` as `unsupported_reader` still works on `cwd` and `repo_id` or `session_id`. A diff of `yakka.py` shows no tool definition, description, wording or validation added for either tool (its only addition is the `session_hint` reader-table entry), and Plan 24's guard test passes unchanged.
  2. In a live interactive session on each harness that loads the Yakka MCP, calling `record_action` for `triage`, then for `fix`, with no `session_id`, gives `GET /v1/actions` both actions on that session in order with `source=mcp`, and the server's `work_cost` splits the session's cost at the second call.
  3. With two concurrent sessions of one harness in the same cwd, each call lands on its own session or returns `ambiguous_session` and records nothing.
  4. Invalid input (`kind=buidl`, `phase=x`) returns a tool error naming the reason codes, matching the contract table, and records nothing; no `rejected` row appears. A call with an explicit `session_id` the server holds no facts for records and says so. With the server's port refusing connections the call fails with the shim's own `unreachable` error (Plan 24, asserted there) and records nothing; the same call carrying a stale `_rev` is retried once by the shim (Plan 24) and records one action, not two.
  5. `work_cost` called through the shim carries auth only (a server-side test asserts no context parameter arrived), and returns the same rows as the direct `/v1/analytics/query` call for the same filters, with `(untagged)` and `(rejected)` present when no tag filter is set; a filter on a measure that lacks it is an error.
  The phase closes when Claude Code passes 2–3 and every other row is either passed or recorded as a documented limit with the observed reason: Codex depends on plan 21's answer to whether Codex gives the MCP server the session's project directory (if not, the Codex row passes when a call without `session_id` returns `ambiguous_session` asking for it, and a call with it records), and Cursor on the user-level MCP config. The direct-endpoint clauses of items 1, 4 and 5 are proven by server tests that call the MCP endpoint directly, before the live runs; their through-the-shim clauses are proven once Plan 24's shim exists. That the shim relays replies unchanged, adds only auth and declared context, and what it says with no login or no server are Plan 24's acceptance tests; Phase 4 only exercises them in the live runs.
- Surfaces: the two tool registrations and handlers in the server's MCP registry (Plan 24's `internal/serve/mcp*.go`), `internal/serve/testdata/mcp-readers.json` (the `session_hint` entry, if kept), `internal/actions` (the validation the handler calls), `ingest.Ingest` (the in-process call the handler uses to store its fact; `internal/serve/host.go` already calls it that way for the hosted drain, but this plan does not touch host.go), the session-binding mechanism chosen in this phase (server-side resolution from `cwd` and `repo_id`, and if needed a `session_hint` pointer written by the session-start path, which extends Phase 2's hook edits and is read by the shim only as declared context through the `session_hint` reader), `docs/design/04` (the MCP tool table). No tool definition, description, wording or validation in `yakka.py`; its only edit is the `session_hint` reader-table entry and its test, if kept.
- Approach: open for the session binding; the yardstick is checks 2–4 above and the candidates are in Assumption 13. The tool contracts and the rest are known.
- Depends on: Phases 1, 2 and 3, and Plan 24 (#177): its Phase 1 to build and test the server side, its Phase 4 (which needs its Phases 1-3) to run live and close

### Phase 5 — Back-fill: simple skill and brief-path pass

Rewritten 19 Nov 2026 (Decisions (5)); it replaces "Back-fill pass 1: deterministic extraction". The tool, its Codex identity fix and its enqueue path are built; its method and outcome change.

- Outcome: On codyh-ubuntu, a dry run (no enqueue, no network) over the four local stores prints, per store (claude, codex, cursor, opencode) and in total, the count report of Domain "Back-fill": sessions; `labelled`; unlabelled split into `multi_signal`, `no_signal`, `no_subject` and `unreadable`; and `labelled` split by signal (planning, refining, executing, brief). Every discovered session is in exactly one row and the rows sum to the sessions; the skipped-subagent, skipped-child and duplicate-id counts are printed beside them and, with the sessions, reconcile with the transcripts discovered. The report is recorded under this plan's `reports/` and is what the follow-up review with Cody (Phase 7) reads. Synthetic fixtures for each store the tool reads prove the rule: a session loading only `design` is `design`; only `workflow:plan` is `design`; only `plan` is `design`; only `refine` is `refine`; only `execute` is `build`; a first prompt carrying `docs/plans/<plan>/briefs/<file>.md` and no skill is `build`, with the phase from the file name; the same skill loaded twice is one signal; two different workflow skills, and a skill plus a brief path, are `multi_signal` and produce no label; no signal is `no_signal`; a single signal with no subject is `no_subject` and is not enqueued; a `close-out` or `post-build` load alone is `no_signal`; a Claude `subagents/` transcript is not discovered; and a harness for which the fixture has no skill-load form still labels by brief path; a subject read from the skill arguments gets confidence 1.0, one read from the brief path gets 1.0, and one that only the fallback extraction finds gets 0.65. A real run, once Cody authorises it, enqueues `source=backfill, method=deterministic` facts for `labelled` sessions only (confidence 1.0 from skill arguments or brief path, 0.65 from fallback evidence), writes a scrubbed local label file for the rest, enqueues nothing for the rest, and a second run enqueues nothing new. After drain, the count of `GET /v1/actions?source=backfill` rows equals the run's emitted count less the files the ingest secret scan refused, which the report itemises; The phase closes on the fixtures and the dry-run count report; the real enqueue and the drain count check are a separate step gated on Cody's authorisation, recorded as carried if not yet run. No queue log is read, no model is called, no Flash rule is applied, and `~/.local/share/workflow/queue` is neither read nor moved.
- Surfaces: `tools/session_backfill/backfill.py` (add skill-load and brief-path recognisers per store and the count report; remove queue-log parsing and truth, masked gold scoring, the Flash predicate and its gate, and the 0.55 confidence tier; skip Claude subagent discovery; take the brief path from the first user prompt, not the concatenated transcript), `tools/session_backfill/tests/test_backfill.py`, `tools/session_backfill/README.md` (Pass 1 section rewritten to the simple rule; the Pass 2 section removed), `plugins/yakka/client/yakka.py` (enqueue writer and `Build`, unchanged), `docs/design/02` (already describes the tag-only envelope).
- Approach: known, except open for the Codex and OpenCode skill-load recognisers (Assumption 47); the yardstick is the outcome above, including a recorded search where no form exists
- Depends on: Phases 1 and 2 (the queue-file builder for event `yakka.session_action`, Phase 2 item 5). Built in part: see IMPLEMENTATION.md for what is kept and what changes on rebuild.

### Phase 6 — Back-fill pass 2: TypeSafe kind classification  *(obsolete)*

Obsolete from 19 Nov 2026. There is no TypeSafe pass, no prompt egress, no gold-set accuracy report and no confidence threshold (Assumption 40). Its outcome is withdrawn and nothing depends on it. Built code to drop on rebuild: `tools/session_backfill/typesafe_kind.py`, `kind_pass.py`, `tests/test_kind_pass.py` and the README Pass 2 section; its brief and report stay in the plan folder as history. `tools/transcript/lib/jev_client.py` is not part of it and is untouched.

### Phase 7 — Follow-up review with Cody  *(replaces back-fill pass 3, human review)*

Not a build phase. Replaces "Back-fill pass 3: human review" and its `review export` and `review import`, its sampled agreement rate and the admin status extension, none of which are built or needed.

- Outcome: After Phase 5 reports its counts, Cody and the Solution Designer review them and decide, with the counts in front of them, what to do with `multi_signal`, `no_signal` and `no_subject` sessions and whether `execute` should be its own kind. The decision is recorded in the plan folder (a note in `IMPLEMENTATION.md`, or a new design if one is commissioned). No classification rule for that remainder exists in this plan before then.
- Surfaces: none.
- Approach: known
- Depends on: Phase 5's count report.

## Provenance Notes

- **Harness-side start.** CHM can write and merge its `harness pick` change at any time: the table is fixed and exporting unread variables is inert. Phase 2 is the earliest phase against which CHM can verify it by its own run (an exported action showing up in `GET /v1/actions` on each harness), conditional on the probe: a harness whose hook does not fire or does not see the environment changes what CHM must do for it. Phase 3 item 5 is the plan's own end-to-end check with CHM's real launches, and is recorded as gated until CHM lands.
- **Rough build size (before the 19 Nov 2026 amendment; see the amended figure below).** About 3,900 lines including tests (the phases sum to 3,890), about 57% of it tests and fixtures. Phase 1 ~800 (Go, server only; ~60% tests), Phase 2 ~320 (bash, Python, TypeScript, fixtures, probe; ~55%), Phase 3 ~460 (the Go usage-path join and its golden tests; ~65%), Phase 4 ~650 plus exploration (two server tool handlers and registry entries with their tests, the session binding, a small hook pointer and the `session_hint` reader-table entry; ~50%), Phase 5 ~760 (Python, including the enqueue writer; ~55%), Phase 6 ~500 (~60%), Phase 7 ~400 (~55%). Seven phases, each its own PR. The back-fill tail (5–7) is 1,660, about 43% of the total. The shim issue's endpoint and shim are a separate issue and are not counted. The committed design said about 3,800 while its phases summed to 3,950 (Phase 1 ~800, Phase 2 ~450, Phase 3 ~700, Phase 4 ~400, Phases 5–7 ~1,600, roughly 60% tests); an interim amendment said 3,600. The change from the committed phases: the client-side Go edits and parity tests leave Phase 2 (about 130 lines); `work_cost` moves from Phase 3 to Phase 4 (about 240 lines out of Phase 3, mostly the tool and its twin); Phase 4 now holds two server tool handlers instead of client tools; Phase 5 takes the enqueue writer (about 60 lines). These are estimates, not measurements.
- **Rejected: a second Go-side client path, or a second client-side copy of the contract.** Parallel Go-side client edits would have kept the server-only Go binary's client half alive, and a `yakka.py` copy of the action contract would put validation in the shim's side of the boundary. Cody decided both go: no phase carries a Go client edit and the only copy of the contract is the server's.
- **Rejected: MCP tools in `yakka.py`, or a shim with a per-tool context table.** The shim is a thin wrapper that holds no tool list, wording or validation (Cody), and which local context a tool receives is declared by the server in its tool definition, not hard-coded in the shim.
- **Rejected: a shim-side parameter named `repo_id` or `record_action`-specific context.** Plan 24's reader table is the capability allowlist and the server's declaration selects among readers; a per-tool branch in the shim would break its guard test. `repo_id` is a value of the `git` reader, and `session_hint` is a generic reader.
- **Rejected: holding Phase 4 or the whole plan on Plan 21's effect decision.** `record_action` is a server write and needs no shim effect; Plan 24 refuses effects and Plan 21 alone waits on that choice.
- **Rejected: one env var carrying a JSON blob.** It needs quoting by every launcher shell and fails as a whole on one bad character; separate variables fail field by field and show which field.
- **Rejected: a `YAKKA_ACTION_RUN` correlation var** (the queue run name). It would link sessions to queue logs and help the gold set, but the back-fill no longer reads queue logs at all (19 Nov 2026 amendment), and a seventh variable is surface without an outcome.
- **Rejected: a dedicated record endpoint (`POST /v1/actions`).** Cody decided that submission uses the ingest path: the queue and the server's own `record_action` handler both feed it, and projection stays asynchronous. A dedicated route would add its own offline, retry and fallback behaviour, the surface plan 21 is tightening.
- **Rejected: splitting cost evenly across a session's actions, or letting the last tag win.** Both misstate cost whenever a session changes work; the timestamps are already on every fact.
- **Rejected: reading the env in the drain.** The drain is a detached background process started by a hook or MCP call; its environment is not the harness's.
- **Size after the Plan 24 reconciliation.** The estimate above is unchanged: registering through Plan 24's seam adds, to Phase 4, a declaration per tool, the `session_hint` reader-table entry with its conformance entry and test, and the scope and instruction fields, about 60 lines that the Phase 4 figure already allows for. The seven phases and their order are unchanged.
- **Recon limits.** The server and client facts here come from reading code, not from running it. Verified in this worktree: no `internal/actions` package and no server MCP endpoint exist (the only MCP code is client-side: `yakka.py`'s `# --- mcp ---`, lines 1840-2514, plus Go client code this plan leaves untouched); `ingest.Ingest` is already callable in-process (`internal/serve/host.go`); `artifact_feedback` makes the local reads that the shim's declared context replaces (cwd, stat and content hash, `git rev-parse --show-toplevel`, `RepoID`, a queue-dir scan, the drain lock, `Load()`, the drain kick). Not verified: whether any harness passes its environment to hooks, whether OpenCode plugins run in the opencode process (the plugin reads `process.env` as if they do), whether Codex loads the plugin MCP live, Cursor's hook cwd, the worker wiring that installs the screen step, and whether subagent usage carries the parent id. Each is either a Phase 2/3/4 probe or a ledgered assumption.
- **Rough build size after the 19 Nov 2026 amendment.** About 3,000 lines including tests, down from about 3,900: Phase 6 (~500) and Phase 7 (~400) leave the plan, and Phase 5 stays at or under its earlier ~760 because it is already built and the rebuild edits the existing tool (it adds recognisers and the count report, and removes queue-log, gold and Flash code). Phases 1-3 are built and unchanged. These are estimates, not measurements. The old rows of this section that name Phases 5-7 as one 1,660-line tail no longer apply.
- **Rejected: a rule for sessions with several signals** (a dominant skill, the last skill loaded, a split by time, a precedence between skills). Cody scoped the amendment to the simple pass; the remainder is unmeasured and is shaped in a follow-up review once the counts exist (Assumption 43).
- **Rejected: keeping the TypeSafe pass as an optional second stage.** It carries prompt egress, a gold set the stores cannot supply and accuracy bars, and the back-fill is a one-off; it is not a latent option here. If the follow-up review wants a model pass for the remainder, that is a new design.
- **Rejected: adding an `execute` kind now.** It would change the closed vocabulary of the built Phase 1 contract for a distinction the signal split in the count report already shows (Assumption 41).
