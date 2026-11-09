package serve

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func lifecycleConfig(dir, ghBase string) Config {
	return Config{
		Addr:                    "0.0.0.0:8770",
		Data:                    dir,
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "cid",
		GitHubOAuthClientSecret: "csec",
	}
}

func newLifecycleServer(dir, ghBase string, opts Options) *Server {
	opts.DisableWorker = true
	opts.GitHubHTTPBase = ghBase
	return New(lifecycleConfig(dir, ghBase), opts)
}

func seedTenantAssets(t *testing.T, s *Server, tenant string) {
	t.Helper()
	ts, err := s.tenant(tenant)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	raw := func(id string) []byte { return []byte(`{"id":"` + id + `"}`) }
	if _, err := ts.t.Append(ctx, []store.FactRow{{
		RowHash: "fact-" + tenant, Type: "artifact_version", ConversationID: "c", Harness: "h",
		Event: "w", TS: 1, RepoID: "r", Path: "docs/plan.md", Raw: raw("fact-" + tenant),
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.t.AppendReviewRuns(ctx, []store.FactRow{{
		RowHash: "rev-" + tenant, Type: "review_run", ConversationID: "c", RepoID: "r", TS: 2, Raw: raw("rev-" + tenant),
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.t.AppendReviewUsage(ctx, []store.ReviewUsageRow{{
		UsageID: "use-" + tenant, TS: 3, Raw: raw("use-" + tenant),
	}}); err != nil {
		t.Fatal(err)
	}
}

func seedTenantReservations(t *testing.T, s *Server, amounts map[string]float64) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var spent, claims []string
	for tenant, amount := range amounts {
		spent = append(spent, fmt.Sprintf(`{"at":%q,"amount":%v,"key":"k-%s","tenant":%q,"version":2}`, now, amount, tenant, tenant))
		claims = append(claims, fmt.Sprintf(`%q:{"id":"id-%s","tenant":%q,"version":2}`, "k-"+tenant, tenant, tenant))
	}
	doc := fmt.Sprintf(`{"version":2,"spent":[%s],"claims":{%s}}`, strings.Join(spent, ","), strings.Join(claims, ","))
	path := filepath.Join(s.cfg.Data, "review-reservations.json")
	if err := os.WriteFile(path, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	res, err := review.NewPersistentReservations(100, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	s.reviewReservations = res
}

func reservationSpent(t *testing.T, s *Server) (float64, []string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(s.cfg.Data, "review-reservations.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Spent []struct {
			Amount float64 `json:"amount"`
			Tenant string  `json:"tenant"`
		} `json:"spent"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	total := 0.0
	var tenants []string
	for _, e := range doc.Spent {
		total += e.Amount
		if e.Tenant != "" {
			tenants = append(tenants, e.Tenant)
		}
	}
	return total, tenants
}

func lifecycleRecord(t *testing.T, s *Server, tenant string) TenantLifecycleRecord {
	t.Helper()
	rec, ok := s.registry.TenantLifecycle(tenant)
	if !ok {
		t.Fatalf("tenant %q has no lifecycle record", tenant)
	}
	return rec
}

func digestTree(t *testing.T, root string) string {
	t.Helper()
	h := sha256.New()
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			_, _ = h.Write([]byte("d:" + p + "\n"))
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		_, _ = h.Write([]byte("f:" + p + ":"))
		_, _ = h.Write(b)
		_, _ = h.Write([]byte("\n"))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func approveGrant(t *testing.T, s *Server, deviceCode, tenant string) {
	t.Helper()
	userCode, err := s.grants.create(deviceCode, "192.0.2.1", "host")
	if err != nil {
		t.Fatal(err)
	}
	found, blocked, err := s.grants.decide("sess", userCode, func(gr *deviceGrant) error {
		gr.status, gr.tenant = grantApproved, tenant
		return nil
	})
	if err != nil || !found || blocked {
		t.Fatalf("approve grant: found=%v blocked=%v err=%v", found, blocked, err)
	}
}

func TestResetTenantErasesAssetsAndKeepsIdentity(t *testing.T) {
	gh := mockGitHub(t, 301, "reset-owner", []mockEmail{{Email: "reset@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := newLifecycleServer(dir, gh.URL, Options{})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")
	b := remoteCreateTenant(t, h, origin, sess, "b")

	_, aTok := remoteIssueToken(t, h, origin, sess, a, TokenScopeReadWrite, "1d")
	_, bTok := remoteIssueToken(t, h, origin, sess, b, TokenScopeRead, "1d")
	seedTenantAssets(t, s, a)
	seedTenantAssets(t, s, b)
	seedTenantReservations(t, s, map[string]float64{a: 1.5, b: 2.5})
	approveGrant(t, s, "dev-a", a)

	before := lifecycleRecord(t, s, a)
	beforeTotal, _ := reservationSpent(t, s)
	bDigest := digestTree(t, filepath.Join(dir, b))

	if err := s.ResetTenant(context.Background(), 301, a); err != nil {
		t.Fatalf("reset: %v", err)
	}

	after := lifecycleRecord(t, s, a)
	if after.State != lifecycleStateActive || after.Operation != "" || after.Generation == before.Generation ||
		after.Marker != before.Marker || s.registry.TenantName(a) != "a" || !s.registry.ownsTenant(301, a) {
		t.Fatalf("reset identity/generation: before=%+v after=%+v", before, after)
	}
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("tenant directory survived reset: %v", err)
	}
	for _, rec := range s.registry.ListAllTokens() {
		if rec.Tenant == a {
			t.Fatalf("token survived reset: %+v", rec)
		}
	}
	if s.grants.tenantResidue(a) {
		t.Fatal("device grant survived reset")
	}
	if s.reviewReservations.TenantResidue(a) || !s.reviewReservations.TenantResidue(b) {
		t.Fatal("claim/spend attribution after reset is wrong")
	}
	afterTotal, attributed := reservationSpent(t, s)
	for _, tenant := range attributed {
		if tenant == a {
			t.Fatalf("tenant-attributed spend survived reset: %v", attributed)
		}
	}
	if afterTotal != beforeTotal {
		t.Fatalf("provider-wide total changed: %v -> %v", beforeTotal, afterTotal)
	}
	if code, _ := do(t, h, "GET", "/v1/whoami", aTok, ""); code != 401 {
		t.Fatalf("old token still authorizes after reset: %d", code)
	}

	if got := digestTree(t, filepath.Join(dir, b)); got != bDigest {
		t.Fatal("other tenant's persisted bytes changed")
	}
	if code, body := do(t, h, "GET", "/v1/whoami", bTok, ""); code != 200 || !strings.Contains(body, `"tenant":"`+b+`"`) {
		t.Fatalf("other tenant auth broke: %d %s", code, body)
	}

	ts, err := s.tenant(a)
	if err != nil {
		t.Fatalf("re-open reset tenant: %v", err)
	}
	if n, err := ts.t.FactCount(context.Background()); err != nil || n != 0 {
		t.Fatalf("reset tenant not empty: n=%d err=%v", n, err)
	}
	if rows, err := ts.t.ReviewUsageRecords(context.Background()); err != nil || len(rows) != 0 {
		t.Fatalf("reset tenant usage: %d %v", len(rows), err)
	}
	if rows, err := ts.t.ReviewRecords(context.Background(), store.ReviewRecordFilter{}); err != nil || len(rows) != 0 {
		t.Fatalf("reset tenant reviews: %d %v", len(rows), err)
	}
}

func TestDeleteTenantErasesEverythingAndRefusesLazyAdmission(t *testing.T) {
	gh := mockGitHub(t, 302, "del-owner", []mockEmail{{Email: "del@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := newLifecycleServer(dir, gh.URL, Options{})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")
	b := remoteCreateTenant(t, h, origin, sess, "b")
	_, aTok := remoteIssueToken(t, h, origin, sess, a, TokenScopeReadWrite, "1d")
	_, bTok := remoteIssueToken(t, h, origin, sess, b, TokenScopeRead, "1d")
	seedTenantAssets(t, s, a)
	seedTenantAssets(t, s, b)
	seedTenantReservations(t, s, map[string]float64{a: 1, b: 2})
	approveGrant(t, s, "dev-a", a)
	bDigest := digestTree(t, filepath.Join(dir, b))

	if err := s.DeleteTenant(context.Background(), 302, a); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("tenant directory survived delete: %v", err)
	}
	if s.registry.tenantRegistered(a) || s.registry.ownsTenant(302, a) {
		t.Fatal("deleted tenant still owned/registered")
	}
	if _, ok := s.registry.TenantLifecycle(a); ok {
		t.Fatal("deleted tenant still has lifecycle metadata")
	}
	assertNoTenantGate(t, s, a)
	if s.grants.tenantResidue(a) || s.reviewReservations.TenantResidue(a) {
		t.Fatal("deleted tenant has grant/claim residue")
	}
	if code, _ := do(t, h, "GET", "/v1/whoami", aTok, ""); code != 401 {
		t.Fatalf("deleted tenant token still authorizes: %d", code)
	}
	if code, _ := do(t, h, "GET", "/v1/reviews?repo_id=r", aTok, ""); code != 401 {
		t.Fatalf("deleted tenant token still reaches data plane: %d", code)
	}
	if _, err := s.beginTenantUse(a); !errors.Is(err, ErrTenantNotFound) {
		t.Fatalf("lazy admission for deleted id: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("refused admission recreated the directory: %v", err)
	}
	if errors.Is(s.DeleteTenant(context.Background(), 302, a), ErrTenantNotFound) == false {
		t.Fatal("repeated delete is not not-found")
	}

	if got := digestTree(t, filepath.Join(dir, b)); got != bDigest {
		t.Fatal("other tenant's persisted bytes changed")
	}
	if code, body := do(t, h, "GET", "/v1/whoami", bTok, ""); code != 200 || !strings.Contains(body, `"tenant":"`+b+`"`) {
		t.Fatalf("other tenant auth broke: %d %s", code, body)
	}
}

func TestLifecycleFaultResumesSameOperation(t *testing.T) {
	stages := []string{"after-begin", "after-stop", "after-quiesce", "after-tokens", "after-claims", "after-close", "after-rename", "after-erase"}
	for _, stage := range stages {
		t.Run(stage, func(t *testing.T) {
			gh := mockGitHub(t, 303, "fault-owner", []mockEmail{{Email: "fault@example.com", Verified: true}})
			t.Cleanup(gh.Close)
			dir := t.TempDir()
			fault := func(at string) error {
				if at == stage {
					return errors.New("injected fault")
				}
				return nil
			}
			s1 := newLifecycleServer(dir, gh.URL, Options{LifecycleFault: fault})
			h := s1.Handler()
			origin := "https://collector.example"
			sess := loginRemote(t, h, origin)
			a := remoteCreateTenant(t, h, origin, sess, "a")
			seedTenantAssets(t, s1, a)
			before := lifecycleRecord(t, s1, a)

			err := s1.ResetTenant(context.Background(), 303, a)
			if !errors.Is(err, ErrTenantCleanupIncomplete) {
				t.Fatalf("faulted reset err=%v", err)
			}
			mid := lifecycleRecord(t, s1, a)
			if mid.State != lifecycleStateResetting || mid.Operation != lifecycleOpReset {
				t.Fatalf("journal after fault: %+v", mid)
			}
			if err := s1.DeleteTenant(context.Background(), 303, a); !errors.Is(err, ErrTenantLifecycleBusy) {
				t.Fatalf("operation switch while resetting: %v", err)
			}
			if _, err := s1.beginTenantUse(a); !errors.Is(err, ErrTenantLifecycleBusy) {
				t.Fatalf("faulted id should stay unavailable: %v", err)
			}
			if err := s1.Close(); err != nil {
				t.Fatal(err)
			}

			s2 := newLifecycleServer(dir, gh.URL, Options{})
			defer s2.Close()
			after := lifecycleRecord(t, s2, a)
			if after.State != lifecycleStateActive || after.Operation != "" || after.Generation == before.Generation || after.Marker != before.Marker {
				t.Fatalf("resume did not finish the reset: %+v", after)
			}
			if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
				t.Fatalf("resume left the directory: %v", err)
			}
			if !s2.registry.ownsTenant(303, a) {
				t.Fatal("resume performed delete instead of reset")
			}
		})
	}
}

func TestLifecycleDeleteFaultResume(t *testing.T) {
	gh := mockGitHub(t, 306, "del-fault", []mockEmail{{Email: "delfault@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	fault := func(stage string) error {
		if stage == "after-close" {
			return errors.New("injected delete fault")
		}
		return nil
	}
	s1 := newLifecycleServer(dir, gh.URL, Options{LifecycleFault: fault})
	h := s1.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")
	seedTenantAssets(t, s1, a)

	if err := s1.DeleteTenant(context.Background(), 306, a); !errors.Is(err, ErrTenantCleanupIncomplete) {
		t.Fatalf("faulted delete: %v", err)
	}
	if rec := lifecycleRecord(t, s1, a); rec.State != lifecycleStateDeleting || rec.Operation != lifecycleOpDelete {
		t.Fatalf("delete journal: %+v", rec)
	}
	if err := s1.ResetTenant(context.Background(), 306, a); !errors.Is(err, ErrTenantLifecycleBusy) {
		t.Fatalf("operation switch while deleting: %v", err)
	}
	if err := s1.Close(); err != nil {
		t.Fatal(err)
	}

	s2 := newLifecycleServer(dir, gh.URL, Options{})
	defer s2.Close()
	if s2.registry.tenantRegistered(a) || s2.registry.ownsTenant(306, a) {
		t.Fatal("resume did not finish delete")
	}
	if _, ok := s2.registry.TenantLifecycle(a); ok {
		t.Fatal("resume left lifecycle metadata")
	}
	assertNoTenantGate(t, s2, a)
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("resume left the directory: %v", err)
	}
}

func TestLifecycleBusyBeforeEffectsAndConcurrentRefusal(t *testing.T) {
	gh := mockGitHub(t, 304, "busy-owner", []mockEmail{{Email: "busy@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	reached := make(chan struct{})
	release := make(chan struct{})
	fault := func(stage string) error {
		if stage == "after-begin" {
			close(reached)
			<-release
		}
		return nil
	}
	s := newLifecycleServer(dir, gh.URL, Options{LifecycleFault: fault})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")
	_, tok := remoteIssueToken(t, h, origin, sess, a, TokenScopeReadWrite, "1d")
	seedTenantAssets(t, s, a)
	approveGrant(t, s, "dev-a", a)
	before := lifecycleRecord(t, s, a)

	// A held target gate refuses before any journal is written.
	gate := s.tenantGate(a)
	gate.RLock()
	err := s.ResetTenant(context.Background(), 304, a)
	gate.RUnlock()
	if !errors.Is(err, ErrTenantLifecycleBusy) {
		t.Fatalf("held gate reset: %v", err)
	}
	if rec := lifecycleRecord(t, s, a); rec.State != lifecycleStateActive || rec == (TenantLifecycleRecord{}) {
		t.Fatalf("busy call changed the journal: %+v", rec)
	}
	if _, err := os.Stat(filepath.Join(dir, a)); err != nil {
		t.Fatalf("busy call touched the directory: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- s.ResetTenant(context.Background(), 304, a) }()
	<-reached

	for _, tc := range []struct {
		name, method, path, body string
		bearer                   bool
	}{
		{"ingest", "POST", "/v1/ingest", artBody("# held\n"), true},
		{"token", "POST", "/v1/tokens", `{"tenant":"` + a + `","scope":"read","lifetime":"1d"}`, false},
		{"reviews", "GET", "/v1/reviews?repo_id=r", "", true},
		{"device redeem", "POST", "/v1/device/token", `{"device_code":"dev-a"}`, false},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if tc.method == "POST" && (tc.path == "/v1/tokens" || tc.path == "/v1/ingest") {
			req.Header.Set("Origin", origin)
		}
		if tc.bearer {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		for _, c := range sess {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "tenant_busy") {
			t.Fatalf("%s during cleanup: %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("reset after refusal: %v", err)
	}
	after := lifecycleRecord(t, s, a)
	if after.Generation == before.Generation {
		t.Fatal("reset did not advance the generation")
	}
}

func TestRepeatedResetAndDelete(t *testing.T) {
	gh := mockGitHub(t, 305, "repeat-owner", []mockEmail{{Email: "repeat@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	dir := t.TempDir()
	s := newLifecycleServer(dir, gh.URL, Options{})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")

	seedTenantAssets(t, s, a)
	first := lifecycleRecord(t, s, a)
	if err := s.ResetTenant(context.Background(), 305, a); err != nil {
		t.Fatal(err)
	}
	second := lifecycleRecord(t, s, a)
	if second.Generation == first.Generation {
		t.Fatal("first reset did not advance the generation")
	}

	seedTenantAssets(t, s, a)
	if err := s.ResetTenant(context.Background(), 305, a); err != nil {
		t.Fatal(err)
	}
	third := lifecycleRecord(t, s, a)
	if third.Generation == second.Generation || third.State != lifecycleStateActive {
		t.Fatalf("second reset: %+v", third)
	}
	if _, err := os.Stat(filepath.Join(dir, a)); !os.IsNotExist(err) {
		t.Fatalf("second reset left the directory: %v", err)
	}

	if err := s.DeleteTenant(context.Background(), 305, a); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(s.DeleteTenant(context.Background(), 305, a), ErrTenantNotFound) {
		t.Fatal("repeated delete is not not-found")
	}
}
