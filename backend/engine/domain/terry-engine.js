/**
 * KnitAdvisor — Plush terry & velour engine
 * =========================================
 *
 * Two different fabrics are both called "terry" in knitting:
 *
 *   LOOPBACK (French) terry — a loop yarn tucks every few needles and floats
 *   across the back. Same knitting as a fleece, never raised. Handled by
 *   fleece-engine.js (`french_terry`), calibrated on the factory's own terry
 *   rows.
 *
 *   SINKER-LOOP (plush) terry — this file. Two yarns are PLATED into every
 *   needle loop: the GROUND yarn in front (the face is plain jersey), the PILE
 *   yarn behind it. The sinkers have two nib levels: the ground yarn is knocked
 *   over the low nib, the pile yarn is drawn over the high one, so every sinker
 *   loop of the pile yarn stands h mm proud of the back — a loop at every
 *   needle in every course (or every second needle, "1:1 plush").
 *   Knitted towel terry is this fabric with tall loops. VELOUR is this fabric
 *   with the loops sheared open into a dense cut pile.
 *
 * HOW THE NUMBERS ARE GROUNDED
 *
 * MEASURED — the factory's loopback terry rows (same single cylinder, same
 * 20G, same two-yarn plated needle loop of face + binder):
 *   • the plated bundle needs a loop of l = √(Σtex) / TF with TF ≈ 1.35
 *     (sd ≈ 0.05 over 122 rows — the tightest relation in the whole dataset);
 *   • finished wales per cm ≈ 0.537·G (open width of an unraised loop cloth);
 *   • the course constant Kc of loopback terry (fleece-engine anchors).
 *
 * DERIVED — the pile yarn shares the ground yarn's needle loop and adds the
 * climb over the high nib and back down, 2h per loop:
 *
 *     l_pile = l_ground + 2h / (pile every n needles)
 *     GSM    = cpc · wpc · (l_g·tex_g + l_pile·tex_p) / 100
 *
 * Shearing velour cuts each loop at height c: the top 2(h − c) of every loop
 * leaves as lint, and the finished pile is c tall.
 *
 * MODELLED — the sinker height chosen when none is given, the shearing cut
 * height, the gauge limit for a plated bundle, the capillary share of the
 * absorbency estimate. Each is labelled so. There are no plush or velour
 * orders in the factory data yet; when there are, they belong in ANCHORS.
 */
'use strict';

const reference = require('../reference');
const fleece = require('./fleece-engine');
const { PLUSH_SIZES, PLUSH_ARRANGEMENTS } = require('./terry-loops');

const TERRY_IDS = ['terry_fabric', 'velour_plush'];
const isPlushTerry = (id) => TERRY_IDS.includes(id);

const VARIANTS = {
  terry_fabric: { name: 'Knitted terry (sinker-loop plush)', kind: 'plush', cut: false },
  velour_plush: { name: 'Velour (sheared plush)', kind: 'velour', cut: true },
};

// fibre constants: density g/cm³, thermal conductivity W/m·K, water retention
// value (g water held inside 1 g fibre after centrifuging — standard WRV
// figures: cotton 0.45-0.50, viscose 0.90-1.00, modal 0.60-0.75, lyocell
// 0.65-0.70, polyester 0.03-0.05, nylon 0.10-0.15)
const FIBRE = {
  cotton:    { rho: 1.52, k: 0.071, wrv: 0.48, wet: 1.0 },
  viscose:   { rho: 1.52, k: 0.070, wrv: 0.95, wet: 1.0 },
  bamboo:    { rho: 1.52, k: 0.070, wrv: 0.95, wet: 1.0 },
  modal:     { rho: 1.52, k: 0.070, wrv: 0.68, wet: 1.0 },
  tencel:    { rho: 1.50, k: 0.070, wrv: 0.67, wet: 1.0 },
  linen:     { rho: 1.50, k: 0.070, wrv: 0.50, wet: 1.0 },
  polyester: { rho: 1.38, k: 0.140, wrv: 0.04, wet: 0.4 },
  nylon:     { rho: 1.14, k: 0.250, wrv: 0.12, wet: 0.6 },
  acrylic:   { rho: 1.17, k: 0.080, wrv: 0.06, wet: 0.5 },
  wool:      { rho: 1.31, k: 0.050, wrv: 0.40, wet: 0.7 },
  elastane:  { rho: 1.20, k: 0.150, wrv: 0.00, wet: 0.3 },
};
const CELLULOSIC = ['cotton', 'viscose', 'modal', 'tencel', 'linen', 'bamboo'];
const K_AIR = 0.026;

const STD_GROUND = [20, 22, 24, 26, 28, 30, 32, 34, 36, 40];
const STD_PILE = [8, 10, 12, 14, 16, 18, 20, 24, 26, 28, 30, 32, 34, 36, 40];
const STD_DENIER_GROUND = [40, 50, 75, 100];
const STD_DENIER_PILE = [75, 100, 150, 200, 300];
// standard plush sinker heights (high nib above the knock-over line), mm
const SINKERS = [1.0, 1.2, 1.5, 1.8, 2.0, 2.2, 2.5, 2.8, 3.0, 3.5];
const PILE_BLENDS = [
  { p: 0, label: 'cotton' }, { p: 0.2, label: 'CVC 80/20' }, { p: 0.4, label: 'CVC 60/40' },
  { p: 0.5, label: 'CVC 50/50' }, { p: 0.65, label: 'PC 65/35' }, { p: 1, label: 'polyester' },
];

const texOfNe = (ne) => 590.5 / ne;
const neOfTex = (tex) => 590.5 / tex;
const snap = (v, list) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0]);
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const dia = (ne) => 0.907 / Math.sqrt(ne);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// ── the measured constants, once per reference snapshot ─────────────────
let cached = null, cachedFor = null;
function model() {
  const snapRef = reference.get();
  if (cached && cachedFor === snapRef) return cached;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const rows = (snapRef.factoryRecords || []).filter(r => r.fab === 'terry' && r.sl > 4 && r.ne > 0 && r.g > 0);
  // loopback face and binder are the same spun count in these rows' cotton
  // orders, plated in one needle loop
  const tfs = rows.map(r => Math.sqrt(2 * texOfNe(r.ne)) / r.sl);
  const tf = tfs.length >= 20 ? mean(tfs) : 1.351;
  const sd = tfs.length >= 20 ? Math.sqrt(mean(tfs.map(x => (x - tf) ** 2))) : 0.049;
  const fm = fleece._model();
  cached = {
    tf, tf_sd: sd, rows: rows.length,
    wpcPerG: fm.terry ? fm.terry.wpcPerG : 0.537,
    kc: fm.KC.terry,
    faceFit: fm.terry ? fm.terry.faceFit : { a: 44.74, b: -0.0446 },
  };
  cachedFor = snapRef;
  return cached;
}

function fibreShares(parsed) {
  const f = (parsed && parsed.fibers) || { cotton: 100 };
  const tot = Object.values(f).reduce((s, v) => s + (+v || 0), 0) || 100;
  const out = {}; for (const [k, v] of Object.entries(f)) if (+v > 0) out[k] = +v / tot;
  return out;
}

/**
 * @param {object} p
 *   fabricId, gsm (finished), gauge, composition (parsed)
 *   groundNe | groundDenier   optional: fix the ground yarn
 *   pileNe | pileDenier       optional: fix the pile yarn (then the sinker height is solved)
 *   pileHeightMm              optional: the sinker (high-nib) height
 *   pileEvery                 1 = full plush (default), 2 = 1:1 plush
 *   cutHeightMm               velour only: shear the pile to this height
 *   cut                       velour only: false leaves the loops uncut (plush)
 */
function analyzePlushTerry(p) {
  const v = VARIANTS[p.fabricId];
  if (!v) return null;
  const gsm = +p.gsm;
  if (!(gsm > 0)) return null;
  const M = model();
  const G = +p.gauge > 0 ? +p.gauge : 20;
  const shares = fibreShares(p.composition);
  const E = shares.elastane || 0;
  const P = shares.polyester || 0;
  const cellKey = CELLULOSIC.find(k => shares[k]) || 'cotton';
  const allPoly = P >= 0.95 || (P + E >= 0.99 && !CELLULOSIC.some(k => shares[k]));
  const cut = v.cut && p.cut !== false;
  // loop layout: which needle positions carry a pile loop (terry-loops.js);
  // `every` = 1/share, so a selected position's extra 2h is spread over 1/φ
  const arrKey = PLUSH_ARRANGEMENTS[p.loopArrangement] ? p.loopArrangement : (+p.pileEvery === 2 ? 'alternate' : 'full');
  const arrangement = PLUSH_ARRANGEMENTS[arrKey];
  const every = 1 / arrangement.phi;
  // loop size preset → sinker height, unless a height is given
  const sizeKey = PLUSH_SIZES[p.loopSize] ? p.loopSize : null;
  const givenH = +p.pileHeightMm > 0 ? +p.pileHeightMm : (sizeKey ? PLUSH_SIZES[sizeKey].h : null);
  const warnings = [];

  const wpc = M.wpcPerG * G;

  // ---- ground yarn ----
  const groundFilament = allPoly || +p.groundDenier > 0 || (P >= (v.kind === 'velour' ? 0.15 : 0.2) && !(+p.groundNe > 0));
  let ground;
  if (groundFilament) {
    const den = +p.groundDenier > 0 ? +p.groundDenier : snap(gsm < 260 ? 50 : gsm < 380 ? 75 : 100, STD_DENIER_GROUND);
    ground = { label: `${den}D polyester filament`, tex: den / 9, denier: den, filament: true, fibre: 'polyester' };
  } else {
    // A plush ground only carries the pile — the pile is most of the weight —
    // so it runs a few counts finer than a loopback face of the same GSM.
    const trend = M.faceFit.a + M.faceFit.b * gsm + 4;
    const ne = +p.groundNe > 0 ? +p.groundNe : snap(trend, STD_GROUND);
    ground = { label: `${ne}/1 ${cellKey}`, tex: texOfNe(ne), ne, filament: false, fibre: cellKey };
  }

  // ---- the balance for any pile yarn and sinker height ----
  const cutNominal = +p.cutHeightMm > 0 ? +p.cutHeightMm : (P >= 0.5 ? 1.2 : 1.5);   // MODELLED
  const cutAt = (h) => (cut ? Math.min(cutNominal, h - 0.3) : h);
  const geom = (pileTex, h, ev = every) => {
    const lg = Math.sqrt(ground.tex + pileTex) / M.tf;                 // mm, plated bundle at the measured TF
    const cpc = M.kc * 10 / lg;
    const c = cutAt(h);
    const lpKnit = lg + 2 * h / ev;                                     // as knitted
    const lpFin = lg + 2 * c / ev;                                      // after shearing (velour)
    const gsmOf = (lp) => cpc * wpc * (lg * ground.tex + lp * pileTex) / 100 / (1 - E);
    return { lg, cpc, c, lpKnit, lpFin, gsmFin: gsmOf(lpFin), gsmGrey: gsmOf(lpKnit) };
  };
  const solvePileTex = (h, ev = every) => {
    let tex = 25;
    for (let i = 0; i < 30; i++) {
      const g = geom(tex, h, ev);
      const need = gsm * (1 - E) * 100 / (g.cpc * wpc);                 // Σ l·tex per needle-course
      const t2 = Math.max(3, (need - g.lg * ground.tex) / g.lpFin);
      if (Math.abs(t2 - tex) < 1e-4) { tex = t2; break; }
      tex = 0.5 * tex + 0.5 * t2;
    }
    return tex;
  };
  const solveHeight = (pileTex) => {
    let lo = 0.6, hi = 5;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (geom(pileTex, mid).gsmFin < gsm) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  // ---- pile yarn: filament or spun, and which sinker ----
  const pileFilament = allPoly || +p.pileDenier > 0 || (v.kind === 'velour' && P >= 0.5);
  const pileLabelOf = (tex) => pileFilament
    ? { den: snap(tex * 9, STD_DENIER_PILE) }
    : { ne: snap(neOfTex(tex), STD_PILE) };
  const texOfChoice = (c) => (c.den ? c.den / 9 : texOfNe(c.ne));
  // the height a merchant would pick: towel loops tall, light plush low,
  // velour knitted ~2 mm before it is sheared (MODELLED preference)
  const hPref = v.kind === 'velour' ? 2.0 : (gsm >= 450 ? 2.5 : gsm >= 350 ? 2.0 : gsm >= 280 ? 1.5 : 1.2);
  // a pile yarn as coarse as the ground or a step coarser fills the loop and
  // plates cleanly behind it (MODELLED target ratio)
  // (a filament pile is the usual 2× the ground denier: 75D ground, 150D pile)
  const ratioPref = pileFilament ? 2.0 : (v.kind === 'velour' ? 1.0 : 1.25);
  const table = SINKERS.map(h => {
    const tex = solvePileTex(h);
    const ch = pileLabelOf(tex);
    const ct = texOfChoice(ch), g = geom(ct, h);
    const lint = cut ? (2 * (h - g.c) / every * ct) / (g.lg * ground.tex + g.lpKnit * ct) : null;
    return { h, exact_tex: tex, choice: ch, gsm: g.gsmFin, lint };
  });
  let pick, basis;
  if (+p.pileNe > 0 || +p.pileDenier > 0) {
    const ch = +p.pileDenier > 0 ? { den: +p.pileDenier } : { ne: +p.pileNe };
    const hx = solveHeight(texOfChoice(ch));
    const h = givenH || snap(hx, SINKERS);
    pick = { h, choice: ch, exact_tex: null };
    basis = givenH ? 'given pile yarn and sinker' : 'given pile yarn — sinker solved from the balance';
  } else if (givenH) {
    const h = givenH, tex = solvePileTex(h);
    pick = { h, choice: pileLabelOf(tex), exact_tex: tex };
    basis = sizeKey && !(+p.pileHeightMm > 0) ? `${PLUSH_SIZES[sizeKey].label} (${h} mm sinker) — pile yarn solved from the balance` : 'given sinker — pile yarn solved from the balance';
  } else {
    const score = (r) => Math.abs(Math.log((r.exact_tex) / (ground.tex * ratioPref))) + 0.45 * Math.abs(r.h - hPref)
      + (Math.abs(r.gsm - gsm) / gsm > 0.06 ? 1 : 0);
    // velour is knitted with room to shear: at least 1.5 mm of loop
    pick = table.filter(r => r.exact_tex > 3 && (v.kind !== 'velour' || r.h >= 1.5)).reduce((b, r) => (score(r) < score(b) ? r : b));
    basis = 'sinker chosen so the pile yarn plates cleanly behind the ground (modelled preference)';
  }
  const h = pick.h;
  const pileTex = texOfChoice(pick.choice);
  const g = geom(pileTex, h);
  const hExact = solveHeight(pileTex);
  const pileTexExact = pick.exact_tex || solvePileTex(h);

  // ---- masses and shares (finished) ----
  const mG = g.lg * ground.tex, mP = g.lpFin * pileTex;
  const tot = mG + mP;
  const share = { ground: mG / tot * (1 - E), pile: mP / tot * (1 - E), elastane: E };
  const shearLossFab = cut ? (2 * (h - g.c) / every * pileTex) / (mG + g.lpKnit * pileTex) : 0;

  // ---- composition: the pile blend that lands the declared polyester ----
  const groundPoly = ground.fibre === 'polyester' ? 1 : 0;
  let pilePolyNeeded = share.pile > 0 ? (P - share.ground * groundPoly) / share.pile : 0;
  pilePolyNeeded = Math.max(0, Math.min(1, pilePolyNeeded));
  const pileBlend = pileFilament ? PILE_BLENDS[PILE_BLENDS.length - 1]
    : PILE_BLENDS.reduce((b, x) => (Math.abs(x.p - pilePolyNeeded) < Math.abs(b.p - pilePolyNeeded) ? x : b), PILE_BLENDS[0]);
  const achievedPoly = share.ground * groundPoly + share.pile * pileBlend.p;
  const achieved = {};
  if (achievedPoly > 0.0005) achieved.polyester = achievedPoly;
  const cellShare = 1 - achievedPoly - E;
  if (cellShare > 0.0005) achieved[cellKey] = cellShare;
  if (E > 0) achieved.elastane = E;
  const fmtComp = (o) => Object.entries(o).sort((a, c) => c[1] - a[1]).map(([k, x]) => `${Math.round(x * 100)}% ${k}`).join(' / ');
  const gap = Math.abs(achievedPoly - P) * 100;
  if (gap >= 3) warnings.push(`With commercial yarns the nearest construction lands at ${fmtComp(achieved)}, ${r1(gap)} points of polyester away from the declared composition.`);

  // ---- labels ----
  const pileLabel = pick.choice.den
    ? `${pick.choice.den}D polyester filament (soft, micro-filament for ${cut ? 'velour' : 'plush'})`
    : `${pick.choice.ne}/1 ${pileBlend.p === 0 ? cellKey : pileBlend.label}${pileBlend.p === 0 ? ', soft twist' : ''}`;
  const pileNeEq = pick.choice.den ? r1(5315 / pick.choice.den) : pick.choice.ne;
  if (!pick.choice.den && (pick.choice.ne > 40 || pick.choice.ne < 8)) warnings.push(`The balance asks for a ${r1(neOfTex(pileTexExact))} Ne pile yarn — outside what plush is knitted with. Change the sinker height or the ground yarn.`);
  if (Math.abs(g.gsmFin - gsm) / gsm > 0.06) warnings.push(`With the nearest standard sinker and yarn the cloth comes to ${r1(g.gsmFin)} GSM. A ${r2(hExact)} mm sinker hits ${gsm} exactly.`);

  // ---- gauge: the plated bundle goes through one hook (MODELLED limit) ----
  const bundle = ground.tex + pileTex;
  const limitOf = (gg) => 2 * 1650 * Math.pow(2.54 / gg, 2);
  const gaugeOk = bundle <= limitOf(G);
  let suggested = null;
  if (!gaugeOk) for (const gg of [22, 20, 18, 16, 14, 12]) { if (gg < G && bundle <= limitOf(gg)) { suggested = gg; break; } }

  // ---- plating: does the pile stay behind the ground? (MODELLED rule) ----
  const plateRatio = pileTex / ground.tex;
  const grin = plateRatio > 1.8 ? 'high' : plateRatio > 1.4 ? 'watch' : 'low';

  // ---- loops ----
  const loopsPerCm2 = g.cpc * wpc / every;

  // ---- thickness, porosity, warmth ----
  const rhoF = Object.entries(achieved).reduce((s, [k, x]) => s + x * (FIBRE[k] || FIBRE.cotton).rho, 0);
  const kF = Object.entries(achieved).reduce((s, [k, x]) => s + x * (FIBRE[k] || FIBRE.cotton).k, 0);
  const dB = dia(neOfTex(bundle));
  const base = 1.25 * 2 * dB;
  const pileStand = cut ? 0.85 * g.c : 0.75 * h;                       // loops lean and give under the gauge foot
  const t = base + pileStand;
  const bulkRho = gsm / (t * 1000);
  const solid = Math.min(0.6, bulkRho / rhoF);
  const beta = (kF - K_AIR) / (kF + 2 * K_AIR);
  const kEff = K_AIR * (1 + 2 * solid * beta) / (1 - solid * beta) + 0.012;
  const R = (t / 1000) / kEff;

  // ---- water: what the cloth can take up (fibre WRV measured, capillary fill MODELLED) ----
  const fibreHeld = gsm * Object.entries(achieved).reduce((s, [k, x]) => s + x * (FIBRE[k] || FIBRE.cotton).wrv, 0);
  const wet = Object.entries(achieved).reduce((s, [k, x]) => s + x * (FIBRE[k] || FIBRE.cotton).wet, 0);
  const pore = (1 - solid) * t * 1000;                                  // g of water to fill every pore of 1 m²
  const CAP_FILL = 0.5;
  const capillary = pore * CAP_FILL * wet;
  const water = fibreHeld + capillary;

  // ---- risks ----
  const risks = [];
  if (grin !== 'low') risks.push({ topic: 'Pile grin-through', level: grin, note: `The pile yarn is ${r1(plateRatio)}× the ground's weight per metre. A coarse pile yarn rolls to the face and shows through the ground — feed it at lower tension than the ground, or use a coarser ground.` });
  if (!cut && h >= 2.5) risks.push({ topic: 'Loop snagging and pull-out', level: 'watch', note: `${r1(h)} mm loops are held only by being plated into the ground loop. They catch on hooks and jewellery; a pulled loop runs along the course. Keep the pile yarn twist up and avoid over-long loops.` });
  if (!cut && water > 0) risks.push({ topic: 'Absorbency and softener', level: 'process', note: 'A silicone softener coats the loops and kills absorbency. Use a hydrophilic softener and check the sinking time after finishing.' });
  if (cut) {
    risks.push({ topic: 'Pile direction (one-way)', level: 'process', note: 'Sheared pile lies one way and reflects light differently by direction. Cut every panel with the nap running the same way, or two panels of one colour will look like two shades.' });
    risks.push({ topic: 'Crush and pressure marks', level: 'watch', note: 'Wet cut pile crushes in rope dyeing and under roll pressure. Dye in a soft-flow jet at low load, do not compact, and do not batch it tightly rolled.' });
    risks.push({ topic: 'Shedding', level: 'watch', note: 'Cut fibre ends are loose by design; expect lint in the first washes. A final shear and a good plating tension keep it down.' });
  }
  if (P >= 0.5) risks.push({ topic: 'Static and low absorbency', level: 'watch', note: 'A polyester pile holds little water and charges up. Fine for apparel velour, poor for a towel.' });
  if (E > 0) risks.push({ topic: 'Elastane', level: 'process', note: 'Elastane is plated with the ground yarn, never in the pile; heat-set before dyeing.' });

  // ---- route ----
  const route = [`Knit (plush machine, ${r1(h)} mm sinker${arrKey !== 'full' ? `, ${arrangement.label.toLowerCase()} pile selection` : ''})`];
  if (P >= 0.15 || E > 0) route.push('Heat-set');
  if (cut) route.push('Shear grey (cut the loops open)');
  route.push('Scour / bleach', P >= 0.5 ? 'Disperse dye (HT)' : (P >= 0.15 ? 'Disperse + reactive dye (two-bath)' : 'Reactive dye'));
  route.push('Hydro-extract (low pressure, open width)');
  if (cut) route.push('Stenter dry (overfeed, no width stretch)', 'Brush / polish (opens the cut fibre)', `Final shear (level the pile to ${r1(g.c)} mm)`, 'Stenter finish (overfeed, softener)');
  else route.push('Stenter with overfeed (hydrophilic softener, no width stretch)', 'Tumble / relax dry (opens and stands the loops)');

  const yarns = [
    { role: 'ground', label: ground.label, composition: ground.fibre === 'polyester' ? '100% Polyester' : `100% ${cap(cellKey)}`,
      ne: ground.ne || r1(neOfTex(ground.tex)), denier: ground.denier || null, tex: r2(ground.tex), sl_mm: r2(g.lg), share_pct: r1(share.ground * 100),
      basis: `plated-bundle tightness from ${M.rows} factory terry rows (TF ${r3(M.tf)})` },
    { role: 'pile', label: pileLabel, ne: pileNeEq, denier: pick.choice.den || null, tex: r2(pileTex),
      sl_mm: r2(g.lpKnit), sl_finished_mm: cut ? r2(g.lpFin) : null, share_pct: r1(share.pile * 100), basis,
      exact_ne: pick.choice.den ? null : r1(neOfTex(pileTexExact)) },
  ];
  if (E > 0) yarns.push({ role: 'elastane', label: 'Elastane, plated with the ground', share_pct: r1(E * 100) });

  return {
    ok: true,
    variant: { id: p.fabricId, name: cut ? v.name : (v.kind === 'velour' ? 'Plush (uncut loops)' : v.name), kind: v.kind, cut, pile_every: Math.round(every), arrangement: arrKey },
    loop: (() => {
      // every size at this layout, and every layout at this sinker, for the
      // same ground yarn and GSM
      const sizes = Object.entries(PLUSH_SIZES).map(([k, z]) => {
        const tex = solvePileTex(z.h), ch = pileLabelOf(tex);
        return { key: k, label: z.label, sinker_mm: z.h, pile: ch.den ? `${ch.den}D` : `${ch.ne}/1`, pile_ne_exact: pileFilament ? null : r1(neOfTex(tex)) };
      });
      const arrangements = Object.entries(PLUSH_ARRANGEMENTS).map(([k, a]) => {
        const ev = 1 / a.phi, tex = solvePileTex(h, ev), ch = pileLabelOf(tex), gg = geom(texOfChoice(ch), h, ev);
        return { key: k, label: a.label, loop_share: Math.round(a.phi * 100), pile: ch.den ? `${ch.den}D` : `${ch.ne}/1`, loops_per_cm2: r1(gg.cpc * wpc * a.phi) };
      });
      return {
        size: { key: sizeKey || 'custom', label: sizeKey ? PLUSH_SIZES[sizeKey].label : `${r2(h)} mm sinker`, sinker_mm: r2(h) },
        arrangement: { key: arrKey, label: arrangement.label, loop_share_pct: Math.round(arrangement.phi * 100), look: arrangement.look },
        loop_height_mm: r2(cut ? g.c : h), loops_per_cm2: r1(loopsPerCm2),
        sizes, arrangements,
        basis: 'A selected needle adds 2h of pile yarn; loop height = sinker height (velour: the cut height). Arrangements other than full plush need pile selection on the machine.',
      };
    })(),
    yarns,
    declaration: `Ground ${ground.label} · Pile ${pileLabel}`,
    pile: {
      sinker_height_mm: r2(h), sinker_for_exact_gsm_mm: r2(hExact),
      finished_pile_mm: r2(cut ? g.c : h), loops_per_cm2: r1(loopsPerCm2),
      kind: cut ? 'cut (sheared)' : 'uncut loops',
      // velour: the cut height sets the finished weight, so a taller knitted
      // loop changes the lint, not the pile yarn
      options: table.filter(r => r.exact_tex > 3 && (!cut || r.h >= cutNominal + 0.3 - 1e-9)).map(r => ({ sinker_mm: r.h, pile: r.choice.den ? `${r.choice.den}D` : `${r.choice.ne}/1`, gsm: r1(r.gsm), lint_pct: r.lint == null ? null : r1(r.lint * 100) })),
    },
    mass_balance: {
      formula: arrKey === 'full'
        ? 'GSM = cpc × wpc × (l_ground·tex_ground + l_pile·tex_pile) / 100;  l_pile = l_ground + 2h'
        : `GSM = cpc × wpc × (l_ground·tex_ground + l_pile·tex_pile) / 100;  l_pile = l_ground + 2h × ${Math.round(arrangement.phi * 100)}% (needles with a loop)`,
      ground_sl_mm: r2(g.lg), pile_sl_mm: r2(g.lpKnit), tightness_factor: r3(M.tf),
      wales_per_cm: r2(wpc), courses_per_cm: r2(g.cpc), kc: r3(M.kc), gauge: G,
      gsm_target: gsm, gsm_at_chosen_counts: r1(g.gsmFin), deviation_pct: r1((g.gsmFin - gsm) / gsm * 100),
      gsm_grey_before_shearing: cut ? r1(g.gsmGrey) : null,
    },
    shearing: cut ? {
      knitted_loop_mm: r2(h), cut_to_mm: r2(g.c), passes: 2,
      pile_yarn_removed_pct: r1((2 * (h - g.c) / every) / g.lpKnit * 100), fabric_mass_removed_pct: r1(shearLossFab * 100),
      basis: 'DERIVED: each loop loses its top 2(h − c) of yarn; the cut height is MODELLED (1.5 mm cotton, 1.2 mm polyester)',
    } : null,
    composition: { declared: fmtComp(shares), achieved: fmtComp(achieved), pile_blend: pileFilament ? 'polyester filament' : pileBlend.label, pile_polyester_needed_pct: r1(pilePolyNeeded * 100) },
    gauge_check: {
      gauge: G, ok: gaugeOk, bundle_tex: r1(bundle), bundle_limit_tex: r1(limitOf(G)), suggested_gauge: suggested,
      note: 'Ground and pile go through the same hook together, so their sum must clear it. The limit is modelled from mill practice (30/1 ground + 20/1 pile on 20G).',
    },
    plating: { pile_to_ground_ratio: r2(plateRatio), grin_risk: grin },
    absorbency: {
      fibre_held_g_m2: Math.round(fibreHeld), capillary_g_m2: Math.round(capillary), total_g_m2: Math.round(water),
      g_per_g: r2(water / gsm),
      basis: 'Fibre water retention (measured WRV per fibre) plus half the pore volume filled by capillarity (modelled)',
    },
    thermal: { thickness_mm: r2(t), bulk_density_g_cm3: r3(bulkRho), porosity_pct: r1((1 - solid) * 100), k_eff_w_mk: r3(kEff), r_m2k_w: r3(R), clo: r2(R / 0.155) },
    machine: {
      type: 'Single-jersey plush (terry) machine, two-level sinkers',
      gauge: gaugeOk ? G : (suggested || G),
      sinker_mm: r2(h),
      note: 'Each feeder carries both yarns through a plating guide: the ground yarn lands in front of the hook, the pile yarn behind it and over the high sinker nib.',
    },
    risks,
    process_route: route,
    warnings,
    calibration: {
      factory_rows: M.rows, tightness_factor: r3(M.tf), tightness_sd: r3(M.tf_sd), wales_per_cm_per_gauge: r3(M.wpcPerG), kc: r3(M.kc),
      note: 'No plush or velour order is in the factory data yet. Loop size, wales per cm and Kc come from the factory loopback terry (same cylinder, same plated two-yarn loop); the 2h pile geometry is derived; the sinker choice, cut height, gauge limit and capillary fill are modelled.',
    },
    source: 'Plush terry model: factory loopback terry records (measured), pile geometry and mass balance (derived), sinker choice, shearing and gauge limit (modelled).',
  };
}

module.exports = { analyzePlushTerry, isPlushTerry, TERRY_IDS, _model: model };
