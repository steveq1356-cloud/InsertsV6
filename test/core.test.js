// Core tests from v3: STL, holes, placement, inserts, G-code, timeline, order.
'use strict';
module.exports = function (t) {
  const { IP, ok, near } = t;
  console.log('STL round trip');
  const raw = IP.exampleBlock();
  const buf = IP.stl.toBinarySTL(raw);
  const back = IP.stl.parseSTL(buf);
  ok(back.length === raw.length, `binary parse keeps ${raw.length / 9} triangles`);
  const ascii = 'solid t\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid t\n';
  ok(IP.stl.parseSTL(new TextEncoder().encode(ascii).buffer).length === 9, 'ASCII parse');
  const refuses = (buf) => { try { IP.stl.parseSTL(buf); return false; } catch (e) { return /not a readable STL/.test(e.message); } };
  const empty = new Uint8Array(84); new TextEncoder().encodeInto('solid empty', empty);
  ok(refuses(new ArrayBuffer(84)) && refuses(empty.buffer) && refuses(new TextEncoder().encode('solid t\nendsolid t\n').buffer),
    'a binary STL with 0 triangles is refused like an empty ASCII one');

  console.log('Placement');
  const part = IP.stl.preparePart(back, { rot: { x: 0, y: 0, z: 0 } });
  ok(near(part.size.x, 60) && near(part.size.y, 45) && near(part.size.z, 12), 'size 60 x 45 x 12');

  console.log('Hole detection');
  const t0 = Date.now();
  const res = IP.holes.detect(part.positions, { dMin: 2.5, dMax: 7 });
  console.log(`  (${Date.now() - t0} ms, ${res.holes.length} holes, ${res.ignored.length} ignored)`);
  ok(res.holes.length === 9, '9 usable holes (5 M3, M2.5, M5, through, shallow)');
  ok(res.ignored.filter((h) => h.reason === 'size').length === 1, 'large pocket ignored for size');
  ok(res.ignored.filter((h) => h.reason === 'blocked').length === 1, 'bottom hole ignored as blocked');
  const m5 = res.holes.find((h) => near(h.dia, 6.4, 0.05));
  ok(m5 && near(m5.top, 12) && near(m5.depth, 11) && m5.blind, 'M5 hole: top 12, depth 11, blind');
  const thru = res.holes.find((h) => near(h.depth, 12));
  ok(thru && !thru.blind && near(thru.x, 7.5) && near(thru.y, 22.5), 'through hole at 7.5, 22.5, not blind');
  // polygon vertices sit on the circle, so the fit is the circumradius
  ok(res.holes.every((h) => h.dia > 3 && h.dia < 7), 'all diameters in range');

  console.log('Rotation keeps holes facing up');
  const flipped = IP.stl.preparePart(back, { rot: { x: 2, y: 0, z: 0 } }); // upside down
  const resF = IP.holes.detect(flipped.positions, {});
  ok(resF.holes.length === 2 && resF.holes.some((h) => near(h.depth, 6)), 'flipped: bottom hole and through hole usable');
  const turned = IP.stl.preparePart(back, { rot: { x: 0, y: 0, z: 1 } });
  ok(near(turned.size.x, 45) && near(turned.size.y, 60), 'Z turn swaps footprint');
  ok(IP.holes.detect(turned.positions, {}).holes.length === 9, 'Z turn keeps all holes');

  console.log('Insert guess');
  ok(IP.gcode.guessInsert(4.0, 'm3') === 'm3', '4.0 mm -> M3');
  ok(IP.gcode.guessInsert(4.0, 'm3s') === 'm3s', '4.0 mm keeps M3 short when that is the default');
  ok(IP.gcode.guessInsert(6.4, 'm3') === 'm5', '6.4 mm -> M5');
  ok(IP.gcode.guessInsert(9, 'm3') === 'm3', '9 mm -> falls back');

  console.log('G-code');
  const holes = res.holes.map((h) => ({ x: h.x, y: h.y, H: h.top, dia: h.dia, depth: h.depth, blind: h.blind,
    insert: IP.gcode.guessInsert(h.dia, 'm3') }));
  const g = IP.gcode.generate({ name: 'test', size: part.size, holes, settings: {} });
  const lines = g.text.trim().split('\n');
  ok(lines.every((l) => l.length <= 72), 'every line fits GRBL buffer (<= 72 chars)');
  ok(g.text.includes('G38.3 Z11.9 F60'), 'press to surface - 0.1 sink with G38.3');
  ok(near(g.clearZ, 12 + 9.5 + 5), 'clear Z = part top + longest insert + clearance');
  ok(g.issues.some((i) => /deep/.test(i.text)), 'flags the shallow hole');
  ok(!g.issues.some((i) => i.level === 'error'), 'no errors');
  ok(/M2\s*$/.test(g.text), 'ends with M2');
  const gm = IP.gcode.generate({ name: 't', size: part.size, holes, settings: { mode: 'manual', overloadStop: false } });
  ok(!/G0 X/.test(gm.text) && /G1 Z11.9 F60/.test(gm.text), 'manual mode has no XY moves, uses G1');
  const bad = IP.gcode.generate({ name: 't', size: part.size, holes: [{ x: 250, y: 5, H: 3, insert: 'm3' }], settings: {} });
  ok(bad.issues.some((i) => i.level === 'error'), 'out-of-travel hole is an error');
  console.log('  est. ' + Math.round(g.seconds) + ' s');

  console.log('Fence, Z travel, long names');
  // Follow the tip through a file: no XY move may start or end within reach of a
  // fence rail (X 0 or Y 0) with the tip below the rail top.
  const D = IP.DEFAULT_SETTINGS;
  const reach = Math.max(D.ironTipD, D.ironNutD, D.ironBodyD) / 2 + D.ironMargin;
  const fenceClear = (text, fenceH) => {
    let z = null, at = null, bad = 0;
    for (const raw of text.split('\n')) {
      const c = raw.replace(/\([^)]*\)/g, '').replace(/;.*$/, '');
      const mx = /X(-?[\d.]+)/.exec(c), my = /Y(-?[\d.]+)/.exec(c), mz = /Z(-?[\d.]+)/.exec(c);
      if (mx && my) {
        const near = (p) => p && Math.min(p[0], p[1]) < reach;
        if ((near(at) || near([+mx[1], +my[1]])) && !(z >= fenceH)) bad++;
        at = [+mx[1], +my[1]];
      }
      if (mz) z = +mz[1];
    }
    return bad === 0;
  };
  const thinHoles = [{ x: 30, y: 30, H: 1, insert: 'm2' }, { x: 4, y: 40, H: 1, insert: 'm2' }];
  const low = IP.gcode.generate({ name: 'thin', partTop: 1, holes: thinHoles, settings: { clearance: 2 } });
  const tl = low.text.trim().split('\n');
  ok(near(low.clearZ, 6) && fenceClear(low.text, 8) && tl[tl.indexOf('G0 X0 Y0') - 1] === 'G0 Z10',
    'thin part, 6 mm travel: rises to Z10 (8 mm fence + 2) before parking at X0 Y0 and near the rail');
  ok(low.moves.every((m, i) => !i || near(m.t0, low.moves[i - 1].t1, 1e-6)) && near(low.moves[low.moves.length - 1].t1, low.seconds, 1e-6),
    'fence rises are on the timeline');
  const tall = IP.gcode.generate({ name: 't', partTop: 5, holes: [{ x: 30, y: 30, H: 5, insert: 'm3' }], settings: { fenceH: 20 } });
  ok(fenceClear(tall.text, 20) && !tall.issues.some((i) => i.level === 'error'), 'a 20 mm fence is cleared at the park');
  const tallT = IP.gcode.generate({ name: 't', partTop: 5, holes: [{ x: 30, y: 30, H: 5, insert: 'm3' }], settings: { fenceH: 30, feed: 'tray' } });
  ok(fenceClear(tallT.text, 30 + 5.7), 'tray mode: the hanging insert clears a 30 mm fence too');
  const wall = IP.gcode.generate({ name: 't', partTop: 5, holes: [{ x: 30, y: 30, H: 5, insert: 'm3' }], settings: { fenceH: 98 } });
  ok(wall.issues.some((i) => i.level === 'error' && /fence needs Z 103/.test(i.text)), 'clearing the fence above the Z travel is an error');
  const tallPart = { name: 't', partTop: 85, holes: [{ x: 30, y: 30, H: 85, insert: 'm3' }], settings: {} };
  const zErr = (r) => r.issues.some((i) => i.level === 'error' && /Z travel/.test(i.text));
  ok(!zErr(IP.gcode.generate(tallPart)) && zErr(IP.gcode.generate(Object.assign({ air: 20 }, tallPart))),
    'Z 95.7 fits the 100 mm travel, the air pass at Z 115.7 does not');
  const longName = 'enclosure-lid-v3-final-FINAL-for-real-printed-at-0.2mm-PETG (MSG,hi) Gehäuse.stl';
  const lhs = [{ x: 20, y: 20, H: 6, insert: 'm3', label: '1' }, { x: 120.123, y: 80.456, H: 6, insert: 'm5', label: '2' }];
  const variants = [{}, { feed: 'tray' }, { feed: 'tray', pick: 'G38.2' }, { feed: 'tray', air: 20 }, { mode: 'manual' }];
  const files = variants.map((o) => IP.gcode.generate({ name: longName, partTop: 6, holes: lhs, settings: Object.assign({}, o), pickProbe: o.pick, air: o.air }).text);
  ok(files.every((f) => f.trim().split('\n').every((l) => l.length < 72)), 'long job name: every line under 72 characters (hand, tray, export, air, Z only)');
  ok(files.every((f) => /^; InsertPress Planner job: enclosure-lid-v3[^()]*\.\.\.$/m.test(f) && !/\(MSG,hi/.test(f)), 'the name is shortened, with no parentheses to read as a message');


  console.log('Wall thickness');
  ok(res.holes.every((h) => h.wall != null), 'every hole has a wall measurement');
  const corner = res.holes.find((h) => near(h.x, 7.5) && near(h.y, 7.5));
  ok(corner && near(corner.wall, 5.5, 0.05), 'corner hole: 7.5 mm to edge minus 2 mm radius = 5.5 mm wall');
  const thin = IP.gcode.check([{ x: 5, y: 5, H: 5, dia: 4, wall: 0.8, insert: 'm3', localId: 1 }], IP.DEFAULT_SETTINGS);
  ok(thin.some((i) => /wall/.test(i.text)), 'thin wall is flagged');

  console.log('Placement');
  const hull = IP.place.footprintHull(part.positions);
  ok(hull.length === 4, 'box footprint hull has 4 corners');
  const ms = IP.place.meshStats(part.positions);
  const solid = 60 * 45 * 12;
  ok(ms.volume < solid && ms.volume > solid * 0.9, `volume ${Math.round(ms.volume)} mm3 is a box minus holes`);
  const inst = IP.place.instances(hull, { x: 10, y: 20, rot: 0 }, { nx: 3, ny: 2, gap: 5 });
  ok(inst.length === 6, '3 x 2 copies');
  ok(near(inst[0].tx, 10) && near(inst[0].ty, 20), 'first copy at the placement');
  ok(near(inst[1].tx, 75) && near(inst[5].tx, 10) && near(inst[5].ty, 70), 'grid pitch = size + gap, serpentine rows');
  const rot = IP.place.instances(hull, { x: 0, y: 0, rot: 90 }, { nx: 1, ny: 1, gap: 0 })[0];
  const w0 = IP.place.toWorld(rot, 0, 0), w1 = IP.place.toWorld(rot, 60, 45);
  ok(near(Math.min(w0.x, w1.x), 0) && near(Math.min(w0.y, w1.y), 0), 'rotated part still starts at the placement corner');
  const back2 = IP.place.toLocal(rot, w1.x, w1.y);
  ok(near(back2.x, 60) && near(back2.y, 45), 'toLocal inverts toWorld');
  const ab = IP.place.arrayBounds(hull, { x: 0, y: 0, rot: 90 }, { nx: 2, ny: 1, gap: 4 });
  ok(near(ab.w, 45 * 2 + 4) && near(ab.h, 60), 'array bounds for rotated copies');

  console.log('Timeline');
  ok(g.moves.length > 9 * 5, 'one move per G-code motion');
  ok(g.moves.every((m, i) => i === 0 || near(m.t0, g.moves[i - 1].t1, 1e-6)), 'moves are contiguous in time');
  ok(near(g.moves[g.moves.length - 1].t1, g.seconds, 1e-6), 'timeline ends at the job time');
  const press = g.moves.find((m) => m.kind === 'press');
  const mid = IP.gcode.sample(g.moves, (press.t0 + press.t1) / 2);
  ok(mid.move === press && near(mid.pos[2], (press.from[2] + press.to[2]) / 2), 'sample interpolates mid-press');
  ok(g.stats.bom.M3 === 7 && g.stats.bom.M5 === 1 && g.stats['inserts'] === 9, 'parts list counts inserts by size');
  ok(g.stats.travelDist > 0 && g.stats.time.press > 0 && g.stats.time.load > 0, 'time and distance breakdown');

  console.log('Order');
  const pts = [{ x: 50, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 0 }];
  const tour = IP.gcode.optimizeOrder(pts, 0, 0);
  ok(tour.map((p) => p.x).join() === '10,20,30,50', 'nearest-neighbour + 2-opt order');
};
