/**
 * Garment cost sheets, per account (table from migration 038). Every query is
 * keyed by the signed-in user's id; the id is never read from a URL or body.
 * Saving under an existing name keeps the previous sheet as a version (last 10).
 */
const { query, queryOne } = require('../client');

const MAX_SHEETS = 200;
const MAX_BYTES = 600 * 1024;     // room for one compressed style picture
const MAX_VERSIONS = 10;

class SheetSaveError extends Error {}

function cleanSheet(body) {
  const b = body || {};
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw new SheetSaveError('Give the sheet a name (style number).');
  const s = b.sheet;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new SheetSaveError('Nothing to save.');
  if (!Array.isArray(s.sizes) || !s.sizes.length || s.sizes.length > 12) throw new SheetSaveError('A sheet has 1 to 12 sizes.');
  if (!Array.isArray(s.shells) || s.shells.length > 8) throw new SheetSaveError('At most 8 fabric shells.');
  if (s.picture != null && !(typeof s.picture === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s.picture))) {
    throw new SheetSaveError('The picture must be a JPEG, PNG or WebP image.');
  }
  const json = JSON.stringify({ ...s, name });
  if (Buffer.byteLength(json) > MAX_BYTES) throw new SheetSaveError('This sheet is too large to save — use a smaller picture.');
  return { name, json };
}

const sheets = {
  list(userId) {
    return query(
      `SELECT id, name, sheet - 'picture' AS sheet, (sheet ? 'picture') AS has_picture, jsonb_array_length(versions) AS versions, created_at, updated_at
         FROM cost_sheets WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT ${MAX_SHEETS}`,
      [userId]
    );
  },

  get(userId, id) {
    return queryOne('SELECT id, name, sheet, versions, created_at, updated_at FROM cost_sheets WHERE user_id = $1 AND id = $2', [userId, id]);
  },

  async save(userId, body) {
    const { name, json } = cleanSheet(body);
    const exists = await queryOne('SELECT id FROM cost_sheets WHERE user_id = $1 AND lower(name) = lower($2)', [userId, name]);
    if (!exists) {
      const { count } = await queryOne('SELECT count(*)::int AS count FROM cost_sheets WHERE user_id = $1', [userId]);
      if (count >= MAX_SHEETS) throw new SheetSaveError(`You have ${MAX_SHEETS} saved sheets — delete one first.`);
    }
    // the sheet being replaced becomes a version (without its picture)
    return queryOne(
      `INSERT INTO cost_sheets (user_id, name, sheet) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, lower(name)) DO UPDATE SET
         versions = (SELECT COALESCE(jsonb_agg(x.v), '[]'::jsonb) FROM (
                       SELECT v FROM jsonb_array_elements(
                         jsonb_build_array(jsonb_build_object('saved_at', cost_sheets.updated_at, 'sheet', cost_sheets.sheet - 'picture')) || cost_sheets.versions
                       ) AS v LIMIT ${MAX_VERSIONS}) x),
         sheet = EXCLUDED.sheet, name = EXCLUDED.name, updated_at = now()
       RETURNING id, name, updated_at, jsonb_array_length(versions) AS versions`,
      [userId, name, json]
    );
  },

  async remove(userId, id) {
    const rows = await query('DELETE FROM cost_sheets WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
    return rows.length > 0;
  },
};

module.exports = { sheets, cleanSheet, SheetSaveError, MAX_SHEETS, MAX_VERSIONS };
