// Yarn chemistry engine: the fibres' chemistry, the wet route in the order the chemistry allows, the recipe, the strength after it.
const assert = require('assert');
const C = require('../engine/domain/yarn-chemistry-engine');
const BY = require('../engine/domain/blend-yarn-engine');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Yarn Chemistry Engine Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const run = (fibres, shade, extra = {}) => C.analyse({ fibres, count: { value: 30, unit: 'ne' }, shade, ...extra });
const ids = (r) => r.route.steps.map((s) => s.id);
const finite = (o, path = '') => {
  if (o == null) return;
  if (typeof o === 'number') { assert(Number.isFinite(o), `non-finite number at ${path}`); return; }
  if (typeof o === 'object') for (const [k, v] of Object.entries(o)) finite(v, path + '.' + k);
};

// ── 1. the recipe: the laws, by hand ─────────────────────────────────────────────────────────
{
  const r = run({ cotton: 100 }, 'medium');
  const dryKg = 100 / 1.085;
  near(r.recipe.dry_yarn_kg, dryKg, 0.06, 'dry weight of 100 kg of conditioned cotton yarn');
  const reactive = r.recipe.dyes.find((d) => d.class === 'reactive');
  near(reactive.kg.value, 0.025 * dryKg, 0.01, 'reactive dye = 2.5 % owf on the dry weight');
  near(reactive.unfixed_kg, reactive.kg.value * 0.24, 0.01, 'a reactive dyeing leaves 24 % unfixed at a medium depth');
  near(r.recipe.liquor_volume_l, 800, 0.5, 'liquor ratio 8:1');
  const salt = r.recipe.chemicals.find((c) => /^Salt/.test(c.name));
  near(salt.kg, salt.g_per_l * 800 / 1000, 0.01, 'salt kg = g/L × litres');
  near(run({ cotton: 100 }, 'medium', { liquor_ratio: 10 }).recipe.liquor_volume_l, 1000, 0.5);
  // a finer fibre has more surface for the same mass, so it needs √(reference ÷ dtex) more dye
  const fine = run({ polyester: 100 }, 'medium', { fineness: { polyester: 0.9 } }).recipe.dyes[0], norm = run({ polyester: 100 }, 'medium').recipe.dyes[0];
  near(fine.kg.value / norm.kg.value, Math.sqrt(1.33 / 0.9), 0.02, 'microfibre needs more dye');
  assert(run({ viscose: 100 }, 'medium').recipe.dyes[0].kg.value < run({ cotton: 100 }, 'medium').recipe.dyes[0].kg.value, 'viscose needs less dye for the same depth');
  const sw = r.sweep.depth;
  assert.strictEqual(sw[0].dye_kg, 0);
  for (let i = 2; i < sw.length; i++) { assert(sw[i].dye_kg > sw[i - 1].dye_kg, 'dye rises with depth'); assert(sw[i].salt_g_l >= sw[i - 1].salt_g_l); }
  const cvc = run({ cotton: 60, polyester: 40 }, 'dark');
  assert(cvc.recipe.dyes.length === 2 && cvc.recipe.dyes.every((d) => d.kg.value > 0));
  near(cvc.recipe.dyes.reduce((t, d) => t + d.kg.value, 0), cvc.sweep.depth[4].dye_kg, 0.02, 'the sweep agrees with the recipe');
  console.log('✓ recipe: % owf on the dry weight, fineness and depth factors, liquor, salt, fixation, the depth ladder');
}

// ── 2. the route: the order the chemistry allows ────────────────────────────────────────────
{
  const cot = ids(run({ cotton: 100 }, 'medium'));
  assert.deepStrictEqual(cot.slice(0, 3), ['scour', 'dye_reactive', 'soap']); assert(cot.includes('biopolish') && cot[cot.length - 1] === 'soften');
  const cvc = ids(run({ cotton: 60, polyester: 40 }, 'medium'));
  assert(cvc.indexOf('dye_disperse') < cvc.indexOf('reduction_clear') && cvc.indexOf('reduction_clear') < cvc.indexOf('dye_reactive') && cvc.indexOf('dye_reactive') < cvc.indexOf('soap'), 'CVC: disperse, reduction clear, reactive, soap: ' + cvc.join(' > '));
  assert.strictEqual(run({ cotton: 60, polyester: 40 }, 'medium').dyeing.baths, 2);
  assert.strictEqual(run({ cotton: 60, polyester: 40 }, 'pastel').dyeing.baths, 1, 'a pastel can go in one bath');
  assert.strictEqual(run({ cotton: 60, polyester: 40 }, 'dark').dyeing.one_bath, false);
  const pes = ids(run({ polyester: 100 }, 'dark')); assert(pes.includes('dye_disperse') && pes.includes('reduction_clear') && !pes.includes('biopolish') && !pes.includes('dye_reactive'), 'polyester: disperse and clear, no bio-polish: ' + pes.join(' > '));
  const nyl = run({ nylon: 85, elastane: 15 }, 'dark');
  assert.strictEqual(nyl.route.steps[0].id, 'heatset', 'elastane: set before dyeing'); assert(ids(nyl).includes('dye_acid') && !ids(nyl).includes('bleach'));
  assert(nyl.warnings.some((w) => /Chlorine/.test(w.text)) && nyl.warnings.some((w) => /Elastane/.test(w.text)));
  assert.strictEqual(run({ acrylic: 50, cotton: 50 }, 'medium').dyeing.classes.map((c) => c.id).join(), 'cationic,reactive');
  assert(run({ wool: 60, cotton: 40 }, 'medium').warnings.some((w) => /alkali/.test(w.text)));
  const vm = run({ cotton: 70, viscose: 30 }, 'medium', { mercerise: true });
  assert(vm.warnings.some((w) => /Mercerising is left out/.test(w.text)) && !ids(vm).includes('mercerise'));
  assert(ids(run({ cotton: 100 }, 'medium', { mercerise: true })).includes('mercerise'));
  const cv = run({ cotton: 70, viscose: 30 }, 'medium');
  assert(cv.dyeing.dye_rate_split && cv.warnings.some((w) => /two shades/.test(w.text)), 'cotton/viscose dyes two shades unless compensated');
  const white = run({ cotton: 60, polyester: 40 }, 'white');
  assert(ids(white).includes('bleach') && ids(white).includes('oba') && !ids(white).some((i) => i.startsWith('dye_')) && white.whitening.applies && white.recipe.dyes.length === 0);
  for (const f of [{ cotton: 100 }, { cotton: 60, nylon: 40 }, { wool: 70, cotton: 30 }]) assert(!run(f, 'pastel').route.steps.some((x) => x.chemicals.some((c) => /ypochlorite|chlorine/i.test(c.name))), 'peroxide only');
  const m = run({ cotton: 60, polyester: 40 }, 'medium');
  assert(m.route.steps.filter((s) => s.id.startsWith('dye_')).every((s) => s.t_c > 0 && s.ph > 0 && s.time_min > 0));
  assert.strictEqual(m.route.steps.find((s) => s.id === 'dye_disperse').t_c, 130);
  assert.strictEqual(run({ nylon: 60, polyester: 40 }, 'medium').route.steps.find((s) => s.id === 'dye_disperse').t_c, 120, 'nylon lowers the disperse temperature');
  console.log('✓ route: the order the chemistry allows, one bath or two, what is left out, peroxide only');
}

// ── 3. strength after the route comes from the blend yarn engine ─────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 'medium');
  const plain = BY.analyse({ fibres: { cotton: 60, polyester: 40 }, count: { value: 30, unit: 'ne' } }).tensile;
  near(r.strength.before.tenacity.value, plain.tenacity.value, 0.2, 'the strength before the route is the blend yarn engine\'s');
  assert(r.strength.after.tenacity.value < r.strength.before.tenacity.value && r.strength.retained_pct.value > 70 && r.strength.retained_pct.value < 100);
  assert.strictEqual(r.strength.trace.length, r.route.steps.length);
  near(r.strength.trace[r.strength.trace.length - 1].tenacity, r.strength.after.tenacity.value, 0.11, 'the last step of the trace is the end of the route');
  assert(r.strength.by_fibre.every((f) => f.retained_pct > 60 && f.retained_pct < 110));
  const cottonMerc = run({ cotton: 100 }, 'medium', { mercerise: true }), cottonPlain = run({ cotton: 100 }, 'medium');
  assert(cottonMerc.strength.retained_pct.value > cottonPlain.strength.retained_pct.value + 5, 'mercerising lifts cotton\'s strength');
  assert(run({ polyester: 100 }, 'medium').strength.retained_pct.value > cottonPlain.strength.retained_pct.value, 'polyester comes through the route better than cotton');
  const noPolish = run({ cotton: 60, polyester: 40 }, 'medium', { biopolish: false });
  assert(noPolish.strength.after.tenacity.value > r.strength.after.tenacity.value && !ids(noPolish).includes('biopolish'));
  const fil = run({ polyester: 100 }, 'medium', { filament: true }); assert.strictEqual(fil.strength.before, null); assert(fil.strength.retained_pct.value > 80);
  console.log('✓ strength: the route\'s retention through the blend yarn engine, step by step; mercerising gains; filament by weight');
}

// ── 4. resistance ────────────────────────────────────────────────────────────────────────────
{
  const r = run({ cotton: 50, nylon: 30, elastane: 20 }, 'medium');
  const g = (a) => r.resistance.find((x) => x.agent === a);
  assert.strictEqual(r.resistance.length, C.AGENTS.length); assert(r.resistance.every((x) => x.per_fibre.length === 3));
  assert(g('hypochlorite').governed_by.rating <= 1 && /avoid|poor/.test(g('hypochlorite').verdict), 'chlorine: the nylon or the elastane governs');
  assert.strictEqual(g('acid_strong').governed_by.rating, 0); assert.strictEqual(g('cellulase').governed_by.rating, 0, 'cellulase destroys the cellulose it is meant to trim');
  const pes = run({ polyester: 100 }, 'medium'), cot = run({ cotton: 100 }, 'medium'), acr = run({ acrylic: 100 }, 'medium');
  const L = (x) => x.resistance.find((a) => a.agent === 'light').per_fibre[0].rating;
  assert(L(acr) > L(pes) && L(pes) >= L(cot), 'the tables\' light order: acrylic, polyester, then cotton');
  assert.strictEqual(pes.resistance.find((a) => a.agent === 'peroxide').governed_by.rating, 4);
  console.log('✓ resistance: every agent, the governing fibre, the light order of the tables');
}

// ── 5. fastness ──────────────────────────────────────────────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 'dark');
  assert(r.fastness.per_class.length === 2 && r.fastness.overall.rub_wet[1] <= 4);
  assert(r.fastness.overall.rub_wet[0] <= Math.min(...r.fastness.per_class.map((p) => p.grades.rub_wet[0])), 'the lowest grade governs');
  assert(r.fastness.risks.some((x) => /Thermomigration/.test(x)) && r.fastness.risks.some((x) => /reduction clearing/.test(x)));
  assert(run({ cotton: 100 }, 'black').fastness.per_class[0].grades.rub_wet[1] <= 3, 'a black reactive rubs off wet');
  assert.strictEqual(run({ cotton: 100 }, 'white').fastness, null);
  assert(run({ acrylic: 100 }, 'medium').fastness.per_class[0].grades.light[0] >= 5, 'acrylic with cationic dye is light-fast');
  console.log('✓ fastness: by class and depth, the lowest grade governs, the risks named');
}

// ── 6. moisture, derivations, bad input, a random field ──────────────────────────────────────
{
  const r = run({ cotton: 60, polyester: 40 }, 'medium');
  near(r.moisture.regain.value, BY.analyse({ fibres: { cotton: 60, polyester: 40 }, count: { value: 30, unit: 'ne' } }).composition.blend_regain.value, 0.02, 'regain agrees with the blend engine');
  assert(r.moisture.swelling_diameter_gain.value > 5 && r.moisture.boil_off_shrinkage.value > 0);
  assert(r.derivations.length >= 4 && r.derivations.every((d) => d.formula && d.working && d.result != null && d.basis));
  assert.throws(() => C.analyse({ fibres: { cotton: 50, kryptonite: 50 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => C.analyse({ fibres: { constructor: 50, cotton: 50 }, count: { value: 30, unit: 'ne' } }), /not a fibre/);
  assert.throws(() => C.analyse({ fibres: { cotton: 20, polyester: 20, viscose: 20, modal: 20, nylon: 20 }, count: { value: 30, unit: 'ne' } }), /At most 4/);
  assert.throws(() => C.analyse({ fibres: { cotton: -5 }, count: { value: 30, unit: 'ne' } }), /share/);
  assert.throws(() => C.analyse({ fibres: { cotton: 100 } }), /count/);
  assert.throws(() => C.analyse({ fibres: { cotton: 100 }, count: { value: 30, unit: 'furlong' } }), /unit/);
  assert.throws(() => C.analyse(null), /Give the yarn/); assert.throws(() => C.analyse({ count: { value: 30, unit: 'ne' } }), /fibres/);
  assert.strictEqual(run({ cotton: 100 }, 'nonsense').identity.shade, 'Medium', 'an unknown shade falls back to medium');
  assert.strictEqual(C.profileOf({ cotton: 60, polyester: 40 }, 19.7, { shade: 'dark' }).identity.shade, 'Dark'); assert.strictEqual(C.profileOf({}, 19.7), null);
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const fib = Object.keys(C.FIB);
  for (let i = 0; i < 400; i++) {
    const k = 1 + Math.floor(rnd() * 4), pick = fib.slice().sort(() => rnd() - 0.5).slice(0, k), f = {};
    pick.forEach((x) => { f[x] = 5 + Math.floor(rnd() * 90); });
    const shade = C.DEPTHS[Math.floor(rnd() * 6)], ne = [6, 10, 16, 24, 30, 40, 60][Math.floor(rnd() * 7)];
    const q = C.analyse({ fibres: f, count: { value: ne, unit: 'ne' }, shade, mercerise: rnd() < 0.3, filament: rnd() < 0.15, liquor_ratio: 4 + Math.floor(rnd() * 12), fineness: rnd() < 0.3 ? { [pick[0]]: 0.7 + rnd() * 3 } : undefined });
    finite(q);
    assert(q.route.steps.length >= 2 && q.resistance.length === C.AGENTS.length && q.sweep.depth.length === 6);
    assert(q.strength.retained_pct.value > 30 && q.strength.retained_pct.value < 115, `retained ${q.strength.retained_pct.value} for ${JSON.stringify(f)} ${shade}`);
    if (shade !== 'white') assert(q.recipe.dyes.length >= 1 || Object.keys(f).every((x) => x === 'elastane'), 'a dyed shade has a dye: ' + JSON.stringify(f));
    assert(!q.route.steps.some((x) => x.chemicals.some((c) => /ypochlorite|chlorine/i.test(c.name))));
  }
  console.log('✓ moisture, derivations, bad input in words, prototype keys refused, 400 random yarns finite');
}

// ── 7. the Studio: the chemistry of each yarn at the count it settled on ─────────────────────
{
  const base = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, ...extra });
  const off = base({}); assert.strictEqual(off.chemistry, null, 'no chemistry unless it is asked for');
  const on = base({ blend: { ground: { fibres: { cotton: 60, polyester: 40 } } }, chemistry: { enabled: true, shade: 'dark' } });
  assert(on.success && on.chemistry && on.chemistry.ground);
  assert(on.chemistry.ground.dyeing.baths === 2 && on.chemistry.ground.identity.shade === 'Dark');
  near(on.chemistry.ground.identity.count.ne, 30, 0.1, 'at the count the Studio uses');
  const plain = base({ chemistry: { enabled: true, shade: 'medium' } }); assert.deepStrictEqual(plain.chemistry.ground.dyeing.classes.map((c) => c.id), ['reactive']);
  const fil = base({ yarn: { fibre: 'polyester_filament', type: 'dty', count: 150, unit: 'denier' }, chemistry: { enabled: true, shade: 'dark' } });
  assert(fil.chemistry.ground.identity.filament && fil.chemistry.ground.dyeing.classes[0].id === 'disperse');
  const mel = base({ melange: { ground: JSON.parse(JSON.stringify(require('../engine/domain/melange-engine').PRESETS.find((p) => p.id === 'grey_85_15').spec)) }, chemistry: { enabled: true, shade: 'medium' } });
  assert(mel.success && mel.chemistry.ground, 'a melange yarn has its chemistry too');
  const lyc = base({ elastane: { denier: 40, draft: 2.6 }, chemistry: { enabled: true, shade: 'dark' } });
  assert(lyc.success && lyc.chemistry.ground.identity.fibres.elastane > 0, 'the elastane of the Lycra card is in the yarn\'s chemistry');
  console.log('✓ Studio: chemistry only on request, at the solved count, blend / filament / melange / elastane yarns');
}
console.log('Yarn chemistry engine tests passed');
