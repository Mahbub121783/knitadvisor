/**
 * KnitAdvisor — reverse engineering a knitted fabric from its loops.
 *
 * Input is what a scan (or a counting glass) measures on the finished face:
 * wales per cm and courses per cm, the structure, and — if the swatch was
 * weighed — its GSM. Output is how to knit it again: stitch length, yarn
 * count, gauge, tightness, and how the cloth was finished.
 *
 * The constants are the factory's own, fitted on 2,201 greige → finish
 * records (knit-plan.js CAL):
 *   Kw = wales/cm × ℓ          → ℓ = Kw ÷ wales/cm                  (measured constant)
 *   Ks = 10 × GSM × ℓ ÷ tex    → tex = 10 × GSM × ℓ ÷ Ks            (measured constant)
 *   tightness factor = √tex ÷ ℓ, its factory window per family    (used only when GSM is unknown)
 * ℓ in cm. Every output says whether it was measured, calculated from a
 * measurement with a factory constant, or estimated from a typical value.
 */
'use strict';

const KP = require('./knit-plan');
const { FACTORY_RECORDS } = require('../catalog/factory-dataset');
const { parseComposition } = require('./composition-engine');

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const quant = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; };

const STRUCTURES = {
  single_jersey: { fam: 'single_jersey', fabric: 'single_jersey', label: 'Single jersey', beds: 1, count: true },
  pique:         { fam: 'pique', fabric: 'lacoste_single', label: 'Piqué / lacoste', beds: 1, count: true },
  rib:           { fam: 'rib', fabric: 'rib_1x1', label: '1×1 rib', beds: 2, count: true },
  interlock:     { fam: 'interlock', fabric: 'interlock', label: 'Interlock', beds: 2, count: true },
  fleece:        { fam: 'fleece', fabric: 'fleece_3_thread', label: 'Fleece (3-thread)', beds: 1, count: false },
  terry:         { fam: 'terry', fabric: 'french_terry', label: 'French terry', beds: 1, count: false },
};
const NE_STEPS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 45, 50, 60, 70, 80];

// the tightness-factor window each family is finished at (√tex ÷ ℓcm)
const TF = (() => {
  const by = {};
  for (const r of FACTORY_RECORDS) if (r.ne > 0 && r.sl > 0) (by[r.fab] = by[r.fab] || []).push(Math.sqrt(590.5 / r.ne) / (r.sl / 10));
  return Object.fromEntries(Object.entries(by).map(([k, a]) => [k, { med: quant(a, 0.5), q1: quant(a, 0.25), q3: quant(a, 0.75), n: a.length }]));
})();

// fibre: the same loop sits differently in polyester or viscose (single-jersey records against cotton)
const FIBRE = (() => {
  const by = { ks: {}, kw: {} };
  for (const r of FACTORY_RECORDS) {
    if (r.fab !== 'single_jersey' || /lycra/i.test(String(r.spin || ''))) continue;
    if (r.sl > 0 && r.ne > 0 && r.fgsm > 0) (by.ks[r.comp] = by.ks[r.comp] || []).push(10 * r.fgsm * (r.sl / 10) / (590.5 / r.ne));
    if (r.g > 0 && r.dia > 0 && r.sl > 0 && r.fdia > 0) (by.kw[r.comp] = by.kw[r.comp] || []).push(Math.PI * r.dia * r.g * (r.sl / 10) / (r.fdia * 2.54));
  }
  const med = (a) => quant(a, 0.5), out = {};
  for (const c of Object.keys(by.ks)) {
    if (by.ks[c].length >= 8 && (by.kw[c] || []).length >= 8 && by.ks.cotton) out[c] = { ks: med(by.ks[c]) / med(by.ks.cotton), kw: med(by.kw[c]) / med(by.kw.cotton), n: by.ks[c].length };
  }
  return out;
})();
function fibreOf(composition) {
  const p = parseComposition(composition || '100% cotton');
  const f = (p && p.fibers) || { cotton: 100 };
  const poly = f.polyester || 0, visc = (f.viscose || 0) + (f.modal || 0) + (f.bamboo || 0);
  const key = poly >= 50 ? 'pc' : poly >= 15 ? 'cvc' : visc >= 50 ? 'viscose' : 'cotton';
  const el = p && p.elastane_pct ? +p.elastane_pct : 0;
  const fac = key === 'cotton' ? { ks: 1, kw: 1, n: null } : FIBRE[key] || { ks: 1, kw: 1, n: 0 };
  return { key, elastane: el, ks: fac.ks, kw: fac.kw, basis: key === 'cotton' ? 'cotton reference' : fac.n ? `${fac.n} factory ${key} single-jersey records against cotton` : `no ${key} records — cotton constants (estimate)` };
}

function nearestNe(ne) { return NE_STEPS.reduce((b, v) => (Math.abs(v - ne) < Math.abs(b - ne) ? v : b), NE_STEPS[0]); }
function gaugeFor(fam, lycra, ne) {
  const list = KP.CAL.gauges[`${fam}|${lycra ? 'L' : 'P'}`] || KP.CAL.gauges[`${fam}|P`] || [];
  let near = [];
  for (const w of [1, 2, 4, 6, 10]) { near = list.filter((r) => Math.abs(r.ne - ne) <= w); if (near.length >= 6) break; }
  if (near.length < 4) return null;
  const c = {}; near.forEach((r) => { c[r.g] = (c[r.g] || 0) + 1; });
  const [g, n] = Object.entries(c).sort((x, y) => y[1] - x[1])[0];
  return { gauge: +g, share_pct: Math.round(n / near.length * 100), n: near.length, basis: `${near.length} factory fabrics of ${fam.replace('_', ' ')} near ${Math.round(ne)}s` };
}

class ReverseError extends Error {}

/**
 * @param {{structure, wpc, cpc?, gsm?, composition?, colour_hex?, confidence?}} m
 */
function reverse(m) {
  const S = STRUCTURES[m.structure];
  if (!S) throw new ReverseError('Choose the structure: single jersey, piqué, rib, interlock, fleece or terry.');
  const wpc = +m.wpc, cpc = m.cpc != null ? +m.cpc : null;
  if (!(wpc >= 4 && wpc <= 40)) throw new ReverseError('Wales per cm must be between 4 and 40.');
  if (cpc != null && !(cpc >= 4 && cpc <= 60)) throw new ReverseError('Courses per cm must be between 4 and 60.');
  const gsm = m.gsm != null && m.gsm !== '' ? +m.gsm : null;
  if (gsm != null && !(gsm >= 60 && gsm <= 700)) throw new ReverseError('GSM must be between 60 and 700.');

  const fib = fibreOf(m.composition);
  const lycra = fib.elastane > 0;
  const KW = KP.calFor('kw', S.fam, lycra), KS = KP.calFor('ks', S.fam, lycra);
  const kw = { med: KW.med * fib.kw, q1: KW.q1 * fib.kw, q3: KW.q3 * fib.kw };
  const ks = { med: KS.med * fib.ks, q1: KS.q1 * fib.ks, q3: KS.q3 * fib.ks };
  const notes = [];

  // stitch length from the wales: the factory's own wales × loop-length constant
  const l = kw.med / wpc, lLo = kw.q1 / wpc, lHi = kw.q3 / wpc;           // cm
  const out = {
    structure: m.structure, label: S.label, fabric_id: S.fabric,
    measured: { wpc: r2(wpc), cpc: cpc != null ? r2(cpc) : null, density: cpc != null ? r1(wpc * cpc) : null, gsm: gsm != null ? gsm : null },
    stitch_length: { mm: r3(l * 10), range: [r3(lLo * 10), r3(lHi * 10)], source: 'calculated', basis: `Kw ${r2(kw.med)} (${KW.basis}${fib.kw !== 1 ? ', ' + fib.basis : ''}) ÷ ${r2(wpc)} wales/cm` },
    fibre: { key: fib.key, elastane_pct: fib.elastane || 0, basis: fib.basis },
    notes,
  };

  let tex = null, texLo = null, texHi = null, gsmEst = null;
  if (S.count) {
    if (gsm != null) {
      tex = 10 * gsm * l / ks.med; texLo = 10 * gsm * lLo / ks.q3; texHi = 10 * gsm * lHi / ks.q1;
      out.count = { ne: r1(590.5 / tex), nearest: nearestNe(590.5 / tex), range: [r1(590.5 / texHi), r1(590.5 / texLo)], source: 'calculated',
        basis: `tex = 10 × ${gsm} GSM × ℓ ÷ Ks ${r1(ks.med)} (${KS.basis})` };
      out.gsm = { value: gsm, source: 'measured' };
    } else {
      const T = TF[S.fam] || TF.single_jersey;
      tex = Math.pow(T.med * l, 2); texLo = Math.pow(T.q1 * lLo, 2); texHi = Math.pow(T.q3 * lHi, 2);
      gsmEst = ks.med * tex / (10 * l);
      out.count = { ne: r1(590.5 / tex), nearest: nearestNe(590.5 / tex), range: [r1(590.5 / texHi), r1(590.5 / texLo)], source: 'estimated',
        basis: `the factory's usual tightness for ${S.label.toLowerCase()} (${r1(T.q1)}–${r1(T.q3)}, ${T.n} fabrics) — weigh the swatch to calculate it instead` };
      out.gsm = { value: Math.round(gsmEst), range: [Math.round(ks.q1 * texLo / (10 * lLo)), Math.round(ks.q3 * texHi / (10 * lHi))].sort((a, b) => a - b), source: 'estimated',
        basis: 'from the loop density and the usual yarn — a GSM cutter and a scale make it exact' };
      notes.push('GSM and count are estimates until the swatch is weighed: cut a 100 cm² disc and enter its weight × 100.');
    }
    const tf = Math.sqrt(tex) / l, T = TF[S.fam] || TF.single_jersey;
    out.tightness = { tf: r1(tf), window: [r1(T.q1), r1(T.q3)], verdict: tf < T.q1 * 0.97 ? 'slack' : tf > T.q3 * 1.03 ? 'tight' : 'normal', source: gsm != null ? 'calculated' : 'estimated' };
    const g = gaugeFor(S.fam, lycra, 590.5 / tex);
    if (g) out.gauge = { value: g.gauge, share_pct: g.share_pct, source: 'factory practice', basis: g.basis };
  } else {
    notes.push(`${S.label}: the weight includes the loop yarn, so the count cannot be read from GSM here — open the full analysis, which solves face, binder and loop yarns.`);
    if (gsm != null) out.gsm = { value: gsm, source: 'measured' };
  }

  // course density against the factory's finished cloth: how the cloth was finished
  if (cpc != null && S.count) {
    const expectS = ks.med / (S.beds * l * l), seen = wpc * cpc, d = seen / expectS - 1;
    out.finish = { compaction_pct: r1(d * 100), verdict: d > 0.08 ? 'more compact lengthwise than factory-finished cloth (heavily compacted, or shrunk)' : d < -0.08 ? 'longer than factory-finished cloth (stretched, or not relaxed — expect length shrinkage)' : 'in line with factory-finished cloth', source: 'calculated' };
    if (m.structure === 'pique' || m.structure === 'fleece' || m.structure === 'terry') out.finish.note = 'tuck and loop structures make the course count uncertain — read this loosely';
  }
  if (m.confidence === 'low') notes.push('The scan was not sharp or regular enough for a high-confidence count — results carry that uncertainty.');

  // ready for the full calculator (cost, CO₂, process, 3D)
  out.full_params = {
    fabric: S.fabric, gsm: Math.round(gsm != null ? gsm : gsmEst || 180), composition: m.composition || '100% Cotton',
    stitch_length: r2(l * 10), gauge: out.gauge ? out.gauge.value : undefined, color_input: /^#[0-9a-f]{6}$/i.test(m.colour_hex || '') ? m.colour_hex : undefined,
  };
  Object.keys(out.full_params).forEach((k) => out.full_params[k] === undefined && delete out.full_params[k]);
  return out;
}

/**
 * How well the constants give back the factory's own fabrics: for every
 * record, wales/cm from its machine and finished width, then stitch length
 * and count from the reverse engine, against what was knitted.
 */
function selfCheck() {
  const rows = { single_jersey: [], pique: [], rib: [], interlock: [] };
  for (const r of FACTORY_RECORDS) {
    if (!rows[r.fab] || !(r.g > 0 && r.dia > 0 && r.sl > 0 && r.fdia > 0 && r.fgsm > 0 && r.ne > 0)) continue;
    if (r.fab === 'rib' && r.fdia / r.dia < 1.6) continue;           // 2x2 set-outs: a different needle basis
    if (/lycra/i.test(String(r.spin || ''))) continue;
    const wpc = Math.PI * r.dia * r.g / (r.fdia * 2.54);
    if (!(wpc >= 4 && wpc <= 40)) continue;
    let o;
    try { o = reverse({ structure: r.fab, wpc, gsm: r.fgsm, composition: r.comp === 'cotton' ? '100% cotton' : r.comp === 'cvc' ? '60% cotton 40% polyester' : r.comp === 'pc' ? '65% polyester 35% cotton' : '100% cotton' }); } catch (_) { continue; }
    rows[r.fab].push({ sl: Math.abs(o.stitch_length.mm / r.sl - 1), ne: Math.abs(o.count.ne - r.ne), nePct: Math.abs(o.count.ne / r.ne - 1) });
  }
  const out = {};
  for (const [k, a] of Object.entries(rows)) {
    if (!a.length) continue;
    out[k] = { n: a.length, stitch_length_median_err_pct: r1(quant(a.map((x) => x.sl), 0.5) * 100), stitch_length_p80_err_pct: r1(quant(a.map((x) => x.sl), 0.8) * 100),
      count_median_err_ne: r1(quant(a.map((x) => x.ne), 0.5)), count_p80_err_ne: r1(quant(a.map((x) => x.ne), 0.8)), count_median_err_pct: r1(quant(a.map((x) => x.nePct), 0.5) * 100) };
  }
  return out;
}

module.exports = { reverse, selfCheck, STRUCTURES, ReverseError };
