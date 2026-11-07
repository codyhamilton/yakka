package serve

import (
	"net/http"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func conversationTotalsMap(t store.ConversationTotals) map[string]any {
	return map[string]any{
		"model_calls":        t.ModelCalls,
		"tokens_in":          t.TokensIn,
		"tokens_out":         t.TokensOut,
		"tokens_cache_read":  t.TokensCacheRead,
		"tokens_cache_write": t.TokensCacheWrite,
		"tokens_reasoning":   t.TokensReasoning,
		"cost_usd":           t.CostUSD,
		"unpriced_calls":     t.UnpricedCalls,
	}
}

func addAnalyticsPartial(out map[string]any, ts *tenantState) {
	if ts.t.CompactionState() != "complete" {
		out["partial"] = true
		out["partial_reasons"] = []string{"compaction_incomplete"}
	}
}

// analyticsConversation returns one conversation's timeline and totals (DESIGN.md plan 12). The
// id is required; an id with no facts is a 404. Facts are returned in time order, capped by the
// store, with no bodies. Optional from/to set window_totals only; events stay the full run.
func (s *Server) analyticsConversation(w http.ResponseWriter, r *http.Request, _ string, ts *tenantState) {
	id := r.URL.Query().Get("id")
	if id == "" {
		errJSON(w, 400, "id required")
		return
	}
	q := r.URL.Query()
	var bounds store.ConversationBounds
	var fromT, toT time.Time
	hasFrom, hasTo := false, false
	if v := q.Get("from"); v != "" {
		tm, err := time.Parse(time.RFC3339, v)
		if err != nil {
			errJSON(w, 400, "from and to must be RFC3339")
			return
		}
		fromT, hasFrom = tm.UTC(), true
		f := float64(fromT.Unix())
		bounds.From = &f
	}
	if v := q.Get("to"); v != "" {
		tm, err := time.Parse(time.RFC3339, v)
		if err != nil {
			errJSON(w, 400, "from and to must be RFC3339")
			return
		}
		toT, hasTo = tm.UTC(), true
		f := float64(toT.Unix())
		bounds.To = &f
	}
	if hasFrom && hasTo && fromT.After(toT) {
		errJSON(w, 400, "from after to")
		return
	}
	d, ok, err := ts.t.Conversation(r.Context(), id, bounds)
	if err != nil {
		readFailed(w)
		return
	}
	if !ok {
		errJSON(w, 404, "conversation not found")
		return
	}
	events := make([]map[string]any, 0, len(d.Events))
	for _, e := range d.Events {
		m := map[string]any{"ts": rfc(e.TS), "type": e.Type, "norm_event": e.NormEvent, "event": e.Event,
			"tool": e.Tool, "model": e.Model, "path": e.Path, "kind": e.Kind, "source": e.Source, "sha": e.SHA}
		if e.Tokens != nil {
			m["tokens"] = map[string]any{"in": e.Tokens.In, "out": e.Tokens.Out, "cache_read": e.Tokens.CacheRead,
				"cache_write": e.Tokens.CacheWrite, "reasoning": e.Tokens.Reasoning}
		}
		if e.CostUSD != nil {
			m["cost_usd"] = *e.CostUSD
			m["priced"] = e.Priced
		}
		events = append(events, m)
	}
	out := map[string]any{
		"conversation_id": d.ConversationID,
		"harness":         d.Harness,
		"repos":           nz(d.Repos),
		"models":          nz(d.Models),
		"first_ts":        rfc(d.FirstTS),
		"last_ts":         rfc(d.LastTS),
		"totals":          conversationTotalsMap(d.Totals),
		"events":          events,
	}
	if d.WindowTotals != nil {
		out["window_totals"] = conversationTotalsMap(*d.WindowTotals)
	}
	if d.Truncated {
		out["truncated"] = true
	}
	addAnalyticsPartial(out, ts)
	writeJSON(w, 200, out)
}
