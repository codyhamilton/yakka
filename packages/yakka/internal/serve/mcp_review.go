package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
)

const reviewMCPInstruction = "review_change runs an advisory review of the supplied local change. It never changes a stage outcome, gate, commit or report."

// RegisterReviewMCPTool exposes the same review orchestrator as POST /v1/reviews.
// Local collection is provided by the declared change reader; the handler only
// accepts its server-carried facts and never returns captured change content.
func (s *Server) RegisterReviewMCPTool() error {
	return s.RegisterMCPTool(MCPTool{
		Name:        "review_change",
		Description: "Review a local uncommitted change or git range against optional plan, brief or explicit criteria. Returns a receipt; detail=full adds only validated findings. Advisory only.",
		InputSchema: reviewMCPInputSchema(),
		Annotations: map[string]any{"readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false},
		Scope:       TokenScopeReadWrite,
		TimeoutS:    150,
		Instruction: reviewMCPInstruction,
		Context: []MCPReader{
			{Reader: "project_dir", Version: 1, Required: mcpRequired(false)},
			{Reader: "cwd", Version: 1, Required: mcpRequired(false)},
			{Reader: "git", Version: 1, Required: mcpRequired(false), Params: map[string]any{"of": "project_dir"}},
			{Reader: "change", Version: 1, Required: mcpRequired(false), Bulk: true, Params: reviewChangeReaderParams()},
		},
		Validate: validateReviewMCPArgs,
		Handler:  s.mcpReviewChange,
	})
}

func reviewChangeReaderParams() map[string]any {
	p, err := review.Values()
	if err != nil {
		panic("serve: review reader policy: " + err.Error())
	}
	return map[string]any{
		"exclusion_policy_version": p.ExclusionPolicyVersion,
		"change_max_file_bytes":    p.ChangeMaxFileBytes, "change_max_total_bytes": p.ChangeMaxTotalBytes,
		"change_max_files": p.ChangeMaxFiles, "context_lines": p.ContextLines, "docs_never_noise": p.DocsNeverNoise,
		"change_exclude": p.ChangeExclude, "excluded_files": p.ExcludedFiles,
		"excluded_directories": p.ExcludedDirectories, "lockfiles": p.Lockfiles,
		"truncation_order": p.TruncationOrder, "budget_bytes": 2097152,
	}
}

func reviewMCPInputSchema() map[string]any {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	properties := map[string]any{
		"mode":              map[string]any{"type": "string", "enum": []string{"uncommitted", "range"}},
		"view":              map[string]any{"type": "string", "enum": []string{"combined", "staged"}},
		"include_untracked": map[string]any{"type": "boolean"}, "base": str("Base git ref; required for range mode."),
		"head": str("Head git ref; required for range mode."), "merge_base": map[string]any{"type": "boolean"},
		"kind": map[string]any{"type": "string", "enum": []string{"phase", "pr", "adhoc"}}, "plan": str("Plan folder or slug."),
		"phase": map[string]any{"type": "integer", "minimum": 1}, "pr": map[string]any{"type": "integer", "minimum": 1},
		"brief":        map[string]any{"type": "object", "properties": map[string]any{"path": str("Stored brief path."), "content_hash": str("Optional pinned content hash.")}, "required": []string{"path"}, "additionalProperties": false},
		"content_hash": str("Optional pinned design hash."), "criteria_text": map[string]any{"type": "array", "items": str("Explicit criterion.")},
		"allow_superseded": map[string]any{"type": "boolean"}, "build_models": map[string]any{"type": "array", "minItems": 1, "items": map[string]any{"type": "object", "properties": map[string]any{"id": str("Build model identifier."), "role": str("Optional role.")}, "required": []string{"id"}, "additionalProperties": false}},
		"repo_id": str("Expected repository identity."), "session_id": str("Optional explicit session identity."),
		"detail": map[string]any{"type": "string", "enum": []string{"receipt", "full"}}, "dry_run": map[string]any{"type": "boolean"},
		"effort": map[string]any{"type": "string", "enum": []string{"high", "xhigh", "max"}},
		"tags":   map[string]any{"type": "array", "maxItems": 16, "items": str("Case-sensitive review tag.")},
		"store":  map[string]any{"type": "boolean"},
		"trial":  map[string]any{"type": "object", "properties": map[string]any{"manifest_hash": str("Frozen manifest SHA-256."), "case_id": str("Historical case id."), "effort": map[string]any{"type": "string", "enum": []string{"high", "xhigh", "max"}}}, "required": []string{"manifest_hash", "case_id", "effort"}, "additionalProperties": false},
	}
	return map[string]any{"type": "object", "properties": properties, "required": []string{"mode", "build_models"}, "additionalProperties": false}
}

var reviewMCPAllowed = map[string]bool{"mode": true, "view": true, "include_untracked": true, "base": true, "head": true, "merge_base": true, "kind": true, "plan": true, "phase": true, "pr": true, "brief": true, "content_hash": true, "criteria_text": true, "allow_superseded": true, "build_models": true, "repo_id": true, "session_id": true, "detail": true, "dry_run": true, "trial": true, "effort": true, "tags": true, "store": true}

func validateReviewMCPArgs(args map[string]any) string {
	for k := range args {
		if !reviewMCPAllowed[k] {
			return "unknown review argument: " + k
		}
	}
	if v, ok := args["include_untracked"]; ok {
		if _, valid := v.(bool); !valid {
			return "include_untracked must be a boolean"
		}
	}
	if v, ok := args["brief"]; ok {
		if !reviewMCPObjectKeys(v, "path", "content_hash") {
			return "brief must contain only path and content_hash"
		}
	}
	if v, ok := args["trial"]; ok {
		if !reviewMCPObjectKeys(v, "manifest_hash", "case_id", "effort") {
			return "trial must contain manifest_hash, case_id and effort"
		}
	}
	if v, ok := args["effort"]; ok {
		effort, valid := v.(string)
		if !valid {
			return "effort must be a string"
		}
		if effort != "high" && effort != "xhigh" && effort != "max" {
			return "effort must be high, xhigh or max"
		}
	}
	if v, ok := args["tags"]; ok {
		tags, valid := v.([]any)
		if !valid {
			return "tags must be an array of strings"
		}
		if len(tags) > 16 {
			return "tags must contain at most 16 entries"
		}
		for _, tag := range tags {
			if _, valid := tag.(string); !valid {
				return "tags must be an array of strings"
			}
		}
	}
	if v, ok := args["store"]; ok {
		if _, valid := v.(bool); !valid {
			return "store must be a boolean"
		}
	}
	if v, ok := args["build_models"]; ok {
		models, valid := v.([]any)
		if valid {
			for _, model := range models {
				if !reviewMCPObjectKeys(model, "id", "role") {
					return "build_models entries must contain only id and role"
				}
			}
		}
	}
	var req review.Request
	if err := decodeReviewMCPArgs(args, &req); err != nil {
		return err.Error()
	}
	if req.Capture.Mode != "uncommitted" && req.Capture.Mode != "range" {
		return "mode must be uncommitted or range"
	}
	if req.Capture.View == "" {
		req.Capture.View = "combined"
	}
	if req.Capture.View != "combined" && req.Capture.View != "staged" {
		return "view must be combined or staged"
	}
	if req.Kind == "" {
		req.Kind = "adhoc"
	}
	if req.Kind != "phase" && req.Kind != "pr" && req.Kind != "adhoc" {
		return "kind must be phase, pr or adhoc"
	}
	if len(req.BuildModels) == 0 {
		return "build_models required"
	}
	if req.Capture.Mode == "range" && (req.Capture.Base == "" || req.Capture.Head == "") {
		return "range mode requires base and head"
	}
	if req.Detail != "" && req.Detail != "receipt" && req.Detail != "full" {
		return "detail must be receipt or full"
	}
	return ""
}

func reviewMCPObjectKeys(v any, allowed ...string) bool {
	obj, ok := v.(map[string]any)
	if !ok {
		return false
	}
	keys := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		keys[key] = true
	}
	for key := range obj {
		if !keys[key] {
			return false
		}
	}
	return true
}

func decodeReviewMCPArgs(args map[string]any, req *review.Request) error {
	top := make(map[string]any, len(args))
	for key, value := range args {
		// Capture-reader keys are decoded separately into req.Capture.
		switch key {
		case "mode", "view", "include_untracked", "base", "head", "merge_base":
			continue
		}
		top[key] = value
	}
	b, err := json.Marshal(top)
	if err != nil {
		return errors.New("invalid review arguments")
	}
	if err := json.Unmarshal(b, req); err != nil {
		return fmt.Errorf("invalid review arguments: %w", err)
	}
	// REST nests capture under `capture`; the MCP declaration intentionally
	// exposes the reader arguments at the top level.
	captureArgs := map[string]any{}
	for _, key := range []string{"mode", "view", "include_untracked", "base", "head", "merge_base"} {
		if value, ok := args[key]; ok {
			captureArgs[key] = value
		}
	}
	cb, err := json.Marshal(captureArgs)
	if err != nil {
		return errors.New("invalid review arguments")
	}
	if err := json.Unmarshal(cb, &req.Capture); err != nil {
		return fmt.Errorf("invalid review arguments: %w", err)
	}
	return nil
}

func (s *Server) mcpReviewChange(ctx context.Context, tenant string, ts *tenantState, args map[string]any, local LocalContext) (any, error) {
	var req review.Request
	if err := decodeReviewMCPArgs(args, &req); err != nil {
		return nil, err
	}
	if req.Capture.Mode == "" {
		return nil, errors.New("mode required")
	}
	if req.Capture.View == "" {
		req.Capture.View = "combined"
	}
	if req.Kind == "" {
		req.Kind = "adhoc"
	}
	// Optional at the registry gate so missing client implementations can be
	// translated into the stable capture error before any review record exists.
	captured, failure := local.Get("change")
	if failure != nil {
		if failure.Code == "undeclared_reader" || failure.Code == "missing" || strings.HasPrefix(failure.Code, "unsupported_reader") || failure.Code == "unsupported_declaration" {
			return nil, errors.New("capture_unsupported")
		}
		return nil, failure
	}
	raw, err := json.Marshal(captured)
	if err != nil {
		return nil, errors.New("capture invalid")
	}
	if err := json.Unmarshal(raw, &req.Capture); err != nil {
		return nil, errors.New("capture invalid")
	}
	if req.Capture.Diff == "" {
		return nil, errors.New("capture_unsupported")
	}
	receipt, err := review.Run(ctx, ts.t, tenant, req, review.RunConfig{Availability: s.reviewAvailability(), Reservations: s.reviewReservations, Endpoint: s.opts.ReviewEndpoint})
	if err != nil {
		return nil, err
	}
	return receipt, nil
}
