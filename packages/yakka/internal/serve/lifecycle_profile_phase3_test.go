package serve

import (
	"net/http"
	"strings"
	"testing"
)

// TestLifecycleProfilePhase3Page serves the real embedded page through the
// placeholder-mode collector and asserts the Plan 30 S-lifecycle shell: the
// dense identity/nav/heading bands, the C1 tenant selector and deep link, the
// C10 Theme control, the owned-tenant table widths/order and the left-anchored
// confirmation dialog, while every lifecycle security string the older tests
// pin remains present.
func TestLifecycleProfilePhase3Page(t *testing.T) {
	rec := getLifecycleProfile(t, lifecycleProfileServer(t))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /profile/lifecycle = %d", rec.Code)
	}
	body := rec.Body.String()

	// V5: analytics then account nav, in the written order, as Pages anchors.
	analytics := []string{
		`href="https://yakka.build/">Start`,
		`https://yakka.build/b/pulse`,
		`https://yakka.build/b/trends`,
		`https://yakka.build/b/cost`,
		`https://yakka.build/b/quality`,
		`https://yakka.build/b/tools`,
		`https://yakka.build/b/workflow`,
		`https://yakka.build/b/compare`,
		`https://yakka.build/b/scatter`,
		`https://yakka.build/plans`,
		`https://yakka.build/sessions`,
		`https://yakka.build/ledger`,
		`https://yakka.build/ops`,
	}
	assertOrdered(t, body, analytics, "analytics nav")
	account := []string{
		`https://yakka.build/profile#tokens`,
		`https://yakka.build/profile#tenants`,
		`https://yakka.build/profile#membership`,
		`https://yakka.build/settings`,
		`https://yakka.build/device`,
	}
	assertOrdered(t, body, account, "account nav")

	for name, want := range map[string]string{
		"S-lifecycle heading":         "<h1>Tenant lifecycle</h1>",
		"identity row height":         "height:46px",
		"analytics nav row height":    "height:32px",
		"heading band height":         "height:32px",
		"body density":                "font:13px/1.35 system-ui,sans-serif",
		"h1 size":                     "h1{font-size:19px",
		"h2 size":                     "h2{font-size:14px",
		"gutter":                      "--gutter:12px",
		"table header Tenant name":    `<th scope="col">Tenant name</th>`,
		"table header Immutable ID":   `<th scope="col">Immutable ID</th>`,
		"table header Lifecycle":      `<th scope="col">Lifecycle state</th>`,
		"table header Generation":     `<th scope="col">Generation</th>`,
		"table header Actions":        `<th scope="col">Actions</th>`,
		"table caption":               "<caption>",
		"column 240":                  "width:240px",
		"column 260":                  "width:260px",
		"column 180":                  "width:180px",
		"column 100":                  "width:100px",
		"30px rows":                   "height:30px",
		"row tenant id":               "row.dataset.tenantId = tenant.id",
		"row highlight":               `row.dataset.selected = "true"`,
		"C1 select id":                `id="tenant-select"`,
		"C1 deep link read":           `URLSearchParams(location.search).get("tenant")`,
		"C1 replaceState":             "history.replaceState(null, \"\", url)",
		"C1 URL field":                `params.set("tenant", state.selected)`,
		"C1 option label separator":   " \\u00b7 ",
		"C1 disabled pending options": `option.disabled = lifecycle !== "active"`,
		"C1 explicit choice":          "Choose a tenant",
		"Reset action label":          `"Reset tenant"`,
		"Delete action label":         `"Delete tenant"`,
		"C10 Theme button":            `id="theme-toggle"`,
		"C10 stored theme key":        `"yakka-analytics-theme"`,
		"C10 data-theme toggle":       `document.documentElement.dataset.theme = next`,
		"return path label":           "Return to analytics",
		"return path pages origin":    `PAGES_ORIGIN = "https://yakka.build"`,
		"return path tenant query":    `PAGES_ORIGIN + "/?tenant="`,
		"left anchored dialog":        "inset:12px auto auto 12px",
		"dialog width":                "width:min(600px,calc(100vw - 24px))",
		"dialog fixed":                "position:fixed",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("lifecycle page missing %s (%q)", name, want)
		}
	}

	// Self-contained: no external stylesheet, script, font or image fetch.
	for _, forbidden := range []string{"<link", "<script src", "url(http", "@import", "<img"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("lifecycle page fetches an external resource via %q", forbidden)
		}
	}

	// The existing lifecycle security/recovery contract must remain intact.
	for name, want := range map[string]string{
		"human owner copy":      lifecycleProfileHumanCopy,
		"reset effect copy":     lifecycleProfileResetCopy,
		"delete effect copy":    lifecycleProfileDeleteCopy,
		"reset route":           "/v1/tenants/",
		"reset suffix":          "/reset",
		"UI header":             "X-Yakka-UI",
		"UI header value":       "tenant-lifecycle",
		"typed id input":        `id="typed-id"`,
		"confirmation field":    "confirm_tenant_id",
		"cookie credentials":    "credentials: 'include'",
		"api sign-in path":      `href="/oauth/login"`,
		"signed out state":      "signedOut",
		"unauthenticated state": "unauth",
		"recovery state":        "recoveryFailed",
		"completion unknown":    "completion unknown",
		"selection notice":      "selection-note",
		"same-origin channel":   "BroadcastChannel",
		"storage listener":      `addEventListener("storage"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("lifecycle page lost %s (%q)", name, want)
		}
	}

	if strings.Contains(body, "owned.some(function (tenant) { return tenant.id === wanted; })") {
		t.Fatal("lifecycle page substitutes another owned tenant when the requested id does not match")
	}
	if !strings.Contains(body, "refusedSelection") {
		t.Fatal("lifecycle page lost the refused-selection state")
	}

	lower := strings.ToLower(body)
	if strings.Contains(lower, "authorization") {
		t.Fatal("page must not construct an Authorization header")
	}
	if strings.Contains(lower, "bearer") {
		t.Fatal("page must not construct a bearer credential")
	}

	// V4 prohibitions: no decoration, motion, invented account controls or
	// analytics filter bar on this account screen.
	for _, forbidden := range []string{"box-shadow", "linear-gradient", "animation", "transition", "Invite", "Add member", "Change role", "scope-apply"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("lifecycle page must not contain %q", forbidden)
		}
	}

	// Destructive writes stay inside submitConfirmed and are never retried.
	script := body[strings.Index(body, "<script>"):]
	if strings.Contains(script, "setTimeout") || strings.Contains(script, "for (;;)") {
		t.Fatal("script contains a scheduling/loop construct that could replay a mutation")
	}
	submitIndex := strings.Index(body, "async function submitConfirmed()")
	loadIndex := strings.LastIndex(body, "loadMe();")
	if submitIndex < 0 || loadIndex < 0 || submitIndex > loadIndex {
		t.Fatal("unexpected lifecycle script layout")
	}
}

func assertOrdered(t *testing.T, body string, needles []string, label string) {
	t.Helper()
	last := -1
	for _, needle := range needles {
		at := strings.Index(body, needle)
		if at < 0 {
			t.Fatalf("%s missing %q", label, needle)
		}
		if at < last {
			t.Fatalf("%s out of order at %q", label, needle)
		}
		last = at
	}
}
