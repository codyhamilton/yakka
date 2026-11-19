# 13-05 Phase 13 integrated acceptance handoff

Status: `done with concerns`. Every component entry point and exact count is
present and verified; the one concern is an environment-induced Go test failure
under the mandated in-worktree `TMPDIR`, explained below and proven to pass with
an outside-repo `TMPDIR`.

Owned files: `packages/yakka-analytics/tests/release-matrix/acceptance.test.mjs`
and this report. Nothing else was staged; `IMPLEMENTATION.md` was already
modified in the worktree and is not touched here.

## Integrated acceptance test

`acceptance.test.mjs` is one top-level test. It reads the committed artifacts and
verifies no Phase 13 outcome is missing or skipped; it does not reimplement the
component suites.

```
$ mkdir -p .scratch/p13
$ TMPDIR=.scratch/p13 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-concurrency=1 packages/yakka-analytics/tests/release-matrix/acceptance.test.mjs
# integrated acceptance: matrix targets pages+embedded, suites 20 tests,
  record 75 requests/12 scenarios/9 all=1, p95<=500ms, identity 8+6, concurrency<=4
# tests 1  pass 1  fail 0  cancelled 0  skipped 0
```

It pins: the matrix's two targets (`pages`, `embedded`) and its four suites with
their measured top-level counts (5/6/5/4 = 20); zero-skips assertion; the record
SHA-256, 75 requests, 12 scenarios, 9 `all=1`; the Go pins (75, same SHA, p95
500 ms, concurrency 4); eight identity subtests with `maxInFlight() <= 4`; six
identity contract tests; the local-shell/remote-JSON callback route test over
`/device`, `/oauth/callback`, `/login`, `/profile`, `/settings`; the release and
secret checks; `pages_build_output_dir = "./web"`; the README/design-03 release
facts; CONTRACTS 14's `Current (landed in Phase 1)`; and the plan marker gate.

## Matrix against both hosts (13-01)

```
$ TMPDIR=.scratch/p13 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true \
  NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/release-matrix/matrix.test.mjs
ok 1 - release matrix: Pages-style static serving passes every acceptance suite
ok 2 - release matrix: the embedded release binary serves the same acceptance suites
# tests 2  pass 2  fail 0  skipped 0
```

Hosts: `pages` (Pages-style static harness, first-party stub API) and `embedded`
(`tools/release/build.sh` binary serving embedded assets via
`YAKKA_RELEASE_STATIC_ORIGIN`). Each ran workspace 5/5, trends-quality 6/6,
scatter-sessions 5/5, plans-artifacts 4/4 — 20 tests per target, 40 total, zero
skips. Build output stayed under `.scratch/p13`; no deploy or tenant action.

## Server pageset smoke and profiler (13-02)

```
$ TMPDIR=$PWD/.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve \
  -run '^TestAnalyticsPageSetSmoke$' -count=1 -v -timeout 20m
browser record: 12 scenarios, 75 requests, 9 all=1
browser record smoke: 75 requests across 12 scenarios = 61 served (200) + 14 documented capability refusals (400)
--- PASS: TestAnalyticsPageSetSmoke (200.30s)

$ TMPDIR=$PWD/.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB YAKKA_PAGESET_PROFILE=fixture \
  go test -p=3 ./internal/serve -run '^TestAnalyticsPageSet$' -count=1 -v -timeout 25m
page request-set profile: 75 recorded cases across 12 scenarios; 61 served cases timed,
  14 documented capability refusals excluded; 4 timed runs each, concurrency 4,
  bound p95<=500ms, fixture fixture-tenant
max p95 282.5 ms across 61 cases (bound 500 ms)
--- PASS: TestAnalyticsPageSet (208.30s)
```

Exact counts: **75 requests / 12 scenarios / 9 `all=1`; 61 served (200), 14
documented refusals (400)**. Max p95 **282.5 ms** this run (component report:
283.7 ms), inside the unchanged 500 ms bound. Profiler covers all-history cases.

## Go suite (all packages)

```
$ TMPDIR=$PWD/.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./... -count=1
ok  .../cmd/yakka ... ok .../internal/serve 243.265s ... ok .../internal/store 13.093s
--- FAIL: TestRepoPath (0.02s)
    keys_test.go:175: outside repo: ok=true err=<nil>
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/keys 0.128s
```

17 packages: 16 `ok`, 1 `FAIL` (`internal/keys TestRepoPath`). The failure is
**environment-induced, not product**: the brief mandates an in-worktree
`TMPDIR=.scratch/p13`, so `t.TempDir()` lands inside this git repository and the
test's "outside repo" negative case sees the repo and returns `ok=true`. Running
the same test with a `TMPDIR` outside the repo passes:

```
$ TMPDIR=/var/tmp/p13-keys-check ... go test -p=3 ./internal/keys -run TestRepoPath -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/keys 0.016s
```

No keys code or test was changed. This is a contradiction between the brief's
`TMPDIR` requirement and `internal/keys`' outside-repo assumption; see
Contradictions.

## Identity and routes (13-03)

```
$ TMPDIR=.scratch/p13 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true \
  NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/identity/*.test.mjs
# tests 15  pass 15  fail 0  cancelled 0  skipped 0
$ ... go test -p=3 ./internal/serve \
  -run 'TestSiteBuiltMode|TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely' -count=1 -v
--- PASS: TestSiteBuiltMode (0.00s)
--- PASS: TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely (0.00s)
```

Eight account subtests plus seven contract tests, zero skips. Route evidence:
local mode serves the built shell for `/device`, `/oauth/callback`, `/login`,
`/profile`, `/settings`; remote `/oauth/callback` returns the API JSON route.
`maxInFlight <= 4` held.

## Release, layout, residual names and docs (13-04)

```
$ TMPDIR=.scratch/p13 python3 tools/release/test_release.py   # Ran 11 tests ... OK
$ python3 tools/release/test_layout.py                        # Ran 7 tests ... OK
$ python3 tools/release/test_scan_residual_names.py           # Ran 5 tests ... OK
$ (cd packages/yakka-analytics && node --test tests/static-shell.test.mjs)
  # tests 3  pass 3  fail 0  skipped 0
$ git diff --check                                            # exit 0, clean
```

Doc state matches the final release: README states `web/` is the no-build
output, `build.sh` embeds and never uploads, Pages deploys `./web` on merge via
external automation, API releases separately on Fly, capability comes from
`/v1/analytics/schema`, and no manual deploy/config/secrets step exists.
Design 03 carries the same facts; CONTRACTS 14 item 1 is relabelled
`Current (landed in Phase 1; wrangler.toml names it)`; `wrangler.toml` is
`pages_build_output_dir = "./web"`.

## Deviations

- `acceptance.test.mjs` reads committed component artifacts and pins their exact
  counts rather than spawning the heavy suites itself; the component commands
  were run separately (above) and recorded. This matches the brief's "integrated
  phase record, not a second implementation".
- The Go full-suite command carries the environment failure described above; no
  suite was skipped, weakened or retried to hide it. The keys check was rerun
  with an outside-repo `TMPDIR` only to attribute the cause, not to replace the
  mandated run's evidence.
- Scratch was `.scratch/p13` as briefed and was removed before committing
  (`git status` shows no `.scratch`).

## Contradictions

- The brief requires `TMPDIR=.scratch/p13` **and** "all Go packages pass".
  `internal/keys TestRepoPath` needs a temp directory outside the repository, so
  those two cannot both hold. The product is unaffected; the test is correct
  under its own assumption (external temp dir) and passes there.
- Component report p95 was 283.7 ms; this independent run measured 282.5 ms.
  Both are well inside 500 ms; the difference is run-to-run timing.

## Unfinished / carried

- Server-maintenance owner: the 14 recorded capability refusals (session-model
  `/query` dimensions, `mode=scatter`, artifact `kind`, jev check/scorer catalog)
  remain documented server gaps; implementing them is a contract change outside
  Phase 13.
- Follow-up design owned by the Plan 20 orchestrator (unchanged here): artifact
  `id` lens grammar; short P10/P11 fixture hashes reaching `identity-required`;
  `shape-bars` harness/repo grouping without a served execution aggregate;
  Plans scatter omitting `session_model` in `FILTER_KEYS`; `plan-timeline`
  multiple-mount load-more collision; artifact deep link beyond `page_max`.
- Process carry: `reports/12-04-artifact-diff.md` was not delivered to
  `artifact_feedback` (no version/queued copy existed). It did not block product
  evidence and is not repaired here.
- Relabel CONTRACTS 10.1/10.2/11.2 `Current (master)`/`Target` labels (noted by
  13-04); out of this unit's scope.

## Gates

- `gate: external Pages automation must accept ./web as its output directory`
- `gate: ready implementation PR body must carry Yakka-Plan: docs/plans/20-analytics-reset`

Neither was verified or changed here; no deploy or configuration action was
performed or claimed.

## Component report paths

- `docs/plans/20-analytics-reset/reports/13-01-browser-matrix-recorder.md`
- `docs/plans/20-analytics-reset/reports/13-02-pageset-smoke-benchmark.md`
- `docs/plans/20-analytics-reset/reports/13-02b-distribution-concurrency-fixer.md`
- `docs/plans/20-analytics-reset/reports/13-03-identity-and-routes.md`
- `docs/plans/20-analytics-reset/reports/13-04-release-docs.md`
