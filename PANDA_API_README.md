# PandaPIengine WebAssembly Build

This project contains helper scripts to compile the [PandaPIengine](https://github.com/panda-planner-dev/pandaPIengine) HTN planner to WebAssembly so it can run in browsers or Node.js.

## Quick build with Docker

The simplest way to produce the WebAssembly and JavaScript loader is via Docker. Run the helper script to build the engine and export the artifacts to `examples/pandapiengine/`:

```bash
./scripts/build_pandapiengine_docker.sh
```

This requires Docker with BuildKit enabled (default on modern versions).

To choose a different output directory, pass it as the first argument:

```bash
./scripts/build_pandapiengine_docker.sh /path/to/output
```

## Running the demo

After building, you can exercise the planner with Node.js:

```bash
node examples/pandapiengine/demo.js
```

The script prints a few exported keys and invokes the planner's help message if available.

The generated `pandaPIengine.wasm` file is ignored by git; rebuild it locally whenever needed.
