// Fabric light engine: opacity, show-through, stretched, and what the 3D view is given.
'use strict';
const assert = require('assert');
const L = require('../engine/domain/fabric-light-engine');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Fabric Light Tests ---');
const base = { wpc: 14.6, cpc: 17.9, loop_mm: 2.8, yarn_d_mm: 0.166, gsm: 140 };
const a = (x) => L.analyse({ ...base, ...x });
const fin = (x, path = '') => { if (typeof x === 'number') assert(Number.isFinite(x), 'not finite at ' + path); else if (x && typeof x === 'object') Object.keys(x).forEach((k) => fin(x[k], path + '.' + k)); };

{
  const white = a({ shade: 'white' }), pastel = a({ shade: 'pastel' }), med = a({ shade: 'medium' }), black = a({ shade: 'black' });
  const op = [white, pastel, med, black].map((r) => r.opacity.value);
  assert(op.every((v, i) => i === 0 || v > op[i - 1]), 'a darker shade is more opaque: ' + op);
  assert(white.opacity.value > 60 && white.opacity.value < 85 && black.opacity.value > 90, 'a 140 g white jersey is semi-sheer, a black one opaque');
  assert(white.open_area.value > 2 && white.open_area.value < 12, 'a 30s jersey is a few per cent open');
  assert(white.contrast_ratio.value < black.contrast_ratio.value + 0.2 && white.contrast_ratio.value > 0.6 && white.contrast_ratio.value <= 1);
  const heavy = a({ shade: 'white', gsm: 220 }), mesh = a({ shade: 'white', gsm: 90, wpc: 10, cpc: 12, loop_mm: 3.4 }), two = a({ shade: 'white', gsm: 260, layers: 2 });
  assert(heavy.opacity.value > white.opacity.value && mesh.opacity.value < white.opacity.value - 15 && two.open_area.value < white.open_area.value, 'weight, openness and layers move it the right way');
  assert(white.stretched[0].opacity.value < white.opacity.value && white.stretched[1].opacity.value < white.stretched[0].opacity.value, 'stretching opens the cloth');
  assert(mesh.warnings.some((w) => /show through/.test(w.text)) && white.warnings.length >= 1);
  assert(a({ shade: 'white', brushed: 'back' }).open_area.value < white.open_area.value, 'a raised nap closes the gaps');
  assert.strictEqual(a({ colour: '#ffffff' }).shade.luminance > 0.9, true);
  assert(a({ colour: '#101010' }).opacity.value > a({ colour: '#f0f0f0' }).opacity.value, 'the colour on screen sets the shade');
  assert(white.render.tint.length === 3 && white.render.gain > 0);
  console.log('✓ opacity rises with depth and weight, falls with openness and stretch; a nap and a second layer close the cloth');
}
{
  assert.throws(() => L.analyse({}), L.LightError);
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const r = L.analyse({ wpc: 5 + rnd() * 25, cpc: 6 + rnd() * 30, loop_mm: 1.8 + rnd() * 3, yarn_d_mm: 0.08 + rnd() * 0.3, gsm: 40 + rnd() * 500, layers: 1 + Math.floor(rnd() * 3), colour: rnd() < 0.5 ? '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0') : undefined, shade: 'medium' });
    fin(r); assert(r.opacity.value >= 0 && r.opacity.value <= 100 && r.contrast_ratio.value >= 0 && r.contrast_ratio.value <= 1);
  }
  console.log('✓ bad input is refused; 300 random cloths come back finite and within 0–100 %');
}
{
  const base2 = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 140 }, machine: {} };
  const none = S.analyse(base2), w = S.analyse({ ...base2, look: { shade: 'white' } }), k = S.analyse({ ...base2, look: { shade: 'black' } });
  assert(none.light === null && w.success && w.light && k.light.opacity.value > w.light.opacity.value, 'asked with the look, follows its shade');
  const c = S.analyse({ ...base2, look: { shade: 'medium' }, colour: { text: '#f4f4f4' } });
  assert(c.light.opacity.value < w.light.opacity.value + 3 && c.light.shade.luminance > 0.8, 'the colour target sets it');
  const dry = S.analyse({ ...base2, look: { shade: 'white' }, state: 'dry' }), full = S.analyse({ ...base2, look: { shade: 'white' }, state: 'full' });
  assert(dry.light.opacity.value < full.light.opacity.value, 'a washed cloth is denser and more opaque than one off the machine');
  console.log('✓ in the Studio: follows the look shade, the colour target and the cloth state');
}
console.log('Fabric light tests passed');
