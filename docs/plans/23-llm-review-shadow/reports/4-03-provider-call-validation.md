# 4-03 Provider call and reply validation

Status: done with concerns

Implemented the single-request Claude Messages transport and strict result validation in `packages/yakka/internal/review/provider.go` and `validate.go`. Requests carry the packet prompt as one user message, configured model and effort, fixed `max_tokens: 8000`, and credentials only in `x-api-key`; the production URL is constant, with endpoint injection for fake-server tests. Request and response sizes are bounded, provider error bodies are not returned, and 401/403 maps to `credential_rejected`. Reply validation enforces schema, enums, and exact criterion outcome coverage. Findings with short or unsupported evidence, path/line, or criterion references are retained and flagged; reply secrets are redacted and set `reply_redacted`.

Interface for 4-04:

```go
func NewReviewer(token, model, effort, endpoint string) *Reviewer
func (r *Reviewer) Review(ctx context.Context, packet Packet, criteria []Criterion) (Result, error)
```

`endpoint` should be `ClaudeMessagesEndpoint` in production. `Result` includes returned model/token usage, outcomes, findings, limitations, coverage, `UnsupportedFindings`, and `ReplyRedacted`. `NewReviewerWithClient` is also exported for transport tests.

Evidence:

- `ulimit -v 8388608 && go test -p=3 ./internal/review` (from `packages/yakka`): `ok github.com/codyhamilton/yakka/packages/yakka/internal/review 0.649s`.
- `git diff --cached --check`: clean (no output).
- Fake-server tests cover method/path/headers/body, one request, bounded response, safe provider errors; validator tests cover enums, criterion coverage, malformed/duplicate/missing outcomes, evidence and location support, retained unsupported findings, and secret redaction.

Departure and contradiction: existing `TestBuildPackageHasNoNetworkOrEnvironmentImports` scanned every production file in the package, conflicting with this brief's required `net/http` transport. Narrowed the check to `build.go`, preserving the offline restriction on packet construction. This is why status is `done with concerns`.

Unfinished work: none. Known problems: none observed. No credentials or live provider calls were used.
