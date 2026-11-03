'use strict';
/* ==========================================================================
 *  UI — goal bar, bottom sheet (build / goals / menu / inspector), toasts.
 * ========================================================================== */

function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(1) + 'M';
}
const resIcon = r => RESOURCES[r] ? RESOURCES[r].icon : '❓';
const resName = r => RESOURCES[r] ? RESOURCES[r].name : r;
const SIDE_NAME = { left: 'left input', right: 'right input' };
const costText = (cost, discovered) => Object.entries(cost)
  .map(([r, a]) => `${fmt(a)}${!discovered || discovered.has(r) ? resIcon(r) : '❓'}`).join(' ') || 'free';

class UI {
  constructor(game, view) {
    this.game = game;
    this.view = view;
    this.selection = null;  // {node} | {conn} | null
    this.mode = null;       // which sheet is open
    this.html = '';
    this.refreshT = 0;
    this.barKey = '';
    this.rates = {};
    this.lastDelivered = {};
    this.rateT = 0;
    const $ = id => document.getElementById(id);
    this.sheet = $('sheet');
    this.body = $('sheet-body');
    this.barEl = $('stock');
    this.goalFill = $('goalfill');
    this.toasts = $('toasts');
    this.navButtons = document.querySelectorAll('[data-open]');
    this.navButtons.forEach(b => b.addEventListener('click', () => this.toggle(b.dataset.open)));
    this.body.addEventListener('click', e => this.onAction(e));
    $('topbar').addEventListener('click', () => this.toggle('goals'));
    game.onEvent = (t, d) => this.onGameEvent(t, d);
  }

  // ---- sheet management ------------------------------------------------------
  toggle(mode) {
    if (this.mode === mode) return this.close();
    this.selection = null;
    this.open(mode);
  }
  open(mode) {
    this.mode = mode;
    this.html = '';
    this.render();
    this.sheet.classList.add('open');
    this.navButtons.forEach(b => b.classList.toggle('active', b.dataset.open === mode));
  }
  close() {
    this.mode = null;
    this.selection = null;
    this.sheet.classList.remove('open');
    this.navButtons.forEach(b => b.classList.remove('active'));
  }
  /** Select a node / connection. openPanel=false only highlights it. */
  select(sel, openPanel = true) {
    if (!sel) return this.close();
    if (!openPanel) { this.close(); this.selection = sel; return; }
    this.selection = sel;
    this.open(sel.node ? 'node' : 'conn');
    requestAnimationFrame(() => this.keepVisible());
  }

  /** Pan so the selected node isn't hidden behind the sheet. */
  keepVisible() {
    const n = this.selection && this.selection.node;
    if (!n) return;
    const v = this.view;
    const free = v.h - this.sheet.offsetHeight - 70;
    const s = v.toScreen((n.x + n.w / 2) * GRID, (n.y + n.h) * GRID + 10);
    if (s.y > free) v.y += (s.y - free) / v.zoom;
  }

  // ---- per-frame update --------------------------------------------------------
  update(dt) {
    this.rateT += dt;
    if (this.rateT >= 1) {
      for (const r in this.game.delivered) {
        const d = this.game.delivered[r] - (this.lastDelivered[r] || 0);
        this.rates[r] = (this.rates[r] || 0) * 0.7 + (d / this.rateT) * 0.3;
        this.lastDelivered[r] = this.game.delivered[r];
      }
      this.rateT = 0;
    }
    this.refreshT += dt;
    if (this.refreshT < 0.2) return;
    this.refreshT = 0;
    this.renderGoalBar();
    if (this.mode) this.render();
  }

  /** Top bar: what the current goal still needs. */
  renderGoalBar() {
    const g = this.game, m = g.currentGoal;
    const list = m ? Object.keys(m.need) : [];
    const key = g.milestone + ':' + list.map(r => r + g.discovered.has(r)).join();
    if (key !== this.barKey) {
      this.barKey = key;
      this.barEl.innerHTML = !m ? '<div class="chip">🏆 All goals complete</div>' :
        `<div class="chip goal">🎯 ${g.milestone + 1}</div>` + list.map(r =>
          `<div class="chip" style="--c:${RESOURCES[r].color}" title="${resName(r)}">
             <span class="ic">${g.discovered.has(r) ? resIcon(r) : '❓'}</span><b data-s="${r}"></b><small data-r="${r}"></small></div>`).join('');
    }
    for (const el of this.barEl.querySelectorAll('[data-s]')) {
      const r = el.dataset.s, got = g.msProgress[r] || 0;
      el.textContent = `${fmt(got)}/${fmt(m.need[r])}`;
      el.parentElement.classList.toggle('full', got >= m.need[r]);
    }
    for (const el of this.barEl.querySelectorAll('[data-r]')) {
      const v = this.rates[el.dataset.r] || 0;
      el.textContent = v >= 0.05 ? `+${v.toFixed(1)}/s` : '';
    }
    let frac = 1;
    if (m) {
      const tot = Object.values(m.need).reduce((a, b) => a + b, 0);
      const got = Object.keys(m.need).reduce((a, r) => a + Math.min(m.need[r], g.msProgress[r] || 0), 0);
      frac = got / tot;
    }
    this.goalFill.style.width = (frac * 100).toFixed(1) + '%';
  }

  /** Rebuild sheet HTML only if its structure changed; live numbers are patched in. */
  render() {
    const sel = this.selection;
    if (sel && sel.node && !this.game.nodes.includes(sel.node)) return this.close();
    if (sel && sel.conn && !this.game.conns.includes(sel.conn)) return this.close();
    const builders = { build: this.buildHTML, goals: this.goalsHTML, menu: this.menuHTML, node: this.nodeHTML, conn: this.connHTML };
    const live = {};
    const html = builders[this.mode].call(this, live);
    if (html !== this.html) { this.body.innerHTML = html; this.html = html; }
    for (const el of this.body.querySelectorAll('[data-live]')) {
      const v = live[el.dataset.live];
      if (v === undefined) continue;
      if (el.dataset.bar !== undefined) el.style.width = (Math.min(1, v) * 100).toFixed(1) + '%';
      else el.textContent = v;
    }
  }

  // ---- html helpers ----------------------------------------------------------------
  recipeHTML(def) {
    const r = def.recipe;
    if (!r) return def.kind === 'storage' ? 'Stores one resource type' : '';
    const side = o => Object.entries(o).map(([k, v]) => `${v}${resIcon(k)}`).join(' + ');
    return `${side(r.in)}${Object.keys(r.in).length ? ' ' : ''}→ ${side(r.out)} <small>/ ${r.time}s</small>`;
  }
  head(title, sub = '') {
    return `<div class="sh-head"><div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <button class="x" data-act="close" aria-label="Close">✕</button></div>`;
  }
  /** Progress list for a track's items: [{res, amount, got}]. */
  itemsHTML(items, prefix, live) {
    return items.map(it => {
      live[prefix + it.res] = `${fmt(it.got)} / ${fmt(it.amount)}`;
      live[prefix + 'b-' + it.res] = it.got / it.amount;
      const known = this.game.discovered.has(it.res);
      return `<div class="need"><span>${known ? resIcon(it.res) : '❓'} ${resName(it.res)}</span>
        <span data-live="${prefix + it.res}"></span>
        <div class="bar"><i data-live="${prefix}b-${it.res}" data-bar style="background:${RESOURCES[it.res].color}"></i></div></div>`;
    }).join('');
  }
  /** Node upgrades: fed through the side inputs, shown with progress. */
  nodeUpgradeRows(n, live) {
    return `<div class="upgs">${SIDES.map(side => {
      const t = n.sideTrack(side);
      if (!t) return '';
      const u = UPGRADES[t.key], lvl = n.level(t.key), cur = u.value(lvl, n.def);
      const val = t.max ? `${u.format(cur)} <small>max</small>` : `${u.format(cur)} → <b>${u.format(u.value(lvl + 1, n.def))}</b>`;
      return `<div class="track">
        <div class="th"><span class="ul">${u.icon} ${u.label} <small>Lv ${lvl} · ${SIDE_NAME[side]}${t.items.length > 1 ? 's' : ''}</small></span>
        <span class="uv">${val}</span></div>
        ${this.itemsHTML(t.items, 'u-' + side + '-', live)}</div>`;
    }).join('')}</div>`;
  }

  // ---- sheets ---------------------------------------------------------------------
  buildHTML() {
    const g = this.game;
    const types = Object.keys(NODE_TYPES).filter(t => NODE_TYPES[t].buildable !== false);
    const cards = types.map(t => {
      const def = NODE_TYPES[t];
      if (!g.isUnlocked(t)) {
        return `<div class="card locked"><b>???</b><div class="rec">🔒 needs ${costText(def.cost || {}, g.discovered)}</div></div>`;
      }
      return `<button class="card" data-act="build" data-arg="${t}">
        <b>${def.name}</b><div class="rec">${this.recipeHTML(def)}</div>
        <div class="cst">🏗 ${costText(g.buildCost(t))}</div></button>`;
    });
    cards.sort((a, b) => a.startsWith('<div') - b.startsWith('<div'));
    return this.head('Build', 'Placing is free. Deliver the 🏗 materials to the side inputs to start production.') +
      `<div class="cards">${cards.join('')}</div>`;
  }

  goalsHTML(live) {
    const g = this.game;
    const rows = MILESTONES.map((m, i) => {
      const unl = i === MILESTONES.length - 1 ? '🏆 Victory' : `all connections → Lv ${UPGRADES.throughput.maxAt(i + 1)}`;
      if (i < g.milestone) return `<div class="goal done">✓ <b>${m.title}</b> <small>${unl}</small></div>`;
      if (i > g.milestone) return `<div class="goal locked">🔒 Goal ${i + 1} · ???</div>`;
      const needs = Object.keys(m.need).map(r => {
        live['g-' + r] = `${fmt(g.msProgress[r] || 0)} / ${fmt(m.need[r])}`;
        live['gb-' + r] = (g.msProgress[r] || 0) / m.need[r];
        const known = g.discovered.has(r);
        return `<div class="need"><span>${known ? resIcon(r) + ' ' + resName(r) : '❓ ' + resName(r)}</span>
          <span data-live="g-${r}"></span>
          <div class="bar"><i data-live="gb-${r}" data-bar style="background:${RESOURCES[r].color}"></i></div></div>`;
      }).join('');
      return `<div class="goal cur"><div><b>Goal ${i + 1}: ${m.title}</b></div>
        <div class="sub">Deliver to the Hub (it accepts nothing else):</div>${needs}<div class="sub">Reward: ${unl}</div></div>`;
    }).join('');
    const tip = g.milestone === 0
      ? `<p class="tip">Your <b>Spring</b> makes water. Build a <b>Lumberjack</b> and connect the Spring's output to the Lumberjack's 🏗 side input. Once built, send its wood to the <b>Hub</b>. New buildings appear when you've produced what they're made of.</p>` : '';
    return this.head('Goals', g.won ? '🏆 You lit the Lighthouse!' : '') + tip + rows;
  }

  menuHTML() {
    return this.head('Menu') + `
      <div class="actions col">
        <button data-act="center">🎯 Center on Hub</button>
        <button data-act="save">💾 Save now</button>
        <button class="danger" data-act="reset">🗑 Reset game</button>
      </div>
      <div class="help">
        <p><b>Pan</b> drag empty space or WASD / arrow keys · <b>Zoom</b> pinch / mouse wheel</p>
        <p><b>Move</b> drag a node · <b>Connect</b> drag from an output (bottom) to an input (top) or onto a node</p>
        <p><b>Build</b> placing is free, but a node only works after its 🏗 materials arrive at its side inputs (one input per material)</p>
        <p><b>Upgrade</b> afterwards the side inputs take upgrade materials: 📦 buffers (left), ⚡ speed (right). Rings show progress.</p>
        <p><b>Re-wire</b> drag a connected port · drop on empty space to remove</p>
        <p><b>Waypoints</b> tap a connection, drag a ＋ handle · tap a waypoint to delete it</p>
        <p>Progress is saved automatically and continues while you're away (max ${BALANCE.offlineCapSec / 3600} h).</p>
      </div>`;
  }

  nodeHTML(live) {
    const n = this.selection.node;
    let info = '';
    if (!n.built) {
      const items = Object.entries(n.buildCost).map(([res, amount]) => ({ res, amount, got: n.gotOf('build', res) }));
      info = `<div class="info"><div>🏗 Under construction</div>
        <div class="sub">Deliver the materials to the side inputs. ${n.def.recipe ? 'Production starts' : 'It works'} when everything has arrived.</div>
        ${this.itemsHTML(items, 'b-', live)}
        ${n.def.recipe ? `<div class="sub">Will make: ${this.recipeHTML(n.def)}</div>` : ''}</div>`;
    } else if (n.kind === 'producer') {
      const statusText = { working: '🟢 Working', starved: '🟠 Waiting for input', blocked: '🔴 Output full', idle: 'Idle' };
      live.status = statusText[n.status];
      const out = Object.entries(n.def.recipe.out).map(([r, a]) => `${(a * n.cyclesPerSec).toFixed(2)}${resIcon(r)}`).join(' ');
      const inn = Object.entries(n.def.recipe.in).map(([r, a]) => `${(a * n.cyclesPerSec).toFixed(2)}${resIcon(r)}`).join(' ');
      info = `<div class="info"><div>${this.recipeHTML(n.def)}</div>
        <div><span data-live="status"></span></div>
        <div class="sub">Max: ${inn ? inn + ' → ' : ''}${out} per second</div></div>`;
    } else if (n.kind === 'storage') {
      live.holds = n.buf.res ? `${resIcon(n.buf.res)} ${resName(n.buf.res)}: ${fmt(n.buf.amount)} / ${n.buf.cap}` : `Empty · ${n.buf.cap}`;
      info = `<div class="info"><div data-live="holds"></div>
        <div class="sub">Locks to the first resource it receives. Clearing destroys the content.</div></div>
        <div class="actions"><button data-act="clear" ${n.buf.res ? '' : 'disabled'}>✕ Clear storage</button></div>`;
    } else if (n.kind === 'hub') {
      info = `<div class="info"><div class="sub">Accepts only what the current goal still needs — everything else stops at the Hub.</div></div>`;
    }
    const ups = n.built && n.upgradeKeys.length ? this.nodeUpgradeRows(n, live) : '';
    const del = n.kind === 'hub' ? '' : `<div class="actions"><button class="danger" data-act="demolish">Demolish</button></div>`;
    return this.head(n.name) + info + ups + del;
  }

  connHTML(live) {
    const c = this.selection.conn, g = this.game;
    const res = c.from.res;
    live.flow = `${c.flow.toFixed(2)}/s`;
    const why = c.mismatch ? `<div class="warn">${c.to.node.name} doesn't take ${resName(res)} ${c.to.isSide ? 'at this input' : 'right now'}</div>` : '';
    const u = UPGRADES.throughput, last = g.milestone >= MILESTONES.length;
    const row = `<div class="upgs"><div class="upg">
        <span class="ul">${u.icon} ${u.label} <small>Lv ${c.level}</small></span>
        <span class="uv">${u.format(c.rate)}${last ? '' : ` → <b>${u.format(u.value(UPGRADES.throughput.maxAt(g.milestone + 1), CONNECTION))}</b>`}</span>
        <span class="uc">${last ? '<small>max</small>' : '🎯 next goal'}</span></div></div>`;
    const track = c.to.isSide && c.to.node.sideTrack(c.to.side);
    const target = track ? `${c.to.node.name} ${track.key === 'build' ? '🏗' : UPGRADES[track.key].icon}` : c.to.node.name;
    return this.head('Connection', `${c.from.node.name} → ${target}`) +
      `<div class="info"><div>${res ? resIcon(res) + ' ' + resName(res) : 'Nothing yet'} · flow <span data-live="flow"></span> of ${c.rate.toFixed(1)}/s</div>${why}
       <div class="sub">Items ride the belt to the target; it only sends what still fits there. Deleting the connection loses what's on it. Each completed goal upgrades all connections.</div>
       <div class="sub">Drag a ＋ handle to add a waypoint, tap a waypoint to remove it.</div></div>` +
      row +
      `<div class="actions">${c.waypoints.length ? '<button data-act="clearwp">Remove waypoints</button>' : ''}
        <button class="danger" data-act="delconn">Delete connection</button></div>`;
  }

  // ---- actions ------------------------------------------------------------------------
  onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const g = this.game, sel = this.selection, arg = b.dataset.arg;
    switch (b.dataset.act) {
      case 'close': this.close(); return;
      case 'build': {
        const v = this.view;
        const c = v.toWorld(v.w / 2, v.h * 0.4);
        const n = g.build(arg, c.x / GRID, c.y / GRID);
        if (n) { this.select({ node: n }, false); this.toast(`${n.name} built — drag it into place`); }
        return;
      }
      case 'demolish': {
        const n = sel.node;
        const invested = (n.built && Object.keys(n.buildCost).length) || Object.keys(n.got).length;
        if (invested && !confirm(`Demolish ${n.name}? Everything delivered to it is lost.`)) return;
        g.removeNode(n);
        this.close();
        return;
      }
      case 'delconn': g.disconnect(sel.conn); this.close(); return;
      case 'clearwp': sel.conn.waypoints = []; break;
      case 'clear': g.clearStorage(sel.node); break;
      case 'center': this.centerOnHub(); this.close(); return;
      case 'save': g.save(); this.toast('Saved'); break;
      case 'reset':
        if (confirm('Reset the game? All progress will be lost.')) {
          g.reset(); g.save(); this.barKey = ''; this.rates = {}; this.lastDelivered = {};
          this.centerOnHub(); this.close();
        }
        return;
    }
    this.html = '';
    this.render();
  }

  centerOnHub() {
    const hub = this.game.nodes.find(n => n.kind === 'hub');
    if (hub) this.view.centerOn((hub.x + hub.w / 2) * GRID, (hub.y + hub.h / 2) * GRID);
  }

  onGameEvent(type, data) {
    if (type === 'discover') this.toast(`New resource: ${resIcon(data)} ${resName(data)}`, 'good');
    else if (type === 'unlock') this.toast(`New building: ${data.map(t => NODE_TYPES[t].name).join(', ')}`, 'big');
    else if (type === 'built') this.toast(`🏗 ${data.name} is ready`, 'good');
    else if (type === 'upgrade') {
      const u = UPGRADES[data.key];
      this.toast(`${data.node.name}: ${u.icon} ${u.label} → Lv ${data.node.level(data.key)}`, 'good');
    } else if (type === 'goal') {
      this.toast(`Goal complete: ${data.title}! All connections upgraded to Lv ${this.game.maxConnLevel}`, 'big');
    } else if (type === 'win') this.toast('🏆 The Lighthouse shines! You finished all goals.', 'big');
    else if (type === 'error') this.toast(data, 'bad');
  }

  toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), kind === 'big' ? 4000 : 2200);
    setTimeout(() => el.remove(), kind === 'big' ? 4500 : 2700);
  }
}
