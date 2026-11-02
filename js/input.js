'use strict';
/* ==========================================================================
 *  INPUT — pointer events (touch + mouse), pan / pinch-zoom, drag nodes,
 *  draw & re-wire connections, edit waypoints.
 *
 *  One finger:  empty space → pan      node → move       port → wire
 *               "+" handle → new waypoint   waypoint → move (tap = delete)
 *  Two fingers: pan + pinch zoom.     Mouse wheel: zoom.
 * ========================================================================== */

const DRAG_THRESHOLD = 7;   // px before a press becomes a drag
const TOUCH_RADIUS = 18;    // px hit radius for ports & handles

class Input {
  constructor(canvas, game, view, ui) {
    Object.assign(this, { canvas, game, view, ui });
    this.pointers = new Map();
    this.g = null;      // current single-pointer gesture
    this.pinch = null;  // current two-finger gesture
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e, true));
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Pointer position in grid units. */
  gridAt(sx, sy) { const w = this.view.toWorld(sx, sy); return { x: w.x / GRID, y: w.y / GRID }; }
  radius() { return TOUCH_RADIUS / (this.view.zoom * GRID); } // grid units

  // ---- hit testing --------------------------------------------------------------
  hit(sx, sy) {
    const p = this.gridAt(sx, sy), r = this.radius();
    const sel = this.ui.selection;
    if (sel && sel.conn && this.game.conns.includes(sel.conn)) {
      const c = sel.conn;
      const wi = c.waypoints.findIndex(w => Math.hypot(w.x - p.x, w.y - p.y) < r);
      if (wi >= 0) return { type: 'waypoint', conn: c, index: wi };
      const m = connMidHandles(c).find(m => Math.hypot(m.x - p.x, m.y - p.y) < r);
      if (m) return { type: 'mid', conn: c, index: m.index };
    }
    const port = this.portAt(p);
    if (port) return { type: 'port', port };
    for (let i = this.game.nodes.length - 1; i >= 0; i--) {
      const n = this.game.nodes[i];
      if (p.x < n.x || p.x > n.x + n.w || p.y < n.y || p.y > n.y + n.h) continue;
      if (n.kind === 'storage' && n.buf.res && p.y < n.y + 1 && p.x > n.x + n.w - 1.2) return { type: 'clear', node: n };
      return { type: 'node', node: n };
    }
    const c = this.connAt(p, r * 0.7);
    if (c) return { type: 'conn', conn: c };
    return null;
  }

  /** Port near p. Hit area extends mostly outside the node so headers stay draggable. */
  portAt(p, filter = null) {
    const r = Math.min(this.radius(), 1);
    let best = null, bd = Infinity;
    for (const n of this.game.nodes) {
      for (const port of n.ports) {
        if (filter && !filter(port)) continue;
        const pp = n.portPos(port);
        const inside = { top: p.y - pp.y, bottom: pp.y - p.y, left: p.x - pp.x, right: pp.x - p.x }[port.side]; // >0 = inside node
        if (inside > 0.45) continue;
        const d = Math.hypot(pp.x - p.x, pp.y - p.y);
        if (d < r && d < bd) { best = port; bd = d; }
      }
    }
    return best;
  }

  connAt(p, r) {
    let best = null, bd = r;
    for (const c of this.game.conns) {
      const d = distToPolyline(p, connRoute(c));
      if (d < bd) { best = c; bd = d; }
    }
    return best;
  }

  /** Where would a wire from `anchor` end if released at screen (sx, sy)? */
  wireTarget(sx, sy, anchor) {
    const p = this.gridAt(sx, sy);
    const ok = port => port !== anchor && !this.game.connectError(anchor, port);
    const port = this.portAt(p, ok);
    if (port) return port;
    // dropped on a node body → pick the best fitting port (free + exact type first, recipe inputs before upgrades)
    const n = this.game.nodes.find(n => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h);
    if (!n) return null;
    const cands = (anchor.dir === 'out' ? [...n.inPorts, ...n.upgPorts] : n.outPorts).filter(q => this.game.wireFits(anchor, q));
    const score = q => (q.conn ? 0 : 4) + (q.res && q.res === anchor.res ? 2 : 0) + (q.isSide ? 0 : 1);
    return cands.sort((a, b) => score(b) - score(a))[0] || null;
  }

  // ---- pointer events -----------------------------------------------------------
  down(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this.cancel(); this.pinch = this.pinchState(); return; }
    if (this.pointers.size > 2) return;
    const h = this.hit(e.clientX, e.clientY);
    const kind = !h ? 'pan' : { port: 'wire', node: 'node', waypoint: 'waypoint', mid: 'mid', clear: 'tap', conn: 'pan' }[h.type];
    const w = this.view.toWorld(e.clientX, e.clientY);
    this.g = { hit: h, kind, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, wsx: w.x, wsy: w.y, moved: false };
    if (h && h.type === 'port') this.g.port = h.port;
    if (h && h.type === 'node') { this.g.ox = h.node.x; this.g.oy = h.node.y; }
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) {
      if (this.pointers.size < 2) return;
      const p = this.pinchState(), v = this.view;
      v.x -= (p.cx - this.pinch.cx) / v.zoom;
      v.y -= (p.cy - this.pinch.cy) / v.zoom;
      v.zoomAt(p.cx, p.cy, p.d / this.pinch.d);
      this.pinch = p;
      return;
    }
    const g = this.g;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.moved && Math.hypot(g.x - g.sx, g.y - g.sy) > DRAG_THRESHOLD) {
      g.moved = true;
      this.beginDrag(g);
    }
    if (g.moved) this.drag(g, dx, dy);
  }

  up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    const g = this.g;
    this.g = null;
    if (!g) return;
    if (cancelled) { this.cancel(g); return; }
    if (!g.moved) this.tap(g);
    else this.drop(g);
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  // ---- gestures -------------------------------------------------------------------
  beginDrag(g) {
    if (g.kind === 'wire' && g.port.conn) {
      // pick up the existing connection at this end; the other end stays anchored
      const c = g.port.conn;
      g.carry = { level: c.level, waypoints: c.waypoints, original: [c.from, c.to] };
      g.port = g.port === c.to ? c.from : c.to;
      this.game.disconnect(c);
      if (this.ui.selection && this.ui.selection.conn === c) this.ui.select(null);
    }
    if (g.kind === 'mid') {
      const c = g.hit.conn;
      const p = this.snapped(g.x, g.y);
      if (!c.waypoints.length) c.waypoints = autoWaypoints(c); // make the automatic route editable
      c.waypoints.splice(g.hit.index, 0, p);
      g.kind = 'waypoint';
      g.hit = { type: 'waypoint', conn: c, index: g.hit.index };
    }
    if (g.kind === 'tap') g.kind = 'pan';
  }

  snapped(sx, sy) { const p = this.gridAt(sx, sy); return { x: Math.round(p.x), y: Math.round(p.y) }; }

  drag(g, dx, dy) {
    const v = this.view;
    switch (g.kind) {
      case 'pan':
        v.x -= dx / v.zoom;
        v.y -= dy / v.zoom;
        break;
      case 'node': {
        const n = g.hit.node, w = v.toWorld(g.x, g.y);
        const nx = Math.round(g.ox + (w.x - g.wsx) / GRID), ny = Math.round(g.oy + (w.y - g.wsy) / GRID);
        if ((nx !== n.x || ny !== n.y) && this.game.isFree(nx, ny, n.w, n.h, n)) { n.x = nx; n.y = ny; }
        break;
      }
      case 'waypoint':
        g.hit.conn.waypoints[g.hit.index] = this.snapped(g.x, g.y);
        break;
      case 'wire':
        g.wpos = v.toWorld(g.x, g.y);
        g.target = this.wireTarget(g.x, g.y, g.port);
        break;
    }
  }

  tap(g) {
    const h = g.hit;
    if (!h) return this.ui.select(null);
    switch (h.type) {
      case 'port': this.ui.select({ node: h.port.node }); break;
      case 'node': this.ui.select({ node: h.node }); break;
      case 'conn': this.ui.select({ conn: h.conn }); break;
      case 'clear': this.game.clearStorage(h.node); this.ui.toast('Storage cleared'); break;
      case 'waypoint': h.conn.waypoints.splice(h.index, 1); break;
    }
  }

  drop(g) {
    if (g.kind !== 'wire') return;
    const target = this.wireTarget(g.x, g.y, g.port);
    const c = target && this.game.connect(g.port, target, g.carry);
    if (c) { if (g.carry) this.ui.select({ conn: c }, false); return; }
    if (g.carry) this.ui.toast('Connection removed');
  }

  /** Abort a gesture (e.g. second finger landed). Restores a picked-up connection. */
  cancel(g = this.g) {
    this.g = null;
    if (g && g.kind === 'wire' && g.carry) this.game.connect(g.carry.original[0], g.carry.original[1], g.carry);
  }

  /** Auto-pan when dragging near the screen edge. Called every frame. */
  update(dt) {
    const g = this.g;
    if (!g || !g.moved || !['wire', 'node', 'waypoint'].includes(g.kind)) return;
    const v = this.view, m = 40;
    const top = 70, bottom = v.h - 90;
    const vx = g.x < m ? -1 : g.x > v.w - m ? 1 : 0;
    const vy = g.y < top ? -1 : g.y > bottom ? 1 : 0;
    if (!vx && !vy) return;
    const speed = 450 * dt / v.zoom;
    v.x += vx * speed;
    v.y += vy * speed;
    this.drag(g, 0, 0);
  }
}
