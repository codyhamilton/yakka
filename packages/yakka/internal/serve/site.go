package serve

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
)

// The site build output is copied into site/ before go build. The committed placeholder
// index.html carries siteMarker, which keeps the handler in "not embedded" mode.
//
//go:embed all:site
var siteEmbed embed.FS

const siteMarker = "yakka-analytics-placeholder"

const (
	siteCSP          = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
	siteFrameOptions = "DENY"
)

var versionedVendorPath = regexp.MustCompile(`^vendor/[^/]+-[0-9]+(?:\.[0-9]+)*(?:[-+][A-Za-z0-9.-]+)?/`)

// siteFS is the site root. Tests replace it with an fstest.MapFS.
var siteFS fs.FS = func() fs.FS {
	sub, err := fs.Sub(siteEmbed, "site")
	if err != nil {
		panic(err)
	}
	return sub
}()

// siteHandler serves the analytics site from fsys. The mode is decided once, here.
// Paths under /v1 are never served as HTML.
func siteHandler(fsys fs.FS) http.HandlerFunc {
	index, err := fs.ReadFile(fsys, "index.html")
	embedded := err == nil && !bytes.Contains(index, []byte(siteMarker))
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1" || strings.HasPrefix(r.URL.Path, "/v1/") {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		if !embedded {
			writeJSON(w, 404, map[string]string{"error": "analytics bundle not embedded"})
			return
		}
		setSiteSecurityHeaders(w.Header())
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeJSON(w, 405, map[string]string{"error": "method not allowed"})
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if fi, err := fs.Stat(fsys, name); err == nil && fi.Mode().IsRegular() {
				if data, err := fs.ReadFile(fsys, name); err == nil {
					if versionedVendorPath.MatchString(name) {
						w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
					} else {
						etag := fmt.Sprintf(`"%x"`, sha256.Sum256(data))
						w.Header().Set("Cache-Control", "no-cache")
						w.Header().Set("ETag", etag)
						if etagMatches(r.Header.Get("If-None-Match"), etag) {
							w.WriteHeader(http.StatusNotModified)
							return
						}
					}
					http.ServeContent(w, r, name, fi.ModTime(), bytes.NewReader(data))
					return
				}
			}
		}
		h := w.Header()
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
	}
}

func setSiteSecurityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", siteCSP)
	h.Set("X-Frame-Options", siteFrameOptions)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
}

func etagMatches(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}
