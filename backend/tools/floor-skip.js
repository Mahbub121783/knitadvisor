/**
 * Part 6's yardstick — the floor-skip test. Teach the Studio only some families of cloth (floors 1, 2 …), take away
 * everything it could know about the rest (their records AND their book values, which are their own factory
 * medians), and ask it for the rest. This is the question a new structure really asks, and the number Part 6
 * (loop geometry from laws, not from family tables) has to bring down.
 *
 * Scenarios:  jersey only · jersey + rib · each family left out in turn (no book value)
 * Run: node tools/floor-skip.js            (≈ 1 min)
 */
'use strict';
const CV = require('./studio-crossval');
const { FACTORY_RECORDS } = require('../engine/catalog/factory-dataset');

const ALL = FACTORY_RECORDS.slice();
const isL = (r) => /lycra/.test(String(r.spin || ''));
const usable = (r) => CV.templateOf(r) && r.sl > 0 && r.ne > 0 && r.fgsm > 0;
const med = (a) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const w5 = (a) => (a.length ? Math.round((a.filter((v) => Math.abs(v) <= 0.05).length / a.length) * 100) : null);

/** Teach `taught`; predict every usable record of the other families, with their book values taken out. */
function scenario(taught, only) {
  const fams = [...new Set(ALL.filter(usable).map((r) => r.fab))].filter((f) => !taught.includes(f) && (!only || only.includes(f)));
  const by = {};
  for (const fam of fams) {
    // each untaught family is taken out of the book on its own (the others' book values are just as unknown)
    const S = CV.studioFrom(ALL.filter((r) => taught.includes(r.fab)), fam);
    for (const r of ALL.filter((x) => usable(x) && x.fab === fam)) {
      const k = r.fab + (isL(r) ? '+L' : '');
      const b = (by[k] = by[k] || { g: [], w: [] });
      const p = CV.predict(S, r); if (!p) continue;
      b.g.push((p.gsm - r.fgsm) / r.fgsm); if (r.fdia > 0) b.w.push((p.width - r.fdia) / r.fdia);
    }
  }
  CV.restore();
  return Object.fromEntries(Object.entries(by).map(([k, b]) => [k, { n: b.g.length, gsm_err_med: med(b.g), gsm_within_5: w5(b.g), width_err_med: med(b.w), width_within_5: w5(b.w) }]));
}

function run() {
  return {
    jersey_only: scenario(['single_jersey']),
    jersey_and_rib: scenario(['single_jersey', 'rib']),
  };
}
module.exports = { run, scenario };

if (require.main === module) {
  const r = run();
  const p = (v) => (v == null ? '   —  ' : (v * 100).toFixed(1).padStart(5) + '%');
  for (const [name, rows] of Object.entries(r)) {
    console.log(`\n${name.replace(/_/g, ' ').toUpperCase()} — book values of the untaught families taken out`);
    console.log('  family            n    GSM |e|med  ±5%     WIDTH |e|med  ±5%');
    for (const [k, v] of Object.entries(rows).sort()) console.log('  ' + k.padEnd(16), String(v.n).padStart(4), '   ' + p(v.gsm_err_med), String(v.gsm_within_5).padStart(4) + '%', '     ' + p(v.width_err_med), String(v.width_within_5).padStart(4) + '%');
  }
}
