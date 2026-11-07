package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func TestArtifactEntitiesMembershipLifetimeVersionAndHistory(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	ctx := context.Background()
	base := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	add := func(conv, repo, path, body string, ts int64) {
		raw, _ := json.Marshal(map[string]any{"type": "artifact_version", "conversation_id": conv, "repo_id": repo, "path": path, "content": body})
		hash := keys.ContentHash([]byte(body))
		rh, _ := keys.RowHash(raw)
		_, err := tn.Append(ctx, []FactRow{{RowHash: rh, Raw: raw, Type: "artifact_version", ConversationID: conv, RepoID: repo, Path: path, ContentHash: hash, TS: float64(ts), Source: "worktree"}})
		if err != nil {
			t.Fatal(err)
		}
	}
	add("writer", "r1", "docs/plans/p/DESIGN.md", "same", base.Unix()-100)
	add("later", "r1", "docs/plans/p/DESIGN.md", "same", base.Unix()-50)
	add("other", "r2", "docs/plans/p/DESIGN.md", "same", base.Unix()-25)
	add("new", "r1", "docs/plans/p/DESIGN.md", "new", base.Unix()+10)
	if _, err := tn.rdb.ExecContext(ctx, `UPDATE facts SET received_at=9000000000 WHERE type='artifact_version' AND repo_id='r1' AND path='docs/plans/p/DESIGN.md'`); err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: base, To: base.Add(time.Hour)}
	count, err := tn.ArtifactEntityCount(ctx, f, nil)
	if err != nil || count != 1 {
		t.Fatalf("membership count=%d err=%v", count, err)
	}
	page, more, err := tn.ArtifactEntitiesPage(ctx, f, nil, "last_ts", true, nil, 10)
	if err != nil || more || len(page) != 1 {
		t.Fatalf("page=%+v more=%v err=%v", page, more, err)
	}
	if page[0].RepoID != "r1" || page[0].Versions != 1 || page[0].ConversationID != "new" {
		t.Fatalf("entity=%+v", page[0])
	}
	allCount, err := tn.ArtifactEntityCount(ctx, AnalyticsFilter{From: base.Add(-time.Hour), To: base.Add(time.Hour)}, nil)
	if err != nil || allCount != 2 {
		t.Fatalf("same path in two repos must remain two artifact identities: n=%d err=%v", allCount, err)
	}
	history, more, err := tn.ArtifactVersionHistory(ctx, "r1", "docs/plans/p/DESIGN.md", nil, "", 10)
	if err != nil || more || len(history) != 2 {
		t.Fatalf("history=%+v more=%v err=%v", history, more, err)
	}
	var old ArtifactVersion
	for _, v := range history {
		if v.Hash == keys.ContentHash([]byte("same")) {
			old = v
		}
	}
	if old.ConversationID != "writer" || old.AlsoSeen != 1 {
		t.Fatalf("repeated save attribution=%+v", old)
	}
	if history[0].Hash > history[1].Hash {
		t.Fatalf("equal-receive-time history must use content_hash ascending: %s then %s", history[0].Hash, history[1].Hash)
	}
}
