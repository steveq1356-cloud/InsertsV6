// Browser check with Playwright: node tools/browser-check.js [--3d] [outdir]
// Loads index.html from file://, drives every screen, saves screenshots.
// --3d serves a small stub of the Three.js r128 API so viewer.js runs.
'use strict';
const path = require('path');
const fs = require('fs');
// Playwright from $PW, a local install, or the global npm root (npm i -g playwright).
function findPlaywright() {
  const tries = [process.env.PW, 'playwright'];
  try { tries.push(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (e) { /* no npm */ }
  for (const t of tries.filter(Boolean)) { try { return require(t); } catch (e) { /* next */ } }
  throw new Error('Playwright not found: npm i -g playwright && npx playwright install chromium (or set PW)');
}
const { chromium } = findPlaywright();
const want3d = process.argv.includes('--3d');
const out = process.argv.filter((a) => !a.startsWith('--'))[2] || path.join(require('os').tmpdir(), 'shots');
fs.mkdirSync(out, { recursive: true });
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

module.exports = async function open(opts) {
  opts = opts || {};
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (opts.three) {
    const stub = fs.readFileSync(path.join(__dirname, 'three-stub.js'), 'utf8');
    await page.route(/three\.min\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
    await page.route(/OrbitControls\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'THREE.OrbitControls = THREE.__Orbit;' }));
  }
  await page.goto(url);
  await page.waitForTimeout(400);
  return { browser, page, errors, out };
};
if (require.main === module) {
  (async () => {
    const { browser, page, errors } = await module.exports({ three: want3d });
    await page.screenshot({ path: path.join(out, 'start.png') });
    console.log(errors.length ? errors.join('\n') : 'no errors');
    await browser.close();
  })();
}
