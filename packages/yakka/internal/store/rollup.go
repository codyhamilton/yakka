package store

import (
	"context"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

// The hourly hook_events rollup (migration 6): one row per distinct (hour, dimension tuple) with
// the count of facts that collapsed into it. It exists because aggregating the base table for the
// hook_events measure misses the phase-3 read bound on large windows; the query package reads the
// rollup for whole interior hours and base rows for the two partial edge hours (measureDef.source).

// hookRollupUpsert increments the rollup row for one inserted fact. Append runs it in the same
// transaction as the fact insert, and only for a fact that was actually inserted, so a duplicate
// that collapses on the row-hash primary key adds nothing to either table.
const hookRollupUpsert = `INSERT INTO hook_events_hourly
	(hour,harness,repo_id,norm_event,event,tool,conversation_id,n) VALUES (?,?,?,?,?,?,?,1)
	ON CONFLICT(hour,harness,repo_id,norm_event,event,tool,conversation_id) DO UPDATE SET n=n+1`

// hookRollupFill refills hook_events_hourly from the base hook_event rows: it is the one aggregate
// whose result defines the rollup, shared by the open-time backfill and the post-compaction rebuild.
const hookRollupFill = `INSERT INTO hook_events_hourly
	SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, norm_event, event, tool, conversation_id, count(*)
	FROM facts WHERE type='hook_event'
	GROUP BY CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, norm_event, event, tool, conversation_id`

// hookRollupColumns are the facts columns hookRollupFill selects. A pre-migration-4 layout (which a
// test constructs) lacks them, so the fill is skipped there.
var hookRollupColumns = []string{"ts", "harness", "repo_id", "norm_event", "event", "tool", "conversation_id"}

// rollupFillApplies reports whether facts has every column the rollup fill needs.
func (t *Tenant) rollupFillApplies() (bool, error) {
	have, err := t.columns("facts")
	if err != nil {
		return false, err
	}
	for _, c := range hookRollupColumns {
		if !have[c] {
			return false, nil
		}
	}
	return true, nil
}

// backfillHookRollup fills hook_events_hourly from base rows for a tenant that just gained the
// table. It is a no-op when facts predates the extracted columns, which the pre-migration-4 layout
// a test constructs does, so the migration stays plain SQL and this runs from open instead.
func (t *Tenant) backfillHookRollup() error {
	ok, err := t.rollupFillApplies()
	if err != nil || !ok {
		return err
	}
	_, err = t.wdb.Exec(`DELETE FROM hook_events_hourly;` + hookRollupFill)
	return err
}

// The hourly conversations rollup (migration 7): one row per distinct (hour, harness, repo_id,
// model, conversation_id) that saw a fact, with n facts collapsed into it. The conversations
// measure is a DISTINCT count, so unlike the hook_events rollup its rows are read with
// count(DISTINCT conversation_id) rather than summed (measureDef.aggSQL): each row stands for the
// presence of one conversation, and reading whole interior hours from the rollup plus the two
// partial edge hours from base rows yields the exact base-row aggregate.

// convRollupUpsert increments the rollup row for one inserted fact. Append runs it in the same
// transaction as the fact insert, for every fact type the conversations measure counts.
const convRollupUpsert = `INSERT INTO conversations_hourly
	(hour,harness,repo_id,model,conversation_id,n) VALUES (?,?,?,?,?,1)
	ON CONFLICT(hour,harness,repo_id,model,conversation_id) DO UPDATE SET n=n+1`

// convRollupFill refills conversations_hourly from the base facts.
const convRollupFill = `INSERT INTO conversations_hourly
	SELECT CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, model, conversation_id, count(*)
	FROM facts WHERE type!='session_action'
	GROUP BY CAST(ts/3600 AS INTEGER)*3600, harness, repo_id, model, conversation_id`

// convRollupColumns are the facts columns convRollupFill selects. A pre-migration-4 layout (which a
// test constructs) lacks model, so the fill is skipped there.
var convRollupColumns = []string{"ts", "harness", "repo_id", "model", "conversation_id"}

// convRollupFillApplies reports whether facts has every column the conversations rollup fill needs.
func (t *Tenant) convRollupFillApplies() (bool, error) {
	have, err := t.columns("facts")
	if err != nil {
		return false, err
	}
	for _, c := range convRollupColumns {
		if !have[c] {
			return false, nil
		}
	}
	return true, nil
}

// backfillConversationRollup fills conversations_hourly from base rows for a tenant that just
// gained the table. It is a no-op when facts predates the analytics columns, so migration 7 can
// stay plain SQL and this runs from open instead. The DELETE and the fill run in one transaction,
// as RebuildHookRollup's do, so a crash between them cannot leave the table empty.
func (t *Tenant) backfillConversationRollup() error {
	ok, err := t.convRollupFillApplies()
	if err != nil || !ok {
		return err
	}
	ctx := context.Background()
	tx, err := t.wdb.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversations_hourly`); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, convRollupFill); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// The hourly facet rollup (migration 8): one row per distinct (dim, hour, value) with the number of
// facts that carried that value, for every dimension the /v1/analytics/facets read lists. Facets
// otherwise runs a DISTINCT scan per dimension over the whole facts window, each a full pass that
// misses the phase-3 bound on 90d; the rollup collapses the interior whole hours to one counted row
// per value and Facets reads base rows only for the two partial edge hours (analytics.go), so the
// distinct sets match the base rows exactly.

// facetRollupUpsert increments the (dim, hour, value) row for one inserted fact. Append runs it in
// the same transaction as the fact insert, only for a fact that was actually inserted, so a
// duplicate that collapses on the fact row-hash primary key adds nothing to the rollup.
const facetRollupUpsert = `INSERT INTO facets_hourly
	(dim,hour,value,n) VALUES (?,?,?,1)
	ON CONFLICT(dim,hour,value) DO UPDATE SET n=n+1`

// facetDims are the dimensions the facets read lists, each with the FactRow field it reads and the
// fact type it applies to ("" for every type). The tool histogram counts only hook_event facts, as
// the base query does.
var facetDims = []struct {
	name, typ string
	val       func(FactRow) string
}{
	{"repo_id", "", func(r FactRow) string { return r.RepoID }},
	{"harness", "", func(r FactRow) string { return r.Harness }},
	{"plan", "", func(r FactRow) string { return planOf(r.Path) }},
	{"event", "", func(r FactRow) string { return r.Event }},
	{"model", "", func(r FactRow) string { return r.Model }},
	{"norm_event", "", func(r FactRow) string { return r.NormEvent }},
	{"kind", "", func(r FactRow) string { return keys.Kind(r.Path) }},
	{"tool", "hook_event", func(r FactRow) string { return r.Tool }},
}

// facetRollupFill refills facets_hourly from the base rows: one grouped branch per dimension, the
// tool branch restricted to hook_event as the base histogram is. It is the aggregate the open-time
// backfill rebuilds the table from.
const facetRollupFill = `INSERT INTO facets_hourly (dim,hour,value,n)
	SELECT 'repo_id', CAST(ts/3600 AS INTEGER)*3600, repo_id, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'harness', CAST(ts/3600 AS INTEGER)*3600, harness, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'plan', CAST(ts/3600 AS INTEGER)*3600, plan, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'event', CAST(ts/3600 AS INTEGER)*3600, event, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'model', CAST(ts/3600 AS INTEGER)*3600, model, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'norm_event', CAST(ts/3600 AS INTEGER)*3600, norm_event, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'kind', CAST(ts/3600 AS INTEGER)*3600, kind, count(*) FROM facts WHERE type!='session_action' GROUP BY 2,3
	UNION ALL SELECT 'tool', CAST(ts/3600 AS INTEGER)*3600, tool, count(*) FROM facts WHERE type='hook_event' GROUP BY 2,3`

// facetRollupColumns are the facts columns facetRollupFill selects. A pre-migration-4 layout (which
// a test constructs) lacks them, so the fill is skipped there.
var facetRollupColumns = []string{"ts", "repo_id", "harness", "plan", "event", "model", "norm_event", "kind", "tool"}

// facetRollupFillApplies reports whether facts has every column the facet rollup fill needs.
func (t *Tenant) facetRollupFillApplies() (bool, error) {
	have, err := t.columns("facts")
	if err != nil {
		return false, err
	}
	for _, c := range facetRollupColumns {
		if !have[c] {
			return false, nil
		}
	}
	return true, nil
}

// backfillFacetRollup fills facets_hourly from base rows for a tenant that just gained the table. It
// is a no-op when facts predates the extracted columns, so migration 8 can stay plain SQL and this
// runs from open instead. The DELETE and the fill run in one transaction, as backfillConversationRollup's
// do, so a crash between them cannot leave the table empty.
func (t *Tenant) backfillFacetRollup() error {
	ok, err := t.facetRollupFillApplies()
	if err != nil || !ok {
		return err
	}
	ctx := context.Background()
	tx, err := t.wdb.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM facets_hourly`); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, facetRollupFill); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// convRollupIndexColumns are the facts columns the conversations page index reads. They are all
// migration-1 columns, so a test that reconstructs a version-1 ledger by dropping the extracted
// columns (kind among them) can still drop them: the index does not reference any of them, and the
// page's per-conversation kind set is read from the base table.
var convRollupIndexColumns = []string{"ts", "type", "conversation_id", "repo_id"}

// ensureConversationRollupIndex creates, once, the covering index the conversations page read
// (/v1/analytics/conversations) uses to group the window by conversation_id. It is ensured on every
// open rather than only when migration 7 first applies, so an index whose creation failed on an
// earlier open is still built. It is created here rather than in the migration slice because a
// pre-migration-4 test layout lacks the columns. ANALYZE runs only when this call creates the index,
// so a normal open does not re-ANALYZE; without stats the planner keeps facts_ts and a wide window
// misses the bound. It is a no-op once the index exists.
func (t *Tenant) ensureConversationRollupIndex() error {
	have, err := t.columns("facts")
	if err != nil {
		return err
	}
	for _, c := range convRollupIndexColumns {
		if !have[c] {
			return nil
		}
	}
	var n int
	if err := t.wdb.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name='facts_conv_page'`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return t.ensureUsageIndex()
	}
	if _, err := t.wdb.Exec(`CREATE INDEX IF NOT EXISTS facts_conv_page ON facts(conversation_id, ts, type, repo_id)`); err != nil {
		return err
	}
	if _, err := t.wdb.Exec(`ANALYZE facts`); err != nil {
		return err
	}
	return t.ensureUsageIndex()
}

// ensureUsageIndex creates, once, facts(type, norm_event, ts), the three columns the usage CTE
// filters on. Without it the planner walks facts_conv_page over every base row (to avoid a sort)
// and looks each row up in the table. The index is ANALYZEd on its own at creation: without a
// stat row the planner also picks it for other type= queries (WindowScores went from 33 ms to 5 s).
// It is a no-op once the index exists or when facts predates norm_event. On a large uncompacted
// ledger the first open pays a one-time build (about 0.7 s for 435k rows).
func (t *Tenant) ensureUsageIndex() error {
	have, err := t.columns("facts")
	if err != nil {
		return err
	}
	for _, c := range []string{"type", "norm_event", "ts"} {
		if !have[c] {
			return nil
		}
	}
	var n int
	if err := t.wdb.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name='facts_usage_ts'`).Scan(&n); err != nil || n > 0 {
		return err
	}
	if _, err := t.wdb.Exec(`CREATE INDEX IF NOT EXISTS facts_usage_ts ON facts(type, norm_event, ts)`); err != nil {
		return err
	}
	_, err = t.wdb.Exec(`ANALYZE facts_usage_ts`) // stats for this index only; a full ANALYZE would rescan facts
	return err
}

// RebuildHookRollup deletes every hook_events_hourly row and refills it from the base hook_event
// rows in one transaction, so the rollup equals the base-row aggregate again after a writer that
// bypasses Append (compaction). It is a no-op when facts predates the analytics columns.
func (t *Tenant) RebuildHookRollup(ctx context.Context) error {
	ok, err := t.rollupFillApplies()
	if err != nil || !ok {
		return err
	}
	tx, err := t.wdb.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM hook_events_hourly`); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, hookRollupFill); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// RebuildConversationRollup deletes every conversations_hourly row and refills it from the base
// facts in one transaction, so the rollup equals the base-row aggregate again after a writer that
// bypasses Append (compaction). It is a no-op when facts predates the analytics columns.
func (t *Tenant) RebuildConversationRollup(ctx context.Context) error {
	ok, err := t.convRollupFillApplies()
	if err != nil || !ok {
		return err
	}
	tx, err := t.wdb.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversations_hourly`); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, convRollupFill); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// RebuildFacetRollup deletes every facets_hourly row and refills it from the base rows in one
// transaction, so the rollup equals the base-row aggregate again after a writer that bypasses
// Append (compaction). It is a no-op when facts predates the analytics columns.
func (t *Tenant) RebuildFacetRollup(ctx context.Context) error {
	ok, err := t.facetRollupFillApplies()
	if err != nil || !ok {
		return err
	}
	tx, err := t.wdb.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM facets_hourly`); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, facetRollupFill); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// RebuildRollups rebuilds every rollup table in the store from base rows: the hook_events, the
// conversations and the facet rollup, in turn, returning the first error. It is the single
// registration point for the rollups, so a new rollup is added by calling its Rebuild* method here
// rather than at every caller. Compaction must call it because it deletes and rewrites facts
// directly, bypassing Append, which is the only writer that maintains the rollups incrementally;
// without this the rollups drift from their base-row aggregates.
func (t *Tenant) RebuildRollups(ctx context.Context) error {
	if err := t.RebuildHookRollup(ctx); err != nil {
		return err
	}
	if err := t.RebuildConversationRollup(ctx); err != nil {
		return err
	}
	return t.RebuildFacetRollup(ctx)
}

// columns returns the set of column names of a table.
func (t *Tenant) columns(table string) (map[string]bool, error) {
	rows, err := t.wdb.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}
