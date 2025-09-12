#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

SRC_DIR="$REPO_ROOT/examples/fluidhtn"
DST_DIR="$REPO_ROOT/examples/app/public/fluidhtn"

if [[ ! -f "$SRC_DIR/_framework/dotnet.js" ]]; then
  echo "Error: AppBundle not found at $SRC_DIR. Build it first with:"
  echo "  $REPO_ROOT/scripts/build_fluidhtn_docker.sh $SRC_DIR"
  exit 1
fi

echo "[fluidhtn] Copying AppBundle -> $DST_DIR"
rm -rf "$DST_DIR"
mkdir -p "$DST_DIR"
cp -R "$SRC_DIR"/* "$DST_DIR"/
echo "[fluidhtn] Done. Next.js can now serve /fluidhtn/_framework/dotnet.js"


