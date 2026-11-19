// The inspection room: lightbox (colour under five lights, brightener, metamerism), burnout lab, barré and grinning.
'use strict';
const assert = require('assert');
const LB = require('../engine/domain/lightbox-engine');
const BO = require('../engine/domain/burnout-engine');
const DEF = require('../engine/domain/defects-engine');
const SP = require('../engine/domain/spectral');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Inspection Engines Tests ---');
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} ${a} vs ${b} (±${tol})`);
const ill = (r, id) => r.illuminants.find((x) => x.id === id);

{
  // the modelled fluorescent spectra sit on the lamps' published chromaticity
  const T = SP._tables;
  const xy = (S_) => { let X = 0, Y = 0, Z = 0; S_.forEach((s, i) => { X += s * T.XB[i]; Y += s * T.YB[i]; Z += s * T.ZB[i]; }); const t = X + Y + Z; return [X / t, Y / t]; };
  const by = Object.fromEntries(LB.SOURCES.map((s) => [s.id, s.S]));
  near(xy(by.D65)[0], 0.3127, 0.001); near(xy(by.A)[0], 0.4476, 0.002);
  near(xy(by.TL84)[0], 0.3805, 0.001, 'TL84 x'); near(xy(by.TL84)[1], 0.3771, 0.001, 'TL84 y');
  near(xy(by.CWF)[0], 0.3721, 0.001, 'CWF x'); near(xy(by.CWF)[1], 0.3751, 0.001, 'CWF y');
  console.log('✓ the lamp spectra: D65 and A are the CIE tables; TL84 and CWF are fitted to their published chromaticity');
}
{
  // a smooth reflectance curve reproduces the colour in daylight
  for (const hex of ['#2a4d8f', '#c33a2f', '#3f7a4a', '#808080', '#f4f4f0', '#e8c13a']) {
    const r = LB.analyse({ colour: hex, shade: 'medium' });
    assert(r.reconstruction.error_de < 1.2, `${hex} reconstruction error ${r.reconstruction.error_de}`);
    assert.strictEqual(ill(r, 'D65').delta_e_vs_d65, 0);
    assert.strictEqual(r.illuminants.length, 5);
  }
  // a neutral grey keeps its colour under every light (colour constancy); a saturated colour does not
  const grey = LB.analyse({ colour: '#808080', shade: 'medium' }), blue = LB.analyse({ colour: '#2a4d8f', shade: 'medium' }), red = LB.analyse({ colour: '#c33a2f', shade: 'medium' });
  assert(grey.inconstancy_index.value < 0.5, `grey inconstancy ${grey.inconstancy_index.value}`);
  assert(blue.inconstancy_index.value > 1 && red.inconstancy_index.value > 2, 'saturated colours move');
  assert(ill(red, 'A').delta_e_vs_d65 > ill(red, 'CWF').delta_e_vs_d65 * 0.8, 'tungsten moves a red more than daylight-like fluorescent');
  // a red under tungsten gets warmer (a*/b* up in the unadapted view): the adapted Lab keeps the ΔE finite and sensible
  assert(ill(red, 'A').delta_e_vs_d65 < 12);
  console.log('✓ lightbox: a grey is constant (ΔE', grey.inconstancy_index.value + '); a blue moves', blue.inconstancy_index.value, 'and a red', red.inconstancy_index.value);
}
{
  // optical brightener: a white glows, more under UV-rich light; a dark shade has none
  const white = LB.analyse({ colour: '#f4f4f0', shade: 'white', oba: true }), plain = LB.analyse({ colour: '#f4f4f0', shade: 'white', oba: false });
  assert(white.oba && !plain.oba);
  assert(ill(white, 'D65').oba.delta_b < -3, 'daylight: b* falls (bluer)');
  assert(ill(white, 'TL84').oba.delta_b > ill(white, 'D65').oba.delta_b, 'a shop fluorescent has less UV: a smaller brightener effect');
  assert(Math.abs(ill(white, 'A').oba.delta_b) < Math.abs(ill(white, 'D65').oba.delta_b) / 5, 'tungsten has none');
  assert(ill(white, 'UV').lab[0] > ill(plain, 'UV').lab[0] + 5, 'a black light makes the brightened white glow');
  assert(ill(plain, 'UV').lab[0] < 3, 'an unbrightened cloth is dark under a black light');
  assert.strictEqual(LB.analyse({ colour: '#1c2b46', shade: 'dark', oba: true }).oba, null, 'a dark shade takes no brightener');
  const cat = LB.analyse({ colour: '#f4f4f0', shade: 'white', oba: true, softener: 'cationic' });
  assert(cat.warnings.some((w) => /cationic/i.test(w.text)));
  console.log('✓ brightener: bluer in daylight, less under a shop light, none under tungsten, a glow under UV; none on a dark shade');
}
{
  // metamerism: two curves → law; classes → estimate
  const a = Array.from({ length: 31 }, (_, i) => 0.25 + 0.2 * Math.sin(i / 5));
  // a second curve that matches a in daylight: adjust it by a small metameric black (found by projection onto the null space of the D65 observer)
  const o = SP._tables.OBS.D65, rows = [o.wx, o.wy, o.wz];
  const b = a.map((v, i) => v + 0.12 * Math.sin(i * 1.7 + 0.4));
  // remove the D65 tristimulus difference with three correction basis curves
  const basis = [0, 1, 2].map((k) => Array.from({ length: 31 }, (_, i) => Math.exp(-0.5 * ((i - 6 - 9 * k) / 3.5) ** 2)));
  const dx = [0, 1, 2].map((r) => rows[r].reduce((t, w, i) => t + w * (a[i] - b[i]), 0));
  const M = [0, 1, 2].map((r) => [0, 1, 2].map((k) => rows[r].reduce((t, w, i) => t + w * basis[k][i], 0)));
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const solve = (m, y) => [0, 1, 2].map((c) => { const mm = m.map((row, r) => row.map((v, k) => (k === c ? y[r] : v))); return det(mm) / det(m); });
  const co = solve(M, dx);
  const b2 = b.map((v, i) => Math.max(0, v + co.reduce((t, c, k) => t + c * basis[k][i], 0)));
  const m = LB.analyse({ colour: '#7a8f9a', spectra: { a, b: b2 } }).metamerism;
  assert.strictEqual(m.basis, 'law'); assert(m.measured);
  assert(m.d65_match_de < 1.0, `the two curves match in daylight (ΔE ${m.d65_match_de})`);
  assert(m.worst_de > 2 * m.d65_match_de && m.worst_de > 0.8, `…and part more under a shop light (${m.worst_de} against ${m.d65_match_de})`);
  const same = LB.analyse({ colour: '#7a8f9a', spectra: { a, b: a } }).metamerism;
  assert(same.worst_de < 0.01 && same.risk === 'low');
  const cvc = LB.analyse({ colour: '#2a4d8f', shade: 'dark', classes: ['reactive', 'disperse'] }).metamerism, one = LB.analyse({ colour: '#2a4d8f', shade: 'dark', classes: ['reactive'] }).metamerism, pastel = LB.analyse({ colour: '#cdd8e4', shade: 'pastel', classes: ['reactive', 'disperse'] }).metamerism;
  assert(cvc.basis === 'estimate' && cvc.risk === 'high' && one.risk === 'low' && pastel.risk === 'medium');
  assert.throws(() => LB.analyse({ colour: 'blue' }), /hex/);
  assert.throws(() => LB.analyse({ colour: '#7a8f9a', spectra: { a: [1, 2], b: a } }), /31 values/);
  console.log('✓ metamerism: two curves that match in daylight part by ΔE', m.worst_de, 'under a shop light; classes give a risk, not a number');
}
{
  const t = LB.tint('TL84'), a = LB.tint('A');
  assert(LB.tint('D65').every((v) => v === 1) && a[0] > a[2] && t[0] > t[2], 'tungsten and TL84 are warmer than daylight');
  assert(a[2] < t[2], 'tungsten is warmer than TL84');
  assert(LB.catalogue().sources.every((s) => Array.isArray(s.tint)));
  console.log('✓ light tints for the 3D view: daylight neutral, TL84 warm, tungsten warmer');
}
{
  // burnout
  const cvc = BO.analyse({ fibres: { cotton: 60, polyester: 40 }, gsm: 200 });
  const acid = cvc.reagents.find((r) => r.id === 'h2so4'), naoh = cvc.reagents.find((r) => r.id === 'naoh'), formic = cvc.reagents.find((r) => r.id === 'formic');
  assert.deepStrictEqual(acid.dissolves, ['cotton']); near(acid.weight_left_pct, 40, 0.5); assert.strictEqual(acid.gsm_after, 80); assert.deepStrictEqual(acid.residue, { polyester: 100 });
  assert.strictEqual(formic.weight_left_pct, 100, 'formic acid leaves a cotton / polyester cloth alone');
  assert(naoh.weight_left_pct > 96 && naoh.attacks.length === 1, 'caustic takes a little of the polyester, nothing of the cotton');
  assert.strictEqual(cvc.suggested, 'h2so4');
  const wool = BO.analyse({ fibres: { wool: 50, polyester: 50 } }), wnaoh = wool.reagents.find((r) => r.id === 'naoh'), whyp = wool.reagents.find((r) => r.id === 'hypochlorite');
  assert.deepStrictEqual(wnaoh.dissolves, ['wool']); assert(wnaoh.weight_left_pct > 44 && wnaoh.weight_left_pct < 48, 'wool gone, polyester loses a little: ' + wnaoh.weight_left_pct); assert.deepStrictEqual(whyp.dissolves, ['wool']);
  const nyl = BO.analyse({ fibres: { cotton: 70, nylon: 30 } });
  assert.deepStrictEqual(nyl.reagents.find((r) => r.id === 'formic').dissolves, ['nylon']);
  assert.strictEqual(BO.analyse({ fibres: { elastane: 5, cotton: 95 } }).reagents.find((r) => r.id === 'dmf').weight_left_pct, 95);
  assert.strictEqual(BO.analyse({ fibres: { polypropylene: 100 } }).reagents.find((r) => r.id === 'xylene').word, 'everything dissolves');
  assert.strictEqual(BO.analyse({ fibres: { polyester: 100 } }).reagents.find((r) => r.id === 'h2so4').word.slice(0, 7), 'nothing');
  // feeds: a fleece with a cotton ground and a polyester loop yarn
  const fl = BO.analyse({ fibres: { cotton: 55, polyester: 45 }, feeds: [{ feed: 1, role: 'ground', mix: { cotton: 100 }, knits: true }, { feed: 2, role: 'loop', mix: { polyester: 100 }, knits: false }] });
  const fa = fl.reagents.find((r) => r.id === 'h2so4');
  assert(fa.feeds[0].vanishes && !fa.feeds[1].vanishes && fa.holds_together === false, 'acid takes the knitting feed: the polyester loops cannot hold together');
  assert.throws(() => BO.analyse({}), /fibres/);
  console.log('✓ burnout: acid takes the cotton (40 % left), formic the nylon, caustic the wool, DMF the elastane, xylene the PP; a fleece\'s knitting feed vanishes and the rest falls apart');
}
{
  // barré
  const b = DEF.barre({ sl_mm: 2.7, feeders: 48, shade: 'medium', kind: 'jersey' });
  assert(b.success && b.profile.delta_l.length === 48 && ['invisible', 'faint', 'visible', 'obvious'].includes(b.risk));
  const a2 = DEF.barre({ sl_mm: 2.7, feeders: 48, shade: 'medium', kind: 'jersey' });
  assert.deepStrictEqual(a2.profile.delta_l, b.profile.delta_l, 'seeded');
  const loose = DEF.barre({ sl_mm: 2.7, feeders: 48, tol_sl_mm: 0.12, shade: 'medium', kind: 'jersey' }), tight = DEF.barre({ sl_mm: 2.7, feeders: 48, tol_sl_mm: 0.01, cv_count: 0.3, shade: 'medium', kind: 'jersey' });
  assert(loose.lightness_step.value > 3 * b.lightness_step.value * 0.6 && ['visible', 'obvious'].includes(loose.risk) && loose.warnings.some((w) => w.level === 'warn'), `a ±0.12 mm spread: ${loose.risk}`);
  assert(tight.risk === 'invisible' && tight.lightness_step.value < b.lightness_step.value, 'a tight spread is invisible');
  // shade and structure: a medium plain jersey shows it most; a white, a black and a rib show less
  const L = (o) => DEF.barre({ sl_mm: 2.7, feeders: 48, tol_sl_mm: 0.08, ...o }).lightness_step.value;
  assert(L({ shade: 'medium' }) > L({ shade: 'white' }) && L({ shade: 'medium' }) > L({ shade: 'black' }) && L({ shade: 'medium' }) > L({ shade: 'dark' }));
  assert(L({ shade: 'medium', kind: 'jersey' }) > L({ shade: 'medium', kind: 'rib' }) && L({ shade: 'medium', kind: 'jersey' }) > L({ shade: 'medium', kind: 'fleece' }));
  // the tolerance that keeps it invisible really does
  const tol = loose.tolerance_for_invisible_mm.value;
  assert(tol > 0 && tol < 0.12 && DEF.barre({ sl_mm: 2.7, feeders: 48, tol_sl_mm: tol, shade: 'medium', kind: 'jersey' }).lightness_step.value <= 0.62, 'the stated tolerance gives a step at the visibility threshold');
  // a count spread alone can exceed the limit: the tolerance is 0 and the warning says to sort the packages
  const cnt = DEF.barre({ sl_mm: 2.7, feeders: 48, tol_sl_mm: 0.01, cv_count: 5, shade: 'medium', kind: 'jersey' });
  assert.strictEqual(cnt.tolerance_for_invisible_mm.value, 0); assert(cnt.warnings.some((w) => /sort the packages/.test(w.text)));
  assert.throws(() => DEF.barre({}), /loop length/);
  console.log('✓ barré: seeded; a ±0.12 mm spread is', loose.risk, '(ΔL*', loose.lightness_step.value + '); the stated tolerance ±' + tol + ' mm stays at the threshold');
}
{
  // grinning
  assert.strictEqual(DEF.grinning({ back_kind: null }).applicable, false);
  assert.strictEqual(DEF.grinning({ back_kind: 'loop', face_hex: '#1c2b46' }).status, 'not_checked');
  const bad = DEF.grinning({ face_hex: '#1c2b46', back_hex: '#f4f4f0', back_kind: 'loop', open_rest: 0.06, open_20: 0.16, open_40: 0.30 });
  assert.strictEqual(bad.status, 'warn'); assert(bad.delta_e.value > 60);
  assert(bad.visible_back_pct.s40.value > bad.visible_back_pct.s20.value && bad.visible_back_pct.s20.value > bad.visible_back_pct.rest.value, 'it shows more as the cloth stretches');
  const same = DEF.grinning({ face_hex: '#1c2b46', back_hex: '#1f2e4a', back_kind: 'loop', open_rest: 0.06, open_20: 0.16, open_40: 0.3 });
  assert.strictEqual(same.status, 'pass');
  const closed = DEF.grinning({ face_hex: '#1c2b46', back_hex: '#f4f4f0', back_kind: 'binder', open_rest: 0, open_20: 0, open_40: 0.01 });
  assert(closed.visible_back_pct.s20.value <= 8.5 && ['pass', 'note', 'warn'].includes(closed.status));
  assert(DEF.grinning({ face_hex: '#1c2b46', back_hex: '#f4f4f0', back_kind: 'plated', open_20: 0.1 }).visible_back_pct.s20.value > DEF.grinning({ face_hex: '#1c2b46', back_hex: '#f4f4f0', back_kind: 'binder', open_20: 0.1 }).visible_back_pct.s20.value, 'a plated back peeks out more than a binder');
  console.log('✓ grinning: white loop yarn behind a navy face warns and shows more stretched; the same colour passes; a closed cloth shows little');
}
{
  // in the Studio: off by default; on request; the gates read it
  const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cvc', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, look: { shade: 'dark', colour: '#2a4d8f' }, chemistry: { enabled: true, shade: 'dark' } };
  const off = S.analyse(base);
  assert.strictEqual(off.inspect, null);
  assert.strictEqual(off.feasibility.rules.find((x) => x.id === 'U-20').status, 'not_checked');
  const on = S.analyse({ ...base, inspect: { enabled: true } });
  assert(on.inspect && on.inspect.success && on.inspect.lightbox && on.inspect.burnout && on.inspect.barre && on.inspect.grinning);
  assert.strictEqual(on.inspect.lightbox.metamerism.risk, 'high', 'a dark CVC is dyed with a disperse and a reactive dye');
  assert.deepStrictEqual(on.inspect.lightbox.metamerism.classes.sort(), ['disperse', 'reactive']);
  assert.strictEqual(on.feasibility.rules.find((x) => x.id === 'U-20').status, 'warn', 'U-20 flags the dual-dye CVC');
  assert.strictEqual(on.inspect.colour.hex, '#2a4d8f');
  near(on.inspect.burnout.reagents.find((r) => r.id === 'h2so4').weight_left_pct, 40, 0.5);
  const cot = S.analyse({ ...base, yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, inspect: { enabled: true } });
  assert.strictEqual(cot.inspect.lightbox.metamerism.risk, 'low'); assert.strictEqual(cot.feasibility.rules.find((x) => x.id === 'U-20').status, 'pass');
  // a white cotton with brightener glows
  const wh = S.analyse({ ...base, yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, look: { shade: 'white', colour: '#f4f4f0' }, chemistry: { enabled: true, shade: 'white' }, inspect: { enabled: true } });
  assert(wh.inspect.lightbox.oba && wh.inspect.lightbox.illuminants.find((x) => x.id === 'D65').oba.delta_b < -3);
  // fleece: a white polyester loop yarn behind a navy cotton face
  const fl = S.analyse({ bed: 'single', grid: { C: [['K', 'K', 'K', 'K'], ['M', 'M', 'M', 'T']], D: null }, feeds: [{ role: 'ground' }, { role: 'loop' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, yarns: { loop: { fibre: 'polyester_spun', type: 'combed', count: 12, unit: 'ne' } }, target: { gsm: 300 }, machine: {}, look: { shade: 'dark', colour: '#1c2b46' }, inspect: { enabled: true, back_colour: '#f4f4f0' } });
  assert.strictEqual(fl.inspect.grinning.status, 'warn'); assert.strictEqual(fl.feasibility.rules.find((x) => x.id === 'U-15').status, 'warn');
  const fa = fl.inspect.burnout.reagents.find((r) => r.id === 'h2so4');
  assert(fa.feeds[0].vanishes && fa.holds_together === false);
  const noBack = S.analyse({ ...fl && { bed: 'single', grid: { C: [['K', 'K', 'K', 'K'], ['M', 'M', 'M', 'T']], D: null }, feeds: [{ role: 'ground' }, { role: 'loop' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, yarns: { loop: { fibre: 'polyester_spun', type: 'combed', count: 12, unit: 'ne' } }, target: { gsm: 300 }, machine: {}, look: { shade: 'dark', colour: '#1c2b46' }, inspect: { enabled: true } } });
  assert.strictEqual(noBack.inspect.grinning.status, 'not_checked'); assert.strictEqual(noBack.feasibility.rules.find((x) => x.id === 'U-15').status, 'not_checked');
  console.log('✓ in the Studio: off by default; a dual-dye CVC trips U-20; a white loop yarn behind a navy face trips U-15; the acid burnout of a fleece loses its knitting feed');
}
console.log('Inspection engines tests passed');
