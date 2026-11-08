// Garment cost sheet: reproduces a real buyer quotation, prices from the system, size by size.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cs = require('../engine/domain/cost-sheet');
const { cleanSheet, SheetSaveError } = require('../db/repositories/cost-sheet-repo');
console.log('--- Running Cost Sheet Tests ---');

const all = (v) => [v, v, v, v];
const YEAW7759 = {
  sizes: ['3Y-6Y', '7Y-10Y', '11Y-14Y', '15Y-16Y'], pack_of: 1, loss_method: 'sheet',
  shells: [
    { name: '1st Shell', fabric: 'single_jersey', composition: '80% cotton 20% polyester', gsm: 280, stripe: 'engineering',
      yarns: [{ type: 'us_combed_cotton', count: 30, share_pct: 100, price: 3.55 }], knit_price: 2.25, dye_price: 1.9, finish_price: 1.0, loss_pct: 20, consumption: [0.3, 0.4, 0.48, 0.6] },
    { name: '2nd Shell', fabric: 'lycra_rib_2x2', composition: '95% cotton 5% elastane', gsm: 350,
      yarns: [{ type: 'us_combed_cotton', count: 30, share_pct: 95, price: 3.65 }, { type: 'spandex_70d', share_pct: 5, price: 6 }], knit_price: 0.4, dye_price: 1.9, finish_price: 0.9, loss_pct: 16, consumption: 0.15 },
    { name: '3rd Shell', fabric: 'single_jersey', composition: '100% cotton', gsm: 150,
      yarns: [{ type: 'combed_regular', count: 30, share_pct: 100, price: 3.75 }], knit_price: 0.16, dye_price: 1.9, finish_price: 0.8, loss_pct: 14, consumption: 0.006 },
  ],
  trims: [['Sewing thread', 0.1], ['Brand label', 0.014], ['Care label', 0.017], ['Hanger loop', 0.01], ['Interlining', 0.05], ['Zipper', 0.3]].map(([name, v]) => ({ name, values: all(v) })),
  embellishments: [{ name: 'Print', values: all(0.12) }, { name: 'Embroidery', values: all(0.2) }],
  packaging: [['Hang tag', 0.018], ['Poly bag', 0.042], ['Carton', 0.06], ['Carton sticker', 0.002678], ['Tag pin', 0.001], ['Tissue', 0.001]].map(([name, v]) => ({ name, values: all(v) })),
  testing: 0.03, cm: { smv: 15.53, cpm: 0.06 },
  markups: [{ name: 'CCL commission', pct: 3.3 }, { name: 'SM', pct: 1.2 }, { name: 'Profit', pct: 1.5 }],
};

// the factory's own sheet, typed in: same fabric prices and FOB per size
{
  const r = cs.analyse(YEAW7759);
  assert(r.success, r.error);
  assert.deepStrictEqual(r.shells.map((s) => s.price_per_kg), [10.44, 8.0823, 7.5354]);
  const sheet = [6.664257524, 7.770897524, 8.656209524, 9.984177524];
  r.per_size.forEach((p, k) => assert(Math.abs(p.fob_pc - sheet[k]) < 0.0005, `${p.size}: ${p.fob_pc} vs ${sheet[k]}`));
  assert.strictEqual(r.per_size[0].cm, 0.9318);
  // the exact loss form costs more, never less
  const e = cs.analyse({ ...YEAW7759, loss_method: 'exact' });
  assert(e.per_size.every((p, k) => p.fob_pc > r.per_size[k].fob_pc));
  assert.strictEqual(e.shells[0].price_per_kg, 10.875);
}

// nothing typed: every conversion price comes from the system and says so
{
  const r = cs.analyse({ sizes: ['S', 'M'], shells: [{ name: 'Body', fabric: 'single_jersey', composition: '100% cotton', gsm: 160, shade: 'dark_navy', yarns: [{ type: 'combed_regular', count: 30, share_pct: 100 }], consumption: [0.2, 0.22] }], cm: { direct: 0.9 } });
  assert(r.success, r.error);
  const p = r.shells[0].prices;
  for (const k of ['knitting', 'dyeing', 'finishing', 'loss_pct']) assert.strictEqual(p[k].source.kind, 'system', `${k} from the system`);
  assert(p.knitting.value > 0 && p.dyeing.value > 0 && p.loss_pct.value > 5);
  assert(r.per_size[1].fob_pc > r.per_size[0].fob_pc, 'bigger size, more fabric, higher FOB');
}

// order booking, target, sensitivity, warnings
{
  const r = cs.analyse({ ...YEAW7759, order: { quantity: 10000, ratio: [1, 2, 2, 1] }, target_fob: [6.8, 7.7, 8.7, 10] });
  assert.strictEqual(r.order.pieces_by_size.reduce((t, p) => t + p.pieces, 0), 10000);
  const f = r.order.fabric[0];
  assert(Math.abs(f.grey_kg - f.finished_kg / 0.8) < 0.05, 'grey = finished ÷ (1 − loss)');
  assert(r.per_size[1].target_gap < 0 && r.per_size[0].target_gap > 0, 'over target is negative');
  assert(r.sensitivity.find((s) => s.label === 'Yarn +10%').per_size.every((v) => v > 0));
  const w = cs.analyse({ ...YEAW7759, sizes: [...YEAW7759.sizes, '17Y'] });
  assert(w.warnings.some((t) => /no consumption for 17Y/.test(t)), 'a size with no consumption is named');
}

// refusals and saving
{
  const bad = (patch, re) => { const r = cs.analyse({ ...YEAW7759, ...patch }); assert(!r.success && re.test(r.error), `${JSON.stringify(patch).slice(0, 60)} → ${r.error}`); };
  bad({ sizes: [] }, /at least one size/);
  bad({ sizes: ['S', 's'] }, /named once/);
  bad({ shells: [{ ...YEAW7759.shells[0], yarns: [{ type: 'combed_regular', count: 30, share_pct: 90 }] }] }, /add up to 90%/);
  bad({ markups: [{ name: 'x', pct: 100 }] }, /100% or more/);
  assert.throws(() => cleanSheet({ name: '', sheet: {} }), SheetSaveError);
  assert.throws(() => cleanSheet({ name: 'x', sheet: { sizes: ['S'], shells: [], picture: 'javascript:alert(1)' } }), /JPEG, PNG or WebP/);
  assert(cleanSheet({ name: ' YEAW7759 ', sheet: { sizes: ['S'], shells: [], picture: 'data:image/jpeg;base64,AAAA' } }).name === 'YEAW7759');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/038_cost_sheets.sql'), 'utf8');
  assert(/UNIQUE INDEX uq_cost_sheets_name ON cost_sheets \(user_id, lower\(name\)\)/.test(sql));
}
// CM from manual SMV ÷ efficiency, a typed CM wins for its size; profit in money and margins
{
  const r = cs.analyse({ ...YEAW7759, cm: { smv: [12, 12, 12, 14], cpm: 0.05, efficiency_pct: 60, override: ['', '', 1.5, ''] },
    markups: [{ name: 'Buying agent', kind: 'commission', pct: 4 }, { name: 'Profit', kind: 'profit', pct: 10 }], target_fob: [7, 8, 9, 10] });
  assert.deepStrictEqual(r.per_size.map((p) => p.cm), [1, 1, 1.5, 1.1667]);
  assert.deepStrictEqual(r.cm.basis, ['smv', 'smv', 'typed', 'smv']);
  const p = r.per_size[0];
  assert(Math.abs(p.commission + p.profit - (p.fob_pc - p.subtotal)) < 0.0002, 'commission + profit = the whole mark-up');
  assert(Math.abs(p.profit / p.subtotal - 0.10) < 0.0005 && Math.abs(p.profit_margin_pct - p.profit / p.fob_pc * 100) < 0.01);
  assert(Math.abs(p.factory_net - (p.fob_pc - p.commission)) < 0.0002);
  // the profit % it reports for the target really lands on the target
  const q = cs.analyse({ ...YEAW7759, cm: { smv: [12, 12, 12, 14], cpm: 0.05, efficiency_pct: 60, override: ['', '', 1.5, ''] },
    markups: [{ name: 'Buying agent', kind: 'commission', pct: 4 }, { name: 'Profit', kind: 'profit', pct: p.profit_pct_at_target }] });
  assert(Math.abs(q.per_size[0].fob_pc - 7) < 0.002, `profit at target lands on 7.00: ${q.per_size[0].fob_pc}`);
  const bad = cs.analyse({ ...YEAW7759, cm: { smv: 12, cpm: 0.05, efficiency_pct: 5 } });
  assert(!bad.success && /efficiency/.test(bad.error));
}

// yarns by role: a fleece is face + binder + loop, an elastane rib is cotton + spandex,
// each priced at its own count and share, and the shares make 100 %
{
  const plan = (fabric, gsm, composition) => {
    const r = cs.analyse({ sizes: ['M'], shells: [{ name: 'B', fabric, gsm, composition, yarn_mode: 'auto', consumption: 0.3 }], cm: { override: 1 } });
    assert(r.success, r.error);
    const s = r.shells[0];
    assert(Math.abs(s.yarns.reduce((t, y) => t + y.share_pct, 0) - 100) < 0.6, `${fabric}: shares add to 100`);
    assert(Math.abs(s.prices.yarn.value - s.yarns.reduce((t, y) => t + y.price * y.share_pct / 100, 0)) < 0.001, 'blend price = Σ share × price');
    return s;
  };
  const f = plan('fleece_3_thread', 320, '80% cotton 20% polyester');
  assert.deepStrictEqual(f.yarns.map((y) => y.role), ['face', 'binder', 'loop']);
  assert(/filament/.test(f.yarns[1].type), 'a CVC fleece binds with polyester filament');
  assert(f.yarns[2].count < f.yarns[0].count, 'the loop yarn is coarser than the face');
  assert(f.yarns[0].count >= 24, 'the knitting tier follows the face count, not the loop');
  const two = plan('fleece_2_thread', 280, '100% cotton');
  assert.deepStrictEqual(two.yarns.map((y) => y.role), ['face', 'loop']);
  const rib = plan('lycra_rib_2x2', 350, '95% cotton 5% elastane');
  assert.deepStrictEqual(rib.yarns.map((y) => [y.role, y.share_pct]), [['ground', 95], ['elastane', 5]]);
  assert(/spandex_40d/.test(rib.yarns[1].type), 'a double-knit rib takes 40D');
  const cvc = plan('single_jersey', 160, '60% cotton 40% polyester');
  assert.strictEqual(cvc.yarns[0].type, 'cvc_60_40');
  const terry = plan('terry_fabric', 400, '100% cotton');
  assert.deepStrictEqual(terry.yarns.map((y) => y.role), ['ground', 'pile']);
}

// the PDF is drawn from the same result
{
  const r = cs.analyse(YEAW7759);
  const doc = require('../engine/domain/cost-sheet-pdf').render(r, YEAW7759);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    const buf = Buffer.concat(chunks);
    assert(buf.slice(0, 4).toString() === '%PDF' && buf.length > 4000, 'a real PDF');
    console.log('Cost sheet tests passed');
  });
  doc.end();
}
