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

A new fact type, `session_action`, travels the existing path: it is written to the client queue, drained with everything else to `POST /v1/ingest`, and projected asynchronously on the server into a `session_actions` table. Three sources write it: the SessionStart hook (reading the `YAKKA_ACTION_*` environment that `harness pick` exports), an MCP tool `record_action` for interactive sessions, and a back-fill tool for past sessions. A session holds a sequence of actions; each owns the span of the session from its start until the next action begins, so cost splits cleanly when work changes mid-session. Cost is read by joining cost-bearing facts to the action in force at each fact's timestamp, through new dimensions on the existing `/v1/analytics/query` and an MCP tool `work_cost`. Untagged, rejected and low-confidence cost is always reported as its own bucket, never hidden or folded in.

There is no new write endpoint. The "action-recording endpoint" the issue asks for is `/v1/ingest` accepting `session_action` facts (decided by Cody: submission is enqueue-only). The only new HTTP route is a read, `GET /v1/actions`.

### Domain: Action contract

- Owns: the closed vocabularies and validation rules for an action: kinds, subject types, id formats, normalisation, and rejection reason codes. One contract file in the Go server package is the source of truth; the Python client and the OpenCode plugin carry parity copies checked by a shared-fixture test.
- Contract:
  - `kind` ∈ `design, refine, build, review, fix, close-out, sync, escalation, triage, research`. (`unclear` is not a kind; an unclassifiable session gets no action.)
  - `subject_type` ∈ `plan, github`.
  - `subject_id`, lowercased as a whole after trimming: plan → `<owner>/<repo>:plan/<name>`, where `<name>` matches `[a-z0-9][a-z0-9._-]{0,99}` and is a `docs/plans/` entry name without `.md` (for example `22-session-work-tagging`); a name that is all digits (`…:plan/158`) is the bare-number form and is accepted and stored as given. github → `<owner>/<repo>#<number>` (issue or PR; the server does not tell which). Owner and repo match `[a-z0-9][a-z0-9._-]*`.
  - `phase`: integer 1–99, optional. `repo`: `<owner>/<repo>`, optional, lowercased, no host. `pr`: positive integer, optional. Integer strings may carry leading zeros.
  - **Which subject.** When the work belongs to a plan, the subject is the plan (`subject_type=plan`) and `pr` carries the PR, including for review, fix and sync on that plan's PR. `github` is for work not tied to a plan (a defect issue, an unplanned PR). Cost for a plan's PR work is then part of that plan's cost; a launcher that tags plan work with a `github` subject takes that work out of `action_plan` queries.
  - Length: a client never sends more than 257 bytes of a value, cut on a character boundary after control characters are stripped, so the server sees an over-length value and rejects it as `too_long`; a truncated value is never accepted.
  - Rejection reason codes: `missing_required:<field>`, `unknown_kind`, `unknown_subject_type`, `bad_subject_id` (matches neither id form), `subject_type_mismatch` (the id is well formed for the other type), `bad_phase`, `bad_repo`, `bad_pr`, `too_long`. A rejected action stores every reason that applies.
- Non-goals: resolving whether a `#N` is an issue or a PR (that needs the GitHub API); merging `plan/158` with `plan/158-foo`; inferring `subject_type` from the id.

### Domain: Capture (client and hooks)

- Owns: reading the `YAKKA_ACTION_*` environment at session start and turning it into a queued fact; the `enqueue` writer used by every non-hook source.
- Contract, **environment variables** (final; set by `harness pick` on the launched process only, never in a profile; a human may export them by hand for an ad-hoc session; the plugin and clients never set them):

  | Variable | Required | Format | Example |
  |---|---|---|---|
  | `YAKKA_ACTION_KIND` | yes | one kind from the closed list | `build` |
  | `YAKKA_ACTION_SUBJECT_TYPE` | yes | `plan` or `github` | `plan` |
  | `YAKKA_ACTION_SUBJECT_ID` | yes | per the Action contract | `codyhamilton/garcia-music:plan/158-ledger`, `codyhamilton/garcia-music#1025` |
  | `YAKKA_ACTION_PHASE` | no | integer 1–99 | `2` |
  | `YAKKA_ACTION_REPO` | no | `<owner>/<repo>` of the repo the work is done in (and where `YAKKA_ACTION_PR` lives); when absent the server resolves it, at query time, to the session's own repo | `codyhamilton/garcia-music` |
  | `YAKKA_ACTION_PR` | no | positive integer | `1083` |

  Rules: if none of the six is set (an empty value counts as unset), no action is recorded and the session is captured exactly as today. If any is set, one action is recorded; a missing required field or a malformed value gives a recorded `rejected` action with its reasons, never an error to the harness and never a changed exit code. The vars are read once, in the harness's own environment, on the session-start event only; they are never read by the drain (a detached background process whose environment may differ). Nothing in `Load()`, `ErrPartialEnv` or any config path reads them, and setting only `YAKKA_ACTION_*` never triggers the one-of-`YAKKA_ENDPOINT`/`YAKKA_KEY` error. The plan name given for one plan must be the same string on every launch: CHM sends the `docs/plans/` entry name consistently (Assumption 3).
- Contract, **queue form and fact**. A session-start tag rides on the session-start event's own queue file: the envelope's first line gains an optional `action` object of raw strings, and the drain emits the usual hook event plus one `session_action` fact. An action from any other source (MCP, back-fill, review) is its own queue file whose envelope names event `yakka.session_action`, carries `source`, `action` and the optional fields below, and whose payload is empty; for that event the builders emit only the `session_action` fact, never a `hook_event`, so no phantom hook events or conversations appear. Both builders decode `action` tolerantly: non-string members are read as their string form, invalid UTF-8 is replaced, and a bad `action` never makes the file unparseable. The fact:

  ```
  {"type":"session_action","id":"<queue file>#<n>","conversation_id":"…","harness":"claude|codex|opencode|cursor",
   "ts":<epoch seconds>,"source":"env|mcp|backfill|review",
   "action":{"kind":"…","subject_type":"…","subject_id":"…","phase":"…","repo":"…","pr":"…"},   // strings as received
   "method":"deterministic|typesafe|human",  // backfill and review only
   "confidence":0.0–1.0, "evidence":"≤300 chars, secret-scrubbed by the sender"}   // backfill only
  ```
- Non-goals: any network call at hook time; Python or JSON parsing in `spool.sh`; setting the vars; Cursor Cloud, which registers no `sessionStart` hook (documented limit).

### Domain: Record and projection (server)

- Owns: accepting `session_action` facts, the asynchronous projection into `session_actions`, and the read API.
- Contract:
  - Ingest accepts a `session_action` fact whenever it is structurally a fact with a `conversation_id`. It never answers 4xx or `rejected` for a bad action value; value errors surface only in the projection. Exceptions, as for every fact: a missing `conversation_id`, and the secret-scan precheck (a value that merely resembles a credential is refused, and its file lands in `rejected/` where `yakka status` shows it; the session is unaffected).
  - Existing views stay as they were: `session_action` facts are excluded from conversation counts, `hook_events` counts and the source and other facet queries, proven by a golden test that seeds them.
  - A projection step in the tenant worker handles unprojected `session_action` facts. It runs whether or not scoring is enabled and whether or not the scorer is reachable, on its own cadence rather than behind the screen step's backoff; a fact that fails to project is retried a bounded number of times and then recorded as failed, never stalling screening or other facts. The store records each fact's projection state so `pending` is exact. A store migration adds `session_actions`, one row per fact: its conversation, `started_at`, `source`, `method`, `confidence`, `status` (`accepted|rejected`), `reasons`, the normalised fields and the raw strings.
  - **Segments** are a pure function of all of one conversation's `session_action` rows, recomputed for that conversation whenever one is projected, so arrival order never matters. Live actions (`env`, `mcp`) start at their fact `ts`; ties are ordered by the fact's hash. Each effective action is valid from its start to the next one's, the first from the beginning of time (so facts that arrive late, or earlier than the first tag, still fall in it). An action equal in all normalised fields to the one in force adds no segment (SessionStart re-fires on resume and compact).
  - **Whole-conversation actions.** `backfill` and `review` actions have no start: each labels the whole conversation. Within one source the latest `ts` wins (and for `backfill`, higher `confidence` first).
  - **Precedence.** If the conversation has any accepted `review` action, only it counts. Otherwise accepted `env`/`mcp` actions form the segments. Otherwise the accepted `backfill` action applies. Rejected actions never count, so a later back-fill can still label a conversation whose live tag was rejected. A session resumed under a different launcher's tag has all its earlier untagged or back-filled time billed to the new tag; `review` corrects it.
  - `GET /v1/actions?conversation_id=&plan=&kind=&status=&source=&max_confidence=&limit=` (bearer read scope) returns projected rows; `plan` is an exact match on the normalised plan name; `pending`, the count of the conversation's unprojected facts, is returned when `conversation_id` is given.
  - `GET /v1/admin/status` gains an `actions` block: conversations tagged and untagged in the last 7 days, rejected counts by reason code, and failed projections.
- Non-goals: a synchronous record call; retroactively rewriting history when the contract changes (a new kind needs a server release, then re-projection from stored facts).

### Domain: Cost by work (server query and MCP)

- Owns: the join from cost-bearing facts to segments, and its exposure.
- Contract:
  - The cost measures (`cost_usd`, `tokens_*`, `model_calls`, `unpriced_calls`, plus a new per-bucket distinct-conversation `sessions`) gain dimensions and filters `action_kind`, `action_plan` (plan subjects only), `action_phase`, `action_subject` (the `subject_id`), `action_pr`, `action_source`. These are served on the existing in-memory usage aggregation, not the SQL dimension tables, and join each priced call to the segment whose span contains the call's `ts`. A call with no segment falls in `(untagged)`; a call whose conversation has only rejected actions falls in `(rejected)`. Any other measure given an `action_*` dimension or filter is an error, not an ignored filter. Queries using no `action_*` field return exactly what they did before.
  - A query may combine up to three dimensions when they are `action_*` (plan × phase × kind). `(untagged)` and `(rejected)` are exempt from top-N folding, and a result's buckets sum to the unfiltered total over the same window.
  - Cost is still priced on read; nothing is stored. `unpriced_calls` is reported per bucket so a harness with no per-session pricing is visible as unpriced, not as $0.
  - MCP tool `work_cost` (read-only): input `group_by` (array of up to three from `plan, phase, kind, subject, pr, source`; default `["kind"]`), filters `plan`, `subject`, `pr`, `kind`, `since`, `until`; output: one row per bucket (`cost_usd`, tokens, `sessions`, `unpriced_calls`), the untagged and rejected buckets always present, and a total that reconciles with the unfiltered total. It uses the client's single resolved-config request path only; it carries no endpoint or fallback logic of its own (see Plan 21).
- Non-goals: a dashboard page; allocating cost within a segment; per-agent attribution inside a session; grouping by repo, harness or model through this tool (the existing dimensions already do).

### Domain: Manual tagging (MCP)

- Owns: `record_action`, and the binding of an MCP call to its session.
- Contract:
  - MCP tool `record_action` (not read-only; idempotent): input `kind`, `subject_type`, `subject_id` (required), `phase`, `repo`, `pr` (optional), and `session_id` (optional escape hatch). It validates with the Action contract and, on invalid input, returns a tool error naming the reason codes and enqueues nothing. On success it writes a `source:"mcp"` queue file and returns `state: queued`, the normalised action, and the session it bound to. It makes no network call, so it works offline and drains later.
  - Binding: with no `session_id`, the client resolves the calling session itself. If it cannot do so unambiguously it returns `ambiguous_session` and enqueues nothing; it never writes to a guessed session. How it resolves is the open part of this design (Phase 4).
  - Changing work mid-session is another `record_action`; the earlier action's segment ends where the new one begins.
- Non-goals: editing or deleting a recorded action (a correction is a later action, or a `review` fact); a `list_actions` tool (`work_cost` and `GET /v1/actions` cover reads).

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

- **Stable docs.** `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md` do not describe the capture and remote surface (they predate it and still say OpenCode is skills-only and Codex has no wiring); the capture contracts live in `docs/design/`. This design depends only on `docs/design/01`, `02`, `03`, `04`, `05`, which are current enough. Their sections to update, at the phase that changes them: `01` event model and normalised events, `02` queue envelope and the env contract, `03` the facts API and the read routes, `04` the MCP tool table, `05` the environment-variable note. Plan 21 edits `02`, `04` and `05` in other sections (config resolution), so these edits are additive. Contracts that outlive the change are promoted at close-out to a new `docs/design/08-session-work-tagging.md`. The two stale docs are reported, not fixed here.
- **Two clients.** The Go client (`packages/yakka`) and the Python client (`plugins/yakka/client/yakka.py`) both parse queue files and both serve MCP, and `packages/hooklog/tests/fixtures` are the parity contract between them. Every change to the envelope, the fact builder or the tool list lands in both, with fixtures, or the phase does not close.
- **Async by construction.** The projection is a worker step, not an ingest-path step (the existing `Derive` runs synchronously in ingest and is not used). It must run when scoring is off and when the scorer is unreachable, which today delays the screen step with a backoff of up to five minutes; the worker wiring in `serve.go` is a Phase 1 surface.
- **Cost depends on facts.** Cost per bucket is only as good as the per-session facts the server holds, and the segment split is only as exact as the timestamps on cost-bearing facts. Whether subagent usage carries the parent's `conversation_id`, whether Cursor sessions have per-session tokens (the Cursor usage export has no session join key), whether each harness's cost facts carry message time rather than import time, and how many of the ~6,500 older local sessions exist on the server are unverified and open (see Open Questions).
- **Rollout order.** A server without Phase 1 answers `invalid` to an unknown fact type, and the drain moves such a file to `rejected/` for good. The Phase 1 server must therefore be deployed before any plugin release carrying Phase 2, 4 or 5 output reaches a machine that drains to it.
- **Plan numbers are not keys.** `docs/plans/` already holds two plans numbered 13, and the design skill says the slug is the key. The issue's `plan/<NN>` form is therefore accepted but not recommended; the entry name is.

### Interaction with Plan 21 (feedback delivery)

Written against plan 21's `DESIGN.md` as it stood in its worktree on 2 Nov 2026 (uncommitted, six phases). Plan 21 makes the client fail instead of falling back to `127.0.0.1:8770` when auth and a remote are configured (a `Resolve` contract returning Remote, Local or Error, with a new explicit `YAKKA_MODE=local`), reconciles written files at feedback and Stop, makes `delivered` say whether scoring ran, fixes how Codex calls feedback (the Yakka MCP already loads there; the gaps are `"cwd": "."` in `.codex-mcp.json` and no instruction to call it), retires the legacy MCP, and uploads the 37,931-event legacy Codex backlog once from a staged copy. Re-check this section against the committed design before Phase 3 is refined.

- **No new fallback path.** Tagging only enqueues. The hook, `record_action` and back-fill never read config and never contact an endpoint, so plan 21's rule cannot be bypassed by them. Plan 21 states that a drain with an Error config leaves queued files untouched, so `session_action` files stay queued like every other fact, and are not moved to `rejected/`.
- **Reads go through the one resolved config.** `work_cost` (Phase 3) uses whatever request path the client has and adds no endpoint or `Load()` logic of its own. Once plan 21's Phase 1 (`Resolve` and its failure contract) has merged, remote configured and unreachable, or not logged in, is plan 21's `unreachable` or `bad config` message, never a loopback answer. Phase 3 proves the routing; if plan 21 Phase 1 has not merged by Phase 3's close, the assertion with a recording listener on 8770 is carried as a named follow-up to plan 21's Phase 1 and recorded in Phase 3's report.
- **Env vars stay out of config.** `YAKKA_ACTION_*` take no part in `Resolve`, the `YAKKA_ENDPOINT`/`YAKKA_KEY` pair rule, or the new `YAKKA_MODE`, and none of plan 21's rules read them. A test sets only `YAKKA_ACTION_*` and asserts the resolved config is unchanged. The two plans' variable names do not overlap.
- **Parity fixtures.** Plan 21's shared conformance table covers config resolution only. Envelope, fact-builder and tool-list parity here keeps using `packages/hooklog/tests/fixtures`.
- **Shared files and ordering.** Both plans edit `plugins/yakka/client/yakka.py` and `packages/yakka/internal/mcp` (plan 21: MCP `instructions`, the `artifact_feedback` description and state wording, `.codex-mcp.json`, and, for reconciliation at Stop and feedback, the drain and the fact builder; this plan: the queue parser and builder for a new event and fact type, and new tools in the same registry and dispatch). Plan 21 also edits the Stop and SessionEnd hooks, and Phase 2 here edits `spool.sh` (session-start only) and `codex.json` (`--event SessionStart`). The edits are additive; whichever plan merges second rebases. No phase here waits on plan 21; where both touch a file the second to merge rebases, and the `record_action` sentence in the MCP `instructions` follows the style of plan 21's feedback sentence.
- **Codex.** MCP loading is not gated on plan 21 (it already loads). What plan 21 settles, and Phase 4 depends on, is its open question 1: whether Codex gives the MCP server the session's project directory. If it does not, a cwd-keyed session binding cannot work on Codex and Phase 4's Codex row falls back to a required `session_id` (Assumption 13). Env-based tagging (Phase 2) uses no MCP and is not affected.
- **Backlog.** Plan 21's upload sends the backlog's hook events through the same drain. These are old Codex events with no action envelope, so they carry no tags; Phase 5's back-fill of Codex sessions from 23 to 31 Oct should run after that upload so those sessions have cost facts to attach to. Out of order it is harmless: `session_actions` joins by `conversation_id` and counts once the facts arrive. Phase 5 must not read or move `~/.local/share/workflow/queue`.

## Decisions

Decided by Cody and carried in: (1) correlation events are submitted through the existing client queue and drain, tagging only enqueues, the server processes asynchronously, no synchronous action call; (2) the three-pass back-fill described above. Every other scope decision is in the ledger.

## Assumption Ledger

### Assumption 1

- Question: Are the draft env var names right?
- Answer chosen: Change them. All six share the prefix `YAKKA_ACTION_`: `KIND`, `SUBJECT_TYPE`, `SUBJECT_ID`, `PHASE`, `REPO`, `PR`.
- Rationale: The draft mixed `YAKKA_ACTION_KIND` with `YAKKA_SUBJECT_*`, `YAKKA_PHASE`, `YAKKA_REPO`, `YAKKA_PR`. A single prefix lets `spool.sh` and the plugin detect "any tag set" with one glob, makes accidental collision with other `YAKKA_*` names impossible (`YAKKA_REPO` and `YAKKA_PR` are generic enough to be taken later), and makes the separation from `YAKKA_ENDPOINT`/`YAKKA_KEY` visible by name. Formats and required/optional status are as drafted.
- If wrong: a rename in `harness pick` and one constant in each client. Nothing is released before Phase 2, so the cost is low if corrected before then.

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
- Answer chosen: No. `POST /v1/ingest` accepts a new fact type, `session_action`. Several actions per session are several facts. The only new route is `GET /v1/actions`.
- Rationale: Cody's decided input. It also gives idempotency (canonical-fact hashing), offline operation and backoff for free.
- If wrong: If an explicit `POST /v1/actions` is wanted later (for a non-queue caller), it is a thin route that wraps the same ingest path; nothing else changes.

### Assumption 6

- Question: Where is a malformed value rejected, and what does "rejected" mean?
- Answer chosen: Ingest accepts the fact; the async projection validates and stores `status=rejected` with all reason codes. Nothing at ingest, hook or tool level turns a bad value into an error for the session. The projection runs when scoring is off and when the scorer is unreachable, on its own cadence, with per-fact failure isolation.
- Rationale: The issue says "recorded as rejected with a reason" and "never block". A 4xx at ingest would push the queue file to `rejected/`, where it is invisible to the cost review. The existing worker always starts but its screen step backs off for up to five minutes while the scorer is unreachable; a projection placed behind it would be delayed with it.
- If wrong: The one remaining ingest-time refusal is the existing secret-scan precheck. A value that merely looks like a credential lands that one file in `rejected/` with its reason, visible in `yakka status`; the session is unaffected and the action is missing, not wrong.

### Assumption 7

- Question: When and how does the client read the env, given hooks must exit 0 quickly and run no Python?
- Answer chosen: `spool.sh` reads the six vars on session-start events only (Claude `SessionStart`, Cursor `sessionStart`, Codex via a new `--event SessionStart` in `codex.json`; OpenCode's plugin reads `process.env` on `session.created`) and adds the raw strings to that event's queue file without parsing, cutting before escaping so a huge value costs nothing. A value never reaches the server truncated and valid (Action contract, Length).
- Rationale: Preserves the "no Python, no network, always exit 0" invariant. Reading at the first event only keeps every other event unchanged. Passing raw strings keeps validation in one place, so a new kind needs no client release for capture.
- If wrong: If a harness's session-start event fires late or not at all, the tag is lost for that session and it counts as untagged; the Phase 2 probe exists to find that.

### Assumption 8

- Question: Do the harnesses actually pass the launching process's environment to their session-start hook, and does the hook fire at all in headless mode?
- Answer chosen: Assume yes for Claude Code and OpenCode (in-process plugin); treat Codex and Cursor as unverified. Phase 2 starts by probing all four headlessly, separating two failures: the env is not forwarded, or the hook does not fire (Codex hooks need a trust review in `/hooks` that a headless `codex exec` may skip). If a harness fails, Phase 2 records which failure and does not close for that harness until Cody chooses between a contingency channel (a launcher-written file with the same six keys, added to this contract by amendment before CHM builds it) and a documented limit. Phase 2's approach is flagged open for that reason.
- Rationale: Recon found no repo doc, test or fixture showing any harness forwarding the user's environment to hooks (the tests inject it by hand). This is the single largest risk to the issue's done-when, and a file channel cannot help where the hook never fires.
- If wrong: Phase 2 grows by one channel per failing harness, and CHM must also write the file. The env table is unaffected for harnesses that pass.

### Assumption 9

- Question: How is cost divided when a session logs several actions?
- Answer chosen: By time. A live action owns the span from its start to the next action's; the first owns everything earlier. Repeats of the action already in force add no segment. The split is called exact only after Phase 3 confirms, per harness, that cost-bearing facts carry message time; where a harness stamps import time, its sessions are attributed whole to the action in force at their last fact, and the report says so.
- Rationale: Facts carry timestamps, so the split needs no estimates; it matches "triage and then a fix"; a session tagged at launch behaves as one segment. Equal splits or "last tag wins" both misstate cost.
- If wrong: A session whose first tag is applied late (`fix` recorded at minute 40 after untagged triage) overstates `fix`; the remedy is to tag triage first, or `review`. A resumed session billed entirely to the resume's tag is corrected the same way.

### Assumption 10

- Question: What wins when sources disagree?
- Answer chosen: `review` beats everything; live actions (`env`, `mcp`) beat back-fill; rejected actions are ignored; back-fill and review label the whole conversation and never split it. Back-fill rows count in cost and are always visible through `action_source`, so the reader can see how much cost rests on unreviewed labels.
- Rationale: Live tags come from the launcher or the agent that knows; review is a human correction; letting back-fill rescue a rejected tag avoids losing the session.
- If wrong: Change the precedence rule in the projection and re-project; stored facts are unchanged.

### Assumption 11

- Question: New cost endpoint, or extend `/v1/analytics/query`?
- Answer chosen: Extend it with `action_*` dimensions and filters, and add the MCP tool `work_cost` over it. The untagged and rejected buckets are always returned.
- Rationale: The endpoint already prices cost, scopes tenants, and validates dimensions; `facts.plan` already exists as an unrelated file-derived dimension, so the new names carry the `action_` prefix to avoid a clash.
- If wrong: A thin dedicated route over the same store function; the MCP tool is unaffected.

### Assumption 12

- Question: Which MCP tools?
- Answer chosen: Two: `record_action` (write, enqueue-only) and `work_cost` (read). No `list_actions`.
- Rationale: The issue lists tagging and cost query; reads of actions are an API concern. Adding a tool means edits in both clients and a test pinning the tool list, so each one earns its place.
- If wrong: Add `list_actions` over `GET /v1/actions`; additive.

### Assumption 13

- Question: How does an MCP call learn its session id? (The MCP server is a child of the harness and gets no session id; `artifact_feedback` binds by file path and repo, not session.)
- Answer chosen: Unsettled; Phase 4 is flagged open. Candidates: a pointer written by the session-start hook and keyed by the harness process or cwd; the id injected into the agent's context at session start; a harness-provided env var if one exists. The outcome is fixed: correct session or `ambiguous_session`, never a guess.
- Rationale: No evidence in the repo favours one, the options differ in per-harness behaviour, and a wrong guess silently mis-tags cost, which is the failure the feature exists to remove.
- If wrong: If no candidate meets the outcome on some harness, that harness ships `record_action` with required `session_id`, and the tool says so. Codex is the likely case: plan 21 found `.codex-mcp.json` runs the server with `"cwd": "."` (the plugin root) and does not yet know whether Codex exposes the project directory, so a cwd-keyed binding is unproven there.

### Assumption 14

- Question: Does `record_action` validate client-side?
- Answer chosen: Yes, strictly, using the parity copy of the contract; invalid input returns a tool error and enqueues nothing. The env path never validates client-side.
- Rationale: An agent can act on an error; a launcher cannot. The risk is a stale client rejecting a newly added kind, handled by the plugin version bump that ships any contract change.
- If wrong: Make the client validate structure only and leave vocab to the server; agents then lose immediate feedback.

### Assumption 15

- Question: Implement in both clients?
- Answer chosen: Yes, both, held together by shared fixtures.
- Rationale: `.mcp.json` launches the Python client, while the Go binary serves `drain` and its own MCP shim; either may be the one a user runs.
- If wrong: If one client is being retired (plan 16 suggests Python is the local client), drop it from later phases and save roughly a fifth of the client work.

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
- Answer chosen: No. Adding a value is a contract change in the server contract file, parity copies and a plugin version bump.
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
- Answer chosen: Keep seven. Phases 1–4 are the live path the issue's done-when needs; Phases 5–7 are Cody's back-fill. They depend on Phase 1 only (and Phase 3 to show the effect), so the tail is a clean split point if sign-off finds the count too large.
- Rationale: The back-fill is decided input and its passes each have a distinct provable outcome.
- If wrong: Cut after Phase 4 and give the back-fill its own design.

### Assumption 24

- Question: What is the queue form of an action that does not come from a session-start hook?
- Answer chosen: Its own queue file with event `yakka.session_action` and an empty payload, for which both builders emit only the `session_action` fact. Existing views exclude `session_action` facts from conversation, hook-event and facet counts.
- Rationale: The builders emit a hook event for every queue file, so a hook-shaped file carrying only an action would create phantom hook events and, for ~6,500 back-filled sessions with no other facts, phantom conversations.
- If wrong: Store actions outside `facts` entirely; the projection and read API are unchanged.

### Assumption 25

- Question: In what order do server and plugin ship?
- Answer chosen: The Phase 1 server is deployed before any plugin release that emits `session_action`. Phase 2's verification runs against a server built from Phase 1.
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
- Rationale: Every extra dimension needs golden tests in the usage path and parity in two clients.
- If wrong: Add `action_repo` or `action_status` as dimensions; both are additive.

### Assumption 28

- Question: What happens when a tagged session is resumed or relaunched?
- Answer chosen: Nothing special: a resumed session fires session-start again and its tag is recorded like any other; an equal tag collapses, a different one starts a new segment and, if it is the first live action, takes the earlier untagged or back-filled time (Assumption 9).
- Rationale: The projection is a pure function of all of a conversation's actions, so retries, resumes and out-of-order arrival give one answer.
- If wrong: If resumes are common under a different launcher tag, add a `since` argument or a launcher rule that unsets the vars on resume.

## Open Questions

- **Env inheritance (blocks Phase 2 closing):** do the Codex (`codex exec`, with its hook trust review) and Cursor (`cursor-agent -p`) session-start hooks run headlessly and see the launching environment? Phase 2's first step answers it; if not, Cody chooses a contingency channel (with CHM work to feed it) or a documented limit per harness.
- **Plan id (blocks CHM's launcher mapping, not the server):** what does `harness pick` hold for a plan, an entry name or a number? If numbers, plan 13's twin shows one repo can collide, and a resolver is needed.
- **Subagent cost (settled in Phase 3):** does subagent usage carry the parent `conversation_id`?
- **Cursor per-session cost (settled in Phase 3):** does the server hold per-session tokens for Cursor, or are those calls unpriced? This bounds what "cost by plan" can say for Cursor sessions.
- **Back-fill value (settled in Phase 5's dry run):** how many of the ~6,500 older local sessions have facts on the server? Sessions without facts get an action but no cost.
- **Accuracy bars and sample size** (Assumption 17) and **prompt egress to TypeSafe** (Assumption 19) are Cody's to confirm or move.
- **Which client to keep:** if the Go or Python client is being retired, later phases drop it (Assumption 15); not known to this design.
- **Phase count:** is seven acceptable, or should the back-fill (5–7) become its own design?
- **Plan 21:** the interaction section is written against its uncommitted worktree design of 2 Nov 2026; re-check it against the committed version. Its open question 1 (project directory exposed to the Codex MCP server) decides Phase 4's Codex binding.

## Phases

Order and count fixed at sign-off. Phases 1–4 build the live path; 5–7 the back-fill. Dependencies are exact: a phase may be built once the phases it lists have closed.

### Phase 1 — Action record path

- Outcome: Against a local `yakka serve`, run with scoring enabled, with scoring disabled, and with the scorer configured but unreachable:
  1. `POST /v1/ingest` of a valid `session_action` fact (input `" Build "`, `"CodyHamilton/Yakka:plan/22-X"`) returns `accepted`. Within the projection cadence, `GET /v1/actions?conversation_id=C` returns one row with `status=accepted`, `kind=build`, a fully lowercased subject id, and `pending=0`.
  2. A fact with `kind=bogus` and `phase=two` also returns `accepted`; its row has `status=rejected` with reasons `unknown_kind` and `bad_phase`. A 300-byte `subject_id` is rejected `too_long`; a `plan` type with `owner/repo#5` is rejected `subject_type_mismatch`; `owner/repo` alone is `bad_subject_id`. No value error produces a 4xx. A fact whose value trips the secret scan is refused as every fact is, and nothing else about the session changes.
  3. Re-posting either fact returns `duplicate`.
  4. Segments are the same whatever the arrival order: two accepted live actions at t1<t2 give a first valid from the beginning to t2 and a second from t2; posting them in reverse order, or posting a third equal to the second, or two with identical `ts`, gives the same segments (ties by fact hash).
  5. A conversation with a rejected `env` action and an accepted `backfill` action takes the back-fill's; with an accepted `env` action as well, the `env` action wins; a `review` action overrides everything, and a second `review` later replaces the first.
  6. A projection forced to fail on one fact is retried a bounded number of times and shown as failed in `GET /v1/admin/status`, while other facts and screening continue.
  7. With `session_action` facts seeded, the existing conversation counts, `hook_events` counts and facets return exactly the values they return without them (golden test).
  8. `GET /v1/admin/status` reports tagged and untagged conversation counts and rejected counts by reason.
  `go test ./...` passes and covers all eight.
- Surfaces: `packages/yakka/internal/ingest/ingest.go` (`validate`, type list), `internal/ingest/policy.go` (confirm the type is not dropped), a new `internal/actions` package holding the contract file, validation and projection, `internal/store/store.go` (migration, `session_actions`, projection state), `internal/store` conversation, `hook_events` and facet queries (exclude the new type), `internal/serve/serve.go` (worker projection step independent of the screen backoff, `/v1/actions` route), `internal/serve/admin.go` and `packages/yakka-analytics/src/lib/api.ts` (status block), `docs/design/01`, `03`.
- Approach: known
- Depends on: nothing

### Phase 2 — Session-start capture on all four harnesses  *(earliest phase the harness side can verify against)*

- Outcome: First, a probe table records for each of Claude Code, Codex, OpenCode and Cursor, launched headlessly, whether its session-start hook or plugin runs and whether it sees an exported variable, with the command used. Then, against a server built from Phase 1, for each harness launched headlessly (`claude -p`, `codex exec`, `opencode run`, `cursor-agent -p`):
  1. With all six `YAKKA_ACTION_*` set to a valid build action, after drain `GET /v1/actions?conversation_id=<the session>` returns that exact action with `source=env`, `status=accepted`, and the session's other facts are present.
  2. With none set, the session's facts are present and no action row exists.
  3. With `KIND=buidl` and `PHASE=x`, the harness process exits as it would without the vars, the session's facts are present, and the row is `rejected` with both reasons.
  4. A fixture run of `spool.sh` with 10 KB values containing quotes, backslashes, newlines and multi-byte characters straddling the cut exits 0 and writes an envelope that both the Go and Python parsers accept, with an over-length value arriving as `too_long`, never as a truncated accepted one; a non-string `action` member does not make either parser reject the file.
  5. The Go and Python builders produce identical facts for the shared fixtures, a tag-only queue file (event `yakka.session_action`) yields exactly one `session_action` fact and no `hook_event`, and resolving client config with only `YAKKA_ACTION_*` set is unchanged.
  A harness that fails 1–3 is recorded with the cause (env not forwarded, or hook not fired). The phase closes when each harness passes 1–3, or Cody has recorded that harness as a documented limit or approved a contingency channel by amendment to this design (Assumption 8). The phase carries the release precondition of Assumption 25.
- Surfaces: `plugins/yakka/script/spool.sh`, `plugins/yakka/hooks/codex.json` (`--event SessionStart`), `hooks.json`, `cursor.json` (verify only), `packages/opencode-yakka-hooks/src/index.ts`, the queue-file parser and fact builder in `plugins/yakka/client/yakka.py` and `packages/yakka/internal/facts`, `packages/hooklog/tests/fixtures`, `docs/design/02`, `05`, `CHANGELOG.md`, plugin version bump.
- Approach: open for any harness that fails the probe (what carries the tag then); known otherwise
- Depends on: Phase 1

### Phase 3 — Cost by work

- Outcome: On a seeded tenant holding one plan across phases 1–3 with kinds build, review and fix, one session with two actions switching at a known timestamp, one untagged session, one session whose only action was rejected, and one session of an unpriced harness:
  1. `/v1/analytics/query` with `dims=[action_plan, action_phase, action_kind]` returns buckets whose `cost_usd` sums, to the cent, to that plan's total computed independently from per-conversation costs; the mid-session session splits at its boundary by call timestamp.
  2. `(untagged)` and `(rejected)` are present, survive top-N folding, and reconcile with the plan's buckets to the unfiltered total; the unpriced harness shows `unpriced_calls`, not $0; `sessions` counts distinct conversations per bucket.
  3. The MCP tool `work_cost`, in both clients, returns the same rows for the same filters; an `action_*` filter on a measure that lacks it is an error.
  4. Queries without `action_*` fields return byte-identical results to before (golden test).
  5. `work_cost` is shown to reach the remote only through the client's single resolved-config request path; where plan 21's Phase 1 has merged, a recording listener on 127.0.0.1:8770 sees no connection when a remote is configured and unreachable, otherwise that assertion is recorded as a named follow-up (Interaction with Plan 21).
  6. On real data: a Phase 2 session's cost appears under its plan and kind; for each harness the report states whether cost-bearing facts carry message time or import time (and the split is called exact only where they carry message time); and the subagent and Cursor questions in Open Questions are answered with counts.
  7. Gated on CHM's change: one real `harness pick` build launch on each harness appears in `GET /v1/actions` as `source=env, accepted`, and an `action_plan` query returns its cost. Until CHM has landed, this item is recorded as gated, and the plan is not reported done against the issue's done-when.
- Surfaces: `packages/yakka/internal/store/usage.go` (the usage aggregation and its dimension and filter handling, which the cost measures use), `internal/serve/analytics_query.go` (dimension limit, measure validation, top-N folding), `internal/mcp/mcp.go`, `plugins/yakka/client/yakka.py` (`_MCP_TOOL_LIST`, dispatch, `test_mcp.py` tool-list pin), `docs/design/03`, `04`.
- Approach: known
- Depends on: Phase 1 and Phase 2

### Phase 4 — Manual tagging from an interactive session

- Outcome: In a live interactive session on each harness that loads the Yakka MCP:
  1. Calling `record_action` for `triage`, then for `fix`, with no `session_id`, then draining, gives `GET /v1/actions` both actions on that session in order with `source=mcp`, and `work_cost` splits the session's cost at the second call.
  2. With two concurrent sessions of one harness in the same cwd, each call lands on its own session or returns `ambiguous_session` and enqueues nothing.
  3. Invalid input returns a tool error naming the reason codes and enqueues nothing; a valid call with the network down returns `queued` and drains later.
  The phase closes when Claude Code passes 1–3 and every other row is either passed or recorded as a documented limit with the observed reason: Codex depends on plan 21's answer to whether Codex gives the MCP server the session's project directory (if not, the Codex row passes with a required `session_id` and says so), and Cursor on the user-level MCP config.
- Surfaces: `plugins/yakka/client/yakka.py` and `packages/yakka/internal/mcp` (the `record_action` tool, the shared enqueue writer), the session-binding mechanism (chosen in this phase; it may add a record written by the session-start path, so it extends Phase 2's hook edits), `test_mcp.py`, `docs/design/04`.
- Approach: open. The yardstick is the three checks above. Candidates are in Assumption 13.
- Depends on: Phases 1, 2 and 3

### Phase 5 — Back-fill pass 1: deterministic extraction

- Outcome: A dry run over the four local stores on codyh-ubuntu prints, per store, how many sessions are labelled (complete), partial (subject without kind), unresolved and excluded (the 890 Flash analysis runs are excluded). A real run enqueues `source=backfill, method=deterministic` facts for complete labels only, and writes a local label file for the rest. With the log-derived label masked, subject type, subject id and phase agree with the queue-log file-name truth on at least 95% of the gold sessions it labels, coverage is reported, and `evidence` is secret-scrubbed before it is written. Every in-scope session appears in the output as complete, partial with evidence, or unresolved. A second run enqueues nothing new. After drain, the count of `GET /v1/actions?source=backfill` rows equals the run's emitted count less the files the ingest secret scan refused, which the report itemises; and the dry run states how many labelled sessions have facts on the server.
- Surfaces: a new back-fill tool beside `tools/transcript/` (parsers for each store's transcripts, queue-log reader, label file), the shared enqueue writer, `docs/design/02`.
- Approach: known
- Depends on: Phase 1

### Phase 6 — Back-fill pass 2: TypeSafe kind classification

- Outcome: A new TypeSafe schema (the ten kinds or `unclear`, with confidence) is run over every partial session from Pass 1 and every session with a subject but no kind. A report on the gold set gives overall and per-kind accuracy and a confusion matrix, and fixes the threshold as the lowest confidence at which gold-set accuracy above it is at least 90%. Results at or above the threshold complete the label and are enqueued as `method=typesafe` facts; results below it, and `unclear`, are written to the review file with the prompt prefix and the model's answer, and enqueue nothing. Prompts are shown by test to pass the secret scrub and truncation before any call. After drain, `GET /v1/actions?source=backfill&max_confidence=<T>` returns the rows whose confidence is below the threshold, matching the report's count, and `work_cost` with `group_by=[kind, source]` shows how much cost rests on each source.
- Surfaces: the back-fill tool, the TypeSafe schema and a client in the style of `tools/transcript/lib/jev_client.py`, the secret scrub, `docs/design/04`.
- Approach: known
- Depends on: Phases 3 and 5

### Phase 7 — Back-fill pass 3: human review

- Outcome: `review export` writes every incomplete or below-threshold session plus a random check sample of the rest (the larger of 5% of high-confidence rows and 50) as JSONL; after a human edits verdicts, `review import` enqueues `source=review, method=human` facts and prints the sample's agreement rate. After drain, each reviewed conversation's projection shows the reviewed action, and a `work_cost` query before and after differs by exactly the cost of the reviewed conversations moving between buckets. Re-importing the same file changes nothing, and a second import with a different verdict replaces the first. The admin status block shows counts by source and sessions awaiting review.
- Surfaces: the back-fill tool (`review` subcommands), the shared enqueue writer, `packages/yakka/internal/serve/admin.go` and `src/lib/api.ts` (status block extension), `docs/design/03`.
- Approach: known
- Depends on: Phases 3 and 6

## Provenance Notes

- **Harness-side start.** CHM can write and merge its `harness pick` change at any time: the table is fixed and exporting unread variables is inert. Phase 2 is the earliest phase against which it can be verified (an exported action showing up in `GET /v1/actions` on each harness), conditional on the probe: a harness whose hook does not fire or does not see the environment changes what CHM must do for it. Phase 3 item 7 is the end-to-end check with CHM's real launches, and is recorded as gated until CHM lands.
- **Rough build size.** About 3,800 lines including tests, roughly 60% of it tests and fixtures: Phase 1 ~800 (Go), Phase 2 ~450 (bash, Go, Python, TypeScript, fixtures, probe), Phase 3 ~700 (Go usage-path join, two MCP clients), Phase 4 ~400 plus exploration, Phase 5 ~700 (Python), Phase 6 ~500, Phase 7 ~400. Seven phases, each its own PR. The back-fill tail (5–7) is about 40% of the total.
- **Rejected: one env var carrying a JSON blob.** It needs quoting by every launcher shell and fails as a whole on one bad character; separate variables fail field by field and show which field.
- **Rejected: a `YAKKA_ACTION_RUN` correlation var** (the queue run name). It would link sessions to queue logs and help the gold set, but the back-fill already reads the logs by name, and a seventh variable is surface without an outcome.
- **Rejected: a synchronous record endpoint.** Cody decided against it, and it would bring its own offline, retry and fallback behaviour, the very surface plan 21 is tightening.
- **Rejected: splitting cost evenly across a session's actions, or letting the last tag win.** Both misstate cost whenever a session changes work; the timestamps are already on every fact.
- **Rejected: reading the env in the drain.** The drain is a detached background process started by a hook or MCP call; its environment is not the harness's.
- **Recon limits.** The server and client facts here come from reading code, not from running it. Not verified: whether any harness passes its environment to hooks, whether OpenCode plugins run in the opencode process (the plugin reads `process.env` as if they do), whether Codex loads the plugin MCP live, Cursor's hook cwd, the worker wiring that installs the screen step, and whether subagent usage carries the parent id. Each is either a Phase 2/3/4 probe or a ledgered assumption.
