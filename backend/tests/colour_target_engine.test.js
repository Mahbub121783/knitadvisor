// Colour target engine: Pantone / Lab / RGB / hex into the depth, the dye amount and a lab-dip check.
'use strict';
const assert = require('assert');
const CT = require('../engine/domain/colour-target-engine');
const MEL = require('../engine/domain/melange-engine');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Colour Target Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

// ── 1. every way of giving a colour arrives at the same one
{
  const a = CT.analyse('19-4052'), b = CT.analyse('#0f4c81'), c = CT.analyse('rgb(15 76 129)'), d = CT.analyse({ pantone: 'PANTONE 19-4052 TCX' }), e = CT.analyse('classic blue');
  [b, c, d, e].forEach((x) => assert.strictEqual(x.colour.hex, a.colour.hex));
  assert(a.colour.catalogue && a.colour.catalogue.code === '19-4052' && a.nearest[0].delta_e00 < 0.5);
  near(a.colour.lab[0], 31.5, 0.6, 'L of classic blue'); near(a.colour.lab[2], -35, 1.2, 'b of classic blue');
  const l = CT.analyse({ lab: a.colour.lab, illuminant: 'D65' });
  assert(MEL.dE00(a.colour.lab, l.colour.lab) < 1.0, 'Lab round trip');
  const l50 = CT.analyse({ lab: [50, 30, 20], illuminant: 'D50' }), l65 = CT.analyse({ lab: [50, 30, 20], illuminant: 'D65' });
  assert.notStrictEqual(l50.colour.hex, l65.colour.hex);
  near(l50.colour.lab_d50[0], 50, 0.8, 'D50 Lab round trip'); near(l50.colour.lab_d50[1], 30, 1.5); near(l50.colour.lab_d50[2], 20, 1.5);
  const g = CT.analyse('L 60 a 85 b 70');
  assert(g.colour.in_gamut === false && g.checks.some((x) => /outside/.test(x.text)), 'out of gamut is said');
  console.log('✓ a code, a name, a hex, an RGB and a Lab reading arrive at one colour; D50 and D65 differ; out-of-gamut is said');
}

// ── 2. depth: lightness orders the shade ladder, and the dye amount rises with it
{
  const L = (l) => CT.analyse({ lab: [l, 0, 0], illuminant: 'D65' });
  const ids = [96, 85, 70, 50, 30, 8].map((l) => L(l).depth.id);
  assert.deepStrictEqual(ids, ['white', 'pastel', 'light', 'medium', 'dark', 'black'], ids.join());
  const owf = [85, 70, 50, 30, 8].map((l) => L(l).depth.dye_owf.reactive.value);
  assert(owf.every((v, i) => i === 0 || v > owf[i - 1]), 'the dye amount rises as the shade deepens: ' + owf);
  assert(L(30).depth.ks.value > L(70).depth.ks.value);
  assert(L(96).checks.some((x) => /white/i.test(x.text)) && L(8).checks.some((x) => /deep black/i.test(x.text)) && L(88).checks.some((x) => /pastel/i.test(x.text)));
  const m = CT.analyse('L 45 a 20 b 15');
  assert(m.depth.dye_owf.disperse.value < m.depth.dye_owf.reactive.value, 'disperse needs less than reactive at a depth');
  console.log('✓ lightness orders white → black, the dye amount rises, and white, pastel and black are each said what they ask');
}

// ── 3. the lab dip
{
  const same = CT.analyse({ target: { text: '19-4052' }, trial: { text: '19-4052' } });
  assert(same.trial.pass && same.trial.delta_e00.value < 0.05 && /on the target/.test(same.trial.says));
  const light = CT.analyse({ target: { lab: [31, 2, -35], illuminant: 'D65' }, trial: { lab: [35, 2, -35], illuminant: 'D65' }, tolerance: 1 });
  assert(!light.trial.pass && light.trial.dL > 3 && /lighter/.test(light.trial.says) && light.trial.dye_correction_pct.value > 5 && /add/.test(light.trial.advice));
  const dark = CT.analyse({ target: { lab: [35, 2, -35], illuminant: 'D65' }, trial: { lab: [31, 2, -35], illuminant: 'D65' } });
  assert(/darker/.test(dark.trial.says) && dark.trial.dye_correction_pct.value < 0 && /take off/.test(dark.trial.advice));
  const hue = CT.analyse({ target: { lab: [40, 20, -30], illuminant: 'D65' }, trial: { lab: [40, 25, -30], illuminant: 'D65' }, tolerance: 1 });
  assert(/redder/.test(hue.trial.says) && /HUE/.test(hue.trial.advice), 'a hue error says the ratio, not the amount');
  assert(CT.analyse('19-4052').trial === null);
  console.log('✓ a lab dip: ΔE00, the difference in words, the dye to add or take off, and a hue error sent to the dye ratio');
}

// ── 4. bad input
{
  ['', '   ', 'zzzzqq', '99-9999', 'rgb(300 0 0)', 'L 120 a 0 b 0'].forEach((t) => assert.throws(() => CT.analyse(t), CT.ColourError, 'refused: ' + t));
  assert.throws(() => CT.analyse({}), CT.ColourError);
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const r = CT.analyse({ lab: [rnd() * 100, (rnd() - 0.5) * 220, (rnd() - 0.5) * 220], illuminant: rnd() < 0.5 ? 'D50' : 'D65', trial: rnd() < 0.5 ? { hex: '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0') } : undefined });
    assert(r.success && /^#[0-9a-f]{6}$/.test(r.colour.hex) && Number.isFinite(r.depth.ks.value) && Object.values(r.depth.dye_owf).every((v) => v.value >= 0 && Number.isFinite(v.value)));
  }
  console.log('✓ bad input is refused in words; 300 random Lab colours come back finite');
}

// ── 5. the Studio
{
  const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 150 }, machine: {} };
  const plain = S.analyse(base), on = S.analyse({ ...base, colour: { text: '19-4052' }, chemistry: { enabled: true, shade: 'light' }, look: { shade: 'light' } });
  assert(plain.colour === null && on.success && on.colour.success !== false && on.colour.depth.id === 'dark');
  assert(/dark/i.test(on.chemistry.ground.identity.shade) && on.look.cloth.shade === 'dark', 'the colour sets the shade of the chemistry and look cards');
  assert(on.colour.applied.look && on.colour.applied.chemistry && !on.colour.applied.melange);
  const bad = S.analyse({ ...base, colour: { text: 'zzzzqq' } });
  assert(bad.success && bad.colour.success === false && /zzzzqq/.test(bad.colour.error), 'a colour that is not understood is said, the design still answers');
  const preset = JSON.parse(JSON.stringify(MEL.PRESETS.find((p) => p.id === 'grey_85_15').spec));
  const mel = S.analyse({ ...base, colour: { text: '#8a8f98' }, melange: { ground: preset } });
  assert(mel.success && mel.colour.applied.melange && mel.melange.roles.ground.colour.target, 'the colour becomes the melange target');
  const own = JSON.parse(JSON.stringify(preset)); own.target = { colour: '#445566' };
  assert(S.analyse({ ...base, colour: { text: '#8a8f98' }, melange: { ground: own } }).melange.roles.ground.colour.target.target_hex === '#445566', 'a melange target set in its own card is kept');
  console.log('✓ in the Studio: the colour sets the chemistry and look shade and a melange target; a bad colour is said, not fatal');
}

console.log('Colour target tests passed');
