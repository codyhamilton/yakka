package review

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// largeBenchmarkCapture returns a capture near the 2 MiB request budget: 32
// files of roughly 55 KiB each. That is large enough to trigger the packet
// trim loop while staying under MaxReviewBody.
func largeBenchmarkCapture(seed int) Capture {
	var b strings.Builder
	for f := 0; f < 32; f++ {
		name := fmt.Sprintf("pkg/generated%02d_%d.go", f, seed)
		b.WriteString("diff --git a/" + name + " b/" + name + "\n")
		b.WriteString("index 1111111..2222222 100644\n--- a/" + name + "\n+++ b/" + name + "\n@@ -1,1 +1,1 @@\n")
		for line := 0; line < 1000; line++ {
			fmt.Fprintf(&b, "+// generated line %04d for %s in benchmark capture\n", line, name)
		}
	}
	return rangeCapture(b.String(), true)
}

func BenchmarkReviewLargeCapture(b *testing.B) {
	tenant, err := store.Open(b.TempDir(), store.Options{})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = tenant.Close() })

	captured := largeBenchmarkCapture(0)
	b.Run("build", func(b *testing.B) {
		in := Input{Capture: captured}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			if _, err := Build(in); err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("write_input", func(b *testing.B) {
		packet, err := Build(Input{Capture: captured})
		if err != nil {
			b.Fatal(err)
		}
		data := packetInput(packet)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			buf := append([]byte(fmt.Sprintf("iteration-%d\n", i)), data...)
			if err := tenant.WriteReviewInput(keys.ContentHash(buf), buf); err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("start_return", func(b *testing.B) {
		lifetime, cancel := context.WithCancel(context.Background())
		cancel()
		cfg := availableConfig("http://127.0.0.1:1")
		cfg.Lifetime = lifetime
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			b.StopTimer()
			req := Request{Capture: largeBenchmarkCapture(i), Kind: "adhoc", BuildModels: []BuildModel{{ID: "unknown"}}}
			b.StartTimer()
			job, _, err := Start(context.Background(), tenant, "tenant", req, cfg)
			b.StopTimer()
			if err != nil {
				b.Fatal(err)
			}
			if job != nil {
				<-job.Done()
			}
			b.StartTimer()
		}
	})
}
