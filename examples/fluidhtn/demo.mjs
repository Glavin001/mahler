// Run after building artifacts into this folder with:
//   ./scripts/build_fluidhtn_docker.sh ./examples/fluidhtn

import { dotnet } from './_framework/dotnet.js';

const { getAssemblyExports, getConfig, setModuleImports } = await dotnet.create();
const config = getConfig();
if (!config.mainAssemblyName) {
  config.mainAssemblyName = 'FluidHtnWasm';
}
const exports = await getAssemblyExports(config.mainAssemblyName);

const result = exports.FluidHtnWasm.PlannerBridge.RunDemo();
console.log('Fluid HTN plan:', result);


