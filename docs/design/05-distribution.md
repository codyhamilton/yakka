# Design Intent 5: Distribution

How the `yakka` binary and the hook configs reach each machine and harness. Part of
[system-architecture.md](system-architecture.md).

## Targets

linux and darwin, amd64 and arm64. WSL is linux. No Windows-native support: hooks and the wrapper
need bash, and a Windows-native harness opening a WSL repo is out of scope.

## Layout

The monorepo separates **`packages/`** (libraries and the Go binary), **`tools/`** (maintainer automation), and **`plugins/yakka`** (the installable yakka plugin: skills, hooks, `script/`, `bin/`).

| Path | Holds |
|---|---|
| `packages/yakka/` | Go module: `cmd/yakka`, `internal/`, and embedded analytics site |
| `packages/yakka/catalogue/` | Jev criteria and check JSON shipped with the binary |
| `packages/hooklog/` | Hook capture edge: `spool.sh`, drain helpers, harness examples |
| `plugins/yakka/` | Yakka plugin install root: skills, harness manifests, `hooks/`, `script/`, `bin/` |
| `plugins/yakka/bin/yakka` | bash wrapper that execs `python3` on `plugins/yakka/client/yakka.py` for plugin commands, committed |
| `plugins/yakka/bin/VERSION` | collector release version (maintainer metadata; not used by the wrapper) |
| `plugins/yakka/bin/SHA256SUMS` | checksums for the collector release's four binaries, committed; not hook input |
| `plugins/yakka/bin/RELEASE_URL` | collector release download base, `https://github.com/codyhamilton/yakka/releases/download` |
| `tools/release/build.sh` | builds the four binaries and writes `SHA256SUMS` |

Binaries are never committed.

## Wrapper

`plugins/yakka/bin/yakka` dispatches plugin commands to the Python client:

1. `YAKKA_BIN`, if set, overrides the wrapper script itself (development).
2. Otherwise `exec python3` on `plugins/yakka/client/yakka.py` with the subcommand for `drain`, `mcp`,
   `login`, `status`, and `version` / `--version`.
3. `serve` and `ledger` are not available through the wrapper: print why on stderr and exit non-zero
   (operators run the Go collector from `packages/yakka`).

`plugins/yakka/bin/yakka version` and `plugins/yakka/bin/yakka --version` print `yakka <version> <commit>`.

Constraints: bash 3.2 compatible (macOS). With `YAKKA_BIN` unset, the spool kick starts
`python3 plugins/yakka/client/yakka.py drain` detached; hooks do not wait on the drain or the shim.
`YAKKA_BIN` set and executable is that program with `drain`.

## Local bootstrap

There is no install command. Local setup varies too much by system (systemd, launchd, a terminal)
for the plugin to presume one, and local mode needs no generated state:

- On loopback, `yakka serve` runs keyless on `127.0.0.1:8770` and stores under tenant `local`,
  whether or not the GitHub OAuth env vars are set (they are ignored). Setting `YAKKA_SERVE_KEYS`
  to anything but empty makes the process exit before it listens. How loopback serve is kept running
  is the user's choice.
- With no `~/.config/yakka/client.toml`, the drain and the shim use `http://127.0.0.1:8770`
  with no key.
- A non-loopback bind with `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and
  `YAKKA_PUBLIC_URL` set is a remote collector. `YAKKA_SERVE_KEYS` is not a credential there:
  any non-empty value makes the process exit before it listens, on loopback or not. The collector
  is the API. Production Pages (`https://yakka.build`) holds the site, including GitHub's callback
  `https://yakka.build/oauth/callback`, which asks the API to set a host-only `workflow_session`
  cookie and return JSON. Local and release binaries still embed the site on the same origin.
  Clients and agents use issued bearer tokens (not the session cookie). **`yakka login`** is a two-step device-code login in the plugin's
  Python client (`plugins/yakka/bin/yakka`; the Go binary refuses `login` and names the wrapper).
  `yakka login start` (`--endpoint` optional; default `https://api.yakka.build`, else the endpoint in
  `client.toml`) requests a device grant, prints the `url:` and `code:` lines and exits at once.
  `yakka login wait` polls until the user approves on the `/device` page, then writes `endpoint` and
  `key` into `client.toml` and exits. Bare `yakka login` runs both and opens the browser. The
  `/yakka:login` skill (`plugins/yakka/skills/login/SKILL.md`, in every harness) drives the two
  steps for an agent without exposing the token. Set **`YAKKA_ENDPOINT`** and **`YAKKA_KEY`** in the agent environment, when there is no
  browser (remote sessions); the environment overrides `client.toml`, and `yakka status` then prints
  `config: env (remote mode)`. There is no `yakka init`.

**Migrating local history.** `yakka sync --to <tenant-id>` (Go binary) copies a local tenant's
hook events, artifact versions and commits to a hosted tenant; ingest is idempotent by row hash, so
it can be rerun. It authenticates with its own credential, never the drain's: `yakka login --sync`
(or `start --sync`) runs the same device flow but writes `sync.toml` (`$YAKKA_SYNC_CONFIG`, else
`~/.config/yakka/sync.toml`, mode 0600) and leaves `client.toml` alone; `YAKKA_SYNC_ENDPOINT` plus
`YAKKA_SYNC_KEY` override it. Sync refuses a loopback endpoint, a credential not bound to `--to`,
a non-`read_write` scope, and a ledger whose schema version this binary does not write. Two recipes:

- Migrate: `yakka login --sync`; `yakka sync --to <t>`; `yakka login` for the same tenant, so the
  drain posts to the remote; wait for local serve to log `not hosting the drain`; `yakka sync --to <t>`
  once more to pick up what arrived meanwhile.
- Mirror: keep the normal login local and run `yakka sync --to <t>` whenever wanted.

With no `serve` running and no remote configured, the drain finds the endpoint unreachable and the
queue grows; `yakka status` reports it as a failure, not as idle.

## Release

`tools/release/build.sh` cross-compiles the **collector** binary with `CGO_ENABLED=0` and writes
`plugins/yakka/bin/SHA256SUMS`. Publishing the release (GitHub release assets for `bin/VERSION`) is a
publish action and happens only with the maintainer's agreement. Operators who need `yakka serve` or
`yakka ledger` run the Go binary from a release asset or a local `go build`; the plugin wrapper does not
fetch or build it.

## Per-harness configs

| Harness | File | Registers |
|---|---|---|
| Claude Code | `plugins/yakka/hooks/hooks.json`, `plugins/yakka/.mcp.json` | `plugins/yakka/script/spool.sh --harness claude`; shim as stdio |
| Cursor | `plugins/yakka/hooks/cursor.json`, `packages/hooklog/cursor-hooks.example.json` | `./script/spool.sh --harness cursor` |
| Codex | `plugins/yakka/hooks/codex.json` | `plugins/yakka/script/spool.sh --harness codex` |
| OpenCode | `packages/opencode-yakka-hooks` | writes spool files with the design 2 name; kicks `python3 plugins/yakka/client/yakka.py drain` |

All four drop the `artifact_submit.py` registration.

## Retired

- The systemd drain timer and service, and `install-drain.sh`.
- `packages/hooklog/drain.py`, once `yakka drain` replaces it.
- The HTTP MCP registration of the legacy service.

The legacy `workflow-quality.service` keeps running for the lab until the maintainer stops it.

## Not in this round

- Updating pinned plugin copies (the Codex copy at `451e009`); each picks up the new configs when
  the maintainer updates it.
- Registration and key issue (design 3).

## Layout rules

`plugins/yakka` may depend on packages. Packages may depend on packages. Tools may depend on either. A package's runtime code and config do not resolve a path into `tools/`. `tools/release/test_layout.py` fails the build when that direction breaks, when a marketplace lists anything but the one yakka plugin (Claude `source` stays the relative path `./plugins/yakka`; the Cursor entry may be the git-subdir object for `https://github.com/codyhamilton/yakka` at path `plugins/yakka` on ref `master`), or when a Cursor hook command is not `./script/...`. Each package README states Consumers, Build, Test, and Release. A change to the plugin itself bumps its version in the same change.

Shipped environment variables use the `YAKKA_` prefix with the same suffix as before. The legacy quality service keeps its original prefix; the 3.0.0 changelog lists that exception. Phase-trailer readers accept the pre-rename trailer and `Yakka-Phase`, and both report fences, through `tools/driver/trailer_keys.py`. Writers emit the `Yakka-*` forms. The dual-read rule is stated in `docs/design/system-architecture.md`.

`docs/lab/bootstrap/session-start.sh` and `docs/lab/CONSUMING_REPO.md` still fetch the pre-rename GitHub repository and the old cloud bootstrap script name. `install.sh` and `tools/cloud-env/bootstrap-yakka-skills.sh` do not. `packages/hooklog` tests set `YAKKA_QUALITY_URL`, which the hook edge does not read. `tools/driver/README.md` still shows only the legacy trailer and report fence; the driver accepts both.
