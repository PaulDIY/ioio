'use strict';
/* Geometry helpers: connection routing & hit testing. All in grid units. */

/** Orthogonal path from a to b (excluding a). Downwards: V-H-V, upwards: H-V-H. */
function elbow(a, b) {
  if (a.x === b.x || a.y === b.y) return [b];
  if (b.y > a.y) {
    const my = Math.round((a.y + b.y) / 2);
    return [{ x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  const mx = Math.round((a.x + b.x) / 2);
  return [{ x: mx, y: a.y }, { x: mx, y: b.y }, b];
}

/** Drop duplicate and collinear points. */
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && l.x === p.x && l.y === p.y) continue;
    if (out.length >= 2) {
      const k = out[out.length - 2];
      if ((k.x === l.x && l.x === p.x) || (k.y === l.y && l.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}

const STUB_DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Port position and the grid point one cell outwards from it. */
function portStub(port) {
  const p = port.node.portPos(port), [dx, dy] = STUB_DIR[port.side];
  return { p, s: { x: p.x + dx, y: p.y + dy } };
}

/** Control points: port, stub below output, waypoints..., stub outside input, port. */
function connControl(conn) {
  const a = portStub(conn.from), b = portStub(conn.to);
  const wps = conn.waypoints.length ? conn.waypoints : autoWaypoints(conn);
  return [a.p, a.s, ...wps, b.s, b.p];
}

/** Without user waypoints, upward connections are routed beside the nodes instead of through them. */
function autoWaypoints(conn) {
  const f = conn.from.node, t = conn.to.node;
  const a = portStub(conn.from).s, b = portStub(conn.to).s;
  const sy = a.y, ey = b.y;
  if (ey >= sy) return [];
  if (conn.to.side !== 'top') return [{ x: b.x, y: sy }]; // side input: go across, then straight up beside the node
  let sx;
  if (f.x + f.w < t.x) sx = Math.round((f.x + f.w + t.x) / 2);        // gap between them
  else if (t.x + t.w < f.x) sx = Math.round((t.x + t.w + f.x) / 2);
  else {                                                              // stacked: go around
    const left = Math.min(f.x, t.x) - 1, right = Math.max(f.x + f.w, t.x + t.w) + 1;
    sx = (a.x + b.x) / 2 - left < right - (a.x + b.x) / 2 ? left : right;
  }
  return [{ x: sx, y: sy }, { x: sx, y: ey }];
}

/** Full routed path from control points. */
function routeControl(ctrl) {
  const pts = [ctrl[0], ctrl[1]];
  for (let i = 1; i < ctrl.length - 2; i++) pts.push(...elbow(ctrl[i], ctrl[i + 1]));
  pts.push(ctrl[ctrl.length - 1]);
  return simplify(pts);
}

function connRoute(conn) { return routeControl(connControl(conn)); }

/** Midpoints of each routed sub-path between control points (for "+" waypoint handles).
 *  Returns [{x, y, index}] where index is the waypoint insert position. */
function connMidHandles(conn) {
  const ctrl = connControl(conn);
  const out = [];
  for (let i = 1; i < ctrl.length - 2; i++) {
    const sub = simplify([ctrl[i], ...elbow(ctrl[i], ctrl[i + 1])]);
    const len = polyLength(sub);
    if (len < 2) continue;
    const p = pointAt(sub, len / 2);
    out.push({ x: p.x, y: p.y, index: i - 1 });
  }
  return out;
}

function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return l;
}

/** Point at distance d along an orthogonal polyline. */
function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (d <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, d / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    d -= seg;
  }
  return { ...pts[0] };
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
  return d;
}

/** Simple camera: (x, y) = world pixel at the screen's top-left corner. */
class View {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; this.w = innerWidth; this.h = innerHeight; }
  toWorld(sx, sy) { return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y }; }
  toScreen(wx, wy) { return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom }; }
  zoomAt(sx, sy, factor) {
    const p = this.toWorld(sx, sy);
    this.zoom = Math.max(0.25, Math.min(3, this.zoom * factor));
    this.x = p.x - sx / this.zoom;
    this.y = p.y - sy / this.zoom;
  }
  centerOn(wx, wy) { this.x = wx - this.w / 2 / this.zoom; this.y = wy - this.h / 2 / this.zoom; }
}
