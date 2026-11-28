// The plan table, read at most once a minute per worker (the daily limit is checked on every engine request).
// A change made in the admin panel clears this worker's copy at once; other workers follow within the minute.
const S = require('../engine/domain/subscriptions');

const TTL_MS = 60 * 1000;
let cached = null, readAt = 0, reading = null;

async function catalogue() {
  if (cached && Date.now() - readAt < TTL_MS) return cached;
  if (!reading) {
    reading = (async () => {
      try { cached = S.catalogueOf(await require('../db/repositories/subscription-repo').plans.list()); } catch (err) {
        console.error('[Plans] could not read the plan table:', err.message);
        cached = cached || S.catalogueOf();          // the built-in plans: a bookkeeping failure never blocks the engine
      }
      readAt = Date.now(); reading = null;
      return cached;
    })();
  }
  return reading;
}

const invalidate = () => { readAt = 0; };

/** The plan an account is on today. */
async function planOf(user) { return S.resolve(user, await catalogue()); }

module.exports = { catalogue, planOf, invalidate };
