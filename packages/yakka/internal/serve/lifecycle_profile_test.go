package serve

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	lifecycleProfileHumanCopy  = "Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf."
	lifecycleProfileResetCopy  = "Erase all tenant data and revoke its keys. Keep this tenant and your ownership; issue a new key to reuse it."
	lifecycleProfileDeleteCopy = "Permanently remove this tenant, all its data and keys, and your ownership link."
)

// lifecycleProfileServer serves the embedded page with the committed
// placeholder siteFS, i.e. the production collector image that has no
// analytics bundle.
func lifecycleProfileServer(t *testing.T) http.Handler {
	t.Helper()
	gh := mockGitHub(t, 61, "owner", nil)
	t.Cleanup(gh.Close)
	old := siteFS
	siteFS = placeholderFS()
	t.Cleanup(func() { siteFS = old })
	return remoteTestConfig(t, t.TempDir(), gh.URL).Handler()
}

func getLifecycleProfile(t *testing.T, h http.Handler) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "https://collector.example/profile/lifecycle", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLifecycleProfileServedInPlaceholderMode(t *testing.T) {
	h := lifecycleProfileServer(t)
	rec := getLifecycleProfile(t, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /profile/lifecycle = %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("content-type = %q", ct)
	}
	body := rec.Body.String()
	if strings.Contains(body, "analytics bundle not embedded") {
		t.Fatal("lifecycle view fell through to the placeholder site handler")
	}

	for name, want := range map[string]string{
		"mandatory human-owner sentence": lifecycleProfileHumanCopy,
		"reset confirmation copy":        lifecycleProfileResetCopy,
		"delete confirmation copy":       lifecycleProfileDeleteCopy,
		"reset route":                    "/v1/tenants/",
		"reset suffix":                   "/reset",
		"ui header":                      "X-Yakka-UI",
		"ui header value":                "tenant-lifecycle",
		"typed-id input":                 `id="typed-id"`,
		"confirmation field":             "confirm_tenant_id",
		"same-origin cookie credentials": "credentials: 'include'",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("lifecycle view missing %s (%q)", name, want)
		}
	}

	// The committed placeholder must remain a placeholder for other site paths.
	other := httptest.NewRequest(http.MethodGet, "https://collector.example/quality", nil)
	otherRec := httptest.NewRecorder()
	h.ServeHTTP(otherRec, other)
	if otherRec.Code != http.StatusNotFound || !strings.Contains(otherRec.Body.String(), "analytics bundle not embedded") {
		t.Fatalf("placeholder site fallback changed: %d %q", otherRec.Code, otherRec.Body.String())
	}
}

func TestLifecycleProfileUnauthenticatedAndRecoveryStates(t *testing.T) {
	body := getLifecycleProfile(t, lifecycleProfileServer(t)).Body.String()

	// Unauthenticated access is served the page, which links to the API-origin
	// sign-in route and only reads /v1/me on load.
	if !strings.Contains(body, `href="/oauth/login"`) {
		t.Fatal("lifecycle view has no API-origin sign-in path")
	}
	if !strings.Contains(body, "signedOut") || !strings.Contains(body, "unauth") {
		t.Fatal("lifecycle view has no unauthenticated state")
	}
	// A failed /me read surfaces completion unknown and disables actions.
	if !strings.Contains(body, "completion unknown") {
		t.Fatal("lifecycle view has no completion-unknown state")
	}
	if !strings.Contains(body, "recoveryFailed") || !strings.Contains(body, "disabled") {
		t.Fatal("lifecycle view does not disable actions while recovery is unresolved")
	}
	// Nothing destructive runs on load: the page only calls /v1/me before any
	// confirmation, and the destructive fetches live inside submitConfirmed.
	loadIndex := strings.LastIndex(body, "loadMe();")
	submitIndex := strings.Index(body, "async function submitConfirmed()")
	if loadIndex < 0 || submitIndex < 0 || submitIndex > loadIndex {
		t.Fatal("unexpected lifecycle script layout")
	}
	if strings.Contains(body[:submitIndex], `method: "DELETE"`) || strings.Contains(body[:submitIndex], `method: "POST"`) {
		t.Fatal("lifecycle view issues a lifecycle request before confirmation")
	}
}

func TestLifecycleProfileScriptContract(t *testing.T) {
	body := getLifecycleProfile(t, lifecycleProfileServer(t)).Body.String()
	script := body[strings.Index(body, "<script>"):]

	for name, want := range map[string]string{
		"same-origin invalidation channel": "BroadcastChannel",
		"same-origin storage event":        `addEventListener("storage"`,
		"explicit re-selection notice":     "selection-note",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("script missing %s (%q)", name, want)
		}
	}

	// Ambiguous failures must never replay the destructive call automatically.
	if strings.Contains(script, "setTimeout") || strings.Contains(script, "for (;;)") {
		t.Fatal("script contains a scheduling/loop construct that could replay a mutation")
	}
	if !strings.Contains(script, "ambiguousFailure") {
		t.Fatal("script has no ambiguous-failure handling")
	}

	lower := strings.ToLower(body)
	if strings.Contains(lower, "authorization") {
		t.Fatal("page must not construct an Authorization header")
	}
	if strings.Contains(lower, "bearer") {
		t.Fatal("page must not construct a bearer credential")
	}
}
