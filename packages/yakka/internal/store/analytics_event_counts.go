package store

import (
	"context"
	"database/sql"
	"time"
)

// EventCountTotal is one completed count triplet. Rows is always Events+Rejections.
type EventCountTotal struct {
	Events     int64
	Rejections int64
	Rows       int64
}

// EventCounts is the retained-record count response. Matched obeys the request filter and the
// frozen applied window; TenantTotal clears every filter and counts all currently retained
// history. CheckedAt is the UTC instant from the transaction that produced the counts.
type EventCounts struct {
	Matched     EventCountTotal
	TenantTotal EventCountTotal
	CheckedAt   time.Time
}

// EventCounts counts retained facts and rejections for one filter and for the whole tenant in a
// single read transaction. It never returns a partial object.
func (t *Tenant) EventCounts(ctx context.Context, f AnalyticsFilter) (EventCounts, error) {
	tx, err := t.rdb.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return EventCounts{}, err
	}
	defer tx.Rollback()

	var out EventCounts
	fw, fargs := f.factWhere()
	rw, rargs := f.retainedRecordRejWhere()
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM facts WHERE `+fw, fargs...).Scan(&out.Matched.Events); err != nil {
		return EventCounts{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM rejections WHERE `+rw, rargs...).Scan(&out.Matched.Rejections); err != nil {
		return EventCounts{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM facts`).Scan(&out.TenantTotal.Events); err != nil {
		return EventCounts{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM rejections`).Scan(&out.TenantTotal.Rejections); err != nil {
		return EventCounts{}, err
	}
	out.Matched.Rows = out.Matched.Events + out.Matched.Rejections
	out.TenantTotal.Rows = out.TenantTotal.Events + out.TenantTotal.Rejections
	out.CheckedAt = time.Now().UTC()
	if err := tx.Commit(); err != nil {
		return EventCounts{}, err
	}
	return out, nil
}
