package review

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const LiveModel = "claude-haiku-5-5"

// Availability contains server-only review settings. Secret values are never
// included in an Error returned by CheckAvailability.
type Availability struct {
	Token, Model, Effort string
	USDCap               float64
	Repositories         map[string]bool
	Local                bool
}

type AvailabilityError struct{ Setting string }

func (e *AvailabilityError) Error() string { return "unavailable: " + e.Setting }

func CheckAvailability(c Availability, tenant, repo, effectiveEffort string) error {
	switch {
	case c.Local:
		return &AvailabilityError{"authenticated remote mode required"}
	case c.Token == "":
		return &AvailabilityError{"CLAUDE_API_TOKEN"}
	case c.Model == "":
		return &AvailabilityError{"YAKKA_REVIEW_MODEL"}
	case c.Model != LiveModel:
		return &AvailabilityError{"YAKKA_REVIEW_MODEL must be claude-haiku-5-5"}
	case c.Effort != "" && c.Effort != "high":
		return &AvailabilityError{"YAKKA_REVIEW_EFFORT must be high"}
	case c.USDCap <= 0 || math.IsNaN(c.USDCap) || math.IsInf(c.USDCap, 0):
		return &AvailabilityError{"YAKKA_REVIEW_USD_CAP"}
	case !store.PricedModel(c.Model):
		return &AvailabilityError{"priced model required"}
	case !c.Repositories[tenant+"/"+repo]:
		return &AvailabilityError{"YAKKA_REVIEW_REPOS"}
	case effectiveEffort != "high" && effectiveEffort != "xhigh" && effectiveEffort != "max":
		return &AvailabilityError{"effort must be high, xhigh or max"}
	}
	return nil
}

// reservationsVersion is the format version of the persistent reservations
// document written by this binary. Version-1 documents (no tenant or version
// fields) remain readable as unattributed legacy records.
const reservationsVersion = 2

type spendEntry struct {
	At      time.Time `json:"at"`
	Amount  float64   `json:"amount"`
	Key     string    `json:"key,omitempty"`
	Attempt int       `json:"attempt,omitempty"`
	Tenant  string    `json:"tenant,omitempty"`
	Version int       `json:"version,omitempty"`
}

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

// Reservations serializes claims and budget reservations for this server.
// A started claim is deliberately retained after completion or timeout.
type Reservations struct {
	mu       sync.Mutex
	cap      float64
	spent    []spendEntry
	claimed  map[string]claimRecord
	active   map[string]bool
	inflight map[string]int
	limit    int
	path     string
	failed   bool
	changed  chan struct{}
}

func NewReservations(capUSD float64, perTenant int) *Reservations {
	if perTenant < 1 {
		perTenant = 2
	}
	return &Reservations{cap: capUSD, claimed: map[string]claimRecord{}, active: map[string]bool{}, inflight: map[string]int{}, limit: perTenant, changed: make(chan struct{})}
}

func NewUnavailableReservations() *Reservations {
	r := NewReservations(0, 2)
	r.failed = true
	return r
}

// NewPersistentReservations keeps claims and rolling spend across server restarts.
func NewPersistentReservations(capUSD float64, perTenant int, path string) (*Reservations, error) {
	r := NewReservations(capUSD, perTenant)
	r.path = path
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	var saved struct {
		Version int             `json:"version"`
		Spent   []spendEntry    `json:"spent"`
		Claims  json.RawMessage `json:"claims"`
		Claimed json.RawMessage `json:"claimed"`
	}
	if err := json.Unmarshal(b, &saved); err != nil {
		return nil, err
	}
	r.spent = saved.Spent
	switch {
	case saved.Version >= reservationsVersion && saved.Claims != nil:
		if err := json.Unmarshal(saved.Claims, &r.claimed); err != nil {
			return nil, err
		}
	case saved.Claimed != nil:
		var legacy map[string]string
		if err := json.Unmarshal(saved.Claimed, &legacy); err != nil {
			return nil, err
		}
		for key, id := range legacy {
			r.claimed[key] = claimRecord{ID: id}
		}
	}
	r.expire(time.Now())
	return r, nil
}

func (r *Reservations) save() error {
	if r.path == "" {
		return nil
	}
	b, err := json.Marshal(struct {
		Version int                    `json:"version"`
		Spent   []spendEntry           `json:"spent"`
		Claims  map[string]claimRecord `json:"claims"`
	}{reservationsVersion, r.spent, r.claimed})
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
var ErrBudget = errors.New("skipped_budget")
var ErrReservationState = errors.New("review reservation state unavailable")

// begin atomically claims a key and reserves the next attempt's worst-case cost.
func (r *Reservations) begin(key, id, tenant string, amount float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failed {
		return ErrReservationState
	}
	if first, ok := r.claimed[key]; ok {
		return fmt.Errorf("%w: %s", ErrDuplicateClaim, first.ID)
	}
	r.expire(time.Now())
	var total float64
	for _, e := range r.spent {
		total += e.Amount
	}
	if total+amount > r.cap || r.inflight[tenant] >= r.limit {
		return ErrBudget
	}
	r.claimed[key] = claimRecord{ID: id, Tenant: tenant, Version: reservationsVersion}
	r.active[key] = true
	r.inflight[tenant]++
	r.spent = append(r.spent, spendEntry{At: time.Now(), Amount: amount, Key: key, Attempt: 1, Tenant: tenant, Version: reservationsVersion})
	if err := r.save(); err != nil {
		delete(r.claimed, key)
		delete(r.active, key)
		r.spent = r.spent[:len(r.spent)-1]
		r.inflight[tenant]--
		return fmt.Errorf("reservation persistence failed")
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

// beginEphemeral reserves spend and an in-flight slot under a fresh non-cache
// identifier without creating a durable dedupe claim.
func (r *Reservations) beginEphemeral(key, tenant string, amount float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failed {
		return ErrReservationState
	}
	r.expire(time.Now())
	var total float64
	for _, e := range r.spent {
		total += e.Amount
	}
	if total+amount > r.cap || r.inflight[tenant] >= r.limit {
		return ErrBudget
	}
	r.inflight[tenant]++
	r.spent = append(r.spent, spendEntry{At: time.Now(), Amount: amount, Key: key, Attempt: 1, Tenant: tenant, Version: reservationsVersion})
	if err := r.save(); err != nil {
		r.spent = r.spent[:len(r.spent)-1]
		r.inflight[tenant]--
		return fmt.Errorf("reservation persistence failed")
	}
	return nil
}

func (r *Reservations) reserveRetry(key string, tenant string, attempt int, amount float64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.expire(time.Now())
	var total float64
	for _, e := range r.spent {
		total += e.Amount
	}
	if total+amount > r.cap {
		return false
	}
	r.spent = append(r.spent, spendEntry{At: time.Now(), Amount: amount, Key: key, Attempt: attempt, Tenant: tenant, Version: reservationsVersion})
	if r.save() != nil {
		r.spent = r.spent[:len(r.spent)-1]
		return false
	}
	return true
}

func (r *Reservations) settle(key string, attempt int, actual float64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.spent) - 1; i >= 0; i-- {
		if r.spent[i].Key == key && r.spent[i].Attempt == attempt {
			reserved := r.spent[i].Amount
			r.spent[i].Amount = actual
			if r.save() != nil {
				r.spent[i].Amount = reserved
			}
			return
		}
	}
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

func (r *Reservations) expire(now time.Time) {
	cut := now.Add(-24 * time.Hour)
	i := 0
	for _, e := range r.spent {
		if e.At.After(cut) {
			r.spent[i] = e
			i++
		}
	}
	r.spent = r.spent[:i]
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

// TenantResidue reports whether any claim or attributed spend remains for tenant.
// Legacy unattributed records are not counted against any tenant.
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
	for _, e := range r.spent {
		if e.Tenant == tenant {
			return true
		}
	}
	return false
}

// PurgeTenant removes tenant's attributed claims and spend, replacing each
// attributed spend entry with an anonymous entry carrying only its timestamp and
// amount so the provider-wide safety total is unchanged. Legacy unattributed
// records are never removed or retargeted. A second purge is a no-op.
func (r *Reservations) PurgeTenant(tenant string) error {
	if tenant == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failed {
		return ErrReservationState
	}
	spent := make([]spendEntry, 0, len(r.spent))
	var anonymous []spendEntry
	changed := false
	for _, e := range r.spent {
		if e.Tenant == tenant {
			anonymous = append(anonymous, spendEntry{At: e.At, Amount: e.Amount})
			changed = true
			continue
		}
		spent = append(spent, e)
	}
	claimed := make(map[string]claimRecord, len(r.claimed))
	var purgedKeys []string
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
	spent = append(spent, anonymous...)
	oldSpent, oldClaims := r.spent, r.claimed
	r.spent, r.claimed = spent, claimed
	if err := r.save(); err != nil {
		r.spent, r.claimed = oldSpent, oldClaims
		return fmt.Errorf("reservation persistence failed")
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
