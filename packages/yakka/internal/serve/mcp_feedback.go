package serve

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

const mcpFeedbackFix = "Fix: rewrite the file; the new write is the repair."
const mcpFeedbackNoDrainFix = "Fix: start the plugin drain at the next hook event, or run the plugin's bin/yakka drain"

// feedbackPendingWindow is how long a delivered version may wait for its screen before a
// scoring value of pending no longer applies.
const feedbackPendingWindow = 30 * time.Second

// feedbackScreenWait bounds how long a delivered answer waits for the screen when scoring
// is configured and the version is still inside feedbackPendingWindow.
var feedbackScreenWait = 10 * time.Second

// feedbackScoring is the scoring value a delivered answer reports: off unless the server has
// a scorer and its checks loaded; pending while no screen is recorded and the version arrived
// under feedbackPendingWindow ago; otherwise on.
func feedbackScoring(configured, screened bool, received, now time.Time) string {
	switch {
	case !configured:
		return "off"
	case !screened && now.Sub(received) < feedbackPendingWindow:
		return "pending"
	default:
		return "on"
	}
}

// feedbackScreened reports whether the screen step has recorded its outcome for the latest version.
func feedbackScreened(a *store.Artifact) bool {
	return a.Latest.Screen != nil || (a.Latest.Rejection != nil && a.Latest.Rejection.Stage == "screen")
}

// scoringConfigured is true when the server has both a scorer and checks loaded.
func (s *Server) scoringConfigured() bool {
	scorer, checks := s.scoring()
	return scorer && checks
}

type feedbackLocal struct {
	resolved map[string]any
	file     map[string]any
	git      map[string]any
	queue    map[string]any
	drain    map[string]any
}

func feedbackNumber(m map[string]any, key string) float64 {
	v, _ := m[key].(float64)
	return v
}

func feedbackString(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func feedbackBool(m map[string]any, key string) bool {
	v, _ := m[key].(bool)
	return v
}

func (l LocalContext) feedbackFacts() (feedbackLocal, *LocalFailure) {
	read := func(name string) (map[string]any, *LocalFailure) { return l.Get(name) }
	var facts feedbackLocal
	var fail *LocalFailure
	if facts.resolved, fail = read("resolved_path"); fail != nil {
		return facts, fail
	}
	if facts.file, fail = read("file"); fail != nil {
		return facts, fail
	}
	if facts.git, fail = read("git"); fail != nil {
		return facts, fail
	}
	if facts.queue, fail = read("queue"); fail != nil {
		return facts, fail
	}
	if facts.drain, fail = read("drain"); fail != nil {
		return facts, fail
	}
	return facts, nil
}

func (s *Server) mcpArtifactFeedback(ctx context.Context, _ string, ts *tenantState, args map[string]any, local LocalContext) (any, error) {
	f, failure := local.feedbackFacts()
	if failure != nil {
		return nil, failure
	}
	path := feedbackString(f.resolved, "path")
	argPath := args["path"].(string)
	if path == "" {
		if !strings.HasPrefix(argPath, "/") {
			return mcpToolError("cannot resolve the working directory"), nil
		}
		path = argPath
	}
	if !feedbackBool(f.file, "exists") {
		return mcpToolError("path does not exist: " + path), nil
	}
	if !feedbackBool(f.file, "is_file") {
		return mcpToolError("path is a directory, not a file: " + path), nil
	}
	if readErr := feedbackString(f.file, "read_error"); readErr != "" {
		return mcpToolError("cannot read " + path), nil
	}
	if feedbackString(f.file, "withheld") == "too_large" {
		return mcpToolError("file too large to hash: " + path), nil
	}
	rel := feedbackString(f.git, "rel_path")
	repo := feedbackString(f.git, "repo_id")
	gitErr := feedbackString(f.git, "error")
	contentHash := feedbackString(f.file, "content_hash")
	if gitErr == "no_repo" || gitErr == "outside_repo" || gitErr == "symlink_out" || gitErr == "git_unavailable" || repo == "" && gitErr != "no_commit" {
		return feedbackState("not tracked", path, "", "", "not inside a git repository; nothing is captured for this file"), nil
	}
	if !validKind(keys.Kind(rel)) {
		return feedbackState("not tracked", path, "", "", "not a design, brief or report path; nothing is captured for this file"), nil
	}
	if gitErr == "no_commit" || repo == "" {
		return feedbackState("not tracked", path, "", "", "repository has no commit yet, so it has no repo_id; nothing is captured for this file"), nil
	}
	if contentHash == "" {
		return mcpToolError("local context unavailable: file (missing content_hash)"), nil
	}
	head := "path: " + rel + "\nrepo: " + repo + "\ncontent_hash: " + contentHash + "\n"
	state := func(name string, lines ...string) any {
		return mcpText("state: " + name + "\n" + head + "\n" + strings.Join(lines, "\n"))
	}
	mtime := feedbackNumber(f.file, "mtime")
	pending, _ := f.queue["pending"].([]any)
	if len(pending) != 0 {
		waited := time.Duration(0)
		if feedbackBool(f.drain, "running") {
			started := time.Now()
			deadline := time.Now().Add(1500 * time.Millisecond)
			for time.Now().Before(deadline) {
				a, err := ts.t.Artifact(ctx, repo, rel)
				if err != nil {
					return nil, fmt.Errorf("artifact read failed")
				}
				if a != nil && a.Latest.ContentHash == contentHash {
					return s.feedbackDelivered(ctx, ts, a, repo, rel, contentHash, state, nil)
				}
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(100 * time.Millisecond):
				}
			}
			waited = time.Since(started)
		}
		oldest := 0.0
		for _, item := range pending {
			m, _ := item.(map[string]any)
			age := feedbackNumber(m, "age_s")
			age += waited.Seconds()
			if age > oldest {
				oldest = age
			}
		}
		why := "draining"
		lines := []string{fmt.Sprintf("%d events for this file still queued, oldest %ds, %s", len(pending), int(math.Round(oldest)), why)}
		if !feedbackBool(f.drain, "running") {
			lines[0] = fmt.Sprintf("%d events for this file still queued, oldest %ds, no drain running", len(pending), int(math.Round(oldest)))
			lines = append(lines, mcpFeedbackNoDrainFix)
		}
		return state("queued", lines...), nil
	}
	rejected, _ := f.queue["rejected"].([]any)
	rejectionLines := []string{}
	superseded := false
	for _, item := range rejected {
		m, _ := item.(map[string]any)
		if feedbackNumber(m, "mtime") < mtime {
			superseded = true
			continue
		}
		if reason := feedbackString(m, "reason"); reason != "" {
			rejectionLines = append(rejectionLines, strings.Split(strings.TrimRight(reason, "\n"), "\n")...)
		}
	}
	if len(rejectionLines) != 0 {
		return state("rejected", append(rejectionLines, mcpFeedbackFix)...), nil
	}
	note := []string{}
	if superseded {
		note = append(note, "note: earlier rejection superseded by a later write")
	}
	a, err := ts.t.Artifact(ctx, repo, rel)
	if err != nil {
		return nil, fmt.Errorf("artifact read failed")
	}
	if a == nil {
		return state("not delivered", append([]string{"the service has no version of this file and nothing is queued; if it was just written, wait for the hook or rewrite the file"}, note...)...), nil
	}
	if a.Latest.ContentHash != contentHash {
		short := a.Latest.ContentHash
		if len(short) > 12 {
			short = short[:12]
		}
		return state("stale", append([]string{fmt.Sprintf("current content not yet delivered (service has %s from %s); normally a write still in the batch window", short, a.Latest.ReceivedAt.UTC().Format(time.RFC3339))}, note...)...), nil
	}
	return s.feedbackDelivered(ctx, ts, a, repo, rel, contentHash, state, note)
}

func feedbackState(name, path, repo, hash string, lines ...string) any {
	parts := []string{"state: " + name, "path: " + path}
	if repo != "" {
		parts = append(parts, "repo: "+repo, "content_hash: "+hash)
	}
	parts = append(parts, lines...)
	return mcpText(strings.Join(parts, "\n"))
}

// awaitScreen waits, while the version is pending, for the screen step to record its outcome.
// It polls the store every 100 ms for at most feedbackScreenWait and stops early when the
// screen is recorded or the latest version is no longer this hash.
func (s *Server) awaitScreen(ctx context.Context, ts *tenantState, repo, rel, hash string, a *store.Artifact) (*store.Artifact, error) {
	deadline := time.Now().Add(feedbackScreenWait)
	for !feedbackScreened(a) && time.Since(a.Latest.ReceivedAt) < feedbackPendingWindow && time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
		cur, err := ts.t.Artifact(ctx, repo, rel)
		if err != nil {
			return nil, fmt.Errorf("artifact read failed")
		}
		if cur == nil || cur.Latest.ContentHash != hash {
			return a, nil
		}
		a = cur
	}
	return a, nil
}

func (s *Server) feedbackDelivered(ctx context.Context, ts *tenantState, a *store.Artifact, repo, rel, hash string, state func(string, ...string) any, note []string) (any, error) {
	configured := s.scoringConfigured()
	if configured && !feedbackScreened(a) {
		var err error
		if a, err = s.awaitScreen(ctx, ts, repo, rel, hash, a); err != nil {
			return nil, err
		}
	}
	kind := keys.Kind(rel)
	lines := []string{}
	screen, rejection := a.Latest.Screen, a.Latest.Rejection
	switch {
	case screen != nil && screen.Verdict == "unscreened":
		lines = append(lines, "screen: unscreened (no scorer on the service)")
	case screen != nil && screen.Verdict == "pass":
		lines = append(lines, "screen: pass by "+screen.Scorer)
	case screen != nil && screen.Verdict != "":
		lines = append(lines, "screen: "+screen.Verdict)
	case rejection != nil && rejection.Stage == "screen":
		lines = append(lines, "screen: flagged: "+rejection.Reason, mcpFeedbackFix)
	default:
		lines = append(lines, "screen: awaiting screen")
		if rejection != nil && rejection.Stage != "" {
			lines = append(lines, fmt.Sprintf("rejection at %s: %s", rejection.Stage, rejection.Reason))
		}
	}
	switch feedbackScoring(configured, feedbackScreened(a), a.Latest.ReceivedAt, time.Now()) {
	case "off":
		lines = append(lines, "scoring: off; scoring is not configured on the service, and stored content is scored by an admin rescore once it is")
	case "pending":
		lines = append(lines, "scoring: pending; the screen has not run yet, so call again in a few seconds")
	default:
		lines = append(lines, "scoring: on")
	}
	if len(a.Latest.Scores) != 0 {
		rows, err := ts.t.LatestScores(ctx)
		values := map[string][]float64{}
		if err != nil {
			lines = append(lines, "baselines unavailable")
		} else {
			for _, row := range rows {
				if keys.Kind(row.Path) == kind {
					values[row.Check] = append(values[row.Check], row.Score)
				}
			}
		}
		baselines := map[string]struct {
			n           int
			p25, median float64
		}{}
		for check, scores := range values {
			sort.Float64s(scores)
			baselines[check] = struct {
				n           int
				p25, median float64
			}{len(scores), round3(percentile(scores, .25)), round3(percentile(scores, .5))}
		}
		for _, score := range a.Latest.Scores {
			b, ok := baselines[score.Check]
			if !ok {
				lines = append(lines, fmt.Sprintf("%s %.2f (no baseline)", score.Check, score.Score))
			} else if b.n < 4 {
				lines = append(lines, fmt.Sprintf("%s %.2f (baseline n=%d, too few to flag)", score.Check, score.Score, b.n))
			} else {
				tag := ""
				if score.Score < b.p25 {
					tag = " BELOW p25"
				}
				lines = append(lines, fmt.Sprintf("%s %.2f (baseline p25 %.2f, median %.2f, n %d)%s", score.Check, score.Score, b.p25, b.median, b.n, tag))
			}
		}
	}
	lines = append(lines, fmt.Sprintf("versions: %d", a.Versions))
	lines = append(lines, note...)
	return state("delivered", lines...), nil
}
