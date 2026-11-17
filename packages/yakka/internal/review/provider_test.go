package review

import (
	"context"
	"encoding/json"
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
		if got["model"] != "claude-haiku-5-5" || got["max_tokens"] != float64(8000) || got["stream"] != nil || got["tools"] != nil {
			t.Errorf("request body = %s", body)
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
		io.WriteString(w, `{"model":"claude-haiku-5-5-20261101","content":[{"type":"text","text":`+mustJSON(t, validReplyJSON())+`}],"usage":{"input_tokens":12,"output_tokens":34}}`)
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

func mustJSON(t *testing.T, v string) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
