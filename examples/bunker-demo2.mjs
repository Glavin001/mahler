/**
 * Bunker + Star demo using the Mahler HTN planner.
 *
 * Run:
 *   npm i mahler
 *   node bunker-demo.mjs
 */

import { Agent, Task } from 'mahler';
import { Planner } from 'mahler/planner';
import { stringify, mermaid } from 'mahler/testing';
import { readableTrace } from 'mahler/utils';

// ---------------------------------------------------------------------------
// 2D world model (teleport movement if a traversable path exists)
// ---------------------------------------------------------------------------

const N = Object.freeze({
  COURTYARD: 'courtyard',
  TABLE: 'table_area',          // key is here
  STORAGE_DOOR: 'storage_door',
  STORAGE_INT: 'storage_interior',
  C4_TABLE: 'c4_table',         // C4 is here
  BUNKER_DOOR: 'bunker_door',
  BUNKER_INT: 'bunker_interior',
  STAR: 'star_pos',             // star is here (inside the bunker)
  SAFE: 'safe_spot',            // safe distance for detonation
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initial = {
  agentAt: N.COURTYARD,

  // World facts
  keyOnTable: true,      // informative; we gate pickup by hasKey anyway
  c4Available: true,     // informative
  starPresent: true,

  // Inventory
  hasKey: false,
  hasC4: false,
  hasStar: false,

  // Environment
  storageUnlocked: false,
  c4Placed: false,
  bunkerBreached: false,
};

// Undirected edges + state gates
const RAW_EDGES = [
  [N.COURTYARD,    N.TABLE,        () => true],
  [N.COURTYARD,    N.STORAGE_DOOR, () => true],
  [N.COURTYARD,    N.BUNKER_DOOR,  () => true],
  [N.COURTYARD,    N.SAFE,         () => true],
  [N.STORAGE_DOOR, N.STORAGE_INT,  (s) => s.storageUnlocked === true],
  [N.STORAGE_INT,  N.C4_TABLE,     () => true],
  [N.BUNKER_DOOR,  N.BUNKER_INT,   (s) => s.bunkerBreached === true],
	[N.BUNKER_DOOR,  N.SAFE,         () => true],
  [N.BUNKER_INT,   N.STAR,         () => true],
];

function makeAdjacency(raw) {
  const map = {};
  for (const [a, b, when] of raw) {
    (map[a] ||= []).push({ to: b, when });
    (map[b] ||= []).push({ to: a, when });
  }
  return map;
}
const ADJ = makeAdjacency(RAW_EDGES);

function neighbors(state, from) {
  return (ADJ[from] || [])
    .filter((e) => e.when(state))
    .map((e) => e.to);
}

/**
 * @deprecated Use isImmediatellyReachable instead such that it's clear
 * the granular steps taken to reach the target.
 */
function isReachable(state, from, to) {
  if (from === to) return true;
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    for (const n of neighbors(state, cur)) {
      if (seen.has(n)) continue;
      if (n === to) return true;
      seen.add(n);
      q.push(n);
    }
  }
  return false;
}

/**
 * Can be reached from current location to target location in one step
 * without any hops.
 */
function isImmediatellyReachable(state, from, to) {
	return neighbors(state, from).includes(to);
}

// Find a path as a sequence of neighbor-to-neighbor locations (inclusive)
function findPath(state, from, to) {
  if (from === to) return [from];
  const seen = new Set([from]);
  const q = [from];
  const prev = new Map();
  while (q.length) {
    const cur = q.shift();
    for (const n of neighbors(state, cur)) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let p = prev.get(to);
        while (p !== undefined) {
          path.push(p);
          p = prev.get(p);
        }
        path.reverse();
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Primitive actions (effects only; we keep them side‑effect free here)
// ---------------------------------------------------------------------------

/**
 * FIXED Move task: use a lens on '/agentAt'.
 * Destination is passed as `target` (not a custom `to` field).
 */
const Move = Task.of().from({
  lens: '/agentAt',
  condition: (agentAt, { target, system }) => {
    const res = agentAt !== target && isImmediatellyReachable(system, agentAt, target)
		// console.log('Move condition', { agentAt, target, res })
		return res
	},
  effect: (agentAt, { target }) => {
    agentAt._ = target; // teleport since path is traversable
  },
  description: ({ target }) => `Move to ${target}`,
});

const PickUpKey = Task.from({
  condition: (state) =>
    !state.hasKey && state.agentAt === N.TABLE,
  effect: (state) => {
    state._.hasKey = true;
    // Optional bookkeeping; not necessary for correctness:
    state._.keyOnTable = false;
  },
  description: 'Pick up key',
});

const UnlockStorage = Task.from({
  condition: (state) =>
    state.hasKey && !state.storageUnlocked && state.agentAt === N.STORAGE_DOOR,
  effect: (state) => {
    state._.storageUnlocked = true;
  },
  description: 'Unlock storage door with key',
});

const PickUpC4 = Task.from({
  condition: (state) =>
    !state.hasC4 && state.agentAt === N.C4_TABLE,
  effect: (state) => {
    state._.hasC4 = true;
    state._.c4Available = false;
  },
  description: 'Pick up C4',
});

const PlaceC4 = Task.from({
  condition: (state) =>
    state.hasC4 && !state.c4Placed && state.agentAt === N.BUNKER_DOOR,
  effect: (state) => {
    state._.hasC4 = false;
    state._.c4Placed = true;
  },
  description: 'Place C4 on bunker',
});

const Detonate = Task.from({
  condition: (state) =>
    state.c4Placed && !state.bunkerBreached && state.agentAt === N.SAFE,
  effect: (state) => {
    state._.bunkerBreached = true;
    state._.c4Placed = false; // consumed
  },
  description: 'Detonate C4 (boom)',
});

const PickUpStar = Task.from({
  condition: (state) =>
    !state.hasStar && state.starPresent && state.agentAt === N.STAR,
  effect: (state) => {
    state._.hasStar = true;
    state._.starPresent = false;
  },
  description: 'Pick up star',
});

// ---------------------------------------------------------------------------
// Methods (compound tasks)
// ---------------------------------------------------------------------------

const GoTo = Task.of().from({
  lens: '/agentAt',
  condition: (agentAt, { target }) => agentAt !== target,
	// Ensure each Move updates 'agentAt' before the next Move
	expansion: 'sequential',
  method: (agentAt, { system, target }) => {
    const path = findPath(system, agentAt, target);
    if (!path || path.length < 2) return [];
    // Create a Move for each immediate step along the path
    return path.slice(1).map((step) => {
			return Move({ target: step });
		});
  },
  description: ({ target }) => `Go to ${target}`,
});

const AcquireKey = Task.from({
  condition: (state) => !state.hasKey,
	expansion: 'sequential',
  method: (_state, ctx) => [
    // IMPORTANT: use Move({ target: <location> }) now
    GoTo({ target: N.TABLE }),
    PickUpKey({ target: ctx.target }),
  ],
  description: 'Acquire key',
});

const AcquireC4 = Task.from({
  condition: (state) => !state.hasC4,
	expansion: 'sequential',
	// condition: (state, { target }) => !state.hasC4 && target?.hasC4 === true,
  method: (state, ctx) => {
    const steps = [GoTo({ target: N.STORAGE_DOOR })];
    if (!state.storageUnlocked) {
      steps.push(UnlockStorage({ target: ctx.target }));
    }
    steps.push(
      GoTo({ target: N.C4_TABLE }),
      PickUpC4({ target: ctx.target }),
    );
    return steps;
  },
  description: 'Acquire C4',
});

const BreachBunker = Task.from({
  condition: (state) => !state.bunkerBreached,
	expansion: 'sequential',
  method: (state, ctx) => {
		const steps = [];
		if (!state.c4Placed) {
			steps.push(
				GoTo({ target: N.BUNKER_DOOR }),
				PlaceC4({ target: ctx.target })
			);
    }
    steps.push(
      GoTo({ target: N.SAFE }),    // walk away to safe distance
      Detonate({ target: ctx.target }),
    );
    return steps;
  },
  description: 'Breach bunker',
});

const GetStar = Task.from({
	condition: (state, { target }) => !state.hasStar && target?.hasStar === true,
	expansion: 'sequential',
  method: (_state, ctx) => [
    GoTo({ target: N.STAR }),
    PickUpStar({ target: ctx.target }),
  ],
  description: 'Collect star',
});

const MissionCollectStar = Task.from({
  condition: (state, { target }) => !state.hasStar && target?.hasStar === true,
  method: (_state, ctx) => [
    AcquireKey({ target: ctx.target }),
    AcquireC4({ target: ctx.target }),
    BreachBunker({ target: ctx.target }),
    GetStar({ target: ctx.target }),
  ],
  description: 'Mission: collect the star',
});

// ---------------------------------------------------------------------------
// Assemble agent and run
// ---------------------------------------------------------------------------

const tasks = [
  // Methods first to guide the planner
  GoTo,
  // MissionCollectStar,
  AcquireKey,
  AcquireC4,
  BreachBunker,
  GetStar,

  // Primitive actions
  Move,
  PickUpKey,
  UnlockStorage,
  PickUpC4,
  PlaceC4,
  Detonate,
  PickUpStar,
];

// Goal: obtain the star
const goal = { hasStar: true };
// const goal = { agentAt: N.BUNKER_DOOR };
// const goal = { bunkerBreached: true };
// const goal = { agentAt: N.BUNKER_INT };
// const goal = { agentAt: N.C4_TABLE };
// const goal = { hasC4: true };
// const goal = { agentAt: N.STAR };
// const goal = { hasKey: true };

const trace = mermaid();
const planner = Planner.from({
	tasks,
	config: {
		// trace: readableTrace(console)
		trace,
	},
});

const planResult = planner.findPlan(initial, goal);
// planResult is similar to what agent.wait() would eventually return, but is synchronous and only plans (does not execute).
console.log('\n--- PLAN RESULT ---');
console.log(stringify(planResult));

console.log('\n--- PLAN RESULT (MERMAID) ---');
console.log(trace.render());
console.log('\n---');

/*
console.log('\n--- AGENT ---');
const agent = Agent.from({
  initial,
  tasks,
  opts: { trace: readableTrace(console) },
});

agent.seek(goal);

const result = await agent.wait();

console.log('\n--- AGENT RESULT ---');
console.log('Success:', result.success);
console.log('Final state:', result.state);

console.log('\n---');
*/
