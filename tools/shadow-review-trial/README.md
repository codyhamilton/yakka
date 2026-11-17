# Shadow review historical trial

Operator tooling for preparing full history, freezing Phase 6 historical cases, running the Phase 7 trial against the real deployed Yakka server, and building its alignment report from complete evidence. The `manifest` command fetches and verifies full reachable history, then freezes a create-only certified manifest; it makes no provider calls. The `run` command talks only to the configured Yakka REST endpoint and never reads a provider credential. Tests and `smoke` use loopback fake endpoints and synthetic fixture auth; they never call a provider.

A real trial is an operator act, not a build-phase result. This README documents the workflow and its gates; it is not a run record. Never label a dry-run, fixture, preflight or docs-only run a completed live trial or deployed smoke.

## Operator prerequisites and gates

These are gates the operator must close before any live or paid action. Nothing here proves they are already met.

- `gate: full-history clone/population proof` — a deliberate full-history fetch from the configured remote, with non-shallow, object-complete and count agreement evidence, before a manifest is frozen.
- `gate: deployed-server target` — the real deployed Yakka server is the trial target; a loopback or fixture server is for tests only.
- `gate: provider credential held only by the server` — the provider credential stays server-side (Fly-held); no local machine receives it.
- `gate: manual browser walkthrough of reset/delete and re-selection` — a human verifies the profile lifecycle UI with a disposable tenant before relying on it. This gate applies to reset/delete only; it is not a trial prerequisite.

Operator preparation after the server is deployed: sign into the owner profile, create a dedicated tenant named `shadow-trial` (or `synthetic`) through the existing create/token routes, and issue a separate `read_write` `wk_` key. Record the immutable tenant id, not just its name. With the server-held `CLAUDE_API_TOKEN`, any authenticated tenant's repo is reviewable: there is no allowlist and no per-repo setup. Confirm the key's identity with `whoami` (`GET /v1/whoami` returns the dedicated tenant and `read_write` scope) before any capture; abort on a real-work mismatch. Provisioning, configuration, deployment and token handling are later operator acts, not part of this tool.

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
  --reviewer-model claude-haiku-5-5 \
  --run-id trial-2026-11-10a --tenant-id <synthetic-tenant-id> \
  --dry-run
```

`--run-id` (1–32 characters from `[A-Za-z0-9_-]`) and `--tenant-id` are required; the run is bound to the dedicated tenant, and the ledger is bound to the manifest hash, run id and tenant id. Before any review POST the runner calls `GET /v1/whoami` and refuses unless it returns the expected tenant with `read_write` scope. The base URL and auth token are explicit inputs; the runner does not discover credentials.

Calls use the general review contract, not the legacy trial object: `effort` (`high`/`xhigh`/`max`), `store: true`, and the canonical tags `trial:<run-id>`, `effort:<level>`, `manifest:<sha256>` and `case:<sha256-of-case-id>`. A supplied tag set that disagrees with the request effort/run/manifest/case is rejected, as are out-of-bound tags.

Dry-run is the default; `--dry-run` makes that mode explicit. It is the non-spending probe: it posts one dry-run per case and effort, makes no provider call and needs no local spend record. Only `unavailable` blocks execution; `skipped_busy` and legacy `skipped_budget` responses are transient and never block. The probe reports which efforts are ready; there are no estimates or caps and no exposure figures.

`--execute` runs after its non-spending checks: the `whoami` tenant/scope match, a dry-run that returns no `unavailable`, and the frozen-manifest/ledger binding. It needs no local authorisation file and no cap. Spend is governed by the provider account; Yakka and this tool only record actual cost from each receipt in the ledger. Resume reuses the same run id, tags and ledger, reposts work that returned `skipped_busy`, and never replays `started`/`started_unknown` work. Claim-before-I/O is unchanged.

## Report

```bash
python3 tools/shadow-review-trial/cli.py report \
  --manifest tools/shadow-review-trial-data/manifest.json \
  --records tools/shadow-review-trial-data/run-export.json \
  --ledger tools/shadow-review-trial-data/run-ledger.json \
  --adjudication tools/shadow-review-trial-data/adjudication.json \
  --output tools/shadow-review-trial-data/alignment-report.json \
```

`--records` is the certified saved export produced by the runner's paged reader, which walks `GET /v1/reviews` to exhaustion with `detail=full`, the fixed `manifest:<sha256>` and `trial:<run-id>` filters, an explicit page size and the returned `cursor`. Every page carries `cursor_in`, `cursor_out`, `complete`, `row_count` and `row_ids_sha256`, and the export carries the terminal state and the flat `reviews`. The report refuses a bare `{"reviews":[...]}`, a legacy 500-row export, or any partial, looping, truncated, hash-mismatched or error page; it never reports `complete` from partial data.

The exported `filters`, high-water identity carried in the cursor chain, page chain and counts are validated before calculation. `--ledger` is the frozen run journal; the report selects only the run's canonical review ids, checks their canonical tags and tenant/effort/case, and counts completion, attempts and usage/cost from canonical records alone. Duplicate receipts, unrelated tenant/run rows and wrong-model rows are exclusions and add no completed case or cost. Adjudication is version 1 JSON with `low_sample_rate` and `findings`; comparator evidence defaults to the frozen manifest and can be supplied with `--comparators`. The report is deterministic for the same frozen inputs, reports per-effort/paired counts and honest shortfalls, and writes its full provenance and result to `--output`. Cost comes from the ledger's canonical run receipts: actual cost per case, per effort and for the whole run. An unknown cost (`cost_usd` null with `cost_known: false`) is counted as unknown, never estimated; `skipped_busy` and legacy `skipped_budget` records are accepted.

`--output` receives the JSON report. The CLI also writes a deterministic rendered Markdown summary at the sibling path `output.with_suffix(".md")` (for example `alignment-report.json` → `alignment-report.md`) and prints `report`, `summary`, `manifest_sha256`, `report_sha256`, `arms` and `usage`. The summary is pure formatting of the report, with a fixed section order: **Population**; **Comparisons (a)–(g)**; **Validation controls**; **Reproducibility**; **Reconciliation**. It prints no path, commit SHA, diff line, outcome excerpt, finding title or case list, and carries no timestamp, host or run-time content.

The JSON report carries the `population` section (eligible, frozen, attempted, completed, failures and exclusions by reason, tier breakdowns and shortfalls); the `comparisons` section with the keys `finding_recall`, `fix_recall`, `corroboration`, `verdict_agreement`, `severity_agreement` and `paired_deltas`; the `validation` controls; `cost_latency`; `reproducibility` (including `report_sha256`); and `reconciliation`. Every recall figure appears beside its shuffled-comparator null, every match carries a `structural` or `adjudicated` method tag, and the paired deltas use seeded bootstrap intervals on the common completed cases.

Adjudication version 1 is extended with optional `second_label`, `labeler_model` and `second_labeler_model` fields; double-labelled pairs produce Cohen's kappa. Review-finding decisions use the `valid`, `invalid` and `unknown` categories in addition to the new-finding categories, while historical comparator decisions use `matched`, `partial` and `unmatched`.

### Leak check

> **Leak check.** The trial reconstructs every request the runner would send
> from the frozen manifest (`runner.build_request`) and resolves each capture
> diff section by its `diff --git` path. It fails the report when a diff
> *section* is the case's own `docs/plans/<plan>/REVIEW.md`,
> `IMPLEMENTATION.md` or `DESIGN.md`, or when a distinctive recorded outcome
> excerpt appears in the non-plan diff bodies or criteria text
> (`scope: case_plan_and_outcome_excerpts`). A code or prose line that merely
> names an own-plan document is not a leak. Outcome excerpts are searched only
> when normalised to at least `min_excerpt_words` (5) words; shorter boilerplate
> is counted in `short_excerpts_skipped` and not searched. Sections under any
> other plan's `docs/plans/` folder are counted once per case as
> `foreign_plan_document_captures` and never fail the check, and their bodies
> are excluded from the outcome-excerpt search.

The request check covers the case's own plan document sections and distinctive recorded outcome excerpts outside every plan-document section. Changed files under another plan's `docs/plans/` folder are counted as `foreign_plan_document_captures`, not failed, because Phase 3 strips only the case's own plan folder. No path, SHA, excerpt or diff line is printed.

### Evidence check

```bash
python3 tools/shadow-review-trial/cli.py evidence-check --folder tools/shadow-review-trial-data/
```

`evidence-check` is the metric-only pre-commit gate. It exits non-zero and names the offenders when the folder contains a manifest or certified export, and prints `{"evidence_check": "pass", "folder": ..., "files_checked": n}` when the folder holds only aggregate, metric-only files such as the report JSON and its summary.

## Smoke

```bash
python3 tools/shadow-review-trial/cli.py smoke
```

Smoke starts a loopback fake REST server, checks a synthetic successful receipt and verifies that a synthetic `read`-scope identity cannot POST. It prints only the review id, status, returned model, input/output token counts, cost and refusal result. It reads no credential and makes no live or provider call; it needs no local spend record. Smoke is a fixture check, not a deployed smoke: never label it, any other fixture, a preflight or a docs-only run a completed live trial or deployed smoke.

## Trial evidence format

A later real run records its evidence under `docs/lab/RESEARCH/<YYYY-MM-DD>-shadow-review-trial/` (see the [research index](../../docs/lab/RESEARCH/INDEX.md) for the folder convention). Do not create a run folder or any fabricated run data in this docs unit; this is the format a real operator run must fill.

- `INDEX.md` — run identity (server, tenant, run id, model, efforts, date), status, and links to the artifacts below.
- Certified export — the saved cursor-paged `detail=full` export with filters, high-water/cursor chain, page counts and terminal completeness evidence.
- Manifest evidence — certified manifest and its frozen history: `manifest_sha256`, repository/tip, fetched refs, non-shallow/object-complete flags, verified count and eligible population/shortfalls.
- Run ledger — the frozen run journal with per-case/per-effort records, canonical review ids and actual usage/cost.
- Report — per-effort and paired completed counts with honest shortfalls, actual cost, exclusions, adjudication summary and the alignment report.
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

**Consumers**: Plan 23 Phase 7 operator preparing full history, freezing a certified manifest, running a historical trial against the deployed server, exporting complete evidence and preparing alignment reports.

**Build**: Python 3 standard library, Git, Phase 1 `CaptureChange`, and the Yakka REST review/whoami endpoints for an explicitly invoked trial.

**Test**: `python3 -m unittest tools/shadow-review-trial/test_phase7.py tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py`; fixture-only loopback endpoints and synthetic auth, no provider calls.

**Release**: Maintainer-only local tooling; fetch full history, freeze the manifest, run the non-spending dry-run probe, and then run an explicitly enabled historical trial.
