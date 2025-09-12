#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

# Output directory for exported artifacts
OUT_DIR="${1:-$REPO_ROOT/examples/pandapiengine}"

echo "[pandaPIengine] Output directory: $OUT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required but not found in PATH." >&2
  exit 1
fi

# Ensure destination exists so users can see it being populated
mkdir -p "$OUT_DIR"

echo "[pandaPIengine] Building via Docker (this may take a few minutes)..."
DOCKER_BUILDKIT=1 docker build \
  -f "$REPO_ROOT/Dockerfile.pandapiengine" \
  -o "$OUT_DIR" \
  "$REPO_ROOT"

echo "[pandaPIengine] Build complete. Verifying artifacts..."

ART_JS="$OUT_DIR/pandaPIengine.js"
ART_WASM="$OUT_DIR/pandaPIengine.wasm"

if [[ -f "$ART_JS" && -f "$ART_WASM" ]]; then
  echo "[pandaPIengine] Found: $(basename "$ART_JS"), $(basename "$ART_WASM")"
  echo "[pandaPIengine] Artifacts are ready in: $OUT_DIR"
else
  echo "Warning: Expected artifacts not found in $OUT_DIR" >&2
  echo "Look for build errors above. The Docker build should export files from /dist." >&2
  exit 1
fi


