const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { planGoalOnWorker } = require('../lib/fluidhtn.cjs');

describe('FluidHTN WASM basic', () => {
	let dotnetUrl;
	beforeAll(async () => {
		const bundleDir = path.join(process.cwd(), 'public', 'fluidhtn', '_framework');
		dotnetUrl = pathToFileURL(path.join(bundleDir, 'dotnet.js')).href;
	});

	test('adjacent move via goal (courtyard -> table_area)', async () => {
		const planText = await planGoalOnWorker(dotnetUrl, 'agentAt_table_area');
		const lines = (planText || '').split('\n').filter(Boolean);
		expect(lines).toEqual(['MOVE table_area']);
	});
});
