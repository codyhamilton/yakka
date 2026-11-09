# Brief: 4-03 — Provider call and reply validation

Consumer: Plan 23 Phase 4 review orchestration.
Owned paths: new provider request and response-validation files under `packages/yakka/internal/review/`, their focused tests, and `docs/plans/23-llm-review-shadow/reports/4-03-provider-call-validation.md`. Do not modify `build.go`, `criteria.go`, REST routes, persistence, or pricing files. Touch nothing else.
Commits: Commit implementation and report when done evidence passes, with a plain-summary title.
Report: Before committing, write the report named above (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: 4-01 and 4-02; keep changes to provider-owned files and tests only.
Budget: 10 files to read, about 850 lines to change, 35 tool turns. Past the budget, stop and report an actionable handoff.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain: Review run, Prompt order, One call, Result schema, Validation, and Phase 4 Outcome.
2. `packages/yakka/internal/review/build.go` — `Packet` contract and existing prompt output.
3. `packages/yakka/internal/secrets/` — established secret scan and redaction patterns.
4. Go HTTP client and fake-server test patterns in `packages/yakka/internal/`.

## Goal

Implement the one-request Claude Messages transport and mechanical parsing/support validation of its reply as a small interface the Phase 4 orchestrator can call with a built packet.

## Contract

Binding design text:

> “one HTTPS `POST` to the Claude Messages API, Go standard library, no tools, no streaming, no second call to repair output, no new dependency.” (Domain: Review run, One call)

> “Validation is mechanical: JSON parses; enums valid; each excerpt a substring of the untrusted section; each cited path and line inside an included hunk; each criterion id exists. A finding failing a support check is kept, flagged `unsupported` and counted separately, never repaired or dropped. A reply that fails to parse or validate is `invalid_output`.” (Domain: Review run, Validation)

> “The reviewer’s reply is scanned the same way before it is stored: a hit is redacted in place with the existing redaction and the record flagged `reply_redacted`” (Domain: Review run)

The endpoint remains a constant in production. Tests inject the fake endpoint through a constructor argument, never process configuration. The orchestrator consumes the request/result API; report its exact type and call shape for unit 4-04.

## Changes

- Add an injectable standard-library HTTP transport that sends one bounded JSON request with the role-first packet, exact configured model and effort, `max_tokens`, and credential only in the authentication header. It must not send tools or stream.
- Bound response bytes and classify provider responses without echoing provider error bodies. Keep the credential and prompt out of errors and logs.
- Parse and validate the exact schema in Domain: Review run against `Packet` and resolved criteria. Unsupported/short evidence is retained and flagged; malformed JSON, invalid enums, missing/duplicate criterion outcomes, or other schema violations yield `invalid_output`.
- Scan and redact reply secrets before returning the result to persistence, preserving the `reply_redacted` signal.

### Keep untouched

- Do not add SDKs, retries, scheduling, provider selection, repair calls, environment reads, or credentials.
- Do not change packet construction or criteria resolution.

## Done evidence

- Fake HTTP server fixtures assert exact URL/method/header/body shape, one request, bounded body handling, no secret leakage, and provider error classification.
- Validator fixtures cover valid output, every enum, criterion coverage, evidence substring and path/line support, unsupported evidence retention, malformed/duplicate/missing output, and secret redaction.
- Focused review package tests pass under an 8 GiB address-space cap and Go `-p=3`; `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, the exported interface for unit 4-04, deviations, contradictions, unfinished work, and known problems. No credentials, provider calls, deploys, Fly, Wrangler, or paid/live review steps.
