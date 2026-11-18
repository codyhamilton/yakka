# Review — MCP discovery without a key (design)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `fc136912d87fb436ff3c1a7a2b88e4b121ac9cd6` (PR #230).

Plan sufficiency: the design is enough to judge intent, phase outcomes, ledger entries, and downstream QA. Server-first release ordering, Plan 21 resolver split, and security boundaries are explicit.

## Phase outcomes (design acceptance)

| Phase | Assessment |
| --- | --- |
| 1 — Anonymous discovery on the server | **met** (as design). Auth gate order, catalog parity with `read`, handler counter at zero, rate limit, and verification command are stated observably. Surfaces match `mcp.go` and `device_limits.go`. |
| 2 — Shim default and the strict drain | **met** (as design). Resolver rules, `Load()` unchanged, status `mcp:` line, and unittest verification are complete. Depends on phase 1 is explicit. |

## Intent and ledger

The verbatim intent block is preserved per the design skill. Problem statements align with code at ground SHA `0a206ccd`: `Load()` loopback fallback, `ErrPartialEnv` on partial env, `mcpAuth` calling `authorizeBearer` before method dispatch, and `DefaultEndpoint` only on `resolve_endpoint`. Plan 21 conflict is reconciled in Decisions and Assumption 1. Nine ledger entries cover resolver split, catalog scope, bearer downgrade, release order, edge forwarding, and harness behaviour.

## Findings

### Follow-up (not blocking design sign-off)

- **low** — Assumption 8 (production edge forwards unauthenticated `POST /v1/mcp`) is ledgered with a checkout-only default; validate at Fly deploy time for phase 1 close-out, not at design sign-off.
- **low** — Assumption 9 (Cursor behaviour after a later `tools/call` `unauthorized`) is correctly non-gating; note for post-release observation only.
- **low** — Phase 2 outcome names `DefaultEndpoint` in tests; implementation should use the module constant in `yakka.py` rather than hard-coding the origin in test fixtures only.

## Security lens

Anonymous path exposes the same read-tool catalog already implied by design 8's scope-filtered `tools/list`; `review_change` omission matches `read_write`. Rejecting a synthetic `read` principal for anonymous `tools/call` is correct. Rate limit (120/min/IP via `deviceClientIP`), 256 KiB body cap, existing `Origin` → 403, and no bearer downgrade are adequate for the stated threat model.

## Residual risks

- Client-before-server release regresses keyless discovery until server deploy (Assumption 7); release process must enforce server-first.
- Many Cloud Agents behind one Fly egress IP share the discovery budget (Assumption 5); tune constant if production shows 429s on legitimate bursts.
- Shim resolver diverges from future Plan 21 `Resolve` for drain; execute must not reunify them without revisiting this design.