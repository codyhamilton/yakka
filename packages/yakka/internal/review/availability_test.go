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

func TestAvailabilityTokenOnly(t *testing.T) {
	for _, tc := range []struct {
		name   string
		c      Availability
		effort string
		want   string
	}{
		{"local", Availability{Token: "token", Local: true}, "high", "authenticated remote mode required"},
		{"local without token", Availability{Local: true}, "high", "authenticated remote mode required"},
		{"empty token", Availability{}, "high", "CLAUDE_API_TOKEN"},
		{"bad effort", Availability{Token: "token"}, "min", "effort must be high, xhigh or max"},
		{"empty effort", Availability{Token: "token"}, "", "effort must be high, xhigh or max"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckAvailability(tc.c, tc.effort)
			var a *AvailabilityError
			if !errors.As(err, &a) || a.Setting != tc.want {
				t.Fatalf("err=%v want %q", err, tc.want)
			}
		})
	}
	for _, eff := range []string{"high", "xhigh", "max"} {
		if err := CheckAvailability(Availability{Token: "token"}, eff); err != nil {
			t.Fatalf("effort %q refused: %v", eff, err)
		}
	}
}

func readReservations(t *testing.T, path string) map[string]json.RawMessage {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func reservationClaims(t *testing.T, doc map[string]json.RawMessage) map[string]claimRecord {
	t.Helper()
	var claims map[string]claimRecord
	if raw, ok := doc["claims"]; ok {
		if err := json.Unmarshal(raw, &claims); err != nil {
			t.Fatal(err)
		}
	}
	return claims
}

func TestReservationLoadsLegacyAndVersionTwoClaims(t *testing.T) {
	at := time.Now().UTC().Format(time.RFC3339Nano)
	for _, tc := range []struct {
		name, body, key, id string
	}{
		{"v1", `{"spent":[{"at":"` + at + `","amount":0.5,"key":"legacy-key","attempt":1}],"claimed":{"legacy-key":"legacy-id"}}`, "legacy-key", "legacy-id"},
		{"v2", `{"version":2,"spent":[{"at":"` + at + `","amount":0.25,"key":"claim-key","attempt":1,"tenant":"tenant-a","version":2}],"claims":{"claim-key":{"id":"claim-id","tenant":"tenant-a","version":2}}}`, "claim-key", "claim-id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "reservations.json")
			if err := os.WriteFile(path, []byte(tc.body), 0o600); err != nil {
				t.Fatal(err)
			}
			r, err := NewPersistentReservations(2, path)
			if err != nil {
				t.Fatal(err)
			}
			if id, state := r.claimState(tc.key); id != tc.id || state != claimDurable {
				t.Fatalf("loaded claim=%q state=%v want %q", id, state, tc.id)
			}
			if err := r.begin("fresh-key", "fresh-id", "tenant-a"); err != nil {
				t.Fatal(err)
			}
			doc := readReservations(t, path)
			if _, ok := doc["spent"]; ok {
				t.Fatal("save kept spend entries")
			}
			claims := reservationClaims(t, doc)
			if claims[tc.key].ID != tc.id || claims["fresh-key"].ID != "fresh-id" || claims["fresh-key"].Tenant != "tenant-a" {
				t.Fatalf("saved claims=%+v", claims)
			}
			reloaded, err := NewPersistentReservations(2, path)
			if err != nil {
				t.Fatal(err)
			}
			if id, state := reloaded.claimState(tc.key); id != tc.id || state != claimDurable {
				t.Fatalf("reloaded claim=%q state=%v", id, state)
			}
			if !reloaded.TenantResidue("tenant-a") {
				t.Fatal("tenant attribution lost")
			}
		})
	}
}

func TestReservationUnreadableOrCorruptFileStartsEmpty(t *testing.T) {
	t.Run("corrupt", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "reservations.json")
		if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
			t.Fatal(err)
		}
		r, err := NewPersistentReservations(2, path)
		if err != nil {
			t.Fatalf("corrupt file disabled review: %v", err)
		}
		if len(r.claimed) != 0 {
			t.Fatalf("corrupt file produced claims: %+v", r.claimed)
		}
		if err := r.begin("key", "id", "tenant"); err != nil {
			t.Fatalf("start after corrupt file: %v", err)
		}
		if _, ok := readReservations(t, path)["spent"]; ok {
			t.Fatal("rewritten file kept spend entries")
		}
	})
	t.Run("unreadable", func(t *testing.T) {
		r, err := NewPersistentReservations(2, t.TempDir())
		if err != nil {
			t.Fatalf("unreadable path disabled review: %v", err)
		}
		if len(r.claimed) != 0 {
			t.Fatalf("unreadable path produced claims: %+v", r.claimed)
		}
	})
}

func TestReservationBusyLimitAndDuplicate(t *testing.T) {
	r := NewReservations(2)
	if err := r.begin("a1", "1", "tenant"); err != nil {
		t.Fatal(err)
	}
	if err := r.begin("a2", "2", "tenant"); err != nil {
		t.Fatal(err)
	}
	if err := r.begin("a3", "3", "tenant"); !errors.Is(err, ErrBusy) {
		t.Fatalf("third durable call err=%v want ErrBusy", err)
	}
	if err := r.beginEphemeral("e3", "tenant"); !errors.Is(err, ErrBusy) {
		t.Fatalf("third ephemeral call err=%v want ErrBusy", err)
	}
	if err := r.begin("a1", "duplicate", "tenant"); !errors.Is(err, ErrDuplicateClaim) {
		t.Fatalf("duplicate err=%v want ErrDuplicateClaim", err)
	}
	if id, dup := duplicateReview(r.begin("a1", "duplicate", "tenant")); !dup || id != "1" {
		t.Fatalf("duplicate claim=%q dup=%v", id, dup)
	}
	if err := r.begin("b1", "4", "other"); err != nil {
		t.Fatalf("other tenant blocked: %v", err)
	}
	r.finishClaim("a1", "tenant")
	r.finishClaim("a2", "tenant")
	if err := r.beginEphemeral("e3", "tenant"); err != nil {
		t.Fatalf("slot not released: %v", err)
	}
}

func TestReservationPurgeIsClaimsOnlyAndIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reservations.json")
	r, err := NewPersistentReservations(2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.begin("a-key", "a-id", "a"); err != nil {
		t.Fatal(err)
	}
	if err := r.begin("b-key", "b-id", "b"); err != nil {
		t.Fatal(err)
	}
	r.finishClaim("a-key", "a")
	r.finishClaim("b-key", "b")
	if !r.TenantResidue("a") || !r.TenantResidue("b") {
		t.Fatal("claims not counted as residue")
	}
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
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PurgeTenant("a"); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("second purge rewrote reservations")
	}
	reloaded, err := NewPersistentReservations(2, path)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.TenantResidue("a") || !reloaded.TenantResidue("b") {
		t.Fatal("reloaded tenant attribution wrong")
	}
	if id, state := reloaded.claimState("b-key"); id != "b-id" || state != claimDurable {
		t.Fatalf("reloaded tenant B claim=%q state=%v", id, state)
	}
}

func TestReservationPurgeLeavesLegacyClaims(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reservations.json")
	legacy := `{"claimed":{"legacy-key":"legacy-id"}}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := NewPersistentReservations(2, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PurgeTenant("tenant-a"); err != nil {
		t.Fatal(err)
	}
	if id, state := r.claimState("legacy-key"); id != "legacy-id" || state != claimDurable {
		t.Fatalf("legacy claim purged: %q %v", id, state)
	}
	if r.TenantResidue("tenant-a") {
		t.Fatal("legacy claim attributed to a tenant")
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
		r := NewReservations(2)
		if err := r.begin("key", "id", "tenant-a"); err != nil {
			t.Fatal(err)
		}
		done, cancel := wait(t, r, "tenant-a")
		defer cancel()
		assertBlocked(t, done)
		r.finishClaim("key", "tenant-a")
		assertReturns(t, done)
	})

	t.Run("ephemeral", func(t *testing.T) {
		r := NewReservations(2)
		if err := r.beginEphemeral("eph", "tenant-a"); err != nil {
			t.Fatal(err)
		}
		done, cancel := wait(t, r, "tenant-a")
		defer cancel()
		assertBlocked(t, done)
		r.finish("tenant-a")
		assertReturns(t, done)
	})

	t.Run("cancelled context", func(t *testing.T) {
		r := NewReservations(2)
		if err := r.begin("key", "id", "tenant-a"); err != nil {
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
		r := NewReservations(2)
		if err := r.WaitTenant(context.Background(), "tenant-a"); err != nil {
			t.Fatalf("idle WaitTenant=%v", err)
		}
	})
}
