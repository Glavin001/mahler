const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runDemoOnWorker } = require('../lib/fluidhtn.js');

describe('FluidHTN WASM demo', () => {
	let dotnetUrl;
	beforeAll(async () => {
		const dir = path.join(process.cwd(), 'public', 'fluidhtn', '_framework');
		dotnetUrl = pathToFileURL(path.join(dir, 'dotnet.js')).href;
	});

	test('RunDemo returns expected sequence shape', async () => {
		const s = await runDemoOnWorker(dotnetUrl);
		// basic sanity: contains known actions and is comma-separated
		expect(typeof s).toBe('string');
		const parts = s.split(',');
		expect(parts.length).toBeGreaterThanOrEqual(2);
		expect(parts).toContain('Get A');
		expect(parts).toContain('Get B');
		expect(parts).toContain('Get C');
		expect(parts).toContain('Done');
	});
});


