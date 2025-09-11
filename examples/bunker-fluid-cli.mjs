/**
 * CLI to run Fluid HTN WASM Bunker plan from Node.js and compare to expected output.
 *
 * Prerequisites:
 *   - Build/copy WASM AppBundle to examples/app/public/fluidhtn via:
 *       scripts/build_fluidhtn_docker.sh examples/fluidhtn
 *       scripts/copy_fluidhtn_to_next_public.sh
 *   - Run with Node 18+:
 *       node examples/bunker-fluid-cli.mjs
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';

const VERBOSE = process.argv.includes('--verbose') || process.env.FLUIDHTN_DEBUG === '1' || true;
function log(...args) {
  if (VERBOSE) console.log('[fluidhtn-cli]', ...args);
}

async function main() {
  // Locate the AppBundle. We reuse the worker’s path convention
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const bundleDir = path.join(repoRoot, 'examples', 'app', 'public', 'fluidhtn', '_framework');
  log('repoRoot =', repoRoot);
  log('bundleDir =', bundleDir);

  // Basic existence check
  try {
    await fs.access(path.join(bundleDir, 'dotnet.js'));
    log('Found dotnet.js');
  } catch (err) {
    console.error('[Error] dotnet.js not found. Build/copy the AppBundle first:');
    console.error('  scripts/build_fluidhtn_docker.sh examples/fluidhtn');
    console.error('  scripts/copy_fluidhtn_to_next_public.sh');
    console.error('Detail:', err);
    process.exit(1);
  }

  const t0 = performance.now();

  // Import the dotnet runtime from file:// URL
  const dotnetUrl = pathToFileURL(path.join(bundleDir, 'dotnet.js')).href;
  log('Importing dotnet runtime from', dotnetUrl);
  const { dotnet } = await import(dotnetUrl);
  log('dotnet runtime imported');
  const { getAssemblyExports, getConfig } = await dotnet.create();
  log('dotnet.create() done');
  const config = getConfig();
  log('config.mainAssemblyName =', config?.mainAssemblyName);
  const exports = await getAssemblyExports(config.mainAssemblyName);
  log('getAssemblyExports() done');
  if (!exports?.FluidHtnWasm?.PlannerBridge?.PlanBunker) {
    const topKeys = Object.keys(exports || {});
    log('Available export roots:', topKeys);
    if (exports?.FluidHtnWasm) log('FluidHtnWasm keys:', Object.keys(exports.FluidHtnWasm));
    if (exports?.FluidHtnWasm?.PlannerBridge) log('PlannerBridge keys:', Object.keys(exports.FluidHtnWasm.PlannerBridge));
  }

  // Quick sanity test
  try {
    log('Invoking PlannerBridge.RunDemo() ...');
    const demo = exports.FluidHtnWasm.PlannerBridge.RunDemo();
    log('RunDemo() returned:', demo);
  } catch (e) {
    console.warn('[warn] RunDemo failed:', e);
  }

  // Prefer goal-based entry when args are provided, fallback to default demo mission
  let planText;
  const goalArg = process.argv.find(a => a.startsWith('--goal='));
  const goalKey = goalArg ? goalArg.split('=')[1] : null;
  if (goalKey) {
    log('Invoking PlannerBridge.PlanBunkerGoal() with', goalKey);
    planText = exports.FluidHtnWasm.PlannerBridge.PlanBunkerGoal(goalKey);
  } else {
    log('Invoking PlannerBridge.PlanBunker() ...');
    planText = exports.FluidHtnWasm.PlannerBridge.PlanBunker();
  }
  log('PlanBunker returned length =', planText?.length ?? 0);
  const steps = (planText || '').split('\n').filter(Boolean);
  log('Parsed steps count =', steps.length);
  const t1 = performance.now();

  // Pretty print
  console.log('--- PLAN RESULT ---');
  for (const s of steps) {
    console.log(formatHuman(s));
  }
  console.log(`\n(planned in ${Math.round(t1 - t0)} ms)`);

  // Compare to expected answer (only for hasStar end-to-end mission)
  const compare = !goalKey || goalKey === 'hasStar';
  if (compare) {
    const expectedLines = [
      'Move to table_area',
      'Pick up key',
      'Move to courtyard',
      'Move to storage_door',
      'Unlock storage door with key',
      'Move to storage_interior',
      'Move to c4_table',
      'Pick up C4',
      'Move to storage_interior',
      'Move to storage_door',
      'Move to courtyard',
      'Move to bunker_door',
      'Place C4 on bunker',
      'Move to safe_spot',
      'Detonate C4 (boom)',
      'Move to bunker_door',
      'Move to bunker_interior',
      'Move to star_pos',
      'Pick up star',
    ];

    const actualLines = steps.map(formatHuman);
    const ok = comparePlans(actualLines, expectedLines);
    console.log(`\nMatch expected: ${ok ? 'YES' : 'NO'}`);
    if (!ok) {
      printDiff(actualLines, expectedLines);
      process.exitCode = 2;
    }
  } else {
    console.log('\n(Comparison skipped for goal:', goalKey, ')');
  }
}

function formatHuman(step) {
  const [op, arg] = step.split(' ');
  switch (op) {
    case 'MOVE':
      return `Move to ${arg}`;
    case 'UNLOCK_STORAGE':
      return 'Unlock storage door with key';
    case 'PICKUP_KEY':
      return 'Pick up key';
    case 'PICKUP_C4':
      return 'Pick up C4';
    case 'PLACE_C4':
      return 'Place C4 on bunker';
    case 'DETONATE':
      return 'Detonate C4 (boom)';
    case 'PICKUP_STAR':
      return 'Pick up star';
    default:
      return step;
  }
}

function comparePlans(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

function printDiff(actual, expected) {
  console.log('\n--- DIFF ---');
  const m = Math.max(actual.length, expected.length);
  for (let i = 0; i < m; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a === e) {
      console.log(`  ${i + 1}.  ${a}`);
    } else {
      console.log(`- ${i + 1}.  ${e ?? '(missing)'}`);
      console.log(`+ ${i + 1}.  ${a ?? '(missing)'}`);
    }
  }
}

function toGoal(key) {
  switch (key) {
    case 'agentAt_bunker_door':
      return { agentAt: 'bunker_door' };
    case 'bunkerBreached':
      return { bunkerBreached: true };
    case 'agentAt_bunker_interior':
      return { agentAt: 'bunker_interior' };
    case 'agentAt_c4_table':
      return { agentAt: 'c4_table' };
    case 'hasC4':
      return { hasC4: true };
    case 'agentAt_star':
      return { agentAt: 'star_pos' };
    case 'hasKey':
      return { hasKey: true };
    case 'hasStar':
    default:
      return { hasStar: true };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


