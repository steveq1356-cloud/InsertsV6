/* InsertPress Planner — G-code for GRBL 1.1, plus a motion timeline for preview.
 *
 * Coordinate convention (set up once per session on the machine):
 *   X0 Y0  = inside corner of the fence
 *   Z0     = tip touching the bed with the spring float relaxed (paper test)
 */
(function (root) {
  'use strict';
  const IP = (root.IP = root.IP || {});

  // Typical tapered brass inserts (CNC Kitchen-style sizes). Edit to match yours.
  // L = length, hole = recommended hole diameter, od = outside diameter of the knurl.
  const INSERTS = {
    m2:  { name: 'M2',       L: 3.0, hole: 3.2, od: 3.6 },
    m25: { name: 'M2.5',     L: 4.0, hole: 3.6, od: 4.6 },
    m3:  { name: 'M3',       L: 5.7, hole: 4.0, od: 5.0 },
    m3s: { name: 'M3 short', L: 3.0, hole: 4.0, od: 5.0 },
    m4:  { name: 'M4',       L: 8.1, hole: 5.6, od: 6.3 },
    m5:  { name: 'M5',       L: 9.5, hole: 6.4, od: 7.1 },
  };

  // Starting points for press settings by plastic. Tune on test prints.
  const MATERIALS = {
    pla:  { name: 'PLA',   tipTemp: 215, pressFeed: 60, dwell: 2.0 },
    petg: { name: 'PETG',  tipTemp: 235, pressFeed: 45, dwell: 3.0 },
    abs:  { name: 'ABS',   tipTemp: 245, pressFeed: 50, dwell: 2.5 },
    asa:  { name: 'ASA',   tipTemp: 250, pressFeed: 50, dwell: 2.5 },
    pa:   { name: 'Nylon', tipTemp: 260, pressFeed: 40, dwell: 3.0 },
    pc:   { name: 'PC',    tipTemp: 280, pressFeed: 35, dwell: 3.5 },
  };

  const DEFAULT_SETTINGS = {
    mode: 'xy',            // 'xy' moves X/Y; 'manual' pauses so you position the part
    feed: 'hand',          // 'hand' you place inserts; 'tray' the machine picks them from the tray
    loadMode: 'each',      // hand only: 'each' pause per hole; 'start' load every insert first
    overloadStop: true,    // press with G38.3 so the move halts if the float sensor trips
    defaultInsert: 'm3',
    material: 'pla',
    tipTemp: 215,          // °C, written into the job so you set the iron to match
    sink: 0.1,             // mm below the surface to finish the insert
    approachGap: 1.0,      // mm above the insert top before slowing to press feed
    pressFeed: 60,         // mm/min
    dwell: 2.0,            // s, hold at depth
    retractSlow: 2.0,      // mm, slow lift distance off the insert
    retractFeed: 120,      // mm/min
    clearance: 5.0,        // mm above (part top + longest insert) for travel
    minClear: 0,           // mm, never travel lower than this
    bedX: 200, bedY: 200,  // usable travel from the fence corner
    bedZ: 100,             // Z travel above Z0
    park: true, parkX: 0, parkY: 0,
    rapidXY: 1500, rapidZ: 400, // mm/min, used for time estimates and preview
    loadTime: 4,           // s per hand-loaded insert, for the time estimate
    insertCost: 0,         // $ per insert, for the parts list (0 hides the cost)
    wallMin: 1.0,          // mm of plastic wanted outside the knurl
    dMin: 2.5, dMax: 7.0,  // hole-detection diameter range
    // Iron envelope for the collision check, measured up from the tip end.
    // Defaults are a Pinecil V2 with a press tip; measure yours.
    ironTipD: 5, ironTipL: 25,   // exposed tip
    ironNutD: 10, ironNutL: 20,  // tip nut / front collar
    ironBodyD: 18,               // iron body
    carriageD: 0, carriageZ: 80, // Z carriage (0 = ignore)
    ironMargin: 0.5,             // mm added around every part of the iron
    fenceH: 8,                   // fence rail height above the bed
    // Touch-off with the float sensor
    tripTravel: 0.5,       // mm the float compresses before the sensor trips
    touchFeed: 60,         // mm/min
    touchMax: 30,          // mm, give up after this much travel
    pilotLen: 0,           // mm the tip goes into the insert before its face meets the insert top
    // Insert tray: pocket 1 is front-left; columns run +X, rows +Y; one size per row.
    trayX: 158, trayY: 146, trayPitch: 8, trayCols: 5, trayRows: 6,
    trayRowSizes: ['m3', 'm3', 'm3', 'm3', 'm25', 'm5'],
    trayTop: 12,           // Z of the tray's top face
    pocketDepth: 2,        // insert stands in a pocket this deep
    pickupDepth: 1,        // probe this far past the seat before calling the pocket empty
    pickupFeed: 120,       // mm/min
    trayEdge: 6,           // block edge beyond the outer pocket centres
    trayEmpty: 'next',     // live runs: 'next' try the next full pocket, 'pause' ask
  };

  function guessInsert(dia, fallback) {
    if (!dia) return fallback;
    let best = null, bd = Infinity;
    for (const [k, v] of Object.entries(INSERTS)) {
      const d = Math.abs(v.hole - dia);
      if (d < bd - 1e-9) { bd = d; best = k; }
    }
    if (best && INSERTS[fallback] && INSERTS[fallback].hole === INSERTS[best].hole) return fallback;
    return bd <= 0.6 ? best : fallback;
  }

  function fmt(v) {
    const t = (Math.round(v * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return t === '-0' ? '0' : t;
  }

  const labelOf = (h, i) => (h.label != null ? h.label : String(i + 1));

  /** Per-hole sanity checks. holes are in press order. */
  function check(holes, s) {
    const out = [];
    const seenLocal = new Set();
    holes.forEach((h, i) => {
      const n = labelOf(h, i);
      const ins = INSERTS[h.insert] || INSERTS[s.defaultInsert];
      // geometry checks only once per source hole, not for every copy
      const lk = h.localId != null ? h.localId : 'i' + i;
      if (!seenLocal.has(lk)) {
        seenLocal.add(lk);
        if (h.blind && h.depth != null && h.depth < ins.L + 0.3) {
          out.push({ level: 'warn', hole: n, localId: h.localId, text: `Hole ${n} is ${fmt(h.depth)} mm deep but the ${ins.name} insert is ${fmt(ins.L)} mm long. It will bottom out.` });
        }
        if (!h.blind && h.depth != null && h.depth > 0 && h.depth < ins.L - 0.05) {
          out.push({ level: 'warn', hole: n, localId: h.localId, text: `Hole ${n} goes through ${fmt(h.depth)} mm of plastic but the ${ins.name} insert is ${fmt(ins.L)} mm long. It will reach the bed before it is flush.` });
        }
        if (h.dia && Math.abs(h.dia - ins.hole) > 0.4) {
          out.push({ level: 'warn', hole: n, localId: h.localId, text: `Hole ${n} measures ${fmt(h.dia)} mm; ${ins.name} inserts usually want about ${fmt(ins.hole)} mm.` });
        }
        if (h.wall != null && h.dia) {
          const need = (ins.od - h.dia) / 2 + s.wallMin;
          if (h.wall < need) {
            out.push({ level: 'warn', hole: n, localId: h.localId, text: `Hole ${n} has ${fmt(h.wall)} mm of wall. An ${ins.name} insert wants about ${fmt(need)} mm, so the side may bulge or crack.` });
          }
        }
      }
      if (s.mode === 'xy' && (h.x < 0 || h.y < 0 || h.x > s.bedX || h.y > s.bedY)) {
        out.push({ level: 'error', hole: n, localId: h.localId, text: `Hole ${n} (X${fmt(h.x)} Y${fmt(h.y)}) is outside the ${s.bedX} × ${s.bedY} mm travel.` });
      }
      const sink = h.sink != null ? h.sink : s.sink;
      if (h.H - sink - (+s.pilotLen || 0) < 0) {
        out.push({ level: 'error', hole: n, localId: h.localId, text: `Hole ${n} would drive the tip below the bed.` });
      }
    });
    if (s.feed === 'tray' && s.mode !== 'xy' && holes.length) {
      out.push({ level: 'error', kind: 'tray', text: 'The tray needs X and Y motion. Switch the machine to X/Y in Machine setup, or load inserts by hand.' });
    }
    for (let i = 0; i < holes.length; i++) {
      for (let j = 0; j < i; j++) {
        if (Math.hypot(holes[j].x - holes[i].x, holes[j].y - holes[i].y) < 1) {
          out.push({ level: 'warn', hole: labelOf(holes[i], i), localId: holes[i].localId,
            text: `Holes ${labelOf(holes[j], j)} and ${labelOf(holes[i], i)} are less than 1 mm apart. Copies may overlap, or one is a duplicate.` });
        }
      }
    }
    return out;
  }

  /**
   * job = { name, partTop, holes:[{x,y,H,insert,sink?,dia?,depth?,blind?,wall?,label?,copy?,localId?}], settings,
   *         air?: mm, tray?: { full: [0|1 per pocket] }, pickProbe?: 'G38.3'|'G38.2' }
   * holes must be in press order and in machine coordinates.
   * air > 0 makes an air pass: every Z is that much higher, so nothing touches the part
   * (in tray mode the pickups become plain dips, so the inventory is untouched).
   * Tray mode (settings.feed === 'tray'): each hole starts with a trip to the next full
   * pocket of its size. Live runs pick with G38.3 so the sender can skip an empty pocket;
   * exported files pick with G38.2 so an empty pocket halts with ALARM:5.
   * Returns { text, issues, seconds, clearZ, moves, stats, air, picks }.
   */
  function generate(job) {
    const s = Object.assign({}, DEFAULT_SETTINGS, job.settings || {});
    const holes = job.holes || [];
    const issues = check(holes, s);
    const empty = { text: '', issues, seconds: 0, clearZ: 0, moves: [], stats: null, picks: [] };
    if (!holes.length) return empty;

    const air = Math.max(0, +job.air || 0);
    const ins = (h) => INSERTS[h.insert] || INSERTS[s.defaultInsert];
    const pilot = Math.max(0, +s.pilotLen || 0);
    const xy = s.mode === 'xy';
    const tray = xy && s.feed === 'tray' && IP.tray ? IP.tray : null;
    const probe = job.pickProbe === 'G38.2' ? 'G38.2' : 'G38.3';
    const maxL = Math.max(...holes.map((h) => ins(h).L));
    const top = job.partTop != null ? job.partTop : Math.max(...holes.map((h) => h.H));
    let A = null, clearZ;
    if (tray) {
      A = tray.assign(holes, s, job.tray && job.tray.full);
      issues.push(...tray.jobIssues(A));
      const hang = maxL - pilot;
      clearZ = Math.max(s.minClear, top + hang + s.clearance, tray.outline(s).z + hang + s.clearance);
    } else clearZ = Math.max(s.minClear, top + maxL + s.clearance);
    clearZ += air;
    // The fence rails run along X 0 and Y 0. Travel that starts or ends within reach
    // of them (parking at X0 Y0, a hole near a rail) rises to clear the rail top,
    // with the insert hanging below the tip in tray mode. A straight move is closest
    // to both rails at one of its ends, so checking the ends is enough.
    const reach = Math.max(+s.ironTipD || 0, +s.ironNutD || 0, +s.ironBodyD || 0) / 2 + Math.max(0, +s.ironMargin || 0);
    const fenceZ = +s.fenceH > 0 ? +s.fenceH + (tray ? maxL - pilot : 0) + s.clearance + air : -Infinity;
    const zAt = (x, y) => (xy && Math.min(x, y) < reach ? Math.max(clearZ, fenceZ) : clearZ);
    let topZ = clearZ;
    const mat = MATERIALS[s.material] || MATERIALS.pla;
    const out = [];
    const moves = [];
    const T = { travel: 0, rapidZ: 0, press: 0, dwell: 0, lift: 0, load: 0, tray: 0 };
    let dist = 0;
    let t = 0;
    let carry = null;
    let pos = [xy && s.park ? s.parkX : holes[0].x, xy && s.park ? s.parkY : holes[0].y, clearZ];
    const push = (l) => { out.push(l); return out.length - 1; };
    const move = (kind, to, feed, line, hole, bucket, extra) => {
      const d = Math.hypot(to[0] - pos[0], to[1] - pos[1], to[2] - pos[2]);
      const dur = feed ? (d / feed) * 60 : 0;
      moves.push(Object.assign({ kind, from: pos.slice(), to: to.slice(), t0: t, t1: t + dur, line, hole, carry }, extra || {}));
      t += dur; T[bucket] += dur;
      if (kind === 'travel') dist += Math.hypot(to[0] - pos[0], to[1] - pos[1]);
      pos = to.slice();
    };
    const wait = (kind, secs, line, hole, bucket) => {
      moves.push({ kind, from: pos.slice(), to: pos.slice(), t0: t, t1: t + secs, line, hole, carry });
      t += secs; T[bucket] += secs;
    };
    /** Rapid to (x, y), first rising to the travel height both ends need. */
    const travel = (x, y, hole, bucket, extra, note) => {
      const z = Math.max(zAt(pos[0], pos[1]), zAt(x, y));
      topZ = Math.max(topZ, z);
      if (pos[2] < z - 1e-9) move('rapid', [pos[0], pos[1], z], s.rapidZ, push(`G0 Z${fmt(z)}`), hole, bucket === 'tray' ? 'tray' : 'rapidZ', extra);
      move('travel', [x, y, pos[2]], s.rapidXY, push(`G0 X${fmt(x)} Y${fmt(y)}${note || ''}`), hole, bucket, extra);
    };

    // printable ASCII only (no parentheses, so no stray MSG), short enough for one line
    let name = String(job.name || 'untitled').replace(/[^\x20-\x7e]|[()]/g, '_');
    if (name.length > 44) name = name.slice(0, 41) + '...';
    push(`; InsertPress Planner job: ${name}`);
    if (air) push(`; AIR PASS: every Z is ${fmt(air)} mm higher. Nothing touches the part.`);
    push(`; ${holes.length} insert${holes.length === 1 ? '' : 's'}${job.copies > 1 ? ` across ${job.copies} copies` : ''}`);
    push(`; Material ${mat.name}, iron at ${fmt(s.tipTemp)} C`);
    push(`; Mode: ${xy ? 'X/Y motion' : 'Z only, part positioned by hand'}`);
    if (tray) {
      push(`; Inserts from the tray, picked with ${air ? 'plain dips (air pass)' : probe}`);
      push('; The tip is hot during pickup: use a metal or high-temp tray');
    }
    push('; Origin: X0 Y0 = fence corner, Z0 = bed surface (touch-off)');
    push(`; Clear Z${fmt(clearZ)}, press F${fmt(s.pressFeed)}, dwell ${fmt(s.dwell)} s`);
    push('G21 G90 G94 G17');
    push('G54');
    let l = push(`G0 Z${fmt(clearZ)}`);
    move('rapid', [pos[0], pos[1], clearZ], s.rapidZ, l, null, 'rapidZ');
    push(air ? '(MSG,Air pass: iron can stay cold. Cycle Start)'
      : tray ? `(MSG,Iron at ${fmt(s.tipTemp)}C and tray filled? Cycle Start)` : `(MSG,Set iron to ${fmt(s.tipTemp)}C then Cycle Start)`);
    l = push('M0');
    wait('pause', 1.5, l, null, 'load');
    if (!tray && s.loadMode === 'start' && !air) {
      push(`(MSG,Place all ${holes.length} inserts then Cycle Start)`);
      l = push('M0');
      wait('pause', s.loadTime * holes.length, l, null, 'load');
    }

    const picks = [];
    holes.forEach((h, i) => {
      const n = labelOf(h, i);
      const k = ins(h);
      const sink = h.sink != null ? h.sink : s.sink;
      const pick = A ? A.picks[i] : null;
      const hang = pick ? k.L - pilot : 0;
      const zAbove = (pick ? h.H + hang : h.H + k.L) + s.approachGap + air;
      const zFinal = h.H - sink - pilot + air;
      const zLift = Math.min(zFinal + s.retractSlow, clearZ);
      const where = h.copy != null && job.copies > 1 ? ` copy ${h.copy + 1}` : '';
      push('');
      push(`; Hole ${n}/${holes.length}${where}  X${fmt(h.x)} Y${fmt(h.y)} Z${fmt(h.H)} ${k.name}`);
      if (A && A.refill.has(i) && !air) {
        push(`(MSG,Refill the ${k.name} pockets then Cycle Start)`);
        l = push('M0');
        wait('pause', s.loadTime * 3, l, n, 'load');
      }
      if (pick) {
        const g = tray.geometry(s, pick.size);
        picks.push({ label: n, pocket: pick.i, n: pick.n, size: pick.size });
        push(`; Pick ${k.name} from pocket ${pick.n}`);
        travel(pick.x, pick.y, n, 'tray', { pocket: pick.i }, air ? '' : ` ; to P${pick.n} ${pick.size}`);
        l = push(`G0 Z${fmt(g.approach + air)}`);
        move('rapid', [pick.x, pick.y, g.approach + air], s.rapidZ, l, n, 'tray', { pocket: pick.i });
        l = push(air ? `G1 Z${fmt(g.trip + air)} F${fmt(s.pickupFeed)} ; dip P${pick.n}`
          : `${probe} Z${fmt(g.limit)} F${fmt(s.pickupFeed)} ; pick P${pick.n} ${pick.size}`);
        move('pick', [pick.x, pick.y, g.trip + air], s.pickupFeed, l, n, 'tray', { pocket: pick.i });
        carry = { key: pick.size, L: k.L, od: k.od, hang };
        l = push(`G1 Z${fmt(Math.min(g.seat + s.retractSlow + air, clearZ))} F${fmt(s.retractFeed)}`);
        move('lift', [pick.x, pick.y, Math.min(g.seat + s.retractSlow + air, clearZ)], s.retractFeed, l, n, 'tray', { pocket: pick.i });
        const zp = zAt(pick.x, pick.y);
        l = push(`G0 Z${fmt(zp)}`);
        move('rapid', [pick.x, pick.y, zp], s.rapidZ, l, n, 'tray', { pocket: pick.i });
      }
      if (xy) {
        travel(h.x, h.y, n, pick ? 'tray' : 'travel');
        if (!tray && s.loadMode === 'each') {
          push(air ? `(MSG,Hole ${n}: air pass, no insert)` : `(MSG,Hole ${n}: place ${k.name} insert)`);
          l = push('M0');
          wait('pause', s.loadTime, l, n, 'load');
        }
      } else {
        const what = air ? 'air pass, ' : s.loadMode === 'each' ? `place ${k.name}, ` : '';
        push(`(MSG,Hole ${n}: ${what}align X${fmt(h.x)} Y${fmt(h.y)})`);
        l = push('M0');
        pos = [h.x, h.y, pos[2]]; // the part moves, not the tip
        wait('pause', s.loadMode === 'each' ? s.loadTime + 3 : 3, l, n, 'load');
      }
      if (zAbove < pos[2]) {
        l = push(`G0 Z${fmt(zAbove)}`);
        move('rapid', [h.x, h.y, zAbove], s.rapidZ, l, n, 'rapidZ');
      }
      l = push(s.overloadStop
        ? `G38.3 Z${fmt(zFinal)} F${fmt(s.pressFeed)} ; press, halts if float trips`
        : `G1 Z${fmt(zFinal)} F${fmt(s.pressFeed)} ; press`);
      move('press', [h.x, h.y, zFinal], s.pressFeed, l, n, 'press');
      carry = null;
      l = push(`G4 P${fmt(s.dwell)}`);
      wait('dwell', s.dwell, l, n, 'dwell');
      l = push(`G1 Z${fmt(zLift)} F${fmt(s.retractFeed)}`);
      move('lift', [h.x, h.y, zLift], s.retractFeed, l, n, 'lift');
      const zh = zAt(h.x, h.y);
      l = push(`G0 Z${fmt(zh)}`);
      move('rapid', [h.x, h.y, zh], s.rapidZ, l, n, 'rapidZ');
    });

    push('');
    push('; Done');
    push(`G0 Z${fmt(Math.max(pos[2], clearZ))}`);
    if (xy && s.park) travel(s.parkX, s.parkY, null, 'travel');
    push('M2');
    if (+s.bedZ > 0 && topZ > s.bedZ + 1e-9) {
      const why = topZ > clearZ + 1e-9 ? `Clearing the ${fmt(s.fenceH)} mm fence needs Z ${fmt(topZ)}, above`
        : `Travel height Z ${fmt(topZ)}${air ? ` (air pass +${fmt(air)} mm)` : ''} is above`;
      issues.push({ level: 'error', text: `${why} the ${fmt(s.bedZ)} mm Z travel. Lower the clearance or the tray, or raise the Z travel in Machine setup.` });
    }

    const bom = {};
    for (const h of holes) { const k = ins(h); bom[k.name] = (bom[k.name] || 0) + 1; }
    const stats = {
      inserts: holes.length,
      bom,
      cost: holes.length * s.insertCost,
      travelDist: dist,
      time: T,
      machineSeconds: T.travel + T.rapidZ + T.press + T.dwell + T.lift + T.tray,
      lines: out.length,
      trayTrips: picks.length,
      refills: A ? A.refill.size : 0,
    };
    return { text: out.join('\n') + '\n', issues, seconds: t, clearZ, moves, stats, air, picks, assign: A };
  }

  /** Tip position at time t from a moves list. */
  function sample(moves, t) {
    if (!moves.length) return null;
    let lo = 0, hi = moves.length - 1;
    if (t <= moves[0].t0) return { pos: moves[0].from, move: moves[0], index: 0 };
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (moves[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    const m = moves[lo];
    const span = m.t1 - m.t0;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - m.t0) / span)) : 1;
    return {
      pos: [m.from[0] + (m.to[0] - m.from[0]) * f, m.from[1] + (m.to[1] - m.from[1]) * f, m.from[2] + (m.to[2] - m.from[2]) * f],
      move: m, index: lo,
    };
  }

  /** Nearest-neighbour tour from (sx, sy), then 2-opt cleanup. Returns a new array. */
  function optimizeOrder(points, sx, sy) {
    const left = points.slice();
    const tour = [];
    let cx = sx, cy = sy;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((p, i) => { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; bi = i; } });
      const p = left.splice(bi, 1)[0];
      tour.push(p); cx = p.x; cy = p.y;
    }
    const start = { x: sx, y: sy };
    const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let improved = true, guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      for (let i = 0; i < tour.length - 1 && !improved; i++) {
        const a = i === 0 ? start : tour[i - 1], b = tour[i];
        for (let j = i + 1; j < tour.length; j++) {
          const c = tour[j], d = tour[j + 1];
          const before = D(a, b) + (d ? D(c, d) : 0);
          const after = D(a, c) + (d ? D(b, d) : 0);
          if (after < before - 1e-9) {
            const seg = tour.slice(i, j + 1).reverse();
            tour.splice(i, seg.length, ...seg);
            improved = true;
            break;
          }
        }
      }
    }
    return tour;
  }

  IP.INSERTS = INSERTS;
  IP.MATERIALS = MATERIALS;
  IP.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  IP.gcode = { generate, check, guessInsert, optimizeOrder, sample, fmt };
})(typeof window !== 'undefined' ? window : globalThis);
