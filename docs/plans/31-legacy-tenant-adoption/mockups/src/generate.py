#!/usr/bin/env python3
"""Generate the Plan 31 static mockups.

Method (same as Plan 30): static HTML/CSS, real theme tokens, synthetic sample data.
- The real shell/account/chart CSS is copied VERBATIM from packages/yakka-analytics/web/css/
  into src/css/ on every run, so the tokens can never drift from the product.
- The header markup is extracted VERBATIM from packages/yakka-analytics/web/index.html.
- The lifecycle page <style> block is extracted VERBATIM from
  packages/yakka/internal/serve/lifecycle_profile.html.
All data is synthetic except the shape: one tenant with immutable id `default` named `default`
holding a large ledger (11,024 sessions). Nothing here calls an API.

Run from anywhere:  python3 generate.py   then   node capture.mjs
"""
import html
import pathlib
import re
import shutil

SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parents[4]
WEB = ROOT / "packages/yakka-analytics/web"
LIFECYCLE = ROOT / "packages/yakka/internal/serve/lifecycle_profile.html"

CSS_FILES = ["app.css", "workspace.css", "scope-controls.css", "charts.css", "account.css"]

esc = html.escape

# --- copy real CSS verbatim ---------------------------------------------------
(SRC / "css").mkdir(exist_ok=True)
for name in CSS_FILES:
    shutil.copyfile(WEB / "css" / name, SRC / "css" / name)

# --- real header markup -------------------------------------------------------
index = (WEB / "index.html").read_text()
header_tpl = re.search(r'<header class="top">.*?</header>', index, re.S).group(0)


def header(options, selected, nav_current, account_current=None, note=None):
    """options: list of (id, label, disabled)."""
    opts = "".join(
        f'<option value="{esc(i)}"{" selected" if i == selected else ""}{" disabled" if dis else ""}>{esc(lbl)}</option>'
        for i, lbl, dis in options
    )
    h = header_tpl.replace(
        '<select id="tenant-select" class="tenant-select" aria-label="Tenant"></select>',
        f'<select id="tenant-select" class="tenant-select" aria-label="Tenant">{opts}</select>',
    )
    h = h.replace(
        '<button id="theme-toggle" type="button">Theme</button>',
        '<button id="theme-toggle" type="button">Theme</button>'
        '<span class="mock-reference">DESIGN REFERENCE · Plan 31 · synthetic data</span>',
    )
    for href in ("/b/pulse", "/profile#tenants"):
        pass
    if nav_current:
        h = h.replace(f'<a href="{nav_current}">', f'<a href="{nav_current}" aria-current="page">', 1)
    if account_current:
        h = h.replace(f'<a href="{account_current}">', f'<a href="{account_current}" aria-current="page">', 1)
    return h


OPTIONS = [
    ("default", "default · default", False),
    ("t-4f2a91c07b3d", "Scratch · t-4f2a91c07b3d", False),
    ("t-81c3e2d9a0b4", "Old build · t-81c3e2d9a0b4 · resetting", True),
]

LISTBOX = """
<div class="mock-listbox" role="listbox" aria-label="Tenant options (expanded for the mockup)">
  <div class="mock-opt selected" role="option" aria-selected="true">default · default</div>
  <div class="mock-opt" role="option">Scratch · t-4f2a91c07b3d</div>
  <div class="mock-opt disabled" role="option" aria-disabled="true">Old build · t-81c3e2d9a0b4 · resetting</div>
</div>
"""

SESSIONS = [
    ("ses_9f3c21a0", "codyhamilton/yakka", "claude-code", "22 Nov 2026 2:51 PM", "412", "design"),
    ("ses_9f3b77d4", "codyhamilton/yakka", "claude-code", "22 Nov 2026 1:02 PM", "1,806", "execute"),
    ("ses_9f3a10c9", "codyhamilton/yakka", "cursor", "22 Nov 2026 11:40 AM", "233", "review"),
    ("ses_9f38e2b1", "codyhamilton/yakka", "claude-code", "21 Nov 2026 8:19 PM", "977", "design"),
    ("ses_9f37a55e", "codyhamilton/ctzns-web", "claude-code", "21 Nov 2026 4:07 PM", "541", "execute"),
    ("ses_9f3622f0", "codyhamilton/yakka", "opencode", "21 Nov 2026 9:33 AM", "88", "refine"),
    ("ses_9f3511aa", "codyhamilton/yakka", "claude-code", "20 Nov 2026 6:45 PM", "1,204", "execute"),
    ("ses_9f34c0de", "codyhamilton/ctzns-web", "claude-code", "20 Nov 2026 2:12 PM", "366", "review"),
    ("ses_9f33f1b7", "codyhamilton/yakka", "claude-code", "19 Nov 2026 10:58 AM", "719", "design"),
    ("ses_9f3299c3", "codyhamilton/yakka", "cursor", "18 Nov 2026 3:30 PM", "152", "execute"),
]


def sessions_table():
    rows = "".join(
        f"<tr><td>{esc(a)}</td><td>{esc(b)}</td><td>{esc(c)}</td><td>{esc(d)}</td><td class=num>{esc(e)}</td><td>{esc(f)}</td></tr>"
        for a, b, c, d, e, f in SESSIONS
    )
    return (
        '<table class="mock-table"><thead><tr><th>Session</th><th>Repository</th><th>Harness</th>'
        "<th>Started (Australia/Brisbane)</th><th>Events</th><th>Stage</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )


HEAD = """<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="css/app.css">
<link rel="stylesheet" href="css/workspace.css">
<link rel="stylesheet" href="css/scope-controls.css">
<link rel="stylesheet" href="css/charts.css">
<link rel="stylesheet" href="css/account.css">
<link rel="stylesheet" href="mock.css">
</head>
<body>
"""


def page_selector():
    return (
        HEAD.format(title="Plan 31 · tenant selector · default selectable")
        + header(OPTIONS, "default", "/b/pulse")
        + LISTBOX
        + """
<main id="app" data-state="ready">
<h1>Sessions</h1>
<p class="mock-population">Tenant <strong>default</strong> (id <code>default</code>): 11,024 sessions retained · hook events 21 Jan 2026 4:28 PM to 22 Nov 2026 2:54 PM (Australia/Brisbane). This tenant has no lifecycle marker yet and is selectable.</p>
<p class="mock-note">The list above is the native tenant select, drawn open. <strong>default · default</strong> is chosen and enabled with no state suffix. <strong>Old build</strong> is greyed because its reset is in progress.</p>
"""
        + sessions_table()
        + """
</main>
<footer><span id="schema-status">Server capabilities checked.</span><span id="request-status">0 requests in flight</span></footer>
</body></html>
"""
    )


def page_profile():
    def row(name, tid, state, state_cls, gen, use_disabled, use_title=""):
        dis = ' disabled title="%s"' % esc(use_title) if use_disabled else ""
        return (
            f'<tr><td title="{esc(name)}">{esc(name)}</td><td title="{esc(tid)}">{esc(tid)}</td><td>Owner</td>'
            f'<td class="account-state account-state-{state_cls}">{esc(state)}</td><td>{esc(gen)}</td>'
            f'<td class="account-actions"><button type="button"{dis}>Use tenant</button> '
            f'<a class="account-lifecycle-link" href="#">Reset or delete… (API owner page)</a></td></tr>'
        )

    rows = (
        row("default", "default", "Active", "active", "—", False)
        + row("Scratch", "t-4f2a91c07b3d", "Active", "active", "3f9a0c1d7e22b4a65c80d1e9f2a7b304", False)
        + row("Old build", "t-81c3e2d9a0b4", "Resetting", "resetting", "c71e5a90d2b84f3361a0e8b9d4c2f517", True, "Reset in progress")
    )
    return (
        HEAD.format(title="Plan 31 · profile tenants")
        + header(OPTIONS, "default", None, "/profile#tenants")
        + """
<main id="app" data-state="ready">
<h1>Profile</h1>
<div class="account-console">
<section class="account-section" id="tenants">
<h2>Tenants &amp; membership</h2>
<p class="account-note">Memberships below are tenants you own.</p>
<form class="account-form account-tenant-form"><label>New tenant <input type="text" maxlength="64"></label> <button type="button">Create tenant</button></form>
<div class="account-table-wrap"><table class="account-table account-tenants-table"><caption class="account-sr-only">Tenants &amp; membership</caption>
<thead><tr><th class="account-col-1">Name</th><th class="account-col-2">Immutable ID</th><th class="account-col-3">Your access</th><th class="account-col-4">Lifecycle state</th><th class="account-col-5">Generation</th><th class="account-col-6">Actions</th></tr></thead>
<tbody>"""
        + rows
        + """</tbody></table></div>
<p class="mock-note">Before the migration runs, <strong>default</strong> shows state <strong>Active</strong> and generation <strong>—</strong> and <strong>Use tenant</strong> works. After the migration it shows a generation like the rows below it. Only a tenant that is mid-reset or mid-delete has <strong>Use tenant</strong> disabled.</p>
</section>
<section class="account-section" id="tokens">
<h2>Tokens — selected tenant</h2>
<p class="account-note">A newly issued token appears once; existing token secrets are never listed.</p>
<p class="account-token-tenant">Selected tenant: default · default</p>
</section>
</div>
</main>
<footer><span id="schema-status">Server capabilities checked.</span><span id="request-status">0 requests in flight</span></footer>
</body></html>
"""
    )


def page_lifecycle():
    src = LIFECYCLE.read_text()
    style = re.search(r"<style>.*?</style>", src, re.S).group(0)
    return (
        """<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan 31 · tenant lifecycle confirm · default</title>
"""
        + style
        + """
<link rel="stylesheet" href="mock.css">
</head>
<body>
<header class="top">
<div class="identity-row">
<a class="brand" href="#">Yakka <span>Analytics</span></a>
<label class="tenant-field">Tenant <select id="tenant-select" class="tenant-select" aria-label="Tenant"><option selected>default · default</option><option>Scratch · t-4f2a91c07b3d</option></select></label>
<button id="theme-toggle" type="button">Theme</button><span class="mock-reference">DESIGN REFERENCE · Plan 31 · synthetic data</span>
<a id="return-link" class="return-link" href="#">Return to analytics</a>
</div>
</header>
<main>
<div class="page-title"><h1>Tenant lifecycle</h1></div>
<div class="account-context"><p>Signed in as codyhamilton (4210937)</p><p>Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.</p></div>
<div class="table-wrap"><table class="tenant-table"><caption>Owner tenant lifecycle</caption>
<thead><tr><th>Tenant name</th><th>Immutable ID</th><th>Lifecycle state</th><th>Generation</th><th>Actions</th></tr></thead>
<tbody>
<tr class="selected"><td>default</td><td>default</td><td>active</td><td>3f9a0c1d7e22b4a65c80d1e9f2a7b304</td><td class="actions"><button class="tenant-action" type="button">Reset tenant</button> <button class="tenant-action" type="button">Delete tenant</button></td></tr>
<tr><td>Scratch</td><td>t-4f2a91c07b3d</td><td>active</td><td>9d02e7a15c3b48f0a6e1d7c2b9a40e83</td><td class="actions"><button class="tenant-action" type="button">Reset tenant</button> <button class="tenant-action" type="button">Delete tenant</button></td></tr>
</tbody></table></div>
<dialog open id="confirm-dialog" class="mock-dialog">
<h2 id="op-title">Delete tenant</h2>
<p id="op-name">Display name: default</p>
<p id="op-id">Immutable id: default</p>
<p id="op-scale" class="effect scale" data-testid="op-scale">This tenant holds 1,418,544 stored records (1,418,332 events, 212 rejected). Deleting erases all of them and cannot be undone.</p>
<p id="op-effect" class="effect">Permanently remove this tenant, all its data and keys, and your ownership link. Every key for this tenant stops working, including the key your sync uses.</p>
<p class="human">Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.</p>
<label>Type the immutable tenant id to confirm <input id="typed-id" value="default" autocomplete="off"></label>
<label id="phrase-label">Type <code>delete all data</code> to confirm <input id="typed-phrase" value="delete all da" autocomplete="off"></label>
<div class="dialog-actions"><button id="cancel-action" type="button">Cancel</button><button id="confirm-action" type="button" disabled>Confirm</button></div>
<p class="mock-note">Confirm stays disabled until BOTH boxes match exactly. The second box appears whenever the tenant holds any records or its size could not be read.</p>
</dialog>
</main>
</body></html>
"""
    )


PAGES = {
    "tenant-selector": page_selector(),
    "profile-tenants": page_profile(),
    "lifecycle-confirm": page_lifecycle(),
}

for key, body in PAGES.items():
    (SRC / f"{key}.html").write_text(body)
print("wrote", ", ".join(f"{k}.html" for k in PAGES))
