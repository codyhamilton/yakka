// Package clientconfig loads client endpoint and key for the drain, MCP shim, and status.
// Resolution (plan 13): when both YAKKA_ENDPOINT and YAKKA_KEY are set they win over the
// file; exactly one of those variables set is an error; otherwise ~/.config/yakka/client.toml
// means remote mode (written by `yakka login`); with no file the client is local mode at
// LocalEndpoint with no bearer.
//
// The path is $YAKKA_CLIENT_CONFIG when set (tests only), else $HOME/.config/yakka/client.toml.
// Only the subset design 2 shows is parsed: `name = "string"` lines, `#` comments and blank lines;
// unknown names are ignored; any other line is an error that names the line number, never its text.
// The key is never logged or placed in an error.
package clientconfig

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// LocalEndpoint is where local mode sends, matching serve's default address.
const LocalEndpoint = "http://127.0.0.1:8770"

const (
	envEndpoint = "YAKKA_ENDPOINT"
	envKey      = "YAKKA_KEY"
)

// ErrPartialEnv means exactly one of YAKKA_ENDPOINT and YAKKA_KEY is set.
var ErrPartialEnv = errors.New("clientconfig: YAKKA_ENDPOINT and YAKKA_KEY must both be set or both unset")

// Config is the parsed file, or the local default when there is none.
type Config struct {
	Endpoint string
	Key      string // empty in local mode
	Local    bool   // no config file: local mode
}

// Mode names the mode for status lines.
func (c Config) Mode() string {
	if c.Local {
		return "local"
	}
	return "remote"
}

var lineRE = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$`)

// Path returns the config file path.
func Path() string {
	if p := os.Getenv("YAKKA_CLIENT_CONFIG"); p != "" {
		return p
	}
	home := os.Getenv("HOME")
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	return filepath.Join(home, ".config", "yakka", "client.toml")
}

// Load reads and parses the config on every call, so edits need no restart. A missing file is
// local mode, not an error, unless env overrides apply.
func Load() (Config, error) {
	ep := strings.TrimSpace(os.Getenv(envEndpoint))
	key := strings.TrimSpace(os.Getenv(envKey))
	epSet := ep != ""
	keySet := key != ""
	switch {
	case epSet && keySet:
		return Config{Endpoint: ep, Key: key}, nil
	case epSet || keySet:
		return Config{}, ErrPartialEnv
	}
	path := Path()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Config{Endpoint: LocalEndpoint, Local: true}, nil
		}
		return Config{}, fmt.Errorf("clientconfig: read %s: %w", path, err)
	}
	return parse(path, string(data))
}

func parse(path, text string) (Config, error) {
	vals := map[string]string{}
	for i, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m := lineRE.FindStringSubmatch(line)
		if m == nil {
			return Config{}, fmt.Errorf("clientconfig: %s: line %d is not a `name = \"string\"` line", path, i+1)
		}
		v, err := strconv.Unquote(m[2])
		if err != nil {
			return Config{}, fmt.Errorf("clientconfig: %s: line %d has an invalid string", path, i+1)
		}
		vals[m[1]] = v
	}
	cfg := Config{Endpoint: vals["endpoint"], Key: vals["key"]}
	if cfg.Endpoint == "" {
		return Config{}, fmt.Errorf("clientconfig: %s: missing endpoint", path)
	}
	if cfg.Key == "" {
		return Config{}, fmt.Errorf("clientconfig: %s: missing key", path)
	}
	return cfg, nil
}

const (
	envSyncEndpoint = "YAKKA_SYNC_ENDPOINT"
	envSyncKey      = "YAKKA_SYNC_KEY"
)

// ErrNoSyncCredential means neither the YAKKA_SYNC_* variables nor sync.toml supply a credential.
var ErrNoSyncCredential = errors.New("clientconfig: no sync credential; run `yakka login --sync` or set YAKKA_SYNC_ENDPOINT and YAKKA_SYNC_KEY")

// ErrPartialSyncEnv means exactly one of YAKKA_SYNC_ENDPOINT and YAKKA_SYNC_KEY is set.
var ErrPartialSyncEnv = errors.New("clientconfig: YAKKA_SYNC_ENDPOINT and YAKKA_SYNC_KEY must both be set or both unset")

// SyncPath returns the sync credential file path: $YAKKA_SYNC_CONFIG when set, else
// $HOME/.config/yakka/sync.toml.
func SyncPath() string {
	if p := os.Getenv("YAKKA_SYNC_CONFIG"); p != "" {
		return p
	}
	home := os.Getenv("HOME")
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	return filepath.Join(home, ".config", "yakka", "sync.toml")
}

// LoadSync resolves the credential `yakka sync` posts with: the YAKKA_SYNC_ENDPOINT and
// YAKKA_SYNC_KEY pair, else sync.toml. It never falls back to client.toml or local mode, so a sync
// can only reach a remote the user logged in to for that purpose.
func LoadSync() (Config, error) {
	ep := strings.TrimSpace(os.Getenv(envSyncEndpoint))
	key := strings.TrimSpace(os.Getenv(envSyncKey))
	switch {
	case ep != "" && key != "":
		return Config{Endpoint: ep, Key: key}, nil
	case ep != "" || key != "":
		return Config{}, ErrPartialSyncEnv
	}
	path := SyncPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Config{}, ErrNoSyncCredential
		}
		return Config{}, fmt.Errorf("clientconfig: read %s: %w", path, err)
	}
	return parse(path, string(data))
}
