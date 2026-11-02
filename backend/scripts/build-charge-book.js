/**
 * Builds backend/data/charge-book-seed.json from data/charge-sheet.txt — the
 * factory's knitting & dyeing charge sheet. Re-run after editing the sheet.
 */
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'data', 'charge-sheet.txt');
const OUT = path.join(__dirname, '..', 'data', 'charge-book-seed.json');

const SHORT = {
  EFF: 'Elastane Full Feeder', EHF: 'Elastane Half Feeder', ES: 'Engineering Stripe',
  ESEFF: 'Engineering Stripe with Elastane Full Feeder', ESEHF: 'Engineering Stripe with Elastane Half Feeder',
  FS: 'Feeder Stripe', FSEFF: 'Feeder Stripe with Elastane Full Feeder', FSEHF: 'Feeder Stripe with Elastane Half Feeder',
};
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const TIERS = ['black', 'dark_navy', 'light_medium', 'neon', 'white_melange'];

function parse() {
  const macros = {}, items = [];
  let group = null;
  for (const raw of fs.readFileSync(SRC, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('# ')) continue;
    if (line.startsWith('@')) { const [k, ...r] = line.slice(1).split(/\s+/); macros[k] = r.join(' '); continue; }
    if (line.startsWith('## ')) { group = line.slice(3).trim(); continue; }
    const [v, k, d] = line.split(';').map((x) => x.trim());
    const [ka, kb] = k.split(/\s+/).map(Number);
    const dye = (macros[d] || d).split('/').map((h) => h.trim().split(/\s+/).map(Number));
    if (dye.length !== 2 || dye[0].length !== 5 || dye[1].length !== 5) throw new Error('bad dyeing: ' + line);
    const variant = v === '-' ? '' : (SHORT[v] || v);
    const n = (x) => (x > 0 ? x : null);
    const rate = { knit_above30: n(ka), knit_below30: n(kb) };
    TIERS.forEach((t, i) => { rate['dye1_' + t] = n(dye[0][i]); rate['dye2_' + t] = n(dye[1][i]); });
    const m = /elastane (full|half) feeder/i.exec(variant);
    items.push({
      item_key: slug(group) + (variant ? '|' + slug(variant) : ''),
      group_name: group, variant, label: variant ? `${group} — ${variant}` : group,
      elastane: m ? (m[1].toLowerCase() === 'full' ? 'ff' : 'hf') : null,
      stripe: /^engineering stripe/i.test(variant) ? 'engineering' : /^feeder stripe/i.test(variant) ? 'feeder' : null,
      rate,
    });
  }
  const seen = new Set();
  items.forEach((i) => { if (seen.has(i.item_key)) throw new Error('duplicate ' + i.item_key); seen.add(i.item_key); });
  return items;
}
const items = parse();
fs.writeFileSync(OUT, JSON.stringify({
  vendor: { code: 'own', name: 'Factory charge sheet', kind: 'own', currency: 'USD', is_default: true },
  tiers: TIERS, items,
}));
console.log(`${items.length} items, ${new Set(items.map((i) => i.group_name)).size} groups -> ${OUT}`);
