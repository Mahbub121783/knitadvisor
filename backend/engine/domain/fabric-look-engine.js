/**
 * KnitAdvisor — Fabric look engine: the real lustre and texture of a cloth, from the yarn to the finished fabric.
 *
 * Every engine below this one describes a piece of the look: the blend yarn engine gives a yarn its sheen, hairiness, softness and
 * bending rigidity; the yarn chemistry engine says what the wet route does; the structure traits say how much relief the drawn
 * programme has; the Studio's fabric numbers say how tight the loops are. This engine carries one yarn through the whole life of
 * the cloth, stage by stage, and says what the eye and the hand find at each:
 *
 *   1  YARN        as spun: its specular strength (refractive index, cross-section, delustrant), its hairs, its hand
 *   2  KNITTED     as it comes off the machine (greige): the loops give the yarn's gloss a geometry — how much surface the yarn
 *                  covers, how well the face yarns line up, what tucks and floats do — and the hairs stand out
 *   3  SCOURED     wax, oil and size off: cleaner, a little brighter
 *   4  DYED        relaxed and wet-processed: the cloth shrinks to its finished density; the colour sets the CONTRAST of the gloss
 *                  (the same sheen is far more visible on a black than on a white)
 *   5  FINISHED    mercerising (cotton's sheen up by the measured multiple), bio-polishing (the cellulosic hairs off, the
 *                  polyester's stay), heat-setting, softening, brushing or raising
 *
 * Each stage reports a sheen index (a yarn of raw combed cotton = 100), the perceived gloss contrast, the hairiness, the stitch
 * definition, a roughness index and the hand. The last stage is what the 3D views draw: the engine returns the material, hair and
 * finish settings (`render`) the Realistic cloth view takes, so the lustre and texture on screen are the engines', not a guess.
 *
 * Every figure carries its basis (the convention of materials.js and the other yarn engines):
 *   measured   a published fibre-property table value        law       worked out by physics or arithmetic
 *   blend      measured fibre values combined by the law that applies   typical   an industry default
 *   estimate   a model not yet calibrated on the mill's own cloth
 * The geometry multipliers (loop cover, alignment, floats) and the finishing multipliers are estimates: they are stated, and
 * replaced by a measured gloss reading (a glossmeter on the finished cloth) which fits the model. No outside source is named.
 */
'use strict';

const BY = require('./blend-yarn-engine');
const U = require('./uster-engine');
const YC = require('./yarn-character');
const FY = require('./fancy-yarn-engine');
const Y = require('./yarn-engine');

class LookError extends Error {}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rd = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
const r1 = (v) => rd(v, 1), r2 = (v) => rd(v, 2), r3 = (v) => rd(v, 3);
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value, unit, basis, ...(extra || {}) });

// the diffuse reflectance (luminance factor) of the cloth's body colour by depth: what the sheen has to stand out against
const BODY = { white: 0.85, pastel: 0.6, light: 0.4, medium: 0.2, dark: 0.08, black: 0.04 };
const SHADES = Object.keys(BODY);
// a cotton-raw yarn's specular reflectance (Fresnel at n ≈ 1.55): the sheen index 100
const R_COTTON = Math.pow((1.55 - 1) / (1.55 + 1), 2);
// the renderer's fibre keys
const FIBRE_3D = { cotton: 'cotton', polyester: 'polyester', viscose: 'viscose', modal: 'modal', tencel: 'viscose', bamboo: 'viscose', nylon: 'nylon', acrylic: 'acrylic', wool: 'wool', silk: 'silk', linen: 'linen', elastane: 'spandex' };

// the lustre scale of the yarn-character engine (0–1) and the sheen index, both ways
const lustreOf = (index) => clamp(1 - Math.exp(-(index - 60) / 220), 0, 0.99);
const indexOf = (lustre) => 60 - 220 * Math.log(1 - clamp(lustre, 0, 0.99));
const lustreClass = (l) => (l < 0.18 ? 'matt' : l < 0.35 ? 'soft sheen' : l < 0.6 ? 'lustrous' : l < 0.85 ? 'bright' : 'glassy');

// ── the glossmeter: ASTM D523 geometry (20°, 60°, 85°), a gloss unit (GU) = 1000 × the specular reflectance ──────────────────────────────
// 100 GU is the reflectance of polished black glass (n = 1.567): 10 % at 60°. A textile reflects a small, scattered share of that: the
// specular fraction of its surface (the share of the face lying at the mirror angle) falls as the surface gets rougher.
function fresnel(n, deg) {
  const ci = Math.cos(deg * Math.PI / 180), st = Math.sin(deg * Math.PI / 180) / n, ct = Math.sqrt(1 - st * st);
  const rs = Math.pow((ci - n * ct) / (ci + n * ct), 2), rp = Math.pow((n * ci - ct) / (n * ci + ct), 2);
  return (rs + rp) / 2;
}
const ANGLES = [20, 60, 85];
const specFraction = (rough) => 0.12 * Math.pow(1 - clamp(rough / 100, 0, 1), 2);
const guOf = (sheen, rough, angle) => 1000 * fresnel(1.55, angle) * (sheen / 100) * specFraction(rough);
const STAGE_IDS = ['knitted', 'scoured', 'dyed', 'finished'];

/** The yarn's own look: from the blend yarn engine for a staple yarn, from the yarn character for a filament. */
function yarnLook(y, mercerised) {
  const L = yarnLook0(y, mercerised);
  // a fancy yarn's effect changes how much sheen reaches the eye, how hairy it reads and how it feels
  const fm = y.form && FY.LOOK[y.form];
  if (fm && L) { L.sheen *= fm.sheen; L.hair_rel *= fm.hair; L.softness += fm.soft; L.form = y.form; }
  return L;
}
function yarnLook0(y, mercerised) {
  if (y.filament) {
    const fam = y.mix && y.mix.nylon > 50 ? 'nylon' : 'polyester';
    const ch = YC.yarnCharacter({ spinKey: 'combed', spin: Y.SPINNING_SYSTEMS.combed, form: 'single', fibers: { [fam]: 100 }, countNe: 590.5 / y.tex, poly_form: y.type, poly_lustre: y.lustre || 'semi_dull' });
    const l = ch.look;
    const idx = indexOf(l.lustre);
    return { source: 'filament', sheen: idx, hair_rel: l.hairAbs, hair_len: l.hairLen, softness: 100, crispness: 60, bulk: l.bulk, fibre: fam, fibre_share: { [fam]: 1 }, cellulosic_hair: 0, synthetic: 1, cotton_share: 0, poly_share: fam === 'polyester' ? 1 : 0, pill: 1.2, uneven: 5, filament: true, dty: !!l.dty, label: fam === 'nylon' ? 'Nylon filament' : 'Polyester filament', diameter_mm: null, blend: null };
  }
  const fibres = {};
  for (const [f, v] of Object.entries(y.mix || { cotton: 100 })) if (f !== 'elastane' && +v > 0 && own(BY.FIB, f)) fibres[f] = +v;
  if (!Object.keys(fibres).length) fibres.cotton = 100;
  const r = BY.analyse({ fibres, count: { value: Math.min(y.tex, 120), unit: 'tex' }, spinning: y.spinning && own(BY.GEO, y.spinning) ? y.spinning : undefined, mercerised: !!mercerised });
  const comp = r.composition.per_fibre;
  const hairParts = comp.map((c) => ({ id: c.fibre, h: (c.dry_share_pct / 100) * BY.FIB[c.fibre].hair, cell: !!BY.FIB[c.fibre].cellulosic }));
  const hT = hairParts.reduce((t, x) => t + x.h, 0) || 1;
  const cot = comp.find((c) => c.fibre === 'cotton');
  const area = Object.fromEntries(comp.map((c) => [c.fibre, c.area_share_pct / 100]));
  return {
    source: 'blend', sheen: r.lustre.index.value, hair_rel: r.texture.hairiness_vs_combed_cotton.value, hair_len: 1, softness: r.texture.softness.value, crispness: r.texture.crispness.value, bulk: r.texture.bulk.value,
    fibre: comp.slice().sort((a, b) => b.area_share_pct - a.area_share_pct)[0].fibre, fibre_share: area, cellulosic_hair: hairParts.filter((x) => x.cell).reduce((t, x) => t + x.h, 0) / hT,
    synthetic: comp.filter((c) => BY.FIB[c.fibre].synthetic).reduce((t, c) => t + c.dry_share_pct / 100, 0), cotton_share: cot ? cot.dry_share_pct / 100 : 0, poly_share: (comp.find((c) => c.fibre === 'polyester') || { dry_share_pct: 0 }).dry_share_pct / 100,
    pill: r.properties.pilling.index.value, uneven: r.evenness.u_pct.value, filament: false, label: r.identity.label, diameter_mm: r.geometry.diameter.value, blend: r,
  };
}

/** The geometry the loops give a yarn's gloss. cover: the share of the face the yarn covers (≈ 1 is a full cover). */
function geometry(st, cover) {
  const a = 0.1 + 0.3 * st.face_knit_share;                               // the face yarns lie in rows of V's: aligned, an anisotropic sheen
  const covered = 1 - Math.exp(-cover);                                   // the yarn overlaps itself: the share of the face it actually covers
  const G = (0.55 + 0.45 * covered) * (1 + 0.15 * a);
  return { G: G * (1 + 0.25 * st.miss_share - 0.2 * st.tuck_share), alignment: a };
}

function coverOf(st) {
  if (!(st.wpc > 0 && st.cpc > 0 && st.loop_mm > 0 && st.yarn_d_mm > 0)) return 0.85;
  return clamp(st.loop_mm * st.yarn_d_mm * (st.wpc * st.cpc) / 100, 0.3, 1.4);   // yarn length × diameter ÷ the area of one loop cell (mm²)
}

function stage(id, label, o) {
  const sheen = o.sheen, Rs = R_COTTON * (sheen / 100), Rd = o.body;
  const contrast = Rs / (Rs + Rd);
  const hair = o.hair, relief = o.relief;
  const definition = clamp(0.95 - 0.22 * Math.min(hair, 4) - 0.3 * Math.max(0, o.cover - 0.95), 0.05, 1) * (o.defMul || 1);
  const rough = clamp(0.10 + 0.20 * Math.min(hair, 4) + 0.45 * relief + 0.12 * (1 - definition) - (o.smoothMul || 0), 0.02, 1);
  return {
    id, label, sheen_index: V(r1(sheen), 'raw cotton yarn = 100', o.basis || 'estimate'), lustre: r2(lustreOf(sheen)), lustre_class: lustreClass(lustreOf(sheen)),
    perceived_gloss: V(r1(contrast * 100), '% of the light that is specular', 'law'), hairiness: V(r2(hair), '× combed cotton', 'estimate'),
    stitch_definition: V(r1(definition * 100), '0–100', 'estimate'), roughness: V(r1(rough * 100), '0–100', 'estimate'), softness: V(r1(o.softness), 'cotton yarn = 100', 'estimate'), cover: V(r2(o.cover), '', 'law'),
    gloss_units: V(r1(guOf(sheen, rough * 100, 60)), 'GU at 60°', o.cal ? 'calibrated' : 'estimate'),
    note: o.note || null,
  };
}

function face(yarn, merc, st, fin, which, cal) {
  const body = BODY[fin.shade];
  const cover = coverOf(st);
  const geoK = geometry(st, cover * 0.92);                                // greige: loops not yet relaxed, a little less cover
  const geoF = geometry(st, cover);
  const relief = clamp(st.relief, 0, 1);
  const stages = [];
  const y0 = yarn.sheen;
  stages.push(stage('yarn', 'Yarn as spun', { sheen: y0, hair: yarn.hair_rel, relief: 0, cover: 0, body: 0.85, softness: yarn.softness, note: yarn.filament ? 'a filament yarn: no hairs, the polymer\'s own sheen' : 'a spun yarn: the fibres\' sheen under a halo of hairs' }));
  const SC = cal ? cal.scale : 1;                                          // a measured gloss fits the model's fabric-level specular strength
  const sK = y0 * geoK.G * SC;
  stages.push(stage('knitted', 'Knitted (greige)', { cal: !!cal, sheen: sK, hair: yarn.hair_rel, relief, cover: cover * 0.92, body: 0.85, softness: yarn.softness * 0.97, note: 'the loops give the yarn\'s gloss a geometry: the cover, the alignment of the face yarns, what tucks and floats do' }));
  const clean = 1 + 0.04 * (yarn.cotton_share + (1 - yarn.synthetic) * 0.5);
  stages.push(stage('scoured', 'Scoured and bleached', { cal: !!cal, sheen: sK * clean, hair: yarn.hair_rel, relief, cover: cover * 0.94, body: 0.85, softness: yarn.softness * 1.02, note: 'wax, oil and size off: cleaner and a little brighter' }));
  const sD = y0 * geoF.G * clean * SC;
  stages.push(stage('dyed', 'Dyed and relaxed', { cal: !!cal, sheen: sD, hair: yarn.hair_rel, relief, cover, body, softness: yarn.softness * 1.02, note: 'relaxed to the finished density, and the colour sets how visible the gloss is: the same sheen shows far more on a dark shade' }));
  // finishing
  let sheen = sD, hair = yarn.hair_rel, soft = yarn.softness * 1.02, defMul = 1, smooth = 0;
  const notes = [];
  let mercMul = 1;
  if (fin.mercerise && yarn.cotton_share > 0 && !yarn.filament) {
    const m = yarnLook({ ...yarn._src }, true);
    mercMul = m.sheen / y0; sheen = sD * mercMul; notes.push(`mercerised: the cotton's sheen × ${r2(mercMul)} (the cotton fibre's measured multiple, weighted by its share of the surface)`);
  }
  const brushed = which === 'back' ? fin.brushed === 'back' || fin.brushed === 'both' : fin.brushed === 'face' || fin.brushed === 'both';
  if (fin.biopolish && yarn.cellulosic_hair > 0 && !brushed) {
    const cut = 0.7 * yarn.cellulosic_hair;
    hair = hair * (1 - cut); soft += 8; notes.push(`bio-polished: the cellulosic hairs cut by 70 % (${r1(cut * 100)} % of the yarn's hairs); ${yarn.synthetic > 0.05 ? 'the polyester\'s hairs stay, so its pills stay' : 'a clean face'}`);
  }
  if (fin.heatset && yarn.poly_share > 0) { sheen *= 1 + 0.03 * yarn.poly_share; soft -= 5 * yarn.poly_share; notes.push('heat-set: the polyester surface smoothed, a little stiffer'); }
  if (fin.softener) { smooth += 0.08; soft += 10; notes.push('softened: less friction, a softer hand'); }
  if (brushed) { hair *= 5; sheen *= 0.4; defMul = 0.5; soft += 18; notes.push('raised: the fibre ends stand up as a nap, the gloss goes (× 0.4) and the stitch is hidden'); }
  if (cal && cal.finish_scale && cal.finish_scale !== 1) { sheen *= cal.finish_scale; notes.push(`the finishing's effect on the gloss fitted to your readings (× ${r2(cal.finish_scale)})`); }
  stages.push(stage('finished', 'Finished', { cal: !!cal, sheen, hair, relief, cover, body, softness: soft, defMul, smoothMul: smooth, note: notes.length ? notes.join('; ') + '.' : 'no finish beyond the wet processing.' }));
  return { stages, yarn, geometry: { cover: r2(cover), alignment: r2(geoF.alignment), factor_knitted: r3(geoK.G), factor_finished: r3(geoF.G) }, mercerise_multiple: mercMul, brushed };
}

function renderOf(f, fin, st, which) {
  const fl = f.stages[f.stages.length - 1], knit = f.stages[1];
  const y = f.yarn;
  // the finishing the renderer knows, one id: the strongest wins
  let finishId = 'none';
  if (f.brushed) finishId = 'brushed';
  else if (fin.mercerise && y.cotton_share > 0.4) finishId = 'mercerized';
  else if (fin.biopolish && y.cellulosic_hair > 0.3) finishId = 'enzyme_wash';
  else if (fin.softener) finishId = 'silicone';
  const sheenK = knit.sheen_index.value;
  const roughness = clamp(1.0 - 0.55 * Math.log10(Math.max(sheenK, 40) / 50), 0.22, 0.92);
  const cover = coverOf(st);
  return {
    fibre_type: FIBRE_3D[y.fibre] || 'cotton',
    yarn_look: { hairAbs: r2(clamp(y.hair_rel, 0.03, 2)), hairLen: r2(y.hair_len || 1), gloss: r2(clamp(sheenK / 115, 0.5, 3)), bulk: r2(y.bulk || 1), lustre: r2(lustreOf(sheenK)), lustre_class: lustreClass(lustreOf(sheenK)), filament: !!y.filament, dty: !!y.dty },
    physics: { finish_id: finishId, specular_sheen: r2(clamp((sheenK - 100) / 500, 0, 0.7)), roughness: r2(roughness), texture_modifier: r2(clamp(0.8 + 0.4 * st.relief, 0.5, 1.5)), shadow_depth: r2(clamp(0.28 - 0.16 * Math.min(1, cover), 0.06, 0.3)) },
    dye_method: fin.dye_method,
    side: which,
    finished: { sheen_index: fl.sheen_index.value, lustre: fl.lustre, perceived_gloss: fl.perceived_gloss.value, hairiness: fl.hairiness.value, roughness: fl.roughness.value },
  };
}

function analyse(input) {
  if (!input || typeof input !== 'object') throw new LookError('Give the cloth: its yarns, its structure and its finish.');
  const yarns = Array.isArray(input.yarns) ? input.yarns.filter((y) => y && +y.tex > 0) : [];
  if (!yarns.length) throw new LookError('Give at least one yarn with its fibres and count.');
  const s = input.structure && typeof input.structure === 'object' ? input.structure : {};
  const st = {
    tuck_share: clamp(+s.tuck_share || 0, 0, 1), miss_share: clamp(+s.miss_share || 0, 0, 1), face_knit_share: clamp(s.face_knit_share != null ? +s.face_knit_share : 1, 0, 1),
    relief: clamp(+s.relief || 0, 0, 1), wpc: +s.wpc || 0, cpc: +s.cpc || 0, loop_mm: +s.loop_mm || 0, yarn_d_mm: +s.yarn_d_mm || 0, family: s.family || null,
  };
  const f0 = input.finish && typeof input.finish === 'object' ? input.finish : {};
  let shade = own(BODY, f0.shade) ? f0.shade : null;
  if (!shade && /^#[0-9a-f]{6}$/i.test(f0.colour || '')) {
    const c = [1, 3, 5].map((i) => parseInt(f0.colour.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const Yl = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
    shade = Yl > 0.6 ? 'white' : Yl > 0.38 ? 'pastel' : Yl > 0.2 ? 'light' : Yl > 0.09 ? 'medium' : Yl > 0.035 ? 'dark' : 'black';
  }
  shade = shade || 'medium';
  const fin = {
    shade, mercerise: !!f0.mercerise, biopolish: f0.biopolish == null ? true : !!f0.biopolish, heatset: f0.heatset == null ? true : !!f0.heatset, softener: f0.softener == null ? true : !!f0.softener,
    brushed: ['face', 'back', 'both'].includes(f0.brushed) ? f0.brushed : 'none', dye_method: ['reactive', 'disperse', 'pigment', 'discharge', 'garment_wash'].includes(f0.dye_method) ? f0.dye_method : 'reactive',
  };
  const by = {};
  yarns.forEach((y) => { by[y.role || 'ground'] = y; });
  const mk = (y) => { const yl = yarnLook(y, false); yl._src = y; return yl; };
  const faceYarn = by.ground || by.face || yarns[0];
  const backYarn = by.loop || faceYarn;
  let F = face(mk(faceYarn), fin.mercerise, st, fin, 'face');
  // glossmeter readings of the cloth fit the model: the ratio of what was measured to what the model predicted, per stage
  let calibration = null;
  const readings = readGloss(input.gloss);
  if (readings.length) {
    const rows = readings.map((r) => {
      const stg = F.stages.find((x) => x.id === r.stage);
      const pred = guOf(stg.sheen_index.value, stg.roughness.value, r.angle);
      return { stage: r.stage, angle: r.angle, measured_gu: r.gu, predicted_gu: r1(pred), ratio: pred > 1e-9 ? r.gu / pred : null };
    });
    const early = rows.filter((x) => x.stage !== 'finished' && x.ratio != null), fin1 = rows.find((x) => x.stage === 'finished' && x.ratio != null);
    const k = early.length ? early.reduce((t, x) => t * x.ratio, 1) ** (1 / early.length) : fin1 ? fin1.ratio : null;
    if (k != null) {
      const scale = clamp(k, 0.05, 20);
      const finishScale = early.length && fin1 ? clamp(fin1.ratio / scale, 0.2, 5) : 1;
      F = face(mk(faceYarn), fin.mercerise, st, fin, 'face', { scale, finish_scale: finishScale });
      calibration = {
        applied: true, basis: 'calibrated', readings: rows.map((x) => ({ ...x, ratio: x.ratio == null ? null : r2(x.ratio), predicted_gu_after: r1(guOf(F.stages.find((y) => y.id === x.stage).sheen_index.value, F.stages.find((y) => y.id === x.stage).roughness.value, x.angle)) })),
        fitted: { specular_scale: r2(scale), finish_scale: r2(finishScale) },
        note: 'The model predicted a gloss for each stage you measured; the ratio of your reading to it fits the fabric-level specular strength (every stage from the knitted cloth on) and, if you measured the finished cloth as well as an earlier stage, the own effect of the finishing. Every sheen, perceived gloss and the material the 3D view is given follow from the fitted values. The back of the cloth is not fitted.',
      };
    }
  }
  const hasBack = !!by.loop || fin.brushed === 'back' || fin.brushed === 'both';
  const B = hasBack ? face(mk(backYarn), fin.mercerise, st, fin, 'back') : null;
  const roles = Object.fromEntries(yarns.map((y) => { const l = y === faceYarn ? F.yarn : (y === backYarn && B ? B.yarn : yarnLook(y, false)); return [y.role || 'ground', { label: l.label, sheen_index: V(r1(l.sheen), 'raw cotton yarn = 100', l.source === 'blend' ? 'blend' : 'estimate'), lustre_class: lustreClass(lustreOf(l.sheen)), hairiness: V(r2(l.hair_rel), '× combed cotton', 'blend'), softness: V(r1(l.softness), 'cotton = 100', 'estimate'), source: l.source }]; }));
  const last = F.stages[F.stages.length - 1], first = F.stages[1];
  const derivations = [
    { id: 'fresnel', quantity: 'Specular reflectance of the yarn', formula: 'R = ((n − 1)/(n + 1))²;  sheen index = 100 × (R ÷ R_cotton) × surface × delustrant × system factor', working: `blend sheen ${r1(F.yarn.sheen)} (cotton raw = 100)`, result: r1(F.yarn.sheen), unit: '', basis: F.yarn.source === 'blend' ? 'blend' : 'estimate' },
    { id: 'geometry', quantity: 'Loop geometry factor', formula: 'G = (0.55 + 0.45·(1 − e^(−cover))) × (1 + 0.15·alignment) × (1 + 0.25·miss − 0.2·tuck);  cover = loop length × yarn diameter × wales × courses ÷ 100', working: `cover ${F.geometry.cover}, alignment ${F.geometry.alignment}, tuck ${r2(st.tuck_share)}, miss ${r2(st.miss_share)}`, result: F.geometry.factor_finished, unit: '', basis: 'estimate' },
    { id: 'contrast', quantity: 'Perceived gloss contrast', formula: 'C = Rs ÷ (Rs + Rd);  Rs = 0.047 × sheen ÷ 100;  Rd = the body colour\'s luminance factor', working: `Rs ${r3(R_COTTON * last.sheen_index.value / 100)}, Rd ${BODY[shade]} (${shade})`, result: last.perceived_gloss.value, unit: '%', basis: 'law' },
    { id: 'hair', quantity: 'Hairiness after finishing', formula: 'H = H_yarn × (1 − 0.7 × the cellulosic share of the hairs) for a bio-polish;  × 5 for a raised face', working: `${r2(F.yarn.hair_rel)} → ${last.hairiness.value}`, result: last.hairiness.value, unit: '× combed cotton', basis: 'estimate' },
  ];
  const warnings = [];
  if (fin.brushed !== 'none' && F.yarn.filament) warnings.push({ level: 'note', text: 'A filament yarn has no loose fibre ends: raising it breaks filaments and gives a poor nap.' });
  if (fin.biopolish && F.yarn.synthetic > 0.3) warnings.push({ level: 'note', text: 'Bio-polishing cuts only the cellulosic hairs: the polyester hairs stay, and so do their pills.' });
  if (fin.mercerise && !(F.yarn.cotton_share > 0)) warnings.push({ level: 'note', text: 'Mercerising lifts cotton: there is none in the face yarn, so it changes nothing.' });
  return {
    success: true,
    cloth: { shade, shade_body: BODY[shade], dye_method: fin.dye_method, finish: { mercerise: fin.mercerise, biopolish: fin.biopolish, heatset: fin.heatset, softener: fin.softener, brushed: fin.brushed } },
    yarns: roles,
    face: { yarn: F.yarn.label, stages: F.stages, geometry: F.geometry, final: last },
    calibration,
    back: B ? { yarn: B.yarn.label, stages: B.stages, geometry: B.geometry, final: B.stages[B.stages.length - 1] } : null,
    change: { sheen_yarn_to_finished: r2(last.sheen_index.value / F.stages[0].sheen_index.value), hair_knitted_to_finished: r2(last.hairiness.value / first.hairiness.value), gloss_contrast_knitted_to_finished: r2(last.perceived_gloss.value / first.perceived_gloss.value) },
    render: renderOf(F, fin, st, 'face'), render_back: B ? renderOf(B, fin, st, 'back') : null,
    derivations, warnings,
  };
}

/** Glossmeter readings: [{ stage, gu, angle }] — the stage of the cloth measured (knitted, scoured, dyed, finished), the gloss units, the geometry. */
function readGloss(g) {
  if (g == null) return [];
  const list = Array.isArray(g) ? g : Array.isArray(g.readings) ? g.readings : [];
  return list.filter((r) => r && r.gu !== '' && r.gu != null).map((r, i) => {
    const gu = +r.gu;
    if (!(gu > 0 && gu <= 1000)) throw new LookError(`Glossmeter reading ${i + 1}: give the gloss units above 0 (and not above 1000).`);
    const stage = r.stage == null ? 'finished' : String(r.stage);
    if (!STAGE_IDS.includes(stage)) throw new LookError(`Glossmeter reading ${i + 1}: the stage is one of ${STAGE_IDS.join(', ')}.`);
    const angle = r.angle == null || r.angle === '' ? 60 : +r.angle;
    if (!ANGLES.includes(angle)) throw new LookError(`Glossmeter reading ${i + 1}: the geometry is 20, 60 or 85 degrees.`);
    return { stage, gu, angle };
  });
}

function catalogue() { return { glossmeter: { stages: STAGE_IDS, angles: ANGLES, unit: 'GU (ASTM D523)' }, shades: SHADES.map((id) => ({ id, label: id, body: BODY[id] })), finishes: ['none', 'face', 'back', 'both'], dye_methods: ['reactive', 'disperse', 'pigment', 'discharge', 'garment_wash'] }; }

module.exports = { analyse, catalogue, LookError, lustreOf, indexOf, BODY, guOf, fresnel };
