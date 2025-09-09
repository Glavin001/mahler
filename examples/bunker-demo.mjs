/**
 * Bunker + Star demo using the Mahler HTN planner.
 *
 * Run:
 *   npm i mahler
 *   node bunker-demo.mjs
 */

import { Agent, Task } from 'mahler';
import { Planner } from 'mahler/planner';
import { stringify } from 'mahler/testing';
import { readableTrace } from 'mahler/utils';

// --- World model -------------------------------------------------------------

// Locations (simple 2D "areas"; movement = teleportation if a passable path exists)
const N = {
  COURTYARD: 'courtyard',
  TABLE: 'table_area',              // the key is here
  STORAGE_DOOR: 'storage_door',
  STORAGE_INT: 'storage_interior',
  C4_TABLE: 'c4_table',             // the C4 is here
  BUNKER_DOOR: 'bunker_door',
  BUNKER_INT: 'bunker_interior',
  STAR: 'star_pos',                 // the star is here
  SAFE: 'safe_spot',                // a safe distance for detonation
};

// Gate-aware undirected adjacency (edges can depend on the state)
const RAW_EDGES = [
  [N.COURTYARD,    N.TABLE,        () => true],
  [N.COURTYARD,    N.STORAGE_DOOR, () => true],
  [N.COURTYARD,    N.BUNKER_DOOR,  () => true],
  [N.COURTYARD,    N.SAFE,         () => true],
  // [N.STORAGE_DOOR, N.STORAGE_INT,  (s) => s.storageUnlocked === true],
  [N.STORAGE_DOOR, N.STORAGE_INT,  (s) => true],
  [N.STORAGE_INT,  N.C4_TABLE,     () => true],
  // [N.BUNKER_DOOR,  N.BUNKER_INT,   (s) => s.bunkerBreached === true],
  [N.BUNKER_DOOR,  N.BUNKER_INT,   (s) => true],
  [N.BUNKER_INT,   N.STAR,         () => true],
];

// Build an adjacency list that consults state for gated edges
function makeAdjacency(rawEdges) {
  const map = {};
  for (const [a, b, when] of rawEdges) {
    map[a] ||= [];
    map[b] ||= [];
    map[a].push({ to: b, when });
    map[b].push({ to: a, when });
  }
  return map;
}
const ADJ = makeAdjacency(RAW_EDGES);

function neighbors(state, from) {
  return (ADJ[from] || [])
    .filter((edge) => edge.when(state))
    .map((edge) => edge.to);
}

// Teleportation path check (BFS over the gated graph)
function isReachable(state, from, to) {
	if (!from) {
		throw new Error('from is required');
	}
	if (!to) {
		throw new Error('to is required');
	}
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

// --- Initial world state -----------------------------------------------------

const initial = {
  agentAt: N.COURTYARD,

  // Items and world
  keyOnTable: true,
  c4Available: true,
  starPresent: true,

  // Inventory / flags
  hasKey: false,
  hasC4: false,
  hasStar: false,

  // World conditions
  storageUnlocked: false,
  c4Placed: false,
  bunkerBreached: false,
};

// --- Primitive actions (effects + conditions) --------------------------------
//
// Notes:
// - In Mahler, an action is just a Task with an `effect` and optional `action`.
//   If you omit `action`, it uses `effect` as the action at runtime.
// - The planner calls `condition` to check applicability during planning.
// - The `effect` mutates state via the View wrapper: `state._`.
//   See Mahler’s basic usage and actions sections. :contentReference[oaicite:0]{index=0}

const Move = Task.from({
  lens: '/agentAt',
  condition: (agentAt, { system, target }) =>
    agentAt !== target && isReachable(system, agentAt, target),
  effect: (agentAt, { target }) => {
    agentAt._ = target;
  },
  description: ({ target }) => `Move to ${target}`,
});

const PickUpKey = Task.from({
  condition: (state) =>
    !state.hasKey && state.keyOnTable && state.agentAt === N.TABLE,
  effect: (state) => {
    state._.hasKey = true;
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
  description: 'Unlock storage door',
});

const PickUpC4 = Task.from({
  condition: (state) =>
    !state.hasC4 && state.c4Available && state.agentAt === N.C4_TABLE,
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
    state._.c4Placed = false; // consumed by blast
  },
  description: 'Detonate C4 (boom)',
});

const PickUpStar = Task.from({
  condition: (state) =>
    !state.hasStar && state.starPresent && state.bunkerBreached && state.agentAt === N.STAR,
  effect: (state) => {
    state._.hasStar = true;
    state._.starPresent = false;
  },
  description: 'Pick up star',
});

// --- Methods (HTN-style compound tasks) --------------------------------------
//
// In Mahler, you create a "method" by providing a `method` function in Task.from.
// The method returns a sequence of grounded tasks (we pass `target` through).
// The planner prefers methods over actions and expands them during planning. :contentReference[oaicite:1]{index=1}

const AcquireKey = Task.from({
  condition: (state) => !state.hasKey,
  method: (_state, ctx) => [
    Move({ target: N.TABLE }),
    PickUpKey({ target: ctx.target }),
  ],
  description: 'Acquire key',
});

const AcquireC4 = Task.from({
  condition: (state) => !state.hasC4,
  method: (state, ctx) => {
    const steps = [
      Move({ target: N.STORAGE_DOOR }),
    ];
    if (!state.storageUnlocked) {
      steps.push(UnlockStorage({ target: ctx.target }));
    }
    steps.push(
      Move({ target: N.C4_TABLE }),
      PickUpC4({ target: ctx.target }),
    );
    return steps;
  },
  description: 'Acquire C4',
});

const BreachBunker = Task.from({
  condition: (state) => !state.bunkerBreached,
  method: (_state, ctx) => [
    Move({ target: N.BUNKER_DOOR }),
    PlaceC4({ target: ctx.target }),
    Move({ target: N.SAFE }), // walk away a safe distance
    Detonate({ target: ctx.target }),
  ],
  description: 'Breach bunker',
});

const GetStar = Task.from({
  condition: (state) => !state.hasStar,
  method: (_state, ctx) => [
    Move({ target: N.STAR }),
    PickUpStar({ target: ctx.target }),
  ],
  description: 'Collect star',
});

// High-level mission method to structure the entire scenario:
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

// --- Build the agent & run ---------------------------------------------------

const tasks = [
  // Methods first, so the planner tries them before primitives.
  MissionCollectStar,
  AcquireKey,
  AcquireC4,
  BreachBunker,
  GetStar,

  // Primitive actions (the planner will use these when expanding methods).
  Move,
  PickUpKey,
  UnlockStorage,
  PickUpC4,
  PlaceC4,
  Detonate,
  PickUpStar,
];

const goal = { hasStar: true };
// const goal = { agentAt: N.BUNKER_DOOR };
// const goal = { agentAt: N.STAR };

/*
const agent = Agent.from({
  initial,
  tasks,
  // Optional readable trace logger that prints planning/execution in human terms
  // (Mahler exposes a `trace` hook and a `readableTrace` helper). :contentReference[oaicite:2]{index=2}
  opts: { trace: readableTrace(console) },
});

// The only goal we care about: having the star.
agent.seek(goal);

const result = await agent.wait();

console.log('\n--- RESULT ---');
console.log('Success:', result.success);
console.log('Final state:', result.state);
*/

const planner = Planner.from({
  tasks,
  config: { trace: readableTrace(console) },
});

const planResult = planner.findPlan(initial, goal);
// planResult is similar to what agent.wait() would eventually return, but is synchronous and only plans (does not execute).
console.log('\n--- RESULT ---');
console.log(stringify(planResult));
