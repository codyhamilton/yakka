package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestReviewUsageIsIsolatedFromFactsAndAggregates(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	rows := []ReviewUsageRow{
		{UsageID: "u1", TS: 10, Raw: []byte(`{"usage_id":"u1","cost_usd":0.25,"status":"ok"}`)},
		{UsageID: "u2", TS: 20, Raw: []byte(`{"usage_id":"u2","cost_usd":0.5,"status":"timeout"}`)},
	}
	ins, err := tn.AppendReviewUsage(ctx, rows)
	if err != nil || len(ins) != 2 || !ins[0] || !ins[1] {
		t.Fatalf("inserted=%v err=%v", ins, err)
	}
	again, err := tn.AppendReviewUsage(ctx, []ReviewUsageRow{{UsageID: "u1", TS: 30, Raw: rows[0].Raw}})
	if err != nil || len(again) != 1 || again[0] {
		t.Fatalf("same usage id was not ignored: %v err=%v", again, err)
	}
	if _, err := tn.AppendReviewUsage(ctx, []ReviewUsageRow{{TS: 1, Raw: []byte(`{}`)}}); err == nil {
		t.Fatal("accepted review_usage without an id")
	}
	got, err := tn.ReviewUsageRecords(ctx)
	if err != nil || len(got) != 2 {
		t.Fatalf("records=%d err=%v", len(got), err)
	}
	if got[0].UsageID != "u2" || got[1].UsageID != "u1" {
		t.Fatalf("order=%s,%s", got[0].UsageID, got[1].UsageID)
	}
	var raw map[string]any
	if err := json.Unmarshal(got[0].Raw, &raw); err != nil || raw["status"] != "timeout" {
		t.Fatalf("raw=%s err=%v", got[0].Raw, err)
	}
	spend, err := tn.ReviewSpend(ctx)
	if err != nil || spend != 0.75 {
		t.Fatalf("spend=%v err=%v", spend, err)
	}
	window := AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(30, 0)}
	summary, err := tn.Summary(ctx, window)
	if err != nil || summary.Conversations != 0 || summary.HookEvents != 0 || summary.ArtifactVersions != 0 || summary.Commits != 0 {
		t.Fatalf("review_usage altered summary: %+v err=%v", summary, err)
	}
	facets, err := tn.Facets(ctx, window)
	if err != nil || len(facets.Repos)+len(facets.Harnesses)+len(facets.Kinds)+len(facets.Plans)+len(facets.Events) != 0 {
		t.Fatalf("review_usage altered facets: %+v err=%v", facets, err)
	}
	if reviews, err := tn.ReviewRecords(ctx, ReviewRecordFilter{Limit: 10}); err != nil || len(reviews) != 0 {
		t.Fatalf("review_usage entered review_runs: %d err=%v", len(reviews), err)
	}
}
