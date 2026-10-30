# Review — plan 18 local-remote-sync

**Verdict:** PASS_WITH_FOLLOWUPS  
**Reviewed SHA:** c3d15306831a9bec1087f56f8ee218beb8f82d98 (pre-fix); automation follow-up commit adds loopback unspecified guard and this file.

## Phase outcomes

| Phase | Assessment | Evidence |
|-------|------------|----------|
| 1 — Diff trim | met | `ingest.Trim` + re-canonical hash (`ingest.go`, `trim_test.go`); plugin trim before spool (`index.ts`, `test_hooks.mjs`); compact keeps trimmed row hashes (`compact_test.go`). |
| 2 — `yakka sync` | met | Preflight, cursor, read-only source, three wire types, batching/retries covered by `internal/sync/sync_test.go` and cmd tests; `GET /v1/whoami` bearer-only (`whoami_test.go`); `LoadSync` isolated from drain (`clientconfig_test.go`, `test_login.py`). Cold-tier preflight intentionally omitted (plan 17 not in tree; noted in PR). |
| 3 — Hosted migration | partial | Production health reports `3.2.0-3f60471`; full migrate recipe counts not re-run in this review (no tenant token). `fly.toml` still has empty `[build]` — follow-up so plain deploy does not revert health to `dev`. |

## Findings

### Resolved in review

- **low — loopback preflight:** Sync endpoint host `0.0.0.0` / `::` was not treated as loopback. Fixed in `sync.go` (`IsUnspecified()`).

### Follow-up (non-blocking)

- **low — `fly.toml` build args:** Record `VERSION` / `COMMIT` in `[build]` (or documented deploy command) so Phase 3 health guard survives the next deploy.
- **low — read-only lock:** `openLockExisting` still skips the lock on `EACCES`; acceptable for read-only copies but worth tightening if sync should always share-lock with serve.

## Intent and ledger

Implementation matches DESIGN.md: separate sync credential, `/v1/ingest` reuse, rowid cursor, trim as one function, whoami for tenant/scope match. Assumption ledger empty per PROVENANCE.md.

## Plan sufficiency

Design was sufficient to derive preflight refusals, cursor semantics, and test expectations. Phase 3 operational steps remain environment-dependent.

## Residual risks

First sync of a large tenant is bandwidth- and screening-heavy (by design). Cursor loss causes duplicate ingest only.
