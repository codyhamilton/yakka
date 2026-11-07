# 5-03 bounded artifact content handoff

## Delivered

- Added `GET /v1/analytics/content?repo_id=&path=&hash=` under the existing analytics auth, deadline and concurrency middleware. Read-scope bearer and owned-session access are covered; the session request selects its owned tenant, and content identity is checked only in that tenant.
- Store reads now require an exact `(repo_id,path,hash)` artifact fact, distinguish pending, missing, screen-removed, screened-pass and explicit unscreened states, and bounded-read full blob bytes. Only paths recognized as stored design, brief or report kinds are eligible.
- Successful responses verify SHA-256 before writing complete bytes and set the required text, nosniff and private no-store headers. Oversize returns 413 with full size/limit and no prefix; mismatches return 500 `content_integrity` without content. `/schema` advertises `artifact_content` with the 16 MiB budget only alongside the registered route.
- Updated the remote-service description. No migration, new dependency, auth mode, or contract was added.

## Evidence

From `packages/yakka`:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 7.025s, serve 25.068s).
- `git diff --check` — passed.
- Fixture HTTP tests cover read bearer/session auth, tenant isolation, exact repo/path/hash identity, pass and unscreened metadata, pending/not-stored/screen-removed refusals, full-byte success, integrity mismatch, unsupported kind, required headers, and oversize refusal. Store tests cover cancellation and no-partial oversize reads.

## Deviations and carried limits

- No departure from the 5-03 brief. 5-01's artifact bucket ambiguity remains documented there; it does not affect this exact-version content route. 5-02 reported no content-route limitation affecting this outcome.
- No unfinished work or external gate for this unit. No live service, deployment, credential, or production data was used.
