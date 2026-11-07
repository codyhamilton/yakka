package serve

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const builtIndex = "<html>built app</html>"

func placeholderFS() fstest.MapFS {
	return fstest.MapFS{"index.html": {Data: []byte("<p>yakka-analytics-placeholder</p>")}}
}

func builtFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                       {Data: []byte(builtIndex)},
		"vendor/uplot-1.6.32/uPlot.esm.js": {Data: []byte("export {}")},
		"js/app.js":                        {Data: []byte("import './core.js'")},
		"js/version.json":                  {Data: []byte(`{"version":"1"}`)},
		"p.wasm":                           {Data: []byte("\x00asm")},
	}
}

// siteServer builds a Server whose site handler reads fsys; local mode unless keyed.
func siteServer(t *testing.T, fsys fstest.MapFS, keyed bool) http.Handler {
	t.Helper()
	old := siteFS
	siteFS = fsys
	t.Cleanup(func() { siteFS = old })
	cfg := Config{Data: t.TempDir()}
	if keyed {
		cfg.Keys = []KeyPair{{"a", "ka"}}
	}
	s := New(cfg, Options{DisableWorker: true, PollInterval: 50 * time.Millisecond})
	t.Cleanup(func() { s.Close() })
	return s.Handler()
}

func siteReq(h http.Handler, method, path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:8770"+path, nil)
	r.Header.Set("Content-Type", "application/json") // localGuard refuses other POSTs with 415 before the site sees them
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func wantJSON(t *testing.T, w *httptest.ResponseRecorder, code int, body string) {
	t.Helper()
	if w.Code != code || w.Header().Get("Content-Type") != "application/json" || strings.TrimSpace(w.Body.String()) != body {
		t.Fatalf("got %d %q %q, want %d application/json %s", w.Code, w.Header().Get("Content-Type"), w.Body.String(), code, body)
	}
}

func TestSitePlaceholderMode(t *testing.T) {
	h := siteServer(t, placeholderFS(), false)
	for _, p := range []string{"/", "/quality"} {
		wantJSON(t, siteReq(h, "GET", p), 404, `{"error":"analytics bundle not embedded"}`)
	}
	wantJSON(t, siteReq(h, "GET", "/v1/not-a-route"), 404, `{"error":"not found"}`)
	if w := siteReq(h, "GET", "/v1/health"); w.Code != 200 || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("health: %d %q", w.Code, w.Header().Get("Content-Type"))
	}
}

func TestSiteMissingIndexIsNotEmbedded(t *testing.T) {
	h := siteServer(t, fstest.MapFS{}, false)
	wantJSON(t, siteReq(h, "GET", "/"), 404, `{"error":"analytics bundle not embedded"}`)
}

func TestSiteEmbeddedPlaceholder(t *testing.T) {
	s, _ := newServer(t, true)
	h := s.Handler()
	for _, p := range []string{"/", "/quality"} {
		wantJSON(t, siteReq(h, "GET", p), 404, `{"error":"analytics bundle not embedded"}`)
	}
	wantJSON(t, siteReq(h, "GET", "/v1/not-a-route"), 404, `{"error":"not found"}`)
	if w := siteReq(h, "GET", "/v1/health"); w.Code != 200 {
		t.Fatalf("health: %d", w.Code)
	}
}

func TestSiteBuiltMode(t *testing.T) {
	for _, keyed := range []bool{false, true} {
		h := siteServer(t, builtFS(), keyed)
		for _, p := range []string{"/", "/index.html", "/quality", "/quality/", "/device", "/vendor", "/vendor/uplot-1.6.32/"} {
			w := siteReq(h, "GET", p)
			if w.Code != 200 || w.Body.String() != builtIndex || w.Header().Get("Content-Type") != "text/html; charset=utf-8" || w.Header().Get("Cache-Control") != "no-cache" {
				t.Fatalf("%s: %d %q %q %q", p, w.Code, w.Body.String(), w.Header().Get("Content-Type"), w.Header().Get("Cache-Control"))
			}
			assertSiteSecurityHeaders(t, w.Header())
		}
		w := siteReq(h, "GET", "/vendor/uplot-1.6.32/uPlot.esm.js")
		if ct := w.Header().Get("Content-Type"); w.Code != 200 || !strings.Contains(ct, "javascript") || w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
			t.Fatalf("js: %d %q %q", w.Code, ct, w.Header().Get("Cache-Control"))
		}
		assertSiteSecurityHeaders(t, w.Header())
		w = siteReq(h, "GET", "/js/version.json")
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("ETag") == "" || w.Body.String() != `{"version":"1"}` {
			t.Fatalf("version: %d %q %q", w.Code, w.Header().Get("Cache-Control"), w.Header().Get("ETag"))
		}
		assertSiteSecurityHeaders(t, w.Header())
		revalidated := httptest.NewRequest("GET", "http://127.0.0.1:8770/js/version.json", nil)
		revalidated.Header.Set("If-None-Match", w.Header().Get("ETag"))
		revalidatedW := httptest.NewRecorder()
		h.ServeHTTP(revalidatedW, revalidated)
		if revalidatedW.Code != http.StatusNotModified || revalidatedW.Body.Len() != 0 || revalidatedW.Header().Get("ETag") != w.Header().Get("ETag") {
			t.Fatalf("ETag revalidation: %d %q %q", revalidatedW.Code, revalidatedW.Header().Get("ETag"), revalidatedW.Body.String())
		}
		if w = siteReq(h, "GET", "/p.wasm"); w.Header().Get("Content-Type") != "application/wasm" || w.Code != 200 {
			t.Fatalf("wasm: %d %q", w.Code, w.Header().Get("Content-Type"))
		}
		wantJSON(t, siteReq(h, "GET", "/v1/not-a-route"), 404, `{"error":"not found"}`)
		wantJSON(t, siteReq(h, "GET", "/v1"), 404, `{"error":"not found"}`)
		w = siteReq(h, "POST", "/")
		wantJSON(t, w, 405, `{"error":"method not allowed"}`)
		if w.Header().Get("Allow") != "GET, HEAD" {
			t.Fatalf("Allow = %q", w.Header().Get("Allow"))
		}
		if w = siteReq(h, "HEAD", "/"); w.Code != 200 || w.Body.Len() != 0 {
			t.Fatalf("HEAD: %d %q", w.Code, w.Body.String())
		}
	}
}

func TestSiteHandlerDirectCallbackFallback(t *testing.T) {
	w := siteReq(siteHandler(builtFS()), "GET", "/oauth/callback")
	if w.Code != http.StatusOK || w.Body.String() != builtIndex || w.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("callback fallback: %d %q %q", w.Code, w.Body.String(), w.Header().Get("Cache-Control"))
	}
}

func assertSiteSecurityHeaders(t *testing.T, got http.Header) {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../yakka-analytics/web/_headers"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if key, value, found := strings.Cut(line, ":"); found {
			want[http.CanonicalHeaderKey(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
	}
	for _, key := range []string{"Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"} {
		if got.Get(key) != want[key] {
			t.Errorf("%s = %q, web/_headers has %q", key, got.Get(key), want[key])
		}
	}
}

func TestSiteLocalGuardStillWraps(t *testing.T) {
	h := siteServer(t, builtFS(), false)
	r := httptest.NewRequest("GET", "http://evil.example/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("non-loopback host: %d", w.Code)
	}
}
