# Design Intent 8: Server MCP Contract

The wire contract between the `yakka mcp` stdio shim and the server's MCP endpoint: the endpoint and
tool registry, the declaration that tells the shim which local context a call needs, the shim's
fixed reader table, and the one declared local action. [Design 2](02-edge-capture.md#mcp-shim)
describes the shim's plumbing and [design 4](04-advisory-surface.md) the tools' answers. This
document is the contract both cite. The record of the plan that built it is
[Plan 24](../plans/24-server-mcp-shim.md).

## Rule

The shim may inject auth and the local context a server declares for a call, and nothing else. Tool
names, descriptions, schemas, `instructions`, argument validation, state logic and result wording
live on the server. The shim holds none of them. The v1 contract has no local effect. The v2
extension adds one declared, call-bound action, `enqueue_file_snapshot`, described below as a
separately versioned extension.

Why: a tool change is a server change, so harnesses cannot drift from each other, and a new tool is
a declaration plus a handler rather than a plugin release.

## Server endpoint and registry

### Transport

`POST /v1/mcp` takes one JSON-RPC 2.0 message per request body, with `Content-Type: application/json`.
A request with an `id` gets `200` and one compact single-line JSON reply. There is no SSE, no session
id, no server-initiated message and no batch. A message without an `id` (a notification) gets `202`
and no body. A body that is not valid UTF-8 JSON gets `-32700` with `id: null`. A JSON array or
non-object, or an object with no `method`, gets `-32600`. An unknown method with an `id` gets
`-32601`. An unknown notification is accepted silently. `GET` and other methods get `405` with
`Allow: POST`.

### Methods

- `initialize` echoes the client's `protocolVersion` when it is one of `2025-11-25`, `2025-06-18`,
  `2025-03-26` or `2024-11-05`, and otherwise answers `2025-11-25`. Its `capabilities` are
  `{"tools":{"listChanged":false}}` and its `serverInfo` is `{"name":"yakka","version":<server build>}`.
  Its `instructions` is a base sentence plus the instruction sentence of each registered tool the
  caller's scope can call, in registry order, so a `read` key is never told about a tool it cannot see.
- `ping` returns `{}`.
- `tools/list` and `tools/call` are described below.

The server is stateless. No method depends on an earlier request, so a shim that restarts or retries
needs no handshake replay.

### Authentication and tenancy

The route uses the same bearer resolution as the REST routes and has no cookie branch: a cookie-only
request is `401`. A `?tenant=` that differs from the credential's tenant is `401`, as for REST, in
keyed and remote modes. In loopback local mode the principal is the local tenant with every scope.
Any request carrying an `Origin` header is refused with `403`. Callers are programs, and the refusal
closes browser cross-origin posts to the keyless loopback server.

Tenant and scope come from the credential alone. Nothing in a request body, including `_local`,
selects or changes either. A missing or bad credential is `401` with the REST error body. A valid key
that lacks a tool's scope gets a `200` JSON-RPC error `-32003` with data
`{"code":"insufficient_scope","need":"read_write"}`, which the shim relays unchanged.

Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.
There is no reset/delete MCP tool. The [pending owner lifecycle API](03-remote-service.md#pending-owner-tenant-lifecycle-api-plan-23-phase-2)
is cookie-session/profile-UI-only, with same-origin and dedicated UI-header guards; keys never
qualify, even beside an owner cookie. Agents must not try REST, browser automation or header
spoofing to bypass that boundary. The guards are spoofable, not proof of a human; a future
human-verification/captcha step is out of scope for this amendment.

### Scope

Each tool declares `read` (the default) or `read_write`. The registry enforces it before the handler
runs, and `tools/list` lists only the tools the caller's scope satisfies. A `read_write` tool sets
`readOnlyHint` to false. `artifact_feedback`, `list_checks`, `search_artifacts` and `list_reviews`
are `read`; `review_change` is `read_write` because it spends on a provider call and stores a review
record.

### Tool definition (the registration seam)

A registration has `name`, `description`, `inputSchema`, `annotations` (MCP standard hints), `scope`,
`timeout_s`, `instruction` (one sentence appended to `instructions`, or empty), `context` (the reader
list below), `validate(arguments)` (argument checks that need no local context) and
`handler(ctx, tenantState, arguments, local)`.

The registry runs, in order: authentication, scope, the `_rev` check, `validate`, the required-reader
gate, and then the handler. An argument error is therefore never masked by a reader failure.

At server start the registry rejects a duplicate name, a reader name absent from the shared
conformance file `packages/yakka/internal/serve/testdata/mcp-readers.json`, a reader declared before
one it depends on, a non-empty `local_actions` in a v1 declaration, a `timeout_s` above the ceiling,
and a bulk budget total above the body ceiling. The `inputSchema` is documentation for the agent. The
handler validates, extra arguments are ignored, and non-object `arguments` is a tool error
`arguments must be an object`.

### Declaration

Each `tools/list` entry carries `_meta["yakka/tool"]`, which is additive to the MCP `Tool` fields:

```json
{"v":1,"rev":"<16 hex>","scope":"read","timeout_s":20,
 "context":[{"reader":"git","v":1,"required":true,"params":{"of":"resolved_path"}}]}
```

- `v` is the declaration format version.
- `rev` is the first 16 hex characters of the SHA-256 of the canonical JSON of the rest of the object,
  so any declaration change changes it.
- `context` is ordered. Each entry names a reader from the shim's fixed table, its version, whether
  the handler needs it (`required`, default true), and constant `params` the reader's table allows:
  booleans, integers, enum strings from the reader's list, or arrays of those. Never a command, a path
  to run, or a URL.
- A tool with no `context` gets auth only.

Version negotiation: the shim sends `Yakka-Context: <highest v it reads>` (absent means 1). The server
never serves a declaration newer than that, and a tool that exists only at a newer `v` is left out of
`tools/list` for that caller. An old plugin therefore keeps every tool it can run.

### Carrier

The shim writes injected values to `params.arguments._local`:

```json
{"_v":1,"_rev":"<rev the shim used>","git":{...},"file":{...},"cwd":{...}}
```

Each declared reader's key holds its value object or `{"_failed":{"code":"<code>"}}`. The registry
strips `_local` before the handler sees `arguments`, and gives the handler an accessor,
`Local.Get(name)`, that returns a value or a typed failure. After `validate` passes, a `required`
reader that is failed, absent, or not a declared name is the tool error
`local context unavailable: <reader> (<code>)`, raised before the handler runs. A handler therefore
cannot read a missing fact as an empty one. Value-level facts are never failures: an empty path, a
missing file or a directory that is not a repository returns a value that says so. A handler that
marks a reader `required:false` must handle its failure explicitly.

If `_rev` is present and differs from the tool's current `rev`, the call fails before the handler with
`-32010` (data `{"code":"stale_declaration"}`) and has no effect. A direct caller that omits `_rev`
skips the check.

Why `_local` is in `arguments`: the agent controls `arguments`, so spoofing happens there and the
overwrite belongs there. A side channel such as `params._meta` would be harder for the model to reach,
but the server trusts neither place.

### Trust

The [Plan 23 follow-up amendment](../plans/23-llm-review-shadow/DESIGN.md) added full cached
duplicate replies, effort/tags/store call controls and tenant-bound cursor paging through a
`list_reviews` tool. They are implemented and preserve server-owned definitions and
credential-derived tenancy; the amendment's bounded tenant reset remains pending (Phase 2).

`_local` and `arguments` are claims by the caller. A handler may use them to word an answer, to select
a row inside the caller's own tenant (for example `(repo_id, rel_path)`), or to compare hashes. It must
not use them to choose a tenant, open a path, run a command, build a URL or SQL text, or decide
authorization. The server never touches a filesystem path that arrives in `_local`.

A direct authenticated call with the same `_local` uses the same handler as the call through the shim
and cannot reach another tenant's data. Repeating a `store=true` review capture returns the earlier
completed review in the full fresh response shape, with `cached=true`, `original_review_id`,
`original_status` and the original findings even at receipt detail. A still-running or unknown
original returns `in_progress` or `outcome_unknown` with `cached=false` and no second provider call,
and a missing or corrupt original returns `cache_unavailable`. `store=false` calls are independent
paid work and are never deduplicated, so `review_change` no longer promises unconditional
idempotency. Captured content is never returned. Absolute paths in `_local` (`cwd`, `project_dir`,
`resolved_path`) are transient: the registry and handlers neither log nor store them. Server request
logs hold method, tool name, tenant id, status and duration, and never arguments, `_local` or tokens.

### Budgets

- Default body cap 256 KiB; ceiling 8 MiB (`YAKKA_MCP_MAX_BODY`). Authentication precedes any body read.
  The route reads at most the ceiling, parses the message, and compares its length with the cap of the
  tool it names (the default for any other method). Over the cap is `413` and nothing executes.
- A tool's cap is `max(default, 64 KiB + the sum of its bulk readers' budget_bytes)`, derived at
  registration from the declaration, so the cap and the declaration cannot disagree.
- Default wall time 20 s; ceiling 300 s (`YAKKA_MCP_MAX_CALL`), declared as `timeout_s`. At `timeout_s`
  the server cancels the handler's context and answers `timeout after <n> s`.
- A client disconnect cancels the handler's context. A handler with a non-idempotent effect states in
  its description whether an abandoned call may have run.
- The route sets no write timeout, so a long call is not cut by the server. `ReadHeaderTimeout` stays
  at 10 s.

Non-goals: server-initiated messages, SSE, resources, prompts, sampling, OAuth for MCP clients, batch,
per-tool rate limits, and registering tool handlers from outside the Go binary.

### The shipped tools

- `list_checks` and `search_artifacts` declare no context. Their names, descriptions, schemas,
  annotations and result text are the server's own. They read the functions behind `/v1/checks` and
  `/v1/search` in process.
- `list_reviews` is `read`, `readOnlyHint` true, declares no context and has no local readers or
  actions. It validates a closed schema of the existing review filters (`repo_id`, `plan`, `phase`,
  `kind`, `status`, `effort`, `profile`, `manifest_hash`, `since`), repeated `tags` (at most 16 exact
  strings, conjunctive/ALL), `detail=full`, `limit` (default 100, range 1–500) and `cursor`, and
  returns the same `{reviews, next_cursor, complete}` data object as `GET /v1/reviews`. Cursors are
  bound to the authenticated tenant, route, filters, detail and fixed high-water mark; malformed,
  mismatched or foreign-tenant cursors are tool errors. The shim learns the tool through the
  registry; no tool-name or schema logic is added to the client.
- `artifact_feedback` is `read`, `readOnlyHint` true, and makes no service write, ingest or worker
  wake. It declares `cwd` (optional, used only to word an error), `resolved_path` with
  `path_arg:"path"` and `bases:["cwd"]`, `file` of `resolved_path`, `git` of `resolved_path`,
  `queue` of `git` and `resolved_path`, and `drain`. The last five are required. The server decides
  the path kind, the state, the order of checks and the wording. [Design 4](04-advisory-surface.md#artifact_feedback)
  holds the states. `bases:["cwd"]` is today's behaviour; whether a harness exposes `project_dir` is
  open question 4.
- `review_change` is server-owned, `read_write`, `readOnlyHint:false`, with `timeout_s:150` and has no local actions.
  Registration requires review model configuration and a server call ceiling of at
  least 150 seconds. Required arguments are `mode` (`uncommitted` or `range`) and `build_models`;
  a range uses `base` and `head`. Optional `kind`, `plan`, `phase`, `pr` and `brief` supply review
  identity and stored criteria references; `detail:full` includes validated findings. Optional
  `effort` (default `high`; `high`, `xhigh` or `max` only), `tags` (at most 16 exact strings) and
  `store` (default `true`; `false` skips all dedupe, cache, input and review-record writes and
  returns the full review) are validated before any spend or storage, and a valid per-call effort is
  never capped by the server's high-only default. The declaration
  orders optional `project_dir`, `cwd`, `git` of `project_dir`, then `change`. All are optional at
  the registry gate so the handler can translate a missing/unsupported capture to
  `capture_unsupported`; an actual capture is mandatory to review. No `session_hint` is declared.
  `change` is content-bearing/bulk with a 2 MiB serialized budget, typed server policy constants,
  and argument-fed capture settings. The shim overwrites agent-supplied `_local` and alone performs
  local capture. The server owns criteria resolution, prompt policy, provider credential/call,
  validation, spend and tenant-local records, sharing the `POST /v1/reviews` orchestrator. Machines
  need no provider key. Fresh receipts never return captured diff content, and a completed duplicate
  returns the original review's full fresh-shape content with `cached`, `original_review_id` and
  `original_status`; `store=false` is never deduplicated.

Stage calls are advisory: one non-gating range invocation per phase close in `execute`, and one at
the reviewed/candidate PR head in each of `comprehensive-review` and `post-build`. They use explicit
base/head SHAs, available criteria references, and `build_models` from the run record or `unknown`,
without a `trial` argument. Receipt summaries/findings stay in session output, never in gates,
verdicts, commits, trailers, exit codes or plan-folder files. Missing, unavailable or failed review
does not affect existing stage decisions. Duplicate receipts are earlier evidence, not new findings.

## Shim (`yakka mcp`)

### Forwarding

Newline-delimited JSON on stdin and stdout. For every request or notification the shim POSTs the
message to `<endpoint>/v1/mcp` and writes the reply body byte for byte, plus `\n`. It is method-agnostic:
it enumerates no methods, so `initialize`, `ping`, `tools/list`, `tools/call` and any method a harness
sends later are relayed, and the server answers `-32601` for an unknown one.

The request `id` is the harness's own and is forwarded unchanged. On `tools/call` only, the shim edits
`params.arguments._local` as above and nothing else. If `params.arguments` is present but not an object,
the call is forwarded unchanged and the server answers `arguments must be an object`. On `tools/list`
replies the shim reads, and never alters, each tool's `_meta["yakka/tool"]` into a cache keyed by tool
name. A `tools/call` that arrives before any `tools/list` result, or names a tool not in the cache,
first triggers an internal `tools/list` fetch, which is not relayed. A missing declaration means auth
only, never a guessed list.

### Per call

The shim re-resolves the login on every request, so a login or key change applies without a restart.
It performs no network I/O at startup.

### HTTP

`POST` with `Authorization: Bearer <key>` (omitted in local mode), `Content-Type` and `Accept`
`application/json`, `Yakka-Context` set to the highest declaration and carrier version it reads (2 with
the v2 action), and `User-Agent: yakka-shim/<plugin version>`. The shim uses the login's endpoint origin
and the fixed path `/v1/mcp`. Nothing in a reply names another URL, and nothing in a reply is fetched.

Redirects are refused. The shim uses the no-redirect opener, not the drain's opener, because the
drain's bearer handler forwards the key to same-host and subdomain targets without checking for an
https-to-http downgrade. A `3xx` is `redirect refused`, which names only the target host. The bearer is
sent only over `https`, or over `http` to a loopback host. Any other `http` endpoint is `bad config`.
Header values reject CR and LF. Userinfo, query and fragment are stripped from any endpoint shown.

### Own errors

These are the complete set. Each is a JSON-RPC error with the harness's `id`, code `-32000`, and a
`message` of the form `<class>: <what failed>. <fix>`, because harnesses usually show the model only the
message. Its `data` is `{"code","host"}`, plus `queued_locally` where noted.

| Class | When | Notes |
|---|---|---|
| `bad config` | login unresolved, partial env, cleartext non-loopback endpoint | |
| `unreachable` | connect, DNS, TLS or reset failure, or HTTP `5xx` with no JSON-RPC body | `queued_locally`: the count of pending `*.evt` files, and nothing else about them |
| `unauthorized` | HTTP `401` | fix: log in or check the key |
| `server unsupported` | HTTP `404` or `405` on `/v1/mcp` | fix: update the server |
| `timeout` | no reply within `timeout_s` + 5 s for a call (10 s otherwise), or HTTP `504` or `524` | the call may have completed |
| `redirect refused` | any `3xx` | names only the target host |
| `bad reply` | not a JSON-RPC response, or over 8 MiB | |

A reply that parses as a JSON-RPC response is relayed unchanged whatever its HTTP status, so server
errors (`-32003`, `-32010`, and `413` bodies in JSON-RPC shape) are never reworded. No path falls back
to another endpoint, to a local answer, or to explicit local mode. A resolved remote is used as resolved.

### Initialize failure

A failed `initialize` is the shim's error, not a synthesized result, because the shim holds no
capabilities or `instructions` to synthesize. Each later request re-resolves and retries independently.
A harness that marks the server failed after one failed `initialize` needs a restart; that is open
question 2.

### Lifecycle

Requests are handled concurrently by a bounded pool of 8, so a long call does not block `ping` or a
cancel. Each reply is written whole under one stdout lock, in completion order. A
`notifications/cancelled` for an in-flight request id aborts that request's connection, so the server
cancels the handler. It writes no reply and is not forwarded, because the server is stateless. stdin EOF
aborts in-flight requests and ends the process. Stderr carries error class tokens only: never the key,
arguments, `_local`, file paths or reply bodies.

### The shim's own ceilings

The server is not trusted with the user's machine, so the shim enforces its own limits on
server-supplied values. `timeout_s` above 300 is clamped to 300. A `budget_bytes` above 8 MiB, or any
param outside the reader's allowed set, is `bad_params`. Reader time is 5 s each and 10 s for the whole
set. The connect timeout is 5 s. Replies are capped at 8 MiB. Eight requests run concurrently.
Changing a limit changes no contract; each is one constant on one side.

## Local context readers

The shim evaluates a call's declared readers in declaration order before the HTTP request, each under
its time budget. Each failure is caught and written as that reader's `_failed`, so a local read problem
reaches the server as context and never as a tool result. The reader set is closed and lives in the
shim. A declaration selects among readers and supplies constant params. It cannot add a reader,
command, path, URL or script.

| Reader (v1) | Params (server-supplied) | Reads | Value |
|---|---|---|---|
| `cwd` | none | the shim's working directory | `{"path"}` |
| `project_dir` | none | the harness-supplied project directory, from a reader-owned ordered list of environment variables (first the one Claude Code documents for plugins) | `{"path"}` or `{"path":null}` |
| `resolved_path` | `path_arg` (the tool argument holding the path), `bases` (ordered subset of `project_dir`, `cwd`) | that argument, normalised; a relative value is resolved against the first available base, which the reader reads itself | `{"path","base"}`; `path` is null when the argument is empty or not a string, or is relative with no base |
| `file` | `of`: `resolved_path` | `stat` of that path; SHA-256 of the bytes only when the path is a regular file inside a git work tree after `realpath` | `{"exists","is_file","size","mtime","content_hash","withheld","read_error"}`; `content_hash` is null with `withheld` set to `outside_repo`, `symlink_out` or `too_large` (over 256 MiB); `read_error` is an OS error name, set only when a read inside a work tree failed |
| `git` | `of`: `resolved_path`, `project_dir` or `cwd` | the work tree top and identity of that path's directory, by the drain's `RepoID`/`RepoPath` rules | `{"repo_id","rel_path","error"}`; `error` is `no_repo`, `no_commit` or `git_unavailable`, a fact and not a failure |
| `queue` | `of`: `git`; `path`: `resolved_path` | spool and `rejected/` entries whose normalised write path equals `(repo_id, rel_path)` or the absolute `resolved_path`, by the drain's path function | `{"pending":[{"age_s","mtime"}],"rejected":[{"reason","mtime"}]}`, at most 50 of each; `reason` is the drain's `.reason` text; no payloads, no paths, no entries for other files |
| `drain` | none | a non-blocking probe of `<queue>/.drain.lock` | `{"running"}` |
| `change` | argument mappings for mode, view, untracked policy, range refs and expected repo id; typed server policy constants; `bulk`, `budget_bytes` | bounded Git diff and omission manifest from `project_dir`; no `cwd` fallback | content-bearing value with `repo_id`, linked-worktree identity, branch, `HEAD`, dirty counts, mode, diff, `diff_sha256`, manifest and completeness |

`git.top` is absent on purpose. The server needs the identity and the relative path, and an absolute
repository path adds egress with no use. The `queue` reader reports what is on disk at call time, and
nothing is remembered between calls.

Safety, for every reader including later plans':

1. A reader is code in the shim. A declaration is data that selects among readers.
2. Subprocesses are limited to fixed argument arrays with no shell (`-C <dir>`, and `--end-of-options`
   where a ref is passed), a minimal allowlisted environment, a timeout and an output cap. The
   foundation set is `git rev-parse --show-toplevel`, `git remote`, `git remote get-url` and
   `git rev-list --max-parents=0 HEAD`. A static test lists every subprocess call in the shim and fails
   on any not in the table.
3. Readers never write, never touch the network, and never pass a reader's input into another reader's
   job.
4. Paths are normalised. Content is read only after `realpath` containment in a git work tree, and only
   for regular files. A path argument chosen by the agent can therefore make the shim hash a file inside
   a repository, and nothing else.
5. A reader whose value can contain file or diff content is marked `content` in the table. It must run
   the secret scan before returning, withhold a file with a hit (naming the pattern and line, never the
   match), and carry a `budget_bytes`. The registered v1 `change` reader is content-bearing;
   `file` returns a hash and has no
   content parameter. A declaration that asks for content from a reader that does not offer it is
   `bad_params`.
6. Non-bulk readers return at most 64 KiB. A bulk reader declares `bulk` and `budget_bytes`, truncates by
   its own rule and states `complete:false` with reasons, or fails with `over_budget`. The shim clamps
   `budget_bytes` to 8 MiB whatever the declaration says.
7. Before sending, the shim checks the serialized context for the bearer key and replaces the offending
   reader's value with `secret_in_context`.
8. No environment variable, hostname, username or other value is sent unless a declared reader's table
   entry names it.
9. `change` validates mode, view, booleans, refs and policy limits. It resolves refs with
   `rev-parse --verify --end-of-options <ref>^{commit}` and reads range content from Git objects. It
   uses fixed Git argument arrays without a shell, fetch, index writes or object writes. It uses only
   `project_dir` to locate a repository, reports linked-worktree identity, and checks `HEAD` plus a
   status fingerprint before and after capture, retrying once before returning `changed_during_capture`.
10. `change` disables external diff, textconv and fsmonitor helpers. It discovers filter attributes
   before status or diff, disables each discovered clean command for those operations, and withholds
   affected worktree paths as `filter_driver`. It does not follow symlinks or return non-regular files.
   Untracked paths come from `ls-files --others --exclude-standard`; ignored paths are listed as
   `ignored` and never included. The existing secret scan checks added and removed diff lines and
   added-file content before return. A hit withholds the whole path and records only pattern and line.
11. `change` receives exclusions, per-file, total-byte and file-count caps, truncation class order and
   context lines from the server declaration. It embeds no policy values in the shim registration.
   Excluded, secret, filtered, invalid-encoding, symlink, ignored, untracked-not-included and capped
   paths have manifest entries with no captured content. Truncation drops whole files by code, tests,
   config, then docs; `docs/` is never excluded as noise. `diff_sha256` covers the exact UTF-8 diff
   bytes returned.

Failure codes form a closed set: `unsupported_reader` (not in the table), `unsupported_reader_version`
(a known reader at a higher `v`), `unsupported_declaration` (the declaration's `v` is above what the shim
reads, set on every declared name), `bad_params`, `bad_input`, `dependency_failed` (a reader whose
dependency failed), `timeout`, `io_error`, `over_budget`, `secret_in_context` and `internal`. A reader whose
`of` input carries no path returns its value with `"skipped":"no_input"`, which is a fact and not a
failure.

Seam for later plans. A reader is added by three things: a table entry in the shim with its name, version,
param schema and failure codes; a matching entry in `mcp-readers.json`; and a server declaration that names
it. An argument-fed reader names the tool arguments it reads in its params (`path_arg` is the pattern).
It validates them itself with fixed codes, and the server validates them again as tool arguments. The
conformance suite exercises the seam with a test-only, argument-fed bulk reader, so the seam is proved
without implementing any later plan's reader.

## Bounded enqueue: declaration v2

**Status.** Approved on 7 Nov 2026 for one server-declared, call-bound `enqueue_file_snapshot`, in the
approval's words: "Allow the bounded queue action". The approval is design authorization and is not
evidence of implementation, verification or deployment. The shim side is built and was exercised against
a compatible fake server. The server side is not built. The v1 registry still refuses `local_actions`,
the server advertises no action, and it emits no directive. [Plan 21](../plans/21-feedback-delivery/DESIGN.md)'s
P3 depends on the server side. Verify it at a new exact SHA before that phase relies on it.

This is a separately versioned extension of the v1 contract. It adds no general local effect. The
declaration cannot name a command, an executable, a queue directory, a payload template, a destination URL
or an alternative path. The only target is the regular file already resolved for the call. It authorizes
the queue effect only. Other tools keep their own declarations, and Plan 21 P3 decides when
`artifact_feedback` declares the action.

### Declaration and capability negotiation

The v2 declaration adds one allowed shape, alongside `context`, `scope`, `timeout_s` and `rev`:

```json
{"v":2,"local_actions":[{"action":"enqueue_file_snapshot","v":1,"path_from":"resolved_path"}]}
```

`rev` covers the whole canonical declaration, including `local_actions`. Registration rejects any other
action, action version, binding, duplicate, or a second action. The action requires the declared
`resolved_path`, `file`, `git`, `queue` (v2) and `drain` readers.

The shim advertises `Yakka-Context: 2` and `Yakka-Local-Actions: enqueue_file_snapshot/1` on each request.
The server advertises the action under `initialize.result._meta["yakka/local-actions"]` as
`{"v":1,"actions":[{"action":"enqueue_file_snapshot","v":1}]}`. This is additive to the MCP capabilities,
and the tools capability is unchanged. Both the declaration version and the explicit action capability must
match before a directive is permitted. The shim checks the server's advertisement, fetching `initialize`
internally if it must, and pins it with the declaration before acting. Capability headers are client support
claims. They are never identity or tenant authority.

An old shim, an absent action header or an unsupported version gets the v1 read-only variant, with the
explicit wording `not delivered` or `stale` plus `enqueue unsupported` where an enqueue would be needed. It
never receives a directive, is never told something was queued, and never has its failure hidden. A
declaration, action or version mismatch is `unsupported`, with no effect. No compatibility path posts content
directly or substitutes local mode.

### Queue reader v2

Queue reader v2 keeps the v1 diagnostic samples (at most 50 pending and 50 rejected entries) and adds
`coverage`: `{complete, pending_covering, rejected_covering, oldest_covering_age_s}`. Counts and the oldest age
are computed over the complete matching set for the pinned repository and path, against the current
`file.mtime`, and not over the truncated sample. The reader requires the preceding `resolved_path`, `git`
and `file` facts. It uses the same containment, matching and mtime rules as the v1 queue reader and obeys the
reader deadline and output budget. If it cannot establish complete coverage, including because a potentially
matching entry cannot be read, it returns `_failed:{code:"incomplete_queue"}`. That required-reader failure
prevents any directive or enqueue. Omission or truncation is never evidence of absence.

### One directive round and its result facts

The initial call carries the shim-generated `_local._call` (a fresh opaque token), `_v:2`, `_rev` and the
declared reader facts. Any `_local`, call token or effect fact supplied by the agent is overwritten. No agent
argument or prose is read as an action. After authentication, scope, revision, argument validation and the
required-reader gates, the server may return the reserved JSON-RPC error `-32011` with data:

```json
{"code":"local_action_required","v":1,"call":"<echo _call>","rev":"<pinned rev>","action_id":"<opaque>","action":"enqueue_file_snapshot","action_v":1,"path":"<exact resolved_path.path>"}
```

This is control data and never an agent-facing answer. The shim ignores its human-readable message and never
relays it. The shim accepts exactly one directive, bound to the same call, tool, descriptor, capability,
action version and original resolved file. It does not accept an action embedded in an ordinary result, a
different JSON-RPC error, an unsolicited message, or prose. It runs the bounded primitive at most once,
re-reads all declared local context, and then forwards the original arguments and request id once more with
the same call token and revision and:

```json
{"effects":[{"action":"enqueue_file_snapshot","v":1,"action_id":"<same>","ok":true,"outcome":"enqueued","error":null}]}
```

`effects` lives inside the shim-owned `_local`. It is a result of the primitive, not a reader and not an agent
permission. Outcomes are `enqueued`, `covered`, `failed` and `unknown`, and `ok` is true only for the first two.
Failure codes are `capture_off`, `spool_dropped`, `yakka_bin_set`, `unsupported`, `path_changed`,
`queue_unavailable`, `queue_rejected`, `stale_declaration` and `effect_unknown`. The codes are facts. Delivery
state, explanations and fixes stay on the server. A malformed, undeclared or unknown action is never executed,
and where the envelope is safely bound the single continuation carries `unsupported`. An unbound or malformed
envelope, a descriptor change, a path substitution or a second directive ends the call with the shim's
`bad directive` error, and no further round starts. A descriptor change after enqueue does not undo the entry,
and the error must say the local effect may have happened. The initial `-32010` refresh and retry is still
allowed once, before any directive, and does not reset the one-effect allowance.

The final normal server reply is relayed unchanged. Plan 21 P3 reads the refreshed delivery hash, queue coverage,
rejection and effect facts. `delivered` requires the service's hash to match. `queued` requires a current covering
entry. An enqueue acknowledgment alone proves neither. If the drain has taken the entry but delivery is not yet
visible, the answer is `not delivered` or `stale`, says the enqueue was acknowledged but delivery is unconfirmed,
and asks for a repeat read. Reader failures stay `local context unavailable`, never a clean state. All round trips
and the effect share the call's bounded deadline. No background job or polling loop is introduced. Cancellation
before the action starts prevents it. After the action starts, cancellation can leave an entry, and nothing rolls it back.

### Retries and unknown outcomes

A transport retry never re-executes the action. Before the action starts, the safe read-retry rules apply. After it
starts, only the continuation carrying the same result facts can be retried, and never with another enqueue. If the
final transport attempt fails, the shim returns its transport error with `local_effect_outcome` (`enqueued`,
`covered`, `failed` or `unknown`) and no false tool state. An interrupted spool acknowledgment is `unknown`, even if
an entry may exist. The primitive is never repeated, no entry is overwritten or deleted, and absence after a drain is
not proof of failure. A later explicit feedback call re-reads service hash, file mtime and queue evidence and shows any
unconfirmed delivery. A restart gives no exactly-once guarantee and never silently replays an abandoned directive.
There is no persistent retry ledger. Metadata-identical facts still dedupe at normal ingest under Plan 21's row-hash rule.

### The bounded primitive

The shim implements one generic action, with no tool name and no feedback wording. Its only target is the regular file
already resolved, contained in the call's Git worktree, hashed, and identified by the initial readers. It pins the
canonical realpath, the worktree and repository identity, and the local file identity (device and inode, size, mtime and
hash). Immediately before enqueue it rechecks containment, identity and generation. A swapped path, a changed symlink, a
replaced file or a changed generation fails with `path_changed` and no enqueue. A directive path must equal the original
`resolved_path.path` exactly. The canonical realpath is a separate local identity guard and is not substituted into the
v1 reader's normalised output. A spelling the server supplies grants no capability, even if it resolves to the same inode.
An unusable initial path, a failed reader or a file outside the worktree grants no action capability.

The primitive checks complete current queue coverage again before appending, so a concurrent or repeated enqueue for the
same file generation is suppressed. A newly covering rejection prevents the append with `queue_rejected`. An incomplete scan
fails with `queue_unavailable`, and never appends on the strength of the diagnostic sample. Coverage uses the repository and
path matching and the entry-mtime-at-or-after-file-mtime rule. An unchanged service hash avoids a directive in the first
place. Concurrent calls for the same target serialise the check and the append with bounded local coordination. The drain's
`.drain.lock` and the spool kick locks keep their existing meanings. The shim never overwrites, consumes or deletes a queue
entry. A legitimate later rewrite can enqueue one new pointer. Mtime coverage is a heuristic, so identical-timestamp edits are
not promised to be preserved.

The enqueue calls the installed plugin's fixed `spool.sh` entry point with fixed arguments and pointer metadata on stdin. It
never takes a server-supplied command string, shell evaluation or an executable path. It writes only the existing queue form:
`umask 077`, a temporary file, then an atomic rename, with an envelope and a pointer payload (`artifact_snapshot`, the
repository, working directory and path, and the conversation metadata). No content is copied into a queue packet or an MCP body.
The opt-in `YAKKA_SPOOL_PRINT=1` acknowledgment prints only the successful entry name to the calling shim, and hook stdout is
unchanged. A zero exit is not success. If the write's outcome cannot be determined, the result is `spool_dropped` or `unknown`.
`YAKKA_HOOKLOG` off gives `capture_off` with no write. A set `YAKKA_BIN` gives `yakka_bin_set` before any enqueue. Queue
configuration comes only from the existing local configuration, never from the directive.

On a successful spool, the existing kick rules apply, including `YAKKA_HOOKLOG_KICK=0`, `.drain.lock` and the kick fallback. The
shim has no drain launcher and no kick policy of its own. A bounded action can therefore start the normal Python drain indirectly
through the spool. If the kick is suppressed, the pointer stays queued and is reported with drain liveness.

A pointer is not a snapshot, despite the name. A file changed after the final guard and before drain consumption can deliver the
newer bytes. A vanished or ineligible file can be rejected by the drain. Neither the enqueue nor `queued` claims that exact bytes
were captured or scanned. Feedback re-hashes the current file on each call and reports delivery or rejection for that generation.
No secret values, payloads, bearer keys, effect arguments or absolute paths are added to logs. The service's own ingest checks are
unchanged. The Python drain alone reads content, hashes it, scans and withholds it, and posts `/v1/ingest`. The MCP handler never
scans content, ingests, wakes the scoring worker or writes the service.

### Authorization

`artifact_feedback` keeps read scope, `readOnlyHint` and `idempotentHint`, which describe its service behaviour: no service write,
ingest or worker wake. They grant no local filesystem permission. The declared action and the bounded approval authorize the queue
effect. Tool descriptions must disclose that effect so a harness can apply its local-effect permission policy. A read token can obtain
feedback and, with local permission, cause the bounded enqueue. That token still cannot authorize drain ingest. An ingest auth failure
leaves the ordinary queued or retry evidence, and the existing age-based `not delivered` or `stale` diagnosis. No token scope, tenant
isolation, shared login or auth fallback changes. `_local` and `effects` are claims to the server, never authorization.

## Drain ownership

The hooks own the drain kick. `spool.sh` starts a detached drain after every spooled event, one at a time, suppressed by
`YAKKA_HOOKLOG_KICK=0`. `SessionStart` and `PostToolUse` run through it for Claude and Codex, and Cursor's `postToolUse` does too. A
stopped drain therefore restarts at the next hook event of any kind. The shim starts no drain.

The cost is stated, not hidden. A drain is started only when an event is actually spooled, the spool's conversation id is present,
`YAKKA_HOOKLOG` is not off, `YAKKA_HOOKLOG_KICK` is not `0`, and a set `YAKKA_BIN` is executable. Where any of those fails, or the hooks
do not run, a queued file whose drain is not running stays queued until something starts a drain. `artifact_feedback` answers `queued`
with the reason `no drain running` and the fix `yakka drain`, and the 1.5 s wait for the store applies only while a drain runs. The shim
and the drain share only the login function and the queue directory layout. The shim reads the queue and never writes it.

## Open questions

Question 1 is resolved by the 7 Nov 2026 approval above. The open items are:

2. Do Claude Code, Codex and Cursor tolerate `_meta["yakka/tool"]` in `tools/list` without sending it to the model,
   and what does each do after a failed `initialize`? Neither has been observed in a live session. Fallbacks: a
   separate declaration endpoint (changes only where the shim learns declarations) and a harness restart after a
   failed `initialize`. Blocks nothing.
3. Does an intermediary cut a call that runs longer than a minute? The Fly proxy idle timeout is not set in `fly.toml`
   (community reports of about 60 s are unverified). The Cloudflare edge in front of `api.yakka.build` has a read
   timeout that is not in the repository and not verified. Any harness's MCP tool timeout is also unknown. The route
   and the shim support `timeout_s` up to 300 s, which may exceed what the edge allows. The shim maps an intermediary's
   `504` or `524` to `timeout`. The fallbacks are an SSE reply or an async call. Blocks only long-call smoke evidence.
4. Does Codex (and Claude Code) expose the project directory to a stdio MCP server? (Plan 21 open question 1.) `project_dir`
   returns `null` until this is answered, and `bases:["cwd"]` is today's behaviour. Nothing here waits on it.
5. Where should the https-only bearer rule live for both the drain and the shim? Today it is enforced in the shim only.
   Plan 21's `Resolve` is the likely home for both.

## Rejected alternatives

- A local-mode shortcut in the shim that answers from the queue when the server is down. It is the behaviour the rule removes,
  and it needs wording in the shim. The `queued_locally` count is a fact in an error, not an answer.
- Porting the Go shim. The Go `internal/mcp` package is slated for deletion and is consulted, not depended on.
- A declaration that carries a command, path or URL for the shim to run. The server is a single point of compromise for every
  logged-in machine, so the reader table is the capability allowlist, and it grows only by shipping a plugin.
- Client-side argument validation or schema checks "for speed". The server validates. An invalid call costs one round trip.
- Ignoring `local_actions` in v1. An ignored key would let the effect arrive as plumbing with no decision. Refusing it makes
  the extension an explicit, versioned decision.
