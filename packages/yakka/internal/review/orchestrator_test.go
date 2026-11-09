package review

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func reviewTenant(t *testing.T) *store.Tenant {
	t.Helper()
	got, err := store.Open(t.TempDir(), store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = got.Close() })
	return got
}

func reviewRequest(complete bool) Request {
	c := rangeCapture(fileDiff("pkg/a.go", "safe changed implementation"), complete)
	return Request{Capture: c, Kind: "adhoc", BuildModels: []BuildModel{{ID: "unknown"}}}
}
func rangeCapture(diff string, complete bool) Capture {
	c := capture(diff)
	c.Complete = complete
	c.Base = strings.Repeat("a", 40)
	c.Head = strings.Repeat("b", 40)
	return c
}
func availableConfig(endpoint string) RunConfig {
	return RunConfig{Availability: Availability{Token: "credential-sentinel", Model: LiveModel, Effort: "high", USDCap: 5, Repositories: map[string]bool{"tenant/repo-sentinel": true}}, Reservations: NewReservations(5, 2), Endpoint: endpoint}
}
func providerReply(outcomes any, findings any, limitations any, coverage string) string {
	b, _ := json.Marshal(map[string]any{"outcomes": outcomes, "findings": findings, "limitations": limitations, "coverage": coverage})
	outer, _ := json.Marshal(map[string]any{"model": LiveModel, "content": []any{map[string]any{"type": "text", "text": string(b)}}, "usage": map[string]any{"input_tokens": 100, "output_tokens": 50}})
	return string(outer)
}

func TestRunSuccessPartialDryRunAndPersistedInput(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("x-api-key") != "credential-sentinel" {
			t.Error("missing provider credential header")
		}
		wire, _ := io.ReadAll(r.Body)
		if strings.Contains(string(wire), "build-model-sentinel") {
			t.Fatal("build model reached provider request")
		}
		var body map[string]any
		_ = json.Unmarshal(wire, &body)
		if body["model"] != LiveModel || body["output_config"].(map[string]any)["effort"] != "high" {
			t.Errorf("request body settings: %#v", body)
		}
		io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
	}))
	defer srv.Close()
	tenant := reviewTenant(t)
	cfg := availableConfig(srv.URL)
	dry := reviewRequest(true)
	dry.DryRun = true
	receipt, err := Run(context.Background(), tenant, "tenant", dry, cfg)
	if err != nil || receipt.Status != "dry_run" || calls.Load() != 0 {
		t.Fatalf("dry run=%+v calls=%d err=%v", receipt, calls.Load(), err)
	}
	req := reviewRequest(true)
	req.BuildModels = []BuildModel{{ID: "build-model-sentinel", Role: "builder"}}
	receipt, err = Run(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || receipt.Status != "ok" || calls.Load() != 1 {
		t.Fatalf("success=%+v calls=%d err=%v", receipt, calls.Load(), err)
	}
	if _, err = tenant.ReadReviewInput(receiptInputHash(t, tenant)); err != nil {
		t.Fatalf("captured input not readable: %v", err)
	}
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{RepoID: "repo-sentinel", Limit: 20})
	if err != nil || len(rows) != 1 {
		t.Fatalf("records=%d err=%v", len(rows), err)
	}
	var rec map[string]any
	if json.Unmarshal(rows[0].Raw, &rec) != nil {
		t.Fatal("invalid record")
	}
	h, ok := rec["input_hash"].(string)
	if !ok {
		t.Fatal("record has no captured-input hash")
	}
	input, err := tenant.ReadReviewInput(h)
	if err != nil || strings.Contains(string(input), "ROLE\n") || !strings.Contains(string(input), "safe changed implementation") {
		t.Fatalf("captured input=%q err=%v", input, err)
	}
	partial := reviewRequest(false)
	partial.Capture = rangeCapture(fileDiff("pkg/a.go", "different partial implementation"), false)
	receipt, err = Run(context.Background(), tenant, "tenant", partial, cfg)
	if err != nil || receipt.Status != "ok_partial" {
		t.Fatalf("partial=%+v err=%v", receipt, err)
	}
}

func receiptInputHash(t *testing.T, tenant *store.Tenant) string {
	t.Helper()
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 1})
	if err != nil || len(rows) == 0 {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(rows[0].Raw, &m)
	return m["input_hash"].(string)
}

func TestRunTreatsReceiptDetailAsSummary(t *testing.T) {
	tenant := reviewTenant(t)
	req := reviewRequest(true)
	req.DryRun = true
	req.Detail = "receipt"
	out, err := Run(context.Background(), tenant, "tenant", req, RunConfig{})
	if err != nil || out.Status != "dry_run" || out.Result != nil {
		t.Fatalf("receipt detail=%+v err=%v", out, err)
	}
}

func TestRunRetriesThenDuplicateAndChangedBuildModel(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != LiveModel || body["output_config"].(map[string]any)["effort"] != "high" {
			t.Errorf("retry request settings=%#v", body)
		}
		if n == 1 {
			w.WriteHeader(500)
			return
		}
		io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
	}))
	defer srv.Close()
	tenant := reviewTenant(t)
	cfg := availableConfig(srv.URL)
	req := reviewRequest(true)
	out, err := Run(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || out.Status != "ok" || calls.Load() != 2 {
		t.Fatalf("retry=%+v calls=%d err=%v", out, calls.Load(), err)
	}
	dup, err := Run(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || dup.Status != "skipped_duplicate" || dup.Reason == "" || calls.Load() != 2 {
		t.Fatalf("duplicate=%+v calls=%d err=%v", dup, calls.Load(), err)
	}
	req.BuildModels = []BuildModel{{ID: "different-build-model"}}
	changed, err := Run(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || changed.Status != "ok" || calls.Load() != 3 {
		t.Fatalf("changed key=%+v calls=%d err=%v", changed, calls.Load(), err)
	}
}

func TestRunKeepsUnsupportedFindingAndRedactsReplyBeforeIngest(t *testing.T) {
	tenant := reviewTenant(t)
	findings := []any{
		map[string]any{"id": "F1", "severity": "high", "lens": "security", "title": "Secret AKIA1234567890ABCDEF", "path": "pkg/a.go", "line_start": 1, "line_end": 1, "evidence": "safe changed implementation", "criterion_ids": []any{}, "confidence": 0.9, "rationale": "review reason"},
		map[string]any{"id": "F2", "severity": "low", "lens": "other", "title": "Unsupported claim", "path": "unsupported", "line_start": 1, "line_end": 1, "evidence": "evidence that is not part of this change", "criterion_ids": []any{}, "confidence": 0.3, "rationale": "no support"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, providerReply([]any{}, findings, []any{}, "complete"))
	}))
	defer srv.Close()
	cfg := availableConfig(srv.URL)
	req := reviewRequest(true)
	req.Detail = "full"
	out, err := Run(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || out.Status != "ok" || out.Result == nil || !out.Result.ReplyRedacted || out.Result.UnsupportedFindings != 1 || strings.Contains(fmt.Sprint(out.Result.Findings), "AKIA1234567890ABCDEF") {
		t.Fatalf("reply=%+v err=%v", out, err)
	}
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{RepoID: "repo-sentinel", Limit: 5})
	if err != nil || len(rows) != 1 || strings.Contains(string(rows[0].Raw), "AKIA1234567890ABCDEF") {
		t.Fatalf("record secret leakage or missing record: %s %v", rows[0].Raw, err)
	}
}

func TestRunStatusFixturesAndPreflightResume(t *testing.T) {
	t.Run("invalid output", func(t *testing.T) {
		tenant := reviewTenant(t)
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"model":"x","content":[{"type":"text","text":"not json"}],"usage":{"input_tokens":1,"output_tokens":1}}`)
		}))
		defer srv.Close()
		out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), availableConfig(srv.URL))
		if err != nil || out.Status != "invalid_output" {
			t.Fatalf("%+v %v", out, err)
		}
	})
	t.Run("api error", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); w.WriteHeader(429) }))
		defer srv.Close()
		out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), availableConfig(srv.URL))
		if err != nil || out.Status != "api_error" || calls.Load() != 2 {
			t.Fatalf("api_error=%+v calls=%d err=%v", out, calls.Load(), err)
		}
	})
	t.Run("credential rejection", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, "provider body must not escape")
		}))
		defer srv.Close()
		out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), availableConfig(srv.URL))
		if err != nil || out.Status != "unavailable" || out.Reason != "credential_rejected" || calls.Load() != 1 {
			t.Fatalf("credential=%+v calls=%d err=%v", out, calls.Load(), err)
		}
	})
	t.Run("unavailable config", func(t *testing.T) {
		tenant := reviewTenant(t)
		cfg := availableConfig("http://127.0.0.1:1")
		cfg.Availability.Token = "credential-that-must-not-appear"
		cfg.Availability.Token = ""
		out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), cfg)
		if err != nil || out.Status != "unavailable" || out.Reason != "CLAUDE_API_TOKEN" {
			t.Fatalf("unavailable=%+v err=%v", out, err)
		}
	})
	t.Run("unavailable settings make zero calls", func(t *testing.T) {
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
		defer srv.Close()
		for _, tc := range []struct {
			name   string
			mutate func(*Availability)
		}{
			{"local", func(a *Availability) { a.Local = true }},
			{"model", func(a *Availability) { a.Model = "claude-sonnet-5-5" }},
			{"effort", func(a *Availability) { a.Effort = "xhigh" }},
			{"cap", func(a *Availability) { a.USDCap = 0 }},
			{"repository", func(a *Availability) { a.Repositories = map[string]bool{} }},
		} {
			t.Run(tc.name, func(t *testing.T) {
				tenant := reviewTenant(t)
				cfg := availableConfig(srv.URL)
				tc.mutate(&cfg.Availability)
				out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), cfg)
				if err != nil || out.Status != "unavailable" || calls.Load() != 0 {
					t.Fatalf("%+v err=%v calls=%d", out, err, calls.Load())
				}
			})
		}
	})
	t.Run("criteria refusal code", func(t *testing.T) {
		tenant := reviewTenant(t)
		req := reviewRequest(true)
		req.Brief = &BriefRef{Path: "docs/plans/nope/briefs/x.md"}
		out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(""))
		if err != nil || out.Status != "refused_criteria" || out.Reason != "criteria_not_found" {
			t.Fatalf("criteria=%+v err=%v", out, err)
		}
	})
	t.Run("trial refusal keeps trial identity", func(t *testing.T) {
		tenant := reviewTenant(t)
		req := reviewRequest(true)
		req.Trial = &Trial{ManifestHash: strings.Repeat("d", 64), CaseID: "case-1", Effort: "max"}
		req.Capture = rangeCapture(fileDiff("pkg/a.go", "literal <<<YAKKA_UNTRUSTED_INJECT"), true)
		out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(""))
		if err != nil || out.Status != "refused_capture" {
			t.Fatalf("trial refusal=%+v err=%v", out, err)
		}
		rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 10})
		if err != nil || len(rows) != 1 {
			t.Fatalf("records=%d err=%v", len(rows), err)
		}
		var rec map[string]any
		if json.Unmarshal(rows[0].Raw, &rec) != nil || rec["profile"] != "historical_trial" || rec["effective_effort"] != "max" || rec["manifest_hash"] != req.Trial.ManifestHash || rec["case_id"] != "case-1" {
			t.Fatalf("trial refusal record=%s", rows[0].Raw)
		}
	})
	t.Run("capture and disclosure refusal", func(t *testing.T) {
		for _, tc := range []struct{ name, body, want string }{{"capture", "literal <<<YAKKA_UNTRUSTED_INJECT", "refused_capture"}, {"secret", "AKIA1234567890ABCDEF", "refused_disclosure"}} {
			t.Run(tc.name, func(t *testing.T) {
				tenant := reviewTenant(t)
				req := reviewRequest(true)
				req.Capture = rangeCapture(fileDiff("pkg/a.go", tc.body), true)
				out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(""))
				if err != nil || out.Status != tc.want {
					t.Fatalf("refusal=%+v err=%v", out, err)
				}
			})
		}
	})
	t.Run("argument and capture errors are unrecorded", func(t *testing.T) {
		tenant := reviewTenant(t)
		req := reviewRequest(true)
		req.Capture.DiffSHA256 = "bad"
		if _, err := Run(context.Background(), tenant, "tenant", req, availableConfig("")); err == nil {
			t.Fatal("bad checksum accepted")
		}
		rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 10})
		if err != nil || len(rows) != 0 {
			t.Fatalf("records=%d err=%v", len(rows), err)
		}
	})
	t.Run("legacy adapter needs no deployment gate", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
		}))
		defer srv.Close()
		req := reviewRequest(true)
		req.Trial = &Trial{ManifestHash: strings.Repeat("a", 64), CaseID: "case", Effort: "xhigh"}
		out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL))
		if err != nil || out.Status != "ok" || calls.Load() != 1 {
			t.Fatalf("legacy=%+v %v calls=%d", out, err, calls.Load())
		}
	})
	t.Run("budget then available", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
		}))
		defer srv.Close()
		req := reviewRequest(true)
		cfg := availableConfig(srv.URL)
		cfg.Reservations = NewReservations(.001, 2)
		out, err := Run(context.Background(), tenant, "tenant", req, cfg)
		if err != nil || out.Status != "skipped_budget" || calls.Load() != 0 {
			t.Fatalf("budget=%+v %v calls=%d", out, err, calls.Load())
		}
		cfg.Reservations = NewReservations(5, 2)
		out, err = Run(context.Background(), tenant, "tenant", req, cfg)
		if err != nil || out.Status != "ok" || calls.Load() != 1 {
			t.Fatalf("available=%+v %v calls=%d", out, err, calls.Load())
		}
	})
	t.Run("timeout remains reserved", func(t *testing.T) {
		tenant := reviewTenant(t)
		srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { time.Sleep(60 * time.Millisecond) }))
		defer srv.Close()
		cfg := availableConfig(srv.URL)
		cfg.AttemptTimeout = 5 * time.Millisecond
		cfg.Reservations = NewReservations(.25, 2)
		out, err := Run(context.Background(), tenant, "tenant", reviewRequest(true), cfg)
		if err != nil || out.Status != "timeout" || len(outFindings(out)) != 0 || len(readAttempts(t, tenant)) != 1 {
			t.Fatalf("timeout=%+v %v", out, err)
		}
		if err := cfg.Reservations.begin("after-timeout", "later", "tenant", .04); !errors.Is(err, ErrBudget) {
			t.Fatalf("timeout reservation released: %v", err)
		}
	})
}

func outFindings(Receipt) map[string]int { return nil }

func readAttempts(t *testing.T, tenant *store.Tenant) []json.RawMessage {
	t.Helper()
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 1})
	if err != nil || len(rows) != 1 {
		t.Fatalf("attempt record missing: %v", err)
	}
	var raw map[string]json.RawMessage
	if err = json.Unmarshal(rows[0].Raw, &raw); err != nil {
		t.Fatal(err)
	}
	var attempts []json.RawMessage
	if err = json.Unmarshal(raw["attempts"], &attempts); err != nil {
		t.Fatal(err)
	}
	return attempts
}

func TestHistoricalEffortsRemainSeparateFromLiveHigh(t *testing.T) {
	for _, eff := range []string{"high", "xhigh", "max"} {
		t.Run(eff, func(t *testing.T) {
			tenant := reviewTenant(t)
			var got string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				got = body["output_config"].(map[string]any)["effort"].(string)
				io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
			}))
			defer srv.Close()
			req := reviewRequest(true)
			req.Trial = &Trial{ManifestHash: strings.Repeat("a", 64), CaseID: eff, Effort: eff}
			cfg := availableConfig(srv.URL)
			out, err := Run(context.Background(), tenant, "tenant", req, cfg)
			if err != nil || out.Status != "ok" || got != eff {
				t.Fatalf("effort=%q result=%+v err=%v", got, out, err)
			}
		})
	}
}

func TestSameHistoricalCaseAtDifferentEffortsIsNotDuplicate(t *testing.T) {
	tenant := reviewTenant(t)
	var calls atomic.Int32
	var efforts []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		efforts = append(efforts, body["output_config"].(map[string]any)["effort"].(string))
		io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
	}))
	defer srv.Close()
	cfg := availableConfig(srv.URL)
	for _, eff := range []string{"high", "xhigh", "max"} {
		req := reviewRequest(true)
		req.Trial = &Trial{ManifestHash: strings.Repeat("b", 64), CaseID: "same-case", Effort: eff}
		out, err := Run(context.Background(), tenant, "tenant", req, cfg)
		if err != nil || out.Status != "ok" {
			t.Fatalf("effort %s: %+v %v", eff, out, err)
		}
	}
	if calls.Load() != 3 || strings.Join(efforts, ",") != "high,xhigh,max" {
		t.Fatalf("calls=%d efforts=%v", calls.Load(), efforts)
	}
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{RepoID: "repo-sentinel", Limit: 10})
	if err != nil || len(rows) != 3 {
		t.Fatalf("records=%d err=%v", len(rows), err)
	}
}

func TestPRReviewUsesEveryRepoScopedPhaseOutcome(t *testing.T) {
	tenant := reviewTenant(t)
	design := "## Intent\nProtect the contract.\n\n## Assumption Ledger\n### Assumption 1\nOnly supplied changes are reviewed.\n\n## Phases\n### Phase 1 — Capture\n- Outcome: capture preserves the selected repository and its diff.\n- Surfaces: local reader.\n### Phase 2 — Review\n- Outcome: review stores a validated finding.\n- Surfaces: REST service.\n"
	fact, _ := json.Marshal(map[string]any{"id": "design-1", "type": "artifact_version", "conversation_id": "design-conversation", "harness": "test", "event": "write", "ts": float64(1), "repo_id": "repo-sentinel", "path": "docs/plans/99-demo/DESIGN.md", "content": design, "content_hash": keys.ContentHash([]byte(design)), "source": "worktree"})
	if got, err := ingest.Ingest(context.Background(), tenant, []json.RawMessage{fact}); err != nil || len(got) != 1 || got[0].Status != ingest.Accepted {
		t.Fatalf("seed criteria=%+v err=%v", got, err)
	}
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		asked = body["messages"].([]any)[0].(map[string]any)["content"].(string)
		io.WriteString(w, providerReply([]any{map[string]any{"criterion_id": "O1", "assessment": "met", "evidence": "covered"}, map[string]any{"criterion_id": "O2", "assessment": "partial", "evidence": "covered"}}, []any{}, []any{}, "complete"))
	}))
	defer srv.Close()
	req := reviewRequest(true)
	req.Kind = "pr"
	req.PR = 42
	req.Plan = "demo"
	cfg := availableConfig(srv.URL)
	out, err := Run(context.Background(), tenant, "tenant", req, cfg)
	if err != nil || out.Status != "ok" || !strings.Contains(asked, "O1: Phase 1 outcome") || !strings.Contains(asked, "O2: Phase 2 outcome") {
		t.Fatalf("PR criteria=%+v err=%v prompt=%s", out, err, asked)
	}
}

func TestReservationClaimsAreAtomic(t *testing.T) {
	r := NewReservations(.06, 2)
	var allowed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if r.begin(fmt.Sprintf("k%d", i), fmt.Sprintf("id%d", i), "tenant", .055) == nil {
				allowed.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if allowed.Load() != 1 {
		t.Fatalf("reserved %d calls over cap", allowed.Load())
	}
	limited := NewReservations(5, 1)
	if err := limited.begin("first", "one", "tenant", .01); err != nil {
		t.Fatal(err)
	}
	if err := limited.begin("second", "two", "tenant", .01); !errors.Is(err, ErrBudget) {
		t.Fatalf("in-flight limit did not reject second call: %v", err)
	}
}

func TestPersistentReservationKeepsUnknownClaimAndSpend(t *testing.T) {
	path := t.TempDir() + "/reservations.json"
	a, err := NewPersistentReservations(.06, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.begin("tenant-key", "review-id", "tenant", .055); err != nil {
		t.Fatal(err)
	}
	b, err := NewPersistentReservations(.06, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, dup := duplicateReview(b.begin("tenant-key", "second-id", "tenant", .001)); !dup {
		t.Fatal("started claim did not survive reload")
	}
	if err := b.begin("other-key", "third-id", "tenant", .01); !errors.Is(err, ErrBudget) {
		t.Fatalf("rolling spend not restored: %v", err)
	}
}

func countReviewInputs(t *testing.T, tenant *store.Tenant) int {
	t.Helper()
	n := 0
	_ = filepath.WalkDir(filepath.Join(tenant.Dir(), "review-inputs"), func(_ string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func readReviewRecord(t *testing.T, tenant *store.Tenant) map[string]any {
	t.Helper()
	rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 1})
	if err != nil || len(rows) != 1 {
		t.Fatalf("records=%d err=%v", len(rows), err)
	}
	var rec map[string]any
	if err := json.Unmarshal(rows[0].Raw, &rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func recordTags(t *testing.T, rec map[string]any) []string {
	t.Helper()
	raw, _ := json.Marshal(rec["tags"])
	var tags []string
	if err := json.Unmarshal(raw, &tags); err != nil {
		t.Fatalf("tags=%v err=%v", rec["tags"], err)
	}
	return tags
}

func reservationsClaimCount(r *Reservations) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.claimed)
}

func TestRunCallControlsRefuseBeforeEffects(t *testing.T) {
	base, err := json.Marshal(reviewRequest(true))
	if err != nil {
		t.Fatal(err)
	}
	seventeen := make([]string, 17)
	for i := range seventeen {
		seventeen[i] = fmt.Sprintf("tag-%d", i)
	}
	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"effort null", func(m map[string]any) { m["effort"] = nil }},
		{"effort empty", func(m map[string]any) { m["effort"] = "" }},
		{"effort unsupported", func(m map[string]any) { m["effort"] = "min" }},
		{"effort number", func(m map[string]any) { m["effort"] = 3 }},
		{"tags null", func(m map[string]any) { m["tags"] = nil }},
		{"tags string", func(m map[string]any) { m["tags"] = "run" }},
		{"tags non-string element", func(m map[string]any) { m["tags"] = []any{"ok", 5} }},
		{"tags overcount", func(m map[string]any) { m["tags"] = seventeen }},
		{"tags overlength", func(m map[string]any) { m["tags"] = []string{strings.Repeat("a", 97)} }},
		{"tags whitespace", func(m map[string]any) { m["tags"] = []string{"a b"} }},
		{"tags control", func(m map[string]any) { m["tags"] = []string{"a\x01b"} }},
		{"store null", func(m map[string]any) { m["store"] = nil }},
		{"store string", func(m map[string]any) { m["store"] = "true" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var raw map[string]any
			if err := json.Unmarshal(base, &raw); err != nil {
				t.Fatal(err)
			}
			tc.mutate(raw)
			body, _ := json.Marshal(raw)
			var req Request
			decodeErr := json.Unmarshal(body, &req)
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
			defer srv.Close()
			tenant := reviewTenant(t)
			if decodeErr == nil {
				if _, runErr := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL)); runErr == nil {
					t.Fatalf("invalid controls accepted: %s", body)
				}
			}
			if calls.Load() != 0 {
				t.Fatalf("provider called %d", calls.Load())
			}
			rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 10})
			if err != nil || len(rows) != 0 {
				t.Fatalf("rows=%d err=%v", len(rows), err)
			}
			if n := countReviewInputs(t, tenant); n != 0 {
				t.Fatalf("review inputs=%d", n)
			}
		})
	}
}

func TestRunEffortsInBothModesWithoutTrialEnv(t *testing.T) {
	for _, mode := range []string{"uncommitted", "range"} {
		for _, eff := range []string{"high", "xhigh", "max"} {
			t.Run(mode+"/"+eff, func(t *testing.T) {
				tenant := reviewTenant(t)
				var got atomic.Value
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					got.Store(body["output_config"].(map[string]any)["effort"].(string))
					io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
				}))
				defer srv.Close()
				req := reviewRequest(true)
				if mode == "uncommitted" {
					req.Capture.Mode = "uncommitted"
					req.Capture.View = "combined"
					req.Capture.Base = ""
					req.Capture.Head = strings.Repeat("c", 40)
				}
				req.Effort = eff
				out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL))
				if err != nil || out.Status != "ok" {
					t.Fatalf("%+v %v", out, err)
				}
				if got.Load() != eff {
					t.Fatalf("provider effort=%v want %s", got.Load(), eff)
				}
				rec := readReviewRecord(t, tenant)
				if rec["configured_effort"] != "high" || rec["requested_effort"] != eff || rec["effective_effort"] != eff {
					t.Fatalf("effort fields configured=%v requested=%v effective=%v", rec["configured_effort"], rec["requested_effort"], rec["effective_effort"])
				}
			})
		}
	}
}

func TestLegacyAdapterMapsTagsAndRejectsConflicts(t *testing.T) {
	manifest := strings.Repeat("a", 64)
	caseID := "case-1"
	digest := sha256.Sum256([]byte(caseID))
	adapter := []string{"case:" + hex.EncodeToString(digest[:]), "effort:xhigh", "manifest:" + manifest}
	sort.Strings(adapter)
	provider := func(calls *atomic.Int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
		}))
	}

	t.Run("pure adapter maps deterministic tags", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := provider(&calls)
		defer srv.Close()
		req := reviewRequest(true)
		req.Trial = &Trial{ManifestHash: manifest, CaseID: caseID, Effort: "xhigh"}
		out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL))
		if err != nil || out.Status != "ok" || calls.Load() != 1 {
			t.Fatalf("%+v %v calls=%d", out, err, calls.Load())
		}
		rec := readReviewRecord(t, tenant)
		if got := recordTags(t, rec); strings.Join(got, ",") != strings.Join(adapter, ",") {
			t.Fatalf("tags=%v want %v", got, adapter)
		}
		if rec["profile"] != "historical_trial" || rec["manifest_hash"] != manifest || rec["case_id"] != caseID {
			t.Fatalf("legacy record=%v", rec)
		}
	})

	t.Run("caller tags union with adapter tags", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := provider(&calls)
		defer srv.Close()
		req := reviewRequest(true)
		req.Trial = &Trial{ManifestHash: manifest, CaseID: caseID, Effort: "xhigh"}
		req.Tags = []string{"run:alpha"}
		out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL))
		if err != nil || out.Status != "ok" {
			t.Fatalf("%+v %v", out, err)
		}
		want := append([]string{"run:alpha"}, adapter...)
		sort.Strings(want)
		if got := recordTags(t, readReviewRecord(t, tenant)); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("tags=%v want %v", got, want)
		}
	})

	t.Run("equal top-level effort accepted", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := provider(&calls)
		defer srv.Close()
		req := reviewRequest(true)
		req.Effort = "xhigh"
		req.Trial = &Trial{ManifestHash: manifest, CaseID: caseID, Effort: "xhigh"}
		if out, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL)); err != nil || out.Status != "ok" {
			t.Fatalf("%+v %v", out, err)
		}
	})

	t.Run("conflicting effort refuses before effects", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := provider(&calls)
		defer srv.Close()
		req := reviewRequest(true)
		req.Effort = "max"
		req.Trial = &Trial{ManifestHash: manifest, CaseID: caseID, Effort: "xhigh"}
		if _, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL)); err == nil {
			t.Fatal("conflicting effort accepted")
		}
		if calls.Load() != 0 {
			t.Fatalf("provider called %d", calls.Load())
		}
		rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 10})
		if err != nil || len(rows) != 0 {
			t.Fatalf("rows=%d err=%v", len(rows), err)
		}
	})

	t.Run("merged set over 16 refuses", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := provider(&calls)
		defer srv.Close()
		req := reviewRequest(true)
		req.Trial = &Trial{ManifestHash: manifest, CaseID: caseID, Effort: "xhigh"}
		for i := 0; i < 14; i++ {
			req.Tags = append(req.Tags, fmt.Sprintf("t-%02d", i))
		}
		if _, err := Run(context.Background(), tenant, "tenant", req, availableConfig(srv.URL)); err == nil {
			t.Fatal("merged tag overflow accepted")
		}
		if calls.Load() != 0 {
			t.Fatalf("provider called %d", calls.Load())
		}
	})
}

func legacyFixtureKey(t *testing.T, req Request, tenant, repo string, p Packet, effort, profile string) string {
	t.Helper()
	b, _ := json.Marshal(struct {
		Tenant, Repo, Kind, Plan, Capture, Criteria, Build, Model, Effort, Profile, Manifest, Case, Policy string
		Phase                                                                                              int
	}{tenant, repo, req.Kind, req.Plan, p.CaptureID, "", fmt.Sprint(req.BuildModels), LiveModel, effort, profile, trialManifest(req.Trial), trialCase(req.Trial), p.PromptPolicyVersion, req.Phase})
	return keys.ContentHash(b)
}

func TestExecutionKeyPreservesPreUpgradeAndSeparatesTags(t *testing.T) {
	req := reviewRequest(true)
	packet, err := Build(Input{Capture: req.Capture})
	if err != nil {
		t.Fatal(err)
	}
	want := legacyFixtureKey(t, req, "tenant", "repo-sentinel", packet, "high", "shadow")
	untagged := executionKey(req, "tenant", "repo-sentinel", packet, CriteriaRecord{}, LiveModel, "high", "shadow", nil)
	if untagged != want {
		t.Fatalf("untagged key changed: %s want %s", untagged, want)
	}
	if got := PreUpgradeExecutionKey(req, "tenant", "repo-sentinel", packet, CriteriaRecord{}, LiveModel, "high", "shadow"); got != want {
		t.Fatalf("pre-upgrade helper=%s want %s", got, want)
	}
	alpha := executionKey(req, "tenant", "repo-sentinel", packet, CriteriaRecord{}, LiveModel, "high", "shadow", []string{"alpha"})
	beta := executionKey(req, "tenant", "repo-sentinel", packet, CriteriaRecord{}, LiveModel, "high", "shadow", []string{"beta"})
	if alpha == beta || alpha == untagged || beta == untagged {
		t.Fatalf("tag keys not distinct: untagged=%s alpha=%s beta=%s", untagged, alpha, beta)
	}
	if got := canonicalTags([]string{"beta", "alpha", "beta"}); strings.Join(got, ",") != "alpha,beta" {
		t.Fatalf("canonical tags=%v", got)
	}
}

func TestStoreFalseBypassesCacheAndPersistence(t *testing.T) {
	t.Run("identical stored call still pays again", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
		}))
		defer srv.Close()
		cfg := availableConfig(srv.URL)
		req := reviewRequest(true)
		if out, err := Run(context.Background(), tenant, "tenant", req, cfg); err != nil || out.Status != "ok" {
			t.Fatalf("stored=%+v %v", out, err)
		}
		inputs := countReviewInputs(t, tenant)
		claims := reservationsClaimCount(cfg.Reservations)
		ephemeral := req
		off := false
		ephemeral.Store = &off
		out, err := Run(context.Background(), tenant, "tenant", ephemeral, cfg)
		if err != nil || out.Status != "ok" {
			t.Fatalf("ephemeral=%+v %v", out, err)
		}
		if out.Result == nil {
			t.Fatal("store=false did not return a full result")
		}
		if calls.Load() != 2 {
			t.Fatalf("provider calls=%d want 2", calls.Load())
		}
		rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 10})
		if err != nil || len(rows) != 1 {
			t.Fatalf("rows=%d err=%v", len(rows), err)
		}
		if countReviewInputs(t, tenant) != inputs {
			t.Fatal("store=false wrote a review input")
		}
		if reservationsClaimCount(cfg.Reservations) != claims {
			t.Fatal("store=false added a durable claim")
		}
	})

	t.Run("fresh store=false leaves no claim or record", func(t *testing.T) {
		tenant := reviewTenant(t)
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			io.WriteString(w, providerReply([]any{}, []any{}, []any{}, "complete"))
		}))
		defer srv.Close()
		cfg := availableConfig(srv.URL)
		off := false
		req := reviewRequest(true)
		req.Store = &off
		out, err := Run(context.Background(), tenant, "tenant", req, cfg)
		if err != nil || out.Status != "ok" || out.Result == nil || calls.Load() != 1 {
			t.Fatalf("%+v %v calls=%d", out, err, calls.Load())
		}
		if reservationsClaimCount(cfg.Reservations) != 0 {
			t.Fatal("store=false created a durable claim")
		}
		rows, err := tenant.ReviewRecords(context.Background(), store.ReviewRecordFilter{Limit: 10})
		if err != nil || len(rows) != 0 {
			t.Fatalf("rows=%d err=%v", len(rows), err)
		}
		if n := countReviewInputs(t, tenant); n != 0 {
			t.Fatalf("review inputs=%d", n)
		}
	})
}
