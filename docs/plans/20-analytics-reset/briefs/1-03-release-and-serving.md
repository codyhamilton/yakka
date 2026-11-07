# Brief: 1-03 — Release and embedded serving

Consumer: Phase 1 integrator and the PR owner preparing a Pages-ready change; later release consumers.
Owned paths: `packages/yakka-analytics/wrangler.toml`, `tools/release/build.sh`, `tools/release/test_release.py`, `packages/yakka/internal/serve/site.go`, `packages/yakka/internal/serve/site_test.go`, `packages/yakka/internal/serve/analytics_pageset_test.go`, `Dockerfile`, `.dockerignore`, `.gitignore`, `docs/design/07-analytics-site.md`, `docs/design/system-architecture.md`, `docs/plans/20-analytics-reset/CONTRACTS.md`. Touch nothing else.
Commits: Leave changes in the working tree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/1-03-release-and-serving.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 1-01 — Deterministic fixture ledger; 1-02 — Framework-free shell.
Runs alongside: nothing.
Budget: 18 files to read, about 600 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 1 outcome and Serving, release and Pages domain.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — sections 1, 10.1–10.2, 11.1–11.6, 14 and 17.6; update only their Phase 1 target statements if made stale by the completed implementation.
3. `tools/release/build.sh` and `tools/release/test_release.py` — current build and release assertions.
4. `packages/yakka/internal/serve/site.go` and `site_test.go` — placeholder and embedded-serving behavior.

## Goal

Make the static web tree Pages-ready and embedded by the release process without Node/npm, while retaining the committed placeholder and enforcing the same generic cache and security policy in Pages and the Go handler.

## Contract

CONTRACTS.md 10.1–10.2, 11.1–11.4 and 17.6 are binding. Pages points at `./web` and does not build; the release script copies `web/` except `_headers`, embeds it before compile, fails on missing/placeholder `index.html`, and restores the committed placeholder on exit. In the Go server, index and fallback are `no-cache`; `vendor/<name>-<version>/…` is immutable; other files are `no-cache` with an ETag; security headers match `web/_headers`. The Pages automation is external; do not deploy or change it. Docker continues to serve the placeholder. Keep the layout README and existing release/layout checks coherent.

## Changes

Update only the owned build/config/serving/docs paths to consume 1-02's `web/` tree. Remove npm/build expectations from release checks; assert embedded assets and clean placeholder restoration. Update `site.go` and `site_test.go` together for generic cache, ETag, content type and security headers, with the test comparing the embedded CSP/framing policy to `web/_headers`. Align local cache-ignore rules and stale current-state docs/contract statements with the delivered Phase 1 target. Keep `analytics_pageset_test.go` aligned only with removed request assumptions that Phase 1 explicitly changes; do not implement later server range/entity work. Preserve the Docker placeholder behavior and `fly.toml`.

### Keep untouched

Do not push, merge, deploy, run `fly` or `wrangler`, alter external Pages automation, read or set secrets, or edit `fly.toml`. Do not rewrite server analytics routes, schemas, joins, or response contracts. Do not touch other plan artifacts. Do not commit generated embedded `site/` contents; the placeholder must remain the committed state after every build outcome.

## Done evidence

Identify the failing/missing release/serving checks before implementation and report their output before and after.

- Release check → runs with a PATH containing no Node/npm, embeds `web/`, and leaves `packages/yakka/internal/serve/site/` at the committed placeholder on success and failure.
- Embedded-serving check → direct route fallback, static MIME, generic cache policy, ETag revalidation, and CSP/frame headers match the policy in `web/_headers`.
- Repository checks → `wrangler.toml` uses `./web`; README layout checks pass; no stale Svelte build reference remains in active release docs; Docker remains placeholder-only.
- Pages external automation remains unverified from this repository; report that as a gate rather than attempting deployment.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.
