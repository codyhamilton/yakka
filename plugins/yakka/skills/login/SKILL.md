---
name: login
description: Log this machine in to the yakka service with a device code — show the user a URL and code to approve in a browser, then confirm the result with `yakka status`. Use when the user asks to log in, connect to yakka, or fix a missing or expired login; not for remote or headless sessions, which set `YAKKA_ENDPOINT` and `YAKKA_KEY` instead.
---

# Login

Log in with the device-code flow. The user approves on a web page; the client stores the token itself. You never see it.

## Steps

1. Run `yakka login start`. Add `--endpoint <url>` only if the user named an endpoint. It prints `url:` and `code:` lines and exits at once.
2. Show the user the `url:` and `code:` lines. Tell them to open the URL, check that the code on the page matches the code you showed, then pick a tenant, scope, lifetime and token name and approve. The name is prefilled with this machine's host name.
3. Run `yakka login wait` as a long-running or background command. Its exit is the signal: 0 means logged in; 1 means denied, expired, or no login was started (run `start` again if the user wants to retry).
4. When it exits, run `yakka status` and report its `config:` and `endpoint:` lines to the user.
5. If `config:` says `env`, warn the user that the environment (`YAKKA_ENDPOINT`/`YAKKA_KEY`) overrides the login, so the login just made is not the one in use until those variables are unset.

## Login for `yakka sync`

Only when the user is migrating local data to the hosted service (`yakka sync`): run `yakka login start --sync` instead, then `yakka login wait` as above. The token goes to `sync.toml`, not `client.toml`, so the drain's target does not change. The user picks a `read_write` token for the tenant they are migrating into. Skip step 4; `yakka status` reports the drain's login, not this one.

## Rules

- Never read, print or edit `client.toml`, `sync.toml` or the `.pending` file. Never print a token or a `device_code`.
- Do not choose the tenant, scope, lifetime or token name for the user; they choose on the page.
- For a remote or headless session, do not run the flow. Tell the user to set `YAKKA_ENDPOINT` and `YAKKA_KEY` in the environment instead.
