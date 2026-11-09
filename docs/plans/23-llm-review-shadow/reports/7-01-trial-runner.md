Status: done with concerns

## What changed

Added `tools/shadow-review-trial/runner.py`, a reusable frozen-manifest runner with injected base URL, HTTP transport, and auth provider. It validates the manifest hash and case/run order; builds range requests from frozen captures and criteria; runs dry-run estimates for all three efforts; includes Phase 4's one bounded retry in projection; and returns the full projection before any live request when the caller's cap is exceeded. Its atomic ledger binds to the manifest and request identity, retains dry-run/run receipts and status, claims a live request before sending it, and never replays a started request after an ambiguous interruption. It retries zero-call preflight blocks when configuration or budget changes. It reconciles duplicate references against `GET /v1/reviews` and counts only matching manifest, case, effort, reviewer model, and `ok`/`ok_partial` records. It reports per-arm completion, shortfall, and the paired intersection.

Added fixture-only coverage in `tools/shadow-review-trial/test_runner.py`. The API's required non-empty `build_models` field is represented as the explicit `unknown` sentinel when that is what the frozen manifest records; curated model evidence passes through unchanged. Historical criteria text is sent as explicit frozen `criteria_text`, while its source and content hash remain bound through the validated manifest hash.

## Checks

Before changes, `python3 -m unittest tools/shadow-review-trial/test_runner.py` failed with `ModuleNotFoundError: No module named 'tools/shadow-review-trial/test_runner'` because the unit did not exist.

After changes, the same command passed: 8 tests, `OK`. Fixtures verify zero model calls during dry-run, per-case/per-effort estimates, retry-inclusive projection, cap refusal before live posts, invariant requests across effort arms, 50 completions and a 49-case shortfall, asymmetric arm counts and paired intersection, partial results, failures and mismatched models, duplicate reconciliation, preflight resume on changed budget, and no replay after a started request's transport interruption. `git diff --check` passed.

## Deviations, contradictions, unfinished work

No brief or design contradiction found. The `unknown` build-model sentinel is required by the REST request validator even though Phase 6 intentionally records unknown provenance; it preserves the explicit unknown rather than inventing a model. No unfinished work for Phase 7 integration. The runner is intentionally not wired into `cli.py`; 7-03 owns that boundary. No credentials were read or stored, and no live provider call, deployment, Fly, or Wrangler action was made.
