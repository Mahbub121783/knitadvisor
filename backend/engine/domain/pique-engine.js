/**
 * KnitAdvisor — Piqué structure engine
 * ====================================
 *
 * What makes a piqué a piqué is not its weight or its count, which the main
 * engine already answers, but what its tuck stitches do to the cloth: a
 * needle that tucks keeps its old loop, so that loop is HELD and stretched up
 * through the tuck courses; the tuck loop sits behind it; the extra yarn
 * buckles the neighbouring knit loops out of the plane while the taut held
 * loop is drawn in. On a single-bed piqué that buckling is the honeycomb
 * cell, and it shows on the TECHNICAL BACK — which is why the back is the
 * side sold as the face.
 *
 * This module turns the needle programme (pattern_cylinder / pattern_dial)
 * plus the fabric actually being made (GSM, count, stitch length, tightness,
 * fibre) into that geometry, in numbers the 3D view builds from and the
 * result page shows:
 *
 *   held loop   H_held = H0 + n_tuck · C · α,  α ≈ 0.82 (course compression)
 *               n_tuck = consecutive tuck courses above a knit loop
 *   relief      cell depth in yarn diameters, ≈ 1.25 + 1.25 · n_tuck — the
 *               tuck crown sits 1.25 d behind the held loop, and every further
 *               tuck course adds about as much again; scaled by tightness
 *               (a tight fabric has no room to buckle) and by fibre
 *   wale spread tucks push wales apart: 1 + 0.68 · tuck fraction (+0.03 per
 *               extra consecutive tuck)
 *   density     wales from the Munden wale constant and the spread; courses
 *               from MASS BALANCE at the requested GSM, so the cell geometry
 *               is the one that actually weighs what was asked for
 *
 * Calibration (internal, not shown on the site): the held-loop, relief and
 * spread relations above reproduce the published parameter sets for single
 * Lacoste (1.75 / 0.42 mm / 1.18), double Lacoste (2.45 / 0.68 mm / 1.28) and
 * polo piqué (2.40 / 0.62 mm / 1.34) within ~10 % at a 26-30 Ne cotton —
 * Spencer, Knitting Technology (2001); Sha et al. (2015); Leaf et al. (2018).
 * Everything here is an ESTIMATE from structure and is labelled as such.
 */

'use strict';

const ALPHA_COMP = 0.82;           // course compression factor in H_held
const KW_SINGLE = 4.1, KC_SINGLE = 5.0;   // Munden (cotton, dry-relaxed) — same constants the 3D view uses
const TF_REF = 18;                 // middle of the piqué family's ideal TF band (17-19.5)
const EYE_ARCMIN_M = 0.000291;     // 1 arc-minute per metre, in metres
const TEXTURE_ARCMIN = 2;          // a low-contrast relief needs ~2' to read

// Every piqué in the catalogue. `face` is the side sold as the face. Ranges
// are where each structure is normally made; outside them it is still made,
// it just reads differently (see gsmFit).
const PIQUE_FAMILY = {
  lacoste_single: {
    bed: 'single', face: 'technical_back', gsm: [160, 190],
    aka: ['Single Lacoste', 'Single Piqué (4-feed)'],
    look: {
      close: 'Small diamond cells: one tuck per wale per repeat, each cell closed by a plain course.',
      distance: 'Fine, even diamond mesh; light, soft drape.',
    },
  },
  lacoste_double: {
    bed: 'single', face: 'technical_back', gsm: [200, 230],
    aka: ['Double Lacoste', '6-feed Piqué'],
    look: {
      close: 'Deep hexagonal cells: two tucks stacked in each wale before the plain course.',
      distance: 'Honeycomb readable from across a room; firm, structured drape.',
    },
  },
  pique_single: {
    bed: 'single', face: 'technical_back', gsm: [210, 240],
    aka: ['Polo Piqué', 'Double Piqué (4-feed, US)'],
    look: {
      close: 'Wide, flat cells: two stacked tucks, no plain course, so wales spread sideways.',
      distance: 'The classic polo-shirt grain; heavier body.',
    },
  },
  pique_double: {
    bed: 'single', face: 'technical_back', gsm: [220, 300],
    aka: ['Jump Piqué', 'Jumbo / Waffle Piqué'],
    look: {
      close: 'Pairs of neighbouring needles tuck together for two courses: large square cells.',
      distance: 'Bold geometric waffle; sweatshirt and heavy polo look.',
    },
  },
  single_cross_tuck: {
    bed: 'single', face: 'technical_back', gsm: [140, 190],
    aka: ['Cross Tuck', 'Micro Piqué', 'Baby Thermal'],
    look: {
      close: 'Alternate needles tuck on every course: a fine pebble / micro-mesh.',
      distance: 'Near-smooth; activewear and sports-jersey drape.',
    },
  },
  swiss_double_pique: {
    bed: 'double', face: 'technical_face', gsm: [240, 290],
    aka: ['Swiss Double Piqué'],
    look: {
      close: 'Dial loops pull the cylinder wales from behind: tight bird\'s-eye cells on the face.',
      distance: 'Crisp, structured, does not curl.',
    },
  },
  french_double_pique: {
    bed: 'double', face: 'technical_face', gsm: [240, 290],
    aka: ['French Double Piqué', 'Rodier Piqué'],
    look: {
      close: 'Dial tucks push the cylinder loops forward: raised, corded blister cells.',
      distance: 'Corded honeycomb relief on a stable double knit.',
    },
  },
  texipique: {
    bed: 'double', face: 'technical_face', gsm: [220, 300],
    aka: ['Texipiqué'],
    look: {
      close: 'Tuck courses between plain interlock courses: wider, puffier cells than Swiss piqué.',
      distance: 'Premium knit-blazer and jacket surface.',
    },
  },
  lacoste_pique: {
    bed: 'double', face: 'technical_back', gsm: [190, 260],
    aka: ['Double-bed Lacoste'],
    look: {
      close: 'Dial tucks on alternate needles: cells on the dial side, plain cylinder side.',
      distance: 'Soft cellular surface on a non-curling double knit.',
    },
  },
  pique_interlock: {
    bed: 'double', face: 'technical_face', gsm: [220, 320],
    aka: ['Interlock Piqué', 'Cross-tuck Interlock'],
    look: {
      close: 'Tuck cells on both beds in turn: texture on both sides.',
      distance: 'Even piqué hand on both faces; stable and wide.',
    },
  },
};

// How each fibre holds a buckled cell. Spun staple fibre with high friction
// keeps the cell sharp; a smooth or limp fibre lets it relax flatter.
const FIBRE_RELIEF = {
  cotton: 1.0, wool: 1.1, linen: 1.05, hemp: 1.05, acrylic: 1.0,
  polyester: 0.88, nylon: 0.85, viscose: 0.85, modal: 0.85, lyocell: 0.9, silk: 0.85,
};

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function isPique(fabricId) {
  return Object.prototype.hasOwnProperty.call(PIQUE_FAMILY, fabricId);
}

// Per-grid tuck statistics. n_tuck is the longest run of consecutive tucks in
// any one wale, read cyclically (the repeat wraps).
function tuckStats(grid) {
  if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0])) return null;
  const rows = grid.length, cols = grid[0].length;
  let tucks = 0, misses = 0, nTuck = 0, held = 0;
  for (let w = 0; w < cols; w++) {
    for (let c = 0; c < rows; c++) {
      const t = grid[c][w];
      if (t === 'T') tucks++;
      if (t === 'M') misses++;
      // a knit loop with at least one hold course directly above it is held
      if (t === 'K' && (grid[(c + 1) % rows][w] === 'T' || grid[(c + 1) % rows][w] === 'M')) held++;
    }
    for (let start = 0; start < rows; start++) {
      let run = 0;
      while (run < rows && grid[(start + run) % rows][w] === 'T') run++;
      nTuck = Math.max(nTuck, run);
    }
  }
  const cells = rows * cols;
  return {
    rows, cols, tucks, misses,
    tuck_fraction: tucks / cells,
    miss_fraction: misses / cells,
    n_tuck: nTuck,
    held_loops: held,
    plain_courses: grid.filter(r => r.every(t => t === 'K')).length,
  };
}

function dominantFibre(composition) {
  const fibers = (composition && composition.fibers) || {};
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

  // The bed that carries the piqué cell: for a double-bed piqué whichever bed
  // tucks or misses; both when both do.
  const active = double
    ? [cyl, dial].filter(s => s && (s.tucks || s.misses))
    : [cyl];
  const nTuck = Math.max(0, ...active.map(s => s.n_tuck));
  // A held course (tuck OR miss above) — miss holds a loop just like a tuck
  // does, it just leaves a float instead of a tuck loop behind it.
  const holdFrac = active.length
    ? active.reduce((a, s) => a + s.tuck_fraction + s.miss_fraction, 0) / (double ? 2 : 1)
    : 0;
  const nHold = Math.max(nTuck, ...active.map(s => {
    // longest consecutive hold (T or M) run, for elongation
    const g = s === cyl ? C : D;
    let best = 0;
    for (let w = 0; w < s.cols; w++) {
      for (let st = 0; st < s.rows; st++) {
        let run = 0;
        while (run < s.rows && (g[(st + run) % s.rows][w] === 'T' || g[(st + run) % s.rows][w] === 'M')) run++;
        best = Math.max(best, run);
      }
    }
    return best;
  }));

  // ── Fibre and elastane ─────────────────────────────────────────────────
  const fibre = dominantFibre(p.composition);
  const elastane = !!(p.composition && p.composition.has_elastane);
  let fibreK = FIBRE_RELIEF[fibre] != null ? FIBRE_RELIEF[fibre] : 1.0;
  if (elastane) fibreK *= 1.12;      // elastane draws the cell in: deeper, smaller

  // ── Yarn and tightness ─────────────────────────────────────────────────
  const countNe = p.countNe > 0 ? p.countNe : 30;
  const dMm = 0.907 / Math.sqrt(countNe);                 // 1 / (28 √Ne) inch
  const llMm = p.llMm > 0 ? p.llMm : 2.6;
  const tex = p.tex > 0 ? p.tex : 590.5 / countNe;
  const tf = p.tf > 0 ? p.tf : Math.sqrt(tex) / (llMm / 10);
  // A tight fabric has no room to buckle; a slack one buckles further.
  const tightK = clamp(Math.sqrt(TF_REF / tf), 0.75, 1.25);

  // ── Geometry ───────────────────────────────────────────────────────────
  const heldElong = 1 + nHold * ALPHA_COMP * 0.92;        // H_held / H0 with C ≈ 0.92 H0
  const reliefD = (nTuck > 0 ? 1.25 + 1.25 * nTuck : 0.9 * nHold) * tightK * fibreK * (double ? 0.6 : 1);
  const reliefMm = reliefD * dMm;
  let spread = 1 + 0.68 * holdFrac + 0.03 * Math.max(0, nTuck - 1);
  if (double) spread = 1 + (spread - 1) * 0.4;            // the second bed holds the wales
  if (elastane) spread = 1 + (spread - 1) * 0.6;
  // Sideways lean of the knit wales toward a tucking neighbour — the wale
  // zig-zag of a Lacoste face — as a fraction of one wale.
  const lean = clamp((spread - 1) * 0.5, 0, 0.2);

  // ── Density at the requested GSM ───────────────────────────────────────
  const llCm = llMm / 10;
  // Single bed: Munden's wale constant. A double knit's width is set by the
  // needle pitch, not the loop (each face shows one bed's needles, relaxed
  // ~1.55x closer than on the machine) — Munden's single-jersey constants
  // overstate its wales by nearly double.
  const gauge = p.gauge > 0 ? p.gauge : 24;
  const wpc = double
    ? (gauge / 2.54) * 1.55 / spread
    : (KW_SINGLE / llCm) / spread;
  const cpcJersey = KC_SINGLE / llCm;
  // Mass balance: GSM = rows/cm · wales/cm · (yarn per needle per row,
  // summed over beds) · tex / 10. A knit or tuck draws one stitch length; a
  // miss leaves only a float about one needle pitch long.
  const yarnPerRow = (s) => (s ? (1 - s.miss_fraction) * llCm + s.miss_fraction / wpc : 0);
  const yarnRow = yarnPerRow(cyl) + (double ? yarnPerRow(dial || cyl) : 0);
  const cpc = p.gsm > 0 ? (p.gsm * 10) / (wpc * yarnRow * tex) : cpcJersey;
  // Against plain jersey at the same stitch length. Not meaningful for a
  // double knit (no single-jersey reference), so not judged there.
  const compression = double ? null : cpc / cpcJersey;
  const plausible = double ? true : compression > 0.85 && compression < 1.7;
  const beds = double ? 2 : 1;

  // ── Cell size and how far away it still reads ──────────────────────────
  const cellW = (cyl.cols / wpc) * 10;                    // mm, one repeat across
  const cellH = (Math.max(cyl.rows, dial ? dial.rows : 0) / cpc) * 10;
  const cellMm = Math.min(cellW, cellH);
  const visibleM = cellMm / 1000 / (EYE_ARCMIN_M * TEXTURE_ARCMIN);

  // ── GSM position ───────────────────────────────────────────────────────
  const [lo, hi] = fam.gsm;
  let gsmPos = 'typical', gsmNote = 'Within the weight this structure is normally made at.';
  if (p.gsm && p.gsm < lo * 0.95) {
    gsmPos = 'light';
    gsmNote = 'Lighter than usual: finer yarn and smaller, shallower cells; the piqué reads more as a texture than a cell.';
  } else if (p.gsm && p.gsm > hi * 1.05) {
    gsmPos = 'heavy';
    gsmNote = 'Heavier than usual: coarser yarn, bigger but more packed cells; firmer hand, relief flattens slightly.';
  }

  // Curl relative to plain jersey. Tucks lock the loops; a double knit does not curl.
  const curl = double ? 0 : clamp(1 - 1.2 * holdFrac, 0.15, 1);

  // Thickness: one bed is about 2 yarn diameters, plus the cell relief.
  const thicknessMm = (double ? 4 : 2.2) * dMm + reliefMm * (double ? 0.5 : 1);

  return {
    fabric_id: p.fabricId,
    bed: fam.bed,
    also_known_as: fam.aka,
    selling_face: fam.face,
    notation: {
      cylinder: C,
      dial: Array.isArray(D) ? D : null,
      feeds: cyl.rows,
      repeat: { wales: Math.max(cyl.cols, dial ? dial.cols : 0), courses: Math.max(cyl.rows, dial ? dial.rows : 0) },
    },
    tuck: {
      tuck_fraction: round(holdFrac, 3),
      consecutive_tucks: nTuck,
      consecutive_holds: nHold,
      held_loops_per_repeat: active.reduce((a, s) => a + s.held_loops, 0),
      plain_courses_per_repeat: cyl.plain_courses,
    },
    geometry: {
      held_loop_elongation: round(heldElong),
      course_compression_alpha: ALPHA_COMP,
      relief_yarn_diameters: round(reliefD),
      relief_mm: round(reliefMm),
      wale_spread: round(spread),
      wale_lean: round(lean, 3),
      yarn_diameter_mm: round(dMm, 3),
      tightness_factor: round(tf, 1),
      tightness_effect: round(tightK),
      fibre: fibre + (elastane ? ' + elastane' : ''),
      fibre_effect: round(fibreK),
    },
    density: {
      wales_per_cm: round(wpc, 1),
      courses_per_cm: round(cpc, 1),
      stitches_per_cm2: Math.round(wpc * cpc * beds),
      course_compression_vs_jersey: compression == null ? null : round(compression),
      plausible,
      note: plausible
        ? 'Courses solved from the requested GSM at this count and stitch length.'
        : 'The requested GSM needs an unusual course density for this structure at this count and stitch length — check the yarn or stitch length.',
    },
    cell: {
      width_mm: round(cellW),
      height_mm: round(cellH),
      readable_up_to_m: round(visibleM, 1),
    },
    gsm_fit: { typical: fam.gsm, position: gsmPos, note: gsmNote },
    behaviour: {
      curl_vs_jersey: round(curl),
      width_vs_jersey_pct: Math.round((spread - 1) * 100),
      thickness_mm: round(thicknessMm),
    },
    appearance: fam.look,
    estimate: true,
  };
}

module.exports = { analyzePique, isPique, tuckStats, PIQUE_FAMILY };
