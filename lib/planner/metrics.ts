import type { PlanNode, PlanAction } from './node';
import * as DAG from '../dag';

export function sumDuration(start: PlanNode<any> | null): number {
	const visited = new Set<PlanNode<any>>();
	const stack: Array<PlanNode<any> | null> = [start];
	let acc = 0;
	while (stack.length > 0) {
		const n = stack.pop();
		if (!n || visited.has(n)) {
			continue;
		}
		visited.add(n);
		if ((n as any).action) {
			acc += (n as PlanAction<any>).duration ?? 0;
			stack.push((n as PlanAction<any>).next as any);
		} else if (DAG.isFork(n)) {
			for (const b of (n as any).next) {
				stack.push(b);
			}
			stack.push((n as any).next);
		} else if ((n as any)._tag === 'join') {
			stack.push((n as any).next);
		}
	}
	return acc;
}

export function makespan(start: PlanNode<any> | null): number {
	const memo = new Map<PlanNode<any> | null, number>();
	const longest = (n: PlanNode<any> | null): number => {
		if (memo.has(n)) {
			return memo.get(n)!;
		}
		let res = 0;
		if (!n) {
			res = 0;
		} else if ((n as any).action) {
			const a = n as PlanAction<any>;
			res = (a.duration ?? 0) + longest(a.next as any);
		} else if (DAG.isFork(n)) {
			res = Math.max(0, ...(n as any).next.map((b: any) => longest(b)));
			res = Math.max(res, longest((n as any).next));
		} else if ((n as any)._tag === 'join') {
			res = longest((n as any).next);
		}
		memo.set(n, res);
		return res;
	};
	return longest(start);
}
