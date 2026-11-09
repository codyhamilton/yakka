package serve

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
)

// Lifecycle states reported for an owned tenant. Only active, resetting and
// deleting are persisted; unsupported is derived for legacy tenants with no
// trustworthy lifecycle record.
const (
	lifecycleStateActive      = "active"
	lifecycleStateResetting   = "resetting"
	lifecycleStateDeleting    = "deleting"
	lifecycleStateUnsupported = "unsupported"
)

// Lifecycle operations bound to an in-progress journal entry.
const (
	lifecycleOpReset  = "reset"
	lifecycleOpDelete = "delete"
)

// Errors returned by lifecycle mutations. Later HTTP units map these to their
// status codes; they are distinct so ordering cannot be collapsed.
var (
	ErrTenantNotFound                 = errors.New("tenant not found")
	ErrTenantOwnerRequired            = errors.New("tenant owner required")
	ErrLegacyTenantCleanupUnsupported = errors.New("legacy tenant cleanup unsupported")
	ErrTenantLifecycleBusy            = errors.New("tenant lifecycle busy")
	ErrTenantLifecycleConflict        = errors.New("tenant lifecycle operation conflict")
)

// TenantLifecycleRecord is the persistent lifecycle/ownership record for one tenant.
// A tenant with an owner/name entry but no record is legacy and must not be
// migrated, guessed at or have a marker inferred from its id.
type TenantLifecycleRecord struct {
	Marker     string `json:"marker"`
	Generation string `json:"generation"`
	State      string `json:"state"`
	Operation  string `json:"operation,omitempty"`
}

// newLifecycleValue returns a fresh opaque random marker or generation.
func newLifecycleValue() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// TenantLifecycle returns the trustworthy lifecycle record for tenant. It is
// false for absent tenants and for legacy tenants with no record.
func (r *Registry) TenantLifecycle(tenant string) (TenantLifecycleRecord, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rec, ok := r.lifecycle[tenant]
	if !ok || rec.Marker == "" {
		return TenantLifecycleRecord{}, false
	}
	return rec, true
}

// TenantGeneration returns the opaque store generation for tenant, when it has
// a trustworthy lifecycle record.
func (r *Registry) TenantGeneration(tenant string) (string, bool) {
	rec, ok := r.TenantLifecycle(tenant)
	if !ok {
		return "", false
	}
	return rec.Generation, true
}

// BeginTenantReset records an in-progress reset for an owned, marker-backed
// tenant. It persists the journal state atomically before any erasure work.
func (r *Registry) BeginTenantReset(githubID int64, tenant string) error {
	return r.beginTenantLifecycle(githubID, tenant, lifecycleOpReset, lifecycleStateResetting)
}

// BeginTenantDelete records an in-progress delete for an owned, marker-backed
// tenant. It persists the journal state atomically before any erasure work.
func (r *Registry) BeginTenantDelete(githubID int64, tenant string) error {
	return r.beginTenantLifecycle(githubID, tenant, lifecycleOpDelete, lifecycleStateDeleting)
}

func (r *Registry) beginTenantLifecycle(githubID int64, tenant, op, state string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	owner, exists := r.owners[tenant]
	if !exists {
		return ErrTenantNotFound
	}
	if owner != fmt.Sprintf("%d", githubID) {
		return ErrTenantOwnerRequired
	}
	rec, ok := r.lifecycle[tenant]
	if !ok || rec.Marker == "" {
		return ErrLegacyTenantCleanupUnsupported
	}
	if rec.State == lifecycleStateResetting || rec.State == lifecycleStateDeleting {
		return ErrTenantLifecycleBusy
	}
	prev, prevDirty := rec, r.dirty
	rec.State = state
	rec.Operation = op
	r.lifecycle[tenant] = rec
	r.dirty = true
	if err := r.saveLocked(); err != nil {
		r.lifecycle[tenant] = prev
		r.dirty = prevDirty
		return err
	}
	return nil
}

// CompleteTenantReset finishes a begun reset: it advances the generation,
// returns the tenant to active, clears the journal operation and removes every
// token for the tenant. The id, name, owner and marker are retained. Sessions
// are user-global and are not touched.
func (r *Registry) CompleteTenantReset(tenant string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rec, ok := r.lifecycle[tenant]
	if !ok || rec.Marker == "" {
		return "", ErrTenantNotFound
	}
	if rec.State != lifecycleStateResetting || rec.Operation != lifecycleOpReset {
		return "", ErrTenantLifecycleConflict
	}
	generation, err := newLifecycleValue()
	if err != nil {
		return "", err
	}
	prev, prevTokens, prevDirty := rec, cloneTokenHashes(r.tokenHashes), r.dirty
	rec.Generation = generation
	rec.State = lifecycleStateActive
	rec.Operation = ""
	r.lifecycle[tenant] = rec
	r.purgeTenantTokensLocked(tenant)
	r.dirty = true
	if err := r.saveLocked(); err != nil {
		r.lifecycle[tenant] = prev
		r.tokenHashes = prevTokens
		r.dirty = prevDirty
		return "", err
	}
	return generation, nil
}

// CompleteTenantDelete finishes a begun delete: it removes the owner, name and
// lifecycle record and every token for the tenant. Sessions are user-global and
// are not touched.
func (r *Registry) CompleteTenantDelete(tenant string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	rec, ok := r.lifecycle[tenant]
	if !ok || rec.Marker == "" {
		return ErrTenantNotFound
	}
	if rec.State != lifecycleStateDeleting || rec.Operation != lifecycleOpDelete {
		return ErrTenantLifecycleConflict
	}
	prevOwner, hadOwner := r.owners[tenant]
	prevName, hadName := r.names[tenant]
	prevTokens, prevDirty := cloneTokenHashes(r.tokenHashes), r.dirty
	delete(r.owners, tenant)
	delete(r.names, tenant)
	delete(r.lifecycle, tenant)
	r.purgeTenantTokensLocked(tenant)
	r.dirty = true
	if err := r.saveLocked(); err != nil {
		if hadOwner {
			r.owners[tenant] = prevOwner
		} else {
			delete(r.owners, tenant)
		}
		if hadName {
			r.names[tenant] = prevName
		}
		r.lifecycle[tenant] = rec
		r.tokenHashes = prevTokens
		r.dirty = prevDirty
		return err
	}
	return nil
}

// PurgeTenantTokens removes every token record for tenant, including revoked
// and expired records, and persists. Other tenants' tokens are untouched.
func (r *Registry) PurgeTenantTokens(tenant string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	prevTokens, prevDirty := cloneTokenHashes(r.tokenHashes), r.dirty
	r.purgeTenantTokensLocked(tenant)
	if err := r.saveLocked(); err != nil {
		r.tokenHashes = prevTokens
		r.dirty = prevDirty
		return err
	}
	return nil
}

// cloneTokenHashes copies the token slice so a failed registry save can restore it.
// A nil slice stays nil; an empty slice stays empty.
func cloneTokenHashes(in []TokenHashRecord) []TokenHashRecord {
	if in == nil {
		return nil
	}
	out := make([]TokenHashRecord, len(in))
	copy(out, in)
	return out
}

// purgeTenantTokensLocked drops every token record for tenant. The caller holds r.mu.
func (r *Registry) purgeTenantTokensLocked(tenant string) {
	if tenant == "" {
		return
	}
	out := make([]TokenHashRecord, 0, len(r.tokenHashes))
	changed := false
	for _, rec := range r.tokenHashes {
		if rec.Tenant == tenant {
			changed = true
			continue
		}
		out = append(out, rec)
	}
	if changed {
		r.tokenHashes = out
		r.dirty = true
	}
}
