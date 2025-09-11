# PandaPIengine build script

The `build_pandapiengine_wasm.sh` script clones and compiles PandaPIengine to WebAssembly using Emscripten.

## Prerequisites

- Emscripten SDK (`emcmake`, `emmake`)
- `git`, `cmake`, `make`, `gengetopt`

If these tools are not available on your host, use the Docker workflow described in `../PANDA_API_README.md`.

## Usage

From the repository root:

```bash
./scripts/build_pandapiengine_wasm.sh
```

Artifacts are placed in `examples/pandapiengine`. To specify a custom output directory, pass it as the first argument:

```bash
./scripts/build_pandapiengine_wasm.sh /path/to/output
```
