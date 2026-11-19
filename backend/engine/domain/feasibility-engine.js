/**
 * KnitAdvisor — the feasibility engine: "can this fabric exist?", answered in three gates.
 *
 * Every Studio analysis already carries checks (the needle programme, the machine, the yarn). This engine reads the finished answer and
 * the design, and puts every check where it belongs, under one of three gates, each PASS, WARN or FATAL:
 *
 *   GATE 1  COHESION      does the cloth hold together? every yarn caught by a knit or a tuck, every needle cleared, two beds tied to
 *                         each other, no float or held loop long enough to fall apart in wear (U-01, U-13)
 *   GATE 2  PACKING       does the yarn fit the space it is given? the volumetric packing of the yarn in the cloth, Φ, and the factory's
 *                         own tightness window for the family (U-02, U-03)
 *   GATE 3  MACHINE AND   can a machine knit it, and can every fibre in it survive the wet route the whole cloth goes through together?
 *           CHEMISTRY     (U-04 … U-07, U-09 … U-12, U-14, U-16 … U-19)
 *   QUALITY (not a gate)  what shows on the face and under the shop's light (U-15, U-20)
 *
 * Each rule says what it found, its basis (law, measured, estimate) and, when it fails, a repair: the change to make, in numbers where
 * the numbers are known. A FATAL anywhere locks the factory files (set-up sheet, programme, cam chart) until it is fixed.
 *
 * Where a threshold is not ours. Some limits come from general textile practice and are carried here as estimates, never as FATAL, until a
 * mill's own floor confirms them (the CSP speed cap, the plating tension ratio, the brushing stitch length, the Φ bands). The FATAL ones
 * are laws (a yarn that is never caught; yarn envelopes packed past the close packing of parallel cylinders), the machine's own logic
 * (needles that meet head-on), or chemistry that destroys a fibre.
 *
 * Φ (packing). Φ = yarn envelope volume ÷ cloth volume = GSM ÷ (1000 · ρ · ψ · T), with ρ the fibre density (volumes add), ψ = 0.58
 * the fibre packing inside a yarn (estimate) and T the cloth thickness (the hand engine's T0, an estimate). The envelopes of parallel
 * cylinders cannot pack past π/(2√3) = 0.907 (law): above it the yarn does not fit (FATAL). The 0.14 and 0.74 warning bands are carried as
 * estimates; the factory's tightness window stays the measured test.
 *
 * No outside source is named in what this returns.
 */
'use strict';

const Y = require('./yarn-engine');
const CHEMY = require('./yarn-chemistry-engine');

const FP = Y.FIBER_PROPERTIES;
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const PSI = 0.58;                       // fibre packing inside a yarn (estimate)
const PHI_CLOSE = Math.PI / (2 * Math.sqrt(3));   // 0.9069: close packing of parallel cylinders (law)
const PHI_JAM = 0.74, PHI_SLEAZY = 0.14;          // warning bands (estimate)
const FLOAT_NEEDLES = 6, FLOAT_MM = 10;           // a float longer than this snags (practice)
const TUCK = { spun: { warn: 4, fatal: 6 }, filament: { warn: 6, fatal: 8 } };   // tucks running on one needle
const ENVELOPE = 21500;                           // general circular-knitting envelope: knitting tex ≤ 21500 ÷ gauge² (estimate)
const DENSITY_ALIAS = { spandex: 'elastane', lycra: 'elastane', cdp: 'polyester', pp: 'polypropylene', linen: null };
const DENSITY_FALLBACK = { linen: 1.5, hemp: 1.5 };

const RULES = {
  'U-01': { name: 'Topology disintegration', gate: 1 },
  'U-02': { name: '3D volumetric jamming', gate: 2 },
  'U-03': { name: 'Sleazy, unstable fabric', gate: 2 },
  'U-04': { name: 'Circular hook breakage', gate: 3 },
  'U-05': { name: 'Interlock needle crash', gate: 3 },
  'U-06': { name: 'Consecutive tuck overload', gate: 3 },
  'U-07': { name: 'Slub latch / hook jam', gate: 3 },
  'U-08': { name: 'Woven reed abrasion', gate: 3 },
  'U-09': { name: 'Caustic on wool or silk', gate: 3 },
  'U-10': { name: 'Polypropylene melt', gate: 3 },
  'U-11': { name: 'Disperse / reactive order', gate: 3 },
  'U-12': { name: 'Peroxide kills the enzyme', gate: 3 },
  'U-13': { name: 'Float snag', gate: 1 },
  'U-14': { name: 'Yarn strength vs machine speed', gate: 3 },
  'U-15': { name: 'Grinning (back yarn shows on the face)', gate: 'quality' },
  'U-16': { name: 'Plating inversion', gate: 3 },
  'U-17': { name: 'Brushing tears the cloth', gate: 3 },
  'U-18': { name: 'Cationic softener on a white', gate: 3 },
  'U-19': { name: 'Elastane heat-set window', gate: 3 },
  'U-20': { name: 'Metamerism under the shop\'s light', gate: 'quality' },
};
const RANK = { fatal: 3, warn: 2, pass: 1, na: 0, not_checked: 0 };

function densityOf(f) {
  const k = Object.prototype.hasOwnProperty.call(DENSITY_ALIAS, f) ? DENSITY_ALIAS[f] : f;
  if (k && FP[k] && FP[k].density) return FP[k].density;
  return DENSITY_FALLBACK[f] || 1.4;
}

// a feed's fibre mix (% by mass): its own, or read from its fibre label
function mixOfFeed(f) {
  if (f && f.fibre_mix && Object.keys(f.fibre_mix).length) return f.fibre_mix;
  const l = String((f && f.fibre) || '').toLowerCase();
  if (/cvc|pc blend/.test(l)) return { cotton: 60, polyester: 40 };
  for (const k of ['polyester', 'nylon', 'viscose', 'modal', 'tencel', 'bamboo', 'wool', 'silk', 'linen', 'acrylic', 'polypropylene', 'elastane', 'cotton']) if (l.includes(k)) return { [k]: 100 };
  return { cotton: 100 };
}

// the fibres of the whole cloth (% by mass): every feed's fibre mix weighted by its mass share, and the elastane
function clothFibres(out) {
  const mix = {};
  const feeds = (out.yarn && out.yarn.feeds) || [];
  feeds.forEach((f) => {
    const m = mixOfFeed(f);
    const tot = Object.values(m).reduce((t, v) => t + (+v || 0), 0) || 100;
    Object.entries(m).forEach(([k, v]) => { mix[k] = (mix[k] || 0) + ((+f.mass_share_pct || 0) * (+v || 0)) / tot; });
  });
  ((out.yarn && out.yarn.composition) || []).forEach((c) => { if (/elastane|lycra|spandex/i.test(c.part || '')) mix.elastane = (mix.elastane || 0) + (+c.pct || 0); });
  const sum = Object.values(mix).reduce((t, v) => t + v, 0);
  if (!(sum > 0)) return { cotton: 100 };
  return Object.fromEntries(Object.entries(mix).filter(([, v]) => v > 0.05).map(([k, v]) => [k, r1((v / sum) * 100)]));
}

const runs = (seq, sym) => {          // the longest cyclic run of `sym`
  let best = 0, r = 0;
  for (const x of [...seq, ...seq]) { r = x === sym ? r + 1 : 0; best = Math.max(best, r); }
  return Math.min(best, seq.length);
};
const at = (g, i, j) => (g && g[i] ? g[i][j] : '-');

/**
 * assess(out, input, extra) — out: the Studio answer (fabric-studio.js analyse, success true); input: the design as analysed;
 * extra: { thickness_mm, thickness_basis } from the hand model.
 */
function assess(out, input, extra) {
  const ex = extra || {};
  const inp = input || {};
  const rules = [];
  const rule = (id, status, text, more) => rules.push({ id, name: RULES[id].name, gate: RULES[id].gate, status, text, ...(more || {}) });
  const st = out.structure || {}, fab = out.fabric || {}, mach = out.machine || {}, yarn = out.yarn || {};
  const C = st.beds && st.beds.C, D = st.beds && st.beds.D;
  const F = C ? C.length : 0, W = C && C[0] ? C[0].length : 0;
  const roles = st.roles || [];
  const feeds = yarn.feeds || [];
  const pitchFab = fab.wpc > 0 ? 10 / fab.wpc : null;          // mm between wales in the finished cloth
  const filamentFeed = (i) => /filament|fdy|dty|poy|aty|mono/i.test(((feeds[i] || {}).yarn_type || '') + ' ' + ((feeds[i] || {}).fibre || ''));

  // ── GATE 1: cohesion ─────────────────────────────────────────────────────────────────────────────
  {
    const loose = [], uncleared = [], fixes = [];
    for (let i = 0; i < F; i++) {
      const caught = [C, D].filter(Boolean).some((g) => g[i].some((x) => x === 'K' || x === 'T' || x === 'E' || x === 'R'));
      if (!caught) { loose.push(i + 1); fixes.push({ field: `grid.C[${i}][0]`, from: at(C, i, 0), to: roles[i] === 'loop' ? 'T' : 'K', why: `catch the yarn of feed ${i + 1}` }); }
    }
    for (const [g, name, key] of [[C, 'cylinder', 'C'], [D, 'dial', 'D']]) {
      if (!g) continue;
      for (let j = 0; j < W; j++) {
        const col = g.map((r) => r[j]);
        if (col.every((x) => x === '-')) continue;          // a needle out of action
        if (!col.includes('K') && !col.includes('E') && !col.includes('R')) { uncleared.push(`${name} ${j + 1}`); fixes.push({ field: `grid.${key}[0][${j}]`, from: col[0], to: 'K', why: `${name} needle ${j + 1} must knit once in the repeat to clear its loops` }); }
      }
    }
    let twoCloths = false;
    if (C && D) {
      const tie = Array.from({ length: F }, (_, i) => i).some((i) => C[i].some((x) => x === 'K' || x === 'T' || x === 'R') && D[i].some((x) => x === 'K' || x === 'T' || x === 'R'));
      if (!tie) { twoCloths = true; fixes.push({ field: 'grid.D[0][0]', from: at(D, 0, 0), to: 'T', why: 'one feed must knit or tuck on both beds to join them' }); }
    }
    if (loose.length || uncleared.length || twoCloths) {
      const parts = [];
      if (loose.length) parts.push(`the yarn of feed${loose.length > 1 ? 's' : ''} ${loose.join(', ')} is never caught by a knit or a tuck: it lies loose and the cloth sheds it`);
      if (uncleared.length) parts.push(`needle${uncleared.length > 1 ? 's' : ''} ${uncleared.slice(0, 6).join(', ')}${uncleared.length > 6 ? ' …' : ''} never knit${uncleared.length > 1 ? '' : 's'}: the loops pile up and are never cast off`);
      if (twoCloths) parts.push('no feed works on both beds: the cylinder and the dial knit two separate cloths that fall apart');
      rule('U-01', 'fatal', parts.join('; ') + '.', { basis: 'law', repair: { text: 'Catch every yarn and clear every needle at least once in the repeat; tie the two beds with a knit or tuck on both at one feed.', changes: fixes.slice(0, 8) } });
    } else rule('U-01', 'pass', 'Every yarn is caught, every needle clears its loops' + (D ? ' and the two beds are tied together' : '') + '.', { basis: 'law' });

    // floats
    let worst = { n: 0, i: -1, bed: '', mm: 0 };
    for (const [g, name] of [[C, 'cylinder'], [D, 'dial']]) {
      if (!g) continue;
      g.forEach((row, i) => {
        if (!row.some((x) => x === 'K' || x === 'T')) return;
        const m = runs(row, 'M');
        if (m >= row.length) return;
        const mm = pitchFab ? m * pitchFab : 0;
        if (m > worst.n || (m === worst.n && mm > worst.mm)) worst = { n: m, i, bed: name, mm };
      });
    }
    if (worst.n > FLOAT_NEEDLES || worst.mm > FLOAT_MM) {
      const row = (worst.bed === 'dial' ? D : C)[worst.i];
      // the middle of the longest float: tuck there
      let start = -1, len = 0, best = { s: 0, l: 0 };
      for (let k = 0; k < 2 * row.length; k++) { const x = row[k % row.length]; if (x === 'M') { if (len === 0) start = k; len++; if (len > best.l) best = { s: start, l: len }; } else len = 0; }
      const mid = (best.s + Math.floor(best.l / 2)) % row.length;
      rule('U-13', 'warn', `Feed ${worst.i + 1} (${worst.bed}) floats over ${worst.n} needles${worst.mm ? ` ≈ ${r1(worst.mm)} mm` : ''} in the finished cloth: past ${FLOAT_NEEDLES} needles or ${FLOAT_MM} mm a float snags on fingers and jewellery.`,
        { basis: 'practice', value: { needles: worst.n, mm: r1(worst.mm) }, repair: { text: `Tie the float in: a tuck at needle ${mid + 1} of feed ${worst.i + 1} halves it.`, changes: [{ field: `grid.${worst.bed === 'dial' ? 'D' : 'C'}[${worst.i}][${mid}]`, from: 'M', to: 'T', why: 'tie-in tuck in the middle of the float' }] } });
    } else rule('U-13', 'pass', worst.n ? `Longest float ${worst.n} needle${worst.n > 1 ? 's' : ''}${worst.mm ? ` ≈ ${r1(worst.mm)} mm` : ''}: within ${FLOAT_NEEDLES} needles and ${FLOAT_MM} mm.` : 'No floats.', { basis: 'practice' });
  }

  // ── GATE 2: packing ──────────────────────────────────────────────────────────────────────────────
  const fibres = clothFibres(out);
  const rho = 1 / Object.entries(fibres).reduce((t, [k, v]) => t + v / 100 / densityOf(k), 0);
  const T = +ex.thickness_mm > 0 ? +ex.thickness_mm : null;
  const gsm = +fab.gsm || 0;
  const phi = T && gsm ? gsm / (1000 * rho * PSI * T) : null;
  const packing = phi == null ? null : {
    phi: r3(phi), fibre_fraction: r3(phi * PSI), porosity_pct: r1((1 - phi * PSI) * 100), thickness_mm: r3(T), fibre_density: r3(rho), yarn_packing: PSI,
    formula: 'Φ = GSM ÷ (1000 · ρ · ψ · T)', working: `${Math.round(gsm)} ÷ (1000 × ${r3(rho)} × ${PSI} × ${r3(T)})`,
    bands: { sleazy_below: PHI_SLEAZY, comfortable: [0.18, 0.68], jam_warn_above: PHI_JAM, impossible_above: r3(PHI_CLOSE) },
    basis: 'estimate (the thickness and the packing inside the yarn are modelled; the close-packing limit is a law)', thickness_basis: ex.thickness_basis || 'estimate',
  };
  const tfW = fab.tf_window, tf = fab.tf;
  const slNow = +fab.sl_mm || null, texG = (yarn.ground && yarn.ground.tex) || null;
  const tfRepair = (target) => (texG && target ? Math.sqrt(texG) / target * 10 : null);     // ℓ (mm) that gives the tightness factor `target`
  if (phi != null && phi > PHI_CLOSE) {
    const l = tfW ? tfRepair(tfW.q3) : null;
    rule('U-02', 'fatal', `Φ = ${r2(phi)}: the yarn would need more room than the cloth has. Round yarns side by side cannot fill more than ${r3(PHI_CLOSE)} of the space — this weight at this thickness does not fit.`, { basis: 'law', value: r3(phi),
      repair: { text: `Open the loop or use a finer yarn: ${l ? `a stitch length of about ${r2(l)} mm (the top of the factory's middle half)` : 'a longer stitch'}, or a coarser gauge.`, changes: l && slNow ? [{ field: 'sl_mm', from: slNow, to: r2(l), why: 'tightness factor back to the factory range' }] : [] } });
  } else if ((phi != null && phi > PHI_JAM) || (tfW && tf > tfW.p95)) {
    const l = tfW ? tfRepair(tfW.q3) : null;
    rule('U-02', 'warn', [phi != null && phi > PHI_JAM ? `Φ = ${r2(phi)}, above ${PHI_JAM}: a very packed cloth (estimate)` : null, tfW && tf > tfW.p95 ? `tightness factor ${tf} is above what the factory finishes this family at (${tfW.p5}–${tfW.p95}, measured)` : null].filter(Boolean).join('; ') + ': expect yarn breaks, needle wear and a boardy hand.',
      { basis: tfW && tf > tfW.p95 ? 'measured' : 'estimate', value: phi != null ? r3(phi) : null, repair: { text: l ? `Lengthen the stitch to about ${r2(l)} mm, use a finer count or a coarser gauge.` : 'Lengthen the stitch, use a finer count or a coarser gauge.', changes: l && slNow ? [{ field: 'sl_mm', from: slNow, to: r2(l), why: 'tightness factor to the top of the factory middle half' }] : [] } });
  } else rule('U-02', 'pass', phi != null ? `Φ = ${r2(phi)}: the yarn fits the cloth.` : 'The yarn fits the cloth (tightness inside the factory range).', { basis: tfW ? 'measured' : 'estimate', value: phi != null ? r3(phi) : null });

  if ((phi != null && phi < PHI_SLEAZY) || (tfW && tf < tfW.p5)) {
    const l = tfW ? tfRepair(tfW.q1) : null;
    rule('U-03', 'warn', [phi != null && phi < PHI_SLEAZY ? `Φ = ${r2(phi)}, below ${PHI_SLEAZY}: a loose, open cloth (estimate)` : null, tfW && tf < tfW.p5 ? `tightness factor ${tf} is below the factory range for this family (${tfW.p5}–${tfW.p95}, measured)` : null].filter(Boolean).join('; ') + ': expect high shrinkage, spirality, seam slippage and a sleazy hand.',
      { basis: tfW && tf < tfW.p5 ? 'measured' : 'estimate', value: phi != null ? r3(phi) : null, repair: { text: l ? `Shorten the stitch to about ${r2(l)} mm, or use a coarser count.` : 'Shorten the stitch or use a coarser count.', changes: l && slNow ? [{ field: 'sl_mm', from: slNow, to: r2(l), why: 'tightness factor to the bottom of the factory middle half' }] : [] } });
  } else rule('U-03', 'pass', 'Not loose: the cloth is inside the stable range.', { basis: tfW ? 'measured' : 'estimate' });

  // ── GATE 3: machine ──────────────────────────────────────────────────────────────────────────────
  const checks = out.checks || [];
  const findCheck = (re, levels) => checks.filter((c) => re.test(c.text) && (!levels || levels.includes(c.level)));
  {
    const GG = +mach.gauge || 0;
    const env = GG ? ENVELOPE / (GG * GG) : null;
    const knitTex = feeds.map((f, i) => ({ i, tex: +f.tex || 0, knits: [C, D].filter(Boolean).some((g) => g[i] && g[i].includes('K')) })).filter((x) => x.knits);
    const maxKnit = knitTex.reduce((m, x) => (x.tex > m.tex ? x : m), { tex: 0, i: -1 });
    const gf = mach.gauge_fit || {};
    const hook = findCheck(/hook load/i, ['warn']);
    const over = env && maxKnit.tex > env;
    const tooFine = gf.fit === 'too fine';
    const recG = mach.gauge_recommended;
    const repair = { text: `Use a coarser gauge${recG && recG !== GG ? ` (${recG} GG is what this count is knitted on)` : ''} or a finer knitting yarn${env ? ` (at ${GG} GG, no more than about ${r1(env)} tex ≈ ${r1(590.5 / env)}s Ne)` : ''}.`, changes: recG && recG !== GG ? [{ field: 'machine.gauge', from: GG, to: recG, why: 'the gauge the factory knits this count on' }] : [] };
    if (over && tooFine) rule('U-04', 'fatal', `The knitting yarn of feed ${maxKnit.i + 1} (${r1(maxKnit.tex)} tex) is too thick for a ${GG} GG hook: past the ${r1(env)} tex envelope and outside the pitch-to-yarn band the factory knits.`, { basis: 'measured', value: { tex: r1(maxKnit.tex), envelope_tex: r1(env) }, repair });
    else if (over || tooFine || hook.length) rule('U-04', 'warn', [over ? `the knitting yarn (${r1(maxKnit.tex)} tex) is past the general ${r1(env)} tex envelope for ${GG} GG (estimate)` : null, tooFine ? `the needle pitch is tight for this yarn (gauge fit: too fine, measured)` : null, hook.length ? hook[0].text : null].filter(Boolean).join('; ') + '.', { basis: tooFine ? 'measured' : 'estimate', value: env ? { tex: r1(maxKnit.tex), envelope_tex: r1(env) } : null, repair });
    else rule('U-04', 'pass', env ? `Knitting yarn ${r1(maxKnit.tex)} tex against a ${r1(env)} tex envelope at ${GG} GG; the needle pitch suits the yarn.` : 'The needle pitch suits the yarn.', { basis: 'measured' });
  }
  {
    const crash = findCheck(/cannot rise at the same feed/i, ['error']);
    if (crash.length) rule('U-05', 'fatal', crash[0].text + (crash.length > 1 ? ` (${crash.length} places)` : ''), { basis: 'machine logic', repair: { text: 'On interlock gating a cylinder needle and the dial needle facing it cannot both knit or tuck at one feed: move one to the next feed, or use rib gating.', changes: [] } });
    else rule('U-05', D && st.gating === 'interlock' ? 'pass' : 'na', D && st.gating === 'interlock' ? 'No cylinder and dial needle rise together on interlock gating.' : 'Not interlock gating.', { basis: 'machine logic' });
  }
  {
    let worst = { n: 0, j: -1, bed: '', fil: false, f: -1 };
    for (const [g, name] of [[C, 'cylinder'], [D, 'dial']]) {
      if (!g) continue;
      for (let j = 0; j < W; j++) {
        const col = g.map((r) => r[j]);
        if (col.every((x) => x === 'T')) continue;               // all-tuck column: U-01
        let r = 0;
        for (let k = 0; k < 2 * F; k++) {
          const i = k % F;
          r = col[i] === 'T' ? r + 1 : 0;
          if (r > worst.n) worst = { n: Math.min(r, F), j, bed: name, fil: filamentFeed(i), f: i };
        }
      }
    }
    const lim = worst.fil ? TUCK.filament : TUCK.spun;
    if (worst.n > lim.fatal) rule('U-06', 'fatal', `${worst.bed} needle ${worst.j + 1} tucks ${worst.n} times running: ${worst.n + 1} loops in one hook — the latch bends and the loops press off.`, { basis: 'practice', value: worst.n, repair: { text: `Break the run: knit needle ${worst.j + 1} at feed ${worst.f + 1}.`, changes: [{ field: `grid.${worst.bed === 'dial' ? 'D' : 'C'}[${worst.f}][${worst.j}]`, from: 'T', to: 'K', why: 'clear the hook' }] } });
    else if (worst.n > lim.warn) rule('U-06', 'warn', `${worst.bed} needle ${worst.j + 1} tucks ${worst.n} times running (${worst.fil ? 'filament' : 'spun'} yarn): past about ${lim.warn} the hook overloads.`, { basis: 'practice', value: worst.n, repair: { text: `Knit needle ${worst.j + 1} at feed ${worst.f + 1}, or use a finer yarn and low tension.`, changes: [{ field: `grid.${worst.bed === 'dial' ? 'D' : 'C'}[${worst.f}][${worst.j}]`, from: 'T', to: 'K', why: 'clear the hook' }] } });
    else rule('U-06', worst.n ? 'pass' : 'na', worst.n ? `At most ${worst.n} tuck${worst.n > 1 ? 's' : ''} running on one needle.` : 'No tucks.', { basis: 'practice' });
  }
  {
    const fancy = out.fancy || null;
    const slubWarn = [...findCheck(/slub|hook or sinker|fancy/i, ['warn', 'error']), ...Object.values(fancy || {}).flatMap((r) => ((r && r.warnings) || []).filter((w) => /hook|needle|gauge|sinker/i.test(w.text || '')))];
    if (!fancy) rule('U-07', 'na', 'No slub or fancy yarn.', { basis: 'machine logic' });
    else if (slubWarn.length) rule('U-07', 'warn', slubWarn[0].text, { basis: 'estimate', repair: { text: 'A thinner effect (lower slub multiplier) or a coarser gauge.', changes: [] } });
    else rule('U-07', 'pass', 'The fancy yarn\'s thick places clear the hook at this gauge.', { basis: 'estimate' });
  }
  rule('U-08', 'na', 'Woven: not a knitted design.', { basis: 'law' });
  {
    const sp = (out.machine_setup && out.machine_setup.speed) || null;
    const csp = +((inp.yarn || {}).csp) || null;
    const dia = +mach.dia || 0, rpm = +mach.rpm || 0;
    const cap = csp && dia ? Math.min(35, (csp / 85) * (30 / dia)) : null;
    const tooFast = sp && sp.max_m_s && sp.surface_m_s > sp.max_m_s;
    if ((cap && rpm > cap) || tooFast) rule('U-14', 'warn', [cap && rpm > cap ? `${rpm} RPM is above the ${r1(cap)} RPM a ${csp} CSP yarn stands on a ${dia}" machine (general rule, estimate)` : null, tooFast ? `the surface speed ${sp.surface_m_s} m/s is past the ${sp.max_m_s} m/s of this class of machine` : null].filter(Boolean).join('; ') + ': expect yarn breaks and stop marks.', { basis: 'estimate', repair: { text: `Run at ${cap ? Math.floor(cap) : Math.floor(rpm * sp.max_m_s / sp.surface_m_s)} RPM or below.`, changes: [{ field: 'machine.rpm', from: rpm, to: cap ? Math.floor(cap) : Math.floor(rpm * sp.max_m_s / sp.surface_m_s), why: 'speed the yarn stands' }] } });
    else rule('U-14', csp || sp ? 'pass' : 'not_checked', csp ? `${rpm} RPM is within what a ${csp} CSP yarn stands on a ${dia}" machine.` : sp ? `Surface speed ${sp.surface_m_s} m/s is within this class of machine. Give the yarn's CSP (lea strength) to check it against the yarn too.` : 'Give the RPM and the yarn\'s CSP.', { basis: 'estimate' });
  }
  {
    const plated = feeds.filter((f) => f.plated);
    const ratio = +((inp.plating || {}).tension_ratio) || null;
    if (!plated.length && !feeds.some((f) => f.role === 'plate')) rule('U-16', 'na', 'No plated feed.', { basis: 'estimate' });
    else if (ratio && (ratio < 1.15 || ratio > 1.65)) rule('U-16', 'warn', `Back-to-face tension ratio ${ratio}: outside 1.15–1.65 the back yarn can roll to the face (plating inversion, estimate).`, { basis: 'estimate', repair: { text: 'Set the back yarn\'s feeder tension 1.15–1.65 × the face yarn\'s, and check the sinker depth.', changes: [{ field: 'plating.tension_ratio', from: ratio, to: 1.4, why: 'middle of the window' }] } });
    else rule('U-16', ratio ? 'pass' : 'not_checked', ratio ? `Back-to-face tension ratio ${ratio}: inside 1.15–1.65.` : 'Plated: give the back-to-face feeder tension ratio to check plating inversion (keep it 1.15–1.65).', { basis: 'estimate' });
  }

  // ── GATE 3: chemistry — the route the whole cloth goes through (every yarn together) ─────────────────
  const shade = (inp.chemistry && inp.chemistry.shade) || (inp.look && inp.look.shade) || 'medium';
  let route = null, safeRoute = null, routeErr = null;
  const proc = CHEMY.cleanProcess(inp.chemistry && inp.chemistry.process);          // what the technologist forced against the compiler's advice
  try {
    const groundTex = (yarn.ground && yarn.ground.tex) || 20;
    const base = { shade: CHEMY.DEPTHS.includes(shade) ? shade : 'medium', mercerise: !!(inp.chemistry && inp.chemistry.mercerise), heatset: inp.chemistry && inp.chemistry.heatset };
    const prof = CHEMY.profileOf(fibres, groundTex, { ...base, process: proc });
    route = prof ? prof.route.steps : null;
    if (Object.keys(proc).length) { const sp = CHEMY.profileOf(fibres, groundTex, base); safeRoute = sp ? sp.route.steps : null; }
  } catch (e) { routeErr = e.message; }
  const has = (k) => (fibres[k] || 0) > 0;
  const protein = has('wool') || has('silk');
  const pp = has('polypropylene') || has('pp');
  const steps = route || [];
  const idx = (id) => steps.findIndex((s) => s.id === id);
  const caustic = steps.filter((s) => (s.chemicals || []).some((c) => /caustic/i.test(c.name)));
  if (!protein) rule('U-09', 'na', 'No wool or silk in the cloth.', { basis: 'chemistry' });
  else if (caustic.length) rule('U-09', 'fatal', `Wool or silk is in the cloth and the route uses caustic soda (${caustic.map((s) => s.label).join(', ')}): alkali dissolves protein fibres.`, { basis: 'chemistry', repair: { text: 'A mild non-ionic scour (pH ≤ 9, no caustic) and an acid clearing instead of caustic reduction clearing.', changes: [] } });
  else if (steps.some((x) => +x.t_c > 110 && x.id !== 'heatset')) { const h = steps.filter((x) => +x.t_c > 110 && x.id !== 'heatset'); rule('U-09', 'warn', `Wool or silk is in the cloth and ${h.map((x) => x.label + ' ' + x.t_c + ' °C').join(', ')} is hotter than about 105–110 °C: wool felts and yellows, silk loses strength.`, { basis: 'chemistry', repair: { text: 'Hold the disperse bath at 105 °C with a wool protector (or use a carrier), and heat-set at 170 °C.', changes: [] } }); }
  else rule('U-09', 'pass', 'Wool or silk is in the cloth: the route uses no caustic soda (mild non-ionic scour, acid clearing) and no bath hotter than 110 °C.', { basis: 'chemistry' });
  const hot = steps.filter((s) => +s.t_c > 125);
  if (!pp) rule('U-10', 'na', 'No polypropylene in the cloth.', { basis: 'chemistry' });
  else if (hot.length) rule('U-10', 'fatal', `Polypropylene softens from about 140 °C and melts at 165 °C: the route reaches ${Math.max(...hot.map((s) => s.t_c))} °C (${hot.map((s) => s.label).join(', ')}).`, { basis: 'chemistry', repair: { text: 'Dope-dyed polypropylene only: wash and dry at 115 °C or below, no disperse dyeing and no heat-setting.', changes: [] } });
  else rule('U-10', 'pass', 'Polypropylene: the route stays at or below 115 °C.', { basis: 'chemistry' });
  {
    const dR = idx('dye_reactive'), dD = idx('dye_disperse');
    if (dR < 0 || dD < 0) rule('U-11', 'na', 'Not a polyester / cellulose dyeing.', { basis: 'chemistry' });
    else if (dR < dD && !(steps[dD] && steps[dD].classes)) rule('U-11', 'fatal', 'The reactive dyeing comes before the 130 °C disperse dyeing: the hot bath strips the reactive shade.', { basis: 'chemistry', repair: { text: 'Disperse (polyester) first, reduction clearing, then reactive (cotton).', changes: [] } });
    else rule('U-11', 'pass', 'Disperse dyeing comes before the reactive dyeing.', { basis: 'chemistry' });
  }
  {
    const b = idx('bleach'), k = idx('killer'), e = idx('biopolish');
    const dyeAfter = steps.findIndex((s, i) => i > b && /^dye_reactive$/.test(s.id));
    if (b < 0) rule('U-12', 'na', 'No peroxide bleaching.', { basis: 'chemistry' });
    else if ((e > b || dyeAfter > b) && !(k > b && (e < 0 || k < e) && (dyeAfter < 0 || k < dyeAfter))) rule('U-12', 'fatal', 'Peroxide bleaching is followed by the enzyme or the reactive dye with no peroxide killer between: the residual peroxide kills the cellulase and oxidises the dye.', { basis: 'chemistry', repair: { text: 'A peroxide-killer (catalase) bath straight after the bleach.', changes: [] } });
    else rule('U-12', 'pass', 'A peroxide killer follows the bleach.', { basis: 'chemistry' });
  }
  {
    const brush = inp.finish && inp.finish.brush && inp.finish.brush !== 'none' ? inp.finish.brush : null;
    const loopFeed = feeds.find((f) => f.role === 'loop');
    const sl = loopFeed ? +loopFeed.sl_mm : +fab.sl_mm;
    if (!brush) rule('U-17', 'na', 'Not brushed.', { basis: 'estimate' });
    else if (sl < 1.35) rule('U-17', 'warn', `Brushed with a ${loopFeed ? 'loop-yarn' : ''} stitch of ${r2(sl)} mm: under about 1.35 mm the raising wire catches the ground and tears it (estimate).`, { basis: 'estimate', repair: { text: 'Give the brushed yarn at least about 1.65 mm.', changes: [{ field: loopFeed ? `feeds[${loopFeed.feed - 1}].sl_mm` : 'sl_mm', from: r2(sl), to: 1.65, why: 'room for the raising wire' }] } });
    else rule('U-17', 'pass', `Brushed: the ${loopFeed ? 'loop yarn' : 'stitch'} (${r2(sl)} mm) gives the raising wire room.`, { basis: 'estimate' });
  }
  {
    const oba = idx('oba') > -1;
    const soft = steps.find((s) => s.id === 'soften');
    const cationic = soft && (soft.chemicals || []).some((c) => /cationic/i.test(c.name) && !/no cationic/i.test(c.name));
    if (!oba) rule('U-18', 'na', 'Not an optical white.', { basis: 'chemistry' });
    else if (cationic) rule('U-18', 'warn', 'An optical white with a cationic softener: it yellows the white (b* rises).', { basis: 'chemistry', repair: { text: 'A silicone or non-ionic softener.', changes: [] } });
    else rule('U-18', 'pass', 'Optical white: softened with silicone or a non-ionic softener.', { basis: 'chemistry' });
  }
  {
    const hs = steps.filter((s) => s.id === 'heatset');
    const tIn = +((inp.finish || {}).heatset_c) || null;
    const temps = tIn ? [tIn] : hs.map((s) => +s.t_c);
    if (!has('elastane')) rule('U-19', 'na', 'No elastane.', { basis: 'estimate' });
    else if (!temps.length) rule('U-19', 'warn', 'Elastane with no heat-setting: the width and the shape are not fixed and the cloth curls.', { basis: 'estimate', repair: { text: 'Heat-set at 185–195 °C.', changes: [] } });
    else {
      const bad = temps.filter((t) => t > 202 || t < 180);
      if (bad.length) rule('U-19', 'warn', `Heat-setting the elastane at ${bad[0]} °C: above about 202 °C it yellows and loses recovery, under about 180 °C it is not set and curls.`, { basis: 'estimate', repair: { text: 'Heat-set at 185–195 °C.', changes: [{ field: 'finish.heatset_c', from: bad[0], to: 190, why: 'middle of the window' }] } });
      else rule('U-19', 'pass', `Elastane heat-set at ${temps.join(' / ')} °C: inside 180–202 °C.`, { basis: 'estimate' });
    }
  }

  // a failure that comes from something the technologist FORCED is repaired by clearing it: the compiled route avoids it
  {
    const FIX = { 'U-09': ['scour_caustic', 'disperse_c'], 'U-10': ['disperse_c', 'heatset_c'], 'U-11': ['reactive_first'], 'U-12': ['skip_killer'], 'U-18': ['softener'], 'U-19': ['heatset_c'] };
    const NAME = { scour_caustic: 'caustic scour', disperse_c: 'the disperse temperature', heatset_c: 'the heat-set temperature', skip_killer: 'skipping the peroxide killer', softener: 'the softener', reactive_first: 'reactive before disperse' };
    rules.forEach((r) => {
      const keys = (FIX[r.id] || []).filter((k) => proc[k] != null);
      if ((r.status === 'fatal' || r.status === 'warn') && keys.length) r.repair = { text: `Clear what was forced (${keys.map((k) => NAME[k]).join(', ')}): the compiled route avoids it.`, forced: true, changes: keys.map((k) => ({ field: 'chemistry.process.' + k, from: proc[k], to: null, why: 'back to the compiled, safe route' })) };
    });
  }

  // ── QUALITY: grinning, metamerism ────────────────────────────────────────────────────────────────
  {
    const grin = findCheck(/grin/i, ['warn', 'note', 'error']);
    const multi = new Set(feeds.map((f) => f.role)).size > 1 || feeds.some((f) => f.plated);
    if (!multi) rule('U-15', 'na', 'One yarn: nothing behind the face to show through.', { basis: 'estimate' });
    else if (grin.length) rule('U-15', 'warn', grin[0].text, { basis: 'estimate', repair: { text: 'Dye or choose the back yarn near the face colour (a melange or a matched shade), or close the cloth.', changes: [] } });
    else rule('U-15', 'pass', 'No back yarn is expected to show through the face.', { basis: 'estimate' });
  }
  rule('U-20', 'not_checked', 'Metamerism under the shop\'s lights (D65 against TL84 and CWF) needs the lightbox: not yet in the Studio. A melange design is checked D65 against A in its own card.', { basis: 'estimate' });

  // ── the gates ────────────────────────────────────────────────────────────────────────────────────
  // the Studio's own errors that no rule above covers still stop the design: they go to the gate they belong to
  const covered = /cannot rise at the same feed|knits on no needle|never knits/i;
  const others = checks.filter((c) => c.level === 'error' && !covered.test(c.text)).map((c) => ({ gate: /repeat|settle|cast off|transferred loop|R hands|after a transfer/i.test(c.text) ? 1 : 3, status: 'fatal', text: c.text }));
  const gateOf = (g) => {
    const rs = rules.filter((r) => r.gate === g), os = others.filter((o) => o.gate === g);
    const worst = [...rs.map((r) => r.status), ...os.map((o) => o.status)].reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'pass');
    return { status: worst === 'na' || worst === 'not_checked' ? 'pass' : worst, rules: rs.map((r) => r.id), other: os.map((o) => o.text) };
  };
  const gates = {
    gate1: { name: 'Cohesion', ...gateOf(1) },
    gate2: { name: 'Packing', ...gateOf(2) },
    gate3: { name: 'Machine and chemistry', ...gateOf(3) },
    quality: { name: 'Face and light', ...gateOf('quality') },
  };
  const verdict = [gates.gate1, gates.gate2, gates.gate3].reduce((w, g) => (RANK[g.status] > RANK[w] ? g.status : w), 'pass');
  const repair = rules.filter((r) => (r.status === 'fatal' || r.status === 'warn') && r.repair).sort((a, b) => RANK[b.status] - RANK[a.status]).map((r) => ({ rule: r.id, status: r.status, text: r.repair.text, changes: r.repair.changes || [] }));
  return {
    verdict,
    export_locked: verdict === 'fatal',
    gates,
    rules,
    packing,
    fibres,
    route: steps.map((s) => ({ id: s.id, label: s.label, t_c: s.t_c, ph: s.ph, chemicals: (s.chemicals || []).map((c) => c.name), requested: !!s.requested })),
    process_forced: proc,
    safe_route: safeRoute ? safeRoute.map((s) => ({ id: s.id, label: s.label, t_c: s.t_c })) : null,
    route_error: routeErr,
    repair,
    counts: { fatal: rules.filter((r) => r.status === 'fatal').length + others.length, warn: rules.filter((r) => r.status === 'warn').length, pass: rules.filter((r) => r.status === 'pass').length, not_applicable: rules.filter((r) => r.status === 'na').length, not_checked: rules.filter((r) => r.status === 'not_checked').length },
    note: 'Three gates: the cloth holds together, the yarn fits, a machine knits it and every fibre survives the wet route of the whole cloth. A FATAL locks the factory files until it is fixed. Laws and the machine\'s logic are FATAL; limits from general practice stay warnings until a mill confirms them.',
  };
}

function catalogue() {
  return { rules: Object.entries(RULES).map(([id, r]) => ({ id, ...r })), statuses: ['pass', 'warn', 'fatal', 'na', 'not_checked'], phi: { yarn_packing: PSI, close_packing: r3(PHI_CLOSE), sleazy_below: PHI_SLEAZY, jam_warn_above: PHI_JAM } };
}

// the wet-process chemistry of the whole cloth from the Studio's solved feeds (before the answer is assembled): fibres, the compiled route
// (with anything forced), and the chemical names of every bath — what process-effects.js reads
function clothChemistry(S, input) {
  const src = { yarn: { feeds: S.feeds || [], composition: S.composition || [] } };
  const fibres = clothFibres(src);
  const inp = input || {};
  const ch = inp.chemistry || {};
  const shade = ch.shade || (inp.look && inp.look.shade) || 'medium';
  const prof = CHEMY.profileOf(fibres, (S.ground && S.ground.tex) || 20, { shade: CHEMY.DEPTHS.includes(shade) ? shade : 'medium', mercerise: !!ch.mercerise, heatset: ch.heatset, process: ch.process });
  return prof ? { fibres, shade, steps: prof.route.steps, bath_chemicals: ((prof.recipe && prof.recipe.chemicals) || []).map((c) => c.name) } : null;
}

module.exports = { clothChemistry, assess, catalogue, clothFibres, mixOfFeed, RULES };
