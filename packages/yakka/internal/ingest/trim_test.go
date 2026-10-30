package ingest

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestTrimListMatchesPlugin asserts the OpenCode plugin's trim-list equals the Go table's
// OpenCode Trimmed entries.
func TestTrimListMatchesPlugin(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "opencode-yakka-hooks", "src", "index.ts"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(src)
	b, e := strings.Index(s, "// trim-list:begin"), strings.Index(s, "// trim-list:end")
	if b < 0 || e < b {
		t.Fatal("trim-list markers not found")
	}
	var plugin []string
	for _, m := range regexp.MustCompile(`"([^"]*)"`).FindAllStringSubmatch(s[b:e], -1) {
		plugin = append(plugin, m[1])
	}
	var goList []string
	for k, a := range policyTable {
		if k.harness == "opencode" && a == Trimmed {
			goList = append(goList, k.event)
		}
	}
	sort.Strings(plugin)
	sort.Strings(goList)
	if strings.Join(plugin, "\n") != strings.Join(goList, "\n") {
		t.Fatalf("trim lists differ:\n plugin %v\n go     %v", plugin, goList)
	}
}

const updatedWithDiffs = `{"id":"q#0","type":"hook_event","conversation_id":"c","harness":"opencode","event":"message.updated","ts":1,
  "payload":{"hook_event_name":"message.updated","event":{"properties":{"info":{"id":"m","summary":{"title":"t","diffs":[{"patch":"x"}]}}}}}}`

func decodeObj(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestTrimDeletesOnlyDiffs(t *testing.T) {
	obj := decodeObj(t, updatedWithDiffs)
	if !Trim(obj) {
		t.Fatal("Trim reported nothing removed")
	}
	got, _ := json.Marshal(obj)
	if strings.Contains(string(got), "diffs") || !strings.Contains(string(got), `"title":"t"`) || !strings.Contains(string(got), `"id":"m"`) {
		t.Fatalf("trimmed object: %s", got)
	}
	if Trim(obj) {
		t.Fatal("second Trim removed something")
	}
	for name, in := range map[string]string{
		"other event":   strings.Replace(updatedWithDiffs, `"event":"message.updated"`, `"event":"session.updated"`, 1),
		"other harness": strings.Replace(updatedWithDiffs, `"harness":"opencode"`, `"harness":"claude"`, 1),
		"not a hook":    strings.Replace(updatedWithDiffs, `"type":"hook_event"`, `"type":"commit"`, 1),
		"no summary":    `{"type":"hook_event","harness":"opencode","event":"message.updated","payload":{"event":{"properties":{"info":{}}}}}`,
		"no payload":    `{"type":"hook_event","harness":"opencode","event":"message.updated"}`,
	} {
		if Trim(decodeObj(t, in)) {
			t.Errorf("%s: Trim changed the fact", name)
		}
	}
}

// A message.updated posted with diffs is stored and archived without them, under the same row hash
// as the same event posted with diffs already removed.
func TestIngestTrimsDiffsAndHashesTheTrimmedObject(t *testing.T) {
	without := strings.Replace(updatedWithDiffs, `,"diffs":[{"patch":"x"}]`, "", 1)
	if strings.Contains(without, "diffs") {
		t.Fatal("fixture still has diffs")
	}
	a, b := open(t), open(t)
	if _, err := Ingest(context.Background(), a, []json.RawMessage{json.RawMessage(updatedWithDiffs)}); err != nil {
		t.Fatal(err)
	}
	res, err := Ingest(context.Background(), b, []json.RawMessage{json.RawMessage(without)})
	if err != nil || len(res) != 1 || res[0].Status != Accepted {
		t.Fatalf("ingest without diffs: %v %+v", err, res)
	}
	hash := func(dir string) string {
		t.Helper()
		files, _ := filepath.Glob(filepath.Join(dir, "archive", "*", "*"))
		if len(files) != 1 {
			t.Fatalf("archive files %v", files)
		}
		lines := rawArchiveLines(t, dir)
		if len(lines) != 1 {
			t.Fatalf("archive lines %d", len(lines))
		}
		if strings.Contains(string(lines[0].Fact), "diffs") {
			t.Fatalf("archived fact still has diffs: %s", lines[0].Fact)
		}
		return lines[0].RowHash
	}
	if ha, hb := hash(a.Dir()), hash(b.Dir()); ha != hb {
		t.Fatalf("row hashes differ: %s vs %s", ha, hb)
	}
	// Reposting the untrimmed form to the same tenant is a duplicate.
	res, err = Ingest(context.Background(), b, []json.RawMessage{json.RawMessage(updatedWithDiffs)})
	if err != nil || res[0].Status != Duplicate {
		t.Fatalf("untrimmed repost: %v %+v", err, res)
	}
}
