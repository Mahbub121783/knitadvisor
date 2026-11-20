/**
 * KnitAdvisor — Fabric DNA: a design written as one open, topology-first JSON document (schema 3.0), and read back.
 *
 * A fabric is its yarn channels (Y1 … YN, any number), the unit cell they run through (the needle programme, cylinder and dial,
 * one row per feed), the machine that knits it, the wet route the whole cloth goes through, and the feasibility verdict. Nothing in
 * it names a preset: a template is only a way to fill it in.
 *
 *   toDNA(input, out)   the Studio design + its answer → the DNA document
 *   fromDNA(dna)        a DNA document → the Studio input (circular weft knitting); { input, notes }
 *
 * The universal unit-cell law is written out and checked against the Studio's own weight:
 *   GSM = Σᵢ (Lᵢ · Texᵢ) ÷ A_cell     Lᵢ the yarn of channel i in one repeat (mm), A_cell the repeat's area (mm²)
 * The Studio's weight comes from the factory's measured constants; the law from the loop lengths and the finished loop densities, so
 * the two agree only as far as the cell's course count is right (a tuck or a held loop makes the count an approximation, said so).
 *
 * No outside source is named in what this returns.
 */
'use strict';

const { mixOfFeed } = require('./feasibility-engine');

class DnaError extends Error { constructor(m) { super(m); this.name = 'DnaError'; } }

const SCHEMA = '3.0.0-UNIVERSAL';
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const FIBRE_OUT = { cotton: 'COTTON', polyester: 'POLYESTER', viscose: 'VISCOSE', modal: 'MODAL', tencel: 'LYOCELL', bamboo: 'BAMBOO_VISCOSE', nylon: 'NYLON', wool: 'WOOL', silk: 'SILK', linen: 'LINEN', acrylic: 'ACRYLIC', elastane: 'ELASTANE', polypropylene: 'POLYPROPYLENE', cdp: 'CATIONIC_POLYESTER' };
const FIBRE_IN = Object.fromEntries(Object.entries(FIBRE_OUT).map(([k, v]) => [v, k]));
Object.assign(FIBRE_IN, { PET: 'polyester', PA: 'nylon', PA6: 'nylon', PA66: 'nylon', PU: 'elastane', SPANDEX: 'elastane', LYCRA: 'elastane', FLAX: 'linen', TENCEL: 'tencel', PP: 'polypropylene', CO: 'cotton', PES: 'polyester', CV: 'viscose', CMD: 'modal', WO: 'wool', SE: 'silk', LI: 'linen', PAN: 'acrylic', EL: 'elastane' });
const STUDIO_FIBRE = { cotton: 'cotton', viscose: 'viscose', modal: 'modal', wool: 'wool', silk: 'silk', linen: 'linen', acrylic: 'acrylic' };
const SPIN_IN = { RING_CARDED: 'carded', CARDED: 'carded', RING_COMBED: 'combed', COMBED: 'combed', COMPACT: 'compact', SIRO: 'siro', SIRO_COMPACT: 'siro_compact', ROTOR: 'open_end', OPEN_END: 'open_end', OE: 'open_end', AIR_JET: 'vortex', MVS: 'vortex', VORTEX: 'vortex', FDY: 'fdy', DTY: 'dty', ATY: 'aty', MONO: 'mono', POY: 'dty' };
const FILAMENT_SPIN = ['fdy', 'dty', 'aty', 'mono'];
const UNIT_IN = { NE: 'ne', NM: 'nm', TEX: 'tex', DTEX: 'dtex', DENIER: 'denier', D: 'denier', DEN: 'denier' };
const GATING = { single: 'SINGLE_BED', rib: 'RIB', interlock: 'INTERLOCK' };

// the courses one repeat makes along a wale: on each working cylinder needle, the feeds that form a loop on it (knit or tuck) — a
// loop-yarn tie-in tuck forms no course and is left out; the most any needle forms is the repeat's course count (approximate where loops are held)
function coursesPerRepeat(C, roles) {
  if (!C || !C.length) return 1;
  const W = C[0].length;
  let best = 0;
  for (let j = 0; j < W; j++) {
    const col = C.map((r) => r[j]); if (col.every((x) => x === '-')) continue;
    best = Math.max(best, col.filter((x, i) => (x === 'K' || x === 'E') || (x === 'T' && roles[i] !== 'loop')).length);
  }
  return Math.max(1, best);
}

function toDNA(input, out) {
  if (!out || !out.success) throw new DnaError('Analyse the design first: the DNA is written from the answer.');
  const inp = out._design || input || {};      // a solved composition: the design the solver wrote
  const st = out.structure || {}, fab = out.fabric || {}, mach = out.machine || {}, yarn = out.yarn || {}, feas = out.feasibility || null;
  const C = st.beds && st.beds.C, D = st.beds && st.beds.D;
  const W = C && C[0] ? C[0].length : 1;
  const feeds = yarn.feeds || [];
  // yarn channels: one per distinct yarn (fibre mix, count, kind)
  const channels = [], chanOf = new Map();
  feeds.forEach((f) => {
    const key = JSON.stringify([f.yarn, f.fibre, f.yarn_type, f.fibre_mix]);
    if (chanOf.has(key)) { chanOf.get(key).roles.add(f.role); chanOf.get(key).share += +f.mass_share_pct || 0; return; }
    const mix = mixOfFeed(f);
    const tot = Object.values(mix).reduce((t, v) => t + (+v || 0), 0) || 100;
    const c = { yarnId: `Y${channels.length + 1}`, roles: new Set([f.role]), label: f.yarn, fiberBlend: Object.entries(mix).map(([k, v]) => ({ fiber: FIBRE_OUT[k] || k.toUpperCase(), fraction: r3((+v || 0) / tot) })),
      spinning: f.yarn_type || null, count: r2(+f.tex), unit: 'tex', tex: r2(+f.tex), share: +f.mass_share_pct || 0, d_mm: f.d_mm };
    channels.push(c); chanOf.set(key, c);
  });
  const el = inp.elastane && +inp.elastane.denier > 0 ? inp.elastane : null;
  const elPart = (yarn.composition || []).find((c) => /elastane/i.test(c.part || ''));
  const yarns = channels.map((c) => ({ yarnId: c.yarnId, label: [...c.roles].join(' + ') + (c.label ? ` · ${c.label}` : ''), roles: [...c.roles], fiberBlend: c.fiberBlend, spinning: c.spinning, count: c.count, unit: c.unit, tex: c.tex, diameterMm: c.d_mm || null, massSharePercent: r1(c.share) }));
  if (el) yarns.push({ yarnId: `Y${yarns.length + 1}`, label: 'elastane (plated with the ground)', roles: ['elastane'], fiberBlend: [{ fiber: 'ELASTANE', fraction: 1 }], spinning: 'BARE_ELASTANE', count: +el.denier, unit: 'Denier', tex: r2(+el.denier / 9), elastaneDraftRatio: +el.draft || null, feeds: el.every === 'alternate' ? 'alternate' : 'every', massSharePercent: elPart ? +elPart.pct : null });
  // the unit cell
  const pitchW = fab.wpc > 0 ? 10 / fab.wpc : null, pitchC = fab.cpc > 0 ? 10 / fab.cpc : null;
  const cpr = coursesPerRepeat(C, feeds.map((f) => f.role));
  // the repeat's width in the cloth: the open width shared over the cylinder's repeats (the working share and the bed's spread are in it)
  const widthMm = fab.width_open_in > 0 && mach.needles > 0 ? (fab.width_open_in * 25.4 * W) / mach.needles : pitchW ? W * pitchW : null;
  const heightMm = pitchC ? cpr * pitchC : null;
  const area = widthMm && heightMm ? widthMm * heightMm : null;
  // one path per feed of the programme; a plush (one feed laying a ground and a pile yarn) names its yarns per channel instead
  const perFeed = C && feeds.length === C.length;
  const paths = (C || []).map((row, i) => {
    const f = perFeed ? feeds[i] : null;
    const role = f ? f.role : (st.roles && st.roles[i]) || 'ground';
    const ch = f ? chanOf.get(JSON.stringify([f.yarn, f.fibre, f.yarn_type, f.fibre_mix])) : channels[0];
    return { yarnId: ch ? ch.yarnId : null, feed: i + 1, role, ops: { cylinder: row.join(''), dial: D && D[i] ? D[i].join('') : null }, stitchLengthMm: f ? f.sl_mm : fab.sl_mm, arcLengthMm: f ? r3((+f.share || 0) * (+f.sl_mm || 0) * W) : null, zOrder: ['loop', 'binder'].includes(role) ? 1 : 0, plated: f ? f.plated || null : null,
      ...(perFeed ? {} : { yarnsLaid: channels.map((c) => c.yarnId), note: 'this feed lays more than one yarn (a sinker-loop plush): the channels carry their own mass shares' }) };
  });
  const lawMass = perFeed ? paths.reduce((t, p, i) => t + p.arcLengthMm * (+feeds[i].tex || 0), 0) : feeds.reduce((t, f) => t + (+f.share || 0) * (+f.sl_mm || 0) * W * (+f.tex || 0), 0);
  const elMass = el && elPart ? (lawMass * (+elPart.pct / 100)) / Math.max(0.01, 1 - (+elPart.pct / 100)) : 0;
  const gsmLaw = area ? (lawMass + elMass) / area : null;
  return {
    schemaVersion: SCHEMA,
    generator: 'KnitAdvisor Fabric Studio',
    name: inp.name || null,
    environment: { tempC: 20.0, relativeHumidityPercent: 65.0, standard: 'ISO_139' },
    manufacturingClass: 'CIRCULAR_WEFT',
    unitCell: {
      widthMm: widthMm ? r3(widthMm) : null, heightMm: heightMm ? r3(heightMm) : null, areaMm2: area ? r3(area) : null,
      thicknessMm: feas && feas.packing ? feas.packing.thickness_mm : null, zLayers: D ? 2 : 1,
      needlesPerRepeat: W, feedsPerRepeat: C ? C.length : 0, coursesPerRepeat: r2(cpr),
      topologyGraph: {
        notation: 'K knit, T tuck, M miss, - needle out of action, E loop transfer to the next needle, R transfer to the other bed; one row per feed, one letter per needle',
        beds: { cylinder: C ? C.map((r) => r.join('')) : null, dial: D ? D.map((r) => r.join('')) : null },
        yarnPaths: paths,
      },
    },
    yarns,
    universalLaw: {
      formula: 'GSM = Σ (L_i × Tex_i) ÷ A_cell',
      gsm_law: gsmLaw ? Math.round(gsmLaw) : null, gsm_studio: fab.gsm, agreement_pct: gsmLaw && fab.gsm ? r1((gsmLaw / fab.gsm - 1) * 100) : null,
      check: gsmLaw && fab.gsm && Math.abs(gsmLaw / fab.gsm - 1) > 0.1 ? 'The law and the Studio differ by more than 10 %: the cell\'s course count or a held / floated yarn\'s path is approximate here — the Studio\'s weight (measured constants) is the one to use.' : null,
      note: 'The law uses the loop lengths and the finished loop densities; the Studio weight uses the factory\'s measured constants. The course count of a cell with tucks or held loops is approximate.',
    },
    machineCompiler: {
      machineParams: { gaugeOrReed: mach.gauge, diameterOrWidthInch: mach.dia, rpmOrPicksPerMin: mach.rpm, gatingOrShed: GATING[st.gating] || 'SINGLE_BED', feeders: mach.feeders, needles: mach.needles },
      timingOffset: null, sinkerDepthMm: null,
      output: { kgPerHour: mach.kg_per_hour, efficiencyPercent: mach.efficiency_pct },
    },
    wetProcessingPipeline: {
      fibres: feas ? feas.fibres : null,
      steps: feas ? feas.route : [],
      autoCompiledRoute: feas && feas.route.length ? feas.route.map((s) => s.id).join(' > ') : null,
      finishingMechanics: { brushed: (inp.finish && inp.finish.brush) || 'none', heatSetTempC: (feas && (feas.route.find((s) => s.id === 'heatset') || {}).t_c) || null, stenter: fab.stenter || null },
    },
    fabric: { gsm: fab.gsm, gsmRange: fab.gsm_range, widthOpenInch: fab.width_open_in, stitchLengthMm: fab.sl_mm, walesPerCm: fab.wpc, coursesPerCm: fab.cpc, tightnessFactor: fab.tf },
    feasibilityVerdict: feas ? {
      verdict: feas.verdict.toUpperCase(),
      gate1Cohesion: feas.gates.gate1.status.toUpperCase(), gate2PackingPhi: feas.packing ? feas.packing.phi : null, gate2Packing: feas.gates.gate2.status.toUpperCase(), gate3MachineChem: feas.gates.gate3.status.toUpperCase(),
      alerts: feas.rules.filter((r) => r.status === 'fatal' || r.status === 'warn').map((r) => ({ id: r.id, severity: r.status.toUpperCase(), text: r.text })),
    } : null,
    knitadvisor: { studio_input: inp },
  };
}

function fibreIdOf(f) {
  const k = String(f || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (FIBRE_IN[k]) return FIBRE_IN[k];
  const low = String(f || '').toLowerCase();
  return FIBRE_OUT[low] ? low : null;
}

// one DNA yarn channel → a Studio yarn
function studioYarn(y, notes) {
  if (!y) return null;
  const blend = (Array.isArray(y.fiberBlend) ? y.fiberBlend : []).map((b) => ({ id: fibreIdOf(b.fiber), f: +b.fraction > 1 ? +b.fraction / 100 : +b.fraction })).filter((b) => b.id && b.f > 0);
  const main = blend.filter((b) => b.id !== 'elastane');
  const spin = SPIN_IN[String(y.spinning || '').toUpperCase().replace(/[\s-]+/g, '_')] || (String(y.spinning || '').toLowerCase() in { combed: 1, carded: 1, compact: 1 } ? String(y.spinning).toLowerCase() : null);
  const filament = spin && FILAMENT_SPIN.includes(spin);
  const unit = UNIT_IN[String(y.unit || '').toUpperCase()] || (+y.tex > 0 ? 'tex' : null);
  const count = unit === 'tex' && !(+y.count > 0) ? +y.tex : +y.count;
  if (!unit || !(count > 0)) throw new DnaError(`Yarn ${y.yarnId || ''}: give its count and unit (Ne, Nm, tex, dtex or denier) or its tex.`);
  const out = { count, unit };
  if (spin) out.type = spin;
  if (main.length === 1 || !main.length) {
    const id = main.length ? main[0].id : 'cotton';
    if (id === 'polyester') out.fibre = filament ? 'polyester_filament' : 'polyester_spun';
    else if (id === 'nylon') { out.fibre = 'nylon_filament'; if (!filament) notes.push(`Yarn ${y.yarnId}: spun nylon is read as nylon filament (the Studio has no spun nylon).`); }
    else if (STUDIO_FIBRE[id]) out.fibre = STUDIO_FIBRE[id];
    else { out.fibre = 'cotton'; notes.push(`Yarn ${y.yarnId}: ${id} is not a Studio fibre yet: cotton stands in, and the feasibility check still reads the DNA's fibre.`); }
  } else {
    const tot = main.reduce((t, b) => t + b.f, 0);
    out.fibre = main.some((b) => b.id === 'cotton') ? 'cotton' : (STUDIO_FIBRE[main[0].id] || 'cotton');
    out.blend = true;
    out.mix = Object.fromEntries(main.map((b) => [b.id, Math.round((b.f / tot) * 1000) / 10]));
  }
  return out;
}

function fromDNA(dna) {
  if (!dna || typeof dna !== 'object') throw new DnaError('Give a Fabric DNA document (JSON).');
  if (!/^3\./.test(String(dna.schemaVersion || ''))) throw new DnaError('Fabric DNA schema 3.x is read here: this document has no 3.x "schemaVersion".');
  const mc = String(dna.manufacturingClass || 'CIRCULAR_WEFT').toUpperCase().split(/\s*\|\s*/)[0];
  if (mc === 'WARP_KNIT') throw new DnaError('A warp-knit DNA: open it in the Warp Studio (its import comes next).');
  if (mc === 'FLAT_VBED') throw new DnaError('A flat V-bed DNA: the flat-bed compiler is not in the Studio yet.');
  if (mc === 'WOVEN_LOOM') throw new DnaError('A woven DNA: woven designs are not in the Studio yet.');
  if (mc !== 'CIRCULAR_WEFT') throw new DnaError(`Unknown manufacturing class "${dna.manufacturingClass}".`);
  const notes = [];
  const base = dna.knitadvisor && dna.knitadvisor.studio_input && typeof dna.knitadvisor.studio_input === 'object' ? JSON.parse(JSON.stringify(dna.knitadvisor.studio_input)) : {};
  const uc = dna.unitCell || {};
  const tg = uc.topologyGraph || {};
  const paths = (Array.isArray(tg.yarnPaths) ? tg.yarnPaths : []).slice().sort((a, b) => (+a.feed || 0) - (+b.feed || 0));
  const rowOf = (ops, bed) => {
    if (ops == null) return null;
    if (typeof ops === 'string') return bed === 'cylinder' ? ops : null;
    if (Array.isArray(ops)) return bed === 'cylinder' ? ops.join('') : null;
    return ops[bed] || null;
  };
  let Crows = paths.map((p) => rowOf(p.ops, 'cylinder')).filter((x) => x != null);
  let Drows = paths.map((p) => rowOf(p.ops, 'dial'));
  if (!Crows.length && tg.beds && Array.isArray(tg.beds.cylinder)) { Crows = tg.beds.cylinder.slice(); Drows = Array.isArray(tg.beds.dial) ? tg.beds.dial.slice() : []; }
  if (!Crows.length) throw new DnaError('The unit cell has no needle programme: give unitCell.topologyGraph.yarnPaths with ops (K, T, M, - per needle) per feed.');
  const bad = Crows.concat(Drows.filter(Boolean)).find((r) => !/^[KTMER-]+$/i.test(r));
  if (bad) throw new DnaError(`"${bad}" is not a needle row: use K, T, M, -, E or R.`);
  const double = Drows.some((r) => r && r.length);
  const mp = (dna.machineCompiler && dna.machineCompiler.machineParams) || {};
  const gat = String(mp.gatingOrShed || '').toUpperCase();
  const input = {
    ...base,
    bed: double ? 'double' : 'single',
    ...(double ? { gating: gat === 'INTERLOCK' ? 'interlock' : 'rib' } : {}),
    grid: { C: Crows.map((r) => r.toUpperCase()), D: double ? Crows.map((_, i) => (Drows[i] || '-'.repeat(Crows[i].length)).toUpperCase()) : null },
  };
  // yarns: the ground is the first channel that knits on a face path; role yarns from the other paths
  const yarns = Array.isArray(dna.yarns) ? dna.yarns : [];
  const byId = new Map(yarns.map((y) => [y.yarnId, y]));
  const roleOf = (p) => (['ground', 'face', 'binder', 'loop'].includes(p.role) ? p.role : /pile|loop/i.test(p.role || '') ? 'loop' : p.zOrder > 0 ? 'loop' : 'ground');
  const slAll = dna.fabric && +dna.fabric.stitchLengthMm > 0 ? +dna.fabric.stitchLengthMm : null;
  // a feed's own stitch length only where it differs from the cloth's (the ground's)
  input.feeds = paths.length ? paths.map((p, i) => ({ ...(base.feeds && base.feeds[i] ? base.feeds[i] : {}), role: roleOf(p), ...(+p.stitchLengthMm > 0 && slAll && Math.abs(+p.stitchLengthMm / slAll - 1) > 0.02 ? { sl_mm: +p.stitchLengthMm } : {}) })) : (base.feeds || Crows.map(() => ({ role: 'ground' })));
  const groundPath = paths.find((p) => roleOf(p) === 'ground' || roleOf(p) === 'face') || paths[0];
  const gy = groundPath ? byId.get(groundPath.yarnId) : yarns.find((y) => !(y.fiberBlend || []).every((b) => fibreIdOf(b.fiber) === 'elastane'));
  if (gy) input.yarn = studioYarn(gy, notes);
  else if (!input.yarn) throw new DnaError('No ground yarn: give the yarns and the yarnId of each path.');
  const roleYarns = {};
  paths.forEach((p) => { const r = roleOf(p); if ((r === 'binder' || r === 'loop') && byId.get(p.yarnId) && p.yarnId !== (groundPath && groundPath.yarnId)) roleYarns[r] = studioYarn(byId.get(p.yarnId), notes); });
  if (Object.keys(roleYarns).length) input.yarns = { ...(base.yarns || {}), ...roleYarns };
  const ely = yarns.find((y) => (y.fiberBlend || []).length && (y.fiberBlend || []).every((b) => fibreIdOf(b.fiber) === 'elastane'));
  if (ely) {
    const unit = UNIT_IN[String(ely.unit || '').toUpperCase()];
    const den = unit === 'denier' ? +ely.count : unit === 'dtex' ? +ely.count * 0.9 : +ely.tex > 0 ? +ely.tex * 9 : null;
    if (den > 0) input.elastane = { denier: den, draft: +ely.elastaneDraftRatio > 0 ? +ely.elastaneDraftRatio : undefined, every: ely.feeds === 'alternate' ? 'alternate' : 'every' };
  }
  input.machine = { ...(base.machine || {}), ...(+mp.gaugeOrReed > 0 ? { gauge: +mp.gaugeOrReed } : {}), ...(+mp.diameterOrWidthInch > 0 ? { dia: +mp.diameterOrWidthInch } : {}), ...(+mp.rpmOrPicksPerMin > 0 ? { rpm: +mp.rpmOrPicksPerMin } : {}), ...(+mp.feeders > 0 ? { feeders: +mp.feeders } : {}) };
  const fin = (dna.wetProcessingPipeline && dna.wetProcessingPipeline.finishingMechanics) || {};
  if (fin.brushed && fin.brushed !== 'none') input.finish = { ...(base.finish || {}), brush: fin.brushed };
  if (+fin.heatSetTempC > 0) input.finish = { ...(input.finish || base.finish || {}), heatset_c: +fin.heatSetTempC };
  // the weight: the DNA's own, or its unit cell by the universal law
  const gsm = dna.fabric && +dna.fabric.gsm > 0 ? +dna.fabric.gsm : null;
  if (gsm) input.target = { ...(base.target || {}), gsm };
  else if (!base.target) {
    if (slAll) input.machine.sl_mm = slAll;
    else {
      const area = +uc.areaMm2 > 0 ? +uc.areaMm2 : +uc.widthMm > 0 && +uc.heightMm > 0 ? +uc.widthMm * +uc.heightMm : null;
      const texOf = (y) => (y ? (+y.tex > 0 ? +y.tex : null) : null);
      const mass = paths.reduce((t, p) => t + (+p.arcLengthMm || 0) * (texOf(byId.get(p.yarnId)) || 0), 0);
      if (area && mass > 0) { input.target = { gsm: Math.round(mass / area) }; notes.push(`No weight in the DNA: the target ${input.target.gsm} GSM is its unit cell by the law Σ(L·Tex) ÷ A_cell.`); }
      else throw new DnaError('Give a weight (fabric.gsm), the stitch lengths of the paths, or a unit cell with arc lengths and yarn tex.');
    }
  }
  if (dna.name && !input.name) input.name = String(dna.name).slice(0, 60);
  return { input, notes };
}

module.exports = { toDNA, fromDNA, DnaError, SCHEMA };
