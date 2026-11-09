package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const listReviewsMCPDescription = "Read a tenant's reviews as one complete, cursor-paged listing. Read-only and tenant-scoped; honours the review filters and returns the same reviews, next_cursor and complete data as GET /v1/reviews."

// RegisterListReviewsMCPTool adds the server-defined, read-scope review listing. The
// plugin discovers it through the registry; there are no local readers or actions.
func (s *Server) RegisterListReviewsMCPTool() error {
	return s.RegisterMCPTool(MCPTool{
		Name:        "list_reviews",
		Description: listReviewsMCPDescription,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"repo_id":       map[string]any{"type": "string"},
				"plan":          map[string]any{"type": "string"},
				"phase":         map[string]any{"type": "integer", "minimum": 1},
				"kind":          map[string]any{"type": "string", "enum": []string{"phase", "pr", "adhoc"}},
				"status":        map[string]any{"type": "string"},
				"effort":        map[string]any{"type": "string", "enum": []string{"high", "xhigh", "max"}},
				"profile":       map[string]any{"type": "string"},
				"manifest_hash": map[string]any{"type": "string"},
				"since":         map[string]any{"type": "number"},
				"tags":          map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "maxItems": maxReviewFilterTags},
				"detail":        map[string]any{"type": "string", "enum": []string{"full"}},
				"limit":         map[string]any{"type": "integer", "minimum": 1, "maximum": maxReviewPageSize},
				"cursor":        map[string]any{"type": "string"},
			},
			"additionalProperties": false,
		},
		Annotations: map[string]any{"readOnlyHint": true},
		Validate:    validateListReviewsMCPArgs,
		Handler:     s.mcpListReviews,
	})
}

var listReviewsArgKeys = map[string]bool{
	"repo_id": true, "plan": true, "phase": true, "kind": true, "status": true,
	"effort": true, "profile": true, "manifest_hash": true, "since": true,
	"tags": true, "detail": true, "limit": true, "cursor": true,
}

// listReviewsQuery is the parsed, canonical request. Filters and cursor are shared with the REST
// read so both transports select the same rows and issue the same next cursor.
type listReviewsQuery struct {
	filters   reviewCursorFilter
	limit     int
	cursor    reviewCursorPayload
	hasCursor bool
}

func validateListReviewsMCPArgs(args map[string]any) string {
	_, msg := parseListReviewsArgs(args)
	return msg
}

func parseListReviewsArgs(args map[string]any) (listReviewsQuery, string) {
	var q listReviewsQuery
	for key := range args {
		if !listReviewsArgKeys[key] {
			return q, fmt.Sprintf("unknown argument %q", key)
		}
	}
	repoID, msg := listReviewsStringArg(args, "repo_id")
	if msg != "" {
		return q, msg
	}
	plan, msg := listReviewsStringArg(args, "plan")
	if msg != "" {
		return q, msg
	}
	status, msg := listReviewsStringArg(args, "status")
	if msg != "" {
		return q, msg
	}
	profile, msg := listReviewsStringArg(args, "profile")
	if msg != "" {
		return q, msg
	}
	manifestHash, msg := listReviewsStringArg(args, "manifest_hash")
	if msg != "" {
		return q, msg
	}
	kind := ""
	if raw, present := args["kind"]; present {
		v, ok := raw.(string)
		if !ok || (v != "phase" && v != "pr" && v != "adhoc") {
			return q, "kind must be one of phase, pr, adhoc"
		}
		kind = v
	}
	effort := ""
	if raw, present := args["effort"]; present {
		v, ok := raw.(string)
		if !ok || (v != "high" && v != "xhigh" && v != "max") {
			return q, "effort must be one of high, xhigh, max"
		}
		effort = v
	}
	var phase *int
	if raw, present := args["phase"]; present {
		n, ok := mcpInteger(raw)
		if !ok || n < 1 {
			return q, "phase must be an integer of at least 1"
		}
		v := int(n)
		phase = &v
	}
	since := float64(0)
	if raw, present := args["since"]; present {
		v, ok := mcpNumber(raw)
		if !ok || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return q, "since must be a non-negative number"
		}
		since = v
	}
	detail := ""
	if raw, present := args["detail"]; present {
		v, ok := raw.(string)
		if !ok || v != "full" {
			return q, `detail must be "full"`
		}
		detail = v
	}
	// Canonicalize to a non-nil empty slice so the cursor payload (and therefore the
	// opaque next_cursor) is identical to the REST read when no tag filter is given.
	tags := []string{}
	if raw, present := args["tags"]; present {
		values, ok := raw.([]any)
		if !ok {
			return q, "tags must be an array of strings"
		}
		if len(values) > maxReviewFilterTags {
			return q, "at most 16 tags are allowed"
		}
		requested := make([]string, 0, len(values))
		for _, value := range values {
			v, ok := value.(string)
			if !ok {
				return q, "tags must be an array of strings"
			}
			requested = append(requested, v)
		}
		canonical, err := reviewFilterTags(requested)
		if err != nil {
			return q, err.Error()
		}
		tags = canonical
	}
	limit := defaultReviewPage
	if raw, present := args["limit"]; present {
		n, ok := mcpInteger(raw)
		if !ok || n < 1 || n > int64(maxReviewPageSize) {
			return q, "limit must be between 1 and 500"
		}
		limit = int(n)
	}
	filters := reviewCursorFilter{
		RepoID: repoID, Plan: plan, Phase: phase, Kind: kind, Status: status,
		Effort: effort, Profile: profile, ManifestHash: manifestHash, Since: since,
		Tags: tags, Detail: detail,
	}
	if raw, present := args["cursor"]; present {
		v, ok := raw.(string)
		if !ok || v == "" {
			return q, "cursor must be a non-empty string"
		}
		payload, err := decodeReviewCursor(v)
		if err != nil {
			return q, "invalid cursor: " + err.Error()
		}
		if payload.Version != reviewCursorVersion {
			return q, "unsupported cursor version"
		}
		if payload.Route != reviewCursorRoute {
			return q, "cursor route mismatch"
		}
		if !payload.Filters.equal(filters) {
			return q, "cursor filter mismatch"
		}
		q.cursor = payload
		q.hasCursor = true
	}
	q.filters = filters
	q.limit = limit
	return q, ""
}

func listReviewsStringArg(args map[string]any, key string) (string, string) {
	raw, present := args[key]
	if !present {
		return "", ""
	}
	v, ok := raw.(string)
	if !ok {
		return "", key + " must be a string"
	}
	return v, ""
}

func mcpInteger(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int64:
		return n, true
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) {
			return 0, false
		}
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		return i, err == nil
	}
	return 0, false
}

func mcpNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// mcpListReviews derives the tenant only from the authenticated argument and reuses the REST
// walk: the same high-water, keyset page, cursor binding and completion metadata.
func (s *Server) mcpListReviews(ctx context.Context, tenant string, ts *tenantState, args map[string]any, _ LocalContext) (any, error) {
	q, msg := parseListReviewsArgs(args)
	if msg != "" {
		return nil, errors.New(msg)
	}
	generation := s.tenantReviewGeneration(tenant)
	highWater := int64(0)
	var after *store.ReviewPageKey
	if q.hasCursor {
		if err := q.cursor.validate(tenant, q.filters, generation); err != nil {
			return nil, err
		}
		highWater = q.cursor.HighWater
		after = &store.ReviewPageKey{TS: q.cursor.LastTS, InsertionID: q.cursor.LastID}
	} else {
		var err error
		highWater, err = ts.t.BeginReviewWalk(ctx)
		if err != nil {
			return nil, errors.New("review read failed")
		}
	}
	rows, hasMore, err := ts.t.ReviewPage(ctx, store.ReviewRecordFilter{
		RepoID: q.filters.RepoID, Plan: q.filters.Plan, Phase: q.filters.Phase,
		Kind: q.filters.Kind, Status: q.filters.Status, Effort: q.filters.Effort,
		Profile: q.filters.Profile, ManifestHash: q.filters.ManifestHash,
		Since: q.filters.Since, Tags: q.filters.Tags,
	}, highWater, after, q.limit)
	if err != nil {
		return nil, errors.New("review read failed")
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var item map[string]any
		if json.Unmarshal(row.Raw, &item) != nil {
			return nil, errors.New("review read failed")
		}
		if q.filters.Detail != "full" {
			delete(item, "payload")
		}
		items = append(items, item)
	}
	var nextCursor any
	if hasMore {
		last := rows[len(rows)-1]
		encoded, err := encodeReviewCursor(reviewCursorPayload{
			Version: reviewCursorVersion, Tenant: tenant, Route: reviewCursorRoute,
			Filters: q.filters, Generation: generation, HighWater: highWater, LastTS: last.TS, LastID: last.InsertionID,
		})
		if err != nil {
			return nil, errors.New("review read failed")
		}
		nextCursor = encoded
	}
	return map[string]any{"reviews": items, "next_cursor": nextCursor, "complete": !hasMore}, nil
}
