package review

import (
	"bytes"
	"strings"
	"testing"
)

const supportedExcerpt = "func reviewChange() { return true }"

func testPacket() Packet {
	context := "diff --git a/review.go b/review.go\n--- a/review.go\n+++ b/review.go\n@@ -0,0 +1,2 @@\n+func reviewChange() { return true }\n+// meaningful included change line\n"
	delim := "<<<YAKKA_UNTRUSTED_test>>>"
	return Packet{Prompt: []byte("ROLE\nreview\nOUTPUT CONTRACT\ncontract\nCRITERIA\ncriterion\nCOVERAGE SUMMARY\nsummary\nUNTRUSTED CONTEXT\n" + delim + "\n" + context + delim)}
}

func validReplyJSON() string {
	return `{"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"}],"findings":[{"id":"F1","severity":"high","lens":"correctness","title":"Issue","path":"review.go","line_start":1,"line_end":2,"evidence":"` + supportedExcerpt + `","criterion_ids":["I1"],"confidence":0.9,"rationale":"The changed function has a correctness issue."}],"limitations":[],"coverage":"complete"}`
}

func TestValidateReplyAllEnumsAndSupport(t *testing.T) {
	for _, assessment := range []string{"met", "partial", "not met", "unassessable"} {
		raw := strings.Replace(validReplyJSON(), `"assessment":"met"`, `"assessment":"`+assessment+`"`, 1)
		for _, severity := range []string{"blocker", "high", "medium", "low"} {
			raw2 := strings.Replace(raw, `"severity":"high"`, `"severity":"`+severity+`"`, 1)
			for _, lens := range []string{"outcome", "intent-assumptions", "correctness", "security", "contract", "tests", "other"} {
				raw3 := strings.Replace(raw2, `"lens":"correctness"`, `"lens":"`+lens+`"`, 1)
				result, err := ValidateReply([]byte(raw3), testPacket(), []Criterion{{ID: "I1", Text: "criteria"}})
				if err != nil || result.UnsupportedFindings != 0 {
					t.Fatalf("assessment=%s severity=%s lens=%s result=%+v err=%v", assessment, severity, lens, result, err)
				}
			}
		}
	}
	for _, coverage := range []string{"complete", "partial"} {
		raw := strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"`+coverage+`"`, 1)
		if _, err := ValidateReply([]byte(raw), testPacket(), []Criterion{{ID: "I1"}}); err != nil {
			t.Errorf("coverage %s: %v", coverage, err)
		}
	}
}

func TestValidateReplyRetainsUnsupportedFindings(t *testing.T) {
	for name, replacement := range map[string]string{
		"short evidence":        strings.Replace(validReplyJSON(), supportedExcerpt, "short", 1),
		"unmatched evidence":    strings.Replace(validReplyJSON(), supportedExcerpt, "This evidence appears nowhere in the diff.", 1),
		"wrong path":            strings.Replace(validReplyJSON(), `"path":"review.go"`, `"path":"elsewhere.go"`, 1),
		"wrong line":            strings.Replace(validReplyJSON(), `"line_start":1,"line_end":2`, `"line_start":8,"line_end":9`, 1),
		"unsupported sentinel":  strings.Replace(validReplyJSON(), `"path":"review.go"`, `"path":"unsupported"`, 1),
		"unknown criterion ref": strings.Replace(validReplyJSON(), `"criterion_ids":["I1"]`, `"criterion_ids":["unknown"]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			result, err := ValidateReply([]byte(replacement), testPacket(), []Criterion{{ID: "I1"}})
			if err != nil || result.UnsupportedFindings != 1 || len(result.Findings) != 1 || !result.Findings[0].Unsupported {
				t.Fatalf("result=%+v err=%v", result, err)
			}
		})
	}
}

func TestValidateReplyAcceptsSingleFenceAndWhitespace(t *testing.T) {
	for name, raw := range map[string]string{
		"json fence":   "```json\n" + validReplyJSON() + "\n```",
		"bare fence":   "```\n" + validReplyJSON() + "\n```",
		"whitespace":   "\n\t " + validReplyJSON() + " \n",
		"fence spaces": "```json\n" + validReplyJSON() + "\n```   \n",
	} {
		t.Run(name, func(t *testing.T) {
			result, err := ValidateReply([]byte(raw), testPacket(), []Criterion{{ID: "I1"}})
			if err != nil || result.Coverage != "complete" || result.UnsupportedFindings != 0 {
				t.Fatalf("result=%+v err=%v", result, err)
			}
		})
	}
}

func TestValidateReplyRejectsUnwrappedTrailingAndProse(t *testing.T) {
	for name, raw := range map[string]string{
		"trailing after fence": "```json\n" + validReplyJSON() + "\n```\nmore",
		"prose before fence":   "Here is the review:\n```json\n" + validReplyJSON() + "\n```",
		"two objects":          validReplyJSON() + " " + validReplyJSON(),
		"unclosed fence":       "```json\n" + validReplyJSON(),
		"wrong fence language": "```yaml\n" + validReplyJSON() + "\n```",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ValidateReply([]byte(raw), testPacket(), []Criterion{{ID: "I1"}}); err == nil {
				t.Fatal("expected invalid output")
			}
		})
	}
}

func TestValidateReplyReasonsAreSpecific(t *testing.T) {
	for name, tc := range map[string]struct {
		raw      string
		want     string
		criteria []Criterion
	}{
		"parse":               {"not json", "json_parse", nil},
		"trailing":            {validReplyJSON() + " trailing", "trailing_data", nil},
		"unknown field":       {strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"complete","extra":true`, 1), "unknown_field", nil},
		"missing field":       {strings.Replace(validReplyJSON(), `"limitations":[],`, "", 1), "missing_field", nil},
		"missing outcomes":    {strings.Replace(validReplyJSON(), `{"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"}],`, `{"outcomes":[],`, 1), "missing_outcomes", nil},
		"invalid coverage":    {strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"unknown"`, 1), "invalid_coverage", nil},
		"empty criterion id":  {validReplyJSON(), "empty_criterion_id", []Criterion{{ID: ""}}},
		"unknown criterion":   {strings.Replace(validReplyJSON(), `"criterion_id":"I1"`, `"criterion_id":"I2"`, 1), "unknown_criterion", nil},
		"duplicate criterion": {strings.Replace(validReplyJSON(), `"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"}]`, `"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"},{"criterion_id":"I1","assessment":"partial","evidence":"reviewed"}]`, 1), "duplicate_criterion", nil},
		"invalid assessment":  {strings.Replace(validReplyJSON(), `"assessment":"met"`, `"assessment":"maybe"`, 1), "invalid_assessment", nil},
		"invalid finding":     {strings.Replace(validReplyJSON(), `"rationale":"The changed function has a correctness issue."`, `"rationale":""`, 1), "invalid_finding", nil},
	} {
		t.Run(name, func(t *testing.T) {
			criteria := tc.criteria
			if criteria == nil {
				criteria = []Criterion{{ID: "I1"}}
			}
			_, err := ValidateReply([]byte(tc.raw), testPacket(), criteria)
			if got := InvalidReason(err); got != tc.want {
				t.Fatalf("reason = %q; want %q (err=%v)", got, tc.want, err)
			}
		})
	}
}

func TestValidateReplyRejectsInvalidEvidence(t *testing.T) {
	raw := bytes.Replace([]byte(validReplyJSON()), []byte("reviewed"), []byte("a\xffb"), 1)
	_, err := ValidateReply(raw, testPacket(), []Criterion{{ID: "I1"}})
	if got := InvalidReason(err); got != "invalid_evidence" {
		t.Fatalf("reason = %q; want invalid_evidence", got)
	}
}

func TestValidateOutcomesRejectsInvalidEvidence(t *testing.T) {
	_, err := validateOutcomes([]Outcome{{CriterionID: "I1", Assessment: "met", Evidence: string([]byte{0xff})}}, []Criterion{{ID: "I1"}})
	if got := InvalidReason(err); got != "invalid_evidence" {
		t.Fatalf("reason = %q; want invalid_evidence (err=%v)", got, err)
	}
}

func TestValidateReplyRejectsMalformedCoverageAndSchema(t *testing.T) {
	for name, raw := range map[string]string{
		"malformed":           "{",
		"invalid assessment":  strings.Replace(validReplyJSON(), `"assessment":"met"`, `"assessment":"maybe"`, 1),
		"invalid severity":    strings.Replace(validReplyJSON(), `"severity":"high"`, `"severity":"urgent"`, 1),
		"invalid lens":        strings.Replace(validReplyJSON(), `"lens":"correctness"`, `"lens":"invented"`, 1),
		"invalid coverage":    strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"unknown"`, 1),
		"missing criterion":   strings.Replace(validReplyJSON(), `{"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"}],`, `{"outcomes":[],`, 1),
		"duplicate criterion": strings.Replace(validReplyJSON(), `"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"}]`, `"outcomes":[{"criterion_id":"I1","assessment":"met","evidence":"reviewed"},{"criterion_id":"I1","assessment":"partial","evidence":"reviewed"}]`, 1),
		"unknown field":       strings.Replace(validReplyJSON(), `"coverage":"complete"`, `"coverage":"complete","extra":true`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ValidateReply([]byte(raw), testPacket(), []Criterion{{ID: "I1"}}); err == nil {
				t.Fatal("expected invalid_output")
			}
		})
	}
}

func TestValidateReplyRedactsEnvAssignmentAtValueStart(t *testing.T) {
	for name, value := range map[string]string{
		"plain value":      "API_KEY=abcd1234efgh5678 set",
		"escaped key form": `{\"API_KEY\":\"abcd1234efgh5678\"}`,
	} {
		t.Run(name, func(t *testing.T) {
			raw := strings.Replace(validReplyJSON(), supportedExcerpt, value, 1)
			result, err := ValidateReply([]byte(raw), testPacket(), []Criterion{{ID: "I1"}})
			if err != nil {
				t.Fatalf("valid JSON with an env-style value must validate: %v", err)
			}
			if !result.ReplyRedacted || strings.Contains(result.Findings[0].Evidence, "abcd1234efgh5678") || !strings.Contains(result.Findings[0].Evidence, "[REDACTED:env_assignment]") {
				t.Fatalf("result=%+v", result)
			}
		})
	}
}

func TestValidateReplyRedactsSecretsInPlace(t *testing.T) {
	secret := "sk-" + strings.Repeat("a1", 12)
	raw := strings.Replace(validReplyJSON(), "The changed function has a correctness issue.", "The changed function uses "+secret+".", 1)
	result, err := ValidateReply([]byte(raw), testPacket(), []Criterion{{ID: "I1"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.ReplyRedacted || !strings.Contains(result.Findings[0].Rationale, "[REDACTED:sk_key]") || strings.Contains(result.Findings[0].Rationale, secret) {
		t.Fatalf("result=%+v", result)
	}
}
