// Run with: node test/run-tests.js           (all files)
//           node test/run-tests.js grbl      (only files whose name contains "grbl")
'use strict';
const fs = require('fs');
const path = require('path');
for (const f of ['stl', 'holes', 'tray', 'gcode', 'example', 'placement', 'snap', 'collision', 'holelist', 'measure', 'grbl', 'grbl-sim']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
const IP = globalThis.IP;

let fails = 0, passes = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  pass  ' : '  FAIL  ') + msg);
  if (cond) passes++; else fails++;
};
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const only = process.argv[2];
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && (!only || f.includes(only))).sort((a, b) =>
  (a === 'core.test.js' ? -1 : b === 'core.test.js' ? 1 : a.localeCompare(b)));

(async () => {
  for (const f of files) {
    console.log(`\n== ${f}`);
    try { await require(path.join(__dirname, f))({ IP, ok, near }); }
    catch (e) { fails++; console.log('  FAIL  threw: ' + (e && e.stack || e)); }
  }
  console.log(fails ? `\n${fails} failed, ${passes} passed` : `\nAll ${passes} tests passed`);
  process.exit(fails ? 1 : 0);
})();
