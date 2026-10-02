/* InsertPress Planner — small shaded thumbnails of a part, drawn on a 2D canvas
 * (no WebGL needed): isometric from the front left, back faces culled,
 * painter's sort, soft light. render() returns a PNG data URL.
 */
(function () {
  'use strict';
  const IP = window.IP;
  const EL = (32 * Math.PI) / 180;
  const R = [Math.SQRT1_2, -Math.SQRT1_2, 0];
  const V = [Math.cos(EL) * Math.SQRT1_2, Math.cos(EL) * Math.SQRT1_2, -Math.sin(EL)];
  const U = [Math.sin(EL) * Math.SQRT1_2, Math.sin(EL) * Math.SQRT1_2, Math.cos(EL)];
  const L = (() => { const l = [-0.35, -0.75, 0.9]; const n = Math.hypot(...l); return l.map((v) => v / n); })();
  const dot = (a, x, y, z) => a[0] * x + a[1] * y + a[2] * z;

  function render(pos, w, h, opts) {
    opts = opts || {};
    const dpr = 2;
    const c = document.createElement('canvas');
    c.width = w * dpr; c.height = h * dpr;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const n = pos.length / 9;
    const tris = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const sx = dot(R, pos[i], pos[i + 1], pos[i + 2]), sy = -dot(U, pos[i], pos[i + 1], pos[i + 2]);
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    for (let t = 0; t < n; t++) {
      const b = t * 9;
      const ux = pos[b + 3] - pos[b], uy = pos[b + 4] - pos[b + 1], uz = pos[b + 5] - pos[b + 2];
      const vx = pos[b + 6] - pos[b], vy = pos[b + 7] - pos[b + 1], vz = pos[b + 8] - pos[b + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (!l) continue;
      nx /= l; ny /= l; nz /= l;
      if (dot(V, nx, ny, nz) >= 0) continue; // facing away
      const d = (dot(V, pos[b], pos[b + 1], pos[b + 2]) + dot(V, pos[b + 3], pos[b + 4], pos[b + 5]) + dot(V, pos[b + 6], pos[b + 7], pos[b + 8])) / 3;
      const lit = Math.max(0, dot(L, nx, ny, nz));
      tris.push({ b, d, lit, up: nz });
    }
    tris.sort((a, b) => b.d - a.d);
    const pad = opts.pad == null ? 8 : opts.pad;
    const k = Math.min((w - 2 * pad) / Math.max(1e-6, x1 - x0), (h - 2 * pad) / Math.max(1e-6, y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2 - x0 * k, oy = (h - (y1 - y0) * k) / 2 - y0 * k;
    const P = (i) => [ox + dot(R, pos[i], pos[i + 1], pos[i + 2]) * k, oy - dot(U, pos[i], pos[i + 1], pos[i + 2]) * k];
    x.lineJoin = 'round';
    x.lineWidth = 0.6;
    const base = opts.color || [214, 219, 221];
    for (const t of tris) {
      const v = 0.42 + 0.58 * t.lit;
      const col = `rgb(${Math.round(base[0] * v)},${Math.round(base[1] * v)},${Math.round(base[2] * v)})`;
      const a = P(t.b), bb = P(t.b + 3), cc = P(t.b + 6);
      x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(bb[0], bb[1]); x.lineTo(cc[0], cc[1]); x.closePath();
      x.fillStyle = col; x.strokeStyle = col; x.fill(); x.stroke();
    }
    return c.toDataURL('image/png');
  }

  IP.thumb = { render };
})();
