package serve

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/screen"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const briefPath = "docs/plans/01-x/briefs/1-01-a.md"

var scoreRE = regexp.MustCompile(`score=([0-9.]+)`)

// contentScorer flags content containing FLAGME and scores check "q.a" from "score=X" in the content.
type contentScorer struct{}

func (contentScorer) Name() string { return "fake" }
func (contentScorer) Screen(_ context.Context, c []byte, _ []string) (scorer.Verdict, error) {
	return scorer.Verdict{Flag: strings.Contains(string(c), "FLAGME"), Reason: "screen:test"}, nil
}
func (contentScorer) Score(_ context.Context, c []byte, _ []string) ([]scorer.Score, error) {
	m := scoreRE.FindSubmatch(c)
	if m == nil {
		return nil, nil
	}
	v, _ := strconv.ParseFloat(string(m[1]), 64)
	return []scorer.Score{{Check: "q.a", Result: v}}, nil
}

// readStep screens through contentScorer, except content containing UNSCREENED, which is promoted
// as unscreened.
func readStep(ctx context.Context, t *store.Tenant, hash string) error {
	if b, err := t.ReadPending(hash); err == nil && strings.Contains(string(b), "UNSCREENED") {
		return t.Promote(ctx, hash, store.Screen{Verdict: "unscreened"})
	}
	return screen.Step(contentScorer{})(ctx, t, hash)
}

func getJSON(t *testing.T, s *Server, key, u string) (int, map[string]any, string) {
	t.Helper()
	code, body := do(t, s.Handler(), "GET", u, key, "")
	var m map[string]any
	_ = json.Unmarshal([]byte(body), &m)
	return code, m, body
}

func artURL(path string) string {
	return "/v1/artifacts?repo_id=r&path=" + url.QueryEscape(path)
}

// settled waits until the latest version of path has a screen or a rejection.
func settled(t *testing.T, s *Server, path string) {
	t.Helper()
	waitFor(t, "settled "+path, func() bool {
		_, m, _ := getJSON(t, s, "ka", artURL(path))
		l, _ := m["latest"].(map[string]any)
		return l != nil && (l["screen"] != nil || l["rejection"] != nil)
	})
}

func putSettled(t *testing.T, s *Server, path, content string) {
	t.Helper()
	post(t, s, path, content)
	waitFor(t, "ingest "+path, func() bool {
		_, m, _ := getJSON(t, s, "ka", artURL(path))
		l, _ := m["latest"].(map[string]any)
		return l != nil && l["content_hash"] == keys.ContentHash([]byte(content))
	})
	settled(t, s, path)
	// the latest version's screen may be the previous one's until the new hash settles
	h := keys.ContentHash([]byte(content))
	waitFor(t, "settled hash "+path, func() bool {
		_, m, _ := getJSON(t, s, "ka", artURL(path))
		l := m["latest"].(map[string]any)
		return l["content_hash"] == h && (l["screen"] != nil || l["rejection"] != nil)
	})
}

func hits(t *testing.T, s *Server, key, q string) []map[string]any {
	t.Helper()
	code, m, body := getJSON(t, s, key, "/v1/search?"+q)
	if code != 200 {
		t.Fatalf("search %s: %d %s", q, code, body)
	}
	var out []map[string]any
	for _, h := range m["hits"].([]any) {
		out = append(out, h.(map[string]any))
	}
	return out
}

func TestAdvisoryReads(t *testing.T) {
	checks, err := scorer.LoadChecks("../../catalogue")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	mk := func(c *scorer.Checks) *Server {
		s := New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}, {"b", "kb"}}},
			Options{PollInterval: 20 * time.Millisecond, ScreenStep: readStep, Checks: c})
		t.Cleanup(func() { s.Close() })
		return s
	}
	s := mk(&checks)
	d := func(n int) string { return fmt.Sprintf("docs/plans/%02d-x/DESIGN.md", n) }

	// Data shared by the subtests, in order.
	putSettled(t, s, d(1), "# one score=0.1 zebrafinch\n")
	putSettled(t, s, d(2), "# two score=0.3\n")
	putSettled(t, s, d(3), "# three score=0.5\n")
	putSettled(t, s, d(4), "# four score=0.7\n")
	putSettled(t, s, d(5), "# five score=0.0 oldversion\n")
	putSettled(t, s, d(5), "# five score=0.9\n")
	putSettled(t, s, briefPath, "# brief UNSCREENED quokka\n")
	putSettled(t, s, "docs/plans/09-x/DESIGN.md", "# secret FLAGME narwhal\n")

	t.Run("artifacts shape", func(t *testing.T) {
		code, m, body := getJSON(t, s, "ka", artURL(d(1)))
		if code != 200 {
			t.Fatal(code, body)
		}
		t.Logf("artifact: %s", strings.TrimSpace(body))
		for _, k := range []string{"repo_id", "path", "kind"} {
			if _, ok := m[k].(string); !ok {
				t.Fatalf("%s not a string: %s", k, body)
			}
		}
		if v, ok := m["versions"].(float64); !ok || v != 1 {
			t.Fatalf("versions: %s", body)
		}
		l := m["latest"].(map[string]any)
		for _, k := range []string{"content_hash", "received_at", "conversation_id", "source"} {
			if _, ok := l[k].(string); !ok {
				t.Fatalf("latest.%s not a string: %s", k, body)
			}
		}
		sc := l["screen"].(map[string]any)
		for _, k := range []string{"verdict", "scorer", "at"} {
			if _, ok := sc[k].(string); !ok {
				t.Fatalf("screen.%s: %s", k, body)
			}
		}
		if ss, ok := l["scores"].([]any); !ok || len(ss) != 1 {
			t.Fatalf("scores: %s", body)
		}
		if v, present := l["rejection"]; !present || v != nil {
			t.Fatalf("rejection should be null: %s", body)
		}
		_, fm, fbody := getJSON(t, s, "ka", artURL("docs/plans/09-x/DESIGN.md"))
		t.Logf("flagged artifact: %s", strings.TrimSpace(fbody))
		rj, ok := fm["latest"].(map[string]any)["rejection"].(map[string]any)
		if !ok || rj["stage"] != "screen" || rj["reason"] != "screen:test" || rj["at"] == "" {
			t.Fatalf("flagged rejection: %s", fbody)
		}
		if code, _, _ := getJSON(t, s, "ka", artURL("docs/plans/77-x/DESIGN.md")); code != 404 {
			t.Fatalf("unknown path: %d", code)
		}
	})

	t.Run("checks", func(t *testing.T) {
		code, m, body := getJSON(t, s, "ka", "/v1/checks?kind=report")
		if code != 200 || m["loaded"] != true {
			t.Fatal(code, body)
		}
		cs := m["checks"].([]any)
		if len(cs) != 5 {
			t.Fatalf("report checks %d", len(cs))
		}
		c0 := cs[0].(map[string]any)
		if _, ok := c0["q"].(string); !ok {
			t.Fatal(c0)
		}
		if _, ok := c0["levels"].([]any); !ok {
			t.Fatal(c0)
		}
		if _, ok := c0["invert"].(bool); !ok {
			t.Fatal(c0)
		}
		if c0["kind"] != "report" || c0["name"] == "" {
			t.Fatal(c0)
		}
		_, all, _ := getJSON(t, s, "ka", "/v1/checks")
		if n := len(all["checks"].([]any)); n != 27 {
			t.Fatalf("all checks %d", n)
		}
		if first := all["checks"].([]any)[0].(map[string]any)["kind"]; first != "design" {
			t.Fatalf("first kind %v", first)
		}
		code, _, body = getJSON(t, s, "ka", "/v1/checks?kind=x")
		if code != 400 || !strings.Contains(body, "kind must be design, brief or report") {
			t.Fatal(code, body)
		}
		s2 := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
		defer s2.Close()
		code, body = do(t, s2.Handler(), "GET", "/v1/checks", "ka", "")
		if code != 200 || strings.TrimSpace(body) != `{"checks":[],"loaded":false}` {
			t.Fatal(code, body)
		}
	})

	t.Run("baselines", func(t *testing.T) {
		code, m, body := getJSON(t, s, "ka", "/v1/baselines?kind=design")
		if code != 200 {
			t.Fatal(code, body)
		}
		t.Logf("baselines: %s", strings.TrimSpace(body))
		q := m["checks"].(map[string]any)["q.a"].(map[string]any)
		want := map[string]float64{"n": 5, "p25": 0.3, "median": 0.5, "p75": 0.7}
		for k, v := range want {
			if q[k] != v {
				t.Fatalf("%s=%v want %v: %s", k, q[k], v, body)
			}
		}
		if m["kind"] != "design" {
			t.Fatal(body)
		}
		code, content, body := getJSON(t, s, "ka", "/v1/baselines?kind=design&population=content&check=q.a")
		if code != 200 || content["population"] != "content" {
			t.Fatalf("content baseline: %d %s", code, body)
		}
		contentScorers := content["scorers"].(map[string]any)
		if len(contentScorers) != 1 {
			t.Fatalf("content baseline scorers=%v body=%s", contentScorers, body)
		}
		contentQ := contentScorers["fake"].(map[string]any)["q.a"].(map[string]any)
		if contentQ["n"] != float64(6) || contentQ["median"] != float64(.4) {
			t.Fatalf("content baseline q.a=%v body=%s", contentQ, body)
		}
		if code, _, _ := getJSON(t, s, "ka", "/v1/baselines"); code != 400 {
			t.Fatalf("missing kind: %d", code)
		}
		if code, _, _ := getJSON(t, s, "ka", "/v1/baselines?kind=x"); code != 400 {
			t.Fatalf("bad kind: %d", code)
		}
		_, em, ebody := getJSON(t, s, "ka", "/v1/baselines?kind=report")
		if strings.TrimSpace(ebody) != `{"checks":{},"kind":"report"}` {
			t.Fatalf("empty kind: %v", em)
		}
	})

	t.Run("content baseline latest scorer", func(t *testing.T) {
		hash := keys.ContentHash([]byte("# one score=0.1 zebrafinch\n"))
		tenant, err := s.tenant("a")
		if err != nil {
			t.Fatal(err)
		}
		if err := tenant.t.Promote(context.Background(), hash, store.Screen{Verdict: "pass", Scorer: "rescored-v2"}, store.Score{Check: "q.a", Result: .1, Scorer: "rescored-v2"}); err != nil {
			t.Fatal(err)
		}
		_, latest, body := getJSON(t, s, "ka", "/v1/baselines?kind=design&population=content&check=q.a&scorer=rescored-v2")
		byScorer := latest["scorers"].(map[string]any)
		q := byScorer["rescored-v2"].(map[string]any)["q.a"].(map[string]any)
		if q["n"] != float64(1) || q["median"] != float64(.1) {
			t.Fatalf("latest scorer baseline: %s", body)
		}
		_, old, body := getJSON(t, s, "ka", "/v1/baselines?kind=design&population=content&check=q.a&scorer=fake")
		if old["scorers"].(map[string]any)["fake"].(map[string]any)["q.a"].(map[string]any)["n"] != float64(5) {
			t.Fatalf("stale score revived into old scorer: %s", body)
		}
	})

	t.Run("search", func(t *testing.T) {
		h := hits(t, s, "ka", "q=zebrafinch")
		if len(h) != 1 || h[0]["kind"] != "design" || h[0]["path"] != d(1) || !strings.Contains(h[0]["snippet"].(string), "[zebrafinch]") {
			t.Fatalf("zebrafinch: %v", h)
		}
		if _, ok := h[0]["rank"].(float64); !ok || h[0]["content_hash"] == "" || h[0]["repo_id"] != "r" {
			t.Fatalf("hit fields: %v", h[0])
		}
		_, _, body := getJSON(t, s, "ka", "/v1/search?q=zebrafinch")
		t.Logf("search: %s", strings.TrimSpace(body))
		if h := hits(t, s, "ka", "q=quokka"); len(h) != 1 || h[0]["kind"] != "brief" {
			t.Fatalf("unscreened brief: %v", h)
		}
		if h := hits(t, s, "ka", "q=narwhal"); len(h) != 0 {
			t.Fatalf("flagged content found: %v", h)
		}
		if h := hits(t, s, "ka", "q=oldversion"); len(h) != 0 {
			t.Fatalf("superseded content found: %v", h)
		}
		// a newer version without the word: the path no longer hits
		putSettled(t, s, d(1), "# one again score=0.1 plain\n")
		if h := hits(t, s, "ka", "q=zebrafinch"); len(h) != 0 {
			t.Fatalf("old version still hits: %v", h)
		}
		// a copy: same content at a second path, never pending
		putSettled(t, s, "docs/plans/02-x/briefs/1-01-copy.md", "# one again score=0.1 plain\n")
		if h := hits(t, s, "ka", "q=plain"); len(h) != 2 {
			t.Fatalf("copy not found: %v", h)
		}
		if h := hits(t, s, "ka", "q=plain&kind=brief"); len(h) != 1 || h[0]["kind"] != "brief" {
			t.Fatalf("kind filter: %v", h)
		}
		if h := hits(t, s, "ka", "q=plain&limit=1"); len(h) != 1 {
			t.Fatalf("limit: %v", h)
		}
		if code, _, _ := getJSON(t, s, "ka", "/v1/search?q="+url.QueryEscape("(*:")); code != 400 {
			t.Fatalf("junk q: %d", code)
		}
		if code, _, _ := getJSON(t, s, "ka", "/v1/search?q=plain&limit=x"); code != 400 {
			t.Fatalf("bad limit: %d", code)
		}
		if code, _, _ := getJSON(t, s, "ka", "/v1/search?q=plain&kind=x"); code != 400 {
			t.Fatalf("bad kind: %d", code)
		}
		// punctuation inside an otherwise good query never reaches MATCH raw
		if code, _, body := getJSON(t, s, "ka", "/v1/search?q="+url.QueryEscape(`plain" OR "x* NEAR(`)); code != 200 {
			t.Fatalf("quoted junk: %d %s", code, body)
		}
		if _, _, body := getJSON(t, s, "ka", "/v1/search?q=nothingmatches"); strings.TrimSpace(body) != `{"hits":[]}` {
			t.Fatalf("no hits: %s", body)
		}
	})

	t.Run("tenant scope", func(t *testing.T) {
		if code, _, _ := getJSON(t, s, "kb", artURL(d(2))); code != 404 {
			t.Fatalf("artifact: %d", code)
		}
		_, m, body := getJSON(t, s, "kb", "/v1/baselines?kind=design")
		if len(m["checks"].(map[string]any)) != 0 {
			t.Fatalf("baselines: %s", body)
		}
		if h := hits(t, s, "kb", "q=plain"); len(h) != 0 {
			t.Fatalf("search: %v", h)
		}
		for _, p := range []string{artURL(d(2)), "/v1/checks", "/v1/baselines?kind=design", "/v1/search?q=plain"} {
			if code, _ := do(t, s.Handler(), "GET", p, "", ""); code != 401 {
				t.Fatalf("%s no key: %d", p, code)
			}
			if code, _ := do(t, s.Handler(), "GET", p, "wrong", ""); code != 401 {
				t.Fatalf("%s wrong key: %d", p, code)
			}
			if code, _ := do(t, s.Handler(), "POST", p, "ka", ""); code != 405 {
				t.Fatalf("%s POST: %d", p, code)
			}
		}
	})

	t.Run("backfill", func(t *testing.T) {
		bdir := t.TempDir()
		content := "# old tenant pangolin\n"
		hash := keys.ContentHash([]byte(content))
		// create the tenant with the current store, then step it back to a version-1 database
		tn, err := store.Open(filepath.Join(bdir, "a"), store.Options{})
		if err != nil {
			t.Fatal(err)
		}
		raw := []byte(fmt.Sprintf(`{"type":"artifact_version","source":"worktree","content_hash":%q}`, hash))
		if _, err := tn.Append(context.Background(), []store.FactRow{{RowHash: keys.ContentHash(raw), Type: "artifact_version", ConversationID: "c",
			Harness: "h", Event: "w", TS: 1, RepoID: "r", Path: d(1), ContentHash: hash, Raw: raw}}); err != nil {
			t.Fatal(err)
		}
		if err := tn.WritePending(hash, []byte(content)); err != nil {
			t.Fatal(err)
		}
		if err := tn.Promote(context.Background(), hash, store.Screen{Verdict: "unscreened"}); err != nil {
			t.Fatal(err)
		}
		tn.Close()
		db, err := sql.Open("sqlite", "file:"+filepath.Join(bdir, "a", "ledger.db"))
		if err != nil {
			t.Fatal(err)
		}
		// undo migrations 2-4 so the file is a real version-1 database
		steps := []string{`DROP TABLE search`, `DROP INDEX facts_ts`, `DROP INDEX facts_type_ts`,
			`DROP INDEX facts_ts_harness_event`, `DROP INDEX facts_usage_ts`, `DROP INDEX rejections_at`}
		for _, c := range []string{"norm_event", "tool", "model", "kind", "plan", "source", "sha", "tok_in", "tok_out",
			"tok_cache_read", "tok_cache_write", "tok_reasoning", "cost_reported"} {
			steps = append(steps, `ALTER TABLE facts DROP COLUMN `+c)
		}
		for _, q := range append(steps, `PRAGMA user_version = 1`) {
			if _, err := db.Exec(q); err != nil {
				t.Fatal(q, err)
			}
		}
		db.Close()
		bs := New(Config{Data: bdir, Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
		defer bs.Close()
		h := hits(t, bs, "ka", "q=pangolin")
		if len(h) != 1 || h[0]["content_hash"] != hash {
			t.Fatalf("backfill: %v", h)
		}
	})
}
