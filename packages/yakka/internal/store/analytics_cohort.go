package store

import (
	"bytes"
	"crypto/sha256"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"modernc.org/sqlite"
)

// wf_cohort_blob_bytes reports a content-addressed blob's stored size for the resolver's
// content_bytes measure without materialising hashes in Go. The tenant blob directory is a bound
// parameter, so the same statement shape serves every tenant.
func init() {
	sqlite.RegisterDeterministicScalarFunction("wf_cohort_blob_bytes", 2, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		dir, _ := args[0].(string)
		hash, _ := args[1].(string)
		if dir == "" || len(hash) < 2 {
			return nil, nil
		}
		st, err := os.Stat(filepath.Join(dir, "blobs", hash[:2], hash))
		if err != nil {
			return nil, nil
		}
		return st.Size(), nil
	})
}

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

// CohortScopeElement is one signed scope element: the values of one lens to include in, or
// exclude from, the source population. A structured element (not a "lens:value" string) is
// required because lens names may contain a colon, as band:<check> does.
type CohortScopeElement struct {
	Lens   string   `json:"lens"`
	Values []string `json:"values"`
}

type CohortScope struct {
	From    string               `json:"from"`
	To      string               `json:"to"`
	TZ      string               `json:"tz"`
	Include []CohortScopeElement `json:"include"`
	Exclude []CohortScopeElement `json:"exclude"`
}

// SQLExpression is a SQL column or expression a resolver binds a scope lens to.
type SQLExpression string

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

// cohortArtifactWriterMeasures are the selected writing session's in-window measures, exactly the
// names 17.3.1's artifact row owes.
var cohortArtifactWriterMeasures = []string{"writing_session_cost_usd", "writing_session_model_calls", "writing_session_tokens_in", "writing_session_tokens_out", "writing_session_tokens_cache_read", "writing_session_tokens_cache_write", "writing_session_tokens_reasoning", "writing_session_hook_events"}

var cohortMeasures = map[string]map[string]bool{
	"time":      {"hook_events": true, "conversations": true, "artifact_versions": true, "distinct_content": true, "commits": true, "rejections": true, "model_calls": true, "unpriced_calls": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true, "cost_usd": true},
	"session":   {"cost_usd": true, "unpriced_calls": true, "model_calls": true, "tokens_in": true, "tokens_out": true, "tokens_cache_read": true, "tokens_cache_write": true, "tokens_reasoning": true, "hook_events": true, "commits": true, "artifact_versions": true, "distinct_content": true, "duration_s": true, "first_ts": true, "last_ts": true},
	"artifact":  {"versions": true, "distinct_writing_sessions": true, "first_ts": true, "last_ts": true, "content_bytes": true, "writing_session_cost_usd": true, "writing_session_model_calls": true, "writing_session_tokens_in": true, "writing_session_tokens_out": true, "writing_session_tokens_cache_read": true, "writing_session_tokens_cache_write": true, "writing_session_tokens_reasoning": true, "writing_session_hook_events": true, "score:<check>": true},
	"content":   {"score": true},
	"execution": {"session_cost_usd": true, "brief_score:<check>": true, "report_score:<check>": true, "ts": true},
	"plan":      {"artifacts": true, "artifacts:<kind>": true, "versions": true, "sessions": true, "shared_sessions": true, "associated_cost_usd": true, "unpriced_calls": true, "executions_complete": true, "executions_unreported": true, "executions_started": true, "complete_share": true, "design_score:<check>": true, "span_days": true, "first_ts": true, "last_ts": true},
}

var cohortLenses = map[string]map[string]bool{
	"session":   {"harness": true, "session_model": true, "session_repo": true, "id": true, "origin": true, "has_artifacts": true},
	"artifact":  {"kind": true, "plan": true, "repo_id": true, "harness": true, "session_model": true, "source": true, "screen_verdict": true, "scorer": true, "band:<check>": true, "id": true},
	"content":   {"harness": true, "session_model": true, "repo_id": true, "plan": true, "scorer": true, "screen_verdict": true, "band": true, "id": true},
	"execution": {"shape": true, "plan": true, "repo_id": true, "harness": true, "session_model": true, "id": true},
	"plan":      {"repo_id": true, "harness": true, "session_model": true, "id": true},
	"time":      {"id": true},
}

// cohortDynamic reports the prefix arg of a dynamic measure or lens name (for example the check of
// score:<check>) and whether the name has that shape. The catalogue check happens in the resolver.
func cohortDynamic(names map[string]bool, name string) (string, bool) {
	for candidate := range names {
		if strings.HasSuffix(candidate, ":<check>") {
			prefix := strings.TrimSuffix(candidate, "<check>")
			if strings.HasPrefix(name, prefix) && len(name) > len(prefix) && !strings.Contains(name[len(prefix):], ":") {
				return name[len(prefix):], true
			}
		}
		if strings.HasSuffix(candidate, ":<kind>") {
			prefix := strings.TrimSuffix(candidate, "<kind>")
			if strings.HasPrefix(name, prefix) && len(name) > len(prefix) && !strings.Contains(name[len(prefix):], ":") {
				return name[len(prefix):], true
			}
		}
	}
	return "", false
}

func cohortAllowsName(names map[string]bool, name string) bool {
	if names[name] {
		return true
	}
	_, ok := cohortDynamic(names, name)
	return ok
}

// cohortGrainFilters is the single table of names each source grain accepts as a frozen source
// scope lens (CONTRACTS.md 17.3.1). The schema unit publishes this table; the cohort parser
// validates scope elements against it. "band:<check>" is a dynamic prefix validated against the
// catalogue by the resolver unit, not here.
var cohortGrainFilters = map[string][]string{
	"session":   {"harness", "session_model", "session_repo", "id"},
	"artifact":  {"kind", "plan", "repo_id", "harness", "session_model", "source", "screen_verdict", "scorer", "band:<check>", "id"},
	"content":   {"harness", "session_model", "repo_id", "plan", "scorer", "screen_verdict", "band", "id"},
	"execution": {"shape", "plan", "repo_id", "harness", "session_model", "id"},
	"plan":      {"repo_id", "harness", "session_model", "id"},
	// The shared-filter dimensions the time measures apply, plus id. session_repo and
	// session_model stay absent until the time route parses them (17.3.1).
	"time": {"repo_id", "harness", "kind", "plan", "norm_event", "event", "tool", "model", "source", "conversation_id", "stage", "id"},
}

// CohortGrainFilters returns a copy of the scope-filter names a grain accepts, in table order.
func CohortGrainFilters(grain string) []string {
	return append([]string{}, cohortGrainFilters[grain]...)
}

// CohortScopeLensError reports a lens that /schema publishes for another grain but not for this
// source grain. It is unsupported_join with reason not_defined_for_grain and a suggested try list.
type CohortScopeLensError struct {
	Grain  string
	Lens   string
	Reason string
	Try    []string
}

func (e *CohortScopeLensError) Error() string {
	return fmt.Sprintf("%s: lens %q is %s for grain %q; try %s", ErrUnsupportedJoin, e.Lens, e.Reason, e.Grain, strings.Join(e.Try, ", "))
}

func (e *CohortScopeLensError) Unwrap() error { return ErrUnsupportedJoin }

func cohortFilterMatches(names []string, lens string) bool {
	for _, name := range names {
		if name == lens {
			return true
		}
		if strings.HasSuffix(name, ":<check>") {
			prefix := strings.TrimSuffix(name, "<check>")
			if strings.HasPrefix(lens, prefix) && len(lens) > len(prefix) {
				return true
			}
		}
	}
	return false
}

func cohortFilterMatchesAnyGrain(lens string) bool {
	for _, names := range cohortGrainFilters {
		if cohortFilterMatches(names, lens) {
			return true
		}
	}
	return false
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
	include, err := parseCohortScopeList(d.Grain, rawField(rawField(raw, "scope"), "include"))
	if err != nil {
		return out, err
	}
	exclude, err := parseCohortScopeList(d.Grain, rawField(rawField(raw, "scope"), "exclude"))
	if err != nil {
		return out, err
	}
	d.Scope.Include, d.Scope.Exclude = include, exclude
	switch d.Grain {
	case "time":
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
	case "artifact", "content":
		var source struct {
			Kind  string `json:"kind"`
			Check string `json:"check"`
		}
		if len(d.Source) != 0 {
			if err := strictObject(d.Source, &source); err != nil {
				return out, fmt.Errorf("%w: source requires kind and check strings", ErrCohortInvalid)
			}
			if source.Kind != "" && !validCohortKind(source.Kind) {
				return out, fmt.Errorf("%w: unknown source kind %q", ErrCohortInvalid, source.Kind)
			}
			if source.Kind != "" && source.Check == "" || source.Kind == "" && source.Check != "" && d.Grain == "content" {
				return out, fmt.Errorf("%w: %s source requires both kind and check", ErrCohortInvalid, d.Grain)
			}
		}
		if d.Grain == "content" && (source.Kind == "" || source.Check == "") {
			return out, fmt.Errorf("%w: content source requires kind and check", ErrCohortInvalid)
		}
		d.Source, _ = json.Marshal(source)
	default:
		if len(d.Source) != 0 {
			return out, fmt.Errorf("%w: source metadata is only valid for time, artifact and content", ErrCohortInvalid)
		}
	}
	node, err := parseCohortNode(d.Grain, d.Predicate, 1, new(int))
	if err != nil {
		return out, err
	}
	if d.Grain == "artifact" {
		var source struct {
			Kind  string `json:"kind"`
			Check string `json:"check"`
		}
		_ = json.Unmarshal(d.Source, &source)
		if source.Check == "" && (cohortUsesLens(d.Scope.Include, "scorer") || cohortUsesLens(d.Scope.Exclude, "scorer") || cohortNodeUsesLens(node, "scorer")) {
			return out, fmt.Errorf("%w: artifact scorer requires source.check", ErrCohortInvalid)
		}
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

func validCohortKind(k string) bool { return k == "design" || k == "brief" || k == "report" }

func cohortUsesLens(elements []CohortScopeElement, lens string) bool {
	for _, el := range elements {
		if el.Lens == lens {
			return true
		}
	}
	return false
}

func cohortNodeUsesLens(n *cohortNode, lens string) bool {
	if n == nil {
		return false
	}
	if n.kind == "in" && n.lens == lens {
		return true
	}
	for _, child := range n.children {
		if cohortNodeUsesLens(child, lens) {
			return true
		}
	}
	return false
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
			if err := strictObject(body, &v); err != nil || !cohortAllowsName(cohortMeasures[grain], v.Measure) {
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
			if err := strictObject(body, &v); err != nil || !cohortAllowsName(cohortLenses[grain], v.Lens) {
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
			if err := strictObject(body, &v); err != nil || !cohortAllowsName(cohortMeasures[grain], v.Measure) {
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

func uniqSortedStrings(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	sort.Strings(in)
	return uniqStrings(in)
}

// parseCohortScopeList strict-decodes one include/exclude array, validates each element's lens
// and budgets, then canonicalises: same-lens elements merge, values deduplicate and sort, and
// elements sort by lens. Budgets are counted on that merged form.
func parseCohortScopeList(grain string, raw json.RawMessage) ([]CohortScopeElement, error) {
	var raws []json.RawMessage
	if err := json.Unmarshal(raw, &raws); err != nil {
		return nil, fmt.Errorf("%w: scope include/exclude must be arrays of objects", ErrCohortInvalid)
	}
	merged := []CohortScopeElement{}
	byLens := map[string]int{}
	for _, elemRaw := range raws {
		if isJSONNull(elemRaw) {
			return nil, fmt.Errorf("%w: scope element must be an object, not null", ErrCohortInvalid)
		}
		var el CohortScopeElement
		if err := strictObject(elemRaw, &el); err != nil {
			return nil, fmt.Errorf("%w: scope element must be an object with lens and values", ErrCohortInvalid)
		}
		if err := requireJSONKeys(elemRaw, "lens", "values"); err != nil {
			return nil, fmt.Errorf("%w: scope element requires lens and values", ErrCohortInvalid)
		}
		if isJSONNull(rawField(elemRaw, "values")) {
			return nil, fmt.Errorf("%w: scope element values must be an array", ErrCohortInvalid)
		}
		if el.Lens == "" {
			return nil, fmt.Errorf("%w: scope element lens is required", ErrCohortInvalid)
		}
		if err := validateCohortScopeLens(grain, el.Lens); err != nil {
			return nil, err
		}
		if len(el.Values) == 0 {
			return nil, fmt.Errorf("%w: scope element values must not be empty", ErrCohortInvalid)
		}
		limit := cohortScopeValueLimit(grain, el.Lens)
		for _, v := range el.Values {
			if v == "" {
				return nil, fmt.Errorf("%w: scope value must not be empty", ErrCohortInvalid)
			}
			if len(v) > limit {
				return nil, fmt.Errorf("%w: value_bytes exceeds %d bytes for lens %q", ErrCohortInvalid, limit, el.Lens)
			}
		}
		sort.Strings(el.Values)
		el.Values = uniqStrings(el.Values)
		if idx, ok := byLens[el.Lens]; ok {
			merged[idx].Values = uniqSortedStrings(append(merged[idx].Values, el.Values...))
		} else {
			byLens[el.Lens] = len(merged)
			merged = append(merged, el)
		}
	}
	if len(merged) > 64 {
		return nil, fmt.Errorf("%w: scope_elements exceeds 64 elements", ErrCohortInvalid)
	}
	for _, el := range merged {
		if len(el.Values) > 64 {
			return nil, fmt.Errorf("%w: scope_values exceeds 64 values for lens %q", ErrCohortInvalid, el.Lens)
		}
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].Lens < merged[j].Lens })
	return merged, nil
}

func validateCohortScopeLens(grain, lens string) error {
	if cohortFilterMatches(cohortGrainFilters[grain], lens) {
		return nil
	}
	if cohortFilterMatchesAnyGrain(lens) {
		return &CohortScopeLensError{Grain: grain, Lens: lens, Reason: "not_defined_for_grain", Try: CohortGrainFilters(grain)}
	}
	return fmt.Errorf("%w: unknown scope lens %q", ErrCohortInvalid, lens)
}

func cohortScopeValueLimit(grain, lens string) int {
	if lens == "id" {
		switch grain {
		case "artifact", "plan", "execution", "time":
			return 1024
		}
	}
	return 256
}

// CompileCohortScope renders the canonical include/exclude scope as a WHERE fragment and args
// over the supplied source expressions. Within one lens values are OR; across lenses they are
// AND; excludes are AND NOT IN applied after includes. An unmapped lens is unsupported_join with
// reason not_defined_for_grain and the mapped names as try, never silently ignored.
func CompileCohortScope(scope CohortScope, columns map[string]SQLExpression) (string, []any, error) {
	if len(scope.Include) == 0 && len(scope.Exclude) == 0 {
		return "1", nil, nil
	}
	parts := []string{}
	args := []any{}
	clause := func(el CohortScopeElement, negate bool) error {
		expr, ok := columns[el.Lens]
		if !ok || expr == "" {
			try := make([]string, 0, len(columns))
			for name := range columns {
				try = append(try, name)
			}
			sort.Strings(try)
			return &CohortScopeLensError{Lens: el.Lens, Reason: "not_defined_for_grain", Try: try}
		}
		if len(el.Values) == 0 {
			return fmt.Errorf("%w: scope element values must not be empty", ErrCohortInvalid)
		}
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(el.Values)), ",")
		op := " IN ("
		if negate {
			op = " NOT IN ("
		}
		parts = append(parts, "("+string(expr)+op+placeholders+"))")
		for _, v := range el.Values {
			args = append(args, v)
		}
		return nil
	}
	for _, el := range scope.Include {
		if err := clause(el, false); err != nil {
			return "", nil, err
		}
	}
	for _, el := range scope.Exclude {
		if err := clause(el, true); err != nil {
			return "", nil, err
		}
	}
	return strings.Join(parts, " AND "), args, nil
}

// CohortResolveOptions carries the caller's active catalogue and blob directory. The catalogue
// validates dynamic names (an unknown check or kind is cohort_invalid); the directory supplies
// the content_bytes measure. Zero options keep structural validation only.
type CohortResolveOptions struct {
	BlobDir string
	Checks  map[string][]string
}

func (o CohortResolveOptions) checkKnown(kind, check string) bool {
	if o.Checks == nil || check == "" {
		return true
	}
	for _, name := range o.Checks[kind] {
		if name == check {
			return true
		}
	}
	return false
}

func (o CohortResolveOptions) anyCheckKnown(check string) bool {
	if o.Checks == nil || check == "" {
		return true
	}
	for _, names := range o.Checks {
		for _, name := range names {
			if name == check {
				return true
			}
		}
	}
	return false
}

// cohortColumns resolves the predicate and scope names of one source grain to SQL over the
// resolver's source CTE. Static names are columns; dynamic names (score:<check>, band:<check>,
// design_score:<check>, brief_score:<check>, report_score:<check>, artifacts:<kind>) bind their
// suffix as a parameter instead of interpolating SQL.
type cohortColumns struct {
	grain    string
	measures map[string]string
	lenses   map[string]string
	dynamicM func(name string) (string, []any, error)
	dynamicL func(name string) (string, []any, error)
}

func (c cohortColumns) measure(name string) (string, []any, error) {
	if expr, ok := c.measures[name]; ok {
		return expr, nil, nil
	}
	if c.dynamicM != nil {
		if expr, args, err := c.dynamicM(name); err != nil || expr != "" {
			return expr, args, err
		}
	}
	return "", nil, fmt.Errorf("%w: %s measure %q is not supported by source resolver", ErrUnsupportedJoin, c.grain, name)
}

func (c cohortColumns) lens(name string) (string, []any, error) {
	if expr, ok := c.lenses[name]; ok {
		return expr, nil, nil
	}
	if c.dynamicL != nil {
		if expr, args, err := c.dynamicL(name); err != nil || expr != "" {
			return expr, args, err
		}
	}
	return "", nil, fmt.Errorf("%w: %s lens %q is not supported by source resolver", ErrUnsupportedJoin, c.grain, name)
}

const (
	cohortScoreCTE    = `cohort_score AS (SELECT content_hash,check_name,scorer,result,ROW_NUMBER() OVER(PARTITION BY content_hash,check_name ORDER BY id DESC) rn FROM scores)`
	cohortHashKindCTE = `cohort_hash_kind AS (SELECT DISTINCT content_hash,wf_kind(path) kind FROM facts WHERE type='artifact_version' AND content_hash!='')`
	cohortBandBaseCTE = `cohort_band_base AS (SELECT h.kind,s.check_name,s.scorer,s.result FROM cohort_score s JOIN cohort_hash_kind h USING(content_hash) WHERE s.rn=1)`
	cohortBandRankCTE = `cohort_band_rank AS (SELECT kind,check_name,scorer,result,ROW_NUMBER() OVER(PARTITION BY kind,check_name,scorer ORDER BY result) rn,COUNT(*) OVER(PARTITION BY kind,check_name,scorer) n FROM cohort_band_base)`
	cohortBandCTE     = `cohort_band AS (SELECT kind,check_name,scorer,n,` +
		`MAX(CASE WHEN rn=CAST((n-1)*0.25 AS INTEGER)+1 THEN result END) p25lo,` +
		`MAX(CASE WHEN rn=CAST((n-1)*0.25 AS INTEGER)+1+CASE WHEN (n-1)*0.25>CAST((n-1)*0.25 AS INTEGER) THEN 1 ELSE 0 END THEN result END) p25hi,` +
		`MAX(CASE WHEN rn=CAST((n-1)*0.75 AS INTEGER)+1 THEN result END) p75lo,` +
		`MAX(CASE WHEN rn=CAST((n-1)*0.75 AS INTEGER)+1+CASE WHEN (n-1)*0.75>CAST((n-1)*0.75 AS INTEGER) THEN 1 ELSE 0 END THEN result END) p75hi ` +
		`FROM cohort_band_rank GROUP BY kind,check_name,scorer)`
	cohortBandRowCTE = `cohort_band_row AS (SELECT s.content_hash,s.check_name,h.kind,CASE WHEN b.n IS NULL THEN 'baseline_unavailable' ` +
		`WHEN s.result<b.p25lo+(b.p25hi-b.p25lo)*((b.n-1)*0.25-CAST((b.n-1)*0.25 AS INTEGER)) THEN 'low' ` +
		`WHEN s.result>b.p75lo+(b.p75hi-b.p75lo)*((b.n-1)*0.75-CAST((b.n-1)*0.75 AS INTEGER)) THEN 'high' ELSE 'mid' END band ` +
		`FROM cohort_score s JOIN cohort_hash_kind h USING(content_hash) LEFT JOIN cohort_band b ON b.kind=h.kind AND b.check_name=s.check_name AND b.scorer=s.scorer WHERE s.rn=1)`
	cohortBandCTEs = cohortScoreCTE + ", " + cohortHashKindCTE + ", " + cohortBandBaseCTE + ", " + cohortBandRankCTE + ", " + cohortBandCTE + ", " + cohortBandRowCTE
)

func cohortLifetimeUsage() (string, []any) {
	life := AnalyticsFilter{From: time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC), To: time.Date(2200, 1, 1, 0, 0, 0, 0, time.UTC)}
	q, args := usageRowsWhere(life)
	q = strings.TrimPrefix(q, "WITH ")
	q = strings.ReplaceAll(q, "usage_u", "usage_u_life")
	q = strings.ReplaceAll(q, "kept", "kept_life")
	return q, args
}

const cohortProvenanceCTEs = `prov_h AS (SELECT conversation_id,harness,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,harness ASC) rn FROM (SELECT conversation_id,COALESCE(NULLIF(harness,''),'unknown') harness,COUNT(*) n FROM facts GROUP BY 1,2)),` +
	`prov_r AS (SELECT conversation_id,COUNT(DISTINCT repo_id) n FROM facts WHERE type IN ('artifact_version','commit') AND repo_id!='' GROUP BY conversation_id),` +
	`prov_m AS (SELECT conversation_id,model,COUNT(*) n FROM kept_life GROUP BY 1,2),` +
	`prov_mt AS (SELECT conversation_id,SUM(n) total,SUM(CASE WHEN model<>'' THEN n ELSE 0 END) named FROM prov_m GROUP BY 1),` +
	`prov_model AS (SELECT t.conversation_id,CASE WHEN t.total=0 THEN '(none)' WHEN t.named=0 THEN 'unknown' WHEN b.n*1.0/t.total>=0.8 THEN b.model ELSE '(mixed)' END session_model ` +
	`FROM prov_mt t LEFT JOIN (SELECT conversation_id,model,n,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY n DESC,model ASC) rn FROM prov_m WHERE model<>'') b ON b.conversation_id=t.conversation_id AND b.rn=1)`

// CohortSessionSubquery returns a parameterized positive source mapping. The result stays inside
// SQLite so a large source population is never copied into an unbounded Go identity slice.
// Source Boolean not complements inside the source grain before resolution; op=exclude is left to
// the target query after this positive set is resolved.
func CohortSessionSubquery(c ParsedCohort, options ...CohortResolveOptions) (string, []any, CohortRelation, error) {
	var opts CohortResolveOptions
	if len(options) > 0 {
		opts = options[0]
	}
	d := c.Definition
	r := CohortRelation{SourceGrain: d.Grain, TargetGrain: "session", Distinct: true, ResolvedN: true}
	from, e1 := time.Parse(time.RFC3339, d.Scope.From)
	to, e2 := time.Parse(time.RFC3339, d.Scope.To)
	if e1 != nil || e2 != nil {
		return "", nil, r, fmt.Errorf("%w: invalid fixed source window", ErrCohortInvalid)
	}
	if d.Grain == "time" {
		if len(d.Scope.Include) != 0 || len(d.Scope.Exclude) != 0 {
			return "", nil, r, fmt.Errorf("%w: time source scope elements are resolved by the time-cohort unit", ErrUnsupportedJoin)
		}
		return timeCohortSessionSubquery(c, from, to, r)
	}
	src, err := cohortSourceFor(c, from, to, opts)
	if err != nil {
		return "", nil, r, err
	}
	r.Mapping, r.Unit = src.rel.Mapping, src.rel.Unit
	predicate, predicateArgs, err := compileCohortColumns(c.root, src.columns)
	if err != nil {
		return "", nil, r, err
	}
	scope, scopeArgs, err := compileCohortScopeColumns(d.Scope, src.columns)
	if err != nil {
		return "", nil, r, err
	}
	q := src.ctes + " SELECT DISTINCT conversation_id FROM (" + src.sql + ") source WHERE (" + scope + ") AND (" + predicate + ")"
	args := append([]any{}, src.args...)
	args = append(args, scopeArgs...)
	args = append(args, predicateArgs...)
	return q, args, r, nil
}

type cohortSource struct {
	ctes    string
	sql     string
	args    []any
	columns cohortColumns
	rel     CohortRelation
}

func compileCohortScopeColumns(scope CohortScope, columns cohortColumns) (string, []any, error) {
	parts := []string{}
	args := []any{}
	clause := func(el CohortScopeElement, negate bool) error {
		expr, eargs, err := columns.lens(el.Lens)
		if err != nil {
			return err
		}
		if len(el.Values) == 0 {
			return fmt.Errorf("%w: scope element values must not be empty", ErrCohortInvalid)
		}
		op := " IN ("
		if negate {
			op = " NOT IN ("
		}
		parts = append(parts, "("+expr+op+strings.TrimSuffix(strings.Repeat("?,", len(el.Values)), ",")+"))")
		args = append(args, eargs...)
		for _, v := range el.Values {
			args = append(args, v)
		}
		return nil
	}
	for _, el := range scope.Include {
		if err := clause(el, false); err != nil {
			return "", nil, err
		}
	}
	for _, el := range scope.Exclude {
		if err := clause(el, true); err != nil {
			return "", nil, err
		}
	}
	if len(parts) == 0 {
		return "1", nil, nil
	}
	return strings.Join(parts, " AND "), args, nil
}

func compileCohortColumns(n *cohortNode, columns cohortColumns) (string, []any, error) {
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
			sql, a, err := compileCohortColumns(child, columns)
			if err != nil {
				return "", nil, err
			}
			parts = append(parts, "("+sql+")")
			args = append(args, a...)
		}
		return strings.Join(parts, sep), args, nil
	}
	if n.kind == "not" {
		sql, a, err := compileCohortColumns(n.children[0], columns)
		return "NOT (" + sql + ")", a, err
	}
	var expr string
	var eargs []any
	var err error
	if n.kind == "in" {
		expr, eargs, err = columns.lens(n.lens)
	} else {
		expr, eargs, err = columns.measure(n.measure)
	}
	if err != nil {
		return "", nil, err
	}
	if n.kind == "in" {
		args = append(args, eargs...)
		if len(n.values) == 0 {
			return "0", nil, nil
		}
		for _, v := range n.values {
			args = append(args, v)
		}
		return expr + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(n.values)), ",") + ")", args, nil
	}
	if n.kind == "is_null" {
		args = append(args, eargs...)
		return expr + " IS NULL", args, nil
	}
	if n.kind != "range" {
		return "", nil, fmt.Errorf("%w: invalid predicate operator", ErrCohortInvalid)
	}
	parts := []string{}
	if n.lo != nil {
		parts = append(parts, expr+">=?")
		args = append(args, eargs...)
		args = append(args, *n.lo)
	}
	if n.hi != nil {
		parts = append(parts, expr+"<=?")
		args = append(args, eargs...)
		args = append(args, *n.hi)
	}
	if len(parts) == 0 {
		return "1", args, nil
	}
	return strings.Join(parts, " AND "), args, nil
}

func cohortScoreExpr(hash string) string {
	return "(SELECT result FROM cohort_score WHERE content_hash=" + hash + " AND check_name=? AND rn=1)"
}

func cohortScorerExpr(hash string) string {
	return "(SELECT scorer FROM cohort_score WHERE content_hash=" + hash + " AND check_name=? AND rn=1)"
}

func cohortBandExpr(hash, kindExpr string) string {
	return "(SELECT band FROM cohort_band_row WHERE content_hash=" + hash + " AND check_name=? AND kind=" + kindExpr + " LIMIT 1)"
}

func cohortSourceFor(c ParsedCohort, from, to time.Time, opts CohortResolveOptions) (cohortSource, error) {
	d := c.Definition
	start, end := seconds(from), seconds(to)
	var src cohortSource
	src.args = []any{start, end}
	life, lifeArgs := cohortLifetimeUsage()
	switch d.Grain {
	case "session":
		src.rel.Mapping, src.rel.Unit = "session_to_itself", "conversation_id"
		usageCTE, usageArgs := usageRowsWhere(AnalyticsFilter{From: from, To: to})
		src.args = append(usageArgs, lifeArgs...)
		src.args = append(src.args, start, end)
		src.ctes = usageCTE + ", " + life + `,` + cohortProvenanceCTEs + `,
			win_usage AS (SELECT conversation_id,COUNT(*) model_calls,SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced_calls,
			 COALESCE(SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)),0) cost_usd,
			 COALESCE(SUM(tok_in),0) tokens_in,COALESCE(SUM(tok_out),0) tokens_out,COALESCE(SUM(tok_cache_read),0) tokens_cache_read,
			 COALESCE(SUM(tok_cache_write),0) tokens_cache_write,COALESCE(SUM(tok_reasoning),0) tokens_reasoning FROM kept GROUP BY conversation_id),
			base AS (SELECT conversation_id,MIN(ts) first_ts,MAX(ts) last_ts,
			 SUM(CASE WHEN type='hook_event' THEN 1 ELSE 0 END) hook_events,
			 SUM(CASE WHEN type='artifact_version' THEN 1 ELSE 0 END) artifact_versions,
			 SUM(CASE WHEN type='commit' THEN 1 ELSE 0 END) commits,
			 COUNT(DISTINCT CASE WHEN type='artifact_version' THEN content_hash END) distinct_content
			 FROM facts WHERE ts>=? AND ts<=? GROUP BY conversation_id),
			base2 AS (SELECT base.*,COALESCE(u.model_calls,0) model_calls,COALESCE(u.unpriced_calls,0) unpriced_calls,COALESCE(u.cost_usd,0) cost_usd,
			 COALESCE(u.tokens_in,0) tokens_in,COALESCE(u.tokens_out,0) tokens_out,COALESCE(u.tokens_cache_read,0) tokens_cache_read,
			 COALESCE(u.tokens_cache_write,0) tokens_cache_write,COALESCE(u.tokens_reasoning,0) tokens_reasoning FROM base LEFT JOIN win_usage u USING(conversation_id))`
		src.sql = `SELECT b.conversation_id,b.first_ts,b.last_ts,(b.last_ts-b.first_ts) duration_s,b.hook_events,b.artifact_versions,b.commits,b.distinct_content,
			b.model_calls,b.unpriced_calls,b.cost_usd,b.tokens_in,b.tokens_out,b.tokens_cache_read,b.tokens_cache_write,b.tokens_reasoning,
			COALESCE(h.harness,'unknown') harness,m.session_model,
			CASE WHEN COALESCE(r.n,0)=0 THEN '(none)' WHEN r.n=1 THEN (SELECT repo_id FROM facts x WHERE x.conversation_id=b.conversation_id AND x.type IN ('artifact_version','commit') AND x.repo_id!='' LIMIT 1) ELSE '(multi)' END session_repo,
			b.conversation_id id
			FROM base2 b LEFT JOIN prov_h h ON h.conversation_id=b.conversation_id AND h.rn=1 LEFT JOIN prov_model m USING(conversation_id) LEFT JOIN prov_r r USING(conversation_id)`
		src.columns = cohortColumns{grain: "session",
			measures: map[string]string{"cost_usd": "source.cost_usd", "unpriced_calls": "source.unpriced_calls", "model_calls": "source.model_calls", "tokens_in": "source.tokens_in", "tokens_out": "source.tokens_out", "tokens_cache_read": "source.tokens_cache_read", "tokens_cache_write": "source.tokens_cache_write", "tokens_reasoning": "source.tokens_reasoning", "hook_events": "source.hook_events", "commits": "source.commits", "artifact_versions": "source.artifact_versions", "distinct_content": "source.distinct_content", "duration_s": "source.duration_s", "first_ts": "source.first_ts", "last_ts": "source.last_ts"},
			lenses:   map[string]string{"harness": "source.harness", "session_model": "source.session_model", "session_repo": "source.session_repo", "id": "source.id"}}
	case "artifact":
		src.rel.Mapping, src.rel.Unit = "artifact_selected_version_to_earliest_writer", "repo_id,path"
		usageCTE, usageArgs := usageRowsWhere(AnalyticsFilter{From: from, To: to})
		src.args = append(append([]any{}, usageArgs...), lifeArgs...)
		src.ctes = usageCTE + ", " + life + `,` + cohortProvenanceCTEs + `,` + cohortBandCTEs + `,
			members AS (SELECT repo_id,path,COUNT(DISTINCT content_hash) versions,COUNT(DISTINCT conversation_id) distinct_writing_sessions,MIN(ts) first_ts,MAX(ts) last_ts
			 FROM facts WHERE type='artifact_version' AND ts>=? AND ts<=? GROUP BY repo_id,path),
			latest AS (SELECT m.*,
			 (SELECT x.content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) content_hash,
			 (SELECT x.source FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) source,
			 (SELECT w.conversation_id FROM facts w WHERE w.type='artifact_version' AND w.repo_id=m.repo_id AND w.path=m.path AND w.content_hash=(SELECT x.content_hash FROM facts x WHERE x.type='artifact_version' AND x.repo_id=m.repo_id AND x.path=m.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) ORDER BY w.ts,w.row_hash LIMIT 1) conversation_id,
			 wf_kind(m.path) kind,wf_plan(m.path) plan FROM members m),
			writer_facts AS (SELECT conversation_id,SUM(CASE WHEN type='hook_event' THEN 1 ELSE 0 END) hook_events FROM facts WHERE ts>=? AND ts<=? GROUP BY conversation_id),
			writer_usage AS (SELECT conversation_id,COUNT(*) model_calls,SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced_calls,
			 COALESCE(SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)),0) cost_usd,
			 COALESCE(SUM(tok_in),0) tokens_in,COALESCE(SUM(tok_out),0) tokens_out,COALESCE(SUM(tok_cache_read),0) tokens_cache_read,
			 COALESCE(SUM(tok_cache_write),0) tokens_cache_write,COALESCE(SUM(tok_reasoning),0) tokens_reasoning FROM kept GROUP BY conversation_id)`
		src.args = append(src.args, start, end, start, end, opts.BlobDir)
		src.sql = `SELECT l.conversation_id,l.repo_id,l.path,l.content_hash _hash,l.kind _kind,l.plan,l.source,l.versions,l.distinct_writing_sessions,l.first_ts,l.last_ts,
			COALESCE(h.harness,'unknown') harness,m.session_model,
			COALESCE((SELECT verdict FROM screens sc WHERE sc.content_hash=l.content_hash ORDER BY sc.at DESC,sc.id DESC LIMIT 1),'unknown') screen_verdict,
			wf_cohort_blob_bytes(?,l.content_hash) content_bytes,
			COALESCE(wu.model_calls,0) writing_session_model_calls,
			CASE WHEN COALESCE(wu.model_calls,0)>0 AND COALESCE(wu.unpriced_calls,0)=COALESCE(wu.model_calls,0) THEN NULL ELSE COALESCE(wu.cost_usd,0) END writing_session_cost_usd,
			COALESCE(wu.tokens_in,0) writing_session_tokens_in,COALESCE(wu.tokens_out,0) writing_session_tokens_out,
			COALESCE(wu.tokens_cache_read,0) writing_session_tokens_cache_read,COALESCE(wu.tokens_cache_write,0) writing_session_tokens_cache_write,
			COALESCE(wu.tokens_reasoning,0) writing_session_tokens_reasoning,COALESCE(wf.hook_events,0) writing_session_hook_events,
			json_object('path',l.path,'repo_id',l.repo_id) id
			FROM latest l LEFT JOIN writer_usage wu USING(conversation_id) LEFT JOIN writer_facts wf USING(conversation_id)
			LEFT JOIN prov_h h ON h.conversation_id=l.conversation_id AND h.rn=1 LEFT JOIN prov_model m ON m.conversation_id=l.conversation_id`
		src.columns = cohortColumns{grain: "artifact",
			measures: map[string]string{"versions": "source.versions", "distinct_writing_sessions": "source.distinct_writing_sessions", "first_ts": "source.first_ts", "last_ts": "source.last_ts", "content_bytes": "source.content_bytes", "writing_session_cost_usd": "source.writing_session_cost_usd", "writing_session_model_calls": "source.writing_session_model_calls", "writing_session_tokens_in": "source.writing_session_tokens_in", "writing_session_tokens_out": "source.writing_session_tokens_out", "writing_session_tokens_cache_read": "source.writing_session_tokens_cache_read", "writing_session_tokens_cache_write": "source.writing_session_tokens_cache_write", "writing_session_tokens_reasoning": "source.writing_session_tokens_reasoning", "writing_session_hook_events": "source.writing_session_hook_events"},
			lenses:   map[string]string{"kind": "source._kind", "plan": "source.plan", "repo_id": "source.repo_id", "harness": "source.harness", "session_model": "source.session_model", "source": "source.source", "screen_verdict": "source.screen_verdict", "id": "source.id"},
			dynamicM: func(name string) (string, []any, error) {
				check, ok := cohortDynamic(cohortMeasures["artifact"], name)
				if !ok {
					return "", nil, nil
				}
				if !opts.anyCheckKnown(check) {
					return "", nil, fmt.Errorf("%w: unknown check %q", ErrCohortInvalid, check)
				}
				return cohortScoreExpr("source._hash"), []any{check}, nil
			},
			dynamicL: func(name string) (string, []any, error) {
				if check, ok := cohortDynamic(cohortLenses["artifact"], name); ok {
					if !opts.anyCheckKnown(check) {
						return "", nil, fmt.Errorf("%w: unknown check %q", ErrCohortInvalid, check)
					}
					return cohortBandExpr("source._hash", "source._kind"), []any{check}, nil
				}
				if name == "scorer" {
					check := cohortSourceCheck(d).Check
					if check == "" {
						return "", nil, fmt.Errorf("%w: artifact scorer requires source.check", ErrCohortInvalid)
					}
					if !opts.anyCheckKnown(check) {
						return "", nil, fmt.Errorf("%w: unknown check %q", ErrCohortInvalid, check)
					}
					return cohortScorerExpr("source._hash"), []any{check}, nil
				}
				return "", nil, nil
			}}
	case "content":
		src.rel.Mapping, src.rel.Unit = "content_representative_to_writing_session", "content_hash"
		source := cohortSourceCheck(d)
		kind, check := source.Kind, source.Check
		if !opts.checkKnown(kind, check) {
			return src, fmt.Errorf("%w: unknown check %q", ErrCohortInvalid, check)
		}
		life2, lifeArgs2 := cohortLifetimeUsage()
		src.args = append(append([]any{}, lifeArgs2...), kind, start, end)
		src.ctes = "WITH " + life2 + `,` + cohortProvenanceCTEs + `,` + cohortBandCTEs + `,
			rep AS (SELECT content_hash,ts,row_hash,repo_id,path,conversation_id,ROW_NUMBER() OVER(PARTITION BY content_hash ORDER BY ts ASC,row_hash ASC,repo_id ASC,path ASC) rn
			 FROM facts WHERE type='artifact_version' AND content_hash!='' AND kind=? AND ts>=? AND ts<=?),
			source_rows AS (SELECT * FROM rep WHERE rn=1)`
		src.sql = `SELECT r.conversation_id,r.content_hash _hash,wf_kind(r.path) _kind,wf_plan(r.path) plan,r.repo_id,
			${SCORE} score,COALESCE(h.harness,'unknown') harness,m.session_model,
			COALESCE((SELECT verdict FROM screens sc WHERE sc.content_hash=r.content_hash ORDER BY sc.at DESC,sc.id DESC LIMIT 1),'unknown') screen_verdict,
			${SCORER} scorer,${BAND} band,r.content_hash id
			FROM source_rows r LEFT JOIN prov_h h ON h.conversation_id=r.conversation_id AND h.rn=1 LEFT JOIN prov_model m ON m.conversation_id=r.conversation_id`
		src.sql = strings.ReplaceAll(src.sql, "${SCORE}", cohortScoreExpr("r.content_hash"))
		src.sql = strings.ReplaceAll(src.sql, "${SCORER}", cohortScorerExpr("r.content_hash"))
		src.sql = strings.ReplaceAll(src.sql, "${BAND}", cohortBandExpr("r.content_hash", "wf_kind(r.path)"))
		src.args = append(src.args, check, check, check)
		src.columns = cohortColumns{grain: "content",
			measures: map[string]string{"score": "source.score"},
			lenses:   map[string]string{"harness": "source.harness", "session_model": "source.session_model", "repo_id": "source.repo_id", "plan": "source.plan", "scorer": "source.scorer", "screen_verdict": "source.screen_verdict", "band": "source.band", "id": "source.id"}}
	case "execution":
		src.rel.Mapping, src.rel.Unit = "execution_to_conversation_id", "repo_id,conversation_id,brief_path"
		usageCTE, usageArgs := usageRowsWhere(AnalyticsFilter{From: from, To: to})
		src.args = append(usageArgs, lifeArgs...)
		src.args = append(src.args, start, end)
		src.ctes = usageCTE + ", " + life + `,` + cohortProvenanceCTEs + `,
			session_usage AS (SELECT conversation_id,COUNT(*) model_calls,SUM(1-wf_usage_priced(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)) unpriced_calls,
			 COALESCE(SUM(wf_usage_cost(harness,model,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported)),0) cost_usd FROM kept GROUP BY conversation_id),
			b AS (SELECT repo_id,plan,conversation_id,path,harness,ts,rowid,ROW_NUMBER() OVER(PARTITION BY repo_id,conversation_id,path ORDER BY ts,rowid) rn FROM facts WHERE type='artifact_version' AND kind='brief' AND ts>=? AND ts<=?)`
		src.sql = `SELECT b.conversation_id,b.repo_id,b.plan,b.path _path,b.harness,b.ts,` + execShapeSQL + ` shape,
			CASE WHEN COALESCE(u.model_calls,0)>0 AND COALESCE(u.unpriced_calls,0)=COALESCE(u.model_calls,0) THEN NULL ELSE COALESCE(u.cost_usd,0) END session_cost_usd,
			m.session_model,json_object('brief_path',b.path,'conversation_id',b.conversation_id,'repo_id',b.repo_id) id
			FROM b LEFT JOIN session_usage u USING(conversation_id) LEFT JOIN prov_model m ON m.conversation_id=b.conversation_id WHERE b.rn=1`
		src.columns = cohortColumns{grain: "execution",
			measures: map[string]string{"session_cost_usd": "source.session_cost_usd", "ts": "source.ts"},
			lenses:   map[string]string{"shape": "source.shape", "plan": "source.plan", "repo_id": "source.repo_id", "harness": "source.harness", "session_model": "source.session_model", "id": "source.id"},
			dynamicM: func(name string) (string, []any, error) {
				for prefix, pathExpr := range map[string]string{"brief_score:": "source._path", "report_score:": "replace(source._path,'/briefs/','/reports/')"} {
					if strings.HasPrefix(name, prefix) {
						check := strings.TrimPrefix(name, prefix)
						if check == "" || strings.Contains(check, ":") || !opts.anyCheckKnown(check) {
							if !opts.anyCheckKnown(check) {
								return "", nil, fmt.Errorf("%w: unknown check %q", ErrCohortInvalid, check)
							}
							return "", nil, nil
						}
						return `(SELECT s.result FROM facts f JOIN scores s ON s.content_hash=f.content_hash
							WHERE f.type='artifact_version' AND f.repo_id=source.repo_id AND f.plan=source.plan AND f.conversation_id=source.conversation_id AND f.path=` + pathExpr + `
							AND f.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=f.repo_id AND x.path=f.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1)
							AND s.check_name=? AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=f.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1) LIMIT 1)`, []any{check}, nil
					}
				}
				return "", nil, nil
			}}
	case "plan":
		src.rel.Mapping, src.rel.Unit = "plan_to_associated_sessions", "repo_id,plan"
		usageCTE, usageArgs := usageRowsWhere(AnalyticsFilter{From: from, To: to})
		src.args = append(usageArgs, lifeArgs...)
		src.args = append(src.args, start, end, start, end, start, end)
		src.ctes = usageCTE + ", " + life + `,` + cohortProvenanceCTEs + `,
			selected AS (SELECT repo_id,plan,path,content_hash,conversation_id,ts FROM facts WHERE type='artifact_version' AND plan<>'' AND ts>=? AND ts<=?),
			active AS (SELECT DISTINCT conversation_id FROM facts WHERE ts>=? AND ts<=?),
			plans AS (SELECT repo_id,plan,COUNT(DISTINCT path) artifacts,COUNT(DISTINCT content_hash) versions,MIN(ts) first_ts,MAX(ts) last_ts FROM selected GROUP BY repo_id,plan),
			assoc AS (SELECT DISTINCT f.repo_id,f.plan,a.conversation_id FROM facts f JOIN active a USING(conversation_id) WHERE f.type='artifact_version' AND f.plan<>''),
			shared AS (SELECT s.repo_id,s.plan,COUNT(DISTINCT s.conversation_id) shared_sessions FROM assoc s WHERE (SELECT COUNT(DISTINCT f2.plan) FROM facts f2 WHERE f2.type='artifact_version' AND f2.conversation_id=s.conversation_id AND f2.plan<>'')>1 GROUP BY s.repo_id,s.plan),
			execs AS (SELECT repo_id,plan,SUM(shape='complete') executions_complete,SUM(shape='unreported') executions_unreported,SUM(shape='started') executions_started FROM (
			 SELECT b.repo_id,b.plan,b.conversation_id,b.path,` + execShapeSQL + ` shape FROM (SELECT repo_id,plan,conversation_id,path,harness,ts,ROW_NUMBER() OVER(PARTITION BY repo_id,conversation_id,path ORDER BY ts,rowid) rn FROM facts WHERE type='artifact_version' AND kind='brief' AND ts>=? AND ts<=?) b WHERE rn=1) GROUP BY repo_id,plan),
			prov_ph AS (SELECT a.repo_id,a.plan,COALESCE(h.harness,'unknown') harness,COUNT(*) n FROM assoc a LEFT JOIN prov_h h ON h.conversation_id=a.conversation_id AND h.rn=1 GROUP BY a.repo_id,a.plan,COALESCE(h.harness,'unknown')),
			prov_pm AS (SELECT a.repo_id,a.plan,m.session_model,COUNT(*) n FROM assoc a LEFT JOIN prov_model m ON m.conversation_id=a.conversation_id GROUP BY a.repo_id,a.plan,m.session_model)`
		src.sql = `SELECT a.conversation_id,p.repo_id,p.plan,p.artifacts,p.versions,(SELECT COUNT(DISTINCT a2.conversation_id) FROM assoc a2 WHERE a2.repo_id=p.repo_id AND a2.plan=p.plan) sessions,COALESCE(sh.shared_sessions,0) shared_sessions,
			COALESCE(e.executions_complete,0) executions_complete,COALESCE(e.executions_unreported,0) executions_unreported,COALESCE(e.executions_started,0) executions_started,
			CASE WHEN COALESCE(e.executions_complete,0)+COALESCE(e.executions_unreported,0)+COALESCE(e.executions_started,0)=0 THEN NULL
			 ELSE 1.0*COALESCE(e.executions_complete,0)/(COALESCE(e.executions_complete,0)+COALESCE(e.executions_unreported,0)+COALESCE(e.executions_started,0)) END complete_share,
			(p.last_ts-p.first_ts)/86400.0 span_days,p.first_ts,p.last_ts,
			(SELECT CASE WHEN COUNT(*)=0 THEN 0 WHEN SUM(1-wf_usage_priced(u.harness,u.model,u.tok_in,u.tok_out,u.tok_cache_read,u.tok_cache_write,u.tok_reasoning,u.cost_reported))=COUNT(*) THEN NULL ELSE SUM(wf_usage_cost(u.harness,u.model,u.tok_in,u.tok_out,u.tok_cache_read,u.tok_cache_write,u.tok_reasoning,u.cost_reported)) END FROM kept u WHERE u.conversation_id IN (SELECT conversation_id FROM assoc x WHERE x.repo_id=p.repo_id AND x.plan=p.plan)) associated_cost_usd,
			COALESCE((SELECT SUM(1-wf_usage_priced(u.harness,u.model,u.tok_in,u.tok_out,u.tok_cache_read,u.tok_cache_write,u.tok_reasoning,u.cost_reported)) FROM kept u WHERE u.conversation_id IN (SELECT conversation_id FROM assoc x WHERE x.repo_id=p.repo_id AND x.plan=p.plan)),0) unpriced_calls,
			COALESCE((SELECT harness FROM prov_ph x WHERE x.repo_id=p.repo_id AND x.plan=p.plan ORDER BY x.n DESC,x.harness ASC LIMIT 1),'unknown') harness,
			(SELECT CASE WHEN SUM(n)=0 THEN '(none)' WHEN MAX(CASE WHEN session_model='unknown' THEN n ELSE 0 END)=SUM(n) THEN 'unknown'
				WHEN MAX(n)*1.0/SUM(n)>=0.8 THEN (SELECT session_model FROM prov_pm y WHERE y.repo_id=p.repo_id AND y.plan=p.plan ORDER BY y.n DESC,y.session_model ASC LIMIT 1) ELSE '(mixed)' END FROM prov_pm z WHERE z.repo_id=p.repo_id AND z.plan=p.plan) session_model,
			json_object('plan',p.plan,'repo_id',p.repo_id) id
			FROM plans p JOIN assoc a ON a.repo_id=p.repo_id AND a.plan=p.plan LEFT JOIN shared sh USING(repo_id,plan) LEFT JOIN execs e USING(repo_id,plan)`
		src.columns = cohortColumns{grain: "plan",
			measures: map[string]string{"artifacts": "source.artifacts", "versions": "source.versions", "sessions": "source.sessions", "shared_sessions": "source.shared_sessions", "associated_cost_usd": "source.associated_cost_usd", "unpriced_calls": "source.unpriced_calls", "executions_complete": "source.executions_complete", "executions_unreported": "source.executions_unreported", "executions_started": "source.executions_started", "complete_share": "source.complete_share", "span_days": "source.span_days", "first_ts": "source.first_ts", "last_ts": "source.last_ts"},
			lenses:   map[string]string{"repo_id": "source.repo_id", "harness": "source.harness", "session_model": "source.session_model", "id": "source.id"},
			dynamicM: func(name string) (string, []any, error) {
				if strings.HasPrefix(name, "artifacts:") {
					kind := strings.TrimPrefix(name, "artifacts:")
					if !validCohortKind(kind) {
						return "", nil, fmt.Errorf("%w: unknown artifact kind %q", ErrCohortInvalid, kind)
					}
					return `(SELECT COUNT(DISTINCT k.path) FROM facts k WHERE k.type='artifact_version' AND k.repo_id=source.repo_id AND k.plan=source.plan AND k.kind=? AND k.ts>=? AND k.ts<=?)`, []any{kind, start, end}, nil
				}
				if strings.HasPrefix(name, "design_score:") {
					check := strings.TrimPrefix(name, "design_score:")
					if check == "" || strings.Contains(check, ":") || !opts.anyCheckKnown(check) {
						if !opts.anyCheckKnown(check) {
							return "", nil, fmt.Errorf("%w: unknown check %q", ErrCohortInvalid, check)
						}
						return "", nil, nil
					}
					return `(SELECT s.result FROM facts d JOIN scores s ON s.content_hash=d.content_hash WHERE d.type='artifact_version' AND d.repo_id=source.repo_id AND d.plan=source.plan AND d.kind='design' AND d.rowid=(SELECT x.rowid FROM facts x WHERE x.type='artifact_version' AND x.repo_id=d.repo_id AND x.path=d.path ORDER BY x.received_at DESC,x.rowid DESC LIMIT 1) AND s.check_name=? AND s.id=(SELECT z.id FROM scores z WHERE z.content_hash=s.content_hash AND z.check_name=s.check_name ORDER BY z.id DESC LIMIT 1) ORDER BY s.id DESC LIMIT 1)`, []any{check}, nil
				}
				return "", nil, nil
			}}
	default:
		return src, fmt.Errorf("%w: unsupported source grain %q", ErrUnsupportedJoin, d.Grain)
	}
	return src, nil
}

func cohortSourceCheck(d CohortDefinition) struct{ Kind, Check string } {
	var source struct {
		Kind  string `json:"kind"`
		Check string `json:"check"`
	}
	_ = json.Unmarshal(d.Source, &source)
	return struct{ Kind, Check string }{source.Kind, source.Check}
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
	// ResolvedN reports that resolved_n is |C| before the target window, as 17.3.1 requires.
	ResolvedN bool `json:"resolved_n_support"`
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
