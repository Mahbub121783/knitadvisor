// The knitting lessons must pass their own gate before they can reach the database.
const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('assert');
const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'import-knitting-lessons.js')], { encoding: 'utf8' });
assert(/gate passed/.test(out), out);
assert(/dry run/.test(out), 'the test must never write');
console.log('Knitting lessons gate passed.');
