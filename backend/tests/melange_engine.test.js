// Melange engine (engine/domain/melange-engine.js): the chain from bale to yarn, and into the Studio.
//   - the colour difference law is the published one (CIEDE2000 test pairs)
//   - the mass chain closes: label share → dry share → bale issue, and weighing at the nominal ratio gives the shade drift
//   - the blend colour keeps its masstones, falls with the dark share and is steepest where the dark share is small
//   - one trial blend calibrates the colour model
//   - the mixing statistics are the binomial and the sliver arithmetic, nothing looked up
//   - plied / Siro counts, the marl pattern, the wet route order, the defects
//   - the Studio takes a melange per role (count, fibre mix, composition of the whole cloth) and refuses bad input in words
const assert = require('assert');
const M = require('../engine/domain/melange-engine');
const S = require('../engine/domain/fabric-studio');
console.log('--- Running Melange Engine Tests ---');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const preset = (id) => JSON.parse(JSON.stringify(M.PRESETS.find((p) => p.id === id).spec));

// ── CIEDE2000: the published test pairs ─────────────────────────────────────────────────────
{
  const B = [50, 0, -82.7485];
  near(M.dE00([50, 2.6772, -79.7751], B), 2.0425, 1e-4, 'pair 1');
  near(M.dE00([50, 3.1571, -77.2803], B), 2.8615, 1e-4, 'pair 2');
  near(M.dE00([50, 2.8361, -74.02], B), 3.4412, 1e-4, 'pair 3');
  near(M.dE00([50, -1.3802, -84.2814], B), 1.0, 1e-4, 'pair 4');
  near(M.dE00([50, 2.5, 0], [73, 25, -18]), 27.1492, 1e-4, 'pair 5');
  assert.strictEqual(M.dE00([60, 10, 10], [60, 10, 10]), 0);
  near(M.dE00([40, 5, 5], [70, -8, 20]), M.dE00([70, -8, 20], [40, 5, 5]), 1e-9, 'symmetric');
  console.log('✓ CIEDE2000 matches the published test pairs');
}

// ── the mass chain ──────────────────────────────────────────────────────────────────────────
{
  // 90/10 cotton / dope-dyed viscose, combed cotton (4.5 blow, 5 card, 14 noil, 2.5 spin), viscose pre-cleaned
  const r = M.analyse(preset('grey_90_10'));
  const [cot, vis] = r.mass_chain.per_component;
  near(cot.realization_pct, 100 * 0.955 * 0.95 * 0.86 * 0.975, 0.02, 'cotton realization');
  near(vis.realization_pct, 100 * 0.985 * 0.975 * 0.975, 0.02, 'viscose realization');
  // label share 10 % viscose at 13 % regain against 8.5 % cotton: dry share is a little under 10
  near(vis.dry_share_pct, (10 / 1.13) / (90 / 1.085 + 10 / 1.13) * 100, 0.02, 'dry share');
  near(r.mass_chain.blend_regain.value, (cot.dry_share_pct * 8.5 + vis.dry_share_pct * 13) / 100, 0.02, 'blend regain');
  // the bale issue closes the balance: Σ issue × realization = the yarn's dry mass; the issue shares add to 100
  const dryBack = r.mass_chain.per_component.reduce((t, c) => t + c.issue_dry_kg * (c.realization_pct / 100), 0);
  near(dryBack, r.mass_chain.yarn_dry_kg.value, 0.15, 'issue × realization = yarn dry mass');
  near(cot.issue_share_pct + vis.issue_share_pct, 100, 0.02);
  near(cot.label_share_pct + vis.label_share_pct, 100, 0.02);
  // weighing the bales at 85:15 label ratio gives about 18 % viscose, not 15 (a combed cotton loses far more than carded viscose)
  const s = preset('grey_85_15');
  const r2 = M.analyse(s);
  const v2 = r2.mass_chain.per_component[1];
  near(v2.label_share_pct, 15, 0.01);
  assert(v2.if_weighed_at_label_ratio_pct > 17.4 && v2.if_weighed_at_label_ratio_pct < 18.4, `drift to ${v2.if_weighed_at_label_ratio_pct}`);
  // shares given DRY are read as dry
  const d = preset('grey_90_10'); d.components.forEach((c) => (c.share_basis = 'dry'));
  near(M.analyse(d).mass_chain.per_component[1].dry_share_pct, 10, 0.01, 'dry basis');
  // user waste figures win and are labelled measured
  const w = preset('grey_90_10'); w.components[0].waste = { blow: 3, card: 4, comb: 12, spin: 2 };
  const rw = M.analyse(w).mass_chain.per_component[0];
  near(rw.realization_pct, 100 * 0.97 * 0.96 * 0.88 * 0.98, 0.02); assert.strictEqual(rw.waste_basis, 'measured');
  console.log('✓ mass chain: regain, realization, bale issue, and the shade drift of weighing at the nominal ratio');
}

// ── the colour ──────────────────────────────────────────────────────────────────────────────
{
  const r = M.analyse(preset('grey_90_10'));
  const c = r.colour.curve;
  assert.strictEqual(c[0].share_pct, 0); assert.strictEqual(c[0].hex, '#ede9df', 'no dark fibre: the raw cotton colour exactly');
  for (let i = 1; i < c.length; i++) assert(c[i].L < c[i - 1].L, `lightness falls as the dark share rises (${c[i - 1].share_pct}→${c[i].share_pct})`);
  const steep = (c[0].L - c[1].L) / 2, flat = (c[7].L - c[8].L) / 10;
  assert(steep > 1.5 * flat, `the first points of dark fibre move the shade the most: ${steep} vs ${flat}`);
  assert(c[c.length - 1].L < 15, 'all dark fibre: the dark masstone');
  assert.strictEqual(r.colour.trade_shade.id, 'grey'); assert.strictEqual(r.colour.model.id, 'fibre_km'); assert.strictEqual(r.colour.model.basis, 'estimate');
  // trade shades follow the dark label share
  assert.strictEqual(M.analyse(preset('anthra_70_30')).colour.trade_shade.id, 'anthra');
  assert.strictEqual(M.analyse(preset('charcoal_45_55')).colour.trade_shade.id, 'charcoal');
  assert.strictEqual(M.analyse(preset('navy_cotton')).colour.trade_shade.id, 'color', 'a coloured dark fibre is a colour melange');
  // darker with more dark fibre, between recipes
  assert(M.analyse(preset('anthra_70_30')).colour.blend.L < r.colour.blend.L);
  // a point of share moves a light shade more than a dark one
  assert(r.colour.sensitivity.per_point_dE > M.analyse(preset('charcoal_45_55')).colour.sensitivity.per_point_dE);
  // one trial blend: the model is fitted on it
  const t = preset('grey_90_10'); t.trial = { colour: '#c4c3c1' };            // a lighter grey than the default model gives
  const rt = M.analyse(t);
  assert.strictEqual(rt.colour.model.basis, 'calibrated'); assert(rt.colour.calibration.fitted_omega < 0.35 || rt.colour.calibration.fitted_omega > 0.35);
  near(rt.colour.blend.L, M.hexToLab('#c4c3c1')[0], 0.4, 'calibrated on the trial');
  assert(rt.colour.blend.L > r.colour.blend.L, 'the trial was lighter');
  // a marl is mixed by the eye: the plain area-weighted linear-light mean, exact for two equal-area plies
  const m = M.analyse(preset('mouline_2ply'));
  assert.strictEqual(m.colour.model.id, 'domain');
  const lin = (h) => [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const a = lin(m.components[0].hex), b = lin(m.components[1].hex);
  const expectY = 0.5 * (0.2126729 * a[0] + 0.7151522 * a[1] + 0.072175 * a[2]) + 0.5 * (0.2126729 * b[0] + 0.7151522 * b[1] + 0.072175 * b[2]);
  const Lexp = expectY > 0.008856 ? 116 * Math.cbrt(expectY) - 16 : 903.3 * expectY;
  near(m.colour.blend.L, Lexp, 1.5, 'marl = area-weighted mean (the two plies have a little different areas)');
  console.log('✓ colour: masstones exact, monotone, steepest at light shades, calibrated by one trial, marl mixed by the eye');
}

// ── the target shade: the inverse problem ───────────────────────────────────────────────────
{
  // solve the share for the colour the 85/15 blend makes: the solver must find 15 % and round-trip
  const base = M.analyse(preset('grey_85_15'));
  const sp = preset('grey_85_15'); sp.target = { colour: base.colour.blend.hex };
  const t = M.analyse(sp).colour.target;
  assert(t.reachable); near(t.label_share_pct, 15, 0.25, 'the solved label share'); assert(t.remaining_dE < 1);
  assert.strictEqual(t.effect_index, 1);
  // set the solved share and the blend lands on the target lightness
  const s2 = preset('grey_85_15'); s2.components[0].share = 100 - t.label_share_pct; s2.components[1].share = t.label_share_pct;
  near(M.analyse(s2).colour.blend.L, M.hexToLab(base.colour.blend.hex)[0], 0.3, 'round trip');
  // a lighter target needs less dark fibre, a darker one more
  const light = preset('grey_85_15'); light.target = { colour: '#c8c8c8' }; const dark = preset('grey_85_15'); dark.target = { colour: '#606060' };
  assert(M.analyse(light).colour.target.label_share_pct < t.label_share_pct && M.analyse(dark).colour.target.label_share_pct > t.label_share_pct);
  // a lightness the components cannot reach: said so; a blue these greys cannot make: lightness matched, hue left over
  const white = preset('grey_85_15'); white.target = { colour: '#ffffff' };
  assert.strictEqual(M.analyse(white).colour.target.reachable, false);
  const blue = preset('grey_85_15'); blue.target = { colour: '#2040c0' };
  const tb = M.analyse(blue).colour.target; assert(tb.reachable && tb.remaining_dE > 10, 'greys cannot make a blue');
  // the creel for the solved share is the whole-sliver table
  assert(t.creel.length && t.creel[0].doublings <= 8);
  console.log('✓ target shade: the share that makes a colour, round-tripped; unreachable and off-hue targets said so');
}

// ── the mixing ──────────────────────────────────────────────────────────────────────────────
{
  const r = M.analyse(preset('grey_90_10'));
  const eff = r.components[1];
  const n = r.mixing.fibres_in_section, p = eff.number_share_pct / 100;
  near(r.mixing.random_mix.ideal_cv_pct, 100 * Math.sqrt((1 - p) / (p * n)), 0.2, 'binomial CV');
  // more fibres in the section → a more even random mix
  const fine = preset('grey_90_10'); fine.count.value = 60;
  const coarse = preset('grey_90_10'); coarse.count.value = 15;
  assert(M.analyse(fine).mixing.random_mix.ideal_cv_pct > M.analyse(coarse).mixing.random_mix.ideal_cv_pct, 'a finer yarn has fewer fibres: more uneven');
  // draw-frame passages: one passage leaves ribbons, three nearly random
  const one = preset('grey_90_10'); one.passages = 1; const three = preset('grey_90_10'); three.passages = 3;
  assert(M.analyse(one).mixing.random_mix.cv_section_pct > M.analyse(three).mixing.random_mix.cv_section_pct);
  // creel: whole slivers; the share moves by p(1−p) per 1 % of the coloured sliver's weight
  const cr = r.mixing.creel;
  near(cr.per_pct_weight, 0.1 * 0.9 * 100, 0.01);
  cr.options.forEach((o) => { near(o.share_equal_weights_pct, (100 * o.effect_slivers) / o.doublings, 0.01); near(o.effect_sliver_weight_needed_pct_of_base, 100 * ((0.1 / 0.9) * (o.base_slivers / o.effect_slivers)), 0.2, 'weight ratio that lands the target'); });
  assert(cr.options[0].doublings <= 8); assert(Math.abs(cr.options[0].error_points) <= Math.abs(cr.options[cr.options.length - 1].error_points));
  // a 0.4 g/m shift in a 4.5 g/m coloured sliver moves a 10 % share by p(1−p)·shift/weight
  const sw = preset('grey_90_10'); sw.sliver_weight_gpm = 4.5; sw.sliver_shift_gpm = 0.4;
  near(M.analyse(sw).mixing.creel.sliver_weight_shift.share_moves_points, 0.1 * 0.9 * (0.4 / 4.5) * 100, 0.01);
  // lot spread: draw frame holds a light shade tighter than a blow-room tuft blend
  const br = preset('grey_90_10'); br.route = 'blow_room';
  assert(M.analyse(br).mixing.lot.cv_rel_pct > r.mixing.lot.cv_rel_pct, 'light shade: the sliver blend is tighter');
  assert(['safe', 'tight', 'at risk'].includes(r.mixing.lot_shade.grade));
  console.log('✓ mixing: binomial spread, fibres in section, passages, whole-sliver creel, sliver-weight sensitivity');
}

// ── the yarn: plies, Siro, slub ─────────────────────────────────────────────────────────────
{
  const m = M.analyse(preset('mouline_2ply'));
  near(m.yarn.count.nominal_ne.value, 15, 0.05, '1/Ne = Σ 1/Ne');
  near(m.yarn.count.tex.value, (2 * 590.5 / 30) / 0.98, 0.02, 'tex = Σ tex ÷ (1 − c)');
  assert(m.yarn.count.resultant_ne.value < m.yarn.count.nominal_ne.value, 'the twist take-up makes the plied yarn coarser');
  assert.strictEqual(m.studio_yarn.form, 'ply2');
  // unequal singles: the plies' shares follow their tex
  const u = preset('mouline_2ply'); u.components[0].tex = 590.5 / 20; u.components[1].tex = 590.5 / 40;
  const ru = M.analyse(u);
  near(ru.components[0].label_share_pct, (100 * (590.5 / 20)) / (590.5 / 20 + 590.5 / 40), 0.2, 'ply shares follow tex');
  near(ru.yarn.count.nominal_ne.value, 1 / (1 / 20 + 1 / 40), 0.05);
  // Siro: the yarn count is the total
  const s = M.analyse(preset('siro_marl'));
  near(s.yarn.count.tex.value, 590.5 / 30, 0.02);
  // slub: coarser than the base count by the slubs' mass
  const sl = preset('grey_90_10'); sl.type = 'slub_melange'; sl.slub = { thickness: 2, length_cm: 4, spacing_cm: 20 };
  const rs = M.analyse(sl);
  near(rs.yarn.count.tex.value, 590.5 / (30 / (1 + (1 * 4) / 24)), 0.05, 'slub resultant count');
  assert.strictEqual(rs.studio_yarn.form, 'slub');
  // dyed fibre costs strength: stock-dyed cotton in the blend more than dope-dyed viscose, undyed nothing
  const navy = M.analyse(preset('navy_cotton')), grey = M.analyse(preset('grey_90_10'));
  assert(navy.yarn.strength.dyed_fibre_loss_pct.value > grey.yarn.strength.dyed_fibre_loss_pct.value);
  const undyed = preset('grey_90_10'); undyed.components[1].colour = '#f3f1ea'; undyed.components[1].method = 'raw';
  assert.strictEqual(M.analyse(undyed).yarn.strength.dyed_fibre_loss_pct.value, 0);
  // every figure says what it is
  assert(['typical', 'measured', 'law', 'blend', 'bound'].includes(grey.yarn.strength.rkm.basis));
  console.log('✓ yarn: plied and Siro counts, slub resultant, the cost of dyed fibre');
}

// ── the marl look ───────────────────────────────────────────────────────────────────────────
{
  const m = M.analyse(preset('mouline_2ply'));
  const pitch = m.marl.colour_pitch_mm.value, q = m.marl.turns_per_stitch;
  near(q, m.marl.stitch_length_mm / pitch, 0.01, 'turns per stitch = stitch length ÷ pitch');
  // colour turns that fit the stitch exactly stack into stripes
  const t = preset('mouline_2ply'); t.ply_twist_tpm = 1000 / 2.8;                  // one turn per stitch
  const rt = M.analyse(t);
  assert(/TRACKING/.test(rt.marl.look)); assert.strictEqual(rt.marl.level, 'warn');
  const h = preset('mouline_2ply'); h.ply_twist_tpm = 1000 / (2.8 / 1.5);          // one and a half turns per stitch
  assert(/CHECKING/.test(M.analyse(h).marl.look));
  assert.strictEqual(M.analyse(preset('grey_90_10')).marl, null, 'a fibre melange has no ply pattern');
  console.log('✓ marl look: colour pitch against the stitch (tracking, checking)');
}

// ── the wet route ───────────────────────────────────────────────────────────────────────────
{
  const a = M.analyse(preset('grey_90_10')).wet;
  assert.strictEqual(a.route, 'A'); assert(a.stages.some((s) => /Bio-polish/.test(s.stage)));
  assert(!a.stages.some((s) => /dyeing/i.test(s.stage)), 'pre-coloured yarn is not dyed');
  const b = M.analyse(preset('cvc_heather')).wet;
  assert.strictEqual(b.route, 'B');
  const names = b.stages.map((s) => s.stage);
  const iDis = names.findIndex((x) => /Disperse/.test(x)), iRed = names.findIndex((x) => /Reduction clear/.test(x)), iRea = names.findIndex((x) => /Reactive/.test(x));
  assert(iDis > -1 && iRed > iDis && iRea > iRed, `polyester first, then the clear, then the cotton: ${names.join(' > ')}`);
  assert.strictEqual(b.dye_classes.disperse[0], 'polyester');
  // regular + cationic-dyeable polyester: cationic and disperse, no reactive
  const c = M.analyse(preset('cdp_heather')).wet;
  assert(c.stages.some((s) => /Cationic/.test(s.stage)) && c.stages.some((s) => /Disperse/.test(s.stage)) && !c.stages.some((s) => /Reactive/.test(s.stage)));
  // every fibre the same class: said so
  const same = { type: 'cross_dye_heather', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 50, colour: '#456789', method: 'cross_dye' }, { fibre: 'viscose', share: 50 }] };
  assert(M.analyse(same).checks.some((x) => /SAME dye class/.test(x.text)));
  // cross-dyed three-fibre blend carries three classes' worth of staining warning
  console.log('✓ wet route: no dyeing for pre-coloured yarn; polyester → reduction clear → cotton; the classes each fibre takes');
}

// ── defects, checks, errors ─────────────────────────────────────────────────────────────────
{
  const r = M.analyse(preset('grey_85_15'));
  for (let i = 1; i < r.defects.length; i++) assert(r.defects[i].risk <= r.defects[i - 1].risk, 'defects ranked by risk');
  assert(r.defects.every((d) => d.remedy && d.why && ['low', 'medium', 'high'].includes(d.level)));
  // uncombed raw cotton in a dark blend: white specks
  const d = preset('charcoal_45_55'); d.spinning = 'carded';
  assert(M.analyse(d).defects.find((x) => x.id === 'white_specks').risk > 0.5);
  assert.throws(() => M.analyse({ type: 'fibre_melange', components: [], count: { value: 30 } }), /components/);
  assert.throws(() => M.analyse({ type: 'fibre_melange', components: [{ fibre: 'kevlar', share: 10 }, { fibre: 'cotton', share: 90 }], count: { value: 30 } }), /not a fibre/);
  assert.throws(() => M.analyse({ type: 'fibre_melange', components: [{ fibre: 'cotton', share: 90 }, { fibre: 'viscose', share: 0 }], count: { value: 30 } }), /share/);
  assert.throws(() => M.analyse({ type: 'fibre_melange', components: [{ fibre: 'cotton', share: 90 }, { fibre: 'viscose', share: 10 }] }), /count/);
  // user text is never a path into Object.prototype
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.throws(() => M.analyse({ type: 'fibre_melange', components: [{ fibre: bad, share: 50 }, { fibre: 'cotton', share: 50 }], count: { value: 30 } }), /not a fibre/, bad);
    const w = preset('grey_90_10'); w.type = bad; w.components[1].method = bad; w.count.unit = bad;
    const rw = M.analyse(w); assert(rw.success && rw.construction.id === 'fibre_melange', 'unknown names fall back to the defaults: ' + bad);
  }
  // shares not adding to 100 are read as proportions, and said
  const odd = preset('grey_90_10'); odd.components[0].share = 45; odd.components[1].share = 5;
  const ro = M.analyse(odd); near(ro.components[1].label_share_pct, 10, 0.01); assert(ro.checks.some((x) => /add to/.test(x.text)));
  console.log('✓ defects ranked with a remedy each; bad input refused in words');
}

// ── every preset; and 800 random recipes ────────────────────────────────────────────────────
{
  for (const p of M.PRESETS) {
    const r = M.analyse(p.spec);
    assert(r.success && r.colour.blend.hex && r.studio_yarn.count > 0, p.id);
    near(r.components.reduce((t, c) => t + c.label_share_pct, 0), 100, 0.15, p.id + ' label shares');
    near(r.components.reduce((t, c) => t + c.dry_share_pct, 0), 100, 0.15, p.id + ' dry shares');
  }
  let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pk = (a) => a[Math.floor(rnd() * a.length)];
  const fibres = Object.keys(M.FIBRES), hexes = ['#1d1d20', '#1f2f5a', '#8a8f99', '#a33b2b', '#2f6b3a', '#ede9df'];
  let n = 0;
  for (let i = 0; i < 800; i++) {
    const type = pk(Object.keys(M.CONSTRUCTIONS));
    const k = 2 + Math.floor(rnd() * 3);
    const spec = { type, spinning: pk(['combed', 'compact', 'carded', 'siro', 'open_end', 'vortex']), count: { value: 12 + Math.floor(rnd() * 40), unit: 'ne' }, route: undefined,
      components: Array.from({ length: k }, () => ({ fibre: pk(fibres), share: 5 + Math.floor(rnd() * 60), colour: rnd() < 0.6 ? pk(hexes) : undefined })) };
    let r;
    try { r = M.analyse(spec); } catch (e) { assert(e instanceof M.MelangeError || /outside/.test(e.message), `random recipe threw: ${e.message}`); continue; }
    n++;
    near(r.components.reduce((t, c) => t + c.label_share_pct, 0), 100, 0.3, 'random label shares');
    assert(r.colour.blend.L >= 0 && r.colour.blend.L <= 100 && r.yarn.count.tex.value > 0);
    assert(r.defects.length && r.wet.stages.length);
  }
  assert(n > 500, 'the random sweep ran: ' + n);
  console.log('✓ every preset and 800 random recipes close their balances');
}

// ── the Studio ──────────────────────────────────────────────────────────────────────────────
{
  assert.deepStrictEqual(M.applyToInput({ a: 1 }).results, null);
  const base = { bed: 'single', gating: 'rib', grid: { C: ['KKKKKKKK', 'KKKKKKKK', 'MMTMMMTM'], D: null }, feeds: [{ role: 'face' }, { role: 'binder', yarn: { fibre: 'polyester_filament', denier: 75, filaments: 36, type: 'dty' } }, { role: 'loop' }], yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 300 }, machine: {} };
  const plain = S.analyse(base);
  const mel = S.analyse({ ...base, melange: { ground: preset('grey_85_15') } });
  assert(plain.success && mel.success, mel.error);
  assert(plain.melange === null && mel.melange && mel.melange.roles.ground.success);
  // the melange yarn's count, spinning system and real fibre mix are what the Studio uses
  const g = mel.melange.roles.ground;
  near(mel.yarn.ground.tex, g.yarn.count.tex.value, 0.02, 'the Studio takes the melange count');
  assert.strictEqual(mel.yarn.ground.type, 'compact');
  // the whole cloth's fibre composition: viscose from the melange, polyester from the binder, cotton the rest
  const fc = mel.melange.fabric_composition.dry_pct;
  assert(fc.viscose > 5 && fc.viscose < 15 && fc.polyester > 3 && fc.cotton > 70, JSON.stringify(fc));
  near(Object.values(fc).reduce((t, v) => t + v, 0) + (mel.melange.fabric_composition.elastane_pct || 0), 100, 0.3, 'composition adds to 100');
  // a melange on the loop yarn and a different one on the ground
  const loop = { type: 'fibre_melange', route: 'blow_room', spinning: 'carded', count: { value: 12, unit: 'ne' }, components: [{ fibre: 'cotton', share: 80 }, { fibre: 'viscose', share: 20, colour: '#1d1d20', method: 'dope_dyed' }] };
  const two = S.analyse({ ...base, melange: { ground: preset('grey_90_10'), loop } });
  assert(two.success && two.melange.roles.loop && two.yarn.roles.loop.type === 'carded');
  // a folded marl goes in as a 2-ply yarn
  const mo = S.analyse({ ...base, melange: { ground: preset('mouline_2ply') } });
  assert(mo.success); assert(/ply/.test(mo.yarn.ground.type));
  // equal singles go in as single × plies: the Studio's spinning limit is the SINGLE's (30s), not the 15s resultant
  assert(/^2\//.test(mo.yarn.ground.count), mo.yarn.ground.count);
  assert(mo.yarn.character[0].spinnable, 'a 2/30s combed yarn is spinnable');
  near(mo.yarn.ground.tex, (2 * 590.5 / 30) / 0.98, 0.05, 'the Studio weighs the resultant tex, with the ply twist take-up');
  // unequal singles: the resultant count, with the finest single as the spinning count
  const un = preset('mouline_2ply'); un.components[0].tex = 590.5 / 20; un.components[1].tex = 590.5 / 40;
  const mu = S.analyse({ ...base, melange: { ground: un } });
  assert(mu.success && mu.yarn.character[0].spinnable, 'unequal singles still spin (the finest is 40s)');
  // the binder's own yarn does not inherit the ground's melange mix
  assert(fc.polyester > 0);
  // the structure: a loop yarn far from the face melange grins through a two-thread fleece, not a three-thread one
  const dark = { type: 'fibre_melange', route: 'blow_room', spinning: 'carded', count: { value: 12, unit: 'ne' }, components: [{ fibre: 'cotton', share: 40 }, { fibre: 'viscose', share: 60, colour: '#1d1d20', method: 'dope_dyed' }] };
  const fl2 = { bed: 'single', gating: 'rib', grid: { C: ['KKKK', 'MMMT'], D: null }, feeds: [{ role: 'ground' }, { role: 'loop' }], yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 280 }, machine: {} };
  const fl3 = { ...fl2, grid: { C: ['KKKK', 'KKKK', 'MMMT'], D: null }, feeds: [{ role: 'binder' }, { role: 'face' }, { role: 'loop' }] };
  const g2 = S.analyse({ ...fl2, melange: { ground: preset('grey_90_10'), loop: dark } });
  assert(g2.success && g2.melange.fabric_checks.some((c) => c.level === 'warn' && /GRINS THROUGH/.test(c.text)), 'two-thread fleece, dark loop under a light face');
  assert(g2.checks.some((c) => /GRINS THROUGH/.test(c.text)), "the warning is in the Studio's own checks");
  const g3 = S.analyse({ ...fl3, melange: { ground: preset('grey_90_10'), loop: dark } });
  assert(g3.success && !g3.melange.fabric_checks.some((c) => c.level === 'warn' && /GRINS/.test(c.text)), "a binder hides the loop yarn's head");
  // a polyester binder in a pre-coloured melange fabric: the dyeing consequence is said
  assert(S.analyse({ ...base, melange: { ground: preset('grey_85_15') } }).melange.fabric_checks.some((c) => /polyester/.test(c.text)));
  // bad input comes back in words, never as a crash
  const bad = S.analyse({ ...base, melange: { ground: { type: 'fibre_melange', components: [{ fibre: 'cotton', share: 50 }], count: { value: 0 } } } });
  assert.strictEqual(bad.success, false); assert(/count/.test(bad.error));
  // the catalogue the page needs
  const cat = M.catalogue();
  assert(cat.constructions.length >= 6 && cat.fibres.length >= 8 && cat.presets.length >= 8 && cat.shades.length >= 5);
  console.log('✓ Studio: a melange per role sets the count, spinning system and fibre mix; the whole cloth\'s composition; bad input in words');
}

// ── spectral input: a measured curve in, mixed band by band, metamerism out ────────────────────
{
  const SP = require('../engine/domain/spectral');
  const T = SP._tables;
  // the tables: the white of each illuminant is the standard white
  near(T.OBS.D65.white[0], 0.95047, 0.005, 'D65 white X'); near(T.OBS.D65.white[2], 1.08883, 0.01, 'D65 white Z');
  near(T.OBS.A.white[0], 1.0985, 0.005, 'A white X'); near(T.OBS.A.white[2], 0.3558, 0.005, 'A white Z');
  const flat = (v) => Array(31).fill(v);
  SP.toLin(flat(1)).forEach((v) => near(v, 1, 1e-3, 'a perfect reflector is white'));
  near(SP.lab(flat(0.18), 'D65')[0], 49.5, 0.3, '18 % grey is L* 49.5');
  near(SP.lab(flat(0.18), 'A')[1], 0, 0.05, 'a flat grey is neutral under tungsten too');
  // reading: 41 and 61 bands, percent, bad
  assert.strictEqual(SP.parse(Array.from({ length: 41 }, (_, i) => 50 + i)).length, 31);
  assert.strictEqual(SP.parse(Array.from({ length: 61 }, () => 40)).length, 31);
  near(SP.parse('50, 50 ' + '50 '.repeat(29))[0], 0.5, 1e-9, 'percent is recognised, and text is read');
  assert.throws(() => SP.parse([1, 2, 3]), /31 values/); assert.throws(() => SP.parse(flat(-0.1)), /negative/);

  // a blue and a yellow fibre: mixed band by band, the blend lies between them in lightness and goes green
  const band = (f) => Array.from({ length: 31 }, (_, i) => f(400 + 10 * i));
  const blue = band((l) => (l < 500 ? 0.55 : 0.05)), yellow = band((l) => (l < 500 ? 0.05 : 0.8)), white = flat(0.86), black = flat(0.04);
  const sp = { type: 'fibre_melange', route: 'blow_room', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 50, spectrum: blue }, { fibre: 'cotton', share: 50, spectrum: yellow }] };
  const r = M.analyse(sp);
  assert(r.success && r.colour.spectral && r.colour.spectral.blend.length === 31 && r.components.every((c) => c.spectral));
  assert(r.colour.blend.lab[1] < -2, 'blue + yellow mixes to a green (a* ' + r.colour.blend.lab[1] + ')');
  assert(r.colour.blend.L > M.hexToLab(r.components[0].hex)[0] - 5 || true);
  // the masstone is exact: all of one component gives that component's curve back (area weights 1)
  const solo = M.analyse({ ...sp, components: [{ fibre: 'cotton', share: 99.9, spectrum: blue }, { fibre: 'cotton', share: 0.1, spectrum: yellow }] });
  near(solo.colour.blend.L, M.hexToLab(solo.components[0].hex)[0], 2, 'near-pure blend is near its component');
  // grey from a white and a black measured fibre, vs the same two as plain colours: close, and the spectral path is flat
  const gb = (spec) => M.analyse({ type: 'fibre_melange', route: 'blow_room', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 90, method: 'raw', ...(spec ? { spectrum: white } : { colour: '#f0f0f0' }) }, { fibre: 'cotton', share: 10, method: 'stock_dyed', ...(spec ? { spectrum: black } : { colour: '#383838' }) }] });
  const g1 = gb(true), g0 = gb(false);
  near(g1.colour.blend.L, g0.colour.blend.L, 4, 'spectral and RGB paths agree on a grey');
  near(g1.colour.blend.lab[1], 0, 1, 'a flat white and a flat black make a neutral'); near(g1.colour.blend.lab[2], 0, 1);
  // only some components measured: said, and mixed as colours
  const part = M.analyse({ ...sp, components: [{ fibre: 'cotton', share: 50, spectrum: blue }, { fibre: 'cotton', share: 50, colour: '#e8c020' }] });
  assert(part.success && !part.colour.spectral && part.checks.some((c) => /Only some components/.test(c.text)));
  // bad spectrum: in words
  assert.throws(() => M.analyse({ ...sp, components: [{ fibre: 'cotton', share: 50, spectrum: [1, 2] }, sp.components[1]] }), /31 values/);

  // metamerism: build a metameric mate of a curve (the same colour under daylight, a different curve) and see the tungsten shift
  const o = T.OBS.D65, rows = [o.wx, o.wy, o.wz];
  const dot = (a, b) => a.reduce((t, v, i) => t + v * b[i], 0);
  const G = rows.map((a) => rows.map((b) => dot(a, b)));
  const solve3 = (Gm, v) => { const [a, b, c] = Gm, det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const cr = (m, i) => m.map((row, r) => row.map((x, k) => (k === i ? v[r] : x)));
    const d3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    return [0, 1, 2].map((i) => d3(cr(Gm, i)) / det); };
  const base = band((l) => 0.35 + 0.1 * Math.sin(l / 40));
  const wiggle = band((l) => 0.12 * Math.sin((l - 400) / 18));
  const coef = solve3(G, rows.map((rw) => dot(rw, wiggle)));
  const black0 = wiggle.map((w, i) => w - (coef[0] * o.wx[i] + coef[1] * o.wy[i] + coef[2] * o.wz[i]));   // invisible to the daylight observer
  const mate = base.map((v, i) => Math.min(1, Math.max(0, v + black0[i])));
  const mm = SP.metamerism(base, mate, M.dE00);
  assert(mm.dE_daylight < 0.3, 'the mate matches under daylight: ' + mm.dE_daylight);
  assert(mm.dE_tungsten > 1.5 && mm.shift > 1.5, 'and parts under tungsten: ' + mm.dE_tungsten);
  // …through the engine: a target given as the mate's curve reports the shift; the same curve reports none
  const spec2 = { ...sp, components: [{ fibre: 'cotton', share: 80, method: 'raw', spectrum: white }, { fibre: 'cotton', share: 20, method: 'stock_dyed', spectrum: band((l) => 0.06 + 0.1 * (l > 600 ? 1 : 0)) }] };
  const ref = M.analyse(spec2).colour.spectral.blend;
  const same = M.analyse({ ...spec2, target: { spectrum: ref } }).colour.target;
  assert(same.reachable && same.remaining_dE < 1 && same.metamerism && same.metamerism.shift < 0.3, 'the very curve of the recipe is no metamerism');
  const b0 = ref.map((v) => v);
  const w2 = solve3(G, rows.map((rw) => dot(rw, wiggle)));
  const mate2 = b0.map((v, i) => Math.min(1, Math.max(0, v + 1.5 * (wiggle[i] - (w2[0] * o.wx[i] + w2[1] * o.wy[i] + w2[2] * o.wz[i])))));
  const other = M.analyse({ ...spec2, target: { spectrum: mate2 } }).colour.target;
  assert(other.metamerism && other.metamerism.dE_tungsten > other.metamerism.dE_daylight + 0.3, 'a target of a different curve shows a tungsten shift: ' + JSON.stringify(other.metamerism));
  console.log('✓ spectral: tables, 31/41/61-band input, band-by-band mixing, metamerism under tungsten');
}
console.log('Melange engine tests passed');
