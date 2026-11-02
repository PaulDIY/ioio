'use strict';
/* ==========================================================================
 *  MODEL — nodes, ports, buffers, connections and the game state.
 *  Content (recipes, numbers) comes from config.js.
 * ========================================================================== */

let _uid = 1;
const newId = () => _uid++;
const even = n => n + (n % 2);
const SIDES = ['left', 'right'];

class Buffer {
  constructor(res = null, need = 0) {
    this.res = res;       // resource held (null = undecided, storage only)
    this.amount = 0;
    this.cap = 1;
    this.need = need;     // recipe amount per cycle (producer buffers)
  }
  get space() { return this.cap - this.amount; }
}

class Port {
  constructor(node, dir, index, buffer, fixedRes = null) {
    this.node = node;
    this.dir = dir;           // 'in' | 'out'
    this.side = dir === 'in' ? 'top' : 'bottom'; // side inputs: 'left' | 'right'
    this.index = index;       // position on its edge (side inputs: slot = n-th resource of the side's cost)
    this.buffer = buffer;     // may be shared (storage) or null (hub, side inputs)
    this.fixedRes = fixedRes; // resource this port is made for (null = any / changes)
    this.conn = null;         // max one connection per port
  }
  /** Side input (construction / upgrades)? */
  get isSide() { return this.side === 'left' || this.side === 'right'; }
  /** Resource currently flowing through this port (null = any / undecided). */
  get res() {
    if (this.isSide) { const it = this.node.sideItem(this); return it ? it.res : null; }
    return this.fixedRes ?? (this.buffer ? this.buffer.res : null);
  }
}

/* --------------------------------------------------------------------------
 *  Nodes
 *
 *  A node starts as a construction site (built = false) unless it costs
 *  nothing. Its side inputs take the construction cost; once built they
 *  feed upgrades instead (left = 1st upgrade key, right = 2nd).
 *  Each resource a side currently needs gets its own input slot.
 * -------------------------------------------------------------------------- */
class GameNode {
  constructor(type, x, y, levels = {}) {
    this.id = newId();
    this.type = type;
    this.x = x; this.y = y;          // grid cell of the top-left corner
    this.levels = { ...levels };
    this.built = true;
    this.buildCost = {};             // what construction needs (fixed when placed)
    this.got = {};                   // delivered so far: { trackKey: { res: n } }
    this.inPorts = [];
    this.outPorts = [];
    this.sidePorts = { left: [], right: [] };
    this.buffers = [];
    this.status = 'idle';
    this.init();
    this.applyStats();
    this.syncSidePorts();
  }
  get def() { return NODE_TYPES[this.type]; }
  get kind() { return this.def.kind || 'producer'; }
  get name() { return this.def.name; }
  get color() { return this.def.color || '#7d8ba0'; }
  get upgPorts() { return [...this.sidePorts.left, ...this.sidePorts.right]; }
  get ports() { return [...this.inPorts, ...this.outPorts, ...this.upgPorts]; }
  get w() { return even(Math.max(BALANCE.nodeMinWidth, 2 * Math.max(this.inPorts.length, this.outPorts.length) + 2)); }
  get h() { return Math.max(BALANCE.nodeHeight, 2 + Math.max(this.sidePorts.left.length, this.sidePorts.right.length)); }

  // --- construction & upgrades ---
  get upgradeKeys() {
    return this.def.upgrades || Object.keys(UPGRADES).filter(k => UPGRADES[k].target === this.kind);
  }
  level(key) { return this.levels[key] || 0; }
  stat(key) { return UPGRADES[key].value(this.level(key), this.def); }
  gotOf(key, res) { return (this.got[key] && this.got[key][res]) || 0; }

  /** What a side input track currently asks for:
   *  { key: 'build' | upgradeKey, items: [{res, amount, got}], max? } or null. */
  sideTrack(side) {
    const si = SIDES.indexOf(side);
    const items = (key, cost) => Object.entries(cost).map(([res, amount]) => ({ res, amount, got: this.gotOf(key, res) }));
    if (!this.built) {
      // construction resources alternate left / right
      return { key: 'build', items: items('build', this.buildCost).filter((_, i) => i % 2 === si) };
    }
    const key = this.upgradeKeys[si];
    if (!key) return null;
    const u = UPGRADES[key], lvl = this.level(key);
    if (lvl >= (u.max ?? Infinity)) return { key, items: [], max: true };
    return { key, items: items(key, u.cost(lvl, this.def)) };
  }
  sideItem(port) { const t = this.sideTrack(port.side); return t ? t.items[port.index] : null; }

  /** Create / remove side inputs to match what the tracks need now. */
  syncSidePorts(game = null) {
    for (const side of SIDES) {
      const list = this.sidePorts[side];
      const t = this.sideTrack(side);
      const n = t ? t.items.length : 0;
      while (list.length < n) {
        const p = new Port(this, 'in', list.length, null);
        p.side = side;
        list.push(p);
      }
      while (list.length > n) {
        const p = list.pop();
        if (p.conn && game) game.disconnect(p.conn);
      }
    }
  }

  feedSide(port, res, game) {
    const key = this.sideTrack(port.side).key;
    this.got[key] = this.got[key] || {};
    this.got[key][res] = (this.got[key][res] || 0) + 1;
    if (key === 'build') {
      if (Object.entries(this.buildCost).some(([r, a]) => this.gotOf('build', r) < a)) return;
      this.built = true;
      delete this.got.build;
      this.syncSidePorts(game);
      game.emit('built', this);
      return;
    }
    if (this.sideTrack(port.side).items.some(it => it.got < it.amount)) return;
    delete this.got[key];
    this.levels[key] = this.level(key) + 1;
    this.applyStats();
    this.syncSidePorts(game);
    game.emit('upgrade', { node: this, key });
  }

  /** Ports sit on grid points: top/bottom 2 cells apart & centered, side slots one per row below the header. */
  portPos(port) {
    if (port.isSide) return { x: port.side === 'left' ? this.x : this.x + this.w, y: this.y + 2 + port.index };
    const list = port.dir === 'in' ? this.inPorts : this.outPorts;
    const start = (this.w - 2 * (list.length - 1)) / 2;
    return { x: this.x + start + 2 * port.index, y: port.dir === 'in' ? this.y : this.y + this.h };
  }

  // --- item transfer interface used by connections ---
  /** Would this input take `res` at all (ignoring space)? */
  accepts(port, res, game) {
    if (port.isSide) { const it = this.sideItem(port); return !!it && it.res === res; }
    return this.inAccepts(port, res, game);
  }
  canAccept(port, res, game) {
    if (port.isSide) { const it = this.sideItem(port); return !!it && it.res === res && it.got < it.amount; }
    return this.built && this.inAccepts(port, res, game) && this.inHasSpace(port, res, game);
  }
  accept(port, res, game) {
    if (port.isSide) this.feedSide(port, res, game);
    else this.inAccept(port, res, game);
  }
  /** Resource available on an output port, or null. */
  peek(port) { const b = port.buffer; return this.built && b && b.amount >= 1 ? b.res : null; }
  take(port) { port.buffer.amount -= 1; }

  // regular (top) inputs — overridden by the hub
  inAccepts(port, res) { const b = port.buffer; return !!b && (b.res == null || b.res === res); }
  inHasSpace(port) { return port.buffer.amount + 1 <= port.buffer.cap; }
  inAccept(port, res) { const b = port.buffer; if (b.res == null) b.res = res; b.amount += 1; }

  init() {}
  applyStats() {}
  update(dt, game) { if (!this.built) this.status = 'construction'; }
}

class ProducerNode extends GameNode {
  init() {
    const r = this.def.recipe;
    this.progress = 0;     // 0..1 of the current cycle
    this.running = false;  // inputs already consumed for the current cycle
    this.inBufs = Object.entries(r.in).map(([res, amt]) => new Buffer(res, amt));
    this.outBufs = Object.entries(r.out).map(([res, amt]) => new Buffer(res, amt));
    this.buffers = [...this.inBufs, ...this.outBufs];
    this.inPorts = this.inBufs.map((b, i) => new Port(this, 'in', i, b, b.res));
    this.outPorts = this.outBufs.map((b, i) => new Port(this, 'out', i, b, b.res));
  }
  get color() { return this.def.color || RESOURCES[this.outBufs[0]?.res]?.color || super.color; }
  get w() {
    const slots = this.buffers.length + (this.inBufs.length && this.outBufs.length ? 0.6 : 0);
    return even(Math.max(super.w, Math.ceil((slots * 26 + 36) / GRID)));
  }
  applyStats() {
    const cap = Math.floor(this.stat('buffer'));
    for (const b of this.buffers) b.cap = Math.max(cap, b.need);
  }
  /** Cycles per second at the current speed. */
  get cyclesPerSec() { return this.stat('speed') / this.def.recipe.time; }

  canStart() {
    return this.inBufs.every(b => b.amount >= b.need) && this.outBufs.every(b => b.space >= b.need);
  }

  update(dt, game) {
    if (!this.built) { this.status = 'construction'; return; }
    let t = dt * this.cyclesPerSec; // cycle fraction to advance this tick
    while (t > 0) {
      if (!this.running) {
        if (!this.canStart()) break;
        for (const b of this.inBufs) b.amount -= b.need;
        this.running = true;
      }
      const left = 1 - this.progress;
      if (t < left) { this.progress += t; break; }
      t -= left;
      this.progress = 0;
      this.running = false;
      for (const b of this.outBufs) { b.amount += b.need; game.discover(b.res); }
    }
    this.status = this.running ? 'working'
      : this.inBufs.some(b => b.amount < b.need) ? 'starved' : 'blocked';
  }
}

class StorageNode extends GameNode {
  init() {
    this.buf = new Buffer(null);
    this.buffers = [this.buf];
  }
  get color() { return RESOURCES[this.buf.res]?.color || super.color; }
  applyStats() {
    this.buf.cap = Math.floor(this.stat('capacity'));
    const n = Math.floor(this.stat('ports'));
    while (this.inPorts.length < n) this.inPorts.push(new Port(this, 'in', this.inPorts.length, this.buf));
    while (this.outPorts.length < n) this.outPorts.push(new Port(this, 'out', this.outPorts.length, this.buf));
  }
  clear() { this.buf.amount = 0; this.buf.res = null; }
}

/** Accepts only what the current goal still needs. */
class HubNode extends GameNode {
  get w() { return even(Math.max(10, 2 * this.inPorts.length + 2)); }
  get h() { return 5; }
  applyStats() {
    while (this.inPorts.length < (this.def.ports || 4)) this.inPorts.push(new Port(this, 'in', this.inPorts.length, null));
  }
  inAccepts(port, res, game) { const m = game.currentGoal; return !!m && !!m.need[res]; }
  inHasSpace(port, res, game) { return (game.msProgress[res] || 0) < game.currentGoal.need[res]; }
  inAccept(port, res, game) { game.deliver(res); }
}

const NODE_CLASSES = { producer: ProducerNode, storage: StorageNode, hub: HubNode };

function createNode(type, x, y, levels) {
  const Cls = NODE_CLASSES[NODE_TYPES[type].kind || 'producer'];
  return new Cls(type, x, y, levels);
}

/* --------------------------------------------------------------------------
 *  Connections: move items from one output port to one input port.
 * -------------------------------------------------------------------------- */
class Connection {
  constructor(from, to) {
    this.id = newId();
    this.from = from;          // output port
    this.to = to;              // input port (top or side)
    this.waypoints = [];       // [{x, y}] grid points
    this.level = 0;            // throughput level
    this.acc = 0;              // fractional item budget
    this.flow = 0;             // smoothed items/s (display)
    this.mismatch = false;     // item type not accepted by target
    this.dots = [];            // visual items in transit
    from.conn = this;
    to.conn = this;
  }
  get rate() { return UPGRADES.throughput.value(this.level, CONNECTION); }

  update(dt, game, visual) {
    const rate = this.rate;
    this.acc = Math.min(this.acc + rate * dt, Math.max(1, rate * dt));
    let moved = 0;
    this.mismatch = false;
    while (this.acc >= 1) {
      const res = this.from.node.peek(this.from);
      if (!res) break;
      if (!this.to.node.accepts(this.to, res, game)) { this.mismatch = true; break; }
      if (!this.to.node.canAccept(this.to, res, game)) break;
      this.from.node.take(this.from);
      this.to.node.accept(this.to, res, game);
      this.acc -= 1;
      moved++;
      if (visual && this.dots.length < 30) this.dots.push({ t: 0, res });
      if (this.to.conn !== this) break; // target input was removed (e.g. upgrade finished)
    }
    // display flow: average over ~1 s windows
    this.cnt = (this.cnt || 0) + moved;
    this.win = (this.win || 0) + dt;
    if (this.win >= 1) { this.flow = this.flow * 0.4 + (this.cnt / this.win) * 0.6; this.cnt = 0; this.win = 0; }
  }
}

/* --------------------------------------------------------------------------
 *  Game state
 * -------------------------------------------------------------------------- */
const SAVE_KEY = 'ioio-save-v3';

class Game {
  constructor() {
    this.onEvent = null; // (type, data) => void   — set by the UI
    this.reset();
  }

  reset() {
    this.nodes = [];
    this.conns = [];
    this.delivered = {};              // lifetime deliveries to the hub, per resource
    this.discovered = new Set();
    this.milestone = 0;
    this.msProgress = {};
    this.won = false;
    this.time = 0;
    for (const s of START_NODES) this.addNode(createNode(s.type, s.x, s.y));
  }

  emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  // ---- unlocks & goals ---------------------------------------------------
  /** A type can be built once every resource of its cost has been produced. */
  isUnlocked(type) {
    const def = NODE_TYPES[type];
    return def.buildable !== false && Object.keys(def.cost || {}).every(r => this.discovered.has(r));
  }
  get currentGoal() { return MILESTONES[this.milestone] || null; }

  deliver(res) {
    this.delivered[res] = (this.delivered[res] || 0) + 1;
    this.msProgress[res] = (this.msProgress[res] || 0) + 1;
    const m = this.currentGoal;
    if (Object.keys(m.need).every(r => (this.msProgress[r] || 0) >= m.need[r])) this.completeGoal();
  }

  completeGoal() {
    const m = this.currentGoal;
    this.milestone++;
    this.msProgress = {};
    this.emit('goal', m);
    if (this.milestone >= MILESTONES.length) { this.won = true; this.emit('win'); }
  }

  discover(res) {
    if (this.discovered.has(res)) return;
    const before = Object.keys(NODE_TYPES).filter(t => this.isUnlocked(t));
    this.discovered.add(res);
    this.emit('discover', res);
    const fresh = Object.keys(NODE_TYPES).filter(t => this.isUnlocked(t) && !before.includes(t));
    if (fresh.length) this.emit('unlock', fresh);
  }

  // ---- building -------------------------------------------------------------
  /** Construction cost of the next node of a type (grows with how many exist). */
  buildCost(type) {
    const n = this.nodes.filter(x => x.type === type).length;
    return scaleCost(NODE_TYPES[type].cost || {}, BALANCE.buildCostGrowth ** n);
  }

  /** Place a construction site near (cx, cy). */
  build(type, cx, cy) {
    if (!this.isUnlocked(type)) return null;
    const node = createNode(type, 0, 0);
    node.buildCost = this.buildCost(type);
    node.built = Object.keys(node.buildCost).length === 0;
    node.syncSidePorts();
    const spot = this.findFreeSpot(Math.round(cx - node.w / 2), Math.round(cy - node.h / 2), node.w, node.h);
    node.x = spot.x; node.y = spot.y;
    return this.addNode(node);
  }

  /** Highest throughput level connections may have right now. */
  get maxConnLevel() { return UPGRADES.throughput.maxAt(this.milestone); }

  upgradeConnection(conn) {
    if (conn.level >= this.maxConnLevel) return false;
    conn.level++;
    return true;
  }

  // ---- nodes & connections -------------------------------------------------
  addNode(node) { this.nodes.push(node); return node; }

  removeNode(node) {
    if (node.kind === 'hub') return;
    for (const p of node.ports) if (p.conn) this.disconnect(p.conn);
    this.nodes = this.nodes.filter(n => n !== node);
  }

  clearStorage(node) { if (node.kind === 'storage') node.clear(); }

  /** Can ports a and b be connected (in any order)? Returns error text or ''. */
  connectError(a, b) {
    if (a.dir === b.dir) return 'Connect an output (bottom) to an input';
    const from = a.dir === 'out' ? a : b, to = a.dir === 'out' ? b : a;
    if (to.isSide) return ''; // side inputs: any node, even itself; type is checked while running
    if (a.node === b.node) return 'Cannot connect a node to itself';
    const fr = from.fixedRes, tr = to.fixedRes;
    if (fr && tr && fr !== tr) return `${to.node.name} needs ${RESOURCES[tr].name}, not ${RESOURCES[fr].name}`;
    return '';
  }

  /** Connectable AND (for side inputs) carrying what that input currently needs. */
  wireFits(a, b) {
    if (this.connectError(a, b)) return false;
    const from = a.dir === 'out' ? a : b, to = a.dir === 'out' ? b : a;
    return !to.isSide || !from.res || from.res === to.res;
  }

  /** Connect two ports. Existing connections on them are replaced. `carry` restores
   *  level/waypoints of a re-wired connection. */
  connect(a, b, carry = null) {
    const err = this.connectError(a, b);
    if (err) { this.emit('error', err); return null; }
    const from = a.dir === 'out' ? a : b, to = a.dir === 'out' ? b : a;
    if (from.conn) this.disconnect(from.conn);
    if (to.conn) this.disconnect(to.conn);
    const c = new Connection(from, to);
    if (carry) {
      c.level = Math.min(carry.level || 0, this.maxConnLevel);
      c.waypoints = (carry.waypoints || []).map(p => ({ ...p }));
    }
    this.conns.push(c);
    return c;
  }

  disconnect(conn) {
    this.conns = this.conns.filter(c => c !== conn);
    if (conn.from.conn === conn) conn.from.conn = null;
    if (conn.to.conn === conn) conn.to.conn = null;
  }

  isFree(x, y, w, h, ignore = null) {
    return this.nodes.every(n => n === ignore ||
      x >= n.x + n.w + 1 || x + w + 1 <= n.x || y >= n.y + n.h + 1 || y + h + 1 <= n.y);
  }

  findFreeSpot(x, y, w, h) {
    for (let r = 0; r < 60; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.isFree(x + dx, y + dy, w, h)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return { x, y };
  }

  // ---- simulation -----------------------------------------------------------
  tick(dt, visual = true) {
    for (const n of this.nodes) n.update(dt, this);
    for (const c of [...this.conns]) if (this.conns.includes(c)) c.update(dt, this, visual);
    this.time += dt;
  }

  /** Fast-forward (offline progress / background tab). */
  simulate(seconds) {
    const step = Math.max(BALANCE.tick, 0.25);
    for (let t = 0; t < seconds; t += step) this.tick(Math.min(step, seconds - t), false);
  }

  // ---- save / load -----------------------------------------------------------
  serialize() {
    const portRef = p => [p.node.id, p.isSide ? p.side : p.dir, p.index];
    return {
      v: 3,
      savedAt: Date.now(),
      delivered: this.delivered,
      discovered: [...this.discovered],
      milestone: this.milestone,
      msProgress: this.msProgress,
      won: this.won,
      nodes: this.nodes.map(n => ({
        id: n.id, type: n.type, x: n.x, y: n.y, levels: n.levels,
        built: n.built, buildCost: n.buildCost, got: n.got,
        bufs: n.buffers.map(b => [b.res, b.amount]),
        progress: n.progress || 0, running: !!n.running,
      })),
      conns: this.conns.map(c => ({ from: portRef(c.from), to: portRef(c.to), wp: c.waypoints, level: c.level })),
    };
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); } catch (e) { /* private mode etc. */ }
  }

  /** Load from localStorage. Returns offline seconds simulated, or -1 if no save. */
  load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { d = null; }
    if (!d || d.v !== 3) return -1;
    try {
      this.restore(d);
    } catch (e) {
      console.warn('Save could not be loaded, starting fresh', e);
      this.reset();
      return -1;
    }
    const offline = Math.min(BALANCE.offlineCapSec, Math.max(0, (Date.now() - d.savedAt) / 1000));
    if (offline > 5) this.simulate(offline);
    return offline;
  }

  restore(d) {
    this.nodes = [];
    this.conns = [];
    this.delivered = d.delivered || {};
    this.discovered = new Set(d.discovered || []);
    this.milestone = d.milestone || 0;
    this.msProgress = d.msProgress || {};
    this.won = !!d.won;
    const byId = new Map();
    for (const s of d.nodes) {
      if (!NODE_TYPES[s.type]) continue; // type removed from config
      const n = createNode(s.type, s.x, s.y, s.levels);
      n.id = s.id;
      n.built = s.built !== false;
      n.buildCost = s.buildCost || {};
      n.got = s.got || {};
      n.syncSidePorts();
      n.buffers.forEach((b, i) => {
        const [res, amount] = s.bufs[i] || [null, 0];
        if (b.res == null) b.res = res;
        if (b.res === res) b.amount = Math.min(amount, b.cap);
      });
      if (n.kind === 'producer') { n.progress = s.progress; n.running = s.running; }
      byId.set(n.id, n);
      this.nodes.push(n);
    }
    if (!this.nodes.some(n => n.kind === 'hub')) this.addNode(createNode('hub', -5, -3));
    _uid = Math.max(_uid, ...this.nodes.map(n => n.id)) + 1;
    const findPort = ([id, where, index]) => {
      const n = byId.get(id);
      if (!n) return null;
      if (where === 'out') return n.outPorts[index];
      if (where === 'in') return n.inPorts[index];
      return n.sidePorts[where] && n.sidePorts[where][index];
    };
    for (const s of d.conns) {
      const fp = findPort(s.from), tp = findPort(s.to);
      if (!fp || !tp || this.connectError(fp, tp)) continue;
      this.connect(fp, tp, { level: s.level, waypoints: s.wp });
    }
  }
}
