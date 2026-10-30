// Package ingest validates, prechecks and stores a batch of facts for one tenant (design 3 Ingest).
//
// Fact wire shape: a JSON object. Common keys: id (the drain's "<queue file>#<n>", echoed in the
// result, never hashed or stored), type ("hook_event" | "artifact_version" | "commit"),
// conversation_id, harness, event, ts (Unix seconds, number).
//
//	hook_event:       payload (object, already scrubbed by the client)
//	artifact_version: repo_id, path, content_hash, content (the file's UTF-8 bytes as a string),
//	                  source ("worktree" | "commit")
//	commit:           repo_id, sha, paths ([]string), renames ([]{"from","to"})
//
// Unknown keys are kept in the stored raw JSON. Per fact the order is: validate; for hook_event the
// event policy (policy.go: a Remove fact is answered accepted and leaves nothing); precheck every
// string leaf with secrets.Scan; row hash; WritePending for artifact content; an archive entry for
// hook events. Then one archive.Append for the batch's hook
// events, then one Append for its rows. A stored hook_event raw is the canonical envelope without
// payload; the archive line holds the full canonical received fact.
package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/archive"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/secrets"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// Result statuses.
const (
	Accepted  = "accepted"
	Duplicate = "duplicate"
	Rejected  = "rejected"
)

// Result is the outcome of one fact.
type Result struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

// Rename is one entry of a commit fact's renames.
type Rename struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Fact documents the envelope; Ingest itself reads facts as generic objects so unknown keys survive.
type Fact struct {
	ID             string         `json:"id"`
	Type           string         `json:"type"`
	ConversationID string         `json:"conversation_id"`
	Harness        string         `json:"harness"`
	Event          string         `json:"event"`
	TS             float64        `json:"ts"`
	Payload        map[string]any `json:"payload,omitempty"`
	RepoID         string         `json:"repo_id,omitempty"`
	Path           string         `json:"path,omitempty"`
	ContentHash    string         `json:"content_hash,omitempty"`
	Content        string         `json:"content,omitempty"`
	Source         string         `json:"source,omitempty"`
	SHA            string         `json:"sha,omitempty"`
	Paths          []string       `json:"paths,omitempty"`
	Renames        []Rename       `json:"renames,omitempty"`
}

func str(m map[string]any, k string) (string, bool) {
	s, ok := m[k].(string)
	return s, ok
}

func invalid(format string, a ...any) string { return "invalid: " + fmt.Sprintf(format, a...) }

// Precheck scans every string leaf of obj (sorted keys, recursive) and returns a reason for the
// first hit, or "". The reason never contains the matched text.
func Precheck(obj map[string]any) string {
	if s, ok := str(obj, "content"); ok {
		if h := secrets.Scan(s); len(h) > 0 {
			return fmt.Sprintf("precheck: %s at line %d", h[0].Pattern, h[0].Line)
		}
	}
	return walk(obj, "", true)
}

func walk(v any, path string, top bool) string {
	switch x := v.(type) {
	case string:
		if h := secrets.Scan(x); len(h) > 0 {
			return fmt.Sprintf("precheck: %s in %s line %d", h[0].Pattern, path, h[0].Line)
		}
	case map[string]any:
		ks := make([]string, 0, len(x))
		for k := range x {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		for _, k := range ks {
			if top && k == "content" {
				continue
			}
			p := k
			if path != "" {
				p = path + "." + k
			}
			if r := walk(x[k], p, false); r != "" {
				return r
			}
		}
	case []any:
		for i, e := range x {
			if r := walk(e, path+"["+strconv.Itoa(i)+"]", false); r != "" {
				return r
			}
		}
	}
	return ""
}

func validate(obj map[string]any) string {
	typ, _ := str(obj, "type")
	conv, _ := str(obj, "conversation_id")
	switch typ {
	case "hook_event", "artifact_version", "commit":
	default:
		return invalid("unknown type")
	}
	if conv == "" {
		return invalid("empty conversation_id")
	}
	if v, ok := obj["ts"]; ok {
		if _, isNum := v.(json.Number); !isNum {
			return invalid("ts is not a number")
		}
	}
	for _, k := range []string{"harness", "event"} {
		if v, ok := obj[k]; ok {
			if _, isStr := v.(string); !isStr {
				return invalid("%s is not a string", k)
			}
		}
	}
	switch typ {
	case "artifact_version":
		for _, k := range []string{"repo_id", "path", "content_hash", "content"} {
			if s, ok := str(obj, k); !ok || (s == "" && k != "content") {
				return invalid("artifact_version needs %s", k)
			}
		}
		c, _ := str(obj, "content")
		if h, _ := str(obj, "content_hash"); h != keys.ContentHash([]byte(c)) {
			return invalid("content_hash does not match content")
		}
	case "commit":
		for _, k := range []string{"repo_id", "sha"} {
			if s, ok := str(obj, k); !ok || s == "" {
				return invalid("commit needs %s", k)
			}
		}
	}
	return ""
}

// Ingest processes facts for tenant. An error is a whole-request failure.
func Ingest(ctx context.Context, tenant *store.Tenant, facts []json.RawMessage) ([]Result, error) {
	results := make([]Result, len(facts))
	var rows []store.FactRow
	var rowIdx []int
	var entries []archive.Entry
	receivedAt := time.Now().UnixNano()
	for i, raw := range facts {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var obj map[string]any
		if err := dec.Decode(&obj); err != nil || obj == nil {
			results[i] = Result{Status: Rejected, Reason: invalid("not an object")}
			continue
		}
		id, _ := str(obj, "id")
		results[i].ID = id
		if r := validate(obj); r != "" {
			results[i].Status, results[i].Reason = Rejected, r
			continue
		}
		typ, _ := str(obj, "type")
		harness, _ := str(obj, "harness")
		event, _ := str(obj, "event")
		payload, _ := obj["payload"].(map[string]any)
		action := Keep
		if typ == "hook_event" {
			action = Policy(harness, event, payload)
			if action == Remove {
				results[i].Status = Accepted
				continue
			}
			if action == Trimmed && Trim(obj) {
				// Hash and archive the trimmed object, not the received bytes.
				var buf bytes.Buffer
				enc := json.NewEncoder(&buf)
				enc.SetEscapeHTML(false)
				if err := enc.Encode(obj); err != nil {
					results[i].Status, results[i].Reason = Rejected, invalid("cannot canonicalise fact")
					continue
				}
				raw = bytes.TrimRight(buf.Bytes(), "\n")
			}
		}
		conv, _ := str(obj, "conversation_id")
		path, _ := str(obj, "path")
		chash, _ := str(obj, "content_hash")
		if r := Precheck(obj); r != "" {
			pat := r[len("precheck: "):]
			for j := 0; j < len(pat); j++ {
				if pat[j] == ' ' {
					pat = pat[:j]
					break
				}
			}
			if err := tenant.AppendRejection(ctx, store.Rejection{Stage: "precheck", FactType: typ,
				ConversationID: conv, Path: path, ContentHash: chash, Pattern: pat, Reason: r}); err != nil {
				return nil, err
			}
			results[i].Status, results[i].Reason = Rejected, r
			continue
		}
		rh, err := keys.RowHash(raw)
		if err != nil {
			results[i].Status, results[i].Reason = Rejected, invalid("cannot hash fact")
			continue
		}
		canon, err := keys.Canonical(raw)
		if err != nil {
			results[i].Status, results[i].Reason = Rejected, invalid("cannot canonicalise fact")
			continue
		}
		if typ == "artifact_version" {
			c, _ := str(obj, "content")
			if err := tenant.WritePending(chash, []byte(c)); err != nil {
				return nil, err
			}
		}
		var ts float64
		if n, ok := obj["ts"].(json.Number); ok {
			ts, _ = n.Float64()
		}
		repo, _ := str(obj, "repo_id")
		row := store.FactRow{RowHash: rh, Type: typ, ConversationID: conv, Harness: harness,
			Event: event, TS: ts, RepoID: repo, Path: path, ContentHash: chash, Raw: canon}
		if typ == "hook_event" {
			slim, err := envelope(obj)
			if err != nil {
				results[i].Status, results[i].Reason = Rejected, invalid("cannot canonicalise fact")
				continue
			}
			row.Raw = slim
			d := Derive(harness, event, payload)
			row.NormEvent, row.Tool, row.Model = d.NormEvent, d.Tool, d.Model
			row.TokIn, row.TokOut, row.TokCacheRead, row.TokCacheWrite, row.TokReasoning =
				d.TokIn, d.TokOut, d.TokCacheRead, d.TokCacheWrite, d.TokReasoning
			row.CostReported = d.CostReported
			entries = append(entries, archive.Entry{ConversationID: conv, TS: ts,
				Line: archive.Line{RowHash: rh, ReceivedAt: receivedAt, Fact: canon}})
		} else {
			row.Source, _ = str(obj, "source")
			row.SHA, _ = str(obj, "sha")
		}
		rows = append(rows, row)
		rowIdx = append(rowIdx, i)
	}
	if len(entries) > 0 {
		if err := archive.Append(tenant.Dir(), entries); err != nil {
			return nil, err
		}
	}
	if len(rows) > 0 {
		ins, err := tenant.Append(ctx, rows)
		if err != nil {
			return nil, err
		}
		for k, i := range rowIdx {
			if ins[k] {
				results[i].Status = Accepted
			} else {
				results[i].Status = Duplicate
			}
		}
	}
	return results, nil
}

// Envelope is the exported form of envelope for the offline compaction engine: the canonical JSON
// of a hook fact as stored, the received object without its top-level id, content and payload keys.
func Envelope(obj map[string]any) ([]byte, error) { return envelope(obj) }

// envelope is the canonical JSON of a hook fact as stored: the received object without its
// top-level id, content and payload keys, encoded as keys.Canonical does.
func envelope(obj map[string]any) ([]byte, error) {
	m := make(map[string]any, len(obj))
	for k, v := range obj {
		switch k {
		case "id", "content", "payload":
		default:
			m[k] = v
		}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
