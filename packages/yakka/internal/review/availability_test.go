package review

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type persistedReservations struct {
	Version int                    `json:"version"`
	Spent   []spendEntry           `json:"spent"`
	Claims  map[string]claimRecord `json:"claims"`
	Claimed map[string]string      `json:"claimed"`
}

func readReservations(t *testing.T, path string) persistedReservations {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc persistedReservations
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func reservationTotal(r *Reservations) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	var total float64
	for _, e := range r.spent {
		total += e.Amount
	}
	return total
}

func TestReservationPersistsTenantAndVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reservations.json")
	r, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.begin("claim-key", "claim-id", "tenant-a", 0.25); err != nil {
		t.Fatal(err)
	}
	if err := r.beginEphemeral("ephemeral-key", "tenant-a", 0.125); err != nil {
		t.Fatal(err)
	}
	doc := readReservations(t, path)
	if doc.Version != reservationsVersion {
		t.Fatalf("document version=%d want %d", doc.Version, reservationsVersion)
	}
	if len(doc.Spent) != 2 {
		t.Fatalf("spent entries=%d want 2", len(doc.Spent))
	}
	for _, e := range doc.Spent {
		if e.Tenant != "tenant-a" || e.Version != reservationsVersion {
			t.Fatalf("spend entry not attributed/versioned: %+v", e)
		}
	}
	claim, ok := doc.Claims["claim-key"]
	if !ok || claim.ID != "claim-id" || claim.Tenant != "tenant-a" || claim.Version != reservationsVersion {
		t.Fatalf("claim=%+v ok=%v", claim, ok)
	}

	reloaded, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if id, state := reloaded.claimState("claim-key"); id != "claim-id" || state != claimDurable {
		t.Fatalf("reloaded claim=%q state=%v", id, state)
	}
	if !reloaded.TenantResidue("tenant-a") {
		t.Fatal("reloaded reservations lost tenant attribution")
	}
	for _, e := range reloaded.spent {
		if e.Tenant != "tenant-a" || e.Version != reservationsVersion {
			t.Fatalf("reloaded spend entry not attributed/versioned: %+v", e)
		}
	}
}

func TestReservationLegacyVersionOneStaysUnattributed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reservations.json")
	at := time.Now().UTC().Format(time.RFC3339Nano)
	legacy := `{"spent":[{"at":"` + at + `","amount":0.5,"key":"legacy-key","attempt":1}],"claimed":{"legacy-key":"legacy-id"}}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if id, state := r.claimState("legacy-key"); id != "legacy-id" || state != claimDurable {
		t.Fatalf("legacy claim=%q state=%v", id, state)
	}
	beginErr := r.begin("legacy-key", "new-id", "tenant-a", 0.01)
	first, dup := duplicateReview(beginErr)
	if !dup || first != "legacy-id" {
		t.Fatalf("legacy duplicate=%q dup=%v err=%v", first, dup, beginErr)
	}
	if r.TenantResidue("tenant-a") {
		t.Fatal("legacy record was assigned to a tenant")
	}
	if err := r.PurgeTenant("tenant-a"); err != nil {
		t.Fatal(err)
	}
	if err := r.PurgeTenant(""); err != nil {
		t.Fatal(err)
	}
	doc := readReservations(t, path)
	if _, ok := doc.Claims["legacy-key"]; !ok {
		if _, legacy := doc.Claimed["legacy-key"]; !legacy {
			t.Fatal("purge removed a legacy claim")
		}
	}
	if len(doc.Spent) != 1 || doc.Spent[0].Key != "legacy-key" || doc.Spent[0].Tenant != "" {
		t.Fatalf("purge retargeted or removed legacy spend: %+v", doc.Spent)
	}
	reloaded, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, dup := duplicateReview(reloaded.begin("legacy-key", "another-id", "tenant-b", 0.01)); !dup {
		t.Fatal("legacy duplicate key did not survive purge/reload")
	}
}

func TestReservationPurgeTenantTransfersAnonymously(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reservations.json")
	r, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.begin("a-key", "a-id", "a", 0.25); err != nil {
		t.Fatal(err)
	}
	if err := r.begin("b-key", "b-id", "b", 0.5); err != nil {
		t.Fatal(err)
	}
	if err := r.beginEphemeral("a-ephemeral", "a", 0.125); err != nil {
		t.Fatal(err)
	}
	r.finishClaim("a-key", "a")
	r.finish("a")
	r.finishClaim("b-key", "b")
	var transfers []spendEntry
	for _, e := range r.spent {
		if e.Tenant == "a" {
			transfers = append(transfers, e)
		}
	}
	if len(transfers) != 2 {
		t.Fatalf("tenant A spend entries=%d want 2", len(transfers))
	}
	before := reservationTotal(r)
	if err := r.PurgeTenant("a"); err != nil {
		t.Fatal(err)
	}
	if r.TenantResidue("a") {
		t.Fatal("tenant A residue remains")
	}
	if !r.TenantResidue("b") {
		t.Fatal("tenant B was removed")
	}
	if id, state := r.claimState("a-key"); state != claimAbsent || id != "" {
		t.Fatalf("tenant A claim remains: %q %v", id, state)
	}
	if id, state := r.claimState("b-key"); id != "b-id" || state != claimDurable {
		t.Fatalf("tenant B claim changed: %q %v", id, state)
	}
	if got := reservationTotal(r); got != before {
		t.Fatalf("provider-wide total changed: got %v want %v", got, before)
	}
	assertAnonymousTransfers(t, r, transfers)

	reloaded, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.TenantResidue("a") || !reloaded.TenantResidue("b") {
		t.Fatal("reloaded tenant attribution wrong")
	}
	if got := reservationTotal(reloaded); got != before {
		t.Fatalf("reloaded provider-wide total changed: got %v want %v", got, before)
	}
	assertAnonymousTransfers(t, reloaded, transfers)
	doc := readReservations(t, path)
	for _, e := range doc.Spent {
		if e.Tenant == "" && e.Key == "" && e.Amount > 0 {
			raw, err := json.Marshal(e)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]any
			if err := json.Unmarshal(raw, &fields); err != nil {
				t.Fatal(err)
			}
			if len(fields) != 2 {
				t.Fatalf("anonymous entry carries extra identity: %s", raw)
			}
		}
	}
}

func assertAnonymousTransfers(t *testing.T, r *Reservations, transfers []spendEntry) {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, want := range transfers {
		found := false
		for _, e := range r.spent {
			if e.Tenant == "" && e.Key == "" && e.At.Equal(want.At) && e.Amount == want.Amount {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("no anonymous transfer for %v", want)
		}
	}
}

func TestReservationPurgeIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reservations.json")
	r, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.begin("a-key", "a-id", "a", 0.25); err != nil {
		t.Fatal(err)
	}
	if err := r.begin("b-key", "b-id", "b", 0.5); err != nil {
		t.Fatal(err)
	}
	if err := r.PurgeTenant("a"); err != nil {
		t.Fatal(err)
	}
	beforeTotal := reservationTotal(r)
	beforeBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PurgeTenant("a"); err != nil {
		t.Fatal(err)
	}
	afterBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeBytes, afterBytes) {
		t.Fatal("second purge rewrote reservations")
	}
	if got := reservationTotal(r); got != beforeTotal {
		t.Fatalf("second purge changed total: got %v want %v", got, beforeTotal)
	}

	reloaded, err := NewPersistentReservations(5, 2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := reloaded.PurgeTenant("a"); err != nil {
		t.Fatal(err)
	}
	reloadedBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeBytes, reloadedBytes) {
		t.Fatal("purge after reload rewrote reservations")
	}
	if got := reservationTotal(reloaded); got != beforeTotal {
		t.Fatalf("purge after reload changed total: got %v want %v", got, beforeTotal)
	}
}

func TestReservationWaitTenantQuiescence(t *testing.T) {
	wait := func(t *testing.T, r *Reservations, tenant string) (chan error, context.CancelFunc) {
		t.Helper()
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- r.WaitTenant(ctx, tenant) }()
		return done, cancel
	}
	assertBlocked := func(t *testing.T, done chan error) {
		t.Helper()
		select {
		case err := <-done:
			t.Fatalf("WaitTenant returned while call active: %v", err)
		case <-time.After(25 * time.Millisecond):
		}
	}
	assertReturns := func(t *testing.T, done chan error) {
		t.Helper()
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("WaitTenant returned %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("WaitTenant did not return after finish")
		}
	}

	t.Run("active claim", func(t *testing.T) {
		r := NewReservations(5, 2)
		if err := r.begin("key", "id", "tenant-a", 0.01); err != nil {
			t.Fatal(err)
		}
		done, cancel := wait(t, r, "tenant-a")
		defer cancel()
		assertBlocked(t, done)
		r.finishClaim("key", "tenant-a")
		assertReturns(t, done)
	})

	t.Run("ephemeral", func(t *testing.T) {
		r := NewReservations(5, 2)
		if err := r.beginEphemeral("eph", "tenant-a", 0.01); err != nil {
			t.Fatal(err)
		}
		done, cancel := wait(t, r, "tenant-a")
		defer cancel()
		assertBlocked(t, done)
		r.finish("tenant-a")
		assertReturns(t, done)
	})

	t.Run("cancelled context", func(t *testing.T) {
		r := NewReservations(5, 2)
		if err := r.begin("key", "id", "tenant-a", 0.01); err != nil {
			t.Fatal(err)
		}
		done, cancel := wait(t, r, "tenant-a")
		assertBlocked(t, done)
		cancel()
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("WaitTenant error=%v want context.Canceled", err)
			}
		case <-time.After(time.Second):
			t.Fatal("WaitTenant ignored cancellation")
		}
	})

	t.Run("idle tenant returns immediately", func(t *testing.T) {
		r := NewReservations(5, 2)
		if err := r.WaitTenant(context.Background(), "tenant-a"); err != nil {
			t.Fatalf("idle WaitTenant=%v", err)
		}
	})
}
