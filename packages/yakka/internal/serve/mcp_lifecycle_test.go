package serve

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// TestMCPLifecycleGuessedToolsUnknownNoEffects proves there is no MCP lifecycle
// surface: guessed reset/delete tools are unknown-tool errors with no effects.
func TestMCPLifecycleGuessedToolsUnknownNoEffects(t *testing.T) {
	tg := newLifecycleHTTPTarget(t, Options{})
	before := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant)
	for _, name := range []string{"reset_tenant", "delete_tenant"} {
		rec := mcpRequest(t, tg.h, tg.key, mcpCallBody(name, map[string]any{"confirm_tenant_id": tg.tenant}), nil)
		reply := mcpDecode(t, rec)
		errObj, ok := reply["error"].(map[string]any)
		if !ok || errObj["code"] != float64(-32602) || errObj["message"] != "unknown tool" {
			t.Fatalf("%s: %#v", name, reply)
		}
	}
	if got := lifecycleStateDigest(t, tg.s, tg.dir, tg.tenant); got != before {
		t.Fatal("guessed MCP lifecycle tool changed store, tokens, grants, claims or spend")
	}
	if _, err := os.Stat(filepath.Join(tg.dir, tg.tenant)); err != nil {
		t.Fatalf("guessed tool touched the store: %v", err)
	}
}

// TestMCPLifecycleBusyAndDeletedTenantRefused proves MCP data-plane calls are
// refused during cleanup and cannot resurrect a deleted tenant.
func TestMCPLifecycleBusyAndDeletedTenantRefused(t *testing.T) {
	reached := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	tg := newLifecycleHTTPTarget(t, Options{LifecycleFault: func(stage string) error {
		if stage == "after-begin" {
			once.Do(func() { close(reached); <-release })
		}
		return nil
	}})
	if err := tg.s.RegisterListReviewsMCPTool(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- tg.s.ResetTenant(context.Background(), tg.ownerID, tg.tenant) }()
	<-reached

	result := mcpCallResult(t, mcpRequest(t, tg.h, tg.key, mcpCallBody("list_reviews", map[string]any{}), nil))
	if result["isError"] != true || !strings.Contains(fmt.Sprint(result["content"]), "tenant_busy") {
		t.Fatalf("MCP during cleanup: %#v", result)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("reset after MCP refusal: %v", err)
	}

	if err := tg.s.DeleteTenant(context.Background(), tg.ownerID, tg.tenant); err != nil {
		t.Fatalf("delete: %v", err)
	}
	rec := mcpRequest(t, tg.h, tg.key, mcpCallBody("list_reviews", map[string]any{}), nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("deleted tenant MCP = %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(tg.dir, tg.tenant)); !os.IsNotExist(err) {
		t.Fatalf("refused MCP call recreated the directory: %v", err)
	}
}
