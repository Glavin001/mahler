// Web Worker: loads the AppBundle runtime from ../fluidhtn/_framework/dotnet.js
// and calls the exported C# method PlannerBridge.RunDemo().

self.onmessage = async (e) => {
  const { type } = e.data || {};
  if (type !== 'run') return;
  try {
    // Try sibling AppBundle (../fluidhtn). If not available, try co-located (_framework under this folder).
    let dotnetMod;
    try {
      dotnetMod = await import('../fluidhtn/_framework/dotnet.js');
    } catch (_) {
      dotnetMod = await import('./_framework/dotnet.js');
    }
    const { dotnet } = dotnetMod;
    const { getAssemblyExports, getConfig } = await dotnet.create();
    const config = getConfig();
    const exports = await getAssemblyExports(config.mainAssemblyName);
    const plan = exports.FluidHtnWasm.PlannerBridge.RunDemo();
    self.postMessage({ type: 'result', plan });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};


