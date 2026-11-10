// Studio accuracy audit: every factory record through the Fabric Studio, predicted vs measured GSM and open width.
// In-sample (the same records calibrate the constants): an upper bound on how well it fits, not an independent test.
// Run: node tools/studio-audit.js
const B = require('path').join(__dirname, '..') + '/';
const S = require(B + 'engine/domain/fabric-studio');
const { FACTORY_RECORDS: R } = require(B + 'engine/catalog/factory-dataset');
const T = S.listTemplates();
const rows = (g) => g.map((r) => (r.join ? r.join('') : r));
const tpl = (id) => T.find((x) => x.id === id);
const FIB = { cotton: 'cotton', cvc: 'cvc', pc: 'polyester_spun', viscose: 'viscose', modal: 'modal' };
const SPIN = { slub: 'carded', combed: 'combed', combed_lycra: 'combed', carded: 'carded', carded_lycra: 'carded', rotor: 'open_end', compact: 'compact' };
const pick = (r) => {
  if (r.fab === 'single_jersey') return 'single_jersey';
  if (r.fab === 'heavy_jersey') return 'heavy_jersey';
  if (r.fab === 'rib') return r.fdia / r.dia < 1.6 ? 'rib_2x2' : 'rib_1x1';
  if (r.fab === 'pique') return 'lacoste_single';
  if (r.fab === 'interlock') return 'interlock';
  if (r.fab === 'fleece') return 'fleece_3_thread';
  if (r.fab === 'waffle') return 'waffle_knit';
  return null;
};
const res = {};
let errors = 0;
for (const r of R) {
  const id = pick(r); if (!id || !(r.sl > 0 && r.ne > 0 && r.fgsm > 0)) continue;
  const t = tpl(id); if (!t) continue;
  const lycra = /lycra/.test(r.spin);
  let o;
  try {
    o = S.analyse({ bed: t.grid.D ? 'double' : 'single', gating: t.gating || 'rib', grid: { C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null },
      feeds: t.roles.map((role) => ({ role })), yarn: { count: r.ne, unit: 'ne', ply: id === 'heavy_jersey' ? 2 : 1, fibre: FIB[r.comp] || 'cotton', type: SPIN[r.spin] || 'combed' },
      elastane: lycra ? { denier: 40, draft: 2.6, every: 'all' } : null,
      machine: { gauge: r.g, dia: r.dia, sl_mm: r.sl }, target: {} });
  } catch (e) { errors++; continue; }
  if (!o.success) { errors++; continue; }
  const k = id + (lycra ? '+L' : '');
  const a = (res[k] = res[k] || { gsm: [], w: [], n: 0 });
  a.n++;
  a.gsm.push((o.fabric.gsm - r.fgsm) / r.fgsm * 100);
  if (r.fdia > 0) a.w.push((o.fabric.width_open_in - r.fdia) / r.fdia * 100);
}
const med = (x) => { const s = x.map(Math.abs).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p90 = (x) => { const s = x.map(Math.abs).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length * 0.9)] : null; };
const bias = (x) => x.length ? x.reduce((t, v) => t + v, 0) / x.length : null;
const f = (v) => (v == null ? '—' : v.toFixed(1));
console.log('family'.padEnd(20), 'n'.padStart(5), 'GSM med|err|', 'p90', 'bias', '  WIDTH med', 'p90', 'bias');
for (const [k, a] of Object.entries(res).sort()) console.log(k.padEnd(20), String(a.n).padStart(5), f(med(a.gsm)).padStart(8), f(p90(a.gsm)).padStart(6), f(bias(a.gsm)).padStart(6), f(med(a.w)).padStart(10), f(p90(a.w)).padStart(6), f(bias(a.w)).padStart(6));
console.log('refused/thrown', errors);
