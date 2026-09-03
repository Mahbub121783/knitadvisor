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
//
// A second case, not the same as the first: bamboo has no book slug at all —
// commercial "bamboo fibre" is bamboo pulp run through the ordinary viscose
// process, so its FIBER_PROPERTIES row is viscose's own cited figures, not a
// bamboo entry the book prints under another name. That is declared on the
// engine row itself as `cites_as`, and read from there rather than hardcoded
// here as a bamboo-shaped special case — the same "the mapping lives in the
// data" reasoning as the linen/flax lookup above, just pointed at the engine
// file instead of the extraction one, because this is the engine's claim
// about itself, not a fact about the book.
const slugFor = key => {
  if (F[key] && F[key].cites_as) return F[key].cites_as;
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

    // ── Chapter 13.7: what water does, all four columns ─────────────────
    // These four ratios have been driving the wet-processing advice since the
    // day it shipped and none of them was ever checked back against the page.
    // They are the most consequential numbers in the file — a wrong modulus
    // ratio sends a dyehouse the opposite instruction — so they are checked
    // hardest.
    for (const [branch, cond] of [['wet', 'wet / 65% r.h.'],
                                  ['hot_wet', 'wet 95 C / wet 20 C']]) {
      const b = t[branch];
      if (!b) continue;
      cite(key, `${branch} tenacity ratio`, b.ten, find(key, 'tenacity_ratio', cond, 312));
      cite(key, `${branch} extension ratio`, b.ext,
           find(key, 'breaking_extension_ratio', cond, 312));
      cite(key, `${branch} modulus ratio`, b.mod,
           find(key, 'initial_modulus_ratio', cond, 312));
      cite(key, `${branch} work of rupture ratio`, b.wor,
           find(key, 'work_of_rupture_ratio', cond, 312));
    }
  }

  // ── Chapter 17: bending, twisting, the loop ───────────────────────────
  if (row.directional) {
    const d = row.directional;
    cite(key, 'flexural rigidity', d.flexural,
         find(key, 'specific_flexural_rigidity', '65% r.h., 20 C', d.page));
    cite(key, 'torsional rigidity', d.torsional,
         find(key, 'specific_torsional_rigidity', '65% r.h., 20 C', d.page));
    if (d.knot_strength_pct != null) {
      cite(key, 'knot strength', d.knot_strength_pct,
           find(key, 'knot_strength_pct', undefined, d.knot_page));
    }
    if (d.shape_factor != null) {
      cite(key, 'shape factor', d.shape_factor,
           find(key, 'fibre_shape_factor', 'Finlayson', d.shape_page));
    }
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

  // ── Chapter 17: the two moduli, and the third ─────────────────────────
  if (row.moduli) {
    const m = row.moduli;
    cite(key, 'tensile modulus', m.tensile_gpa,
         find(key, 'tensile_modulus_gpa', '65% r.h., 20 C', m.page));
    cite(key, 'shear modulus', m.shear_gpa,
         find(key, 'shear_modulus', '65% r.h., 20 C', m.page));
    cite(key, 'bending modulus', m.bending_gpa,
         find(key, 'bending_modulus', '65% r.h., 20 C', m.page));
    // The whole point of the pair is the RATIO, and a ratio below the
    // isotropic 2.6 would mean one of them had been typed into the wrong slot:
    // a real fibre cannot resist twisting better than an unoriented solid does.
    if (m.tensile_gpa != null && m.shear_gpa != null) {
      const half = v => (Array.isArray(v) ? (v[0] + v[1]) / 2 : v);
      assert(half(m.tensile_gpa) / half(m.shear_gpa) >= 2.6,
        `${key}: E/G is ${(half(m.tensile_gpa) / half(m.shear_gpa)).toFixed(2)}, below the 2.6 ` +
        'of an isotropic solid — E and G have probably been swapped');
      checked++;
    }
  }

  // ── Chapter 13: the shape of the curve ────────────────────────────────
  if (row.curve) {
    const c = row.curve;
    cite(key, 'work factor', c.work_factor,
         find(key, 'work_factor', '65% r.h., 20 C', c.page));
    // Work factor = work of rupture / (breaking load x breaking extension), so
    // where the engine holds all three the identity has to hold. It catches the
    // failure a lookup cannot: a work factor read off the correct page but from
    // the row above or below. Tolerance is wide because the printed figures are
    // rounded to two significant places before this arithmetic sees them.
    if (row.tensile && row.tensile.page === c.page &&
        row.tensile.work_of_rupture != null && row.tensile.tenacity != null &&
        row.tensile.extension != null) {
      const derived = row.tensile.work_of_rupture /
        (row.tensile.tenacity * 1000 * row.tensile.extension / 100);
      assert(Math.abs(derived - c.work_factor) < 0.06,
        `${key}: work factor ${c.work_factor} does not follow from the engine's own work of ` +
        `rupture ${row.tensile.work_of_rupture}, tenacity ${row.tensile.tenacity} and ` +
        `extension ${row.tensile.extension}% — that gives ${derived.toFixed(3)}`);
      checked++;
    }
  }

  // ── Chapter 24: orientation ───────────────────────────────────────────
  if (row.optical) {
    const o = row.optical;
    cite(key, 'refractive index along', o.n_parallel,
         find(key, 'refractive_index_parallel', 'light polarised along the fibre', o.page));
    cite(key, 'refractive index across', o.n_perpendicular,
         find(key, 'refractive_index_perpendicular', 'light polarised across the fibre', o.page));
    cite(key, 'birefringence', o.birefringence, find(key, 'birefringence', undefined, o.page));
    // Birefringence is DEFINED as the difference of the other two, so the three
    // stored numbers have to be consistent with each other whatever the book
    // printed. Rounding in the table is to three decimals, so 0.001 of slack.
    assert(Math.abs((o.n_parallel - o.n_perpendicular) - o.birefringence) < 0.0011,
      `${key}: birefringence ${o.birefringence} is not n_parallel ${o.n_parallel} minus ` +
      `n_perpendicular ${o.n_perpendicular}`);
    checked++;
  }

  // ── Chapter 24.5: the cross-section Adderley measured ─────────────────
  if (row.cross_section) {
    const x = row.cross_section;
    const all = prop => book.properties
      .filter(q => q.fibre_slug === key && q.property === prop && q.page === x.page);
    const merc = r => /mercerised/i.test(r.condition || '');
    const spanOf = rows => [Math.min(...rows.map(r => r.value)),
                            Math.max(...rows.map(r => r.value))];
    const raw = all('fibre_ellipticity').filter(r => !merc(r));
    const mer = all('fibre_ellipticity').filter(merc);
    cite(key, 'raw axis ratio span', x.ellipticity, spanOf(raw));
    cite(key, 'mercerised axis ratio span', x.ellipticity_mercerised, spanOf(mer));
    cite(key, 'convolutions span', x.convolutions_per_cm, spanOf(all('convolutions_per_cm')));
    // The two lustre anchors have to be the rows the table actually pairs with
    // those axis ratios, or the multiple computed from them is invented.
    for (const anchor of [x.lustre_at_max_flat, x.lustre_at_min_flat]) {
      const row2 = all('fibre_ellipticity').find(r => r.value === anchor.ratio);
      assert(row2, `${key}: no cotton in Table 24.5 has an axis ratio of ${anchor.ratio}`);
      const l = all('lustre').find(r => (r.condition || '') === (row2.condition || ''));
      assert(l && l.value === anchor.lustre,
        `${key}: the sample at axis ratio ${anchor.ratio} (${row2.condition}) has lustre ` +
        `${l ? l.value : 'none'}, not ${anchor.lustre}`);
      checked++;
    }
    // Mercerising must ROUND the section in the table, or the finding has the
    // direction of the whole mechanism backwards.
    assert(Math.max(...x.ellipticity_mercerised) < Math.max(...x.ellipticity),
      `${key}: the mercerised samples are not rounder than the raw ones`);
    checked++;
  }

  // ── Chapter 16: repeated loading ──────────────────────────────────────
  if (row.cyclic) {
    cite(key, 'growth by cycle 10', row.cyclic.growth_10,
         find(key, 'cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension'));
    cite(key, 'growth by cycle 1000', row.cyclic.growth_1000,
         find(key, 'cyclic_extension_growth_pct', 'by cycle 1000, at 2% imposed extension'));
    cite(key, 'stress to hold 2% at cycle 10', row.cyclic.stress_10,
         find(key, 'cyclic_stress_mn_tex', 'at cycle 10, 2% imposed extension'));
    cite(key, 'stress to hold 2% at cycle 1000', row.cyclic.stress_1000,
         find(key, 'cyclic_stress_mn_tex', 'at cycle 1000, 2% imposed extension'));
    // Every fibre with both columns needs MORE stress at cycle 1000 than at
    // cycle 10: it is being work-hardened as it is cycled. A row where the
    // stress falls has had the two columns crossed.
    if (row.cyclic.stress_10 != null && row.cyclic.stress_1000 != null) {
      assert(row.cyclic.stress_1000 > row.cyclic.stress_10,
        `${key}: the stress to hold 2% falls from ${row.cyclic.stress_10} to ` +
        `${row.cyclic.stress_1000} mN/tex over a thousand cycles, which is the wrong way round`);
      checked++;
    }
  }

  // ── Chapter 11: swelling across the diameter ──────────────────────────
  if (row.swelling && row.swelling.diameter != null) {
    cite(key, 'diameter swelling', row.swelling.diameter,
         find(key, 'transverse_swelling_diameter', 'immersed in water', row.swelling.page));
    // A fibre cannot gain more on its area than a circle of that diameter
    // would: area goes as diameter squared, so an area figure below the
    // diameter one means the two columns have been read into the wrong slots.
    const dHi = Array.isArray(row.swelling.diameter)
      ? row.swelling.diameter[1] : row.swelling.diameter;
    const aHi = Array.isArray(row.swelling.area) ? row.swelling.area[1] : row.swelling.area;
    if (aHi != null) {
      assert(aHi >= dHi,
        `${key}: area swelling ${aHi}% is below diameter swelling ${dHi}%, which no ` +
        'cross-section can do');
      checked++;
    }
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
    cite(key, 'strength retained at 100 C for 80 days', row.heat.retained_100c_80d,
         find(key, 'strength_retained_pct', 'after 80 days at 100 C'));
    // Hotter is never kinder. A fibre that keeps more at 130 C than at 100 C
    // over the same 80 days has had its two columns crossed.
    if (row.heat.retained_100c_80d != null && row.heat.retained_130c_80d != null) {
      assert(row.heat.retained_130c_80d <= row.heat.retained_100c_80d,
        `${key}: keeps ${row.heat.retained_130c_80d}% at 130 C and only ` +
        `${row.heat.retained_100c_80d}% at 100 C over the same 80 days`);
      checked++;
    }
  }

  // ── Chapters 8, 10 and 19: heat released, water left, bends survived ──
  if (row.moisture_energy) {
    const m = row.moisture_energy;
    cite(key, 'heat of sorption', m.heat_40_70_kj_kg,
         find(key, 'heat_of_sorption', 'going from 40% to 70% r.h.'));
    cite(key, 'median flex life', m.flex_median_cycles,
         find(key, 'flex_fatigue_life', 'median, 65% r.h., 20 C', m.flex_page));
    cite(key, 'flex life scatter', m.flex_cv_pct,
         find(key, 'cv_flex_fatigue_life', '65% r.h., 20 C', m.flex_page));
    cite(key, 'flex bending strain', m.flex_strain_pct,
         find(key, 'flex_bending_strain', undefined, m.flex_page));
    cite(key, 'flex specific stress', m.flex_stress_mn_tex,
         find(key, 'flex_specific_stress', undefined, m.flex_page));
    cite(key, 'flex test fineness', m.flex_dtex,
         find(key, 'fibre_linear_density', undefined, m.flex_page));
    // A skewed lifetime distribution puts the mean above the median. The
    // reverse would mean the two had been typed into each other's slots.
    if (m.flex_life_cycles != null && m.flex_median_cycles != null) {
      assert(m.flex_life_cycles >= m.flex_median_cycles,
        `${key}: mean flex life ${m.flex_life_cycles} sits below the median ` +
        `${m.flex_median_cycles}, which a right-skewed distribution cannot do`);
      checked++;
    }
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

// ── Chapter 22: what humidity buys ──────────────────────────────────────
for (const [engineKey, row] of Object.entries(F)) {
  if (!row.static) continue;
  const key = slugFor(engineKey);
  cite(key, 'resistance at 10% moisture', row.static.log_at_10pct,
       find(key, 'log_resistance_at_10pct_moisture', undefined, row.static.page));
  cite(key, 'resistance-moisture slope', row.static.moisture_slope,
       find(key, 'resistance_moisture_slope', undefined, row.static.page));
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
