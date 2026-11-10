/**
 * The pool (migration 044): who has opted in, and what the pool tells a member.
 *
 * The only thing stored is membership. Contributions are computed from the members' own logged
 * rolls when read (the last CAP rolls of each structure, per account) and held in memory for
 * two minutes, so leaving takes effect at once in this worker and within the TTL in the others.
 * What leaves this module is a small table of cells that at least MIN_ACCOUNTS OTHER accounts
 * stand behind (engine/domain/machine-pool.js) — never a roll, a user or a machine.
 */
'use strict';
const { query, queryOne } = require('../client');
const MP = require('../../engine/domain/machine-pool');

const TTL_MS = 120 * 1000;
let cellsCache = null;
const memberCache = new Map();               // user id → { member, at }
const invalidate = () => { cellsCache = null; };

async function cells() {
  if (cellsCache && Date.now() - cellsCache.at < TTL_MS) return cellsCache.cells;
  const rows = await query(
    `SELECT user_id AS "user", group_key AS "group", ne::float8 AS ne, (gsm / NULLIF(gsm_model, 0))::float8 AS gsm_ratio,
            (width_in / NULLIF(width_model, 0))::float8 AS width_ratio
       FROM (SELECT r.user_id, r.group_key, r.ne, r.gsm, r.gsm_model, r.width_in, r.width_model,
                    row_number() OVER (PARTITION BY r.user_id, r.group_key ORDER BY r.created_at DESC, r.id DESC) AS rn
               FROM studio_floor_rolls r JOIN studio_pool_members m ON m.user_id = r.user_id) t
      WHERE rn <= $1`, [MP.CAP]);
  const c = MP.aggregate(rows);
  cellsCache = { at: Date.now(), cells: c };
  return c;
}

const members = {
  async isMember(userId) {
    const h = memberCache.get(userId);
    if (h && Date.now() - h.at < 60 * 1000) return h.member;
    const member = !!(await queryOne('SELECT 1 AS x FROM studio_pool_members WHERE user_id = $1', [userId]));
    memberCache.set(userId, { member, at: Date.now() });
    if (memberCache.size > 5000) memberCache.delete(memberCache.keys().next().value);
    return member;
  },
  async join(userId) { await query('INSERT INTO studio_pool_members (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]); memberCache.delete(userId); invalidate(); },
  async leave(userId) { await query('DELETE FROM studio_pool_members WHERE user_id = $1', [userId]); memberCache.delete(userId); invalidate(); },
};

/** What the pool tells this account (null when it is not a member, or no cell has 5 other accounts yet). */
async function tableFor(userId) { return MP.tableFor(await cells(), userId); }

/** For the account's own screen — its status, and which structures the pool covers, by how many mills. */
async function status(userId) {
  const member = await members.isMember(userId);
  const out = { member, mills: null, covered: [], my_rolls: 0 };
  out.my_rolls = (await queryOne('SELECT count(*)::int AS n FROM studio_floor_rolls WHERE user_id = $1', [userId])).n;
  if (member) {
    const n = (await queryOne('SELECT count(*)::int AS n FROM studio_pool_members', [])).n;
    out.mills = n >= MP.MIN_ACCOUNTS ? n : null;                  // a head-count under 5 is not given out
    out.covered = MP.coverage(await tableFor(userId));
  }
  return out;
}

module.exports = { members, tableFor, status, invalidate, MIN_ACCOUNTS: MP.MIN_ACCOUNTS };
