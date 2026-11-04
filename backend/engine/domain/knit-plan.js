/**
 * KnitAdvisor — Knitting plan
 * ===========================
 *
 * ONE answer for the knitting floor, where there used to be several that
 * disagreed: gauge, diameter, needles, feeders, stitch length, the width and
 * density that come off the machine, the output per hour — and the structure
 * itself (notation, needle set-out, cam chart) checked rule by rule.
 *
 * Every number is tied to either a formula or the factory's own records, and
 * says which:
 *
 *   WIDTH      finished open width = needles × ℓ ÷ Kw.   Kw (wales/cm × ℓ cm)
 *              is fitted per family on the factory R&D file (2,201 greige →
 *              finish rows): single jersey 3.81 (IQR 3.70–3.93), with lycra
 *              4.41, rib 2.94, interlock 4.26, piqué 2.92, fleece 5.06 …
 *              The old model divided the needle count by gauge × 1.13 and
 *              came out ~30% wide.
 *   GSM ↔ SL   GSM = Ks × tex ÷ (10 × ℓ cm), Ks = Kc × Kw, fitted on the same
 *              rows (single jersey 19.7 — Munden's dry-relaxed figure is ~19–21).
 *   GAUGE      what the factory knits this family at this count (the records),
 *              checked against the cover-factor gauge √(K ÷ tex).
 *   FEEDERS    feeders per inch of diameter for the machine type, rounded to a
 *              whole number of pattern repeats.
 *   OUTPUT     yarn delivered per revolution, feed by feed from the notation:
 *              a knit takes a full loop, a tuck ~0.7 of one, a miss a float of
 *              about one needle pitch — so a piqué or a fleece is not costed as
 *              if every feeder knitted every needle.
 */
'use strict';

const { FACTORY_RECORDS, FAB_ALIAS } = require('../catalog/factory-dataset');

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── 1. CALIBRATION FROM THE FACTORY RECORDS (computed once at load) ────────
const isLycraSpin = (s) => /lycra/.test(String(s || ''));
const quant = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; };

const CAL = (() => {
  const kw = {}, ks = {}, gauges = {}, dias = {}, ratio = {};
  for (const r of FACTORY_RECORDS) {
    const key = `${r.fab}|${isLycraSpin(r.spin) ? 'L' : 'P'}`;
    if (r.g > 0 && r.dia > 0 && r.sl > 0 && r.fdia > 0) {
      let k = Math.PI * r.dia * r.g * (r.sl / 10) / (r.fdia * 2.54);
      // The rib rows fall in two clusters: finished width ≈ 2.0 × dia (1x1, every
      // needle working) and ≈ 1.3 × dia — two-thirds of it, which is a 2x2 rib
      // knitted 2-in-1-out on a 1x1-gated machine. Put both on the 1x1 basis;
      // the plan scales back by the set-out's working needles.
      if (r.fab === 'rib' && r.fdia / r.dia < 1.6) k *= 2 / 3;
      (kw[key] = kw[key] || []).push(k);
    }
    if (r.sl > 0 && r.ne > 0 && r.fgsm > 0) (ks[key] = ks[key] || []).push(10 * r.fgsm * (r.sl / 10) / (590.5 / r.ne));
    if (r.g > 0 && r.ne > 0) (gauges[key] = gauges[key] || []).push({ ne: r.ne, g: r.g });
    if (r.dia > 0) (dias[key] = dias[key] || []).push(r.dia);
    if (r.g > 0 && r.ne > 0) (ratio[r.fab] = ratio[r.fab] || []).push((25.4 / r.g) / (Math.sqrt(590.5 / r.ne) / 28));
  }
  const summ = (o) => Object.fromEntries(Object.entries(o).map(([k, a]) => [k, { med: quant(a, 0.5), q1: quant(a, 0.25), q3: quant(a, 0.75), n: a.length }]));
  const mode = (a) => { const c = {}; a.forEach((x) => { c[x] = (c[x] || 0) + 1; }); return +Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; };
  const band = Object.fromEntries(Object.entries(ratio).map(([k, a]) => [k, { lo: quant(a, 0.05), hi: quant(a, 0.95), n: a.length }]));
  return { kw: summ(kw), ks: summ(ks), gauges, band, diaMode: Object.fromEntries(Object.entries(dias).map(([k, a]) => [k, mode(a)])) };
})();

// fallbacks where the records are thin (book values)
const BOOK = {
  kw: { single_jersey: 3.8, rib: 3.0, interlock: 4.2, pique: 2.9, fleece: 5.1, terry: 4.8, waffle: 3.2, heavy_jersey: 4.0 },
  ks: { single_jersey: 19.7, rib: 28, interlock: 36.7, pique: 21.8, fleece: 65.5, terry: 67, waffle: 29, heavy_jersey: 41 },
};

function calFor(table, family, lycra) {
  const k = `${family}|${lycra ? 'L' : 'P'}`, kp = `${family}|P`;
  const c = CAL[table][k] && CAL[table][k].n >= 12 ? CAL[table][k] : CAL[table][kp] && CAL[table][kp].n >= 12 ? CAL[table][kp] : null;
  if (c) return { ...c, basis: `${c.n} factory records (${family}${c === CAL[table][k] && lycra ? ', lycra' : ''})` };
  const v = BOOK[table][family] || BOOK[table].single_jersey;
  return { med: v, q1: v * 0.96, q3: v * 1.04, n: 0, basis: 'book value (too few factory records)' };
}

// ── 2. MACHINE TYPES ────────────────────────────────────────────────────────
// feeders per inch of diameter (modern machines) and the speed factor
// (rpm × dia, inches) they run at
const MACHINE = {
  // feeders per inch: fpi is the usual figure; fpiRange spans what is built (up to 4.8 on single jersey and rib)
  single:   { label: 'Single jersey', fpi: 3.0, fpiRange: [2.8, 4.8], sf: 900, gauges: [14, 16, 18, 20, 22, 24, 28, 32, 36] },
  pique:    { label: 'Single jersey, 4-track (piqué / lacoste)', fpi: 3.0, fpiRange: [2.8, 4.8], sf: 850, gauges: [18, 20, 22, 24, 28] },
  fleece:   { label: 'Fleece (3-thread)', fpi: 3.0, fpiRange: [2.4, 3.0], sf: 800, gauges: [12, 14, 16, 18, 20, 22, 24, 28] },
  terry:    { label: 'Plush / terry (sinker loop)', fpi: 2.0, fpiRange: [1.6, 2.0], sf: 650, gauges: [12, 14, 16, 18, 20, 22, 24, 28] },
  rib:      { label: 'Rib (cylinder + dial, rib gating)', fpi: 2.0, fpiRange: [1.6, 4.8], sf: 750, gauges: [10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40] },
  interlock:{ label: 'Interlock (cylinder + dial, interlock gating)', fpi: 2.0, fpiRange: [1.6, 4.8], sf: 750, gauges: [14, 16, 18, 20, 22, 24, 28, 32] },
};
const STANDARD_DIA = [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44];

function machineType(fabricDef, family) {
  const id = fabricDef.id || '';
  if (family === 'fleece' || /fleece|french_terry/.test(id)) return 'fleece';
  if (/terry_fabric|velour|plush/.test(id)) return 'terry';
  if (fabricDef.category === 'rib') return 'rib';
  if (fabricDef.category === 'interlock') return 'interlock';
  if (family === 'pique' || /pique|lacoste|blister|honeycomb|popcorn|twill|crepe|cross_tuck|birds_eye|lockknit/.test(id)) return 'pique';
  return 'single';
}

// ── 3. STRUCTURE: notation, needle set-out, cam chart, checks ──────────────
const SYM = { K: 'Knit', T: 'Tuck', M: 'Miss', '-': 'No needle' };

function normaliseStructure(fabricDef, pattern) {
  const s = pattern && (pattern.pattern_cylinder || pattern.pattern_dial)
    ? { pattern: { C: pattern.pattern_cylinder || null, D: pattern.pattern_dial || null }, cam: pattern.cam_arrangement }
    : (fabricDef.structure || {});
  const P = s.pattern;
  if (!P) return null;
  const raw = Array.isArray(P) ? { C: P, D: null } : { C: P.C || null, D: P.D || null };
  const width = Math.max(...[raw.C, raw.D].filter(Boolean).flatMap((g) => g.map((r) => r.length)));
  const fix = (g) => g ? g.map((row) => Array.from({ length: width }, (_, j) => String(row[j % row.length] || 'M').toUpperCase().slice(0, 1))) : null;
  const beds = { C: fix(raw.C), D: fix(raw.D) };
  const feeds = (beds.C || beds.D).length;
  // a needle that does nothing at any feed is not a "miss" — it is out of
  // action (removed or dropped). Mark it so: "-" in the notation.
  for (const g of [beds.C, beds.D].filter(Boolean)) {
    for (let j = 0; j < width; j++) if (g.every((row) => row[j] === 'M' || row[j] === '-')) g.forEach((row) => { row[j] = '-'; });
  }
  // the yarn on each feed, where the catalogue names it
  const camRows = Array.isArray(s.cam) ? s.cam : [];
  const yarn = Array.from({ length: feeds }, (_, i) => {
    const c = camRows.find((x) => +x.feed === i + 1);
    return c && c.yarn ? String(c.yarn) : null;
  });
  return { beds, feeds, width, yarn, gating: beds.D ? (fabricDef.category === 'interlock' ? 'interlock' : 'rib') : 'single' };
}

function tracksOf(g) {
  if (!g) return null;
  const seqs = [], tracks = [];
  for (let j = 0; j < g[0].length; j++) {
    const seq = g.map((row) => row[j]).join('');
    if (/^-+$/.test(seq)) { tracks.push('-'); continue; }
    let t = seqs.indexOf(seq);
    if (t < 0) { seqs.push(seq); t = seqs.length - 1; }
    tracks.push(String.fromCharCode(65 + t));
  }
  return { setout: tracks, sequences: seqs.map((q, i) => ({ track: String.fromCharCode(65 + i), sequence: q })) };
}

function camChart(st, T) {
  return Array.from({ length: st.feeds }, (_, i) => {
    const row = { feed: i + 1, yarn: st.yarn[i] };
    for (const b of ['C', 'D']) {
      if (!T[b]) continue;
      row[b] = Object.fromEntries(T[b].sequences.map((s) => [s.track, s.sequence[i]]));
    }
    return row;
  });
}

function structureChecks(st, T, machine) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const beds = [['C', 'cylinder'], ['D', 'dial']].filter(([b]) => st.beds[b]);
  // every feed must knit somewhere, or nothing pulls the cloth down
  for (let i = 0; i < st.feeds; i++) {
    const all = beds.flatMap(([b]) => st.beds[b][i]);
    const inlay = st.yarn[i] && /fleece|loop|pile|inlay/i.test(st.yarn[i]);
    if (!all.includes('K') && !inlay) add('error', `Feed ${i + 1} knits on no needle — every loop is held, nothing is cast off.`);
  }
  for (const [b, name] of beds) {
    const g = st.beds[b];
    for (let j = 0; j < st.width; j++) {
      const col = g.map((r) => r[j]);
      if (col.every((x) => x === '-')) continue;
      if (!col.includes('K')) add('error', `${name} needle ${j + 1} never knits in the repeat — its loops are never cleared.`);
      const run = (sym) => { let r = 0, m = 0; for (const x of [...col, ...col]) { r = x === sym ? r + 1 : 0; m = Math.max(m, r); } return m >= 2 * col.length ? col.length : m; };
      const t = run('T'), m = run('M');
      if (t > 4) add('warn', `${name} needle ${j + 1} tucks ${t} times running: ${t + 1} loops in one hook — needs fine yarn, low tension, and risks hook damage and press-off.`);
      else if (t === 4) add('note', `${name} needle ${j + 1} holds 4 tucks — the practical limit; keep the yarn fine and the take-down even.`);
      else if (t === 3) add('note', `${name} needle ${j + 1} holds 3 tucks (4 loops in one hook): flat-bed practice caps a needle at 3 loops, so use a fine yarn and a loose take-down.`);
      if (m > 4) add('warn', `${name} needle ${j + 1} misses ${m} feeds running — its held loop is stretched over ${m} courses.`);
    }
    // horizontal floats: consecutive missing needles in one feed
    for (let i = 0; i < st.feeds; i++) {
      const row = g[i];
      if (!row.includes('K') && !row.includes('T')) continue;
      let r = 0, m = 0;
      for (const x of [...row, ...row]) { r = x === 'M' ? r + 1 : 0; m = Math.max(m, r); }
      if (m >= 5 && m < row.length) add('warn', `Feed ${i + 1}, ${name}: a float across ${m} needles — snags; keep floats to 4 or fewer.`);
    }
  }
  const nTracks = Math.max(...beds.map(([b]) => (T[b] ? T[b].sequences.length : 0)));
  if (nTracks > 4) add('warn', `${nTracks} needle tracks: more than the 4 cam tracks of a standard machine — needs a jacquard / electronic selection machine.`);
  else add('ok', `${nTracks} needle track${nTracks > 1 ? 's' : ''} — fits a standard ${machine.label.toLowerCase()} machine.`);
  if (!out.some((c) => c.level === 'error')) add('ok', 'Every feed casts off and every needle knits within the repeat.');
  return out;
}

// yarn length used per needle at a feed, as a share of one knitted loop
const TUCK_SHARE = 0.7;
function feedConsumption(st, pitchMm, slMm) {
  const missShare = clamp((pitchMm * 1.1) / slMm, 0.15, 0.6);
  return Array.from({ length: st.feeds }, (_, i) => {
    let s = 0, n = 0;
    const dbl = !!st.beds.D;
    for (const b of ['C', 'D']) {
      if (!st.beds[b]) continue;
      const other = b === 'C' ? st.beds.D : st.beds.C;
      st.beds[b][i].forEach((x, j) => {
        if (x === '-') return;
        n++;
        if (x === 'K') s += 1;
        else if (x === 'T') s += TUCK_SHARE;
        // a miss on a double bed is the yarn passing to the other bed's loop:
        // no extra length when the opposite needle works at this feed
        else if (!(dbl && other && (other[i][j] === 'K' || other[i][j] === 'T'))) s += dbl ? 0 : missShare;
      });
    }
    return { share: n ? s / st.width : 0 }; // per needle position of one bed
  });
}

// ── 4. THE PLAN ─────────────────────────────────────────────────────────────
/**
 * @param {object} a
 *   fabricDef, countNe, slMm (the engine's stitch length), gsm (finished target),
 *   lycra (bool), gauge, dia, feeders, rpm, efficiency (user's machine, optional),
 *   targetWidthIn, yarnTex (per role: {loop, pile, binder}), slUser
 */
function buildKnitPlan(a) {
  const fabricDef = a.fabricDef || {};
  if (fabricDef.category === 'warp_knit' || !(a.countNe > 0)) return null;
  let family = FAB_ALIAS[fabricDef.id] || (fabricDef.category === 'rib' ? 'rib' : fabricDef.category === 'interlock' ? 'interlock' : 'single_jersey');
  // the constants must come from the same kind of machine: a double-bed
  // relief or interlock piqué is not calibrated on single-bed rows
  if (fabricDef.category === 'interlock' && family !== 'interlock') family = 'interlock';
  else if (fabricDef.category === 'rib' && !['rib', 'waffle'].includes(family)) family = 'rib';
  else if (!['rib', 'interlock', 'purl'].includes(fabricDef.category) && ['rib', 'interlock'].includes(family)) family = 'single_jersey';
  const lycra = !!a.lycra;
  const mt = machineType(fabricDef, family);
  const M = MACHINE[mt];
  const tex = 590.5 / a.countNe;
  const notes = [];

  // ---- gauge ----
  const gList = CAL.gauges[`${family}|${lycra ? 'L' : 'P'}`] || CAL.gauges[`${family}|P`] || [];
  let near = [];
  for (const w of [1, 2, 4, 6, 10]) { near = gList.filter((r) => Math.abs(r.ne - a.countNe) <= w); if (near.length >= 8) break; }
  let factoryGauge = null;
  if (near.length) {
    const c = {}; near.forEach((r) => { c[r.g] = (c[r.g] || 0) + 1; });
    const [g, n] = Object.entries(c).sort((x, y) => y[1] - x[1])[0];
    factoryGauge = { gauge: +g, share_pct: Math.round(n / near.length * 100), n: near.length, spread: c };
  }
  const isDouble = mt === 'rib' || mt === 'interlock';
  const npi = Math.sqrt((isDouble ? 770 : 1650) / tex) * 2.54;
  const coverGauge = M.gauges.reduce((b, g) => (Math.abs(g - npi) < Math.abs(b - npi) ? g : b), M.gauges[0]);
  let recGauge = factoryGauge && factoryGauge.n >= 5 ? factoryGauge.gauge : coverGauge;
  let recSource = factoryGauge && factoryGauge.n >= 5 ? 'factory records' : 'cover factor';
  if (a.gaugeHint && a.gaugeHint.gauge > 0) { recGauge = a.gaugeHint.gauge; recSource = a.gaugeHint.source; }
  const gauge = a.gauge > 0 ? +a.gauge : recGauge;
  // a gauge is a fit for a count when the yarn's diameter leaves the hook room
  // to clear: yarn Ø (√tex / 28 mm for cotton) against the needle pitch
  const pitch = 25.4 / gauge;
  const yarnD = Math.sqrt(tex) / 28; // mm, cotton ~0.9 g/cc packing
  const pitchRatio = pitch / yarnD;
  // the band the factory actually knits this family in (5th–95th percentile)
  const B = CAL.band[family] && CAL.band[family].n >= 20 ? CAL.band[family] : CAL.band.single_jersey;
  const gaugeFit = pitchRatio < B.lo * 0.92 ? 'too fine for this count'
    : pitchRatio > B.hi * 1.08 ? 'coarse for this count' : 'good';
  if (a.gauge > 0 && gaugeFit !== 'good') notes.push(`${gauge} GG is ${gaugeFit} at ${a.countNe}s (pitch ${r2(pitch)} mm against a ${r2(yarnD)} mm yarn).`);

  // ---- stitch length ----
  const KS = calFor('ks', family, lycra);
  // (a plush is solved by its own mass balance: ground + pile over the sinker)
  const slPhys = a.gsm > 0 && mt !== 'terry' ? (KS.med * tex) / (10 * a.gsm) * 10 : null; // mm
  const slUsed = a.slUser > 0 ? +a.slUser : a.slMm > 0 ? +a.slMm : slPhys;
  const sl = {
    used_mm: slUsed != null ? r3(slUsed) : null,
    source: a.slUser > 0 ? 'your setting' : a.slMm > 0 ? (a.slSource || 'factory records') : 'GSM model',
    engine_mm: a.slMm > 0 ? r3(a.slMm) : null,
    model_mm: slPhys != null ? r3(slPhys) : null,
    model_range_mm: slPhys != null ? [r3((KS.q1 * tex) / a.gsm), r3((KS.q3 * tex) / a.gsm)] : null,
    ks: r1(KS.med), ks_basis: KS.basis,
  };
  if (sl.engine_mm && sl.model_mm) {
    sl.agreement_pct = r1((sl.engine_mm / sl.model_mm - 1) * 100);
    if (Math.abs(sl.agreement_pct) > 8) notes.push(`Stitch length: the matched factory record (${sl.engine_mm} mm) and the GSM model (${sl.model_mm} mm) differ by ${sl.agreement_pct}% — confirm on a trial roll.`);
  }
  const lcm = (slUsed || 2.7) / 10;
  // the GSM this stitch length gives, with this count
  const gsmFromSl = r1((KS.med * tex) / (10 * lcm));

  // ---- width per dia ----
  const KW = calFor('kw', family, lycra);
  const st = normaliseStructure(fabricDef, a.pattern);
  const wrep = st ? st.width : 1;
  const needleRound = (d, g) => { const step = Math.max(2, wrep % 2 ? wrep * 2 : wrep); return Math.round(Math.PI * d * g / step) * step; };
  // a rib with needles out of action knits only part of the bed
  const workFrac = st && st.beds.D && fabricDef.category === 'rib'
    ? ([st.beds.C, st.beds.D].reduce((t, g) => t + g[0].filter((x) => x !== '-').length, 0) / (2 * st.width)) : 1;
  const widthAt = (d, g, k = KW.med) => (needleRound(d, g) * workFrac * lcm) / (k * 2.54);
  const feedsRep = st ? st.feeds : 1;
  const feedersAt = (d) => { const f = M.fpi * d; const step = Math.max(1, feedsRep); return Math.max(step, Math.round(f / step) * step); };
  const options = STANDARD_DIA.filter((d) => d >= 20 && d <= 44).map((d) => ({
    dia: d, needles: needleRound(d, gauge), feeders: feedersAt(d),
    finished_width_in: r1(widthAt(d, gauge)), tube_width_in: r1(widthAt(d, gauge) / 2),
  }));
  let dia, diaMode;
  const commonDia = CAL.diaMode[`${family}|${lycra ? 'L' : 'P'}`] || CAL.diaMode[`${family}|P`] || 30;
  if (a.dia > 0) { dia = +a.dia; diaMode = 'your machine'; }
  else if (a.targetWidthIn > 0) {
    const exact = (a.targetWidthIn * KW.med * 2.54) / (Math.PI * gauge * lcm);
    dia = STANDARD_DIA.reduce((b, d) => (Math.abs(d - exact) < Math.abs(b - exact) ? d : b), 30);
    diaMode = `solved for ${a.targetWidthIn}" finished width (exact ${r1(exact)}")`;
  } else { dia = commonDia; diaMode = `the factory's most common ${family.replace('_', ' ')} diameter`; }
  const needles = needleRound(dia, gauge);
  const finished = widthAt(dia, gauge);
  const feeders = a.feeders > 0 ? +a.feeders : feedersAt(dia);
  if (a.feeders > 0 && st && feeders % feedsRep) notes.push(`${feeders} feeders is not a whole number of ${feedsRep}-feed repeats — the pattern breaks at the feeder where it wraps round. Use ${Math.round(feeders / feedsRep) * feedsRep}.`);

  // the recommended machine, whatever the user's own is
  const recDia = a.targetWidthIn > 0
    ? STANDARD_DIA.reduce((b, d) => (Math.abs(d - (a.targetWidthIn * KW.med * 2.54) / (Math.PI * recGauge * lcm)) < Math.abs(b - (a.targetWidthIn * KW.med * 2.54) / (Math.PI * recGauge * lcm)) ? d : b), 30)
    : commonDia;
  const recommended = {
    gauge: recGauge, dia: recDia, needles: needleRound(recDia, recGauge), feeders: feedersAt(recDia),
    finished_width_in: r1(widthAt(recDia, recGauge)),
    dia_basis: a.targetWidthIn > 0 ? `solved for ${a.targetWidthIn}" finished width` : `the factory's most common ${family.replace('_', ' ')} diameter`,
  };

  // ---- density ----
  // Ks counts every loop in the cloth: a double-bed fabric has two (one per
  // bed) for each face wale in a course
  const bedsLoops = st && st.beds.D ? 2 : 1;
  const wpc = KW.med / lcm, cpc = (KS.med / (bedsLoops * KW.med)) / lcm;

  // ---- structure ----
  let structure = null, cons = null;
  if (st) {
    const T = { C: tracksOf(st.beds.C), D: tracksOf(st.beds.D) };
    cons = feedConsumption(st, pitch, slUsed || 2.7);
    structure = {
      feeds_per_repeat: st.feeds, needles_per_repeat: st.width, gating: st.gating,
      beds: st.beds, symbols: SYM,
      setout: { C: T.C ? T.C.setout.join(' ') : null, D: T.D ? T.D.setout.join(' ') : null },
      tracks: { C: T.C ? T.C.sequences : null, D: T.D ? T.D.sequences : null },
      cam_chart: camChart(st, T),
      yarn_per_feed: st.yarn,
      consumption: cons.map((c, i) => ({ feed: i + 1, share: r2(c.share) })),
      checks: structureChecks(st, T, M),
    };
  }

  // ---- output ----
  const rpm = a.rpm > 0 ? +a.rpm : Math.round(M.sf / dia);
  const eff = (a.efficiency > 0 ? +a.efficiency : 85) / 100;
  const texFor = (y) => {
    const t = String(y || '');
    if (/\+/.test(t) && /pile/i.test(t) && a.yarnTex && a.yarnTex.loop) return tex + a.yarnTex.loop;
    if (/loop|fleece|pile/i.test(t) && a.yarnTex && a.yarnTex.loop) return a.yarnTex.loop;
    if (/binder|tie/i.test(t) && a.yarnTex && a.yarnTex.binder) return a.yarnTex.binder;
    return tex;
  };
  // grams of yarn per revolution, averaged over the repeat
  const gPerFeeder = cons
    ? cons.reduce((t, c, i) => t + c.share * texFor(st.yarn[i]), 0) / cons.length
    : tex;
  const gramsPerRev = feeders * needles * (lcm / 100) * gPerFeeder / 1000; // g
  const kgh = (rpm * 60 * eff * gramsPerRev) / 1000;
  const mh = kgh * 1000 / Math.max(1, (a.gsm || gsmFromSl)) / (finished * 0.0254);
  const production = {
    kg_per_hour: r2(kgh), kg_per_shift_8h: r1(kgh * 8), kg_per_day: r1(kgh * 24), m_per_hour: r1(mh),
    rpm, rpm_source: a.rpm > 0 ? 'your setting' : `typical for a ${dia}" ${M.label.toLowerCase()} machine (speed factor ${M.sf})`,
    efficiency_pct: Math.round(eff * 100),
    formula: `RPM × 60 × efficiency × feeders × needles × ℓ × tex × structure share = ${rpm} × 60 × ${r2(eff)} × ${feeders} × ${needles} × ${r3(lcm / 100)} m × ${r2(gPerFeeder)} g/km`,
    structure_share: cons ? r2(cons.reduce((t, c) => t + c.share, 0) / cons.length) : 1,
  };

  return {
    family, machine_type: mt, machine_label: M.label, lycra,
    gauge: {
      recommended: recGauge, used: gauge, source: a.gauge > 0 ? 'your machine' : recSource, recommended_source: recSource,
      factory: factoryGauge, cover_factor: { npi: r1(npi), gauge: coverGauge, formula: `NPI = √(${isDouble ? 770 : 1650} ÷ ${r2(tex)} tex) × 2.54 = ${r1(npi)}` },
      fit: gaugeFit, pitch_mm: r3(pitch), yarn_diameter_mm: r3(yarnD), pitch_to_yarn: r2(pitchRatio), factory_band: [r2(B.lo), r2(B.hi)],
    },
    stitch_length: { ...sl, gsm_at_this_sl: gsmFromSl },
    dia: { used: dia, mode: diaMode, factory_common: commonDia, options },
    recommended,
    machine: {
      dia, gauge, needles, feeders, feeders_typical: [Math.round(M.fpiRange[0] * dia), Math.round(M.fpiRange[1] * dia)],
      feeders_per_repeat: feedsRep, repeats_round: st ? feeders / feedsRep : null, pitch_mm: r3(pitch),
    },
    fabric: {
      finished_width_in: r1(finished), finished_width_cm: r1(finished * 2.54),
      width_range_in: [r1(widthAt(dia, gauge, KW.q3)), r1(widthAt(dia, gauge, KW.q1))],
      tube_width_in: r1(finished / 2),
      wpc: r1(wpc), cpc: r1(cpc), wpi: r1(wpc * 2.54), cpi: r1(cpc * 2.54),
      loops_per_cm2: Math.round(wpc * cpc),
      kw: r2(KW.med), kw_basis: KW.basis, ks: r1(KS.med), working_needles_pct: Math.round(workFrac * 100),
      formula: `width = needles × ℓ ÷ Kw = ${needles} × ${r3(lcm)} cm ÷ ${r2(KW.med)} = ${r1(finished * 2.54)} cm`,
    },
    production,
    structure,
    notes,
  };
}

module.exports = {
  buildKnitPlan, normaliseStructure, CAL, MACHINE, STANDARD_DIA,
  // shared with the fabric studio (fabric-studio.js)
  calFor, tracksOf, camChart, structureChecks, feedConsumption,
};
