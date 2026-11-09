package store

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"strings"
)

//go:embed pricing_table.json
var pricingJSON []byte

type rates struct {
	Input      float64    `json:"input"`
	CacheWrite float64    `json:"cache_write"`
	CacheRead  float64    `json:"cache_read"`
	Output     float64    `json:"output"`
	Tiers      []rateTier `json:"tiers,omitempty"`
}

type rateTier struct {
	Name           string  `json:"name"`
	MaxInputTokens int64   `json:"max_input_tokens,omitempty"`
	MinInputTokens int64   `json:"min_input_tokens,omitempty"`
	Input          float64 `json:"input"`
	CacheWrite     float64 `json:"cache_write"`
	CacheRead      float64 `json:"cache_read"`
	Output         float64 `json:"output"`
}

func (t rateTier) rates() rates {
	return rates{Input: t.Input, CacheWrite: t.CacheWrite, CacheRead: t.CacheRead, Output: t.Output}
}

// pricing maps model name to USD-per-million-token rates, parsed from the embedded copy of
// tools/transcript/pricing.json (the "_meta" key is skipped).
var pricing = loadPricing()

func loadPricing() map[string]rates {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(pricingJSON, &raw); err != nil {
		panic("store: bad pricing_table.json: " + err.Error())
	}
	out := make(map[string]rates, len(raw))
	for k, v := range raw {
		if k == "_meta" {
			continue
		}
		var r rates
		if err := json.Unmarshal(v, &r); err != nil {
			panic("store: bad pricing entry " + k + ": " + err.Error())
		}
		out[k] = r
	}
	return out
}

// Tokens is one call's token columns as stored.
type Tokens struct{ In, Out, CacheRead, CacheWrite, Reasoning int64 }

func lookupRates(model string) (rates, bool) {
	if model == "" {
		return rates{}, false
	}
	if r, ok := pricing[model]; ok {
		return r, true
	}
	if _, after, found := strings.Cut(model, "/"); found {
		if r, ok := pricing[after]; ok {
			return r, true
		}
	}
	return rates{}, false
}

// PricedModel reports whether model has a price in the embedded table (exact, or the text after
// the first "/").
func PricedModel(model string) bool {
	_, ok := lookupRates(model)
	return ok
}

// Cost returns a call's USD cost. A positive reported cost wins; 0 or negative counts as not
// reported. Otherwise tokens are priced from the table; priced is false when the model is unknown.
// Codex input_tokens include cached input, so cache reads are subtracted from fresh input there.
// Reasoning tokens are inside Out and are not charged separately.
func Cost(harness, model string, tok Tokens, reported *float64) (usd float64, priced bool) {
	inputSize := tok.In + tok.CacheRead + tok.CacheWrite
	return CostAtInputSize(harness, model, tok, inputSize, reported)
}

// CostAtInputSize settles usage using the model tier selected by the exact
// provider-reported prompt size. Input tokens at a tier boundary use the lower tier.
func CostAtInputSize(harness, model string, tok Tokens, inputSize int64, reported *float64) (usd float64, priced bool) {
	if reported != nil && *reported > 0 {
		return *reported, true
	}
	r, ok := lookupRates(model)
	if !ok {
		return 0, false
	}
	r = rateForInputSize(r, inputSize, false)
	fresh := tok.In
	if harness == "codex" {
		fresh = max(tok.In-tok.CacheRead, 0)
	}
	usd = (float64(fresh)*r.Input + float64(tok.CacheRead)*r.CacheRead +
		float64(tok.CacheWrite)*r.CacheWrite + float64(tok.Out)*r.Output) / 1e6
	return usd, true
}

// ReservationCost prices an uncached request bound. If input size is uncertain,
// it selects the most expensive published tier even when the estimate is below
// the boundary. Callers reserve this amount independently for each attempt.
func ReservationCost(model string, maxInputTokens, maxOutputTokens int64, uncertain bool) (float64, bool) {
	r, ok := lookupRates(model)
	if !ok {
		return 0, false
	}
	r = rateForInputSize(r, maxInputTokens, uncertain)
	return (float64(maxInputTokens)*r.Input + float64(maxOutputTokens)*r.Output) / 1e6, true
}

// PricingTableID identifies the exact embedded pricing bytes for durable records.
func PricingTableID() string {
	sum := sha256.Sum256(pricingJSON)
	return hex.EncodeToString(sum[:])
}

// PricingTier reports the stable tier label selected for usage or reservation.
// Flat-rate models return "flat". The returned label can be stored with a review.
func PricingTier(model string, inputSize int64, uncertain bool) (string, bool) {
	r, ok := lookupRates(model)
	if !ok {
		return "", false
	}
	if len(r.Tiers) == 0 {
		return "flat", true
	}
	if uncertain {
		return r.Tiers[len(r.Tiers)-1].Name, true
	}
	for _, tier := range r.Tiers {
		if (tier.MinInputTokens == 0 || inputSize >= tier.MinInputTokens) &&
			(tier.MaxInputTokens == 0 || inputSize <= tier.MaxInputTokens) {
			return tier.Name, true
		}
	}
	return "", false
}

func rateForInputSize(r rates, inputSize int64, uncertain bool) rates {
	if len(r.Tiers) == 0 {
		return r
	}
	if uncertain {
		return r.Tiers[len(r.Tiers)-1].rates()
	}
	for _, tier := range r.Tiers {
		if (tier.MinInputTokens == 0 || inputSize >= tier.MinInputTokens) &&
			(tier.MaxInputTokens == 0 || inputSize <= tier.MaxInputTokens) {
			return tier.rates()
		}
	}
	return r
}
