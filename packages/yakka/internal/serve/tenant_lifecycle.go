package serve

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// ErrTenantCleanupIncomplete reports a begun reset/delete that could not finish.
// The journal remains, the id stays unavailable, and a restarted server resumes
// the same recorded operation.
var ErrTenantCleanupIncomplete = errors.New("tenant cleanup incomplete")

// lifecycleTrashName is the data-directory subdirectory holding quarantined
// tenant directories between rename and removal. It has no ledger.db of its own,
// so tenant-directory enumerators skip it.
const lifecycleTrashName = ".lifecycle-trash"

// tenantRegistered reports whether tenant has an owner entry. Legacy tenants do;
// ids removed by delete do not.
func (r *Registry) tenantRegistered(tenant string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.owners[tenant]
	return ok
}

// incompleteLifecycles snapshots marker-backed records naming an in-progress
// operation. Legacy records without a marker are never resumable.
func (r *Registry) incompleteLifecycles() map[string]TenantLifecycleRecord {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := map[string]TenantLifecycleRecord{}
	for tenant, rec := range r.lifecycle {
		if rec.Marker == "" {
			continue
		}
		if rec.State == lifecycleStateResetting || rec.State == lifecycleStateDeleting {
			out[tenant] = rec
		}
	}
	return out
}

// tenantResidue reports whether any device grant is attributed to tenant.
func (g *deviceGrants) tenantResidue(tenant string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, gr := range g.byHash {
		if gr.tenant == tenant {
			return true
		}
	}
	return false
}

// tenantGate returns the per-tenant admission gate, creating it on first use.
// The gate outlives a tenantState so a request cannot bypass cleanup by racing a
// lazy open after the cached state was evicted.
func (s *Server) tenantGate(name string) *sync.RWMutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gates == nil {
		s.gates = map[string]*sync.RWMutex{}
	}
	gate := s.gates[name]
	if gate == nil {
		gate = &sync.RWMutex{}
		s.gates[name] = gate
	}
	return gate
}

// evictTenantGate drops the per-tenant admission gate after a completed delete.
// The caller holds the gate's write lock, so no admitted work can still be using
// it. A later request creates a fresh gate and is refused by the registry
// unregistered check before any storage is opened.
func (s *Server) evictTenantGate(name string) {
	s.mu.Lock()
	delete(s.gates, name)
	s.mu.Unlock()
}

// beginTenantUse starts request work that can reach tenant storage. It holds the
// tenant's read gate until release is called and refuses a tenant that is
// unregistered (deleted) or mid-cleanup. TryRLock makes admission during a
// cleanup fail fast instead of queueing behind the write side.
func (s *Server) beginTenantUse(name string) (func(), error) {
	// An id that is already gone must not grow the gate map. The registration
	// check is repeated after the lock so a delete that commits in between
	// cannot open storage on a freshly created gate.
	if s.cfg.Remote() && !s.registry.tenantRegistered(name) {
		return nil, ErrTenantNotFound
	}
	gate := s.tenantGate(name)
	if !gate.TryRLock() {
		return nil, ErrTenantLifecycleBusy
	}
	if s.cfg.Remote() {
		if !s.registry.tenantRegistered(name) {
			gate.RUnlock()
			return nil, ErrTenantNotFound
		}
		if rec, ok := s.registry.TenantLifecycle(name); ok {
			if rec.State == lifecycleStateResetting || rec.State == lifecycleStateDeleting {
				gate.RUnlock()
				return nil, ErrTenantLifecycleBusy
			}
		}
	}
	return gate.RUnlock, nil
}

// writeTenantUseError maps admission refusals for the HTTP data plane.
func writeTenantUseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrTenantLifecycleBusy):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "tenant_busy"})
	case errors.Is(err, ErrTenantNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant_not_found"})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "tenant unavailable"})
	}
}

// ResetTenant erases every asset of tenant while retaining its identity, owner,
// marker and a new generation. The owner must match the registry owner.
func (s *Server) ResetTenant(ctx context.Context, ownerID int64, tenant string) error {
	return s.runTenantLifecycle(ctx, ownerID, tenant, lifecycleOpReset)
}

// DeleteTenant erases tenant entirely, including its identity, owner, tokens,
// grants, attributed global state and cleanup journal.
func (s *Server) DeleteTenant(ctx context.Context, ownerID int64, tenant string) error {
	return s.runTenantLifecycle(ctx, ownerID, tenant, lifecycleOpDelete)
}

func (s *Server) runTenantLifecycle(ctx context.Context, ownerID int64, tenant, op string) error {
	if err := s.precheckTenantLifecycle(ownerID, tenant); err != nil {
		return err
	}
	gate := s.tenantGate(tenant)
	if !gate.TryLock() {
		return ErrTenantLifecycleBusy
	}
	defer gate.Unlock()

	var err error
	switch op {
	case lifecycleOpReset:
		err = s.registry.BeginTenantReset(ownerID, tenant)
	case lifecycleOpDelete:
		err = s.registry.BeginTenantDelete(ownerID, tenant)
	default:
		return ErrTenantLifecycleConflict
	}
	if err != nil {
		return err
	}
	return s.executeTenantLifecycle(ctx, tenant, op)
}

// precheckTenantLifecycle applies the ordering the HTTP unit maps: absent id,
// non-owner, legacy marker, then busy, all before any journal or effect.
func (s *Server) precheckTenantLifecycle(ownerID int64, tenant string) error {
	if !s.registry.tenantRegistered(tenant) {
		return ErrTenantNotFound
	}
	if !s.registry.ownsTenant(ownerID, tenant) {
		return ErrTenantOwnerRequired
	}
	rec, ok := s.registry.TenantLifecycle(tenant)
	if !ok {
		return ErrLegacyTenantCleanupUnsupported
	}
	if rec.State == lifecycleStateResetting || rec.State == lifecycleStateDeleting {
		return ErrTenantLifecycleBusy
	}
	return nil
}

// executeTenantLifecycle finishes an already-journaled operation. Every failure
// after the journal exists is ErrTenantCleanupIncomplete; the journal and its
// operation stay in place for resume.
func (s *Server) executeTenantLifecycle(ctx context.Context, tenant, op string) error {
	incomplete := func(err error) error {
		return fmt.Errorf("%w: %v", ErrTenantCleanupIncomplete, err)
	}
	previous, ok := s.registry.TenantLifecycle(tenant)
	if !ok {
		return ErrTenantNotFound
	}
	if op != lifecycleOpReset && op != lifecycleOpDelete {
		return ErrTenantLifecycleConflict
	}
	// The journal, not the caller, binds the operation.
	if op == lifecycleOpReset && (previous.State != lifecycleStateResetting || previous.Operation != lifecycleOpReset) {
		return ErrTenantLifecycleConflict
	}
	if op == lifecycleOpDelete && (previous.State != lifecycleStateDeleting || previous.Operation != lifecycleOpDelete) {
		return ErrTenantLifecycleConflict
	}

	if err := s.lifecycleFault("after-begin"); err != nil {
		return incomplete(err)
	}

	if ts := s.cachedTenant(tenant); ts != nil {
		s.stopTenantRuntime(ts)
	}
	if err := s.lifecycleFault("after-stop"); err != nil {
		return incomplete(err)
	}

	if err := s.reviewReservations.WaitTenant(ctx, tenant); err != nil {
		return incomplete(err)
	}
	if err := s.lifecycleFault("after-quiesce"); err != nil {
		return incomplete(err)
	}

	if err := s.registry.PurgeTenantTokens(tenant); err != nil {
		return incomplete(err)
	}
	s.grants.purgeTenant(tenant)
	if err := s.lifecycleFault("after-tokens"); err != nil {
		return incomplete(err)
	}

	if err := s.reviewReservations.PurgeTenant(tenant); err != nil {
		return incomplete(err)
	}
	if err := s.lifecycleFault("after-claims"); err != nil {
		return incomplete(err)
	}

	if err := s.evictTenant(tenant); err != nil {
		return incomplete(err)
	}
	if err := s.lifecycleFault("after-close"); err != nil {
		return incomplete(err)
	}

	if err := s.quarantineTenantDir(tenant); err != nil {
		return incomplete(err)
	}
	if err := s.lifecycleFault("after-rename"); err != nil {
		return incomplete(err)
	}
	if err := s.removeTenantQuarantine(tenant); err != nil {
		return incomplete(err)
	}
	if err := s.lifecycleFault("after-erase"); err != nil {
		return incomplete(err)
	}

	if err := s.tenantResidualClean(tenant); err != nil {
		return incomplete(err)
	}

	switch op {
	case lifecycleOpReset:
		generation, err := s.registry.CompleteTenantReset(tenant)
		if err != nil {
			return incomplete(err)
		}
		rec, ok := s.registry.TenantLifecycle(tenant)
		if !ok || rec.State != lifecycleStateActive || rec.Operation != "" ||
			rec.Generation != generation || rec.Generation == previous.Generation || rec.Marker != previous.Marker {
			return incomplete(errors.New("reset completion is not active with a new generation"))
		}
	case lifecycleOpDelete:
		if err := s.registry.CompleteTenantDelete(tenant); err != nil {
			return incomplete(err)
		}
		if s.registry.tenantRegistered(tenant) {
			return incomplete(errors.New("deleted tenant is still registered"))
		}
		if _, ok := s.registry.TenantLifecycle(tenant); ok {
			return incomplete(errors.New("deleted tenant still has a lifecycle record"))
		}
		// The id is now unregistered, so a fresh gate created by a racing
		// post-delete request will fail the registry check before opening
		// storage. Evicting while the write lock is held keeps the gate
		// meaningful for any request that already reached it.
		s.evictTenantGate(tenant)
	}
	return nil
}

// tenantResidualClean proves the target has no remaining local or global asset.
func (s *Server) tenantResidualClean(tenant string) error {
	for _, rec := range s.registry.ListAllTokens() {
		if rec.Tenant == tenant {
			return fmt.Errorf("token record remains")
		}
	}
	if s.grants.tenantResidue(tenant) {
		return fmt.Errorf("device grant remains")
	}
	if s.reviewReservations.TenantResidue(tenant) {
		return fmt.Errorf("claim or attributed spend remains")
	}
	if _, err := os.Stat(s.tenantDir(tenant)); !os.IsNotExist(err) {
		return fmt.Errorf("tenant directory remains")
	}
	if _, err := os.Stat(s.tenantQuarantine(tenant)); !os.IsNotExist(err) {
		return fmt.Errorf("tenant quarantine remains")
	}
	return nil
}

func (s *Server) cachedTenant(name string) *tenantState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tenants[name]
}

// stopTenantRuntime stops the worker and any rescore for one tenant and waits
// for their current work to finish. Under s.mu it clears the runtime so a later
// rescore start cannot slip in after cleanup has begun.
func (s *Server) stopTenantRuntime(ts *tenantState) {
	s.mu.Lock()
	stop, workerDone, rescoreDone := ts.stop, ts.workerDone, ts.rescoreDone
	ts.stop = nil
	ts.workerDone = nil
	ts.rescoreDone = nil
	ts.started = false
	s.mu.Unlock()
	if stop != nil {
		close(stop)
	}
	if workerDone != nil {
		<-workerDone
	}
	if rescoreDone != nil {
		<-rescoreDone
	}
}

func (s *Server) evictTenant(name string) error {
	s.mu.Lock()
	ts := s.tenants[name]
	delete(s.tenants, name)
	s.mu.Unlock()
	if ts == nil {
		return nil
	}
	return ts.t.Close()
}

func (s *Server) tenantDir(tenant string) string {
	return filepath.Join(s.cfg.Data, tenant)
}

func (s *Server) tenantQuarantine(tenant string) string {
	return filepath.Join(s.cfg.Data, lifecycleTrashName, tenant)
}

// quarantineTenantDir moves the tenant directory into the data-directory trash.
// A crash after the rename leaves the assets non-resurrectable and removable on
// resume; nothing uses /tmp.
func (s *Server) quarantineTenantDir(tenant string) error {
	if tenant == "" || tenant == "." || tenant == ".." || filepath.Base(tenant) != tenant {
		return fmt.Errorf("unsafe tenant id")
	}
	trash := s.tenantQuarantine(tenant)
	if err := os.MkdirAll(filepath.Dir(trash), 0o700); err != nil {
		return err
	}
	if err := os.RemoveAll(trash); err != nil {
		return err
	}
	if err := os.Rename(s.tenantDir(tenant), trash); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Server) removeTenantQuarantine(tenant string) error {
	return os.RemoveAll(s.tenantQuarantine(tenant))
}

func (s *Server) lifecycleFault(stage string) error {
	if s.opts.LifecycleFault == nil {
		return nil
	}
	if err := s.opts.LifecycleFault(stage); err != nil {
		return fmt.Errorf("fault at %s: %w", stage, err)
	}
	return nil
}

// resumeTenantLifecycles finishes journaled reset/delete records at start. The
// recorded operation is authoritative; ownership was verified before the journal
// was written, so a restart neither re-derives nor widens authority.
func (s *Server) resumeTenantLifecycles() {
	for tenant, rec := range s.registry.incompleteLifecycles() {
		op := rec.Operation
		if op != lifecycleOpReset && op != lifecycleOpDelete {
			continue
		}
		gate := s.tenantGate(tenant)
		if !gate.TryLock() {
			continue
		}
		err := s.executeTenantLifecycle(context.Background(), tenant, op)
		gate.Unlock()
		if err != nil {
			fmt.Fprintf(os.Stderr, "yakka serve: resume %s %q: %v\n", op, tenant, err)
		}
	}
}
