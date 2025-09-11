#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

# Output directory for exported artifacts
OUT_DIR="${1:-$REPO_ROOT/examples/fluidhtn}"

# Optional: enable AOT via env or second arg: true|false (default false)
AOT_ARG="${2:-${AOT:-false}}"

echo "[fluidhtn] Output directory: $OUT_DIR"
echo "[fluidhtn] AOT: $AOT_ARG"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required but not found in PATH." >&2
  exit 1
fi

# Ensure destination exists so users can see it being populated
mkdir -p "$OUT_DIR"

echo "[fluidhtn] Building via Docker (this may take a few minutes)..."
DOCKER_BUILDKIT=1 docker build \
  -f "$REPO_ROOT/Dockerfile.fluidhtn" \
  --build-arg AOT="$AOT_ARG" \
  -o "$OUT_DIR" \
  "$REPO_ROOT"

echo "[fluidhtn] Build complete. Verifying artifacts..."

if [[ -f "$OUT_DIR/dotnet.js" || -f "$OUT_DIR/_framework/dotnet.js" ]]; then
  echo "[fluidhtn] Found runtime: dotnet.js"
  if [[ -f "$OUT_DIR/FluidHtnWasm.dll" ]]; then
    echo "[fluidhtn] Found assembly: FluidHtnWasm.dll"
  fi
  echo "[fluidhtn] Artifacts are ready in: $OUT_DIR"

  # Auto-sync AppBundle into Next.js public folder for local dev
  if [[ -d "$REPO_ROOT/examples/app/public" ]]; then
    echo "[fluidhtn] Syncing AppBundle into Next public (/fluidhtn)..."
    bash "$REPO_ROOT/scripts/copy_fluidhtn_to_next_public.sh" || echo "[fluidhtn] Warning: sync to Next public failed"
  fi
else
  echo "Warning: Expected artifacts not found in $OUT_DIR" >&2
  echo "Look for build errors above. The Docker build should export files from the published output." >&2
  exit 1
fi


