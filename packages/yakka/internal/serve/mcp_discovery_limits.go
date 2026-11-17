package serve

import (
	"errors"
	"sync"
	"time"
)

// Judgement value: anonymous MCP discovery posts per client IP per minute (plan 25).
const mcpDiscoveryRatePerMinute = 120

var errMCPDiscoveryRateLimited = errors.New("rate_limited")

type mcpDiscoveryLimits struct {
	mu   sync.Mutex
	now  func() time.Time
	hits map[string][]time.Time
}

func newMCPDiscoveryLimits() mcpDiscoveryLimits {
	return mcpDiscoveryLimits{now: time.Now, hits: map[string][]time.Time{}}
}

func (l *mcpDiscoveryLimits) admit(ip string) error {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	window := time.Minute
	hits := recent(l.hits[ip], now, window)
	if len(hits) >= mcpDiscoveryRatePerMinute {
		l.hits[ip] = hits
		return errMCPDiscoveryRateLimited
	}
	l.hits[ip] = append(hits, now)
	pruneHits(l.hits, now, window)
	return nil
}