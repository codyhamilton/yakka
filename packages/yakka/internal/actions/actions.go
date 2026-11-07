// Package actions defines the server's session action contract.
package actions

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var kinds = map[string]bool{"design": true, "refine": true, "build": true, "review": true, "fix": true, "close-out": true, "sync": true, "escalation": true, "triage": true, "research": true}
var ownerRepo = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$`)
var planID = regexp.MustCompile(`^([a-z0-9][a-z0-9._-]*)/([a-z0-9][a-z0-9._-]*):plan/([a-z0-9][a-z0-9._-]{0,99})$`)
var githubID = regexp.MustCompile(`^([a-z0-9][a-z0-9._-]*)/([a-z0-9][a-z0-9._-]*)#([0-9]+)$`)

type Values struct {
	Kind        string `json:"kind"`
	SubjectType string `json:"subject_type"`
	SubjectID   string `json:"subject_id"`
	Phase       string `json:"phase,omitempty"`
	Repo        string `json:"repo,omitempty"`
	PR          string `json:"pr,omitempty"`
}
type Result struct {
	Values  Values
	Reasons []string
}

// Validate trims and lowercases the contract values, retaining every applicable reason.
func Validate(v Values) Result {
	v.Kind = strings.ToLower(strings.TrimSpace(v.Kind))
	v.SubjectType = strings.ToLower(strings.TrimSpace(v.SubjectType))
	v.SubjectID = strings.ToLower(strings.TrimSpace(v.SubjectID))
	v.Phase = strings.TrimSpace(v.Phase)
	v.Repo = strings.ToLower(strings.TrimSpace(v.Repo))
	v.PR = strings.TrimSpace(v.PR)
	r := Result{Values: v}
	add := func(s string) { r.Reasons = append(r.Reasons, s) }
	for _, x := range []struct{ name, value string }{{"kind", v.Kind}, {"subject_type", v.SubjectType}, {"subject_id", v.SubjectID}} {
		if x.value == "" {
			add("missing_required:" + x.name)
		}
	}
	for _, x := range []string{v.Kind, v.SubjectType, v.SubjectID, v.Phase, v.Repo, v.PR} {
		if len(x) > 256 {
			add("too_long")
			break
		}
	}
	if v.Kind != "" && !kinds[v.Kind] {
		add("unknown_kind")
	}
	if v.SubjectType != "" && v.SubjectType != "plan" && v.SubjectType != "github" {
		add("unknown_subject_type")
	}
	p, g := planID.MatchString(v.SubjectID), githubID.MatchString(v.SubjectID)
	if m := githubID.FindStringSubmatch(v.SubjectID); len(m) == 4 {
		n, err := strconv.Atoi(m[3])
		if err != nil || n < 1 {
			g = false
		} else {
			v.SubjectID = m[1] + "/" + m[2] + "#" + strconv.Itoa(n)
		}
	}
	if v.SubjectID != "" && !p && !g {
		add("bad_subject_id")
	} else if (v.SubjectType == "plan" && g) || (v.SubjectType == "github" && p) {
		add("subject_type_mismatch")
	}
	if v.Phase != "" {
		n, e := strconv.Atoi(v.Phase)
		if e != nil || n < 1 || n > 99 {
			add("bad_phase")
		} else {
			v.Phase = strconv.Itoa(n)
		}
	}
	if v.Repo != "" && !ownerRepo.MatchString(v.Repo) {
		add("bad_repo")
	}
	if v.PR != "" {
		n, e := strconv.Atoi(v.PR)
		if e != nil || n < 1 {
			add("bad_pr")
		} else {
			v.PR = strconv.Itoa(n)
		}
	}
	r.Values = v
	sort.Strings(r.Reasons)
	return r
}

func (v Values) String() string { return fmt.Sprintf("%s %s %s", v.Kind, v.SubjectType, v.SubjectID) }
