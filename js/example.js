/* InsertPress Planner — built-in example part.
 * A 60 × 45 × 12 mm block on a 15 mm grid with a mix of holes, so the
 * detector has real cases to sort out:
 *   five M3 blind holes, an M2.5, an M5, a through hole (all usable),
 *   a 4 mm hole that is too shallow for an M3 (flagged),
 *   a 10 mm pocket (ignored: too big), and a hole from the bottom (ignored: blocked).
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  function exampleBlock() {
    const S = 15, NX = 4, NY = 3, T = 12, N = 32;
    const top = (d, depth) => ({ d, depth, from: 'top' });
    // rows listed back (high Y) to front
    const layout = [
      [top(4, 7), top(4, 7), top(4, 7), top(4, 7)],
      [{ d: 4, from: 'through' }, top(10, 4), null, top(6.4, 11)],
      [top(4, 7), { d: 4, depth: 6, from: 'bottom' }, top(3.6, 5.5), top(4, 4)],
    ];
    const tris = [];
    const tri = (a, b, c) => tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const W = S * NX, D = S * NY, h = S / 2;

    for (let row = 0; row < NY; row++) {
      for (let col = 0; col < NX; col++) {
        const spec = layout[row][col];
        const cx = col * S + h, cy = D - (row * S + h);
        const ang = (k) => Math.PI / 4 + (k * 2 * Math.PI) / N;
        const sq = (k) => {
          const a = ang(k), r = h / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
          return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        };
        const ci = (k, r) => [cx + r * Math.cos(ang(k)), cy + r * Math.sin(ang(k))];
        const r = spec ? spec.d / 2 : 0;
        const openTop = spec && spec.from !== 'bottom';
        const openBot = spec && spec.from !== 'top';

        for (let k = 0; k < N; k++) {
          const b0 = sq(k), b1 = sq(k + 1);
          // top face (normal up)
          if (openTop) {
            const c0 = ci(k, r), c1 = ci(k + 1, r);
            tri([b0[0], b0[1], T], [b1[0], b1[1], T], [c1[0], c1[1], T]);
            tri([b0[0], b0[1], T], [c1[0], c1[1], T], [c0[0], c0[1], T]);
          } else {
            tri([cx, cy, T], [b0[0], b0[1], T], [b1[0], b1[1], T]);
          }
          // bottom face (normal down)
          if (openBot) {
            const c0 = ci(k, r), c1 = ci(k + 1, r);
            tri([b0[0], b0[1], 0], [c1[0], c1[1], 0], [b1[0], b1[1], 0]);
            tri([b0[0], b0[1], 0], [c0[0], c0[1], 0], [c1[0], c1[1], 0]);
          } else {
            tri([cx, cy, 0], [b1[0], b1[1], 0], [b0[0], b0[1], 0]);
          }
          if (!spec) continue;
          // bore wall (normal toward the axis)
          const z0 = spec.from === 'top' ? T - spec.depth : 0;
          const z1 = spec.from === 'bottom' ? spec.depth : T;
          const c0 = ci(k, r), c1 = ci(k + 1, r);
          tri([c0[0], c0[1], z0], [c1[0], c1[1], z1], [c1[0], c1[1], z0]);
          tri([c0[0], c0[1], z0], [c0[0], c0[1], z1], [c1[0], c1[1], z1]);
          if (spec.from === 'top') tri([cx, cy, z0], [c0[0], c0[1], z0], [c1[0], c1[1], z0]);      // floor, up
          if (spec.from === 'bottom') tri([cx, cy, z1], [c1[0], c1[1], z1], [c0[0], c0[1], z1]);   // ceiling, down
        }
      }
    }
    // outer walls (normals outward)
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    quad([0, 0, 0], [W, 0, 0], [W, 0, T], [0, 0, T]);
    quad([W, 0, 0], [W, D, 0], [W, D, T], [W, 0, T]);
    quad([W, D, 0], [0, D, 0], [0, D, T], [W, D, T]);
    quad([0, D, 0], [0, 0, 0], [0, 0, T], [0, D, T]);
    return new Float32Array(tris);
  }

  /**
   * A watertight part built on a rectilinear grid of cells.
   * cols: cell widths along X, rows: cell depths along Y (front row first),
   * cells[row][col] = { T: top height, hole?: { d, depth?, from: 'top'|'through'|'bottom' },
   *                     boss?: { d, h } }.
   * Each cell is a column; walls are added wherever neighbouring heights differ.
   * A boss is a round post of diameter d standing h above the cell top; its
   * hole (from 'top' = blind from the boss top, or 'through') goes down its axis.
   */
  function cellPart(cols, rows, cells, segs) {
    const M = Math.max(2, Math.round((segs || 32) / 4)); // segments per cell side
    const xs = [0], ys = [0];
    for (const w of cols) xs.push(xs[xs.length - 1] + w);
    for (const d of rows) ys.push(ys[ys.length - 1] + d);
    // shared side parameter, exactly antisymmetric so neighbouring cells meet bit for bit
    const t = new Array(M + 1);
    for (let j = 0; j <= M / 2; j++) {
      const v = Math.tan(-Math.PI / 4 + (j * Math.PI) / 2 / M);
      t[j] = j === 0 ? -1 : v;
      t[M - j] = j === 0 ? 1 : -v;
    }
    if (M % 2 === 0) t[M / 2] = 0;
    const tris = [];
    const tri = (a, b, c) => tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const height = (r, c) => (r < 0 || c < 0 || r >= rows.length || c >= cols.length || !cells[r][c] ? 0 : cells[r][c].T);

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const cell = cells[r][c];
        if (!cell) continue;
        const T = cell.T;
        const x0 = xs[c], x1 = xs[c + 1], y0 = ys[r], y1 = ys[r + 1];
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
        const X = (u) => (u === 1 ? x1 : u === -1 ? x0 : cx + hx * u);
        const Y = (v) => (v === 1 ? y1 : v === -1 ? y0 : cy + hy * v);
        // border loop, counterclockwise from the back-right corner: top, left, bottom, right sides
        const uv = [];
        for (let j = 0; j < M; j++) uv.push([-t[j], 1]);
        for (let j = 0; j < M; j++) uv.push([-1, -t[j]]);
        for (let j = 0; j < M; j++) uv.push([t[j], -1]);
        for (let j = 0; j < M; j++) uv.push([1, t[j]]);
        const N = uv.length;
        const B = uv.map(([u, v]) => [X(u), Y(v)]);
        const hole = cell.hole;
        const rr = hole ? hole.d / 2 : 0;
        const ring = (rad) => uv.map(([u, v]) => { const dx = u * hx, dy = v * hy, l = Math.hypot(dx, dy); return [cx + (rad * dx) / l, cy + (rad * dy) / l]; });
        const Cc = ring(rr);
        if (cell.boss) {
          const Q = ring(cell.boss.d / 2), Tb = T + cell.boss.h;
          const thru = hole && hole.from === 'through';
          for (let k = 0; k < N; k++) {
            const b0 = B[k], b1 = B[(k + 1) % N], q0 = Q[k], q1 = Q[(k + 1) % N], c0 = Cc[k], c1 = Cc[(k + 1) % N];
            tri([b0[0], b0[1], T], [b1[0], b1[1], T], [q1[0], q1[1], T]);          // plate top ring, up
            tri([b0[0], b0[1], T], [q1[0], q1[1], T], [q0[0], q0[1], T]);
            tri([q0[0], q0[1], T], [q1[0], q1[1], T], [q1[0], q1[1], Tb]);        // boss wall, outward
            tri([q0[0], q0[1], T], [q1[0], q1[1], Tb], [q0[0], q0[1], Tb]);
            if (hole) {                                                            // boss top ring, up
              tri([q0[0], q0[1], Tb], [q1[0], q1[1], Tb], [c1[0], c1[1], Tb]);
              tri([q0[0], q0[1], Tb], [c1[0], c1[1], Tb], [c0[0], c0[1], Tb]);
            } else tri([cx, cy, Tb], [q0[0], q0[1], Tb], [q1[0], q1[1], Tb]);
            if (thru) {                                                            // bottom, down
              tri([b0[0], b0[1], 0], [c1[0], c1[1], 0], [b1[0], b1[1], 0]);
              tri([b0[0], b0[1], 0], [c0[0], c0[1], 0], [c1[0], c1[1], 0]);
            } else tri([cx, cy, 0], [b1[0], b1[1], 0], [b0[0], b0[1], 0]);
            if (hole) {                                                            // bore, inward
              const z0 = thru ? 0 : Tb - hole.depth;
              tri([c0[0], c0[1], z0], [c1[0], c1[1], Tb], [c1[0], c1[1], z0]);
              tri([c0[0], c0[1], z0], [c0[0], c0[1], Tb], [c1[0], c1[1], Tb]);
              if (!thru) tri([cx, cy, z0], [c0[0], c0[1], z0], [c1[0], c1[1], z0]);
            }
          }
        }
        const openTop = hole && hole.from !== 'bottom';
        const openBot = hole && hole.from !== 'top';
        for (let k = 0; k < N && !cell.boss; k++) {
          const b0 = B[k], b1 = B[(k + 1) % N], c0 = Cc[k], c1 = Cc[(k + 1) % N];
          if (openTop) {
            tri([b0[0], b0[1], T], [b1[0], b1[1], T], [c1[0], c1[1], T]);
            tri([b0[0], b0[1], T], [c1[0], c1[1], T], [c0[0], c0[1], T]);
          } else tri([cx, cy, T], [b0[0], b0[1], T], [b1[0], b1[1], T]);
          if (openBot) {
            tri([b0[0], b0[1], 0], [c1[0], c1[1], 0], [b1[0], b1[1], 0]);
            tri([b0[0], b0[1], 0], [c0[0], c0[1], 0], [c1[0], c1[1], 0]);
          } else tri([cx, cy, 0], [b1[0], b1[1], 0], [b0[0], b0[1], 0]);
          if (hole) {
            const z0 = hole.from === 'top' ? T - hole.depth : 0;
            const z1 = hole.from === 'bottom' ? hole.depth : T;
            tri([c0[0], c0[1], z0], [c1[0], c1[1], z1], [c1[0], c1[1], z0]);
            tri([c0[0], c0[1], z0], [c0[0], c0[1], z1], [c1[0], c1[1], z1]);
            if (hole.from === 'top') tri([cx, cy, z0], [c0[0], c0[1], z0], [c1[0], c1[1], z0]);
            if (hole.from === 'bottom') tri([cx, cy, z1], [c1[0], c1[1], z1], [c0[0], c0[1], z1]);
          }
        }
        // side walls down to each lower neighbour (or the bed), facing outward
        const sides = [[r + 1, c], [r, c - 1], [r - 1, c], [r, c + 1]];
        sides.forEach(([nr, nc], si) => {
          const lo = height(nr, nc);
          if (lo >= T) return;
          for (let j = 0; j < M; j++) {
            const p = B[si * M + j], q = B[(si * M + j + 1) % N];
            tri([p[0], p[1], lo], [q[0], q[1], lo], [q[0], q[1], T]);
            tri([p[0], p[1], lo], [q[0], q[1], T], [p[0], p[1], T]);
          }
        });
      }
    }
    return new Float32Array(tris);
  }

  /**
   * An L bracket: a 6 mm base with a 60 mm upright along the back.
   * Three base holes sit 6 mm from the upright, close enough that the iron body
   * hits it (with the default iron), so the collision check has something to find.
   */
  function exampleBracket() {
    const base = 6, up = 60;
    const B = (hole) => ({ T: base, hole });
    const U = (hole) => ({ T: up, hole });
    const thru = (d) => ({ d, from: 'through' });
    const cells = [
      [B(), B(thru(4)), B(), B(thru(4)), B()],
      [B(), B(thru(4)), B(thru(3.6)), B(thru(4)), B()],
      [U(), U({ d: 3.2, depth: 4, from: 'top' }), U(), U({ d: 3.2, depth: 4, from: 'top' }), U()],
    ];
    return cellPart([10, 14, 16, 14, 10], [16, 12, 8], cells, 32);
  }

  /** Enclosure lid: a 3 mm plate with four ⌀8 corner bosses, an M3 hole in each. */
  function exampleLid() {
    const P = { T: 3 };
    const B = { T: 3, boss: { d: 8, h: 6 }, hole: { d: 4, depth: 7, from: 'top' } };
    return cellPart([12, 56, 12], [12, 36, 12], [[B, P, B], [P, P, P], [B, P, B]], 32);
  }

  /** PCB plate: Raspberry Pi M2.5 standoffs (58 × 49) and an M3 pair. */
  function examplePcb() {
    const P = () => ({ T: 3 });
    const pi = () => ({ T: 3, boss: { d: 7, h: 5 }, hole: { d: 3.6, depth: 4.5, from: 'top' } });
    const m3 = () => ({ T: 3, boss: { d: 8, h: 5 }, hole: { d: 4, depth: 6.2, from: 'top' } });
    const cols = [7, 10, 48, 10, 9, 12, 8], rows = [7, 10, 5, 12, 6, 12, 4, 10, 9];
    const cells = rows.map(() => cols.map(P));
    for (const r of [1, 7]) for (const c of [1, 3]) cells[r][c] = pi();
    for (const r of [3, 5]) cells[r][5] = m3();
    return cellPart(cols, rows, cells, 32);
  }

  /** A tab with one M3 hole 1 mm from the end: the thin-wall check flags it. */
  function exampleTab() {
    const P = { T: 8 }, H = { T: 8, hole: { d: 4, depth: 7, from: 'top' } };
    return cellPart([6, 13, 12, 9, 10], [16], [[H, P, H, P, H]], 32);
  }

  /** A cover whose four M3 holes open underneath: flip it to reach them. */
  function exampleCover() {
    const P = { T: 10 }, H = { T: 10, hole: { d: 4, depth: 7, from: 'bottom' } };
    return cellPart([10, 30, 10], [10, 20, 10], [[H, P, H], [P, P, P], [H, P, H]], 32);
  }

  /** A flat mounting panel with four M3 through holes, for copies and auto-fill. */
  function examplePanel() {
    const P = { T: 6 }, H = { T: 6, hole: { d: 4, from: 'through' } };
    return cellPart([12, 46, 12], [12, 21, 12], [[H, P, H], [P, P, P], [H, P, H]], 32);
  }

  // The gallery. `shows` is the one thing each example demonstrates.
  const EXAMPLES = [
    { id: 'block', file: 'example-block.stl', name: 'Test block', shows: 'Mixed sizes and the hole finder', make: exampleBlock },
    { id: 'bracket', file: 'example-bracket.stl', name: 'Bracket, tall wall', shows: 'The iron collision check', make: exampleBracket },
    { id: 'lid', file: 'example-lid.stl', name: 'Enclosure lid', shows: 'Holes on raised bosses', make: exampleLid },
    { id: 'pcb', file: 'example-pcb-plate.stl', name: 'PCB plate', shows: 'M2.5 and M3 standoffs', make: examplePcb },
    { id: 'tab', file: 'example-edge-tab.stl', name: 'Edge tab', shows: 'A thin-wall warning', make: exampleTab },
    { id: 'cover', file: 'example-cover.stl', name: 'Cover', shows: 'Holes underneath: flip it', make: exampleCover },
    { id: 'panel', file: 'example-panel.stl', name: 'Mounting panel', shows: 'Copies and auto-fill', make: examplePanel },
  ];

  IP.exampleBlock = exampleBlock;
  IP.exampleBracket = exampleBracket;
  IP.exampleLid = exampleLid;
  IP.examplePcb = examplePcb;
  IP.exampleTab = exampleTab;
  IP.exampleCover = exampleCover;
  IP.examplePanel = examplePanel;
  IP.EXAMPLES = EXAMPLES;
  IP.cellPart = cellPart;
})(typeof window !== 'undefined' ? window : globalThis);
