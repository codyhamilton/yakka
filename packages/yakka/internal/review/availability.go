package review

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const LiveModel = "claude-haiku-5-5"

// Availability contains server-only review settings. Secret values are never
// included in an Error returned by CheckAvailability.
type Availability struct {
	Token string
	Local bool
	// Model is the optional YAKKA_REVIEW_MODEL override. Empty means LiveModel.
	Model string
}

// EffectiveModel is the model a review call uses: Model if set, otherwise LiveModel
// ("claude-haiku-5-5"), the existing review/Claude default and Plan 28 recommended model.
func (c Availability) EffectiveModel() string {
	if m := strings.TrimSpace(c.Model); m != "" {
		return m
	}
	return LiveModel
}

type AvailabilityError struct{ Setting string }

func (e *AvailabilityError) Error() string { return "unavailable: " + e.Setting }

// CheckAvailability reports whether review may run. Availability is exactly
// authenticated remote mode plus a token; nothing else configures a refusal.
func CheckAvailability(c Availability, effectiveEffort string) error {
	switch {
	case c.Local:
		return &AvailabilityError{"authenticated remote mode required"}
	case c.Token == "":
		return &AvailabilityError{"CLAUDE_API_TOKEN"}
	case effectiveEffort != "high" && effectiveEffort != "xhigh" && effectiveEffort != "max":
		return &AvailabilityError{"effort must be high, xhigh or max"}
	}
	return nil
}

// reservationsVersion is the format version of the persistent reservations
// document written by this binary. Version-1 documents (no tenant or version
// fields) remain readable as unattributed legacy claims; any spend entries are
// ignored and dropped on the next save.
const reservationsVersion = 2

// claimRecord is a durable claim with its explicit owner and format version.
// Legacy version-1 claims decode with an empty tenant and version 0.
type claimRecord struct {
	ID      string `json:"id"`
	Tenant  string `json:"tenant,omitempty"`
	Version int    `json:"version,omitempty"`
}

// claimStatus distinguishes an in-process call from a claim restored after a
// restart. Only the former may still produce a provider outcome.
type claimStatus int

const (
	claimAbsent claimStatus = iota
	claimActive
	claimDurable
)

// Reservations serializes durable claims and per-tenant in-flight calls for
// this server. A started claim is deliberately retained after completion or
// timeout.
type Reservations struct {
	mu       sync.Mutex
	claimed  map[string]claimRecord
	active   map[string]bool
	inflight map[string]int
	limit    int
	path     string
	changed  chan struct{}
}

func NewReservations(perTenant int) *Reservations {
	if perTenant < 1 {
		perTenant = 2
	}
	return &Reservations{claimed: map[string]claimRecord{}, active: map[string]bool{}, inflight: map[string]int{}, limit: perTenant, changed: make(chan struct{})}
}

// NewPersistentReservations keeps claims across server restarts. A missing,
// unreadable, corrupt or non-JSON file starts with empty claims and stays
// usable; the path is kept for later saves.
func NewPersistentReservations(perTenant int, path string) (*Reservations, error) {
	r := NewReservations(perTenant)
	r.path = path
	b, err := os.ReadFile(path)
	if err != nil {
		return r, nil
	}
	var saved struct {
		Claims  json.RawMessage `json:"claims"`
		Claimed json.RawMessage `json:"claimed"`
	}
	if err := json.Unmarshal(b, &saved); err != nil {
		return r, nil
	}
	if saved.Claims != nil {
		var claims map[string]claimRecord
		if err := json.Unmarshal(saved.Claims, &claims); err != nil {
			return r, nil
		}
		if claims != nil {
			r.claimed = claims
		}
		return r, nil
	}
	if saved.Claimed != nil {
		var legacy map[string]string
		if err := json.Unmarshal(saved.Claimed, &legacy); err != nil {
			return r, nil
		}
		for key, id := range legacy {
			r.claimed[key] = claimRecord{ID: id}
		}
	}
	return r, nil
}

func (r *Reservations) save() error {
	if r.path == "" {
		return nil
	}
	b, err := json.Marshal(struct {
		Version int                    `json:"version"`
		Claims  map[string]claimRecord `json:"claims"`
	}{reservationsVersion, r.claimed})
	if err != nil {
		return err
	}
	dir := filepath.Dir(r.path)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".review-reservations-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0o600); err == nil {
		_, err = tmp.Write(b)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, r.path)
}

var ErrDuplicateClaim = errors.New("skipped_duplicate")
var ErrBusy = errors.New("skipped_busy")
var ErrClaimState = errors.New("review claim state unavailable")

// begin atomically claims a key and takes an in-flight slot for its tenant.
func (r *Reservations) begin(key, id, tenant string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if first, ok := r.claimed[key]; ok {
		return fmt.Errorf("%w: %s", ErrDuplicateClaim, first.ID)
	}
	if r.inflight[tenant] >= r.limit {
		return ErrBusy
	}
	r.claimed[key] = claimRecord{ID: id, Tenant: tenant, Version: reservationsVersion}
	r.active[key] = true
	r.inflight[tenant]++
	if err := r.save(); err != nil {
		delete(r.claimed, key)
		delete(r.active, key)
		r.inflight[tenant]--
		return ErrClaimState
	}
	return nil
}

// claimState reports a durable claim and whether an in-process call still owns it.
func (r *Reservations) claimState(key string) (string, claimStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()
	claim, ok := r.claimed[key]
	if !ok {
		return "", claimAbsent
	}
	if r.active[key] {
		return claim.ID, claimActive
	}
	return claim.ID, claimDurable
}

// beginEphemeral takes an in-flight slot under a fresh non-cache identifier
// without creating a durable dedupe claim.
func (r *Reservations) beginEphemeral(key, tenant string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inflight[tenant] >= r.limit {
		return ErrBusy
	}
	r.inflight[tenant]++
	if err := r.save(); err != nil {
		r.inflight[tenant]--
		return ErrClaimState
	}
	return nil
}

func (r *Reservations) finish(tenant string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inflight[tenant] > 0 {
		r.inflight[tenant]--
	}
	r.notifyLocked()
}

// finishClaim ends an in-process call while keeping the durable claim so a
// later equal request resolves to the stored original or outcome_unknown.
func (r *Reservations) finishClaim(key, tenant string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.active, key)
	if r.inflight[tenant] > 0 {
		r.inflight[tenant]--
	}
	r.notifyLocked()
}

func (r *Reservations) notifyLocked() {
	if r.changed != nil {
		close(r.changed)
	}
	r.changed = make(chan struct{})
}

// WaitTenant blocks until no in-process call for tenant remains (an active claim
// or an ephemeral in-flight call), or ctx is done.
func (r *Reservations) WaitTenant(ctx context.Context, tenant string) error {
	if tenant == "" {
		return nil
	}
	for {
		r.mu.Lock()
		busy := r.tenantBusyLocked(tenant)
		if r.changed == nil {
			r.changed = make(chan struct{})
		}
		ch := r.changed
		r.mu.Unlock()
		if !busy {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ch:
		}
	}
}

func (r *Reservations) tenantBusyLocked(tenant string) bool {
	if r.inflight[tenant] > 0 {
		return true
	}
	for key, active := range r.active {
		if !active {
			continue
		}
		if claim, ok := r.claimed[key]; ok && claim.Tenant == tenant {
			return true
		}
	}
	return false
}

// TenantResidue reports whether any claim remains for tenant. Legacy
// unattributed claims are not counted against any tenant.
func (r *Reservations) TenantResidue(tenant string) bool {
	if tenant == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, claim := range r.claimed {
		if claim.Tenant == tenant {
			return true
		}
	}
	return false
}

// PurgeTenant removes tenant's claims and active entries. Legacy unattributed
// claims are never removed or retargeted. A second purge is a no-op.
func (r *Reservations) PurgeTenant(tenant string) error {
	if tenant == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	claimed := make(map[string]claimRecord, len(r.claimed))
	var purgedKeys []string
	changed := false
	for key, claim := range r.claimed {
		if claim.Tenant == tenant {
			changed = true
			purgedKeys = append(purgedKeys, key)
			continue
		}
		claimed[key] = claim
	}
	if !changed {
		return nil
	}
	oldClaims := r.claimed
	r.claimed = claimed
	if err := r.save(); err != nil {
		r.claimed = oldClaims
		return ErrClaimState
	}
	for _, key := range purgedKeys {
		delete(r.active, key)
	}
	return nil
}

func duplicateReview(err error) (string, bool) {
	if !errors.Is(err, ErrDuplicateClaim) {
		return "", false
	}
	parts := strings.SplitN(err.Error(), ": ", 2)
	if len(parts) == 2 {
		return parts[1], true
	}
	return "", true
}
