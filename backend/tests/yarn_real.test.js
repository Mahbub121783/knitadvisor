// Fabric Studio · the yarn real view (frontend/assets/js/yarn-real-geom.js).
// The geometry the page draws is checked against the laws it claims and
// against the yarn engine's own spinning-system indices.
const assert = require('assert');
const G = require('../../frontend/assets/js/yarn-real-geom.js');
const { SPINNING_SYSTEMS } = require('../engine/domain/yarn-engine');
console.log('--- Running Yarn Real View Tests ---');

const NE30 = 590.5 / 30;
const yarn = (type, extra = {}) => G.build({ fibre: 'cotton', type, tex: NE30, ...extra });

// 1. the hairiness and evenness indices are the yarn engine's, not a copy that drifts
for (const [k, s] of Object.entries(G.SYSTEM)) {
  assert.ok(SPINNING_SYSTEMS[k], `${k} is a spinning system of the yarn engine`);
  assert.strictEqual(s.hair, SPINNING_SYSTEMS[k].hairiness_idx, `${k}: hairiness index equals the yarn engine's`);
  assert.strictEqual(s.u_pct, SPINNING_SYSTEMS[k].u_pct, `${k}: evenness equals the yarn engine's`);
}

// 2. the laws: fibres in the section, diameter, twist
const c = yarn('combed').meta;
assert.strictEqual(c.fibres_in_section, Math.round(NE30 / 0.17), 'fibres in the section = yarn tex / fibre tex');
assert.ok(Math.abs(c.diameter_mm / (25.4 / (28 * Math.sqrt(30))) - 1) < 0.06, `30s combed diameter ${c.diameter_mm} mm is within 6% of the 1/(28√Ne) inch rule`);
assert.ok(Math.abs(c.tpi - 3.4 * Math.sqrt(30)) < 0.11, 'TPI = αe √Ne');
assert.ok(c.twist_angle_deg > 15 && c.twist_angle_deg < 30, 'a knitting yarn has a 15–30° surface twist angle');

// 3. the spinning systems look as they should, relative to each other
const longHairs = (type) => {   // free ends and loops longer than 1 mm, over several seeds
  let n = 0, mm = 0;
  for (let s = 1; s <= 5; s++) {
    const b = G.build({ fibre: 'cotton', type, tex: NE30 }, { seed: s, length: 8 });
    mm += b.length;
    b.fibres.filter((f) => f.kind === 'hair' || f.kind === 'loop').forEach((f) => {
      let L = 0; for (let i = 3; i < f.p.length; i += 3) L += Math.hypot(f.p[i] - f.p[i - 3], f.p[i + 1] - f.p[i - 2], f.p[i + 2] - f.p[i - 1]);
      if (L > 1) n++;
    });
  }
  return n / mm;
};
assert.ok(yarn('carded').meta.hairiness_H > yarn('combed').meta.hairiness_H && yarn('combed').meta.hairiness_H > yarn('compact').meta.hairiness_H, 'H: carded > combed > compact');
assert.ok(longHairs('carded') > 2 * longHairs('compact'), 'carded shows more than twice the long hairs of compact');
assert.ok(yarn('compact').meta.diameter_mm < yarn('carded').meta.diameter_mm, 'compact is the most compact');
assert.ok(yarn('open_end').meta.diameter_mm > yarn('combed').meta.diameter_mm, 'rotor is bulkier than ring');
assert.ok(yarn('open_end').fibres.some((f) => f.kind === 'wrap'), 'rotor yarn has wrapper fibres');
assert.ok(!yarn('combed').fibres.some((f) => f.kind === 'wrap'), 'ring yarn has none');
assert.strictEqual(yarn('vortex').meta.tpi, 0, 'vortex: an untwisted core');
assert.ok(yarn('open_end').meta.tpi > yarn('combed').meta.tpi, 'rotor needs more twist than ring');

// 4. ply and filament
const p2 = yarn('combed', { ply: 2 }).meta;
assert.strictEqual(p2.fibres_in_section, 2 * c.fibres_in_section, 'a 2-ply yarn has both ends\' fibres');
assert.ok(p2.ply_tpm > 0 && p2.ply_tpm < c.tpm, 'ply twist runs at less than the single twist');
const fdy = G.build({ fibre: 'polyester_filament', type: 'fdy', tex: 75 / 9, filaments: 72 });
assert.strictEqual(fdy.meta.fibres_in_section, 72, 'a filament yarn draws its filaments');
assert.ok(!fdy.fibres.some((f) => f.kind === 'hair' || f.kind === 'loop'), 'a filament yarn has no hairs');

// 5. the same yarn always draws the same, and every point is a number
const a = yarn('carded'), b = yarn('carded');
assert.strictEqual(a.fibres.length, b.fibres.length);
assert.deepStrictEqual(Array.from(a.fibres[5].p.slice(0, 30)), Array.from(b.fibres[5].p.slice(0, 30)), 'seeded: the same yarn draws the same');
for (const t of Object.keys(G.SYSTEM)) {
  const y = yarn(t);
  assert.ok(y.fibres.every((f) => f.p.every(Number.isFinite) && f.rf > 0), `${t}: every point finite, every fibre has a radius`);
}

// 6. a coarse yarn stays drawable: the fibre count is capped, the size is not
const coarse = G.build({ fibre: 'cotton', type: 'open_end', tex: 590.5 / 4 });
assert.ok(coarse.meta.fibres_drawn <= 700 && coarse.meta.capped, '4s rotor (868 fibres): fibres drawn capped at 700');
assert.ok(Math.abs(coarse.meta.diameter_mm - G.params({ fibre: 'cotton', type: 'open_end', tex: 590.5 / 4 }).d) < 6e-4, 'its diameter is still the law\'s');

// 7. filament yarns: monofilament, multifilament (FDY), textured (DTY)
const fil = (type, extra = {}) => G.build({ fibre: 'polyester_filament', type, tex: 150 / 9, ...extra });
const mono = fil('mono', { lustre: 'bright' }).meta;
assert.strictEqual(mono.filaments, 1, 'a monofilament is one filament');
assert.ok(Math.abs(mono.diameter_mm - 2 * Math.sqrt((150 / 9) / (1.38 * 1000) / Math.PI)) < 6e-4, 'its diameter is the solid polymer rod: 2√(tex / ρπ)');
assert.strictEqual(mono.tio2_pct, 0, 'bright: no delustrant');
const f75 = G.build({ fibre: 'polyester_filament', type: 'fdy', tex: 75 / 9 }).meta;
assert.strictEqual(f75.filaments, 75, 'FDY with no filament count: about 1 denier per filament');
const d96 = fil('dty', { filaments: 96, crimp: 35 }).meta;
// the crimp law: a helix of pitch p and radius a shortens the filament to p / √(p² + (2πa)²)
const pc = d96.coil_pitch_mm, ac = d96.coil_radius_um / 1000;
assert.ok(Math.abs(1 - pc / Math.hypot(pc, 2 * Math.PI * ac) - 0.35) < 0.01, 'coil radius reproduces the crimp contraction');
assert.ok(d96.bulk_ratio > 1.3 && fil('fdy', { filaments: 96 }).meta.bulk_ratio < 1.1, 'DTY is bulked, FDY is not');
assert.ok(fil('dty', { filaments: 96, crimp: 12 }).meta.diameter_mm < d96.diameter_mm, 'less crimp, less bulk');
assert.strictEqual(fil('fdy', { lustre: 'full_dull' }).meta.tio2_pct, 2, 'full-dull carries about 2% TiO2');
assert.strictEqual(fil('fdy', { section: 'trilobal' }).fibres[0].shape, 'trilobal', 'the cross-section reaches the drawing');
const nodes = fil('fdy', { filaments: 48, interlace: 25 });
assert.strictEqual(nodes.meta.nodes_per_m, 25, 'intermingling nodes as given');
assert.ok(fil('fdy', { interlace: 0 }).meta.nodes_per_m === 0, 'no intermingling when 0 is given');
for (const t of ['mono', 'fdy', 'dty']) assert.ok(fil(t).fibres.every((f) => f.p.every(Number.isFinite)), `${t}: every point finite`);

// 8. the Studio engine knows the monofilament as one filament, and carries the lustre
const S = require('../engine/domain/fabric-studio');
const t0 = S.listTemplates().find((x) => x.id === 'single_jersey');
const mo = S.analyse({ bed: 'single', gating: 'rib', grid: t0.grid, feeds: t0.roles.map((role) => ({ role })), yarn: { fibre: 'polyester_filament', type: 'mono', count: 30, unit: 'denier', lustre: 'bright' }, target: { gsm: 100 }, machine: {} });
assert.ok(mo.success, 'a monofilament jersey analyses');
assert.ok(mo.yarn.character[0].look.filament && mo.yarn.character[0].look.lustre > 0.9, 'bright monofilament reaches the fabric view as bright filament');

// 9. elastane: bare, core-spun, covered (single and double)
const el = (type, extra = {}, o = {}) => G.build({ fibre: 'elastane', type, denier: 40, draft: 3, ...extra }, o);
const dRelLaw = 2 * Math.sqrt((40 / 9) / (G.EL_RHO * 1000 * Math.PI));
const bare = el('bare').meta;
assert.ok(Math.abs(bare.diameter_mm - dRelLaw) < 6e-4 && Math.abs(bare.diameter_mm - 0.068) < 0.002, 'a 40 D elastane is about 68 µm across, from denier and density');
assert.ok(Math.abs(el('bare', { state: 'drafted' }).meta.diameter_mm - dRelLaw / Math.sqrt(3)) < 6e-4, 'drafted: the rubber keeps its volume, so d falls as 1/√draft');
assert.strictEqual(bare.coalesced_filaments, 4, 'about one coalesced filament per 10 denier');

const SH = { fibre: 'cotton', type: 'combed', tex: 590.5 / 30 };
const core = el('core', { sheath: SH });
assert.ok(Math.abs(core.meta.core_share_pct - ((40 / 9 / 3) / (590.5 / 30)) * 100) < 0.06, 'core mass per yarn length = tex ÷ draft, as the engine\'s mass balance has it');
assert.ok(Math.abs(core.meta.tex - 590.5 / 30) < 0.01, 'the yarn keeps its count; the sheath is what is left after the core');
const Rcore = core.meta.core_diameter_drafted_um / 2000;
let minR = Infinity;
core.fibres.filter((f) => f.kind === 'body').forEach((f) => { for (let i = 0; i < f.p.length; i += 3) minR = Math.min(minR, Math.hypot(f.p[i], f.p[i + 2])); });
assert.ok(minR > Rcore * 0.88, 'no sheath fibre runs through the core');
assert.ok(core.meta.hairiness_H > 0 && core.meta.tpi > 0, 'the core-spun yarn keeps its sheath\'s twist and hairiness');
assert.ok(el('core', { sheath: { fibre: 'polyester_filament', type: 'fdy', tex: 10 } }).meta.sheath_fell_back, 'a filament cannot be a spun sheath: said, and a cotton sheath is shown');
const cut = el('core', { sheath: SH }, { cutaway: true });
const y0 = cut.length * 0.3, y1 = cut.length * 0.64;
assert.ok(cut.fibres.filter((f) => f.kind !== 'core').every((f) => { for (let i = 0; i < f.p.length; i += 3) if (f.p[i + 1] >= y0 && f.p[i + 1] <= y1 && f.p[i + 2] > 1e-6) return false; return true; }), 'the cutaway removes the sheath in front of the plane');
assert.ok(cut.fibres.some((f) => f.kind === 'core'), '... and keeps the core');

const cov = el('covered').meta, covD = el('covered', { state: 'drafted' }).meta;
assert.ok(Math.abs(cov.wrap_pitch_mm - 1000 / (900 * 3)) < 1e-3, 'relaxed: a cover wound at 900 turns/m on a core drafted ×3 has 2700 turns/m');
assert.ok(Math.abs(covD.wrap_pitch_mm - 1000 / 900) < 1e-3, 'at knitting draft the pitch is the covering pitch');
const rho = cov.core_diameter_mm / 2 + (cov.cover_filament_um / 2000) * 0.9;
assert.ok(Math.abs(cov.wrap_angle_deg - Math.round(Math.atan((2 * Math.PI * rho) / cov.wrap_pitch_mm) * 180 / Math.PI)) <= 1, 'wrap angle from tan α = 2πρ / p');
assert.ok(cov.wrap_angle_deg > covD.wrap_angle_deg, 'relaxing winds the cover steeper');
assert.ok(cov.coverage_pct > 0 && cov.coverage_pct < 100, 'a cover is partial: the core shows between the wraps');
const hand = (f) => { const a0 = Math.atan2(f.p[2], f.p[0]); let a1 = Math.atan2(f.p[5], f.p[3]); let d = a1 - a0; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.sign(d * (f.p[4] - f.p[1])); };
const dc = el('dcovered');
const covers = dc.fibres.filter((f) => f.kind === 'cover');
assert.strictEqual(covers.length, 2 * dc.meta.cover_filaments, 'a double-covered yarn has two layers of the cover yarn');
assert.strictEqual(hand(covers[0]) * hand(covers[covers.length - 1]), -1, 'the two layers wind in opposite hands');
assert.ok(dc.meta.diameter_mm > cov.diameter_mm, 'double covered is thicker');
for (const t of ['bare', 'covered', 'dcovered']) assert.ok(el(t).fibres.every((f) => f.p.every(Number.isFinite)), `${t}: every point finite`);
assert.ok(core.fibres.every((f) => f.p.every(Number.isFinite)), 'core-spun: every point finite');


// 9. a melange yarn: every fibre has the colour of its component. A fibre blend is coloured by number share; a marl by whole strand
{
  const lum = (t) => 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  const body = (b) => b.fibres.filter((f) => f.kind === 'body');
  const parts = [{ fibre: 'cotton', share: 85, colour: '#ede9df' }, { fibre: 'viscose', share: 15, colour: '#1d1d20' }];
  const mb = G.build({ fibre: 'cotton', type: 'combed', tex: NE30, mottle: { mode: 'fibres', parts } });
  assert.strictEqual(mb.meta.mottled, true, 'a melange is flagged');
  const dark = body(mb).filter((f) => lum(f.tone) < 0.1).length, all = body(mb).length;
  assert.ok(Math.abs(dark / all - 0.15) < 0.04, `dark fibres ${dark}/${all} follow the 15 % number share`);
  assert.ok(body(mb).filter((f) => lum(f.tone) >= 0.1).every((f) => f.fibre === 'cotton'), 'light fibres are cotton, dark ones viscose');
  assert.ok(body(mb).filter((f) => lum(f.tone) < 0.1).every((f) => f.fibre === 'viscose'));
  assert.strictEqual(G.build({ fibre: 'cotton', type: 'combed', tex: NE30 }).meta.mottled, false, 'a plain yarn is not');
  // the same melange twice is the same yarn (deterministic), and the colours do not change the geometry
  const mb2 = G.build({ fibre: 'cotton', type: 'combed', tex: NE30, mottle: { mode: 'fibres', parts } });
  assert.deepStrictEqual(body(mb).map((f) => f.tone), body(mb2).map((f) => f.tone));
  // a folded marl: ply 0 one colour, ply 1 the other
  const ml = G.build({ fibre: 'cotton', type: 'combed', tex: NE30 / 2, ply: 2, mottle: { mode: 'strands', parts: [{ fibre: 'cotton', share: 50, colour: '#1f2f5a' }, { fibre: 'cotton', share: 50, colour: '#ede9df' }] } });
  const bs = body(ml), half = bs.length / 2;
  const L = (a) => a.reduce((t, f) => t + lum(f.tone), 0) / a.length;
  assert.ok(L(bs.slice(0, half)) < 0.1 && L(bs.slice(half)) > 0.5, 'each ply is one colour');
  // garbage is ignored, not a crash
  assert.strictEqual(G.build({ fibre: 'cotton', type: 'combed', tex: NE30, mottle: { mode: 'fibres', parts: [{ fibre: 'cotton', share: 1, colour: 'red' }] } }).meta.mottled, false);
  assert.ok(G.build({ fibre: 'poly_filament', type: 'fdy', tex: 8, mottle: { mode: 'fibres', parts } }).fibres.length > 0, 'filaments ignore it');
  console.log('✓ melange yarn view: each fibre in its own colour, by share or by ply');
}

console.log('✓ Yarn real view tests passed');
