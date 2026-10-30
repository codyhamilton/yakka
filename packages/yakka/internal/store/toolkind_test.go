package store

import (
	"context"
	"strings"
	"testing"
)

func TestToolKindExpr(t *testing.T) {
	cases := map[string]string{
		"": "", "Bash": "shell", "bash": "shell", "exec": "shell", "Read": "read", "Edit": "edit",
		"apply_patch": "edit", "Grep": "search", "WebFetch": "web", "Agent": "agent", "task": "agent",
		"collaborationspawn_agent": "agent", "collaborationwait_agent": "agent", "todowrite": "plan",
		"AskUserQuestion": "plan", "mcp__plugin_yakka_yakka__list_checks": "mcp",
		"mcp__codex_apps__github__fetch_issue": "mcp", "yakka_list_checks": "mcp",
		"workflow-quality_post_design": "mcp", "artifact_submit": "mcp",
		"Skill": "other", "clocksleep": "other", "Monitor": "other", "invalid": "other",
	}
	tn := openT(t, Options{})
	check := func(tool, want string) {
		var got string
		q := "WITH x(tool) AS (SELECT ?) SELECT " + toolKindExpr + " FROM x"
		if err := tn.wdb.QueryRowContext(context.Background(), q, tool).Scan(&got); err != nil {
			t.Fatalf("%q: %v", tool, err)
		}
		if got != want {
			t.Errorf("tool_kind(%q) = %q, want %q", tool, got, want)
		}
	}
	for tool, want := range cases {
		check(tool, want)
	}
	for kind, names := range toolKinds {
		for _, n := range names {
			check(strings.ToUpper(n[:1])+n[1:], kind)
		}
	}
}
