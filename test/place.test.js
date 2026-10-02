// Moving parts: snapping, rotate-about-centre, align, skipped copies, auto-fill, face down.
'use strict';
module.exports = function (t) {
  const { IP, ok, near } = t;
  const snap = IP.snap.snapBox;

  console.log('Snapping');
  const env = { bed: { x: 200, y: 200 }, grid: 10, gap: 6, others: [{ x0: 152, y0: 140, x1: 196, y1: 192, name: 'tray' }] };
  let r = snap({ x: 2.5, y: -1.8, w: 60, h: 45 }, env, 4);
  ok(r.x === 0 && r.y === 0 && r.label === 'Snapped to fence corner' && r.guides.length === 2, 'near the corner: fence corner, two guides');
  r = snap({ x: 1.2, y: 33.3, w: 60, h: 45 }, env, 4);
  ok(r.x === 0 && near(r.y, 33.3) && r.label === 'Snapped to left fence' && r.guides.length === 1 && r.guides[0].x1 === 0, 'against the left fence only');
  r = snap({ x: 36, y: 0.9, w: 60, h: 45 }, env, 4);
  ok(r.y === 0 && r.label === 'Snapped to front fence', 'against the front fence');
  r = snap({ x: 69, y: 78, w: 60, h: 45 }, env, 4);
  ok(r.x === 70 && r.y === 77.5 && r.label === 'Snapped to bed centre', 'bed centre');
  r = snap({ x: 138, y: 22.6, w: 60, h: 45 }, env, 4);
  ok(r.x === 140 && r.snapped.x.kind === 'bed', 'right edge to the travel limit');
  r = snap({ x: 108, y: 150, w: 40, h: 30 }, env, 4);
  ok(r.x === 106 && r.y === 150 && r.label === 'Snapped to tray and grid', 'beside the tray with the gap, grid on the other axis');
  r = snap({ x: 21.5, y: 58.8, w: 20, h: 20 }, env, 4);
  ok(r.x === 20 && r.y === 60 && r.label === 'Snapped to grid', 'grid when nothing stronger is near');
  r = snap({ x: 45.3, y: 33.3, w: 20, h: 20 }, env, 4);
  ok(near(r.x, 45.3) && near(r.y, 33.3) && r.label === '' && !r.guides.length, 'nothing near: stays put');
  const A = IP.snap.snapAngle;
  ok(A(47) === 45 && A(84) === 90 && A(-10) === 345 && A(91, true) === 91 && A(358) === 0, 'rotation snaps to 15°, 90° is sticky, Alt is free');

  console.log('Rotate, align, skip');
  const hull = [[0, 0], [60, 0], [60, 45], [0, 45]];
  const one = { nx: 1, ny: 1, gap: 0 };
  const p = IP.place.rotateKeep(hull, { x: 10, y: 10, rot: 0 }, one, 90);
  ok(near(p.x, 17.5) && near(p.y, 2.5) && p.rot === 90, 'rotating keeps the centre where it was');
  const bed = { x: 200, y: 200 };
  const al = (w) => IP.place.align(hull, { x: 33, y: 44, rot: 0 }, one, bed, w);
  ok(al('left').x === 0 && al('left').y === 44 && al('front').y === 0 && al('front').x === 33, 'against the left fence / the front fence');
  ok(al('corner').x === 0 && al('corner').y === 0 && al('center').x === 70 && al('center').y === 77.5, 'into the corner / centred');
  const sk = IP.place.instances(hull, { x: 0, y: 0, rot: 0 }, { nx: 3, ny: 2, gap: 5, skip: ['1,0'] });
  ok(sk.length === 5 && sk.map((i) => i.i).join() === '0,1,2,3,4' && !sk.some((i) => i.col === 1 && i.row === 0), 'a skipped copy is left out and the rest renumbered');

  console.log('Auto-fill');
  const tray = IP.tray.outline(IP.DEFAULT_SETTINGS);
  const avoid = [{ x0: tray.x0 - 6, y0: tray.y0 - 6, x1: tray.x1 + 6, y1: tray.y1 + 6 }];
  const f = IP.place.autoFill(hull, { x: 0, y: 0, rot: 0 }, bed, 6, avoid);
  ok(f.nx === 3 && f.ny === 4 && f.count === 10 && f.skip.sort().join() === '2,2,2,3', `60 × 45 parts, 6 mm gap: 3 × 4 grid minus the 2 on the tray = ${f.count}`);
  ok(IP.place.autoFill(hull, { x: 0, y: 0, rot: 0 }, bed, 6, []).count === 12, 'without the tray: 12');
  const fi = IP.place.instances(hull, { x: 0, y: 0, rot: 0 }, f);
  ok(fi.every((i) => !IP.tray.polyRect(IP.place.worldHull(hull, i), tray)), 'no copy overlaps the tray');
  ok(fi.every((i) => { const b = IP.place.worldHull(hull, i); return b.every(([x, y]) => x <= 200 && y <= 200); }), 'every copy is inside the travel');
  const onTray = { x: 140, y: 150, rot: 0 };
  const f0 = IP.place.autoFill(hull, onTray, bed, 6, avoid);
  const i0 = IP.place.instances(hull, onTray, f0);
  ok(f0.count === 1 && f0.blocked && i0.length === f0.count, 'every copy would be on the tray: one part stays where it is, and the count says 1');
  ok(IP.tray.issues(Object.assign({}, IP.DEFAULT_SETTINGS, { feed: 'tray' }), { hulls: i0.map((i) => IP.place.worldHull(hull, i)) })
    .some((x) => x.level === 'error' && /sits on the tray/.test(x.text)), 'and the tray check still flags it');

  console.log('Face down');
  const cover = IP.exampleCover();
  ok(IP.holes.detect(IP.stl.preparePart(cover, {}).positions, {}).holes.length === 0, 'cover as drawn: holes face down');
  const M = IP.stl.faceDownMatrix(0, 0, 1);
  const flipped = IP.stl.preparePart(cover, { matrix: M });
  const fh = IP.holes.detect(flipped.positions, {}).holes;
  ok(fh.length === 4 && fh.every((h) => near(h.depth, 7) && h.blind), 'click the top face to put it down: 4 holes face up');
  const side = IP.stl.preparePart(IP.exampleBlock(), { matrix: IP.stl.faceDownMatrix(1, 0, 0) });
  ok(near(side.size.z, 60) && near(side.size.x, 12) && near(side.size.y, 45), 'a side face down: the block stands on its end');
  const q = IP.stl.preparePart(IP.exampleBlock(), { rot: { x: 1, y: 0, z: 1 } });
  const qm = IP.stl.preparePart(IP.exampleBlock(), { matrix: IP.stl.quarterMatrix({ x: 1, y: 0, z: 1 }) });
  ok(q.positions.every((v, i) => Math.abs(v - qm.positions[i]) < 1e-4), 'quarter turns as a matrix match the quarter turns');
  const tilt = IP.stl.faceDownMatrix(0.6, 0, 0.8);
  const n = IP.stl.applyMatrix(tilt, 0.6, 0, 0.8);
  ok(near(n[2], -1, 1e-9) && near(Math.hypot(...n), 1, 1e-9), 'any face normal is turned straight down');
};
