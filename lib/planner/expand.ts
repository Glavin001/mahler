import type { Operation as PatchOperation } from 'mahler-wasm';
import { diff as createPatch, patch as applyPatch } from 'mahler-wasm';

import assert from '../assert';
import type { Distance } from '../distance';
import { Ref } from '../ref';
import type { Action, Instruction } from '../task';
import { Method, MethodExpansion } from '../task';
import { PlanAction } from './node';
import type { Plan } from './plan';
import type { PlannerConfig } from './types';
import { Aborted, ConditionNotMet, LoopDetected } from './types';
import * as DAG from '../dag';
import type { Operation } from '../operation';

export interface PlanningState<TState = any> {
	distance: Distance<TState>;
	tasks: any[];
	depth?: number;
	operation?: Operation<TState, any>;
	trace: PlannerConfig<TState>['trace'];
	initialPlan: Plan<TState>;
	callStack?: Array<Method<TState>>;
	maxSearchDepth: number;
}

function tryAction<TState = any>(
	action: Action<TState>,
	{ initialPlan, callStack = [] }: PlanningState<TState>,
): Plan<TState> {
	assert(initialPlan.success);

	const node = PlanAction.from(initialPlan.state, action);
	const id = node.id;

	if (
		DAG.find(initialPlan.start, (a: PlanAction<TState>) => a.id === id) != null
	) {
		return { success: false, stats: initialPlan.stats, error: LoopDetected };
	}

	const ref = Ref.of(structuredClone(initialPlan.state));
	action.effect(ref);
	const state = ref._;

	const changes = createPatch(initialPlan.state, state);

	if (changes.length === 0 && callStack.length === 0) {
		return initialPlan;
	}

	const start = DAG.createValue({
		id,
		action,
		duration: node.duration,
		next: initialPlan.start,
	});

	return {
		success: true,
		start,
		stats: initialPlan.stats,
		state,
		pendingChanges: initialPlan.pendingChanges.concat(changes),
	};
}

function trySequential<TState = any>(
	method: Method<TState>,
	{
		initialPlan,
		callStack = [],
		maxSearchDepth,
		...pState
	}: PlanningState<TState>,
): Plan<TState> {
	assert(initialPlan.success);

	if (callStack.length > maxSearchDepth) {
		throw new Aborted(
			`Maximum search depth ${maxSearchDepth} reached on recursion`,
			initialPlan.stats,
		);
	}

	const output = method(initialPlan.state);
	const instructions = Array.isArray(output) ? output : [output];

	const plan: Plan<TState> = { ...initialPlan };
	const cStack = [...callStack, method];
	for (const i of instructions) {
		const res = expandInstruction(i, {
			...pState,
			initialPlan: plan,
			callStack: cStack,
			maxSearchDepth,
			trace: pState.trace,
		});
		if (!res.success) {
			return res;
		}
		plan.start = res.start;
		plan.state = res.state;
		plan.pendingChanges = res.pendingChanges;
	}

	return plan;
}

function findConflict(
	ops: PatchOperation[][],
): [PatchOperation, PatchOperation] | undefined {
	const unique = new Map<string, [number, PatchOperation]>();

	for (const [i, patches] of ops.entries()) {
		for (const o of patches) {
			for (const [path, [index, op]] of unique.entries()) {
				if (
					i !== index &&
					(o.path.startsWith(path) || path.startsWith(o.path))
				) {
					return [o, op];
				}
			}
			unique.set(o.path, [i, o]);
		}
	}
}

function tryParallel<TState = any>(
	parallel: Method<TState>,
	{
		trace,
		initialPlan,
		callStack = [],
		maxSearchDepth,
		...pState
	}: PlanningState<TState>,
): Plan<TState> {
	assert(initialPlan.success);

	if (callStack.length > maxSearchDepth) {
		throw new Aborted(
			`Maximum search depth ${maxSearchDepth} reached on recursion`,
			initialPlan.stats,
		);
	}
	const output = parallel(initialPlan.state);
	const instructions = Array.isArray(output) ? output : [output];

	if (instructions.length === 0) {
		return initialPlan;
	}

	const empty = DAG.createJoin(initialPlan.start);

	const results: Array<Plan<TState> & { success: true }> = [];
	const cStack = [...callStack, parallel];
	for (const i of instructions) {
		const res = expandInstruction(i, {
			...pState,
			trace,
			initialPlan: { ...initialPlan, start: empty },
			callStack: cStack,
			maxSearchDepth,
		});

		if (!res.success) {
			return res;
		}

		results.push(res as any);
	}

	const patches = results.map((r) => r.pendingChanges);
	const conflict = findConflict(patches);
	if (conflict != null) {
		trace({ event: 'parallel-conflict', conflict } as any);
		return trySequential(parallel, {
			trace,
			initialPlan,
			callStack,
			maxSearchDepth,
			...pState,
		});
	}

	const start = DAG.createFork(
		results.map((r) => r.start!).filter((r) => r != null),
	);

	const pendingChanges = results.reduce(
		(acc, r) => acc.concat(r.pendingChanges),
		initialPlan.pendingChanges,
	);

	const state = applyPatch(structuredClone(initialPlan.state), pendingChanges);

	return {
		success: true,
		state,
		pendingChanges,
		start,
		stats: initialPlan.stats,
	};
}

export function expandInstruction<TState = any>(
	instruction: Instruction<TState>,
	{ trace, initialPlan, callStack = [], ...state }: PlanningState<TState>,
): Plan<TState> {
	assert(initialPlan.success);
	trace({
		event: 'try-instruction',
		operation: state.operation!,
		parent: callStack[callStack.length - 1],
		instruction,
		state: initialPlan.state,
		prev: initialPlan.start,
	});

	if (!instruction.condition(initialPlan.state)) {
		return { success: false, stats: initialPlan.stats, error: ConditionNotMet };
	}

	let res: Plan<TState>;
	if (Method.is(instruction)) {
		if (instruction.expansion === MethodExpansion.SEQUENTIAL) {
			res = trySequential(instruction, {
				...state,
				trace,
				initialPlan,
				callStack,
			});
		} else {
			res = tryParallel(instruction, {
				...state,
				trace,
				initialPlan,
				callStack,
			});
		}
	} else {
		res = tryAction(instruction, { ...state, trace, initialPlan, callStack });
	}

	return res;
}
