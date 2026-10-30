// Package sync copies a local tenant's facts to a hosted tenant (plan 18).
//
// It reads the local ledger read-only, rebuilds each fact in its wire shape and posts it to the
// remote's /v1/ingest with the credential from clientconfig.LoadSync. The remote ingest is idempotent
// by row hash, so a run can be repeated, interrupted and resumed; a cursor over the local rowid
// keeps reruns incremental. Preflight refuses, before anything is sent, a target that is not the
// tenant the user named, a token that cannot write, a loopback endpoint and a ledger this binary
// does not understand.
package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/codyhamilton/yakka/packages/yakka/internal/archive"
	"github.com/codyhamilton/yakka/packages/yakka/internal/clientconfig"
	"github.com/codyhamilton/yakka/packages/yakka/internal/drain"
	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// Options configure Run. Zero values take the defaults noted.
type Options struct {
	Source string // local tenant directory (required)
	To     string // remote tenant ID the credential must be bound to (required)
	DryRun bool

	Cred     clientconfig.Config // sync credential (required)
	StateDir string              // cursor directory; default $XDG_STATE_HOME/yakka/sync
	Client   *http.Client        // default: 30 s timeout

	MaxFacts   int           // facts per request, default 500
	MaxBytes   int           // body bytes per request, default 8 MiB
	PageRows   int           // ledger rows read per page, default 500
	BackoffMin time.Duration // first retry delay for 5xx and network errors, default 500 ms
	BackoffMax time.Duration // cap on that delay, default 5 min

	// AllowLoopback lets tests target an httptest server; the command never sets it.
	AllowLoopback bool
	// Stop, if set, is consulted after each batch; a non-nil return ends the run with that error
	// (tests use it to interrupt).
	Stop func(sentFacts int) error
}

// TypeCounts is a per-fact-type tally.
type TypeCounts map[string]int

// Report is what a run did.
type Report struct {
	Accepted  TypeCounts `json:"accepted"`
	Duplicate TypeCounts `json:"duplicate"`
	Rejected  TypeCounts `json:"rejected"`
	NoBody    int        `json:"no_body"`
	NoContent int        `json:"no_content"`
	TooLarge  int        `json:"too_large"`
	Bytes     int64      `json:"bytes"`
	Contents  int        `json:"distinct_contents"`
	Rejects   []Reject   `json:"rejects,omitempty"`
	DryRun    bool       `json:"dry_run"`
	Cursor    int64      `json:"cursor"`
}

// Reject names a fact the remote refused: its id and the reason (never the content).
type Reject struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// Print writes the human-readable report.
func (r *Report) Print(w io.Writer) {
	for _, typ := range []string{"hook_event", "artifact_version", "commit"} {
		n := r.Accepted[typ] + r.Duplicate[typ] + r.Rejected[typ]
		if r.DryRun {
			fmt.Fprintf(w, "%-17s would send %d\n", typ, n)
			continue
		}
		fmt.Fprintf(w, "%-17s sent %d  accepted %d  duplicate %d  rejected %d\n", typ, n,
			r.Accepted[typ], r.Duplicate[typ], r.Rejected[typ])
	}
	fmt.Fprintf(w, "skipped           no_body %d  no_content %d  too_large %d\n", r.NoBody, r.NoContent, r.TooLarge)
	fmt.Fprintf(w, "bytes %d  distinct artifact contents %d  cursor %d\n", r.Bytes, r.Contents, r.Cursor)
	for _, x := range r.Rejects {
		fmt.Fprintf(w, "rejected %s: %s\n", x.ID, x.Reason)
	}
}

func (o *Options) defaults() {
	if o.MaxFacts <= 0 {
		o.MaxFacts = 500
	}
	if o.MaxBytes <= 0 {
		o.MaxBytes = 8 << 20
	}
	if o.PageRows <= 0 {
		o.PageRows = 500
	}
	if o.BackoffMin <= 0 {
		o.BackoffMin = 500 * time.Millisecond
	}
	if o.BackoffMax <= 0 {
		o.BackoffMax = 5 * time.Minute
	}
	if o.Client == nil {
		o.Client = &http.Client{Timeout: 30 * time.Second}
	}
	if o.StateDir == "" {
		o.StateDir = defaultStateDir()
	}
}

func defaultStateDir() string {
	base := os.Getenv("XDG_STATE_HOME")
	if base == "" {
		home := os.Getenv("HOME")
		if home == "" {
			home, _ = os.UserHomeDir()
		}
		base = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(base, "yakka", "sync")
}

// ErrPreflight wraps every refusal made before a fact is sent.
var ErrPreflight = errors.New("sync: refused")

func refuse(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrPreflight, fmt.Sprintf(format, a...))
}

func loopback(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

type whoami struct {
	Tenant string `json:"tenant"`
	Scope  string `json:"scope"`
}

func (o *Options) preflight(ctx context.Context, ro *store.ReadOnly) error {
	if o.Cred.Endpoint == "" || o.Cred.Key == "" {
		return refuse("no sync credential")
	}
	u, err := url.Parse(o.Cred.Endpoint)
	if err != nil || u.Host == "" {
		return refuse("the sync endpoint is not a URL")
	}
	if !o.AllowLoopback && loopback(u.Hostname()) {
		return refuse("the sync endpoint is a loopback address; sync copies to a hosted collector")
	}
	if o.To == "" {
		return refuse("--to is required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(o.Cred.Endpoint, "/")+"/v1/whoami", nil)
	if err != nil {
		return refuse("the sync endpoint is not a URL")
	}
	req.Header.Set("Authorization", "Bearer "+o.Cred.Key)
	resp, err := o.Client.Do(req)
	if err != nil {
		return refuse("cannot reach the sync endpoint")
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case 200:
	case 404:
		return refuse("the endpoint has no /v1/whoami; it is not a yakka collector this version can sync to")
	case 401:
		return refuse("the sync credential was not accepted (expired or revoked); run `yakka login --sync`")
	default:
		return refuse("whoami answered %d", resp.StatusCode)
	}
	var w whoami
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&w) != nil {
		return refuse("whoami answer is not JSON")
	}
	if w.Tenant != o.To {
		return refuse("the credential is bound to tenant %q, not %q", w.Tenant, o.To)
	}
	if w.Scope != "read_write" {
		return refuse("the credential has scope %q; sync needs read_write", w.Scope)
	}
	v, err := ro.UserVersion(ctx)
	if err != nil {
		return refuse("cannot read the local ledger: %v", err)
	}
	if v != store.SchemaVersion() {
		return refuse("the local ledger is schema version %d and this binary expects %d; start `yakka serve` once on it to migrate", v, store.SchemaVersion())
	}
	return nil
}

// cursor

type cursorFile struct {
	Rowid int64 `json:"rowid"`
}

func (o *Options) cursorPath() string {
	u, _ := url.Parse(o.Cred.Endpoint)
	host := strings.NewReplacer(":", "_", "/", "_").Replace(u.Host)
	return filepath.Join(o.StateDir, host+"_"+o.To+".json")
}

func (o *Options) loadCursor() int64 {
	b, err := os.ReadFile(o.cursorPath())
	if err != nil {
		return 0
	}
	var c cursorFile
	if json.Unmarshal(b, &c) != nil || c.Rowid < 0 {
		return 0
	}
	return c.Rowid
}

func (o *Options) saveCursor(rowid int64) error {
	if err := os.MkdirAll(o.StateDir, 0o700); err != nil {
		return err
	}
	b, _ := json.Marshal(cursorFile{Rowid: rowid})
	tmp := o.cursorPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, o.cursorPath())
}

// facts

type outFact struct {
	rowid int64
	typ   string
	id    string
	body  json.RawMessage
	hash  string // content hash of an artifact_version
}

func encode(m map[string]any) (json.RawMessage, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func decode(raw []byte) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil || m == nil {
		return nil, errors.New("not an object")
	}
	return m, nil
}

// build turns one page of ledger rows into wire facts in rowid order. Rows with nothing to send
// are counted in rep and skipped.
func build(ro *store.ReadOnly, rows []store.SyncRow, rep *Report) ([]outFact, error) {
	byConv := map[string]map[string]archive.Line{}
	for _, r := range rows {
		if r.Type != "hook_event" {
			continue
		}
		if _, ok := byConv[r.ConversationID]; ok {
			continue
		}
		lines, err := archive.Read(ro.Dir(), r.ConversationID)
		if err != nil {
			return nil, err
		}
		m := make(map[string]archive.Line, len(lines))
		for _, l := range lines {
			m[l.RowHash] = l
		}
		byConv[r.ConversationID] = m
	}
	var out []outFact
	for _, r := range rows {
		id := fmt.Sprintf("sync:%d", r.Rowid)
		switch r.Type {
		case "hook_event":
			l, ok := byConv[r.ConversationID][r.RowHash]
			if !ok {
				rep.NoBody++
				continue
			}
			m, err := decode(l.Fact)
			if err != nil {
				rep.NoBody++
				continue
			}
			ingest.Trim(m)
			m["id"] = id
			b, err := encode(m)
			if err != nil {
				return nil, err
			}
			out = append(out, outFact{rowid: r.Rowid, typ: r.Type, id: id, body: b})
		case "artifact_version":
			content, ok, err := ro.Content(r.ContentHash)
			if err != nil {
				return nil, err
			}
			if !ok || !utf8.Valid(content) {
				rep.NoContent++
				continue
			}
			m, err := decode(r.Raw)
			if err != nil {
				return nil, fmt.Errorf("sync: row %d: %w", r.Rowid, err)
			}
			m["id"] = id
			m["content"] = string(content)
			b, err := encode(m)
			if err != nil {
				return nil, err
			}
			out = append(out, outFact{rowid: r.Rowid, typ: r.Type, id: id, body: b, hash: r.ContentHash})
		default:
			m, err := decode(r.Raw)
			if err != nil {
				return nil, fmt.Errorf("sync: row %d: %w", r.Rowid, err)
			}
			m["id"] = id
			b, err := encode(m)
			if err != nil {
				return nil, err
			}
			out = append(out, outFact{rowid: r.Rowid, typ: r.Type, id: id, body: b})
		}
	}
	return out, nil
}

// sending

// ErrAuth is returned when the remote refuses the credential after preflight passed.
var ErrAuth = errors.New("sync: the remote refused the credential mid-run; the cursor is saved, run `yakka login --sync` and sync again")

type runner struct {
	o     *Options
	sink  drain.Sink
	rep   *Report
	sent  int
	seen  map[string]bool
	wait  func(context.Context, time.Duration) error
	delay time.Duration
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func tally(m *TypeCounts, typ string) {
	if *m == nil {
		*m = TypeCounts{}
	}
	(*m)[typ]++
}

// batches splits facts by the fact and byte caps.
func (r *runner) batches(facts []outFact) [][]outFact {
	var out [][]outFact
	var cur []outFact
	size := 0
	for _, f := range facts {
		if len(cur) > 0 && (len(cur) >= r.o.MaxFacts || size+len(f.body) > r.o.MaxBytes) {
			out = append(out, cur)
			cur, size = nil, 0
		}
		cur = append(cur, f)
		size += len(f.body) + 1
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

func (r *runner) record(f outFact, status, reason string) {
	r.sent++
	r.rep.Bytes += int64(len(f.body))
	switch status {
	case ingest.Accepted:
		tally(&r.rep.Accepted, f.typ)
	case ingest.Duplicate:
		tally(&r.rep.Duplicate, f.typ)
	default:
		tally(&r.rep.Rejected, f.typ)
		r.rep.Rejects = append(r.rep.Rejects, Reject{ID: f.id, Reason: reason})
	}
	if f.hash != "" && !r.seen[f.hash] {
		r.seen[f.hash] = true
		r.rep.Contents++
	}
}

// send delivers one batch, retrying and splitting as the status requires.
func (r *runner) send(ctx context.Context, batch []outFact) error {
	for {
		bodies := make([]json.RawMessage, len(batch))
		for i, f := range batch {
			bodies[i] = f.body
		}
		resp, err := r.sink.Send(ctx, bodies)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		switch {
		case err != nil || resp.Status >= 500:
			if r.delay == 0 {
				r.delay = r.o.BackoffMin
			} else {
				r.delay = min(r.delay*2, r.o.BackoffMax)
			}
			if err := r.wait(ctx, r.delay); err != nil {
				return err
			}
			continue
		case resp.Status == 429:
			d := resp.RetryAfter
			if d <= 0 {
				d = time.Second
			}
			if err := r.wait(ctx, d); err != nil {
				return err
			}
			continue
		case resp.Status == 401 || resp.Status == 403:
			return ErrAuth
		case resp.Status == 400 || resp.Status == 413:
			if len(batch) > 1 {
				mid := len(batch) / 2
				if err := r.send(ctx, batch[:mid]); err != nil {
					return err
				}
				return r.send(ctx, batch[mid:])
			}
			if resp.Status == 413 {
				r.rep.TooLarge++
			} else {
				r.record(batch[0], ingest.Rejected, "bad request")
			}
			return nil
		case resp.Status != 200 || len(resp.Results) != len(batch):
			return fmt.Errorf("sync: unexpected answer %d from the remote", resp.Status)
		}
		r.delay = 0
		for i, f := range batch {
			r.record(f, resp.Results[i].Status, resp.Results[i].Reason)
		}
		if r.o.Stop != nil {
			if err := r.o.Stop(r.sent); err != nil {
				return err
			}
		}
		return nil
	}
}

// Run syncs opts.Source to the remote tenant opts.To and returns the report. On an error the
// report holds what was done so far and the cursor is where the last finished page left it.
func Run(ctx context.Context, opts Options) (*Report, error) {
	opts.defaults()
	rep := &Report{Accepted: TypeCounts{}, Duplicate: TypeCounts{}, Rejected: TypeCounts{}, DryRun: opts.DryRun}
	ro, err := store.OpenReadOnly(opts.Source)
	if err != nil {
		return rep, err
	}
	defer ro.Close()
	if err := opts.preflight(ctx, ro); err != nil {
		return rep, err
	}
	run := &runner{o: &opts, rep: rep, seen: map[string]bool{}, wait: sleep,
		sink: &drain.HTTPSink{Endpoint: opts.Cred.Endpoint, Key: opts.Cred.Key, Client: opts.Client}}
	cur := opts.loadCursor()
	rep.Cursor = cur
	for {
		rows, err := ro.FactsAfter(ctx, cur, opts.PageRows)
		if err != nil {
			return rep, err
		}
		if len(rows) == 0 {
			return rep, nil
		}
		facts, err := build(ro, rows, rep)
		if err != nil {
			return rep, err
		}
		if opts.DryRun {
			for _, f := range facts {
				run.record(f, ingest.Accepted, "")
			}
		} else {
			for _, b := range run.batches(facts) {
				if err := run.send(ctx, b); err != nil {
					return rep, err
				}
			}
		}
		cur = rows[len(rows)-1].Rowid
		rep.Cursor = cur
		if !opts.DryRun {
			if err := opts.saveCursor(cur); err != nil {
				return rep, err
			}
		}
	}
}
