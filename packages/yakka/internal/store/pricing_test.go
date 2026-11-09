package store

import (
	"bytes"
	"math"
	"os"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-12 }

func TestPricingTableMatchesTranscript(t *testing.T) {
	want, err := os.ReadFile("../../../../tools/transcript/pricing.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, pricingJSON) {
		t.Fatal("pricing_table.json differs from tools/transcript/pricing.json; re-copy it")
	}
}

func TestCostReportedWins(t *testing.T) {
	r := 12.5
	usd, ok := Cost("claude", "kimi-k2.5", Tokens{In: 1000}, &r)
	if !ok || usd != 12.5 {
		t.Fatalf("got %v %v", usd, ok)
	}
	// Reported cost wins even for an unpriced model.
	if usd, ok := Cost("opencode", "nope", Tokens{}, &r); !ok || usd != 12.5 {
		t.Fatalf("got %v %v", usd, ok)
	}
}

func TestCostReportedZeroFallsToTokens(t *testing.T) {
	for _, z := range []float64{0, -1} {
		z := z
		usd, ok := Cost("opencode", "kimi-k2.5", Tokens{In: 1000}, &z)
		if !ok || !near(usd, 0.0006) { // 1000 * 0.6 / 1e6
			t.Fatalf("reported %v: got %v %v", z, usd, ok)
		}
	}
}

func TestCostCodexNoDoubleCharge(t *testing.T) {
	// fresh 600*0.6 + cache 400*0.1 = 400 per million.
	usd, ok := Cost("codex", "kimi-k2.5", Tokens{In: 1000, CacheRead: 400}, nil)
	if !ok || !near(usd, 0.0004) {
		t.Fatalf("got %v %v", usd, ok)
	}
	// Cache read larger than input clamps fresh to 0: 400*0.1 = 40 per million.
	usd, _ = Cost("codex", "kimi-k2.5", Tokens{In: 100, CacheRead: 400}, nil)
	if !near(usd, 0.00004) {
		t.Fatalf("clamp: got %v", usd)
	}
}

func TestCostClaudeNotReduced(t *testing.T) {
	// 1000*0.6 + 400*0.1 + 200*0.6 + 500*3.0 = 600+40+120+1500 = 2260 per million.
	usd, ok := Cost("claude", "kimi-k2.5", Tokens{In: 1000, CacheRead: 400, CacheWrite: 200, Out: 500, Reasoning: 300}, nil)
	if !ok || !near(usd, 0.00226) {
		t.Fatalf("got %v %v", usd, ok)
	}
}

func TestCostPrefixRule(t *testing.T) {
	usd, ok := Cost("opencode", "x/kimi-k2.5", Tokens{In: 1000}, nil)
	if !ok || !near(usd, 0.0006) {
		t.Fatalf("got %v %v", usd, ok)
	}
	if !PricedModel("x/kimi-k2.5") || !PricedModel("kimi-k2.5") {
		t.Fatal("PricedModel should accept exact and prefixed names")
	}
}

func TestCostUnknownModel(t *testing.T) {
	for _, m := range []string{"", "claude-test-unpriced", "a/b/kimi-k2.5", "x/unknown"} {
		if usd, ok := Cost("claude", m, Tokens{In: 1000}, nil); ok || usd != 0 {
			t.Fatalf("%q: got %v %v", m, usd, ok)
		}
		if PricedModel(m) {
			t.Fatalf("%q should not be priced", m)
		}
	}
}

func TestCostVendorRates(t *testing.T) {
	// Claude sonnet-5-5: 1M fresh in $2 + 1M cache read $0.10 + 1M out $10 + 1M cache write $2.50.
	usd, ok := Cost("claude", "claude-sonnet-5-5", Tokens{In: 1e6, CacheRead: 1e6, CacheWrite: 1e6, Out: 1e6}, nil)
	if !ok || !near(usd, 14.60) {
		t.Fatalf("claude-sonnet-5-5: got %v %v", usd, ok)
	}
	// Codex input includes cached input: 1M in with 400k cached = 600k fresh.
	usd, ok = Cost("codex", "gpt-5.4", Tokens{In: 1e6, CacheRead: 4e5, Out: 1e5}, nil)
	if !ok || !near(usd, 0.6*2.5+0.4*0.25+0.1*15) {
		t.Fatalf("gpt-5.4: got %v %v", usd, ok)
	}
	for _, m := range []string{"claude-haiku-4-5-20251001", "claude-opus-5-5", "gpt-6.1-sol", "gpt-6-luna"} {
		if !PricedModel(m) {
			t.Fatalf("%s should be priced", m)
		}
	}
}

func TestHaiku55PublishedInputTiers(t *testing.T) {
	const boundary = int64(100_000)
	for _, tc := range []struct {
		name  string
		input int64
		want  float64
	}{
		{"below", boundary - 1, 0.0100004},
		{"at", boundary, 0.0100005},
		{"above", boundary + 1, 0.050003},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := CostAtInputSize("claude", "claude-haiku-5-5", Tokens{In: tc.input, Out: 1}, tc.input, nil)
			if !ok || !near(got, tc.want) {
				t.Fatalf("got %.9f, %v; want %.9f", got, ok, tc.want)
			}
		})
	}
}

func TestHaiku55ConservativeReservations(t *testing.T) {
	// Uncertain size chooses the upper tier even below the boundary; a retry
	// reserves the same worst-case amount as another independent attempt.
	one, ok := ReservationCost("claude-haiku-5-5", 99_999, 2_000, true)
	if !ok || !near(one, 0.0549995) {
		t.Fatalf("reservation: %.9f %v", one, ok)
	}
	retry, ok := ReservationCost("claude-haiku-5-5", 99_999, 2_000, true)
	if !ok || !near(retry, one) {
		t.Fatalf("retry reservation: %.9f %v", retry, ok)
	}
	known, _ := ReservationCost("claude-haiku-5-5", 99_999, 2_000, false)
	if !near(known, 0.0109999) {
		t.Fatalf("known low-tier reservation: %.9f", known)
	}
	if PricingTableID() == "" {
		t.Fatal("pricing table identity is empty")
	}
	for _, tc := range []struct {
		size      int64
		uncertain bool
		want      string
	}{
		{99_999, false, "up_to_100k"}, {100_000, false, "up_to_100k"},
		{100_001, false, "over_100k"}, {1, true, "over_100k"},
	} {
		if got, ok := PricingTier("claude-haiku-5-5", tc.size, tc.uncertain); !ok || got != tc.want {
			t.Fatalf("tier for size %d uncertain=%v: got %q, %v; want %q", tc.size, tc.uncertain, got, ok, tc.want)
		}
	}
}
