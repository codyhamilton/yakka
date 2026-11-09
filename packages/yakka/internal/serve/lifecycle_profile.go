package serve

import (
	_ "embed"
	"net/http"
)

// lifecycleProfilePage is the bounded, self-contained profile lifecycle view.
// It is served from the API origin so it works on the production collector even
// when the analytics site bundle is not embedded (site/index.html is still the
// placeholder). It shares no build step with the analytics package.
//
//go:embed lifecycle_profile.html
var lifecycleProfilePage []byte

// handleLifecycleProfile serves the same-origin lifecycle view. Sign-in and
// ownership are enforced by /v1/me and the lifecycle routes; this static page
// only displays observed state and never issues a mutation on load.
func (s *Server) handleLifecycleProfile(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	// The page can reset or delete a tenant with the caller's cookie. Do not
	// let another origin frame it and steer that confirmation.
	h.Set("Content-Security-Policy", "frame-ancestors 'none'")
	h.Set("X-Frame-Options", "DENY")
	_, _ = w.Write(lifecycleProfilePage)
}
