/* InsertPress Planner — measuring between two points in the view. Pure. */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  /** a, b = { x, y, z } in mm. */
  function between(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z || 0) - (a.z || 0);
    return { dx, dy, dz, d: Math.hypot(dx, dy, dz), dxy: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }

  /** Nearest candidate within maxD screen pixels: cands = [{ sx, sy, ... }]. */
  function nearest(cands, px, py, maxD) {
    let best = null, bd = maxD;
    for (const c of cands) {
      const d = Math.hypot(c.sx - px, c.sy - py);
      if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }

  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  function label(m) { return `${f2(m.d)} mm`; }
  function detail(m) {
    const parts = [`ΔX ${f2(m.dx)}`, `ΔY ${f2(m.dy)}`];
    if (Math.abs(m.dz) > 0.005) parts.push(`ΔZ ${f2(m.dz)}`);
    return parts.join('   ');
  }

  IP.measure = { between, nearest, label, detail };
})(typeof window !== 'undefined' ? window : globalThis);
