package review

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/secrets"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const (
	MaxReviewBody         = 3 << 20
	maxReviewInputTokens  = int64(400_000)
	maxReviewOutputTokens = int64(8_000)
	reviewWallTime        = 120 * time.Second
	defaultAttemptTimeout = 60 * time.Second
)

type BuildModel struct {
	ID   string `json:"id"`
	Role string `json:"role,omitempty"`
}
type BriefRef struct {
	Path        string `json:"path"`
	ContentHash string `json:"content_hash,omitempty"`
}
type Trial struct {
	ManifestHash string `json:"manifest_hash"`
	CaseID       string `json:"case_id"`
	Effort       string `json:"effort"`
}

// Request is the REST body. Capture bytes are supplied by the caller; all
// prompt, policy, cost and persistence decisions remain server-side.
type Request struct {
	Capture         Capture      `json:"capture"`
	Kind            string       `json:"kind"`
	Plan            string       `json:"plan,omitempty"`
	ContentHash     string       `json:"content_hash,omitempty"`
	Phase           int          `json:"phase,omitempty"`
	PR              int          `json:"pr,omitempty"`
	Brief           *BriefRef    `json:"brief,omitempty"`
	CriteriaText    []string     `json:"criteria_text,omitempty"`
	AllowSuperseded bool         `json:"allow_superseded,omitempty"`
	BuildModels     []BuildModel `json:"build_models"`
	RepoID          string       `json:"repo_id,omitempty"`
	SessionID       string       `json:"session_id,omitempty"`
	Detail          string       `json:"detail,omitempty"`
	DryRun          bool         `json:"dry_run,omitempty"`
	Trial           *Trial       `json:"trial,omitempty"`
	Effort          string       `json:"effort,omitempty"`
	Tags            []string     `json:"tags,omitempty"`
	Store           *bool        `json:"store,omitempty"`
}

// UnmarshalJSON keeps omitted, null and wrong-typed call controls distinct.
// Omitted effort/tags/store retain their documented defaults; explicit null is
// an argument error. Programmatic requests leave Effort empty and Store nil.
func (r *Request) UnmarshalJSON(data []byte) error {
	type requestAlias Request
	var decoded requestAlias
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&decoded); err != nil {
		return err
	}
	*r = Request(decoded)
	var raw struct {
		Effort json.RawMessage `json:"effort"`
		Tags   json.RawMessage `json:"tags"`
		Store  json.RawMessage `json:"store"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	effort, err := decodeEffortField(raw.Effort)
	if err != nil {
		return err
	}
	r.Effort = effort
	tags, err := decodeTagsField(raw.Tags)
	if err != nil {
		return err
	}
	r.Tags = tags
	store, err := decodeStoreField(raw.Store)
	if err != nil {
		return err
	}
	r.Store = store
	return nil
}

func decodeEffortField(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	if string(raw) == "null" {
		return "", errors.New("effort must be high, xhigh or max")
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", errors.New("effort must be a string")
	}
	if !validEffort(s) {
		return "", errors.New("effort must be high, xhigh or max")
	}
	return s, nil
}

func decodeTagsField(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if string(raw) == "null" {
		return nil, errors.New("tags must be an array of strings")
	}
	var tags []string
	if err := json.Unmarshal(raw, &tags); err != nil {
		return nil, errors.New("tags must be an array of strings")
	}
	return tags, nil
}

func decodeStoreField(raw json.RawMessage) (*bool, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if string(raw) == "null" {
		return nil, errors.New("store must be a boolean")
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, errors.New("store must be a boolean")
	}
	return &b, nil
}

type Attempt struct {
	Number       int     `json:"number"`
	Status       string  `json:"status"`
	InputTokens  int     `json:"input_tokens,omitempty"`
	OutputTokens int     `json:"output_tokens,omitempty"`
	LatencyMS    int64   `json:"latency_ms"`
	CostUSD      float64 `json:"cost_usd"`
	PricingTier  string  `json:"pricing_tier,omitempty"`
}

type Receipt struct {
	ID            string          `json:"id,omitempty"`
	Status        string          `json:"status"`
	Reason        string          `json:"reason,omitempty"`
	CaptureID     string          `json:"capture_id,omitempty"`
	FindingCounts map[string]int  `json:"finding_counts,omitempty"`
	Coverage      Coverage        `json:"coverage,omitempty"`
	CostUSD       float64         `json:"cost_usd,omitempty"`
	EstimatedUSD  float64         `json:"estimated_usd,omitempty"`
	Manifest      []ManifestEntry `json:"manifest,omitempty"`
	Ignored       []string        `json:"ignored,omitempty"`
	Result        *Result         `json:"result,omitempty"`
}

type RunConfig struct {
	Availability   Availability
	Reservations   *Reservations
	Endpoint       string
	Now            func() time.Time
	AttemptTimeout time.Duration
}

// Run composes the landed criteria, packet, provider, pricing and persistence
// APIs. It records one fact after all argument/capture validation succeeds.
func Run(ctx context.Context, tenant *store.Tenant, tenantID string, req Request, cfg RunConfig) (Receipt, error) {
	if err := validateRequest(req); err != nil {
		return Receipt{}, err
	}
	if tenant == nil {
		return Receipt{}, errors.New("tenant unavailable")
	}
	repo := req.Capture.RepoID
	if repo == "" {
		repo = req.RepoID
	}
	if repo == "" {
		return Receipt{}, errors.New("repo_id required")
	}
	if req.RepoID != "" && req.Capture.RepoID != "" && req.RepoID != req.Capture.RepoID {
		return Receipt{}, errors.New("wrong_checkout")
	}
	if req.Capture.RepoID == "" {
		req.Capture.RepoID = repo
	}
	if len(secrets.Scan(repo)) > 0 || len(secrets.Scan(req.Plan)) > 0 || (req.Brief != nil && len(secrets.Scan(req.Brief.Path)) > 0) {
		return Receipt{}, errors.New("review identity arguments invalid")
	}
	if req.Kind != "phase" && req.Kind != "pr" && req.Kind != "adhoc" {
		return Receipt{}, errors.New("kind must be phase, pr or adhoc")
	}
	if (req.Kind == "phase" && (req.Plan == "" || req.Phase < 1)) || (req.Kind == "pr" && req.PR < 1) {
		return Receipt{}, errors.New("review kind identity is incomplete")
	}
	// MCP advertises detail=receipt for the summary shape. Empty means the same thing.
	if req.Detail == "receipt" {
		req.Detail = ""
	}
	if req.Detail != "" && req.Detail != "full" {
		return Receipt{}, errors.New("detail must be full")
	}
	controls, err := resolveCallControls(req, cfg.Availability.Effort)
	if err != nil {
		return Receipt{}, err
	}

	phaseText := ""
	if req.Phase > 0 {
		phaseText = strconv.Itoa(req.Phase)
	}
	cr := CriteriaRequest{RepoID: repo, Plan: req.Plan, Phase: phaseText, ContentHash: req.ContentHash, AllowSuperseded: req.AllowSuperseded, CriteriaText: req.CriteriaText}
	if req.Brief != nil {
		cr.BriefPath, cr.ContentHash = req.Brief.Path, req.Brief.ContentHash
	}
	var resolved CriteriaResolution
	var criteriaErr error
	if req.Kind == "pr" && req.Plan != "" && req.Brief == nil {
		resolved, criteriaErr = resolvePRCriteria(ctx, tenant, repo, req.Plan, req.ContentHash, req.AllowSuperseded)
		if len(req.CriteriaText) > 0 {
			resolved.Record.Ignored = "criteria_text"
		}
	} else {
		resolved, criteriaErr = ResolveCriteria(ctx, tenant, cr)
	}
	if criteriaErr != nil {
		resolved = CriteriaResolution{Record: CriteriaRecord{Source: "store", RepoID: repo}}
	}
	packet, buildErr := Build(Input{Capture: req.Capture, Criteria: resolved.Criteria, CriteriaText: resolved.CriteriaText})
	if buildErr != nil {
		var re *Error
		if !errors.As(buildErr, &re) {
			return Receipt{}, errors.New("capture invalid")
		}
		if re.Code == "bad_capture" {
			return Receipt{}, buildErr
		}
		packet.CaptureID = keys.ContentHash([]byte(req.Capture.RepoID + "\n" + req.Capture.Mode + "\n" + req.Capture.View + "\n" + req.Capture.DiffSHA256))
		if req.DryRun {
			return Receipt{Status: re.Code}, nil
		}
		if !controls.store {
			return Receipt{Status: re.Code, Reason: re.Pattern, CaptureID: packet.CaptureID, Manifest: packet.Manifest}, nil
		}
		return persistRefusal(ctx, tenant, tenantID, req, repo, re.Code, re.Pattern, resolved.Record, packet, "", cfg, controls)
	}
	if criteriaErr != nil {
		var ce *CriteriaError
		errors.As(criteriaErr, &ce)
		if req.DryRun {
			return Receipt{Status: "refused_criteria", Reason: ce.Code, CaptureID: packet.CaptureID, Manifest: packet.Manifest}, nil
		}
		if !controls.store {
			return Receipt{Status: "refused_criteria", Reason: ce.Code, CaptureID: packet.CaptureID, Manifest: packet.Manifest}, nil
		}
		return persistRefusal(ctx, tenant, tenantID, req, repo, "refused_criteria", ce.Code, resolved.Record, packet, "", cfg, controls)
	}
	if req.DryRun {
		est, _ := store.ReservationCost(cfg.Availability.Model, maxReviewInputTokens, maxReviewOutputTokens, true)
		return Receipt{Status: "dry_run", CaptureID: packet.CaptureID, Coverage: packet.Coverage, Manifest: packet.Manifest, EstimatedUSD: est}, nil
	}

	status, reason := "", ""
	if err := CheckAvailability(cfg.Availability, tenantID, repo, controls.effective); err != nil {
		status, reason = "unavailable", safeReason(err)
	}
	if status == "" {
		if id, ok := store.ReservationCost(cfg.Availability.Model, maxReviewInputTokens, maxReviewOutputTokens, true); !ok || id < 0 {
			status, reason = "unavailable", "priced model required"
		}
	}
	inputHash := ""
	key := ""
	if controls.store {
		inputBytes := packetInput(packet)
		inputHash = keys.ContentHash(inputBytes)
		if err := tenant.WriteReviewInput(inputHash, inputBytes); err != nil {
			return Receipt{}, errors.New("review input persistence failed")
		}
		key = executionKey(req, tenantID, repo, packet, resolved.Record, cfg.Availability.Model, controls.effective, controls.profile, controls.tags)
	}
	id := makeID()
	if controls.store {
		if first, err := persistedClaim(ctx, tenant, repo, key); err != nil {
			status, reason = "unavailable", "review record lookup failed"
		} else if first != "" {
			status, reason = "skipped_duplicate", first
		}
	}
	spendKey := key
	if !controls.store {
		spendKey = id
	}
	if status == "" {
		if cfg.Reservations == nil {
			cfg.Reservations = NewReservations(cfg.Availability.USDCap, 2)
		}
		reservation, ok := store.ReservationCost(cfg.Availability.Model, maxReviewInputTokens, maxReviewOutputTokens, true)
		if !ok {
			status, reason = "unavailable", "priced model required"
		} else if controls.store {
			if err := cfg.Reservations.begin(key, id, tenantID, reservation); err != nil {
				if first, dup := duplicateReview(err); dup {
					status, reason = "skipped_duplicate", first
				} else if errors.Is(err, ErrReservationState) {
					status, reason = "unavailable", "review reservation state unavailable"
				} else {
					status, reason = "skipped_budget", "spend cap or in-flight limit"
				}
			}
		} else if err := cfg.Reservations.beginEphemeral(spendKey, tenantID, reservation); err != nil {
			if errors.Is(err, ErrReservationState) {
				status, reason = "unavailable", "review reservation state unavailable"
			} else {
				status, reason = "skipped_budget", "spend cap or in-flight limit"
			}
		}
	}
	var result Result
	var attempts []Attempt
	if status == "" {
		defer cfg.Reservations.finish(tenantID)
		reviewer := NewReviewer(cfg.Availability.Token, cfg.Availability.Model, controls.effective, cfg.Endpoint)
		reviewCtx, cancelReview := context.WithTimeout(ctx, reviewWallTime)
		defer cancelReview()
		for n := 1; n <= 2; n++ {
			if n > 1 {
				if reviewCtx.Err() != nil {
					break
				}
				if !cfg.Reservations.reserveRetry(spendKey, tenantID, n, reservationAmount(cfg.Availability.Model)) {
					reason = "retry reservation exceeds spend cap"
					break
				}
			}
			at := time.Now()
			if cfg.Now != nil {
				at = cfg.Now()
			}
			timeout := cfg.AttemptTimeout
			if timeout <= 0 {
				timeout = defaultAttemptTimeout
			}
			callCtx, cancel := context.WithTimeout(reviewCtx, timeout)
			res, err := reviewer.Review(callCtx, packet, resolved.Criteria)
			cancel()
			lat := time.Since(at).Milliseconds()
			a := Attempt{Number: n, LatencyMS: lat}
			if err == nil {
				result = res
				if resolved.Record.Source == "none" {
					result.Limitations = append(result.Limitations, "No criteria were supplied for this review.")
				}
				a.InputTokens, a.OutputTokens = res.InputTokens, res.OutputTokens
				a.Status = "ok"
				inputSize := int64(res.InputTokens)
				if tier, yes := store.PricingTier(cfg.Availability.Model, inputSize, false); yes {
					a.PricingTier = tier
				}
				a.CostUSD, _ = store.CostAtInputSize("claude", cfg.Availability.Model, store.Tokens{In: int64(res.InputTokens), Out: int64(res.OutputTokens)}, inputSize, nil)
				cfg.Reservations.settle(spendKey, n, a.CostUSD)
				attempts = append(attempts, a)
				status = "ok"
				if packet.Coverage.State != "complete" || res.Coverage != "complete" {
					status = "ok_partial"
				}
				break
			}
			a.Status = errorStatus(err)
			a.CostUSD = reservationAmount(cfg.Availability.Model)
			if tier, ok := store.PricingTier(cfg.Availability.Model, maxReviewInputTokens, true); ok {
				a.PricingTier = tier
			}
			attempts = append(attempts, a)
			status = a.Status
			if status == "unavailable" && strings.Contains(err.Error(), "credential_rejected") {
				reason = "credential_rejected"
			}
			if status != "timeout" && status != "api_error" {
				break
			}
			if n == 2 {
				break
			}
		}
	}
	if status == "" {
		status = "api_error"
	}
	return persistRecord(ctx, tenant, tenantID, req, repo, id, status, reason, result, attempts, packet, resolved.Record, inputHash, cfg, controls, key, controls.store)
}

func validateRequest(r Request) error {
	if r.Capture.Diff == "" && r.Capture.DiffSHA256 == "" {
		return errors.New("capture required")
	}
	if r.Capture.Mode != "uncommitted" && r.Capture.Mode != "range" {
		return errors.New("mode must be uncommitted or range")
	}
	if r.Capture.Mode == "range" && (r.Capture.Base == "" || r.Capture.Head == "") {
		return errors.New("range base and head required")
	}
	if r.Capture.Mode == "range" && (!validSHA(r.Capture.Base) || !validSHA(r.Capture.Head) || (r.Capture.MergeBase && !validSHA(r.Capture.MergeBaseSHA))) {
		return errors.New("range refs must be resolved commit shas")
	}
	if r.Capture.Mode == "uncommitted" && !validSHA(r.Capture.Head) {
		return errors.New("uncommitted capture requires HEAD sha")
	}
	if r.Capture.Mode == "uncommitted" && r.Capture.View != "combined" && r.Capture.View != "staged" {
		return errors.New("uncommitted view must be combined or staged")
	}
	if r.Capture.Mode == "range" && r.Capture.View != "combined" {
		return errors.New("range view must be combined")
	}
	if r.Kind == "phase" && r.Phase < 1 {
		return errors.New("phase must be positive")
	}
	if r.Kind == "pr" && r.Plan == "" && r.Brief == nil && len(r.CriteriaText) == 0 {
		return errors.New("pr review requires a plan, brief or explicit criteria")
	}
	return nil
}
func validSHA(s string) bool {
	if len(s) != 40 && len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
func validHash(s string) bool { return len(s) == 64 && validSHA(s) }

func resolvePRCriteria(ctx context.Context, t *store.Tenant, repo, plan, contentHash string, allowSuperseded bool) (CriteriaResolution, error) {
	paths, err := t.PlanDesignPaths(ctx, repo, 1000)
	if err != nil {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	var matches []string
	for _, p := range paths {
		folder := path.Base(path.Dir(p))
		if folder == plan || barePlanSlug(folder) == plan {
			matches = append(matches, p)
		}
	}
	if len(matches) == 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_not_found")
	}
	if len(matches) > 1 {
		return CriteriaResolution{}, criteriaRefusal("criteria_ambiguous")
	}
	versions, err := t.ArtifactVersions(ctx, repo, matches[0])
	if err != nil || len(versions) == 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	var design *store.ArtifactVersion
	for i := range versions {
		if contentHash != "" && versions[i].ContentHash == contentHash {
			design = &versions[i]
			break
		}
		if contentHash == "" && versions[i].Rejection == nil {
			design = &versions[i]
			break
		}
	}
	if design == nil || len(design.Body) == 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	var phases []string
	for _, line := range strings.Split(string(design.Body), "\n") {
		if m := phaseHeading.FindStringSubmatch(line); len(m) == 2 {
			phases = append(phases, m[1])
		}
	}
	if len(phases) == 0 {
		return CriteriaResolution{}, criteriaRefusal("phase_not_found")
	}
	var all []Criterion
	var record CriteriaRecord
	for i, phase := range phases {
		part, e := ResolveCriteria(ctx, t, CriteriaRequest{RepoID: repo, Plan: plan, Phase: phase, ContentHash: contentHash, AllowSuperseded: allowSuperseded})
		if e != nil {
			return CriteriaResolution{}, e
		}
		if i == 0 {
			record = part.Record
		}
		for _, c := range part.Criteria {
			if c.ID == "O1" {
				all = append(all, Criterion{ID: "O" + phase, Text: "Phase " + phase + " outcome:\n" + c.Text})
			}
		}
	}
	if len(all) == 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	return CriteriaResolution{Criteria: all, Record: record}, nil
}
func validEffort(s string) bool { return s == "high" || s == "xhigh" || s == "max" }

const maxReviewTags = 16

var reviewTagRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/=-]{0,95}$`)

func validReviewTag(tag string) bool {
	return reviewTagRE.MatchString(tag) && len(secrets.Scan(tag)) == 0
}

func canonicalTags(tags []string) []string {
	seen := make(map[string]bool, len(tags))
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		if seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	sort.Strings(out)
	return out
}

func caseTag(caseID string) string {
	h := sha256.Sum256([]byte(caseID))
	return "case:" + hex.EncodeToString(h[:])
}

// callControls is the resolved, validated per-call control set. It is computed
// from caller input and server configuration before any effect.
type callControls struct {
	configured, requested, effective string
	profile                          string
	tags                             []string
	store                            bool
	legacy                           bool
}

func resolveCallControls(r Request, availabilityEffort string) (callControls, error) {
	submitted := r.Tags
	if len(submitted) > maxReviewTags {
		return callControls{}, errors.New("tags must contain at most 16 entries")
	}
	for _, tag := range submitted {
		if !validReviewTag(tag) {
			return callControls{}, errors.New("invalid review tag")
		}
	}
	requested := r.Effort
	profile := "shadow"
	canonical := canonicalTags(submitted)
	legacy := r.Trial != nil
	if legacy {
		if r.Capture.Mode != "range" {
			return callControls{}, errors.New("trial requires range mode")
		}
		if !validHash(r.Trial.ManifestHash) || r.Trial.CaseID == "" || len(secrets.Scan(r.Trial.CaseID)) > 0 {
			return callControls{}, errors.New("invalid trial arguments")
		}
		if !validEffort(r.Trial.Effort) {
			return callControls{}, errors.New("invalid trial arguments")
		}
		if requested != "" && requested != r.Trial.Effort {
			return callControls{}, errors.New("conflicting effort")
		}
		requested = r.Trial.Effort
		profile = "historical_trial"
		merged := append(append([]string{}, canonical...), "effort:"+r.Trial.Effort, "manifest:"+r.Trial.ManifestHash, caseTag(r.Trial.CaseID))
		canonical = canonicalTags(merged)
		if len(canonical) > maxReviewTags {
			return callControls{}, errors.New("tags must contain at most 16 entries")
		}
	}
	if requested == "" {
		requested = "high"
	}
	if !validEffort(requested) {
		return callControls{}, errors.New("effort must be high, xhigh or max")
	}
	configured := availabilityEffort
	if configured == "" {
		configured = "high"
	}
	store := r.Store == nil || *r.Store
	return callControls{configured: configured, requested: requested, effective: requested, profile: profile, tags: canonical, store: store, legacy: legacy}, nil
}
func safeReason(err error) string {
	var a *AvailabilityError
	if errors.As(err, &a) {
		return a.Setting
	}
	return "configuration unavailable"
}
func errorStatus(err error) string {
	var p *ProviderError
	if errors.As(err, &p) {
		return string(p.Status)
	}
	if strings.Contains(err.Error(), "credential_rejected") {
		return "unavailable"
	}
	return "api_error"
}
func reservationAmount(model string) float64 {
	n, _ := store.ReservationCost(model, maxReviewInputTokens, maxReviewOutputTokens, true)
	return n
}
func packetInput(p Packet) []byte {
	s := string(p.Prompt)
	const marker = "UNTRUSTED CONTEXT\n"
	i := strings.Index(s, marker)
	if i >= 0 {
		s = s[i+len(marker):]
		if j := strings.Index(s, "\n<<<YAKKA_UNTRUSTED_"); j >= 0 {
			s = s[:j]
		}
	}
	return []byte(s)
}

// executionKey derives cache identity. An empty canonical tag set keeps the
// exact pre-upgrade serialization so untagged paid work stays cached. Any tags
// use a distinct versioned serialization that includes the canonical set.
func executionKey(r Request, tenant, repo string, p Packet, c CriteriaRecord, model, effort, profile string, tags []string) string {
	if len(tags) == 0 {
		return legacyExecutionKey(r, tenant, repo, p, c, model, effort, profile)
	}
	b, _ := json.Marshal(struct {
		Version, Tenant, Repo, Kind, Plan, Capture, Criteria, Build, Model, Effort, Profile, Manifest, Case, Policy, Tags string
		Phase                                                                                                             int
	}{"review-execution-tags-v1", tenant, repo, r.Kind, r.Plan, p.CaptureID, c.ContentHash, fmt.Sprint(r.BuildModels), model, effort, profile, trialManifest(r.Trial), trialCase(r.Trial), p.PromptPolicyVersion, strings.Join(tags, "\n"), r.Phase})
	return keys.ContentHash(b)
}

func legacyExecutionKey(r Request, tenant, repo string, p Packet, c CriteriaRecord, model, effort, profile string) string {
	b, _ := json.Marshal(struct {
		Tenant, Repo, Kind, Plan, Capture, Criteria, Build, Model, Effort, Profile, Manifest, Case, Policy string
		Phase                                                                                              int
	}{tenant, repo, r.Kind, r.Plan, p.CaptureID, c.ContentHash, fmt.Sprint(r.BuildModels), model, effort, profile, trialManifest(r.Trial), trialCase(r.Trial), p.PromptPolicyVersion, r.Phase})
	return keys.ContentHash(b)
}

// PreUpgradeExecutionKey recomputes the exact pre-tag execution key. It exists
// for the restricted legacy-adapter claim fallback; new requests never use it.
func PreUpgradeExecutionKey(r Request, tenant, repo string, p Packet, c CriteriaRecord, model, effort, profile string) string {
	return legacyExecutionKey(r, tenant, repo, p, c, model, effort, profile)
}
func persistedClaim(ctx context.Context, t *store.Tenant, repo, key string) (string, error) {
	rows, err := t.ReviewRecords(ctx, store.ReviewRecordFilter{RepoID: repo, Limit: 500})
	if err != nil {
		return "", err
	}
	for _, row := range rows {
		var m struct {
			Key      string            `json:"key"`
			ID       string            `json:"id"`
			Attempts []json.RawMessage `json:"attempts"`
		}
		if json.Unmarshal(row.Raw, &m) == nil && m.Key == key && len(m.Attempts) > 0 {
			return m.ID, nil
		}
	}
	return "", nil
}
func trialManifest(t *Trial) string {
	if t == nil {
		return ""
	}
	return t.ManifestHash
}
func trialCase(t *Trial) string {
	if t == nil {
		return ""
	}
	return t.CaseID
}
func makeID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("review-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func persistRefusal(ctx context.Context, t *store.Tenant, tenant string, r Request, repo, status, reason string, c CriteriaRecord, p Packet, inputHash string, cfg RunConfig, ctl callControls) (Receipt, error) {
	if status == "refused_criteria" && inputHash == "" {
		data := packetInput(p)
		inputHash = keys.ContentHash(data)
		if err := t.WriteReviewInput(inputHash, data); err != nil {
			return Receipt{}, errors.New("review input persistence failed")
		}
	}
	return persistRecord(ctx, t, tenant, r, repo, makeID(), status, reason, Result{}, nil, p, c, inputHash, cfg, ctl, "refusal", true)
}

func persistRecord(ctx context.Context, t *store.Tenant, tenant string, r Request, repo, id, status, reason string, result Result, attempts []Attempt, p Packet, c CriteriaRecord, inputHash string, cfg RunConfig, ctl callControls, key string, write bool) (Receipt, error) {
	findings := map[string]int{}
	for _, f := range result.Findings {
		findings[f.Severity]++
	}
	out := Receipt{Status: status, Reason: reason, CaptureID: p.CaptureID, FindingCounts: findings, Coverage: p.Coverage}
	if c.Ignored != "" {
		out.Ignored = []string{c.Ignored}
	}
	for _, a := range attempts {
		out.CostUSD += a.CostUSD
	}
	if r.Detail == "full" || (!write && (status == "ok" || status == "ok_partial")) {
		out.Result = &result
	}
	if !write {
		return out, nil
	}
	out.ID = id
	now := time.Now()
	if cfg.Now != nil {
		now = cfg.Now()
	}
	conv := "review:" + p.CaptureID[:min(12, len(p.CaptureID))]
	model := cfg.Availability.Model
	tags := ctl.tags
	if tags == nil {
		tags = []string{}
	}
	rec := map[string]any{"id": id, "type": "review_run", "repo_id": repo, "kind": r.Kind, "plan": r.Plan, "phase": r.Phase, "pr": r.PR, "capture_id": p.CaptureID, "input_hash": inputHash, "criteria": c, "configured_model": model, "returned_model": result.Model, "configured_effort": ctl.configured, "requested_effort": ctl.requested, "effective_effort": ctl.effective, "profile": ctl.profile, "tags": tags, "prompt_policy_version": p.PromptPolicyVersion, "exclusion_policy_version": p.ExclusionPolicyVersion, "status": status, "attempts": attempts, "payload": result, "build_models": r.BuildModels, "session_binding": "unbound", "session_binding_reason": "Plan 22 session resolver is unavailable", "conversation_id": conv, "coverage": p.Coverage, "manifest": p.Manifest, "key": key, "ts": float64(now.Unix())}
	if r.Capture.Mode == "range" {
		rec["base_sha"] = r.Capture.Base
		rec["head_sha"] = r.Capture.Head
	} else {
		rec["head_sha"] = r.Capture.Head
		rec["view"] = r.Capture.View
	}
	if r.Trial != nil {
		rec["manifest_hash"] = r.Trial.ManifestHash
		rec["case_id"] = r.Trial.CaseID
	}
	if p.CaptureID != "" {
		rec["capture_id"] = p.CaptureID
	}
	if result.Model != "" {
		rec["returned_model"] = result.Model
		rec["model_mismatch"] = result.Model != model
	}
	if len(attempts) > 0 {
		var cost float64
		for _, a := range attempts {
			cost += a.CostUSD
		}
		rec["cost_usd"] = cost
		rec["pricing_table_id"] = store.PricingTableID()
		rec["input_tokens"] = result.InputTokens
		rec["output_tokens"] = result.OutputTokens
	}
	if reason != "" {
		rec["reason"] = reason
	}
	b, _ := json.Marshal(rec)
	raw := json.RawMessage(b)
	facts, err := ingest.IngestReviewRuns(ctx, t, []json.RawMessage{raw})
	if err != nil {
		return Receipt{}, errors.New("review record persistence failed")
	}
	if len(facts) != 1 || facts[0].Status != ingest.Accepted {
		return Receipt{}, fmt.Errorf("review record rejected: %s", facts[0].Reason)
	}
	return out, nil
}
