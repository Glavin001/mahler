const { Worker } = require('worker_threads');
const path = require('node:path');

function runWorker(dotnetUrl, msg) {
	return new Promise((resolve, reject) => {
		const workerPath = path.join(__dirname, 'fluidhtn-worker.mjs');
		const worker = new Worker(workerPath, { type: 'module' });
		const cleanup = () => worker.terminate().catch(() => void 0);
		const onErr = (err) => { cleanup(); reject(err); };
		worker.once('error', onErr);
		worker.once('message', (m) => {
			if (m?.type === 'ready') {
				worker.once('message', (m2) => {
					cleanup();
					if (m2?.type === 'result') return resolve(m2.result);
					return reject(new Error(m2?.error || 'Unknown worker error'));
				});
				worker.postMessage(msg);
			} else if (m?.type === 'error') {
				cleanup();
				reject(new Error(m.error));
			}
		});
		worker.postMessage({ cmd: 'init', dotnetUrl });
	});
}

async function runDemoOnWorker(dotnetUrl) {
	return runWorker(dotnetUrl, { cmd: 'runDemo', dotnetUrl });
}

async function planGoalOnWorker(dotnetUrl, goalKey) {
	return runWorker(dotnetUrl, { cmd: 'planGoal', dotnetUrl, goalKey });
}

async function planJsonOnWorker(dotnetUrl, payload) {
	return runWorker(dotnetUrl, { cmd: 'planJson', dotnetUrl, json: JSON.stringify(payload) });
}

module.exports = {
	runDemoOnWorker,
	planGoalOnWorker,
	planJsonOnWorker,
};
