// Package ingest validates, prechecks and stores a batch of facts for one tenant (design 3 Ingest).
//
// Fact wire shape: a JSON object. Common keys: id (the drain's "<queue file>#<n>", echoed in the
// result, never hashed or stored), type ("hook_event" | "artifact_version" | "commit"). review_run
// is accepted only through IngestReviewRuns on the authenticated review handler path; review_usage
// is accepted only through IngestReviewUsage and is kept out of facts.
// conversation_id, harness, event, ts (Unix seconds, number).
//
//	hook_event:       payload (object, already scrubbed by the client)
//	artifact_version: repo_id, path, content_hash, content (the file's UTF-8 bytes as a string),
//	                  source ("worktree" | "commit")
//	commit:           repo_id, sha, paths ([]string), renames ([]{"from","to"})
//	review_run:       repo_id, kind, capture_id, status and generic review record fields
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
	case "hook_event", "artifact_version", "commit", "review_run", "review_usage":
	default:
		return invalid("unknown type")
	}
	if typ != "review_usage" && conv == "" {
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
	case "review_run":
		for _, k := range []string{"repo_id", "kind", "capture_id", "status"} {
			if s, ok := str(obj, k); !ok || s == "" {
				return invalid("review_run needs %s", k)
			}
		}
		kind, _ := str(obj, "kind")
		if kind != "phase" && kind != "pr" && kind != "adhoc" {
			return invalid("review_run kind must be phase, pr or adhoc")
		}
		status, _ := str(obj, "status")
		switch status {
		case "ok", "ok_partial", "timeout", "api_error", "invalid_output", "unavailable",
			"refused_capture", "refused_disclosure", "refused_criteria", "skipped_budget", "skipped_duplicate":
		default:
			return invalid("review_run has unknown status")
		}
	case "review_usage":
		for _, k := range []string{"usage_id", "configured_model", "configured_effort", "requested_effort", "effective_effort", "status"} {
			if s, ok := str(obj, k); !ok || s == "" {
				return invalid("review_usage needs %s", k)
			}
		}
		if b, ok := obj["store"].(bool); !ok || b {
			return invalid("review_usage store must be false")
		}
		if _, ok := obj["ts"].(json.Number); !ok {
			return invalid("review_usage needs ts")
		}
		if tags, ok := obj["tags"]; ok {
			list, isList := tags.([]any)
			if !isList {
				return invalid("review_usage tags must be an array of strings")
			}
			for _, tag := range list {
				if _, isStr := tag.(string); !isStr {
					return invalid("review_usage tags must be an array of strings")
				}
			}
		}
		for _, k := range []string{"repo_id", "plan", "phase", "pr", "session_id", "capture_id",
			"input_hash", "content_hash", "conversation_id", "prompt", "criteria", "criteria_text",
			"findings", "result", "payload", "error", "reason", "manifest_hash", "case_id", "key"} {
			if _, ok := obj[k]; ok {
				return invalid("review_usage must not contain %s", k)
			}
		}
		status, _ := str(obj, "status")
		switch status {
		case "ok", "ok_partial", "timeout", "api_error", "invalid_output", "unavailable":
		default:
			return invalid("review_usage has unknown status")
		}
	}
	return ""
}

// Ingest processes remote envelope facts for tenant. review_run and review_usage facts are rejected;
// callers on the review handler use IngestReviewRuns or IngestReviewUsage. An error is a
// whole-request failure.
func Ingest(ctx context.Context, tenant *store.Tenant, facts []json.RawMessage) ([]Result, error) {
	return ingestBatch(ctx, tenant, facts, false, false)
}

// IngestReviewRuns persists review_run facts from the authenticated review handler.
func IngestReviewRuns(ctx context.Context, tenant *store.Tenant, facts []json.RawMessage) ([]Result, error) {
	return ingestBatch(ctx, tenant, facts, true, false)
}

// IngestReviewUsage persists content-free review_usage facts from the authenticated review
// handler. They are stored outside facts and review_runs, so no analytics measure reads them.
func IngestReviewUsage(ctx context.Context, tenant *store.Tenant, facts []json.RawMessage) ([]Result, error) {
	return ingestBatch(ctx, tenant, facts, false, true)
}

func ingestBatch(ctx context.Context, tenant *store.Tenant, facts []json.RawMessage, reviewRuns, reviewUsage bool) ([]Result, error) {
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
		if typ == "review_run" && !reviewRuns {
			results[i].Status, results[i].Reason = Rejected, invalid("review_run is server-authored")
			continue
		}
		if typ == "review_usage" && !reviewUsage {
			results[i].Status, results[i].Reason = Rejected, invalid("review_usage is server-authored")
			continue
		}
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
		if typ == "review_usage" {
			usageID, _ := str(obj, "usage_id")
			var ts float64
			if n, ok := obj["ts"].(json.Number); ok {
				ts, _ = n.Float64()
			}
			ins, err := tenant.AppendReviewUsage(ctx, []store.ReviewUsageRow{{UsageID: usageID, TS: ts, Raw: canon}})
			if err != nil {
				return nil, err
			}
			if ins[0] {
				results[i].Status = Accepted
			} else {
				results[i].Status = Duplicate
			}
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
		if typ == "review_run" {
			ins, err := tenant.AppendReviewRuns(ctx, []store.FactRow{row})
			if err != nil {
				return nil, err
			}
			if ins[0] {
				results[i].Status = Accepted
			} else {
				results[i].Status = Duplicate
			}
			continue
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
