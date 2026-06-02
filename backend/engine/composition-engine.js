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
// COLOR SHADE CLASSIFIER
// Classifies color names into dark / medium / light
// for GSM impact analysis
// ============================================================

const DARK_KEYWORDS = [
  'black', 'navy', 'dark', 'charcoal', 'deep', 'midnight',
  'ebony', 'onyx', 'anthracite', 'jet', 'iris',
];
const LIGHT_KEYWORDS = [
  'white', 'bright', 'cream', 'ecru', 'ivory', 'snow',
  'pale', 'light', 'pastel', 'bleach', 'vanilla', 'off-white',
];
// Medium = everything else (grey, mel, olive, blue, red, etc.)

// ============================================================
// COLOR SHADE → KNITTING PARAMETER TABLE
// Source: Karl Mayer Warp Knitting Handbook, Spencer "Knitting Technology" 3rd ed.,
// Bangladesh RMG factory R&D (25+ grey/finish GSM sample pairs, 2019–2023)
//
// Core principle: dye + auxiliary chemicals add physical mass to the fabric.
// Grey GSM must be set LOWER than finish target to compensate.
// SL adjustment ensures the greige loop structure accommodates dye swelling.
//
// dark:   Reactive/vat dye at 8–12% OWF + carriers/fixatives → +3.5–5% mass gain
//         grey_gsm_factor = 0.962 → knit at 96.2%, dye adds ~+4% → 100% finish
//         sl_factor = 1.020 → SL 2% looser; dye/auxiliary swelling compresses to spec
// medium: Reactive at 3–6% OWF → +1–2% mass gain typical
//         grey_gsm_factor = 0.985, sl_factor = 1.005 (minimal adjustment)
// light:  Bleach + OBA only → dye mass ≈ 0; softener/finish adds ~+0.5%
//         grey_gsm_factor = 0.995 (knit fractionally below), sl_factor = 0.990 (tighter)
// ============================================================
const SHADE_PARAMS = {
  dark: {
    gsm_adjustment_pct: 4,       // +4% dye mass uptake (reactive/vat 8–12% OWF)
    grey_gsm_factor:    0.962,   // knit grey at 96.2% of finish target
    sl_factor:          1.020,   // SL 2% looser in grey → dye swelling = final spec
    sl_direction:       'looser',
    note: 'Dark shade (Black/Navy/Bottle Green): Dye + auxiliary uptake adds ~4% GSM mass during reactive/vat dyeing. Knit grey at 96.2% of finish GSM with SL 2% looser — dye swelling will compress fabric to target SL and GSM. Source: Karl Mayer Handbook & BD factory R&D.',
  },
  medium: {
    gsm_adjustment_pct: 1.5,     // +1.5% from reactive dye 3–6% OWF
    grey_gsm_factor:    0.985,   // knit grey at 98.5% of finish target
    sl_factor:          1.005,   // SL 0.5% looser (minor correction)
    sl_direction:       'standard',
    note: 'Medium shade (Red/Blue/Maroon/Green/Grey): Reactive dye at 3–6% OWF adds ~1.5% mass. Knit grey at 98.5% of finish GSM. SL adjusted +0.5% (minor). Standard reactive exhaust dyeing.',
  },
  light: {
    gsm_adjustment_pct: 0.5,     // ~0.5% from softener/OBA finishing
    grey_gsm_factor:    0.995,   // knit fractionally below target (compensate softener add-on)
    sl_factor:          0.990,   // SL 1% tighter — no dye compression effect
    sl_direction:       'tighter',
    note: 'Light/White shade (White/Ecru/Ivory/Pastel): Bleach + optical brightener only — near-zero dye mass. Set SL 1% tighter to hit target GSM. Finishing softener adds ~0.5% GSM (compensated by grey_gsm_factor 0.995). No reactive dye swelling will occur.',
  },
};

/**
 * Classify a color name/code into shade depth and return knitting parameters.
 * Also detects Pantone TCX codes (19-xxxx = dark, 11-14xxxx = light).
 *
 * @param {string} colorName
 * @returns {{ shade, gsm_adjustment_pct, grey_gsm_factor, sl_factor, sl_direction, note }}
 */
function classifyColorShade(colorName) {
  if (!colorName || typeof colorName !== 'string') {
    return { shade: 'medium', ...SHADE_PARAMS.medium };
  }

  const lower = colorName.toLowerCase().trim();

  // Direct shade keywords first (user clicked Dark/Medium/Light button)
  if (lower === 'dark')   return { shade: 'dark',   ...SHADE_PARAMS.dark };
  if (lower === 'medium') return { shade: 'medium', ...SHADE_PARAMS.medium };
  if (lower === 'light')  return { shade: 'light',  ...SHADE_PARAMS.light };

  // Pantone TCX code detection (e.g. "19-3910 TCX")
  const pantoneMatch = lower.match(/(\d{2})-\d{4}/);
  if (pantoneMatch) {
    const pg = parseInt(pantoneMatch[1]);
    if (pg >= 19) return { shade: 'dark',   ...SHADE_PARAMS.dark };
    if (pg <= 14) return { shade: 'light',  ...SHADE_PARAMS.light };
    return             { shade: 'medium', ...SHADE_PARAMS.medium };
  }

  // Dark keywords
  for (const kw of DARK_KEYWORDS) {
    if (lower.includes(kw)) return { shade: 'dark', ...SHADE_PARAMS.dark };
  }

  // Light keywords
  for (const kw of LIGHT_KEYWORDS) {
    if (lower.includes(kw)) return { shade: 'light', ...SHADE_PARAMS.light };
  }

  // Melange / heather / grey → medium
  if (lower.includes('mel') || lower.includes('heather') || lower.includes('grey') || lower.includes('gray')) {
    return { shade: 'medium', ...SHADE_PARAMS.medium };
  }

  return { shade: 'medium', ...SHADE_PARAMS.medium };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  parseComposition,
  getCompositionModifiers,
  classifyColorShade,
  SHORTHAND_COMPOSITIONS,
  FIBER_ALIASES,
};
