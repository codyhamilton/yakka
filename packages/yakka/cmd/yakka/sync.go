package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/codyhamilton/yakka/packages/yakka/internal/clientconfig"
	"github.com/codyhamilton/yakka/packages/yakka/internal/serve"
	ysync "github.com/codyhamilton/yakka/packages/yakka/internal/sync"
)

const syncUsage = "usage: yakka sync --to <tenant-id> [--tenant-dir <dir>] [--dry-run]\n"

// runSync copies a local tenant's facts to the hosted tenant named by --to, using the credential
// from `yakka login --sync` (never the drain's login).
func runSync(args []string) int {
	fs := flag.NewFlagSet("sync", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	fs.Usage = func() { fmt.Fprint(os.Stderr, syncUsage) }
	var to, dir string
	var dry bool
	fs.StringVar(&to, "to", "", "remote tenant ID the sync credential must be bound to (required)")
	fs.StringVar(&dir, "tenant-dir", "", "local tenant directory (default <serve data>/"+serve.LocalTenant+")")
	fs.BoolVar(&dry, "dry-run", false, "report what would be sent without sending")
	if err := fs.Parse(args); err != nil || to == "" || fs.NArg() != 0 {
		if err == nil {
			fmt.Fprint(os.Stderr, syncUsage)
		}
		return 2
	}
	if dir == "" {
		cfg, err := serve.ConfigFromEnv(os.Getenv)
		if err != nil {
			fmt.Fprintln(os.Stderr, "yakka sync:", err)
			return 1
		}
		dir = filepath.Join(cfg.Data, serve.LocalTenant)
	}
	cred, err := clientconfig.LoadSync()
	if err != nil {
		fmt.Fprintln(os.Stderr, "yakka sync:", err)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	rep, err := ysync.Run(ctx, ysync.Options{Source: dir, To: to, DryRun: dry, Cred: cred})
	if rep != nil && !errors.Is(err, ysync.ErrPreflight) {
		rep.Print(os.Stdout)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "yakka sync:", err)
		return 1
	}
	return 0
}
