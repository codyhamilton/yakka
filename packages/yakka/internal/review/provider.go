package review

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	claudeMessagesURL = "https://api.anthropic.com/v1/messages"
	claudeAPIVersion  = "2023-06-01"
	maxReplyBytes     = 2 << 20
	maxPacketBytes    = 2 << 20
	maxTokens         = 8000
)

// ProviderStatus is a safe, body-free provider failure classification.
type ProviderStatus string

const (
	ProviderTimeout  ProviderStatus = "timeout"
	ProviderAPIError ProviderStatus = "api_error"
	ProviderInvalid  ProviderStatus = "invalid_output"
)

// ProviderError never includes the request, credential, or provider response body.
type ProviderError struct {
	Status     ProviderStatus
	HTTPStatus int
}

func (e *ProviderError) Error() string {
	if e.HTTPStatus != 0 {
		return fmt.Sprintf("%s: provider HTTP %d", e.Status, e.HTTPStatus)
	}
	return string(e.Status)
}

// Result is a mechanically validated reviewer response. Unsupported findings
// remain in Findings and are counted in UnsupportedFindings.
type Result struct {
	Model               string    `json:"model"`
	InputTokens         int       `json:"input_tokens"`
	OutputTokens        int       `json:"output_tokens"`
	Outcomes            []Outcome `json:"outcomes"`
	Findings            []Finding `json:"findings"`
	Limitations         []string  `json:"limitations"`
	Coverage            string    `json:"coverage"`
	UnsupportedFindings int       `json:"unsupported_findings"`
	ReplyRedacted       bool      `json:"reply_redacted"`
}

// Reviewer makes exactly one Claude Messages request and validates its reply.
type Reviewer struct {
	client   *http.Client
	endpoint string
	token    string
	model    string
	effort   string
}

// NewReviewer creates the production transport. endpoint is injectable for
// tests; production callers should pass the constant ClaudeMessagesEndpoint.
func NewReviewer(token, model, effort, endpoint string) *Reviewer {
	if endpoint == "" {
		endpoint = claudeMessagesURL
	}
	return NewReviewerWithClient(token, model, effort, endpoint, &http.Client{Timeout: 120 * time.Second})
}

// ClaudeMessagesEndpoint is the fixed production endpoint.
const ClaudeMessagesEndpoint = claudeMessagesURL

// NewReviewerWithClient is useful for deterministic HTTP transport tests. The
// injected endpoint remains an explicit constructor argument, never config.
func NewReviewerWithClient(token, model, effort, endpoint string, client *http.Client) *Reviewer {
	if endpoint == "" {
		endpoint = claudeMessagesURL
	}
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	return &Reviewer{client: client, endpoint: endpoint, token: token, model: model, effort: effort}
}

type messagesRequest struct {
	Model        string       `json:"model"`
	MaxTokens    int          `json:"max_tokens"`
	Messages     []message    `json:"messages"`
	OutputConfig outputConfig `json:"output_config"`
}
type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type outputConfig struct {
	Effort string `json:"effort"`
}
type messagesResponse struct {
	Model   string `json:"model"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// Review sends packet.Prompt as the sole user message, then validates the
// returned JSON against criteria and packet-supported diff locations.
func (r *Reviewer) Review(ctx context.Context, packet Packet, criteria []Criterion) (Result, error) {
	if r == nil || r.client == nil || r.endpoint == "" || r.token == "" || r.model == "" || r.effort == "" {
		return Result{}, errors.New("review provider unavailable: configuration missing")
	}
	if len(packet.Prompt) == 0 || len(packet.Prompt) > maxPacketBytes {
		return Result{}, errors.New("review provider invalid packet")
	}
	body, err := json.Marshal(messagesRequest{
		Model: r.model, MaxTokens: maxTokens,
		Messages:     []message{{Role: "user", Content: string(packet.Prompt)}},
		OutputConfig: outputConfig{Effort: r.effort},
	})
	if err != nil {
		return Result{}, errors.New("review provider request encoding failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.endpoint, bytes.NewReader(body))
	if err != nil {
		return Result{}, errors.New("review provider request failed")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", r.token)
	req.Header.Set("anthropic-version", claudeAPIVersion)
	resp, err := r.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Result{}, &ProviderError{Status: ProviderTimeout}
		}
		return Result{}, &ProviderError{Status: ProviderAPIError}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return Result{}, errors.New("review provider unavailable: credential_rejected")
		}
		return Result{}, &ProviderError{Status: ProviderAPIError, HTTPStatus: resp.StatusCode}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxReplyBytes+1))
	if err != nil || len(raw) > maxReplyBytes {
		return Result{}, &ProviderError{Status: ProviderAPIError}
	}
	var envelope messagesResponse
	if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope.Content) == 0 {
		return Result{}, &ProviderError{Status: ProviderInvalid}
	}
	var texts []string
	for _, block := range envelope.Content {
		if block.Type == "text" {
			texts = append(texts, block.Text)
		}
	}
	if len(texts) != 1 {
		return Result{}, &ProviderError{Status: ProviderInvalid}
	}
	result, err := ValidateReply([]byte(texts[0]), packet, criteria)
	if err != nil {
		return Result{}, &ProviderError{Status: ProviderInvalid}
	}
	result.Model = envelope.Model
	result.InputTokens = envelope.Usage.InputTokens
	result.OutputTokens = envelope.Usage.OutputTokens
	return result, nil
}
