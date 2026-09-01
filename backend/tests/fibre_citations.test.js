const assert = require('assert');
const book = require('../data/fibre-properties.json');
const { FIBER_PROPERTIES: F } = require('../engine/domain/yarn-engine');

console.log('--- Running Fibre Citation Tests ---');

// ============================================================================
// Every figure on the engine's fibre table, checked back against the extraction
// it claims to come from.
//
// This suite exists because of how the numbers get there. The extractor is
// gated to death — 81 checks, sabotage-proven — and then the values are TYPED
// into yarn-engine.js by hand, and a typed citation is one that can quietly
// stop being true. `work_of_rupture` sat in the database for four chapters
// before anything used it; the reverse failure, a figure in the engine that no
// longer matches the page it names, would be worse, because it would be used.
//
// Nothing here re-checks the book. It checks that the engine and the extraction
// still agree about what the book says.
// ============================================================================

const span = r => (r.value != null ? r.value : [r.value_min, r.value_max]);
const same = (a, b) => JSON.stringify(Array.isArray(a) ? a : [a]) ===
                       JSON.stringify(Array.isArray(b) ? b : [b]);

// Some rows carry a row-condition in front of the column one — "across 3 types,
// 65% r.h., 20 C" — so match on the tail.
// The PAGE is part of the citation and has to be part of the lookup. Nylon has
// a tenacity on p.290 (Table 13.1, the 1945 survey) and another on p.292 (Table
// 13.2, nylon 6.6 medium-tenacity), 0.47 and 0.48, both at 65% r.h. Matching on
// fibre and property alone finds whichever comes first and then reports a drift
// that is really just the wrong row — which would train a reader to ignore this
// suite.
const find = (slug, prop, cond, page) => {
  const r = book.properties.find(p => p.fibre_slug === slug && p.property === prop &&
    (page === undefined || p.page === page) &&
    (cond === undefined || (p.condition || '').endsWith(cond)));
  return r ? span(r) : null;
};

// The engine's key and the book's slug are not always the same word: the engine
// calls it `linen` and the extraction files it under `flax`, which is the name
// printed on the page. The mapping is already in the data — every fibre row
// carries the engine key it answers to — so it is read from there rather than
// duplicated here, where it could drift.
const slugFor = key => {
  const f = book.fibres.find(x => x.engine_key === key);
  return f ? f.slug : key;
};

let checked = 0;
const cite = (slug, label, engineVal, bookVal) => {
  if (engineVal == null && bookVal == null) return;
  checked++;
  assert(same(engineVal, bookVal),
    `${slug} ${label}: engine has ${JSON.stringify(engineVal)}, the extraction has ` +
    `${JSON.stringify(bookVal)} — one of them has drifted`);
};

for (const [engineKey, row] of Object.entries(F)) {
  const key = slugFor(engineKey);
  // ── Chapter 13: tensile ───────────────────────────────────────────────
  if (row.tensile) {
    const t = row.tensile;
    cite(key, 'tenacity', t.tenacity, find(key, 'tenacity', '65% r.h., 20 C', t.page));
    cite(key, 'breaking extension', t.extension, find(key, 'breaking_extension', '65% r.h., 20 C', t.page));
    cite(key, 'initial modulus', t.modulus, find(key, 'initial_modulus', '65% r.h., 20 C', t.page));
    cite(key, 'work of rupture', t.work_of_rupture, find(key, 'work_of_rupture', '65% r.h., 20 C', t.page));
  }

  // ── Chapter 17: bending, twisting, the loop ───────────────────────────
  if (row.directional) {
    const d = row.directional;
    cite(key, 'flexural rigidity', d.flexural,
         find(key, 'specific_flexural_rigidity', '65% r.h., 20 C', d.page));
    cite(key, 'torsional rigidity', d.torsional,
         find(key, 'specific_torsional_rigidity', '65% r.h., 20 C', d.page));
    if (d.loop_strength_pct != null) {
      // Two workers report loop strength; the engine takes one of them and it
      // has to be one the book actually prints.
      const loops = book.properties
        .filter(p => p.fibre_slug === key && p.property === 'loop_strength_pct')
        .map(p => p.value);
      assert(loops.includes(d.loop_strength_pct),
        `${key} loop strength: engine has ${d.loop_strength_pct}, the book prints ${loops.join(' and ')}`);
      checked++;
    }
  }

  // ── Chapter 16: repeated loading ──────────────────────────────────────
  if (row.cyclic) {
    cite(key, 'growth by cycle 10', row.cyclic.growth_10,
         find(key, 'cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension'));
    cite(key, 'growth by cycle 1000', row.cyclic.growth_1000,
         find(key, 'cyclic_extension_growth_pct', 'by cycle 1000, at 2% imposed extension'));
  }

  // ── Chapter 6: heat ───────────────────────────────────────────────────
  if (row.thermal) {
    const e = book.properties.find(p => p.fibre_slug === key &&
      p.property === 'linear_expansion_axial');
    cite(key, 'linear expansion', row.thermal.expansion_1e4_per_c, e ? span(e) : null);
    cite(key, 'thermal conductivity', row.thermal.conductivity_mw_mk,
         find(key, 'thermal_conductivity', 'pad at 0.5 g/cm3 bulk density'));
  }

  // ── Chapter 15: recovery ──────────────────────────────────────────────
  if (row.recovery) {
    for (const [branch, rh] of [['rh60', 60], ['rh90', 90]]) {
      for (const [field, ext] of [['e1', 1], ['e5', 5], ['e10', 10]]) {
        const r = book.properties.find(p => p.fibre_slug === key &&
          p.property === 'elastic_recovery' && p.rh_pct === rh &&
          (p.condition || '').startsWith(`from ${ext}% `));
        cite(key, `recovery ${branch} ${field}`, row.recovery[branch][field],
             r ? r.value : null);
      }
    }
  }

  // ── Chapter 7: the two regains ────────────────────────────────────────
  if (row.regain_detail) {
    const rd = row.regain_detail;
    cite(key, 'commercial regain', rd.commercial,
         find(key, 'commercial_regain', 'conventional allowance'));
    cite(key, 'measured regain', rd.measured, find(key, 'moisture_regain', '65% r.h.'));
    cite(key, 'hysteresis', rd.hysteresis, find(key, 'regain_hysteresis', '65% r.h.'));
  }

  // ── Chapter 18: heat ──────────────────────────────────────────────────
  if (row.heat) {
    cite(key, 'melting point', row.heat.melting_c, find(key, 'melting_point'));
    cite(key, 'strength retained at 130 C for 80 days', row.heat.retained_130c_80d,
         find(key, 'strength_retained_pct', 'after 80 days at 130 C'));
  }

  // ── Chapters 8, 10 and 19: heat released, water left, bends survived ──
  if (row.moisture_energy) {
    const m = row.moisture_energy;
    cite(key, 'heat of sorption', m.heat_40_70_kj_kg,
         find(key, 'heat_of_sorption', 'going from 40% to 70% r.h.'));
    // Wool's retention is measured on loose fibre, so its condition carries a
    // prefix the others do not have.
    const spunCond = key === 'wool'
      ? 'loose fibre, after centrifuging at 1000g for 5 min'
      : 'after centrifuging at 1000g for 5 min';
    const suckCond = key === 'wool'
      ? 'loose fibre, after suction at 30 cm Hg (40 kPa)'
      : 'after suction at 30 cm Hg (40 kPa)';
    cite(key, 'water retained, spun', m.retained_spun_pct, find(key, 'water_retained', spunCond));
    cite(key, 'water retained, sucked', m.retained_sucked_pct, find(key, 'water_retained', suckCond));
    cite(key, 'flex fatigue life', m.flex_life_cycles,
         find(key, 'flex_fatigue_life', 'mean, 65% r.h., 20 C'));
  }

  // ── Chapter 22: static ────────────────────────────────────────────────
  if (row.static) {
    cite(key, 'static threshold', row.static.rh_threshold,
         find(key, 'rh_for_static_threshold',
              'r.h. at which resistance reaches 1e10 ohm g/m2'));
    cite(key, 'log resistance at 65% r.h.', row.static.log_resistance_65,
         find(key, 'log_resistance', '65% r.h.'));
  }

  // ── Chapter 15: the yield point ───────────────────────────────────────
  if (row.yield_point) {
    cite(key, 'yield stress', row.yield_point.stress_mn_tex,
         find(key, 'yield_stress', 'yield point from the recovery curve'));
    cite(key, 'yield strain', row.yield_point.strain_pct,
         find(key, 'yield_strain', 'yield point from the recovery curve'));
  }
}

// Every cited page must be inside the book, and must be the page the property
// actually sits on rather than the fibre's own definition page.
for (const [key, row] of Object.entries(F)) {
  for (const [block, obj] of Object.entries(row)) {
    if (!obj || typeof obj !== 'object' || obj.page == null) continue;
    assert(obj.page >= 1 && obj.page <= 746,
      `${key}.${block} cites p.${obj.page}, which is outside the book`);
    assert(typeof obj.table === 'string' && /Tables?\s/.test(obj.table),
      `${key}.${block} cites p.${obj.page} with no table`);
  }
}

console.log(`  ${checked} engine figures re-checked against the extraction`);
console.log('\n✓ All fibre citation tests passed.');
