export type BunkerGoalKey =
  | 'hasStar'
  | 'hasKey'
  | 'hasC4'
  | 'bunkerBreached'
  | 'agentAt_bunker_door'
  | 'agentAt_bunker_interior'
  | 'agentAt_c4_table'
  | 'agentAt_star';

export async function loadDotnet(dotnetUrl: string) {
  const mod = await import(/* @vite-ignore */ dotnetUrl);
  const { dotnet } = mod as any;
  const { getAssemblyExports, getConfig } = await dotnet.create();
  const config = getConfig();
  const exports = await getAssemblyExports(config.mainAssemblyName);
  // Enable C# side debug logs only when explicitly requested
  try {
    if (typeof process !== 'undefined' && process?.env?.FLUIDHTN_DEBUG === '1') {
      exports.FluidHtnWasm.PlannerBridge.EnablePlannerDebug(true);
    }
  } catch {}
  return { exports } as {
    exports: any;
  };
}

export async function planGoal(exports: any, goal: BunkerGoalKey) {
  return exports.FluidHtnWasm.PlannerBridge.PlanBunkerGoal(goal) as string;
}

export async function planJson(exports: any, payload: unknown) {
  const json = JSON.stringify(payload);
  return exports.FluidHtnWasm.PlannerBridge.PlanBunkerJson(json) as string;
}

// Node worker-threaded helpers (non-blocking)
export type WorkerPlanCmd =
  | { cmd: 'init'; dotnetUrl: string }
  | { cmd: 'runDemo'; dotnetUrl: string }
  | { cmd: 'planGoal'; dotnetUrl: string; goalKey: BunkerGoalKey }
  | { cmd: 'planJson'; dotnetUrl: string; json: string };

export async function withFluidWorker<T = any>(dotnetUrl: string, message: WorkerPlanCmd): Promise<T> {
  const { Worker } = await import('worker_threads');
  const worker = new Worker(new URL('./fluidhtn-worker.mjs', import.meta.url), { type: 'module' });
  try {
    // Initialize
    await new Promise<void>((resolve, reject) => {
      const onMsg = (m: any) => {
        if (m?.type === 'ready') {
          worker.off('message', onMsg);
          resolve();
        } else if (m?.type === 'error') {
          worker.off('message', onMsg);
          reject(new Error(m.error));
        }
      };
      worker.on('message', onMsg);
      worker.postMessage({ cmd: 'init', dotnetUrl });
    });

    // Run command
    return await new Promise<T>((resolve, reject) => {
      const onMsg = (m: any) => {
        if (m?.type === 'result') {
          worker.off('message', onMsg);
          resolve(m.result as T);
        } else if (m?.type === 'error') {
          worker.off('message', onMsg);
          reject(new Error(m.error));
        }
      };
      worker.on('message', onMsg);
      worker.postMessage(message);
    });
  } finally {
    worker.terminate();
  }
}

export async function runDemoOnWorker(dotnetUrl: string) {
  return withFluidWorker<string>(dotnetUrl, { cmd: 'runDemo', dotnetUrl } as WorkerPlanCmd);
}

export async function planGoalOnWorker(dotnetUrl: string, goal: BunkerGoalKey) {
  return withFluidWorker<string>(dotnetUrl, { cmd: 'planGoal', dotnetUrl, goalKey: goal } as WorkerPlanCmd);
}

export async function planJsonOnWorker(dotnetUrl: string, payload: unknown) {
  const json = JSON.stringify(payload);
  return withFluidWorker<string>(dotnetUrl, { cmd: 'planJson', dotnetUrl, json } as WorkerPlanCmd);
}
