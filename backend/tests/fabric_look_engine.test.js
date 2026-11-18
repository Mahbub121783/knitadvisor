// Fabric look engine: the lustre and texture of a cloth, from the yarn through knitting, dyeing and finishing; what the 3D views are given.
const assert = require('assert');
const L = require('../engine/domain/fabric-look-engine');
const BY = require('../engine/domain/blend-yarn-engine');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Fabric Look Engine Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const finite = (o, path = '') => {
  if (o == null) return;
  if (typeof o === 'number') { assert(Number.isFinite(o), `non-finite number at ${path}`); return; }
  if (typeof o === 'object') for (const [k, v] of Object.entries(o)) finite(v, path + '.' + k);
};
const STRUCT = { wpc: 12, cpc: 16.5, loop_mm: 2.5, yarn_d_mm: 0.16, relief: 0.13, face_knit_share: 1, tuck_share: 0, miss_share: 0 };
const look = (mix, finish, extra = {}) => L.analyse({ yarns: [{ role: 'ground', mix, tex: 19.7, spinning: 'combed' }], structure: STRUCT, finish, ...extra });
const fin = (r) => r.face.final, st = (r, id) => r.face.stages.find((s) => s.id === id);

// ── 1. the stages carry the yarn's own figures ───────────────────────────────────────────────
{
  const r = look({ cotton: 60, polyester: 40 }, { shade: 'medium' });
  const blend = BY.analyse({ fibres: { cotton: 60, polyester: 40 }, count: { value: 19.7, unit: 'tex' }, spinning: 'combed' });
  near(st(r, 'yarn').sheen_index.value, blend.lustre.index.value, 0.2, 'the yarn stage is the blend engine\'s sheen');
  near(st(r, 'yarn').hairiness.value, blend.texture.hairiness_vs_combed_cotton.value, 0.02, 'and its hairiness');
  near(st(r, 'yarn').softness.value, blend.texture.softness.value, 0.2);
  assert.deepStrictEqual(r.face.stages.map((s) => s.id), ['yarn', 'knitted', 'scoured', 'dyed', 'finished']);
  assert(r.face.stages.every((s) => s.lustre >= 0 && s.lustre < 1 && s.perceived_gloss.value > 0 && s.perceived_gloss.value < 100 && s.stitch_definition.value > 0 && s.stitch_definition.value <= 100));
  assert(r.derivations.length >= 4 && r.derivations.every((d) => d.formula && d.working && d.result != null && d.basis));
  console.log('✓ stages: yarn, knitted, scoured, dyed, finished — the yarn stage is the blend engine\'s own figures');
}

// ── 2. knitting, dyeing: the geometry and the colour ─────────────────────────────────────────
{
  // a tighter cloth covers more and shows more gloss; a looser one less
  const tight = L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 }, tex: 19.7, spinning: 'combed' }], structure: { ...STRUCT, loop_mm: 2.2, wpc: 15, cpc: 21 }, finish: { shade: 'medium' } });
  const loose = L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 }, tex: 19.7, spinning: 'combed' }], structure: { ...STRUCT, loop_mm: 3.2, wpc: 9, cpc: 12 }, finish: { shade: 'medium' } });
  assert(st(tight, 'knitted').sheen_index.value > st(loose, 'knitted').sheen_index.value, 'a tighter cloth covers more');
  assert(tight.face.geometry.cover > loose.face.geometry.cover);
  // tucks break the alignment, floats add sheen
  const tucky = look({ cotton: 100 }, { shade: 'medium' }, { structure: { ...STRUCT, tuck_share: 0.3 } }), floaty = look({ cotton: 100 }, { shade: 'medium' }, { structure: { ...STRUCT, miss_share: 0.3 } });
  assert(st(tucky, 'knitted').sheen_index.value < st(look({ cotton: 100 }, { shade: 'medium' }), 'knitted').sheen_index.value && st(floaty, 'knitted').sheen_index.value > st(look({ cotton: 100 }, { shade: 'medium' }), 'knitted').sheen_index.value);
  // the colour sets the CONTRAST of the same gloss: black ≫ medium ≫ white, the specular strength unchanged
  const w = look({ cotton: 100 }, { shade: 'white' }), m = look({ cotton: 100 }, { shade: 'medium' }), b = look({ cotton: 100 }, { shade: 'black' });
  assert(fin(b).perceived_gloss.value > fin(m).perceived_gloss.value && fin(m).perceived_gloss.value > fin(w).perceived_gloss.value, 'dark cloth shows gloss more');
  near(fin(b).sheen_index.value, fin(w).sheen_index.value, 0.01, 'the sheen itself does not depend on the colour');
  // the law: C = Rs ÷ (Rs + Rd)
  const Rs = Math.pow(0.55 / 2.55, 2) * fin(b).sheen_index.value / 100; near(fin(b).perceived_gloss.value, Rs / (Rs + 0.04) * 100, 0.2, 'contrast = Rs ÷ (Rs + Rd)');
  // a colour given as a hex is read into a depth
  assert.strictEqual(look({ cotton: 100 }, { colour: '#1d1d20' }).cloth.shade, 'black'); assert.strictEqual(look({ cotton: 100 }, { colour: '#f4f1ea' }).cloth.shade, 'white'); assert.strictEqual(look({ cotton: 100 }, {}).cloth.shade, 'medium');
  console.log('✓ knitting and dyeing: cover, tucks and floats, the colour sets the gloss contrast (Rs ÷ (Rs + Rd))');
}

// ── 3. finishing ─────────────────────────────────────────────────────────────────────────────
{
  const none = look({ cotton: 100 }, { shade: 'medium', biopolish: false, heatset: false, softener: false });
  // mercerising lifts the cotton's sheen by the measured multiple
  const merc = look({ cotton: 100 }, { shade: 'medium', mercerise: true, biopolish: false, heatset: false, softener: false });
  near(fin(merc).sheen_index.value / fin(none).sheen_index.value, 2.44, 0.1, 'cotton × 2.44 (the table\'s multiple)');
  assert.strictEqual(merc.render.physics.finish_id, 'mercerized');
  // a polyester-rich yarn is hardly changed by it
  assert(fin(look({ polyester: 80, cotton: 20 }, { shade: 'medium', mercerise: true })).sheen_index.value / fin(look({ polyester: 80, cotton: 20 }, { shade: 'medium' })).sheen_index.value < 1.3);
  // bio-polish: the cellulosic hairs go, the polyester's stay
  const polish = look({ cotton: 100 }, { shade: 'medium', biopolish: true }), polyBlend = look({ cotton: 50, polyester: 50 }, { shade: 'medium', biopolish: true }), polyOnly = look({ polyester: 100 }, { shade: 'medium', biopolish: true });
  near(fin(polish).hairiness.value / st(polish, 'dyed').hairiness.value, 0.3, 0.02, 'a bio-polish leaves 30 % of cotton\'s hairs');
  assert(fin(polyBlend).hairiness.value / st(polyBlend, 'dyed').hairiness.value > 0.4 && fin(polyOnly).hairiness.value === st(polyOnly, 'dyed').hairiness.value, 'the polyester\'s hairs stay');
  assert(polish.render.physics.finish_id === 'enzyme_wash' && fin(polish).roughness.value < st(polish, 'dyed').roughness.value && fin(polish).stitch_definition.value > st(polish, 'dyed').stitch_definition.value, 'smoother, sharper stitches');
  // brushing: the nap up, the gloss and the definition down
  const br = L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 }, tex: 19.7, spinning: 'combed' }, { role: 'loop', mix: { cotton: 100 }, tex: 60, spinning: 'open_end' }], structure: STRUCT, finish: { shade: 'medium', brushed: 'back' } });
  assert(br.back && br.back.final.hairiness.value > br.back.stages[1].hairiness.value * 3 && br.back.final.sheen_index.value < br.back.stages[1].sheen_index.value * 0.6 && br.back.final.stitch_definition.value < br.back.stages[1].stitch_definition.value);
  assert.strictEqual(br.render_back.physics.finish_id, 'brushed'); assert.notStrictEqual(br.render.physics.finish_id, 'brushed', 'the face is not raised');
  assert(look({ cotton: 100 }, { shade: 'medium' }).back === null, 'no back look without a back yarn or a raised back');
  // softener: smoother and softer; heat-set: polyester a little brighter and stiffer
  const soft = look({ cotton: 100 }, { shade: 'medium', softener: true, biopolish: false }), nosoft = look({ cotton: 100 }, { shade: 'medium', softener: false, biopolish: false });
  assert(fin(soft).softness.value > fin(nosoft).softness.value && fin(soft).roughness.value < fin(nosoft).roughness.value);
  assert(fin(look({ polyester: 100 }, { heatset: true })).sheen_index.value > fin(look({ polyester: 100 }, { heatset: false })).sheen_index.value);
  console.log('✓ finishing: mercerising × 2.44, bio-polish cuts cotton\'s hairs only, brushing, softener, heat-set');
}

// ── 4. yarns of every kind, and what the 3D views are given ─────────────────────────────────
{
  // spinning system: compact is glossier and less hairy than open-end
  const sys = (s) => L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 }, tex: 19.7, spinning: s }], structure: STRUCT, finish: { shade: 'medium' } });
  assert(fin(sys('compact')).sheen_index.value > fin(sys('open_end')).sheen_index.value && sys('compact').render.yarn_look.hairAbs < sys('open_end').render.yarn_look.hairAbs);
  // a filament yarn: no hairs, the polymer's own sheen, a lustrous class; bright is more lustrous than semi-dull
  const fil = (lus) => L.analyse({ yarns: [{ role: 'ground', mix: { polyester: 100 }, tex: 16.7, filament: true, type: 'fdy', lustre: lus }], structure: STRUCT, finish: { shade: 'dark' } });
  assert(fil('bright').face.final.sheen_index.value > fil('semi_dull').face.final.sheen_index.value && fil('bright').render.yarn_look.filament && fil('bright').render.yarn_look.hairAbs < 0.1);
  assert(fil('bright').render.physics.roughness < look({ cotton: 100 }, { shade: 'dark' }).render.physics.roughness, 'a bright filament is smoother than cotton');
  // the render object: the renderer's fields, in range
  const r = look({ cotton: 60, polyester: 40 }, { shade: 'dark', dye_method: 'disperse' });
  const p = r.render.physics, y = r.render.yarn_look;
  assert(p.roughness >= 0.2 && p.roughness <= 0.95 && p.specular_sheen >= 0 && p.specular_sheen <= 0.7 && p.shadow_depth >= 0.05 && p.shadow_depth <= 0.31 && ['none', 'brushed', 'mercerized', 'enzyme_wash', 'silicone'].includes(p.finish_id));
  assert(y.gloss >= 0.5 && y.gloss <= 3 && y.hairAbs > 0 && y.bulk > 0 && typeof y.lustre_class === 'string');
  assert.strictEqual(r.render.dye_method, 'disperse'); assert.strictEqual(r.render.fibre_type, 'cotton'); assert.strictEqual(look({ polyester: 100 }, {}).render.fibre_type, 'polyester'); assert.strictEqual(look({ viscose: 100 }, {}).render.fibre_type, 'viscose');
  // the lustre scale of the yarn-character engine round-trips
  for (const l of [0.1, 0.5, 0.95]) near(L.lustreOf(L.indexOf(l)), l, 1e-6);
  // a looser cloth casts deeper shadows
  assert(L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 }, tex: 19.7 }], structure: { ...STRUCT, loop_mm: 3.4, wpc: 8, cpc: 10 }, finish: {} }).render.physics.shadow_depth > look({ cotton: 100 }, {}).render.physics.shadow_depth);
  console.log('✓ yarns: spinning system, filament lustre; the render object is in the renderer\'s ranges');
}

// ── 5. bad input and a random field ──────────────────────────────────────────────────────────
{
  assert.throws(() => L.analyse(null), /Give the cloth/); assert.throws(() => L.analyse({ yarns: [] }), /at least one yarn/); assert.throws(() => L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 } }] }), /at least one yarn/);
  assert(L.analyse({ yarns: [{ role: 'ground', mix: { constructor: 50, cotton: 50 }, tex: 20 }] }).success, 'an unknown fibre key is ignored, never a path into Object.prototype');
  assert(L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 100 }, tex: 20 }], finish: { shade: '__proto__', brushed: 'constructor' } }).cloth.shade === 'medium');
  let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ids = ['cotton', 'polyester', 'viscose', 'modal', 'tencel', 'nylon', 'acrylic', 'wool'];
  for (let i = 0; i < 300; i++) {
    const k = 1 + Math.floor(rnd() * 3), pick = ids.slice().sort(() => rnd() - 0.5).slice(0, k), mix = {};
    pick.forEach((x) => { mix[x] = 5 + Math.floor(rnd() * 90); });
    const yarns = [{ role: 'ground', mix, tex: 8 + rnd() * 70, spinning: ['carded', 'combed', 'compact', 'open_end', 'vortex', undefined][Math.floor(rnd() * 6)], filament: rnd() < 0.1 && k === 1 && (pick[0] === 'polyester' || pick[0] === 'nylon'), type: 'dty' }];
    if (rnd() < 0.3) yarns.push({ role: 'loop', mix: { cotton: 100 }, tex: 30 + rnd() * 40, spinning: 'open_end' });
    const r = L.analyse({ yarns, structure: { wpc: 6 + rnd() * 14, cpc: 8 + rnd() * 18, loop_mm: 1.5 + rnd() * 3, yarn_d_mm: 0.1 + rnd() * 0.2, relief: rnd(), face_knit_share: rnd(), tuck_share: rnd() * 0.5, miss_share: rnd() * 0.5 }, finish: { shade: L.analyse.length ? ['white', 'pastel', 'light', 'medium', 'dark', 'black'][Math.floor(rnd() * 6)] : 'medium', mercerise: rnd() < 0.3, biopolish: rnd() < 0.7, heatset: rnd() < 0.5, softener: rnd() < 0.7, brushed: ['none', 'face', 'back', 'both'][Math.floor(rnd() * 4)] } });
    finite(r);
    assert(r.face.stages.length === 5 && r.render.physics.roughness >= 0.2 && r.render.yarn_look.gloss >= 0.5);
  }
  console.log('✓ bad input in words, prototype keys harmless, 300 random cloths finite and in range');
}

// ── 6. the Studio: the look rides on the analysis when asked, from the real yarn and the real cloth ────
{
  const base = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, ...extra });
  assert.strictEqual(base({}).look, null, 'no look unless asked');
  const a = base({ blend: { ground: { fibres: { cotton: 60, polyester: 40 } } }, look: { colour: '#1d1d20' } });
  assert(a.success && a.look && a.look.cloth.shade === 'black' && a.look.face.yarn === 'CVC 60/40');
  near(a.look.face.geometry.cover, a.fabric.sl_mm * a.yarn.ground.d_mm * (a.fabric.wpc * a.fabric.cpc) / 100, 0.05, 'the cover is worked out from the Studio\'s own loop length, yarn diameter and densities');
  const plain = base({ look: { shade: 'medium' } }); assert(plain.look.face.yarn === 'Cotton');
  assert(fin(a.look).hairiness.value < st(a.look, 'dyed').hairiness.value, 'the default finish bio-polishes');
  // the structure matters: a tuck design reads differently from plain jersey
  const tuck = S.analyse({ bed: 'single', grid: { C: ['KT', 'TK'], D: null }, feeds: [{ role: 'ground' }, { role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, look: { shade: 'medium' } });
  assert(tuck.success && tuck.look.face.geometry.alignment <= plain.look.face.geometry.alignment + 1e-9 && tuck.look.face.stages[1].roughness.value >= plain.look.face.stages[1].roughness.value, 'a tuck structure has more relief');
  // the chemistry card's dye class sets the dye method; a filament yarn and a melange work too
  const dis = base({ yarn: { fibre: 'polyester_spun', type: 'combed', count: 30, unit: 'ne' }, chemistry: { enabled: true, shade: 'dark' }, look: { colour: '#222222' } });
  assert.strictEqual(dis.look.render.dye_method, 'disperse');
  assert(base({ yarn: { fibre: 'polyester_filament', type: 'dty', count: 150, unit: 'denier' }, look: { shade: 'dark' } }).look.render.yarn_look.filament);
  assert(base({ melange: { ground: JSON.parse(JSON.stringify(require('../engine/domain/melange-engine').PRESETS.find((p) => p.id === 'grey_85_15').spec)) }, look: { shade: 'light' } }).look);
  console.log('✓ Studio: the look from the real yarn, the real loop length and density, the chemistry card\'s dye class');
}

// ── 7. the glossmeter: a measured gloss fits the model ───────────────────────────────────────
{
  const mk = (gloss, shade) => L.analyse({ yarns: [{ role: 'ground', mix: { cotton: 60, polyester: 40 }, tex: 19.7, spinning: 'combed' }], structure: STRUCT, finish: { shade: shade || 'dark' }, gloss });
  const none = mk(undefined);
  assert.strictEqual(none.calibration, null);
  // predicted gloss units are in a textile's range and follow the sheen, the roughness and the geometry
  assert(none.face.stages.every((s) => s.gloss_units.value > 0.5 && s.gloss_units.value < 60 && s.gloss_units.basis === 'estimate'), 'a textile reads a few GU');
  assert(L.guOf(300, 20, 60) > L.guOf(100, 20, 60) && L.guOf(100, 60, 60) < L.guOf(100, 20, 60), 'more sheen more gloss; rougher, less');
  near(L.fresnel(1.55, 0.001), Math.pow(0.55 / 2.55, 2), 1e-4, 'normal incidence'); assert(L.fresnel(1.55, 85) > L.fresnel(1.55, 60) && L.fresnel(1.55, 60) > L.fresnel(1.55, 20));
  near(L.fresnel(1.567, 60), 0.1, 0.006, 'polished black glass reflects 10 % at 60°: 100 GU');
  // one reading of the knitted cloth: the model reproduces it, and every later stage scales with it
  const pk = none.face.stages.find((s) => s.id === 'knitted').gloss_units.value;
  const a = mk({ readings: [{ stage: 'knitted', gu: pk * 2 }] });
  assert(a.calibration.applied && a.calibration.basis === 'calibrated' && a.calibration.fitted.finish_scale === 1);
  near(a.face.stages.find((s) => s.id === 'knitted').gloss_units.value, pk * 2, 0.06, 'the knitted stage now reads what was measured');
  near(a.face.final.sheen_index.value / none.face.final.sheen_index.value, 2, 0.05, 'and the finished cloth scales with it');
  assert(a.face.stages.find((s) => s.id === 'knitted').gloss_units.basis === 'calibrated' && a.face.stages[0].gloss_units.basis === 'estimate', 'the yarn stage is the blend engine own figure, not fitted');
  // two readings, knitted and finished: the finishing effect is fitted on its own
  const pf = none.face.stages.find((s) => s.id === 'finished').gloss_units.value;
  const b = mk({ readings: [{ stage: 'knitted', gu: pk }, { stage: 'finished', gu: pf * 1.5 }] });
  near(b.calibration.fitted.specular_scale, 1, 0.02); near(b.calibration.fitted.finish_scale, 1.5, 0.05, 'the finishing lifts the gloss by what was measured');
  near(b.face.stages.find((s) => s.id === 'finished').gloss_units.value, pf * 1.5, 0.1);
  near(b.face.stages.find((s) => s.id === 'knitted').gloss_units.value, pk, 0.06);
  // only the finished cloth measured: the whole fabric-level strength is fitted to it
  const c = mk([{ stage: 'finished', gu: pf * 0.5 }]); near(c.face.stages.find((s) => s.id === 'finished').gloss_units.value, pf * 0.5, 0.06); assert.strictEqual(c.calibration.fitted.finish_scale, 1);
  // a brighter measured cloth gives the 3D view a smoother, glossier material
  const dull = mk({ readings: [{ stage: 'finished', gu: pf * 0.3 }] }), shiny = mk({ readings: [{ stage: 'finished', gu: pf * 3 }] });
  assert(shiny.render.physics.roughness < dull.render.physics.roughness && shiny.render.physics.specular_sheen >= dull.render.physics.specular_sheen && shiny.face.final.perceived_gloss.value > dull.face.final.perceived_gloss.value);
  // the geometry: a 20° reading of the same cloth gives a different ratio, but the fit still reproduces it
  const d = mk({ readings: [{ stage: 'finished', gu: 1.2, angle: 20 }] });
  near(L.guOf(d.face.final.sheen_index.value, d.face.final.roughness.value, 20), 1.2, 0.08, 'a 20° reading is reproduced at 20°');
  // bad readings in words
  assert.throws(() => mk({ readings: [{ stage: 'finished', gu: -4 }] }), /gloss units/); assert.throws(() => mk({ readings: [{ stage: 'finished', gu: 5000 }] }), /gloss units/);
  assert.throws(() => mk({ readings: [{ stage: 'wet', gu: 5 }] }), /stage is one of/); assert.throws(() => mk({ readings: [{ stage: 'finished', gu: 5, angle: 45 }] }), /20, 60 or 85/);
  assert.strictEqual(mk({ readings: [{ stage: 'finished', gu: '' }] }).calibration, null, 'an empty reading is no reading');
  // through the Studio
  const base = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, ...extra });
  const s1 = base({ look: { shade: 'dark', gloss: { readings: [{ stage: 'finished', gu: 9 }] } } });
  assert(s1.look.calibration && near(L.guOf(s1.look.face.final.sheen_index.value, s1.look.face.final.roughness.value, 60), 9, 0.15) === undefined);
  const bad = base({ look: { shade: 'dark', gloss: { readings: [{ stage: 'finished', gu: -1 }] } } });
  assert.strictEqual(bad.success, true); assert.strictEqual(bad.look.success, false); assert(/gloss units/.test(bad.look.error), 'a bad reading comes back in words, the analysis still works');
  console.log('✓ glossmeter: predicted GU in the range of a textile, Fresnel at 20/60/85°, one or two readings fit the model exactly, the 3D material follows');
}
console.log('Fabric look engine tests passed');
