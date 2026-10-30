package serve

import (
	"crypto/rand"
	"strings"
	"sync"
	"time"
)

const (
	deviceUserCodeAlphabet = "BCDFGHJKLMNPQRSTVWXZ"
	deviceGrantTTL         = 600 * time.Second
	deviceBaseInterval     = 5 * time.Second
	deviceSlowDownStep     = 5 * time.Second
)

type grantStatus int

const (
	grantPending grantStatus = iota
	grantApproved
	grantDenied
)

// deviceGrant is one pending device authorization. It lives in memory only and never holds a token.
type deviceGrant struct {
	userCode  string // normalised
	host      string // host name the device reported, the default token name; may be empty
	status    grantStatus
	tenant    string
	scope     string
	name      string    // token name chosen on approval
	expiresAt time.Time // token expiry, set on approval from the chosen lifetime
	githubID  int64
	expiry    time.Time // grant expiry
	clientIP  string
	lastPoll  time.Time
	interval  time.Duration
}

// deviceGrants is the in-memory grant table, keyed by the SHA-256 of device_code and by user code.
type deviceGrants struct {
	mu     sync.Mutex
	now    func() time.Time
	byHash map[string]*deviceGrant
	byUser map[string]*deviceGrant
	limits deviceLimits
}

func newDeviceGrants() *deviceGrants {
	return &deviceGrants{now: time.Now, byHash: map[string]*deviceGrant{}, byUser: map[string]*deviceGrant{}, limits: newDeviceLimits()}
}

// normaliseUserCode uppercases and strips hyphens and spaces.
func normaliseUserCode(c string) string {
	c = strings.ToUpper(c)
	return strings.NewReplacer("-", "", " ", "").Replace(c)
}

func formatUserCode(n string) string { return n[:4] + "-" + n[4:] }

func generateUserCode() (string, error) {
	// 256 is not a multiple of 20; reject bytes >= 240 so every letter is equally likely.
	const limit = 256 - 256%len(deviceUserCodeAlphabet)
	out := make([]byte, 0, 8)
	var buf [16]byte
	for len(out) < 8 {
		if _, err := rand.Read(buf[:]); err != nil {
			return "", err
		}
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, deviceUserCodeAlphabet[int(b)%len(deviceUserCodeAlphabet)])
			if len(out) == 8 {
				break
			}
		}
	}
	return string(out), nil
}

// sweepLocked drops grants past expiry. Called at the start of every device route; there is no background loop.
func (g *deviceGrants) sweepLocked(now time.Time) {
	g.limits.pruneLocked(now)
	for h, gr := range g.byHash {
		if !now.Before(gr.expiry) {
			delete(g.byHash, h)
			delete(g.byUser, gr.userCode)
		}
	}
}

func (g *deviceGrants) dropLocked(hash string, gr *deviceGrant) {
	delete(g.byHash, hash)
	delete(g.byUser, gr.userCode)
}

// create adds a pending grant for deviceCode and returns its formatted user code.
func (g *deviceGrants) create(deviceCode, clientIP, host string) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.sweepLocked(now)
	if err := g.admitCodeLocked(clientIP, now); err != nil {
		return "", err
	}
	var norm string
	for {
		c, err := generateUserCode()
		if err != nil {
			return "", err
		}
		if _, taken := g.byUser[c]; !taken {
			norm = c
			break
		}
	}
	gr := &deviceGrant{userCode: norm, host: host, clientIP: clientIP, expiry: now.Add(deviceGrantTTL), interval: deviceBaseInterval}
	g.byHash[hashDeviceCode(deviceCode)] = gr
	g.byUser[norm] = gr
	return formatUserCode(norm), nil
}

// decide sweeps, applies the per-session unknown-code limit, then runs under the table lock.
// The limit check, the lookup and recording an unknown attempt share one lock, so a burst of
// requests cannot pass the cap. A session at the limit is blocked and that attempt is not
// recorded. An unknown, expired or already decided code is one unknown attempt. The callback
// runs only for a pending grant.
func (g *deviceGrants) decide(sessionID, userCode string, decide func(gr *deviceGrant) error) (found, blocked bool, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.sweepLocked(now)
	hits := recent(g.limits.unknownHits[sessionID], now, g.limits.unknownWindow)
	if len(hits) >= g.limits.unknownMax {
		return false, true, nil
	}
	gr := g.byUser[normaliseUserCode(userCode)]
	if gr == nil || gr.status != grantPending {
		g.limits.unknownHits[sessionID] = append(hits, now)
		return false, false, nil
	}
	return true, false, decide(gr)
}

type pollResult int

const (
	pollUnknown pollResult = iota
	pollSlowDown
	pollPending
	pollDenied
	pollApproved
)

// poll applies the poll-rate rule and reports the grant's state. On pollDenied the grant is dropped.
// On pollApproved the grant is dropped too and returned for the caller to mint from.
func (g *deviceGrants) poll(deviceCode string) (pollResult, deviceGrant) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.sweepLocked(now)
	h := hashDeviceCode(deviceCode)
	gr := g.byHash[h]
	if gr == nil {
		return pollUnknown, deviceGrant{}
	}
	tooSoon := !gr.lastPoll.IsZero() && now.Sub(gr.lastPoll) < gr.interval
	if tooSoon {
		gr.interval += deviceSlowDownStep
	}
	gr.lastPoll = now
	if tooSoon {
		return pollSlowDown, *gr
	}
	switch gr.status {
	case grantDenied:
		g.dropLocked(h, gr)
		return pollDenied, *gr
	case grantApproved:
		g.dropLocked(h, gr) // claimed here, under the lock, so a grant yields at most one token
		return pollApproved, *gr
	}
	return pollPending, *gr
}

// sweep drops expired grants; device routes that do not otherwise touch the table call it first.
func (g *deviceGrants) sweep() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.sweepLocked(g.now())
}
