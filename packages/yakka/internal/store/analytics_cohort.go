package store

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// CohortDefinition is the stateless, URL-carried source definition. ParseCohortDefinition
// validates and canonicalizes it before any query is prepared.
type CohortDefinition struct {
	Version   int             `json:"v"`
	Grain     string          `json:"grain"`
	Scope     CohortScope     `json:"scope"`
	Predicate json.RawMessage `json:"predicate"`
	Op        string          `json:"op,omitempty"`
	Source    json.RawMessage `json:"source,omitempty"`
}

type CohortScope struct {
	From    string   `json:"from"`
	To      string   `json:"to"`
	TZ      string   `json:"tz"`
	Include []string `json:"include"`
	Exclude []string `json:"exclude"`
}

// ParsedCohort holds the normalized definition and its stable identity. Canonical is safe to
// place in a query parameter after URL encoding; Key changes when scope, predicate or operation
// changes, and is independent of JSON object key order and commutative predicate order.
type ParsedCohort struct {
	Definition CohortDefinition
	Predicate  []byte
	Canonical  []byte
	Key        string
	root       *cohortNode
}

var ErrCohortInvalid = errors.New("cohort_invalid")
var ErrUnsupportedJoin = errors.New("unsupported_join")

type cohortNode struct {
	kind     string
	measure  string
	lens     string
	lo, hi   *float64
	values   []string
	children []*cohortNode
}

var cohortMeasures = map[string]map[string]bool{
	"time":      {"hook_events": true, "conversations": true, "artifact_versions": true, "distinct_content": true, "commits": true, "rejections": true, "model_calls": true, "unpriced_calls": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true, "cost_usd": true},
	"session":   {"cost_usd": true, "unpriced_calls": true, "model_calls": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true, "hook_events": true, "commits": true, "artifact_versions": true, "distinct_content": true, "duration_s": true, "first_ts": true, "last_ts": true},
	"artifact":  {"versions": true, "distinct_writing_sessions": true, "first_ts": true, "last_ts": true, "content_bytes": true},
	"content":   {"score": true},
	"execution": {"session_cost_usd": true, "brief_score": true, "report_score": true, "ts": true},
	"plan":      {"artifacts": true, "versions": true, "sessions": true, "shared_sessions": true, "associated_cost_usd": true, "unpriced_calls": true, "executions_complete": true, "executions_unreported": true, "executions_started": true, "complete_share": true, "span_days": true, "first_ts": true, "last_ts": true},
}

var cohortLenses = map[string]map[string]bool{
	"session":   {"harness": true, "session_model": true, "session_repo": true, "origin": true, "has_artifacts": true, "repo_id": true, "model": true},
	"artifact":  {"kind": true, "plan": true, "repo_id": true, "harness": true, "session_model": true, "source": true, "screen_verdict": true, "scorer": true},
	"content":   {"kind": true, "plan": true, "repo_id": true, "harness": true, "session_model": true, "source": true, "screen_verdict": true, "scorer": true},
	"execution": {"shape": true, "plan": true, "repo_id": true, "harness": true, "session_model": true},
	"plan":      {"repo_id": true, "harness": true, "session_model": true},
}

// ParseCohortDefinition enforces the public 64-leaf, 64-value, depth-8 predicate limits. It
// rejects unknown fields and grain-specific names rather than silently dropping a condition.
func ParseCohortDefinition(raw []byte) (ParsedCohort, error) {
	var out ParsedCohort
	if len(raw) == 0 || len(raw) > 8192 {
		return out, fmt.Errorf("%w: encoded definition exceeds 8 KiB", ErrCohortInvalid)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var d CohortDefinition
	if err := dec.Decode(&d); err != nil {
		return out, fmt.Errorf("%w: invalid definition: %v", ErrCohortInvalid, err)
	}
	if err := ensureEOF(dec); err != nil {
		return out, fmt.Errorf("%w: invalid definition", ErrCohortInvalid)
	}
	if d.Version != 1 {
		return out, fmt.Errorf("%w: v must be 1", ErrCohortInvalid)
	}
	if !knownCohortGrain(d.Grain) {
		return out, fmt.Errorf("%w: unknown grain %q", ErrCohortInvalid, d.Grain)
	}
	if d.Op == "" {
		d.Op = "include"
	}
	if d.Op != "include" && d.Op != "exclude" {
		return out, fmt.Errorf("%w: op must be include or exclude", ErrCohortInvalid)
	}
	if err := requireJSONKeys(raw, "v", "grain", "scope", "predicate"); err != nil {
		return out, fmt.Errorf("%w: missing required definition field", ErrCohortInvalid)
	}
	if err := requireJSONKeys(rawField(raw, "scope"), "from", "to", "tz", "include", "exclude"); err != nil {
		return out, fmt.Errorf("%w: scope requires from, to, tz, include and exclude", ErrCohortInvalid)
	}
	if isJSONNull(rawField(rawField(raw, "scope"), "include")) || isJSONNull(rawField(rawField(raw, "scope"), "exclude")) {
		return out, fmt.Errorf("%w: scope include/exclude must be arrays", ErrCohortInvalid)
	}
	from, e1 := time.Parse(time.RFC3339, d.Scope.From)
	to, e2 := time.Parse(time.RFC3339, d.Scope.To)
	if e1 != nil || e2 != nil || from.After(to) {
		return out, fmt.Errorf("%w: scope requires valid absolute from and to", ErrCohortInvalid)
	}
	d.Scope.From = from.UTC().Format(time.RFC3339Nano)
	d.Scope.To = to.UTC().Format(time.RFC3339Nano)
	if d.Scope.TZ == "" {
		return out, fmt.Errorf("%w: scope tz is required", ErrCohortInvalid)
	}
	if _, err := time.LoadLocation(d.Scope.TZ); err != nil {
		return out, fmt.Errorf("%w: invalid scope tz", ErrCohortInvalid)
	}
	if d.Scope.Include == nil {
		d.Scope.Include = []string{}
	}
	if d.Scope.Exclude == nil {
		d.Scope.Exclude = []string{}
	}
	for _, list := range [][]string{d.Scope.Include, d.Scope.Exclude} {
		if len(list) > 64 {
			return out, fmt.Errorf("%w: scope list exceeds 64 values", ErrCohortInvalid)
		}
		for _, v := range list {
			if v == "" || len(v) > 256 {
				return out, fmt.Errorf("%w: invalid scope value", ErrCohortInvalid)
			}
		}
		sort.Strings(list)
	}
	d.Scope.Include = uniqStrings(d.Scope.Include)
	d.Scope.Exclude = uniqStrings(d.Scope.Exclude)
	if len(d.Source) != 0 && d.Grain != "time" {
		return out, fmt.Errorf("%w: source metadata is only valid for time", ErrCohortInvalid)
	}
	if d.Grain == "time" {
		var source struct {
			Fields     []string `json:"fields"`
			Bucket     string   `json:"bucket"`
			BucketStep int      `json:"bucket_step"`
		}
		if len(d.Source) == 0 || strictObject(d.Source, &source) != nil || len(source.Fields) == 0 || source.Bucket == "" {
			return out, fmt.Errorf("%w: time source requires fields, bucket and bucket_step", ErrCohortInvalid)
		}
		if source.BucketStep == 0 {
			source.BucketStep = 1
		}
		if source.BucketStep < 1 || !validCohortBucket(source.Bucket, source.BucketStep) {
			return out, fmt.Errorf("%w: unsupported time source bucket", ErrCohortInvalid)
		}
		seen := map[string]bool{}
		for _, field := range source.Fields {
			if !cohortMeasures["time"][field] || seen[field] {
				return out, fmt.Errorf("%w: unsupported time source field %q", ErrCohortInvalid, field)
			}
			seen[field] = true
		}
		sort.Strings(source.Fields)
		d.Source, _ = json.Marshal(source)
	}
	node, err := parseCohortNode(d.Grain, d.Predicate, 1, new(int))
	if err != nil {
		return out, err
	}
	pred, err := json.Marshal(node)
	if err != nil {
		return out, err
	}
	d.Predicate = pred
	canonical, err := json.Marshal(d)
	if err != nil {
		return out, err
	}
	h := sha256.Sum256(canonical)
	out = ParsedCohort{Definition: d, Predicate: pred, Canonical: canonical, Key: hex.EncodeToString(h[:]), root: node}
	return out, nil
}

func validCohortBucket(bucket string, step int) bool {
	if bucket == "year" {
		return step > 0 && step <= 100
	}
	if bucket == "hour" || bucket == "day" || bucket == "week" || bucket == "month" {
		return step == 1
	}
	if n, ok := multiYearStep(bucket); ok {
		return n == step
	}
	return false
}

func ensureEOF(d *json.Decoder) error {
	var x any
	err := d.Decode(&x)
	if err == io.EOF {
		return nil
	}
	if err == nil {
		return errors.New("trailing JSON")
	}
	return err
}
func knownCohortGrain(g string) bool {
	return g == "session" || g == "artifact" || g == "content" || g == "execution" || g == "plan" || g == "time"
}

func parseCohortNode(grain string, raw json.RawMessage, depth int, leaves *int) (*cohortNode, error) {
	if depth > 8 {
		return nil, fmt.Errorf("%w: predicate depth exceeds 8", ErrCohortInvalid)
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil || len(obj) != 1 {
		return nil, fmt.Errorf("%w: node must have exactly one operator", ErrCohortInvalid)
	}
	for op, body := range obj {
		n := &cohortNode{kind: op}
		switch op {
		case "and", "or":
			var arr []json.RawMessage
			if isJSONNull(body) {
				return nil, fmt.Errorf("%w: %s needs an array", ErrCohortInvalid, op)
			}
			if err := json.Unmarshal(body, &arr); err != nil || len(arr) == 0 {
				return nil, fmt.Errorf("%w: %s needs children", ErrCohortInvalid, op)
			}
			for _, child := range arr {
				c, err := parseCohortNode(grain, child, depth+1, leaves)
				if err != nil {
					return nil, err
				}
				n.children = append(n.children, c)
			}
			sort.Slice(n.children, func(i, j int) bool {
				a, _ := json.Marshal(n.children[i])
				b, _ := json.Marshal(n.children[j])
				return string(a) < string(b)
			})
			uniq := n.children[:0]
			last := ""
			for _, c := range n.children {
				b, _ := json.Marshal(c)
				if string(b) != last {
					uniq = append(uniq, c)
					last = string(b)
				}
			}
			n.children = uniq
		case "not":
			c, err := parseCohortNode(grain, body, depth+1, leaves)
			if err != nil {
				return nil, err
			}
			n.children = []*cohortNode{c}
		case "range":
			if err := requireJSONKeys(body, "measure", "lo", "hi"); err != nil {
				return nil, fmt.Errorf("%w: range requires measure, lo and hi", ErrCohortInvalid)
			}
			var v struct {
				Measure string   `json:"measure"`
				Lo      *float64 `json:"lo"`
				Hi      *float64 `json:"hi"`
			}
			if err := strictObject(body, &v); err != nil || !cohortMeasures[grain][v.Measure] {
				return nil, fmt.Errorf("%w: unsupported range measure", ErrCohortInvalid)
			}
			if v.Lo != nil && (math.IsNaN(*v.Lo) || math.IsInf(*v.Lo, 0)) || v.Hi != nil && (math.IsNaN(*v.Hi) || math.IsInf(*v.Hi, 0)) || v.Lo != nil && v.Hi != nil && *v.Lo > *v.Hi {
				return nil, fmt.Errorf("%w: invalid range bounds", ErrCohortInvalid)
			}
			n.measure = v.Measure
			n.lo = v.Lo
			n.hi = v.Hi
			*leaves++
		case "in":
			if err := requireJSONKeys(body, "lens", "values"); err != nil {
				return nil, fmt.Errorf("%w: in requires lens and values", ErrCohortInvalid)
			}
			if isJSONNull(rawField(body, "values")) {
				return nil, fmt.Errorf("%w: in values must be an array", ErrCohortInvalid)
			}
			var v struct {
				Lens   string   `json:"lens"`
				Values []string `json:"values"`
			}
			if err := strictObject(body, &v); err != nil || !cohortLenses[grain][v.Lens] {
				return nil, fmt.Errorf("%w: unsupported lens", ErrCohortInvalid)
			}
			if len(v.Values) > 64 {
				return nil, fmt.Errorf("%w: in exceeds 64 values", ErrCohortInvalid)
			}
			for _, s := range v.Values {
				if s == "" || len(s) > 256 {
					return nil, fmt.Errorf("%w: invalid in value", ErrCohortInvalid)
				}
			}
			sort.Strings(v.Values)
			n.values = uniqStrings(v.Values)
			n.lens = v.Lens
			*leaves++
		case "is_null":
			if err := requireJSONKeys(body, "measure"); err != nil {
				return nil, fmt.Errorf("%w: is_null requires measure", ErrCohortInvalid)
			}
			var v struct {
				Measure string `json:"measure"`
			}
			if err := strictObject(body, &v); err != nil || !cohortMeasures[grain][v.Measure] {
				return nil, fmt.Errorf("%w: unsupported null measure", ErrCohortInvalid)
			}
			n.measure = v.Measure
			*leaves++
		default:
			return nil, fmt.Errorf("%w: unknown operator %q", ErrCohortInvalid, op)
		}
		if *leaves > 64 {
			return nil, fmt.Errorf("%w: predicate exceeds 64 leaves", ErrCohortInvalid)
		}
		return n, nil
	}
	return nil, fmt.Errorf("%w: invalid node", ErrCohortInvalid)
}

func strictObject(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	return ensureEOF(d)
}

func rawField(raw []byte, key string) json.RawMessage {
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	return m[key]
}
func requireJSONKeys(raw []byte, keys ...string) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return fmt.Errorf("missing %s", k)
		}
	}
	return nil
}
func isJSONNull(raw []byte) bool { return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) }
func uniqStrings(in []string) []string {
	if len(in) == 0 {
		return in
	}
	out := in[:1]
	for _, v := range in[1:] {
		if v != out[len(out)-1] {
			out = append(out, v)
		}
	}
	return out
}

// CohortSessionSubquery returns a parameterized positive source mapping. The result stays inside
// SQLite so a large source population is never copied into an unbounded Go identity slice.
// Source exclusion is deliberately left to the target query after this positive set is resolved.
func CohortSessionSubquery(c ParsedCohort) (string, []any, CohortRelation, error) {
	d := c.Definition
	r := CohortRelation{SourceGrain: d.Grain, TargetGrain: "session", Distinct: true}
	if len(d.Scope.Include) != 0 || len(d.Scope.Exclude) != 0 {
		return "", nil, r, fmt.Errorf("%w: scope include/exclude element syntax is unspecified", ErrCohortInvalid)
	}
	from, e1 := time.Parse(time.RFC3339, d.Scope.From)
	to, e2 := time.Parse(time.RFC3339, d.Scope.To)
	if e1 != nil || e2 != nil {
		return "", nil, r, fmt.Errorf("%w: invalid fixed source window", ErrCohortInvalid)
	}
	if d.Grain == "content" {
		return "", nil, r, fmt.Errorf("%w: content requires selected kind/check metadata absent from the definition", ErrCohortInvalid)
	}
	if d.Grain == "time" {
		return timeCohortSessionSubquery(c, from, to, r)
	}
	start, end := from.UTC().UnixNano(), to.UTC().UnixNano()
	// facts.ts is stored as Unix seconds (REAL), while time.Parse preserves the contract's
	// absolute RFC3339 bounds. Bind as seconds to match every existing analytics filter.
	startSeconds, endSeconds := float64(start)/1e9, float64(end)/1e9
	var source string
	var args []any
	switch d.Grain {
	case "session":
		r.Mapping, r.Unit = "session_to_itself", "conversation_id"
		source = "SELECT conversation_id, COUNT(DISTINCT CASE WHEN type='hook_event' THEN row_hash END) hook_events, SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END) commits, " +
			"COUNT(DISTINCT CASE WHEN type='artifact_version' THEN row_hash END) artifact_versions, " +
			"COUNT(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END) distinct_content, " +
			"SUM(tok_in) tokens_in, SUM(tok_out) tokens_out, SUM(tok_cache_read) tokens_cache_read, " +
			"SUM(tok_cache_write) tokens_cache_write, SUM(tok_reasoning) tokens_reasoning, MIN(ts) first_ts, MAX(ts) last_ts " +
			"FROM facts WHERE ts>=? AND ts<=? GROUP BY conversation_id"
		args = []any{startSeconds, endSeconds}
	case "artifact":
		r.Mapping, r.Unit = "artifact_selected_version_to_earliest_writer", "repo_id,path"
		source = "WITH members AS (SELECT repo_id,path,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) distinct_writing_sessions,MIN(ts) first_ts,MAX(ts) last_ts " +
			"FROM facts WHERE type='artifact_version' AND ts>=? AND ts<=? GROUP BY repo_id,path), source AS (SELECT m.*, " +
			"(SELECT x.content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) content_hash, " +
			"(SELECT x.kind FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) kind, " +
			"(SELECT x.plan FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) plan, " +
			"(SELECT x.source FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) source, " +
			"(SELECT w.conversation_id FROM facts w WHERE w.type='artifact_version' AND w.repo_id=m.repo_id AND w.path=m.path AND w.content_hash=(SELECT x.content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) ORDER BY w.ts,w.row_hash LIMIT 1) conversation_id FROM members m) "
		args = []any{startSeconds, endSeconds}
	case "execution":
		r.Mapping, r.Unit = "execution_to_conversation_id", "repo_id,conversation_id,brief_path"
		source = "WITH b AS (SELECT repo_id,plan,conversation_id,path,harness,ts,rowid,row_number() OVER(PARTITION BY repo_id,conversation_id,path ORDER BY ts,rowid) rn FROM facts WHERE type='artifact_version' AND kind='brief' AND ts>=? AND ts<=?), source AS (SELECT b.*, " + execShapeSQL + " AS shape FROM b WHERE rn=1) "
		args = []any{startSeconds, endSeconds}
	case "plan":
		r.Mapping, r.Unit = "plan_to_associated_sessions", "repo_id,plan"
		source = "WITH selected AS (SELECT repo_id,plan,path,content_hash,conversation_id,ts FROM facts WHERE type='artifact_version' AND plan<>'' AND ts>=? AND ts<=?), active AS (SELECT DISTINCT conversation_id FROM facts WHERE ts>=? AND ts<=?), source AS (SELECT repo_id,plan,COUNT(DISTINCT path) artifacts,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) sessions,MIN(ts) first_ts,MAX(ts) last_ts FROM selected GROUP BY repo_id,plan) "
		args = []any{startSeconds, endSeconds, startSeconds, endSeconds}
	default:
		return "", nil, r, fmt.Errorf("%w: unsupported source grain %q", ErrUnsupportedJoin, d.Grain)
	}
	condition, predicateArgs, err := compileCohortNode(d.Grain, c.root)
	if err != nil {
		return "", nil, r, err
	}
	args = append(args, predicateArgs...)
	switch d.Grain {
	case "session":
		return "SELECT DISTINCT conversation_id FROM (" + source + ") source WHERE " + condition, args, r, nil
	case "artifact":
		return source + "SELECT DISTINCT conversation_id FROM source WHERE conversation_id<>'' AND " + condition, args, r, nil
	case "execution":
		return source + "SELECT DISTINCT conversation_id FROM source WHERE " + condition, args, r, nil
	case "plan":
		return source + "SELECT DISTINCT a.conversation_id FROM source JOIN facts a ON a.type='artifact_version' AND a.repo_id=source.repo_id AND a.plan=source.plan JOIN active USING(conversation_id) WHERE a.conversation_id<>'' AND " + condition, args, r, nil
	}
	return "", nil, r, ErrUnsupportedJoin
}

func timeCohortSessionSubquery(c ParsedCohort, from, to time.Time, rel CohortRelation) (string, []any, CohortRelation, error) {
	var source struct {
		Fields     []string `json:"fields"`
		Bucket     string   `json:"bucket"`
		BucketStep int      `json:"bucket_step"`
	}
	if err := json.Unmarshal(c.Definition.Source, &source); err != nil {
		return "", nil, rel, fmt.Errorf("%w: invalid time source", ErrCohortInvalid)
	}
	f := AnalyticsFilter{From: from, To: to}
	loc, err := time.LoadLocation(c.Definition.Scope.TZ)
	if err != nil {
		return "", nil, rel, fmt.Errorf("%w: invalid time zone", ErrCohortInvalid)
	}
	f.TZ = loc
	args := []any{seconds(from), seconds(to)}
	// The source and membership use the frozen calendar bucket rule, including local DST
	// boundaries. Each contributor is still selected by its existing fact/call/rejection identity.
	if source.Bucket == "" {
		return "", nil, rel, fmt.Errorf("%w: empty time bucket", ErrCohortInvalid)
	}
	columns := []string{"hook_events", "conversations", "artifact_versions", "distinct_content", "commits", "rejections", "model_calls", "unpriced_calls", "tokens_in", "tokens_out", "tokens_cache_read", "tokens_cache_write", "tokens_reasoning", "cost_usd"}
	for _, m := range source.Fields {
		if !containsString(columns, m) {
			return "", nil, rel, fmt.Errorf("%w: time measure %q has no contributor mapping", ErrUnsupportedJoin, m)
		}
	}
	// Resolve only bucket rows selected by the frozen positive predicate.
	cond, predicateArgs, err := compileCohortNode("time", c.root)
	if err != nil {
		return "", nil, rel, err
	}
	fieldPred := make([]string, 0, len(source.Fields))
	factTypes := map[string]bool{}
	includeUsage, includeRejections := false, false
	for _, field := range source.Fields {
		fieldPred = append(fieldPred, "\""+field+"\" > 0")
		switch field {
		case "hook_events":
			factTypes["hook_event"] = true
		case "conversations":
			for _, typ := range []string{"hook_event", "artifact_version", "commit"} {
				factTypes[typ] = true
			}
		case "artifact_versions", "distinct_content":
			factTypes["artifact_version"] = true
		case "commits":
			factTypes["commit"] = true
		case "rejections":
			includeRejections = true
		default:
			includeUsage = true
		}
	}
	zeroCols := make([]string, len(columns))
	for i, col := range columns {
		zeroCols[i] = "0 AS \"" + col + "\""
	}
	factExpr := "wf_cohort_bucket(ts,'" + source.Bucket + "','" + strings.ReplaceAll(c.Definition.Scope.TZ, "'", "''") + "'," + strconv.Itoa(source.BucketStep) + ")"
	usageCTE, usageArgs := usageRowsWhere(f)
	args = append(args, usageArgs...)
	// Rejection timestamps are nanoseconds; the scalar accepts seconds, like the existing
	// analytics measure. Rejection membership requires a recorded conversation with facts.
	q := "WITH facts_b AS (SELECT " + factExpr + " bucket,COUNT(DISTINCT CASE WHEN type='hook_event' THEN row_hash END) hook_events,COUNT(DISTINCT conversation_id) conversations,COUNT(DISTINCT CASE WHEN type='artifact_version' THEN row_hash END) artifact_versions,COUNT(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END) distinct_content,SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END) commits," + strings.Join(zeroCols[5:], ",") + " FROM facts WHERE ts>=? AND ts<=? GROUP BY bucket), "
	q += "usage_b AS (" + usageCTE + " SELECT wf_cohort_bucket(ts,'" + source.Bucket + "','" + strings.ReplaceAll(c.Definition.Scope.TZ, "'", "''") + "'," + strconv.Itoa(source.BucketStep) + ") bucket,0 hook_events,0 conversations,0 artifact_versions,0 distinct_content,0 commits,0 rejections,COUNT(*) model_calls,SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced_calls,SUM(tok_in) tokens_in,SUM(tok_out) tokens_out,SUM(tok_cache_read) tokens_cache_read,SUM(tok_cache_write) tokens_cache_write,SUM(tok_reasoning) tokens_reasoning,SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) cost_usd FROM kept GROUP BY bucket), "
	q += "reject_b AS (SELECT wf_cohort_bucket(at/1e9,'" + source.Bucket + "','" + strings.ReplaceAll(c.Definition.Scope.TZ, "'", "''") + "'," + strconv.Itoa(source.BucketStep) + ") bucket,0 hook_events,0 conversations,0 artifact_versions,0 distinct_content,0 commits,COUNT(*) rejections," + strings.Join(zeroCols[6:], ",") + " FROM rejections WHERE at>=? AND at<=? GROUP BY bucket), "
	q += "all_b AS (SELECT * FROM facts_b UNION ALL SELECT * FROM usage_b UNION ALL SELECT * FROM reject_b), buckets AS (SELECT bucket," + sumColumns(columns) + " FROM all_b GROUP BY bucket), selected AS (SELECT bucket FROM buckets WHERE (" + cond + ") AND (" + strings.Join(fieldPred, " OR ") + ")) "
	contributors := []string{}
	if len(factTypes) != 0 {
		types := make([]string, 0, len(factTypes))
		for typ := range factTypes {
			types = append(types, "'"+typ+"'")
		}
		sort.Strings(types)
		contributors = append(contributors, "SELECT f.conversation_id FROM facts f JOIN selected s ON wf_cohort_bucket(f.ts,'"+source.Bucket+"','"+strings.ReplaceAll(c.Definition.Scope.TZ, "'", "''")+"',"+strconv.Itoa(source.BucketStep)+")=s.bucket WHERE f.type IN ("+strings.Join(types, ",")+") AND f.ts>=? AND f.ts<=?")
	}
	if includeUsage {
		contributors = append(contributors, "SELECT u.conversation_id FROM ("+usageCTE+" SELECT conversation_id,ts FROM kept) u JOIN selected s ON wf_cohort_bucket(u.ts,'"+source.Bucket+"','"+strings.ReplaceAll(c.Definition.Scope.TZ, "'", "''")+"',"+strconv.Itoa(source.BucketStep)+")=s.bucket WHERE u.ts>=? AND u.ts<=?")
	}
	if includeRejections {
		contributors = append(contributors, "SELECT r.conversation_id FROM rejections r JOIN facts existing ON existing.conversation_id=r.conversation_id JOIN selected s ON wf_cohort_bucket(r.at/1e9,'"+source.Bucket+"','"+strings.ReplaceAll(c.Definition.Scope.TZ, "'", "''")+"',"+strconv.Itoa(source.BucketStep)+")=s.bucket WHERE r.at>=? AND r.at<=? AND r.conversation_id<>''")
	}
	q += "SELECT DISTINCT conversation_id FROM (" + strings.Join(contributors, " UNION ") + ") WHERE conversation_id<>''"
	args = append(args, from.UnixNano(), to.UnixNano())
	args = append(args, predicateArgs...)
	if len(factTypes) != 0 {
		args = append(args, seconds(from), seconds(to))
	}
	if includeUsage {
		args = append(args, usageArgs...)
		args = append(args, seconds(from), seconds(to))
	}
	if includeRejections {
		args = append(args, from.UnixNano(), to.UnixNano())
	}
	rel.Mapping, rel.Unit = "time_bucket_to_contributing_session", "conversation_id"
	return q, args, rel, nil
}

func containsString(xs []string, value string) bool {
	for _, x := range xs {
		if x == value {
			return true
		}
	}
	return false
}
func sumColumns(columns []string) string {
	xs := make([]string, len(columns))
	for i, c := range columns {
		xs[i] = "SUM(\"" + c + "\") AS \"" + c + "\""
	}
	return strings.Join(xs, ",")
}

func compileCohortNode(grain string, n *cohortNode) (string, []any, error) {
	if n == nil {
		return "", nil, fmt.Errorf("%w: missing parsed predicate", ErrCohortInvalid)
	}
	args := []any{}
	if n.kind == "and" || n.kind == "or" {
		sep := " AND "
		if n.kind == "or" {
			sep = " OR "
		}
		parts := []string{}
		for _, child := range n.children {
			sql, a, err := compileCohortNode(grain, child)
			if err != nil {
				return "", nil, err
			}
			parts = append(parts, "("+sql+")")
			args = append(args, a...)
		}
		return strings.Join(parts, sep), args, nil
	}
	if n.kind == "not" {
		sql, a, err := compileCohortNode(grain, n.children[0])
		return "NOT (" + sql + ")", a, err
	}
	columns := map[string]map[string]string{
		"time":      {"hook_events": "hook_events", "conversations": "conversations", "artifact_versions": "artifact_versions", "distinct_content": "distinct_content", "commits": "commits", "rejections": "rejections", "model_calls": "model_calls", "unpriced_calls": "unpriced_calls", "tokens_in": "tokens_in", "tokens_out": "tokens_out", "tokens_cache_read": "tokens_cache_read", "tokens_cache_write": "tokens_cache_write", "tokens_reasoning": "tokens_reasoning", "cost_usd": "cost_usd"},
		"session":   {"hook_events": "hook_events", "commits": "commits", "artifact_versions": "artifact_versions", "distinct_content": "distinct_content", "tokens_in": "tokens_in", "tokens_out": "tokens_out", "tokens_cache_read": "tokens_cache_read", "tokens_cache_write": "tokens_cache_write", "tokens_reasoning": "tokens_reasoning", "first_ts": "first_ts", "last_ts": "last_ts", "duration_s": "(last_ts-first_ts)"},
		"artifact":  {"versions": "versions", "distinct_writing_sessions": "distinct_writing_sessions", "first_ts": "first_ts", "last_ts": "last_ts", "kind": "kind", "plan": "plan", "repo_id": "repo_id", "source": "source"},
		"execution": {"ts": "ts", "shape": "shape", "plan": "plan", "repo_id": "repo_id", "harness": "harness"},
		"plan":      {"artifacts": "artifacts", "versions": "versions", "sessions": "sessions", "first_ts": "first_ts", "last_ts": "last_ts", "repo_id": "repo_id", "plan": "plan"},
	}
	col := columns[grain][n.measure]
	if n.kind == "in" {
		col = columns[grain][n.lens]
		if col == "" {
			return "", nil, fmt.Errorf("%w: %s lens %q is not supported by source resolver", ErrUnsupportedJoin, grain, n.lens)
		}
		if len(n.values) == 0 {
			return "0", nil, nil
		}
		for _, v := range n.values {
			args = append(args, v)
		}
		return col + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(n.values)), ",") + ")", args, nil
	}
	if col == "" {
		return "", nil, fmt.Errorf("%w: %s measure %q is not supported by source resolver", ErrUnsupportedJoin, grain, n.measure)
	}
	if n.kind == "is_null" {
		return col + " IS NULL", nil, nil
	}
	if n.kind != "range" {
		return "", nil, fmt.Errorf("%w: invalid predicate operator", ErrCohortInvalid)
	}
	parts := []string{}
	if n.lo != nil {
		parts = append(parts, col+">=?")
		args = append(args, *n.lo)
	}
	if n.hi != nil {
		parts = append(parts, col+"<=?")
		args = append(args, *n.hi)
	}
	if len(parts) == 0 {
		return "1", nil, nil
	}
	return strings.Join(parts, " AND "), args, nil
}

type CohortRelation struct {
	SourceGrain string `json:"source_grain"`
	TargetGrain string `json:"target_grain"`
	Mapping     string `json:"mapping"`
	Unit        string `json:"unit"`
	Distinct    bool   `json:"distinct"`
}

func (n cohortNode) MarshalJSON() ([]byte, error) {
	switch n.kind {
	case "and", "or":
		return json.Marshal(map[string]any{n.kind: n.children})
	case "not":
		return json.Marshal(map[string]any{"not": n.children[0]})
	case "range":
		return json.Marshal(map[string]any{"range": map[string]any{"measure": n.measure, "lo": n.lo, "hi": n.hi}})
	case "in":
		return json.Marshal(map[string]any{"in": map[string]any{"lens": n.lens, "values": n.values}})
	case "is_null":
		return json.Marshal(map[string]any{"is_null": map[string]any{"measure": n.measure}})
	default:
		return nil, fmt.Errorf("unknown cohort node %q", n.kind)
	}
}

// CanonicalNumber is exposed for focused contract tests and callers that need stable numeric text.
func CanonicalNumber(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

var _ = strings.Builder{}
