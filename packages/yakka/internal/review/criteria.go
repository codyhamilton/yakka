package review

import (
	"context"
	"path"
	"regexp"
	"strings"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// CriteriaRequest names one stored criteria reference, explicit text, or no
// criteria. RepoID is the captured repository identity and scopes every read.
type CriteriaRequest struct {
	RepoID          string
	Plan            string
	Phase           string
	BriefPath       string
	ContentHash     string
	CriteriaText    []string
	AllowSuperseded bool
}

// CriteriaRecord is the version identity recorded alongside a review.
type CriteriaRecord struct {
	Source      string `json:"source"`
	RepoID      string `json:"repo_id,omitempty"`
	Path        string `json:"path,omitempty"`
	ContentHash string `json:"content_hash,omitempty"`
	ScreenState string `json:"screen_state,omitempty"`
	Ignored     string `json:"ignored,omitempty"`
}

// CriteriaResolution is directly consumable by Build. CriteriaText is used
// for explicit text and the no-criteria marker; stored sources use Criteria.
type CriteriaResolution struct {
	Criteria     []Criterion
	CriteriaText string
	Record       CriteriaRecord
}

// CriteriaError is a safe refusal code suitable for a refused_criteria run.
type CriteriaError struct{ Code string }

func (e *CriteriaError) Error() string { return e.Code + ": criteria could not be resolved" }

func criteriaRefusal(code string) error { return &CriteriaError{Code: code} }

var phaseHeading = regexp.MustCompile(`^### Phase ([0-9]+) — .+$`)
var ledgerHeading = regexp.MustCompile(`^### Assumption ([0-9]+)$`)

// ResolveCriteria resolves one criteria source using only tenant's artifact
// ledger and content store. It performs no filesystem or git reads.
func ResolveCriteria(ctx context.Context, tenant *store.Tenant, req CriteriaRequest) (CriteriaResolution, error) {
	if tenant == nil {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	if (req.Plan != "" || req.Phase != "") && req.BriefPath != "" {
		return CriteriaResolution{}, criteriaRefusal("criteria_not_found")
	}
	if req.Plan != "" || req.Phase != "" {
		if req.Plan == "" || req.Phase == "" {
			return CriteriaResolution{}, criteriaRefusal("phase_not_found")
		}
		p, err := resolvePlan(ctx, tenant, req)
		if err != nil {
			return CriteriaResolution{}, err
		}
		if len(req.CriteriaText) > 0 {
			p.Record.Ignored = "criteria_text"
		}
		return p, nil
	}
	if req.BriefPath != "" {
		p, err := resolveBrief(ctx, tenant, req)
		if err == nil && len(req.CriteriaText) > 0 {
			p.Record.Ignored = "criteria_text"
		}
		return p, err
	}
	if len(req.CriteriaText) > 0 {
		text := strings.Join(req.CriteriaText, "\n")
		return CriteriaResolution{
			CriteriaText: text,
			Record:       CriteriaRecord{Source: "explicit", RepoID: req.RepoID, ContentHash: keys.ContentHash([]byte(text))},
		}, nil
	}
	return CriteriaResolution{CriteriaText: "criteria: none", Record: CriteriaRecord{Source: "none", RepoID: req.RepoID}}, nil
}

func resolvePlan(ctx context.Context, tenant *store.Tenant, req CriteriaRequest) (CriteriaResolution, error) {
	paths, err := tenant.PlanDesignPaths(ctx, req.RepoID, 1000)
	if err != nil {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	var matches []string
	for _, p := range paths {
		folder := path.Base(path.Dir(p))
		if folder == req.Plan || barePlanSlug(folder) == req.Plan {
			matches = append(matches, p)
		}
	}
	if len(matches) == 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_not_found")
	}
	if len(matches) > 1 {
		return CriteriaResolution{}, criteriaRefusal("criteria_ambiguous")
	}
	return resolveStored(ctx, tenant, req, matches[0], true)
}

func barePlanSlug(folder string) string {
	if len(folder) > 3 && folder[2] == '-' && folder[0] >= '0' && folder[0] <= '9' && folder[1] >= '0' && folder[1] <= '9' {
		return folder[3:]
	}
	return folder
}

func resolveBrief(ctx context.Context, tenant *store.Tenant, req CriteriaRequest) (CriteriaResolution, error) {
	p := path.Clean(strings.ReplaceAll(req.BriefPath, "\\", "/"))
	if p != req.BriefPath || strings.HasPrefix(p, "../") || p == ".." || keys.Kind(p) != "brief" || strings.HasPrefix(path.Base(p), "remediation-") {
		return CriteriaResolution{}, criteriaRefusal("criteria_not_found")
	}
	return resolveStored(ctx, tenant, req, p, false)
}

func resolveStored(ctx context.Context, tenant *store.Tenant, req CriteriaRequest, p string, design bool) (CriteriaResolution, error) {
	kind := keys.Kind(p)
	if (design && kind != "design") || (!design && kind != "brief") {
		return CriteriaResolution{}, criteriaRefusal("criteria_not_found")
	}
	versions, err := tenant.ArtifactVersions(ctx, req.RepoID, p)
	if err != nil {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	if len(versions) == 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_not_found")
	}
	newestEligible := -1
	for i := range versions {
		if versions[i].Rejection == nil {
			newestEligible = i
			break
		}
	}
	if newestEligible < 0 {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	selected := newestEligible
	if req.ContentHash != "" {
		selected = -1
		for i := range versions {
			if versions[i].ContentHash == req.ContentHash {
				selected = i
				break
			}
		}
		if selected < 0 {
			return CriteriaResolution{}, criteriaRefusal("criteria_version_unknown")
		}
		if versions[selected].Rejection != nil {
			return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
		}
		if selected != newestEligible && !req.AllowSuperseded {
			return CriteriaResolution{}, criteriaRefusal("criteria_stale")
		}
	}
	v := versions[selected]
	if v.Body == nil {
		return CriteriaResolution{}, criteriaRefusal("criteria_unavailable")
	}
	var criteria []Criterion
	if design {
		criteria, err = extractDesign(string(v.Body), req.Phase)
	} else {
		criteria, err = extractBrief(string(v.Body))
	}
	if err != nil {
		return CriteriaResolution{}, err
	}
	return CriteriaResolution{Criteria: criteria, Record: CriteriaRecord{
		Source: "store", RepoID: req.RepoID, Path: p, ContentHash: v.ContentHash, ScreenState: screenState(v),
	}}, nil
}

func screenState(v store.ArtifactVersion) string {
	if v.Rejection != nil {
		return "rejected"
	}
	if v.Screen != nil {
		return v.Screen.Verdict
	}
	if v.Pending {
		return "pending"
	}
	return "unscreened"
}

func extractBrief(content string) ([]Criterion, error) {
	sections := []struct{ heading, id string }{
		{"## Goal", "G1"}, {"## Contract", "C1"}, {"## Done evidence", "E1"},
	}
	var out []Criterion
	for _, s := range sections {
		body := markdownSection(content, s.heading, 2)
		if strings.TrimSpace(body) == "" {
			return nil, criteriaRefusal("criteria_unavailable")
		}
		out = append(out, Criterion{ID: s.id, Text: strings.TrimSpace(body)})
	}
	owned := ""
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "Owned paths:") {
			owned = strings.TrimSpace(strings.TrimPrefix(line, "Owned paths:"))
			break
		}
	}
	if owned == "" {
		return nil, criteriaRefusal("criteria_unavailable")
	}
	out = append(out, Criterion{ID: "A1", Text: owned})
	return out, nil
}

func extractDesign(content, phase string) ([]Criterion, error) {
	intent := markdownSection(content, "## Intent", 2)
	if strings.TrimSpace(intent) == "" {
		return nil, criteriaRefusal("criteria_unavailable")
	}
	phases := markdownSection(content, "## Phases", 2)
	lines := strings.Split(phases, "\n")
	var matching []int
	for i, line := range lines {
		m := phaseHeading.FindStringSubmatch(line)
		if len(m) == 2 && m[1] == phase {
			matching = append(matching, i)
		}
	}
	if len(matching) == 0 {
		return nil, criteriaRefusal("phase_not_found")
	}
	if len(matching) > 1 {
		return nil, criteriaRefusal("criteria_ambiguous")
	}
	start := matching[0]
	end := len(lines)
	for i := start + 1; i < len(lines); i++ {
		if phaseHeading.MatchString(lines[i]) {
			end = i
			break
		}
	}
	phaseBody := strings.Join(lines[start+1:end], "\n")
	outcome := markdownSection(phaseBody, "- Outcome:", 0)
	surfaces := markdownSection(phaseBody, "- Surfaces:", 0)
	if strings.TrimSpace(outcome) == "" || strings.TrimSpace(surfaces) == "" {
		return nil, criteriaRefusal("criteria_unavailable")
	}
	out := []Criterion{{ID: "I1", Text: strings.TrimSpace(intent)}, {ID: "O1", Text: strings.TrimSpace(outcome)}, {ID: "S1", Text: strings.TrimSpace(surfaces)}}
	ledger := markdownSection(content, "## Assumption Ledger", 2)
	ledgerLines := strings.Split(ledger, "\n")
	for i := 0; i < len(ledgerLines); i++ {
		m := ledgerHeading.FindStringSubmatch(ledgerLines[i])
		if len(m) != 2 {
			continue
		}
		j := i + 1
		for ; j < len(ledgerLines); j++ {
			if ledgerHeading.MatchString(ledgerLines[j]) || strings.HasPrefix(ledgerLines[j], "## ") {
				break
			}
		}
		out = append(out, Criterion{ID: "A" + m[1], Text: strings.TrimSpace(strings.Join(ledgerLines[i:j], "\n"))})
		i = j - 1
	}
	if len(out) == 3 {
		return nil, criteriaRefusal("criteria_unavailable")
	}
	return out, nil
}

// markdownSection extracts exact-heading content through the next heading of
// the same or shallower level. A level of zero extracts a labelled list item.
func markdownSection(content, heading string, level int) string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	for i, line := range lines {
		if line != heading && !(strings.HasPrefix(line, heading) && len(line) > len(heading) && line[len(heading)] == ' ') {
			continue
		}
		if level == 0 {
			body := strings.TrimSpace(strings.TrimPrefix(line, heading))
			var tail []string
			for j := i + 1; j < len(lines) && !strings.HasPrefix(lines[j], "- "); j++ {
				tail = append(tail, lines[j])
			}
			if body != "" && len(tail) > 0 {
				return body + "\n" + strings.TrimSpace(strings.Join(tail, "\n"))
			}
			return body
		}
		var body []string
		for j := i + 1; j < len(lines); j++ {
			if headingLevel(lines[j]) > 0 && headingLevel(lines[j]) <= level {
				break
			}
			body = append(body, lines[j])
		}
		return strings.TrimSpace(strings.Join(body, "\n"))
	}
	return ""
}

func headingLevel(s string) int {
	n := 0
	for n < len(s) && s[n] == '#' {
		n++
	}
	if n == 0 || n < len(s) && s[n] != ' ' {
		return 0
	}
	return n
}
