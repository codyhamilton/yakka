package store

import (
	"context"
	"database/sql"
	"fmt"
)

// conversationEventCap is the most events Conversation returns; one more is read to detect
// truncation. A variable so a test can lower it.
var conversationEventCap = 5000

// ConversationBounds optional inclusive ts bounds (Unix seconds) for window totals only.
type ConversationBounds struct {
	From *float64
	To   *float64
}

// ConversationEvent is one fact in a conversation timeline. Tokens and CostUSD are set only on a
// kept usage call, and are nil on every other fact (including a deduplicated Claude repeat).
type ConversationEvent struct {
	TS        float64
	Type      string
	NormEvent string
	Event     string
	Tool      string
	Model     string
	Path      string
	Kind      string
	Source    string
	SHA       string
	Tokens    *Tokens
	CostUSD   *float64
	Priced    bool
}

// ConversationTotals sums the kept usage calls of a conversation.
type ConversationTotals struct {
	ModelCalls       int64
	TokensIn         int64
	TokensOut        int64
	TokensCacheRead  int64
	TokensCacheWrite int64
	TokensReasoning  int64
	CostUSD          float64
	UnpricedCalls    int64
}

// ConversationDetail is one conversation's timeline and totals. FirstTS and LastTS span all its
// facts; Events is capped at conversationEventCap with Truncated set when more matched.
type ConversationDetail struct {
	ConversationID string
	Harness        string
	Repos          []string
	Models         []string
	FirstTS        float64
	LastTS         float64
	Totals         ConversationTotals
	WindowTotals   *ConversationTotals
	Events         []ConversationEvent
	Truncated      bool
}

func conversationTSClause(from, to *float64) (string, []any) {
	var clause string
	var args []any
	if from != nil {
		clause += " AND ts>=?"
		args = append(args, *from)
	}
	if to != nil {
		clause += " AND ts<=?"
		args = append(args, *to)
	}
	return clause, args
}

const conversationDedupeCTE = `
		WITH base AS (
			SELECT ts, type, harness, norm_event, event, tool, model, path, kind, source, sha,
				tok_in, tok_out, tok_cache_read, tok_cache_write, tok_reasoning, cost_reported, row_hash,
				CASE WHEN type='hook_event' AND norm_event='usage'
					THEN CASE WHEN harness='claude' THEN json_extract(raw,'$.backfill.ref') END END AS _mid
			FROM facts WHERE conversation_id=?%s),
		c AS (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY _mid ORDER BY tok_out DESC, row_hash ASC) AS _rn
			FROM base)`

func (t *Tenant) conversationUsageTotals(ctx context.Context, id string, from, to *float64) (ConversationTotals, error) {
	tsClause, tsArgs := conversationTSClause(from, to)
	q := fmt.Sprintf(conversationDedupeCTE+`
		SELECT harness, model, tok_in, tok_out, tok_cache_read, tok_cache_write, tok_reasoning, cost_reported, _mid, _rn
		FROM c WHERE type='hook_event' AND norm_event='usage'`, tsClause)
	args := append([]any{id}, tsArgs...)
	rows, err := t.rdb.QueryContext(ctx, q, args...)
	if err != nil {
		return ConversationTotals{}, err
	}
	defer rows.Close()
	var tot ConversationTotals
	for rows.Next() {
		var harness, model string
		var tok Tokens
		var cost sql.NullFloat64
		var mid sql.NullString
		var rn int
		if err := rows.Scan(&harness, &model, &tok.In, &tok.Out, &tok.CacheRead, &tok.CacheWrite, &tok.Reasoning,
			&cost, &mid, &rn); err != nil {
			return ConversationTotals{}, err
		}
		if mid.Valid && mid.String != "" && rn != 1 {
			continue
		}
		var reported *float64
		if cost.Valid {
			v := cost.Float64
			reported = &v
		}
		usd, priced := Cost(harness, model, tok, reported)
		tot.ModelCalls++
		tot.TokensIn += tok.In
		tot.TokensOut += tok.Out
		tot.TokensCacheRead += tok.CacheRead
		tot.TokensCacheWrite += tok.CacheWrite
		tot.TokensReasoning += tok.Reasoning
		tot.CostUSD += usd
		if !priced {
			tot.UnpricedCalls++
		}
	}
	return tot, rows.Err()
}

// Conversation returns one conversation's facts in time order (ts, then row_hash) plus the totals
// of its kept usage calls. ok is false when no fact has that conversation_id.
//
// The call selection mirrors 3-05's usageRowsWhere: a Claude call is deduplicated by its message
// id, json_extract(raw,'$.backfill.ref'), keeping the row with the largest tok_out (ties broken by
// the lowest row_hash); a row with no id is its own call. Every fact is returned as an event, but
// only the kept calls carry Tokens and CostUSD. Totals cover all kept usage calls in the run;
// optional bounds compute WindowTotals over that inclusive ts range without affecting Events.
func (t *Tenant) Conversation(ctx context.Context, id string, bounds ConversationBounds) (ConversationDetail, bool, error) {
	var first, last sql.NullFloat64
	if err := t.rdb.QueryRowContext(ctx,
		`SELECT MIN(ts), MAX(ts) FROM facts WHERE conversation_id=?`, id).Scan(&first, &last); err != nil {
		return ConversationDetail{}, false, err
	}
	if !first.Valid {
		return ConversationDetail{}, false, nil
	}
	d := ConversationDetail{ConversationID: id, FirstTS: first.Float64, LastTS: last.Float64}
	if err := t.rdb.QueryRowContext(ctx, `SELECT harness FROM facts WHERE conversation_id=?
		GROUP BY harness ORDER BY COUNT(*) DESC, harness ASC LIMIT 1`, id).Scan(&d.Harness); err != nil {
		return ConversationDetail{}, false, err
	}
	var err error
	if d.Repos, err = t.strings(ctx, `SELECT DISTINCT repo_id FROM facts
		WHERE conversation_id=? AND repo_id != '' ORDER BY repo_id`, id); err != nil {
		return ConversationDetail{}, false, err
	}
	if d.Models, err = t.strings(ctx, `SELECT DISTINCT model FROM facts
		WHERE conversation_id=? AND model != '' ORDER BY model`, id); err != nil {
		return ConversationDetail{}, false, err
	}
	if d.Totals, err = t.conversationUsageTotals(ctx, id, nil, nil); err != nil {
		return ConversationDetail{}, false, err
	}
	if bounds.From != nil || bounds.To != nil {
		wt, err := t.conversationUsageTotals(ctx, id, bounds.From, bounds.To)
		if err != nil {
			return ConversationDetail{}, false, err
		}
		d.WindowTotals = &wt
	}
	rows, err := t.rdb.QueryContext(ctx, fmt.Sprintf(conversationDedupeCTE+`
		SELECT ts, type, harness, norm_event, event, tool, model, path, kind, source, sha,
			tok_in, tok_out, tok_cache_read, tok_cache_write, tok_reasoning, cost_reported, _mid, _rn
		FROM c ORDER BY ts, row_hash LIMIT ?`, ""), id, conversationEventCap+1)
	if err != nil {
		return ConversationDetail{}, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var e ConversationEvent
		var harness, typ, norm string
		var tok Tokens
		var cost sql.NullFloat64
		var mid sql.NullString
		var rn int
		if err := rows.Scan(&e.TS, &typ, &harness, &norm, &e.Event, &e.Tool, &e.Model, &e.Path,
			&e.Kind, &e.Source, &e.SHA, &tok.In, &tok.Out, &tok.CacheRead, &tok.CacheWrite, &tok.Reasoning,
			&cost, &mid, &rn); err != nil {
			return ConversationDetail{}, false, err
		}
		e.Type, e.NormEvent = typ, norm
		if typ == "hook_event" && norm == "usage" && (!mid.Valid || mid.String == "" || rn == 1) {
			var reported *float64
			if cost.Valid {
				v := cost.Float64
				reported = &v
			}
			usd, priced := Cost(harness, e.Model, tok, reported)
			e.Tokens, e.CostUSD, e.Priced = &tok, &usd, priced
		}
		d.Events = append(d.Events, e)
	}
	if err := rows.Err(); err != nil {
		return ConversationDetail{}, false, err
	}
	if len(d.Events) > conversationEventCap {
		d.Events = d.Events[:conversationEventCap]
		d.Truncated = true
	}
	return d, true, nil
}
