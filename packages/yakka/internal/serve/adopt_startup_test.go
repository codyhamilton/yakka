package serve

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// writeLegacyAdoptFixture writes a compact registry.json holding one owned
// tenant with no lifecycle record and one read token bound to it.
func writeLegacyAdoptFixture(t *testing.T, dir, tenant string, owner int64, plaintext string) {
	t.Helper()
	now := time.Now().UTC()
	doc := registryDoc{
		Version:  1,
		Policy:   DomainPolicy{Mode: PolicyEveryone},
		Sessions: map[string]SessionRecord{},
		Owners:   map[string]string{tenant: strconv.FormatInt(owner, 10)},
		Names:    map[string]string{tenant: "old"},
		TokenHashes: []TokenHashRecord{{
			ID:        "tok-" + tenant,
			Tenant:    tenant,
			Scope:     TokenScopeRead,
			Hash:      hashTokenPlaintext(plaintext),
			GitHubID:  owner,
			ExpiresAt: now.Add(time.Hour),
			Revoked:   false,
			CreatedAt: now,
		}},
	}
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, registryFileName), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestNewAdoptsWhenFlagOn(t *testing.T) {
	dir := t.TempDir()
	const plaintext = "wk_adopt_fixture_read"
	writeLegacyAdoptFixture(t, dir, "t-legacy", 204, plaintext)

	cfg := lifecycleConfig(dir, "http://127.0.0.1:1")
	cfg.AdoptUnmarkedTenants = true
	s := New(cfg, Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })

	origin := "https://collector.example"
	sess := putLifecycleSession(t, s, "sess-adopt-owner", 204)
	info, ok := tenantByID(getTenants(t, s, origin, sess), "t-legacy")
	if !ok || info.LifecycleState != lifecycleStateActive || info.LifecycleGeneration == nil || *info.LifecycleGeneration == "" {
		t.Fatalf("adopted tenant: ok=%v %+v", ok, info)
	}
	code, body := do(t, s.Handler(), "GET", "/v1/analytics/event-counts?tenant=t-legacy", plaintext, "")
	if code != 200 {
		t.Fatalf("adopted tenant analytics read: %d %s", code, body)
	}
}

func TestNewLeavesUnmarkedWhenFlagOff(t *testing.T) {
	dir := t.TempDir()
	const plaintext = "wk_unmarked_fixture_read"
	writeLegacyAdoptFixture(t, dir, "t-legacy", 204, plaintext)

	// New ends with Persist in remote mode, so compare against the normalised
	// form of the hand-written compact fixture.
	r, err := OpenRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	normalised, err := os.ReadFile(filepath.Join(dir, registryFileName))
	if err != nil {
		t.Fatal(err)
	}

	s := New(lifecycleConfig(dir, "http://127.0.0.1:1"), Options{DisableWorker: true, PollInterval: time.Hour})
	t.Cleanup(func() { _ = s.Close() })
	afterNew, err := os.ReadFile(filepath.Join(dir, registryFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(normalised, afterNew) {
		t.Fatal("start with the flag off rewrote registry.json")
	}

	origin := "https://collector.example"
	sess := putLifecycleSession(t, s, "sess-unmarked-owner", 204)
	info, ok := tenantByID(getTenants(t, s, origin, sess), "t-legacy")
	if !ok || info.LifecycleState != lifecycleStateUnmarked || info.LifecycleGeneration != nil {
		t.Fatalf("unmarked tenant: ok=%v %+v", ok, info)
	}
	code, body := do(t, s.Handler(), "GET", "/v1/analytics/event-counts?tenant=t-legacy", plaintext, "")
	if code != 200 {
		t.Fatalf("unmarked tenant analytics read: %d %s", code, body)
	}

	if err := s.RegisterStatelessMCPTools(); err != nil {
		t.Fatal(err)
	}
	reply := mcpDecode(t, mcpRequest(t, s.Handler(), plaintext, `{"id":1,"method":"tools/list"}`, nil))
	result, _ := reply["result"].(map[string]any)
	tools, _ := result["tools"].([]any)
	if len(tools) == 0 {
		t.Fatalf("unmarked tenant MCP tools/list was empty: %#v", reply)
	}

	remoteIssueToken(t, s.Handler(), origin, sess, "t-legacy", TokenScopeRead, "1d")
}

func TestNewAdoptSecondStartIsByteIdentical(t *testing.T) {
	dir := t.TempDir()
	const plaintext = "wk_b4_fixture_read"
	writeLegacyAdoptFixture(t, dir, "t-legacy", 204, plaintext)

	cfg := lifecycleConfig(dir, "http://127.0.0.1:1")
	cfg.AdoptUnmarkedTenants = true
	opts := Options{DisableWorker: true, PollInterval: time.Hour}

	first := New(cfg, opts)
	firstRec, ok := first.registry.TenantLifecycle("t-legacy")
	if !ok || firstRec.State != lifecycleStateActive || !isHex32(firstRec.Marker) || !isHex32(firstRec.Generation) {
		t.Fatalf("first start did not adopt: ok=%v %+v", ok, firstRec)
	}
	firstBytes, err := os.ReadFile(filepath.Join(dir, registryFileName))
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second := New(cfg, opts)
	t.Cleanup(func() { _ = second.Close() })
	secondRec, ok := second.registry.TenantLifecycle("t-legacy")
	if !ok || secondRec.Marker != firstRec.Marker || secondRec.Generation != firstRec.Generation {
		t.Fatalf("second start changed the record: ok=%v %+v want %+v", ok, secondRec, firstRec)
	}
	secondBytes, err := os.ReadFile(filepath.Join(dir, registryFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstBytes, secondBytes) {
		t.Fatal("second start changed registry.json")
	}
	firstSum := sha256.Sum256(firstBytes)
	secondSum := sha256.Sum256(secondBytes)
	t.Logf("registry.json SHA-256 after first start: %x", firstSum)
	t.Logf("registry.json SHA-256 after second start: %x", secondSum)
}
