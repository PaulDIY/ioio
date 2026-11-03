# ioio

A mobile-first node-based production game. Plain HTML/Canvas/JS, no build step.

## Run

- **Desktop:** open `index.html` in a browser.
- **Phone:** `python3 -m http.server 8000` in this folder, then open `http://<your-computer-ip>:8000` on the phone (same Wi-Fi).

Progress autosaves to `localStorage` and keeps producing while you're away (capped by `BALANCE.offlineCapSec`).
Debug from the dev console via `ioio.game` (e.g. `ioio.game.milestone = 3; ioio.game.recomputeUnlocks()`).

## Rules

- **No stock or currency.** You start with the Hub and a free Spring.
- **Construction:** placing a node is free, but it's a 🏗 site until its materials arrive at its **side inputs** (one input per material, alternating left / right). Each further node of a type costs more (`BALANCE.buildCostGrowth`).
- **Unlocking:** a building appears in the Build menu once every material it needs has been produced at least once (Spring → water → Lumberjack → wood → Quarry …).
- **Upgrades:** once built, the side inputs take upgrade materials: 📦 buffers on the left, ⚡ speed on the right (storage: capacity / ports). A level can need several materials → several inputs on that side; rings show progress.
- **Goals:** the Hub accepts only what the current goal still needs; everything else stops there (red dashed line). Each completed goal upgrades the throughput of all connections.
- **Conveyor belts:** items travel along connections (`BALANCE.beltSpeed`). An output only sends while the target's input buffer plus the items already on the way stay below its capacity (the same goes for side inputs and the Hub's remaining goal amounts) — so long belts need bigger buffers.
- Demolishing a node loses everything delivered to it; deleting a connection loses the items on it.

## Controls

| Action | Gesture |
|---|---|
| Pan / zoom | drag empty space or WASD / arrow keys / pinch (mouse wheel) |
| Move node | drag it (snaps to grid, keeps connections) |
| Connect | drag from an output (bottom) to an input (top), or just onto the target node |
| Re-wire / delete | drag a connected port somewhere else / onto empty space |
| Waypoints | tap a connection, drag a ＋ handle; tap a waypoint to delete it |
| Inspect / upgrade | tap a node or connection |
| Construct / upgrade | connect outputs to a node's left / right side inputs, or drop the wire on the node (a built node can feed itself) |
| Clear storage | small ✕ in the storage header |

## Files

| File | What |
|---|---|
| `js/config.js` | **Everything to tweak**: resources, node types & recipes, upgrade formulas, goals, balance |
| `js/model.js` | `GameNode` (+ `ProducerNode`, `StorageNode`, `HubNode`), `Connection`, `Game` (sim, goals, save) |
| `js/geom.js` | grid routing for connections, hit-test math, camera |
| `js/render.js` | canvas drawing |
| `js/input.js` | touch / mouse gestures |
| `js/ui.js` | bottom sheets, goal bar, toasts |

## Tweaking (all in `config.js`)

**New resource:** add to `RESOURCES` → `gem: { name: 'Gems', icon: '💎', color: '#5ee' }`

**New node:** add to `NODE_TYPES`; ports & buffers are derived from the recipe, side inputs from the cost:

```js
jeweler: { name: 'Jeweler', recipe: { in: { gem: 1, iron: 1 }, out: { ring: 1 }, time: 4 },
           cost: { brick: 20, gem: 5 }, speed: 0.5, buffer: 5 },   // speed/buffer = optional base overrides
```

It unlocks automatically once bricks and gems have been produced. Multiple outputs work too: `out: { plank: 1, sawdust: 1 }`.
Starting nodes are in `START_NODES`.

**Upgrades:** each entry in `UPGRADES` is `{ target, value(level, def), cost(level, def), format, max }`.
`cost` may return several resources per level (`{ wood: 30, plank: 20 }`) — each gets its own side input.
`target` decides what gets it (`producer`, `storage`, `connection`); the first two matching upgrades become the
left / right tracks. Override per type with `upgrades: ['speed', 'buffer']`.
The default `upgradeCost(def, lvl, mult, growth)` = build cost × mult × growth^level, plus one extra material from
`UPGRADE_EXTRAS` at higher levels. Per type you can set `upgradeCost: {...}` as a different base.
All connections are set to level `throughput.maxAt(goalsDone)` whenever a goal is completed.

**Balance knobs:** `BALANCE` (build cost growth, tick, offline cap, node size).

After changing things that affect existing saves: ⚙ Menu → Reset game.

## Ideas for the main goal

1. **Monument (implemented as default):** a chain of goals delivered to the Hub, ending in a huge final build (the Lighthouse). Clear finish line, good for a first version.
2. **Orders / contracts:** traders request resource bundles with a timer and pay with a currency or blueprints. Gives replayable mid-game pressure.
3. **Prestige / expedition:** at the end, "ship" your production to a new island with different base resources and a permanent bonus. Encourages optimizing and restarting.
4. **Space-limited puzzle levels:** handcrafted maps with fixed grid area, obstacles and target rates (e.g. "2 bread/s"). Turns the routing into the core challenge.
5. **Living settlement:** villagers consume bread/water/tools over time; population unlocks tech. A soft goal that keeps the factory running.
