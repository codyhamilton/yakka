package serve

import (
	"strings"
	"time"
	"unicode"
)

// tokenLifetimes are the lifetimes a token can be issued for. The server computes the expiry from
// one of these; clients never choose a date. Months are fixed day counts.
var tokenLifetimes = map[string]time.Duration{
	"1d": 24 * time.Hour,
	"1w": 7 * 24 * time.Hour,
	"1m": 30 * 24 * time.Hour,
	"3m": 90 * 24 * time.Hour,
	"6m": 180 * 24 * time.Hour,
	"1y": 365 * 24 * time.Hour,
}

// defaultTokenName names a token when the request and the device supplied no name.
const defaultTokenName = "token"

// defaultTokenLifetime applies when a request names no lifetime.
const defaultTokenLifetime = "3m"

// tokenExpiry returns now plus the named lifetime ("" means the default); ok is false for an
// unknown name.
func tokenExpiry(lifetime string, now time.Time) (time.Time, bool) {
	if lifetime == "" {
		lifetime = defaultTokenLifetime
	}
	d, ok := tokenLifetimes[lifetime]
	if !ok {
		return time.Time{}, false
	}
	return now.Add(d).UTC(), true
}

// validTokenName accepts a token name: 1 to 64 characters, no control characters.
func validTokenName(name string) bool { return validTenantName(name) }

// cleanHost normalises a client-supplied host name into a default token name: control characters
// dropped, whitespace trimmed, at most 64 characters. It may return "".
func cleanHost(h string) string {
	h = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, h))
	if r := []rune(h); len(r) > 64 {
		h = string(r[:64])
	}
	return h
}
