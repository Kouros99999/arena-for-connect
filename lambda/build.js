// Copies the shared engine next to the Lambda code so `sam build` packages one folder.
// Run before `sam build` or the tests: node lambda/build.js
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'prototype', 'arena-engine.js');
const dst = path.join(__dirname, 'src', 'arena-engine.js');
fs.copyFileSync(src, dst);
console.log('copied', path.relative(process.cwd(), src), '->', path.relative(process.cwd(), dst));
