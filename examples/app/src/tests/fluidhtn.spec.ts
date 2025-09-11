import { describe, it, expect, beforeAll } from 'vitest';
import { planJsonOnWorker, planGoalOnWorker } from '../lib/fluidhtn.ts';

let dotnetUrl: string;

beforeAll(async () => {
  dotnetUrl = new URL('../../public/fluidhtn/_framework/dotnet.js', import.meta.url).href;
});

describe('FluidHTN WASM basic', () => {
  it('adjacent move via goal (courtyard -> bunker_door)', async () => {
    const res = await planGoalOnWorker(dotnetUrl, 'agentAt_bunker_door');
    const lines = (res || '').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe('MOVE bunker_door');
  });

  it('goal key hasKey should generate pickup sequence', async () => {
    const res = await planGoalOnWorker(dotnetUrl, 'hasKey');
    const lines = (res || '').split('\n').filter(Boolean);
    // Should include moving to table then pickup
    expect(lines[0]).toBe('MOVE table_area');
    expect(lines).toContain('PICKUP_KEY');
  });
});





