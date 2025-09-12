# Fluid HTN WebAssembly Build

This setup compiles the Fluid HTN C# library to run in the browser or Node.js using the official .NET WebAssembly toolchain.

References:
- Microsoft Learn: WebAssembly build tools and AOT (`wasm-tools`) — `https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools-and-aot?view=aspnetcore-9.0`
- .NET from any JavaScript app — `https://devblogs.microsoft.com/dotnet/use-net-7-from-any-javascript-app-in-net-7/`
- JS interop with WebAssembly Browser App — `https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app?view=aspnetcore-9.0`

## Build with Docker

```bash
# Default output to examples/fluidhtn (no AOT)
./scripts/build_fluidhtn_docker.sh

# Custom output directory
./scripts/build_fluidhtn_docker.sh /path/to/output

# Enable AOT (slower build, faster runtime, larger size)
./scripts/build_fluidhtn_docker.sh ./examples/fluidhtn true
```

Artifacts are exported to the specified directory (e.g., `examples/fluidhtn/`), containing `_framework/dotnet.js`, app assets, and `main.js`.

## Run the Node demo

```bash
node examples/fluidhtn/demo.mjs
```

This loads the .NET runtime in Node and calls `PlannerBridge.RunDemo()` exported from C#.

## Run the browser (Web Worker) demo

1. Build artifacts to `examples/fluidhtn/`:

```bash
./scripts/build_fluidhtn_docker.sh ./examples/fluidhtn
```

2. Serve the examples root (so `fluidhtn-web` can access `../fluidhtn`):

```bash
npx http-server examples -c-1
# then open /fluidhtn-web/
```

   - Alternatively, copy the AppBundle into the web folder and serve just that directory:

```bash
rm -rf examples/fluidhtn-web/_framework
cp -r examples/fluidhtn/_framework examples/fluidhtn-web/
# then:
npx http-server examples/fluidhtn-web -c-1
```

3. Open the served URL and click "Run Planner".

## Next.js integration (examples/app)

To run the 3D bunker page powered by Fluid HTN:

1) Build the AppBundle:

```bash
./scripts/build_fluidhtn_docker.sh ./examples/fluidhtn
```

2) Serve the Next public root with the AppBundle under `/fluidhtn`.

Option A: serve `examples` so `/fluidhtn` is available and Next can reach `/workers`:

```bash
npx http-server examples -c-1
# open /app/ and navigate to /bunker-fluid
```

Option B: copy AppBundle into Next public directory:

```bash
rm -rf examples/app/public/fluidhtn
cp -r examples/fluidhtn examples/app/public/fluidhtn
cd examples/app && npm install && npm run dev
# open http://localhost:3000/bunker-fluid
```



