/* InsertPress Planner — automatic insert-hole detection.
 *
 * An STL is only triangles, so "holes" are found geometrically:
 *   1. Keep the near-vertical triangles (the walls).
 *   2. Group walls that share edges into connected patches.
 *   3. Fit a circle to each patch in XY. A patch that is round, wraps most of
 *      the way around, and faces inward (normals toward the axis) is a hole.
 *   4. Check what is above the hole's centre. If material covers it, the hole
 *      opens downward (or is blocked) and the tip cannot reach it.
 *   5. Keep holes whose diameter is in the insert range.
 *
 * Positions must already be placed with preparePart() (Z up, part on Z=0).
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  function weld(pos) {
    const q = 1e4; // 0.1 µm grid
    const map = new Map();
    const n = pos.length / 3;
    const vid = new Int32Array(n);
    const vx = [], vy = [], vz = [];
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
      let id = map.get(key);
      if (id === undefined) {
        id = vx.length;
        map.set(key, id);
        vx.push(x); vy.push(y); vz.push(z);
      }
      vid[i] = id;
    }
    return { vid, vx, vy, vz, nV: vx.length };
  }

  /** Algebraic (Kåsa) circle fit, computed about the centroid for stability. */
  function fitCircle(xs, ys) {
    const n = xs.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (let i = 0; i < n; i++) {
      const u = xs[i] - mx, v = ys[i] - my;
      suu += u * u; svv += v * v; suv += u * v;
      suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-12) return null;
    const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
    const uc = (a * svv - b * suv) / det;
    const vc = (b * suu - a * suv) / det;
    const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
    const cx = uc + mx, cy = vc + my;
    let err = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(xs[i] - cx, ys[i] - cy) - r;
      err += d * d;
    }
    return { x: cx, y: cy, r, rms: Math.sqrt(err / n) };
  }

  function detect(pos, opts) {
    opts = Object.assign({ dMin: 2.5, dMax: 7.0 }, opts || {});
    const nTri = (pos.length / 9) | 0;
    const W = weld(pos);
    const { vid, vx, vy, vz, nV } = W;

    const nx = new Float32Array(nTri), ny = new Float32Array(nTri), nz = new Float32Array(nTri);
    const area = new Float32Array(nTri);
    const isWall = new Uint8Array(nTri);
    for (let t = 0; t < nTri; t++) {
      const a = vid[t * 3], b = vid[t * 3 + 1], c = vid[t * 3 + 2];
      const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a];
      const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a];
      const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      const len = Math.hypot(cx, cy, cz);
      if (len < 1e-12) continue;
      nx[t] = cx / len; ny[t] = cy / len; nz[t] = cz / len;
      area[t] = len / 2;
      if (Math.abs(nz[t]) < 0.05) isWall[t] = 1;
    }

    // Union walls that share an edge.
    const parent = new Int32Array(nTri);
    for (let i = 0; i < nTri; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edgeOwner = new Map();
    for (let t = 0; t < nTri; t++) {
      if (!isWall[t]) continue;
      for (let e = 0; e < 3; e++) {
        const a = vid[t * 3 + e], b = vid[t * 3 + ((e + 1) % 3)];
        const key = a < b ? a * nV + b : b * nV + a;
        const o = edgeOwner.get(key);
        if (o === undefined) edgeOwner.set(key, t);
        else { const ra = find(o), rb = find(t); if (ra !== rb) parent[ra] = rb; }
      }
    }
    const comps = new Map();
    for (let t = 0; t < nTri; t++) {
      if (!isWall[t]) continue;
      const r = find(t);
      let list = comps.get(r);
      if (!list) comps.set(r, (list = []));
      list.push(t);
    }

    // Fit circles.
    let cands = [];
    for (const tris of comps.values()) {
      if (tris.length < 6) continue;
      const seen = new Set();
      const xs = [], ys = [];
      let zmin = Infinity, zmax = -Infinity;
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const v = vid[t * 3 + k];
          if (vz[v] < zmin) zmin = vz[v];
          if (vz[v] > zmax) zmax = vz[v];
          if (seen.has(v)) continue;
          seen.add(v); xs.push(vx[v]); ys.push(vy[v]);
        }
      }
      if (xs.length < 6) continue;
      const fit = fitCircle(xs, ys);
      if (!fit || fit.r < 0.3 || fit.r > 60) continue;
      if (fit.rms > Math.max(0.02, 0.03 * fit.r)) continue;

      const ang = xs.map((x, i) => Math.atan2(ys[i] - fit.y, x - fit.x)).sort((a, b) => a - b);
      let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
      for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
      if (gap > (100 * Math.PI) / 180) continue; // must wrap most of the way around

      let inward = 0;
      for (const t of tris) {
        const a = vid[t * 3], b = vid[t * 3 + 1], c = vid[t * 3 + 2];
        const mx = (vx[a] + vx[b] + vx[c]) / 3, my = (vy[a] + vy[b] + vy[c]) / 3;
        const dx = fit.x - mx, dy = fit.y - my, d = Math.hypot(dx, dy);
        if (d > 0) inward += (area[t] * (nx[t] * dx + ny[t] * dy)) / d;
      }
      if (inward <= 0) continue; // a round boss, not a hole

      cands.push({ x: fit.x, y: fit.y, r: fit.r, zmin, zmax });
    }

    // Merge coaxial pieces of the same bore.
    cands.sort((a, b) => a.zmin - b.zmin);
    const merged = [];
    for (const c of cands) {
      const m = merged.find((o) =>
        Math.hypot(o.x - c.x, o.y - c.y) < 0.05 && Math.abs(o.r - c.r) < 0.05 && c.zmin <= o.zmax + 0.05);
      if (m) { m.zmax = Math.max(m.zmax, c.zmax); m.zmin = Math.min(m.zmin, c.zmin); }
      else merged.push(Object.assign({}, c));
    }

    // What sits over (and under) each hole centre?
    const P = pos;
    for (const c of merged) {
      c.blockedAt = null;
      c.floor = false;
      for (let t = 0; t < nTri; t++) {
        if (isWall[t] || area[t] === 0) continue;
        const b = t * 9;
        const x0 = P[b], y0 = P[b + 1], x1 = P[b + 3], y1 = P[b + 4], x2 = P[b + 6], y2 = P[b + 7];
        if (c.x < Math.min(x0, x1, x2) - 1e-6 || c.x > Math.max(x0, x1, x2) + 1e-6) continue;
        if (c.y < Math.min(y0, y1, y2) - 1e-6 || c.y > Math.max(y0, y1, y2) + 1e-6) continue;
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-12) continue;
        const l0 = ((y1 - y2) * (c.x - x2) + (x2 - x1) * (c.y - y2)) / d;
        const l1 = ((y2 - y0) * (c.x - x2) + (x0 - x2) * (c.y - y2)) / d;
        const l2 = 1 - l0 - l1;
        const tol = -1e-6;
        if (l0 < tol || l1 < tol || l2 < tol) continue;
        const z = l0 * P[b + 2] + l1 * P[b + 5] + l2 * P[b + 8];
        if (z > c.zmax - 0.02) {
          if (c.blockedAt === null || z < c.blockedAt) c.blockedAt = z;
        } else if (Math.abs(z - c.zmin) < 0.05 && nz[t] > 0.5) {
          c.floor = true;
        }
      }
    }

    // Wall thickness: nearest other vertical wall around each hole, in XY,
    // over the hole's own height range.
    const segDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let u = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      u = Math.max(0, Math.min(1, u));
      return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
    };
    for (const c of merged) {
      let best = Infinity;
      const own = c.r * 1.02 + 0.05;
      for (let t = 0; t < nTri; t++) {
        if (!isWall[t]) continue;
        const b = t * 9;
        const z0 = Math.min(P[b + 2], P[b + 5], P[b + 8]), z1 = Math.max(P[b + 2], P[b + 5], P[b + 8]);
        if (z1 <= c.zmin + 0.01 || z0 >= c.zmax - 0.01) continue;
        const d = Math.min(
          segDist(c.x, c.y, P[b], P[b + 1], P[b + 3], P[b + 4]),
          segDist(c.x, c.y, P[b + 3], P[b + 4], P[b + 6], P[b + 7]),
          segDist(c.x, c.y, P[b + 6], P[b + 7], P[b], P[b + 1]));
        if (d > own && d < best) best = d;
      }
      c.wall = isFinite(best) ? best - c.r : null;
    }

    const holes = [], ignored = [];
    for (const c of merged) {
      const rec = {
        x: c.x, y: c.y, dia: 2 * c.r, top: c.zmax, bottom: c.zmin,
        depth: c.zmax - c.zmin, blind: c.floor, wall: c.wall,
      };
      if (c.blockedAt !== null) ignored.push(Object.assign(rec, { reason: 'blocked' }));
      else if (rec.dia < opts.dMin || rec.dia > opts.dMax) ignored.push(Object.assign(rec, { reason: 'size' }));
      else holes.push(rec);
    }
    holes.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    return { holes, ignored, triangles: nTri };
  }

  IP.holes = { detect, fitCircle };
})(typeof window !== 'undefined' ? window : globalThis);
