// Module worker that loads the Fluid HTN WASM AppBundle and returns a bunker plan
// Requires the AppBundle to be served at /fluidhtn/_framework/

self.onmessage = async (e) => {
  const { type } = e.data || {};
  if (type !== 'plan') return;
  const t0 = performance.now();
  try {
    let dotnetModule;
    try {
      dotnetModule = await import('/fluidhtn/_framework/dotnet.js');
    } catch (err) {
      // Fallback to relative path if hosted differently
      dotnetModule = await import('../fluidhtn/_framework/dotnet.js');
    }
    const { dotnet } = dotnetModule;
    const { getAssemblyExports, getConfig } = await dotnet.create();
    const config = getConfig();
    const exports = await getAssemblyExports(config.mainAssemblyName);
    const planText = exports.FluidHtnWasm.PlannerBridge.PlanBunker();
    const steps = (planText || '').split('\n').filter(Boolean);
    const t1 = performance.now();
    self.postMessage({ type: 'result', steps, elapsedMs: Math.round(t1 - t0) });
  } catch (err) {
    const t1 = performance.now();
    self.postMessage({ type: 'error', message: String(err?.message || err), elapsedMs: Math.round(t1 - t0) });
  }
};


