# Shadow review historical trial

Operator tooling for preparing full history, freezing Phase 6 historical cases, running the Phase 7 trial against the real deployed Yakka server, and building its alignment report from complete evidence. The `manifest` command fetches and verifies full reachable history, then freezes a create-only certified manifest; it makes no provider calls. The `run` command talks only to the configured Yakka REST endpoint and never reads a provider credential. Tests and `smoke` use loopback fake endpoints and synthetic fixture auth; they never call a provider.

A real trial is an operator act, not a build-phase result. This README documents the workflow and its gates; it is not a run record. Never label a dry-run, fixture, preflight or docs-only run a completed live trial or deployed smoke.

## Operator prerequisites and gates

These are gates the operator must close before any live or paid action. Nothing here proves they are already met.

- `gate: full-history clone/population proof` — a deliberate full-history fetch from the configured remote, with non-shallow, object-complete and count agreement evidence, before a manifest is frozen.
- `gate: deployed-server readiness` — the real deployed Yakka server is the trial target; a loopback or fixture server is for tests only.
- `gate: provider credential held only by the server` — the provider credential stays server-side (Fly-held); no local machine receives it.
- `gate: Cody's separate explicit spend approval before any live or paid run` — a local approval record is required before `--execute`, any retry, resumed work or paid smoke. `--execute` alone is not authorization.
- `gate: manual browser walkthrough of reset/delete and re-selection before operator use` — a human verifies the profile lifecycle UI with a disposable tenant before relying on it.

Operator preparation after the server is deployed: sign into the owner profile, create a dedicated tenant named `shadow-trial` (or `synthetic`) through the existing create/token routes, and issue a separate `read_write` `wk_` key. Record the immutable tenant id, not just its name. Add `<synthetic-tenant-id>/<repo_id>` to `YAKKA_REVIEW_REPOS` through normal operator configuration. Confirm the key's identity with `whoami` (`GET /v1/whoami` returns the dedicated tenant and `read_write` scope) before any capture; abort on a real-work mismatch. Provisioning, configuration, deployment and token handling are later operator acts, not part of this tool.

## Owner-only trial cleanup (Plan 23 follow-up)

Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.

The [amended Phase 2](../../docs/plans/23-llm-review-shadow.md) implements these operations
through the API-origin profile UI. There is no lifecycle MCP tool or runner cleanup command. The
trial's `wk_` key is for reviews, never reset/delete.

Recommended operator path: preserve and export the needed trial evidence first (see **Trial evidence format** below), then the human opens the API-origin profile UI (navigate there from Pages), chooses the disposable trial tenant, selects **Delete**, types its immutable id and confirms. Delete removes the entire tenant and all assets. Optional **Reset** keeps id/name/ownership but wipes data and revokes all old keys; reuse requires deliberate re-selection, a refreshed generation/read state and a newly issued key. Both require the owner cookie, exact API Origin, same-origin Fetch-Site when present, `X-Yakka-UI: tenant-lifecycle`, JSON and matching `confirm_tenant_id`. The UI sends no bearer; key calls, including key-plus-cookie, fail specifically with `403 tenant_lifecycle_ui_only`. Do not automate cleanup or spoof these headers.

Deleting/resetting the selected or only tenant is permitted with confirmation. Success clears selection/caches/cursors and forces explicit re-selection/create while keeping global sign-in; rejection/cancellation has no effects. Legacy tenants without trustworthy creation/ownership coverage return `409 legacy_tenant_cleanup_unsupported` before cleanup; use a fresh eligible trial tenant. The gate is a spoofable guardrail, not proof of personhood; future human verification/captcha is explicitly deferred. A timeout is not proof of success and must not trigger automatic replay.

## Manifest

```bash
python3 tools/shadow-review-trial/cli.py manifest \
  --repo . --output tools/shadow-review-trial-data/manifest.json --seed 23 \
  --remote origin --expected-repository codyhamilton/yakka
```

The command prepares history before enumeration. It resolves the configured remote (default `origin`), normalizes and compares its identity to `--expected-repository` (default `codyhamilton/yakka`), fetches or unshallows the remote, fetches its `HEAD`, and requires `git rev-parse --is-shallow-repository=false` plus a missing-object check. It records the resolved default-branch tip, fetched refs, `git rev-list --count <tip>` and the full enumeration, and refuses to freeze when history is still shallow or incomplete, the remote identity is wrong, the count is missing, or the count disagrees with enumeration. Freeze happens before any output is opened, so a refusal writes no partial manifest. Fetching lives here only; the shim and change reader stay network-free. An old shallow manifest cannot be certified by relabeling it.

The manifest freezes that history evidence (repository, remote, tip, refs, nonshallow, object-complete, enumerated and verified counts) and records every candidate with its eligibility reason. Each candidate capture uses its first parent as base and the commit as head. Criteria come from the plan `DESIGN.md` blob at that head and carry its Git blob id; candidates without historical criteria are retained as ineligible with `criteria_unavailable`. Build-model provenance remains explicitly `unknown` unless supplied as curated evidence. Phase comparator pointers use the phase `IMPLEMENTATION.md` and `REVIEW.md`; PR pointers use `REVIEW.md`. Comparator paths are excluded from the captured change. The output includes eligible phase, PR, and unaccompanied counts, separate `high`, `xhigh`, and `max` eligible and completed shortfalls, fixed shared-case settings, and a persisted deterministic run order.

The output path is create-only. If it already exists, the command refuses to refresh the frozen case set. Choose a new output path to create a new manifest after changing local history or evidence.

## Run

```bash
python3 tools/shadow-review-trial/cli.py run \
  --manifest tools/shadow-review-trial-data/manifest.json \
  --ledger tools/shadow-review-trial-data/run-ledger.json \
  --base-url https://yakka.example \
  --auth-token "$YAKKA_ACCESS_TOKEN" \
  --reviewer-model claude-haiku-5-5 --cap-usd 10 \
  --run-id trial-2026-11-10a --tenant-id <synthetic-tenant-id> \
  --dry-run
```

`--run-id` (1–32 characters from `[A-Za-z0-9_-]`) and `--tenant-id` are required; the run is bound to the dedicated tenant, and the ledger is bound to the manifest hash, run id and tenant id. Before any review POST the runner calls `GET /v1/whoami` and refuses unless it returns the expected tenant with `read_write` scope. The base URL and auth token are explicit inputs; the runner does not discover credentials.

Calls use the general review contract, not the legacy trial object: `effort` (`high`/`xhigh`/`max`), `store: true`, and the canonical tags `trial:<run-id>`, `effort:<level>`, `manifest:<sha256>` and `case:<sha256-of-case-id>`. A supplied tag set that disagrees with the request effort/run/manifest/case is rejected, as are out-of-bound tags.

Dry-run is the default; `--dry-run` makes that mode explicit. A dry-run makes zero provider calls and is allowed before approval. It posts per-case, per-effort and retry-inclusive estimates plus aggregate exposure, and refuses execution when the projection exceeds `--cap-usd`. It reports `readiness` (`ready`, `refused_over_cap`, `blocked_efforts`); it is an estimate, not a reservation or proof of credential acceptance.

`--execute` requires a local Cody approval artifact supplied with `--approval`. `--execute` alone is not authorization. The approval is JSON with `schema_version`, `approval_reference`, `tenant_id`, exact `endpoint`, `manifest_sha256`, `run_id`, `preflight_sha256` (the SHA-256 of the canonical dry-run summary the operator approved), finite non-negative `authorized_max_usd` and a UTC `expires_at`. The runner validates it before any whoami or review call, refuses missing/malformed/expired/mismatched records, and never creates approval itself. Execution is refused unless prior recorded charges plus unknown-outcome reservations plus the retry-inclusive projection fit both the supplied cap and the approved ceiling. Resume reuses the same run id, tags and ledger; prior spend and unknown outcomes count against the same ceiling, and a changed plan, cap or config needs renewed explicit approval. Claim-before-I/O and no-blind-replay of `started`/`started_unknown` work are unchanged.

## Report

```bash
python3 tools/shadow-review-trial/cli.py report \
  --manifest tools/shadow-review-trial-data/manifest.json \
  --records tools/shadow-review-trial-data/run-export.json \
  --ledger tools/shadow-review-trial-data/run-ledger.json \
  --adjudication tools/shadow-review-trial-data/adjudication.json \
  --output tools/shadow-review-trial-data/alignment-report.json \
  --cap-usd 10
```

`--records` is the certified saved export produced by the runner's paged reader, which walks `GET /v1/reviews` to exhaustion with `detail=full`, the fixed `manifest:<sha256>` and `trial:<run-id>` filters, an explicit page size and the returned `cursor`. Every page carries `cursor_in`, `cursor_out`, `complete`, `row_count` and `row_ids_sha256`, and the export carries the terminal state and the flat `reviews`. The report refuses a bare `{"reviews":[...]}`, a legacy 500-row export, or any partial, looping, truncated, hash-mismatched or error page; it never reports `complete` from partial data.

The exported `filters`, high-water identity carried in the cursor chain, page chain and counts are validated before calculation. `--ledger` is the frozen run journal; the report selects only the run's canonical review ids, checks their canonical tags and tenant/effort/case, and counts completion, attempts and usage/cost from canonical records alone. Duplicate receipts, unrelated tenant/run rows and wrong-model rows are exclusions and add no completed case or cost. Adjudication is version 1 JSON with `low_sample_rate` and `findings`; comparator evidence defaults to the frozen manifest and can be supplied with `--comparators`. The report is deterministic for the same frozen inputs, reports per-effort/paired counts and honest shortfalls, and writes its full provenance and result to `--output`.

## Smoke

```bash
python3 tools/shadow-review-trial/cli.py smoke
```

Smoke starts a loopback fake REST server, checks a synthetic successful receipt and verifies that a synthetic `read`-scope identity cannot POST. It prints only the review id, status, returned model, input/output token counts, cost and refusal result. It reads no credential and makes no live or provider call; it needs no spend approval. Smoke is a fixture check, not a deployed smoke: never label it, any other fixture, a preflight or a docs-only run a completed live trial or deployed smoke.

## Trial evidence format

A later real run records its evidence under `docs/lab/RESEARCH/<YYYY-MM-DD>-shadow-review-trial/` (see the [research index](../../docs/lab/RESEARCH/INDEX.md) for the folder convention). Do not create a run folder or any fabricated run data in this docs unit; this is the format a real operator run must fill.

- `INDEX.md` — run identity (server, tenant, run id, model, efforts, date), status, and links to the artifacts below.
- Certified export — the saved cursor-paged `detail=full` export with filters, high-water/cursor chain, page counts and terminal completeness evidence.
- Manifest evidence — certified manifest and its frozen history: `manifest_sha256`, repository/tip, fetched refs, non-shallow/object-complete flags, verified count and eligible population/shortfalls.
- Approval reference — the local approval record reference, tenant, endpoint, manifest/run, preflight digest, ceiling and expiry. Never commit the credential or token; a reference to the approved record is enough.
- Run ledger — the frozen run journal with per-case/per-effort records, canonical review ids and usage/cost.
- Report — per-effort and paired completed counts with honest shortfalls, exclusions, adjudication summary and the alignment report.
- Cleanup record — the human's note that evidence was preserved and exported before the disposable tenant was deleted (or reset and deliberately re-selected), with date and observed outcome. Not an auto-generated claim.

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

**Consumers**: Plan 23 Phase 7 operator preparing full history, freezing a certified manifest, running an approval-gated historical trial against the deployed server, exporting complete evidence and preparing alignment reports.

**Build**: Python 3 standard library, Git, Phase 1 `CaptureChange`, and the Yakka REST review/whoami endpoints for an explicitly invoked, approved trial.

**Test**: `python3 -m unittest tools/shadow-review-trial/test_phase7.py tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py tools/shadow-review-trial/test_approval.py`; fixture-only loopback endpoints and synthetic auth, no provider calls.

**Release**: Maintainer-only local tooling; fetch full history, freeze the manifest, read the retry-inclusive dry-run preflight, obtain Cody's separate spend approval, and only then run an explicitly enabled historical trial.
