package review

import (
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

type spendEntry struct {
	At      time.Time `json:"at"`
	Amount  float64   `json:"amount"`
	Key     string    `json:"key"`
	Attempt int       `json:"attempt"`
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
	claimed  map[string]string
	active   map[string]bool
	inflight map[string]int
	limit    int
	path     string
	failed   bool
}

func NewReservations(capUSD float64, perTenant int) *Reservations {
	if perTenant < 1 {
		perTenant = 2
	}
	return &Reservations{cap: capUSD, claimed: map[string]string{}, active: map[string]bool{}, inflight: map[string]int{}, limit: perTenant}
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
		Spent   []spendEntry      `json:"spent"`
		Claimed map[string]string `json:"claimed"`
	}
	if err := json.Unmarshal(b, &saved); err != nil {
		return nil, err
	}
	r.spent = saved.Spent
	if saved.Claimed != nil {
		r.claimed = saved.Claimed
	}
	r.expire(time.Now())
	return r, nil
}

func (r *Reservations) save() error {
	if r.path == "" {
		return nil
	}
	b, err := json.Marshal(struct {
		Spent   []spendEntry      `json:"spent"`
		Claimed map[string]string `json:"claimed"`
	}{r.spent, r.claimed})
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
		return fmt.Errorf("%w: %s", ErrDuplicateClaim, first)
	}
	r.expire(time.Now())
	var total float64
	for _, e := range r.spent {
		total += e.Amount
	}
	if total+amount > r.cap || r.inflight[tenant] >= r.limit {
		return ErrBudget
	}
	r.claimed[key] = id
	r.active[key] = true
	r.inflight[tenant]++
	r.spent = append(r.spent, spendEntry{At: time.Now(), Amount: amount, Key: key, Attempt: 1})
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
	id, ok := r.claimed[key]
	if !ok {
		return "", claimAbsent
	}
	if r.active[key] {
		return id, claimActive
	}
	return id, claimDurable
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
	r.spent = append(r.spent, spendEntry{At: time.Now(), Amount: amount, Key: key, Attempt: 1})
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
	r.spent = append(r.spent, spendEntry{At: time.Now(), Amount: amount, Key: key, Attempt: attempt})
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
