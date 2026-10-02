// Iron collision check.
'use strict';
module.exports = function (t) {
  const { IP, ok, near } = t;
  const C = IP.collision;
  const S = IP.DEFAULT_SETTINGS;

  const setup = (raw, settings, copies, place) => {
    const part = IP.stl.preparePart(raw, {});
    const det = IP.holes.detect(part.positions, {});
    const hull = IP.place.footprintHull(part.positions);
    const insts = IP.place.instances(hull, place || { x: 0, y: 0, rot: 0 }, copies || { nx: 1, ny: 1, gap: 6 });
    const holes = [];
    for (const inst of insts) det.holes.forEach((h, i) => {
      const w = IP.place.toWorld(inst, h.x, h.y);
      holes.push({ x: w.x, y: w.y, H: h.top, label: String(inst.i * det.holes.length + i + 1), localId: i, copy: inst.i });
    });
    const s = Object.assign({}, S, settings || {});
    const res = C.check(holes, { index: new C.Index(part.positions), instances: insts, partSize: part.size,
      zones: C.zonesFrom(s), margin: s.ironMargin, sink: s.sink, fenceH: s.fenceH });
    return { part, det, holes, res };
  };

  console.log('Iron zones');
  const z = C.zonesFrom(S);
  ok(z.length === 3 && z[0].key === 'tip' && z[1].from === 25 && z[2].from === 45, 'tip, nut, body stacked from the tip end');
  ok(C.zonesFrom(Object.assign({}, S, { carriageD: 40, carriageZ: 70 })).pop().from === 70, 'optional carriage zone');

  console.log('Clipping');
  const flat = new Float32Array([-10, -10, 5, 10, -10, 5, 0, 10, 5]);
  ok(C.clipMax(flat, 0, 0, 0, 2).z === 5, 'flat triangle over the hole: its height');
  ok(C.clipMax(flat, 0, 30, 0, 2) === null, 'triangle out of reach: nothing');
  const slope = new Float32Array([-10, 0, 0, 10, 0, 20, 10, 5, 20]);
  const sl = C.clipMax(slope, 0, 0, 1, 2);
  ok(sl && near(sl.z, 12, 0.15), `slope: highest point inside the circle (${sl && sl.z.toFixed(2)})`);
  const wall = new Float32Array([3, -5, 0, 3, 5, 0, 3, 5, 40]);
  ok(near(C.clipMax(wall, 0, 0, 0, 4).z, 40 * (Math.sqrt(16 - 9) + 5) / 10, 0.2), 'vertical wall clipped exactly');

  console.log('Example block');
  const blk = setup(IP.exampleBlock());
  ok(blk.res.every((r) => r.hits.length === 0), 'flat block: no collisions');

  console.log('Bracket with a 60 mm upright');
  const br = setup(IP.exampleBracket());
  const hitIds = br.res.filter((r) => r.hits.length).map((r) => r.localId);
  const nearWall = br.det.holes.map((h, i) => (near(h.y, 22) ? i : -1)).filter((i) => i >= 0);
  ok(hitIds.length === 3 && nearWall.every((i) => hitIds.includes(i)), 'the three holes 6 mm from the upright collide');
  const hit = br.res.find((r) => r.hits.length).hits[0];
  ok(hit.zone.key === 'body' && near(hit.dist, 6, 0.05) && near(hit.z, 60) && near(hit.need, 50.9), 'it is the iron body, 6 mm away, against Z 60');
  ok(br.res.filter((r) => r.hits.length === 0).length === 4, 'front holes and the holes on top of the upright are clear');
  const iss = C.issues(br.res);
  ok(iss.length === 3 && iss.every((i) => i.level === 'error' && /iron body/.test(i.text) && /6\.0 mm/.test(i.text)), 'one error per colliding hole, with the distance');
  const thin = setup(IP.exampleBracket(), { ironBodyD: 10 });
  ok(thin.res.every((r) => r.hits.length === 0), 'a ⌀10 body clears the upright');
  const short = setup(IP.exampleBracket(), { ironTipL: 50 });
  ok(short.res.every((r) => r.hits.length === 0), 'a longer tip lifts the body clear');
  const tall = setup(IP.exampleBracket(), { ironTipD: 13, ironNutD: 13 });
  ok(tall.res.filter((r) => r.hits.some((h) => h.zone.key === 'tip')).length === 3, 'a fat tip hits right at the surface');

  console.log('Copies and the fence');
  // two rows of brackets 1 mm apart: copy 2's front holes sit 9 mm from copy 1's upright
  const cp = setup(IP.exampleBracket(), {}, { nx: 1, ny: 2, gap: 1 });
  const cross = cp.res.filter((r) => r.hits.some((h) => h.source === 'copy'));
  ok(cross.length === 2 && cross.every((r) => r.copy === 1 && near(cp.det.holes[r.localId].y, 8)), 'front holes of copy 2 hit the upright of copy 1');
  ok(near(cross[0].hits.find((h) => h.source === 'copy').dist, 9, 0.05), 'measured 9 mm across the gap');
  const cpWide = setup(IP.exampleBracket(), {}, { nx: 1, ny: 2, gap: 3 });
  ok(!cpWide.res.some((r) => r.hits.some((h) => h.source === 'copy')), 'a 3 mm gap clears it');
  const plate = IP.cellPart([5, 20], [5, 20], [[{ T: 3, hole: { d: 4, from: 'through' } }, { T: 3 }], [{ T: 3 }, { T: 3 }]], 32);
  const fen = setup(plate, { ironTipD: 5 }, null, { x: 0, y: 0, rot: 0 });
  ok(fen.res[0].hits.some((h) => h.source === 'fence' && h.zone.key === 'tip'), 'hole 2.5 mm from the fence: the tip hits the 8 mm fence');
  const away = setup(plate, { ironTipD: 5 }, null, { x: 20, y: 20, rot: 0 });
  ok(away.res[0].hits.length === 0, 'moved off the fence: clear');

  console.log('Tray, pilot, pickups');
  const plate2 = IP.cellPart([10, 10], [10], [[{ T: 3, hole: { d: 4, from: 'through' } }, { T: 3 }]], 32);
  const p2 = IP.stl.preparePart(plate2, {});
  const ctx2 = (o) => Object.assign({ index: new C.Index(p2.positions), instances: [{ i: 0, rot: 0, tx: 30, ty: 30 }], partSize: p2.size,
    zones: C.zonesFrom(S), margin: S.ironMargin, sink: S.sink, fenceH: S.fenceH }, o);
  const h2 = [{ x: 35, y: 35, H: 3, label: '1', localId: 0, copy: 0 }];
  ok(C.check(h2, ctx2()).every((r) => !r.hits.length), 'a plate hole in the open: clear');
  const trayBox = { x0: 37, y0: 20, x1: 60, y1: 60, z: 20, source: 'tray' };
  const tr = C.check(h2, ctx2({ boxes: [trayBox] }))[0];
  ok(tr.hits.some((x) => x.source === 'tray' && x.zone.key === 'tip' && near(x.dist, 2)), 'the tray block 2 mm away hits the tip');
  ok(/hits the tray/.test(C.issues([tr])[0].text), 'reported as hitting the tray');
  const brk = (o) => setup(IP.exampleBracket(), Object.assign({ ironTipL: 50 }, o));
  ok(brk().res.every((r) => !r.hits.length), 'bracket with a 50 mm tip: clear');
  const part3 = IP.stl.preparePart(IP.exampleBracket(), {});
  const det3 = IP.holes.detect(part3.positions, {});
  const s3 = Object.assign({}, S, { ironTipL: 50 });
  const hs3 = det3.holes.map((h, i) => ({ x: h.x, y: h.y, H: h.top, label: String(i + 1), localId: i, copy: 0 }));
  const base3 = { index: new C.Index(part3.positions), instances: [{ i: 0, rot: 0, tx: 0, ty: 0 }], partSize: part3.size,
    zones: C.zonesFrom(s3), margin: s3.ironMargin, sink: s3.sink, fenceH: s3.fenceH };
  ok(C.check(hs3, Object.assign({ pilot: 20 }, base3)).filter((r) => r.hits.length).length === 3, 'a 20 mm pilot drops the iron 20 mm lower: the upright hits again');
  const pocket = [{ x: 32, y: 44, H: 10, sink: S.tripTravel, label: 'P1', pocket: 1 }];
  const pr = C.check(pocket, Object.assign({}, base3, { zones: C.zonesFrom(S) }))[0];
  ok(pr.hits.length && pr.hits[0].source === 'copy', 'a pocket 8 mm behind the 60 mm upright: the iron hits the part while picking up');
  ok(/^Pocket 1: picking up/.test(C.issues([pr])[0].text), 'reported against the pocket');
};
