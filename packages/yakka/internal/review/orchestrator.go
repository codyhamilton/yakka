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
	"sync"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/secrets"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const (
	MaxReviewBody = 3 << 20
	// StatusPending and StatusRunning are the in-flight statuses of an asynchronous
	// stored review. A POST that accepts work returns one of them with the review id;
	// clients poll GET /v1/reviews/{id} until the attempt reaches a terminal status.
	StatusPending = "pending"
	StatusRunning = "running"
	// AttemptTimeout bounds one provider attempt. It was raised from 60s
	// after seven high-effort reviews timed out at exactly 60s. Tune it again
	// once high/xhigh/max wall times have been measured.
	AttemptTimeout = 10 * time.Minute
	// AttemptTimeoutHeadroom lets the HTTP transport and outer MCP call finish
	// response handling after the provider attempt deadline.
	AttemptTimeoutHeadroom = 30 * time.Second
	defaultAttemptTimeout  = AttemptTimeout
	// reviewWallTime covers both allowed attempts plus a little overhead so a
	// single 10-minute attempt is never cut short by the outer deadline.
	reviewWallTime = 2*defaultAttemptTimeout + 30*time.Second
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
	CostUSD      float64 `json:"cost_usd,omitempty"`
	CostKnown    bool    `json:"cost_known"`
	PricingTier  string  `json:"pricing_tier,omitempty"`
}

type Receipt struct {
	ID                 string          `json:"id,omitempty"`
	Status             string          `json:"status"`
	Reason             string          `json:"reason,omitempty"`
	InputTokenEstimate int             `json:"input_token_estimate,omitempty"`
	InputTrimmed       bool            `json:"input_trimmed,omitempty"`
	CaptureID          string          `json:"capture_id,omitempty"`
	FindingCounts      map[string]int  `json:"finding_counts,omitempty"`
	Coverage           Coverage        `json:"coverage,omitempty"`
	CostUSD            float64         `json:"cost_usd,omitempty"`
	Manifest           []ManifestEntry `json:"manifest,omitempty"`
	Ignored            []string        `json:"ignored,omitempty"`
	Result             *Result         `json:"result,omitempty"`
	Cached             *bool           `json:"cached,omitempty"`
	OriginalReviewID   string          `json:"original_review_id,omitempty"`
	OriginalStatus     string          `json:"original_status,omitempty"`
	Model              string          `json:"model,omitempty"`
	Effort             string          `json:"effort,omitempty"`
	Tags               []string        `json:"tags,omitempty"`
	Attempts           []Attempt       `json:"attempts,omitempty"`
}

func boolPtr(b bool) *bool { return &b }

type RunConfig struct {
	Availability   Availability
	Reservations   *Reservations
	Endpoint       string
	Now            func() time.Time
	AttemptTimeout time.Duration
	// Lifetime anchors a detached stored attempt started by Start. It is the
	// server/process lifetime, never a request context, so a client disconnect
	// cannot cancel the provider call. Run ignores it.
	Lifetime context.Context
	// OnFinish, when set, runs exactly once after a detached attempt has
	// persisted its final row and released its reservation. It must not block.
	OnFinish func()
}

// Job is one detached stored review attempt. Wait reports the current receipt and
// whether the attempt has reached a terminal status.
type Job struct {
	ID   string
	done chan struct{}

	mu      sync.Mutex
	receipt Receipt
	err     error
}

// Done is closed when the detached attempt has finished persisting its final row.
func (j *Job) Done() <-chan struct{} { return j.done }

// Wait blocks until the attempt is terminal or ctx ends. The returned bool reports
// whether it is terminal. Ending ctx never cancels the detached work.
func (j *Job) Wait(ctx context.Context) (Receipt, bool) {
	select {
	case <-j.done:
	case <-ctx.Done():
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	select {
	case <-j.done:
		return j.receipt, true
	default:
		return j.receipt, false
	}
}

// Snapshot returns the latest known receipt without blocking.
func (j *Job) Snapshot() Receipt {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.receipt
}

// prepared is a stored review whose synchronous decisions have already succeeded and
// whose provider attempt is ready to run. A non-nil release owns an in-flight slot.
type prepared struct {
	tenant      *store.Tenant
	req         Request
	tenantID    string
	repo        string
	id          string
	controls    callControls
	criteria    []Criterion
	criteriaRec CriteriaRecord
	packet      Packet
	inputHash   string
	key         string
	release     func()
	detachable  bool
}

func (p *prepared) releaseReservation() {
	if p.release != nil {
		p.release()
		p.release = nil
	}
}

// Run composes the landed criteria, packet, provider, pricing and persistence
// APIs synchronously. It records one fact after all argument/capture validation
// succeeds and waits for the provider attempt before returning.
func Run(ctx context.Context, tenant *store.Tenant, tenantID string, req Request, cfg RunConfig) (Receipt, error) {
	p, out, err := begin(ctx, tenant, tenantID, req, cfg, false)
	if err != nil || p == nil {
		return out, err
	}
	return p.finish(ctx, cfg)
}

// Start applies the synchronous review decisions and, when a stored provider attempt
// is accepted, persists an in-flight row and runs the attempt on cfg.Lifetime. It
// returns either a terminal receipt (refusal, cache hit, duplicate, dry run,
// store=false, unavailable) with a nil job, or an in-flight receipt plus the job.
// A returned job's work is never cancelled by ctx ending.
func Start(ctx context.Context, tenant *store.Tenant, tenantID string, req Request, cfg RunConfig) (*Job, Receipt, error) {
	p, out, err := begin(ctx, tenant, tenantID, req, cfg, true)
	if err != nil || p == nil {
		if out.Status == "in_progress" && out.OriginalReviewID != "" {
			out.ID = out.OriginalReviewID
			out.Status = StatusRunning
		}
		return nil, out, err
	}
	if !p.detachable {
		receipt, ferr := p.finish(ctx, cfg)
		return nil, receipt, ferr
	}
	lifetime := cfg.Lifetime
	if lifetime == nil {
		lifetime = context.Background()
	}
	initial := Receipt{ID: p.id, Status: StatusRunning, Cached: boolPtr(false)}
	job := &Job{ID: p.id, done: make(chan struct{}), receipt: initial}
	go func() {
		receipt, ferr := p.finishDetached(lifetime, cfg)
		job.mu.Lock()
		job.receipt, job.err = receipt, ferr
		job.mu.Unlock()
		if cfg.OnFinish != nil {
			cfg.OnFinish()
		}
		close(job.done)
	}()
	return job, initial, nil
}

func begin(ctx context.Context, tenant *store.Tenant, tenantID string, req Request, cfg RunConfig, async bool) (*prepared, Receipt, error) {
	if err := validateRequest(req); err != nil {
		return nil, Receipt{}, err
	}
	if tenant == nil {
		return nil, Receipt{}, errors.New("tenant unavailable")
	}
	repo := req.Capture.RepoID
	if repo == "" {
		repo = req.RepoID
	}
	if repo == "" {
		return nil, Receipt{}, errors.New("repo_id required")
	}
	if req.RepoID != "" && req.Capture.RepoID != "" && req.RepoID != req.Capture.RepoID {
		return nil, Receipt{}, errors.New("wrong_checkout")
	}
	if req.Capture.RepoID == "" {
		req.Capture.RepoID = repo
	}
	if len(secrets.Scan(repo)) > 0 || len(secrets.Scan(req.Plan)) > 0 || (req.Brief != nil && len(secrets.Scan(req.Brief.Path)) > 0) {
		return nil, Receipt{}, errors.New("review identity arguments invalid")
	}
	if len(req.BuildModels) == 0 {
		return nil, Receipt{}, errors.New("build_models required")
	}
	for _, m := range req.BuildModels {
		if strings.TrimSpace(m.ID) == "" || len(secrets.Scan(m.ID+"\n"+m.Role)) > 0 {
			return nil, Receipt{}, errors.New("build_models entries require id")
		}
	}
	if req.Kind != "phase" && req.Kind != "pr" && req.Kind != "adhoc" {
		return nil, Receipt{}, errors.New("kind must be phase, pr or adhoc")
	}
	if (req.Kind == "phase" && (req.Plan == "" || req.Phase < 1)) || (req.Kind == "pr" && req.PR < 1) {
		return nil, Receipt{}, errors.New("review kind identity is incomplete")
	}
	// MCP advertises detail=receipt for the summary shape. Empty means the same thing.
	if req.Detail == "receipt" {
		req.Detail = ""
	}
	if req.Detail != "" && req.Detail != "full" {
		return nil, Receipt{}, errors.New("detail must be full")
	}
	controls, err := resolveCallControls(req)
	if err != nil {
		return nil, Receipt{}, err
	}
	model := cfg.Availability.EffectiveModel()
	if req.DryRun {
		if err := CheckAvailability(cfg.Availability, controls.effective); err != nil {
			return nil, Receipt{Status: "unavailable", Reason: safeReason(err)}, nil
		}
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
			return nil, Receipt{}, errors.New("capture invalid")
		}
		if re.Code == "bad_capture" {
			return nil, Receipt{}, buildErr
		}
		packet.CaptureID = keys.ContentHash([]byte(req.Capture.RepoID + "\n" + req.Capture.Mode + "\n" + req.Capture.View + "\n" + req.Capture.DiffSHA256))
		if req.DryRun {
			return nil, Receipt{Status: re.Code}, nil
		}
		if !controls.store {
			return nil, Receipt{Status: re.Code, Reason: re.Pattern, CaptureID: packet.CaptureID, Manifest: packet.Manifest}, nil
		}
		receipt, err := persistRefusal(ctx, tenant, tenantID, req, repo, re.Code, re.Pattern, resolved.Record, packet, "", cfg, controls)
		return nil, receipt, err
	}
	if criteriaErr != nil {
		var ce *CriteriaError
		errors.As(criteriaErr, &ce)
		if req.DryRun {
			return nil, Receipt{Status: "refused_criteria", Reason: ce.Code, CaptureID: packet.CaptureID, Manifest: packet.Manifest}, nil
		}
		if !controls.store {
			return nil, Receipt{Status: "refused_criteria", Reason: ce.Code, CaptureID: packet.CaptureID, Manifest: packet.Manifest}, nil
		}
		receipt, err := persistRefusal(ctx, tenant, tenantID, req, repo, "refused_criteria", ce.Code, resolved.Record, packet, "", cfg, controls)
		return nil, receipt, err
	}
	if req.DryRun {
		return nil, Receipt{Status: "dry_run", CaptureID: packet.CaptureID, Coverage: packet.Coverage, Manifest: packet.Manifest}, nil
	}

	status, reason := "", ""
	if err := CheckAvailability(cfg.Availability, controls.effective); err != nil {
		status, reason = "unavailable", safeReason(err)
	}
	inputHash := ""
	key := ""
	if controls.store {
		inputBytes := packetInput(packet)
		inputHash = keys.ContentHash(inputBytes)
		if err := tenant.WriteReviewInput(inputHash, inputBytes); err != nil {
			return nil, Receipt{}, errors.New("review input persistence failed")
		}
		key = executionKey(req, tenantID, repo, packet, resolved.Record, model, controls.effective, controls.profile, controls.tags)
	}
	id := makeID()
	var release func()
	if controls.store {
		hitRow, found, lookupErr := tenant.ReviewByExecutionKey(ctx, repo, key)
		if lookupErr != nil {
			status, reason = "unavailable", "review record lookup failed"
		} else if found {
			if inflight, ok := inFlightReceipt(hitRow); ok {
				return nil, inflight, nil
			}
			cached, usable := cachedReceipt(hitRow)
			if !usable {
				return nil, cached, nil
			}
			if _, err := persistRecord(ctx, tenant, tenantID, req, repo, makeID(), "skipped_duplicate", cached.OriginalReviewID, Result{}, nil, packet, resolved.Record, inputHash, cfg, controls, key, true); err != nil {
				return nil, Receipt{}, err
			}
			return nil, cached, nil
		} else if controls.legacyFallback {
			legacyKey := PreUpgradeExecutionKey(req, tenantID, repo, packet, resolved.Record, model, controls.effective, controls.profile)
			if legacyKey != key {
				legacyRow, legacyFound, legacyErr := tenant.ReviewByExecutionKey(ctx, repo, legacyKey)
				if legacyErr != nil {
					status, reason = "unavailable", "review record lookup failed"
				} else if legacyFound && legacyIdentityMatches(legacyRow, req.Trial) {
					if inflight, ok := inFlightReceipt(legacyRow); ok {
						return nil, inflight, nil
					}
					cached, usable := cachedReceipt(legacyRow)
					if !usable {
						return nil, cached, nil
					}
					if _, err := persistRecord(ctx, tenant, tenantID, req, repo, makeID(), "skipped_duplicate", cached.OriginalReviewID, Result{}, nil, packet, resolved.Record, inputHash, cfg, controls, key, true); err != nil {
						return nil, Receipt{}, err
					}
					return nil, cached, nil
				}
			}
		}
	}
	if status == "" {
		if cfg.Reservations == nil {
			cfg.Reservations = NewReservations(2)
		}
		if controls.store {
			if err := cfg.Reservations.begin(key, id, tenantID); err != nil {
				if first, dup := duplicateReview(err); dup {
					originalID := first
					if row, found, lerr := tenant.ReviewByExecutionKey(ctx, repo, key); lerr == nil && found {
						if inflight, ok := inFlightReceipt(row); ok {
							return nil, inflight, nil
						}
					}
					if stateID, state := cfg.Reservations.claimState(key); state == claimActive && stateID != "" {
						return nil, Receipt{Status: "in_progress", Reason: originalID, Cached: boolPtr(false), OriginalReviewID: originalID}, nil
					}
					return nil, Receipt{Status: "outcome_unknown", Reason: originalID, Cached: boolPtr(false), OriginalReviewID: originalID}, nil
				} else if errors.Is(err, ErrClaimState) {
					status, reason = "unavailable", "review claim state unavailable"
				} else {
					status, reason = "skipped_busy", "tenant in-flight limit"
				}
			} else {
				release = func() { cfg.Reservations.finishClaim(key, tenantID) }
			}
		} else if err := cfg.Reservations.beginEphemeral(tenantID); err != nil {
			status, reason = "skipped_busy", "tenant in-flight limit"
		} else {
			release = func() { cfg.Reservations.finish(tenantID) }
		}
	}
	if status != "" {
		receipt, err := persistRecord(ctx, tenant, tenantID, req, repo, id, status, reason, Result{}, nil, packet, resolved.Record, inputHash, cfg, controls, key, controls.store)
		return nil, receipt, err
	}
	p := &prepared{tenant: tenant, req: req, tenantID: tenantID, repo: repo, id: id, controls: controls, criteria: resolved.Criteria, criteriaRec: resolved.Record, packet: packet, inputHash: inputHash, key: key, release: release}
	if async && controls.store {
		if _, err := persistRecord(ctx, tenant, tenantID, req, repo, id, StatusRunning, "", Result{}, nil, packet, resolved.Record, inputHash, cfg, controls, key, true); err != nil {
			p.releaseReservation()
			return nil, Receipt{}, err
		}
		p.detachable = true
	}
	return p, Receipt{}, nil
}

// inFlightReceipt recognises a persisted pending/running row so a repeated POST
// resolves to the existing review id without starting a second provider call.
func inFlightReceipt(row store.ReviewRecord) (Receipt, bool) {
	var rec storedReview
	if json.Unmarshal(row.Raw, &rec) != nil {
		return Receipt{}, false
	}
	if rec.Status != StatusPending && rec.Status != StatusRunning {
		return Receipt{}, false
	}
	id := rec.ID
	if id == "" {
		id = rec.LegacyID
	}
	return Receipt{ID: id, Status: rec.Status, Cached: boolPtr(false), OriginalReviewID: id, CaptureID: rec.CaptureID, Tags: rec.Tags, Model: rec.ReturnedModel, Effort: rec.EffectiveEffort, Attempts: rec.Attempts}, true
}

func (p *prepared) finish(ctx context.Context, cfg RunConfig) (Receipt, error) {
	defer p.releaseReservation()
	result, attempts, status, reason := p.attempt(ctx, cfg)
	return persistRecord(ctx, p.tenant, p.tenantID, p.req, p.repo, p.id, status, reason, result, attempts, p.packet, p.criteriaRec, p.inputHash, cfg, p.controls, p.key, p.controls.store)
}

func (p *prepared) finishDetached(ctx context.Context, cfg RunConfig) (Receipt, error) {
	defer p.releaseReservation()
	result, attempts, status, reason := p.attempt(ctx, cfg)
	receipt, err := finalizeRecord(ctx, p.tenant, p.tenantID, p.req, p.repo, p.id, status, reason, result, attempts, p.packet, p.criteriaRec, p.inputHash, cfg, p.controls, p.key)
	if err != nil {
		// Keep the in-flight identity visible rather than a zero receipt; the
		// persisted running row remains the polling answer.
		return Receipt{ID: p.id, Status: StatusRunning, Cached: boolPtr(false)}, err
	}
	return receipt, nil
}

func (p *prepared) attempt(ctx context.Context, cfg RunConfig) (Result, []Attempt, string, string) {
	var result Result
	var attempts []Attempt
	status, reason := "", ""
	model := cfg.Availability.EffectiveModel()
	reviewer := NewReviewer(cfg.Availability.Token, model, p.controls.effective, cfg.Endpoint)
	reviewCtx, cancelReview := context.WithTimeout(ctx, reviewWallTime)
	defer cancelReview()
	for n := 1; n <= 2; n++ {
		if n > 1 && reviewCtx.Err() != nil {
			break
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
		res, err := reviewer.Review(callCtx, p.packet, p.criteria)
		cancel()
		lat := time.Since(at).Milliseconds()
		a := Attempt{Number: n, LatencyMS: lat}
		if err == nil {
			result = res
			if p.criteriaRec.Source == "none" {
				result.Limitations = append(result.Limitations, "No criteria were supplied for this review.")
			}
			a.Status = "ok"
			applyReportedUsage(&a, model, res.InputTokens, res.OutputTokens)
			attempts = append(attempts, a)
			status = "ok"
			if p.packet.Coverage.State != "complete" || res.Coverage != "complete" {
				status = "ok_partial"
			}
			break
		}
		a.Status = errorStatus(err)
		var pe *ProviderError
		if errors.As(err, &pe) {
			if pe.UsageReported {
				applyReportedUsage(&a, model, pe.InputTokens, pe.OutputTokens)
			}
			if pe.Reason != "" {
				reason = pe.Reason
			}
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
	if status == "" {
		status = "api_error"
	}
	return result, attempts, status, reason
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
	// legacyFallback is true only for a pure legacy-adapter request: the merged
	// canonical tag set is exactly the three deterministic adapter tags.
	legacyFallback bool
}

func resolveCallControls(r Request) (callControls, error) {
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
	legacyFallback := false
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
		adapterTags := canonicalTags([]string{"effort:" + r.Trial.Effort, "manifest:" + r.Trial.ManifestHash, caseTag(r.Trial.CaseID)})
		merged := append(append([]string{}, canonical...), adapterTags...)
		canonical = canonicalTags(merged)
		if len(canonical) > maxReviewTags {
			return callControls{}, errors.New("tags must contain at most 16 entries")
		}
		legacyFallback = sameTags(canonical, adapterTags)
	}
	if requested == "" {
		requested = "high"
	}
	if !validEffort(requested) {
		return callControls{}, errors.New("effort must be high, xhigh or max")
	}
	configured := "high"
	store := r.Store == nil || *r.Store
	return callControls{configured: configured, requested: requested, effective: requested, profile: profile, tags: canonical, store: store, legacy: legacy, legacyFallback: legacyFallback}, nil
}

func sameTags(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
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

// storedReview is the subset of a stored review_run used to build a cache-hit
// receipt. Captured input is never part of it.
type storedReview struct {
	ID              string          `json:"review_id"`
	LegacyID        string          `json:"id"`
	Status          string          `json:"status"`
	CaptureID       string          `json:"capture_id"`
	ConfiguredModel string          `json:"configured_model"`
	ReturnedModel   string          `json:"returned_model"`
	EffectiveEffort string          `json:"effective_effort"`
	Tags            []string        `json:"tags"`
	Attempts        []Attempt       `json:"attempts"`
	Payload         json.RawMessage `json:"payload"`
	Coverage        Coverage        `json:"coverage"`
	Manifest        []ManifestEntry `json:"manifest"`
	CostUSD         float64         `json:"cost_usd"`
}

// cachedReceipt projects a completed stored original into the fresh response
// shape. The second return value is false when the original is unusable; the
// returned receipt then reports cache_unavailable and never a fabricated result.
func cachedReceipt(row store.ReviewRecord) (Receipt, bool) {
	var rec storedReview
	if err := json.Unmarshal(row.Raw, &rec); err != nil {
		return Receipt{Status: "cache_unavailable", Reason: "cache_unavailable", Cached: boolPtr(false)}, false
	}
	if rec.ID == "" {
		rec.ID = rec.LegacyID
	}
	if rec.ID == "" || rec.Status == "" || rec.Status == "skipped_duplicate" {
		return Receipt{Status: "cache_unavailable", Reason: "cache_unavailable", Cached: boolPtr(false), OriginalReviewID: rec.ID}, false
	}
	out := Receipt{
		ID:               rec.ID,
		Status:           "skipped_duplicate",
		Reason:           rec.ID,
		CaptureID:        rec.CaptureID,
		Coverage:         rec.Coverage,
		CostUSD:          rec.CostUSD,
		Manifest:         rec.Manifest,
		Cached:           boolPtr(true),
		OriginalReviewID: rec.ID,
		OriginalStatus:   rec.Status,
		Model:            rec.ReturnedModel,
		Effort:           rec.EffectiveEffort,
		Tags:             rec.Tags,
		Attempts:         rec.Attempts,
	}
	if out.Model == "" {
		out.Model = rec.ConfiguredModel
	}
	if rec.Status == "ok" || rec.Status == "ok_partial" {
		if len(rec.Payload) == 0 || string(rec.Payload) == "null" {
			return Receipt{Status: "cache_unavailable", Reason: "cache_unavailable", Cached: boolPtr(false), OriginalReviewID: rec.ID}, false
		}
		var result Result
		if err := json.Unmarshal(rec.Payload, &result); err != nil {
			return Receipt{Status: "cache_unavailable", Reason: "cache_unavailable", Cached: boolPtr(false), OriginalReviewID: rec.ID}, false
		}
		out.Result = &result
		counts := map[string]int{}
		for _, f := range result.Findings {
			counts[f.Severity]++
		}
		if len(counts) > 0 {
			out.FindingCounts = counts
		}
	}
	return out, true
}

// legacyIdentityMatches verifies the stored legacy record would have produced
// the pre-upgrade key for this adapter request. Key equality already covers the
// other identity fields.
func legacyIdentityMatches(row store.ReviewRecord, trial *Trial) bool {
	if trial == nil {
		return false
	}
	var rec struct {
		ManifestHash    string `json:"manifest_hash"`
		CaseID          string `json:"case_id"`
		EffectiveEffort string `json:"effective_effort"`
		Profile         string `json:"profile"`
	}
	if json.Unmarshal(row.Raw, &rec) != nil {
		return false
	}
	return rec.ManifestHash == trial.ManifestHash && rec.CaseID == trial.CaseID &&
		rec.EffectiveEffort == trial.Effort && rec.Profile == "historical_trial"
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

// applyReportedUsage records provider-reported tokens. Cost is known only when
// the embedded table prices the model; an unpriced override stays unknown
// rather than a known zero.
func applyReportedUsage(a *Attempt, model string, in, out int) {
	a.InputTokens, a.OutputTokens = in, out
	inputSize := int64(in)
	if tier, ok := store.PricingTier(model, inputSize, false); ok {
		a.PricingTier = tier
	}
	if cost, priced := store.CostAtInputSize("claude", model, store.Tokens{In: int64(in), Out: int64(out)}, inputSize, nil); priced {
		a.CostUSD = cost
		a.CostKnown = true
	}
}

func attemptTotals(attempts []Attempt) (in, out int, cost float64, known bool) {
	for _, a := range attempts {
		in += a.InputTokens
		out += a.OutputTokens
		if a.CostKnown {
			known = true
			cost += a.CostUSD
		}
	}
	return
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

// reviewRecord builds the persisted review_run map and its client receipt. write
// selects the persisted shape; a read-only (store=false) call only needs the receipt.
func reviewRecord(r Request, repo, id, status, reason string, result Result, attempts []Attempt, p Packet, c CriteriaRecord, inputHash string, cfg RunConfig, ctl callControls, key string, now time.Time, write bool) (map[string]any, Receipt) {
	findings := map[string]int{}
	for _, f := range result.Findings {
		findings[f.Severity]++
	}
	out := Receipt{Status: status, Reason: reason, InputTokenEstimate: p.InputTokenEstimate, InputTrimmed: p.InputTrimmed, CaptureID: p.CaptureID, FindingCounts: findings, Coverage: p.Coverage}
	if c.Ignored != "" {
		out.Ignored = []string{c.Ignored}
	}
	if r.Detail == "full" || !write {
		out.Model = result.Model
		if out.Model == "" {
			out.Model = cfg.Availability.EffectiveModel()
		}
		out.Effort = ctl.effective
		out.Tags = ctl.tags
		out.Attempts = attempts
	}
	for _, a := range attempts {
		out.CostUSD += a.CostUSD
	}
	if r.Detail == "full" || (!write && (status == "ok" || status == "ok_partial")) {
		out.Result = &result
	}
	if !write {
		return nil, out
	}
	out.ID = id
	conv := "review:" + p.CaptureID[:min(12, len(p.CaptureID))]
	model := cfg.Availability.EffectiveModel()
	tags := ctl.tags
	if tags == nil {
		tags = []string{}
	}
	rec := map[string]any{"id": id, "review_id": id, "type": "review_run", "repo_id": repo, "kind": r.Kind, "plan": r.Plan, "phase": r.Phase, "pr": r.PR, "capture_id": p.CaptureID, "input_hash": inputHash, "input_token_estimate": p.InputTokenEstimate, "input_trimmed": p.InputTrimmed, "criteria": c, "configured_model": model, "returned_model": result.Model, "configured_effort": ctl.configured, "requested_effort": ctl.requested, "effective_effort": ctl.effective, "profile": ctl.profile, "tags": tags, "prompt_policy_version": p.PromptPolicyVersion, "exclusion_policy_version": p.ExclusionPolicyVersion, "status": status, "attempts": attempts, "payload": result, "build_models": r.BuildModels, "session_binding": "unbound", "session_binding_reason": "Plan 22 session resolver is unavailable", "conversation_id": conv, "coverage": p.Coverage, "manifest": p.Manifest, "key": key, "ts": float64(now.Unix())}
	if status == "skipped_duplicate" && reason != "" {
		rec["original_review_id"] = reason
	}
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
		in, outTok, cost, known := attemptTotals(attempts)
		rec["pricing_table_id"] = store.PricingTableID()
		rec["input_tokens"] = in
		rec["output_tokens"] = outTok
		if known {
			rec["cost_usd"] = cost
			rec["cost_known"] = true
		} else {
			rec["cost_usd"] = nil
			rec["cost_known"] = false
		}
	}
	if reason != "" {
		rec["reason"] = reason
	}
	return rec, out
}

func persistRecord(ctx context.Context, t *store.Tenant, tenant string, r Request, repo, id, status, reason string, result Result, attempts []Attempt, p Packet, c CriteriaRecord, inputHash string, cfg RunConfig, ctl callControls, key string, write bool) (Receipt, error) {
	now := time.Now()
	if cfg.Now != nil {
		now = cfg.Now()
	}
	rec, out := reviewRecord(r, repo, id, status, reason, result, attempts, p, c, inputHash, cfg, ctl, key, now, write)
	if !write {
		if !ctl.store && len(attempts) > 0 {
			if err := persistReviewUsage(ctx, t, status, result, attempts, cfg, ctl); err != nil {
				return Receipt{}, err
			}
		}
		return out, nil
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

// finalizeRecord replaces the in-flight row created by Start with the terminal
// result on the same review id. It never appends a second row for the attempt.
func finalizeRecord(ctx context.Context, t *store.Tenant, tenant string, r Request, repo, id, status, reason string, result Result, attempts []Attempt, p Packet, c CriteriaRecord, inputHash string, cfg RunConfig, ctl callControls, key string) (Receipt, error) {
	now := time.Now()
	if cfg.Now != nil {
		now = cfg.Now()
	}
	rec, out := reviewRecord(r, repo, id, status, reason, result, attempts, p, c, inputHash, cfg, ctl, key, now, true)
	b, _ := json.Marshal(rec)
	updated, err := t.FinalizeReviewRun(ctx, id, b)
	if err != nil {
		return Receipt{}, errors.New("review record persistence failed")
	}
	if !updated {
		return Receipt{}, errors.New("review record finalize failed")
	}
	return out, nil
}

// persistReviewUsage writes one content-free review_usage fact for a store=false call that
// reached the provider. It carries no repository, plan, session, capture, prompt, criteria,
// finding, error-body or content-derived hash field. Cost is the sum of known attempt costs;
// with no known attempt it is null and cost_known is false.
func persistReviewUsage(ctx context.Context, t *store.Tenant, status string, result Result, attempts []Attempt, cfg RunConfig, ctl callControls) error {
	in, out, charge, known := attemptTotals(attempts)
	tags := ctl.tags
	if tags == nil {
		tags = []string{}
	}
	now := time.Now()
	if cfg.Now != nil {
		now = cfg.Now()
	}
	rec := map[string]any{
		"type":              "review_usage",
		"usage_id":          makeID(),
		"configured_model":  cfg.Availability.EffectiveModel(),
		"returned_model":    result.Model,
		"configured_effort": ctl.configured,
		"requested_effort":  ctl.requested,
		"effective_effort":  ctl.effective,
		"input_tokens":      in,
		"output_tokens":     out,
		"pricing_table_id":  store.PricingTableID(),
		"ts":                float64(now.Unix()),
		"tags":              tags,
		"store":             false,
		"status":            status,
		"attempts":          attempts,
	}
	if known {
		rec["cost_usd"] = charge
		rec["cost_known"] = true
	} else {
		rec["cost_usd"] = nil
		rec["cost_known"] = false
	}
	b, _ := json.Marshal(rec)
	facts, err := ingest.IngestReviewUsage(ctx, t, []json.RawMessage{json.RawMessage(b)})
	if err != nil {
		return errors.New("review usage persistence failed")
	}
	if len(facts) != 1 || facts[0].Status != ingest.Accepted {
		return errors.New("review usage rejected")
	}
	return nil
}
