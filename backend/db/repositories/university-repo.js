/**
 * Admin-curated university email-domain allow-list (migration 031).
 * See engine/domain/student-eligibility.js for why matching is exact, never
 * a suffix/wildcard.
 */
const { query, queryOne } = require('../client');

/** What a student can pick: active, and never a staff-only domain. */
async function listActive() {
  return query("SELECT id, name, domain, kind FROM university_domains WHERE active AND kind <> 'staff' ORDER BY name, domain");
}

async function listAll() {
  return query('SELECT id, name, domain, active, kind, aliases, source, created_at FROM university_domains ORDER BY name, domain');
}

function findById(id) {
  return queryOne('SELECT id, name, domain, active, kind, aliases FROM university_domains WHERE id = $1', [id]);
}

/** Every name this university goes by (its rows across domains, plus aliases) — what a document is searched for. */
async function namesFor(id, fallbackName) {
  const row = id ? await findById(id) : null;
  if (!row) return { names: fallbackName ? [fallbackName] : [], domains: [] };
  const sib = await query('SELECT domain, aliases FROM university_domains WHERE lower(name) = lower($1)', [row.name]);
  const names = new Set([row.name]);
  const domains = new Set([row.domain]);
  for (const r of sib) { (r.aliases || []).forEach((a) => names.add(a)); domains.add(r.domain); }
  return { names: [...names], domains: [...domains] };
}

/** kind (student / staff / any), aliases, name. */
async function update(id, { kind, aliases, name }) {
  const sets = [], vals = [id];
  if (kind) { vals.push(kind); sets.push('kind = $' + vals.length); }
  if (Array.isArray(aliases)) { vals.push(aliases); sets.push('aliases = $' + vals.length); }
  if (name) { vals.push(name); sets.push('name = $' + vals.length); }
  if (!sets.length) return findById(id);
  sets.push("source = 'admin'");
  const rows = await query('UPDATE university_domains SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING id, name, domain, active, kind, aliases, source', vals);
  return rows[0] || null;
}

/** @returns {Promise<{row: object|null, conflict: boolean}>} */
async function create({ name, domain, kind = 'any', aliases = [] }) {
  try {
    const rows = await query(
      'INSERT INTO university_domains (name, domain, kind, aliases) VALUES ($1, $2, $3, $4) RETURNING id, name, domain, active, kind, aliases, source',
      [name, String(domain).toLowerCase(), ['student', 'staff', 'any'].includes(kind) ? kind : 'any', aliases]
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

module.exports = { listActive, listAll, findById, namesFor, update, create, setActive, remove };
