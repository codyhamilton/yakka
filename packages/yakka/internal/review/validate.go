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

var hunkHeader = regexp.MustCompile(`^@@ -[0-9]+(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@`)

// ValidateReply parses the strict result schema, checks criterion coverage and
// marks findings unsupported when evidence or locations lack packet support.
func ValidateReply(raw []byte, packet Packet, criteria []Criterion) (Result, error) {
	redacted := secrets.Redact(string(raw))
	wasRedacted := redacted != string(raw)
	dec := json.NewDecoder(bytes.NewBufferString(redacted))
	dec.DisallowUnknownFields()
	var reply reviewerReply
	if err := dec.Decode(&reply); err != nil {
		return Result{}, errors.New("invalid output")
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		return Result{}, errors.New("invalid output")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(redacted), &fields); err != nil {
		return Result{}, errors.New("invalid output")
	}
	for _, key := range []string{"outcomes", "findings", "limitations", "coverage"} {
		if _, ok := fields[key]; !ok {
			return Result{}, errors.New("invalid output")
		}
	}
	if len(fields) != 4 || reply.Outcomes == nil || reply.Findings == nil || reply.Limitations == nil {
		return Result{}, errors.New("invalid output")
	}
	if reply.Coverage != "complete" && reply.Coverage != "partial" {
		return Result{}, errors.New("invalid output")
	}
	criteriaSet := make(map[string]struct{}, len(criteria))
	for _, criterion := range criteria {
		if criterion.ID == "" {
			return Result{}, errors.New("invalid criteria")
		}
		criteriaSet[criterion.ID] = struct{}{}
	}
	seen := make(map[string]bool, len(criteriaSet))
	for _, outcome := range reply.Outcomes {
		if _, exists := criteriaSet[outcome.CriterionID]; !exists || seen[outcome.CriterionID] {
			return Result{}, errors.New("invalid output")
		}
		seen[outcome.CriterionID] = true
		if outcome.Assessment != "met" && outcome.Assessment != "partial" && outcome.Assessment != "not met" && outcome.Assessment != "unassessable" {
			return Result{}, errors.New("invalid output")
		}
		if !utf8.ValidString(outcome.Evidence) {
			return Result{}, errors.New("invalid output")
		}
	}
	if len(seen) != len(criteriaSet) {
		return Result{}, errors.New("invalid output")
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
			return Result{}, errors.New("invalid output")
		}
		for _, id := range f.CriterionIDs {
			if id == "" {
				return Result{}, errors.New("invalid output")
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
