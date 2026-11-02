'use strict';
/* ==========================================================================
 *  RENDERER — draws the world on a canvas (world units = grid cells × GRID).
 * ========================================================================== */

const THEME = {
  bg: '#12161d',
  gridMinor: 'rgba(255,255,255,0.035)',
  gridMajor: 'rgba(255,255,255,0.07)',
  node: '#1d2430',
  text: '#e8edf3',
  textDim: '#8e9aab',
  wire: '#8a96a8',
  status: { working: '#4cd964', starved: '#f5a623', blocked: '#ff5b5b', idle: '#6b7684' },
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Polyline with rounded corners (points in world px). */
function tracePath(ctx, pts, radius) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    ctx.arcTo(b.x, b.y, c.x, c.y, r);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l.x, l.y);
}

const toPx = p => ({ x: p.x * GRID, y: p.y * GRID });

class Renderer {
  constructor(canvas, game, view, ui, input) {
    Object.assign(this, { canvas, game, view, ui, input });
    this.ctx = canvas.getContext('2d');
    this.time = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.view.w = w;
    this.view.h = h;
  }

  draw(dt) {
    const { ctx, view, game } = this;
    this.time += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = view.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, -view.x * z, -view.y * z);

    this.drawGrid();
    const sel = this.ui.selection || {};
    for (const c of game.conns) this.drawConn(c, dt, sel.conn === c);
    for (const n of game.nodes) if (this.visible(n)) this.drawNode(n, sel.node === n);
    if (sel.conn && game.conns.includes(sel.conn)) this.drawConnHandles(sel.conn);
    this.drawWirePreview();
  }

  visible(n) {
    const v = this.view, m = 2 * GRID;
    return n.x * GRID < v.x + v.w / v.zoom + m && (n.x + n.w) * GRID > v.x - m &&
           n.y * GRID < v.y + v.h / v.zoom + m && (n.y + n.h) * GRID > v.y - m - GRID;
  }

  drawGrid() {
    const { ctx, view } = this;
    const x0 = Math.floor(view.x / GRID), x1 = Math.ceil((view.x + view.w / view.zoom) / GRID);
    const y0 = Math.floor(view.y / GRID), y1 = Math.ceil((view.y + view.h / view.zoom) / GRID);
    const minor = GRID * view.zoom >= 8;
    ctx.lineWidth = 1 / view.zoom;
    for (const major of [false, true]) {
      if (!major && !minor) continue;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) if ((x % 5 === 0) === major) { ctx.moveTo(x * GRID, y0 * GRID); ctx.lineTo(x * GRID, y1 * GRID); }
      for (let y = y0; y <= y1; y++) if ((y % 5 === 0) === major) { ctx.moveTo(x0 * GRID, y * GRID); ctx.lineTo(x1 * GRID, y * GRID); }
      ctx.strokeStyle = major ? THEME.gridMajor : THEME.gridMinor;
      ctx.stroke();
    }
  }

  // ---- connections -----------------------------------------------------------
  drawConn(c, dt, selected) {
    const { ctx } = this;
    const pts = connRoute(c).map(toPx);
    const res = c.from.res;
    const color = res ? RESOURCES[res].color : THEME.wire;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePath(ctx, pts, 10);
    if (selected) { ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 11; ctx.stroke(); }
    ctx.strokeStyle = '#0a0d12'; ctx.lineWidth = 6.5; ctx.stroke();
    if (c.mismatch) { ctx.setLineDash([6, 5]); ctx.strokeStyle = '#ff5b5b'; }
    else ctx.strokeStyle = rgba(color, c.flow > 0.05 ? 0.95 : 0.5);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);

    // items in transit (visual only)
    const len = polyLength(pts);
    const step = BALANCE.dotSpeed * GRID * dt / Math.max(len, 1);
    c.dots = c.dots.filter(d => (d.t += step) < 1);
    for (const d of c.dots) {
      const p = pointAt(pts, d.t * len);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = RESOURCES[d.res]?.color || '#fff';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#0a0d12';
      ctx.stroke();
    }
  }

  drawConnHandles(c) {
    const { ctx, view } = this;
    const s = 1 / view.zoom;
    for (const m of connMidHandles(c)) {
      const p = toPx(m);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30,38,50,0.9)';
      ctx.fill();
      ctx.lineWidth = 1.5 * s;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 4 * s, p.y); ctx.lineTo(p.x + 4 * s, p.y);
      ctx.moveTo(p.x, p.y - 4 * s); ctx.lineTo(p.x, p.y + 4 * s);
      ctx.stroke();
    }
    for (const w of c.waypoints) {
      const p = toPx(w), r = 6 * s;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0a0d12';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawWirePreview() {
    const g = this.input.g;
    if (!g || g.kind !== 'wire' || !g.moved || !g.wpos) return;
    const { ctx, game } = this;
    ctx.lineJoin = 'round';
    const a = g.port;
    let pts;
    if (g.target) {
      const [f, t] = a.dir === 'out' ? [a, g.target] : [g.target, a];
      pts = connRoute({ from: f, to: t, waypoints: [] });
    } else {
      const ptr = { x: g.wpos.x / GRID, y: g.wpos.y / GRID };
      const { p, s } = portStub(a);
      pts = a.dir === 'out' ? simplify([p, s, ...elbow(s, ptr)]) : simplify([ptr, ...elbow(ptr, s), p]);
    }
    pts = pts.map(toPx);
    const res = a.res;
    tracePath(ctx, pts, 10);
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.lineWidth = 3;
    ctx.strokeStyle = res ? RESOURCES[res].color : '#ffffff';
    ctx.stroke();
    ctx.setLineDash([]);

    // highlight compatible ports
    const pulse = 0.45 + 0.35 * Math.sin(this.time * 6);
    for (const n of game.nodes) {
      for (const p of (a.dir === 'out' ? [...n.inPorts, ...n.upgPorts] : n.outPorts)) {
        if (!game.wireFits(a, p)) continue;
        const pp = toPx(n.portPos(p));
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, p === g.target ? 11 : 9, 0, Math.PI * 2);
        ctx.lineWidth = p === g.target ? 3 : 2;
        ctx.strokeStyle = p === g.target ? '#ffffff' : `rgba(255,255,255,${pulse})`;
        ctx.stroke();
      }
    }
  }

  // ---- nodes -------------------------------------------------------------------
  drawNode(n, selected) {
    const { ctx } = this;
    const x = n.x * GRID, y = n.y * GRID, w = n.w * GRID, h = n.h * GRID;
    const color = n.color;

    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fillStyle = THEME.node;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = rgba(color, 0.3);
    ctx.fillRect(x, y, w, GRID);
    ctx.restore();
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeStyle = selected ? '#ffffff' : rgba(color, 0.75);
    if (!n.built) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // header
    let title = n.built ? n.name : `🏗 ${n.name}`;
    if (n.kind === 'hub') title = this.game.won ? 'Hub · 🏆' : `Hub · Goal ${this.game.milestone + 1}`;
    const pad = n.kind === 'producer' || n.kind === 'storage' ? 16 : 6;
    ctx.font = '600 11px system-ui, sans-serif';
    if (ctx.measureText(title).width > w - 2 * pad) ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x + w / 2, y + GRID / 2 + 0.5);

    if (n.kind === 'producer' && n.built) {
      ctx.beginPath();
      ctx.arc(x + 9, y + GRID / 2, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = THEME.status[n.status] || THEME.status.idle;
      ctx.fill();
    }

    const by = y + GRID, bh = h - GRID;
    if (!n.built) this.drawConstructionBody(n, x, by, w, bh);
    else if (n.kind === 'producer') this.drawProducerBody(n, x, by, w, bh);
    else if (n.kind === 'storage') this.drawStorageBody(n, x, y, by, w, bh);
    else if (n.kind === 'hub') this.drawHubBody(n, x, by, w, bh);

    for (const p of n.ports) this.drawPort(n, p);
  }

  /** Vertical bar with icon on top and a label below. */
  drawBar(cx, by, bh, res, frac, label) {
    const { ctx } = this;
    const r = RESOURCES[res];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(r ? r.icon : '?', cx, by + 10);
    const bw = 11, top = by + 18, barH = bh - 36;
    roundRectPath(ctx, cx - bw / 2, top, bw, barH, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const fh = barH * Math.max(0, Math.min(1, frac));
    if (fh > 0.5) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = r ? r.color : '#999';
      ctx.fillRect(cx - bw / 2, top + barH - fh, bw, fh);
      ctx.restore();
    }
    ctx.font = '8.5px system-ui, sans-serif';
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(label, cx, top + barH + 8);
    ctx.fillStyle = THEME.text;
  }

  drawProducerBody(n, x, by, w, bh) {
    const { ctx } = this;
    const both = n.inBufs.length && n.outBufs.length;
    const items = [...n.inBufs, ...(both ? ['arrow'] : []), ...n.outBufs];
    const total = n.buffers.length + (both ? 0.6 : 0);
    const slot = Math.min(32, (w - 12) / total);
    let cx = x + w / 2 - (total * slot) / 2;
    ctx.fillStyle = THEME.text;
    for (const it of items) {
      if (it === 'arrow') {
        const mid = cx + 0.3 * slot, my = by + bh / 2 - 2;
        ctx.beginPath();
        ctx.moveTo(mid - 3, my - 5); ctx.lineTo(mid + 3, my); ctx.lineTo(mid - 3, my + 5);
        ctx.strokeStyle = THEME.textDim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        cx += 0.6 * slot;
        continue;
      }
      const label = slot >= 28 ? `${Math.floor(it.amount)}/${it.cap}` : `${Math.floor(it.amount)}`;
      this.drawBar(cx + slot / 2, by, bh, it.res, it.amount / it.cap, label);
      cx += slot;
    }
    // cycle progress
    const px = x + 8, pw = w - 16, py = by + bh - 5;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(px, py, pw, 2.5);
    ctx.fillStyle = n.color;
    ctx.fillRect(px, py, pw * n.progress, 2.5);
  }

  drawStorageBody(n, x, y, by, w, bh) {
    const { ctx } = this;
    const b = n.buf, r = RESOURCES[b.res];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(r ? r.icon : '∅', x + 17, by + bh / 2 - 2);
    const bx = x + 32, bw = w - 42, bt = by + 14;
    roundRectPath(ctx, bx, bt, bw, 10, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    if (r && b.amount > 0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = r.color;
      ctx.fillRect(bx, bt, bw * Math.min(1, b.amount / b.cap), 10);
      ctx.restore();
    }
    ctx.font = '9.5px system-ui, sans-serif';
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(r ? `${Math.floor(b.amount)} / ${b.cap}` : `empty · ${b.cap}`, bx + bw / 2, bt + 24);

    // little clear button in the header
    if (b.res) {
      const cx = x + w - 10, cy = y + GRID / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.strokeStyle = THEME.text;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 2.5, cy - 2.5); ctx.lineTo(cx + 2.5, cy + 2.5);
      ctx.moveTo(cx + 2.5, cy - 2.5); ctx.lineTo(cx - 2.5, cy + 2.5);
      ctx.stroke();
    }
  }

  drawHubBody(n, x, by, w, bh) {
    const { ctx, game } = this;
    const m = game.currentGoal;
    ctx.fillStyle = THEME.text;
    if (!m) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('🏆 All goals complete', x + w / 2, by + bh / 2);
      return;
    }
    const needs = Object.keys(m.need);
    const slot = Math.min(36, (w - 12) / needs.length);
    let cx = x + w / 2 - (needs.length * slot) / 2;
    for (const res of needs) {
      const p = game.msProgress[res] || 0;
      this.drawBar(cx + slot / 2, by + 6, bh - 12, res, p / m.need[res], `${p}/${m.need[res]}`);
      cx += slot;
    }
  }

  /** Construction site: progress bars for every material. */
  drawConstructionBody(n, x, by, w, bh) {
    const items = Object.entries(n.buildCost);
    const slot = Math.min(36, (w - 40) / Math.max(1, items.length));
    let cx = x + w / 2 - (items.length * slot) / 2;
    this.ctx.fillStyle = THEME.text;
    for (const [res, amount] of items) {
      const got = n.gotOf('build', res);
      this.drawBar(cx + slot / 2, by, bh, res, got / amount, `${got}/${amount}`);
      cx += slot;
    }
  }

  /** Side input: ring = progress of its resource, resource icon inside the edge,
   *  track icon (🏗 / 📦 / ⚡ …) above the first slot. */
  drawUpgradePort(n, p) {
    const { ctx } = this;
    const pp = toPx(n.portPos(p));
    const track = n.sideTrack(p.side);
    const need = n.sideItem(p);
    const col = need ? RESOURCES[need.res].color : '#5b6574';
    const inward = p.side === 'left' ? 1 : -1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.text;
    if (p.index === 0 && track) {
      ctx.font = '8px system-ui, sans-serif';
      ctx.fillText(track.key === 'build' ? '🏗' : UPGRADES[track.key].icon, pp.x + inward * 9, pp.y - 11);
    }
    if (need) {
      ctx.font = '8px system-ui, sans-serif';
      ctx.globalAlpha = need.got >= need.amount ? 0.35 : 1;
      ctx.fillText(resIcon(need.res), pp.x + inward * 15, pp.y);
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = THEME.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(col, 0.35);
    ctx.stroke();
    if (need && need.got > 0) {
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 6.5, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * need.got / need.amount);
      ctx.strokeStyle = col;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = p.conn || !need ? col : rgba(col, 0.35);
    ctx.fill();
  }

  drawPort(n, p) {
    if (p.isSide) return this.drawUpgradePort(n, p);
    const { ctx } = this;
    const pp = toPx(n.portPos(p));
    const res = p.res;
    const col = res ? RESOURCES[res].color : '#c9d2de';
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = p.conn ? col : THEME.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.conn ? '#0a0d12' : col;
    ctx.stroke();
  }
}
