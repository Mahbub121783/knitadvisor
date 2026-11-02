// Shade × composition — melange, fluorescent, white and dyed routes.
const assert = require('assert');
const { analyzeShadeSpec, _lStar } = require('../engine/domain/shade-spec');
const { calculate } = require('../engine');

console.log('--- Running Shade Spec Tests ---');
const S = (shade, fibers, extra = {}) => analyzeShadeSpec({ shade, fibers, ...extra });
const C = (comp, extra) => calculate({ fabric: 'single_jersey', gsm: 180, composition: comp, efficiency: 85, ...extra });

// 1. melange: viscose is the standard dark fibre, and its share IS the shade
{
  const g = S('melange', { cotton: 90, viscose: 10 });
  assert.strictEqual(g.melange.type, 'grey');
  assert.strictEqual(g.melange.carrier, 'viscose');
  assert.strictEqual(g.composition_check.status, 'ok');
  const L = (v) => S('melange', { cotton: 100 - v, viscose: v }).melange.lightness_L;
  const Ls = [2, 10, 30, 55, 85].map(L);
  for (let i = 1; i < Ls.length; i++) assert(Ls[i] < Ls[i - 1], 'more dark fibre, darker melange');
  assert(Ls[1] > 66 && Ls[1] < 79, `grey melange 10% sits around L* 72 (${Ls[1]})`);
  assert(Ls[2] > 48 && Ls[2] < 62, `anthra 30% around L* 55 (${Ls[2]})`);
  assert.strictEqual(S('melange', { cotton: 70, viscose: 30 }).melange.type, 'anthra', 'type follows the viscose share');
  // asking for anthra with 10% viscose is a mismatch, with a fix both ways
  const m = S('melange', { cotton: 90, viscose: 10 }, { melange_type: 'anthra' });
  assert.strictEqual(m.composition_check.status, 'mismatch');
  assert(m.composition_check.suggestions.some((x) => x.composition === '70% Cotton 30% Viscose'), 'offers the anthra composition');
  assert(m.composition_check.suggestions.some((x) => x.melange_type === 'grey'), 'or keeps it and calls it grey');
}

// 2. melange without viscose: still works, by the route the fibres allow
{
  const cot = S('melange', { cotton: 100 });
  assert.strictEqual(cot.melange.carrier, 'cotton', '100% cotton melange is fibre-dyed cotton');
  assert.strictEqual(cot.composition_check.status, 'note');
  assert(cot.melange.yarn_premium_usd > S('melange', { cotton: 90, viscose: 10 }).melange.yarn_premium_usd, 'and dearer than viscose melange');
  assert(cot.composition_check.suggestions.some((x) => /Viscose/.test(x.composition)), 'suggests the viscose route');
  const cvc = S('melange', { cotton: 60, polyester: 40 });
  assert.strictEqual(cvc.melange.carrier, 'cross_dye', 'CVC melange is a cross-dyed heather');
  assert.strictEqual(cvc.costing_shade, 'light_medium', 'a heather IS dyed: priced as a dyeing, not a wash');
  const r = C('100% Cotton', { color_shade: 'melange' });
  assert(r.costing.yarn_surcharges.some((x) => /Melange/.test(x.name)), 'the melange premium reaches the yarn price');
  assert.strictEqual(r.shade_spec.melange.carrier, 'cotton');
  const h = C('60% Cotton 40% Polyester', { color_shade: 'melange' });
  assert(h.costing.dyeing_per_kg_usd > C('90% Cotton 10% Viscose', { color_shade: 'melange' }).costing.dyeing_per_kg_usd, 'heather dyeing costs more than a melange wash');
}

// 3. fluorescent: polyester glows, cotton does not
{
  const p = S('fluorescent', { polyester: 100 }, { neon: 'yellow' });
  const c = S('fluorescent', { cotton: 100 }, { neon: 'yellow' });
  assert(p.fluorescent.brightness_pct === 100 && c.fluorescent.brightness_pct < 65, 'brightness: polyester 100, cotton about half');
  assert(p.fluorescent.hi_vis.possible && !c.fluorescent.hi_vis.possible, 'hi-vis only on polyester');
  assert.strictEqual(c.composition_check.status, 'mismatch');
  assert(c.composition_check.suggestions[0].composition === '100% Polyester');
  assert(p.fluorescent.light_fastness > c.fluorescent.light_fastness, 'fades faster on cotton');
  // what the cotton reaches is duller than the neon
  const sat = (hex) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
  assert(sat(c.render_hex) < sat(p.render_hex), 'a cotton neon renders duller');
  assert(/no true fluorescent blue/.test(S('fluorescent', { polyester: 100 }, { colorHex: '#1F5BFF' }).warnings.join(' ')), 'blue is flagged');
  assert(S('fluorescent', { polyester: 100 }, { colorHex: '#FF2D95' }).fluorescent.neon === 'pink', 'the exact colour picks the neon');
  // a polyester neon renders the neon in the views
  const r = C('100% Polyester', { color_shade: 'fluorescent', neon_color: 'orange' });
  assert(r.shade_spec.fluorescent.neon === 'orange' && r.fabric_physics.rendered_color.hex);
}

// 4. white: four whites, four processes and prices
{
  const o = S('white_melange', { cotton: 100 }), e = S('white_melange', { cotton: 100 }, { white_type: 'ecru' });
  assert(o.white.whiteness_index > e.white.whiteness_index, 'optic is whiter than ecru');
  assert(_lStar(o.render_hex) > _lStar(e.render_hex));
  assert(C('100% Cotton', { color_shade: 'white_melange', white_type: 'ecru' }).costing.dyeing_per_kg_usd <= C('100% Cotton', { color_shade: 'white_melange' }).costing.dyeing_per_kg_usd, 'ecru (scour only) never costs more than optic white (the sheet has one White/Melange price)');
  assert.strictEqual(S('white_melange', { polyester: 100 }, { white_type: 'ecru' }).composition_check.status, 'note', 'ecru polyester is a tint');
}

// 5. dyed: blends get two baths
{
  const d = S('dark_navy', { cotton: 60, polyester: 40 });
  assert(/two baths/.test(d.dyed.route) && d.composition_check.status === 'note');
  assert(/reactive/.test(S('black', { cotton: 100 }).dyed.route));
}

// 6. through calculate(): inputs whitelisted, the views get a melange split, no sources
{
  const { ENGINE_INPUTS } = require('../engine');
  for (const k of ['melange_type', 'melange_pct', 'white_type', 'neon_color']) assert(ENGINE_INPUTS.includes(k), k + ' is whitelisted');
  const r = C('85% Cotton 15% Viscose', { color_shade: 'melange', melange_pct: 15 });
  const m = r.shade_spec.melange;
  assert(m.dark_hex && m.light_hex && m.light_fraction > 0 && m.light_fraction < 1, 'the views get both fibre colours and the light share');
  assert(!/Hearle|Munden|textilelearner|ISO 20471.*http/i.test(JSON.stringify(r.shade_spec)), 'no source attribution');
  const plain = C('100% Cotton', {});
  assert.strictEqual(plain.shade_spec, null, 'no shade, no spec');
}

// 7. the API module must load: a duplicate import there took the server down
//    on 2026-11-02 while every engine test still passed
{
  const router = require('../routes/api');
  assert(router && typeof router === 'function', 'routes/api.js loads');
}

console.log('\nAll shade spec tests passed.');
