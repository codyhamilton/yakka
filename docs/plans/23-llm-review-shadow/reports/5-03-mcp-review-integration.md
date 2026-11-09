# 5-03 — MCP review registration and transport proof

Status: `done with concerns`

## Delivered

- Registered `review_change` over the existing `review.Run` orchestrator and REST request contract. Its schema covers review identity, criteria, build models, detail, dry run and trial fields; the declaration is `read_write`, 150 seconds, no local actions, and uses the `project_dir`, `cwd`, `git`, `change` context order. Reader policy values come from the embedded review policy. All context entries are optional at the registry gate; missing/unsupported change capture is translated to `capture_unsupported` before orchestration.
- Added route tests for registration and scope, unsupported-reader refusal, and fake-endpoint MCP reviews for `uncommitted` and `range`, followed by REST calls with equivalent arguments. Both paths use the shared orchestrator and identical capture identity; REST observes the prior MCP call as `skipped_duplicate`. MCP full detail contains the validated result and neither transport returns captured diff content in a receipt.
- Review tool registration is conditional on review model configuration and a server MCP ceiling of at least 150 seconds. Minimal servers keep their existing exact tool lists; a configured server advertises the tool only when its timeout contract fits.
- Plan 22's `session_hint` reader has not shipped, so it is omitted. Session binding remains the existing orchestrator's unbound behavior.

## Evidence

From the repository root:

```text
prlimit --as=8589934592 -- bash -lc 'cd packages/yakka && GOMAXPROCS=3 go test -p=3 ./internal/serve'
ok github.com/codyhamilton/yakka/packages/yakka/internal/serve 9.311s

prlimit --as=8589934592 -- python3 -m unittest test_mcp_shim
Ran 21 tests in 6.431s
OK

git diff --check
(no output; exit 0)
```

The Python shim check ran from `plugins/yakka/client`. The Go fake provider asserted explicit `high` effort and handled both capture modes without live calls or credentials.

## Departures and known concerns

- Registration is conditional as described above because unconditional registration violated existing conformance fixtures and failed servers configured with a call ceiling below 150 seconds. If review should be listed while its model setting is absent, registration needs a separate explicit startup hook.
- The REST parity assertion sees the same capture id and names the MCP review as the duplicate; idempotency intentionally returns a new `skipped_duplicate` receipt, so that second response is not byte-for-byte the original receipt.
- Unfinished work: none. No live provider, credentials, deploy, Fly or Wrangler actions were used.
