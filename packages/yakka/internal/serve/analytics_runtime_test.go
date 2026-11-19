package serve

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestAnalyticsDeadlineInterruptsReadAndReleasesReader(t *testing.T) {
	data := t.TempDir()
	s := New(Config{Data: data, Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(data, "a", "ledger.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	old := analyticsDeadline
	analyticsDeadline = 10 * time.Millisecond
	t.Cleanup(func() { analyticsDeadline = old })

	r := httptest.NewRequest("GET", "/v1/analytics/summary", nil)
	w := httptest.NewRecorder()
	serveBoundedAnalytics(w, r, "a", ts, func(w http.ResponseWriter, r *http.Request, _ string, _ *tenantState) {
		_, _ = w.Write([]byte("partial response must be discarded"))
		rows, err := db.QueryContext(r.Context(), `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var sum int64
				_ = rows.Scan(&sum)
			}
			err = rows.Err()
		}
		if err != nil {
			readFailed(w)
		}
	})
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("timeout body is not JSON: %q (%v)", w.Body.String(), err)
	}
	retry, _ := body["retry"].(map[string]any)
	if w.Code != 503 || body["code"] != "query_timeout" || body["error"] != "analytics query deadline exceeded" ||
		retry["after_s"] != float64(1) || retry["suggested_action"] != "narrow_window_or_coarsen_bucket" || len(body) != 3 {
		t.Fatalf("timeout response: %d %v", w.Code, body)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var one int
	if err := db.QueryRowContext(ctx, "SELECT 1").Scan(&one); err != nil || one != 1 {
		t.Fatalf("reader was not released after interrupt: %d %v", one, err)
	}
}

func TestAnalyticsHeavyReadConcurrencyReturnsBusy(t *testing.T) {
	_, ts := queryTenant(t)
	entered := make(chan struct{}, analyticsHeavyConcurrency)
	release := make(chan struct{})
	h := func(w http.ResponseWriter, _ *http.Request, _ string, _ *tenantState) {
		entered <- struct{}{}
		<-release
		writeJSON(w, 200, map[string]any{"ok": true})
	}
	var wg sync.WaitGroup
	for i := 0; i < analyticsHeavyConcurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			serveBoundedAnalytics(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/analytics/summary", nil), "a", ts, h)
		}()
	}
	for i := 0; i < analyticsHeavyConcurrency; i++ {
		<-entered
	}
	w := httptest.NewRecorder()
	serveBoundedAnalytics(w, httptest.NewRequest("GET", "/v1/analytics/summary", nil), "a", ts, h)
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	retry, _ := body["retry"].(map[string]any)
	if w.Code != 503 || body["code"] != "busy" || body["error"] != "analytics read concurrency limit reached" ||
		retry["after_s"] != float64(1) || w.Header().Get("Retry-After") != "1" {
		t.Fatalf("busy response: status=%d header=%q body=%v", w.Code, w.Header().Get("Retry-After"), body)
	}
	close(release)
	wg.Wait()
}
