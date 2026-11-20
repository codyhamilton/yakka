package analyticsfixture

// Retained-history workload for Plan 29 Phase 2 acceptance. It reproduces the EVIDENCE.md
// migrated-ledger scale (facts, sessions, scores, plan/file identities, association fan-out and
// usage attribution) deterministically, without copying any real ledger. Product code is not
// involved: this package owns only test data.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// RetainedVersion identifies the retained-workload generator. A prepared synthetic directory is
// reused only when its marker has this version; bump it when the generated shape changes.
const RetainedVersion = 1

const (
	retainedSessions     = 7440
	retainedPlans        = 260
	retainedFiles        = 1400
	retainedToolEvents   = 202400
	retainedUsageCalls   = 33600
	retainedCommits      = 900
	retainedVersionsEach = 2
	retainedChecks       = 15
	retainedSeed         = "plan29-retained-v1"
)

var (
	retainedFactEnd  = time.Date(2026, 10, 22, 23, 19, 51, 0, time.UTC)
	retainedUsageEnd = time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)

	retainedHarnesses   = []string{"claude", "codex", "opencode", "cursor"}
	retainedPricedModel = []string{"claude-sonnet-5-5", "gpt-5.5", "kimi-k2.5", "gemini-3.5-flash"}
	retainedFreeModel   = []string{"unknown-model-a", "unknown-model-b", "unknown-model-c", "unknown-model-d"}
	retainedCheckNames  = []string{
		"clarity", "quality", "debt", "design-coherence", "scope-fidelity",
		"test-coverage", "risk", "readability", "structure", "evidence",
		"tradeoffs", "performance", "security", "maintainability", "clarity-2",
	}
)

// RetainedCounts is the exact generated workload size and fan-out.
type RetainedCounts struct {
	Facts                   int `json:"facts"`
	HookEvents              int `json:"hook_events"`
	UsageCalls              int `json:"usage_calls"`
	ArtifactVersions        int `json:"artifact_versions"`
	Commits                 int `json:"commits"`
	Sessions                int `json:"sessions"`
	PlanIdentities          int `json:"plan_identities"`
	ArtifactFiles           int `json:"artifact_files"`
	PlanSessionAssociations int `json:"plan_session_associations"`
	HarnessModelGroups      int `json:"harness_model_groups"`
	MaxSessionsPerPlan      int `json:"max_sessions_per_plan"`
	MaxPlansPerSession      int `json:"max_plans_per_session"`
	Scores                  int `json:"scores"`
	ScoredContent           int `json:"scored_content"`
	Checks                  int `json:"checks"`
}

// RetainedOracle holds values a replay can compare against without re-running a store query: the
// population sizes, the mixed-attribution identity, priced/unpriced session classes and the
// expected minimum rows for each committed request-shape oracle key.
type RetainedOracle struct {
	MinFactTS                  int64          `json:"min_fact_ts"`
	MaxFactTS                  int64          `json:"max_fact_ts"`
	LatestUsageTS              int64          `json:"latest_usage_ts"`
	TotalCostUSD               float64        `json:"total_cost_usd"`
	PricedSessions             int            `json:"priced_sessions"`
	PartiallyPricedSessions    int            `json:"partially_priced_sessions"`
	AllUnpricedSessions        int            `json:"all_unpriced_sessions"`
	MixedRepoID                string         `json:"mixed_repo_id"`
	MixedPlan                  string         `json:"mixed_plan"`
	MixedSession               string         `json:"mixed_session"`
	MixedSessionCostUSD        float64        `json:"mixed_session_cost_usd"`
	MixedPlanAssociatedCostUSD float64        `json:"mixed_plan_associated_cost_usd"`
	MixedUsageRawRepoEmpty     bool           `json:"mixed_usage_raw_repo_empty"`
	MaxSessionsPerPlan         int            `json:"max_sessions_per_plan"`
	MaxSessionsPlanRepo        string         `json:"max_sessions_plan_repo"`
	MaxSessionsPlan            string         `json:"max_sessions_plan"`
	MaxPlansPerSession         int            `json:"max_plans_per_session"`
	MaxPlansSession            string         `json:"max_plans_session"`
	HarnessModelGroups         int            `json:"harness_model_groups"`
	ScoredContent              int            `json:"scored_content"`
	Scores                     int            `json:"scores"`
	Checks                     []string       `json:"checks"`
	ShapeOracle                map[string]int `json:"shape_oracle"`
}

// RetainedSummary is the committed oracle record for a generated or prepared workload.
type RetainedSummary struct {
	Version   int            `json:"version"`
	Seed      string         `json:"seed"`
	Generated RetainedCounts `json:"generated"`
	Oracle    RetainedOracle `json:"oracle"`
}

// RetainedDigest hashes the deterministic generated rows and score plan, so tests can prove the
// generator is reproducible without building two ledgers.
func RetainedDigest() (string, error) {
	plan, err := buildRetained()
	if err != nil {
		return "", err
	}
	h := sha256.New()
	for _, r := range plan.facts {
		fmt.Fprintf(h, "%s\x00%s\x00%s\x00%s\x00%s\x00%v\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%d\x00%d\x00%d\x00",
			r.RowHash, r.Type, r.ConversationID, r.Harness, r.Event, r.TS, r.RepoID, r.Path, r.ContentHash,
			r.NormEvent, r.Tool, r.Model, r.Source, r.SHA, r.TokIn, r.TokOut, r.TokCacheRead, r.TokCacheWrite, r.TokReasoning)
		if r.CostReported == nil {
			h.Write([]byte("nil\x00"))
		} else {
			fmt.Fprintf(h, "%v\x00", *r.CostReported)
		}
		h.Write(r.Raw)
		h.Write([]byte("\x00"))
	}
	for _, x := range plan.scoreBatches {
		fmt.Fprintf(h, "%s", x.Hash)
		for _, s := range x.Scores {
			fmt.Fprintf(h, "\x00%s\x00%v\x00%s", s.Check, s.Result, s.Scorer)
		}
		h.Write([]byte("\x01"))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

type retainedScoreBatch struct {
	Hash   string
	Scores []store.Score
}

type retainedPlan struct {
	facts        []store.FactRow
	scoreBatches []retainedScoreBatch
	summary      RetainedSummary
}

// CreateRetained builds the synthetic retained-history tenant under dir. It is deterministic and
// reuses a completed directory whose marker matches RetainedVersion; a partial directory is
// rebuilt. dir itself is the tenant directory (the eventual ledger.db parent).
func CreateRetained(ctx context.Context, dir string) (RetainedSummary, error) {
	marker := filepath.Join(dir, "retained-workload.json")
	if b, err := os.ReadFile(marker); err == nil {
		var s RetainedSummary
		if json.Unmarshal(b, &s) == nil && s.Version == RetainedVersion {
			if _, statErr := os.Stat(filepath.Join(dir, "ledger.db")); statErr == nil {
				return s, nil
			}
		}
	}
	if err := os.RemoveAll(dir); err != nil {
		return RetainedSummary{}, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return RetainedSummary{}, err
	}
	plan, err := buildRetained()
	if err != nil {
		return RetainedSummary{}, err
	}
	t, err := store.Open(dir, store.Options{})
	if err != nil {
		return RetainedSummary{}, err
	}
	const batch = 5000
	for start := 0; start < len(plan.facts); start += batch {
		end := start + batch
		if end > len(plan.facts) {
			end = len(plan.facts)
		}
		if _, err := t.Append(ctx, plan.facts[start:end]); err != nil {
			t.Close()
			return RetainedSummary{}, err
		}
	}
	for _, x := range plan.scoreBatches {
		if err := t.AppendScores(ctx, x.Hash, x.Scores); err != nil {
			t.Close()
			return RetainedSummary{}, err
		}
	}
	if err := t.Close(); err != nil {
		return RetainedSummary{}, err
	}
	b, err := json.MarshalIndent(plan.summary, "", "  ")
	if err != nil {
		return RetainedSummary{}, err
	}
	if err := os.WriteFile(marker, append(b, '\n'), 0o600); err != nil {
		return RetainedSummary{}, err
	}
	return plan.summary, nil
}

func retainedRaw(typ, id string) []byte {
	b, _ := json.Marshal(map[string]any{"type": typ, "id": id, "source": "analyticsfixture-retained"})
	return b
}

type retainedFile struct {
	repo, plan, path, kind string
	hashV1, hashV2         string
	tsV1, tsV2             float64
}

func retainedFileAt(i int) retainedFile {
	planIdx := i % retainedPlans
	repo := fmt.Sprintf("repo-%02d", planIdx%26)
	plan := fmt.Sprintf("plan-%03d", planIdx)
	ordinal := i / retainedPlans
	var path, kind string
	switch ordinal {
	case 0:
		path, kind = "docs/plans/"+plan+"/DESIGN.md", "design"
	case 1:
		path, kind = "docs/plans/"+plan+"/briefs/01-scope.md", "brief"
	case 2:
		path, kind = "docs/plans/"+plan+"/briefs/02-build.md", "brief"
	case 3:
		path, kind = "docs/plans/"+plan+"/reports/01-build.md", "report"
	case 4:
		path, kind = "docs/plans/"+plan+"/reports/02-review.md", "report"
	default:
		path, kind = "docs/plans/"+plan+"/briefs/03-extra.md", "brief"
	}
	ts1 := float64(retainedFactEnd.Add(-time.Duration((i*37+1)%12000) * time.Hour).Unix())
	return retainedFile{
		repo: repo, plan: plan, path: path, kind: kind,
		hashV1: keys.ContentHash([]byte(fmt.Sprintf("retained content %04d v1", i))),
		hashV2: keys.ContentHash([]byte(fmt.Sprintf("retained content %04d v2", i))),
		tsV1:   ts1,
		tsV2:   ts1 + 3600,
	}
}

func buildRetained() (*retainedPlan, error) {
	facts := make([]store.FactRow, 0, 240000)
	sessionsSeen := map[string]bool{}
	planSessions := map[string]map[string]bool{}
	sessionPlans := map[string]map[string]bool{}
	usageGroups := map[string]bool{}
	type callClass struct{ priced, unpriced int }
	callClasses := map[string]*callClass{}

	add := func(r store.FactRow) {
		facts = append(facts, r)
		if r.ConversationID != "" {
			sessionsSeen[r.ConversationID] = true
		}
	}
	rawFor := func(typ, id string) []byte { return retainedRaw(typ, id) }
	rowHash := func(typ, id string) string {
		sum := sha256.Sum256(rawFor(typ, id))
		return hex.EncodeToString(sum[:])
	}

	// Tool events: every session has at least one in-window fact.
	for i := 0; i < retainedToolEvents; i++ {
		sess := fmt.Sprintf("sess-%05d", i%retainedSessions)
		id := fmt.Sprintf("tool-%06d", i)
		at := retainedFactEnd.Add(-time.Duration((i*104729)%20000) * time.Hour)
		add(store.FactRow{
			RowHash: rowHash("hook_event", id), Type: "hook_event", ConversationID: sess,
			Harness: retainedHarnesses[i%len(retainedHarnesses)], Event: "PostToolUse", NormEvent: "tool_post",
			Tool: []string{"Read", "Bash", "Edit", "Grep"}[i%4], TS: float64(at.Unix()), Raw: rawFor("hook_event", id), Source: "retained-fixture",
		})
	}

	// Usage calls: sessions 0..59 stay call-free except the mixed-attribution session 0, so
	// plan-000's lifetime associated cost equals that one session's cost exactly.
	mixedCost := 0.0
	addUsage := func(i int, sess string, priced bool) {
		harnessIdx := i % len(retainedHarnesses)
		modelIdx := (i / len(retainedHarnesses)) % len(retainedPricedModel)
		var model string
		if priced {
			model = retainedPricedModel[modelIdx]
		} else {
			model = retainedFreeModel[modelIdx]
		}
		harness := retainedHarnesses[harnessIdx]
		tok := store.Tokens{In: int64(400 + (i*13)%4000), Out: int64(80 + (i*7)%800), CacheRead: int64((i * 3) % 200)}
		var reported *float64
		usd, ok := store.Cost(harness, model, tok, reported)
		if ok != priced {
			// The lists above are chosen so a known model is priced and an unknown model is not.
			panic("retained fixture usage pricing mismatch")
		}
		id := fmt.Sprintf("usage-%06d", i)
		at := retainedUsageEnd.Add(-time.Duration((i*7919)%8000) * time.Hour)
		add(store.FactRow{
			RowHash: rowHash("hook_event", id), Type: "hook_event", ConversationID: sess, Harness: harness,
			Event: "model_call", NormEvent: "usage", Model: model, TS: float64(at.Unix()), Raw: rawFor("hook_event", id),
			TokIn: tok.In, TokOut: tok.Out, TokCacheRead: tok.CacheRead, Source: "retained-fixture",
		})
		if sess == "sess-00000" {
			mixedCost = usd
		}
		cc := callClasses[sess]
		if cc == nil {
			cc = &callClass{}
			callClasses[sess] = cc
		}
		if priced {
			cc.priced++
		} else {
			cc.unpriced++
		}
		usageGroups[harness+"\x00"+model] = true
	}
	addUsage(0, "sess-00000", true)
	call := 1
	for s := 60; s < 6060; s++ {
		sess := fmt.Sprintf("sess-%05d", s)
		class := (s - 60) % 3
		n := 5
		if s < 60+3599 {
			n = 6
		}
		for c := 0; c < n; c++ {
			priced := class == 0 || (class == 1 && c%5 < 3)
			addUsage(call, sess, priced)
			call++
		}
	}

	// Artifact versions: 1,400 file identities with two versions each. The latest version of
	// every file is scored, so the artifact band population is fully scored.
	files := make([]retainedFile, retainedFiles)
	scored := make([]string, 0, retainedFiles)
	for i := range files {
		f := retainedFileAt(i)
		files[i] = f
		for v := 1; v <= retainedVersionsEach; v++ {
			hash, ts := f.hashV1, f.tsV1
			if v == 2 {
				hash, ts = f.hashV2, f.tsV2
			}
			id := fmt.Sprintf("artifact-%04d-v%d", i, v)
			sess := f.sessionFor(i, v)
			add(store.FactRow{
				RowHash: rowHash("artifact_version", id), Type: "artifact_version", ConversationID: sess,
				Harness: retainedHarnesses[i%len(retainedHarnesses)], TS: ts, RepoID: f.repo, Path: f.path,
				ContentHash: hash, Raw: rawFor("artifact_version", id), Source: "retained-fixture",
			})
			linkPlanSession(planSessions, sessionPlans, f.repo, f.plan, sess)
		}
		scored = append(scored, f.hashV2)
	}

	// Explicit fan-out: 60 sessions on plan-000 and 50 plans on sess-00000. They reuse scored
	// latest hashes so the latest-version band stays available.
	design0 := files[0]
	for s := 0; s < 60; s++ {
		sess := fmt.Sprintf("sess-%05d", s)
		id := fmt.Sprintf("assoc-plan0-%02d", s)
		add(store.FactRow{
			RowHash: rowHash("artifact_version", id), Type: "artifact_version", ConversationID: sess,
			Harness: retainedHarnesses[s%len(retainedHarnesses)], TS: design0.tsV2 - float64(s),
			RepoID: design0.repo, Path: design0.path, ContentHash: design0.hashV2,
			Raw: rawFor("artifact_version", id), Source: "retained-fixture",
		})
		linkPlanSession(planSessions, sessionPlans, design0.repo, design0.plan, sess)
	}
	for p := 0; p < 50; p++ {
		f := files[p] // ordinal 0 is DESIGN.md for each of the first 50 plans
		id := fmt.Sprintf("assoc-sess0-plan%02d", p)
		add(store.FactRow{
			RowHash: rowHash("artifact_version", id), Type: "artifact_version", ConversationID: "sess-00000",
			Harness: retainedHarnesses[p%len(retainedHarnesses)], TS: f.tsV2 - float64(p+1),
			RepoID: f.repo, Path: f.path, ContentHash: f.hashV2, Raw: rawFor("artifact_version", id), Source: "retained-fixture",
		})
		linkPlanSession(planSessions, sessionPlans, f.repo, f.plan, "sess-00000")
	}

	// Commits give the session scatter a non-empty commits measure.
	for i := 0; i < retainedCommits; i++ {
		sess := fmt.Sprintf("sess-%05d", (i*13)%retainedSessions)
		id := fmt.Sprintf("commit-%04d", i)
		at := retainedFactEnd.Add(-time.Duration((i*503)%15000) * time.Hour)
		add(store.FactRow{
			RowHash: rowHash("commit", id), Type: "commit", ConversationID: sess,
			Harness: retainedHarnesses[i%len(retainedHarnesses)], Event: "commit", TS: float64(at.Unix()),
			RepoID: fmt.Sprintf("repo-%02d", i%26), Raw: rawFor("commit", id), Source: "retained-fixture",
		})
	}

	// Scores on every latest artifact hash. 1,400 x 15 = 21,000 score rows.
	scoreBatches := make([]retainedScoreBatch, 0, len(scored))
	for i, hash := range scored {
		scores := make([]store.Score, 0, len(retainedCheckNames))
		for c, name := range retainedCheckNames {
			scores = append(scores, store.Score{Check: name, Result: float64((i+c*7)%100) / 100.0, Scorer: "jev-1.13.0"})
		}
		scoreBatches = append(scoreBatches, retainedScoreBatch{Hash: hash, Scores: scores})
	}

	counts := RetainedCounts{
		Facts: len(facts), HookEvents: countType(facts, "hook_event"), ArtifactVersions: countType(facts, "artifact_version"),
		Commits: countType(facts, "commit"), Sessions: len(sessionsSeen), PlanIdentities: len(planSessions),
		ArtifactFiles: retainedFiles, HarnessModelGroups: len(usageGroups), Scores: len(scoreBatches) * len(retainedCheckNames),
		ScoredContent: len(scored), Checks: len(retainedCheckNames),
	}
	counts.PlanSessionAssociations = associations(planSessions)
	counts.UsageCalls = call
	// Every call issued through addUsage was counted by call, including the mixed one.
	for plan, sess := range planSessions {
		if len(sess) > counts.MaxSessionsPerPlan {
			counts.MaxSessionsPerPlan = len(sess)
		}
		_ = plan
	}
	for sess, plans := range sessionPlans {
		if len(plans) > counts.MaxPlansPerSession {
			counts.MaxPlansPerSession = len(plans)
			_ = sess
		}
	}

	priced, partial, allUnpriced := 0, 0, 0
	for _, cc := range callClasses {
		switch {
		case cc.priced > 0 && cc.unpriced == 0:
			priced++
		case cc.priced > 0 && cc.unpriced > 0:
			partial++
		case cc.unpriced > 0:
			allUnpriced++
		}
	}
	totalCost := 0.0
	latestUsage := int64(0)
	minFact, maxFact := int64(1<<62), int64(-1<<62)
	for _, r := range facts {
		ts := int64(r.TS)
		if ts < minFact {
			minFact = ts
		}
		if ts > maxFact {
			maxFact = ts
		}
		if r.NormEvent == "usage" {
			if ts > latestUsage {
				latestUsage = ts
			}
			if usd, ok := store.Cost(r.Harness, r.Model, store.Tokens{In: r.TokIn, Out: r.TokOut, CacheRead: r.TokCacheRead}, nil); ok {
				totalCost += usd
			}
		}
	}
	maxPlan, maxPlanRepo, maxSess, maxSessPlans := 0, "", "", 0
	for key, sess := range planSessions {
		if len(sess) > maxPlan {
			maxPlan = len(sess)
			repo, plan := splitPlanKey(key)
			maxPlanRepo, maxSess = repo, plan
		}
	}
	for sess, plans := range sessionPlans {
		if len(plans) > maxSessPlans {
			maxSessPlans = len(plans)
			maxSess = sess
		}
	}
	oracle := RetainedOracle{
		MinFactTS: minFact, MaxFactTS: maxFact, LatestUsageTS: latestUsage, TotalCostUSD: totalCost,
		PricedSessions: priced, PartiallyPricedSessions: partial, AllUnpricedSessions: allUnpriced,
		MixedRepoID: design0.repo, MixedPlan: design0.plan, MixedSession: "sess-00000",
		MixedSessionCostUSD: mixedCost, MixedPlanAssociatedCostUSD: mixedCost, MixedUsageRawRepoEmpty: true,
		MaxSessionsPerPlan: maxPlan, MaxSessionsPlanRepo: maxPlanRepo, MaxSessionsPlan: maxSess,
		MaxPlansPerSession: maxSessPlans, MaxPlansSession: maxSess,
		HarnessModelGroups: len(usageGroups), ScoredContent: len(scored), Scores: counts.Scores,
		Checks: append([]string{}, retainedCheckNames...),
		ShapeOracle: map[string]int{
			"plan_population":      len(planSessions),
			"plan_associations":    counts.PlanSessionAssociations,
			"plan_detail_sessions": maxPlan,
			"session_plans":        maxSessPlans,
			"usage_groups":         len(usageGroups),
			"scored_content":       len(scored),
			"artifact_files":       retainedFiles,
			"sessions":             len(sessionsSeen),
			"usage_calls":          counts.UsageCalls,
		},
	}
	summary := RetainedSummary{Version: RetainedVersion, Seed: retainedSeed, Generated: counts, Oracle: oracle}
	if err := validateRetained(summary); err != nil {
		return nil, err
	}
	return &retainedPlan{facts: facts, scoreBatches: scoreBatches, summary: summary}, nil
}

// sessionFor keeps plan-000's associated sessions inside the call-free 0..59 band so the
// mixed-attribution plan cost is exactly its one associated session's cost.
func (f retainedFile) sessionFor(i, v int) string {
	if f.plan == "plan-000" {
		return fmt.Sprintf("sess-%05d", (i/retainedPlans+v-1)%60)
	}
	return fmt.Sprintf("sess-%05d", (i*7+v-1)%retainedSessions)
}

func linkPlanSession(planSessions, sessionPlans map[string]map[string]bool, repo, plan, sess string) {
	key := repo + "\x00" + plan
	if planSessions[key] == nil {
		planSessions[key] = map[string]bool{}
	}
	planSessions[key][sess] = true
	if sessionPlans[sess] == nil {
		sessionPlans[sess] = map[string]bool{}
	}
	sessionPlans[sess][key] = true
}

func splitPlanKey(key string) (repo, plan string) {
	for i := 0; i < len(key); i++ {
		if key[i] == 0 {
			return key[:i], key[i+1:]
		}
	}
	return key, ""
}

func associations(planSessions map[string]map[string]bool) int {
	n := 0
	for _, sess := range planSessions {
		n += len(sess)
	}
	return n
}

func countType(facts []store.FactRow, typ string) int {
	n := 0
	for _, r := range facts {
		if r.Type == typ {
			n++
		}
	}
	return n
}

// validateRetained enforces the EVIDENCE Phase 2 scale floors and both fan-out maxima.
func validateRetained(s RetainedSummary) error {
	c := s.Generated
	checks := []struct {
		ok   bool
		what string
	}{
		{c.Facts >= 235496, "facts >= 235496"},
		{c.Scores >= 20805, "scores >= 20805"},
		{c.Sessions >= 7417, "sessions >= 7417"},
		{c.PlanIdentities >= 257, "plan identities >= 257"},
		{c.ArtifactFiles >= 1339, "artifact files >= 1339"},
		{c.PlanSessionAssociations >= 823, "plan/session associations >= 823"},
		{c.HarnessModelGroups >= 32, "harness/model groups >= 32"},
		{c.MaxSessionsPerPlan >= 57, "sessions on one plan >= 57"},
		{c.MaxPlansPerSession >= 43, "plans on one session >= 43"},
		{s.Oracle.PricedSessions > 0 && s.Oracle.PartiallyPricedSessions > 0 && s.Oracle.AllUnpricedSessions > 0, "priced, partial and all-unpriced sessions"},
		{s.Oracle.LatestUsageTS < time.Now().Add(-30*24*time.Hour).Unix(), "usage older than 30 days"},
		{s.Oracle.MixedPlanAssociatedCostUSD > 0 && s.Oracle.MixedUsageRawRepoEmpty, "mixed-attribution plan cost"},
	}
	for _, x := range checks {
		if !x.ok {
			return fmt.Errorf("retained fixture: %s", x.what)
		}
	}
	return nil
}
