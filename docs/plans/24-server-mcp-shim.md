# Server-defined MCP: the yakka.py shim becomes a thin wrapper

Plan 24 moved every MCP tool definition, schema, description, instruction string, argument check and
result wording out of the Python shim in `plugins/yakka/client/yakka.py` and onto a stateless
`POST /v1/mcp` endpoint on the Go server. The shim now injects the bearer key and the local context a
server declares for a call, then relays replies unchanged. The three shipped tools (`list_checks`,
`search_artifacts`, `artifact_feedback`) are served from the server's tool registry. For the read-only v1
contract, a 23-request corpus matched byte for byte against the live product server, and the terminal
review passed. The bounded `enqueue_file_snapshot` action was approved on 7 Nov 2026 and is specified in
the design, but its server side is not built, so Plan 21's P3 cannot close until it is. The
harness-behaviour observations (`_meta` visibility, behaviour after a failed `initialize`) were not
collected.

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

## Why This Existed

The shim was a second MCP surface. Its tool list, schemas, instructions and feedback states lived in
`yakka.py`, a copy of what the server already knew, so each new tool meant a plugin release and wording
that could drift from the server. The server had REST only. Plans 21 and 22 both add tools and depend
on the shim holding no logic.

## What Was Built

The wire contract is in [design 8](../design/08-server-mcp-contract.md). The plan's own design is
superseded by that document for everything that outlives this change.

**Changed:** `packages/yakka/internal/serve/` (the `/v1/mcp` route, the registry, the three tools, the
test-only conformance registry, `testdata/mcp-readers.json`, `testdata/mcp-golden/`),
`packages/yakka/cmd/yakka/main.go` (registers the shipped tools), `plugins/yakka/client/yakka.py` (the
`# --- mcp ---` section replaced by transport, reader table and the one enqueue action),
`plugins/yakka/script/spool.sh` (opt-in `YAKKA_SPOOL_PRINT=1` acknowledgment, hook stdout unchanged),
`plugins/yakka/client/test_mcp.py`, new `test_mcp_shim.py` and `test_mcp_guard.py`, `docs/design/02`,
`03` and `04` (describe the boundary as built), new `docs/design/08`, and the three plugin manifests.

### Phase 1 — Server MCP endpoint and registry

Stateless `POST /v1/mcp` with bearer-only authentication shared with REST. A cookie-only request is 401
and an `Origin` header is 403. Scope comes from the credential, enforced by the registry before the
handler. The registry runs authentication, scope, the `_rev` check, argument validation, the required-reader
gate, then the handler, and it strips `_local` from `arguments`. It also enforces body budgets, per-tool
deadlines, cancellation on client disconnect, and call logs that hold no arguments, `_local` or token.
Registration rejects duplicate names, unknown readers, bad dependency order, any `local_actions` in v1,
and over-ceiling values. Unit commit `dba4dd9`. The first worker pass was incomplete, and a retry on the
next model tier completed it.

### Phase 2 — `list_checks` and `search_artifacts` on the server

Both tools are server-owned, with empty context declarations. A characterization corpus recorded from
the Python shim was committed first (`8f91f4b`). Each corpus call on `POST /v1/mcp` matches the recorded
text, and populated search matches the REST formatting of the same store. Cross-tenant search sees only
the caller's tenant.

### Phase 3 — `artifact_feedback` on the server

Server-owned, read scope, `readOnlyHint` true. The handler reads the tenant's artifact and baseline data
directly and produces the feedback states, screen and score lines, queue and rejection details, and the
bounded wait for a running drain. The handler performs no ingest, no store write, no worker wake and no
queue effect. A failed or missing required reader is a tool error, never a state.

### Phase 4 — The thin shim, its readers, and the guard

Four units: transport (`eba14b3`), local readers and bounded enqueue (`b81e77f`), conformance and guard
(`41f672b`), docs and release (`eeb787b`).

- **Shim.** Relays every message to the endpoint without naming a method. It writes `_local` on
  `tools/call` only. It caches declarations from `tools/list`, performs one refresh-and-retry on
  `-32010`, and answers with a closed set of its own errors. It refuses redirects, sends the bearer only
  over https or loopback http, and handles cancellation and EOF. It starts no drain.
- **Readers.** `cwd`, `project_dir`, `resolved_path`, `file`, `git`, `queue` (v2 with complete coverage
  facts), and `drain`. A secret scrub replaces any value containing the bearer.
- **Bounded enqueue.** The `enqueue_file_snapshot` directive, its continuation with `effects`, and the
  fixed `spool.sh` entry point, all implemented in the shim and exercised against a compatible fake
  server only.
- **Guard.** A static test fails on tool names, corpus text or schema literals in `yakka.py`, and checks
  every subprocess call against the fixed argv table.

Phase 4 verification: 23 corpus requests (`initialize`, `tools/list`, and every Phase 2–3 call) went
through the Python shim to the live Go product server, and each reply matched a direct authenticated
call byte for byte. Ten Python relay and guard tests passed, the Go MCP conformance tests passed, and
`py_compile` and `git diff --check` passed.

## Deviations

- **The approved v2 action is not in the product server.** The shim side is built and smoke-tested
  against a compatible fake server. The live server is v1: it advertises no `local_actions`, emits no
  `-32011` directive, and refuses a non-empty `local_actions` at registration. Plan 21's P3 needs this
  extension verified at a new exact SHA before it can close.
- **The spool acknowledgment surface was added.** The design referenced a spool path that is not the
  installed one, so the brief was amended before the unit ran. The installed script is
  `plugins/yakka/script/spool.sh`, and the acknowledgment is opt-in, so hook stdout is unchanged by default.
- **Harness observations were not collected.** Claude Code, Codex and Cursor `_meta` visibility, and their
  behaviour after a failed `initialize`, were unavailable in this environment. The design makes these
  non-gating observations, not implementation claims.
- **The relay unit tests use a local authenticated HTTP fixture.** The live check against the Go server
  is the separate 23-request run above.

## Review

- Design-stage review at `e659fd9`: PASS. One low finding, unlinked notes in `04-advisory-surface.md`,
  was resolved in review. Its follow-up, open question 1 (the local effect), was resolved on 7 Nov 2026.
- Terminal review at `086aaab`: PASS, with no blocker or high finding. One low finding was filed as
  [#196](https://github.com/codyhamilton/yakka/issues/196): the committed coverage does not exercise the
  v2 directive and continuation flow or its failure outcomes end to end. The relay corpus suite also uses
  a protocol fixture rather than the product server.

## QA

No separate QA stage ran. The verification is the phase checks above and the terminal review. Go tests
(`go test ./...`) passed in each server phase, with 16 packages in the last run. The Python suite
(`python3 -m unittest test_mcp test_mcp_guard`) passed 10 tests. The repository's layout test was not run
(see Residual Risks).

## Residual Risks

- **The v2 server side is unbuilt.** Plan 21's P3, and P6 and P7 through it, cannot close until the server
  implements the declaration, the capability advertisement, the `-32011` directive and its continuation.
- **Open questions 2–5** are unresolved, and each is recorded with its location in design 8:
  harness tolerance of `_meta` and failed `initialize` (2); whether an edge timeout cuts calls longer than
  about a minute (3); whether a harness exposes the project directory (4); and where the https-only bearer
  rule should live (5).
- **Harness behaviour is unverified** for Claude Code, Codex and Cursor.
- **Long calls are untested end to end.** The shim accepts `timeout_s` up to 300 s, but the Fly and
  Cloudflare intermediaries' limits are unknown.
- **No deterministic `LatestScores` failure fixture exists.** The `baselines unavailable` fallback is kept,
  but only ordinary baseline formatting is tested.
- **A pre-existing layout test fails for reasons unrelated to this plan.** It is recorded in the design. It
  was not run or investigated here.

## Follow-ups

- [#196](https://github.com/codyhamilton/yakka/issues/196): cover the v2 directive and continuation
  failures in shim integration tests against the product server.
- The v2 server side of `enqueue_file_snapshot`. Recorded in design 8 under Bounded enqueue. No GitHub issue
  was filed for it. Verify it at a new exact SHA before Plan 21 P3.
- Open questions 2–5 are recorded in design 8 under Open questions.
- Plan 22's `DESIGN.md` (lines 37 and 148) still describes the endpoint and shim as not built. Its link
  path has been updated, and the wording is left for Plan 22's own refine.

## Decisions Worth Keeping

- **One endpoint and a registry, not REST-shaped handlers per tool.** Adding a tool is a declaration plus a
  handler. The protocol, scope, budget and trust rules are written once.
- **The reader table is the capability allowlist.** A declaration selects among readers with constant
  params. It cannot name a command, path, URL or script, because a single compromised declaration would
  reach every logged-in machine.
- **`_local` lives in `arguments`, and the shim overwrites it.** The agent controls `arguments`, so the
  overwrite belongs there. The server trusts neither `_local` nor `arguments` for identity or authorization.
- **The registry enforces required readers before the handler runs.** One check makes "a failed read is
  never a clean state" a property of the registry, not of each handler.
- **The v1 registry refuses `local_actions` rather than ignoring it.** An ignored key would let the local
  effect arrive as plumbing without a decision.
- **Hooks own the drain kick.** The shim has no drain launcher and no kick policy, so the drain's start is
  unchanged from before.
- **No fallback from remote to local.** When a remote is configured and unreachable, the shim answers with
  its own error and does not answer from the local queue.
