// Screenshots of every screen for design review, with real Three.js (needs the network).
// Run with: node tools/shots.js [outdir] [--phone]
'use strict';
const path = require('path');
const open = require('./browser-check.js');
const phone = process.argv.includes('--phone');
const out = process.argv.filter((a) => !a.startsWith('--'))[2] || path.join(require('os').tmpdir(), 'ip-shots');
(async () => {
  const { browser, page, errors } = await open({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(out, (phone ? 'p-' : '') + name + '.png') }); };
  await page.waitForTimeout(1200);
  await shot('01-start');
  await ev(() => IP.app.ui.setup.open('iron')); await shot('02-setup-iron');
  await ev(() => IP.app.ui.setup.open('tray')); await ev(() => IP.app.ctx.setSetting('feed', 'tray')); await ev(() => IP.app.ui.setup.render()); await shot('03-setup-tray');
  await ev(() => { IP.app.ui.setup.close(); IP.app.ctx.setSetting('feed', 'hand'); });
  await ev(() => IP.app.ctx.loadExample('pcb')); await shot('04-part');
  await ev(() => IP.app.ctx.goStep('holes')); await shot('05-holes');
  await ev(() => { IP.app.S.list.tools = true; IP.app.ctx.redraw(); }); await shot('06-holes-tools');
  await ev(() => { IP.app.ctx.loadExample('bracket'); IP.app.ctx.goStep('holes'); }); await shot('07-holes-bad');
  await ev(() => { IP.app.ctx.loadExample('lid'); IP.app.ctx.setSetting('feed', 'tray'); IP.app.ctx.goStep('review'); IP.app.ui.review.toggle(); });
  await page.waitForTimeout(2500); await ev(() => IP.app.ui.review.toggle()); await shot('08-review');
  await ev(() => IP.app.ctx.goScreen('run')); await shot('09-run-idle');
  await page.click('#pd-sim'); await page.waitForTimeout(1200); await shot('10-run-connected');
  await page.click('#pd-run'); await page.waitForTimeout(300); await shot('11-run-checklist');
  await page.click('#pd-go'); await page.waitForTimeout(2500); await shot('12-run-live');
  console.log(errors.length ? errors.join('\n') : 'no browser errors');
  await browser.close();
})();
