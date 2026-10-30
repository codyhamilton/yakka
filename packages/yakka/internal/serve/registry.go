package serve

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Registry persistence lives directly under YAKKA_SERVE_DATA (not inside a tenant directory):
//
//	<data>/registry.json — versioned JSON document with domain policy, sessions, and reserved
//	slots for tenant owners and issued token hashes (phase 2).
//
// Restart loads this file; a missing file means domain policy defaults to everyone and no sessions.
const registryFileName = "registry.json"

// DomainPolicyMode is the collector-wide admission mode.
const (
	PolicyEveryone  = "everyone"
	PolicyAllowList = "allow_list"
)

// DomainPolicy is the collector-wide domain admission record.
type DomainPolicy struct {
	Mode    string   `json:"mode"`
	Domains []string `json:"domains,omitempty"`
}

// SessionRecord is one logged-in session keyed by opaque session id.
type SessionRecord struct {
	GitHubID       int64     `json:"github_id"`
	GitHubLogin    string    `json:"github_login"`
	VerifiedEmails []string  `json:"verified_emails"`
	ExpiresAt      time.Time `json:"expires_at"`
}

const (
	TokenScopeRead      = "read"
	TokenScopeReadWrite = "read_write"
)

// TokenHashRecord is one issued API token (SHA-256 of plaintext stored; plaintext never persisted).
type TokenHashRecord struct {
	ID        string    `json:"id"`
	Tenant    string    `json:"tenant"`
	Scope     string    `json:"scope"`
	Hash      string    `json:"hash"`
	GitHubID  int64     `json:"github_id"`
	ExpiresAt time.Time `json:"expires_at"`
	Revoked   bool      `json:"revoked"`
	CreatedAt time.Time `json:"created_at"`
}

// CreatedToken is returned once when a token is issued (includes plaintext).
type CreatedToken struct {
	Record    TokenHashRecord
	Plaintext string
}

// legacyDeviceCodeRecord reads the retired device_codes field so load can revoke the
// tokens those codes would have released. It is never written back.
type legacyDeviceCodeRecord struct {
	TokenID string `json:"token_id"`
}

// registryDoc is the on-disk shape of registry.json.
type registryDoc struct {
	Version     int                      `json:"version"`
	Policy      DomainPolicy             `json:"policy"`
	Sessions    map[string]SessionRecord `json:"sessions"`
	Owners      map[string]string        `json:"owners"`
	Names       map[string]string        `json:"names,omitempty"`
	TokenHashes []TokenHashRecord        `json:"token_hashes"`
}

// Registry holds collector-wide state outside tenant directories.
type Registry struct {
	mu   sync.RWMutex
	path string

	policy      DomainPolicy
	sessions    map[string]SessionRecord
	owners      map[string]string // tenant ID -> owner GitHub ID
	names       map[string]string // tenant ID -> display name; a missing entry means the name is the ID
	tokenHashes []TokenHashRecord
	dirty       bool
}

// OpenRegistry loads or creates registry state for dataDir.
func OpenRegistry(dataDir string) (*Registry, error) {
	r := &Registry{
		path:     filepath.Join(dataDir, registryFileName),
		policy:   DomainPolicy{Mode: PolicyEveryone},
		sessions: map[string]SessionRecord{},
		owners:   map[string]string{},
		names:    map[string]string{},
	}
	if err := r.load(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Registry) load() error {
	b, err := os.ReadFile(r.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var doc registryDoc
	if err := json.Unmarshal(b, &doc); err != nil {
		return fmt.Errorf("registry: invalid %s: %w", registryFileName, err)
	}
	if doc.Version != 1 {
		return fmt.Errorf("registry: unsupported version %d in %s", doc.Version, registryFileName)
	}
	if doc.Policy.Mode == "" {
		doc.Policy.Mode = PolicyEveryone
	}
	r.policy = doc.Policy
	if doc.Sessions != nil {
		r.sessions = doc.Sessions
	}
	if doc.Owners != nil {
		r.owners = doc.Owners
	}
	if doc.Names != nil {
		r.names = doc.Names
	}
	r.tokenHashes = doc.TokenHashes
	var legacy struct {
		DeviceCodes []legacyDeviceCodeRecord `json:"device_codes"`
	}
	if err := json.Unmarshal(b, &legacy); err == nil {
		for _, dc := range legacy.DeviceCodes {
			for i := range r.tokenHashes {
				if r.tokenHashes[i].ID == dc.TokenID && !r.tokenHashes[i].Revoked {
					r.tokenHashes[i].Revoked = true
					r.dirty = true
				}
			}
		}
	}
	return nil
}

// Persist writes the registry if the data directory should hold a file (remote collector mode).
func (r *Registry) Persist() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.saveLocked()
}

func (r *Registry) saveLocked() error {
	doc := registryDoc{
		Version:     1,
		Policy:      r.policy,
		Sessions:    r.sessions,
		Owners:      r.owners,
		Names:       r.names,
		TokenHashes: r.tokenHashes,
	}
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, r.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	r.dirty = false
	return nil
}

// Close flushes pending changes.
func (r *Registry) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.dirty {
		return nil
	}
	return r.saveLocked()
}

// Policy returns the current domain policy (default everyone when never set).
func (r *Registry) Policy() DomainPolicy {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.policy
}

// SetPolicy updates domain policy and marks the registry dirty.
func (r *Registry) SetPolicy(p DomainPolicy) error {
	if p.Mode != PolicyEveryone && p.Mode != PolicyAllowList {
		return fmt.Errorf("registry: invalid policy mode %q", p.Mode)
	}
	if p.Mode == PolicyEveryone {
		p.Domains = nil
	}
	r.mu.Lock()
	r.policy = p
	r.dirty = true
	r.mu.Unlock()
	return nil
}

// GetSession returns one session by id, or false when missing or expired at now.
func (r *Registry) GetSession(id string, now time.Time) (SessionRecord, bool) {
	r.mu.RLock()
	rec, ok := r.sessions[id]
	r.mu.RUnlock()
	if !ok || !now.Before(rec.ExpiresAt) {
		return SessionRecord{}, false
	}
	return rec, true
}

// PutSession stores or replaces a session record.
func (r *Registry) PutSession(id string, rec SessionRecord) {
	r.mu.Lock()
	r.sessions[id] = rec
	r.dirty = true
	r.mu.Unlock()
}

// DeleteSession removes a session by id.
func (r *Registry) DeleteSession(id string) {
	r.mu.Lock()
	if _, ok := r.sessions[id]; ok {
		delete(r.sessions, id)
		r.dirty = true
	}
	r.mu.Unlock()
}

// RegistryPath reports the on-disk file path (tests).
func (r *Registry) RegistryPath() string { return r.path }

func hashTokenPlaintext(plaintext string) string {
	h := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(h[:])
}

func generateTokenPlaintext() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "wk_" + base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func newTokenID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// DefaultTenantName is the display name of the tenant every user gets on first sign-in.
const DefaultTenantName = "default"

func newTenantID() (string, error) {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "t-" + hex.EncodeToString(b[:]), nil
}

// createTenantLocked registers a tenant under a fresh unique ID. The caller holds r.mu.
func (r *Registry) createTenantLocked(name, owner string) (string, error) {
	for i := 0; i < 8; i++ {
		id, err := newTenantID()
		if err != nil {
			return "", err
		}
		if _, taken := r.owners[id]; taken {
			continue
		}
		r.owners[id] = owner
		r.names[id] = name
		r.dirty = true
		return id, nil
	}
	return "", fmt.Errorf("registry: no free tenant id")
}

func (r *Registry) tenantNameLocked(id string) string {
	if n := r.names[id]; n != "" {
		return n
	}
	return id
}

// CreateTenant registers a tenant called name for githubID and returns its ID.
// Names are unique per owner, not globally; ok is false when githubID already has that name.
func (r *Registry) CreateTenant(name string, githubID int64) (id string, ok bool, err error) {
	owner := fmt.Sprintf("%d", githubID)
	r.mu.Lock()
	defer r.mu.Unlock()
	for tid, o := range r.owners {
		if o == owner && r.tenantNameLocked(tid) == name {
			return "", false, nil
		}
	}
	id, err = r.createTenantLocked(name, owner)
	return id, err == nil, err
}

// EnsureDefaultTenant gives githubID a tenant named "default" when they own none.
// It reports whether it created one.
func (r *Registry) EnsureDefaultTenant(githubID int64) (bool, error) {
	owner := fmt.Sprintf("%d", githubID)
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, o := range r.owners {
		if o == owner {
			return false, nil
		}
	}
	if _, err := r.createTenantLocked(DefaultTenantName, owner); err != nil {
		return false, err
	}
	return true, nil
}

// TenantInfo is a tenant as shown to its owner.
type TenantInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TenantName returns the display name for a tenant ID (the ID itself when none was set).
func (r *Registry) TenantName(id string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tenantNameLocked(id)
}

// validateGrantLocked runs the scope, expiry and owner checks shared by ValidateGrant and CreateToken.
// The caller holds r.mu.
func (r *Registry) validateGrantLocked(tenant, scope string, expiresAt time.Time, githubID int64, now time.Time) error {
	if scope != TokenScopeRead && scope != TokenScopeReadWrite {
		return fmt.Errorf("invalid scope")
	}
	if !expiresAt.After(now) {
		return fmt.Errorf("expires_at must be in the future")
	}
	if r.owners[tenant] != fmt.Sprintf("%d", githubID) {
		return fmt.Errorf("forbidden tenant")
	}
	return nil
}

// ValidateGrant applies the checks CreateToken applies, without minting.
func (r *Registry) ValidateGrant(tenant, scope string, expiresAt time.Time, githubID int64, now time.Time) error {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.validateGrantLocked(tenant, scope, expiresAt, githubID, now)
}

// CreateToken issues a token for tenant owned by githubID. Returns nil on validation or ownership failure.
func (r *Registry) CreateToken(tenant, scope string, expiresAt time.Time, githubID int64, now time.Time) (*CreatedToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.validateGrantLocked(tenant, scope, expiresAt, githubID, now); err != nil {
		return nil, err
	}
	id, err := newTokenID()
	if err != nil {
		return nil, err
	}
	plain, err := generateTokenPlaintext()
	if err != nil {
		return nil, err
	}
	rec := TokenHashRecord{
		ID:        id,
		Tenant:    tenant,
		Scope:     scope,
		Hash:      hashTokenPlaintext(plain),
		GitHubID:  githubID,
		ExpiresAt: expiresAt.UTC(),
		CreatedAt: now.UTC(),
	}
	r.tokenHashes = append(r.tokenHashes, rec)
	r.dirty = true
	return &CreatedToken{Record: rec, Plaintext: plain}, nil
}

func generateDeviceCode() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func hashDeviceCode(code string) string {
	return hashTokenPlaintext(code)
}

// ListTokensForOwner returns tokens whose tenant is owned by githubID.
func (r *Registry) ListTokensForOwner(githubID int64) []TokenHashRecord {
	r.mu.RLock()
	defer r.mu.RUnlock()
	owner := fmt.Sprintf("%d", githubID)
	var out []TokenHashRecord
	for _, rec := range r.tokenHashes {
		if r.owners[rec.Tenant] == owner {
			out = append(out, rec)
		}
	}
	return out
}

// ListAllTokens returns every token record.
func (r *Registry) ListAllTokens() []TokenHashRecord {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]TokenHashRecord, len(r.tokenHashes))
	copy(out, r.tokenHashes)
	return out
}

// RevokeToken marks a token revoked. Returns (found, alreadyRevoked).
func (r *Registry) RevokeToken(id string) (bool, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.tokenHashes {
		if r.tokenHashes[i].ID != id {
			continue
		}
		if r.tokenHashes[i].Revoked {
			return true, true
		}
		r.tokenHashes[i].Revoked = true
		r.dirty = true
		return true, false
	}
	return false, false
}

// TokenByID returns one token by id.
func (r *Registry) TokenByID(id string) (TokenHashRecord, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, rec := range r.tokenHashes {
		if rec.ID == id {
			return rec, true
		}
	}
	return TokenHashRecord{}, false
}

// resolveBearer maps a plaintext bearer to tenant and scope. Expired and revoked tokens do not match.
func (r *Registry) resolveBearer(plaintext string, now time.Time) (tenant, scope string, ok bool) {
	kh := sha256.Sum256([]byte(plaintext))
	r.mu.RLock()
	defer r.mu.RUnlock()
	var found *TokenHashRecord
	match := 0
	for i := range r.tokenHashes {
		rec := &r.tokenHashes[i]
		ph, err := hex.DecodeString(rec.Hash)
		if err != nil || len(ph) != sha256.Size {
			continue
		}
		eq := subtle.ConstantTimeCompare(kh[:], ph)
		if eq == 1 {
			found = rec
		}
		match |= eq
	}
	if match != 1 || found == nil {
		return "", "", false
	}
	if found.Revoked || !now.Before(found.ExpiresAt) {
		return "", "", false
	}
	return found.Tenant, found.Scope, true
}
