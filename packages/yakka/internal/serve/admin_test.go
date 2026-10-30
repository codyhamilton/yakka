package serve

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func adminTestServer(t *testing.T, dir, ghBase string, step ScreenFunc) *Server {
	t.Helper()
	cfg := Config{
		Addr:                    "0.0.0.0:8770",
		Data:                    dir,
		PublicURL:               "https://collector.example",
		GitHubOAuthClientID:     "cid",
		GitHubOAuthClientSecret: "csec",
	}
	s := New(cfg, Options{DisableWorker: true, GitHubHTTPBase: ghBase, ScreenStep: step})
	t.Cleanup(func() { s.Close() })
	return s
}

// seedUnscored stores content the way a scorer-less server does: a blob whose only screen is
// "unscreened".
func seedUnscored(t *testing.T, s *Server, tenant, content string) string {
	t.Helper()
	ts, err := s.tenant(tenant)
	if err != nil {
		t.Fatal(err)
	}
	h := keys.ContentHash([]byte(content))
	if err := ts.t.WritePending(h, []byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := ts.t.Promote(context.Background(), h, store.Screen{Verdict: "unscreened"}); err != nil {
		t.Fatal(err)
	}
	return h
}

type adminStatusResp struct {
	Scoring struct {
		Rescorable bool `json:"rescorable"`
	} `json:"scoring"`
	Volume  map[string]uint64 `json:"volume"`
	Tenants []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Facts     int    `json:"facts"`
		Footprint struct {
			Blobs int `json:"blobs"`
		} `json:"footprint"`
		Screens struct {
			Verdicts   map[string]int `json:"verdicts"`
			ScoredRows int            `json:"score_rows"`
		} `json:"screens"`
		Failures []struct {
			Pattern string `json:"pattern"`
		} `json:"failures"`
		Rescore RescoreView `json:"rescore"`
	} `json:"tenants"`
}

func TestAdminStatusAndRescore(t *testing.T) {
	ghAdmin := mockGitHub(t, 1, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(ghAdmin.Close)
	ghMember := mockGitHub(t, 2, "member", []mockEmail{{Email: "member@allowed.example", Verified: true}})
	t.Cleanup(ghMember.Close)
	dir := t.TempDir()
	origin := "https://collector.example"

	step := func(ctx context.Context, tn *store.Tenant, hash string) error {
		return tn.Promote(ctx, hash, store.Screen{Verdict: "pass", Scorer: "test"}, store.Score{Check: "c", Result: 1})
	}
	sAdmin := adminTestServer(t, dir, ghAdmin.URL, step)
	hAdmin := sAdmin.Handler()
	admin := loginRemote(t, hAdmin, origin)
	tid := remoteCreateTenant(t, hAdmin, origin, admin, "ops")
	hash := seedUnscored(t, sAdmin, tid, "# design\n")
	if err := mustAppendRejection(sAdmin, tid); err != nil {
		t.Fatal(err)
	}

	hMember := adminTestServer(t, dir, ghMember.URL, step).Handler()
	member := loginRemote(t, hMember, origin)
	if code, _, _ := doWithCookies(t, hMember, "GET", "/v1/admin/status", origin, "", member); code != 403 {
		t.Fatalf("member status: %d", code)
	}
	if code, _, _ := doWithCookies(t, hMember, "POST", "/v1/admin/rescore", origin, `{"tenant":"`+tid+`"}`, member); code != 403 {
		t.Fatalf("member rescore: %d", code)
	}
	if code, _, _ := doWithCookies(t, hAdmin, "GET", "/v1/admin/status", origin, "", nil); code != 401 {
		t.Fatalf("status without session: %d", code)
	}
	bearer := httptest.NewRequest(http.MethodGet, "/v1/admin/status", nil)
	bearer.Header.Set("Authorization", "Bearer wk_not-a-session")
	bearer.Header.Set("Origin", origin)
	for _, c := range admin {
		bearer.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	hAdmin.ServeHTTP(rec, bearer)
	if rec.Code != 401 {
		t.Fatalf("bearer on status: %d", rec.Code)
	}
	if code, _, _ := doWithCookies(t, hAdmin, "POST", "/v1/admin/rescore", "https://evil.example", `{"tenant":"`+tid+`"}`, admin); code != 403 {
		t.Fatalf("rescore from another origin: %d", code)
	}

	status := func() adminStatusResp {
		code, body, _ := doWithCookies(t, hAdmin, "GET", "/v1/admin/status", origin, "", admin)
		if code != 200 {
			t.Fatalf("status: %d %s", code, body)
		}
		var r adminStatusResp
		if err := json.Unmarshal([]byte(body), &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	st := status()
	if !st.Scoring.Rescorable || st.Volume["total_bytes"] == 0 || len(st.Tenants) != 1 {
		t.Fatalf("status shape: %+v", st)
	}
	tn := st.Tenants[0]
	if tn.ID != tid || tn.Name != "ops" || tn.Footprint.Blobs != 1 || tn.Screens.Verdicts["unscreened"] != 1 {
		t.Fatalf("tenant status: %+v", tn)
	}
	if len(tn.Failures) != 1 || tn.Failures[0].Pattern != "screen_error" {
		t.Fatalf("failures: %+v", tn.Failures)
	}

	if code, _, _ := doWithCookies(t, hAdmin, "POST", "/v1/admin/rescore", origin, `{"tenant":"nope"}`, admin); code != 404 {
		t.Fatalf("unknown tenant: %d", code)
	}
	if code, _, _ := doWithCookies(t, hAdmin, "POST", "/v1/admin/rescore", origin, `{}`, admin); code != 400 {
		t.Fatalf("no tenant: %d", code)
	}
	code, body, _ := doWithCookies(t, hAdmin, "POST", "/v1/admin/rescore", origin, `{"tenant":"`+tid+`"}`, admin)
	if code != 202 || !strings.Contains(body, `"total":1`) {
		t.Fatalf("rescore: %d %s", code, body)
	}
	deadline := time.Now().Add(5 * time.Second)
	for status().Tenants[0].Rescore.Running {
		if time.Now().After(deadline) {
			t.Fatal("rescore did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}
	tn = status().Tenants[0]
	if tn.Rescore.Done != 1 || tn.Rescore.Failed != 0 || tn.Screens.Verdicts["pass"] != 1 || tn.Screens.Verdicts["unscreened"] != 0 || tn.Screens.ScoredRows != 1 {
		t.Fatalf("after rescore: %+v", tn)
	}
	_ = hash
}

func mustAppendRejection(s *Server, tenant string) error {
	ts, err := s.tenant(tenant)
	if err != nil {
		return err
	}
	return ts.t.AppendRejection(context.Background(), store.Rejection{Stage: "screen", Pattern: "screen_error",
		Reason: "screen error: boom", FactType: "artifact_version", ContentHash: strings.Repeat("a", 64), Path: "docs/x.md"})
}

func TestAdminRescoreFlagClearsUnscreened(t *testing.T) {
	gh := mockGitHub(t, 1, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	origin := "https://collector.example"
	step := func(ctx context.Context, tn *store.Tenant, hash string) error {
		return tn.DropBlob(ctx, hash, store.Rejection{Stage: "screen", Pattern: "jev_screen", Reason: "flagged"})
	}
	s := adminTestServer(t, t.TempDir(), gh.URL, step)
	h := s.Handler()
	admin := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, admin, "ops")
	seedUnscored(t, s, tid, "# design\n")
	code, body, _ := doWithCookies(t, h, "POST", "/v1/admin/rescore", origin, `{"tenant":"`+tid+`"}`, admin)
	if code != 202 {
		t.Fatalf("rescore: %d %s", code, body)
	}
	deadline := time.Now().Add(5 * time.Second)
	var flagged adminStatusResp
	for {
		code, body, _ = doWithCookies(t, h, "GET", "/v1/admin/status", origin, "", admin)
		if code != 200 {
			t.Fatalf("status: %d %s", code, body)
		}
		// A fresh value each poll: encoding/json keeps map keys that the next body omits.
		flagged = adminStatusResp{}
		if err := json.Unmarshal([]byte(body), &flagged); err != nil {
			t.Fatal(err)
		}
		if len(flagged.Tenants) == 1 && !flagged.Tenants[0].Rescore.Running && flagged.Tenants[0].Screens.Verdicts["unscreened"] == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("rescore did not clear the unscreened verdict: %+v", flagged)
		}
		time.Sleep(10 * time.Millisecond)
	}
	flaggedTenant := flagged.Tenants[0]
	if flaggedTenant.Rescore.Failed != 0 || flaggedTenant.Rescore.Done != 1 {
		t.Fatalf("after flag: %+v", flaggedTenant)
	}
	if len(flaggedTenant.Failures) != 1 || flaggedTenant.Failures[0].Pattern != "jev_screen" {
		t.Fatalf("failures: %+v", flaggedTenant.Failures)
	}
}

func TestAdminRescoreNeedsScorer(t *testing.T) {
	gh := mockGitHub(t, 1, "codyh", []mockEmail{{Email: adminEmail, Verified: true}})
	t.Cleanup(gh.Close)
	origin := "https://collector.example"
	s := adminTestServer(t, t.TempDir(), gh.URL, nil)
	h := s.Handler()
	admin := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, admin, "ops")
	seedUnscored(t, s, tid, "# design\n")
	code, body, _ := doWithCookies(t, h, "POST", "/v1/admin/rescore", origin, `{"tenant":"`+tid+`"}`, admin)
	if code != 409 || !strings.Contains(body, "scoring is off") {
		t.Fatalf("rescore without scorer: %d %s", code, body)
	}
}
