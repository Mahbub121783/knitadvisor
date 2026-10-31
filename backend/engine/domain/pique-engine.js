/**
 * KnitAdvisor — Piqué structure engine
 * ====================================
 *
 * What makes a piqué a piqué is not its weight or its count, which the main
 * engine already answers, but what its tuck stitches do to the cloth. A
 * needle that tucks keeps its old loop: that loop is HELD and has to reach up
 * through the tuck courses to the course where it is finally knitted, with
 * no more yarn than any other loop — so it is pulled taut and narrow, robbing
 * yarn from its neighbours. The tuck loop is never drawn through; it lies
 * open on the technical back. The result, measured on real cloth:
 *
 *   - the wales spread apart (a piqué comes off the same machine wider)
 *   - the courses pack together (more courses per cm at the same stitch
 *     length)
 *   - the neighbouring knit loops, squeezed between the packed courses with
 *     the same yarn length, buckle out of the plane: those buckles are the
 *     beads of the cell, on the technical back, which is why the back is the
 *     side sold as the face.
 *
 * HOW THE NUMBERS ARE GROUNDED
 *
 * 1. Spread and compression come from the factory R&D records
 *    (factory-dataset.js: greige→finish rows from a Bangladesh knitting
 *    floor, with machine dia, gauge, stitch length, count and the FINISHED
 *    open width and GSM). For each row: wales/cm = needles / finished width,
 *    courses/cm from mass balance at the finished GSM. Their Munden-type
 *    constants (Kw = wpc·SL, Kc = cpc·SL), computed here at load time:
 *
 *        family         Kw     Kc     (medians, non-lycra)
 *        single jersey  3.81   5.19   ~1,100 rows
 *        piqué          2.92   7.44   ~100 rows
 *
 *    → piqué wales ~30 % wider, courses ~43 % denser than jersey at the
 *    same stitch length, with a tight spread (IQR ±3 %) and almost no drift
 *    with GSM or tightness. CVC piqué packs ~9 % more courses than cotton;
 *    lycra piqué spreads less and packs more. All of that is read from the
 *    records, not assumed.
 *
 * 2. The records call every quality "piqué"; they do not say which needle
 *    programme. So that measured value is the anchor for a TYPICAL piqué,
 *    and each programme is placed around it by its hold intensity
 *        I = held-course fraction × (1 + 0.5 · (consecutive holds − 1))
 *    against the reference I = 0.5 (midway between single Lacoste and polo
 *    piqué, the two qualities a polo floor mostly runs), with a square root
 *    because wales can only spread so far. That placement is a MODEL; the
 *    anchor is DATA.
 *
 * 3. Held loop elongation from intermeshing geometry: a knit loop is about
 *    1.41 course pitches tall (its head overlaps the course above), so a loop
 *    held over n courses is (1.41 + n) / 1.41 times as tall.
 *
 * 4. Cell depth from buckling: a loop leg of height H squeezed into H / k
 *    (k = course compression) with its yarn length unchanged bows out like a
 *    pinned elastica, amplitude ≈ (2/π)·√(2·H·(H − H/k)). Compression comes
 *    from the GSM actually requested (mass balance), so a heavier quality at
 *    the same count and stitch length is genuinely deeper.
 *
 * Everything returned is an ESTIMATE and is labelled as one.
 */

'use strict';

const { FACTORY_RECORDS } = require('../catalog/factory-dataset');

const LOOP_HEIGHT_PITCHES = 1.41;  // knit loop height / course pitch (head overlaps the course above)
const I_REF = 0.5;                 // hold intensity the pooled factory piqué stands for
const EYE_ARCMIN_M = 0.000291;     // 1 arc-minute per metre, in metres
const TEXTURE_ARCMIN = 2;          // a low-contrast relief needs ~2' to read
const DOUBLE_WIDTH_PER_NEEDLE = null; // filled from the interlock records below

// ── Factory anchors ───────────────────────────────────────────────────────
// Medians of Kw, Kc and finished width / machine circumference per family,
// lycra and non-lycra apart, by fibre class. Rows whose finished width is not
// a plausible open width (0.4-1.6 x circumference: tube widths, typos) are
// left out.
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) / 2)];
}

function deriveRow(r) {
  if (!(r.dia > 0 && r.g > 0 && r.fdia > 0 && r.sl > 0 && r.ne > 0 && r.fgsm > 0)) return null;
  const circ = Math.PI * r.dia;
  const widthRatio = r.fdia / circ;
  if (widthRatio < 0.4 || widthRatio > 1.6) return null;
  const wpc = (circ * r.g) / (r.fdia * 2.54);
  const slCm = r.sl / 10;
  const cpc = (r.fgsm * 10) / (wpc * slCm * (590.5 / r.ne));
  return { Kw: wpc * slCm, Kc: cpc * slCm, widthRatio, gauge: r.g, fgsm: r.fgsm, comp: r.comp };
}

const ANCHORS = (() => {
  const rows = (fab, lycra, comp) => FACTORY_RECORDS
    .filter(r => r.fab === fab && /lycra/.test(r.spin || '') === lycra && (!comp || r.comp === comp))
    .map(deriveRow).filter(Boolean);
  const summarise = (rs) => rs.length ? {
    n: rs.length,
    Kw: median(rs.map(d => d.Kw)),
    Kc: median(rs.map(d => d.Kc)),
    widthPerNeedle: median(rs.map(d => d.widthRatio / d.gauge)),
    gsm: [rs.map(d => d.fgsm).sort((a, b) => a - b)[Math.floor(rs.length * 0.25)],
          rs.map(d => d.fgsm).sort((a, b) => a - b)[Math.floor(rs.length * 0.75)]],
  } : null;
  return {
    jersey: summarise(rows('single_jersey', false)),
    jerseyLycra: summarise(rows('single_jersey', true)),
    pique: summarise(rows('pique', false)),
    piqueLycra: summarise(rows('pique', true)),
    piqueCotton: summarise(rows('pique', false, 'cotton')),
    piqueCvc: summarise(rows('pique', false, 'cvc')),
    interlock: summarise(rows('interlock', false)),
  };
})();

// Fallbacks only if the dataset ever ships without these families.
const A_JERSEY = ANCHORS.jersey || { n: 0, Kw: 3.81, Kc: 5.19 };
const A_PIQUE = ANCHORS.pique || { n: 0, Kw: 2.92, Kc: 7.44, gsm: [186, 210] };
const SPREAD_REF = A_JERSEY.Kw / A_PIQUE.Kw;           // ~1.30, measured
const COMPRESSION_REF = A_PIQUE.Kc / A_JERSEY.Kc;       // ~1.43, measured

// Fibre effect on a piqué, read from the records where they hold enough rows
// (cotton vs CVC); anything else falls back to cotton and says so.
function fibreEffect(fibre, elastane) {
  let spread = 1, pack = 1, basis = 'cotton piqué records';
  const cot = ANCHORS.piqueCotton, cvc = ANCHORS.piqueCvc;
  const polyBlend = fibre === 'polyester' || fibre === 'cvc' || fibre === 'pc';
  if (polyBlend && cvc && cot && cvc.n >= 8) {
    spread = cot.Kw / cvc.Kw;
    pack = cvc.Kc / cot.Kc;
    basis = `CVC piqué records (${cvc.n})`;
  } else if (fibre !== 'cotton') {
    basis = `no ${fibre} piqué in the records — cotton values used`;
  }
  if (elastane && ANCHORS.piqueLycra && ANCHORS.piqueLycra.n >= 8) {
    spread *= A_PIQUE.Kw / ANCHORS.piqueLycra.Kw;
    pack *= ANCHORS.piqueLycra.Kc / A_PIQUE.Kc;
    basis += ` + lycra piqué records (${ANCHORS.piqueLycra.n})`;
  }
  return { spread, pack, basis };
}

// Every piqué in the catalogue. `face` is the side sold as the face.
const PIQUE_FAMILY = {
  lacoste_single: {
    bed: 'single', face: 'technical_back',
    aka: ['Single Lacoste', 'Single Piqué (4-feed)'],
    look: {
      close: 'Small staggered cells: one tuck per wale per repeat, each row of cells closed by a plain course.',
      distance: 'Fine, even pebble; soft drape.',
    },
  },
  lacoste_double: {
    bed: 'single', face: 'technical_back',
    aka: ['Double Lacoste', '6-feed Piqué'],
    look: {
      close: 'Deeper cells: two tucks stacked in each wale before the plain course.',
      distance: 'Bolder honeycomb; firmer, more structured drape.',
    },
  },
  pique_single: {
    bed: 'single', face: 'technical_back',
    aka: ['Polo Piqué', 'Double Piqué (4-feed, US)'],
    look: {
      close: 'Two stacked tucks and no plain course: wales spread wide, cells in straight rows of beads.',
      distance: 'The classic polo-shirt grain.',
    },
  },
  pique_double: {
    bed: 'single', face: 'technical_back',
    aka: ['Jump Piqué', 'Jumbo / Waffle Piqué'],
    look: {
      close: 'Pairs of neighbouring needles tuck together for two courses: large square cells.',
      distance: 'Bold geometric waffle.',
    },
  },
  single_cross_tuck: {
    bed: 'single', face: 'technical_back',
    aka: ['Cross Tuck', 'Micro Piqué', 'Baby Thermal'],
    look: {
      close: 'Alternate needles tuck on every course: a fine pebble / micro-mesh.',
      distance: 'Near-smooth with a fine grain.',
    },
  },
  swiss_double_pique: {
    bed: 'double', face: 'technical_face',
    aka: ['Swiss Double Piqué'],
    look: {
      close: 'Dial loops held on alternate feeds pull the cylinder wales in from behind: small, tight cells on the face.',
      distance: 'Crisp, structured, does not curl.',
    },
  },
  french_double_pique: {
    bed: 'double', face: 'technical_face',
    aka: ['French Double Piqué', 'Rodier Piqué'],
    look: {
      close: 'Dial tucks push the cylinder loops forward: raised, corded cells.',
      distance: 'Corded relief on a stable double knit.',
    },
  },
  texipique: {
    bed: 'double', face: 'technical_face',
    aka: ['Texipiqué'],
    look: {
      close: 'Tuck courses between plain interlock courses: wider, softer cells.',
      distance: 'Even, quiet texture on a stable double knit.',
    },
  },
  lacoste_pique: {
    bed: 'double', face: 'technical_back',
    aka: ['Double-bed Lacoste'],
    look: {
      close: 'Dial tucks on alternate needles: cells on the dial side, plain cylinder side.',
      distance: 'Soft cellular surface on a non-curling double knit.',
    },
  },
  pique_interlock: {
    bed: 'double', face: 'technical_face',
    aka: ['Interlock Piqué', 'Cross-tuck Interlock'],
    look: {
      close: 'Tuck cells on both beds in turn: texture on both sides.',
      distance: 'Even piqué hand on both faces; stable.',
    },
  },
};

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function isPique(fabricId) {
  return Object.prototype.hasOwnProperty.call(PIQUE_FAMILY, fabricId);
}

// Per-grid statistics. n_tuck / n_hold: longest run of consecutive tucks /
// holds (tuck or miss) in any one wale, read cyclically (the repeat wraps).
function tuckStats(grid) {
  if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0])) return null;
  const rows = grid.length, cols = grid[0].length;
  const isHold = (t) => t === 'T' || t === 'M';
  let tucks = 0, misses = 0, nTuck = 0, nHold = 0, held = 0;
  for (let w = 0; w < cols; w++) {
    for (let c = 0; c < rows; c++) {
      const t = grid[c][w];
      if (t === 'T') tucks++;
      if (t === 'M') misses++;
      if (t === 'K' && isHold(grid[(c + 1) % rows][w])) held++;
    }
    for (let start = 0; start < rows; start++) {
      let rt = 0, rh = 0;
      while (rt < rows && grid[(start + rt) % rows][w] === 'T') rt++;
      while (rh < rows && isHold(grid[(start + rh) % rows][w])) rh++;
      nTuck = Math.max(nTuck, rt);
      nHold = Math.max(nHold, rh);
    }
  }
  const cells = rows * cols;
  return {
    rows, cols, tucks, misses,
    tuck_fraction: tucks / cells,
    miss_fraction: misses / cells,
    n_tuck: nTuck,
    n_hold: nHold,
    held_loops: held,
    plain_courses: grid.filter(r => r.every(t => t === 'K')).length,
  };
}

function fibreClass(composition) {
  const fibers = (composition && composition.fibers) || {};
  const cot = fibers.cotton || 0, pes = fibers.polyester || 0;
  if (cot > 0 && pes > 0) return cot >= pes ? 'cvc' : 'pc';
  let best = 'cotton', pct = -1;
  for (const [f, p] of Object.entries(fibers)) {
    if (f === 'elastane' || f === 'spandex') continue;
    if (p > pct) { best = f; pct = p; }
  }
  return best;
}

/**
 * @param {object} p
 *   fabricId, gsm, gauge, countNe, llMm, tex, tf, composition, pattern ({pattern_cylinder, pattern_dial})
 * @returns analysis object, or null for a fabric that is not a piqué
 */
function analyzePique(p) {
  const fam = PIQUE_FAMILY[p.fabricId];
  if (!fam) return null;
  const pat = p.pattern || {};
  const C = pat.pattern_cylinder, D = pat.pattern_dial;
  const cyl = tuckStats(C);
  const dial = Array.isArray(D) ? tuckStats(D) : null;
  if (!cyl) return null;
  const double = fam.bed === 'double';

  // The bed(s) that carry the cell.
  const active = double ? [cyl, dial].filter(s => s && (s.tucks || s.misses)) : [cyl];
  const nTuck = Math.max(0, ...active.map(s => s.n_tuck));
  const nHold = Math.max(0, ...active.map(s => s.n_hold));
  const holdFrac = active.length
    ? active.reduce((a, s) => a + s.tuck_fraction + s.miss_fraction, 0) / (double ? 2 : 1)
    : 0;
  const intensity = holdFrac * (1 + 0.5 * Math.max(0, nHold - 1));
  const rel = Math.sqrt(intensity / I_REF);

  // ── Yarn ───────────────────────────────────────────────────────────────
  const countNe = p.countNe > 0 ? p.countNe : 30;
  const dMm = 0.907 / Math.sqrt(countNe);                 // 1 / (28 √Ne) inch
  const llMm = p.llMm > 0 ? p.llMm : 2.6;
  const llCm = llMm / 10;
  const tex = p.tex > 0 ? p.tex : 590.5 / countNe;
  const tf = p.tf > 0 ? p.tf : Math.sqrt(tex) / llCm;
  const fibre = fibreClass(p.composition);
  const elastane = !!(p.composition && p.composition.has_elastane);
  const fx = fibreEffect(fibre, elastane);

  // ── Spread and expected compression (factory anchor, placed by structure) ─
  let spread = (1 + (SPREAD_REF - 1) * rel) * fx.spread;
  let compressionExpected = (1 + (COMPRESSION_REF - 1) * rel) * fx.pack;
  if (double) {
    // the second bed holds the wales; no double-piqué records to say how much
    spread = 1 + (spread - 1) * 0.4;
    compressionExpected = 1 + (compressionExpected - 1) * 0.4;
  }
  const lean = clamp((spread - 1) * 0.5, 0, 0.2);        // wale zig-zag, fraction of a wale

  // ── Density at the requested GSM ───────────────────────────────────────
  // Single bed: wales from the factory jersey constant and the spread.
  // Double bed: width is set by the needle pitch (interlock records give
  // the finished width per needle).
  const gauge = p.gauge > 0 ? p.gauge : 24;
  const il = ANCHORS.interlock;
  const wpc = double
    ? (il && il.widthPerNeedle ? 1 / (il.widthPerNeedle * 2.54) : (gauge / 2.54) * 1.64) / spread
    : (A_JERSEY.Kw / llCm) / spread;
  // Mass balance: GSM = rows/cm · wales/cm · (yarn per needle per row,
  // summed over beds) · tex / 10. A knit or tuck draws one stitch length; a
  // miss leaves only a float about one needle pitch long.
  const yarnPerRow = (s) => (s ? (1 - s.miss_fraction) * llCm + s.miss_fraction / wpc : 0);
  const yarnRow = yarnPerRow(cyl) + (double ? yarnPerRow(dial || cyl) : 0);
  const cpcJersey = A_JERSEY.Kc / llCm;
  const cpc = p.gsm > 0 ? (p.gsm * 10) / (wpc * yarnRow * tex) : cpcJersey * compressionExpected;
  const compression = double ? null : cpc / cpcJersey;
  // How far this GSM/count/SL sits from what the factory runs for this
  // structure. Outside ±15 % the quality is unusual for its stitch length.
  const deviation = double ? null : compression / compressionExpected - 1;
  const plausible = double ? true : Math.abs(deviation) <= 0.15;

  // ── Held loop and cell depth ───────────────────────────────────────────
  const heldElong = (LOOP_HEIGHT_PITCHES + nHold) / LOOP_HEIGHT_PITCHES;
  // Buckling of the squeezed knit loops (mm). Relaxed loop height from the
  // jersey course pitch at this stitch length; compression from the GSM
  // asked for (single bed), or the structure's expectation (double bed,
  // where the second bed takes part of the squeeze).
  const H = LOOP_HEIGHT_PITCHES * (llMm / A_JERSEY.Kc);
  const k = clamp(double ? compressionExpected : compression, 1, 2.2);
  let reliefMm = nHold > 0 ? (2 / Math.PI) * Math.sqrt(2 * H * (H - H / k)) : 0;
  if (double) reliefMm *= 0.5;
  const reliefD = reliefMm / dMm;

  // ── Cell size and how far away it still reads ──────────────────────────
  const repW = Math.max(cyl.cols, dial ? dial.cols : 0);
  const repC = Math.max(cyl.rows, dial ? dial.rows : 0);
  const cellW = (repW / wpc) * 10;
  const cellH = (repC / cpc) * 10;
  const visibleM = Math.min(cellW, cellH) / 1000 / (EYE_ARCMIN_M * TEXTURE_ARCMIN);

  // ── GSM position against what the factory runs (single-bed piqué) ─────
  const common = A_PIQUE.gsm;
  let gsmPos = 'typical', gsmNote = `Within the range most piqué is run at (${common[0]}–${common[1]} GSM finished).`;
  if (double) {
    gsmNote = 'No double-piqué rows in the factory records to compare the weight against.';
    gsmPos = 'n/a';
  } else if (p.gsm && p.gsm < common[0] * 0.92) {
    gsmPos = 'light';
    gsmNote = `Lighter than most piqué runs (${common[0]}–${common[1]} GSM): finer yarn, smaller cells.`;
  } else if (p.gsm && p.gsm > common[1] * 1.08) {
    gsmPos = 'heavy';
    gsmNote = `Heavier than most piqué runs (${common[0]}–${common[1]} GSM): coarser yarn, larger, firmer cells.`;
  }

  // Curl relative to plain jersey: tucks lock the loops; a double knit does not curl.
  const curl = double ? 0 : clamp(1 - 1.2 * holdFrac, 0.15, 1);
  // Thickness: one bed is about 2.2 yarn diameters, plus the cell relief.
  const thicknessMm = (double ? 4 : 2.2) * dMm + reliefMm;

  return {
    fabric_id: p.fabricId,
    bed: fam.bed,
    also_known_as: fam.aka,
    selling_face: fam.face,
    notation: {
      cylinder: C,
      dial: Array.isArray(D) ? D : null,
      feeds: cyl.rows,
      repeat: { wales: repW, courses: repC },
    },
    tuck: {
      tuck_fraction: round(holdFrac, 3),
      consecutive_tucks: nTuck,
      consecutive_holds: nHold,
      hold_intensity: round(intensity, 3),
      held_loops_per_repeat: active.reduce((a, s) => a + s.held_loops, 0),
      plain_courses_per_repeat: cyl.plain_courses,
    },
    geometry: {
      held_loop_elongation: round(heldElong),
      relief_yarn_diameters: round(reliefD),
      relief_mm: round(reliefMm),
      wale_spread: round(spread),
      wale_lean: round(lean, 3),
      yarn_diameter_mm: round(dMm, 3),
      tightness_factor: round(tf, 1),
      fibre: fibre + (elastane ? ' + elastane' : ''),
      fibre_basis: fx.basis,
    },
    density: {
      wales_per_cm: round(wpc, 1),
      courses_per_cm: round(cpc, 1),
      stitches_per_cm2: Math.round(wpc * cpc * (double ? 2 : 1)),
      course_compression_vs_jersey: compression == null ? null : round(compression),
      expected_compression: double ? null : round(compressionExpected),
      plausible,
      note: double
        ? 'Courses solved from the requested GSM; width from the needle pitch.'
        : plausible
          ? 'Courses solved from the requested GSM; in line with what the factory runs for this structure.'
          : `At this count and stitch length the requested GSM needs ${Math.round(Math.abs(deviation) * 100)}% ${deviation > 0 ? 'more' : 'fewer'} courses than the factory's piqué normally packs — check the yarn count or stitch length.`,
    },
    cell: {
      width_mm: round(cellW),
      height_mm: round(cellH),
      readable_up_to_m: round(visibleM, 1),
    },
    gsm_fit: { common_finished: common, position: gsmPos, note: gsmNote },
    behaviour: {
      curl_vs_jersey: round(curl),
      width_vs_jersey_pct: Math.round((spread - 1) * 100),
      thickness_mm: round(thicknessMm),
    },
    basis: {
      factory_pique_rows: A_PIQUE.n,
      factory_jersey_rows: A_JERSEY.n,
      measured: 'wale spread and course packing of a typical piqué; CVC and lycra effects',
      modelled: 'placement of each needle programme around that typical piqué; cell depth from loop buckling; double-bed values',
    },
    appearance: fam.look,
    estimate: true,
  };
}

module.exports = { analyzePique, isPique, tuckStats, PIQUE_FAMILY, ANCHORS };
