package actions

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestContractFixtures(t *testing.T) {
	b, err := os.ReadFile("testdata/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Input      Values   `json:"input"`
		Status     string   `json:"status"`
		Reasons    []string `json:"reasons"`
		Normalised Values   `json:"normalised"`
	}
	if err = json.Unmarshal(b, &rows); err != nil {
		t.Fatal(err)
	}
	for i, row := range rows {
		got := Validate(row.Input)
		wantStatus := "accepted"
		if len(got.Reasons) > 0 {
			wantStatus = "rejected"
		}
		if wantStatus != row.Status || !reflect.DeepEqual(got.Reasons, row.Reasons) {
			t.Errorf("fixture %d: status=%s reasons=%v", i, wantStatus, got.Reasons)
		}
		if row.Status == "accepted" && got.Values != row.Normalised {
			t.Errorf("fixture %d: got %#v want %#v", i, got.Values, row.Normalised)
		}
	}
}

func TestLengthAndIntegerNormalisation(t *testing.T) {
	long := strings.Repeat("x", 300)
	got := Validate(Values{Kind: "build", SubjectType: "plan", SubjectID: long})
	hasTooLong := false
	for _, r := range got.Reasons {
		if r == "too_long" {
			hasTooLong = true
		}
	}
	if !hasTooLong {
		t.Fatalf("300-byte value was not rejected as too_long: %#v", got)
	}
	got = Validate(Values{Kind: "fix", SubjectType: "github", SubjectID: "Owner/Repo#0005", PR: "0007"})
	if len(got.Reasons) != 0 || got.Values.SubjectID != "owner/repo#5" || got.Values.PR != "7" {
		t.Fatalf("integer string normalization: %#v", got)
	}
}
