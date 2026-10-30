package ingest

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/archive"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/klauspost/compress/zstd"
)

// TestRemoveListMatchesPlugin asserts the OpenCode plugin's remove-list equals the Go table's
// OpenCode Remove entries.
func TestRemoveListMatchesPlugin(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "opencode-yakka-hooks", "src", "index.ts"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(src)
	b, e := strings.Index(s, "// remove-list:begin"), strings.Index(s, "// remove-list:end")
	if b < 0 || e < b {
		t.Fatal("remove-list markers not found")
	}
	var plugin []string
	for _, m := range regexp.MustCompile(`"([^"]*)"`).FindAllStringSubmatch(s[b:e], -1) {
		plugin = append(plugin, m[1])
	}
	var goList []string
	for k, a := range policyTable {
		if k.harness == "opencode" && a == Remove {
			goList = append(goList, k.event)
		}
	}
	sort.Strings(plugin)
	sort.Strings(goList)
	if strings.Join(plugin, "\n") != strings.Join(goList, "\n") {
		t.Fatalf("remove lists differ:\n plugin %v\n go     %v", plugin, goList)
	}
}

type rawFixture struct {
	Facts  []json.RawMessage `json:"facts"`
	Expect []struct {
		ID     string `json:"id"`
		Policy string `json:"policy"`
	} `json:"expect"`
}

func loadRawFixture(t *testing.T) rawFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "hooklog", "tests", "fixtures", "ingest_policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx rawFixture
	if err := json.Unmarshal(b, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

// rawArchiveLines decodes every archive file of the tenant, without dedupe.
func rawArchiveLines(t *testing.T, dir string) []archive.Line {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(dir, "archive", "*", "*"))
	var out []archive.Line
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		zr, err := zstd.NewReader(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		dec, err := io.ReadAll(zr)
		zr.Close()
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range bytes.Split(bytes.TrimSpace(dec), []byte("\n")) {
			var ln archive.Line
			if err := json.Unmarshal(l, &ln); err != nil {
				t.Fatal(err)
			}
			out = append(out, ln)
		}
	}
	return out
}

func TestIngestPolicyFixture(t *testing.T) {
	fx := loadRawFixture(t)
	full := loadPolicyFixture(t)
	tn := open(t)
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(tn.Dir(), "ledger.db")+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRowContext(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(q, err)
		}
		return n
	}

	res, err := Ingest(ctx, tn, fx.Facts)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != len(fx.Facts) {
		t.Fatalf("results %d", len(res))
	}
	policy := map[string]string{}
	for _, e := range fx.Expect {
		policy[e.ID] = e.Policy
	}
	removeEvents := map[string]bool{}
	var nonRemove int
	for i, r := range res {
		f := full.Facts[i]
		if r.Status != Accepted || r.ID != f.ID {
			t.Fatalf("first send %d: %+v want accepted", i, r)
		}
		if p := policy[f.ID]; p == "remove" {
			removeEvents[f.Event] = true
		} else {
			nonRemove++
		}
	}
	if len(removeEvents) != 5 {
		t.Fatalf("remove events in fixture: %v", removeEvents)
	}

	// (a) removed events leave no fact row and no archive line.
	for ev := range removeEvents {
		if n := count(`SELECT count(*) FROM facts WHERE harness='opencode' AND event=?`, ev); n != 0 {
			t.Fatalf("removed %s stored %d rows", ev, n)
		}
	}
	for _, l := range rawArchiveLines(t, tn.Dir()) {
		if bytes.Contains(l.Fact, []byte("FAKE-NOT-A-SECRET")) {
			t.Fatalf("removed event archived: %s", l.Fact)
		}
	}

	// (b) message.part.delta is removed: no fact row and no archive line, keyed or keyless.
	if n := count(`SELECT count(*) FROM facts WHERE event='message.part.delta'`); n != 0 {
		t.Fatalf("delta rows %d want 0", n)
	}

	// (e) no stored hook fact carries a payload.
	if n := count(`SELECT count(*) FROM facts WHERE type='hook_event' AND instr(raw,'"payload"')>0`); n != 0 {
		t.Fatalf("%d hook rows keep payload", n)
	}

	// (f) extracted columns equal the fixture expect; per-harness sums equal expect_totals.
	type sums struct{ in, out, cr, cw, rs int64 }
	got := map[string]*sums{}
	seenHash := map[string]bool{}
	for i, f := range full.Facts {
		e := full.Expect[i]
		if e.Policy == "remove" {
			continue
		}
		rh, _ := keys.RowHash(fx.Facts[i])
		var ne, tool, model string
		var in, out, cr, cw, rs int64
		var cost *float64
		if err := db.QueryRowContext(ctx, `SELECT norm_event,tool,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported
			FROM facts WHERE row_hash=?`, rh).Scan(&ne, &tool, &model, &in, &out, &cr, &cw, &rs, &cost); err != nil {
			t.Fatalf("%s: %v", f.ID, err)
		}
		if ne != e.NormEvent || tool != e.Tool || model != e.Model || in != e.TokIn || out != e.TokOut ||
			cr != e.TokCacheRead || cw != e.TokCacheWr || rs != e.TokReasoning ||
			(cost == nil) != (e.CostReported == nil) || (cost != nil && *cost != *e.CostReported) {
			t.Fatalf("%s columns: %s %s %s %d %d %d %d %d %v; want %+v", f.ID, ne, tool, model, in, out, cr, cw, rs, cost, e)
		}
		// Sum per model call: Claude usage repeats by message_id, which the fixture totals dedupe.
		key := rh
		if mid, ok := f.Payload["message_id"].(string); ok && f.Harness == "claude" && mid != "" {
			key = "claude:" + mid
		}
		if seenHash[key] {
			continue
		}
		seenHash[key] = true
		s := got[f.Harness]
		if s == nil {
			s = &sums{}
			got[f.Harness] = s
		}
		s.in, s.out, s.cr, s.cw, s.rs = s.in+in, s.out+out, s.cr+cr, s.cw+cw, s.rs+rs
	}
	for h, w := range full.ExpectTotals {
		s := got[h]
		if s == nil {
			s = &sums{}
		}
		if s.in != w.TokIn || s.out != w.TokOut || s.cr != w.TokCacheRead || s.cw != w.TokCacheWr || s.rs != w.TokReasoning {
			t.Fatalf("%s totals %+v want %+v", h, *s, w)
		}
	}

	// (d) archive: a line per received non-remove fact, own hash, fact byte-equal to canonical.
	checkArchive := func(round int) {
		t.Helper()
		want := map[string][]byte{}
		convs := map[string]bool{}
		for i := range full.Facts {
			if full.Expect[i].Policy == "remove" {
				continue
			}
			rh, _ := keys.RowHash(fx.Facts[i])
			c, _ := keys.Canonical(fx.Facts[i])
			want[rh] = c
			var cv struct {
				C string `json:"conversation_id"`
			}
			json.Unmarshal(fx.Facts[i], &cv)
			convs[cv.C] = true
		}
		if len(want) != nonRemove {
			t.Fatalf("non-remove facts share envelope hashes: %d vs %d", len(want), nonRemove)
		}
		seen := map[string]bool{}
		for c := range convs {
			lines, err := archive.Read(tn.Dir(), c)
			if err != nil {
				t.Fatal(err)
			}
			for _, l := range lines {
				if seen[l.RowHash] {
					t.Fatalf("round %d: Read returned %s twice", round, l.RowHash)
				}
				seen[l.RowHash] = true
				if w, ok := want[l.RowHash]; !ok || !bytes.Equal(w, l.Fact) {
					t.Fatalf("round %d: archive line %s fact\n %s\nwant\n %s", round, l.RowHash, l.Fact, w)
				}
			}
		}
		if len(seen) != len(want) {
			t.Fatalf("round %d: archive has %d distinct lines, want %d", round, len(seen), len(want))
		}
		if raw := rawArchiveLines(t, tn.Dir()); len(raw) != round*nonRemove {
			t.Fatalf("round %d: raw archive lines %d want %d", round, len(raw), round*nonRemove)
		}
	}
	checkArchive(1)

	// (c) resending the batch: duplicate for every non-remove fact, accepted for remove.
	before := count(`SELECT count(*) FROM facts`)
	res, err = Ingest(ctx, tn, fx.Facts)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range res {
		want := Duplicate
		if full.Expect[i].Policy == "remove" {
			want = Accepted
		}
		if r.Status != want {
			t.Fatalf("resend %s: %+v want %s", full.Facts[i].ID, r, want)
		}
	}
	if after := count(`SELECT count(*) FROM facts`); after != before {
		t.Fatalf("resend added rows: %d -> %d", before, after)
	}
	checkArchive(2)
}

// (g) a hook body containing a secret is rejected and not archived.
func TestIngestSecretHookNotArchived(t *testing.T) {
	tn := open(t)
	f := map[string]any{"id": "s#0", "type": "hook_event", "conversation_id": "sec", "harness": "opencode", "event": "tool.execute.after", "ts": 5,
		"payload": map[string]any{"event": map[string]any{"properties": map[string]any{"messageID": "m", "partID": "p", "field": "text", "delta": "k " + secretText()}}}}
	res, err := Ingest(context.Background(), tn, marshal(t, f))
	if err != nil {
		t.Fatal(err)
	}
	if res[0].Status != Rejected || !strings.HasPrefix(res[0].Reason, "precheck: ") {
		t.Fatalf("%+v", res[0])
	}
	if lines, _ := archive.Read(tn.Dir(), "sec"); len(lines) != 0 {
		t.Fatalf("secret archived: %d lines", len(lines))
	}
	if n := len(rawArchiveLines(t, tn.Dir())); n != 0 {
		t.Fatalf("archive files hold %d lines", n)
	}
}
