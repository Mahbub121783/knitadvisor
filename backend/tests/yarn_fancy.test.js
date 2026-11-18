// Fancy yarns and the four new fibres: the 3D geometry, the engine, and the Studio.
const assert = require('assert');
const G = require('../../frontend/assets/js/yarn-real-geom.js');
const F = require('../engine/domain/fancy-yarn-engine');
const BY = require('../engine/domain/blend-yarn-engine');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Fancy Yarn Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const finite = (b) => b.fibres.every((f) => f.p.every(Number.isFinite) && (!f.depth || f.depth.every(Number.isFinite)));
const rad = (f) => { const a = []; for (let i = 0; i < f.p.length; i += 3) a.push(Math.hypot(f.p[i], f.p[i + 2])); return a; };
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const base = { fibre: 'cotton', type: 'combed', tex: 590.5 / 30 };

// ── 1. the four new fibres have shapes of their own ──────────────────────────────────────────
{
  for (const f of ['wool', 'acrylic', 'silk', 'linen', 'nylon']) {
    const b = G.build({ fibre: f, type: 'combed', tex: 25 });
    assert(b.fibres.length > 20 && finite(b), f + ' builds');
    assert(b.fibres.filter((x) => x.kind === 'body').every((x) => x.p.length >= 9));
  }
  const body = (f) => G.build({ fibre: f, type: 'combed', tex: 25 }).fibres.filter((x) => x.kind === 'body');
  assert(body('acrylic')[0].shape === 'lobed' && body('acrylic')[0].lobes === 2, 'the dog-bone section of acrylic');
  assert(body('silk')[0].shape === 'lobed' && body('silk')[0].lobes === 3, 'the rounded triangle of silk');
  assert(body('linen')[0].nodeAmp > 0 && body('linen')[0].nodePitch > 0, 'flax has nodes along it');
  assert(body('wool')[0].modAmp > 0, 'wool has scale edges');
  assert(body('cotton')[0].shape === 'ribbon', 'cotton is still a ribbon');
  // different fineness, so different fibre counts at the same tex: wool is coarse, silk fine
  const n = (f) => G.build({ fibre: f, type: 'combed', tex: 25 }).meta.fibres_in_section;
  assert(n('wool') < n('cotton') && n('cotton') < n('silk'), `fibres in the section: wool ${n('wool')} < cotton ${n('cotton')} < silk ${n('silk')}`);
  // wool and acrylic are crimped: a fibre's distance from the axis waves along the yarn (cotton's does not, beyond its twist)
  const wav = (f) => { const fb = body(f).filter((x) => x.p.length > 100)[0], r = rad(fb); const m = r.reduce((t, v) => t + v, 0) / r.length; return Math.sqrt(r.reduce((t, v) => t + (v - m) * (v - m), 0) / r.length) / m; };
  assert(wav('wool') > wav('cotton') * 1.3, `wool's crimp: ${wav('wool')} vs ${wav('cotton')}`);
  // the tones are their own
  assert(body('silk')[0].tone[0] > body('linen')[0].tone[0] && body('linen')[0].tone[2] < body('cotton')[0].tone[2], 'linen is the darkest, silk the brightest');
  // a blend uses the shapes: cotton/wool is drawn by number share, in two shapes
  const bl = G.build({ fibre: 'cotton', type: 'combed', tex: 25, blend: { cotton: 70, wool: 30 } }).fibres.filter((x) => x.kind === 'body');
  assert(bl.some((x) => x.fibre === 'wool') && bl.some((x) => x.fibre === 'cotton'));
  console.log('✓ wool, acrylic, silk, linen, nylon: shapes, crimp, nodes, fineness and tone of their own');
}

// ── 2. slub and flame: thick places ──────────────────────────────────────────────────────────
{
  const plain = G.build(base), sl = G.build({ ...base, form: 'slub', fancy: { thickness: 2, length_mm: 40, spacing_mm: 120 } });
  assert(finite(sl) && sl.length > plain.length && sl.meta.slub && sl.meta.slub.gap_shortened && sl.meta.slub.slub_length_real_mm === 40, 'shortened to be seen, and says so');
  assert(sl.fibres.length > plain.fibres.length, 'the slub holds extra fibres');
  // the radius in the thick place against the thin: √(mass ratio)
  const s = sl.meta.slub, y0 = 0.4 * s.slub_length_mm, y1 = y0 + s.slub_length_mm, thinR = [], thickR = [];
  sl.fibres.filter((f) => f.kind === 'body').forEach((f) => { for (let i = 0; i < f.p.length; i += 3) { const yy = f.p[i + 1], r = Math.hypot(f.p[i], f.p[i + 2]); if (yy > y0 + s.slub_length_mm * 0.3 && yy < y1 - s.slub_length_mm * 0.3) thickR.push(r); else if (yy > y1 + 1.2 || yy < y0 - 1.2) thinR.push(r); } });
  const q = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.9)];
  near(q(thickR) / q(thinR), Math.sqrt(2), 0.2, 'the thick place is √(mass ratio) wider');
  // a thicker slub is wider and has more extra fibres
  const sl3 = G.build({ ...base, form: 'slub', fancy: { thickness: 3.5, length_mm: 40, spacing_mm: 120 } });
  assert(sl3.fibres.length > sl.fibres.length && sl3.meta.slub.thickness_max > sl.meta.slub.thickness_max);
  // a flame: several slubs of different lengths and thicknesses; the same input gives the same yarn
  const fl = G.build({ ...base, form: 'flame', fancy: { thickness: 3, length_mm: 14 } }), fl2 = G.build({ ...base, form: 'flame', fancy: { thickness: 3, length_mm: 14 } });
  assert(finite(fl) && fl.meta.slub.count_slubs_drawn === 3); assert.deepStrictEqual(fl.fibres.slice(0, 20).map((x) => x.tone), fl2.fibres.slice(0, 20).map((x) => x.tone), 'deterministic');
  // lengthOnly agrees (the view frames from it)
  near(G.build({ ...base, form: 'slub', fancy: { thickness: 2, length_mm: 40 } }, { lengthOnly: true }).length, sl.length, 1e-6);
  console.log('✓ slub and flame: thick places √(mass ratio) wider, extra fibres, shortened to be seen and said so, deterministic');
}

// ── 3. nep, bouclé, chenille, filament core, air-jet textured ────────────────────────────────
{
  const nep = G.build({ ...base, form: 'nep', fancy: { per_cm: 1, colour: '#1d3f8a' } });
  const neps = nep.fibres.filter((f) => f.kind === 'nep');
  assert(finite(nep) && neps.length === 9 * nep.meta.neps_drawn && nep.meta.neps_drawn >= 2, 'nine fibres to a nep');
  assert(neps[0].tone[2] > neps[0].tone[0] * 2, 'a blue nep in a pale yarn');
  const bo = G.build({ ...base, tex: 59, form: 'boucle', fancy: { overfeed: 3.2, spacing_mm: 1.6 } });
  assert(finite(bo) && bo.fibres.length >= 40);
  near(bo.meta.loop_height_mm, F.loopHeight(3.2, 1.6), 0.02, 'the loop height is the engine\'s: solved from the overfeed');
  assert(bo.meta.diameter_mm > 10 * G.build({ ...base, tex: 59 }).meta.diameter_mm, 'a bouclé is many times the diameter of the plain yarn of its count');
  assert(G.build({ ...base, tex: 59, form: 'boucle', fancy: { overfeed: 5 } }).meta.loop_height_mm > bo.meta.loop_height_mm, 'more overfeed, taller loops');
  const ch = G.build({ fibre: 'viscose', type: 'combed', tex: 118, form: 'chenille', fancy: { pile_mm: 1.8, pile_density: 24 } });
  const tufts = ch.fibres.filter((f) => f.kind === 'tuft');
  assert(finite(ch) && tufts.length >= 3 * 24 * ch.length * 0.9, 'three fibres to a tuft, 24 tufts a mm');
  const rmax = Math.max(...tufts.map((f) => Math.max(...rad(f)))); assert(rmax > 1.2 && rmax < 3, `the pile stands out ${rmax} mm`);
  assert(G.build({ fibre: 'viscose', type: 'combed', tex: 118, form: 'chenille', fancy: { pile_mm: 3 } }).meta.diameter_mm > ch.meta.diameter_mm, 'a longer pile, a wider yarn');
  const cf = G.build({ ...base, form: 'core_fil', fancy: { core_denier: 40 } }), core = cf.fibres.filter((f) => f.coreFil);
  assert(finite(cf) && core.length === cf.meta.core_filaments && cf.meta.core_share_pct > 15 && cf.meta.core_share_pct < 30);
  assert(Math.max(...core.map((f) => Math.max(...rad(f)))) < cf.meta.diameter_mm / 2 * 0.7, 'the core lies inside the sheath');
  const cut = G.build({ ...base, form: 'core_fil', fancy: { core_denier: 40 } }, { cutaway: true }); assert(cut.fibres.filter((f) => f.coreFil).length === core.length, 'a cutaway keeps the core');
  const aty = G.build({ fibre: 'polyester_filament', type: 'aty', tex: 16.7 }), dty = G.build({ fibre: 'polyester_filament', type: 'dty', tex: 16.7 }), fdy = G.build({ fibre: 'polyester_filament', type: 'fdy', tex: 16.7 });
  assert(finite(aty) && /Air-jet/.test(aty.meta.system_label) && aty.meta.overfeed_pct > 0);
  const out = (b) => Math.max(...b.fibres.map((f) => Math.max(...rad(f)))) / (b.meta.compact_diameter_mm / 2);
  assert(out(aty) > out(fdy) * 1.4 && out(aty) > 1.5, `loops stand out of the core: ${out(aty)} vs ${out(fdy)}`);
  console.log('✓ nep, bouclé (loop height from the overfeed, equal to the engine\'s), chenille, filament core (inside, kept in a cutaway), air-jet textured');
}

// ── 4. the engine ───────────────────────────────────────────────────────────────────────────
{
  const run = (form, extra = {}) => F.analyse({ form, fibres: { cotton: 100 }, count: { value: 20, unit: 'ne' }, ...extra });
  // slub: the two-level laws, by hand
  const s = run('slub', { params: { thickness: 1.8, length_cm: 4, spacing_cm: 12 } });
  const p = 40 / (40 + 120), extra = 0.8 * p;
  near(s.count.extra_mass_pct, extra * 100, 0.02, 'extra mass = (m − 1)·p');
  near(s.count_labels.declared_base_ne, 590.5 / (590.5 / 20 / (1 + extra)), 0.1, 'the declared base count');
  near(s.evenness.cvm_pct.value, (0.8 * Math.sqrt(p * (1 - p)) / (1 + p * 0.8)) * 100, 0.05, 'the two-level CV');
  assert(s.count.slubs_per_km === 6250);
  assert(run('slub', { params: { thickness: 3 } }).evenness.cvm_pct.value > s.evenness.cvm_pct.value && run('slub', { params: { thickness: 3 } }).tensile.tenacity.value < s.tensile.tenacity.value, 'a thicker slub is less even and weaker per tex');
  // the weakest place is the base yarn, a little weaker
  const baseYarn = BY.analyse({ fibres: { cotton: 100 }, count: { value: 590.5 / 20 / (1 + extra), unit: 'tex' } });
  near(s.tensile.breaking_force.value, baseYarn.tensile.breaking_force.value * 0.9, 0.3, 'a slub yarn breaks in its thin place');
  const fl = run('flame'); assert(fl.evenness.cvm_pct.value > 20 && fl.evenness.basis === undefined || fl.evenness.cvm_pct.basis === 'estimate'); assert.strictEqual(JSON.stringify(run('flame')), JSON.stringify(fl), 'a flame is sampled with a fixed seed');
  // bouclé: the parts add up, the effect yarn's own count follows the overfeed, the loop height is solved
  const b = run('boucle', { count: { value: 6, unit: 'ne' }, params: { effect_share: 0.6, overfeed: 3.2, spacing_mm: 1.6 } });
  near(b.mass.reduce((t, m) => t + m.share_pct, 0), 100, 0.3); near(b.count.effect_tex_per_its_own_length, 0.6 * (590.5 / 6) / 3.2, 0.02, 'effect tex per its own length = share × tex ÷ overfeed');
  const arc = (h, sp) => { let t0 = 0, py = 0, pr = 0; for (let i = 1; i <= 28; i++) { const t = i / 28, yy = sp * (t - 1.25 * Math.sin(2 * Math.PI * t) / (2 * Math.PI)), r = h * Math.pow(Math.sin(Math.PI * t), 0.85); t0 += Math.hypot(yy - py, r - pr); py = yy; pr = r; } return t0; };
  near(arc(b.geometry.loop_height_mm.value, 1.6) / 1.6, 3.2, 0.03, 'the effect yarn is 3.2 times as long as the yarn');
  assert(b.tensile.tenacity.value < run('boucle', { count: { value: 6, unit: 'ne' }, params: { effect_share: 0.4 } }).tensile.tenacity.value, 'more effect yarn, less strength per tex');
  assert(b.knitting.finest_gauge.value < run('slub').knitting.finest_gauge.value, 'a bouclé is knitted in a coarser gauge than a slub');
  // chenille: the core carries the load
  const c = run('chenille', { fibres: { viscose: 100 }, count: { value: 4, unit: 'ne' } });
  near(c.mass.find((m) => /pile/.test(m.part)).share_pct, 72, 0.1); assert(c.tensile.tenacity.value < 8 && c.hand.shedding && c.knitting.finest_gauge.value <= 7);
  assert(run('chenille', { fibres: { viscose: 100 }, count: { value: 4, unit: 'ne' }, params: { pile_mm: 3.2, pile_density: 10 } }).hand.shedding.value === undefined && run('chenille', { fibres: { viscose: 100 }, count: { value: 4, unit: 'ne' }, params: { pile_mm: 3.2, pile_density: 10 } }).hand.shedding === 'high');
  // filament core: stronger than the plain yarn of the same count, and it holds on to a higher elongation
  const cf = run('core_fil', { count: { value: 30, unit: 'ne' } }), plain = BY.analyse({ fibres: { cotton: 100 }, count: { value: 30, unit: 'ne' } });
  assert(cf.tensile.tenacity.value > plain.tensile.tenacity.value * 1.05 && cf.tensile.ultimate_elongation.value > plain.tensile.ultimate_elongation.value + 3, 'the filament core adds strength and a long tail');
  near(cf.count.core_share_pct, 40 / 9 / (590.5 / 30) * 100, 0.2);
  // nep and ATY
  const n = run('nep'); assert(n.count.nep_mass_pct < 10 && n.tensile.factor_vs_plain.value === 0.97);
  const a = F.analyse({ form: 'aty', count: { value: 150, unit: 'denier' } }); assert(a.tensile.tenacity.value > 30 && a.tensile.tenacity.value < 50 && a.hand.hairiness.value < 1 && a.count.filaments > 30);
  // every form's render object: the form and the numbers the 3D view draws from
  for (const f of F.FORMS ? Object.keys(F.FORMS) : []) assert(F.analyse({ form: f, fibres: { cotton: 100 }, count: { value: f === 'boucle' ? 6 : f === 'chenille' ? 4 : f === 'aty' ? 150 : 20, unit: f === 'aty' ? 'denier' : 'ne' } }).render.form === f);
  // bad input in words, prototype keys harmless
  assert.throws(() => F.analyse({ form: 'sparkle', fibres: { cotton: 100 }, count: { value: 20, unit: 'ne' } }), /not a fancy yarn form/);
  assert.throws(() => F.analyse({ form: 'slub', fibres: { cotton: 100 } }), /count/); assert.throws(() => F.analyse({ form: 'slub', count: { value: 20, unit: 'ne' } }), /fibres/);
  assert.throws(() => F.analyse({ form: 'slub', fibres: { cotton: 100 }, count: { value: 20, unit: 'furlong' } }), /unit/); assert.throws(() => F.analyse(null), /Give the fancy yarn/);
  assert.throws(() => F.analyse({ form: '__proto__', fibres: { cotton: 100 }, count: { value: 20, unit: 'ne' } }), /not a fancy yarn form/);
  assert(F.analyse({ form: 'slub', fibres: { constructor: 50, cotton: 50 }, count: { value: 20, unit: 'ne' }, params: { __proto__: { thickness: 9 } } }).success);
  // random: finite, bounded
  let seed = 9; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const fin = (o, path = '') => { if (o == null) return; if (typeof o === 'number') { assert(Number.isFinite(o), 'non-finite at ' + path); return; } if (typeof o === 'object') for (const [k, v] of Object.entries(o)) fin(v, path + '.' + k); };
  for (let i = 0; i < 300; i++) {
    const form = Object.keys(F.FORMS)[Math.floor(rnd() * 7)], fibres = { [['cotton', 'viscose', 'wool', 'acrylic', 'polyester', 'linen', 'silk'][Math.floor(rnd() * 7)]]: 100 };
    const r = F.analyse({ form, fibres, count: { value: form === 'aty' ? 60 + rnd() * 300 : form === 'boucle' || form === 'chenille' ? 3 + rnd() * 8 : 6 + rnd() * 40, unit: form === 'aty' ? 'denier' : 'ne' }, params: { thickness: 1.2 + rnd() * 3.5, length_cm: 1 + rnd() * 10, spacing_cm: 3 + rnd() * 50, per_cm: 0.2 + rnd() * 5, overfeed: 1.8 + rnd() * 4, spacing_mm: 0.8 + rnd() * 5, effect_share: 0.3 + rnd() * 0.5, pile_mm: 0.5 + rnd() * 3, core_denier: 15 + rnd() * 150 } });
    fin(r); assert(r.tensile.tenacity.value > 0 && r.knitting.finest_gauge.value > 0 && r.derivations.length >= 2);
  }
  console.log('✓ engine: the slub laws by hand, the bouclé overfeed, chenille\'s core, the filament core\'s strength; bad input; 300 random yarns finite');
}

// ── 5. the Studio ───────────────────────────────────────────────────────────────────────────
{
  const run = (fancy, yarn, extra = {}) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: yarn || { fibre: 'cotton', type: 'combed', count: 20, unit: 'ne' }, target: { gsm: 200 }, machine: {}, fancy: fancy ? { ground: fancy } : undefined, ...extra });
  const plain = run(null), sl = run({ form: 'slub', params: { thickness: 2 } });
  assert(sl.success && sl.fancy && sl.fancy.ground.identity.label === 'Slub' && /slub/.test(sl.yarn.ground.type) && plain.fancy === null);
  near(sl.fancy.ground.count_labels.resultant_ne, 20, 0.1, 'the count is the yarn as knitted');
  const bo = run({ form: 'boucle' }, { fibre: 'cotton', type: 'combed', count: 6, unit: 'ne' });
  assert(bo.success && bo.yarn.ground.d_mm > 3 * plain.yarn.ground.d_mm, 'a bouclé is far wider than the plain yarn: ' + bo.yarn.ground.d_mm);
  assert(run({ form: 'chenille' }, { fibre: 'viscose', type: 'combed', count: 4, unit: 'ne' }).success, 'a chenille count beyond 120 tex is allowed');
  const coarse = run({ form: 'chenille' }, { fibre: 'viscose', type: 'combed', count: 4, unit: 'ne' }, { chemistry: { enabled: true, shade: 'dark' }, recovery: { enabled: true }, look: { shade: 'dark' }, blend: { ground: { fibres: { viscose: 100 } } } });
  assert(coarse.success && coarse.chemistry.ground && coarse.recovery.ground && coarse.look && coarse.checks.some((c) => /blend analysis is for yarns up to 120 tex/.test(c.text)), 'a coarse yarn goes through every engine, and the blend analysis says what it cannot do');
  assert.strictEqual(S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 4, unit: 'ne' }, target: { gsm: 200 }, machine: {} }).success, false, 'a plain yarn beyond 120 tex is still refused');
  const aty = run({ form: 'aty' }, { fibre: 'cotton', type: 'combed', count: 150, unit: 'denier' });
  assert(aty.success && aty.yarn.ground.type === 'air-jet textured (ATY)' && aty.fancy.ground.identity.label === 'Air-jet textured (ATY)', 'an ATY makes the yarn a polyester filament');
  assert(run({ form: 'core_fil' }).success && run({ form: 'nep' }).success && run({ form: 'flame' }).success);
  const bad = run({ form: 'sparkle' }); assert(bad.success && bad.yarn.ground.type && bad.fancy === null, 'an unknown form is ignored, never a crash');
  // the look takes the form: a chenille reads hairier and softer, a bouclé duller
  assert(run({ form: 'chenille' }, { fibre: 'viscose', type: 'combed', count: 4, unit: 'ne' }, { look: { shade: 'medium' } }).look.face.stages[0].hairiness.value > 2 * run(null, { fibre: 'viscose', type: 'combed', count: 20, unit: 'ne' }, { look: { shade: 'medium' } }).look.face.stages[0].hairiness.value);
  // the new fibres in the Studio: wool, acrylic, silk, linen
  for (const f of ['wool', 'acrylic', 'silk', 'linen']) {
    const r = run(null, { fibre: f, type: 'combed', count: 24, unit: 'ne' }, { chemistry: { enabled: true, shade: 'medium' }, recovery: { enabled: true }, look: { shade: 'medium' } });
    assert(r.success && r.yarn.ground.fibre === S.FIBRES[f].label, f + ' in the Studio');
    assert(r.chemistry.ground && r.recovery.ground && r.look.render.fibre_type === f, f + ': chemistry, recovery and the 3D fibre type');
  }
  assert(run(null, { fibre: 'wool', type: 'combed', count: 24, unit: 'ne' }).yarn.ground.d_mm > run(null, { fibre: 'cotton', type: 'combed', count: 24, unit: 'ne' }).yarn.ground.d_mm, 'wool is lighter, so a thicker yarn of the same tex');
  console.log('✓ Studio: forms on a role, count as knitted, bouclé and chenille beyond 120 tex, ATY as a filament, the new fibres through every engine');
}
console.log('Fancy yarn tests passed');
