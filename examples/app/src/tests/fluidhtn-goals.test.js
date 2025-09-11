const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { planGoalOnWorker } = require('../lib/fluidhtn.js');

function parseLines(planText) {
	return (planText || '')
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s && !s.startsWith('#'));
}

function expectInOrder(lines, tokens) {
	let prev = -1;
	for (const t of tokens) {
		const idx = lines.indexOf(t);
		expect(idx).toBeGreaterThan(-1);
		expect(idx).toBeGreaterThan(prev);
		prev = idx;
	}
}

describe('FluidHTN WASM goals', () => {
	let dotnetUrl;
	beforeAll(async () => {
		const bundleDir = path.join(process.cwd(), 'public', 'fluidhtn', '_framework');
		dotnetUrl = pathToFileURL(path.join(bundleDir, 'dotnet.js')).href;
	});

	test('adjacent move via goal (courtyard -> bunker_door)', async () => {
		const planText = await planGoalOnWorker(dotnetUrl, 'agentAt_bunker_door');
		const lines = parseLines(planText);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		expect(lines[0]).toBe('MOVE bunker_door');
	});

	test('hasKey plan includes moving to table and pickup', async () => {
		const planText = await planGoalOnWorker(dotnetUrl, 'hasKey');
		const lines = parseLines(planText);
		expect(lines).toContain('PICKUP_KEY');
		expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY']);
	});

	test('hasC4 plan unlocks storage and picks up C4', async () => {
		const planText = await planGoalOnWorker(dotnetUrl, 'hasC4');
		const lines = parseLines(planText);
		expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY']);
		expect(lines).toContain('UNLOCK_STORAGE');
		expect(lines).toContain('PICKUP_C4');
		expectInOrder(lines, ['UNLOCK_STORAGE', 'PICKUP_C4']);
	});

	test('bunkerBreached plan places C4 and detonates', async () => {
		const planText = await planGoalOnWorker(dotnetUrl, 'bunkerBreached');
		const lines = parseLines(planText);
		expect(lines).toContain('PLACE_C4');
		expect(lines).toContain('DETONATE');
		expectInOrder(lines, ['PLACE_C4', 'DETONATE']);
	});

	test('hasStar plan completes full mission and picks up star', async () => {
		const planText = await planGoalOnWorker(dotnetUrl, 'hasStar');
		const lines = parseLines(planText);
		// Sanity: must contain the key milestones in correct order
		expectInOrder(lines, [
			'MOVE table_area',
			'PICKUP_KEY',
			'UNLOCK_STORAGE',
			'PICKUP_C4',
			'PLACE_C4',
			'DETONATE',
			'MOVE bunker_interior',
			'MOVE star_pos',
			'PICKUP_STAR',
		]);
		// Final step should be picking up the star
		expect(lines[lines.length - 1]).toBe('PICKUP_STAR');
	});
});
