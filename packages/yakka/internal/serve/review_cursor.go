package serve

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"sort"
)

const (
	reviewCursorVersion = 1
	reviewCursorRoute   = "GET /v1/reviews"
	maxReviewFilterTags = 16
	defaultReviewPage   = 100
	maxReviewPageSize   = 500
)

var reviewTagRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/=-]{0,95}$`)

// reviewFilterTags validates and canonicalizes repeated REST tag filters. Tags match all of the
// requested values, so duplicates add no meaning; the result is sorted and unique.
func reviewFilterTags(values []string) ([]string, error) {
	if len(values) > maxReviewFilterTags {
		return nil, errors.New("at most 16 tag filters are allowed")
	}
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if !reviewTagRE.MatchString(value) {
			return nil, errors.New("invalid tag filter")
		}
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out, nil
}

// reviewCursorFilter is the canonical filter selection bound into a cursor. Filters are compared
// exactly, so a later page cannot ignore or override a bound filter without an explicit error.
type reviewCursorFilter struct {
	RepoID       string   `json:"repo_id"`
	Plan         string   `json:"plan"`
	Phase        *int     `json:"phase"`
	Kind         string   `json:"kind"`
	Status       string   `json:"status"`
	Effort       string   `json:"effort"`
	Profile      string   `json:"profile"`
	ManifestHash string   `json:"manifest_hash"`
	Since        float64  `json:"since"`
	Tags         []string `json:"tags"`
	Detail       string   `json:"detail"`
}

func (f reviewCursorFilter) equal(g reviewCursorFilter) bool {
	if f.RepoID != g.RepoID || f.Plan != g.Plan || f.Kind != g.Kind || f.Status != g.Status ||
		f.Effort != g.Effort || f.Profile != g.Profile || f.ManifestHash != g.ManifestHash ||
		f.Since != g.Since || f.Detail != g.Detail {
		return false
	}
	if (f.Phase == nil) != (g.Phase == nil) {
		return false
	}
	if f.Phase != nil && *f.Phase != *g.Phase {
		return false
	}
	return slices.Equal(f.Tags, g.Tags)
}

// reviewCursorPayload is the opaque state of one walk page. It binds the cursor version, the
// authenticated tenant, the route, the canonical filters and detail, the fixed high-water mark and
// the strict last key. Page size is deliberately not bound.
type reviewCursorPayload struct {
	Version   int                `json:"v"`
	Tenant    string             `json:"tenant"`
	Route     string             `json:"route"`
	Filters   reviewCursorFilter `json:"filters"`
	HighWater int64              `json:"high_water"`
	LastTS    float64            `json:"last_ts"`
	LastID    int64              `json:"last_id"`
}

type reviewCursorEnvelope struct {
	Payload  json.RawMessage `json:"payload"`
	Checksum string          `json:"checksum"`
}

// encodeReviewCursor wraps the bound payload in base64url with a checksum over that payload, so a
// mutated or inconsistent cursor is detectably invalid rather than silently reselecting rows.
func encodeReviewCursor(p reviewCursorPayload) (string, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	envelope, err := json.Marshal(reviewCursorEnvelope{Payload: payload, Checksum: hex.EncodeToString(sum[:])})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(envelope), nil
}

func decodeReviewCursor(raw string) (reviewCursorPayload, error) {
	var p reviewCursorPayload
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return p, errors.New("malformed cursor")
	}
	var envelope reviewCursorEnvelope
	if err := json.Unmarshal(decoded, &envelope); err != nil {
		return p, errors.New("malformed cursor")
	}
	sum := sha256.Sum256(envelope.Payload)
	if envelope.Checksum != hex.EncodeToString(sum[:]) {
		return p, errors.New("malformed cursor")
	}
	if err := json.Unmarshal(envelope.Payload, &p); err != nil {
		return p, errors.New("malformed cursor")
	}
	return p, nil
}

// validate checks every field bound to the current request. A mismatch is an explicit argument
// error, never a silent reselection.
func (p reviewCursorPayload) validate(tenant string, filters reviewCursorFilter) error {
	if p.Version != reviewCursorVersion {
		return errors.New("unsupported cursor version")
	}
	if p.Route != reviewCursorRoute {
		return errors.New("cursor route mismatch")
	}
	if p.Tenant != tenant {
		return errors.New("cursor tenant mismatch")
	}
	if !p.Filters.equal(filters) {
		return errors.New("cursor filter mismatch")
	}
	return nil
}
