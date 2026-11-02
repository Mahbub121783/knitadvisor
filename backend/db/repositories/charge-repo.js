/**
 * Charge book repository — writes (the engine reads the in-memory snapshot in
 * engine/domain/charge-book.js; every write here is followed by a reload there).
 */
'use strict';
const { query, transaction } = require('../client');
const SEED = require('../../data/charge-book-seed.json');

const TIERS = SEED.tiers;
const FIELDS = ['knit_above30', 'knit_below30', ...TIERS.map((t) => 'dye1_' + t), ...TIERS.map((t) => 'dye2_' + t)];
const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const cleanNum = (v) => (v == null || v === '' || !Number.isFinite(+v) || +v <= 0 ? null : Math.round(+v * 1000) / 1000);
const rateCols = FIELDS.join(', ');

/** First boot: load the factory sheet into an empty book. */
async function ensureSeeded() {
  const [{ n }] = await query('SELECT count(*)::int AS n FROM charge_items');
  if (n > 0) return false;
  const v = SEED.vendor;
  await transaction(async (q) => {
    await q(`INSERT INTO charge_vendors (code, name, kind, currency, is_default, notes)
             VALUES ($1,$2,$3,$4,TRUE,$5) ON CONFLICT (code) DO NOTHING`, [v.code, v.name, v.kind, v.currency, 'Seeded from the factory charge sheet']);
    for (const it of SEED.items) {
      await q(`INSERT INTO charge_items (item_key, group_name, variant, label, elastane, stripe)
               VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item_key) DO NOTHING`, [it.item_key, it.group_name, it.variant, it.label, it.elastane, it.stripe]);
      await q(`INSERT INTO charge_rates (vendor_code, item_key, ${rateCols}, updated_by)
               VALUES ($1,$2,${FIELDS.map((_, i) => '$' + (i + 3)).join(',')},'seed') ON CONFLICT DO NOTHING`,
        [v.code, it.item_key, ...FIELDS.map((f) => it.rate[f])]);
    }
  });
  return true;
}

/** Set a vendor's prices for one item (only the fields given); logs each change. */
async function upsertRate(vendor, itemKey, fields, who, note) {
  return transaction(async (q) => {
    const cur = (await q('SELECT * FROM charge_rates WHERE vendor_code=$1 AND item_key=$2', [vendor, itemKey]))[0] || null;
    if (!cur) await q('INSERT INTO charge_rates (vendor_code, item_key, updated_by) VALUES ($1,$2,$3)', [vendor, itemKey, who || null]);
    let changed = 0;
    for (const f of FIELDS) {
      if (!(f in fields)) continue;
      const nv = cleanNum(fields[f]), ov = cur && cur[f] != null ? Number(cur[f]) : null;
      if (nv === ov) continue;
      await q(`UPDATE charge_rates SET ${f}=$3, updated_at=now(), updated_by=$4 WHERE vendor_code=$1 AND item_key=$2`, [vendor, itemKey, nv, who || null]);
      await q('INSERT INTO charge_history (vendor_code, item_key, field, old_value, new_value, note, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [vendor, itemKey, f, ov, nv, note || null, who || null]);
      changed++;
    }
    return changed;
  });
}

async function createItem({ group_name, variant = '', elastane = null, stripe = null }) {
  const group = String(group_name || '').trim(), vr = String(variant || '').trim();
  if (!group) throw new Error('group_name is required');
  const key = slug(group) + (vr ? '|' + slug(vr) : '');
  const label = vr ? `${group} — ${vr}` : group;
  await query(`INSERT INTO charge_items (item_key, group_name, variant, label, elastane, stripe)
               VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item_key) DO UPDATE SET active = TRUE`, [key, group, vr, label, elastane, stripe]);
  return key;
}

async function setItemActive(key, active) { await query('UPDATE charge_items SET active=$2 WHERE item_key=$1', [key, !!active]); }

async function createVendor(v) {
  const code = slug(v.code || v.name).replace(/_/g, '-');
  if (!code || !v.name) throw new Error('name is required');
  await query(`INSERT INTO charge_vendors (code, name, kind, currency, derived_from, adjust_pct, valid_from, notes)
               VALUES ($1,$2,$3,'USD',$4,$5,$6,$7)`,
    [code, v.name, v.kind || 'vendor', v.derived_from || null, Number(v.adjust_pct) || 0, v.valid_from || null, v.notes || null]);
  return code;
}

async function updateVendor(code, p) {
  const sets = [], vals = [code];
  const add = (c, v) => { vals.push(v); sets.push(`${c}=$${vals.length}`); };
  if ('name' in p) add('name', p.name);
  if ('kind' in p) add('kind', p.kind);
  if ('active' in p) add('active', !!p.active);
  if ('derived_from' in p) add('derived_from', p.derived_from || null);
  if ('adjust_pct' in p) add('adjust_pct', Number(p.adjust_pct) || 0);
  if ('valid_from' in p) add('valid_from', p.valid_from || null);
  if ('notes' in p) add('notes', p.notes || null);
  return transaction(async (q) => {
    if (p.is_default === true) { await q('UPDATE charge_vendors SET is_default=FALSE WHERE is_default'); add('is_default', true); }
    if (sets.length) await q(`UPDATE charge_vendors SET ${sets.join(', ')}, updated_at=now() WHERE code=$1`, vals);
  });
}

/**
 * Bulk import. rows: { vendor, group, variant, <field>: value ... }. Missing
 * items are created, so a new fabric or variant needs no separate step.
 */
async function importRows(rows, who, note) {
  let created = 0, updated = 0;
  for (const r of rows) {
    const key = await createItem({ group_name: r.group, variant: r.variant || '' });
    const exists = (await query('SELECT 1 FROM charge_rates WHERE vendor_code=$1 AND item_key=$2', [r.vendor, key])).length;
    const fields = {}; FIELDS.forEach((f) => { if (f in r) fields[f] = r[f]; });
    const n = await upsertRate(r.vendor, key, fields, who, note || 'import');
    if (!exists) created++; else if (n) updated++;
  }
  return { created, updated };
}

async function history(itemKey, limit = 40) {
  return query('SELECT vendor_code, field, old_value, new_value, note, changed_by, changed_at FROM charge_history WHERE item_key=$1 ORDER BY changed_at DESC LIMIT $2', [itemKey, limit]);
}

async function recordGap(g) {
  await query(`INSERT INTO charge_gaps (gap_key, kind, fabric_id, group_name, variant, detail)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (gap_key) DO UPDATE SET hits = charge_gaps.hits + 1, last_seen = now(), resolved = FALSE`,
    [g.gap_key, g.kind, g.fabric_id, g.group_name, g.variant, g.detail]);
}
async function gaps(includeResolved) {
  return query(`SELECT id, kind, fabric_id, group_name, variant, detail, hits, first_seen, last_seen, resolved FROM charge_gaps
                ${includeResolved ? '' : 'WHERE NOT resolved'} ORDER BY hits DESC, last_seen DESC LIMIT 200`);
}
async function resolveGap(id) { await query('UPDATE charge_gaps SET resolved=TRUE WHERE id=$1', [id]); }

module.exports = { ensureSeeded, upsertRate, createItem, setItemActive, createVendor, updateVendor, importRows, history, recordGap, gaps, resolveGap, FIELDS };
