# PandaPIengine WebAssembly Build

This project contains helper scripts to compile the [PandaPIengine](https://github.com/panda-planner-dev/pandaPIengine) HTN planner to WebAssembly so it can run in browsers or Node.js.

## Quick build with Docker

The simplest way to produce the WebAssembly and JavaScript loader is via Docker. The following command builds the engine and writes the artifacts to `examples/pandapiengine/`:

```bash
docker build -f Dockerfile.pandapiengine -o examples/pandapiengine .
```

This requires Docker with BuildKit enabled (default on modern versions).

## Running the demo

After building, you can exercise the planner with Node.js:

```bash
node examples/pandapiengine/demo.js
```

The script prints a few exported keys and invokes the planner's help message if available.

The generated `pandaPIengine.wasm` file is ignored by git; rebuild it locally whenever needed.
