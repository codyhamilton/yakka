# Report: phase3-05 — Spend authorization gate and approved execution rehearsal

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `tools/shadow-review-trial/approval.py` (new) — read-only loader/validator for the local Cody authorization JSON: `schema_version`, `approval_reference`, `tenant_id`, exact `endpoint`, `manifest_sha256`, `run_id`, `preflight_sha256`, finite non-negative `authorized_max_usd`, UTC `expires_at`. `load(path, now=...)` takes the injected clock and raises explicit `ApprovalError`s for missing/malformed/wrong-schema/expired records; `check_binding`, `check_preflight` and `check_ceiling` enforce identity, the canonical dry-run digest (`preflight_digest`) and the ceiling. It never writes an approval.
- `tools/shadow-review-trial/runner.py` — `run` gained `approval_path` and `clock`. When `execute=True` it loads/binds the approval before `/v1/whoami` or any review POST; dry-run needs none. After preflight it checks the summary digest, then refuses execution unless `prior recorded charges + unknown-outcome reservations + retry-inclusive projection` fits both the approved ceiling and the independent cap. Prior charges come from recorded run-attempt `cost_usd` (attempt rows or receipt top-level); unfinished `started`/`started_unknown` claims reserve their retry-inclusive estimate. The dry-run summary now carries `readiness` (`ready`, `refused_over_cap`, `blocked_efforts`) beside per-case/per-effort estimates and aggregate projection. Cap refusal, claim-before-I/O and no-replay of started/unknown work are unchanged.
- `tools/shadow-review-trial/cli.py` — `run` gained `--approval`; it is passed through and `ApprovalError` is reported via the normal parser error. The loopback `smoke` command is unchanged and needs no approval.
- `tools/shadow-review-trial/test_approval.py` (new) — record schema/bounds/expiry/clock, canonical digest stability, and tenant/endpoint/manifest/run/preflight/ceiling mismatch refusals.
- `tools/shadow-review-trial/test_runner.py` — `FakeREST` run receipts now carry per-attempt cost; the execute helper mints a fixture approval from a dry-run summary. New tests prove missing/expired/mismatched approvals abort with zero provider calls, an exceeded-ceiling resume counts prior spend and unknown reservations without replay, and prior-spend uses recorded attempt or receipt cost.
- `tools/shadow-review-trial/test_phase7.py` — the composed rehearsal dry-runs, proves `--execute` without approval exits before any provider attempt, then runs manifest→run→adjudication→report on the fake endpoint with a bound approval; asserts cap/ceiling bounds and no live/deployed claim. The smoke test asserts no approval input.

## Checks

Before (tests written, implementation absent — exact done-evidence command):

```
Ran 3 tests in 0.000s
FAILED (errors=3)
ModuleNotFoundError: No module named 'approval'
```

After:

```
cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && \
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest \
  tools/shadow-review-trial/test_approval.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 33 tests in 12.939s
OK
$ git diff --check
(no output)
```

All temporary data stayed under `/home/codyh/workspace/.briefs/yakka/23b-test-tmp`; no `/tmp`, timing or sleep-based test, live server, provider, credential, deployment, Fly/Wrangler or paid step was used.

## Deviations

- Budget: read about 13 files (some ranges) and changed roughly 600 lines against `about 400`; the excess is the mandated new module plus its gate/resume/rehearsal tests. Tool turns stayed under 55.
- Endpoint matching is exact, so a trailing slash is a mismatch. This follows "exact `endpoint`".
- `preflight_sha256` covers the whole dry-run summary, including `cap_usd` and `readiness`; changing the cap/config changes the digest and therefore requires a renewed approval (treated as a plan change).
- The ceiling uses the full preflight projection for all arms, not just remaining arms, on resume. This is conservative: the brief says "prior spend plus unknown reservations plus the new retry-inclusive projection", and the digest binds the aggregate preflight.
- Prior charges use per-attempt `cost_usd`, falling back to the receipt's top-level `cost_usd` when `attempts` is absent (the server omits attempts on summary-detail receipts but still sets total cost).
- Reservations are added only for `started`/`started_unknown`; a known failure such as `timeout` is covered only by its recorded attempt cost.
- `test_runner`'s execute helper first runs a dry-run to mint a fixture approval; this mirrors the operator flow and keeps preflight receipts cached so provider-call counts are unchanged.
- No README edit; 3-06 owns the Run/Smoke wording.

## Contradictions

- DESIGN says execution is refused if projection exceeds the cap or approved amount. This unit also requires the approved ceiling to cover prior spend plus unknown reservations, per the brief's stricter sentence; the two are compatible because required exposure is never below the projection.
- "Test fixtures require no paid approval" vs "require the approval whenever `execute=True`": read as fixtures need a local approval record but no real-money authorization. Tests mint a fixture record; no paid approval is implied.
- No other contradiction found.

## Problems / unfinished

- Fixture-only proof: no live paged read, provider call, deployed smoke or real approval was exercised.
- An operator must obtain the preflight digest from `--dry-run` output themselves; there is no CLI flag that prints it (the README update is 3-06's).
- If a server receipt carries neither attempt costs nor a top-level cost, prior spend is counted as zero; an unfinished claim is still reserved. The real server sets `cost_usd`, so this is a fallback limitation, not observed behavior.
- `README.md` still omits `--approval` and the approval-gate workflow.

## Gates

- gate: any live provider call, paid smoke, retry or resumed work requires Cody's explicit written approval record (reference, tenant, endpoint, manifest/run, preflight digest, ceiling, expiry); the runner never creates it.
- gate: the authoritative preflight estimate must come from a real deployed Yakka server with a dedicated `wk_` key matching `/v1/whoami` tenant and `read_write` scope, using the Fly-held provider credential.
- gate: a certified full-history manifest (3-01) and dedicated synthetic-tenant provisioning are operator prerequisites.
- gate: no completed live trial or deployed smoke is claimed; that needs the approved operator run, evidence export, and a separate later smoke/live step.
- gate: re-price and re-preflight before spend approval (DESIGN Decision 24).
