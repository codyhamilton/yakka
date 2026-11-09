package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// ReviewUsageRow is one content-free ephemeral review call fact. UsageID is a
// random identifier; Raw is the canonical fact and holds no repository, plan,
// session, capture, prompt, criteria, finding, error-body or content-derived
// hash field.
type ReviewUsageRow struct {
	UsageID string
	TS      float64
	Raw     []byte
}

// ReviewUsageRecord is a stored review_usage fact plus its random identifier.
type ReviewUsageRecord struct {
	UsageID string          `json:"usage_id"`
	TS      float64         `json:"ts"`
	Raw     json.RawMessage `json:"raw"`
}

// AppendReviewUsage writes content-free review_usage facts to the tenant-local
// review_usage table. The table is deliberately separate from facts and
// review_runs, so conversation, hook, facet, quality and work-cost measures
// cannot read it. The random usage_id is the primary key, so no content-derived
// hash is persisted.
func (t *Tenant) AppendReviewUsage(ctx context.Context, rows []ReviewUsageRow) ([]bool, error) {
	for _, r := range rows {
		if r.UsageID == "" || len(r.Raw) == 0 {
			return nil, fmt.Errorf("store: review_usage needs usage id and raw fact")
		}
	}
	inserted := make([]bool, len(rows))
	err := t.submit(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS review_usage (
			usage_id TEXT PRIMARY KEY, ts REAL NOT NULL, raw BLOB NOT NULL)`); err != nil {
			return err
		}
		st, err := tx.Prepare(`INSERT OR IGNORE INTO review_usage(usage_id,ts,raw) VALUES(?,?,?)`)
		if err != nil {
			return err
		}
		defer st.Close()
		for i, r := range rows {
			res, err := st.Exec(r.UsageID, r.TS, r.Raw)
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			inserted[i] = n > 0
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return inserted, nil
}

// ReviewUsageRecords returns this tenant's review_usage facts, newest first.
// It is the test-facing read; callers never receive captured content.
func (t *Tenant) ReviewUsageRecords(ctx context.Context) ([]ReviewUsageRecord, error) {
	var exists int
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='review_usage'`).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return []ReviewUsageRecord{}, nil
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT usage_id,ts,raw FROM review_usage ORDER BY ts DESC,rowid DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewUsageRecord{}
	for rows.Next() {
		var r ReviewUsageRecord
		if err := rows.Scan(&r.UsageID, &r.TS, &r.Raw); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReviewSpend is the explicitly named tenant review-spend measure: the sum of
// estimated review_usage cost. It never reads work_cost, quality or other
// analytics measures.
func (t *Tenant) ReviewSpend(ctx context.Context) (float64, error) {
	var exists int
	if err := t.rdb.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='review_usage'`).Scan(&exists); err != nil {
		return 0, err
	}
	if exists == 0 {
		return 0, nil
	}
	var total float64
	err := t.rdb.QueryRowContext(ctx, `SELECT COALESCE(SUM(CAST(json_extract(raw,'$.cost_usd') AS REAL)),0)
		FROM review_usage WHERE json_valid(raw)`).Scan(&total)
	return total, err
}
