#!/bin/bash
# Cross-compiles the four release binaries and writes their checksums. Never uploads.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd -P)
cd "$ROOT"
VERSION=$(tr -d ' \n\r' < plugins/yakka/bin/VERSION)
OUT_DIR=${OUT_DIR:-tools/release/dist}
SUMS_FILE=${SUMS_FILE:-plugins/yakka/bin/SHA256SUMS}
if command -v go >/dev/null 2>&1; then
  GO=$(command -v go)
else
  GO=""
  for c in "$HOME/.local/go/bin/go" /usr/local/go/bin/go /opt/homebrew/bin/go; do
    if [ -x "$c" ]; then GO="$c"; break; fi
  done
  [ -n "$GO" ] || { echo "build.sh: no Go toolchain" >&2; exit 1; }
fi
SITE="$ROOT/packages/yakka/internal/serve/site"
SITE_SRC=${SITE_SRC:-$ROOT/packages/yakka-analytics/web}
SAVE=$(mktemp -d "${TMPDIR:-/tmp}/build-site.XXXXXX")
git show HEAD:packages/yakka/internal/serve/site/index.html > "$SAVE/index.html"
# Always leave site/ as the committed placeholder, whether the build succeeded or not.
restore_site() {
  find "$SITE" -mindepth 1 -delete 2>/dev/null || true
  mkdir -p "$SITE" && cp "$SAVE/index.html" "$SITE/index.html"
  rm -rf "$SAVE"
}
trap restore_site EXIT
if [ ! -f "$SITE_SRC/index.html" ] || grep -q yakka-analytics-placeholder "$SITE_SRC/index.html"; then
  echo "build.sh: $SITE_SRC/index.html is missing or still the placeholder" >&2; exit 1
fi
find "$SITE" -mindepth 1 -delete
mkdir -p "$SITE"
find "$SITE_SRC" -mindepth 1 -maxdepth 1 ! -name _headers -exec cp -R {} "$SITE/" \;
COMMIT=$(git rev-parse --short=12 HEAD 2>/dev/null) || COMMIT=unknown
mkdir -p "$OUT_DIR"
OUT_ABS=$(cd "$OUT_DIR" && pwd -P)
for os in linux darwin; do
  for arch in amd64 arm64; do
    (cd packages/yakka && CGO_ENABLED=0 GOOS=$os GOARCH=$arch GOTOOLCHAIN=auto "$GO" build -trimpath \
      -ldflags "-X main.version=$VERSION -X main.commit=$COMMIT" \
      -o "$OUT_ABS/yakka-$os-$arch" ./cmd/yakka)
  done
done
tmp="$SUMS_FILE.tmp.$$"
(cd "$OUT_ABS" && for f in yakka-*; do
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi
done) | sort -k2 > "$tmp"
mv "$tmp" "$SUMS_FILE"
