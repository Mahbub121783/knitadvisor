/**
 * Admin-curated university email-domain allow-list (migration 031).
 * See engine/domain/student-eligibility.js for why matching is exact, never
 * a suffix/wildcard.
 */
const { query, queryOne } = require('../client');

async function listActive() {
  return query('SELECT id, name, domain FROM university_domains WHERE active ORDER BY name');
}

async function listAll() {
  return query('SELECT id, name, domain, active, created_at FROM university_domains ORDER BY name');
}

function findById(id) {
  return queryOne('SELECT id, name, domain, active FROM university_domains WHERE id = $1', [id]);
}

/** @returns {Promise<{row: object|null, conflict: boolean}>} */
async function create({ name, domain }) {
  try {
    const rows = await query(
      'INSERT INTO university_domains (name, domain) VALUES ($1, $2) RETURNING id, name, domain, active',
      [name, String(domain).toLowerCase()]
    );
    return { row: rows[0], conflict: false };
  } catch (err) {
    if (err.code === '23505') return { row: null, conflict: true };
    throw err;
  }
}

async function setActive(id, active) {
  const rows = await query('UPDATE university_domains SET active = $2 WHERE id = $1 RETURNING id, active', [id, !!active]);
  return rows[0] || null;
}

async function remove(id) {
  const rows = await query('DELETE FROM university_domains WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

module.exports = { listActive, listAll, findById, create, setActive, remove };
