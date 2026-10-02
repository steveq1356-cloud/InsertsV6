/* InsertPress Planner — iron collision check.
 *
 * The iron is a stack of cylinders measured up from the tip end: the tip, the
 * tip nut, the iron body, and optionally the Z carriage. At the bottom of a
 * press the tip end sits at tipZ = H - sink - pilot (a pickup passes its lowest
 * tip Z as H - sink, pilot included, and gets no extra pilot). Zone k (radius r,
 * starting `from` mm above the tip end) collides when material inside radius
 * r + margin rises above  max(tipZ + from, H + 0.05)  — the surface the insert
 * is pressed into is expected to touch, anything above it is not.
 *
 * The lowest point of the press is the worst case: the part is solid from the
 * bed up, so every zone only clears more as the iron rises.
 *
 * Material is found by clipping each nearby triangle against a polygon that
 * circumscribes the zone circle and taking the highest clipped point, so walls,
 * slopes, and tops are all handled. Checks run against every copy (a tall
 * feature on the neighbouring copy counts) and against the fence.
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});
  const EPS = 0.05;
  const SIDES = 24;
  const COS = [], SIN = [];
  for (let k = 0; k < SIDES; k++) { COS.push(Math.cos((k * 2 * Math.PI) / SIDES)); SIN.push(Math.sin((k * 2 * Math.PI) / SIDES)); }

  /** Iron zones from settings, bottom up: [{ key, name, d, from }]. */
  function zonesFrom(s) {
    const tipL = Math.max(0, +s.ironTipL || 0), nutL = Math.max(0, +s.ironNutL || 0);
    const z = [{ key: 'tip', name: 'tip', d: Math.max(0.1, +s.ironTipD || 0), from: 0 }];
    if (+s.ironNutD > 0 && nutL > 0) z.push({ key: 'nut', name: 'tip nut', d: +s.ironNutD, from: tipL });
    z.push({ key: 'body', name: 'iron body', d: Math.max(0.1, +s.ironBodyD || 0), from: tipL + nutL });
    if (+s.carriageD > 0) z.push({ key: 'carriage', name: 'Z carriage', d: +s.carriageD, from: Math.max(tipL + nutL, +s.carriageZ || 0) });
    return z;
  }

  /** Uniform grid over triangle XY bounds. */
  class Index {
    constructor(pos, cell) {
      this.pos = pos;
      this.cell = cell || 4;
      const n = pos.length / 9;
      this.n = n;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      this.zmax = new Float32Array(n);
      for (let t = 0; t < n; t++) {
        const b = t * 9;
        for (let k = 0; k < 9; k += 3) {
          const x = pos[b + k], y = pos[b + k + 1];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        this.zmax[t] = Math.max(pos[b + 2], pos[b + 5], pos[b + 8]);
      }
      if (!n) { minX = minY = 0; maxX = maxY = 1; }
      this.minX = minX; this.minY = minY; this.maxX = maxX; this.maxY = maxY;
      this.nx = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 1);
      this.ny = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 1);
      const buckets = new Array(this.nx * this.ny);
      for (let t = 0; t < n; t++) {
        const b = t * 9;
        const x0 = Math.min(pos[b], pos[b + 3], pos[b + 6]), x1 = Math.max(pos[b], pos[b + 3], pos[b + 6]);
        const y0 = Math.min(pos[b + 1], pos[b + 4], pos[b + 7]), y1 = Math.max(pos[b + 1], pos[b + 4], pos[b + 7]);
        const i0 = this._ix(x0), i1 = this._ix(x1), j0 = this._iy(y0), j1 = this._iy(y1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * this.nx + i;
          (buckets[k] || (buckets[k] = [])).push(t);
        }
      }
      this.buckets = buckets;
      this.stamp = new Uint32Array(n);
      this.mark = 0;
    }
    _ix(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell))); }
    _iy(y) { return Math.max(0, Math.min(this.ny - 1, Math.floor((y - this.minY) / this.cell))); }
    /** Call fn(t) once for each triangle whose cell overlaps the square around (x, y). */
    near(x, y, r, fn) {
      if (x + r < this.minX || x - r > this.maxX || y + r < this.minY || y - r > this.maxY) return;
      this.mark++;
      if (this.mark === 0xffffffff) { this.stamp.fill(0); this.mark = 1; }
      const i0 = this._ix(x - r), i1 = this._ix(x + r), j0 = this._iy(y - r), j1 = this._iy(y + r);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const list = this.buckets[j * this.nx + i];
        if (!list) continue;
        for (const t of list) { if (this.stamp[t] !== this.mark) { this.stamp[t] = this.mark; fn(t); } }
      }
    }
  }

  /**
   * Highest point of triangle t inside the circle (cx, cy, r), or null.
   * Sutherland–Hodgman against a circumscribed polygon; z rides along edges,
   * which is exact for a planar triangle (vertical walls included).
   */
  function clipMax(P, t, cx, cy, r) {
    const b = t * 9;
    let poly = [[P[b] - cx, P[b + 1] - cy, P[b + 2]], [P[b + 3] - cx, P[b + 4] - cy, P[b + 5]], [P[b + 6] - cx, P[b + 7] - cy, P[b + 8]]];
    const r2 = r * r;
    if (poly.every((p) => p[0] * p[0] + p[1] * p[1] <= r2)) {
      let best = poly[0];
      for (const p of poly) if (p[2] > best[2]) best = p;
      return { z: best[2], x: best[0] + cx, y: best[1] + cy };
    }
    for (let k = 0; k < SIDES && poly.length; k++) {
      const nx = COS[k], ny = SIN[k];
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const da = a[0] * nx + a[1] * ny - r, dc = c[0] * nx + c[1] * ny - r;
        const ina = da <= 1e-9, inc = dc <= 1e-9;
        if (ina) out.push(a);
        if (ina !== inc) {
          const u = da / (da - dc);
          out.push([a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u]);
        }
      }
      poly = out;
    }
    if (!poly.length) return null;
    let best = poly[0];
    for (const p of poly) if (p[2] > best[2]) best = p;
    return { z: best[2], x: best[0] + cx, y: best[1] + cy };
  }

  /**
   * Highest material inside each zone radius around local point (x, y),
   * counting only material above `floor`. Returns [{ z, x, y } | null] per zone.
   */
  function scan(index, x, y, radii, floor) {
    const R = Math.max(...radii);
    const best = radii.map(() => null);
    const P = index.pos;
    index.near(x, y, R, (t) => {
      if (index.zmax[t] <= floor) return;
      for (let k = 0; k < radii.length; k++) {
        const cur = best[k];
        if (cur && index.zmax[t] <= cur.z) continue;
        const hit = clipMax(P, t, x, y, radii[k]);
        if (hit && hit.z > floor && (!cur || hit.z > cur.z)) best[k] = hit;
      }
    });
    return best;
  }

  /** Nearest XY distance from (x, y) to material above z = level within radius r. */
  function nearestAbove(index, x, y, r, level) {
    const P = index.pos;
    let best = Infinity;
    index.near(x, y, r, (t) => {
      if (index.zmax[t] <= level) return;
      const b = t * 9;
      let poly = [[P[b], P[b + 1], P[b + 2]], [P[b + 3], P[b + 4], P[b + 5]], [P[b + 6], P[b + 7], P[b + 8]]];
      const out = [];
      for (let i = 0; i < 3; i++) {
        const a = poly[i], c = poly[(i + 1) % 3];
        const ina = a[2] >= level, inc = c[2] >= level;
        if (ina) out.push(a);
        if (ina !== inc) { const u = (level - a[2]) / (c[2] - a[2]); out.push([a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, level]); }
      }
      poly = out;
      if (!poly.length) return;
      // inside test (for non-degenerate projections) and distance to the edges
      let inside = poly.length >= 3, sign = 0;
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const ex = c[0] - a[0], ey = c[1] - a[1];
        const cr = ex * (y - a[1]) - ey * (x - a[0]);
        if (Math.abs(cr) > 1e-9) { const sg = Math.sign(cr); if (sign && sg !== sign) inside = false; sign = sign || sg; }
        const L = ex * ex + ey * ey;
        const u = L ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / L)) : 0;
        d = Math.min(d, Math.hypot(x - (a[0] + u * ex), y - (a[1] + u * ey)));
      }
      if (inside && sign) d = 0;
      if (d < best) best = d;
    });
    return best;
  }

  /**
   * holes: world holes in press order [{ x, y, H, sink?, label, localId, copy }]
   * ctx:   { index, instances, partSize, zones, margin, sink, fenceH, pilot, boxes }
   *   pilot lowers the tip end at the bottom of the press (tip enters the insert).
   *   boxes = [{ x0, y0, x1, y1, z, source }] are block obstacles such as the tray.
   *   A hole with pocket: n is a pickup: every copy counts as 'copy'.
   * Returns one result per hole: { label, localId, copy, pocket, hits:[...], clearance }
   *   hit = { zone, z, need, over, dist, source: 'part'|'copy'|'fence'|'tray', copy }
   *   clearance = smallest vertical gap between a zone and material near it (mm),
   *   or null when nothing rises above the hole surface within reach.
   */
  function check(holes, ctx) {
    const zones = ctx.zones, margin = Math.max(0, ctx.margin || 0);
    const radii = zones.map((z) => z.d / 2 + margin);
    const R = Math.max(...radii);
    const size = ctx.partSize;
    const out = [];
    for (const h of holes) {
      const sink = h.sink != null ? h.sink : ctx.sink || 0;
      const tipZ = h.H - sink - (h.pocket != null ? 0 : ctx.pilot || 0);
      const need = zones.map((z) => Math.max(tipZ + z.from, h.H + EPS));
      const hits = [];
      let clearance = null;
      (ctx.instances || [{ i: 0, rot: 0, tx: 0, ty: 0 }]).forEach((inst) => {
        const loc = IP.place.toLocal(inst, h.x, h.y);
        if (size && (loc.x < -R || loc.y < -R || loc.x > size.x + R || loc.y > size.y + R)) return;
        const own = h.pocket == null && (h.copy == null || inst.i === h.copy);
        const found = scan(ctx.index, loc.x, loc.y, radii, h.H + EPS);
        found.forEach((f, k) => {
          if (!f) return;
          const gap = need[k] - f.z;
          if (clearance == null || gap < clearance) clearance = gap;
          if (f.z > need[k]) {
            const dist = nearestAbove(ctx.index, loc.x, loc.y, radii[k], need[k]);
            hits.push({ zone: zones[k], z: f.z, need: need[k], over: f.z - need[k],
              dist: isFinite(dist) ? dist : Math.hypot(f.x - loc.x, f.y - loc.y), source: own ? 'part' : 'copy', copy: inst.i });
          }
        });
      });
      const fh = ctx.fenceH || 0;
      if (fh > 0) {
        zones.forEach((z, k) => {
          const d = Math.min(h.x, h.y);
          if (d < radii[k]) {
            const gap = need[k] - fh;
            if (clearance == null || gap < clearance) clearance = gap;
            if (fh > need[k]) hits.push({ zone: z, z: fh, need: need[k], over: fh - need[k], dist: Math.max(0, d), source: 'fence' });
          }
        });
      }
      for (const bx of ctx.boxes || []) {
        const dx = Math.max(bx.x0 - h.x, 0, h.x - bx.x1), dy = Math.max(bx.y0 - h.y, 0, h.y - bx.y1);
        const d = Math.hypot(dx, dy);
        zones.forEach((z, k) => {
          if (d >= radii[k]) return;
          const gap = need[k] - bx.z;
          if (clearance == null || gap < clearance) clearance = gap;
          if (bx.z > need[k]) hits.push({ zone: z, z: bx.z, need: need[k], over: bx.z - need[k], dist: d, source: bx.source || 'tray' });
        });
      }
      // keep the worst hit per zone and source
      const worst = new Map();
      for (const x of hits) {
        const k = x.zone.key + ':' + x.source + ':' + (x.source === 'copy' ? x.copy : '');
        if (!worst.has(k) || worst.get(k).over < x.over) worst.set(k, x);
      }
      out.push({ label: h.label, localId: h.localId, copy: h.copy, pocket: h.pocket, hits: [...worst.values()].sort((a, b) => b.over - a.over), clearance });
    }
    return out;
  }

  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const dia = (d) => (Math.round(d * 10) / 10).toString();

  /** Issues for the job list. Hits on a part's own geometry are reported once per source hole. */
  function issues(results) {
    const out = [];
    const seen = new Set();
    for (const r of results) {
      for (const x of r.hits) {
        const key = x.source === 'part' ? 'p' + r.localId + x.zone.key : 'w' + r.label + x.zone.key + x.source + x.copy;
        if (seen.has(key)) continue;
        seen.add(key);
        const what = x.source === 'fence' ? 'the fence' : x.source === 'tray' ? 'the tray'
          : x.source === 'copy' ? (r.pocket != null && r.single ? 'the part' : `copy ${x.copy + 1}`) : 'the part';
        if (r.pocket != null) {
          out.push({ level: 'error', kind: 'collision', pocket: r.pocket,
            text: `Pocket ${r.pocket}: picking up, the ${x.zone.name} (⌀${dia(x.zone.d)}) hits ${what} ${f1(x.dist)} mm away. Move the part away from the tray.` });
          continue;
        }
        out.push({
          level: 'error', kind: 'collision', hole: r.label, localId: r.localId,
          text: `Hole ${r.label}: the ${x.zone.name} (⌀${dia(x.zone.d)}) hits ${what} ${f1(x.dist)} mm from the hole. `
            + `It rises to Z ${f1(x.z)} there; the ${x.zone.name} only clears Z ${f1(x.need)}.`,
        });
      }
    }
    return out;
  }

  IP.collision = { zonesFrom, Index, clipMax, scan, nearestAbove, check, issues };
})(typeof window !== 'undefined' ? window : globalThis);
