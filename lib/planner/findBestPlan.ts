import { patch as applyPatch } from 'mahler-wasm';

import { Distance } from '../distance';
import { Lens } from '../lens';
import { Pointer } from '../pointer';
import type { Task } from '../task';
import { expandInstruction } from './expand';
import { sumDuration, makespan } from './metrics';
import { isTaskApplicable } from './utils';
import { Aborted, MethodExpansionEmpty, SearchFailed } from './types';
import type { PlannerConfig } from './types';
import type { Plan } from './plan';
import type { Operation } from '../operation';

type Objective = 'sum' | 'makespan' | ((start: any) => number);

export interface BestPlanOptions {
	objective?: Objective;
	maxNodes?: number;
	maxDepth?: number;
	timeLimitMs?: number;
	trace?: PlannerConfig<any>['trace'];
}

type Node<TState> = {
	plan: Plan<TState> & { success: true };
	g: number;
	depth: number;
};

function score(start: any, objective: Objective): number {
	if (typeof objective === 'function') {
		return objective(start);
	}
	if (objective === 'makespan') {
		return makespan(start);
	}
	return sumDuration(start);
}

export function findBestPlan<TState>(
	current: TState,
	target: any,
	tasks: Array<Task<TState, any, any>>,
	config: PlannerConfig<TState>,
	opts: BestPlanOptions = {},
): Plan<TState> {
	const distance = Distance.from(current, target);
	const trace =
		opts.trace ??
		config.trace ??
		(() => {
			/* noop */
		});
	const maxDepth = opts.maxDepth ?? config.maxSearchDepth ?? 1000;
	const maxNodes = opts.maxNodes ?? Infinity;
	const timeLimitMs = opts.timeLimitMs ?? Infinity;
	const objective = opts.objective ?? 'sum';

	const startPlan: Plan<TState> & { success: true } = {
		success: true,
		start: null,
		state: current,
		stats: { iterations: 0, maxDepth: 0, time: 0 },
		pendingChanges: [],
	};

	const pq: Array<Node<TState>> = [{ plan: startPlan, g: 0, depth: 0 }];

	const popBest = () => {
		pq.sort((a, b) => a.g - b.g);
		return pq.shift()!;
	};

	const started = performance.now();
	let expanded = 0;

	while (pq.length > 0) {
		if (expanded++ > maxNodes) {
			break;
		}
		if (performance.now() - started > timeLimitMs) {
			break;
		}

		const cur = popBest();

		const ops = distance(cur.plan.state);
		if (ops.length === 0) {
			trace({ event: 'found', prev: cur.plan.start });
			return cur.plan;
		}

		if (cur.depth >= maxDepth) {
			throw new Aborted(
				`Maximum search depth reached (${maxDepth})`,
				cur.plan.stats,
			);
		}

		trace({
			event: 'find-next',
			depth: cur.depth,
			state: cur.plan.state,
			prev: cur.plan.start,
			operations: ops,
		});

		for (const operation of ops) {
			const applicable = tasks.filter((t) => isTaskApplicable(t, operation));
			for (const t of applicable) {
				cur.plan.stats.iterations++;
				const path = operation.path;
				const tgt =
					operation.op === 'delete'
						? undefined
						: Pointer.from<TState, string>(distance.target, path);
				const ctx = Lens.context<any, string>(t.lens, path, tgt);

				const childDelta = expandInstruction((t as any)(ctx as any), {
					distance,
					tasks,
					trace,
					operation: operation as Operation<TState, any>,
					initialPlan: cur.plan,
					callStack: [],
					depth: cur.depth,
					maxSearchDepth: maxDepth,
				});
				if (!childDelta.success) {
					trace(childDelta.error);
					continue;
				}
				if (childDelta.start === cur.plan.start) {
					trace(MethodExpansionEmpty);
					continue;
				}

				const childState = applyPatch(
					structuredClone(cur.plan.state),
					childDelta.pendingChanges,
				);

				const base = score(cur.plan.start, objective);
				const next = score(childDelta.start, objective);
				const delta = next - base;

				const childPlan: Plan<TState> & { success: true } = {
					...childDelta,
					state: childState,
					pendingChanges: [],
					stats: cur.plan.stats,
				};
				pq.push({ plan: childPlan, g: cur.g + delta, depth: cur.depth + 1 });
			}
		}
	}

	trace({ event: 'failed' });
	return { success: false, stats: startPlan.stats, error: SearchFailed };
}
