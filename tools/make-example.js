// Writes the example STLs in examples/ from the built-in generators.
// Run with: node tools/make-example.js
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/stl.js');
require('../js/example.js');
const IP = globalThis.IP;
for (const ex of IP.EXAMPLES) {
  const out = path.join(__dirname, '..', 'examples', ex.file);
  fs.writeFileSync(out, Buffer.from(IP.stl.toBinarySTL(ex.make())));
  console.log('Wrote ' + out);
}
