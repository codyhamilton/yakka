package review

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/codyhamilton/yakka/packages/yakka/internal/secrets"
)

// Outcome is one criterion assessment from the reviewer.
type Outcome struct {
	CriterionID string `json:"criterion_id"`
	Assessment  string `json:"assessment"`
	Evidence    string `json:"evidence"`
}

// Finding is a returned concern. Unsupported marks evidence or a location that
// could not be mechanically tied to the packet; unsupported findings remain.
type Finding struct {
	ID           string   `json:"id"`
	Severity     string   `json:"severity"`
	Lens         string   `json:"lens"`
	Title        string   `json:"title"`
	Path         string   `json:"path"`
	LineStart    int      `json:"line_start"`
	LineEnd      int      `json:"line_end"`
	Evidence     string   `json:"evidence"`
	CriterionIDs []string `json:"criterion_ids"`
	Confidence   float64  `json:"confidence"`
	Rationale    string   `json:"rationale"`
	Unsupported  bool     `json:"unsupported,omitempty"`
}

type reviewerReply struct {
	Outcomes    []Outcome `json:"outcomes"`
	Findings    []Finding `json:"findings"`
	Limitations []string  `json:"limitations"`
	Coverage    string    `json:"coverage"`
}

// InvalidReplyError classifies why a reply failed the strict contract. It never
// carries reply bytes. Reason is a short machine-readable value.
type InvalidReplyError struct{ Reason string }

func (e *InvalidReplyError) Error() string { return "invalid output" }

func invalidReply(reason string) error { return &InvalidReplyError{Reason: reason} }

// redactReply replaces secret matches inside decoded string fields and reports
// whether any value changed. It never touches JSON structure or non-string
// values. Support checks run afterwards on these redacted values, preserving
// the prior behaviour where redaction happened before validation.
func redactReply(reply *reviewerReply) bool {
	changed := false
	redact := func(s *string) {
		if *s == "" {
			return
		}
		if r := secrets.Redact(*s); r != *s {
			*s = r
			changed = true
		}
	}
	for i := range reply.Outcomes {
		o := &reply.Outcomes[i]
		redact(&o.CriterionID)
		redact(&o.Evidence)
	}
	for i := range reply.Findings {
		f := &reply.Findings[i]
		redact(&f.ID)
		redact(&f.Title)
		redact(&f.Path)
		redact(&f.Evidence)
		redact(&f.Rationale)
		for j := range f.CriterionIDs {
			redact(&f.CriterionIDs[j])
		}
	}
	for i := range reply.Limitations {
		redact(&reply.Limitations[i])
	}
	return changed
}

// rawOutcomeEvidenceValid reports whether every raw outcome evidence token is
// valid UTF-8. Malformed structure is left to the strict decoder.
func rawOutcomeEvidenceValid(raw json.RawMessage) bool {
	var outcomes []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &outcomes); err != nil {
		return true
	}
	for _, outcome := range outcomes {
		if evidence, ok := outcome["evidence"]; ok && !utf8.Valid(evidence) {
			return false
		}
	}
	return true
}

// validateOutcomes enforces one outcome per supplied criterion id and returns
// the supplied id set for finding support checks. Each failure has a distinct
// body-free reason.
func validateOutcomes(outcomes []Outcome, criteria []Criterion) (map[string]struct{}, error) {
	criteriaSet := make(map[string]struct{}, len(criteria))
	for _, criterion := range criteria {
		if criterion.ID == "" {
			return nil, invalidReply("empty_criterion_id")
		}
		criteriaSet[criterion.ID] = struct{}{}
	}
	seen := make(map[string]bool, len(criteriaSet))
	for _, outcome := range outcomes {
		if _, exists := criteriaSet[outcome.CriterionID]; !exists {
			return nil, invalidReply("unknown_criterion")
		}
		if seen[outcome.CriterionID] {
			return nil, invalidReply("duplicate_criterion")
		}
		seen[outcome.CriterionID] = true
		if outcome.Assessment != "met" && outcome.Assessment != "partial" && outcome.Assessment != "not met" && outcome.Assessment != "unassessable" {
			return nil, invalidReply("invalid_assessment")
		}
		if !utf8.ValidString(outcome.Evidence) {
			return nil, invalidReply("invalid_evidence")
		}
	}
	if len(seen) != len(criteriaSet) {
		return nil, invalidReply("missing_outcomes")
	}
	return criteriaSet, nil
}

// InvalidReason returns the body-free validator classification, if any.
func InvalidReason(err error) string {
	var ire *InvalidReplyError
	if errors.As(err, &ire) {
		return ire.Reason
	}
	return ""
}

var hunkHeader = regexp.MustCompile(`^@@ -[0-9]+(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@`)

// unwrapJSONFence trims surrounding whitespace and removes one optional
// markdown fence around the whole reply. It never salvages prose or multiple
// JSON values: anything after the closing fence is left in place and rejected
// as trailing data.
func unwrapJSONFence(raw []byte) []byte {
	s := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(s, "```") {
		return []byte(s)
	}
	nl := strings.IndexByte(s, '\n')
	if nl < 0 {
		return []byte(s)
	}
	open := strings.TrimSpace(s[:nl])
	if open != "```" && !strings.EqualFold(open, "```json") {
		return []byte(s)
	}
	rest := strings.TrimRight(s[nl+1:], " \t\r\n")
	if !strings.HasSuffix(rest, "```") {
		return []byte(s)
	}
	return []byte(strings.TrimSpace(rest[:len(rest)-3]))
}

// ValidateReply parses the strict result schema, checks criterion coverage and
// marks findings unsupported when evidence or locations lack packet support.
// An optional single markdown fence around the object is accepted; every
// failure returns an *InvalidReplyError with a body-free reason.
func ValidateReply(raw []byte, packet Packet, criteria []Criterion) (Result, error) {
	raw = unwrapJSONFence(raw)
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var reply reviewerReply
	if err := dec.Decode(&reply); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return Result{}, invalidReply("unknown_field")
		}
		return Result{}, invalidReply("json_parse")
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		return Result{}, invalidReply("trailing_data")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return Result{}, invalidReply("json_parse")
	}
	for _, key := range []string{"outcomes", "findings", "limitations", "coverage"} {
		if _, ok := fields[key]; !ok {
			return Result{}, invalidReply("missing_field")
		}
	}
	if len(fields) != 4 {
		return Result{}, invalidReply("unknown_field")
	}
	if reply.Outcomes == nil {
		return Result{}, invalidReply("missing_outcomes")
	}
	if reply.Findings == nil || reply.Limitations == nil {
		return Result{}, invalidReply("missing_field")
	}
	// The decoder replaces invalid UTF-8 bytes with U+FFFD, so check the raw
	// outcome evidence tokens before that sanitization can hide the defect.
	if !rawOutcomeEvidenceValid(fields["outcomes"]) {
		return Result{}, invalidReply("invalid_evidence")
	}
	// Redact decoded string values only, after the strict decode. The raw bytes
	// are valid JSON by construction, so an env-style assignment at the start of
	// a value can no longer consume the opening quote and corrupt parsing.
	wasRedacted := redactReply(&reply)
	if reply.Coverage != "complete" && reply.Coverage != "partial" {
		return Result{}, invalidReply("invalid_coverage")
	}
	criteriaSet, err := validateOutcomes(reply.Outcomes, criteria)
	if err != nil {
		return Result{}, err
	}
	context, err := untrustedText(packet.Prompt)
	if err != nil {
		return Result{}, errors.New("invalid packet")
	}
	hunks := packetHunks(context)
	unsupported := 0
	for i := range reply.Findings {
		f := &reply.Findings[i]
		if f.ID == "" || f.Title == "" || f.Rationale == "" || !utf8.ValidString(f.Evidence) || !utf8.ValidString(f.Path) ||
			(f.Severity != "blocker" && f.Severity != "high" && f.Severity != "medium" && f.Severity != "low") ||
			(f.Lens != "outcome" && f.Lens != "intent-assumptions" && f.Lens != "correctness" && f.Lens != "security" && f.Lens != "contract" && f.Lens != "tests" && f.Lens != "other") ||
			f.Confidence < 0 || f.Confidence > 1 || f.CriterionIDs == nil {
			return Result{}, invalidReply("invalid_finding")
		}
		for _, id := range f.CriterionIDs {
			if id == "" {
				return Result{}, invalidReply("invalid_finding")
			}
		}
		if !supportedFinding(*f, context, hunks, criteriaSet) {
			f.Unsupported = true
			unsupported++
		}
	}
	return Result{Outcomes: reply.Outcomes, Findings: reply.Findings, Limitations: reply.Limitations,
		Coverage: reply.Coverage, UnsupportedFindings: unsupported, ReplyRedacted: wasRedacted}, nil
}

func supportedFinding(f Finding, context string, hunks map[string][]lineRange, criteria map[string]struct{}) bool {
	if utf8.RuneCountInString(f.Evidence) < 20 || !strings.Contains(context, f.Evidence) {
		return false
	}
	for _, id := range f.CriterionIDs {
		if _, ok := criteria[id]; !ok {
			return false
		}
	}
	if f.Path == "unsupported" {
		return false
	}
	if f.LineStart < 1 || f.LineEnd < f.LineStart {
		return false
	}
	for _, r := range hunks[f.Path] {
		if f.LineStart >= r.start && f.LineEnd <= r.end {
			return true
		}
	}
	return false
}

type lineRange struct{ start, end int }

func packetHunks(context string) map[string][]lineRange {
	out := map[string][]lineRange{}
	path := ""
	var current *lineRange
	for _, line := range strings.Split(context, "\n") {
		if strings.HasPrefix(line, "+++ b/") {
			path = strings.TrimPrefix(line, "+++ b/")
			current = nil
			continue
		}
		if m := hunkHeader.FindStringSubmatch(line); m != nil && path != "" {
			start, _ := strconv.Atoi(m[2])
			count := 1
			if m[3] != "" {
				count, _ = strconv.Atoi(m[3])
			}
			r := lineRange{start: start, end: start + count - 1}
			if count == 0 {
				r.end = start
			}
			out[path] = append(out[path], r)
			current = &out[path][len(out[path])-1]
			continue
		}
		if current != nil && (strings.HasPrefix(line, "diff --git ") || strings.HasPrefix(line, "--- a/")) {
			current = nil
		}
	}
	return out
}

func untrustedText(prompt []byte) (string, error) {
	const marker = "<<<YAKKA_UNTRUSTED_"
	start := strings.Index(string(prompt), marker)
	if start < 0 {
		return "", errors.New("missing untrusted delimiter")
	}
	startEnd := strings.IndexByte(string(prompt[start:]), '\n')
	if startEnd < 0 {
		return "", errors.New("bad untrusted delimiter")
	}
	opening := string(prompt[start : start+startEnd])
	contentStart := start + startEnd + 1
	close := strings.Index(string(prompt[contentStart:]), "\n"+opening)
	if close < 0 {
		return "", errors.New("missing closing delimiter")
	}
	return string(prompt[contentStart : contentStart+close]), nil
}
