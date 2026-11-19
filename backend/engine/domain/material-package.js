/**
 * KnitAdvisor — Material package: the cloth as a 3D material, in open formats.
 *
 * A 3D garment tool wants two things of a fabric: how it LOOKS (maps) and how it MOVES (physics). The Studio has both — the maps come from
 * the real loops of the real view (the browser bakes them), the physics from the Fabric hand, stretch and drape engines. This module writes the
 * parts that are numbers and words:
 *
 *   physics()    the cloth's mechanics in SI and in the tester's units, on knit axes (course = weft = X, wale = warp = Y): weight, thickness, bending, shear,
 *                stretch under a load, friction, and — when worked out — the drape coefficient, air permeability, thermal resistance and contact angle
 *   material()   the glTF 2.0 material: base roughness (from the fibres and the finish), sheen (the fuzz of the yarn), whether the surface has holes
 *   readme()     what is in the package, the conventions (tangent-space normal, +Y up, tiling) and what each number rests on
 *   formats()    which formats are written and which are not, and why
 *
 * What is NOT written: Browzwear's .u3ma and CLO's .zfab are closed formats with no public specification. The package carries open formats that
 * those tools read through their material import (the PNG maps, glTF 2.0) and the physics as numbers; the conversion of the bending and stretch
 * into each tool's own units needs that tool's own fabric calibration, which is not guessed here.
 *
 * Basis: the physics are the Studio's own (measured / calculated / estimated as tagged in each engine); the glTF values are estimates. No outside
 * source is named.
 */
'use strict';

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

class MaterialError extends Error { constructor(m) { super(m); this.name = 'MaterialError'; } }

const GF_CM_TO_N_M = 0.0980665, B_TO_SI = 9.80665e-5, G_TO_SI = 56.2;
// how rough a cloth of each fibre is to light (estimate): a lustrous filament shines, a short staple is matt
const ROUGH = { cotton: 0.92, linen: 0.94, wool: 0.96, polyester: 0.62, nylon: 0.55, viscose: 0.66, modal: 0.7, tencel: 0.66, bamboo: 0.72, acrylic: 0.85, silk: 0.42, polypropylene: 0.7, elastane: 0.8, cdp: 0.62 };

function fibresOf(out) {
  const feeds = (out.yarn && out.yarn.feeds) || [];
  const mix = {};
  feeds.forEach((f) => {
    const m = f.fibre_mix || {};
    const tot = Object.values(m).reduce((t, v) => t + (+v || 0), 0) || 100;
    Object.entries(m).forEach(([k, v]) => { mix[k] = (mix[k] || 0) + ((+f.mass_share_pct || 0) * (+v || 0)) / tot; });
  });
  ((out.yarn && out.yarn.composition) || []).forEach((c) => { if (/elastane|lycra|spandex/i.test(c.part || '')) mix.elastane = (mix.elastane || 0) + (+c.pct || 0); });
  const sum = Object.values(mix).reduce((t, v) => t + v, 0);
  return sum > 0 ? Object.fromEntries(Object.entries(mix).filter(([, v]) => v > 0.05).map(([k, v]) => [k, r1((v / sum) * 100)])) : { cotton: 100 };
}

function physics(out, extra) {
  const ex = extra || {};
  const h = out && out.hand;
  if (!h || h.success === false || !h.geometry) throw new MaterialError('The hand numbers of this cloth could not be worked out: a material needs them.');
  const load = h.identity.load_gf_cm;
  const emtC = h.tensile.width.EMT.value, emtW = h.tensile.length.EMT.value;
  const Bc = h.bending.course.value, Bw = h.bending.wale.value;
  const bias = Math.sqrt(Bc * Bw);
  const secant = (emt) => (load * GF_CM_TO_N_M) / (Math.max(0.1, emt) / 100);
  const res = {
    schema: 'knitadvisor.material-physics/1',
    axes: { x: 'course direction (across the wales) = weft', y: 'wale direction (along the wales) = warp', note: 'a knit has no warp or weft yarn; the names are the garment tools\' for the two directions of the cloth' },
    fabric: {
      name: ex.name || null, structure: (out.structure && out.structure.identity && out.structure.identity.title) || null, state: (out.state && out.state.selected) || 'finished',
      composition_pct: fibresOf(out), weight_g_m2: h.geometry.gsm, thickness_mm: h.compression.T0.value, thickness_at_50gf_cm2_mm: h.compression.Tm.value,
      wales_per_cm: h.geometry.wales_per_cm, courses_per_cm: h.geometry.courses_per_cm, loop_length_mm: h.geometry.loop_mm,
    },
    mechanics: {
      course: { bending: { gf_cm2_per_cm: Bc, N_m: +(Bc * B_TO_SI).toPrecision(4), note: 'N·m per metre of width' }, stretch_pct_at_load: emtC, stiffness_secant_N_per_m: r1(secant(emtC)) },
      wale: { bending: { gf_cm2_per_cm: Bw, N_m: +(Bw * B_TO_SI).toPrecision(4) }, stretch_pct_at_load: emtW, stiffness_secant_N_per_m: r1(secant(emtW)) },
      bias: { bending: { gf_cm2_per_cm: r3(bias), N_m: +(bias * B_TO_SI).toPrecision(4), note: 'the geometric mean of the two axes (a stand-in: the bias is not tested)' } },
      shear: { G_gf_per_cm_deg: h.shear.G.value, G_N_per_m_rad: r2(h.shear.G.value * G_TO_SI), hysteresis_2HG_gf_per_cm: h.shear.HG.value },
      load_gf_per_cm: load,
      recovery_pct: { course: h.tensile.width.RT ? h.tensile.width.RT.value : null, wale: h.tensile.length.RT ? h.tensile.length.RT.value : null },
    },
    surface: { friction_miu: h.surface.MIU.value, roughness_smd_um: h.surface.SMD.value, hairiness_vs_combed_cotton: h.identity.yarn.hairiness_vs_combed_cotton },
    hand: h.hand ? { summary: h.hand.summary, scores_0_10: Object.fromEntries(Object.entries(h.hand.scores || {}).map(([k, v]) => [k, v.score])) } : null,
    optical: out.light && out.light.success !== false ? { open_area_pct: out.light.open_area.value, opacity_pct: out.light.opacity.value, contrast_ratio: out.light.contrast_ratio.value } : null,
    basis: 'The mechanics are the Studio\'s Fabric hand numbers: law where arithmetic, measured where from the factory records, estimate where modelled (shear, surface and the hand scores are estimates). A Kawabata or FAST reading of the mill\'s own cloth replaces them.',
  };
  if (ex.drape && ex.drape.success !== false) res.drape = { test: ex.drape.test, drape_coefficient_pct: ex.drape.drape_coefficient ? ex.drape.drape_coefficient.value : null, nodes: ex.drape.folds.nodes, skirt_hem_sweep: ex.drape.skirt ? ex.drape.skirt.hem_sweep_ratio : null, basis: 'estimate' };
  if (out.lab && out.lab.success !== false) res.comfort = { air_permeability_mm_s: out.lab.air.air_permeability.value, thermal_resistance_m2K_W: out.lab.thermal.rct.value, clo: out.lab.thermal.clo.value, basis: 'estimate' };
  if (out.repel && out.repel.success !== false) res.water = { contact_angle_deg: out.repel.contact_angle.value, spray_rating: out.repel.spray_rating.value, roll_off_deg: out.repel.roll_off.value, finish: out.repel.finish.label, basis: 'estimate' };
  return res;
}

function material(out, extra) {
  const ex = extra || {};
  const fibres = fibresOf(out);
  const tot = Object.values(fibres).reduce((t, v) => t + v, 0) || 100;
  let rough = Object.entries(fibres).reduce((t, [k, v]) => t + (ROUGH[k] != null ? ROUGH[k] : 0.85) * (v / tot), 0);
  const brushed = out.finish && out.finish.brushed && out.finish.brushed !== 'none';
  if (brushed) rough += 0.08;
  if (+ex.roughness > 0) rough = +ex.roughness;                       // the real view's own material, when the browser gives it
  const hair = out.hand && out.hand.identity && out.hand.identity.yarn ? +out.hand.identity.yarn.hairiness_vs_combed_cotton : 1;
  const sheen = clamp(0.2 + 0.4 * (Number.isFinite(hair) ? hair : 1), 0.15, 0.9);
  const hasHoles = !!(out.light && out.light.success !== false && out.light.open_area && out.light.open_area.value > 6) || /pointelle|mesh|eyelet/i.test((out.structure && out.structure.identity && out.structure.identity.title) || '');
  return {
    roughness_factor: r2(clamp(rough, 0.2, 1)), metallic_factor: 0,
    sheen: { colour_mix_with_base: 0.55, strength: r2(sheen), roughness: 0.5, note: 'the fuzz of the yarn, as the glTF sheen extension: grazing-angle softness that a fabric has and a plastic does not' },
    alpha_mode: hasHoles ? 'MASK' : 'OPAQUE', alpha_cutoff: 0.5, double_sided: true,
    ior: 1.45,
    basis: 'estimate',
  };
}

function formats() {
  return {
    written: [
      { id: 'png', what: 'albedo (with opacity in the alpha channel), normal (tangent space, OpenGL: +Y up), roughness, ambient occlusion, displacement (height), opacity, and ORM (occlusion, roughness, metallic packed)' },
      { id: 'gltf', what: 'a glTF 2.0 binary (.glb): a tiled swatch, with the maps embedded and the sheen extension (KHR_materials_sheen)' },
      { id: 'json', what: 'the physics of the cloth in SI and in the tester\'s units, on the garment tools\' axes' },
    ],
    not_written: [
      { id: 'u3ma', reason: 'Browzwear\'s material format is closed and has no public specification; it cannot be written correctly without the vendor\'s SDK. The PNG maps and the physics numbers are what its material editor takes.' },
      { id: 'zfab', reason: 'CLO\'s fabric format is closed and has no public specification. Its fabric properties are in CLO\'s own units from its fabric-kit calibration, which a conversion from bending and stretch would only guess.' },
      { id: 'sbsar', reason: 'a Substance archive is a closed, vendor-compiled graph; the PNG maps are what it is built from.' },
      { id: 'displacement_in_gltf', reason: 'core glTF has no displacement; the height map is a separate PNG for tools that use it, and the relief is in the normal map.' },
    ],
  };
}

function readme(out, extra) {
  const ex = extra || {};
  const files = ex.files || [];
  const t = ex.tile_cm || null;
  const lines = [
    'KnitAdvisor material package',
    '============================',
    '',
    (out.structure && out.structure.identity && out.structure.identity.title) ? 'Cloth: ' + out.structure.identity.title : 'Cloth: a knitted fabric drawn in the Fabric Studio',
    'Composition: ' + Object.entries(fibresOf(out)).map(([k, v]) => `${v} % ${k}`).join(', '),
    out.fabric ? `Weight: ${out.fabric.gsm} g/m² (finished state)` : '',
    '',
    'MAPS',
    '  Every map is one tile of the real knitted structure (a whole number of loop repeats), so it tiles without a seam.' + (t ? ` One tile is ${r2(t.w)} cm × ${r2(t.h)} cm of cloth.` : ''),
    '  albedo.png        base colour of the dyed cloth; the alpha channel is the opacity (holes are transparent)',
    '  normal.png        tangent-space normal map, OpenGL convention (+X right, +Y up), not DirectX',
    '  roughness.png     greyscale, 1 = rough',
    '  ao.png            ambient occlusion of the yarns',
    '  displacement.png  height of the yarns, 0 = lowest, 1 = highest (the relief is also in the normal map)',
    '  opacity.png       white = yarn, black = a hole',
    '  orm.png           packed for glTF: R = occlusion, G = roughness, B = metallic (0)',
    '',
    'GLTF',
    '  swatch.glb        a flat swatch with the maps embedded; UVs repeat the tile (sampler wrap = REPEAT). Material: metallic 0, roughness from the file, KHR_materials_sheen for the yarn fuzz.',
    '',
    'PHYSICS',
    '  physics.json      weight, thickness, bending, shear, stretch under load, friction, on knit axes: x = course direction (weft), y = wale direction (warp), in SI and in',
    '                    the tester\'s units (gf·cm²/cm, gf/(cm·deg)). Bending and stretch are NOT converted to any one tool\'s own fabric units: those come from that tool\'s fabric calibration.',
    '',
    'WHAT IS NOT HERE',
    ...formats().not_written.map((f) => `  .${f.id}: ${f.reason}`),
    '',
    'WHAT IT RESTS ON',
    '  The relief, occlusion and holes come from the real loops of the real view. The albedo is the dye colour of the design (flat: the maps carry the structure). Roughness and sheen are estimates from the fibres and',
    '  the finish. The physics are the Studio\'s: measured where from the factory records, estimated where modelled (shear, surface, hand scores). A reading of the mill\'s own cloth replaces each estimate.',
    files.length ? '' : '',
    files.length ? 'FILES: ' + files.join(', ') : '',
  ];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n') + '\n';
}

module.exports = { physics, material, readme, formats, fibresOf, MaterialError };
