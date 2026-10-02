// Hole list filtering, sorting, selection; measuring; air pass; the bracket example.
'use strict';
module.exports = function (t) {
  const { IP, ok, near } = t;
  const L = IP.holeList;

  console.log('Hole list');
  const holes = [
    { id: 1, x: 30, y: 5, dia: 4, depth: 7, blind: true, wall: 3, insert: 'm3', source: 'auto' },
    { id: 2, x: 10, y: 15, dia: 6.4, depth: 11, blind: true, wall: 1, insert: 'm5', source: 'auto' },
    { id: 3, x: 20, y: 25, dia: 4, depth: 12, blind: false, wall: 5, insert: 'm3', source: 'auto' },
    { id: 4, x: 5, y: 5, dia: null, depth: null, blind: false, wall: null, insert: 'm3', source: 'manual' },
  ];
  const order = [3, 1];
  const issues = new Map([[2, [{ text: 'thin' }]]]);
  const v = L.view(holes, order, {}, { issues });
  ok(v.rows.map((r) => r.id).join() === '3,1,2,4', 'press order first, then the rest');
  ok(v.counts.pressing === 2 && v.counts.skipped === 2 && v.counts.issues === 1, 'counts');
  ok(v.sizes.map((s) => s.key).join() === '4.0,6.4,hand' && v.sizes[0].inN === 2, 'size groups, hand-placed last');
  ok(L.view(holes, order, { filter: 'skipped' }).rows.map((r) => r.id).join() === '2,4', 'filter: not pressed');
  ok(L.view(holes, order, { filter: 'issues' }, { issues }).rows.map((r) => r.id).join() === '2', 'filter: has issues');
  ok(L.view(holes, order, { sizes: ['4.0'] }).rows.map((r) => r.id).join() === '3,1', 'filter: by size');
  ok(L.view(holes, order, { sort: 'x' }).rows.map((r) => r.id).join() === '4,2,3,1', 'sort by X');
  ok(L.view(holes, order, { sort: 'x', dir: -1 }).rows.map((r) => r.id).join() === '1,3,2,4', 'sort by X, descending');
  ok(L.view(holes, order, { sort: 'wall' }).rows.map((r) => r.id).join() === '2,1,3,4', 'sort by wall, unknown last');
  ok(L.view(holes, order, { sort: 'depth' }).rows.map((r) => r.id).join() === '1,2,3,4', 'sort by depth, through holes last');
  const rows = L.view(holes, order, { sort: 'x' }).rows;
  ok(L.range(rows, 2, 1).join() === '2,3,1', 'shift-select range follows the shown order');
  ok(L.orderBy(holes, [3, 1, 2], 'y', 1).join() === '1,2,3', 'press order re-sorted by Y');
  ok(L.orderBy(holes, [3, 1], 'order', 1).join() === '3,1', 'press-order sort keeps the order');

  console.log('Measure');
  const m = IP.measure.between({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 });
  ok(near(m.d, 13) && near(m.dxy, 5) && near(m.dz, 12), '3-4-12 gives 13 mm, 5 mm in plan');
  ok(IP.measure.label(m) === '13.00 mm' && /ΔZ 12\.00/.test(IP.measure.detail(m)), 'labels');
  ok(!/ΔZ/.test(IP.measure.detail(IP.measure.between({ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }))), 'flat measure hides ΔZ');
  const snap = IP.measure.nearest([{ sx: 10, sy: 10, id: 'a' }, { sx: 30, sy: 10, id: 'b' }], 27, 12, 8);
  ok(snap && snap.id === 'b' && IP.measure.nearest([{ sx: 0, sy: 0 }], 50, 50, 8) === null, 'snaps within reach only');

  console.log('Air pass');
  const hs = [{ x: 10, y: 10, H: 12, insert: 'm3', label: '1' }, { x: 30, y: 10, H: 12, insert: 'm3', label: '2' }];
  const real = IP.gcode.generate({ name: 'a', partTop: 12, holes: hs, settings: {} });
  const air = IP.gcode.generate({ name: 'a', partTop: 12, holes: hs, settings: {}, air: 20 });
  ok(/AIR PASS/.test(air.text) && /air pass, no insert/.test(air.text), 'air pass is labelled in the file and the pauses');
  ok(air.text.includes('G38.3 Z31.9 F60') && real.text.includes('G38.3 Z11.9 F60'), 'presses run 20 mm higher');
  ok(near(air.clearZ, real.clearZ + 20), 'travel height 20 mm higher');
  ok(Math.min(...air.moves.map((x) => x.to[2])) >= 31.9 - 1e-9, 'nothing in the air pass goes below Z 31.9');
  ok(air.text.trim().split('\n').every((l) => l.length <= 72), 'air pass lines fit GRBL');

  console.log('Through-hole insert length');
  const th = IP.gcode.check([{ x: 5, y: 5, H: 4, dia: 4, depth: 4, blind: false, insert: 'm3', localId: 1 }], IP.DEFAULT_SETTINGS);
  ok(th.some((i) => /reach the bed/.test(i.text)), 'insert longer than a through hole is flagged');

  console.log('Bracket example');
  const part = IP.stl.preparePart(IP.exampleBracket(), {});
  ok(near(part.size.x, 64) && near(part.size.y, 36) && near(part.size.z, 60), 'bracket is 64 x 36 x 60');
  const det = IP.holes.detect(part.positions, {});
  ok(det.holes.length === 7 && det.ignored.length === 0, '7 holes found');
  ok(det.holes.filter((h) => near(h.top, 60) && h.blind && near(h.depth, 4)).length === 2, 'two M2 holes on top of the upright');
  const vol = IP.place.meshStats(part.positions).volume;
  ok(near(vol, 64 * 28 * 6 + 64 * 8 * 60 - Math.PI * (4 * 4 * 6 + 1.8 * 1.8 * 6 + 2 * 1.6 * 1.6 * 4), 10), 'watertight: volume matches the solid (within the polygon facets)');
};
