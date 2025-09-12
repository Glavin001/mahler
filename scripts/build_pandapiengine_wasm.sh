#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUT_DIR="${1:-$SCRIPT_DIR/../examples/pandapiengine}"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/pandaPIengine.js" "$OUT_DIR/pandaPIengine.wasm" "$OUT_DIR/pandaPIengine.d.ts"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
git clone --depth 1 https://github.com/panda-planner-dev/pandaPIengine "$TMP_DIR/pandaPIengine"
cd "$TMP_DIR/pandaPIengine"
mkdir build
cd build
LDFLAGS="-sMODULARIZE=1 -sEXPORT_ES6=0 -sENVIRONMENT=web,node -sEXPORTED_RUNTIME_METHODS=['callMain'] -sEXPORT_ALL=1 -sEXIT_RUNTIME=1 -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1"
TSDEF="$OUT_DIR/pandaPIengine.d.ts"
LINKER_FLAGS="$LDFLAGS --emit-tsd $TSDEF -lembind"
emcmake cmake ../src -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="$LDFLAGS" -DCMAKE_C_FLAGS="$LDFLAGS" -DCMAKE_EXE_LINKER_FLAGS="$LINKER_FLAGS"
emmake make -j$(nproc)
cp pandaPIengine.js pandaPIengine.wasm "$OUT_DIR"
echo "Artifacts placed in $OUT_DIR"
