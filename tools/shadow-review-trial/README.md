# Shadow review historical trial

Local tools for freezing Phase 6 historical cases, running the Phase 7 trial, and building its alignment report. The `manifest` command uses local Git objects and the Phase 1 `CaptureChange` range API; it makes no network or provider calls and needs no credentials. The `run` command talks only to the configured Yakka REST endpoint. Tests and `smoke` use loopback fake endpoints and synthetic fixture auth; they never call a provider.

## Owner-only trial cleanup (Plan 23 follow-up)

Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.
The [amended Phase 2](../../docs/plans/23-llm-review-shadow/DESIGN.md) implements these operations
through the API-origin profile UI. There is no lifecycle MCP tool or runner cleanup command. The
trial's `wk_` key is for reviews, never reset/delete.

Recommended operator path: preserve needed trial exports/evidence, then the
human opens the API-origin profile UI (navigate there from Pages), chooses the disposable trial
tenant, selects **Delete**, types its immutable id and confirms. Delete removes the entire tenant
and all assets. Optional **Reset** keeps id/name/ownership but wipes data and revokes all old keys;
reuse requires deliberate re-selection and a newly issued key. Both require the owner cookie,
exact API Origin, same-origin Fetch-Site when present, `X-Yakka-UI: tenant-lifecycle`, JSON and
matching `confirm_tenant_id`. The UI sends no bearer; key calls, including key-plus-cookie, fail
specifically with `403 tenant_lifecycle_ui_only`. Do not automate cleanup or spoof these headers.

Deleting/resetting the selected or only tenant is permitted with confirmation. Success clears
selection/caches/cursors and forces explicit re-selection/create while keeping global sign-in;
rejection/cancellation has no effects. Legacy tenants without trustworthy creation/ownership
coverage return `409 legacy_tenant_cleanup_unsupported` before cleanup; use a fresh eligible trial
tenant. The gate is a spoofable guardrail, not proof of personhood; future human verification/captcha
is explicitly deferred. A timeout is not proof of success and must not trigger automatic replay.

## Manifest

```bash
python3 tools/shadow-review-trial/cli.py manifest \
  --repo . --output tools/shadow-review-trial-data/manifest.json --seed 23
```

The command enumerates reachable commits, records every candidate and its eligibility reason, and records shallow history plus boundary SHAs. Each candidate capture uses its first parent as base and the commit as head. Criteria come from the plan `DESIGN.md` blob at that head and carry its Git blob id; candidates without historical criteria are retained as ineligible with `criteria_unavailable`. Build-model provenance remains explicitly `unknown` unless supplied as curated evidence. Phase comparator pointers use the phase `IMPLEMENTATION.md` and `REVIEW.md`; PR pointers use `REVIEW.md`. Comparator paths are excluded from the captured change. The output includes eligible phase, PR, and unaccompanied counts, separate `high`, `xhigh`, and `max` eligible and completed shortfalls, fixed shared-case settings, and a persisted deterministic run order.

The output path is create-only. If it already exists, the command refuses to refresh the frozen case set. Choose a new output path to create a new manifest after changing local history or evidence.

## Run

```bash
python3 tools/shadow-review-trial/cli.py run \
  --manifest tools/shadow-review-trial-data/manifest.json \
  --ledger tools/shadow-review-trial-data/run-ledger.json \
  --base-url https://yakka.example \
  --auth-token "$YAKKA_ACCESS_TOKEN" \
  --reviewer-model claude-haiku-5-5 --cap-usd 10 --dry-run
```

Dry-run is the default; `--dry-run` makes that mode explicit. The runner posts estimates for each case and effort, includes the bounded retry exposure, and refuses execution when the projection exceeds `--cap-usd`. Add `--execute` to run after preflight. The base URL and auth provider are explicit inputs; the runner does not discover credentials. It persists each started case/effort in the ledger before the request. On resume it reconciles GET records first and will not repeat an ambiguous started request. A `skipped_duplicate` receipt is resolved through its canonical review reference and counts only when that stored record matches the manifest, case, effort and reviewer model.

## Report

```bash
python3 tools/shadow-review-trial/cli.py report \
  --manifest tools/shadow-review-trial-data/manifest.json \
  --records tools/shadow-review-trial-data/get-records.json \
  --adjudication tools/shadow-review-trial-data/adjudication.json \
  --output tools/shadow-review-trial-data/alignment-report.json \
  --cap-usd 10
```

`--records` is a saved `GET /v1/reviews` response with a `reviews` array, or that array directly. Adjudication is version 1 JSON with `low_sample_rate` and `findings`; comparator evidence defaults to the frozen manifest and can be supplied with `--comparators`. The report is deterministic for the same frozen inputs and writes its full result to `--output`.

## Smoke

```bash
python3 tools/shadow-review-trial/cli.py smoke
```

Smoke starts a loopback fake REST server, checks a synthetic successful receipt and verifies that a synthetic `read`-scope identity cannot POST. It prints only the review id, status, returned model, input/output token counts, cost and refusal result. It reads no credential and makes no live or provider call.

## Comparator evidence

`--comparators` accepts JSON with this shape:

```json
{
  "version": 1,
  "findings": [{
    "id": "phase-1-f1",
    "stratum": "phase",
    "head_sha": "<full commit SHA>",
    "text": "A curated historical finding",
    "citations": [{
      "path": "docs/plans/example/IMPLEMENTATION.md",
      "sha": "<same full commit SHA>",
      "blobhash": "<Git blob id>",
      "line_start": 12,
      "line_end": 13
    }]
  }],
  "build_models": {"<full commit SHA>": ["curated-model-id"]}
}
```

Every citation is checked against the cited commit's Git blob and line range, and must point into the candidate plan's phase or PR review source. The curated file's SHA-256 is bound into the manifest. A local PR review export can be supplied separately with `--pr-export`; it is keyed by a PR candidate `head_sha`, independently SHA-256 hashed, and kept distinct from curated phase and PR comparators.

## Layout contract

**Consumers**: Plan 23 Phase 7 operator running historical trials and preparing alignment reports.

**Build**: Python 3 standard library, Git, Phase 1 `CaptureChange`, and the Yakka REST review endpoint for an explicitly invoked trial.

**Test**: `python3 -m unittest tools/shadow-review-trial/test_phase7.py tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_report.py`; fixture-only loopback endpoints and synthetic auth, no provider calls.

**Release**: Maintainer-only local tooling; freeze the manifest and review the cost preflight before an explicitly enabled historical trial run.
