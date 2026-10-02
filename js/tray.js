/* InsertPress Planner — the insert tray ("parking lot"). Pure: runs in Node.
 *
 * A fixed block with a grid of pockets, one insert per pocket. Pocket 1 is the
 * front-left pocket (lowest X and Y); columns run along +X, rows along +Y, and
 * every row holds one insert size. The machine picks an insert by lowering the
 * hot tip into it with G38.3: the float trips when the tip seats in the insert
 * bore. No trip by the pickup depth means the pocket is empty.
 *
 * Z geometry (Z = tip end, the face touched off on the bed as Z0):
 *   seat  = trayTop − pocketDepth + L − pilot   tip end when it touches the insert
 *   trip  = seat − tripTravel                   where the float trips on a full pocket
 *   limit = seat − pickupDepth                  G38.3 target; no trip = empty pocket
 *   hang  = L − pilot                           insert below the tip end while carried
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});
  const POCKET_CLEAR = 0.4; // pocket bore = knurl OD + this
  const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
  const fmt = (v) => {
    const t = (Math.round(v * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return t === '-0' ? '0' : t;
  };

  function dims(s) { return { rows: int(s.trayRows, 1, 20), cols: int(s.trayCols, 1, 20) }; }

  /** Insert key held by a row ('' = row unused). Missing entries repeat the last one. */
  function rowSize(s, row) {
    const a = Array.isArray(s.trayRowSizes) ? s.trayRowSizes : [];
    if (!a.length) return s.defaultInsert || 'm3';
    const k = row < a.length ? a[row] : a[a.length - 1];
    return k && IP.INSERTS && !IP.INSERTS[k] ? '' : k || '';
  }

  /** Every pocket: { i, n (1-based), row, col, x, y, size }. */
  function pockets(s) {
    const { rows, cols } = dims(s);
    const p = +s.trayPitch || 8;
    const out = [];
    for (let r = 0; r < rows; r++) {
      const size = rowSize(s, r);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        out.push({ i, n: i + 1, row: r, col: c, x: +s.trayX + c * p, y: +s.trayY + r * p, size });
      }
    }
    return out;
  }

  /** Tray block outline in bed coordinates, and its height including inserts sticking up. */
  function outline(s) {
    const { rows, cols } = dims(s);
    const p = +s.trayPitch || 8, e = Math.max(0, +s.trayEdge || 0);
    let stick = 0;
    for (let r = 0; r < rows; r++) {
      const k = rowSize(s, r);
      if (k && IP.INSERTS[k]) stick = Math.max(stick, IP.INSERTS[k].L - s.pocketDepth);
    }
    return {
      x0: +s.trayX - e, y0: +s.trayY - e,
      x1: +s.trayX + (cols - 1) * p + e, y1: +s.trayY + (rows - 1) * p + e,
      top: +s.trayTop, z: +s.trayTop + Math.max(0, stick), stick,
    };
  }

  /** Z geometry for one insert size. */
  function geometry(s, key) {
    const ins = IP.INSERTS[key] || IP.INSERTS[s.defaultInsert] || IP.INSERTS.m3;
    const L = ins.L, pilot = Math.max(0, +s.pilotLen || 0), t = Math.max(0, +s.tripTravel || 0);
    const T = +s.trayTop, d = +s.pocketDepth;
    const seat = T - d + L - pilot;
    const bore = ins.od + POCKET_CLEAR;
    const fits = (+s.ironTipD || 0) <= bore + 1e-9;
    const stick = L - d;
    return {
      key, name: ins.name, L, od: ins.od, bore, fits, stick, pilot,
      insertTop: T - d + L, floor: T - d,
      seat, approach: seat + (+s.approachGap || 0), trip: seat - t, limit: seat - (+s.pickupDepth || 0),
      hang: L - pilot,
      // pickup depths at or past this let an empty pocket trip the float too
      maxDepth: fits ? L - pilot + t : stick + t,
      minDepth: t,
    };
  }

  /* ---------- inventory: one 0/1 per pocket, 1 = full ---------- */
  function count(s) { const d = dims(s); return d.rows * d.cols; }
  function blank(s, v) { return new Array(count(s)).fill(v == null ? 1 : v); }
  /** An inventory that matches the tray's size (a mismatched one starts full). */
  function fit(full, s) { return Array.isArray(full) && full.length === count(s) ? full.slice() : blank(s, 1); }
  /** Per size: { full, total }. */
  function counts(s, full) {
    const out = {};
    const f = fit(full, s);
    for (const p of pockets(s)) {
      if (!p.size) continue;
      const c = out[p.size] || (out[p.size] = { full: 0, total: 0 });
      c.total++;
      if (f[p.i]) c.full++;
    }
    return out;
  }

  /**
   * Which pocket each hole picks from, in press order.
   * Uses the first full pocket of the hole's size (row by row). When a size runs
   * out the job pauses for a refill and starts again from the first pocket.
   * Returns { picks: [pocket|null], refill: Set(hole index), need, have, short, missing, after }.
   */
  function assign(holes, s, full) {
    const pk = pockets(s);
    const state = fit(full, s);
    const bySize = {};
    for (const p of pk) if (p.size) (bySize[p.size] || (bySize[p.size] = [])).push(p);
    const have = {};
    for (const k in bySize) have[k] = bySize[k].filter((p) => state[p.i]).length;
    const need = {}, picks = [], refill = new Set(), missing = new Set();
    holes.forEach((h, i) => {
      const k = h.insert || s.defaultInsert;
      need[k] = (need[k] || 0) + 1;
      const mine = bySize[k];
      if (!mine) { missing.add(k); picks.push(null); return; }
      let p = mine.find((q) => state[q.i]);
      if (!p) { refill.add(i); for (const q of mine) state[q.i] = 1; p = mine[0]; }
      state[p.i] = 0;
      picks.push(p);
    });
    const short = {};
    for (const k in need) if (bySize[k] && need[k] > have[k]) short[k] = need[k] - have[k];
    return { picks, refill, need, have, short, missing: [...missing], after: state };
  }

  /** Next full pocket of a size after (or including) pocket index `from`, else the first one. */
  function nextFull(s, full, size, from) {
    const pk = pockets(s).filter((p) => p.size === size && full[p.i]);
    return pk.find((p) => p.i >= (from || 0)) || pk[0] || null;
  }

  /** G-code to try another pocket after an empty one (tip is down in the empty pocket). */
  function retryText(s, pocket, clearZ, probe) {
    const g = geometry(s, pocket.size);
    return [
      `G0 Z${fmt(clearZ)}`,
      `G0 X${fmt(pocket.x)} Y${fmt(pocket.y)} ; to P${pocket.n} ${pocket.size}`,
      `G0 Z${fmt(g.approach)}`,
      `${probe || 'G38.3'} Z${fmt(g.limit)} F${fmt(s.pickupFeed)} ; pick P${pocket.n} ${pocket.size}`,
    ].join('\n');
  }

  /* ---------- checks ---------- */

  /** Does a convex polygon [[x,y]...] overlap the rectangle {x0,y0,x1,y1}? (separating axes) */
  function polyRect(poly, r) {
    if (!poly || poly.length < 3) return false;
    const rect = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    const axes = [[1, 0], [0, 1]];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      axes.push([-(b[1] - a[1]), b[0] - a[0]]);
    }
    for (const [ax, ay] of axes) {
      let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
      for (const [x, y] of poly) { const d = x * ax + y * ay; if (d < p0) p0 = d; if (d > p1) p1 = d; }
      for (const [x, y] of rect) { const d = x * ax + y * ay; if (d < q0) q0 = d; if (d > q1) q1 = d; }
      const eps = 1e-6 * (Math.abs(ax) + Math.abs(ay));
      if (p1 <= q0 + eps || q1 <= p0 + eps) return false;
    }
    return true;
  }

  /**
   * Tray problems. ctx = { hulls: [[ [x,y]... ] per copy, world], sizes: [insert keys the job uses] }
   * Returns [{ level, kind: 'tray', text }].
   */
  function issues(s, ctx) {
    ctx = ctx || {};
    const out = [];
    const err = (text) => out.push({ level: 'error', kind: 'tray', text });
    const warn = (text) => out.push({ level: 'warn', kind: 'tray', text });
    if (s.mode !== 'xy') err('The tray needs X and Y motion. Switch the machine to X/Y in Machine setup, or load inserts by hand.');
    const pk = pockets(s);
    const outside = pk.filter((p) => p.x < 0 || p.y < 0 || p.x > s.bedX || p.y > s.bedY);
    if (outside.length) err(`${outside.length === pk.length ? 'The tray is' : `Pocket ${outside[0].n} is`} outside the ${s.bedX} × ${s.bedY} mm travel. Move the tray in Machine setup.`);
    const ol = outline(s);
    (ctx.hulls || []).forEach((h, i) => {
      if (polyRect(h, ol)) err(`${(ctx.hulls.length > 1 ? `Copy ${i + 1}` : 'The part')} sits on the tray. Move it, or use Auto-fill to keep copies off the tray.`);
    });
    const t = +s.tripTravel || 0, D = +s.pickupDepth || 0;
    if (D < t + 0.2) err(`Pickup depth ${fmt(D)} mm is too shallow: a full pocket needs more than the ${fmt(t)} mm float travel to trip. Use at least ${fmt(t + 0.2)} mm.`);
    const seen = new Set();
    for (const p of pk) {
      if (!p.size || seen.has(p.size)) continue;
      seen.add(p.size);
      const g = geometry(s, p.size);
      if (!g.fits && g.stick < 0) err(`${g.name} inserts sit ${fmt(-g.stick)} mm below the tray top and the ⌀${fmt(s.ironTipD)} tip is wider than the ⌀${fmt(g.bore)} pocket, so the tip can't reach them. Make the pockets shallower than ${fmt(g.L)} mm.`);
      else if (D > g.maxDepth - 0.2) {
        const why = g.fits ? `the tip would reach the floor of an empty ${g.name} pocket` : `the ⌀${fmt(s.ironTipD)} tip lands on the tray top beside an empty ${g.name} pocket (⌀${fmt(g.bore)})`;
        err(`Pickup depth ${fmt(D)} mm is too deep: ${why} and trip the float, so it would look full. Use less than ${fmt(Math.max(0, g.maxDepth - 0.2))} mm.`);
      }
    }
    const tipR = (+s.ironTipD || 0) / 2 + (+s.ironMargin || 0);
    const maxOd = Math.max(0, ...pk.filter((p) => p.size).map((p) => IP.INSERTS[p.size].od));
    if (dims(s).rows * dims(s).cols > 1 && +s.trayPitch < tipR + maxOd / 2) warn(`Pockets are ${fmt(s.trayPitch)} mm apart; the tip may touch the insert in the next pocket. ${fmt(Math.ceil((tipR + maxOd / 2) * 2) / 2)} mm or more is safer.`);
    for (const k of ctx.sizes || []) {
      if (!pk.some((p) => p.size === k)) err(`No tray row holds ${IP.INSERTS[k] ? IP.INSERTS[k].name : k} inserts. Give it a row in Machine setup, or load by hand.`);
    }
    return out;
  }

  /** Issues from an assignment: missing sizes are errors, a short tray is a warning. */
  function jobIssues(A) {
    const out = [];
    for (const k of A.missing) out.push({ level: 'error', kind: 'tray', text: `No tray row holds ${IP.INSERTS[k] ? IP.INSERTS[k].name : k} inserts. Give it a row in Machine setup, or load by hand.` });
    for (const k in A.short) {
      const n = IP.INSERTS[k] ? IP.INSERTS[k].name : k;
      out.push({ level: 'warn', kind: 'tray', short: k, text: `The tray has ${A.have[k]} ${n} insert${A.have[k] === 1 ? '' : 's'} but the job needs ${A.need[k]}. It will pause for you to refill the ${n} pockets.` });
    }
    return out;
  }

  /* ---------- path ---------- */

  /** Travel of a press order in tray mode: start → pocket → hole → pocket → hole … */
  function cost(order, s, full, start) {
    const state = fit(full, s);
    const pk = pockets(s);
    let x = start[0], y = start[1], d = 0;
    for (const h of order) {
      let p = pk.find((q) => q.size === h.insert && state[q.i]);
      if (!p) { for (const q of pk) if (q.size === h.insert) state[q.i] = 1; p = pk.find((q) => q.size === h.insert); }
      if (p) { state[p.i] = 0; d += Math.hypot(p.x - x, p.y - y); x = p.x; y = p.y; }
      d += Math.hypot(h.x - x, h.y - y); x = h.x; y = h.y;
    }
    return d;
  }

  /** Press order that keeps tray round trips short: greedy on the real cost, then 2-opt. */
  function optimize(points, s, full, start) {
    const left = points.slice(), tour = [];
    const state = fit(full, s), pk = pockets(s);
    let x = start[0], y = start[1];
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((h, i) => {
        const p = pk.find((q) => q.size === h.insert && state[q.i]) || pk.find((q) => q.size === h.insert);
        const d = p ? Math.hypot(p.x - x, p.y - y) + Math.hypot(h.x - p.x, h.y - p.y) : Math.hypot(h.x - x, h.y - y);
        if (d < bd - 1e-9) { bd = d; bi = i; }
      });
      const h = left.splice(bi, 1)[0];
      const p = pk.find((q) => q.size === h.insert && state[q.i]);
      if (p) state[p.i] = 0;
      tour.push(h); x = h.x; y = h.y;
    }
    if (tour.length > 150) return tour;
    let best = cost(tour, s, full, start), guard = 0, improved = true;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 0; i < tour.length - 1; i++) {
        for (let j = i + 1; j < tour.length; j++) {
          const cand = tour.slice(0, i).concat(tour.slice(i, j + 1).reverse(), tour.slice(j + 1));
          const c = cost(cand, s, full, start);
          if (c < best - 1e-6) { best = c; tour.splice(0, tour.length, ...cand); improved = true; }
        }
      }
    }
    return tour;
  }

  /* ---------- simulator ---------- */

  /** Is the float pressed by a full pocket at tip position (x, y, z)? full = the tray's real contents. */
  function simProbe(s, full, x, y, z) {
    for (const p of pockets(s)) {
      if (Math.abs(x - p.x) > 0.8 || Math.abs(y - p.y) > 0.8 || Math.hypot(x - p.x, y - p.y) > 0.8) continue;
      if (!full[p.i] || !p.size) return false;
      return z <= geometry(s, p.size).trip + 1e-6;
    }
    return false;
  }

  /** Pocket under (x, y), if any. */
  function pocketAt(s, x, y, r) {
    let best = null, bd = r == null ? 0.8 : r;
    for (const p of pockets(s)) { const d = Math.hypot(x - p.x, y - p.y); if (d <= bd) { bd = d; best = p; } }
    return best;
  }

  IP.tray = {
    POCKET_CLEAR, dims, rowSize, pockets, outline, geometry,
    count, blank, fit, counts, assign, nextFull, retryText,
    polyRect, issues, jobIssues, cost, optimize, simProbe, pocketAt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
