/**
 * KnitAdvisor — Fleece & terry engine
 * ===================================
 *
 * A fleece is knitted as a terry and becomes a fleece only in finishing. On a
 * single-cylinder fleece machine, per face course:
 *
 *   - the FACE (knit) yarn knits every needle — the smooth jersey outside;
 *   - the BINDER (tie-in) yarn knits every needle behind it — it holds the
 *     loop yarn in and closes the face from behind (in "invisible" fleece it
 *     never shows through);
 *   - the LOOP (fleecy) yarn — the coarse, soft one — tucks on one needle in
 *     four (two-thread: one in four of its own feed) and floats across the
 *     technical back everywhere else.
 *
 * Off the machine that back is a field of floats ("loopback", French terry).
 * A fleece is dyed, dried on the stenter WIDER than finish (brushing pulls the
 * width in), and then RAISED: wire-covered rollers tear fibre out of the
 * floats into a nap. Optionally the nap is sheared level, and the cloth goes
 * back to the stenter and the compactor.
 *
 * HOW THE NUMBERS ARE GROUNDED
 *
 * MEASURED — the factory R&D records (engine/reference snapshot, `fab:
 * 'fleece'`, ~265 rows, almost all 20G): finished wales per cm =
 * needles / finished open width gives wpc ≈ 0.578·G; the face count falls
 * with weight (Ne ≈ 45 − 0.045·GSM); the face stitch length is ~4.45-4.6 mm.
 * Those rows do not record the binder or loop yarn.
 *
 * MEASURED — three full three-yarn specifications from real orders (risk
 * records 6, 37, 47: face / binder / loop count AND stitch length, finished
 * GSM). They fix the per-needle yarn lengths (binder ≈ 0.81 × face for a spun
 * binder, ≈ 0.62 × face for a filament one; loop yarn 1.85 mm per needle in a
 * fleece, 1.55 in a loopback terry) and, through the mass balance below, the
 * course-packing constant Kc = courses/cm × face SL (cm).
 *
 * DERIVED — the mass balance. Every needle in every face course carries one
 * length of each yarn, so
 *
 *     GSM = cpc · wpc · Σ (lᵢ[mm] · texᵢ) / 100 · (1 − brushing loss)
 *
 * With face and binder chosen, the loop yarn count is what closes it. That is
 * how a heavier fleece gets a COARSER loop yarn — the old lookup table had the
 * loop yarn getting finer as the fabric got heavier, which no mill does.
 *
 * DERIVED — thickness, density, porosity and the thermal resistance of the
 * still air the nap holds (Maxwell–Eucken for the conduction through a
 * fibre/air mix, plus a radiative/convective allowance).
 *
 * MODELLED — brushing (fraction of the loop yarn torn out per pass, pile
 * height from staple length and passes), the loop-yarn tuck limit per gauge,
 * the thickness bulk factor. Each is labelled so.
 */
'use strict';

const reference = require('../reference');
const { LOOPBACK_SIZES, LOOPBACK_ARRANGEMENTS, loopbackSize, loopbackGeometry, loopbackBack } = require('./terry-loops');

const FLEECE_IDS = ['fleece_2_thread', 'fleece_3_thread', 'fleece_diagonal', 'french_terry'];
const isFleeceFamily = (id) => FLEECE_IDS.includes(id);

// what each catalogued quality is, mechanically
const VARIANTS = {
  fleece_3_thread: { name: '3-thread fleece (invisible)', yarns: 3, brushed: true,  tuckRepeat: 4, loopLen20: 1.85, kind: 'fleece' },
  fleece_diagonal: { name: 'Diagonal 3-thread fleece',    yarns: 3, brushed: true,  tuckRepeat: 4, loopLen20: 1.85, kind: 'fleece' },
  fleece_2_thread: { name: '2-thread fleece',             yarns: 2, brushed: true,  tuckRepeat: 4, loopLen20: 1.40, kind: 'fleece', faceSl20: 2.8 },
  french_terry:    { name: 'French terry (loopback)',     yarns: 3, brushed: false, tuckRepeat: 4, loopLen20: 1.55, kind: 'terry' },
};

// fibre constants: density g/cm³, mean staple mm, thermal conductivity W/m·K
const FIBRE = {
  cotton:    { rho: 1.52, staple: 28, k: 0.071 },
  polyester: { rho: 1.38, staple: 38, k: 0.140 },
  viscose:   { rho: 1.52, staple: 38, k: 0.070 },
  modal:     { rho: 1.52, staple: 38, k: 0.070 },
  tencel:    { rho: 1.50, staple: 38, k: 0.070 },
  elastane:  { rho: 1.20, staple: 0,  k: 0.150 },
  nylon:     { rho: 1.14, staple: 38, k: 0.250 },
  acrylic:   { rho: 1.17, staple: 51, k: 0.080 },
  wool:      { rho: 1.31, staple: 60, k: 0.050 },
};
const CELLULOSIC = ['cotton', 'viscose', 'modal', 'tencel', 'linen', 'bamboo'];
const K_AIR = 0.026;

const STD_FACE = [20, 22, 24, 26, 28, 30, 32, 34, 36, 40];
const STD_LOOP = [6, 7, 8, 10, 12, 14, 16, 18, 20, 24, 26, 30];
const LOOP_BLENDS = [ // polyester fraction of commercial loop yarns
  { p: 0,    label: '100% cotton' }, { p: 0.2, label: 'CVC 80/20' }, { p: 0.4, label: 'CVC 60/40' },
  { p: 0.5,  label: 'CVC 50/50' },   { p: 0.65, label: 'PC 65/35' }, { p: 1, label: '100% polyester' },
];
const snap = (v, list) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0]);
const texOfNe = (ne) => 590.5 / ne;
const neOfTex = (tex) => 590.5 / tex;
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
// compact yarn diameter, mm (the app's canonical 0.907/√Ne)
const dia = (ne) => 0.907 / Math.sqrt(ne);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// ── the measured anchors ────────────────────────────────────────────────
// Three full specifications from real orders. `check` is a substring the
// snapshot's own record must still contain, so an edited record drops its
// anchor instead of silently calibrating against something else.
const ANCHORS = [
  { id: 6,  kind: 'fleece', gsm: 310, check: '150D', face: { ne: 30, sl: 4.60 }, binder: { tex: 150 / 9, sl: 2.85, filament: true }, loop: { ne: 10, sl: 1.85 }, comp: 'cvc' },
  { id: 37, kind: 'fleece', gsm: 370, check: '10/1', face: { ne: 26, sl: 4.45 }, binder: { tex: texOfNe(26), sl: 3.60 }, loop: { ne: 10, sl: 1.85 }, comp: 'cotton' },
  { id: 47, kind: 'terry',  gsm: 400, check: '22/1', face: { ne: 22, sl: 4.45 }, binder: { tex: texOfNe(22), sl: 3.60 }, loop: { ne: 22, sl: 1.55 }, comp: 'cotton' },
];

// unbrushed-terry rows of the industry count chart: "TERRY W/OUT brush", GSM → "face/1+loop/1"
function TERRY_CHART() {
  let rows = [];
  try { rows = require('../formulas/gsm-count').MASTER_LOOKUP || []; } catch (_) { rows = []; }
  return rows.filter(r => /terry/i.test(r.type) && /w\/?out\s*brush/i.test(r.type) && r.gsm > 0)
    .map(r => { const m = String(r.count).match(/^(\d+)\/1\s*\+\s*(\d+)\/1$/); return m ? { gsm: r.gsm, face: +m[1], loop: +m[2] } : null; })
    .filter(Boolean);
}

// ── brushing (MODELLED) ─────────────────────────────────────────────────
const PASS_LOSS = 0.035;                 // share of the loop yarn torn out per pass
function brushing(variant, fibres, opt) {
  if (!variant.brushed && !opt.brushed) return { passes: 0, loop_loss: 0, pile_mm: 0, sheared: false, sides: 'none' };
  const poly = fibres.polyester || 0;
  const passes = Number.isFinite(+opt.passes) && +opt.passes > 0 ? +opt.passes : (poly >= 0.6 ? 5 : poly > 0.1 ? 4 : 3);
  const loopLoss = 1 - Math.pow(1 - PASS_LOSS, passes);
  const staple = Object.entries(fibres).reduce((s, [f, x]) => s + x * ((FIBRE[f] || FIBRE.cotton).staple || 28), 0) || 28;
  let pile = 0.065 * staple * (1 - Math.exp(-passes / 2.5));
  const sheared = !!opt.sheared;
  if (sheared) pile = Math.min(pile, 1.2);
  return { passes, loop_loss: loopLoss, pile_mm: pile, sheared, sides: opt.sides === 'both' ? 'both' : 'back' };
}

// ── model constants from the data, built once per snapshot ──────────────
let cached = null, cachedFor = null;
function model() {
  const snapRef = reference.get();
  if (cached && cachedFor === snapRef) return cached;
  const rows = (snapRef.factoryRecords || []).filter(r => r.fab === 'fleece' && r.fgsm > 150 && r.fgsm < 520 && r.sl > 4 && r.g > 0);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const fit = (xs, ys) => {
    const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    const b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b };
  };
  const wRows = rows.filter(r => r.fdia > 40 && r.dia > 0);
  const wpcPerG = wRows.length >= 20 ? mean(wRows.map(r => (Math.PI * r.dia * r.g) / (r.fdia * 2.54) / r.g)) : 0.578;
  const faceFit = rows.length >= 20 ? fit(rows.map(r => r.fgsm), rows.map(r => r.ne)) : { a: 44.98, b: -0.0449 };
  const slFit = rows.length >= 20 ? fit(rows.map(r => r.ne), rows.map(r => r.sl)) : { a: 5.111, b: -0.0187 };
  const gauges = {}; rows.forEach(r => { gauges[r.g] = (gauges[r.g] || 0) + 1; });

  // anchors still present in the snapshot
  const risk = snapRef.riskRecords || [];
  const live = ANCHORS.filter(a => {
    const rec = risk.find(r => r.id === a.id);
    return rec && Math.abs(rec.gsm - a.gsm) < 1 && String(rec.yarn_count_raw || '').includes(a.check);
  });
  // Kc per anchor from the finished-GSM mass balance at 20G
  const kcOf = (a, wpc) => {
    const sum = a.face.sl * texOfNe(a.face.ne) + a.binder.sl * a.binder.tex + a.loop.sl * texOfNe(a.loop.ne);
    const fibres = a.comp === 'cvc' ? { cotton: 0.77, polyester: 0.23 } : { cotton: 1 };
    const b = brushing(VARIANTS[a.kind === 'terry' ? 'french_terry' : 'fleece_3_thread'], fibres, {});
    const loopShare = (a.loop.sl * texOfNe(a.loop.ne)) / sum;
    const loss = b.loop_loss * loopShare;
    const cpc = (a.gsm * 100) / (wpc * sum * (1 - loss));
    return cpc * a.face.sl / 10;
  };
  const wpc20 = wpcPerG * 20;
  const kcFleece = live.filter(a => a.kind === 'fleece').map(a => kcOf(a, wpc20));
  const kcTerry = live.filter(a => a.kind === 'terry').map(a => kcOf(a, wpc20));
  const KC = { fleece: kcFleece.length ? mean(kcFleece) : 5.14, terry: kcTerry.length ? mean(kcTerry) : 5.98 };

  // leave-one-out over the fleece anchors: predict each GSM from the other's Kc
  const loo = live.filter(a => a.kind === 'fleece').map(a => {
    const others = kcFleece.filter((_, i) => live.filter(x => x.kind === 'fleece')[i] !== a);
    if (!others.length) return null;
    const kc = mean(others);
    const cpc = kc * 10 / a.face.sl;
    const sum = a.face.sl * texOfNe(a.face.ne) + a.binder.sl * a.binder.tex + a.loop.sl * texOfNe(a.loop.ne);
    const fibres = a.comp === 'cvc' ? { cotton: 0.77, polyester: 0.23 } : { cotton: 1 };
    const b = brushing(VARIANTS.fleece_3_thread, fibres, {});
    const loss = b.loop_loss * (a.loop.sl * texOfNe(a.loop.ne)) / sum;
    const pred = cpc * wpc20 * sum * (1 - loss) / 100;
    return { record: a.id, gsm: a.gsm, predicted: r1(pred), error_pct: r1((pred - a.gsm) / a.gsm * 100) };
  }).filter(Boolean);

  // ── loopback terry: its own factory rows and its own anchors ──
  // The factory's "terry" rows are loopback (French) terry — face SL ~4.45 mm
  // on 20G, the same three-yarn knitting as a fleece — but never raised, so the
  // stenter does not pull the width in for brushing: it finishes WIDER (about
  // 78" open from a 34" cylinder against a fleece's 72"), i.e. fewer wales per
  // cm. Using the fleece's 0.578·G for terry overstated the stitches per m² and
  // left almost nothing for the loop yarn (a 30/1 loop at 280 GSM).
  const tRows = (snapRef.factoryRecords || []).filter(r => r.fab === 'terry' && r.fgsm > 150 && r.fgsm < 520 && r.sl > 4 && r.g > 0);
  const tW = tRows.filter(r => r.fdia > 40 && r.dia > 0);
  const terryWpcPerG = tW.length >= 20 ? mean(tW.map(r => (Math.PI * r.dia * r.g) / (r.fdia * 2.54) / r.g)) : 0.537;
  const terryFaceFit = tRows.length >= 20 ? fit(tRows.map(r => r.fgsm), tRows.map(r => r.ne)) : { a: 44.74, b: -0.0446 };
  const terrySlFit = tRows.length >= 20 ? fit(tRows.map(r => r.ne), tRows.map(r => r.sl)) : { a: 5.003, b: -0.0158 };
  const terryGauges = {}; tRows.forEach(r => { terryGauges[r.g] = (terryGauges[r.g] || 0) + 1; });
  // Terry anchors: the measured order (record 47) plus the four unbrushed-terry
  // rows of the industry count chart (GSM + face and loop count; face SL from
  // the factory trend, spun binder of the face count). The same chart's fleece
  // rows, put through the fleece wpc, land on the measured fleece Kc within a
  // few per cent — which is what makes its terry rows usable here.
  const wpcT20 = terryWpcPerG * 20;
  const terryAnchors = live.filter(a => a.kind === 'terry').map(a => ({ ...a, tier: 'order' }));
  for (const row of TERRY_CHART()) {
    const fsl = terrySlFit.a + terrySlFit.b * row.face;
    terryAnchors.push({ id: `chart-${row.gsm}`, kind: 'terry', gsm: row.gsm, tier: 'industry chart',
      face: { ne: row.face, sl: fsl }, binder: { tex: texOfNe(row.face), sl: fsl * 0.81 }, loop: { ne: row.loop, sl: 1.55 }, comp: 'cotton' });
  }
  const kcTerryEach = terryAnchors.map(a => kcOf(a, wpcT20));
  if (kcTerryEach.length) KC.terry = mean(kcTerryEach);
  const terryLoo = terryAnchors.length > 1 ? terryAnchors.map((a, i) => {
    const kc = mean(kcTerryEach.filter((_, j) => j !== i));
    const sum = a.face.sl * texOfNe(a.face.ne) + a.binder.sl * a.binder.tex + a.loop.sl * texOfNe(a.loop.ne);
    const pred = (kc * 10 / a.face.sl) * wpcT20 * sum / 100;
    return { record: a.id, tier: a.tier, gsm: a.gsm, predicted: r1(pred), error_pct: r1((pred - a.gsm) / a.gsm * 100) };
  }) : [];

  cached = {
    wpcPerG, faceFit, slFit, KC, anchors: live.map(a => a.id), loo,
    rows: rows.length, gauges,
    kc_each: { fleece: kcFleece.map(r3), terry: kcTerryEach.map(r3) },
    terry: {
      wpcPerG: terryWpcPerG, faceFit: terryFaceFit, slFit: terrySlFit, rows: tRows.length, gauges: terryGauges,
      anchors: terryAnchors.map(a => a.id), loo: terryLoo,
    },
  };
  cachedFor = snapRef;
  return cached;
}

// ── yarn plan: which fibre goes in which yarn ───────────────────────────
function fibreShares(parsed) {
  const f = (parsed && parsed.fibers) || { cotton: 100 };
  const tot = Object.values(f).reduce((s, v) => s + (+v || 0), 0) || 100;
  const out = {}; for (const [k, v] of Object.entries(f)) if (+v > 0) out[k] = +v / tot;
  return out;
}

/**
 * @param {object} p
 *   fabricId, gsm (finished), gauge, composition (parsed), rawComposition
 *   faceNe, faceSlMm      — when the main engine already has them (factory row)
 *   brushing: { passes, sheared, sides, brushed }   optional overrides
 */
function analyzeFleece(p) {
  const v = VARIANTS[p.fabricId];
  if (!v) return null;
  const gsm = +p.gsm;
  if (!(gsm > 0)) return null;
  const M = model();
  const G = +p.gauge > 0 ? +p.gauge : 20;
  const shares = fibreShares(p.composition);
  const elastane = shares.elastane || 0;
  const poly = shares.polyester || 0;
  const cellKey = CELLULOSIC.find(k => shares[k]) || (poly >= 0.999 ? 'polyester' : 'cotton');
  const warnings = [];

  // ---- machine-state geometry ----
  const pitch = 25.4 / G;
  const isTerry = v.kind === 'terry';
  const D = isTerry ? M.terry : M;                    // terry has its own factory rows
  const wpc = D.wpcPerG * G;
  // face count: the engine's own (factory) answer wins; else the measured trend
  let faceNe = +p.faceNe > 0 ? +p.faceNe : null;
  const faceFromTrend = D.faceFit.a + D.faceFit.b * gsm;
  if (!faceNe) faceNe = snap(v.yarns === 2 ? Math.max(20, faceFromTrend - 6) : faceFromTrend, STD_FACE);
  let faceSl = +p.faceSlMm > 0 ? +p.faceSlMm : (v.faceSl20 ? v.faceSl20 * 20 / G : (D.slFit.a + D.slFit.b * faceNe) * 20 / G);
  // loopback terry is named by its loops: the sinker sets their size (loop
  // length per needle), the tuck sequence their layout (terry-loops.js)
  const loopSize = isTerry ? loopbackSize(p.loopSize, p.loopLengthMm, G) : null;
  const arrKey = isTerry && LOOPBACK_ARRANGEMENTS[p.loopArrangement] ? p.loopArrangement : 'standard';
  const loopSl = isTerry ? loopSize.l : v.loopLen20 * 20 / G;

  // ---- binder ----
  let binder = null;
  if (v.yarns === 3) {
    if (poly >= 0.08 && cellKey !== 'polyester') {
      const den = gsm >= 300 ? 150 : 75;
      binder = { role: 'binder', label: `${den}D polyester filament`, tex: den / 9, ne: neOfTex(den / 9), filament: true, fibre: { polyester: 1 }, sl: faceSl * 0.62, sl_basis: 'measured ratio, filament binder (0.62 × face)' };
    } else if (cellKey === 'polyester') {
      binder = { role: 'binder', label: '75D polyester filament', tex: 75 / 9, ne: neOfTex(75 / 9), filament: true, fibre: { polyester: 1 }, sl: faceSl * 0.62, sl_basis: 'measured ratio, filament binder (0.62 × face)' };
    } else {
      binder = { role: 'binder', label: `${faceNe}/1 ${cellKey} (same as face)`, tex: texOfNe(faceNe), ne: faceNe, filament: false, fibre: { [cellKey]: 1 }, sl: faceSl * 0.81, sl_basis: 'measured ratio, spun binder (0.81 × face)' };
    }
  }

  // ---- mass balance: solve the loop yarn ----
  const kc = v.kind === 'terry' ? M.KC.terry : M.KC.fleece;
  const cpc = kc * 10 / faceSl;
  const faceTex = texOfNe(faceNe);
  const faceMass = faceSl * faceTex;                // per needle-course, mm·tex
  const binderMass = binder ? binder.sl * binder.tex : 0;
  // brushing loss is a share of the loop yarn, so solve iteratively
  const brushOpt = p.brushing || {};
  let loopTex = 30, b = null;
  for (let it = 0; it < 6; it++) {
    const loopMass = loopSl * loopTex;
    const sum = faceMass + binderMass + loopMass;
    b = brushing(v, shares, brushOpt);
    const loss = b.loop_loss * loopMass / sum;
    const needed = gsm * (1 - elastane) * 100 / (cpc * wpc * (1 - loss));
    loopTex = Math.max(5, (needed - faceMass - binderMass) / loopSl);
  }
  let loopNeExact = neOfTex(loopTex);
  let ply = 1;
  if (loopNeExact < 6) { ply = 2; }
  const loopNe = ply === 1 ? snap(loopNeExact, STD_LOOP) : snap(loopNeExact * 2, STD_LOOP);
  const loopTexChosen = texOfNe(loopNe) * ply;
  if (needLighterFace(loopNeExact)) warnings.push(`At ${gsm} GSM the loop yarn the balance asks for (${r1(loopNeExact)} Ne) is finer than fleece loop yarns run — the face and binder already carry most of the weight. Use a finer face count or a lighter binder.`);

  // the sinker setting that hits the target exactly with the snapped count
  const sumFixed = faceMass + binderMass;
  const lossFrac = (bb, lm) => bb.loop_loss * lm / (sumFixed + lm);
  const loopSlExact = (() => {
    let l = loopSl;
    for (let it = 0; it < 6; it++) {
      const need = gsm * (1 - elastane) * 100 / (cpc * wpc * (1 - lossFrac(b, l * loopTexChosen)));
      l = (need - sumFixed) / loopTexChosen;
    }
    return l;
  })();
  const gsmAtChosen = (() => {
    const lm = loopSl * loopTexChosen;
    return cpc * wpc * (sumFixed + lm) * (1 - lossFrac(b, lm)) / 100 / (1 - elastane);
  })();

  // ---- yarn shares by mass (finished, after brushing) ----
  const lmass = loopSl * loopTexChosen * (1 - b.loop_loss);
  const fabricLoss = b.loop_loss * (loopSl * loopTexChosen) / (faceMass + binderMass + loopSl * loopTexChosen);
  const totalNoEl = faceMass + binderMass + lmass;
  const massShare = {
    face: (faceMass / totalNoEl) * (1 - elastane),
    binder: (binderMass / totalNoEl) * (1 - elastane),
    loop: (lmass / totalNoEl) * (1 - elastane),
    elastane,
  };

  // ---- composition: which blend must the loop yarn be to land the declared one ----
  const targetPoly = poly;
  const facePoly = cellKey === 'polyester' ? 1 : 0;
  const binderPoly = binder && binder.fibre.polyester ? 1 : 0;
  let loopPolyNeeded = massShare.loop > 0 ? (targetPoly - massShare.face * facePoly - massShare.binder * binderPoly) / massShare.loop : 0;
  let faceBlend = facePoly;
  if (loopPolyNeeded > 1.0001 && facePoly < 1) {
    // even an all-polyester loop yarn is not enough: the face must carry polyester too
    const excess = targetPoly - massShare.binder * binderPoly - massShare.loop;
    faceBlend = Math.min(1, Math.max(0, excess / massShare.face));
    loopPolyNeeded = 1;
  }
  loopPolyNeeded = Math.max(0, Math.min(1, loopPolyNeeded));
  const loopBlend = LOOP_BLENDS.reduce((best, x) => (Math.abs(x.p - loopPolyNeeded) < Math.abs(best.p - loopPolyNeeded) ? x : best), LOOP_BLENDS[0]);
  const actualPoly = massShare.face * faceBlend + massShare.binder * binderPoly + massShare.loop * loopBlend.p;
  const otherKey = cellKey === 'polyester' ? 'polyester' : cellKey;
  const actual = {};
  if (actualPoly > 0.0005) actual.polyester = actualPoly;
  if (1 - actualPoly - elastane > 0.0005 && otherKey !== 'polyester') actual[otherKey] = 1 - actualPoly - elastane;
  if (elastane > 0) actual.elastane = elastane;
  const fmtComp = (o) => Object.entries(o).sort((a, c) => c[1] - a[1]).map(([k, x]) => `${Math.round(x * 100)}% ${k}`).join(' / ');
  const declared = Object.fromEntries(Object.entries(shares).map(([k, x]) => [k, x]));
  const compGap = Math.abs(actualPoly - targetPoly) * 100;
  if (binderPoly && targetPoly < 0.08) warnings.push('A polyester filament binder in a fabric declared without polyester changes its fibre content — use a spun binder of the face fibre.');
  if (compGap >= 3) warnings.push(`With commercial loop blends the nearest construction lands at ${fmtComp(actual)}, ${r1(compGap)} points of polyester away from the declared composition.`);

  // ---- gauge: can this machine carry these yarns? (MODELLED limits) ----
  const knitTexMax = 1650 * Math.pow(2.54 / G, 2) * 1.25;            // each knitting yarn, on its own feed
  const loopNeMin = 8 * Math.pow(G / 20, 2);                          // a tucked yarn, not drawn through
  const knitLoad = Math.max(faceTex, binder ? binder.tex : 0);
  const gaugeOk = knitLoad <= knitTexMax && (loopNe / ply) >= loopNeMin * 0.999;
  let suggested = null;
  if (!gaugeOk) {
    for (const g of [24, 22, 20, 18, 16, 14]) {
      if (g >= G) continue;
      if (knitLoad <= 1650 * Math.pow(2.54 / g, 2) * 1.25 && loopNe / ply >= 8 * Math.pow(g / 20, 2)) { suggested = g; break; }
    }
  }
  const dataGauge = Object.entries(D.gauges).sort((a, c) => c[1] - a[1])[0];

  // ---- thickness, density, porosity, warmth ----
  const bulk = 1.25;                                                   // MODELLED: knitted yarn is fuller than a compact cylinder
  const loopD = dia(loopNe / ply) * Math.sqrt(ply);
  const binderD = binder ? (binder.filament ? 0.0119 * Math.sqrt(binder.tex) * 1.05 : dia(binder.ne)) : 0;
  // loopback: the loops stand above the loop-yarn layer, mostly pressed flat
  // under a thickness gauge (0.25 of their height, MODELLED)
  const loopGeom = isTerry ? loopbackGeometry({ n: LOOPBACK_ARRANGEMENTS[arrKey].n, l: loopSl, G, wpc, cpc }) : null;
  const t0 = bulk * (2 * dia(faceNe) + binderD + 2 * loopD) + (isTerry ? 0.25 * loopGeom.loop_height_mm : 0);
  const tB = t0 + b.pile_mm * 0.7;                                      // the nap compresses under the gauge foot
  const rhoFibre = Object.entries(actual).reduce((s, [k, x]) => s + x * (FIBRE[k] || FIBRE.cotton).rho, 0);
  const kFibre = Object.entries(actual).reduce((s, [k, x]) => s + x * (FIBRE[k] || FIBRE.cotton).k, 0);
  const warmth = (t) => {
    const bulkRho = gsm / (t * 1000);                                   // g/cm³
    const solid = Math.min(0.6, bulkRho / rhoFibre);
    const beta = (kFibre - K_AIR) / (kFibre + 2 * K_AIR);
    const kCond = K_AIR * (1 + 2 * solid * beta) / (1 - solid * beta);
    const kEff = kCond + 0.012;                                         // radiation + micro-convection allowance
    const R = (t / 1000) / kEff;
    return { thickness_mm: r2(t), bulk_density_g_cm3: r3(bulkRho), porosity_pct: r1((1 - solid) * 100), k_eff_w_mk: r3(kEff), r_m2k_w: r3(R), clo: r2(R / 0.155) };
  };
  const before = warmth(t0), after = b.passes ? warmth(tB) : null;

  // ---- risks particular to this cloth ----
  const risks = [];
  if (binder && binder.filament && (shares.cotton || 0) >= 0.5) risks.push({ topic: 'Binder grin-through', level: 'watch', note: 'A polyester binder takes no reactive dye. In a dark shade it shows as white specks on the face unless the face is tight enough to hide it (invisible fleece) or the polyester is dyed in a disperse bath.' });
  if (b.passes && poly >= 0.5 && !b.sheared) risks.push({ topic: 'Pilling', level: 'high', note: 'A raised polyester nap pills. Shear it, or use a low-pill polyester.' });
  else if (b.passes) risks.push({ topic: 'Pilling and shedding', level: poly > 0.1 ? 'medium' : 'medium', note: 'The raised fibre is loose by design; expect 3-3.5 on a pilling test after brushing and some lint on first washes.' });
  if (b.passes && (shares.cotton || 0) >= 0.7) risks.push({ topic: 'Nap after washing', level: 'watch', note: 'A cotton nap lays down and looks thin after the first washes. A light shear and a softener help it stand.' });
  let loop = null;
  if (isTerry) {
    // what each loop size and each layout would do at this GSM, face and binder
    const need = gsm * (1 - elastane) * 100 / (cpc * wpc);
    const ref = loopbackGeometry({ n: 4, l: 1.55 * 20 / G, G, wpc, cpc });
    const snagIdx = (g) => (ref.snag_area > 0 ? g.snag_area / ref.snag_area : 1);
    const arr = LOOPBACK_ARRANGEMENTS[arrKey];
    const sizes = Object.entries(LOOPBACK_SIZES).map(([k, z]) => {
      const l = z.l20 * 20 / G;
      const exact = neOfTex(Math.max(5, (need - faceMass - binderMass) / l));
      const g = loopbackGeometry({ n: arr.n, l, G, wpc, cpc });
      return { key: k, label: z.label, loop_length_mm: r2(l), loop_ne: snap(exact, STD_LOOP), loop_ne_exact: r1(exact), loop_height_mm: g.loop_height_mm };
    });
    const arrangements = Object.entries(LOOPBACK_ARRANGEMENTS).map(([k, a]) => {
      const g = loopbackGeometry({ n: a.n, l: loopSl, G, wpc, cpc });
      return { key: k, label: a.label, tuck_repeat: a.n, sequence: a.seq.map(t => t + 1), loop_height_mm: g.loop_height_mm, float_mm: g.float_mm, loops_per_cm2: g.loops_per_cm2, snag_index: r2(snagIdx(g)) };
    });
    const snag = snagIdx(loopGeom);
    loop = {
      size: { key: loopSize.key, label: loopSize.label, length_per_needle_mm: r2(loopSl) },
      arrangement: { key: arrKey, label: arr.label, tuck_repeat: arr.n, sequence: arr.seq.map(t => t + 1), look: arr.look, face: arr.face },
      ...loopGeom, snag_area: undefined, snag_index: r2(snag),
      sizes, arrangements,
      back: loopbackBack({ arrKey, h: loopGeom.loop_height_mm, S: loopGeom.float_mm, l: loopSl, G, cpc, loopNe, ply, binderFilament: !!(binder && binder.filament) }),
      formula: 'h = √(3/16 · (L² − S²)),  L = n · loop length per needle,  S = n · needle pitch',
      basis: 'DERIVED from the loop yarn length and the float span; the size presets are MODELLED around the measured 1.55 mm (record 47)',
    };
    if (loopGeom.taut) warnings.push(`At ${r2(loopSl)} mm per needle the loop yarn is no longer than the needle pitch (${r2(pitch)} mm): the floats lie taut and no loop forms. Raise the sinker.`);
    risks.push({ topic: 'Loop snagging', level: snag > 1.4 ? 'high' : snag > 1.05 ? 'watch' : 'low',
      note: `${r2(loopGeom.loop_height_mm)} mm loops over ${r2(loopGeom.float_mm)} mm floats — ${r1(snag)}× the snag exposure of a standard 1:3 terry. ${snag > 1.05 ? 'They catch on Velcro and jewellery; a smaller loop or a shorter float holds better.' : 'Short, tight loops hold well.'}` });
    risks.push({ topic: 'Face', level: arrKey === 'straight' || arrKey === 'micro' ? 'watch' : 'low', note: arr.face });
    if (arrKey === 'micro' && texOfNe(loopNe) > 2.2 * faceTex) risks.push({ topic: 'Loop grin-through', level: 'watch', note: `Tied every second needle, a loop yarn ${r1(texOfNe(loopNe) / faceTex)}× the face weight can show through the face. Use a finer loop yarn or the 1:3 layout.` });
  }
  risks.push({ topic: 'Width loss in brushing', level: 'process', note: b.passes ? 'Raising pulls the cloth in. Dry it on the stenter about 15-18% wider than finish before brushing, then set the width on the second stenter.' : 'Not brushed — width is set on the stenter and compactor.' });
  if (elastane > 0) risks.push({ topic: 'Elastane', level: 'process', note: 'Elastane is plated with the face yarn, never in the loop yarn; heat-set before dyeing.' });

  // ---- process route ----
  const route = ['Knit (fleece machine, sinker set for the loop yarn)', 'Dye (piece)'];
  if (poly >= 0.15 && cellKey !== 'polyester') route.splice(1, 0, 'Heat-set');
  route.push('Hydro-extract / slit');
  if (b.passes) {
    route.push('Stenter dry, about 15-18% over finish width', `Raise / brush (${b.passes} passes${b.sides === 'both' ? ', both sides' : ', back'})`);
    if (b.sheared) route.push('Shear');
    route.push('Stenter (finish, softener, width set)', 'Compact');
  } else {
    route.push('Stenter (softener, width set)', 'Compact');
  }

  const yarns = [
    { role: 'face', label: `${faceNe}/1 ${faceBlend > 0 && faceBlend < 1 ? `${Math.round((1 - faceBlend) * 100)}/${Math.round(faceBlend * 100)} ${cellKey}/polyester` : (faceBlend >= 1 ? 'polyester' : cellKey)}${elastane > 0 ? ` + elastane plated` : ''}`,
      composition: faceBlend >= 0.999 ? '100% Polyester'
        : faceBlend > 0.001 ? `${Math.round((1 - faceBlend) * 100)}% ${cap(cellKey)} ${Math.round(faceBlend * 100)}% Polyester`
        : `100% ${cap(cellKey)}`,
      ne: faceNe, tex: r2(faceTex), sl_mm: r2(faceSl), share_pct: r1(massShare.face * 100), basis: +p.faceNe > 0 ? 'factory record' : 'measured trend (face count vs GSM)' },
  ];
  if (binder) yarns.push({ role: 'binder', label: binder.label, ne: r1(binder.ne), tex: r2(binder.tex), sl_mm: r2(binder.sl), share_pct: r1(massShare.binder * 100), basis: binder.sl_basis });
  yarns.push({ role: 'loop', label: `${loopNe}/1${ply > 1 ? ' × 2 ply' : ''} ${loopBlend.label}`, ne: loopNe, ply, tex: r2(loopTexChosen), sl_mm: r2(loopSl), share_pct: r1(massShare.loop * 100),
    basis: 'solved from the mass balance', exact_ne: r1(loopNeExact * (ply > 1 ? 2 : 1)), sl_for_exact_gsm_mm: r2(loopSlExact) });
  if (elastane > 0) yarns.push({ role: 'elastane', label: 'Elastane, plated with the face', share_pct: r1(elastane * 100) });

  return {
    ok: true,
    variant: { id: p.fabricId, name: v.name, kind: v.kind, yarn_system: v.yarns, tuck_repeat: v.tuckRepeat, brushed: b.passes > 0 },
    yarns,
    declaration: yarns.filter(y => y.role !== 'elastane').map(y => `${y.role === 'face' ? 'Face' : y.role === 'binder' ? 'Binder' : 'Loop'} ${y.label}`).join(' · '),
    mass_balance: {
      formula: 'GSM = cpc × wpc × Σ(l × tex) / 100 × (1 − brushing loss)',
      wales_per_cm: r2(wpc), courses_per_cm: r2(cpc), kc: r3(kc), gauge: G, needle_pitch_mm: r3(pitch),
      gsm_target: gsm, gsm_at_chosen_counts: r1(gsmAtChosen), deviation_pct: r1((gsmAtChosen - gsm) / gsm * 100),
      gsm_before_brushing: r1(gsm / (1 - fabricLoss)),
    },
    composition: { declared: fmtComp(declared), achieved: fmtComp(actual), loop_yarn_blend: loopBlend.label, loop_polyester_needed_pct: r1(loopPolyNeeded * 100) },
    gauge_check: {
      gauge: G, ok: gaugeOk, knit_load_tex: r1(knitLoad), knit_limit_tex: r1(knitTexMax), loop_ne: loopNe / ply, loop_ne_min: r1(loopNeMin),
      suggested_gauge: suggested, factory_practice: dataGauge ? `${dataGauge[0]}G (${dataGauge[1]} of ${D.rows} factory ${isTerry ? 'loopback terry' : 'fleece'} rows)` : null,
      note: 'Face and binder knit on their own feeds, so each must clear the hook; the loop yarn only tucks, so it can be far coarser. The limits are modelled from mill practice (26/1 face and binder and a 10/1 loop run on 20G).',
    },
    brushing: b.passes ? {
      passes: b.passes, sides: b.sides, sheared: b.sheared,
      loop_yarn_removed_pct: r1(b.loop_loss * 100), fabric_mass_removed_pct: r1(fabricLoss * 100),
      pile_height_mm: r2(b.pile_mm), basis: 'MODELLED: 3.5% of the loop yarn per pass; pile from staple length and passes',
    } : null,
    thermal: { unbrushed: before, brushed: after, note: 'Still air held in the cloth does the insulating; brushing roughly doubles the air it holds.' },
    loop,
    risks,
    process_route: route,
    warnings,
    calibration: {
      anchors: isTerry ? M.terry.anchors : M.anchors.filter(id => id !== 47), kc: M.KC, kc_each: M.kc_each,
      wales_per_cm_per_gauge: r3(D.wpcPerG), factory_rows: D.rows, row_kind: isTerry ? 'loopback terry' : 'fleece',
      face_count_trend: `Ne ≈ ${r2(D.faceFit.a)} ${D.faceFit.b < 0 ? '−' : '+'} ${Math.abs(r3(D.faceFit.b))} × GSM`,
      leave_one_out: isTerry ? M.terry.loo : M.loo,
    },
    source: isTerry
      ? 'Loopback terry model: factory terry records and one full order specification (measured), an industry count chart, mass balance and heat transfer (derived), gauge limits (modelled).'
      : 'Fleece model: factory records + full order specifications (measured), mass balance and heat transfer (derived), brushing and gauge limits (modelled).',
  };

  function needLighterFace(ne) { return ne > 32; }
}

module.exports = { analyzeFleece, isFleeceFamily, FLEECE_IDS, _model: model };
