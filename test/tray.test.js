// Insert tray: pockets, Z geometry, inventory, pocket assignment, tray G-code,
// time estimate, checks, path, and live pickups against the virtual GRBL.
'use strict';
const rig = require('./rig.js');
module.exports = async function (t) {
  const { IP, ok, near } = t;
  const T = IP.tray, G = IP.grbl;
  const S = Object.assign({}, IP.DEFAULT_SETTINGS, { feed: 'tray' });

  console.log('Pockets and Z geometry');
  const pk = T.pockets(S);
  ok(pk.length === 30 && pk[0].n === 1 && near(pk[0].x, 158) && near(pk[0].y, 146), '30 pockets, pocket 1 front-left at X158 Y146');
  ok(near(pk[6].x, 166) && near(pk[6].y, 154) && pk[6].row === 1 && pk[6].col === 1, 'columns along +X, rows along +Y, 8 mm pitch');
  ok(pk.filter((p) => p.size === 'm3').length === 20 && pk[20].size === 'm25' && pk[29].size === 'm5', 'one size per row');
  const ol = T.outline(S);
  ok(near(ol.x0, 152) && near(ol.y1, 192) && near(ol.z, 12 + 9.5 - 2), 'block outline, height includes M5 inserts standing 7.5 mm proud');
  const g = T.geometry(S, 'm3');
  ok(near(g.seat, 15.7) && near(g.trip, 15.2) && near(g.limit, 14.7) && near(g.approach, 16.7) && near(g.hang, 5.7),
    'M3: seat 15.7, float trips at 15.2, gives up at 14.7, hangs 5.7 below the tip');
  const gp = T.geometry(Object.assign({}, S, { pilotLen: 2 }), 'm3');
  ok(near(gp.seat, 13.7) && near(gp.hang, 3.7), 'a 2 mm tip pilot lowers the seat and shortens the overhang');
  const g2 = T.geometry(S, 'm2');
  ok(g.fits && near(g.maxDepth, 6.2) && !g2.fits && near(g2.maxDepth, 1.5),
    'empty pocket limits: the tip enters an M3 pocket (floor), lands on the tray top beside an M2');

  console.log('Inventory and pocket assignment');
  const hs = [
    { x: 20, y: 20, H: 6, insert: 'm3', label: '1' }, { x: 40, y: 20, H: 6, insert: 'm3', label: '2' },
    { x: 60, y: 20, H: 6, insert: 'm5', label: '3' }, { x: 80, y: 20, H: 6, insert: 'm3', label: '4' },
  ];
  const full = T.blank(S); full[0] = 0; full[2] = 0;
  const A = T.assign(hs, S, full);
  ok(A.picks.map((p) => p.n).join() === '2,4,26,5', 'first full pocket of each size, skipping empty ones');
  ok(A.after[1] === 0 && A.after[3] === 0 && A.after[25] === 0 && full[1] === 1, 'assignment works on a copy of the inventory');
  const c = T.counts(S, full);
  ok(c.m3.full === 18 && c.m3.total === 20 && c.m5.full === 5, 'counts per size');
  ok(T.fit([1, 0], S).length === 30 && T.fit(full, S)[0] === 0, 'an inventory for a different tray size starts full');
  const S2 = Object.assign({}, S, { trayRows: 1, trayCols: 2, trayRowSizes: ['m3'] });
  const A2 = T.assign([hs[0], hs[1], hs[3]], S2, null);
  ok(A2.refill.has(2) && A2.short.m3 === 1 && A2.picks[2].n === 1, 'tray runs out: refill pause before the third hole, then pocket 1 again');
  const A3 = T.assign([hs[2]], S2, null);
  ok(A3.missing.join() === 'm5' && A3.picks[0] === null, 'no M5 row: that size is missing');
  ok(T.jobIssues(A3)[0].level === 'error' && T.jobIssues(A2)[0].level === 'warn' && /refill/.test(T.jobIssues(A2)[0].text), 'missing size is an error, a short tray a warning');

  console.log('Tray G-code');
  const job = IP.gcode.generate({ name: 't', partTop: 6, holes: hs, settings: S, tray: { full } });
  const txt = job.text, lines = txt.trim().split('\n');
  ok(lines.every((l) => l.length <= 72), 'every line under 72 characters');
  ok(/^G38\.3 Z14\.7 F120 ; pick P2 m3$/m.test(txt), 'pick at pocket 2: G38.3 down to the limit');
  ok(job.picks.map((p) => p.n).join() === '2,4,26,5', 'pockets recorded in press order');
  ok(near(job.clearZ, 12 + 7.5 + 9.5 + 5), 'travel height: M5 hanging clears M5 standing in the tray (12 + 7.5 + 9.5 + 5)');
  ok(txt.includes('G0 Z12.7') && /^G38\.3 Z5\.9 F60 ; press/m.test(txt), 'approach with the insert hanging (6 + 5.7 + 1), press to 5.9');
  const iPick = lines.findIndex((l) => /pick P2/.test(l)), iGo = lines.findIndex((l) => l === 'G0 X20 Y20');
  ok(iPick > 0 && iGo > iPick && lines[iPick - 2] === 'G0 X166 Y146 ; to P2 m3', 'travel to pocket 2, pick, then travel to the hole');
  ok(!/place M3 insert/.test(txt) && /metal or high-temp/.test(txt), 'no hand-load pauses; the file warns the tip is hot during pickup');
  const exp = IP.gcode.generate({ name: 't', partTop: 6, holes: hs, settings: S, tray: { full }, pickProbe: 'G38.2' });
  ok(/^G38\.2 Z14\.7 F120 ; pick P2/m.test(exp.text) && /^G38\.3 Z5\.9/m.test(exp.text), 'export picks with G38.2 (an empty pocket halts) and still presses with G38.3');
  const airp = IP.gcode.generate({ name: 't', partTop: 6, holes: hs, settings: S, tray: { full }, air: 20 });
  ok(!/pick P/.test(airp.text) && /^G1 Z35\.2 F120 ; dip P2$/m.test(airp.text), 'air pass dips into the pockets without probing');
  const prog = G.prepare(txt);
  ok(prog.filter((e) => e.pick).map((e) => e.pick.n).join() === '2,4,26,5' && prog.find((e) => e.pick).pick.size === 'm3', 'program entries know their pocket and size');
  const short = IP.gcode.generate({ name: 't', partTop: 6, holes: [hs[0], hs[1], hs[3]], settings: S2 });
  ok(/Refill the M3 pockets/.test(short.text) && short.stats.refills === 1, 'a short tray adds a refill pause');
  const hand = IP.gcode.generate({ name: 't', partTop: 6, holes: hs, settings: Object.assign({}, S, { feed: 'hand' }) });
  ok(!/pick/.test(hand.text) && /place M3 insert/.test(hand.text), 'load by hand still works');

  console.log('Time estimate');
  const one = IP.gcode.generate({ name: 't', partTop: 6, holes: [hs[0]], settings: S });
  const cz = one.clearZ, s = S;
  const expect = (Math.hypot(158, 146) + Math.hypot(158 - 20, 146 - 20)) / s.rapidXY * 60
    + (cz - 16.7) / s.rapidZ * 60 + 1.5 / s.pickupFeed * 60 + (17.7 - 15.2) / s.retractFeed * 60 + (cz - 17.7) / s.rapidZ * 60;
  ok(near(one.stats.time.tray, expect, 0.01), `tray trip for one hole: ${one.stats.time.tray.toFixed(2)} s (by hand ${expect.toFixed(2)} s)`);
  ok(job.moves.filter((m) => m.kind === 'pick').length === 4 && job.moves.some((m) => m.kind === 'travel' && m.carry), 'timeline has the pickups and knows when an insert is carried');
  ok(near(job.moves[job.moves.length - 1].t1, job.seconds, 1e-6) && job.moves.every((m, i) => !i || near(m.t0, job.moves[i - 1].t1, 1e-6)), 'timeline is contiguous and ends at the job time');
  const sum = Object.values(job.stats.time).reduce((a, b) => a + b, 0);
  ok(near(sum, job.seconds, 1e-6) && job.stats.time.load < hand.stats.time.load, 'breakdown adds up; no per-insert loading time');

  console.log('Tray checks');
  const iss = (o, ctx) => T.issues(Object.assign({}, S, o), ctx || {});
  ok(iss({}).length === 0, 'default tray is fine');
  ok(iss({}, { hulls: [[[150, 150], [170, 150], [170, 170], [150, 170]]] }).some((i) => i.level === 'error' && /sits on the tray/.test(i.text)), 'a part on the tray is an error');
  ok(iss({}, { hulls: [[[0, 0], [60, 0], [60, 45], [0, 45]]] }).length === 0, 'a part in the fence corner is clear of it');
  ok(iss({ trayX: 175 }).some((i) => /outside/.test(i.text)), 'pockets past the travel are an error');
  ok(iss({ pickupDepth: 0.5 }).some((i) => /too shallow/.test(i.text)), 'pickup depth under the float travel is an error');
  ok(iss({ pickupDepth: 5 }).some((i) => /too deep/.test(i.text) && /M2\.5/.test(i.text) && /floor/.test(i.text)), 'too deep for M2.5: tip would hit an empty pocket floor');
  ok(iss({ trayRowSizes: ['m2'], pickupDepth: 1.4 }).some((i) => /tray top/.test(i.text)), 'too deep for M2: tip lands on the tray top');
  ok(iss({ trayRowSizes: ['m2'], pocketDepth: 3.5 }).some((i) => /can't reach/.test(i.text)), 'insert below the tray top and a wide tip: unreachable');
  ok(iss({ trayPitch: 5.5 }).some((i) => i.level === 'warn' && /apart/.test(i.text)), 'tight pitch is a warning');
  ok(iss({ mode: 'manual' }).some((i) => /X and Y/.test(i.text)), 'Z-only machine cannot use the tray');
  ok(iss({}, { sizes: ['m4'] }).some((i) => /M4/.test(i.text)), 'a job size with no row is an error');

  console.log('Path with tray round trips');
  const pts = [[30, 170, 'm5'], [10, 10, 'm3'], [120, 60, 'm3'], [80, 150, 'm25'], [60, 100, 'm3'], [140, 20, 'm5'], [20, 120, 'm3'], [100, 100, 'm25']]
    .map(([x, y, insert], i) => ({ id: i, x, y, insert }));
  const best = T.optimize(pts, S, null, [0, 0]);
  const nn = IP.gcode.optimizeOrder(pts, 0, 0);
  ok(best.length === pts.length && new Set(best.map((p) => p.id)).size === pts.length, 'every hole once');
  ok(T.cost(best, S, null, [0, 0]) <= T.cost(nn, S, null, [0, 0]) + 1e-6 && T.cost(best, S, null, [0, 0]) <= T.cost(pts, S, null, [0, 0]) + 1e-6,
    `tray-aware order is no longer than nearest-neighbour (${Math.round(T.cost(best, S, null, [0, 0]))} vs ${Math.round(T.cost(nn, S, null, [0, 0]))} mm)`);

  console.log('Simulator: full pockets trip, empty ones do not');
  const real = T.blank(S); real[1] = 0;
  const bed = (x, y, z) => z <= -S.tripTravel;
  const probe = (x, y, z) => bed(x, y, z) || T.simProbe(S, real, x, y, z);
  const r0 = rig(IP, { probe });
  const prb = [];
  r0.link.on('line', (l, m) => { if (m.type === 'probe') prb.push(m); });
  const done = [];
  for (const p of [pk[0], pk[1]]) {
    for (const cmd of [`G0 Z30`, `G0 X${p.x} Y${p.y}`, `G0 Z${g.approach}`, `G38.3 Z${g.limit} F120`, 'G0 Z30']) r0.link.command(cmd).then((x) => done.push(x));
  }
  await r0.run(() => done.length === 10, 60);
  ok(prb.length === 2 && prb[0].ok && near(prb[0].pos[2], g.trip, 0.02), `full pocket 1 trips at Z ${prb[0] && prb[0].pos[2].toFixed(2)} (expected ${g.trip})`);
  ok(prb[1] && !prb[1].ok && near(prb[1].pos[2], g.limit, 0.02), 'empty pocket 2 reaches the pickup depth without a trip');

  console.log('Live run: skip empty pockets');
  const inv = T.blank(S);                // what the app believes
  const shelf = T.blank(S); shelf[0] = 0; shelf[1] = 0; // what is really in the tray
  const probe2 = (x, y, z) => bed(x, y, z) || T.simProbe(S, shelf, x, y, z);
  const live = IP.gcode.generate({ name: 't', partTop: 6, holes: hs, settings: S, tray: { full: inv } });
  const r1 = rig(IP, { probe: probe2 });
  const missLog = [];
  const onMiss = (e, retry) => {
    inv[e.pick.n - 1] = 0;
    const p = T.nextFull(S, inv, e.pick.size, e.pick.n);
    missLog.push(e.pick.n);
    return p ? { entries: G.splice(T.retryText(S, p, live.clearZ), e.hole) } : { text: 'Out of inserts' };
  };
  r1.link.on('picked', (r) => { inv[r.entry.pick.n - 1] = 0; shelf[r.entry.pick.n - 1] = 0; });
  const remap = (tp) => {
    if (inv[tp.n - 1]) return null;
    return T.nextFull(S, inv, tp.size, 0);
  };
  r1.link.stream(G.prepare(live.text), { onMiss, remap }, 0);
  await r1.run(() => r1.link.streamer.state === 'done', 1500, r1.autoStart);
  const st = r1.link.streamer;
  const visited = r1.sent().map((l) => { const m = /^G0X([\d.]+)Y([\d.]+)$/.exec(l); return m ? T.pocketAt(S, +m[1], +m[2]) : null; }).filter(Boolean).map((p) => p.n);
  ok(st.state === 'done' && st.misses.length === 2 && st.picks.length === 4, `finished: 2 empty pockets skipped, 4 inserts picked (${st.state})`);
  ok(visited.join() === '1,2,3,4,26,5', `pockets visited in order: ${visited.join(', ')} (planned 1, 2, 26, 3)`);
  ok(missLog.join() === '1,2' && st.trips.length === 0, 'misses reported for pockets 1 and 2; pickups are not float-trip faults');
  ok([0, 1, 2, 3, 4, 25].every((i) => inv[i] === 0) && inv[5] === 1, 'inventory marks the empty and the used pockets');
  ok(r1.sim.overflow === 0 && r1.sim.maxRx <= 128, `buffer never overflowed (peak ${r1.sim.maxRx})`);
  ok(r1.sent().filter((l) => /^G38\.3Z5\.9F60/.test(l)).length === 4, 'all four presses ran');

  console.log('Live run: out of inserts, refill, carry on');
  const S3 = Object.assign({}, S, { trayRows: 1, trayCols: 2, trayRowSizes: ['m3'], trayX: 150, trayY: 150 });
  const inv3 = [1, 1], shelf3 = [0, 0];
  const job3 = IP.gcode.generate({ name: 't', partTop: 6, holes: [hs[0]], settings: S3, tray: { full: inv3 } });
  const r3 = rig(IP, { probe: (x, y, z) => bed(x, y, z) || T.simProbe(S3, shelf3, x, y, z) });
  let held = null;
  const onMiss3 = (e, retry) => {
    if (retry) { for (const p of T.pockets(S3)) inv3[p.i] = 1; }
    else inv3[e.pick.n - 1] = 0;
    const p = T.nextFull(S3, inv3, e.pick.size, retry ? 0 : e.pick.n);
    return p ? { entries: G.splice(T.retryText(S3, p, job3.clearZ), e.hole) } : { text: 'Out of M3 inserts. Refill, then Continue.' };
  };
  r3.link.on('state', (x) => { if (x.state === 'pick') held = x; });
  r3.link.stream(G.prepare(job3.text), { onMiss: onMiss3 }, 0);
  await r3.run(() => ['pick', 'done'].includes(r3.link.streamer.state), 600, r3.autoStart);
  ok(r3.link.streamer.state === 'pick' && held && /Refill/.test(held.text), 'both pockets empty: holds and asks for a refill');
  ok(!r3.sent().some((l) => /^G38\.3Z5\.9/.test(l)), 'nothing was pressed with an empty tip');
  shelf3[0] = 1; shelf3[1] = 1;
  r3.link.streamer.resume();
  await r3.run(() => r3.link.streamer.state === 'done', 600, r3.autoStart);
  ok(r3.link.streamer.state === 'done' && r3.link.streamer.picks.length === 1 && r3.sent().filter((l) => /^G38\.3Z5\.9/.test(l)).length === 1, 'after the refill it picks and presses');

  console.log('Pause after this hole');
  const r4 = rig(IP, { probe: bed });
  const handJob = IP.gcode.generate({ name: 't', partTop: 6, holes: hs, settings: Object.assign({}, S, { feed: 'hand', loadMode: 'start' }) });
  r4.link.stream(G.prepare(handJob.text), {}, 0);
  await r4.run(() => r4.link.streamer.current() && r4.link.streamer.current().hole === '1', 120, r4.autoStart);
  r4.link.streamer.pauseAfterHole();
  await r4.run(() => r4.link.streamer.state !== 'running', 300, r4.autoStart);
  ok(r4.link.streamer.state === 'between' && r4.sent().filter((l) => /^G38\.3/.test(l)).length === 1, 'holds between holes after hole 1');
  r4.link.streamer.resume();
  await r4.run(() => r4.link.streamer.state === 'done', 900, r4.autoStart);
  ok(r4.link.streamer.state === 'done' && r4.sent().filter((l) => /^G38\.3/.test(l)).length === 4, 'continue finishes the job');
};
