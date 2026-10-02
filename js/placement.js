/* InsertPress Planner — putting the part on the bed.
 *
 * Holes are stored in part-local coordinates (after the quarter-turn
 * orientation, with the part's bounding box starting at 0,0,0).
 * Placement adds a rotation about Z and a position, and copies repeat the part
 * in a grid. world = R(θ)·p + t, where t is chosen so the rotated footprint of
 * copy (0,0) starts at (place.x, place.y).
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  /** Convex hull of the part's XY footprint (Andrew's monotone chain). */
  function footprintHull(pos) {
    const pts = [];
    const seen = new Set();
    for (let i = 0; i < pos.length; i += 3) {
      const qx = Math.round(pos[i] * 1e4), qy = Math.round(pos[i + 1] * 1e4);
      const k = qx + ',' + qy;
      if (seen.has(k)) continue;
      seen.add(k);
      pts.push([qx / 1e4, qy / 1e4]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-6) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-6) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  /** Volume (signed tetrahedra) and surface area of a closed mesh. */
  function meshStats(pos) {
    let vol = 0, area = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
      const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
      const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    return { volume: Math.abs(vol), area };
  }

  /** Rotated footprint bounds for angle (degrees). */
  function rotatedBounds(hull, deg) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of hull) {
      const X = c * x - s * y, Y = s * x + c * y;
      if (X < minX) minX = X; if (X > maxX) maxX = X;
      if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    }
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Instances for a placement.
   * place = { x, y, rot }   copies = { nx, ny, gap, skip?: ['col,row', ...] }
   * Returns [{ i, col, row, rot, tx, ty }] in serpentine order (rows from the fence out).
   * Skipped grid cells are left out and the rest renumbered, so i stays contiguous.
   */
  function instances(hull, place, copies) {
    const b = rotatedBounds(hull, place.rot || 0);
    const nx = Math.max(1, copies ? copies.nx | 0 : 1), ny = Math.max(1, copies ? copies.ny | 0 : 1);
    const gap = copies ? copies.gap || 0 : 0;
    const skip = new Set((copies && copies.skip) || []);
    if (skip.size >= nx * ny) skip.clear();
    const out = [];
    for (let row = 0; row < ny; row++) {
      for (let k = 0; k < nx; k++) {
        const col = row % 2 ? nx - 1 - k : k;
        if (skip.has(col + ',' + row)) continue;
        out.push({
          i: out.length, col, row, rot: place.rot || 0,
          tx: place.x - b.minX + col * (b.w + gap),
          ty: place.y - b.minY + row * (b.h + gap),
        });
      }
    }
    return out;
  }

  /** Array footprint: overall size of all copies. */
  function arrayBounds(hull, place, copies) {
    const b = rotatedBounds(hull, place.rot || 0);
    const nx = Math.max(1, copies.nx | 0), ny = Math.max(1, copies.ny | 0);
    return {
      x: place.x, y: place.y,
      w: nx * b.w + (nx - 1) * copies.gap,
      h: ny * b.h + (ny - 1) * copies.gap,
      partW: b.w, partH: b.h,
    };
  }

  function toWorld(inst, x, y) {
    const a = (inst.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: c * x - s * y + inst.tx, y: s * x + c * y + inst.ty };
  }

  function toLocal(inst, x, y) {
    const a = (inst.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = x - inst.tx, dy = y - inst.ty;
    return { x: c * dx + s * dy, y: -s * dx + c * dy };
  }

  /** The footprint hull of one instance in bed coordinates. */
  function worldHull(hull, inst) { return hull.map(([x, y]) => { const w = toWorld(inst, x, y); return [w.x, w.y]; }); }

  /** New placement at angle `rot` that keeps the centre of the whole array where it was. */
  function rotateKeep(hull, place, copies, rot) {
    const a = arrayBounds(hull, place, copies);
    const b = arrayBounds(hull, { x: 0, y: 0, rot }, copies);
    return { x: a.x + a.w / 2 - b.w / 2, y: a.y + a.h / 2 - b.h / 2, rot };
  }

  /** Placement pushed to 'corner', 'left' (X 0), 'front' (Y 0) or 'center' of the bed. */
  function align(hull, place, copies, bed, where) {
    const a = arrayBounds(hull, place, copies);
    const p = { x: place.x, y: place.y, rot: place.rot };
    if (where === 'corner' || where === 'left') p.x = 0;
    if (where === 'corner' || where === 'front') p.y = 0;
    if (where === 'center') { p.x = Math.round((bed.x - a.w) * 5) / 10; p.y = Math.round((bed.y - a.h) * 5) / 10; }
    return p;
  }

  /**
   * As many copies as fit the travel from the current placement, with `gap`
   * between them, leaving out any that would overlap one of the `avoid` rects
   * ({ x0, y0, x1, y1 }, e.g. the tray grown by the gap). Returns { nx, ny, gap, skip, count }.
   * If every copy would overlap, it falls back to the one part where it is
   * (instances() never returns none) with blocked: true; the tray check flags it.
   */
  function autoFill(hull, place, bed, gap, avoid) {
    const b = rotatedBounds(hull, place.rot || 0);
    const fitN = (room, size) => Math.max(1, Math.min(20, Math.floor((room + gap + 1e-6) / (size + gap))));
    const nx = fitN(bed.x - place.x, b.w), ny = fitN(bed.y - place.y, b.h);
    const all = instances(hull, place, { nx, ny, gap });
    const hit = (IP.tray && IP.tray.polyRect) || (() => false);
    const skip = all.filter((inst) => (avoid || []).some((r) => hit(worldHull(hull, inst), r))).map((i) => i.col + ',' + i.row);
    if (skip.length >= nx * ny) return { nx: 1, ny: 1, gap, skip: [], count: 1, blocked: true };
    return { nx, ny, gap, skip, count: nx * ny - skip.length };
  }

  IP.place = { footprintHull, meshStats, rotatedBounds, instances, arrayBounds, toWorld, toLocal, worldHull, rotateKeep, align, autoFill };
})(typeof window !== 'undefined' ? window : globalThis);
