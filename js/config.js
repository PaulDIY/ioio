'use strict';
/* ==========================================================================
 *  IOIO — GAME CONFIG
 *
 *  All content & balancing lives here: resources, node types (recipes),
 *  upgrades and goals. Everything is plain data or tiny functions, so you
 *  can experiment freely. After bigger changes use  ⚙ Menu → Reset game.
 * ========================================================================== */

/** World pixels per grid cell (at zoom 1). */
const GRID = 20;

const BALANCE = {
  tick: 0.05,                 // simulation step (seconds)
  offlineCapSec: 2 * 3600,    // max offline progress simulated when you come back
  dotSpeed: 5,                // visual item speed on connections (cells / second)
  buildCostGrowth: 1.5,       // each further node of a type costs × this (1 = flat)
  nodeMinWidth: 6,            // cells (keep even, so ports sit on grid lines)
  nodeHeight: 4,              // cells
};

/* --------------------------------------------------------------------------
 *  RESOURCES — id: { name, icon, color }
 * -------------------------------------------------------------------------- */
const RESOURCES = {
  wood:  { name: 'Wood',     icon: '🪵', color: '#b07a45' },
  water: { name: 'Water',    icon: '💧', color: '#3fa7ff' },
  stone: { name: 'Stone',    icon: '🪨', color: '#9ba3ad' },
  plank: { name: 'Planks',   icon: '🟫', color: '#e0b06a' },
  clay:  { name: 'Clay',     icon: '🟤', color: '#c8794a' },
  brick: { name: 'Bricks',   icon: '🧱', color: '#d0503a' },
  wheat: { name: 'Wheat',    icon: '🌾', color: '#e8c547' },
  sand:  { name: 'Sand',     icon: '⏳', color: '#ead9a0' },
  coal:  { name: 'Charcoal', icon: '⚫', color: '#6b7280' },
  ore:   { name: 'Iron Ore', icon: '⛏️', color: '#9b7fc0' },
  flour: { name: 'Flour',    icon: '🥣', color: '#f4efe2' },
  iron:  { name: 'Iron',     icon: '🔩', color: '#b9c7d6' },
  bread: { name: 'Bread',    icon: '🍞', color: '#d98f3c' },
  glass: { name: 'Glass',    icon: '🔷', color: '#7fe0e8' },
  gear:  { name: 'Gears',    icon: '⚙️', color: '#8fa3c8' },
  tools: { name: 'Tools',    icon: '🛠️', color: '#7cc47a' },
};

/* --------------------------------------------------------------------------
 *  NODE TYPES
 *
 *  Placing a node is free, but it stays a construction site until its `cost`
 *  has been delivered into its side inputs (cost resources alternate
 *  left / right). A type shows up in the Build menu once every resource in
 *  its cost has been produced at least once — that's how buildings unlock.
 *
 *  kind: 'producer' (default) | 'storage' | 'hub'
 *  recipe: { in: {res: amount}, out: {res: amount}, time: seconds per cycle }
 *          → one input port per ingredient (top), one output port per product (bottom)
 *  cost:        construction cost of the FIRST one (more get pricier, see BALANCE.buildCostGrowth)
 *  upgradeCost: base for upgrade costs (defaults to `cost`)
 *  Optional per-type overrides of upgrade base values:
 *    speed (multiplier, default 1), buffer (default 3), capacity / ports (storage)
 *  upgrades: [leftKey, rightKey] — which UPGRADES the side inputs feed once built
 *  color: header color (defaults to the first output's resource color)
 * -------------------------------------------------------------------------- */
const NODE_TYPES = {
  hub:     { kind: 'hub', name: 'Hub', buildable: false, color: '#e9b949', ports: 4, upgrades: [] },
  storage: { kind: 'storage', name: 'Storage', color: '#8a9bb0', capacity: 20, ports: 2, cost: { wood: 20 } },

  spring:     { name: 'Spring',     recipe: { in: {}, out: { water: 1 }, time: 1 },   cost: { wood: 10 } },
  lumberjack: { name: 'Lumberjack', recipe: { in: {}, out: { wood: 1 }, time: 1 },    cost: { water: 10 } },
  quarry:     { name: 'Quarry',     recipe: { in: {}, out: { stone: 1 }, time: 1.5 }, cost: { wood: 10 } },

  sawmill:    { name: 'Sawmill',    recipe: { in: { wood: 2 }, out: { plank: 1 }, time: 1 }, cost: { wood: 10, stone: 10 } },
  claypit:    { name: 'Clay Pit',   recipe: { in: { water: 1 }, out: { clay: 1 }, time: 1 }, cost: { wood: 15, stone: 10 } },

  kiln:       { name: 'Kiln',       recipe: { in: { clay: 2, wood: 1 }, out: { brick: 1 }, time: 2 }, cost: { stone: 20, clay: 10 } },
  farm:       { name: 'Farm',       recipe: { in: { water: 2 }, out: { wheat: 1 }, time: 2 },          cost: { plank: 10, water: 20 } },

  sandpit:    { name: 'Sand Pit',      recipe: { in: {}, out: { sand: 1 }, time: 1 },          cost: { plank: 15, stone: 15 } },
  charcoal:   { name: 'Charcoal Kiln', recipe: { in: { wood: 3 }, out: { coal: 1 }, time: 2 }, cost: { brick: 10, wood: 30 } },
  mill:       { name: 'Mill',          recipe: { in: { wheat: 2 }, out: { flour: 1 }, time: 2 }, cost: { plank: 20, brick: 10 } },
  mine:       { name: 'Mine',          recipe: { in: {}, out: { ore: 1 }, time: 2 },           cost: { plank: 20, brick: 15 } },

  smelter:    { name: 'Smelter',    recipe: { in: { ore: 2, coal: 1 }, out: { iron: 1 }, time: 3 },    cost: { brick: 30, stone: 30, coal: 10 } },
  bakery:     { name: 'Bakery',     recipe: { in: { flour: 2, water: 1 }, out: { bread: 1 }, time: 3 }, cost: { brick: 20, flour: 10 } },

  glassworks: { name: 'Glassworks', recipe: { in: { sand: 2, coal: 1 }, out: { glass: 1 }, time: 2 }, cost: { brick: 30, iron: 10, sand: 20 } },
  forge:      { name: 'Forge',      recipe: { in: { iron: 2 }, out: { gear: 1 }, time: 3 },            cost: { brick: 30, iron: 20 } },
  workshop:   { name: 'Workshop',   recipe: { in: { plank: 2, iron: 1 }, out: { tools: 1 }, time: 3 }, cost: { plank: 30, iron: 20 } },
};

/** Nodes placed at game start (already built). */
const START_NODES = [
  { type: 'hub', x: -5, y: -3 },
  { type: 'spring', x: -3, y: 7 },
];

/** Base values for connections (upgraded via UPGRADES.throughput). */
const CONNECTION = { throughput: 1 }; // items per second

/* --------------------------------------------------------------------------
 *  UPGRADES
 *
 *  Once built, a node's side inputs feed its upgrades (first key = left side,
 *  second = right side). A level may need several resources:
 *  cost(level, def) → { res: amount, ... } — each resource gets its own input
 *  on that side, and the level is reached when all are delivered.
 *
 *  target: 'producer' | 'storage' | 'connection'
 *  value(level, def)  → the stat at a given level (def = node type or CONNECTION)
 *  format(value)      → how the value is shown in the UI
 *  max                → max level
 *  Connections have no side inputs: their max level grows with completed
 *  goals → maxAt(goalsDone). Upgrading them is a free button.
 * -------------------------------------------------------------------------- */

/** Multiply every amount of a cost by `mult` (rounded up). */
function scaleCost(base, mult) {
  const out = {};
  for (const k in base) out[k] = Math.ceil(base[k] * mult);
  return out;
}

/** From these levels on, upgrades additionally need [resource, base amount]
 *  (only the highest one reached applies). */
const UPGRADE_EXTRAS = [[4, 'plank', 20], [8, 'brick', 30], [12, 'iron', 40], [16, 'gear', 50]];

/** Default upgrade cost: the node's build cost × mult × growth^level, plus an extra resource at higher levels. */
function upgradeCost(def, lvl, mult, growth) {
  const cost = scaleCost(def.upgradeCost || def.cost || { wood: 10 }, mult * growth ** lvl);
  let extra = null;
  for (const e of UPGRADE_EXTRAS) if (lvl >= e[0]) extra = e;
  if (extra) cost[extra[1]] = (cost[extra[1]] || 0) + Math.ceil(extra[2] * growth ** (lvl - extra[0]));
  return cost;
}

const UPGRADES = {
  // ---- producers (left: buffer, right: speed) ----------------------------
  buffer: {
    target: 'producer', label: 'Buffers', icon: '📦', max: 15,
    value: (lvl, def) => (def.buffer ?? 3) + 2 * lvl,
    format: v => `${Math.floor(v)}`,
    cost: (lvl, def) => upgradeCost(def, lvl, 1.5, 1.4),
  },
  speed: {
    target: 'producer', label: 'Speed', icon: '⚡', max: 20,
    value: (lvl, def) => (def.speed ?? 1) * (1 + 0.25 * lvl),
    format: v => `×${v.toFixed(2)}`,
    cost: (lvl, def) => upgradeCost(def, lvl, 3, 1.5),
  },

  // ---- storage (left: capacity, right: ports) ----------------------------
  capacity: {
    target: 'storage', label: 'Capacity', icon: '🗄️', max: 15,
    value: (lvl, def) => Math.round((def.capacity ?? 20) * 1.5 ** lvl),
    format: v => `${v}`,
    cost: (lvl, def) => upgradeCost(def, lvl, 1.5, 1.5),
  },
  ports: {
    target: 'storage', label: 'Ports', icon: '🔌', max: 2,
    value: (lvl, def) => (def.ports ?? 2) + lvl,
    format: v => `${v} in / ${v} out`,
    cost: lvl => ({ plank: 40 * 3 ** lvl, stone: 40 * 3 ** lvl }),
  },

  // ---- connections (free, unlocked by goals) -------------------------------
  throughput: {
    target: 'connection', label: 'Throughput', icon: '➰',
    maxAt: goalsDone => 1 + 2 * goalsDone,
    value: (lvl, def) => (def.throughput ?? 1) * (1 + 0.5 * lvl),
    format: v => `${v.toFixed(1)}/s`,
  },
};

/* --------------------------------------------------------------------------
 *  GOALS (milestones) — deliver `need` to the Hub to complete, in order.
 *  The Hub only accepts what the current goal still needs.
 *  Reward: higher connection throughput levels (UPGRADES.throughput.maxAt).
 * -------------------------------------------------------------------------- */
const MILESTONES = [
  { title: 'Clearing',       need: { wood: 20 } },
  { title: 'Foundations',    need: { wood: 50, stone: 30 } },
  { title: 'Carpentry',      need: { plank: 30, clay: 30 } },
  { title: 'Brickworks',     need: { brick: 40, wheat: 30 } },
  { title: 'Iron Age',       need: { coal: 30, ore: 40, flour: 20 } },
  { title: 'Craftsmen',      need: { iron: 50, bread: 30, sand: 40 } },
  { title: 'The Lighthouse', need: { glass: 100, gear: 60, tools: 60, brick: 200 } },
];
