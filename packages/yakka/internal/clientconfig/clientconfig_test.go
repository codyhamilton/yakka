package clientconfig

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, body string) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "client.toml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YAKKA_CLIENT_CONFIG", p)
}

func TestLoad(t *testing.T) {
	write(t, "# c\n\nendpoint = \"http://127.0.0.1:8770\"   # local\nother = \"x\"\nkey = \"k\\\"1\"\n")
	c, err := Load()
	if err != nil || c.Endpoint != "http://127.0.0.1:8770" || c.Key != `k"1` {
		t.Fatalf("got %+v %v", c, err)
	}
	if Path() != os.Getenv("YAKKA_CLIENT_CONFIG") {
		t.Fatal("path")
	}
}

func TestMissingFile(t *testing.T) {
	t.Setenv("YAKKA_CLIENT_CONFIG", filepath.Join(t.TempDir(), "none.toml"))
	c, err := Load()
	if err != nil || !c.Local || c.Endpoint != LocalEndpoint || c.Key != "" || c.Mode() != "local" {
		t.Fatalf("got %+v %v", c, err)
	}
}

func TestDefaultPath(t *testing.T) {
	t.Setenv("YAKKA_CLIENT_CONFIG", "")
	t.Setenv("HOME", "/h")
	if Path() != "/h/.config/yakka/client.toml" {
		t.Fatal(Path())
	}
}

func TestEnvOverridesFile(t *testing.T) {
	write(t, "endpoint = \"http://file.example\"\nkey = \"file-key\"\n")
	t.Setenv("YAKKA_ENDPOINT", "http://env.example")
	t.Setenv("YAKKA_KEY", "env-key")
	c, err := Load()
	if err != nil || c.Local || c.Endpoint != "http://env.example" || c.Key != "env-key" {
		t.Fatalf("got %+v %v", c, err)
	}
}

func TestEnvRemoteNoFile(t *testing.T) {
	t.Setenv("YAKKA_CLIENT_CONFIG", filepath.Join(t.TempDir(), "missing.toml"))
	t.Setenv("YAKKA_ENDPOINT", "http://collector.example")
	t.Setenv("YAKKA_KEY", "wk_test")
	c, err := Load()
	if err != nil || c.Local || c.Endpoint != "http://collector.example" || c.Key != "wk_test" {
		t.Fatalf("got %+v %v", c, err)
	}
}

func TestPartialEnv(t *testing.T) {
	secret := "super-secret-key-value"
	t.Setenv("YAKKA_KEY", secret)
	_, err := Load()
	if err == nil || !errors.Is(err, ErrPartialEnv) {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaks key: %v", err)
	}
	t.Setenv("YAKKA_KEY", "")
	t.Setenv("YAKKA_ENDPOINT", "http://only-endpoint.example")
	_, err = Load()
	if err == nil || !errors.Is(err, ErrPartialEnv) {
		t.Fatalf("got %v", err)
	}
}

func TestMalformed(t *testing.T) {
	write(t, "endpoint = \"e\"\nkey = hunter2secret\n")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "line 2") || strings.Contains(err.Error(), "hunter2") {
		t.Fatalf("got %v", err)
	}
	write(t, "endpoint = \"e\"\n")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "missing key") {
		t.Fatalf("got %v", err)
	}
	write(t, "key = \"k\"\n")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "missing endpoint") {
		t.Fatalf("got %v", err)
	}
}

func TestLoadSync(t *testing.T) {
	t.Setenv("YAKKA_SYNC_ENDPOINT", "")
	t.Setenv("YAKKA_SYNC_KEY", "")
	// client.toml and the drain's env never stand in for a sync credential.
	write(t, "endpoint = \"https://drain.example\"\nkey = \"drainkey\"\n")
	t.Setenv("YAKKA_ENDPOINT", "https://env.example")
	t.Setenv("YAKKA_KEY", "envkey")
	t.Setenv("YAKKA_SYNC_CONFIG", filepath.Join(t.TempDir(), "none.toml"))
	if _, err := LoadSync(); !errors.Is(err, ErrNoSyncCredential) {
		t.Fatalf("no credential: %v", err)
	}

	p := filepath.Join(t.TempDir(), "sync.toml")
	if err := os.WriteFile(p, []byte("endpoint = \"https://sync.example\"\nkey = \"synckey\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YAKKA_SYNC_CONFIG", p)
	c, err := LoadSync()
	if err != nil || c.Endpoint != "https://sync.example" || c.Key != "synckey" || SyncPath() != p {
		t.Fatalf("file: %+v %v", c, err)
	}

	t.Setenv("YAKKA_SYNC_ENDPOINT", "https://senv.example")
	if _, err := LoadSync(); !errors.Is(err, ErrPartialSyncEnv) {
		t.Fatalf("partial env: %v", err)
	}
	t.Setenv("YAKKA_SYNC_KEY", "senvkey")
	if c, err := LoadSync(); err != nil || c.Endpoint != "https://senv.example" || c.Key != "senvkey" {
		t.Fatalf("env: %+v %v", c, err)
	}
}

func TestSyncDefaultPath(t *testing.T) {
	t.Setenv("YAKKA_SYNC_CONFIG", "")
	t.Setenv("HOME", "/home/x")
	if got := SyncPath(); got != "/home/x/.config/yakka/sync.toml" {
		t.Fatalf("got %s", got)
	}
}
