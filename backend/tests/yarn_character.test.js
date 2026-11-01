// Yarn character — the KIND of yarn (spinning system, form, polyester) and what
// it does to the numbers, the optics and the look.
const assert = require('assert');
const { calculate } = require('../engine');
const { yarnCharacter } = require('../engine/domain/yarn-character');

console.log('--- Running Yarn Character Tests ---');
const run = (extra, comp = '100% Cotton') => calculate({ fabric: 'single_jersey', gsm: 180, composition: comp, efficiency: 85, ...extra });
const ex = (r) => r.yarn.expertise;

// 1. every spinning system resolves, and they order the way a spinner expects
{
  const sys = ['carded', 'combed', 'compact', 'siro', 'siro_compact', 'open_end', 'vortex'];
  const R = Object.fromEntries(sys.map((s) => [s, run({ spinning_system: s })]));
  for (const s of sys) assert.strictEqual(ex(R[s]).spinning_system.key, s, `${s} is honoured`);
  const rkm = (s) => ex(R[s]).properties.tenacity_rkm;
  assert(rkm('siro') > rkm('combed') && rkm('siro_compact') > rkm('siro') && rkm('combed') > rkm('carded') && rkm('carded') > rkm('open_end'), 'strength: siro-compact > siro > combed > carded > open-end');
  const hair = (s) => ex(R[s]).character.hair_factor;
  assert(hair('carded') > hair('combed') && hair('combed') > hair('compact') && hair('compact') > hair('siro_compact') - 0.3, 'hairiness falls from carded to compact');
  assert(hair('siro_compact') < hair('siro') && hair('siro') < hair('combed'), 'siro is cleaner than ring, siro-compact cleaner still');
  assert(hair('vortex') < hair('compact'), 'air-jet is the cleanest');
  const spir = (s) => R[s].quality_prediction.spirality.predicted_pct;
  assert(spir('siro') < spir('combed') && spir('vortex') < spir('siro'), `spirality: siro ${spir('siro')} < combed ${spir('combed')}; air-jet ${spir('vortex')} lowest`);
  const pill = (s) => R[s].quality_prediction.pilling.score;
  assert(pill('compact') > pill('combed') && pill('combed') > pill('carded'), 'pilling: compact > combed > carded');
  assert(ex(R.open_end).diameter_mm > ex(R.combed).diameter_mm && ex(R.siro_compact).diameter_mm < ex(R.combed).diameter_mm, 'open-end is bulkier, siro-compact slimmer');
  // the choice drives the yarn price: carded and open-end are the cheaper rows
  const price = (s) => R[s].costing.yarn_final_price_usd;
  assert(price('carded') < price('combed') && price('open_end') < price('combed'), `price: carded ${price('carded')} < combed ${price('combed')}`);
}

// 2. 2-ply balances the twist
{
  const single = run({ spinning_system: 'combed' }), ply = run({ spinning_system: 'combed', yarn_form: 'ply2' });
  assert(ply.quality_prediction.spirality.predicted_pct < single.quality_prediction.spirality.predicted_pct * 0.5, '2-ply cuts spirality');
  assert(ex(ply).diameter_mm > ex(single).diameter_mm, '2-ply is a little larger');
}

// 3. polyester: lustre and form decide the shine
{
  const sheen = (e, c = '100% Polyester') => run(e, c).fabric_physics.physics.specular_sheen;
  const brightFdy = sheen({ poly_form: 'fdy', poly_lustre: 'bright' });
  const semiDty = sheen({ poly_form: 'dty', poly_lustre: 'semi_dull' });
  const dullStaple = sheen({ poly_form: 'staple', poly_lustre: 'full_dull' });
  assert(brightFdy > 0.85 && brightFdy > semiDty && semiDty > dullStaple, `shine: bright FDY ${brightFdy} > semi-dull DTY ${semiDty} > full-dull staple ${dullStaple}`);
  assert(dullStaple < 0.4, 'a full-dull spun polyester is nearly cotton-flat');
  // a blend: the polyester shows through in proportion
  const cvcBright = sheen({ poly_form: 'staple', poly_lustre: 'bright' }, '60% Cotton 40% Polyester');
  const cvcDull = sheen({ poly_form: 'staple', poly_lustre: 'full_dull' }, '60% Cotton 40% Polyester');
  const cotton = sheen({}, '100% Cotton');
  assert(cvcBright > cvcDull && cvcDull > cotton - 0.01, `CVC: bright ${cvcBright} > full-dull ${cvcDull} >= cotton ${cotton}`);
  // a bright fibre reads deeper, a full-dull one lighter
  const L = (e) => run(e, '100% Polyester').fabric_physics.rendered_color.hsl.l;
  assert(L({ poly_form: 'fdy', poly_lustre: 'bright' }) <= L({ poly_form: 'fdy', poly_lustre: 'full_dull' }), 'a dull polyester reads lighter than a bright one');
  // a filament has no hair, a staple has
  const fil = run({ poly_form: 'fdy' }, '100% Polyester').yarn.expertise.character, stp = run({ poly_form: 'staple' }, '100% Polyester').yarn.expertise.character;
  assert(fil.filament_only && fil.look.filament && fil.look.hairAbs < 0.1, 'filament: no fibre ends');
  assert(!stp.filament_only && stp.look.hairAbs > 0.4, 'staple: fibre ends');
  assert(stp.polyester.assumed_lustre && fil.polyester.assumed_lustre, 'an unchosen lustre is reported as assumed');
  // filament polyester does not pill; the spinning system is irrelevant to it
  assert(run({ poly_form: 'fdy' }, '100% Polyester').quality_prediction.pilling.score > run({ poly_form: 'staple' }, '100% Polyester').quality_prediction.pilling.score + 1, 'filament polyester pills far less than staple');
  assert(fil.warnings.length === 0, 'no spinning warning without a spinning choice');
  assert(run({ poly_form: 'fdy', spinning_system: 'carded' }, '100% Polyester').yarn.expertise.character.warnings.some((w) => /filament/.test(w)), 'a spinning choice on a filament is flagged');
  // default form: a cotton blend is spun staple; 100% polyester is a textured filament
  assert.strictEqual(run({}, '60% Cotton 40% Polyester').yarn.expertise.character.polyester.form, 'staple');
  assert.strictEqual(run({}, '100% Polyester').yarn.expertise.character.polyester.form, 'dty');
  // no polyester, no polyester block
  assert.strictEqual(run({}).yarn.expertise.character.polyester, null);
}

// 4. the look handed to the 3D and Realistic views
{
  const k = run({ spinning_system: 'carded' }).yarn.expertise.character.look;
  const c = run({ spinning_system: 'siro_compact' }).yarn.expertise.character.look;
  assert(k.hairAbs > c.hairAbs * 2 && k.gloss < c.gloss && k.bulk > c.bulk, 'carded: hairier, flatter, bulkier than siro-compact');
  assert(run({ yarn_form: 'slub' }).yarn.expertise.character.look.slub, 'slub form is passed on');
  assert.strictEqual(run({ yarn_form: 'ply2' }).yarn.expertise.character.look.ply, 2);
}

// 5. warp knit: no yarn analysis, but a polyester filament still gets its character
{
  const w = calculate({ fabric: 'tricot_plain', gsm: 140, composition: '100% Polyester', poly_lustre: 'bright', efficiency: 85 });
  assert(w.yarn.character && w.yarn.character.filament_only, 'warp knit polyester is a filament');
  assert(w.fabric_physics.physics.specular_sheen > 0.85, 'and a bright one shines');
}

// 6. direct unit: the character's effects are written for a reader, and cite no source
{
  const ch = run({ spinning_system: 'open_end', poly_lustre: 'bright', poly_form: 'staple' }, '60% Cotton 40% Polyester').yarn.expertise.character;
  assert(ch.effects.length >= 6 && ch.process.length >= 2, 'effects and finishing notes present');
  assert(ch.warnings.some((w) => /pill/i.test(w)), 'open-end with 40% polyester is warned about pilling');
  const txt = JSON.stringify(ch);
  assert(!/Hearle|Munden|Klein|textilelearner|Uster Statistics 2018/i.test(txt), 'no source attribution in the API');
  const bare = yarnCharacter({});
  assert(bare.system.key === 'combed' && bare.look.hairAbs === 1, 'defaults to a combed ring cotton');
}

// 7. the cache key must see the new inputs
{
  const a = run({ poly_lustre: 'bright', poly_form: 'fdy' }, '100% Polyester'), b = run({ poly_lustre: 'full_dull', poly_form: 'fdy' }, '100% Polyester');
  assert.notStrictEqual(a.fabric_physics.physics.specular_sheen, b.fabric_physics.physics.specular_sheen);
  const { ENGINE_INPUTS } = require('../engine');
  assert(ENGINE_INPUTS.includes('poly_lustre') && ENGINE_INPUTS.includes('poly_form'), 'poly inputs are on the whitelist');
}

console.log('\nAll yarn character tests passed.');
