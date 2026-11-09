package review

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func openCriteriaTenant(t *testing.T) *store.Tenant {
	t.Helper()
	tn, err := store.Open(t.TempDir(), store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tn.Close() })
	return tn
}

func ingestArtifact(t *testing.T, tn *store.Tenant, repo, p, body string) string {
	t.Helper()
	h := keys.ContentHash([]byte(body))
	fact := map[string]any{
		"id": "criteria#" + h[:12], "type": "artifact_version", "conversation_id": "criteria-fixture",
		"harness": "fixture", "event": "write", "ts": 1, "repo_id": repo, "path": p,
		"content_hash": h, "content": body, "source": "worktree",
	}
	raw, err := json.Marshal(fact)
	if err != nil {
		t.Fatal(err)
	}
	results, err := ingest.Ingest(context.Background(), tn, []json.RawMessage{raw})
	if err != nil || len(results) != 1 || results[0].Status != ingest.Accepted {
		t.Fatalf("ingest artifact: results=%+v err=%v", results, err)
	}
	return h
}

func markScreen(t *testing.T, tn *store.Tenant, hash, verdict string) {
	t.Helper()
	if err := tn.Promote(context.Background(), hash, store.Screen{Verdict: verdict, Scorer: "fixture"}); err != nil {
		t.Fatal(err)
	}
}

func rejectPending(t *testing.T, tn *store.Tenant, hash string) {
	t.Helper()
	if err := tn.DropPending(context.Background(), hash, store.Rejection{Stage: "screen", ContentHash: hash, Reason: "fixture rejected"}); err != nil {
		t.Fatal(err)
	}
}

func designFixture(plan, phaseOutcome string) string {
	return "# Design: " + plan + "\n\n## Intent\n\nBuild " + plan + " safely.\n\n## Assumption Ledger\n\n### Assumption 1\n\n- Answer chosen: keep the server tenant-bound.\n\n### Assumption 2\n\n- Answer chosen: preserve deterministic output.\n\n## Phases\n\n### Phase 3 — Criteria resolution\n\n- Outcome: " + phaseOutcome + "\n- Surfaces: review resolver and store reads.\n\n### Phase 4 — Later phase\n\n- Outcome: Later outcome.\n- Surfaces: Later surfaces.\n"
}

func TestResolvePlanVersionsStatesAndHistoricalPin(t *testing.T) {
	tn := openCriteriaTenant(t)
	p := "docs/plans/23-demo/DESIGN.md"
	v1 := ingestArtifact(t, tn, "repo-a", p, designFixture("old", "old outcome sentinel"))
	markScreen(t, tn, v1, "pass")
	v2 := ingestArtifact(t, tn, "repo-a", p, designFixture("middle", "middle outcome sentinel"))
	markScreen(t, tn, v2, "flagged")
	flagged, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo-a", Plan: "23-demo", Phase: "3", ContentHash: v2, AllowSuperseded: true})
	if err != nil || flagged.Record.ScreenState != "flagged" || flagged.Record.ContentHash != v2 {
		t.Fatalf("flagged version record: %+v err=%v", flagged.Record, err)
	}
	v3 := ingestArtifact(t, tn, "repo-a", p, designFixture("new", "new outcome sentinel"))
	// This is the newest eligible version and is still in the pending store.
	got, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo-a", Plan: "23-demo", Phase: "3"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Record.ContentHash != v3 || got.Record.ScreenState != "pending" || got.Record.Path != p || got.Record.RepoID != "repo-a" || got.Record.Source != "store" {
		t.Fatalf("pending version record: %+v", got.Record)
	}
	if len(got.Criteria) != 5 || got.Criteria[0] != (Criterion{ID: "I1", Text: "Build new safely."}) || got.Criteria[1] != (Criterion{ID: "O1", Text: "new outcome sentinel"}) || got.Criteria[2] != (Criterion{ID: "S1", Text: "review resolver and store reads."}) || got.Criteria[3].ID != "A1" || got.Criteria[4].ID != "A2" {
		t.Fatalf("criteria extraction/order: %+v", got.Criteria)
	}
	if _, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo-a", Plan: "demo", Phase: "3", ContentHash: v1}); err == nil || !strings.Contains(err.Error(), "criteria_stale") {
		t.Fatalf("expected stale pin, got %v", err)
	}
	pinned, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo-a", Plan: "23-demo", Phase: "3", ContentHash: v1, AllowSuperseded: true})
	if err != nil {
		t.Fatal(err)
	}
	if pinned.Record.ContentHash != v1 || !strings.Contains(pinned.Criteria[1].Text, "old outcome sentinel") || strings.Contains(strings.Join(criteriaTexts(pinned.Criteria), "\n"), "new outcome sentinel") {
		t.Fatalf("historical pin did not use exact old body: %+v", pinned)
	}
	if _, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo-a", Plan: "23-demo", Phase: "4"}); err != nil {
		t.Fatal(err)
	}
}

func criteriaTexts(cs []Criterion) []string {
	out := make([]string, len(cs))
	for i := range cs {
		out[i] = cs[i].Text
	}
	return out
}

func TestResolveBriefAndReferencePrecedence(t *testing.T) {
	tn := openCriteriaTenant(t)
	p := "docs/plans/23-demo/briefs/3-01-resolver.md"
	body := "# Brief\n\nOwned paths: packages/yakka/internal/review/\n\n## Goal\n\nResolve criteria from stored artifacts.\n\n## Contract\n\n- Use tenant-scoped versions.\n\n## Done evidence\n\n- Fixture suite passes.\n"
	h := ingestArtifact(t, tn, "repo", p, body)
	markScreen(t, tn, h, "pass")
	got, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo", BriefPath: p, CriteriaText: []string{"DO NOT SEND"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Record.Ignored != "criteria_text" || got.Record.ContentHash != h || len(got.Criteria) != 4 || got.Criteria[0] != (Criterion{ID: "G1", Text: "Resolve criteria from stored artifacts."}) || got.Criteria[1].ID != "C1" || got.Criteria[2].ID != "E1" || got.Criteria[3] != (Criterion{ID: "A1", Text: "packages/yakka/internal/review/"}) {
		t.Fatalf("brief resolution: %+v", got)
	}
	if strings.Contains(strings.Join(criteriaTexts(got.Criteria), "\n"), "DO NOT SEND") {
		t.Fatal("ignored criteria_text leaked into resolution")
	}
}

func TestBriefExtractionRequiresExactSectionHeadings(t *testing.T) {
	body := `# Brief

Owned paths: packages/yakka/internal/review/

## Goal extra

This is not the Goal section.

## Contract

- Use tenant-scoped versions.

## Done evidence

- Fixture suite passes.
`
	if _, err := extractBrief(body); err == nil || !strings.Contains(err.Error(), "criteria_unavailable") {
		t.Fatalf("near-match heading should not satisfy Goal: %v", err)
	}
}

func TestResolveExplicitNoneAndNoCrossTenant(t *testing.T) {
	tnA, tnB := openCriteriaTenant(t), openCriteriaTenant(t)
	p := "docs/plans/23-demo/DESIGN.md"
	ingestArtifact(t, tnB, "repo-b", p, designFixture("other tenant", "other outcome"))
	if _, err := ResolveCriteria(context.Background(), tnA, CriteriaRequest{RepoID: "repo-b", Plan: "23-demo", Phase: "3"}); err == nil || !strings.Contains(err.Error(), "criteria_not_found") {
		t.Fatalf("cross-tenant lookup: %v", err)
	}
	none, err := ResolveCriteria(context.Background(), tnA, CriteriaRequest{RepoID: "repo-a"})
	if err != nil || none.CriteriaText != "criteria: none" || len(none.Criteria) != 0 || none.Record.Source != "none" {
		t.Fatalf("none marker: %+v %v", none, err)
	}
	text, err := ResolveCriteria(context.Background(), tnA, CriteriaRequest{RepoID: "repo-a", CriteriaText: []string{"one", "two"}})
	if err != nil || text.CriteriaText != "one\ntwo" || text.Record.Source != "explicit" || text.Record.ContentHash != keys.ContentHash([]byte("one\ntwo")) {
		t.Fatalf("explicit text: %+v %v", text, err)
	}
}

func TestResolveRefusalCodesAndRejectedFallback(t *testing.T) {
	tn := openCriteriaTenant(t)
	ctx := context.Background()
	put := func(repo, folder, body string) string {
		return ingestArtifact(t, tn, repo, "docs/plans/"+folder+"/DESIGN.md", body)
	}
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "missing", Phase: "3"}); err == nil || !strings.Contains(err.Error(), "criteria_not_found") {
		t.Errorf("criteria_not_found: got %v", err)
	}
	put("repo", "23-demo", designFixture("phase", "existing phase"))
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "23-demo", Phase: "99"}); err == nil || !strings.Contains(err.Error(), "phase_not_found") {
		t.Errorf("phase_not_found: got %v", err)
	}
	body := designFixture("duplicate", "first") + "\n### Phase 3 — Duplicate\n\n- Outcome: second\n- Surfaces: second\n"
	put("repo", "23-demo", body)
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "23-demo", Phase: "3"}); err == nil || !strings.Contains(err.Error(), "criteria_ambiguous") {
		t.Fatalf("duplicate phase: %v", err)
	}
	put("repo", "01-collision", designFixture("collision", "one"))
	put("repo", "02-collision", designFixture("collision", "two"))
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "collision", Phase: "3"}); err == nil || !strings.Contains(err.Error(), "criteria_ambiguous") {
		t.Fatalf("slug collision: %v", err)
	}
	// Use a different plan path to prove rejected newest content falls back to
	// the newest eligible version and that a rejected hash cannot be pinned.
	p := "docs/plans/23-fallback/DESIGN.md"
	old := ingestArtifact(t, tn, "repo", p, designFixture("old", "eligible body"))
	markScreen(t, tn, old, "pass")
	rejected := ingestArtifact(t, tn, "repo", p, designFixture("new", "rejected body"))
	rejectPending(t, tn, rejected)
	got, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "23-fallback", Phase: "3"})
	if err != nil || got.Record.ContentHash != old {
		t.Fatalf("rejected version fallback: %+v %v", got, err)
	}
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "23-fallback", Phase: "3", ContentHash: strings.Repeat("a", 64)}); err == nil || !strings.Contains(err.Error(), "criteria_version_unknown") {
		t.Fatalf("unknown pin: %v", err)
	}
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "23-fallback", Phase: "3", ContentHash: rejected, AllowSuperseded: true}); err == nil || !strings.Contains(err.Error(), "criteria_unavailable") {
		t.Fatalf("rejected pin: %v", err)
	}
	rejectedOnlyPath := "docs/plans/23-rejected/DESIGN.md"
	rejectedOnly := ingestArtifact(t, tn, "repo", rejectedOnlyPath, designFixture("rejected", "no eligible content"))
	rejectPending(t, tn, rejectedOnly)
	if _, err := ResolveCriteria(ctx, tn, CriteriaRequest{RepoID: "repo", Plan: "23-rejected", Phase: "3"}); err == nil || !strings.Contains(err.Error(), "criteria_unavailable") {
		t.Fatalf("no eligible version: %v", err)
	}
}

func TestResolveUnavailableDisallowedPathsAndHeldVersions(t *testing.T) {
	tn := openCriteriaTenant(t)
	p := "docs/plans/23-demo/DESIGN.md"
	h := ingestArtifact(t, tn, "repo", p, designFixture("unavailable", "body"))
	if _, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo", Plan: "23-demo", Phase: "3", ContentHash: strings.Repeat("f", 64)}); err == nil || !strings.Contains(err.Error(), "criteria_version_unknown") {
		t.Fatalf("unknown version: %v", err)
	}
	if err := os.Remove(filepath.Join(tn.Dir(), "pending", h)); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo", Plan: "23-demo", Phase: "3"}); err == nil || !strings.Contains(err.Error(), "criteria_unavailable") {
		t.Fatalf("missing body: %v", err)
	}
	for _, forbidden := range []string{"docs/plans/23-demo/reports/run.md", "docs/plans/23-demo/briefs/remediation-fix.md", "docs/plans/23-demo/PLAN.md"} {
		if _, err := ResolveCriteria(context.Background(), tn, CriteriaRequest{RepoID: "repo", BriefPath: forbidden}); err == nil || !strings.Contains(err.Error(), "criteria_not_found") {
			t.Errorf("forbidden source %s: %v", forbidden, err)
		}
	}
}

func TestArtifactVersionReadIsPathScopedAndCarriesScreenMetadata(t *testing.T) {
	tn := openCriteriaTenant(t)
	p := "docs/plans/23-demo/DESIGN.md"
	h1 := ingestArtifact(t, tn, "repo-a", p, designFixture("v1", "one"))
	markScreen(t, tn, h1, "pass")
	h2 := ingestArtifact(t, tn, "repo-a", p, designFixture("v2", "two"))
	h3 := ingestArtifact(t, tn, "repo-a", p, designFixture("v3", "three"))
	markScreen(t, tn, h3, "flagged")
	h4 := ingestArtifact(t, tn, "repo-a", p, designFixture("v4", "four"))
	markScreen(t, tn, h4, "unscreened")
	h5 := ingestArtifact(t, tn, "repo-a", p, designFixture("v5", "five"))
	rejectPending(t, tn, h5)
	ingestArtifact(t, tn, "repo-b", p, designFixture("other", "tenant"))
	versions, err := tn.ArtifactVersions(context.Background(), "repo-a", p)
	if err != nil || len(versions) != 5 || versions[0].ContentHash != h5 || versions[0].Rejection == nil || versions[0].Body != nil || screenState(versions[0]) != "rejected" || versions[1].ContentHash != h4 || screenState(versions[1]) != "unscreened" || versions[2].ContentHash != h3 || string(versions[2].Body) != designFixture("v3", "three") || screenState(versions[2]) != "flagged" || versions[3].ContentHash != h2 || !versions[3].Pending || screenState(versions[3]) != "pending" || versions[4].ContentHash != h1 || screenState(versions[4]) != "pass" {
		t.Fatalf("artifact version metadata/body: %+v err=%v", versions, err)
	}
	paths, err := tn.PlanDesignPaths(context.Background(), "repo-a", 10)
	if err != nil || len(paths) != 1 || paths[0] != p {
		t.Fatalf("repo-scoped design paths: %v %v", paths, err)
	}
}
