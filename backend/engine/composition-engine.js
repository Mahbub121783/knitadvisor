/**
 * KnitAdvisor — Composition Engine
 * 
 * Parses user-provided composition strings into structured fiber data,
 * returns factory-trained correction modifiers for count, loop length, GSM.
 * Supports 2-component AND 3-component blends (e.g. 55% Cotton + 40% Polyester + 5% Elastane).
 * 
 * ZERO external dependencies. All knowledge is embedded.
 */

// ============================================================
// FIBER ALIASES — normalize user input to canonical fiber names
// ============================================================
const FIBER_ALIASES = {
  // Cotton variants → 'cotton'
  'cotton':           'cotton',
  'ctn':              'cotton',
  'cot':              'cotton',
  'combed cotton':    'cotton',
  'combed compact cotton': 'cotton',
  'compact cotton':   'cotton',
  'card cotton':      'cotton',
  'bci cotton':       'cotton',
  'bci combed cotton':'cotton',
  'bci combed compact cotton': 'cotton',
  'bci compact cotton': 'cotton',
  'organic cotton':   'cotton',
  'bio cotton':       'cotton',
  'ic2 cotton':       'cotton',
  'ic-2 organic cotton': 'cotton',
  'cmia cotton':      'cotton',
  'recycled cotton':  'cotton',
  'recycle cotton':   'cotton',
  'regenerated cotton': 'cotton',
  're-cycled cotton': 'cotton',
  'cotton slub':      'cotton',
  'bci cotton slub':  'cotton',

  // Polyester → 'polyester'
  'polyester':        'polyester',
  'poly':             'polyester',
  'pet':              'polyester',
  'recycled polyester': 'polyester',
  'recycle polyester':'polyester',
  'recycel polyester':'polyester',
  'eco coolmax':      'polyester',

  // Elastane / Spandex / Lycra → 'elastane'
  'elastane':         'elastane',
  'spandex':          'elastane',
  'lycra':            'elastane',
  'elast':            'elastane',
  'elas':             'elastane',

  // Viscose / Modal → 'viscose'
  'viscose':          'viscose',
  'visocse':          'viscose',
  'viscoss':          'viscose',
  'modal':            'viscose',
  
  // Tencel / Bamboo
  'tencel':           'tencel',
  'lyocell':          'tencel',
  'bamboo':           'bamboo',

  // Nylon
  'nylon':            'nylon',
  'polyamide':        'nylon',
};

// ============================================================
// SHORTHAND COMPOSITIONS — common industry abbreviations
// ============================================================
const SHORTHAND_COMPOSITIONS = {
  // CVC = Chief Value Cotton (cotton > 50%)
  'cvc':       { cotton: 60, polyester: 40 },
  'cvc 60/40': { cotton: 60, polyester: 40 },
  'cvc60/40':  { cotton: 60, polyester: 40 },

  // PC = Polyester Cotton (polyester dominant)
  'pc':        { polyester: 65, cotton: 35 },
  'pc 65/35':  { polyester: 65, cotton: 35 },
  'pc65/35':   { polyester: 65, cotton: 35 },
  't/c':       { polyester: 65, cotton: 35 },
  'tc':        { polyester: 65, cotton: 35 },

  // CP = Cotton Polyester (cotton dominant)
  'cp':        { cotton: 60, polyester: 40 },
  'c/p':       { cotton: 60, polyester: 40 },

  // Pure fibers
  '100% cotton':    { cotton: 100 },
  '100% polyester': { polyester: 100 },
  '100% viscose':   { viscose: 100 },
  '100% tencel':    { tencel: 100 },
  '100% lyocell':   { tencel: 100 },
  '100% bamboo':    { bamboo: 100 },

  // Common lycra blends
  '95/5':           { cotton: 95, elastane: 5 },
  '97/3':           { cotton: 97, elastane: 3 },
};

// ============================================================
// COMPOSITION PARSER
// ============================================================

/**
 * Parse a user-provided composition string into structured fiber data.
 * 
 * Handles:
 *   "100% Cotton"
 *   "95% Cotton 5% Spandex"
 *   "95% Cotton + 05% Spandex"
 *   "60% Cotton + 40% Polyester"
 *   "55% Cotton 40% Polyester 5% Elastane"   ← 3-component
 *   "CVC"
 *   "PC"
 *   "Cotton/Polyester"
 *   "Cotton/Viscose"
 *   etc.
 * 
 * @param {string} input - Raw composition string
 * @returns {{ fibers: {[fiber]: number}, type: string, has_elastane: boolean, elastane_pct: number }}
 */
function parseComposition(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const raw = input.trim();
  const lower = raw.toLowerCase().replace(/\s+/g, ' ');

  // 1. Check shorthand first
  if (SHORTHAND_COMPOSITIONS[lower]) {
    const fibers = { ...SHORTHAND_COMPOSITIONS[lower] };
    return buildResult(fibers);
  }

  // 2. Try parsing percentage patterns: "XX% FiberName"
  //    Supports: "95% Cotton + 5% Spandex" or "55% Cotton 40% Polyester 5% Elastane"
  const pctPattern = /(\d+(?:\.\d+)?)\s*%\s*([a-zA-Z][a-zA-Z\s\-\/]*?)(?=\s*[\+,]|\s+\d+%|\s*$)/gi;
  const matches = [];
  let m;
  while ((m = pctPattern.exec(raw)) !== null) {
    const pct = parseFloat(m[1]);
    const fiberRaw = m[2].trim().toLowerCase();
    const fiber = resolveFiber(fiberRaw);
    if (fiber && pct > 0 && pct <= 100) {
      matches.push({ fiber, pct });
    }
  }

  if (matches.length > 0) {
    const fibers = {};
    matches.forEach(({ fiber, pct }) => {
      fibers[fiber] = (fibers[fiber] || 0) + pct;
    });

    // Validate total sums approximately to 100
    const total = Object.values(fibers).reduce((s, v) => s + v, 0);
    if (total >= 95 && total <= 105) {
      // Normalize to exactly 100 if close
      if (total !== 100) {
        const factor = 100 / total;
        Object.keys(fibers).forEach(f => {
          fibers[f] = Math.round(fibers[f] * factor * 10) / 10;
        });
      }
      return buildResult(fibers);
    }
  }

  // 3. Try "Fiber/Fiber" pattern (e.g. "Cotton/Polyester", "Cotton/Viscose")
  const slashParts = lower.split('/').map(s => s.trim()).filter(Boolean);
  if (slashParts.length === 2) {
    const f1 = resolveFiber(slashParts[0]);
    const f2 = resolveFiber(slashParts[1]);
    if (f1 && f2) {
      // Use industry-standard default ratios
      const ratio = getDefaultRatio(f1, f2);
      return buildResult(ratio);
    }
  }

  // 4. Try single fiber name
  const singleFiber = resolveFiber(lower);
  if (singleFiber) {
    return buildResult({ [singleFiber]: 100 });
  }

  // 5. Could not parse
  return null;
}

/**
 * Resolve a raw fiber name to its canonical form
 */
function resolveFiber(raw) {
  const cleaned = raw.replace(/[^a-z\s\-\/]/g, '').trim();
  if (FIBER_ALIASES[cleaned]) return FIBER_ALIASES[cleaned];

  // Partial match
  for (const [alias, canonical] of Object.entries(FIBER_ALIASES)) {
    if (cleaned.includes(alias) || alias.includes(cleaned)) {
      return canonical;
    }
  }
  return null;
}

/**
 * Get default ratio for two fibers (industry standard)
 */
function getDefaultRatio(f1, f2) {
  const key = [f1, f2].sort().join('_');
  const defaults = {
    'cotton_polyester': { cotton: 60, polyester: 40 },
    'cotton_viscose':   { cotton: 85, viscose: 15 },
    'cotton_elastane':  { cotton: 95, elastane: 5 },
    'cotton_nylon':     { cotton: 80, nylon: 20 },
    'polyester_viscose':{ polyester: 65, viscose: 35 },
    'elastane_polyester': { polyester: 90, elastane: 10 },
    'elastane_viscose': { viscose: 95, elastane: 5 },
  };
  return defaults[key] || { [f1]: 60, [f2]: 40 };
}

/**
 * Build standardized result object from fibers map
 */
function buildResult(fibers) {
  const has_elastane = !!fibers.elastane && fibers.elastane > 0;
  const elastane_pct = fibers.elastane || 0;

  // Determine type
  let type = 'pure';
  const fiberKeys = Object.keys(fibers).filter(f => fibers[f] > 0);
  if (fiberKeys.length === 1) {
    type = 'pure';
  } else if (fiberKeys.length === 2) {
    if (has_elastane) {
      type = 'stretch_blend';
    } else {
      type = 'blend';
    }
  } else if (fiberKeys.length >= 3) {
    type = 'multi_blend';
  }

  // Determine dominant fiber
  let dominant = fiberKeys[0];
  fiberKeys.forEach(f => {
    if (fibers[f] > fibers[dominant]) dominant = f;
  });

  // Display string
  const display = fiberKeys
    .sort((a, b) => fibers[b] - fibers[a])
    .map(f => `${fibers[f]}% ${f.charAt(0).toUpperCase() + f.slice(1)}`)
    .join(' + ');

  return {
    fibers,
    type,
    dominant,
    has_elastane,
    elastane_pct,
    fiber_count: fiberKeys.length,
    display,
  };
}

// ============================================================
// COMPOSITION EFFECT MODIFIERS
// Factory-trained from 2710 R&D records
// ============================================================

/**
 * Get calculation modifiers based on parsed composition.
 * These adjust the base (100% cotton) calculations.
 * 
 * @param {object} parsed - Result from parseComposition()
 * @param {string} fabricId - e.g. 'single_jersey', 'rib_1x1'
 * @returns {{ count_factor, sl_factor, gsm_offset, lycra_denier, feed_type, notes }}
 */
function getCompositionModifiers(parsed, fabricId) {
  if (!parsed) {
    // Default: assume 100% cotton
    return {
      count_factor: 1.0,
      sl_factor: 1.0,
      gsm_offset: 0,
      lycra_denier: null,
      feed_type: null,
      notes: ['Assuming 100% Cotton (no composition specified)'],
    };
  }

  const { fibers, has_elastane, elastane_pct, type, dominant } = parsed;
  const notes = [];
  let count_factor = 1.0;
  let sl_factor = 1.0;
  let gsm_offset = 0;
  let lycra_denier = null;
  let feed_type = null;

  // --- Elastane / Lycra Effect ---
  if (has_elastane) {
    if (elastane_pct <= 3) {
      // Light stretch
      count_factor = 1.02;
      sl_factor = 0.98;
      gsm_offset = 0.08;
      lycra_denier = 20;
      feed_type = 'full_feed';
      notes.push(`Light stretch (${elastane_pct}% elastane) — Full-feed ${lycra_denier}D recommended`);
    } else if (elastane_pct <= 5) {
      // Standard stretch — most common in industry
      count_factor = 1.04;
      sl_factor = 0.95;
      gsm_offset = 0.15;
      lycra_denier = 40;
      feed_type = 'half_feed';
      notes.push(`Standard stretch (${elastane_pct}% elastane) — Half-feed ${lycra_denier}D recommended`);

      // Rib fabrics with elastane tend to use higher denier
      if (fabricId && fabricId.includes('rib')) {
        lycra_denier = 40;
        feed_type = 'half_feed';
        notes.push('Rib + Lycra: Half-feed 40D standard');
      }
    } else if (elastane_pct <= 10) {
      // High stretch
      count_factor = 1.06;
      sl_factor = 0.92;
      gsm_offset = 0.22;
      lycra_denier = 40;
      feed_type = 'full_feed';
      notes.push(`High stretch (${elastane_pct}% elastane) — Full-feed ${lycra_denier}D`);
    } else if (elastane_pct <= 15) {
      // Very high stretch — swimwear/shapewear-tier rib. Previously ANY
      // elastane % above 10 fell through every branch here and silently
      // reset to count_factor/sl_factor = 1.0, lycra_denier/feed_type =
      // null — i.e. treated as if the fabric had NO elastane at all, even
      // though has_elastane was still true. 12-30% is completely normal for
      // compression/swimwear/powernet-style fabrics, so this wasn't an edge
      // case — it silently broke the single most elastane-heavy segment.
      count_factor = 1.08;
      sl_factor = 0.90;
      gsm_offset = 0.28;
      lycra_denier = 70;
      feed_type = 'full_feed';
      notes.push(`Very high stretch (${elastane_pct}% elastane) — Full-feed ${lycra_denier}D, compression/shapewear-tier`);
    } else if (elastane_pct <= 22) {
      // Compression / swimwear
      count_factor = 1.10;
      sl_factor = 0.87;
      gsm_offset = 0.35;
      lycra_denier = 70;
      feed_type = 'full_feed';
      notes.push(`Compression stretch (${elastane_pct}% elastane) — Full-feed ${lycra_denier}D, swimwear/compression-tier`);
    } else {
      // Power-mesh / extreme compression (foundation garments, medical)
      count_factor = 1.13;
      sl_factor = 0.84;
      gsm_offset = 0.45;
      lycra_denier = 140;
      feed_type = 'full_feed';
      notes.push(`Extreme stretch (${elastane_pct}% elastane) — Full-feed ${lycra_denier}D, power-mesh/foundation-tier`);
    }
  }

  // --- Polyester Blend Effect ---
  if (fibers.polyester && fibers.polyester > 0 && fibers.polyester < 100) {
    const polyPct = fibers.polyester;

    if (polyPct >= 50) {
      // Poly-dominant (PC fabric)
      count_factor *= 0.93;
      sl_factor *= 1.03;
      gsm_offset -= 0.05;
      notes.push(`Polyester dominant (${polyPct}%) — lighter per GSM, tighter loop, finer count`);
    } else if (polyPct >= 30) {
      // CVC range
      count_factor *= 0.97;
      sl_factor *= 1.02;
      gsm_offset -= 0.03;
      notes.push(`Cotton-poly blend (${polyPct}% poly) — slight count/GSM adjustment`);
    } else {
      // Small poly content (< 30%)
      count_factor *= 0.99;
      notes.push(`Minor polyester content (${polyPct}%)`);
    }
  }

  // --- Viscose / Modal Effect ---
  if (fibers.viscose && fibers.viscose > 0) {
    const visPct = fibers.viscose;
    if (visPct >= 50) {
      count_factor *= 1.05;
      sl_factor *= 0.98;
      gsm_offset += 0.02;
      notes.push(`Viscose dominant (${visPct}%) — heavier drape, slightly higher count`);
    } else {
      count_factor *= 1.02;
      notes.push(`Viscose blend (${visPct}%) — softer hand feel`);
    }
  }

  // --- 100% Polyester ---
  if (fibers.polyester === 100) {
    count_factor = 0.85;
    sl_factor = 1.05;
    gsm_offset = -0.08;
    notes.push('100% Polyester — denier-based system recommended; count_factor is approximate');
  }

  // --- 3-component blend (e.g. Cotton+Poly+Elastane) ---
  if (parsed.fiber_count >= 3) {
    notes.push(`Multi-blend (${parsed.fiber_count} fibers) — modifiers combined from each component`);
  }

  return {
    count_factor: Math.round(count_factor * 1000) / 1000,
    sl_factor: Math.round(sl_factor * 1000) / 1000,
    gsm_offset: Math.round(gsm_offset * 1000) / 1000,
    lycra_denier,
    feed_type,
    notes,
  };
}

// ============================================================
// COLOR SHADE CLASSIFIER — 6-tier (official price list: Black | Dark/Navy | Light/Medium | Neon/Fluorescent | White/Melange + Melange)
// ============================================================

const BLACK_KEYWORDS   = ['black','noir','jet black','jet-black','deep black','pure black','onyx','ebony','99x','906'];
const DARK_KEYWORDS    = ['navy','dark','charcoal','anthracite','midnight','bottle','maroon','wine','burgundy','deep','iron','slate dark','olive dark','khaki dark'];
const FLUORO_KEYWORDS  = ['neon','fluorescent','fluro','fluoro','electric','lime green','safety','hi-vis','hivis','acid'];
const MELANGE_KEYWORDS = ['melange','mélange','marl','heather','mel grey','grey mel','chine','gris chine','ecru mel','vigore','vigo'];
const WHITE_KEYWORDS   = ['white','ecru','ivory','cream','snow','off white','off-white','optic','optical','bright white','bleach','vanilla','natural','rfd','lucent','gardenia','oyster'];
const LIGHT_KEYWORDS   = ['light','pale','pastel','sky','blush','pink','peach','coral','lemon','mint','sand','beige','nude','powder','lavender','lilac'];

// ── SHADE PARAMETERS ──────────────────────────────────────────────────────────
const SHADE_PARAMS = {
  black: {
    gsm_adjustment_pct: 5.0, grey_gsm_factor: 0.952,
    sl_factor: 1.030, sl_direction: 'looser', dyeing_tier: 'black',
    note: 'BLACK: Vat/reactive black 10-15% OWF adds ~5% mass. Knit grey at 95.2% finish GSM, SL 3% looser.',
  },
  dark_navy: {
    gsm_adjustment_pct: 4.0, grey_gsm_factor: 0.962,
    sl_factor: 1.020, sl_direction: 'looser', dyeing_tier: 'dark_navy',
    note: 'DARK/NAVY: Reactive 6-10% OWF adds ~4% mass. Knit grey at 96.2% finish GSM, SL 2% looser.',
  },
  light_medium: {
    gsm_adjustment_pct: 2.0, grey_gsm_factor: 0.980,
    sl_factor: 1.008, sl_direction: 'slight_loose', dyeing_tier: 'light_medium',
    note: 'LIGHT/MEDIUM: Reactive 1-6% OWF, avg +2% mass. Knit grey at 98% finish GSM. Minor SL adjustment.',
  },
  fluorescent: {
    gsm_adjustment_pct: 2.5, grey_gsm_factor: 0.976,
    sl_factor: 1.010, sl_direction: 'standard', dyeing_tier: 'fluorescent',
    note: 'NEON/FLUORESCENT: Special fluorescent reactive dyes, +2.5% mass. Premium dyeing cost. Sensitive to wash temp/UV.',
  },
  white_melange: {
    gsm_adjustment_pct: 0.5, grey_gsm_factor: 0.995,
    sl_factor: 0.990, sl_direction: 'tighter', dyeing_tier: 'white_melange',
    note: 'WHITE/MELANGE: Bleach + OBA + softener only, near-zero dye mass. SL 1% tighter. No reactive dye swelling.',
  },
  melange: {
    gsm_adjustment_pct: 0.3, grey_gsm_factor: 0.997,
    sl_factor: 0.995, sl_direction: 'neutral', dyeing_tier: 'white_melange',
    note: 'MELANGE/HEATHER: Color from yarn blend (pre-dyed fiber) — NO reactive dyeing. OBA + softener only. Viscose melange needs separate viscose bath.',
  },
};
// Legacy 3-tier aliases for engine fallbacks
SHADE_PARAMS.dark   = { ...SHADE_PARAMS.dark_navy,    shade_alias_of: 'dark_navy' };
SHADE_PARAMS.medium = { ...SHADE_PARAMS.light_medium, shade_alias_of: 'light_medium' };
SHADE_PARAMS.light  = { ...SHADE_PARAMS.white_melange,shade_alias_of: 'white_melange' };

// ── SHADE DEPTH (continuous %OWF) ───────────────────────────────────────────
// The 6-tier system above is 6 fixed buckets; real dyeing is a continuous
// dye-concentration scale (%OWF — dye weight on weight of fabric), and the
// SAME 4 buckets already document their real %OWF ranges in their notes
// (white_melange ≈0%, light_medium 1-6%, dark_navy 6-10%, black 10-15%).
// These are real calibration anchors, not invented numbers — this just
// interpolates/extrapolates BETWEEN them (same technique already used for
// heavy-GSM count/SL extrapolation in factory-knowledge.js) so a user who
// knows their actual dye recipe %OWF gets a continuously-scaled mass-gain
// and SL factor instead of snapping to the nearest of 6 buckets.
const OWF_DEPTH_ANCHORS = [
  { owf: 0,    mass_pct: 0.3, sl_factor: 0.990 },  // white/melange — bleach+OBA only
  { owf: 3.5,  mass_pct: 2.0, sl_factor: 1.008 },  // light/medium reactive midpoint
  { owf: 8.0,  mass_pct: 4.0, sl_factor: 1.020 },  // dark/navy reactive midpoint
  { owf: 12.5, mass_pct: 5.0, sl_factor: 1.030 },  // black vat/reactive midpoint
];

/**
 * Classify shade from a continuous dye-depth %OWF value instead of a fixed
 * tier button. Interpolates between OWF_DEPTH_ANCHORS; extrapolates linearly
 * from the last segment's slope beyond the highest anchor (e.g. triple-dip
 * black > 15% OWF), floored so mass gain never goes negative.
 * @param {number} owfPct  Dye concentration, % on weight of fabric (0-25 typical)
 * @returns {{ shade, dyeing_tier, gsm_adjustment_pct, grey_gsm_factor, sl_factor, sl_direction, owf_pct, continuous, note }}
 */
function classifyShadeByDepth(owfPct) {
  const pct = Math.max(0, Math.min(25, parseFloat(owfPct)));
  const anchors = OWF_DEPTH_ANCHORS;
  let lower = anchors[0], upper = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (pct >= anchors[i].owf && pct <= anchors[i + 1].owf) { lower = anchors[i]; upper = anchors[i + 1]; break; }
  }
  let mass, sl;
  if (pct <= anchors[0].owf) {
    mass = anchors[0].mass_pct; sl = anchors[0].sl_factor;
  } else if (pct >= anchors[anchors.length - 1].owf) {
    // extrapolate from the last real segment's slope
    const a = anchors[anchors.length - 2], b = anchors[anchors.length - 1];
    const dOwf = pct - b.owf;
    const slopeMass = (b.mass_pct - a.mass_pct) / (b.owf - a.owf);
    const slopeSl = (b.sl_factor - a.sl_factor) / (b.owf - a.owf);
    mass = Math.max(0, b.mass_pct + slopeMass * dOwf);
    sl = b.sl_factor + slopeSl * dOwf;
  } else {
    const ratio = (pct - lower.owf) / (upper.owf - lower.owf);
    mass = lower.mass_pct + ratio * (upper.mass_pct - lower.mass_pct);
    sl = lower.sl_factor + ratio * (upper.sl_factor - lower.sl_factor);
  }
  // Nearest discrete tier — needed by consumers that key real production data
  // off the 6-tier name (e.g. grey-GSM-by-family lookup), not by %OWF.
  let shade = 'white_melange';
  if (pct >= 10) shade = 'black';
  else if (pct >= 6) shade = 'dark_navy';
  else if (pct >= 1) shade = 'light_medium';
  return {
    shade, dyeing_tier: shade,
    gsm_adjustment_pct: parseFloat(mass.toFixed(2)),
    grey_gsm_factor: parseFloat((1 / (1 + mass / 100)).toFixed(4)),
    sl_factor: parseFloat(sl.toFixed(4)),
    sl_direction: mass > 0.6 ? 'looser' : 'neutral',
    owf_pct: pct,
    continuous: true,
    note: `Continuous shade-depth: ${pct}% OWF → +${mass.toFixed(1)}% mass gain (interpolated from the same real dye-recipe anchors the 6-tier buttons use).`,
  };
}

/**
 * Classify a color name/code into the 6-tier shade system.
 * @param {string} colorName
 * @returns {{ shade, dyeing_tier, gsm_adjustment_pct, grey_gsm_factor, sl_factor, sl_direction, note }}
 */
function classifyColorShade(colorName) {
  if (!colorName || typeof colorName !== 'string') {
    return { shade: 'light_medium', ...SHADE_PARAMS.light_medium };
  }
  const lower = colorName.toLowerCase().trim();

  // Direct 6-tier keys
  if (lower === 'black')         return { shade: 'black',        ...SHADE_PARAMS.black };
  if (lower === 'dark_navy')     return { shade: 'dark_navy',    ...SHADE_PARAMS.dark_navy };
  if (lower === 'light_medium')  return { shade: 'light_medium', ...SHADE_PARAMS.light_medium };
  if (lower === 'fluorescent')   return { shade: 'fluorescent',  ...SHADE_PARAMS.fluorescent };
  if (lower === 'white_melange') return { shade: 'white_melange',...SHADE_PARAMS.white_melange };
  if (lower === 'melange')       return { shade: 'melange',      ...SHADE_PARAMS.melange };

  // Legacy 3-tier compat
  if (lower === 'dark')   return { shade: 'dark_navy',    ...SHADE_PARAMS.dark_navy };
  if (lower === 'medium') return { shade: 'light_medium', ...SHADE_PARAMS.light_medium };
  if (lower === 'light')  return { shade: 'white_melange',...SHADE_PARAMS.white_melange };

  // Pantone TCX (e.g. "19-3910 TCX") — uses color-engine for accurate Lab-lightness classification
  const pm = lower.match(/(\d{2})-\d{4}/);
  if (pm) {
    try {
      const colorEngine = require('./color-engine');
      const tcxResult = colorEngine.classifyFromTCX(lower);
      if (tcxResult && tcxResult.shade && SHADE_PARAMS[tcxResult.shade]) {
        return { shade: tcxResult.shade, ...SHADE_PARAMS[tcxResult.shade], tcx_classification: tcxResult };
      }
    } catch (_) { /* color-engine not available, fall through to page-group */ }
    // Page-group fallback if color-engine unavailable
    const pg = parseInt(pm[1]);
    if (pg >= 19) return { shade: 'dark_navy',    ...SHADE_PARAMS.dark_navy };
    if (pg <= 12) return { shade: 'white_melange',...SHADE_PARAMS.white_melange };
    if (pg <= 16) return { shade: 'light_medium', ...SHADE_PARAMS.light_medium };
    return               { shade: 'dark_navy',    ...SHADE_PARAMS.dark_navy };
  }

  // HEX color code (e.g. "#2B2E43", "#FFF")
  if (lower.match(/^#?[0-9a-f]{3,6}$/)) {
    try {
      const colorEngine = require('./color-engine');
      const hexResult = colorEngine.classifyFromHex(lower.startsWith('#') ? lower : '#' + lower);
      if (hexResult && hexResult.shade && SHADE_PARAMS[hexResult.shade]) {
        return { shade: hexResult.shade, ...SHADE_PARAMS[hexResult.shade], hex_classification: hexResult };
      }
    } catch (_) { /* color-engine not available, fall through */ }
  }

  // Keyword matching (most specific first)
  for (const kw of FLUORO_KEYWORDS)  if (lower.includes(kw)) return { shade: 'fluorescent',  ...SHADE_PARAMS.fluorescent };
  for (const kw of MELANGE_KEYWORDS) if (lower.includes(kw)) return { shade: 'melange',      ...SHADE_PARAMS.melange };
  for (const kw of BLACK_KEYWORDS)   if (lower.includes(kw)) return { shade: 'black',        ...SHADE_PARAMS.black };
  for (const kw of DARK_KEYWORDS)    if (lower.includes(kw)) return { shade: 'dark_navy',    ...SHADE_PARAMS.dark_navy };
  for (const kw of WHITE_KEYWORDS)   if (lower.includes(kw)) return { shade: 'white_melange',...SHADE_PARAMS.white_melange };
  for (const kw of LIGHT_KEYWORDS)   if (lower.includes(kw)) return { shade: 'light_medium', ...SHADE_PARAMS.light_medium };

  if (lower.includes('aop') || lower.includes('rfd')) return { shade: 'white_melange', ...SHADE_PARAMS.white_melange };
  if (lower.includes('y/d') || lower.includes('yd'))  return { shade: 'light_medium',  ...SHADE_PARAMS.light_medium };

  return { shade: 'light_medium', ...SHADE_PARAMS.light_medium };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  parseComposition,
  getCompositionModifiers,
  classifyColorShade,
  classifyShadeByDepth,
  SHORTHAND_COMPOSITIONS,
  FIBER_ALIASES,
};
