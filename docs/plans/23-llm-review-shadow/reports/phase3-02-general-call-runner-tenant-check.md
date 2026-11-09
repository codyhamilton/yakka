# Report: phase3-02 — General-call runner and dedicated-tenant identity

Status: `done with concerns`

Branch: `feat/23b-review-controls-trial`

## What changed

- `tools/shadow-review-trial/runner.py`
  - `build_request` no longer emits `trial`; it sends `effort`, `store:true` and canonical sorted `tags`: `trial:<run-id>`, `effort:<level>`, `manifest:<sha>`, `case:<sha256-of-case-id>`. It validates the run id (`[A-Za-z0-9_-]{1,32}`), every tag against the Phase 1 16 × 96 bounds, and rejects a supplied tag whose `effort`/`trial`/`manifest`/`case` value disagrees with the request. An optional `tags` argument exists only so callers/tests can supply additional tags.
  - `_manifest` refuses a manifest whose `history` is absent, shallow, object-incomplete, lacks repository/tip, or whose `verified_count` differs from `enumerated_commits` (3-01 certification).
  - `TrialRunner.whoami()` calls `/v1/whoami`; `verify_identity(expected_tenant)` requires the expected tenant and `read_write` scope. `run()` calls it before any dry-run or execute review POST.
  - `run()` now requires `run_id` and `tenant_id`; the ledger is bound to `manifest_hash`, `run_id`, `tenant_id` and per-entry `case_id`/`effort`/request identity, plus `canonical_review_id`. Resume refuses a different manifest, run id or tenant. Claim-before-I/O and no-replay for `started`/`started_unknown` are unchanged.
  - Completion matching uses the canonical tags plus `effective_effort` and `returned_model`, not `profile`/`manifest_hash`/`case_id`.
  - `skipped_duplicate` is resolved from its full cached body (`original_review_id`/`reason`, `original_status`, `result`, `coverage`, `finding_counts`, `model`, `effort`, `tags`, `attempts`); the duplicate branch issues no GET solely for the duplicate. Canonical records are counted once per case/tag set.
  - `get_reviews` filters by `manifest:<sha>` and `trial:<run>` tags instead of legacy profile/manifest fields.
- `tools/shadow-review-trial/cli.py` — `run` gains required `--run-id` and `--tenant-id`, passed through. No approval gate (3-05).
- `tools/shadow-review-trial/test_runner.py` — certified `history` in the fixture; FakeREST answers `/v1/whoami`, parses tag identity, returns tag-only records, and emits full duplicate bodies. New tests cover request shape/no `trial`, effort/run-tag disagreement, invalid run id/tag, tenant and scope mismatch with zero POSTs, matching tenant, duplicate full-body resolution with no duplicate-only GET or new call, resume refusal for run id/tenant/manifest, and uncertified/shallow/count-mismatch manifest refusal. Existing 50/49/asymmetric/retry/cap/no-replay tests now run under the new identity.
- `tools/shadow-review-trial/test_phase7.py` — fake handler answers `/v1/whoami` and accepts the tag/effort/store shape; composed run passes `--run-id`/`--tenant-id`; request-shape assertions check no `trial`, `store:true`, effort and canonical tags. Report section retained.

## Check output

Before (unchanged tree, exact done-evidence command): `Ran 11 tests` → `FAILED (errors=1)`: `test_phase7` manifest creation failed because its fixture repo had no `origin` after 3-01 added history fetch.

New checks written first, run against the pre-change `runner.py` (`git show HEAD:...`): `Ran 13 tests` → `FAILED (errors=13)` (e.g. `TypeError: run() got an unexpected keyword argument 'run_id'`).

After:

```
cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 15 tests in 9.650s
OK
```

`git diff --check` → clean (`DIFF_CHECK_OK`).

## Deviations

- `test_phase7._historical_repo` now creates/pushes a local bare `origin` and passes `--expected-repository`. This sits outside the brief's "request-shape sections" but is required to make the composed rehearsal run at all after 3-01; without it the done-evidence command cannot pass.
- `build_request` takes an optional supplied `tags` list. Needed to test "supplied tag set disagrees"; `run()` never supplies extra tags.
- `get_reviews` switched to tag filters. New rows do not carry `manifest_hash`/`case_id`, so the old filter would never reconcile them. Paging to exhaustion remains 3-03.
- `frozen()` fixture now includes certified history; otherwise every runner test would be refused by 3-01's new contract.

## Contradictions

- Brief "Keep untouched" says only the run/rehearsal request-shape sections of `test_phase7.py`; making the brief's own done-evidence command pass required the fixture remote change above. Not resolved silently.
- The README Run section still says `skipped_duplicate` is resolved through a canonical review reference and does not mention `--run-id`/`--tenant-id` or tenant verification; the brief assigns the README to 3-06, so it remains stale.

## Known problems / unfinished

- `report.py` still validates records by `case_id`, `manifest_hash` and `profile`. Real new-run rows are tag-only, so report reconciliation of real records is not correct until 3-04; the `test_phase7` fake keeps those legacy fields so the composed report assertion still passes.
- `get_reviews` remains a single `limit=500` GET with no cursor/complete handling; 3-03 replaces it.
- Duplicate completion trusts the cached body's identity fields and does not separately require `result`/`coverage`/`finding_counts` to be present for `ok`/`ok_partial` originals.
- No live-server evidence: the request shape and whoami contract are proven only against fixtures.

## Gates

- gate: live execution needs the deployed Yakka server, a dedicated `wk_` key and a matching `/v1/whoami` tenant/`read_write` identity; not available or exercised here.
- gate: any provider call, paid smoke or live trial requires Cody's explicit approval (3-05); out of scope.
- gate: a real certified full-history manifest and dedicated-tenant provisioning are operator prerequisites from 3-01/Phase 2.
- gate: README Run/duplicate wording update is owned by 3-06.
