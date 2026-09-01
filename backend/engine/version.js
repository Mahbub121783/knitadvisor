'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The cache-partitioning version for calculated results.
 *
 * WHY THIS IS NOT A HAND-BUMPED STRING ANY MORE
 * ---------------------------------------------
 * It was, and the comment beside it said "this is easy to forget", and it was
 * forgotten. Results from /api/calculate are cached in memory and in the
 * database for thirty days under a key that begins with this version, so any
 * engine change that does not come with a bump is invisible to every caller
 * whose inputs were already cached.
 *
 * That is not a small failure. A whole chapter of measured fibre science was
 * shipped, deployed, verified live on the server — and the site kept serving
 * answers computed before it existed. `node -e` on the production machine gave
 * seventeen findings; the same calculation over HTTP gave eight. The files were
 * byte-identical. The cache was thirty days deep and did not care.
 *
 * So the version is now taken from the deployed BUILD. `tmp/restart.txt` holds
 * the commit that Passenger last restarted on, which is written by the deploy
 * and by nothing else, so every deploy partitions the key space exactly once
 * and no human has to remember anything.
 *
 * THE COST, STATED. Every deploy cold-starts the cache. For a calculator that
 * is synchronous, does no network work and holds its reference data in memory,
 * that is a few milliseconds on the first request per input — set against
 * serving month-old answers from an engine that has since been corrected. It is
 * not a close call.
 *
 * The fallback matters too: in tests and local runs there is no restart.txt, so
 * this returns a fixed string rather than something that changes per process.
 * A version that varied between workers would give each of them its own key
 * space and quietly divide the cache hit rate by the number of processes.
 */
const FALLBACK = 'v4-dev';

const BUILD = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'tmp', 'restart.txt'), 'utf8');
    const token = raw.trim().split(/\s+/)[0];
    return token ? token.slice(0, 12) : FALLBACK;
  } catch {
    return FALLBACK;
  }
})();

module.exports = { ENGINE_VERSION: BUILD, FALLBACK };
