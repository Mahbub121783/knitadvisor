/**
 * ============================================================================
 * YARN NOWCAST — bringing an old quote forward by what its fibre has done since
 * ============================================================================
 *
 * A yarn price is mostly the fibre inside it. A kilogram of ring carded yarn
 * holds about 1.08 kg of cotton lint (blowroom, card and flat waste); a kilogram
 * of combed yarn about 1.25 kg (the comber takes the short fibre out). Those are
 * the same mass balances the carbon footprint uses, from the same table. So when
 * the last quote is weeks old, the move since then is not guessed — it is the
 * change in the fibre benchmark, times the kilograms of fibre in a kilogram of
 * yarn, times the fibre's share of the blend:
 *
 *     Δ yarn ($/kg) = Σ  share(fibre) × kg fibre per kg yarn × Δ fibre ($/kg)
 *
 * Cotton moves with the international cotton benchmark, read on the quote's day
 * and today. Polyester has no free daily fibre price, so its move is MODELLED
 * from crude oil: the staple's price is taken to move by 0.45 of crude's
 * relative change (polyester is made from PTA and MEG, which follow oil with a
 * damped swing), on a staple-fibre level of about $1.05/kg. Fibres with no free
 * benchmark at all — viscose, modal, lyocell, nylon, elastane, ELS cotton — are
 * carried at their quoted price, and the result says which parts moved.
 *
 * It never replaces a quote. It moves one, and reports the move beside it.
 * Pure: the benchmark levels are handed in, so tests and scripts need no network.
 */
'use strict';

const CM = require('../catalog/carbon-model');

const POLY = {
  staple_usd_kg: 1.05,          // polyester staple fibre, Asia, 2026 (MODELLED)
  filament_usd_kg: 1.35,        // polyester filament chip-to-yarn base (MODELLED)
  oil_elasticity: 0.45,         // relative move of the fibre per relative move of crude (MODELLED, 0.3-0.6)
};
const kgPerKg = (w) => 1 / (1 - w);

/** What a kilogram of this yarn holds, by benchmarked fibre: [{fibre, share, kg_per_kg_yarn, spin}] */
function fibreMix(row) {
  if (!row) return [];
  const f = String(row.fiber || ''), combed = row.type === 'combed', W = CM.MILL.spin_waste;
  const cot = (share, sys) => ({ fibre: 'cotton', share, kg_per_kg_yarn: kgPerKg(W[sys].central), spin: sys });
  const pol = (share) => ({ fibre: 'polyester', share, kg_per_kg_yarn: kgPerKg(W.synthetic.central), spin: 'synthetic staple' });
  if (f === 'cotton') return [cot(1, combed ? 'combed' : 'carded')];
  const blend = { cvc_60_40: [0.6, 0.4], cvc_80_20: [0.8, 0.2], cvc_50_50: [0.5, 0.5], pc_65_35: [0.35, 0.65] }[f];
  if (blend) return [cot(blend[0], 'carded'), pol(blend[1])];
  if (f === 'cotton_modal' || f === 'cotton_viscose') return [cot(0.5, 'carded')];
  if (f === 'pv') return [pol(0.65)];
  if (f === 'polyester') return [pol(1)];
  if (f === 'filament') return [{ fibre: 'polyester filament', share: 1, kg_per_kg_yarn: 1.02, spin: 'filament' }];
  return [];                                                   // no free benchmark: carried as quoted
}

const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * @param row     the price-matrix row of the yarn (fiber, type)
 * @param sinceISO the quote's date (or the reference list's)
 * @param bench   { levelAt(series, iso), levelNow(series) } — the benchmark store
 * @returns { delta, since, to, parts[], unmoved[] } or null when nothing can be moved
 */
function nowcast(row, sinceISO, bench) {
  if (!bench || typeof bench.levelAt !== 'function' || !sinceISO) return null;
  const mix = fibreMix(row);
  if (!mix.length) return null;
  const parts = [];
  let delta = 0, to = null;
  for (const m of mix) {
    if (m.fibre === 'cotton') {
      const a = bench.levelAt('cotton_usd_kg', sinceISO), b = bench.levelNow('cotton_usd_kg');
      if (!a || !b) continue;
      const d = b.value - a.value, c = m.share * m.kg_per_kg_yarn * d;
      parts.push({ fibre: 'cotton', share: m.share, kg_per_kg_yarn: r4(m.kg_per_kg_yarn), spin: m.spin,
        driver: 'international cotton benchmark', from: a, to: b, fibre_change_usd_kg: r4(d), fibre_change_pct: r4((b.value / a.value - 1) * 100), contribution_usd_kg: r4(c), tier: 'SOURCED' });
      delta += c; to = !to || b.on > to ? b.on : to;
    } else {
      const a = bench.levelAt('brent_usd_bbl', sinceISO), b = bench.levelNow('brent_usd_bbl');
      if (!a || !b) continue;
      const rel = b.value / a.value - 1, base = m.fibre === 'polyester filament' ? POLY.filament_usd_kg : POLY.staple_usd_kg;
      const d = base * POLY.oil_elasticity * rel, c = m.share * m.kg_per_kg_yarn * d;
      parts.push({ fibre: m.fibre, share: m.share, kg_per_kg_yarn: r4(m.kg_per_kg_yarn), spin: m.spin,
        driver: 'crude oil (polyester feedstock)', from: a, to: b, oil_change_pct: r4(rel * 100),
        fibre_change_usd_kg: r4(d), contribution_usd_kg: r4(c), tier: 'MODELLED',
        model: `fibre moves ${POLY.oil_elasticity} × crude's change on a $${base}/kg fibre` });
      delta += c; to = !to || b.on > to ? b.on : to;
    }
  }
  if (!parts.length) return null;
  const covered = parts.reduce((t, p) => t + p.share, 0);
  return { delta: r4(delta), since: sinceISO, to, parts, unmoved_share: r4(Math.max(0, 1 - covered)),
    formula: 'Δ yarn = Σ share × kg fibre per kg yarn × Δ fibre price' };
}

module.exports = { nowcast, fibreMix, POLY };
