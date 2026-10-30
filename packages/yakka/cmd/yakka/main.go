// Command yakka is the single binary of plan 09: serve, drain, mcp, status.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/drain"
	"github.com/codyhamilton/yakka/packages/yakka/internal/mcp"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/screen"
	"github.com/codyhamilton/yakka/packages/yakka/internal/serve"
)

// Set with -ldflags -X main.version=… -X main.commit=…
var (
	version = "dev"
	commit  = "unknown"
)

const usage = "usage: yakka serve | drain | ledger compact --tenant-dir <dir> | ledger purge-deltas --tenant-dir <dir> | sync --to <tenant-id> | mcp | status | version\n"

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, usage)
		return 2
	}
	switch args[0] {
	case "serve":
		return runServe()
	case "drain":
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()
		return drain.RunStandalone(ctx, os.Stderr)
	case "status":
		return drain.RunStatus(os.Stdout)
	case "login":
		return runLogin(args[1:])
	case "ledger":
		return runLedger(args[1:])
	case "sync":
		return runSync(args[1:])
	case "mcp":
		return runMCP(args[1:])
	case "--version", "version":
		fmt.Printf("yakka %s %s\n", version, commit)
		return 0
	}
	fmt.Fprint(os.Stderr, usage)
	return 2
}

// runLogin refuses: login lives in the plugin's Python client (plans/19-device-login).
func runLogin(args []string) int {
	fmt.Fprintln(os.Stderr, "yakka login moved to the plugin wrapper (plugins/yakka/bin/yakka)")
	return 1
}

// runMCP serves the advisory shim on stdin and stdout until EOF or a signal. Only JSON-RPC goes to
// stdout; diagnostics go to stderr.
func runMCP(args []string) int {
	if len(args) > 0 {
		fmt.Fprint(os.Stderr, "usage: yakka mcp (no arguments)\n")
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	err := mcp.Serve(ctx, os.Stdin, os.Stdout, mcp.Options{Version: version, QueueDir: drain.QueueDir()})
	if err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, "yakka mcp:", err)
		return 1
	}
	return 0
}

func runServe() int {
	cfg, err := serve.ConfigFromEnv(os.Getenv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "yakka serve:", err)
		return 1
	}
	if err := os.MkdirAll(cfg.Data, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "yakka serve: data directory:", err)
		return 1
	}
	step, checks, err := screenStep(os.Getenv("TYPESAFE_API_KEY"), os.Getenv("YAKKA_CHECKS_DIR"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "yakka serve:", err)
		return 1
	}
	if err := serve.Preflight(cfg.Data); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "yakka serve:", err)
		return 1
	}
	s := serve.New(cfg, serve.Options{Version: version, ScreenStep: step, Checks: checks})
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	hostCtx, hostCancel := context.WithCancel(context.Background())
	hostDone := make(chan struct{})
	var hostPoll time.Duration // YAKKA_SERVE_POLL: test-only hosting tick
	if d, err := time.ParseDuration(os.Getenv("YAKKA_SERVE_POLL")); err == nil {
		hostPoll = d
	}
	go func() {
		defer close(hostDone)
		s.Host(hostCtx, serve.HostOptions{Bound: ln.Addr().String(), Poll: hostPoll, Log: os.Stderr})
	}()
	fmt.Fprintf(os.Stderr, "yakka serve: listening on %s\n", ln.Addr())
	code := 0
	select {
	case <-ctx.Done():
	case err := <-errc:
		fmt.Fprintln(os.Stderr, "yakka serve:", err)
		code = 1
	}
	hostCancel() // the hosted drain stops and releases the lock before tenants close
	<-hostDone
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "yakka serve: shutdown:", err)
	}
	if err := s.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "yakka serve: close:", err)
		code = 1
	}
	return code
}

// screenStep builds the screen step and loads the checks from the environment. No key: a nil step,
// so verdicts are "unscreened". YAKKA_CHECKS_DIR is loaded whenever it is set (nil checks when
// not), for the screen step and for /v1/checks. The key is used only to build the scorer; it is
// never printed.
func screenStep(key, checksDir string) (serve.ScreenFunc, *scorer.Checks, error) {
	key = strings.TrimSpace(key)
	var checks scorer.Checks
	var loaded *scorer.Checks
	if checksDir != "" {
		c, err := scorer.LoadChecks(checksDir)
		if err != nil {
			return nil, nil, fmt.Errorf("checks: %w", err)
		}
		checks, loaded = c, &c
	}
	counts := fmt.Sprintf("checks design=%d brief=%d report=%d", checks.Count("design"), checks.Count("brief"), checks.Count("report"))
	if key == "" {
		fmt.Fprintln(os.Stderr, "yakka serve: scorer none; verdicts are unscreened")
		if loaded != nil {
			fmt.Fprintln(os.Stderr, "yakka serve: "+counts)
		}
		return nil, loaded, nil
	}
	if checksDir == "" {
		fmt.Fprintln(os.Stderr, "yakka serve: scoring is off because YAKKA_CHECKS_DIR is unset; screening only")
	}
	sc := scorer.NewJev(key, checks)
	fmt.Fprintf(os.Stderr, "yakka serve: scorer %s; %s\n", sc.Name(), counts)
	return screen.Step(sc), loaded, nil
}
