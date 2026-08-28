/**
 * Test runner for the engine test suites.
 *
 * These files existed and passed but nothing ever ran them: there was no `npm
 * test` script and the deploy workflow went straight from checkout to FTP
 * upload. Each suite throws on failure, so a non-zero exit here is a real
 * regression.
 *
 * Deliberately dependency-free and DB-free — every suite exercises the pure
 * calculation engine, so this runs in CI with no database available.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SUITES = fs.readdirSync(ROOT)
  .filter(f => f.startsWith('test_') && f.endsWith('.js'))
  .sort();

if (SUITES.length === 0) {
  console.error('No test_*.js suites found in', ROOT);
  process.exit(1);
}

let passed = 0;
const failed = [];

for (const suite of SUITES) {
  process.stdout.write(`\n──── ${suite} ${'─'.repeat(Math.max(0, 50 - suite.length))}\n`);
  try {
    execFileSync(process.execPath, [path.join(ROOT, suite)], { stdio: 'inherit', cwd: ROOT });
    passed++;
  } catch (err) {
    failed.push(suite);
    console.error(`✗ ${suite} FAILED (exit ${err.status})`);
  }
}

console.log(`\n${'='.repeat(56)}`);
console.log(`  ${passed}/${SUITES.length} suites passed${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`);
console.log('='.repeat(56));

process.exit(failed.length ? 1 : 0);
