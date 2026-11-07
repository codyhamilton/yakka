package serve

import (
	"context"
	"fmt"
	"strings"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

const statelessMCPInstruction = "Read-only advice on design, brief and report files: delivery state and scores for a file, the checks a kind is scored against, and similar past artifacts."

// RegisterStatelessMCPTools adds the two store-backed MCP reads used by the
// service. It is explicit so conformance servers can register only their test
// tools.
func (s *Server) RegisterStatelessMCPTools() error {
	kindSchema := map[string]any{"type": "string", "enum": []string{"design", "brief", "report"}}
	if err := s.RegisterMCPTool(MCPTool{
		Name:        "list_checks",
		Description: "The checks a design, brief or report is scored against.",
		InputSchema: map[string]any{
			"type": "object", "properties": map[string]any{"kind": kindSchema},
			"required": []string{"kind"}, "additionalProperties": false,
		},
		Annotations: map[string]any{"readOnlyHint": true},
		Instruction: statelessMCPInstruction,
		Validate: func(args map[string]any) string {
			if _, err := mcpKindArgument(args, true); err != "" {
				return err
			}
			return ""
		},
		Handler: s.mcpListChecks,
	}); err != nil {
		return err
	}
	return s.RegisterMCPTool(MCPTool{
		Name:        "search_artifacts",
		Description: "Similar past designs, briefs and reports in this tenant, with path, repo and a snippet.",
		InputSchema: map[string]any{
			"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "kind": kindSchema},
			"required": []string{"query"}, "additionalProperties": false,
		},
		Annotations: map[string]any{"readOnlyHint": true},
		Validate: func(args map[string]any) string {
			q, ok := args["query"].(string)
			if !ok || strings.TrimSpace(q) == "" {
				return "query must be a non-empty string"
			}
			if _, err := mcpKindArgument(args, false); err != "" {
				return err
			}
			return ""
		},
		Handler: s.mcpSearchArtifacts,
	})
}

func mcpKindArgument(args map[string]any, required bool) (string, string) {
	if _, present := args["kind"]; !present && !required {
		return "", ""
	}
	kind, ok := args["kind"].(string)
	if !ok || !validKind(kind) {
		return "", "kind must be one of design, brief, report"
	}
	return kind, ""
}

func mcpText(text string) any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}, "isError": false}
}

func (s *Server) mcpListChecks(_ context.Context, _ string, _ *tenantState, args map[string]any, _ LocalContext) (any, error) {
	kind, _ := mcpKindArgument(args, true)
	if s.opts.Checks == nil {
		return mcpText("no checks loaded on the service"), nil
	}
	checks := s.opts.Checks.For(kind)
	if len(checks) == 0 {
		return mcpText("no checks loaded on the service"), nil
	}
	parts := make([]string, 0, len(checks))
	for _, check := range checks {
		line := fmt.Sprintf("%s [levels %s]", check.Name, strings.Join(check.Levels, "/"))
		if check.Invert {
			line += " [inverted]"
		}
		parts = append(parts, line+": "+check.Q)
	}
	return mcpText(strings.Join(parts, "\n")), nil
}

func (s *Server) mcpSearchArtifacts(ctx context.Context, _ string, ts *tenantState, args map[string]any, _ LocalContext) (any, error) {
	query := args["query"].(string) // Validate runs before the handler.
	kind, _ := mcpKindArgument(args, false)
	expr := matchExpr(query)
	if expr == "" {
		return mcpText("no matches"), nil
	}
	var keep func(string) bool
	if kind != "" {
		keep = func(path string) bool { return keys.Kind(path) == kind }
	}
	hits, err := ts.t.Search(ctx, expr, 10, keep)
	if err != nil {
		return nil, fmt.Errorf("search failed")
	}
	if len(hits) == 0 {
		return mcpText("no matches"), nil
	}
	parts := make([]string, 0, len(hits))
	for _, hit := range hits {
		parts = append(parts, fmt.Sprintf("%s %s:%s (rank %v)\n%s", keys.Kind(hit.Path), hit.RepoID, hit.Path, hit.Rank, hit.Snippet))
	}
	return mcpText(strings.Join(parts, "\n")), nil
}
