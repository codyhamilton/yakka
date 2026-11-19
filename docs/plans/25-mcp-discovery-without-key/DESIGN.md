# MCP discovery without a key

Yakka-Plan: docs/plans/25-mcp-discovery-without-key/

## Intent

User request, verbatim:

> You are drafting a signed-off-quality implementation plan (DESIGN.md style) for the yakka monorepo at /agent/repos/yakka.
>
> ## Problem (from parent conversation)
>
> Cursor Cloud Agents fail Yakka MCP live tool discovery because:
> 1. Plugin MCP subprocess often lacks YAKKA_ENDPOINT/YAKKA_KEY; no client.toml on worker.
> 2. Client `Load()` falls back to `http://127.0.0.1:8770` when no file/env (wrong on cloud).
> 3. Production server requires bearer auth for ALL MCP methods including `initialize` and `tools/list` (`mcpAuth` in packages/yakka/internal/serve/mcp.go).
> 4. Partial env (only endpoint or only key) raises `ErrPartialEnv`.
>
> ## Desired direction (user-approved intent)
>
> 1. **Default remote endpoint** `https://api.yakka.build` when not overriding (login already has `DefaultEndpoint`). `YAKKA_ENDPOINT` only when overriding.
> 2. **Missing key must not block MCP tool discovery** — Cursor should get tools/list without secrets in MCP child env.
> 3. **Keep drain strict** — ingest still requires login; do not silently post without key.
> 4. Split or scope resolution so MCP shim can discover keylessly while drain/login/status stay honest.
>
> ## Your task
>
> 1. Read relevant code and existing plans:
>    - plugins/yakka/client/yakka.py: Load(), ErrPartialEnv, cmd_mcp, _McpRelay._post
>    - packages/yakka/internal/serve/mcp.go: mcpAuth, mcpList, mcpInitialize
>    - packages/yakka/internal/serve/session.go: authorizeBearer
>    - docs/plans/21-feedback-delivery.md: Resolve contract (conflict to resolve explicitly)
>    - docs/plans/24-server-mcp-shim.md, docs/design/08-server-mcp-contract.md if present
>    - plugins/yakka/.cursor-mcp.json
>
> 2. Pick next plan folder number by listing docs/plans/ and choosing unused NN.
>
> 3. Write a complete plan document to `docs/plans/<NN>-mcp-discovery-without-key/DESIGN.md` following yakka design conventions from plugins/yakka/skills/design/SKILL.md (read that file first):
>    - Problem statement
>    - Domains with contracts
>    - Phases with provable outcomes (verification commands/tests)
>    - Assumption ledger / decisions reconciling Plan 21
>    - Security notes for anonymous tools/list (what is exposed, rate limits if any)
>    - Client vs server phase ordering (server first or parallel)
>    - Explicit non-goals
>    - Yakka-Plan marker line for future PR
>
> 4. Keep scope minimal — no unrelated Plan 22/23 work.
>
> 5. Return to parent: plan path, suggested phase count, one-paragraph summary, and any blocking open questions you left in the ledger.
>
> Do NOT implement code — design only. Create the directory and DESIGN.md file on disk in the repo.

## Problem

Cursor's live tool discovery starts `python3 ./client/yakka.py mcp` from `plugins/yakka/mcp.json` with `cwd` set to the plugin root and with no `env` block. On a Cloud Agent worker there is often no `~/.config/yakka/client.toml` and no `YAKKA_ENDPOINT` / `YAKKA_KEY` in that child. Discovery then dies before Cursor can show tools. Four facts in the tree at `0a206ccddef4540f9b5a47e981ba2d493ba0bbd0` produce that:

1. **The shim's only login is `Load()`, and a missing file is loopback.** `Load()` in `plugins/yakka/client/yakka.py` returns `http://127.0.0.1:8770` with `Local` set when neither env var is set and `client.toml` is absent. `_McpRelay._post` calls `Load()` on every forward, including `initialize` and `tools/list`. The worker then dials a server that is not there. `yakka login` already defaults with `DefaultEndpoint = "https://api.yakka.build"` inside `resolve_endpoint`, and that default is not used by `Load()` or by the shim.
2. **One env var aborts the shim.** If exactly one of `YAKKA_ENDPOINT` and `YAKKA_KEY` is set, `Load()` raises `ErrPartialEnv` and does not read `client.toml`. `_post` turns that into the shim error `bad config`. Cursor marks the server failed.
3. **The production MCP route demands a bearer before it knows the method.** `mcpAuth` calls `authorizeBearer` for every `POST /v1/mcp`. On a non-local server a missing bearer is HTTP 401 with the REST error body, and the handler returns before `initialize`, `ping`, `tools/list`, or `tools/call`. Design 8 states the same rule: a missing or bad credential is 401, and authentication precedes any body read. A keyless shim that did reach `https://api.yakka.build` would still fail discovery.
4. **A failed `initialize` fails the server, not one call.** The shim holds no tool list. It relays the server's `initialize` and `tools/list` or it answers with `bad config` / `unauthorized` / `unreachable`. Cursor's discovery is those two methods. `tools/call` is a later, separate request.

Drain must stay on the strict login. `ConfigSink` and `RunStandalone` call `Load()`. Partial env exits the drain before a request. A missing file still builds an `HTTPSink` aimed at loopback with an empty key, which does not post to `https://api.yakka.build`. `POST /v1/ingest` on a non-local server still requires a `read_write` bearer. This plan keeps that. It does not point the drain at the default origin when no key exists.

Plan 21's Client configuration domain conflicts with the approved direction and is reconciled under Decisions. Its `Resolve` result is one of remote, explicit local, or error, shared by the shim, the drain, and status. Nothing configured is the error "yakka is not logged in". Exactly one env var is an error. That contract is a design; `Load()` on this tree is still the loopback fallback above. Plan 21 phase 1 has not replaced it.

`plugins/yakka/.cursor-mcp.json` is gone on this commit. Cursor's manifest is `plugins/yakka/mcp.json`. It still passes no endpoint and no key, which is what discovery has to tolerate.

## Solution Shape

The MCP route on a non-local server answers `initialize`, `ping`, `tools/list`, and notifications with no bearer, listing and instructing exactly the tools a `read` credential would see, and it answers `tools/call` with 401 without running a handler. The shim resolves its own endpoint and key: `https://api.yakka.build` when nothing overrides the endpoint, a bearer only when a key is actually present, and no `ErrPartialEnv`. Drain, login, and the drain half of status keep today's `Load()` and `resolve_endpoint`. Status also prints the shim's target so a loopback drain line is not the only account of where MCP goes.

### Domain: Server discovery gate

- Owns: which `POST /v1/mcp` methods a non-local server accepts without a bearer; the catalog and `instructions` those methods return; the anonymous request budget; the guarantee that no tool handler, tenant, or store read runs on that path. `authorizeBearer`, `POST /v1/ingest`, and every non-MCP route stay as they are.
- Contract: on a server that is not in loopback local mode, the route decides in this order.
  1. A request whose `Origin` header is present is 403 `{"error":"forbidden"}`. The body is not read.
  2. A request whose `Authorization` header is present is resolved with `authorizeBearer` before the body is read. A header that does not resolve to a tenant is 401 with the REST error body, including an empty bearer and a bearer for another `?tenant=`. The body is not read. A resolved bearer keeps today's scope, tenancy, body ceiling, and method dispatch. A cookie is not a bearer and does not select a tenant.
  3. A request with no `Authorization` header is the anonymous discovery principal. It has no tenant. It is not the local tenant and it is not `read` or `read_write`. The anonymous budget in the Security section is applied before the body is read. Over budget is 429 `{"error":"rate_limited"}` and the body is not read.
  4. An admitted anonymous body is read at the default MCP cap (256 KiB), including when the JSON names a bulk tool. Over that cap is 413. The 8 MiB ceiling is not available on this path.
  5. A message with no `id` is a notification: 202, empty body, no handler, including a `tools/call` that arrived without an `id`. `initialize`, `ping`, and `tools/list` with an `id` return 200 and one JSON-RPC result. An unknown method with an `id` returns `-32601`. `tools/call` with an `id` returns 401 with the REST error body. No branch calls a tool handler, opens a tenant, or reads the store.
- Contract, catalog: anonymous `initialize` instructions and anonymous `tools/list` entries are byte-for-byte the instructions and the tool entries a `read` bearer receives on that same server at the same `Yakka-Context` value. That set is the registered `read` tools the caller's declaration version can run. On the shipped registry with `Yakka-Context: 2` those names are `list_checks`, `search_artifacts`, `artifact_feedback`, and `list_reviews`. `review_change` is absent, and its instruction sentence is absent. An empty tool list is not a successful discovery result. Each listed entry still carries `name`, `description`, `inputSchema`, `annotations`, and `_meta["yakka/tool"]`. `serverInfo.version` is the server build, the same value a bearer receives and the same value `/v1/health` already publishes.
- Contract, local mode: a loopback local server is unchanged. A missing bearer there is the local tenant with `read_write`, and `tools/call` runs. The anonymous budget does not apply.
- Non-goals: anonymous `tools/call`; a synthetic tenant; accepting cookies or `?tenant=` as identity; changing ingest, REST reads, device login, or review spend; a per-tool limiter on authenticated calls; OAuth for MCP clients.

### Domain: Shim resolution

- Owns: the endpoint and bearer the stdio shim puts on every `POST /v1/mcp`, including the internal `tools/list` refresh and the internal `initialize` it uses to read the local-action advertisement. `plugins/yakka/mcp.json`, `.mcp.json`, and `.codex-mcp.json` stay free of endpoint and key.
- Contract: the shim resolves with the MCP login below, not with `Load()`, and not with Plan 21's single `Resolve`. `ErrPartialEnv` is not produced here. `Local` is true only when the resolved endpoint is loopback. The default origin is `Local` false with an empty key.
  - Endpoint, first match: a non-empty `YAKKA_ENDPOINT`; otherwise `endpoint` in `client.toml` when the file exists and contains one; otherwise login's `DefaultEndpoint`, `https://api.yakka.build`.
  - Key, first match: a non-empty `YAKKA_KEY`; otherwise `key` in `client.toml` when the file exists and contains one; otherwise empty, and the shim sends no `Authorization` header.
  - When `YAKKA_ENDPOINT` is set and `YAKKA_KEY` is not, the key is empty even if `client.toml` contains a key. An endpoint override is sent with no saved bearer.
  - When `YAKKA_KEY` is set and `YAKKA_ENDPOINT` is not, the endpoint still falls through to the file and then to `DefaultEndpoint`, and that key is the bearer.
  - A missing file skips the file steps. A file that exists and is unreadable, or whose lines are not `name = "string"`, is the shim error `bad config`. The shim does not skip a broken file and use the default. A file that parses and simply omits `endpoint`, `key`, or both uses the matches above for the omitted fields. That is a deliberate difference from `Load()`, which rejects a file missing either field.
  - The bearer is sent only for a non-empty key over `https`, or over `http` to a loopback host. A key aimed at any other `http` origin is `bad config`. A keyless explicit `http` origin is still forwarded. Absence of configuration is never rewritten to `http://127.0.0.1:8770`.
  - A connect, TLS, or HTTP failure uses the resolved origin only. The shim does not retry on loopback and does not replace the origin.
  - HTTP 401 that is not a JSON-RPC body is the existing shim error `unauthorized`. HTTP 429 is `unreachable` (retryable, with `queued_locally`), and it is not `bad config`.
  - The secret scrub inside `_mcp_readers` uses this login's key, the same value the following POST will send. A reader value that contains that key becomes the existing `secret_in_context` failure before the body is sent. Today's scrub calls `Load()` and swallows `ErrPartialEnv`, so a process with only `YAKKA_KEY` set skips the scrub. That skip is closed. A resolver failure still sends nothing.
- Contract, discovery: with no file and both env vars unset, a shim `initialize` and `tools/list` are posted to `https://api.yakka.build/v1/mcp` with no `Authorization` header, and the process writes the server's JSON-RPC replies to stdout. A following `tools/call` is posted the same way, and a 401 from the server becomes `unauthorized` for that call. The process stays up.
- Non-goals: a tool list, schema, or instruction string inside `yakka.py`; embedding `YAKKA_KEY` in `mcp.json`; starting a drain from the shim; posting file bytes.

### Domain: Drain, login, and status

- Owns: `Load()`, `ConfigSink`, `RunStandalone`, `resolve_endpoint`, `cmd_login`, and the drain lines of `run_status`. The Go loaders in `internal/clientconfig`, `internal/drain`, and `internal/mcp` are outside this domain.
- Contract: `Load()` is unchanged. Both env vars set is that remote. Exactly one set is `ErrPartialEnv`. A readable file with both `endpoint` and `key` is that remote. Anything else in a present file is the existing read error. Neither env var set and no file is loopback `http://127.0.0.1:8770`, `Local` true, empty key. `RunStandalone` still returns 1 on `ErrPartialEnv` before any request. `ConfigSink` still builds its sink from `Load()`. With neither env var and no file, that sink's endpoint is loopback and the drain does not open `https://api.yakka.build`. `POST /v1/ingest` is unchanged: a non-local server without a `read_write` bearer rejects the batch. `resolve_endpoint` is unchanged: `--endpoint`, else the file's endpoint, else `DefaultEndpoint`. Login still writes `client.toml` only after a device token is issued.
- Contract, status: exit codes and the existing drain lines stay. No file and no env still prints `config: none (local mode)` and `endpoint: http://127.0.0.1:8770`, which describes the drain target. Partial env still exits 1 and still names the missing variable. Status adds one line from the shim's resolver, and it does not open a connection to that origin: `mcp: <origin> credential` when a key resolved, `mcp: <origin> no-credential` when the origin resolved and the key did not, `mcp: -` when the resolver itself is `bad config`. The origin is shown with userinfo, query, and fragment removed. The line does not contain the key. The reachable word stays on the drain endpoint's health probe only.
- Non-goals: Plan 21's replacement of the no-file drain fallback with "yakka is not logged in"; `mode = "local"` / `YAKKA_MODE`; posting keyless batches to the default origin; changing the Go hosted drain in `internal/serve/host.go`.

## Security

Anonymous `initialize` and `tools/list` publish the read-tool catalog and nothing from a tenant.

Exposed on an anonymous discovery response:

- The server name and build version (`serverInfo`), which `/v1/health` already returns.
- For each `read` tool the declaration version includes: tool name, description, JSON schema, MCP annotations, the one-line instruction sentence (through `initialize`), and `_meta["yakka/tool"]` (`v`, `rev`, `scope`, `timeout_s`, and the reader list with its constant params).
- The shipped reader params name local facts the shim would attach on a later authenticated call (`path_arg`, `bases`, `of`). They are not paths on the server, not bearer values, and not file contents.

Not exposed, and not computed, on any anonymous request:

- Tenant ids, artifact rows, snippets, checks text, baselines, review records, cursors, scores, and captured diffs. Those exist only inside handlers, and the anonymous path does not enter a handler.
- `review_change`, its schema, and its instruction. That tool is `read_write` and spends on a provider call. A `read` bearer already cannot see it; anonymous discovery matches that bearer.
- The caller's filesystem. The server never reads `_local` paths. Anonymous `tools/call` is 401 before a handler, so a forged `_local` is discarded with the body.
- Whether a guessed bearer is one character off. A present `Authorization` header that fails is the same 401 as any other bad bearer. It is not retried as anonymous, so discovery does not launder a wrong key into a 200.

Budget: 120 anonymous `POST /v1/mcp` requests per client IP per rolling minute. The IP is `deviceClientIP`: `Fly-Client-IP` when `FLY_APP_NAME` is set and the header parses as an IP, otherwise the connection's remote host. `X-Forwarded-For` is not used. The counter is the discovery route's own. It does not share the device-grant window, and it does not count a request that presented `Authorization` or a loopback local-mode request. The check runs before the body is read. The next request over the cap is 429 `{"error":"rate_limited"}`. Authenticated MCP stays without a per-tool rate limit, as design 8's non-goal already says. This plan does not add a limiter for bad bearers.

A single shim session is `initialize`, `tools/list`, and the occasional internal list refresh. That set is under the cap. The cap is what stops an open proxy from holding multi-megabyte parses: anonymous bodies stop at 256 KiB, and 120 of those per minute per IP is the admitted volume.

## Architectural Implications

- The PR body's first line is `Yakka-Plan: docs/plans/25-mcp-discovery-without-key/`.
- Server phase first, then the client phase. Shipping the shim's new default before the server accepts anonymous discovery makes every keyless Cloud Agent `POST` to `https://api.yakka.build/v1/mcp` and get today's 401, which fails discovery the same way. A server deploy alone leaves current shims on `Load()`: keyed clients keep working, and a keyless shim still dials loopback until the plugin that contains phase 2 is released. The two phases can be built in one branch. They are not released in parallel.
- Stable docs this change rewrites: design 8 (authentication, the "missing credential is 401" sentence, and the body-read sentence), design 3 (the `POST /v1/mcp` row), design 2 (the shared four-step config list, as it applies to the shim), design 4 (the sentence that the shim forwards every method with the shared login), design 5 (the sentence that a remote agent sets both env vars). `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md` point at design 8 and do not state the per-method rule. They stay as they are.
- Plan 21's single `Resolve` does not become the shim's login. When Plan 21 phase 1 is built, it may tighten drain and status. It leaves the shim on this plan's resolver. The sentence in Plan 21 that the shim takes its endpoint and bearer from the one login the drain uses is superseded for the shim.
- Plan 24's closed shim error classes stay. 429 joins the `unreachable` row. The shim still holds no tool wording.
- The Go client packages (`internal/clientconfig`, `internal/drain`, `internal/mcp`, `internal/serve/host.go`) still call `clientconfig.Load()`. Cursor does not launch them. This plan does not patch them and does not depend on deleting them.
- Phase outcomes are proved in a checkout against the Go server and the Python shim. A live Cloud Agent session is an observation after the server is deployed and the plugin is released. It is not a third phase.

## Decisions

- Discovery is a server exception for four messages (`initialize`, `ping`, `tools/list`, notifications), plus the shim aiming keyless clients at `https://api.yakka.build`. A client-only default would 401 on production. A server-only change would leave the Cloud Agent shim on loopback.
- The anonymous catalog is the `read` catalog, not an empty list and not the `read_write` catalog. An empty list would connect and still give Cursor no tools. Listing `review_change` would publish a spend tool's schema to the internet. Calls stay unauthorized until a real bearer is present, so a Cloud Agent with no key can see the advisory tools and gets `unauthorized` when it invokes one.
- A present `Authorization` header is never downgraded to anonymous. A wrong key stays visible as 401 on `initialize`. A missing header is the only keyless path.
- `YAKKA_ENDPOINT` overrides the origin and does not carry `client.toml`'s key with it. `YAKKA_KEY` with no endpoint uses the file's origin when it has one, and otherwise `DefaultEndpoint`.
- Drain keeps `Load()`. This plan does not implement Plan 21's "nothing configured is an error", and it does not switch the drain onto the shim's default. Keyless ingest of the default origin does not exist.
- Status tells both stories. The drain lines stay honest about `Load()`. The new `mcp:` line names the shim's origin and whether a credential was resolved, without probing that origin and without printing the key.
- The discovery budget is 120 anonymous posts per IP per minute, counted before the body is read, using the device-route IP rule. Authenticated calls are not added to it.

## Assumption Ledger

### Assumption 1

- Question: Does Plan 21's single `Resolve` (nothing configured is an error; exactly one env var is an error; the shim and the drain share it) stay in force for the shim?
- Answer chosen: No for the shim. Yes as the future drain/status contract Plan 21 may still build. This plan leaves `Load()` as it is and gives the shim a separate resolver. Plan 21 phase 1 must not route `_McpRelay._post` back through that shared `Resolve`.
- Rationale: the approved direction is keyless discovery at `https://api.yakka.build`, with drain still refusing to post without a key. One resolver cannot do both. Plan 21 phase 1 is unbuilt; `Load()` is still the loopback fallback.
- If wrong: if the shim must share the drain's error, Cloud Agents with no file stay `bad config` and this design's phase 2 outcome is void. Discovery would then need a key in the MCP child, which the approved direction rejects.

### Assumption 2

- Question: Which tools does a keyless `tools/list` return?
- Answer chosen: Exactly the tools a `read` bearer would be shown at the same `Yakka-Context`, including declaration metadata. `review_change` stays hidden until a `read_write` bearer lists tools.
- Rationale: Cursor discovery needs the advisory tools the skills name (`artifact_feedback`, `list_checks`, `search_artifacts`). `list_reviews` is already `read`. The spend tool's schema is not required for the server to appear.
- If wrong: if a harness never re-lists after a key appears in a long-lived shim, that process would not see `review_change` until restart. Keyed sessions send the bearer on the first `initialize`, so they see it immediately. A follow-up can list `read_write` names without making them callable. It must not do that by giving the anonymous principal `read_write`.

### Assumption 3

- Question: Does a bad or partial bearer fall through to anonymous discovery?
- Answer chosen: No. Only a missing `Authorization` header is anonymous. Any present header that `authorizeBearer` rejects is 401 on every method, body unread.
- Rationale: a wrong key in the environment should fail discovery loudly. Falling through would report a healthy server and then 401 on calls.
- If wrong: if operators need a poisoned env key to be ignored, the shim would omit the header when the server returned 401 on `initialize` and retry once. That retry is a new behavior and is not part of this design.

### Assumption 4

- Question: When `YAKKA_ENDPOINT` is set and the key is only in `client.toml`, which key is sent?
- Answer chosen: None. The override origin is contacted with no bearer. A `YAKKA_KEY` with no `YAKKA_ENDPOINT` still uses the file origin, then `DefaultEndpoint`.
- Rationale: an endpoint override that inherited the file key would present the saved bearer to whatever host the override names. Cloud workers have no file, so discovery still works. A laptop that overrides the endpoint and expects the file key must set `YAKKA_KEY` as well, or unset the endpoint and edit the file.
- If wrong: independent field override (file key travels with the env endpoint) is a one-line change to the resolver. It is unsafe for a hostile override host and is rejected here.

### Assumption 5

- Question: What budget limits anonymous discovery?
- Answer chosen: 120 requests per IP per rolling minute, IP via `deviceClientIP`, counter private to this route, enforced before the body read, 429 `{"error":"rate_limited"}`. The shim maps 429 to `unreachable`.
- Rationale: a session sends a handful of discovery posts. 120 leaves room for many workers behind one Fly client IP and stops an unbounded 256 KiB parse loop. Device login's 10 per minute is too tight for shared egress and is a different route.
- If wrong: raise the constant. The phase outcome holds as long as one session's `initialize` plus `tools/list` is under the cap and the next request past the cap is 429 with the body unread. A lower cap that breaks shared Cloud Agent egress is a constant change, not a new auth rule.

### Assumption 6

- Question: How does status stay honest without adopting the shim's default for the drain?
- Answer chosen: Drain lines and exit codes stay on `Load()`. An added `mcp:` line reports the shim origin and `credential` or `no-credential`, with no health probe of that origin and with the key omitted.
- Rationale: today's no-file line `config: none (local mode)` is true of the drain and false of the shim once phase 2 lands. Deleting it would pretend Plan 21's drain error had shipped. Probing `https://api.yakka.build` from status would be a new network call on every status.
- If wrong: if the extra line is too noisy when both sides match, print it only when the shim origin or credential presence differs from `Load()`. The no-file and partial-env cases must still print it.

### Assumption 7

- Question: May the client default ship before the server accepts anonymous discovery?
- Answer chosen: No. Phase 1 is deployed before a plugin release that contains phase 2. Checkout tests may run together.
- Rationale: the new shim default is production. Against today's `mcpAuth` that default fails `initialize` with 401.
- If wrong: a client-first release regresses Cloud Agent discovery until the server deploy, and keyed clients are unaffected. There is no flag in this design to keep the loopback fallback for one release.

### Assumption 8

- Question: Does the production edge forward an unauthenticated `POST /v1/mcp` to the app?
- Answer chosen: Yes, the same way it forwards unauthenticated `POST /v1/device/code` and `GET /v1/health`. Phase outcomes are proved against the Go server directly and do not depend on the edge.
- Rationale: those routes are already programmatic and unauthenticated. Nothing in this repo places a bot check on `/v1/mcp`.
- If wrong: the checkout outcomes still hold, and a live Cloud Agent still fails until an edge rule lets the POST through. The shim must not treat that failure as a reason to dial loopback.

### Assumption 9

- Question: Does Cursor drop the server when a later `tools/call` returns the shim's `unauthorized`?
- Answer chosen: Discovery is defined as `initialize` and `tools/list` succeeding. A later call's `unauthorized` is that call's error. Harness policy after a failed call is unobserved and is not a phase gate.
- Rationale: Plan 24 already records that harness behavior after a failed `initialize` was not collected. This plan removes the `initialize` failure for the keyless case. It cannot promise how Cursor renders a later tool error.
- If wrong: a follow-up can change the call error text. It must not satisfy the call anonymously to keep the server green.

## Open Questions

None that block a phase. Assumption 8 blocks only a live production claim, and Assumption 9 blocks only a claim about Cursor's reaction to a later `unauthorized` call. Both have a chosen default. Downstream review can challenge the ledger.

## Non-goals

- Implementing Plan 21 (final-write capture, feedback states, Codex instructions, legacy retirement, backlog upload) or amending its phases beyond the resolver split in Assumption 1.
- Plan 22 session work tagging, Plan 23 review controls, and the unbuilt Plan 24 server side of `enqueue_file_snapshot`.
- Anonymous or keyless `tools/call`, ingest, REST reads, or review spend.
- Putting `YAKKA_ENDPOINT` or `YAKKA_KEY` into `plugins/yakka/mcp.json` or the other harness manifests.
- Replacing `Load()`'s no-file loopback result, adding `mode = "local"`, or teaching the drain to use `DefaultEndpoint`.
- Patching or deleting the Go client (`internal/clientconfig`, `internal/drain`, `internal/mcp`, the hosted drain).
- A plugin release, a Fly deploy, or a live Cloud Agent session as a closing condition of either phase.
- Per-tool rate limits on authenticated MCP, a limiter for bad bearers, and OAuth for MCP clients.

## Phases

Two phases. Phase 2 depends on phase 1's contract. `refine` applies. Neither phase is open.

### Phase 1 — Anonymous discovery on the server

- Outcome: on a non-local test server, a `POST /v1/mcp` with no `Authorization` header returns 200 for `initialize`, `ping`, and `tools/list`, and 202 for a notification. `initialize` instructions and `tools/list` entries match a `read` bearer on that server at the same `Yakka-Context`, include `list_checks`, `search_artifacts`, `artifact_feedback`, and `list_reviews` when those tools are registered, and omit `review_change`. A `tools/call` of a `read` tool, a `read_write` tool, or an unknown tool returns 401, and a handler counter stays 0. A present bad `Authorization` returns 401 for `initialize` with the body unread. An `Origin` header returns 403 with the body unread. A cookie does not select a tenant. One anonymous request past the budget returns 429 with the body unread, and a valid bearer on the same IP still receives 200. Anonymous bodies over 256 KiB receive 413. `POST /v1/ingest` and a REST advisory read with no bearer still return 401. A loopback local server still runs `tools/call` with no bearer. Design 8 and the design 3 route row describe this gate.
- Surfaces: `packages/yakka/internal/serve/mcp.go` (the MCP route's auth and dispatch), the MCP tests in that package, `deviceClientIP` in `packages/yakka/internal/serve/device_limits.go` as the IP source, `docs/design/08-server-mcp-contract.md`, `docs/design/03-remote-service.md`.
- Approach: known
- Depends on: nothing
- Verification: from `packages/yakka`, `go test ./internal/serve/ -count=1 -run 'TestMCP'`. The run includes the assertions in the outcome. Existing keyed MCP tests stay green, including the tenant matrix and the unread-body case for a rejected bearer.

### Phase 2 — Shim default and the strict drain

- Outcome: with a temp home, no `client.toml`, and `YAKKA_ENDPOINT` and `YAKKA_KEY` unset, the shim posts `initialize` and `tools/list` to a fixture standing in for `https://api.yakka.build` with no `Authorization` header and writes the fixture's tool list to stdout. The same process posts `tools/call` with no header, and a fixture 401 becomes the shim error `unauthorized` on stdout. The process does not dial `127.0.0.1:8770`. Only `YAKKA_ENDPOINT` set does not raise `ErrPartialEnv` and posts to that origin with no header and no file key. Only `YAKKA_KEY` set posts to `DefaultEndpoint` with that bearer, and a reader value that contains that key is replaced with the `secret_in_context` failure so the key text is absent from the body. Both set posts those values. A file with no env supplies whichever of endpoint and key it contains, and a missing field uses the default origin or no bearer. An env endpoint suppresses a file key. A broken file is `bad config` for the shim and `mcp: -` for status, and it is not retried against the default. `Load()` still returns loopback when nothing is set, still raises `ErrPartialEnv` when one env var is set, and `ConfigSink` in that no-file case still names `http://127.0.0.1:8770`. `yakka status` in the no-file case still prints the local drain line and also prints `mcp: https://api.yakka.build no-credential`, and it does not request that origin. A partial env still exits status 1, still names the missing variable, and prints the `mcp:` line for the resolver. A logged-in file still sends the bearer and prints `mcp: <file origin> credential` with the key absent from stdout. Design 2, design 4, and design 5 describe the split.
- Surfaces: `plugins/yakka/client/yakka.py` (`_McpRelay._post`, the scrub in `_mcp_readers`, and `run_status`; `Load`, `ConfigSink`, `RunStandalone`, and `resolve_endpoint` unchanged), `plugins/yakka/client/test_clientconfig.py`, `plugins/yakka/client/test_mcp_shim.py`, `plugins/yakka/client/test_status.py`, `plugins/yakka/client/test_drain.py`, `docs/design/02-edge-capture.md`, `docs/design/04-advisory-surface.md`, `docs/design/05-distribution.md`. `plugins/yakka/mcp.json` is unchanged.
- Approach: known
- Depends on: Phase 1
- Verification: from `plugins/yakka/client`, `python3 -m unittest test_clientconfig test_mcp_shim test_status test_drain`. The shim cases speak HTTP to a local fixture that implements the phase 1 status codes, with `DefaultEndpoint` pointed at that fixture for the test. `python3 -m unittest test_mcp_guard` still passes: `yakka.py` gains no tool name, schema, or instruction literal.

## Provenance Notes

Ground is the tree at `0a206ccddef4540f9b5a47e981ba2d493ba0bbd0`. The worktree this design started from was one commit behind that, still carrying `plugins/yakka/.cursor-mcp.json`. That file was renamed to `plugins/yakka/mcp.json` in `#229`. The manifest still has no `env` block. `cmd/yakka` in the Go module does not serve the Cursor shim.

Rejected: teaching `Load()` the default origin. Drain, status, and the shim would all start posting or probing production, and a missing key would either send keyless ingest or trip `ErrPartialEnv` for discovery. The split is the whole fix.

Rejected: an anonymous principal whose scope string is `read`. `scopeAllows` would then let `tools/call` enter read handlers and return tenant data. The list matches a read bearer. The call path does not.

Rejected: skipping the body-read rule for anonymous clients up to 8 MiB. The admitted anonymous read is the default 256 KiB cap, after the budget check. A rejected bearer is still unread, which keeps the existing conformance spy for bad credentials.

The adversarial pass over this document was done in the design context. No separate context was available to dispatch. Findings applied here: the unread-body rule split between a presented bearer and a missing header; a `tools/call` with no `id` stays a notification and runs nothing; the file key withheld from an endpoint override; the `_mcp_readers` scrub follows the shim key so a `YAKKA_KEY`-only process does not skip it; 429 mapped onto the existing `unreachable` class; the Go client named as out of scope so a worker does not patch `internal/mcp`; status's drain lines preserved so this plan does not silently ship Plan 21's unbuilt error.
