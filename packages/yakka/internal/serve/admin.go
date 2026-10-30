package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// adminFailureRows is how many recent screen failures the status shows per tenant.
const adminFailureRows = 25

// adminOnly narrows a session handler to the admin.
func (s *Server) adminOnly(h func(w http.ResponseWriter, r *http.Request, sess *Session)) func(w http.ResponseWriter, r *http.Request, sess *Session) {
	return func(w http.ResponseWriter, r *http.Request, sess *Session) {
		if !isAdmin(SessionRecord{VerifiedEmails: sess.VerifiedEmails}) {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		h(w, r, sess)
	}
}

// rescoreState is one tenant's rescore job. The job re-runs the screen step over content that was
// stored while no scorer was configured; it never runs for a server without one.
type rescoreState struct {
	mu   sync.Mutex
	view RescoreView
}

// RescoreView is the externally visible state of a rescore job.
type RescoreView struct {
	Running  bool   `json:"running"`
	Total    int    `json:"total"`
	Done     int    `json:"done"`
	Failed   int    `json:"failed"`
	Started  int64  `json:"started"`  // unix seconds; 0 when never run
	Finished int64  `json:"finished"` // unix seconds; 0 while running or never run
	Error    string `json:"error,omitempty"`
}

func (r *rescoreState) snapshot() RescoreView {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.view
}

// begin claims the job slot. It reports false when a job is already running.
func (r *rescoreState) begin(total int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.view.Running {
		return false
	}
	r.view = RescoreView{Running: true, Total: total, Started: time.Now().Unix()}
	return true
}

func (r *rescoreState) step(ok bool, cause error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if ok {
		r.view.Done++
		return
	}
	r.view.Failed++
	r.view.Error = shortCause(cause)
}

func (r *rescoreState) end(abort error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.view.Running = false
	r.view.Finished = time.Now().Unix()
	if abort != nil {
		r.view.Error = shortCause(abort)
	}
}

// scoring reports whether the server was started with a scorer, and with checks loaded.
func (s *Server) scoring() (scorer, checks bool) {
	return s.opts.ScreenStep != nil, s.opts.Checks != nil
}

type adminTenant struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name"`
	Facts      int                    `json:"facts"`
	Compaction string                 `json:"compaction"`
	Footprint  store.Footprint        `json:"footprint"`
	Screens    store.ScreenSummary    `json:"screens"`
	Failures   []store.RejectionEntry `json:"failures"`
	Rescore    RescoreView            `json:"rescore"`
	Error      string                 `json:"error,omitempty"`
}

// adminTenantIDs lists every tenant directory that holds a ledger.
func (s *Server) adminTenantIDs() []string {
	ents, err := os.ReadDir(s.cfg.Data)
	if err != nil {
		return nil
	}
	var ids []string
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(s.cfg.Data, e.Name(), "ledger.db")); err == nil {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids
}

func (s *Server) adminTenantStatus(ctx context.Context, id string) adminTenant {
	out := adminTenant{ID: id, Name: s.registry.TenantName(id), Failures: []store.RejectionEntry{}}
	ts, err := s.tenant(id)
	if err != nil {
		out.Error = shortCause(err)
		return out
	}
	t := ts.t
	out.Compaction = t.CompactionState()
	out.Rescore = ts.rescore.snapshot()
	var errs []error
	if out.Facts, err = t.FactCount(ctx); err != nil {
		errs = append(errs, err)
	}
	if out.Footprint, err = t.Footprint(); err != nil {
		errs = append(errs, err)
	}
	if out.Screens, err = t.ScreenSummary(ctx); err != nil {
		errs = append(errs, err)
	}
	if out.Failures, err = t.RecentRejections(ctx, "screen", adminFailureRows); err != nil {
		errs = append(errs, err)
	}
	if err := errors.Join(errs...); err != nil {
		out.Error = shortCause(err)
	}
	return out
}

func (s *Server) handleAdminStatus(w http.ResponseWriter, r *http.Request, _ *Session) {
	hasScorer, hasChecks := s.scoring()
	resp := map[string]any{
		"version": s.opts.Version,
		"scoring": map[string]bool{"scorer": hasScorer, "checks": hasChecks, "rescorable": hasScorer},
	}
	if total, free, err := volumeUsage(s.cfg.Data); err == nil {
		resp["volume"] = map[string]uint64{"total_bytes": total, "free_bytes": free}
	}
	tenants := []adminTenant{}
	for _, id := range s.adminTenantIDs() {
		tenants = append(tenants, s.adminTenantStatus(r.Context(), id))
	}
	resp["tenants"] = tenants
	writeJSON(w, 200, resp)
}

func (s *Server) handleAdminRescore(w http.ResponseWriter, r *http.Request, _ *Session) {
	var body struct {
		Tenant string `json:"tenant"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Tenant == "" {
		writeJSON(w, 400, map[string]string{"error": "tenant is required"})
		return
	}
	if hasScorer, _ := s.scoring(); !hasScorer {
		writeJSON(w, 409, map[string]string{"error": "scoring is off: set TYPESAFE_API_KEY and YAKKA_CHECKS_DIR and restart"})
		return
	}
	known := false
	for _, id := range s.adminTenantIDs() {
		if id == body.Tenant {
			known = true
			break
		}
	}
	if !known {
		writeJSON(w, 404, map[string]string{"error": "no such tenant"})
		return
	}
	ts, err := s.tenant(body.Tenant)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "tenant unavailable"})
		return
	}
	hashes, err := ts.t.UnscoredBlobs(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "cannot list unscored content"})
		return
	}
	if !ts.rescore.begin(len(hashes)) {
		writeJSON(w, 409, map[string]string{"error": "a rescore is already running"})
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		ts.rescore.end(store.ErrClosed)
		writeJSON(w, 503, map[string]string{"error": "shutting down"})
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()
	go s.runRescore(ts, hashes)
	writeJSON(w, 202, ts.rescore.snapshot())
}

// runRescore screens each hash in turn. A scorer that is unreachable ends the job; any other
// failure is counted and the job moves on, so one bad blob cannot hold the rest back.
func (s *Server) runRescore(ts *tenantState, hashes []string) {
	defer s.wg.Done()
	var abort error
	for _, h := range hashes {
		if err := s.ctx.Err(); err != nil {
			abort = err
			break
		}
		err := s.screen(s.ctx, ts.t, h)
		ts.rescore.step(err == nil, err)
		if err != nil {
			fmt.Fprintf(os.Stderr, "yakka serve: rescore %s: %v\n", h, err)
			if errors.Is(err, scorer.ErrUnreachable) {
				abort = err
				break
			}
		}
	}
	ts.rescore.end(abort)
}
