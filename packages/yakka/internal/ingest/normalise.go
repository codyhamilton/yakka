package ingest

import "strings"

// Derived is what the ingest policy stores beside a hook event's native name and payload.
type Derived struct {
	NormEvent, Tool, Model                                   string
	TokIn, TokOut, TokCacheRead, TokCacheWrite, TokReasoning int64
	CostReported                                             *float64 // nil when the payload carries no cost
}

// normTable maps lower-cased native event names to norm_event. It is seeded from the kinds in
// packages/hooklog/hooklog.py normalize() and extended with the names the local ledger holds.
// Names are shared across harnesses (each harness uses a subset), so one table serves all; an
// unknown harness or event is "other". transcript.* events are handled in Derive because their
// mapping depends on the payload.
var normTable = map[string]string{
	"sessionstart": "session_start", "session.created": "session_start",
	"sessionend":       "session_end",
	"userpromptsubmit": "prompt", "beforesubmitprompt": "prompt", "chat.message": "prompt",
	"pretooluse": "tool_pre", "tool.execute.before": "tool_pre",
	"tool.execute.incomplete": "tool_fail",
	"posttooluse":             "tool_post", "tool.execute.after": "tool_post", "afterfileedit": "tool_post",
	"aftertabfileedit": "tool_post", "aftershellexecution": "tool_post", "aftermcpexecution": "tool_post",
	"posttoolusefailure": "tool_fail",
	"posttoolbatch":      "batch_end",
	"afteragentresponse": "assistant_message", "messagedisplay": "assistant_message",
	"experimental.text.complete": "assistant_message",
	"stop":                       "turn_end", "stopfailure": "turn_end",
	"subagentstart": "subagent_start", "subagentstop": "subagent_end",
	"precompact": "compact", "postcompact": "compact",
	"message.part.updated": "message_part",
}

var knownHarness = map[string]bool{"claude": true, "codex": true, "opencode": true, "cursor": true}

// Derive computes norm_event, tool, model and token/cost fields for one hook event. It never
// panics; missing or mistyped fields give zero values. A nil payload is valid.
func Derive(harness, event string, payload map[string]any) Derived {
	d := Derived{NormEvent: "other"}
	if !knownHarness[harness] {
		return d
	}
	low := strings.ToLower(event)
	switch low {
	case "transcript.token_count":
		if harness == "codex" {
			d.NormEvent = "usage"
			extractCodex(&d, payload)
		}
	case "transcript.assistant_message":
		d.NormEvent = "assistant_message"
		switch harness {
		case "claude":
			if extractClaude(&d, payload) {
				d.NormEvent = "usage"
			}
		case "codex":
			d.Model = strField(payload, "model")
		case "opencode":
			if extractOpenCode(&d, payload) {
				d.NormEvent = "usage"
			}
		}
	default:
		if n, ok := normTable[low]; ok {
			d.NormEvent = n
		}
	}
	switch d.NormEvent {
	case "tool_pre", "tool_post", "tool_fail":
		d.Tool = strField(payload, "tool_name")
	}
	return d
}
