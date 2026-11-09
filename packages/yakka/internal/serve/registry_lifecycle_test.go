package serve

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tenantByID(infos []TenantInfo, id string) (TenantInfo, bool) {
	for _, in := range infos {
		if in.ID == id {
			return in, true
		}
	}
	return TenantInfo{}, false
}

func TestNewTenantsHaveActiveLifecycle(t *testing.T) {
	r, err := OpenRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, ok, err := r.CreateTenant("work", 201)
	if err != nil || !ok {
		t.Fatalf("create: ok=%v err=%v", ok, err)
	}
	lc, ok := r.TenantLifecycle(id)
	if !ok || lc.State != lifecycleStateActive || lc.Marker == "" || lc.Generation == "" || lc.Operation != "" {
		t.Fatalf("created tenant lifecycle: ok=%v %+v", ok, lc)
	}
	workLC := lc

	created, err := r.EnsureDefaultTenant(202)
	if err != nil || !created {
		t.Fatalf("ensure default: created=%v err=%v", created, err)
	}
	owned := r.tenantsOwnedBy(202)
	if len(owned) != 1 {
		t.Fatalf("owned: %+v", owned)
	}
	lc, ok = r.TenantLifecycle(owned[0].ID)
	if !ok || lc.State != lifecycleStateActive || lc.Marker == "" || lc.Generation == "" {
		t.Fatalf("default tenant lifecycle: ok=%v %+v", ok, lc)
	}

	// The lifecycle record survives a restart unchanged.
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	r2, err := OpenRegistry(filepath.Dir(r.RegistryPath()))
	if err != nil {
		t.Fatal(err)
	}
	again, ok := r2.TenantLifecycle(id)
	if !ok || again != workLC {
		t.Fatalf("reloaded lifecycle: ok=%v %+v want %+v", ok, again, workLC)
	}
	if got := r2.tenantsOwnedBy(201); len(got) != 1 || got[0].LifecycleState != lifecycleStateActive || got[0].LifecycleGeneration == nil || *got[0].LifecycleGeneration == "" {
		t.Fatalf("reloaded tenant info: %+v", got)
	}
}

func TestMeReportsActiveLifecycle(t *testing.T) {
	gh := mockGitHub(t, 203, "life", []mockEmail{{Email: "life@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	second := remoteCreateTenant(t, h, origin, sess, "second")

	got := getTenants(t, s, origin, sess)
	if len(got) != 2 {
		t.Fatalf("want default+second, got %+v", got)
	}
	if _, ok := tenantByID(got, second); !ok {
		t.Fatalf("second tenant missing: %+v", got)
	}
	for _, in := range got {
		if in.LifecycleState != lifecycleStateActive || in.LifecycleGeneration == nil || *in.LifecycleGeneration == "" {
			t.Fatalf("tenant %q not active with generation: %+v", in.ID, in)
		}
	}
}

func TestLegacyTenantReportsUnsupported(t *testing.T) {
	dir := t.TempDir()
	doc := `{"version":1,"policy":{"mode":"everyone"},"sessions":{},"owners":{"t-legacy":"204"},"names":{"t-legacy":"old"},"token_hashes":[]}`
	if err := os.WriteFile(filepath.Join(dir, registryFileName), []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := OpenRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := r.tenantsOwnedBy(204)
	if len(got) != 1 || got[0].ID != "t-legacy" || got[0].Name != "old" {
		t.Fatalf("owned: %+v", got)
	}
	if got[0].LifecycleState != lifecycleStateUnsupported || got[0].LifecycleGeneration != nil {
		t.Fatalf("legacy lifecycle: %+v", got[0])
	}
	if _, ok := r.TenantLifecycle("t-legacy"); ok {
		t.Fatal("legacy tenant must not have a lifecycle record")
	}
	if err := r.BeginTenantReset(204, "t-legacy"); !errors.Is(err, ErrLegacyTenantCleanupUnsupported) {
		t.Fatalf("begin reset on legacy: %v", err)
	}
	if err := r.BeginTenantDelete(204, "t-legacy"); !errors.Is(err, ErrLegacyTenantCleanupUnsupported) {
		t.Fatalf("begin delete on legacy: %v", err)
	}
	if err := r.BeginTenantReset(999, "t-legacy"); !errors.Is(err, ErrTenantOwnerRequired) {
		t.Fatalf("non-owner begin: %v", err)
	}
	if err := r.BeginTenantReset(204, "t-absent"); !errors.Is(err, ErrTenantNotFound) {
		t.Fatalf("absent begin: %v", err)
	}
}

func TestTenantLifecycleTransitions(t *testing.T) {
	gh := mockGitHub(t, 205, "trans", []mockEmail{{Email: "trans@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "trial")

	before, ok := s.registry.TenantLifecycle(tid)
	if !ok {
		t.Fatal("no lifecycle after create")
	}

	if err := s.registry.BeginTenantReset(205, tid); err != nil {
		t.Fatal(err)
	}
	got, ok := tenantByID(getTenants(t, s, origin, sess), tid)
	if !ok || got.Name != "trial" || got.LifecycleState != lifecycleStateResetting || got.LifecycleGeneration == nil || *got.LifecycleGeneration != before.Generation {
		t.Fatalf("resetting view: ok=%v %+v want generation %q", ok, got, before.Generation)
	}
	if err := s.registry.BeginTenantDelete(205, tid); !errors.Is(err, ErrTenantLifecycleBusy) {
		t.Fatalf("conflicting begin while resetting: %v", err)
	}

	newGen, err := s.registry.CompleteTenantReset(tid)
	if err != nil {
		t.Fatal(err)
	}
	if newGen == "" || newGen == before.Generation {
		t.Fatalf("reset generation not advanced: %q -> %q", before.Generation, newGen)
	}
	after, ok := s.registry.TenantLifecycle(tid)
	if !ok || after.State != lifecycleStateActive || after.Operation != "" || after.Generation != newGen || after.Marker != before.Marker {
		t.Fatalf("after reset: ok=%v %+v", ok, after)
	}
	got, ok = tenantByID(getTenants(t, s, origin, sess), tid)
	if !ok || got.Name != "trial" || got.LifecycleState != lifecycleStateActive || got.LifecycleGeneration == nil || *got.LifecycleGeneration != newGen {
		t.Fatalf("active after reset: ok=%v %+v", ok, got)
	}

	if err := s.registry.BeginTenantDelete(205, tid); err != nil {
		t.Fatal(err)
	}
	got, ok = tenantByID(getTenants(t, s, origin, sess), tid)
	if !ok || got.LifecycleState != lifecycleStateDeleting || got.LifecycleGeneration == nil || *got.LifecycleGeneration != newGen {
		t.Fatalf("deleting view: ok=%v %+v", ok, got)
	}
	if err := s.registry.BeginTenantReset(205, tid); !errors.Is(err, ErrTenantLifecycleBusy) {
		t.Fatalf("conflicting begin while deleting: %v", err)
	}

	if err := s.registry.CompleteTenantDelete(tid); err != nil {
		t.Fatal(err)
	}
	if _, ok := tenantByID(getTenants(t, s, origin, sess), tid); ok {
		t.Fatal("deleted tenant still listed")
	}
	if s.registry.ownsTenant(205, tid) {
		t.Fatal("deleted tenant still owned")
	}
	if _, ok := s.registry.GetSession(sess[0].Value, time.Now()); !ok {
		t.Fatal("session was removed by delete")
	}
}

func TestLifecycleCompletionPurgesTenantTokens(t *testing.T) {
	gh := mockGitHub(t, 206, "tok", []mockEmail{{Email: "tok@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	a := remoteCreateTenant(t, h, origin, sess, "a")
	b := remoteCreateTenant(t, h, origin, sess, "b")

	aRevoked, _ := remoteIssueToken(t, h, origin, sess, a, TokenScopeRead, "1d")
	aExpired, _ := remoteIssueToken(t, h, origin, sess, a, TokenScopeReadWrite, "1d")
	bKeep, _ := remoteIssueToken(t, h, origin, sess, b, TokenScopeRead, "1d")
	if _, already := s.registry.RevokeToken(aRevoked); already {
		t.Fatal("fresh token already revoked")
	}
	for i := range s.registry.tokenHashes {
		if s.registry.tokenHashes[i].ID == aExpired {
			s.registry.tokenHashes[i].ExpiresAt = time.Now().Add(-time.Hour)
		}
	}

	if err := s.registry.BeginTenantReset(206, a); err != nil {
		t.Fatal(err)
	}
	if _, err := s.registry.CompleteTenantReset(a); err != nil {
		t.Fatal(err)
	}
	for _, rec := range s.registry.ListAllTokens() {
		if rec.Tenant == a {
			t.Fatalf("token survived reset: %+v", rec)
		}
	}
	if !tokenPresent(s.registry, bKeep) {
		t.Fatal("other tenant's token was purged by reset")
	}
	if _, ok := s.registry.GetSession(sess[0].Value, time.Now()); !ok {
		t.Fatal("session removed by reset")
	}
	if !s.registry.ownsTenant(206, b) {
		t.Fatal("other owned tenant removed by reset")
	}

	aNew, _ := remoteIssueToken(t, h, origin, sess, a, TokenScopeRead, "1d")
	if err := s.registry.BeginTenantDelete(206, a); err != nil {
		t.Fatal(err)
	}
	if err := s.registry.CompleteTenantDelete(a); err != nil {
		t.Fatal(err)
	}
	if tokenPresent(s.registry, aNew) {
		t.Fatal("token survived delete")
	}
	if !tokenPresent(s.registry, bKeep) {
		t.Fatal("other tenant's token was purged by delete")
	}
	if _, ok := tenantByID(s.registry.tenantsOwnedBy(206), a); ok {
		t.Fatal("deleted tenant still owned")
	}
	if !s.registry.ownsTenant(206, b) {
		t.Fatal("other owned tenant removed by delete")
	}
}

func TestLifecycleSaveFailureRestoresMemory(t *testing.T) {
	dir := t.TempDir()
	r, err := OpenRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	id, ok, err := r.CreateTenant("work", 7)
	if err != nil || !ok {
		t.Fatalf("create: ok=%v err=%v", ok, err)
	}
	if err := r.Persist(); err != nil {
		t.Fatal(err)
	}
	before, ok := r.TenantLifecycle(id)
	if !ok {
		t.Fatal("missing lifecycle")
	}
	tok, err := r.CreateToken(id, TokenScopeRead, "laptop", time.Now().Add(time.Hour), 7, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Persist(); err != nil {
		t.Fatal(err)
	}
	savedPath := r.path
	blockSaves := func() { r.path = filepath.Join(dir, "missing-parent", registryFileName) }
	restoreSaves := func() { r.path = savedPath }

	blockSaves()
	if err := r.BeginTenantReset(7, id); err == nil {
		t.Fatal("begin reset saved despite an unwritable registry")
	}
	if got, ok := r.TenantLifecycle(id); !ok || got != before {
		t.Fatalf("failed begin reset mutated lifecycle: ok=%v %+v", ok, got)
	}
	disk, err := OpenRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := disk.TenantLifecycle(id); !ok || got != before {
		t.Fatalf("failed begin reset changed disk: ok=%v %+v", ok, got)
	}

	restoreSaves()
	if err := r.BeginTenantReset(7, id); err != nil {
		t.Fatal(err)
	}
	resetting, ok := r.TenantLifecycle(id)
	if !ok || resetting.State != lifecycleStateResetting {
		t.Fatalf("reset did not begin: %+v", resetting)
	}
	blockSaves()
	if _, err := r.CompleteTenantReset(id); err == nil {
		t.Fatal("complete reset saved despite an unwritable registry")
	}
	if got, ok := r.TenantLifecycle(id); !ok || got != resetting {
		t.Fatalf("failed complete reset mutated lifecycle: ok=%v %+v want %+v", ok, got, resetting)
	}
	if !tokenPresent(r, tok.Record.ID) {
		t.Fatal("failed complete reset dropped the token from memory")
	}

	restoreSaves()
	if _, err := r.CompleteTenantReset(id); err != nil {
		t.Fatal(err)
	}
	tok, err = r.CreateToken(id, TokenScopeRead, "after-reset", time.Now().Add(time.Hour), 7, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := r.BeginTenantDelete(7, id); err != nil {
		t.Fatal(err)
	}
	blockSaves()
	if err := r.CompleteTenantDelete(id); err == nil {
		t.Fatal("complete delete saved despite an unwritable registry")
	}
	if !r.ownsTenant(7, id) {
		t.Fatal("failed complete delete unregistered the tenant in memory")
	}
	if _, ok := r.TenantLifecycle(id); !ok {
		t.Fatal("failed complete delete dropped the lifecycle record")
	}
	if !tokenPresent(r, tok.Record.ID) {
		t.Fatal("failed complete delete dropped the token from memory")
	}
}

func tokenPresent(r *Registry, id string) bool {
	_, ok := r.TokenByID(id)
	return ok
}

func TestPurgeTenantDropsOnlyMatchingGrants(t *testing.T) {
	g := newDeviceGrants()
	aCode, err := g.create("dev-a", "192.0.2.1", "host")
	if err != nil {
		t.Fatal(err)
	}
	bCode, err := g.create("dev-b", "192.0.2.1", "host")
	if err != nil {
		t.Fatal(err)
	}
	pendingCode, err := g.create("dev-pending", "192.0.2.1", "host")
	if err != nil {
		t.Fatal(err)
	}
	approveAs := func(code, tenant string) {
		t.Helper()
		found, blocked, err := g.decide("sess", code, func(gr *deviceGrant) error {
			gr.status = grantApproved
			gr.tenant = tenant
			return nil
		})
		if err != nil || !found || blocked {
			t.Fatalf("decide %q: found=%v blocked=%v err=%v", code, found, blocked, err)
		}
	}
	approveAs(aCode, "a")
	approveAs(bCode, "b")

	g.purgeTenant("a")

	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.byHash[hashDeviceCode("dev-a")]; ok {
		t.Fatal("purged tenant grant survived")
	}
	if _, ok := g.byUser[normaliseUserCode(aCode)]; ok {
		t.Fatal("purged tenant user-code index survived")
	}
	if _, ok := g.byHash[hashDeviceCode("dev-b")]; !ok {
		t.Fatal("other tenant's grant was dropped")
	}
	if _, ok := g.byHash[hashDeviceCode("dev-pending")]; !ok {
		t.Fatal("pending grant with no tenant identity was dropped")
	}
	_ = pendingCode
}
