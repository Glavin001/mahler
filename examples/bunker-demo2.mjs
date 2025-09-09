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

// Undirected edges + state gates
const RAW_EDGES = [
  [N.COURTYARD,    N.TABLE,        () => true],
  [N.COURTYARD,    N.STORAGE_DOOR, () => true],
  [N.COURTYARD,    N.BUNKER_DOOR,  () => true],
  [N.COURTYARD,    N.SAFE,         () => true],
  [N.STORAGE_DOOR, N.STORAGE_INT,  (s) => s.storageUnlocked === true],
  [N.STORAGE_INT,  N.C4_TABLE,     () => true],
  // [N.BUNKER_DOOR,  N.BUNKER_INT,   (s) => s.bunkerBreached === true],
  [N.BUNKER_DOOR,  N.BUNKER_INT,   (s) => true],
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

// ---------------------------------------------------------------------------
// Primitive actions (effects only; we keep them side‑effect free here)
// ---------------------------------------------------------------------------

/**
 * FIXED Move task: use a lens on '/agentAt'.
 * Destination is passed as `target` (not a custom `to` field).
 */
const Move = Task.of().from({
  lens: '/agentAt',
  condition: (agentAt, { target, system }) =>
    agentAt !== target && isReachable(system, agentAt, target),
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
  description: 'Unlock storage door',
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
    !state.hasStar && state.starPresent && state.bunkerBreached && state.agentAt === N.STAR,
  effect: (state) => {
    state._.hasStar = true;
    state._.starPresent = false;
  },
  description: 'Pick up star',
});

// ---------------------------------------------------------------------------
// Methods (compound tasks)
// ---------------------------------------------------------------------------

const AcquireKey = Task.from({
  condition: (state) => !state.hasKey,
  method: (_state, ctx) => [
    // IMPORTANT: use Move({ target: <location> }) now
    Move({ target: N.TABLE }),
    PickUpKey({ target: ctx.target }),
  ],
  description: 'Acquire key',
});

const AcquireC4 = Task.from({
  condition: (state) => !state.hasC4,
  method: (state, ctx) => {
    const steps = [Move({ target: N.STORAGE_DOOR })];
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
    Move({ target: N.SAFE }),    // walk away to safe distance
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
  // MissionCollectStar,
  // AcquireKey,
  // AcquireC4,
  // BreachBunker,
  // GetStar,

  // Primitive actions
  Move,
  // PickUpKey,
  // UnlockStorage,
  // PickUpC4,
  // PlaceC4,
  // Detonate,
  PickUpStar,
];

// Goal: obtain the star
// const goal = { hasStar: true };
const goal = { agentAt: N.STAR };

const planner = Planner.from({
	tasks,
	config: { trace: readableTrace(console) },
});

const planResult = planner.findPlan(initial, goal);
// planResult is similar to what agent.wait() would eventually return, but is synchronous and only plans (does not execute).
console.log('\n--- PLAN RESULT ---');
console.log(stringify(planResult));
console.log('\n---');

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
