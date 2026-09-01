const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Cache Version Tests ---');

// ============================================================================
// The cache version must track the deployed build, and nothing else.
//
// Results from /api/calculate are cached in memory and in PostgreSQL for thirty
// days under a key that begins with this version. For most of the fibre work it
// was a hand-bumped string, and it was not bumped: the production machine
// returned seventeen advisory findings when the engine was called directly and
// eight over HTTP, from byte-identical files, because every HTTP answer came
// out of a cache written before the advisory existed.
//
// Nothing about that failure was visible. The deploy was green, the build hash
// in /health was right, the files on disk were right, the worker was fresh. The
// only symptom was that the answers were old.
// ============================================================================

const versionPath = path.join(__dirname, '..', 'engine', 'version.js');
const restartPath = path.join(__dirname, '..', 'tmp', 'restart.txt');

// A fresh require each time, since the module reads the file once at load.
const load = () => {
  delete require.cache[require.resolve(versionPath)];
  return require(versionPath);
};

const hadRestart = fs.existsSync(restartPath);
const original = hadRestart ? fs.readFileSync(restartPath, 'utf8') : null;

try {
  // With a build recorded, the version IS the build.
  fs.mkdirSync(path.dirname(restartPath), { recursive: true });
  fs.writeFileSync(restartPath, 'abc123def456789 restarted at whenever\n');
  const withBuild = load();
  assert.strictEqual(withBuild.ENGINE_VERSION, 'abc123def456',
    'the cache version must be the deployed commit, truncated');

  // A different build must give a different key space, or a deploy would go on
  // serving the previous engine's answers — which is the entire failure this
  // exists to prevent.
  fs.writeFileSync(restartPath, '999888777666555\n');
  assert.notStrictEqual(load().ENGINE_VERSION, withBuild.ENGINE_VERSION,
    'a new build must partition the cache away from the old one');

  // With no build recorded — tests, a local run — it must be a FIXED string.
  // Anything varying per process would give every worker its own key space and
  // quietly divide the hit rate by the number of workers.
  fs.rmSync(restartPath);
  const noBuild = load();
  assert.strictEqual(noBuild.ENGINE_VERSION, noBuild.FALLBACK);
  assert.strictEqual(load().ENGINE_VERSION, noBuild.ENGINE_VERSION,
    'the fallback must be stable across loads, not per-process');
} finally {
  if (hadRestart) fs.writeFileSync(restartPath, original);
  else if (fs.existsSync(restartPath)) fs.rmSync(restartPath);
  delete require.cache[require.resolve(versionPath)];
}

// The route must take the version from that module rather than declaring its
// own. A literal here is how the drift started.
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
assert(/require\(['"]\.\.\/engine\/version['"]\)/.test(routeSrc),
  'routes/api.js must take ENGINE_VERSION from engine/version.js');
assert(!/const ENGINE_VERSION\s*=\s*['"]/.test(routeSrc),
  'routes/api.js must not declare a hand-written ENGINE_VERSION string again');
assert(/ENGINE_VERSION \+ '\|'/.test(routeSrc),
  'and the cache key must still begin with it');

console.log('  cache version tracks the build; the route cannot hard-code one');
console.log('\n✓ All cache version tests passed.');
