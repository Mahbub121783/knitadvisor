/**
 * Per-user daily request counters (migration 031), keyed on the Asia/Dhaka
 * calendar day like logs-repo's todayStats() and user-repo's newCounts() —
 * a server-local (Mountain time) cutoff would flip "today" around midday in
 * Bangladesh.
 *
 * incrementAndGet() is a single atomic UPSERT so two concurrent requests
 * (possibly on different Passenger workers) can never both read the same
 * count and both decide they are still under the limit.
 */
const { query, queryOne } = require('../client');

function tz() {
  return process.env.BUSINESS_TIMEZONE || 'Asia/Dhaka';
}

/** @returns {Promise<number>} the count for today, AFTER this call's increment. */
async function incrementAndGet(userId) {
  const row = await queryOne(
    `INSERT INTO app_user_daily_usage (user_id, usage_date, count)
     VALUES ($1, (now() AT TIME ZONE $2)::date, 1)
     ON CONFLICT (user_id, usage_date) DO UPDATE SET count = app_user_daily_usage.count + 1
     RETURNING count`,
    [userId, tz()]
  );
  return row.count;
}

async function todayCount(userId) {
  const row = await queryOne(
    'SELECT count FROM app_user_daily_usage WHERE user_id = $1 AND usage_date = (now() AT TIME ZONE $2)::date',
    [userId, tz()]
  );
  return row ? row.count : 0;
}

module.exports = { incrementAndGet, todayCount };
