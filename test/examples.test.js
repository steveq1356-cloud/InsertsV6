// Example gallery: every part is watertight, finds the holes it is meant to show,
// and matches the STL written to examples/.
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = function (t) {
  const { IP, ok, near } = t;
  const edgesOk = (P) => {
    const m = new Map();
    const k = (i) => [P[i], P[i + 1], P[i + 2]].map((v) => Math.round(v * 1e4)).join(',');
    for (let i = 0; i < P.length; i += 9) {
      const v = [k(i), k(i + 3), k(i + 6)];
      for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; const key = a < b ? a + '|' + b : b + '|' + a; m.set(key, (m.get(key) || 0) + 1); }
    }
    return [...m.values()].every((n) => n === 2);
  };
  const load = (id, opts) => {
    const ex = IP.EXAMPLES.find((e) => e.id === id);
    const part = IP.stl.preparePart(ex.make(), opts || {});
    return { ex, part, det: IP.holes.detect(part.positions, {}) };
  };
  ok(IP.EXAMPLES.length === 7 && new Set(IP.EXAMPLES.map((e) => e.id)).size === 7, 'seven examples in the gallery');
  for (const ex of IP.EXAMPLES) {
    const file = path.join(__dirname, '..', 'examples', ex.file);
    const raw = ex.make();
    const buf = fs.readFileSync(file);
    const back = IP.stl.parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    ok(back.length === raw.length, `${ex.file} matches the generator (${raw.length / 9} triangles)`);
  }
  for (const id of ['lid', 'pcb', 'tab', 'cover', 'panel']) ok(edgesOk(load(id).part.positions), `${id} is watertight`);

  console.log('Enclosure lid');
  const lid = load('lid');
  ok(near(lid.part.size.x, 80) && near(lid.part.size.y, 60) && near(lid.part.size.z, 9), '80 × 60 plate, bosses to Z 9');
  ok(lid.det.holes.length === 4 && lid.det.ignored.length === 0, '4 holes; the round bosses themselves are not holes');
  ok(lid.det.holes.every((h) => near(h.top, 9) && near(h.depth, 7) && h.blind && near(h.dia, 4, 0.02) && h.wall > 1.8 && h.wall < 2.05), 'each on a boss top: ⌀4, 7 deep, about 2 mm of boss wall');
  ok(lid.det.holes.every((h) => IP.gcode.guessInsert(h.dia, 'm3') === 'm3'), 'all M3');

  console.log('PCB plate');
  const pcb = load('pcb');
  const ins = pcb.det.holes.map((h) => IP.gcode.guessInsert(h.dia, 'm3'));
  ok(pcb.det.holes.length === 6 && ins.filter((k) => k === 'm25').length === 4 && ins.filter((k) => k === 'm3').length === 2, '4 M2.5 and 2 M3 standoffs');
  const pi = pcb.det.holes.filter((h) => near(h.dia, 3.6, 0.02));
  const xs = [...new Set(pi.map((h) => Math.round(h.x)))].sort((a, b) => a - b), ys = [...new Set(pi.map((h) => Math.round(h.y)))].sort((a, b) => a - b);
  ok(xs[1] - xs[0] === 58 && ys[1] - ys[0] === 49, 'Raspberry Pi pattern, 58 × 49 mm');
  const pcbIssues = IP.gcode.check(pcb.det.holes.map((h, i) => ({ x: h.x, y: h.y, H: h.top, dia: h.dia, depth: h.depth, blind: h.blind, wall: h.wall, insert: ins[i], localId: i })), IP.DEFAULT_SETTINGS);
  ok(pcbIssues.length === 0, 'no warnings: deep and thick enough');

  console.log('Edge tab');
  const tab = load('tab');
  const tabIss = IP.gcode.check(tab.det.holes.map((h, i) => ({ x: h.x, y: h.y, H: h.top, dia: h.dia, depth: h.depth, blind: h.blind, wall: h.wall, insert: 'm3', localId: i })), IP.DEFAULT_SETTINGS);
  const thin = tabIss.filter((i) => /wall/.test(i.text));
  ok(tab.det.holes.length === 3 && thin.length === 1 && near(tab.det.holes[thin[0].localId].x, 3), 'the hole 1 mm from the end gets the thin-wall warning, the other two do not');

  console.log('Cover, holes underneath');
  const cov = load('cover');
  ok(cov.det.holes.length === 0 && cov.det.ignored.filter((i) => i.reason === 'blocked').length === 4, 'as drawn: 4 holes, all opening downward');
  const cf = load('cover', { rot: { x: 2, y: 0, z: 0 } });
  ok(cf.det.holes.length === 4 && cf.det.holes.every((h) => near(h.top, 10) && near(h.depth, 7)), 'flipped: all 4 face up');

  console.log('Mounting panel');
  const pan = load('panel');
  ok(pan.det.holes.length === 4 && pan.det.holes.every((h) => !h.blind && near(h.depth, 6)), '4 through holes, 6 mm plate');
  const f = IP.place.autoFill(IP.place.footprintHull(pan.part.positions), { x: 0, y: 0, rot: 0 }, { x: 200, y: 200 }, 6, []);
  ok(f.nx === 2 && f.ny === 4 && f.count === 8, `auto-fill puts ${f.count} on a 200 × 200 bed`);
};
