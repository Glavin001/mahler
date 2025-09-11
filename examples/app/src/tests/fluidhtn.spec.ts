import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, beforeAll } from '@jest/globals';
import { loadDotnet, planJson, planGoal } from '../lib/fluidhtn';

let exportsRef: any;

beforeAll(async () => {
  const bundleDir = path.join(process.cwd(), 'examples', 'app', 'public', 'fluidhtn', '_framework');
  const dotnetUrl = pathToFileURL(path.join(bundleDir, 'dotnet.js')).href;
  const { exports } = await loadDotnet(dotnetUrl);
  exportsRef = exports;
});

describe('FluidHTN WASM basic', () => {
  it('adjacent move via JSON (courtyard -> table_area)', async () => {
    const res = await planJson(exportsRef, {
      initial: { agentAt: 'courtyard' },
      goal: { agentAt: 'table_area' },
    });
    const lines = (res || '').split('\n').filter(Boolean);
    expect(lines).toEqual(['MOVE table_area']);
  });

  it('goal key hasKey should generate pickup sequence', async () => {
    const res = await planGoal(exportsRef, 'hasKey');
    const lines = (res || '').split('\n').filter(Boolean);
    // Should include moving to table then pickup
    expect(lines[0]).toBe('MOVE table_area');
    expect(lines).toContain('PICKUP_KEY');
  });
});


