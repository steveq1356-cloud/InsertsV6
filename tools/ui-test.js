// Browser tests with Playwright (needs PLAYWRIGHT_BROWSERS_PATH if browsers live elsewhere).
// Run with: node tools/ui-test.js
'use strict';
const open = require('./browser-check.js');
const ok = (c, m) => console.log((c ? '  pass  ' : '  FAIL  ') + m);
(async () => {
  let { browser, page, errors } = await open({});
  const out = require('os').tmpdir() + '/';
  const ev = (f, a) => page.evaluate(f, a);
  // every example loads
  for (const id of ['block', 'bracket', 'lid', 'pcb', 'tab', 'cover', 'panel']) {
    await ev(() => IP.app.ctx.goScreen('start'));
    await page.click(`[data-example="${id}"]`); await page.waitForTimeout(150);
    const r = await ev(() => ({ n: IP.app.S.holes.length, errs: IP.app.S.result ? IP.app.S.result.issues.filter((i) => i.level === 'error').length : 0 }));
    ok(r.n >= 0, `${id}: ${r.n} holes, ${r.errs} errors`);
  }
  // bracket shows collisions in red
  await ev(() => IP.app.ctx.loadExample('bracket')); await ev(() => IP.app.ctx.goStep('holes')); await page.waitForTimeout(150);
  ok(await ev(() => IP.app.S.collide.size === 3), 'bracket: 3 colliding holes');
  await page.screenshot({ path: out + 'bracket-holes.png' });
  // cover: face down by clicking the top in 2D (face tool)
  await ev(() => IP.app.ctx.loadExample('cover')); await page.waitForTimeout(100);
  ok(await ev(() => IP.app.S.holes.length === 0), 'cover starts with no usable holes');
  await page.click('#btn-face');
  const box = await page.locator('#viewport canvas').boundingBox();
  const c = await ev(() => { const S = IP.app.S; const p = IP.app.viewer.project(25, 20, 10); return p; });
  await page.mouse.click(box.x + c.x, box.y + c.y); await page.waitForTimeout(200);
  ok(await ev(() => IP.app.S.holes.length === 4 && !!IP.app.S.tilt), 'clicking the top face puts it down: 4 holes');
  // drag with snapping (move tool)
  await ev(() => { IP.app.ctx.loadExample('panel'); IP.app.S.place.x = 40; IP.app.S.place.y = 40; IP.app.ctx.refresh(); });
  await page.waitForTimeout(100);
  const a = await ev(() => IP.app.viewer.project(75, 62, 6));
  const b = await ev(() => IP.app.viewer.project(36.5, 23.5, 6));
  await page.mouse.move(box.x + a.x, box.y + a.y); await page.mouse.down();
  await page.mouse.move(box.x + (a.x + b.x) / 2, box.y + (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 4 });
  const lab = await page.textContent('#snap-label');
  await page.screenshot({ path: out + 'snap.png' });
  await page.mouse.up();
  const pl = await ev(() => IP.app.S.place);
  ok(pl.x === 0 && pl.y === 0 && /fence corner/.test(lab), `drag near the corner snaps: ${pl.x}, ${pl.y} "${lab}"`);
  // Alt drag is free
  await page.mouse.move(box.x + b.x + 10, box.y + b.y - 10); await page.keyboard.down('Alt'); await page.mouse.down();
  await page.mouse.move(box.x + b.x + 13, box.y + b.y - 13, { steps: 3 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const pf = await ev(() => IP.app.S.place);
  ok(pf.x !== 0 && pf.y !== 0, `Alt drag moves freely: ${pf.x}, ${pf.y}`);
  // rotate handle
  await page.waitForTimeout(100);
  const h = await page.locator('#rot-handle').boundingBox();
  ok(!!h, 'rotate handle shown');
  await page.mouse.move(h.x + 17, h.y + 17); await page.mouse.down();
  const ctr = await ev(() => { const b = IP.app.ctx.arrayBox(); return IP.app.viewer.project(b.x + b.w / 2, b.y + b.h / 2, 3); });
  // sweep 90° counterclockwise around the centre
  const R = Math.hypot(h.x + 17 - (box.x + ctr.x), h.y + 17 - (box.y + ctr.y)), a0 = Math.atan2(-(h.y + 17 - box.y - ctr.y), h.x + 17 - box.x - ctr.x);
  for (let k = 1; k <= 10; k++) { const an = a0 + (k / 10) * Math.PI / 2; await page.mouse.move(box.x + ctr.x + R * Math.cos(an), box.y + ctr.y - R * Math.sin(an)); }
  await page.mouse.up();
  ok(await ev(() => IP.app.S.place.rot === 90), 'rotate handle turns 90° (snapped): ' + await ev(() => IP.app.S.place.rot));
  // lock
  await page.click('#btn-lock');
  ok(await ev(() => IP.app.S.place.locked && document.getElementById('pos-x').disabled && document.getElementById('rot-handle').hidden), 'lock disables moving');
  await page.click('#btn-lock');
  // autofill around the tray
  await ev(() => { IP.app.ctx.setSetting('feed', 'tray'); IP.app.S.place.rot = 0; IP.app.S.place.x = 0; IP.app.S.place.y = 0; IP.app.ctx.refresh(); });
  await page.click('#btn-autofill'); await page.waitForTimeout(150);
  const fill = await ev(() => ({ n: IP.app.ctx.insts().length, skip: IP.app.S.copies.skip.length, onTray: IP.app.S.result.issues.some((i) => /sits on the tray/.test(i.text)) }));
  ok(fill.n >= 6 && !fill.onTray, `fill the bed: ${fill.n} copies, ${fill.skip} left off the tray, none on it`);
  await page.screenshot({ path: out + 'autofill.png' });
  // undo
  await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
  ok(await ev(() => IP.app.ctx.insts().length === 1), 'undo brings back one copy');
  // session restore
  await ev(() => IP.app.ctx.goStep('holes'));
  await page.waitForTimeout(1000);
  await page.reload(); await page.waitForTimeout(500);
  ok(await page.isVisible('#resume'), 'after reload: pick up where you left off');
  await page.screenshot({ path: out + 'start-resume.png' });
  await page.click('#btn-resume'); await page.waitForTimeout(400);
  const back = await ev(() => ({ name: IP.app.S.name, step: IP.app.S.step, feed: IP.app.S.settings.feed }));
  ok(back.name === 'example-panel' && back.step === 'holes', `restored ${back.name} on ${back.step}`);
  // v4 job file opens
  const v4 = { format: 'insertpress-job', version: 4, part: { name: 'example-block', triangles: 2184, rot: { x: 0, y: 0, z: 0 }, scale: 1 },
    place: { x: 10, y: 5, rot: 0 }, copies: { nx: 2, ny: 1, gap: 6 }, settings: { material: 'petg', tipTemp: 235 }, holes: [], order: [] };
  await ev(() => IP.app.ctx.loadExample('block'));
  await ev((t) => IP.app.ctx.openJob(t), JSON.stringify(v4)); await page.waitForTimeout(200);
  const j = await ev(() => ({ x: IP.app.S.place.x, n: IP.app.ctx.insts().length, mat: IP.app.S.settings.material, holes: IP.app.S.holes.length }));
  ok(j.x === 10 && j.n === 2 && j.mat === 'petg' && j.holes === 9, `v4 job opens: ${JSON.stringify(j)}`);
  const v6 = await ev(() => IP.app.ctx.jobObject().version);
  ok(v6 === 6, 'jobs save as version 6');
  // export is G38.2 in tray mode
  await ev(() => { IP.app.ctx.setSetting('feed', 'tray'); IP.app.S.order = IP.app.S.holes.map((h) => h.id); IP.app.ctx.refresh(); });
  const exp = await ev(() => IP.app.ctx.buildRun({ from: 0, export: true }).text);
  ok(/G38\.2 Z[\d.]+ F120 ; pick P1/.test(exp), 'exported tray G-code picks with G38.2');
  // a job waiting for its STL is not applied to a different part
  await ev((t) => IP.app.ctx.openJob(t), JSON.stringify(Object.assign({}, v4, { part: { name: 'someone-else', triangles: 12 }, place: { x: 50, y: 50, rot: 0 } })));
  const waiting = await ev(() => !!IP.app.S.pendingJob);
  await ev(() => IP.app.ctx.loadExample('lid'));
  ok(waiting && await ev(() => !IP.app.S.pendingJob && IP.app.S.place.x === 0), 'a waiting job is dropped when another part opens');
  // opening a job keeps this machine's setup and takes the job's press settings
  await ev(() => { IP.app.ctx.loadExample('block'); IP.app.ctx.setSetting('bedX', 333); });
  await ev((t) => IP.app.ctx.openJob(t), JSON.stringify(Object.assign({}, v4, { settings: { bedX: 99, material: 'abs', tipTemp: 245 } })));
  const keep = await ev(() => ({ bedX: IP.app.S.settings.bedX, mat: IP.app.S.settings.material }));
  ok(keep.bedX === 333 && keep.mat === 'abs', `opening a job keeps the machine: ${JSON.stringify(keep)}`);
  await ev(() => IP.app.ctx.setSetting('bedX', 200));
  // a size filter from another part is dropped
  await ev(() => { IP.app.S.list.tools = true; IP.app.S.list.sizes = ['9.9']; IP.app.ctx.goStep('holes'); IP.app.ctx.redraw(); });
  ok(await ev(() => IP.app.S.list.sizes.length === 0 && document.querySelectorAll('#hole-list [data-id]').length > 0), 'a stale size filter is dropped, holes still listed');
  // undoing a tray size change keeps the inventory the right size
  await ev(() => { IP.app.ctx.setSetting('feed', 'tray'); IP.app.ctx.setSetting('trayRows', IP.app.S.settings.trayRows - 1); });
  await page.click('#btn-undo');
  ok(await ev(() => IP.app.S.inv.length === IP.tray.count(IP.app.S.settings)), 'undo a tray rows change: inventory fits the tray');
  // undoing a lock gives the move tool back
  await ev(() => IP.app.ctx.goStep('part'));
  await page.click('#btn-lock'); await page.click('#btn-undo');
  ok(await ev(() => !IP.app.S.place.locked && IP.app.S.tool === 'move'), 'undo a lock: dragging works again');
  // examples keep one Recent entry each
  for (const id of ['block', 'lid', 'block', 'pcb', 'lid', 'tab', 'cover', 'panel']) await ev((i) => IP.app.ctx.loadExample(i), id);
  const rec = await ev(() => JSON.parse(localStorage.getItem('insertpress.recent.v5')).map((r) => r.example));
  ok(new Set(rec).size === rec.length && rec.length <= 6, `examples are not repeated in Recent: ${rec.join(', ')}`);
  // Clear recents with a part open: it can still be picked up after a reload
  await ev(() => IP.app.ctx.goScreen('start')); await page.click('#btn-recent-clear');
  ok(await ev(() => { const r = JSON.parse(localStorage.getItem('insertpress.recent.v5')); const s = JSON.parse(localStorage.getItem('insertpress.session.v5')); return r.length === 1 && s && s.recentId === r[0].id; }), 'clear recents keeps the open part resumable');
  // undo and redo have buttons on a phone
  await page.setViewportSize({ width: 375, height: 800 }); await ev(() => IP.app.ctx.goStep('part')); await page.waitForTimeout(100);
  ok(await page.isVisible('#btn-undo') && await page.isVisible('#btn-redo'), 'undo and redo shown at 375 px');
  await page.setViewportSize({ width: 1440, height: 900 });
  // losing the connection mid-run gives the Run button back
  await ev(() => { IP.app.ctx.loadExample('block'); IP.app.ctx.setSetting('feed', 'hand'); IP.app.ctx.goScreen('run'); });
  await page.click('#pd-sim'); await page.waitForTimeout(800);
  await page.click('#pd-run'); await page.click('#pd-go'); await page.waitForTimeout(1000);
  const midRun = await ev(() => IP.app.ui.machine.running);
  await ev(() => IP.app.ui.machine.state.port.close()); await page.waitForTimeout(200);
  ok(midRun && await ev(() => !document.getElementById('pd-setup').hidden && document.getElementById('pd-live').hidden && IP.app.ui.machine.state.run.over),
    'disconnect mid-run: back to the Run button, live panel closed');
  console.log(errors.length ? errors.join('\n') : 'no browser errors');
  await browser.close();
  // 3D path with the stub
  ({ browser, page, errors } = await open({ three: true }));
  await page.click('[data-example="bracket"]'); await page.waitForTimeout(200);
  const is3 = await page.evaluate(() => !IP.app.ctx.is2D && IP.app.viewer instanceof IP.Viewer);
  await page.evaluate(() => { IP.app.ctx.setSetting('feed', 'tray'); IP.app.ctx.goStep('review'); IP.app.ui.review.toggle(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { IP.app.viewer.setGuides([{ x1: 0, y1: 0, x2: 0, y2: 100 }]); IP.app.viewer.setTip([10, 10, 10], 'travel', { od: 5, L: 5.7, hang: 5.7 }); IP.app.ctx.goScreen('run'); });
  await page.waitForTimeout(200);
  ok(is3, 'Three.js stub: the 3D viewer is used');
  ok(await page.evaluate(() => document.getElementById('timeline').hidden), 'run screen hides the Review preview');
  await page.click('#pd-back'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('timeline').hidden), 'back on Review the preview returns');
  console.log(errors.length ? errors.join('\n') : 'no browser errors (3D)');
  await browser.close();
})();
