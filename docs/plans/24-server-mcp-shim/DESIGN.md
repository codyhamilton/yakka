# Server-defined MCP: the yakka.py shim becomes a thin wrapper

## Intent

User request, verbatim — codyhamilton/yakka issue #177, supplied in full:

> Title: Fundamental rethink: the yakka.py MCP shim becomes a thin wrapper that injects auth and local context, with every tool on the server
>
> **Plans 21 (feedback delivery) and 22 (session work tagging) depend on this issue.**
>
> Direction from Cody (2 Nov): the local MCP shim in `plugins/yakka/client/yakka.py` is a thin wrapper, not a surface. It exists so the shim and the drain share one login (`client.toml` / `YAKKA_ENDPOINT`+`YAKKA_KEY`). All tool definitions and logic live on the server.
>
> ## The rule
> The shim may only:
> 1. inject auth: the bearer key from the shared login, on every forwarded request; and
> 2. inject local context, meaning values that can only be read from the agent's machine (file content, a resolved path, git identity, local queue facts), added as parameters to the forwarded call.
>
> The shim must not hold any tool list, description, schema, `instructions`, argument validation, state logic or result wording. It forwards `initialize`, `tools/list` and `tools/call` to the server's MCP endpoint and relays the replies unchanged. Its only errors are its own transport and config ones: not logged in, config set for remote but unreachable (per Plan 21, it never falls back to local), and local read failures reported as injected context, not as tool results. Which context gets injected for which tool must be declared by the server, for example as a per-tool annotation in `tools/list`, not hard-coded per tool in the shim. The drain stays a separate local piece using the same login.
>
> The server has no MCP endpoint today, only REST (/v1/artifacts, /v1/baselines, /v1/checks, /v1/search, /v1/health). All MCP lives in yakka.py # --- mcp --- and test_mcp.py. Move protocol, surface, list_checks and search_artifacts validation/formatting, artifact_feedback logic/wording to Go server. Current feedback local reads: working dir, file metadata/hash, git repo path/id, local queue entries, drain lock liveness, shared config. One existing effect starts drain when queued; decide whether hooks own kick versus shim. Path kind/tracked/reasons/states/fix wording move server-side.
>
> Done when: tools/list and every tools/call through yakka mcp match direct authenticated server calls with same injected context; yakka.py contains no tool names/descriptions/schemas/result wording and test fails if it does; list_checks/search_artifacts preserve behavior and artifact_feedback states same for same local situations. Related Go client deletion #178 is separate, not porting Go shim.

Invocation brief (headless design run, harness pick `design --headless --issue codyhamilton/yakka#177`), excerpts verbatim:

> DESIGN OUTCOME:
> Minimal authenticated server-defined MCP tool registry and stdlib Python thin shim, supports current three tools and future Plan22/23 declarations. Formal enough contracts (wire shape, context reader declaration/version and failure facts, capability allowlist, trust boundaries, tenant/scope auth parity REST, bulk body budgets/truncation semantics, lifecycle/protocol handling, timeout/error/cancellation ownership, empty/unknown declaration fallback/version compatibility, no fallback remote-to-local, initialize/tool list relay preservation) that dependent plans cite exact seams. Don't overengineer full generic agent platform or invented parallel tracking. Explicit local mode only if existing contracts allow, don't silently break shared login/drain; config reconciliation with Plan21.
>
> Read-only collection isn't arbitrary command execution: fixed reader registry and safe argument/path handling, no remote-requested shell, network, writes, process launches or user-defined scripts. Server-defined descriptions/schemas/validation/formatting; shim only generic context safety and auth/transport config. Ensure SSRF/key redirect handling, path/symlink containment, secret disclosure controls especially file content, queue limited facts (no raw unneeded payload), no credentials leak in context/logs/results. Client-provided context isn't trusted identity; tenant/scopes from auth only. Direct calls can supply same context as claims but cannot cross tenancy. Spec safe behavior for missing/unknown readers/capabilities, read errors injection, no false clean feedback. May capture hash instead of file bytes for current feedback; secret handling and declared bulk later reader no surprise egress.
>
> Phase count fixed, each observable outcome, exact grounded surfaces, known/open flag. BOUNDING DESIGN not code or task briefs. Headless assumption ledger no human signoff checkpoint, but preserve explicit unresolved local-effects approval as out-of-scope extension rather than unblock by assumption. Stable docs stale about shim ownership: amend necessary stable contract/pointers transparently as proposed design, not claim already deployed.

Also from the brief, paraphrased (not verbatim): Plan 21's amended design extends the shim with a server-requested `enqueue_file_snapshot` side effect (its open question 6). The brief marks that an unapproved product decision and says the issue's rule (auth and context only) wins. This design builds the read-only context foundation with no effects, names the extension decision precisely, and says what the dependent Plan 21 phase does without it.

## Authorized amendment: bounded enqueue, declaration v2

Approval supplied for this headless amendment: **7 Nov 2026, 7:22 PM AEST**. The question was
“May the shim queue the specific reviewed file when the server requests it?” The answer, verbatim:

> Allow the bounded queue action

This approval amends only the auth/context-only restriction for one server-declared,
call-bound `enqueue_file_snapshot` action. The original Intent above is preserved. The v1
foundation below remains the base contract; this addendum takes precedence only for the
explicit v2 deltas below. It is a separately versioned extension, with the same four phases,
not a new phase or a general local-effects framework. Approval is design authorization, not
evidence that the extension is implemented, verified, released or deployed.

### Ground and amendment boundary

On 7 Nov 2026, canonical `git@github.com:codyhamilton/yakka.git` master was inspected and
fetched through ordinary Git as `e178ab458633d007244c8cfb22f99c91df9e9402`, including
Plan 24's design merge `f5a9f9e` and Plan 21's reconciliation merge `e178ab4`. The preserved
four-file draft was hash-verified and applied unchanged first, then reconciled in a new isolated
documentation worktree based on that SHA. No surrounding canonical-master delta was present.
At that basis the Python client still owns the MCP tools and the server route table has no
`/v1/mcp`. The Problem and original foundation sections below retain their historical Ground.

Read-only build-reference inspection found Plan 24 at `e178ab458633d007244c8cfb22f99c91df9e9402`,
Plan 22 at `84ffbd0e2eefda5595cb46d39e8d3aa235732e6d`, and Plan 21 at
`32f3dbe3a3b4c971e5a7cb4b02a7a5dad114993a`. Plan 21's implementation record now describes
P1 and P2 closures; they remain historical and are not reopened. These are dated local branch
observations, not reviews of PRs 181, 184 or 185, implementation correctness judgments, or
extension verification. Existing outcomes, units, implementation records and reviews on those
branches are left intact. Executor integration must re-read its then-current boundary and verify
the v2 extension against a new exact SHA. Existing `REVIEW.md` files are historical evidence,
not an adversarial pass on this amendment.

Ground was delegated to supported clean Luna recon contexts. Haiku is not offered by this Codex
subagent facility; no Claude session was launched or quota cap bypassed.

### Contract: declaration and capability negotiation (Plan 24 P1)

Declaration v1 continues to reject nonempty `local_actions` and has no directives. V2 adds exactly
one allowed declaration shape alongside the existing `context`, `scope`, `timeout_s` and `rev`:

```json
{"v":2,"local_actions":[{"action":"enqueue_file_snapshot","v":1,"path_from":"resolved_path"}]}
```

The example omits the unchanged fields. `rev` covers the complete canonical declaration,
including `local_actions`. Registration rejects any other action, action version, binding,
duplicate action or multiple actions; the action requires declared `resolved_path`, `file`,
`git`, `queue` and `drain` readers, with `queue` v2 as specified below. No command, executable, queue directory, payload template,
destination URL or alternative path can be declared. The registry provides the generic seam;
Plan 21 P3 owns adding this declaration to `artifact_feedback` and deciding when it is needed.
All other tools, including Plan 22/23 tools, retain their own declarations and permissions.

For the effect-capable variant, `queue` reader v2 retains the v1 diagnostic samples (at most
50 pending and 50 rejected entries) and adds `coverage`:
`{complete, pending_covering, rejected_covering, oldest_covering_age_s}`. Counts and oldest age
are computed over the complete matching set for the pinned repository/path and the current
`file.mtime`, not the truncated sample. This reader requires preceding `resolved_path`, `git`
and `file` facts and uses the same containment, matching and mtime rules as Plan 21. It obeys
the existing reader deadline and output budget: if it cannot establish complete coverage,
including because a potentially matching entry cannot be read, it returns
`_failed:{code:"incomplete_queue"}`. This required-reader failure prevents a directive or
enqueue; omission/truncation is never evidence of absence. V1 readers/tools remain unchanged;
an effect-capable shim must implement queue v2 and the registry fixture must declare it.

The shim advertises `Yakka-Context: 2` and
`Yakka-Local-Actions: enqueue_file_snapshot/1`. The server advertises the matching action under
`initialize.result._meta["yakka/local-actions"]` as
`{"v":1,"actions":[{"action":"enqueue_file_snapshot","v":1}]}`. This is additive to MCP
capabilities; the existing tools capability is unchanged. Headers are sent on each request;
the stateless server does not depend on remembering initialization. Both the declaration version
and the explicit action capability must match before a directive is permitted. The shim checks
the server advertisement (fetching `initialize` internally if necessary) and pins it with the
declaration before acting. Capability headers are client support claims, never identity or
tenant authority.

For an old shim, an absent action header, or an unsupported version, the server retains the v1
read-only feedback variant and its declaration, with explicit server wording `not delivered` or
`stale` plus `enqueue unsupported` when enqueue would be needed. It never sends that caller a
directive, claims it queued anything, or hides the delivery failure. Other tools continue to work.
The server may omit a future tool that has no compatible variant, as in the base negotiation rule.
A new shim with an old server uses v1 when available; a server without `/v1/mcp` produces the
existing `server unsupported` error. A declaration/action/version mismatch is `unsupported`,
with no effect. No compatibility path posts content directly or silently substitutes local mode.

### Contract: one directive round and result facts (Plan 24 P1/P4)

The initial call carries shim-generated `_local._call` (a fresh opaque call token), `_v:2`,
`_rev` and the declared reader facts. Agent-supplied `_local`, call tokens and effect facts are
overwritten; no agent argument or prose is interpreted as an action. After authentication,
scope, revision, argument validation and required-reader gates, the server may return the
reserved JSON-RPC error `-32011`, with data:

```json
{"code":"local_action_required","v":1,"call":"<echo _call>","rev":"<pinned rev>","action_id":"<opaque>","action":"enqueue_file_snapshot","action_v":1,"path":"<exact resolved_path.path>"}
```

This is control data, never an agent-facing tool answer. Its human-readable message is ignored
by the shim and never relayed. The shim accepts exactly one directive bound to the same call,
tool, descriptor, capability, action version and original resolved file. It does not accept an
action embedded in an ordinary result, another JSON-RPC error, unsolicited message or prose.
It runs the bounded primitive at most once, re-reads all declared local context, then forwards
the original arguments and request id once more with the same call token and revision and:

```json
{"effects":[{"action":"enqueue_file_snapshot","v":1,"action_id":"<same>","ok":true,"outcome":"enqueued","error":null}]}
```

`effects` lives inside shim-owned `_local`, is a result of the primitive, not a reader or an
agent permission. Outcomes are `enqueued`, `covered`, `failed`, `unknown`; `ok` is true only
for the first two. Failure codes are `capture_off`, `spool_dropped`, `yakka_bin_set`,
`unsupported`, `path_changed`, `queue_unavailable`, `queue_rejected`, `stale_declaration`, `effect_unknown`.
The codes are facts; all delivery state, explanations and fixes remain on the server.
Malformed, undeclared or unknown actions are never executed; where the envelope is safely
bound, the single continuation carries `unsupported`. An unbound/malformed envelope, descriptor
change, path substitution or a second directive terminates with the shim's bounded `bad directive`
error. It never starts another directive round. A descriptor change after enqueue does not undo
the entry and must say the local effect may have happened. The initial `-32010` refresh/retry
remains allowed once only before any directive; it does not reset the one-effect allowance.

The final normal server reply is relayed unchanged. Plan 21 P3 interprets refreshed delivery
hash, queue coverage, rejection and effect facts: `delivered` requires the service's hash to
match; `queued` requires a current covering entry; an enqueue acknowledgment alone proves neither.
If the drain has taken the entry but delivery is not yet visible, the answer is `not delivered`
or `stale`, explains that enqueue was acknowledged but delivery is unconfirmed, and asks for a
repeat read. Reader failures remain `local context unavailable`, never a clean delivery state.
All round trips and the effect share the call's bounded deadline; no background tool job or
new polling loop is introduced. Cancellation prevents an action not yet started; after action
start it can leave an entry and cannot roll it back.

Transport retry never re-executes the action. Before action start the existing safe read retry
rules apply. After start, only the continuation carrying the same result facts can be retried,
without another enqueue; if final transport fails the shim returns its transport error with
`local_effect_outcome` (`enqueued`, `covered`, `failed` or `unknown`) and no false tool state.
An interrupted spool acknowledgment is `unknown`, even if an entry may exist. Do not repeat
the primitive, overwrite/delete an entry or treat absence after a drain as proof of failure.
An explicit later feedback call re-reads service/hash/mtime/queue evidence and exposes any
unconfirmed delivery; a restart provides no exactly-once guarantee and must not silently replay
an abandoned directive. There is no new persistent retry ledger. Metadata-identical facts still
dedupe at normal ingest under Plan 21's row-hash contract.

### Contract: bounded local primitive and pointer freshness (Plan 24 P4)

The shim implements one generic action, without tool names or feedback wording. Its only target
is the regular file already resolved, contained in the call's Git worktree, hashed and identified
by the initial readers. It pins canonical realpath, worktree/repository identity and local file
identity (device/inode, size, mtime and hash). Immediately before enqueue it rechecks containment,
identity and generation; swapping a path, changing a symlink, replacing a file or changing the
generation fails `path_changed` without enqueue. A directive path must equal the original
`resolved_path.path` exactly; the canonical realpath is a separate local identity guard and is
not substituted into the v1 reader's normalized-path output. Alternative spellings supplied by
the server grant no capability, even when they resolve to the same inode. Unusable
initial paths, failed readers and files outside the worktree grant no action capability. Local
guards are safety checks, not tool argument/state logic.

The primitive checks complete current queue coverage again to suppress a concurrent/repeated enqueue for
the same file generation. A newly covering rejection prevents append with `queue_rejected`;
an incomplete scan fails `queue_unavailable`, never an append based on the diagnostic sample.
Coverage uses Plan 21's repository/path matching and entry mtime at or
after file mtime; unchanged service hash avoids a directive in the first place. Concurrent calls
for the same target must serialize this check-and-append with bounded local coordination;
the drain's lifetime `.drain.lock` and spool kick locks retain their existing meanings. No queue
entry is overwritten, consumed or deleted by the shim. A legitimate later rewrite can enqueue
one new pointer; mtime coverage is a heuristic, not a promise to preserve identical-timestamp edits.
The next feedback call compares the current content hash, so a mismatch remains visibly stale
or not delivered rather than being called delivered.

The enqueue uses the installed plugin's fixed `spool.sh` entry point with fixed arguments and
pointer metadata on stdin, never server-supplied command strings, shell evaluation or a path to
an executable. It writes only the existing queue form: `umask 077`, temporary file then atomic
rename, envelope plus pointer payload (`artifact_snapshot`, repo/cwd/path and conversation
metadata as Plan 21 defines). No content is copied to a queue packet or MCP body. The opt-in
`YAKKA_SPOOL_PRINT=1` acknowledgment prints only the successful entry name to the private caller;
hook stdout stays unchanged. A mere zero exit is not success: no acknowledgment is `spool_dropped`
or `unknown` if the write's outcome cannot be determined. Acknowledgment is never agent wording.
`YAKKA_HOOKLOG` off gives `capture_off` with no write. A set `YAKKA_BIN` gives `yakka_bin_set`
before enqueue, preventing this path from starting an unknown external drain implementation.
Queue configuration comes only from the existing local configuration, never the directive.

There is no shim-owned drain launcher. On a successful spool, the existing spool kick rules
apply, including `YAKKA_HOOKLOG_KICK=0`, `.drain.lock` and existing kick fallback. Thus the bounded
action may indirectly start the normal Python drain through the spool; it does not invent a
second kick policy. Suppressing the kick leaves the pointer queued, reported with drain liveness.
The Python drain alone reads content with its hash, scans/withholds it, and posts `/v1/ingest`.
The MCP handler never scans content, ingests, wakes the scoring worker or writes the service.
The service's own ordinary ingest checks remain unchanged. No secret values, payloads, bearer
keys, effect arguments or absolute paths are added to logs.

Despite the name `enqueue_file_snapshot`, this is a pointer, preserving Plan 21's semantics.
A file changed after the final guard and before drain consumption can deliver the newer bytes;
a vanished or ineligible file can be rejected by the drain. Neither enqueue nor `queued` claims
that exact bytes have been captured or scanned. Feedback re-hashes the current file on each call
and reports delivery/rejection for that generation; no snapshot-content upload is added to the
shim to close this race.

### Authorization, service scope and permissions

`artifact_feedback` retains scope `read`, `readOnlyHint:true` and `idempotentHint:true` as already
decided in Plan 21. Those describe its service behavior: no service write, ingest or worker wake.
They do not grant local filesystem permission. The explicit local-action declaration and the
bounded approval above authorize the queue effect; tool descriptions must disclose it so a
harness can apply its local-effect permission policy. A read token can obtain feedback and,
with local permission, cause the bounded enqueue; that token still cannot authorize drain ingest.
An ingest auth failure leaves ordinary queued/retry evidence and ultimately the existing age-based
`not delivered`/`stale` diagnosis. No token scope, tenant isolation, shared login or auth fallback
changes. `_local`/`effects` remain untrusted claims to the server, never authorization.

### Exact handoff deltas within the fixed four phases

These are acceptance addenda for the Executor to fold at a phase boundary. They do not reopen
a closed phase, add a fifth phase, create task briefs, or assert that an earlier tested SHA
covers the extension. If an affected phase has already closed/merged when this is adopted,
record extension verification against a new exact SHA without changing the historical closure.

| Phase | Outcome/acceptance delta: entry → action → observable result | Surfaces | Approach/dependencies |
|---|---|---|---|
| P1 endpoint/registry | `initialize`/`tools/list` → negotiate action and declaration versions → only compatible v2 clients receive the exact bounded declaration. Clauses (1),(2),(5),(8): add capability advertisement, queue v2 complete-coverage contract, revised rev/carrier and one-round control envelope; replace blanket action refusal only for this exact v2 action; malformed/unknown declarations fail. Auth/tenant/log/budget clauses remain. | `internal/serve/mcp*.go`, reader/declaration conformance fixture `testdata/mcp-readers.json`, registry fixtures; proposed route contract notes | Known, still no dependency. |
| P2 stateless tools | Existing direct calls → compare original corpus → identical definitions/results, no actions or effect facts needed. No acceptance delta. | Existing server reads/store and golden corpus, unchanged | Known, still P1. |
| P3 base feedback migration | V1 direct feedback calls → compare base parity corpus → existing states and no service writes. No base acceptance delta; this phase does not acquire Plan 21's enqueue state machine. | Existing feedback handler and parity fixtures, unchanged for the foundation | Known, still P1. Plan 21 P3 owns its subsequent directive decisions/state wording. |
| P4 shim | Compatible fake server's declared action → one guarded enqueue and continuation → one pointer, refreshed facts, only final server wording. Extend clauses (1),(2),(3),(5),(7),(9) for v2 relay, action error facts, no directive leakage, spoof/path/symlink/identity/descriptor rejection, concurrent coverage, complete-coverage/rejection summaries beyond 50 entries and incomplete-scan refusal, timeout/retry/unknown outcome, old/new compatibility and static argv guard. Replace “spool byte-identical/no processes except git” only for the fixed spool invocation/acknowledgment and its existing kick. V1 remains effect-free. | `yakka.py` shim/action primitive, queue v2 reader and tests/guard, `spool.sh` opt-in acknowledgment, registry conformance fixtures, docs 02/04; plugin version change belongs to future implementation | Known, still P1/P2/P3. No dependency on Plan 21 handler implementation for generic conformance proof. |
| Plan 21 P3 (separate plan, unchanged seven-phase count) | Missing current service hash with no covering/rejected pointer → server requests approved action → pointer queued before Stop, repeat adds none, normal drain later delivers or exposes rejection/failure. Part 2 selects A, and includes the v2 adversarial/compatibility cases above. | Plan 21 feedback handler/declaration, sweep/drain/path matching, integration evidence | Open as before; P21 P1 plus P24 P1/P3/P4 and verified v2 extension. |

P24 P1/P4 generic conformance and P21 P3 end-to-end behavior are separate acceptance obligations.
No extension build or implementation tests run as part of this design amendment.

### Headless amendment ledger

- Question: Is a local queue write now permitted? Answer: only the quoted bounded approval,
  selecting Plan 21 alternative A. Rationale: explicit user decision at the stated time. If the
  approval is construed differently, return to design; never infer arbitrary local effects.
- Question: What changes in a built/closed foundation? Answer: acceptance deltas are separately
  verified at the Executor's boundary; base closure remains historical. Rationale: ongoing PRs
  can move beyond these dated observations. If the Executor's base differs, reconcile the
  extension with its current surfaces without rewriting prior closure evidence.
- Question: How do retries and old clients behave? Answer: explicit support negotiation, one
  action per call, unknown-outcome visibility and no automatic action replay. Rationale: no
  existing durable exactly-once queue receipt contract. If stronger guarantees are required,
  that is a new design decision, not an invented local effects ledger.
- Question: What does freshness mean? Answer: a guarded pointer to the reviewed file, current
  bytes at drain time, current hash at feedback time. Rationale: preserves Plan 21's queue
  semantics. If exact-byte capture is required, stop at design; this approval does not grant it.
- Question: Does publication release any operational gate? Answer: no. No queue operations,
  implementation, retirement, deletion, secrets/config changes, build/review/merge, release,
  deployment or Plan 25 work is authorized by this amendment run. Existing Plan 21 gates remain.

### Adversarial rationale

A supported clean-context Codex design reviewer challenged the four preserved draft documents;
its runtime model ID was not exposed, so this is not represented as a Haiku or Sonnet pass.
Its four findings led to explicit queue v2 complete-set coverage and incomplete-scan refusal,
separate wire-path equality and canonical identity guards, removal of Plan 21's unconditional
queued-on-enqueue promise, and the 300-second age diagnosis regardless of drain liveness.
The amended phase deltas include the resulting conformance obligations. This records a design
challenge and corrections, not implementation review, test evidence, a reused historical
`REVIEW.md` verdict. Canonical-master reconciliation is recorded separately above; that does not
turn this prior draft review into a fresh review of the final tracked files.

## Problem

All MCP behaviour lives in the client. `plugins/yakka/client/yakka.py` `# --- mcp ---` (lines 1840-2513) holds the protocol (`_mcp_handle`, 2400), the three tool definitions (`_MCP_TOOL_LIST`, 2350-2389), the `instructions` text (1845-1849), argument validation, every result string, and the whole `artifact_feedback` state machine (1967-2200) beside its local reads. The server has no MCP code at all (`grep -i mcp internal/serve` is empty); its routes are REST (`serve.go:485-529`). A Go twin of the shim and of the feedback states exists in `packages/yakka/internal/mcp` (`feedback.go:151-334`), unregistered and slated for deletion by #178.

Consequences: every tool change ships as a plugin release and drifts between harnesses; Plans 21, 22 and 23 each want new tools or new wording and would put it in a file the rule says must hold none; and the shim's one local effect (starting the drain, `yakka.py:1882-1901`) plus its "never fail because the service is down, answer from local state" behaviour (design 04) are the opposite of Plan 21's remote-or-fail rule. #177 is the foundation all three plans wait on.

## Solution Shape

After this change the server has one MCP endpoint, `POST /v1/mcp`, behind the same bearer authentication and tenant resolution as the REST routes. A Go tool registry on the server owns every tool: name, description, schema, annotations, required scope, call timeout, instruction sentence, handler, and the declaration of which local context the call needs. `list_checks`, `search_artifacts` and `artifact_feedback` are the first three entries, answering with the wording they have today. `yakka mcp` is a thin stdio program in `yakka.py` that reads the shared login, forwards each JSON-RPC message to that endpoint with the bearer attached, relays the reply bytes unchanged, and, on `tools/call` only, fills one reserved argument, `_local`, with the values of the readers the server's declaration for that tool names. The shim's readers are a fixed table of read-only mechanisms; the server chooses which to run and with what constant parameters, and never anything else. The shim runs no effect, interprets only the named protocol fields of a reply (each tool's `_meta["yakka/tool"]` in `tools/list`, the error code `-32010`, the HTTP status), and holds no tool name or wording. Its own errors are a closed set of transport and config conditions.

Nothing changes for REST callers, the drain, the spool, the hooks or the plugin's MCP registration (`.mcp.json` and `.codex-mcp.json` keep launching `python3 client/yakka.py mcp`).

### Domain: MCP endpoint and registry (server)

- Owns: the MCP wire contract, the tool registry, the declaration format, scope and tenant enforcement for tools, body and time budgets, the `instructions` string, and every tool's description, schema, validation, state logic and wording. New Go code under `packages/yakka/internal/serve` (route and registry, tool handlers beside them). It does not import `internal/mcp`, `drain`, `facts` or `clientconfig` (all deleted by #178, which stays independent).
- Contract, **transport**: `POST /v1/mcp`, one JSON-RPC 2.0 message per request body, `Content-Type: application/json`. A request with an `id` gets `200` and one compact single-line JSON reply (`Content-Type: application/json`, no SSE, no session id, no server-initiated messages, no batch). A message with no `id` (a notification) gets `202` and no body. A body that is not valid UTF-8 JSON is `-32700` with `id: null`; a JSON array or non-object is `-32600`; a missing `method` is `-32600`; an unknown method with an `id` is `-32601`; an unknown notification is accepted silently. `GET`/other methods get the existing `405` with `Allow: POST`. These are today's `_mcp_handle` behaviours (`yakka.py:2400-2466`), moved.
- Contract, **methods**: `initialize` (echoes the client's `protocolVersion` if it is one of `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, else answers `2025-11-25`; `capabilities` `{"tools":{"listChanged":false}}`; `serverInfo` `{"name":"yakka","version":<server build>}`; `instructions` composed from a base sentence plus the instruction sentence of each registered tool the caller's scope can call, in registry order, so a `read` key is never told to use a tool it cannot see), `ping` (`{}`), `tools/list`, `tools/call`. The server is stateless: no method depends on a previous request, so a shim that restarts or retries needs no handshake replay.
- Contract, **authentication and tenancy**: the route authenticates through a bearer-only helper that factors out the bearer branch of `authorizeRequest` (`session.go:291-313`; `whoami` already hand-rolls one, `serve.go:663-690`) and has no cookie branch: the bearer resolves tenant and scope from the token record exactly as for REST, a `?tenant=` that differs is `401` as today (in keyed and remote modes; local mode returns before that check, as for REST), and in loopback local mode (`Config.Local()`) the principal is `LocalTenant` with every scope, as for REST. Cookie sessions are refused on this route (`401`), and any request carrying an `Origin` header is refused (`403`): the only callers are programs, and the refusal closes browser-driven cross-origin posts to the keyless loopback server (`localGuard` already refuses non-loopback `Host` values, `serve.go:585-604`). Tenant and scope come from the credential alone; nothing in a request body, including `_local`, selects or changes either. Handlers receive the resolved tenant state and never a tenant name from input. HTTP `401` is for a missing or bad credential and carries the REST error body; a valid key lacking the tool's scope is a `200` JSON-RPC error `-32003` (data `{"code":"insufficient_scope","need":"read_write"}`) so the shim relays it unchanged.
- Contract, **scope**: each tool declares `scope`, `read` (default) or `read_write`, enforced by the registry before the handler runs. `tools/list` lists only tools the caller's scope satisfies. `artifact_feedback`, `list_checks` and `search_artifacts` are `read` (Plan 21 as amended: no write-scope check on this route). A `read_write` tool's declaration says so and `readOnlyHint` is false.
- Contract, **tool definition** (the registration seam dependent plans cite): `name`, `description`, `inputSchema`, `annotations` (`readOnlyHint`, `idempotentHint` etc., MCP standard), `scope`, `timeout_s`, `instruction` (one sentence appended to `instructions`, or empty), `context` (the reader list below), `validate(arguments)` (argument checks that need no local context) and `handler(ctx, tenantState, arguments, local)`. The registry runs, in this order: authentication, scope, the `_rev` check, `validate`, the required-reader gate, `handler`; so an argument error is never masked by a reader failure. The registry rejects, at server start, a registration with a duplicate name, a reader name absent from `packages/yakka/internal/serve/testdata/mcp-readers.json`, a reader that is not declared before one that depends on it, a non-empty `local_actions` key (no effects exist, see Decisions), `timeout_s` above the ceiling, or a bulk budget total above the body ceiling. The inputSchema is documentation for the agent; the handler validates, as today (extra arguments are ignored, `arguments must be an object` is a tool error).
- Contract, **declaration** (`tools/list` entry, `_meta["yakka/tool"]`, additive to the MCP `Tool` fields so a harness that ignores `_meta` is unaffected):

  ```
  {"v":1,"rev":"<16 hex>","scope":"read","timeout_s":20,
   "context":[{"reader":"git","v":1,"required":true,"params":{"of":"resolved_path"}}, ...]}
  ```
  `v` is the declaration format version. `rev` is the first 16 hex characters of SHA-256 of the canonical JSON of the rest of this object, so any change to a tool's declaration changes it. `context` is ordered; an entry names a reader from the shim's fixed table, its version, whether the handler needs it (`required`, default true), and constant `params` the reader's own table allows (values are booleans, integers, enum strings from the reader's list, or arrays of such; never a command, path to run, or URL). A tool with no `context` gets auth only. Unknown keys are ignored by readers of the declaration, so additions that do not change meaning do not bump `v`. Version negotiation: the shim sends `Yakka-Context: <highest v it reads>` (absent means 1); the server never serves a declaration newer than that, and a tool that exists only at a newer `v` is left out of `tools/list` for that caller, so an old plugin keeps every tool it can run instead of failing closed on all of them. The shim's `unsupported_declaration` failure remains the backstop for a direct mismatch.
- Contract, **carrier**: the shim writes the injected values to `params.arguments._local` (`_local` is reserved; the agent's own `_local` is overwritten, or deleted when the tool declares no context):

  ```
  {"_v":1,"_rev":"<rev the shim used>","git":{...},"file":{...},"cwd":{...}}
  ```
  Each declared reader's key holds its value object (reader-owned shape, below) or `{"_failed":{"code":"<code>"}}`. The registry strips `_local` before the handler sees `arguments` and hands the handler an accessor, `Local.Get(name)`, that returns a value or a typed failure. After `validate` passes, a `required` reader that is failed, absent from `_local`, or whose key is not a declared name is a tool error `local context unavailable: <reader> (<code>)` raised by the registry before the handler runs, so a handler cannot read a missing fact as an empty one. Value-level facts are never failures: a reader whose input is unusable for a legitimate reason (an empty path, a missing file, a directory that is not a repository) returns a value that says so. A handler that marks a reader `required:false` must handle the failure explicitly. If `_rev` is present and differs from the tool's current `rev`, the call fails before the handler with `-32010` (data `{"code":"stale_declaration"}`) and no effect; the shim refreshes `tools/list` once and retries once (Domain: Shim). A direct caller that omits `_rev` skips the check.
- Contract, **trust**: `_local` and `arguments` are claims by the caller. A handler may use them to word an answer, select a row inside the caller's own tenant (for example `(repo_id, rel_path)` for `artifact_feedback`), or compare hashes. It must not use them to choose a tenant, open a path, run a command, build a URL or SQL text, or decide authorization; the server never touches a filesystem path that arrives in `_local`. A direct authenticated call carrying the same `_local` receives the same answer as through the shim, and cannot reach another tenant's data (tested with a cross-tenant matrix per tool). Absolute paths in `_local` (`cwd`, `project_dir`, `resolved_path`) are transient: the registry and handlers do not log or store them, and server request logs hold method, tool name, tenant id, status and duration only, never arguments, `_local` or tokens.
- Contract, **budgets**: default MCP body cap 256 KiB; ceiling 8 MiB (`YAKKA_MCP_MAX_BODY`); authentication precedes any body read; the route then reads at most the ceiling through `MaxBytesReader` (a body over it is `413` with the REST error body), parses the message, and compares the received length with the cap of the tool named in it (the default for any other method); over that cap is `413` and nothing executes. An authenticated caller can therefore make the server buffer up to the ceiling (REST ingest already allows 16 MiB). A tool's cap is `max(default, 64 KiB + the sum of its bulk readers' budget_bytes)`, derived at registration from the declaration, so the cap and the declaration cannot disagree. Default tool wall time 20 s, ceiling 300 s (`YAKKA_MCP_MAX_CALL`), declared as `timeout_s`; the server cancels the handler's context at `timeout_s` and answers a tool error `timeout after <n> s`. A client disconnect cancels the handler context; the handler must stop work, and a handler with a non-idempotent effect states in its description whether an abandoned call may have run. The route sets no `WriteTimeout` (a long call must not be cut by the server); `ReadHeaderTimeout` (10 s, `main.go:111`) stays.
- Non-goals: server-initiated messages, SSE, resources, prompts, sampling, OAuth for MCP clients, batch, per-tool rate limits (the REST API has none), registering tool handlers from outside the Go binary, and any tool beyond the three until Plans 21-23 add theirs.

### Domain: Shim (`yakka mcp` in `yakka.py`)

- Owns: stdio framing; resolving the shared login; auth and transport; the fixed reader table and its safety; the declaration cache; its own closed error set. It owns no tool name, description, schema, instruction, argument validation, state, or result wording.
- Contract, **forwarding**: newline-delimited JSON on stdin and stdout (as today). For every request or notification the shim POSTs the message to `<endpoint>/v1/mcp` and writes the reply body, byte for byte, plus `\n`. It is method-agnostic: it does not enumerate methods, so `initialize`, `ping`, `tools/list`, `tools/call` and anything a harness sends later are relayed and the server answers (`-32601` if unknown). The request `id` is the harness's own, forwarded unchanged and echoed by the server. On `tools/call` only, it edits `params.arguments._local` as above and nothing else; when `params.arguments` is present but not an object it forwards the call unchanged and the server answers `arguments must be an object`. On `tools/list` replies it reads (never alters) each tool's `_meta["yakka/tool"]` into a cache keyed by tool name, to know what to inject. If a `tools/call` arrives before any `tools/list` result, or for a tool not in the cache, the shim first fetches `tools/list` itself (internal, not relayed). A missing declaration means auth only, never a guessed list.
- Contract, **requests per call**: the shim re-resolves the login (`Load()` today, Plan 21's `Resolve` later: one function, the one the drain calls) on every request, so a login or key change applies without a restart, and performs no network I/O at startup.
- Contract, **HTTP**: `POST` with `Authorization: Bearer <key>` (omitted in Local mode, where `Config.Local()` ignores bearers), `Content-Type: application/json`, `Accept: application/json`, `Yakka-Context: 1` (the highest declaration/carrier version the shim reads), `User-Agent: yakka-shim/<plugin version>`. The shim uses the endpoint origin the login gives and the fixed path `/v1/mcp`; nothing in a reply names another URL and nothing in a reply is fetched. Redirects are not followed: the shim uses the existing no-redirect opener (`_NO_REDIRECT`, `_urlopen_noredir`, `yakka.py:1137-1168`), not the opener the drain uses, because `_BearerRedirectHandler` forwards the bearer to same-host or subdomain targets and does not check an https-to-http downgrade (`yakka.py:1108-1134`); any `3xx` is the error `redirect refused`, naming only the target host. The `User-Agent` is never urllib's default (the edge in front of `api.yakka.build` rejects it, `yakka.py:1150`). The bearer is sent only over `https`, or `http` to a loopback host; any other `http` endpoint is `bad config`. Header values are validated as `_bearer_header` does (no CR/LF, latin-1). Userinfo, query and fragment are stripped from any endpoint shown (`_request_base`, `_shown_endpoint` exist).
- Contract, **own errors** (the complete set; each is a JSON-RPC error with the harness's `id`, code `-32000`, a `message` of the form `<class token>: <what failed>. <fix>` (harnesses typically show the model only `message`), and `data` `{"code","host"}` plus `queued_locally` where noted): `bad config` (login unresolved, partial env, cleartext non-loopback endpoint); `unreachable` (connect, DNS, TLS, reset, or an HTTP `5xx` with no JSON-RPC body; includes `queued_locally`, the count of pending `*.evt` files in the queue directory, nothing else about them; Plan 21's failure contract requires the error to say how many local writes stay queued); `unauthorized` (HTTP `401`; fix: log in or check the key); `server unsupported` (HTTP `404`/`405` on `/v1/mcp`: an older server; fix: update the server); `timeout` (no reply within `timeout_s` + 5 s for a call, 10 s otherwise, or an HTTP `504` or `524` from an intermediary; states the call may have completed); `redirect refused`; `bad reply` (reply is not a JSON-RPC response, or over 8 MiB). A reply that parses as a JSON-RPC response is relayed unchanged whatever the HTTP status, so server errors (`-32003`, `-32010`, `413` bodies with a JSON-RPC shape) are never reworded. No path falls back to another endpoint, to a local answer, or to explicit local mode; a resolved remote is used as resolved.
- Contract, **initialize failure** (Plan 21 open question 5, decided here): a failed `initialize` is the error above, not a synthesized result (the shim holds no capabilities or `instructions` to synthesize). Each later request re-resolves and re-tries independently, so a harness that keeps the process recovers on its next request; a harness that marks the server failed after a failed `initialize` needs a restart, which is recorded per harness in Phase 4 rather than hidden.
- Contract, **lifecycle**: requests are handled concurrently (bounded worker pool, 8) so a long call does not block `ping` or a cancel; each reply is written whole under one stdout lock, in completion order. `notifications/cancelled` for an in-flight request id aborts that request's connection (so the server's handler context is cancelled), writes no reply for it, and is not forwarded (the server is stateless). Stdin EOF ends the process after aborting in-flight requests. Stderr carries error class tokens only: never the key, arguments, `_local`, file paths or reply bodies.
- Contract, **readers**: below. The shim evaluates a call's declared readers in declaration order before the HTTP request, each under a time budget (default 5 s; the whole set 10 s), each failure caught and written as that reader's `_failed`, so a local read problem always reaches the server as context and never as a tool result. `queue`-style reads run no network. The shim also enforces its own hard ceilings on server-supplied numbers, because the server is not trusted with the user's machine: `timeout_s` above 300 is clamped to 300, a `budget_bytes` above 8 MiB or any param outside the reader's allowed range is `bad_params`. A reader unknown to the table is `{"_failed":{"code":"unsupported_reader"}}`; a known reader at a higher `v` than the table's is `unsupported_reader_version`; a declaration whose `v` exceeds what the shim reads is `unsupported_declaration` on every declared name; a `params` value outside the reader's allowed set is `bad_params`; a reader whose input is unusable is `bad_input`; a reader depending on a failed reader is `dependency_failed`, and one whose `of` input carries no path returns its value with `"skipped":"no_input"`, a fact and not a failure; also `timeout`, `io_error`, `over_budget`, `secret_in_context` (the serialized context contains the bearer key), `internal`. The code set is closed and server wording is built from it.
- Non-goals: any tool-specific branch; any write (spool, queue, files, index); starting a process other than the readers' fixed read-only argv; network access other than the one POST; interpreting any reply field beyond those the Shim contracts name; retrying anything but a `stale_declaration`; caching replies; a local answer of any kind when the server cannot be reached.

### Domain: Local context readers (the fixed table)

- Owns: the closed set of read mechanisms the shim can run, their names, versions, parameters, value shapes, safety rules and failure codes; the shared conformance file `packages/yakka/internal/serve/testdata/mcp-readers.json` (names, versions, allowed params) that the Go registry test and the Python reader tests both read, so a declaration naming something the shim cannot run is caught at server start and the converse is caught in the Python suite.
- Contract, **table** (this design builds the facts the three tools read today; later plans register their own through the same seam):

  | Reader (v1) | Params (server-supplied) | Reads | Value |
  |---|---|---|---|
  | `cwd` | none | the shim's working directory | `{"path"}` |
  | `project_dir` | none | the harness-supplied project directory from a reader-owned ordered list of environment variables (first the one Claude Code documents for plugins) | `{"path"}` or `{"path":null}` |
  | `resolved_path` | `path_arg` (the tool argument holding the path), `bases` (ordered subset of `project_dir`, `cwd`) | that argument, normalised; relative values resolved against the first available base, which it reads itself (no dependency on the `cwd` reader) | `{"path","base"}`; `path` null when the argument is empty or not a string, or relative with no base |
  | `file` | `of`: `resolved_path` | `stat` of that path; SHA-256 of the bytes only when the path is a regular file inside a git work tree after `realpath` (a symlink leaving the work tree, a non-regular file or a size over 256 MiB is withheld) | `{"exists","is_file","size","mtime","content_hash","withheld","read_error"}`; `content_hash` null with `withheld` set to `outside_repo`, `symlink_out` or `too_large`; `is_file` is `os.path.isfile` as today; `read_error` an OS error name, set only when a read inside a work tree failed |
  | `git` | `of`: `resolved_path`, `project_dir` or `cwd` | the work tree top and identity of that path's directory, by the drain's `RepoID`/`RepoPath` rules | `{"repo_id","rel_path","error"}`; `error` is `no_repo`, `no_commit` or `git_unavailable`, a fact not a failure |
  | `queue` | `of`: `git`, `path`: `resolved_path` | the spool and `rejected/` entries whose normalised write path equals `(repo_id, rel_path)` or the absolute `resolved_path` (both matches exist today, `yakka.py:2300-2307`), by the drain's path function | `{"pending":[{"age_s","mtime"}],"rejected":[{"reason","mtime"}]}`, at most 50 each, `reason` the drain's `.reason` text; no payloads, no paths, no entries for any other file |
  | `drain` | none | a non-blocking probe of `<queue>/.drain.lock` | `{"running"}` |

  `git.top` is deliberately absent: the server needs the identity and the relative path, and an absolute repository path adds egress with no use. Plan 21's table lists it; a later plan may ask for it back with a reason. `effects` is not in this table (Decisions). The `queue` reader reports what is on disk at call time; nothing is remembered between calls.
- Contract, **safety** (apply to every reader, including later plans'): (1) A reader is code in `yakka.py`; a declaration is data selecting among readers. The server cannot add a reader, a command, a path, a URL or a script. (2) Subprocesses are limited to fixed argument arrays (no shell, `-C <dir>`, `--end-of-options` where a ref is passed), a minimal allowlisted environment, a timeout and an output byte cap per command; the foundation set is `git rev-parse --show-toplevel`, `git remote`, `git remote get-url`, `git rev-list --max-parents=0 HEAD`, as `RepoPath`/`RepoID` use today. A static test lists every subprocess call in the shim section and fails on any not in the table. (3) Readers never write, never touch the network, never follow a reader input into another reader's job. (4) Paths: inputs are normalised, content is read only after `realpath` containment in a git work tree, symlinks resolve before the test, only regular files are read; a path argument chosen by the agent can therefore make the shim hash a file inside a repository, and nothing else. (5) A reader whose value can contain file or diff content is marked `content` in the table, must run the existing secret scan (`# --- secrets ---`) before returning, withholds a file with a hit (naming pattern and line, never the match), and has a `budget_bytes`. No foundation reader returns content; `file` v1 returns a hash and has no content parameter, and a declaration asking for content from a reader that does not offer it is `bad_params`. (6) Output size: non-bulk readers return at most 64 KiB; a reader above that is declared bulk with `budget_bytes` in `params`, truncates by its own documented rule and states `complete:false` with reasons, or fails with `over_budget`; the shim clamps `budget_bytes` to 8 MiB regardless of the declaration. (7) Before sending, the shim checks the serialized context for the bearer key and replaces the offending reader with `secret_in_context`. (8) No environment variable, hostname, username or other value is sent unless a declared reader's table entry names it.
- Contract, **seam for later plans**: a reader is added by (a) a table entry in `yakka.py` with name, version, param schema and failure codes, (b) a matching entry in `mcp-readers.json`, (c) a server declaration naming it. Plan 22's `session_hint` and Plan 23's `change` use exactly this. An argument-fed reader names the tool arguments it reads in its params (`path_arg` is the pattern; Plan 23's `change` reads `mode`, `view`, `include_untracked`, `base`, `head`, `merge_base`); arguments are untrusted input to the reader, which validates them itself with fixed codes (Plan 23's `bad_ref`), and the server validates them again as tool arguments. A bulk reader is declared with `bulk` and `budget_bytes` (its truncation rule is its owner's, Plan 23's class order for `change`), and the server derives the body cap from the declared budgets (Domain: endpoint). The conformance fixture in Phase 4 exercises this with a test-only argument-fed bulk reader registered through the same seam (including the shim's ceilings on server-supplied numbers), so the seam is proved without implementing either plan's reader.
- Non-goals: file content in v1, Plan 21's `effects`, Plan 22's `session_hint`, Plan 23's `change`, reading environment for the agent, and any reader that a tool can use to run a repository-configured helper.

### Domain: The three tools on the server

- Owns: `list_checks`, `search_artifacts`, `artifact_feedback` as server registry entries. Behaviour reference is the Python implementation, the one the plugin registers (`.mcp.json`, `.codex-mcp.json`); the Go twin in `internal/mcp` is consulted only where it agrees and is not a reference.
- Contract, **`list_checks` and `search_artifacts`**: same names, descriptions, input schemas, `readOnlyHint: true` annotations (`yakka.py:2350-2389`), same validation messages (`kind must be one of design, brief, report`; `query must be a non-empty string`), same output text (`name [levels a/b] [inverted]: q` per check; `no checks loaded on the service`; `kind repo_id:path (rank N)` with the snippet; `no matches`), `search` limit 10, kind filter. They call the functions behind `/v1/checks` and `/v1/search` in process (`reads.go:21-46`, `87-138`, `store/reads.go:133-150`), not the HTTP routes. Declared context: none. Differences, accounted: the client-side failure strings (`service unreachable at ...`, `service refused the request (HTTP n)`, `unusable client config`), which today return `isError:false` tool results, no longer exist as tool results; a transport failure is now the shim's own error (`unreachable`, `unauthorized`, `bad config`), and a server-side failure is a tool error.
- Contract, **`artifact_feedback`**: argument `path`; read scope; read-only on the service (no `ingest.Ingest`, no write, no worker wake); declared context `cwd` (optional: used only to word an error), `resolved_path{path_arg:"path", bases:["cwd"]}`, `file{of:resolved_path}`, `git{of:resolved_path}`, `queue{of:git, path:resolved_path}` and `drain`, the last five required. The base list is `["cwd"]` because that is today's behaviour; Plan 21 changes it to `["project_dir"]` by editing this declaration once its `project_dir` question is answered, which needs no shim change. The server decides everything: path kind (`keys.Kind`, `keys.go:168-186`), the state, the order of checks, the wording. Parity table (Phase 3 fixtures; "same" means the same state and the same text, byte for byte, for the same context):

  | Local situation | Today (`yakka.py`) | After |
  |---|---|---|
  | empty `path`, non-object arguments, path missing, not a regular file, unreadable inside a work tree | tool errors (`path must be a non-empty string`, `arguments must be an object`, `path does not exist: <abs>`, `path is a directory, not a file: <abs>`, `cannot read <abs>`), all before any local read matters | same text, from `validate` and the `file` facts; `cannot resolve the working directory` is the error for a relative path with no usable base (`resolved_path.path` null), worded by the server |
| unreadable file outside any work tree; file over 256 MiB | `cannot read <abs>`; hashed whatever its size | outside a work tree: `not tracked`, the file is never read (D3); over 256 MiB inside one: tool error `file too large to hash: <abs>` (D3, new wording) |
  | outside a work tree (`no_repo`, `outside_repo`, `symlink_out`), `git` missing (`git_unavailable`), not design/brief/report, no commit | `not tracked` with its reasons (a git error or missing git is `not tracked` today) | same states and reasons; the "no commit yet" wording is used only for `git.error = no_commit` (today every `RepoID` error says it) |
  | queue entry for the file, drain running | polls the queue up to 1.5 s, then `queued` ("N events ... oldest Ns, draining"), the age taken after the poll | `queued`, after the server waits up to 1.5 s for the store to hold the file's hash and then answers `delivered` if it does; the age is the probe's age plus the wait |
  | queue entry for the file, no drain running | starts the drain, waits up to 1.5 s, then `queued` or, if it delivered, `delivered` | `queued` at once, with the reason `no drain running` and the fix `yakka drain` (D1) |
  | `rejected/` entry newer than the file | `rejected` + reason lines + "Fix: rewrite the file; the new write is the repair." | same |
  | store has no version, nothing queued | `not delivered` (404 text) | same text |
  | store hash differs from the file | `stale` | same |
  | store hash equals the file | `delivered` + `screen:` line + score lines with baseline, `BELOW p25`, `too few to flag`, `baselines unavailable`, `versions: N`, `note: earlier rejection superseded...` | same, from the store directly |
  | config unresolved, with queued or rejected entries | local `queued`/`rejected`/`bad config` answers from local state | the shim's `bad config` error; no tool answer (D2, Plan 21's rule) |
  | server unreachable | local `queued`/`rejected` plus "service unreachable" | the shim's `unreachable` error with `queued_locally` (D2) |
  | a required reader failed or missing | not possible | tool error `local context unavailable: <reader> (<code>)`; never a state (no false clean) |

  Order of evaluation, the existing one: argument errors; not tracked; queued; rejected; not delivered; stale; delivered. Differences are exactly D1 (no drain kick; the 1.5 s wait moves to the server and applies only while a drain runs), D2 (transport and config failures are the shim's errors; the local-only answers they allowed are gone, as Plan 21 decided), D3 (a file outside a work tree is never read, so an unreadable one is `not tracked`; a file over 256 MiB is refused, not hashed), and the narrowed "no commit yet" wording. Phase 3's fixtures are recorded from the current implementation before it is removed.
- Contract, **instructions**: `instructions` is today's base sentence; each of Plans 21, 22, 23 adds its own sentence through its tool's `instruction` field.
- Non-goals: the scoring-state `scoring:` line, the 10 s pending-screen wait, `enqueue_file_snapshot` and `effects` (Plan 21); `record_action` and `work_cost` (Plan 22); `review_change` (Plan 23); changing any wording not listed above; fixing the baseline-by-path merge across repositories in `store/reads.go:98-121` (parity first, a separate fix).

### Domain: Hooks and the drain (unchanged, kick decided)

- Owns: capture, queue and drain exactly as today; the drain keeps using the one login. The shim and the drain share only the login function and the queue directory layout, which the shim reads and never writes.
- Contract, **who kicks the drain** (the issue's question, decided): hooks. `spool.sh` starts a detached drain after every spooled event (`spool.sh` `kick()`, one at a time, suppressed by `YAKKA_HOOKLOG_KICK=0`), and `SessionStart` and `PostToolUse` run through it for Claude and Codex (`hooks/hooks.json`, `hooks/codex.json`), so a stopped drain restarts at the next hook event of any kind (Cursor's `postToolUse` also goes through it); the `PostToolUse` of the feedback call itself fires after that call has answered, so it helps the repeat call, not the first. The shim's own kick (`_mcp_start_drain`, `yakka.py:1882-1901`) is removed with the rest of the tool code and not replaced. No hook file changes in this design.
- Contract, **what this costs** (D1): a drain is started only when an event is actually spooled (the payload must carry a conversation id), `YAKKA_HOOKLOG` is not off, `YAKKA_HOOKLOG_KICK` is not `0`, and a set `YAKKA_BIN` is executable. Where any of those fails, or hooks do not run, a queued file whose drain is not running stays queued until something starts one; the answer says `no drain running` and gives a harness-neutral fix (a drain starts at the next hook event, or run the plugin's `bin/yakka drain`). That is the only behavioural loss from dropping the shim's kick and is stated, not hidden. Plan 21's open question 6 is where an effect that restores it would be decided.
- Non-goals: any change to `spool.sh`, the drain, the queue format, or the hooks; deleting legacy queues; Plan 21's `artifact_snapshot` entries.

## Architectural Implications

- Stable docs. `docs/design/04-advisory-surface.md` (Shape, `artifact_feedback`, Unreachable service, Registration, Tests) and `docs/design/02-edge-capture.md` (MCP shim) state that the shim holds the tools, reads the queue and answers from local state when the service is down. `docs/design/03-remote-service.md` has no `/v1/mcp` row. This design's commit adds a clearly marked "Proposed by plan 24, not built" note to each, pointing here; Phase 4 rewrites them to describe what exists. `ARCHITECTURE.md` and `OVERVIEW.md` do not mention the shim and are not changed.
- Plan 21 (feedback delivery): P1 and P2 are independent of this design. P3 and P4 need Phases 1-3 here (the registry, `artifact_feedback` on the server) and P3 also needs Phase 4 (the injected context) and an answer to the open question below. Plan 21 owns `Resolve` and the not-logged-in semantics: the shim calls the single login function and uses whatever it returns, so the shim is correct before and after Plan 21 P1 (Phase 4 stubs the function to return Remote, Local and Error). Today `Load()` defaults to loopback local mode when nothing is set (`yakka.py:91`), so "not logged in" is a `bad config` error only after Plan 21 P1; this design neither changes nor pre-empts that. Plan 21's table (`git.top`, `effects`, `project_dir`-only bases) is amended at its own P3 as described in the Local context readers domain.
- Plan 22: P4 depends on Phase 1 (registry and scope; whether `record_action`, which stores a fact, declares `read_write` is Plan 22's declaration to make) and on Phase 4 (`cwd` and `git` readers; its `repo_id` is `git.repo_id`; `session_hint` is registered by Plan 22 through the seam). `work_cost` declares no context. Its REST reads and ingest path are untouched.
- Plan 23: P5 depends on Phases 1 and 4 here. Its four needs map to: (a) declared params and argument-fed readers: the declaration `params` and `path_arg`-style inputs; (b) declared scope: `scope: "read_write"`, enforced and filtered by the registry; (c) a long call: `timeout_s` up to 300 s, no server write timeout, the shim's per-call HTTP timeout; (d) bulk: `bulk`/`budget_bytes` with the derived body cap and `413`. Its `local_actions: []` is represented by the key's absence. The `_local` overwrite is the carrier rule. Plan 23's tool, prompt policy, credential `CLAUDE_API_TOKEN`, the `change` reader and the review run stay entirely in Plan 23.
- #178 (delete the Go client): independent. The new server code imports none of `internal/mcp`, `drain`, `facts`, `clientconfig`; whichever issue lands first, the other is unaffected. `serve/host.go` and the Go `yakka mcp` are untouched here.
- Rollout order: server first (Phases 1-3), shim and plugin after (Phase 4). An old plugin keeps working against the new server (REST unchanged). A new shim against an old server gets `server unsupported` with the fix `update the server`.
- Plugin version: Phase 4 changes the plugin runtime and bumps the version in the same change (`docs/design/05-distribution.md:124`). `serverInfo.version` today reports `bin/VERSION` (0.3.0) while the plugin manifests say 3.4.0; the server reports its own build version, which fixes that mismatch as a side effect, noted here because the parity harness must not compare that field.

## Decisions

Headless: none were taken interactively. Decisions carried in from the issue (all "Direction from Cody (2 Nov)", the rule): the shim only injects auth and local context; all tools and logic live on the server; the declaration of which context to inject is the server's; the drain stays separate with the same login; the shim never falls back from a configured remote to local; #178 is separate. Decided by this design, with the choice and its reversal cost in the ledger: the wire form, the declaration carrier, the closed error and failure vocabularies, scope and Origin handling, budgets, readers, who kicks the drain, the phase cut.

**Now decided narrowly by the appended 7 Nov approval:** the v2 addendum permits only one server-declared reviewed-file-bound enqueue. The base v1 decision and every other local effect restriction remain. See resolved Open Question 1 and the amendment ledger.

## Assumption Ledger

### Assumption 1

- Question: Which MCP transport form does the server speak?
- Answer chosen: Stateless JSON over `POST /v1/mcp`: one message in, one JSON reply out (or `202` for a notification); no SSE, session id, batch or server push.
- Rationale: the shim is the only client, the three tools are request/response, the server has no session store to keep, and a stateless endpoint is trivially retried and trivially compared against direct calls (the issue's done-when). The MCP streamable-HTTP spec permits JSON-only replies.
- If wrong: a tool that must stream progress (Plan 23's two-minute review, if a proxy idle timeout cuts it, open question 3) needs SSE replies; that adds a stream-to-line relay to the shim and a streaming writer to the route, both additive, and Plan 23 Assumption 7 already holds an async fallback.

### Assumption 2

- Question: Where does the server's declaration of local context live, and where do injected values go?
- Answer chosen: Declaration in each tool's `_meta["yakka/tool"]` in `tools/list` (versioned, with a `rev`); values under the reserved `arguments._local` of `tools/call`, which the shim overwrites.
- Rationale: `_meta` is the MCP extension point and ignored by clients that do not know it; the issue asks for a per-tool annotation; `arguments` is the one place a harness model fully controls, so it is the place that must be overwritten, and `_local` is the name Plans 21 and 23 already cite.
- If wrong: if a harness forwards `_meta` to the model (token cost) or drops it, Phase 4 measures that; the fallback is a separate `GET /v1/mcp/declaration` the shim reads, which changes only where the shim learns declarations, not the contract.

### Assumption 3

- Question: Does the shim enumerate the methods it forwards?
- Answer chosen: No. It relays every request and notification and special-cases only `tools/call` (inject) and `tools/list` (read), plus `notifications/cancelled` locally.
- Rationale: an enumerated method list is protocol knowledge the server owns; a method-agnostic relay needs no change when the server adds a method.
- If wrong: a harness that mishandles a relayed unknown-method error would need a local filter; unlikely and additive.

### Assumption 4

- Question: How are local read failures surfaced, and can a handler read a failure as "nothing there"?
- Answer chosen: A failure is injected as `{"_failed":{"code"}}`; the registry turns a failed, missing or undeclared required reader into a tool error before the handler runs; value-level facts (`git.error: no_repo`, `file.exists: false`) are normal values.
- Rationale: the issue says local read failures are reported as injected context; Plan 21 and the brief require no false clean feedback. Doing the check in the registry rather than in each handler makes the safe path the default.
- If wrong: a tool that wants to proceed without a reader marks it `required:false` and handles `Failure`; only the registry default changes.

### Assumption 5

The following records the v1 foundation decision. The 7 Nov bounded approval now authorizes only
the v2 exception in the addendum; it does not retroactively change v1 acceptance evidence.

- Question: Does the foundation include any shim-run effect (drain kick, `enqueue_file_snapshot`)?
- Answer chosen: No. The declaration v1 has no `local_actions` (the registry refuses one), the shim never interprets a reply, and the existing drain kick is dropped. Hooks own the kick because they already start a drain on every spooled event.
- Rationale: the issue's rule is auth plus local context; Plan 21's effect is an unapproved widening (its open question 6), and the brief says not to unblock it by assumption. The shim's current kick is redundant with the hook kick for every harness that runs the hooks.
- If wrong: if Cody approves effects, the extension is a v2 declaration (`local_actions`, a directive reply shape, a fixed action table in the shim) built as its own change; nothing in this design needs to be undone, and the registry's refusal of `local_actions` is the one line that moves.

### Assumption 6

- Question: What does the shim do when `initialize` cannot reach the server?
- Answer chosen: It answers the request with its own `bad config` or `unreachable` error; later requests retry independently.
- Rationale: the shim holds no capabilities or `instructions` and must not invent them; Plan 21 requires only an error naming what failed and the fix.
- If wrong: a harness that marks the server dead after one failed `initialize` loses the tools until restart. Phase 4 records this per harness; the alternative (a synthesized `initialize`) would put protocol content in the shim.

### Assumption 7

- Question: How strict is the shim's transport against key leaks and SSRF?
- Answer chosen: Fixed path on the login's origin only; no redirects followed; the bearer sent only over `https` or to a loopback `http` host; reply bodies never fetched or executed; stderr, logs and context carry no key.
- Rationale: the existing redirect handler forwards the bearer to same-host or subdomain redirects without a scheme check, the server must not be able to steer the shim, and the drain's `http`-with-key leniency should not extend to a new surface.
- If wrong: a deployment using plain `http` to a non-loopback host (an internal network) gets `bad config` from the shim while the drain still works; the one-line rule belongs in Plan 21's `Resolve` for both, and an env opt-out would be the escape.

### Assumption 8

- Question: How does the route authenticate and which tools does a caller see?
- Answer chosen: Bearer only (cookie sessions refused), any `Origin` header refused, tenant and scope from the token, `tools/list` filtered by the caller's scope, a scope shortfall a relayable `-32003`.
- Rationale: a cookie-authenticated JSON POST route invites CSRF, the callers are programs, and keyless loopback mode needs the Origin refusal against DNS rebinding.
- If wrong: a browser-based MCP client would need a cookie or CORS path; none exists in the issue.

### Assumption 9

- Question: Is local mode in scope?
- Answer chosen: Local mode as the login function reports it (today implicit when nothing is configured, `yakka.py:89-91`; explicit once Plan 21's `Resolve` lands) works because the route sits behind the existing auth: a keyless loopback `yakka serve` serves `/v1/mcp` under tenant `local` as it serves REST, and the shim sends no bearer when the login function says Local. The shim cannot tell explicit from implicit local and does not try; it adds no local-mode logic and no other path to local. Until Plan 21 P1, an unconfigured machine therefore gets `unreachable` naming the loopback endpoint (what today's tools say), and `bad config` for a missing login only after P1. Phase 4 does not wait for Plan 21 P1 and is tested against every outcome the login function can return.
- Rationale: existing contracts allow it (design 02, 05; Plan 21 `Resolve`); making the shim agnostic keeps it from silently breaking the shared login or the drain.
- If wrong: none that this design depends on; if loopback keyless serve should not expose MCP, one registry flag would disable the route in local mode.

### Assumption 10

- Question: What leaves the machine, and is the foundation `file` reader a content reader?
- Answer chosen: Per call: the agent's arguments, the declared readers' values, the bearer. `file` returns metadata and a SHA-256 only, only for regular files inside a git work tree after `realpath`; `git` omits the absolute top; absolute `cwd`, `project_dir` and `resolved_path` reach the server transiently and are not logged or stored.
- Rationale: today's feedback sends only `repo_id`, the relative path and a hash; Plan 21 settled "hash, never bytes" (its ledger 16). Absolute paths are the one new egress and the error texts need them.
- If wrong: if even transient absolute paths are unwanted, the server can reword errors with the relative path and the readers drop `path` from `cwd`/`project_dir` values; only wording changes.

### Assumption 11

- Question: Default numbers.
- Answer chosen: body 256 KiB default, 8 MiB ceiling; call 20 s default, 300 s ceiling; shim call timeout `timeout_s` + 5 s; connect 5 s; reader 5 s, set 10 s; 8 concurrent requests; reply cap 8 MiB; 50 queue entries; 64 KiB per non-bulk reader.
- Rationale: the REST ingest cap is 16 MiB and the batch cap in the drain 8 MiB; MCP bodies are small except Plan 23's bulk class, which derives its own cap; the current shim uses 3 s reads, which a handler waiting on a screen (Plan 21's 10 s) already exceeds.
- If wrong: all are constants in one place per side; changing them changes no contract.

### Assumption 12

- Question: What is the behaviour reference for parity, and which differences are accepted?
- Answer chosen: The Python implementation registered by the plugin. Accepted differences: D1 (no kick; the wait applies only while a drain runs), D2 (transport and config failures are the shim's errors, no local-only answers), the narrowed "no commit yet" wording, and the loss of `isError:false` tool results for service failures.
- Rationale: these follow the issue ("not logged in ... never falls back") and Plan 21's decisions; each is a row in Phase 3's table so none is silent.
- If wrong: if D2's loss of local `queued`/`rejected` answers when the server is down matters, the fix is a documented shim-side local summary, which the rule forbids; the only compliant route is the `queued_locally` count in the error.

### Assumption 13

- Question: How is "yakka.py holds no tool names, descriptions, schemas or wording" tested?
- Answer chosen: A Python test that (a) fails on any registry tool name, any distinct line of the recorded corpus (Phase 2-3 fixtures, 12+ characters), or any `inputSchema`/`description`/`instructions` literal in `yakka.py`, with a mutation check that it fails on a planted tool name; (b) runs the shim against a fake server serving a tool the shim has never seen and checks the declared readers and the relay.
- Rationale: a denylist alone is gameable, the second test proves genericness behaviourally; the corpus makes the wording check follow the server's real outputs.
- If wrong: a clever restatement of a tool's wording passes (a); (b) still shows the shim does not need it.

### Assumption 14

- Question: Phase cut.
- Answer chosen: Four phases: the server endpoint and registry; the two stateless tools; `artifact_feedback`; the shim cutover with readers, guard and docs. The shim is replaced in one phase because a migration's outcome is the behaviour on the migrated shape.
- Rationale: phases 2 and 3 are independent after 1 and each is provable by direct authenticated calls; the shim can only cut over when all three tools exist on the server.
- If wrong: Phase 4 is the large one (refine should split it into units along transport, readers, guard and docs); if it proves too large it is split into a design-intent doc plus designs, not extended here.

### Assumption 15

- Question: Do dependent plans' names survive?
- Answer chosen: Yes. `_local`, `cwd`, `project_dir`, `resolved_path`, `file`, `git`, `queue`, `drain` as in Plan 21's table (with `git.top` dropped); Plan 22's `repo_id` is `git.repo_id`; Plan 23's `local_actions: []` is the key's absence; `effects` and `local_actions` are reserved and refused until the extension question is answered.
- Rationale: dependent plans cite these seams; renaming would reopen three designs.
- If wrong: a rename is a declaration change plus a table entry, not a contract change.

### Assumption 16

- Question: In what order does the registry check a call, so a local read failure cannot hide an argument error or become a false state?
- Answer chosen: authentication, scope, `_rev`, the tool's `validate` (arguments only), the required-reader gate, the handler. Readers return facts, not failures, for unusable-but-legitimate input (empty path, missing file, not a repository); `cwd` is optional for `artifact_feedback`.
- Rationale: today's `feedback()` reports `path must be a non-empty string` before touching anything, and reports a dead working directory only for a relative path; the gate placed first would change both.
- If wrong: a tool that wants the gate earlier can declare no `validate`; only that tool changes.

### Assumption 17

- Question: What happens when the server's declaration is newer than the shim reads?
- Answer chosen: The shim sends `Yakka-Context: <v>`; the server serves no declaration newer than that and omits a tool that exists only at a newer `v`; the shim's `unsupported_declaration` is only the backstop.
- Rationale: a server-first rollout must not turn a future `v:2` into a deploy-time outage of every tool for every old plugin.
- If wrong: with no version header at all the server would have to guess; the header is the contract.

### Assumption 18

- Question: How much of the server's declaration does the shim believe?
- Answer chosen: Only within the shim's own ceilings: `timeout_s` clamped to 300, `budget_bytes` above 8 MiB and out-of-range params refused as `bad_params`, reader time 5 s each and 10 s in all.
- Rationale: the design treats the server as a single point of compromise for every logged-in machine; a hostile or buggy declaration must not make the shim read or send unbounded data or hang a call. Registration-time ceilings on the server alone do not protect a client.
- If wrong: a legitimate larger bulk reader (Plan 23) needs a plugin release to raise a constant; that is deliberate.

### Assumption 19

- Question: Which differences from today are accepted beyond D1 and D2?
- Answer chosen: D3: a file outside any git work tree is never read, so an unreadable one answers `not tracked` instead of `cannot read`; a file over 256 MiB is refused with `file too large to hash` instead of being read whole. The `queue` matching and `age` semantics are kept except that the age includes the server's wait.
- Rationale: hashing is the one local read an agent-chosen path can trigger, so it is limited to files inside a repository, and an unbounded read has no use for scored design, brief and report files.
- If wrong: raise or remove the size ceiling, or hash outside work trees; the reader is the only place that changes, and the parity row is updated.

## Open Questions

1. **Resolved by the 7 Nov 2026, 7:22 PM AEST approval:** one server-declared, reviewed-file-bound
   `enqueue_file_snapshot` is authorized by the v2 addendum above. No general local effect is
   permitted. Plan 21 P3 Part 2 selects A and still requires the extension's implementation and
   verification; P1/P2 remain independent, P4 is independent of the effect, P5 retains its own
   dependencies, and P6/P7 transitively require P3 closure. Nothing is unblocked by choice alone.

2. Do Claude Code, Codex and Cursor tolerate `_meta["yakka/tool"]` in `tools/list` without sending it to the model, and what does each do after a failed `initialize`? Measured in Phase 4; blocks nothing earlier. Fallback in Assumptions 2 and 6.
3. Does the Fly proxy idle timeout (not set in `fly.toml`; community reports of roughly 60 s are unverified), the Cloudflare edge in front of `api.yakka.build` (`yakka.py:1150`; its proxy read timeout is not in the repo and not verified here), or any harness's MCP tool timeout cut a call over a minute? Blocks only Plan 23's smoke evidence. The route and shim support `timeout_s` up to 300 s, which may exceed what the edge allows; the shim maps an intermediary's `504`/`524` to `timeout`, and the SSE or async fallbacks are Assumption 1's.
4. Does Codex (and Claude Code) expose the project directory to a stdio MCP server? Plan 21's open question 1. `project_dir` returns `null` until answered; `bases:["cwd"]` is today's behaviour; nothing here waits on it.
5. Where does the https-only rule for the bearer live for both drain and shim: Plan 21's `Resolve`? This design enforces it in the shim only (Assumption 7).

## Phases

Order and count fixed at sign-off. Phases 2 and 3 can be built in either order after Phase 1. Nothing here deploys, edits production configuration, or runs a paid trial.

### Phase 1 — Server MCP endpoint and tool registry

- Outcome: Against a keyed test server (two tenants, a `read` and a `read_write` key each) and a keyless loopback server, with a conformance registry the test registers (no product tools): (1) `POST /v1/mcp` `initialize` echoes a supported client `protocolVersion` or answers `2025-11-25`, returns `capabilities {"tools":{"listChanged":false}}`, `serverInfo.name` `yakka`, and `instructions` composed in registry order from the tools the caller's scope can call (a `read` key's `instructions` omits a `read_write` tool's sentence); `ping` returns `{}`; an unknown method with an id is `-32601`; a notification is `202` with no body; invalid JSON is `-32700` with a null id; an array body is `-32600`; `GET` is `405` with `Allow: POST`. (2) `tools/list` returns name, description, schema, annotations and `_meta["yakka/tool"]` (`v`, `rev`, `scope`, `timeout_s`, `context`), lists a `read_write` tool only for the `read_write` key, changes `rev` when the declaration changes, and leaves out a tool that exists only at a declaration `v` above the request's `Yakka-Context` value (a conformance tool registered at `v:2`). (3) `tools/call` with tenant A's key reaches the handler with tenant A, and tenant B's key sending the same `_local` and arguments reads only tenant B's data (a conformance tool reading the tenant store). (4) No key is `401` with the REST error body; a cookie-only request is `401`; a request with an `Origin` header is `403`; a mismatched `?tenant=` is `401`; a `read` key calling a `read_write` tool gets `-32003` with `insufficient_scope`; keyless loopback accepts every scope. (5) `_local` is stripped before the handler sees `arguments`; a failing `validate` answers its argument error even when a required reader also failed; otherwise a required reader that is failed, missing, or not declared gives the tool error `local context unavailable: ...` and the handler does not run; a stale `_rev` gives `-32010` with no handler run. (6) A body over the default cap is `413` and nothing runs; a tool declaring a bulk budget accepts a body above the default cap up to its derived cap and `413`s above it, after parsing; a body over the ceiling is `413` at read; an unauthenticated request is refused without its body being read. (7) A handler slower than `timeout_s` is cancelled and answers `timeout after <n> s`; a client disconnect cancels the handler's context (the test handler records it). (8) Registration refuses, at server start, a duplicate tool name, a reader absent from `mcp-readers.json`, a reader declared before its dependency, a non-empty `local_actions`, a `timeout_s` above the ceiling, and a bulk total above the body ceiling. (9) Captured server logs for a call hold method, tool name, tenant id, status and duration and contain neither the arguments, `_local`, nor the token. (10) The existing Go suite passes with REST unchanged. (11) `docs/design/03`'s note for `POST /v1/mcp` is rewritten to describe the route as existing, with no client using it until Phase 4.
- Surfaces: `packages/yakka/internal/serve/serve.go:485-529` (route), `session.go:291-313` (`authorizeRequest`, reused), new `internal/serve/mcp*.go` (route, registry, declaration, accessor), `packages/yakka/internal/serve/testdata/mcp-readers.json`, `serve_test.go` helpers (`newServer`, `remoteIssueToken`, `do`), `docs/design/03-remote-service.md` (the API table's proposal note).
- Approach: known
- Depends on: nothing

### Phase 2 — `list_checks` and `search_artifacts` on the server

- Outcome: A characterization corpus is recorded first, from the current Python `yakka mcp` driven over the existing `test_mcp.py` fixtures (every tool, every argument error, empty and populated results), and committed. Then a direct authenticated `tools/list` returns entries for the two tools whose name, description, schema and annotations equal `_MCP_TOOL_LIST`'s, `initialize`'s `instructions` contains the current sentence verbatim, and each corpus call sent to `POST /v1/mcp` returns the same `content[0].text` and `isError` as recorded for the success and argument-error cases; the text also equals what the REST body for the same query formats to, because both read the same store functions (a test asserts the equality, no HTTP self-call); a cross-tenant check shows a `search_artifacts` call sees only the caller's tenant; the two tools declare no context and a call carrying `_local` is unaffected. The only recorded differences are the client-side failure strings, listed in the corpus README.
- Surfaces: `internal/serve/reads.go:21-46,87-138`, `internal/store/reads.go:133-150`, the registry from Phase 1, `plugins/yakka/client/yakka.py:1845-1849,2200-2250,2330-2389` and `test_mcp.py` (read as the reference, not edited), the corpus under `packages/yakka/internal/serve/testdata/mcp-golden/`.
- Approach: known
- Depends on: Phase 1

### Phase 3 — `artifact_feedback` on the server

- Outcome: A direct authenticated `tools/call artifact_feedback` whose `_local` carries the values the current shim reads for each local situation in the parity table returns the same state and the same text as the current implementation recorded for that situation, for every row marked "same", including all `screen:` and score lines and the argument errors raised before any reader matters; the rows D1 (queued with no drain running: `queued` at once, reason `no drain running`, fix `yakka drain`; queued with a drain running: waits up to 1.5 s for the store to hold the hash, then `delivered` if it does) and D2 (the config and unreachable cases) are asserted as written in the table; D3 is asserted as written (an unreadable file outside a work tree and a file over 256 MiB, by `file` claims); the narrowed "no commit yet" wording appears only for `git.error: no_commit`; a failed, missing or undeclared required reader (`queue` failed, `git` failed, `file` missing) is a tool error naming the reader and never a state, so a failed `queue` read cannot produce `delivered`; a `read` key reaches the tool and gets a state; the handler makes no `ingest.Ingest` call and no write (a recording store shows none); `tools/list` shows `readOnlyHint: true` and the declaration with its readers (`cwd` optional; `resolved_path`, `file`, `git`, `queue`, `drain` required) and `bases:["cwd"]`; a claim naming tenant A's `(repo_id, rel_path)` made with tenant B's key reads only tenant B's store; a server log capture holds no path or hash from `_local`. Fixtures are recorded from the current implementation before it is removed.
- Surfaces: `internal/store/store.go:929-992` (artifact read), `serve.go:762-791`, `reads.go:48-85` (baseline math, kept as is), `internal/keys/keys.go:168-186` (`Kind`), the registry from Phase 1, `plugins/yakka/client/yakka.py:1967-2200` and `test_mcp.py:362-548` (reference), the parity fixtures under `testdata/mcp-golden/`.
- Approach: known
- Depends on: Phase 1

### Phase 4 — The thin shim, its readers, and the guard

- Outcome: With the server of Phases 1-3 and `.mcp.json`/`.codex-mcp.json` unchanged, `yakka mcp` is the shim and the old `# --- mcp ---` tool code is gone. (1) Parity harness: for `initialize`, `tools/list` and every Phase 2-3 corpus call, the `result` the shim writes equals, byte for byte after the `id`, the reply of a direct authenticated `POST /v1/mcp` carrying the same `_local` the shim computed (`serverInfo.version` is compared as equal because both come from the server). (1b) Situation parity: each local situation of Phase 3's parity table is built on disk (a temporary repository, queue directory with entries and `.reason` files, a held `.drain.lock`, symlinks, a missing file) and run through the real shim against the Phase 3 server, and the text for every row marked "same" equals the text recorded from the old implementation, so a reader bug (a wrong `rel_path`, mtime unit or queue match) cannot pass because the relay is faithful. (2) A fake server serving a tool the shim has never seen, with declared readers, shows: `tools/list` relayed verbatim; declared readers injected under `_local` with `_v` and `_rev`; an agent-supplied `_local` overwritten, or removed when no context is declared; an unknown reader, a higher reader version and a higher declaration `v` each injected as `_failed` with the codes above; a `-32010` answered by one `tools/list` refresh and one retry. (3) Each own error is produced and relayed with the harness's `id`, with the fix in `message`: with the login function stubbed to return Error the shim answers `bad config` carrying its text and sends nothing, and stubbed to Local or Remote it forwards (no key sent for Local); partial env gives `bad config`; a dead endpoint gives `unreachable` with `queued_locally` equal to the pending count and no other queue detail; `401` gives `unauthorized`; a `3xx` gives `redirect refused` and a listener on the target records no request carrying the key; `404` gives `server unsupported`; a server slower than `timeout_s` + 5 s, and a `504` or `524`, give `timeout`; a non-JSON-RPC body gives `bad reply`; `http://` to a non-loopback host with a key gives `bad config`; with a remote configured and down, a listener on `127.0.0.1:8770` records no connection. (4) Concurrency and cancellation: a 3 s call does not delay a concurrent `ping`; `notifications/cancelled` closes the in-flight connection (the server's handler context is cancelled) and no reply is written; stdin EOF exits. (5) Reader safety: a symlink inside a repository pointing outside withholds the hash (`symlink_out`); a file outside any work tree reports `outside_repo`; the injected context for `artifact_feedback` contains no file bytes, no queue payload and no path of another file; a context containing the bearer is replaced by `secret_in_context`; captured stdout, stderr and injected context from every test contain no key; a static test finds every subprocess call in the shim section inside the fixed argv table with no shell; the shim starts no drain (no process other than the readers' `git` runs, and the hooks, `spool.sh` and the drain are byte-identical to before). (6) Seam proof: a test-only, argument-fed, bulk reader registered through the reader-table seam, with server-supplied `budget_bytes`, is evaluated from tool arguments, returns `complete:false` with reasons when over budget and `over_budget` when it cannot truncate, and its body passes the server's derived cap; a declaration with `budget_bytes` above 8 MiB or an out-of-range param is `bad_params`, and a `timeout_s` of 100000 is clamped to 300. (7) The guard test fails on a planted tool name, a planted corpus line or a planted schema literal in `yakka.py`, and passes on the shipped file; `plugins/yakka/client/test_mcp.py` no longer holds tool-wording tests. (8) In a real Claude Code session `tools/list` loads and an `artifact_feedback` call completes through the shim; whether the harness shows `_meta` to the model (observed by asking the model to recite the tool's fields), the Codex and Cursor results, and each harness's behaviour after a failed `initialize` are recorded as observations, not gates. (9) Docs 02 and 04 describe the shim as built; the plugin version is bumped.
- Surfaces: `plugins/yakka/client/yakka.py` `# --- mcp ---` (1840-2513, replaced), the HTTP helpers it reuses (`_request_base` 1061, `_bearer_header` 1049, `_shown_endpoint` 1090; the redirect handler 1122-1134 is not used for the shim), `Load()` (77) as the login function, `RepoID`/`RepoPath` (233, 261) and the drain's queue path function (`_write_paths` 695) for the readers, `# --- secrets ---` (311) for content readers, `plugins/yakka/client/test_mcp.py`, a new shim test file and guard, `packages/yakka/internal/serve/testdata/mcp-readers.json`, `plugins/yakka/.claude-plugin/plugin.json` and its Cursor and Codex siblings (version), `docs/design/02-edge-capture.md`, `04-advisory-surface.md`; the existing no-redirect opener (`_NO_REDIRECT`, 1137-1168) is used for the shim.
- Approach: known (harness behaviour in clause 8 is observed, not designed)
- Depends on: Phases 1, 2 and 3

## Provenance Notes

- **Why one endpoint and a registry, not three REST-shaped handlers.** The three plans add tools at a steady rate (Plan 21 changes one, Plan 22 adds two, Plan 23 adds one). A registry entry is a declaration plus a handler; the protocol, scope, budget and trust rules are written once, and the issue's "tools/list through yakka mcp matches the server" is true by construction because the shim does not author it.
- **Why the v1 registry refuses `local_actions` rather than ignoring it.** An ignored key would let Plan 21's effect arrive as "plumbing" with no decision. A refusal is a visible gate that the extension decision (Open Question 1) must open deliberately, with `v: 2`.
- **Why `_local` lives in `arguments`.** The agent controls `arguments`, so spoofing happens there and the overwrite belongs there; a side channel (`params._meta`) would be safer from the model but is not what Plans 21 and 23 already cite, and the server does not trust either place.
- **Why the registry enforces required readers.** Plan 21's no-false-clean rule is easy to break in one handler and hard to audit across several; one check before the handler turns it into a property of the registry.
- **Why the stale-declaration retry exists.** Without `_rev` a shim holding a declaration cache from before a server deploy injects the old reader list; the registry then sees a missing required reader and fails every call until the harness restarts the shim. One `-32010`, one `tools/list` refresh and one retry is the smallest mechanism that closes that.
- **Rejected: a local-mode shortcut in the shim** (answering from the queue when the server is down). It is the behaviour the issue and Plan 21 remove, and it needs wording in the shim. The `queued_locally` count is a fact in an error, not an answer.
- **Rejected: porting the Go shim.** #178 deletes it; its feedback logic is consulted, not depended on.
- **Rejected: letting a declaration carry a command, path or URL for the shim to run.** The server is remote, shared and a single point of compromise for every logged-in machine; the reader table is the capability allowlist, and it can only grow by shipping a plugin.
- **Rejected: client-side argument validation or schema checks "for speed".** The server validates; the shim has no schema. An invalid call costs one round trip.
- **What a build must not infer from this document:** that effects beyond the explicitly approved v2 bounded enqueue are approved, that `project_dir` is available on any harness, that a deployment or secret exists, or that any behaviour here is deployed. Nothing here is.
- **Recon limits.** Facts come from reading code and a Haiku recon pass, not from running it. Not read: `test_drain.py`, `test_login.py`, `test_status.py`, the hooks' producer details beyond `spool.sh`'s kick, the Go `internal/mcp` tests. Fly's proxy timeout is not in the repo.
