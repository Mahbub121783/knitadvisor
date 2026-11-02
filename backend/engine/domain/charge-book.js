/**
 * KnitAdvisor — Charge book (knitting & dyeing, multi-vendor)
 * ===========================================================
 *
 * The price list the costing stands on. One place holds every conversion
 * charge: knitting by count tier, dyeing one-part / two-part by shade, for each
 * fabric group and variant, for each vendor (the factory's own sheet first).
 *
 *   resolveItem()  fabric + composition + yarn form + feeder mode → the sheet row
 *                  that prices it (and says when it had to approximate)
 *   quote()        that row × count × shade × vendor → knitting and dyeing USD/kg,
 *                  with every other vendor's price beside it
 *   search()       free text / count → rows with prices (admin and API)
 *
 * It is read synchronously, like every other reference in the engine: the seed
 * JSON (the factory sheet) is loaded at require time, so a calculation never
 * depends on a database; load() replaces it with the editable DB copy at boot
 * and after every admin write. A price of null means "not offered" — never 0.
 *
 * What the engine asked for and the book could not answer is recorded as a gap
 * (fabric not on the sheet, variant not on the sheet, tier not offered), so a new
 * fabric or a missing price shows up on the admin dashboard on its own.
 */
'use strict';

const SEED = require('../../data/charge-book-seed.json');

const TIERS = SEED.tiers;                                  // black dark_navy light_medium neon white_melange
const FIELDS = ['knit_above30', 'knit_below30', ...TIERS.map((t) => 'dye1_' + t), ...TIERS.map((t) => 'dye2_' + t)];
const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) || +v <= 0 ? null : +v);

// ── snapshot ────────────────────────────────────────────────────────────────
function seedSnapshot() {
  const v = SEED.vendor;
  const vendors = new Map([[v.code, { code: v.code, name: v.name, kind: v.kind, currency: v.currency, active: true, is_default: true, derived_from: null, adjust_pct: 0, notes: null }]]);
  const items = new Map(), rates = new Map([[v.code, new Map()]]);
  for (const it of SEED.items) {
    items.set(it.item_key, { item_key: it.item_key, group_name: it.group_name, variant: it.variant, label: it.label, elastane: it.elastane, stripe: it.stripe, active: true });
    rates.get(v.code).set(it.item_key, { ...it.rate });
  }
  return { vendors, items, rates, source: 'seed', loaded_at: null, error: null };
}
let snap = seedSnapshot();
const reindex = () => {
  const byGroup = new Map();
  for (const it of snap.items.values()) { if (!it.active) continue; const k = slug(it.group_name); if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(it); }
  snap.byGroup = byGroup;
};
reindex();

async function load() {
  let db;
  try { db = require('../../db/client'); } catch (e) { snap.error = 'db/client unavailable: ' + e.message; return status(); }
  try {
    try { await require('../../db/repositories/charge-repo').ensureSeeded(); } catch (e) { snap.error = 'seed: ' + e.message; }
    const [vs, its, rs] = await Promise.all([
      db.query('SELECT * FROM charge_vendors'), db.query('SELECT * FROM charge_items'), db.query('SELECT * FROM charge_rates')]);
    if (!its.length || !vs.length) return status();       // nothing in the DB: keep the seed
    const next = { vendors: new Map(), items: new Map(), rates: new Map(), source: 'database', loaded_at: new Date().toISOString(), error: null };
    vs.forEach((v) => next.vendors.set(v.code, { code: v.code, name: v.name, kind: v.kind, currency: v.currency, active: v.active, is_default: v.is_default, derived_from: v.derived_from, adjust_pct: Number(v.adjust_pct) || 0, notes: v.notes }));
    its.forEach((i) => next.items.set(i.item_key, { item_key: i.item_key, group_name: i.group_name, variant: i.variant, label: i.label, elastane: i.elastane, stripe: i.stripe, active: i.active }));
    rs.forEach((r) => {
      if (!next.rates.has(r.vendor_code)) next.rates.set(r.vendor_code, new Map());
      const o = {}; FIELDS.forEach((f) => { o[f] = r[f] == null ? null : Number(r[f]); });
      next.rates.get(r.vendor_code).set(r.item_key, o);
    });
    snap = next; reindex();
  } catch (e) { snap.error = e.message; }
  return status();
}
const reload = load;
function status() {
  return { source: snap.source, loaded_at: snap.loaded_at, error: snap.error, vendors: snap.vendors.size, items: snap.items.size,
    rates: [...snap.rates.values()].reduce((t, m) => t + m.size, 0) };
}

// ── mapping: engine fabric → sheet group ────────────────────────────────────
const GROUP_MAP = {
  single_jersey: 'Single Jersey', plated_jersey: 'Single Jersey', heavy_jersey: 'Heavy Jersey',
  pique_single: 'Pique', pique_double: 'Pique', lacoste_single: 'Single Lacoste', lacoste_double: 'Double Lacoste',
  french_terry: 'French Terry Loop Back Three Thread', fleece_3_thread: 'French Terry Loop Back Three Thread',
  fleece_diagonal: 'French Terry Loop Back Three Thread', fleece_2_thread: 'French Terry Loop Back Two Thread',
  terry_fabric: 'Terry Towelling', velour_plush: 'Terry Towelling',
  rib_1x1: 'RIB 1 x 1', lycra_rib_1x1: 'RIB 1 x 1', purl_1x1: 'RIB 1 x 1', rib_2x1: 'RIB 2 x 1', rib_2x2: 'RIB 2 x 2', lycra_rib_2x2: 'RIB 2 x 2',
  rib_3x1: 'RIB 3 x 1', rib_3x2: 'RIB 3 x 2', rib_3x3: 'RIB 3 x 3', rib_4x1: '4 x 1 Rib', rib_4x2: 'RIB 4 x 2', rib_4x3: 'RIB 4 x 3',
  rib_5x1: 'RIB 5 x 1', rib_5x3: 'RIB 5 x 3', rib_5x4: 'RIB 5 x 4', drop_needle_rib: 'Rib (Irregular)', cable_rib: 'RIB 3 x 3',
  half_cardigan: 'Ottoman Rib', full_cardigan: 'Ottoman Rib', half_milano: 'Ottoman Rib', full_milano: 'Ottoman Rib',
  interlock: 'Interlock', ponte_di_roma: 'Interlock', eight_lock: 'Interlock', gabardine_double: 'Interlock', poplin_double: 'Interlock',
  swiss_double_pique: 'Interlock Pique', french_double_pique: 'Interlock Pique', lacoste_pique: 'Interlock Pique', texipique: 'Interlock Pique', pique_interlock: 'Interlock Pique',
  relief_single: 'Interlock Double Face', blister_single: 'Interlock Double Face', bourrelet: 'Interlock Double Face',
  waffle_knit: 'Waffle / Thermal', popcorn_blister: 'Popcorn Jersey', knop_honeycomb: 'Pique Honeycomb', cellular_blister: 'Pique Honeycomb',
  pointelle: 'Pointal Jersey', pointelle_eyelet: 'Pointal Jersey', pointelle_chevron: 'Pointal Jersey', pointelle_diagonal: 'Pointal Jersey',
  single_jacquard: 'Pointal Jersey', mock_rib: 'Single Jersey', single_cross_tuck: 'Single Jersey', knitted_twill: 'Single Jersey', knitted_crepe: 'Crape Jersey',
  weft_lockknit: 'Single Jersey', birds_eye: 'Single Jersey', jersey_blister: 'Single Jersey', accordion_tuck: 'Single Jersey', moss_stitch: 'Single Jersey',
};
const FLEECY = new Set(['french_terry', 'fleece_2_thread', 'fleece_3_thread', 'fleece_diagonal']);
const ELASTANE_MODE = { ff: 'Full', hf: 'Half' };

function familyDefault(fabricId, category) {
  const id = String(fabricId || '');
  if (/rib/.test(id) || category === 'rib') return 'RIB 1 x 1';
  if (/interlock|double/.test(id) || category === 'interlock') return 'Interlock';
  if (/fleece|terry/.test(id)) return 'French Terry Loop Back Three Thread';
  if (/woven|plain_|twill|satin/.test(id)) return 'Woven Fabric';
  return 'Single Jersey';
}

const seen = new Set();
let gapSink = null;
function setGapSink(fn) { gapSink = typeof fn === 'function' ? fn : null; }
function noteGap(kind, ctx, group, variant, detail) {
  if (ctx._quiet) return;
  const key = [kind, ctx.fabricId, group, variant].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  if (gapSink) { try { gapSink({ gap_key: key, kind, fabric_id: ctx.fabricId || null, group_name: group || null, variant: variant || null, detail }); } catch (_) { /* never fail a costing */ } }
}

/**
 * Which sheet row prices this fabric. Never throws; `approximate` says the sheet
 * has no row for exactly this and the nearest was used.
 */
function resolveItem(ctx = {}) {
  const notes = [];
  const forced = ctx.itemKey && snap.items.get(ctx.itemKey);
  if (forced && forced.active) return { item: forced, approximate: false, how: 'chosen', notes };

  const fibers = ctx.fibers || {};
  const viscose = (fibers.viscose || 0) + (fibers.modal || 0) + (fibers.bamboo || 0) >= 30;
  const elastane = (fibers.elastane || fibers.spandex || fibers.lycra || 0) > 0;
  const slub = ctx.yarnForm === 'slub' || /slub/.test(String(ctx.fabricId || ''));

  let group = GROUP_MAP[ctx.fabricId], approximate = false;
  if (!group) { group = familyDefault(ctx.fabricId, ctx.category); approximate = true; notes.push(`"${ctx.fabricId}" is not on the charge sheet; priced as ${group}.`); noteGap('no_group', ctx, group, '', `fabric "${ctx.fabricId}" has no row on the charge sheet`); }
  if (ctx.brushed && FLEECY.has(ctx.fabricId) && snap.byGroup.has(slug(group + ' inside Brush'))) group = group + ' inside Brush';

  let pool = null, used = group;
  const tryGroup = (g) => { const p = snap.byGroup.get(slug(g)); if (p && p.length) { pool = p; used = p[0].group_name; return true; } return false; };
  if (viscose && tryGroup(group + ' Viscose')) notes.push('viscose rate');
  else if (slub && tryGroup(group + ' Slub')) notes.push('slub rate');
  else if (slub && tryGroup(group + ' SLUB')) notes.push('slub rate');
  if (!pool && !tryGroup(group)) {
    group = familyDefault(ctx.fabricId, ctx.category); approximate = true;
    if (!tryGroup(group)) return { item: null, approximate: true, how: 'none', notes: [...notes, 'no charge rows at all'] };
    noteGap('no_group', ctx, group, '', `group not on the sheet; used ${group}`);
  }

  const stripe = ctx.stripeType === 'engineering' ? 'Engineering Stripe' : ctx.stripeType === 'feeder' ? 'Feeder Stripe' : null;
  const mode = ctx.feederType === 'ff' ? 'ff' : 'hf', other = mode === 'ff' ? 'hf' : 'ff';
  const wants = [];
  if (stripe && elastane) wants.push(`${stripe} with Elastane ${ELASTANE_MODE[mode]} Feeder`, `${stripe} with Elastane ${ELASTANE_MODE[other]} Feeder`);
  else if (stripe) wants.push(stripe);
  else if (elastane) wants.push(`Elastane ${ELASTANE_MODE[mode]} Feeder`, `Elastane ${ELASTANE_MODE[other]} Feeder`);
  else wants.push('');
  let item = null;
  for (const w of wants) { item = pool.find((i) => i.variant === w); if (item) break; }
  if (item && wants.length > 1 && item.variant !== wants[0]) notes.push(`${wants[0]} is not on the sheet for ${used}; the ${item.variant.toLowerCase()} rate was used`);
  if (!item) {
    item = pool.find((i) => i.variant === '') || pool[0];
    approximate = true;
    const w = wants[0] || 'base';
    notes.push(`No "${w}" row for ${used} on the sheet; priced on ${item.variant || 'the base row'}.`);
    noteGap('no_variant', ctx, used, w, `"${used}" has no "${w}" row`);
  }
  return { item, approximate, how: 'matched', notes };
}

// ── rates ───────────────────────────────────────────────────────────────────
function vendorRate(code, itemKey, depth = 0) {
  const v = snap.vendors.get(code);
  if (!v || !v.active) return null;
  const own = snap.rates.get(code) && snap.rates.get(code).get(itemKey);
  if (own) return { rate: own, derived: false };
  if (v.derived_from && depth < 4) {
    const base = vendorRate(v.derived_from, itemKey, depth + 1);
    if (base) {
      const k = 1 + (v.adjust_pct || 0) / 100, out = {};
      FIELDS.forEach((f) => { out[f] = base.rate[f] == null ? null : r3(base.rate[f] * k); });
      return { rate: out, derived: true, from: v.derived_from, adjust_pct: v.adjust_pct };
    }
  }
  return null;
}
const defaultVendor = () => [...snap.vendors.values()].find((v) => v.is_default && v.active) || [...snap.vendors.values()].find((v) => v.active) || null;

const SHADE_TIER = { black: 'black', dark_navy: 'dark_navy', dark: 'dark_navy', navy: 'dark_navy', light_medium: 'light_medium', medium: 'light_medium', light: 'light_medium',
  fluorescent: 'neon', neon: 'neon', white_melange: 'white_melange', white: 'white_melange', melange: 'white_melange', heather: 'white_melange' };
const tierOfShade = (s) => SHADE_TIER[String(s || '').toLowerCase()] || 'light_medium';

// The sheet's own two-part step: every two-part price is the one-part price + 0.45
// (black 1.75 -> 2.20, dark 1.55 -> 2.00, light/medium 1.30 -> 1.75).
const TWO_PART_STEP = 0.45;

function priceFrom(rate, countNe, tier, twoPart) {
  const above = Number(countNe) > 30;
  const k = above ? rate.knit_above30 : rate.knit_below30, kAlt = above ? rate.knit_below30 : rate.knit_above30;
  const d1 = rate['dye1_' + tier], d2 = rate['dye2_' + tier];
  let dye = twoPart ? d2 : d1, part = twoPart ? 'two' : 'one', how = null;
  // White / melange is a bleach or a wash, not a dye bath: one price, whatever the fibres
  if (tier === 'white_melange' && twoPart && d1 != null) { dye = d1; part = 'one'; how = 'a bleach or wash, one bath whatever the blend'; }
  // The sheet lists no two-part price for this row: its own step on the one-part price
  else if (twoPart && d2 == null && d1 != null) { dye = Math.round((d1 + TWO_PART_STEP) * 1000) / 1000; how = `the sheet lists no two-part price here: one-part + the sheet's usual ${TWO_PART_STEP} two-part step`; }
  return { knit: k != null ? k : kAlt, knit_fallback_tier: k == null && kAlt != null, dye, dye_part: part, dye_how: how };
}

/**
 * Knitting and dyeing USD/kg for one fabric, from one vendor, plus the others.
 *   ctx: fabricId, category, fibers, yarnForm, feederType, stripeType, brushed,
 *        itemKey, vendor ('code' | 'cheapest'), countNe, shade, twoPart
 */
function quote(ctx = {}) {
  const res = resolveItem(ctx);
  if (!res.item) return { ok: false, notes: res.notes };
  const tier = tierOfShade(ctx.shade);
  const twoPart = !!ctx.twoPart;
  const list = [...snap.vendors.values()].filter((v) => v.active);
  const rows = [];
  for (const v of list) {
    const vr = vendorRate(v.code, res.item.item_key);
    if (!vr) continue;
    const p = priceFrom(vr.rate, ctx.countNe, tier, twoPart);
    rows.push({ vendor: v.code, name: v.name, derived: vr.derived, rate: vr.rate, ...p, total: p.knit != null && p.dye != null ? r3(p.knit + p.dye) : null });
  }
  let chosen = null, vendorNote = null;
  if (ctx.vendor === 'cheapest') {
    chosen = rows.filter((r) => r.total != null).sort((a, b) => a.total - b.total)[0] || null;
    if (chosen) vendorNote = `cheapest of ${rows.filter((r) => r.total != null).length} vendors`;
  } else if (ctx.vendor) {
    chosen = rows.find((r) => r.vendor === ctx.vendor) || null;
    if (!chosen) { vendorNote = `"${ctx.vendor}" does not price this item; the default vendor was used`; noteGap('no_vendor_item', ctx, res.item.group_name, res.item.variant, vendorNote); }
  }
  if (!chosen) { const d = defaultVendor(); chosen = d && rows.find((r) => r.vendor === d.code) || rows[0] || null; }
  if (!chosen) return { ok: false, item: res.item, notes: [...res.notes, 'no vendor prices this item'] };

  // A yarn-dyed stripe with elastane lists knitting only: the yarn is dyed before
  // knitting, so the cloth sees only the wash the plain stripe row prices.
  if (chosen.dye == null && res.item.stripe) {
    const sibName = res.item.stripe === 'engineering' ? 'Engineering Stripe' : 'Feeder Stripe';
    const sib = (snap.byGroup.get(slug(res.item.group_name)) || []).find((i) => i.variant === sibName);
    const sr = sib && vendorRate(chosen.vendor, sib.item_key);
    const sd = sr && sr.rate['dye' + (twoPart ? '2' : '1') + '_' + tier];
    if (sd != null) { chosen = { ...chosen, dye: sd, dye_part: twoPart ? 'two' : 'one' }; res.notes.push(`yarn-dyed: dyeing priced as the plain ${sibName.toLowerCase()} row`); }
  }
  const notes = [...res.notes]; if (vendorNote) notes.push(vendorNote);
  if (chosen.dye_how) notes.push(`Dyeing: ${chosen.dye_how}.`);
  if (chosen.dye == null) { notes.push(`The sheet offers no ${twoPart ? 'two-part' : 'one-part'} ${tier.replace('_', '/')} dyeing for ${res.item.label}.`); noteGap('no_price', ctx, res.item.group_name, res.item.variant, `${twoPart ? '2P' : '1P'} ${tier} not offered`); }
  if (chosen.knit == null) { notes.push(`The sheet offers no knitting price for ${res.item.label}.`); noteGap('no_price', ctx, res.item.group_name, res.item.variant, 'knitting not offered'); }
  return {
    ok: true, approximate: res.approximate, how: res.how, notes,
    item: { key: res.item.item_key, label: res.item.label, group: res.item.group_name, variant: res.item.variant },
    vendor: { code: chosen.vendor, name: chosen.name, derived: chosen.derived },
    tier, two_part: twoPart,
    knit: chosen.knit == null ? null : { usd: chosen.knit, above30: chosen.rate.knit_above30, below30: chosen.rate.knit_below30, tier: Number(ctx.countNe) > 30 ? 'above 30s' : '30s and below', fallback_tier: chosen.knit_fallback_tier },
    dye: chosen.dye == null ? null : { usd: chosen.dye, tier, part: chosen.dye_part, how: chosen.dye_how || null },
    dye_table: { one_part: Object.fromEntries(TIERS.map((t) => [t, chosen.rate['dye1_' + t]])), two_part: Object.fromEntries(TIERS.map((t) => [t, chosen.rate['dye2_' + t]])) },
    alternatives: rows.map((r) => ({ vendor: r.vendor, name: r.name, derived: r.derived, knit: r.knit, dye: r.dye, total: r.total })).sort((a, b) => (a.total == null) - (b.total == null) || a.total - b.total),
  };
}

// ── search (admin, API) ─────────────────────────────────────────────────────
const normText = (t) => String(t || '').toLowerCase()
  .replace(/(\d)\s*[x×]\s*(\d)/g, '$1x$2').replace(/\blycra\b|\bspandex\b/g, 'elastane').replace(/\bff\b/g, 'full feeder').replace(/\bhf\b/g, 'half feeder')
  .replace(/\bsj\b/g, 'single jersey').replace(/\bpolo\b|\bpique\b|\bpiqué\b/g, 'pique').replace(/[^a-z0-9/()+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

function search(o = {}) {
  const q = normText(o.q), toks = q ? q.split(' ') : [];
  const tier = o.shade ? tierOfShade(o.shade) : null;
  const out = [];
  for (const it of snap.items.values()) {
    if (!it.active && !o.includeInactive) continue;
    const hay = normText(it.label + ' ' + it.group_name);
    let score = 0, ok = true;
    for (const t of toks) { if (hay.includes(t)) score += hay.split(' ').includes(t) ? 2 : 1; else { ok = false; break; } }
    if (!ok) continue;
    if (!toks.length) score = 1;
    out.push({ it, score: score - (it.variant ? 0.01 * it.variant.length : 0) });
  }
  out.sort((a, b) => b.score - a.score || a.it.label.localeCompare(b.it.label));
  const vendors = [...snap.vendors.values()].filter((v) => v.active && (!o.vendor || o.vendor === 'all' || v.code === o.vendor));
  const total = out.length;
  return {
    total, shown: Math.min(total, o.limit || 60),
    vendors: vendors.map((v) => ({ code: v.code, name: v.name, is_default: v.is_default })),
    rows: out.slice(0, o.limit || 60).map(({ it }) => ({
      item_key: it.item_key, group: it.group_name, variant: it.variant, label: it.label, elastane: it.elastane, stripe: it.stripe, active: it.active,
      prices: vendors.map((v) => {
        const vr = vendorRate(v.code, it.item_key);
        if (!vr) return { vendor: v.code, offered: false };
        const p = o.count ? priceFrom(vr.rate, o.count, tier || 'light_medium', false) : null;
        return { vendor: v.code, offered: true, derived: vr.derived, rate: vr.rate, at_count: p ? { knit: p.knit, dye_one_part: vr.rate['dye1_' + (tier || 'light_medium')], dye_two_part: vr.rate['dye2_' + (tier || 'light_medium')] } : null };
      }),
    })),
  };
}

/** Coverage: every engine fabric id and the sheet row it lands on. */
function coverage(fabrics) {
  return fabrics.map((f) => {
    const r = resolveItem({ fabricId: f.id, category: f.category, fibers: { cotton: 100 }, _quiet: true });
    return { fabric_id: f.id, name: f.name, category: f.category, group: r.item ? r.item.group_name : null, approximate: r.approximate, notes: r.notes };
  });
}

const getItem = (k) => snap.items.get(k) || null;
const listVendors = () => [...snap.vendors.values()];
const listItems = () => [...snap.items.values()];

const _snap = () => snap;   // tests only

module.exports = { _snap, load, reload, status, resolveItem, quote, search, coverage, tierOfShade, setGapSink, getItem, listVendors, listItems, vendorRate, defaultVendor, FIELDS, TIERS, GROUP_MAP };
