package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"

	"github.com/codyhamilton/yakka/packages/yakka/internal/actions"
)

type ActionProjection struct {
	Hash     string
	Raw      []byte
	Attempts int
}
type ActionRow struct {
	Hash           string         `json:"hash"`
	ConversationID string         `json:"conversation_id"`
	StartedAt      float64        `json:"started_at"`
	Source         string         `json:"source"`
	Method         string         `json:"method,omitempty"`
	Confidence     *float64       `json:"confidence,omitempty"`
	Status         string         `json:"status"`
	Reasons        []string       `json:"reasons"`
	Kind           string         `json:"kind,omitempty"`
	SubjectType    string         `json:"subject_type,omitempty"`
	SubjectID      string         `json:"subject_id,omitempty"`
	Phase          string         `json:"phase,omitempty"`
	Repo           string         `json:"repo,omitempty"`
	PR             string         `json:"pr,omitempty"`
	Raw            actions.Values `json:"raw"`
	SegmentStart   *float64       `json:"segment_start,omitempty"`
	SegmentEnd     *float64       `json:"segment_end,omitempty"`
	Effective      bool           `json:"effective"`
}

// PendingActionProjections returns facts whose projection has not succeeded or reached its retry cap.
func (t *Tenant) PendingActionProjections(ctx context.Context, limit int) ([]ActionProjection, error) {
	if limit < 1 {
		limit = 100
	}
	rows, err := t.rdb.QueryContext(ctx, `SELECT p.row_hash,f.raw,p.attempts FROM action_projection p JOIN facts f USING(row_hash) WHERE p.state='pending' ORDER BY f.received_at,p.row_hash LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ActionProjection
	for rows.Next() {
		var x ActionProjection
		if err := rows.Scan(&x.Hash, &x.Raw, &x.Attempts); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// ProjectAction validates and stores one action row. Failures are durable and bounded at three tries.
func (t *Tenant) ProjectAction(ctx context.Context, hash string) error {
	return t.submit(ctx, func(tx *sql.Tx) error {
		var raw []byte
		var state string
		var attempts int
		if err := tx.QueryRowContext(ctx, `SELECT f.raw,p.state,p.attempts FROM facts f JOIN action_projection p USING(row_hash) WHERE p.row_hash=?`, hash).Scan(&raw, &state, &attempts); err != nil {
			return err
		}
		if state != "pending" {
			return nil
		}
		var obj map[string]any
		if err := json.Unmarshal(raw, &obj); err != nil {
			return t.failActionTx(tx, hash, attempts, err)
		}
		s := func(k string) string { v, _ := obj[k].(string); return v }
		num := func(k string) (float64, bool) { v, ok := obj[k].(float64); return v, ok }
		a, _ := obj["action"].(map[string]any)
		av := actions.Values{}
		if a != nil {
			av = actions.Values{Kind: strVal(a["kind"]), SubjectType: strVal(a["subject_type"]), SubjectID: strVal(a["subject_id"]), Phase: strVal(a["phase"]), Repo: strVal(a["repo"]), PR: strVal(a["pr"])}
		}
		result := actions.Validate(av)
		status := "accepted"
		if len(result.Reasons) > 0 {
			status = "rejected"
		}
		ts, _ := num("ts")
		source := s("source")
		method := s("method")
		confidence, hasConfidence := num("confidence")
		var conf any
		if hasConfidence {
			conf = confidence
		}
		reasons, _ := json.Marshal(result.Reasons)
		n := result.Values
		_, err := tx.ExecContext(ctx, `INSERT OR REPLACE INTO session_actions(row_hash,conversation_id,started_at,source,method,confidence,status,reasons,kind,subject_type,subject_id,phase,repo,pr,raw_kind,raw_subject_type,raw_subject_id,raw_phase,raw_repo,raw_pr) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, hash, s("conversation_id"), ts, source, method, conf, status, string(reasons), n.Kind, n.SubjectType, n.SubjectID, n.Phase, n.Repo, n.PR, av.Kind, av.SubjectType, av.SubjectID, av.Phase, av.Repo, av.PR)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE action_projection SET state='projected',attempts=attempts+1,error='' WHERE row_hash=?`, hash); err != nil {
			return err
		}
		return recomputeActionSegments(ctx, tx, s("conversation_id"))
	})
}
func strVal(v any) string { s, _ := v.(string); return s }
func (t *Tenant) failActionTx(tx *sql.Tx, hash string, attempts int, cause error) error {
	attempts++
	state := "pending"
	if attempts >= 3 {
		state = "failed"
	}
	_, err := tx.Exec(`UPDATE action_projection SET attempts=?,state=?,error=? WHERE row_hash=?`, attempts, state, cause.Error(), hash)
	return err
}

// FailActionProjection records one failed attempt and marks the row terminal after three tries.
func (t *Tenant) FailActionProjection(ctx context.Context, hash string, cause error) error {
	return t.submit(ctx, func(tx *sql.Tx) error {
		var attempts int
		if err := tx.QueryRowContext(ctx, `SELECT attempts FROM action_projection WHERE row_hash=? AND state='pending'`, hash).Scan(&attempts); err != nil {
			return err
		}
		return t.failActionTx(tx, hash, attempts, cause)
	})
}

func recomputeActionSegments(ctx context.Context, tx *sql.Tx, conv string) error {
	rows, err := tx.QueryContext(ctx, `SELECT row_hash,source,started_at,status,kind,subject_type,subject_id,phase,repo,pr,COALESCE(confidence,0) FROM session_actions WHERE conversation_id=? ORDER BY started_at,row_hash`, conv)
	if err != nil {
		return err
	}
	type item struct {
		hash, source, status, kind, typ, id, phase, repo, pr string
		ts                                                   float64
		confidence                                           float64
		segmentStart, segmentEnd                             *float64
		effective                                            bool
	}
	var all []item
	for rows.Next() {
		var x item
		if err := rows.Scan(&x.hash, &x.source, &x.ts, &x.status, &x.kind, &x.typ, &x.id, &x.phase, &x.repo, &x.pr, &x.confidence); err != nil {
			rows.Close()
			return err
		}
		all = append(all, x)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if _, err = tx.ExecContext(ctx, `UPDATE session_actions SET effective=0,segment_start=NULL,segment_end=NULL WHERE conversation_id=?`, conv); err != nil {
		return err
	}
	var reviews, live, backs []item
	for _, x := range all {
		if x.status != "accepted" {
			continue
		}
		switch x.source {
		case "review":
			reviews = append(reviews, x)
		case "env", "mcp":
			live = append(live, x)
		case "backfill":
			backs = append(backs, x)
		}
	}
	if len(reviews) > 0 {
		sort.Slice(reviews, func(i, j int) bool {
			if reviews[i].ts == reviews[j].ts {
				return reviews[i].hash > reviews[j].hash
			}
			return reviews[i].ts > reviews[j].ts
		})
		_, err = tx.ExecContext(ctx, `UPDATE session_actions SET effective=1 WHERE row_hash=?`, reviews[0].hash)
		return err
	}
	if len(live) > 0 {
		sort.Slice(live, func(i, j int) bool {
			if live[i].ts == live[j].ts {
				return live[i].hash < live[j].hash
			}
			return live[i].ts < live[j].ts
		})
		start := 0
		for i := 1; i < len(live); i++ {
			a, b := live[i-1], live[i]
			if a.kind == b.kind && a.typ == b.typ && a.id == b.id && a.phase == b.phase && a.repo == b.repo && a.pr == b.pr {
				continue
			}
			live[start].effective = live[start].ts < b.ts
			live[start].segmentEnd = &b.ts
			live[start].segmentStart = nil
			start = i
		}
		live[start].effective = true
		for _, x := range live {
			var st, en any
			if x.segmentStart != nil {
				st = *x.segmentStart
			}
			if x.segmentEnd != nil {
				en = *x.segmentEnd
			}
			if _, err = tx.ExecContext(ctx, `UPDATE session_actions SET effective=?,segment_start=?,segment_end=? WHERE row_hash=?`, boolInt(x.effective), st, en, x.hash); err != nil {
				return err
			}
		}
		return nil
	}
	if len(backs) > 0 {
		sort.Slice(backs, func(i, j int) bool {
			if backs[i].confidence != backs[j].confidence {
				return backs[i].confidence > backs[j].confidence
			}
			if backs[i].ts != backs[j].ts {
				return backs[i].ts > backs[j].ts
			}
			return backs[i].hash > backs[j].hash
		})
		_, err = tx.ExecContext(ctx, `UPDATE session_actions SET effective=1 WHERE row_hash=?`, backs[0].hash)
	}
	return err
}
func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ActionRows reads projected actions with optional exact filters; a conversation query also reports pending facts.
func (t *Tenant) ActionRows(ctx context.Context, conversation, plan, kind, status, source string, maxConfidence *float64, limit int) ([]ActionRow, int, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	where := `WHERE 1=1`
	args := []any{}
	add := func(col, val string) {
		if val != "" {
			where += ` AND ` + col + `=?`
			args = append(args, val)
		}
	}
	add("conversation_id", conversation)
	if plan != "" {
		where += ` AND subject_type='plan' AND substr(subject_id,instr(subject_id,':plan/')+6)=?`
		args = append(args, plan)
	}
	add("kind", kind)
	add("status", status)
	add("source", source)
	if maxConfidence != nil {
		where += ` AND confidence<=?`
		args = append(args, *maxConfidence)
	}
	args = append(args, limit)
	tx, err := t.rdb.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT row_hash,conversation_id,started_at,source,method,confidence,status,reasons,kind,subject_type,subject_id,phase,repo,pr,raw_kind,raw_subject_type,raw_subject_id,raw_phase,raw_repo,raw_pr,segment_start,segment_end,effective FROM session_actions `+where+` ORDER BY started_at DESC,row_hash LIMIT ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []ActionRow{}
	for rows.Next() {
		var x ActionRow
		var reasons string
		var conf, st, en sql.NullFloat64
		var start float64
		var eff int
		if err := rows.Scan(&x.Hash, &x.ConversationID, &start, &x.Source, &x.Method, &conf, &x.Status, &reasons, &x.Kind, &x.SubjectType, &x.SubjectID, &x.Phase, &x.Repo, &x.PR, &x.Raw.Kind, &x.Raw.SubjectType, &x.Raw.SubjectID, &x.Raw.Phase, &x.Raw.Repo, &x.Raw.PR, &st, &en, &eff); err != nil {
			return nil, 0, err
		}
		x.StartedAt = start
		if conf.Valid {
			x.Confidence = &conf.Float64
		}
		if st.Valid {
			x.SegmentStart = &st.Float64
		}
		if en.Valid {
			x.SegmentEnd = &en.Float64
		}
		x.Effective = eff != 0
		if err := json.Unmarshal([]byte(reasons), &x.Reasons); err != nil {
			return nil, 0, err
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	pending := 0
	if conversation != "" {
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM action_projection p JOIN facts f USING(row_hash) WHERE f.conversation_id=? AND p.state='pending'`, conversation).Scan(&pending); err != nil {
			return nil, 0, err
		}
	}
	return out, pending, nil
}

// ActionStatus reports action counts within the trailing week, rejected reasons, and terminal projection failures.
func (t *Tenant) ActionStatus(ctx context.Context) (map[string]int, error) {
	out := map[string]int{"tagged": 0, "untagged": 0, "failed": 0}
	var tagged, untagged int
	err := t.rdb.QueryRowContext(ctx, `WITH conv AS (SELECT DISTINCT conversation_id FROM facts WHERE ts>=strftime('%s','now')-604800), tagged AS (SELECT DISTINCT conversation_id FROM session_actions WHERE status='accepted') SELECT (SELECT COUNT(*) FROM conv JOIN tagged USING(conversation_id)),(SELECT COUNT(*) FROM conv)-(SELECT COUNT(*) FROM conv JOIN tagged USING(conversation_id))`).Scan(&tagged, &untagged)
	if err != nil {
		return nil, err
	}
	out["tagged"], out["untagged"] = tagged, untagged
	var failed int
	err = t.rdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM action_projection WHERE state='failed'`).Scan(&failed)
	if err != nil {
		return nil, err
	}
	out["failed"] = failed
	rows, err := t.rdb.QueryContext(ctx, `SELECT reasons FROM session_actions WHERE status='rejected' AND started_at>=strftime('%s','now')-604800`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		_ = rows.Scan(&raw)
		var rs []string
		_ = json.Unmarshal([]byte(raw), &rs)
		for _, r := range rs {
			out["rejected:"+r]++
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
