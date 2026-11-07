// Package analyticsfixture creates deterministic, non-shipping analytics test ledgers.
package analyticsfixture

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

//go:embed manifest.json
var files embed.FS

type Manifest struct {
	Version     int              `json:"version"`
	Populations map[string]int   `json:"populations"`
	Bounds      map[string]int64 `json:"bounds"`
}

type Summary struct {
	Manifest Manifest       `json:"manifest"`
	Counts   map[string]int `json:"counts"`
}

// ReadManifest returns the committed contract oracle used by fixture tests and browser setup.
func ReadManifest() (Manifest, error) {
	b, err := files.ReadFile("manifest.json")
	if err != nil {
		return Manifest{}, err
	}
	var m Manifest
	err = json.Unmarshal(b, &m)
	return m, err
}

// Create builds a fresh fixture ledger under dir. The caller owns the directory lifetime.
func Create(ctx context.Context, dir string) (Summary, error) {
	t, err := store.Open(dir, store.Options{})
	if err != nil {
		return Summary{}, err
	}
	defer t.Close()
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Unix()
	rows := make([]store.FactRow, 0, 5019)
	add := func(id, typ, conv, harness, event, repo, path, hash string, ts float64, model string, priced bool) {
		raw, _ := json.Marshal(map[string]any{"type": typ, "id": id, "source": "analyticsfixture"})
		rh := sha256.Sum256(raw)
		r := store.FactRow{RowHash: hex.EncodeToString(rh[:]), Type: typ, ConversationID: conv, Harness: harness,
			Event: event, TS: ts, RepoID: repo, Path: path, ContentHash: hash, Raw: raw, Model: model,
			NormEvent: event, Source: "fixture"}
		if typ == "hook_event" {
			r.Tool = "fixture-tool"
		}
		if model != "" {
			r.TokIn, r.TokOut = 12, 8
			if priced {
				c := 0.01
				r.CostReported = &c
			}
		}
		rows = append(rows, r)
	}
	for i := 0; i < 5008; i++ {
		add(fmt.Sprintf("event-%05d", i), "hook_event", "session-many", []string{"harness-a", "harness-b"}[i%2], "tool_call", "repo-a", "", "", float64(base+int64(i)), "", false)
	}
	for i, conv := range []string{"session-one", "session-many", "session-none", "session-many"} {
		repo, model, price := "", "model-b", false
		if i == 0 {
			repo = "repo-a"
		}
		if i == 1 {
			repo = "repo-b"
		}
		if i%2 == 0 {
			model, price = "model-a", true
		}
		add(fmt.Sprintf("call-%d", i), "hook_event", conv, "harness-a", "model_call", repo, "", "", float64(base+6000+int64(i)), model, price)
	}
	for i, y := range []int{1500, 2300} {
		add(fmt.Sprintf("boundary-%d", i), "hook_event", "boundary", "harness-boundary", "tool_call", "repo-boundary", "", "", float64(time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC).Unix()), "", false)
	}
	// The unpriced call is deliberately beyond the 5,000 event conversation fixture.
	add("unpriced-tail", "hook_event", "session-many", "harness-b", "model_call", "", "", "", float64(base+9000), "unpriced-model", false)
	if _, err := t.Append(ctx, rows); err != nil {
		return Summary{}, err
	}
	for _, r := range []store.Rejection{{Stage: "precheck", FactType: "artifact_version", Path: "plans/repo-a/plan-a/design.md", Reason: "fixture precheck"}, {Stage: "screen", FactType: "artifact_version", Path: "plans/repo-a/plan-a/design.md", Reason: "fixture screen"}} {
		if err := t.AppendRejection(ctx, r); err != nil {
			return Summary{}, err
		}
	}
	// Three artifact kinds with three versions each. Identical body bytes across three identities
	// prove content sharing independently of path, plan and repo joins.
	shared := []byte("shared deterministic fixture body\n")
	sharedHash := keys.ContentHash(shared)
	ids := []struct{ repo, plan, kind string }{{"repo-a", "plan-a", "design"}, {"repo-b", "plan-a", "brief"}, {"repo-c", "plan-b", "report"}}
	for j, x := range ids {
		for v := 1; v <= 3; v++ {
			path := fmt.Sprintf("docs/plans/%s/%s", x.plan, map[string]string{"design": "DESIGN.md", "brief": "briefs/01-task.md", "report": "reports/01-task.md"}[x.kind])
			body := shared
			if v > 1 {
				body = []byte(fmt.Sprintf("%s version %d\n", x.kind, v))
			}
			h := keys.ContentHash(body)
			raw, _ := json.Marshal(map[string]any{"type": "artifact_version", "repo_id": x.repo, "path": path, "content_hash": h, "version": v, "source": "analyticsfixture"})
			rh := sha256.Sum256(raw)
			if _, err := t.Append(ctx, []store.FactRow{{RowHash: hex.EncodeToString(rh[:]), Type: "artifact_version", ConversationID: []string{"session-one", "session-many", "session-plan"}[j], Harness: "harness-a", TS: float64(base + 10000 + int64(j*10+v)), RepoID: x.repo, Path: path, ContentHash: h, Raw: raw}}); err != nil {
				return Summary{}, err
			}
			// Promotion requires pending content before it can become a stored artifact body.
			if err := t.WritePending(h, body); err != nil {
				return Summary{}, err
			}
			if err := t.Promote(ctx, h, store.Screen{Verdict: "pass", Scorer: "scorer-a"}, store.Score{Check: "quality", Result: 0.8, Scorer: "scorer-a"}); err != nil {
				return Summary{}, err
			}
			if v == 1 {
				if err := t.AppendScores(ctx, h, []store.Score{{Check: "quality", Result: 0.9, Scorer: "scorer-b"}, {Check: "clarity", Result: 0.7, Scorer: "scorer-a"}, {Check: "clarity", Result: 0.6, Scorer: "scorer-b"}}); err != nil {
					return Summary{}, err
				}
			}
		}
	}
	// Distinct scored hashes exercise the SQL parameter boundary. Each has a valid artifact body.
	jobs := make(chan int)
	errs := make(chan error, 32)
	var wg sync.WaitGroup
	for worker := 0; worker < cap(errs); worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				body := []byte(fmt.Sprintf("scored fixture body %05d\n", i))
				h := keys.ContentHash(body)
				if err := t.WritePending(h, body); err != nil {
					errs <- err
					continue
				}
				if err := t.Promote(ctx, h, store.Screen{Verdict: "pass", Scorer: "scorer-limit"}, store.Score{Check: "limit", Result: 0.5, Scorer: "scorer-limit"}); err != nil {
					errs <- err
				}
			}
		}()
	}
	for i := 0; i < 32760; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return Summary{}, err
		}
	}
	// The store derives execution shapes from brief, matching report, and commit facts.
	addArtifact := func(repo, path, conv string, ts int64) error {
		add(path, "artifact_version", conv, "harness-a", "", repo, path, sharedHash, float64(ts), "", false)
		_, err := t.Append(ctx, rows[len(rows)-1:])
		return err
	}
	if err := addArtifact("repo-c", "docs/plans/plan-b/briefs/02-unreported.md", "session-plan", base+30000); err != nil {
		return Summary{}, err
	}
	if err := addArtifact("repo-c", "docs/plans/plan-b/briefs/03-started.md", "session-started", base+30001); err != nil {
		return Summary{}, err
	}
	if _, err := t.Append(ctx, []store.FactRow{{RowHash: keys.ContentHash([]byte("fixture commit unreported")), Type: "commit", ConversationID: "session-plan", Harness: "harness-a", TS: float64(base + 30002), RepoID: "repo-c", Raw: []byte(`{"type":"commit","source":"analyticsfixture"}`)}}); err != nil {
		return Summary{}, err
	}
	if _, err := t.Append(ctx, []store.FactRow{{RowHash: keys.ContentHash([]byte("fixture commit complete")), Type: "commit", ConversationID: "session-many", Harness: "harness-a", TS: float64(base + 30002), RepoID: "repo-b", Raw: []byte(`{"type":"commit","source":"analyticsfixture"}`)}}); err != nil {
		return Summary{}, err
	}
	if err := addArtifact("repo-b", "docs/plans/plan-a/reports/01-task.md", "session-many", base+30003); err != nil {
		return Summary{}, err
	}
	if err := addArtifact("repo-c", "docs/plans/plan-a/reports/02-shared.md", "session-plan", base+30004); err != nil {
		return Summary{}, err
	}
	m, err := ReadManifest()
	if err != nil {
		return Summary{}, err
	}
	return Summary{Manifest: m, Counts: copyCounts(m.Populations)}, nil
}

func copyCounts(in map[string]int) map[string]int {
	out := make(map[string]int, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
