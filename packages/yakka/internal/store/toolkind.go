package store

import (
	"sort"
	"strings"
)

// toolKinds groups the tool names the harnesses report into a few kinds, so tool use can be
// compared across harnesses. Names are lower-cased with a leading "collaboration" removed (Codex
// and Claude report some agent tools as collaborationspawn_agent). A name not listed is "other".
// The kind is computed in the query, not stored, so editing this table changes old rows too.
var toolKinds = map[string][]string{
	"shell":  {"bash", "shell", "exec", "write_stdin", "bash_placeholder"},
	"read":   {"read", "view_image"},
	"edit":   {"edit", "write", "apply_patch", "notebookedit"},
	"search": {"grep", "glob", "toolsearch"},
	"web":    {"webfetch", "websearch", "webrun"},
	"agent": {"agent", "task", "spawn_agent", "wait_agent", "send_message", "sendmessage", "send_input",
		"close_agent", "resume_agent", "followup_task", "list_agents", "listagents", "interrupt_agent",
		"subagenthandback", "taskstop"},
	"plan": {"todowrite", "update_plan", "askuserquestion", "question", "request_user_input",
		"request_user_input_async", "enterplanmode", "exitplanmode"},
	"mcp": {"artifact_submit", "list_mcp_resources", "list_mcp_resource_templates"},
}

// toolKindMCPPrefixes marks MCP tools by name: Claude and Codex prefix them "mcp__", OpenCode joins
// the server and tool names with an underscore.
var toolKindMCPPrefixes = []string{`mcp\_\_`, `workflow\_`, `workflow-quality\_`, `yakka\_`}

// toolKindExpr is the SQL expression for the kind of the row's `tool` column; an empty tool is "".
var toolKindExpr = buildToolKindExpr()

func buildToolKindExpr() string {
	const name = "(CASE WHEN lower(tool) LIKE 'collaboration%' THEN substr(lower(tool), 14) ELSE lower(tool) END)"
	kinds := make([]string, 0, len(toolKinds))
	for k := range toolKinds {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	var b strings.Builder
	b.WriteString("CASE WHEN tool = '' THEN ''")
	for _, p := range toolKindMCPPrefixes {
		b.WriteString(" WHEN lower(tool) LIKE '" + p + "%' ESCAPE '\\' THEN 'mcp'")
	}
	for _, k := range kinds {
		names := make([]string, len(toolKinds[k]))
		for i, n := range toolKinds[k] {
			names[i] = "'" + n + "'"
		}
		b.WriteString(" WHEN " + name + " IN (" + strings.Join(names, ",") + ") THEN '" + k + "'")
	}
	b.WriteString(" ELSE 'other' END")
	return b.String()
}
