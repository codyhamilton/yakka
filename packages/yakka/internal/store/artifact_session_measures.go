package store

import (
	"context"
	"time"
)

// WritingSessionMeasuresFor reads the selected versions' captured sessions inside
// the board window. Artifact repo/kind/path filters never filter these call rows.
// Identity batches keep every SQLite statement below the bind parameter limit.
func (t *Tenant) WritingSessionMeasuresFor(ctx context.Context, ids []string, from, to time.Time) (map[string]map[string]float64, error) {
	out := make(map[string]map[string]float64, len(ids))
	for start := 0; start < len(ids); start += 500 {
		batch := ids[start:min(start+500, len(ids))]
		cte, args := sessionAggregateCTE(AnalyticsFilter{From: from, To: to, ConversationIDs: batch})
		rows, err := t.rdb.QueryContext(ctx, cte+` SELECT conversation_id,model_calls,unpriced_calls,cost_usd,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,tokens_reasoning,hook_events FROM filtered`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			vals := make([]float64, 9)
			if err := rows.Scan(&id, &vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5], &vals[6], &vals[7], &vals[8]); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = map[string]float64{}
			for i, name := range []string{"model_calls", "unpriced_calls", "cost_usd", "tokens_in", "tokens_out", "tokens_cache_read", "tokens_cache_write", "tokens_reasoning", "hook_events"} {
				out[id][name] = vals[i]
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
