package review

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReviewerRequestAndReply(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.URL.Path != "/v1/messages" {
			t.Errorf("request = %s %s", r.Method, r.URL)
		}
		if r.Header.Get("x-api-key") != "credential-secret-value" || r.Header.Get("anthropic-version") != claudeAPIVersion || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected headers: %v", r.Header)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(body), "credential-secret-value") {
			t.Fatal("credential leaked into request body")
		}
		var got map[string]any
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatal(err)
		}
		if got["model"] != "claude-haiku-5-5" || got["max_tokens"] != float64(128000) || got["stream"] != nil || got["tools"] != nil {
			t.Errorf("request body = %s", body)
		}
		if strings.Contains(string(body), "cache_control") {
			t.Fatalf("request body carries cache_control: %s", body)
		}
		if _, ok := got["cache_control"]; ok {
			t.Fatalf("request body has a cache_control field")
		}
		if _, ok := got["system"]; ok {
			t.Fatalf("one-shot request unexpectedly carries a system prefix")
		}
		outCfg := got["output_config"].(map[string]any)
		if outCfg["effort"] != "high" {
			t.Errorf("output_config = %#v", outCfg)
		}
		msgs := got["messages"].([]any)
		msg := msgs[0].(map[string]any)
		if msg["role"] != "user" || !strings.HasPrefix(msg["content"].(string), "ROLE\n") {
			t.Errorf("messages = %#v", msgs)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"claude-haiku-5-5-20261101","stop_reason":"end_turn","content":[{"type":"text","text":`+mustJSON(t, validReplyJSON())+`}],"usage":{"input_tokens":12,"output_tokens":34}}`)
	}))
	defer server.Close()
	reviewer := NewReviewer("credential-secret-value", "claude-haiku-5-5", "high", server.URL+"/v1/messages")
	result, err := reviewer.Review(context.Background(), testPacket(), []Criterion{{ID: "I1", Text: "criterion"}})
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 || result.Model != "claude-haiku-5-5-20261101" || result.InputTokens != 12 || result.OutputTokens != 34 {
		t.Fatalf("requests=%d result=%+v", requests, result)
	}
}

func TestReviewerClassifiesProviderErrorsWithoutBody(t *testing.T) {
	for _, tc := range []struct {
		code int
		want string
	}{{401, "credential_rejected"}, {429, "provider HTTP 429"}, {500, "provider HTTP 500"}} {
		t.Run(tc.want, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.code)
				io.WriteString(w, "LEAK_SECRET_PROVIDER_BODY")
			}))
			defer server.Close()
			_, err := NewReviewer("secret-credential", "model", "high", server.URL).Review(context.Background(), testPacket(), nil)
			if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "LEAK_SECRET") || strings.Contains(err.Error(), "secret-credential") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestReviewerInvalidOutputReportsUsageOnlyWhenPresent(t *testing.T) {
	reply := func(body string) error {
		t.Helper()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			io.WriteString(w, body)
		}))
		t.Cleanup(server.Close)
		_, err := NewReviewer("token", "claude-haiku-5-5", "high", server.URL).Review(context.Background(), testPacket(), nil)
		return err
	}
	missing := reply(`{"model":"claude-haiku-5-5","content":[{"type":"text","text":"not json"}]}`)
	var absent *ProviderError
	if !errors.As(missing, &absent) || absent.Status != ProviderInvalid || absent.UsageReported || absent.InputTokens != 0 || absent.OutputTokens != 0 {
		t.Fatalf("missing usage = %v", missing)
	}
	present := reply(`{"model":"claude-haiku-5-5","content":[],"usage":{"input_tokens":1000,"output_tokens":500}}`)
	var reported *ProviderError
	if !errors.As(present, &reported) || !reported.UsageReported || reported.InputTokens != 1000 || reported.OutputTokens != 500 {
		t.Fatalf("reported usage = %v", present)
	}
}

func TestReviewerClassifiesTruncatedStopReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"claude-haiku-5-5","stop_reason":"max_tokens","content":[{"type":"text","text":"partial"}],"usage":{"input_tokens":1000,"output_tokens":100000}}`)
	}))
	defer server.Close()
	_, err := NewReviewer("token", "claude-haiku-5-5", "max", server.URL).Review(context.Background(), testPacket(), nil)
	var pe *ProviderError
	if !errors.As(err, &pe) || pe.Status != ProviderTruncated || strings.Contains(err.Error(), string(ProviderInvalid)) {
		t.Fatalf("error = %v", err)
	}
	if !pe.UsageReported || pe.InputTokens != 1000 || pe.OutputTokens != 100000 {
		t.Fatalf("usage = %+v", pe)
	}
}

func TestRunTruncatedPersistsStatusAndUsage(t *testing.T) {
	tenant := reviewTenant(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"claude-haiku-5-5","stop_reason":"max_tokens","content":[{"type":"text","text":"partial"}],"usage":{"input_tokens":1000,"output_tokens":100000}}`)
	}))
	defer srv.Close()
	out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), availableConfig(srv.URL))
	if err != nil || out.Status != "truncated" {
		t.Fatalf("%+v %v", out, err)
	}
	rec := readReviewRecord(t, tenant)
	if rec["status"] != "truncated" || rec["output_tokens"] != float64(100000) {
		t.Fatalf("record status=%v output_tokens=%v", rec["status"], rec["output_tokens"])
	}
	attempts := recordAttempts(t, tenant)
	if len(attempts) != 1 || attempts[0]["status"] != "truncated" {
		t.Fatalf("attempts=%v", attempts)
	}
}

func TestRunInvalidOutputWithoutUsageIsUnknownCost(t *testing.T) {
	tenant := reviewTenant(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `{"model":"claude-haiku-5-5","content":[{"type":"text","text":"not json"}]}`)
	}))
	defer srv.Close()
	out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), availableConfig(srv.URL))
	if err != nil || out.Status != "invalid_output" {
		t.Fatalf("%+v %v", out, err)
	}
	rec := readReviewRecord(t, tenant)
	if rec["cost_usd"] != nil || rec["cost_known"] != false {
		t.Fatalf("cost=%v known=%v", rec["cost_usd"], rec["cost_known"])
	}
	attempts := recordAttempts(t, tenant)
	if len(attempts) != 1 || attempts[0]["cost_known"] != false {
		t.Fatalf("attempts=%v", attempts)
	}
	if _, ok := attempts[0]["cost_usd"]; ok {
		t.Fatalf("unknown attempt carries cost: %v", attempts[0])
	}
}

func TestReviewerBoundsResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, strings.Repeat("x", maxReplyBytes+1))
	}))
	defer server.Close()
	_, err := NewReviewer("token", "model", "high", server.URL).Review(context.Background(), testPacket(), nil)
	if err == nil || !strings.Contains(err.Error(), string(ProviderAPIError)) {
		t.Fatalf("error = %v", err)
	}
}

func TestReviewerAcceptsSingleMarkdownFence(t *testing.T) {
	for _, fenced := range []string{
		"```json\n" + validReplyJSON() + "\n```",
		"```\n" + validReplyJSON() + "\n```",
		"\n  " + validReplyJSON() + "  \n",
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			encoded := mustJSON(t, fenced)
			io.WriteString(w, `{"model":"claude-haiku-5-5","stop_reason":"end_turn","content":[{"type":"text","text":`+encoded+`}],"usage":{"input_tokens":12,"output_tokens":34}}`)
		}))
		result, err := NewReviewer("token", "claude-haiku-5-5", "high", server.URL).Review(context.Background(), testPacket(), []Criterion{{ID: "I1"}})
		server.Close()
		if err != nil || result.Coverage != "complete" {
			t.Fatalf("fenced reply = %+v, %v", result, err)
		}
	}
}

func reviewTextBlocks(t *testing.T, blocks []map[string]string) (Result, error) {
	t.Helper()
	content, err := json.Marshal(blocks)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"model":"claude-haiku-5-5","stop_reason":"end_turn","content":` + string(content) + `,"usage":{"input_tokens":12,"output_tokens":34}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, body)
	}))
	defer server.Close()
	return NewReviewer("token", "claude-haiku-5-5", "high", server.URL).Review(context.Background(), testPacket(), []Criterion{{ID: "I1"}})
}

func TestReviewerJoinsTextBlocksIntoOneObject(t *testing.T) {
	valid := validReplyJSON()
	mid := len(valid) / 2
	result, err := reviewTextBlocks(t, []map[string]string{
		{"type": "text", "text": valid[:mid]},
		{"type": "text", "text": valid[mid:]},
	})
	if err != nil || result.Coverage != "complete" {
		t.Fatalf("split object = %+v, %v", result, err)
	}
}

func TestReviewerIgnoresNonTextBlocks(t *testing.T) {
	result, err := reviewTextBlocks(t, []map[string]string{
		{"type": "thinking", "thinking": "internal"},
		{"type": "text", "text": validReplyJSON()},
		{"type": "tool_use", "id": "tool-1"},
	})
	if err != nil || result.Coverage != "complete" {
		t.Fatalf("mixed blocks = %+v, %v", result, err)
	}
}

func TestReviewerUsesLastValidObject(t *testing.T) {
	partial := strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"partial"`, 1)
	for name, text := range map[string]string{
		// The later object wins whether the earlier content is prose, an invalid
		// object, or another valid object.
		"prose then valid":   "Here is the review:\n" + partial,
		"invalid then valid": "{not json} " + partial,
		"two valid objects":  validReplyJSON() + "\n" + partial,
	} {
		t.Run(name, func(t *testing.T) {
			result, err := reviewTextBlocks(t, []map[string]string{{"type": "text", "text": text}})
			if err != nil || result.Coverage != "partial" {
				t.Fatalf("result = %+v, %v", result, err)
			}
		})
	}
}

func TestReviewerAcceptsTrailingAndProseAroundObject(t *testing.T) {
	// The whole-reply validate still rejects these shapes, but last-valid-object
	// selection intentionally accepts the trailing or fenced object.
	for name, text := range map[string]string{
		"prose before fence":    "Here is the review:\n```json\n" + validReplyJSON() + "\n```",
		"trailing after fence":  "```json\n" + validReplyJSON() + "\n```\nmore",
		"trailing after object": validReplyJSON() + " trailing",
	} {
		t.Run(name, func(t *testing.T) {
			result, err := reviewTextBlocks(t, []map[string]string{{"type": "text", "text": text}})
			if err != nil || result.Coverage != "complete" {
				t.Fatalf("result = %+v, %v", result, err)
			}
		})
	}
}

func TestReviewerJoinedTextWithoutValidObjectIsInvalid(t *testing.T) {
	_, err := reviewTextBlocks(t, []map[string]string{
		{"type": "text", "text": "prose only "},
		{"type": "text", "text": `{"not":"a contract"}`},
	})
	var pe *ProviderError
	if !errors.As(err, &pe) || pe.Status != ProviderInvalid || pe.Reason == "" || pe.Reason == "multiple_text_blocks" {
		t.Fatalf("error = %v", err)
	}
}

func TestReviewerInvalidReasonIsBodyFree(t *testing.T) {
	for name, body := range map[string]string{
		"not json": `{"model":"claude-haiku-5-5","content":[{"type":"text","text":"not json"}]}`,
		// Two joined blocks that are each empty objects have no valid contract
		// object; multiple_text_blocks is no longer an outcome of joining.
		"joined empty objects": `{"model":"claude-haiku-5-5","content":[{"type":"text","text":"{}"},{"type":"text","text":"{}"}]}`,
		"unknown field":        `{"model":"claude-haiku-5-5","content":[{"type":"text","text":` + mustJSON(t, strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"complete","extra":true`, 1)) + `}]}`,
		"invalid assessment":   `{"model":"claude-haiku-5-5","content":[{"type":"text","text":` + mustJSON(t, strings.Replace(validReplyJSON(), `"assessment":"met"`, `"assessment":"maybe"`, 1)) + `}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				io.WriteString(w, body)
			}))
			defer server.Close()
			_, err := NewReviewer("token", "claude-haiku-5-5", "high", server.URL).Review(context.Background(), testPacket(), []Criterion{{ID: "I1"}})
			var pe *ProviderError
			if !errors.As(err, &pe) || pe.Status != ProviderInvalid || pe.Reason == "" {
				t.Fatalf("error = %v", err)
			}
			if strings.Contains(pe.Reason, "not json") || strings.Contains(pe.Reason, "maybe") || strings.Contains(pe.Reason, "extra") {
				t.Fatalf("reason leaked reply content: %q", pe.Reason)
			}
		})
	}
}

func TestReviewerRefusesOverBudgetPacketWithoutCall(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		io.WriteString(w, `{"model":"claude-haiku-5-5","content":[]}`)
	}))
	defer server.Close()
	packet := testPacket()
	packet.Prompt = []byte(strings.Repeat("x", overBudgetBytes()))
	_, err := NewReviewer("token", "claude-haiku-5-5", "high", server.URL).Review(context.Background(), packet, nil)
	var pe *ProviderError
	if !errors.As(err, &pe) || pe.Status != ProviderInputTooLarge {
		t.Fatalf("error = %v", err)
	}
	if requests != 0 {
		t.Fatalf("over-budget packet reached the provider: %d calls", requests)
	}
}

func TestReviewerRequestHasNoCacheControlAnywhere(t *testing.T) {
	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		encoded := mustJSON(t, validReplyJSON())
		io.WriteString(w, `{"model":"claude-haiku-5-5","stop_reason":"end_turn","content":[{"type":"text","text":`+encoded+`}],"usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	defer server.Close()
	if _, err := NewReviewer("token", "claude-haiku-5-5", "high", server.URL).Review(context.Background(), testPacket(), []Criterion{{ID: "I1"}}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "cache") {
		t.Fatalf("one-shot request carries a cache prefix: %s", body)
	}
}

func mustJSON(t *testing.T, v string) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
