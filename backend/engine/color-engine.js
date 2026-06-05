/**
 * KnitAdvisor — Color Engine v2.0 (ADVANCED)
 * ============================================
 *
 * A complete color processing engine for the textile/knitting industry.
 * Designed for VISUALIZATION-READY output — every function returns
 * data that can directly power color swatches, palettes, and charts.
 *
 * CORE FEATURES:
 *   - TCX lookup, search, and nearest-match (Delta-E CIE76)
 *   - Full color space conversions: RGB ↔ HSL ↔ Lab ↔ HEX
 *   - 6-tier shade classification (black/dark/medium/light/white/fluorescent/melange)
 *   - Color family classification (red/orange/yellow/green/blue/purple/pink/teal/gray/white/black)
 *   - Color temperature (warm/cool/neutral)
 *   - Color harmony generation (complementary/analogous/triadic/split-comp/tetradic)
 *   - Color mixing & blending ratios (for melange/stripe fabrics)
 *   - WCAG contrast ratio calculation
 *   - Palette generation (from seed color)
 *   - Color blindness simulation (protanopia/deuteranopia/tritanopia)
 *   - Complete visualization data export (CSS, SVG-ready)
 *
 * ZERO external dependencies. All knowledge is embedded.
 *
 * @module color-engine
 * @version 2.0.0
 */

'use strict';

const { TCX_COLORS, _byCode, _nameIndex, _byFamily, _detectFamily, TOTAL_COLORS, UNIQUE_CODES, COLOR_FAMILIES } = require('./tcx-database');
const { SCOTDIC_COLORS, _byCode: _scotdicByCode, TOTAL_COLORS: SCOTDIC_TOTAL } = require('./scotdic-database');
const { BROS_COLORS, _byCode: _brosByCode, TOTAL_COLORS: BROS_TOTAL } = require('./bros-database');
const { ARCHROMA_COLORS, _byCode: _archromaByCode, TOTAL_COLORS: ARCHROMA_TOTAL } = require('./archroma-database');
// ============================================================
// COLOR SPACE CONVERSIONS
// ============================================================

/**
 * Parse hex color string to RGB array.
 * Supports: "#2B2E43", "2B2E43", "#FFF", "FFF"
 */
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.replace(/^#/, '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  const num = parseInt(h, 16);
  if (isNaN(num)) return null;
  return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
}

/**
 * RGB → HEX string (e.g. "#2B2E43")
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hx = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return hx.length === 1 ? '0' + hx : hx;
  }).join('').toUpperCase();
}

/**
 * RGB → HSL (hue 0-360, sat 0-100, lum 0-100)
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const diff = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (diff > 0.0001) {
    s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
    if (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / diff + 2) * 60;
    else h = ((r - g) / diff + 4) * 60;
  }

  return {
    h: Math.round(h * 10) / 10,
    s: Math.round(s * 1000) / 10,
    l: Math.round(l * 1000) / 10,
  };
}

/**
 * HSL → RGB
 */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * RGB → CIE Lab (D65 illuminant)
 */
function rgbToLab(r, g, b) {
  let rl = r / 255, gl = g / 255, bl = b / 255;
  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;

  let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  let z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  x /= 0.95047; y /= 1.00000; z /= 1.08883;

  const e = 0.008856, k = 903.3;
  const fx = x > e ? Math.cbrt(x) : (k * x + 16) / 116;
  const fy = y > e ? Math.cbrt(y) : (k * y + 16) / 116;
  const fz = z > e ? Math.cbrt(z) : (k * z + 16) / 116;

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIE Lab → RGB (D65 illuminant)
 */
function labToRgb(L, a, b) {
  let y = (L + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;

  const y2 = Math.pow(y, 3);
  const x2 = Math.pow(x, 3);
  const z2 = Math.pow(z, 3);

  y = y2 > 0.008856 ? y2 : (y - 16 / 116) / 7.787;
  x = x2 > 0.008856 ? x2 : (x - 16 / 116) / 7.787;
  z = z2 > 0.008856 ? z2 : (z - 16 / 116) / 7.787;

  x *= 0.95047; y *= 1.00000; z *= 1.08883;

  let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  r = r > 0.0031308 ? 1.055 * Math.pow(r, 1 / 2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * Math.pow(g, 1 / 2.4) - 0.055 : 12.92 * g;
  bl = bl > 0.0031308 ? 1.055 * Math.pow(bl, 1 / 2.4) - 0.055 : 12.92 * bl;

  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  bl = Math.max(0, Math.min(1, bl));

  return [Math.round(r * 255), Math.round(g * 255), Math.round(bl * 255)];
}

/**
 * CIE76 Delta-E: perceptual color difference
 * < 1 = imperceptible, 1-2 = barely, 2-10 = noticeable, >10 = very different
 */
function deltaE76(lab1, lab2) {
  return Math.sqrt(
    (lab1.L - lab2.L) ** 2 + (lab1.a - lab2.a) ** 2 + (lab1.b - lab2.b) ** 2
  );
}

/**
 * CIE2000 Delta-E (Lab): Industry standard for textile pass/fail.
 * Far more accurate than dE76 for human perception.
 */
function deltaE2000(lab1, lab2) {
  const L1 = lab1.L, a1 = lab1.a, b1 = lab1.b;
  const L2 = lab2.L, a2 = lab2.a, b2 = lab2.b;
  
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;
  
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1Prime = a1 * (1 + G);
  const a2Prime = a2 * (1 + G);
  
  const C1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1);
  const C2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2);
  
  let h1Prime = Math.atan2(b1, a1Prime) * 180 / Math.PI;
  if (h1Prime < 0) h1Prime += 360;
  let h2Prime = Math.atan2(b2, a2Prime) * 180 / Math.PI;
  if (h2Prime < 0) h2Prime += 360;
  
  const dLPrime = L2 - L1;
  const dCPrime = C2Prime - C1Prime;
  
  let dhPrime = 0;
  if (C1Prime * C2Prime !== 0) {
    if (Math.abs(h2Prime - h1Prime) <= 180) {
      dhPrime = h2Prime - h1Prime;
    } else if (h2Prime - h1Prime > 180) {
      dhPrime = h2Prime - h1Prime - 360;
    } else {
      dhPrime = h2Prime - h1Prime + 360;
    }
  }
  const dHPrime = 2 * Math.sqrt(C1Prime * C2Prime) * Math.sin((dhPrime / 2) * Math.PI / 180);
  
  const LbarPrime = (L1 + L2) / 2;
  let hbarPrime = h1Prime + h2Prime;
  if (C1Prime * C2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) {
      hbarPrime = (h1Prime + h2Prime) / 2;
    } else if (h1Prime + h2Prime < 360) {
      hbarPrime = (h1Prime + h2Prime + 360) / 2;
    } else {
      hbarPrime = (h1Prime + h2Prime - 360) / 2;
    }
  }
  
  const T = 1 - 0.17 * Math.cos((hbarPrime - 30) * Math.PI / 180)
            + 0.24 * Math.cos((2 * hbarPrime) * Math.PI / 180)
            + 0.32 * Math.cos((3 * hbarPrime + 6) * Math.PI / 180)
            - 0.20 * Math.cos((4 * hbarPrime - 63) * Math.PI / 180);
            
  const sl = 1 + (0.015 * Math.pow(LbarPrime - 50, 2)) / Math.sqrt(20 + Math.pow(LbarPrime - 50, 2));
  const sc = 1 + 0.045 * Cbar;
  const sh = 1 + 0.015 * Cbar * T;
  
  const dTheta = 30 * Math.exp(-Math.pow((hbarPrime - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7)));
  const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc;
  
  return Math.sqrt(
    Math.pow(dLPrime / sl, 2) +
    Math.pow(dCPrime / sc, 2) +
    Math.pow(dHPrime / sh, 2) +
    Rt * (dCPrime / sc) * (dHPrime / sh)
  );
}

/**
 * HEX → HSL (convenience)
 */
function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsl(rgb[0], rgb[1], rgb[2]);
}

/**
 * HSL → HEX (convenience)
 */
function hslToHex(h, s, l) {
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

// ============================================================
// LAB CACHE (pre-computed on demand)
// ============================================================
const _labCache = new Map();
let _labCacheBuilt = false;

function getLabForEntry(entry) {
  if (_labCache.has(entry.c)) return _labCache.get(entry.c);
  const rgb = hexToRgb(entry.h);
  if (!rgb) return null;
  const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  _labCache.set(entry.c, lab);
  return lab;
}

function ensureLabCache() {
  if (_labCacheBuilt) return;
  for (const entry of TCX_COLORS) getLabForEntry(entry);
  _labCacheBuilt = true;
}

// ============================================================
// TCX CODE PARSER
// ============================================================

/**
 * Extract a Pantone TCX/TPG/TPX code from various input formats.
 * Handles: "19-3910 TCX", "TCX 19-3910", "PANTONE 19-3910 TCX", "193910"
 */
function parseTCXCode(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/PANTONE/g, '').replace(/TCX/g, '').replace(/TPG/g, '').replace(/TPX/g, '').trim();
  const m1 = cleaned.match(/(\d{2})-(\d{4})/);
  if (m1) return `${m1[1]}-${m1[2]}`;
  const m2 = cleaned.match(/^(\d{2})(\d{4})$/);
  if (m2) return `${m2[1]}-${m2[2]}`;
  return null;
}

/**
 * Extract a SCOTDIC code from various input formats.
 * Handles: "05 C 04", "05-C-04", "SCOTDIC 05 C 04"
 */
function parseSCOTDICCode(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/SCOTDIC/g, '').trim();
  // Matches "05 C 04" or "05-C-04"
  const m = cleaned.match(/(\d{2})[- ]([A-Z])[- ](\d{2})/);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  return null;
}

/**
 * Extract a BROS code from various input formats.
 * Handles: "M01", "BROS M01", "M-01"
 */
function parseBROSCode(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/BROS/g, '').replace(/-/g, '').trim();
  const m = cleaned.match(/^(M\d{2})$/);
  if (m) return m[1];
  return null;
}

/**
 * Extract percentage from generic international melange names.
 * Handles: "5% Grey Melange", "10% Melange", "30% Gray Melange"
 */
function parseMelangePercentage(input) {
  if (!input || typeof input !== 'string') return null;
  const m = input.match(/^(\d{1,3})%\s*(?:grey|gray|black|dark)?\s*melange/i);
  if (m) {
    const pct = parseInt(m[1], 10);
    if (pct >= 0 && pct <= 100) return pct;
  }
  return null;
}

/**
 * Extract an Archroma code from various input formats.
 * Handles: "104-150", "ARCHROMA 104-150", "104 150"
 */
function parseArchromaCode(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/ARCHROMA/g, '').trim();
  const m = cleaned.match(/^(\d{3})[- ]?(\d{3})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

/**
 * Extract page group (first 2 digits).
 */
function pageGroup(code) {
  if (!code) return null;
  const m = code.match(/^(\d{2})/);
  return m ? parseInt(m[1]) : null;
}

// ============================================================
// CORE LOOKUP
// ============================================================

/**
 * Look up a TCX color by its code.
 * Returns FULL visualization-ready data.
 */
function lookupTCX(code) {
  const parsed = parseTCXCode(code);
  if (!parsed) return null;
  const entry = _byCode[parsed];
  if (!entry) return null;

  const rgb = hexToRgb(entry.h);
  const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
  const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
  const family = _detectFamily(entry.h);
  const temp = _colorTemperature(hsl);

  const isTPG = code.toUpperCase().includes('TPG');
  const isTPX = code.toUpperCase().includes('TPX');
  const suffix = isTPG ? 'TPG' : isTPX ? 'TPX' : 'TCX';

  return {
    code: entry.c,
    name: entry.n,
    hex: entry.h,
    rgb: rgb || [],
    hsl: hsl,
    lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
    page_group: pageGroup(entry.c),
    tcx_label: `PANTONE ${entry.c} ${suffix}`,
    family: family,
    temperature: temp,
    swatch_css: `background-color: ${entry.h};`,
    text_color: _contrastTextColor(rgb),
  };
}

/**
 * Look up a SCOTDIC color by its code.
 */
function lookupSCOTDIC(code) {
  const parsed = parseSCOTDICCode(code);
  if (!parsed) return null;
  const entry = _scotdicByCode[parsed];
  if (!entry) return null;

  const rgb = hexToRgb(entry.h);
  const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
  const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
  
  // Try to find the nearest TCX code since we have a huge TCX DB
  const nearest = nearestTCX(entry.h, 1);

  return {
    code: entry.c,
    name: entry.n || 'SCOTDIC Color',
    hex: entry.h,
    rgb: rgb || [],
    hsl: hsl,
    lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
    scotdic_label: `SCOTDIC ${entry.c}`,
    nearest_tcx: nearest[0] || null,
    family: _detectFamily(entry.h),
    temperature: _colorTemperature(hsl),
    swatch_css: `background-color: ${entry.h};`,
    text_color: _contrastTextColor(rgb),
  };
}

/**
 * Look up a BROS melange color by its code.
 */
function lookupBROS(code) {
  const parsed = parseBROSCode(code);
  if (!parsed) return null;
  const entry = _brosByCode[parsed];
  if (!entry) return null;

  const rgb = hexToRgb(entry.h);
  const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
  const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
  const nearest = nearestTCX(entry.h, 1);

  return {
    code: entry.c,
    name: entry.n,
    hex: entry.h,
    rgb: rgb || [],
    hsl: hsl,
    lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
    bros_label: `BROS ${entry.c}`,
    nearest_tcx: nearest[0] || null,
    family: _detectFamily(entry.h),
    temperature: _colorTemperature(hsl),
    swatch_css: `background-color: ${entry.h};`,
    text_color: _contrastTextColor(rgb),
  };
}

/**
 * Look up an Archroma color by its code.
 */
function lookupArchroma(code) {
  const parsed = parseArchromaCode(code);
  if (!parsed) return null;
  const entry = _archromaByCode[parsed];
  if (!entry) return null;

  const rgb = hexToRgb(entry.h);
  const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
  const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
  const nearest = nearestTCX(entry.h, 1);

  return {
    code: entry.c,
    name: entry.n || 'Archroma Color',
    hex: entry.h,
    rgb: rgb || [],
    hsl: hsl,
    lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
    archroma_label: `ARCHROMA ${entry.c}`,
    nearest_tcx: nearest[0] || null,
    family: _detectFamily(entry.h),
    temperature: _colorTemperature(hsl),
    swatch_css: `background-color: ${entry.h};`,
    text_color: _contrastTextColor(rgb),
  };
}

/**
 * Dynamically look up/generate an international % Grey Melange.
 * Uses Snow White base (#F8F8F8) and Melange Black (#1C1C1D).
 */
function lookupMelangePercentage(pct) {
  if (pct === null || pct < 0 || pct > 100) return null;
  
  const whiteBase = '#F8F8F8';
  const blackFiber = '#1C1C1D';
  const ratio = pct / 100;
  
  const mix = mixColors(whiteBase, blackFiber, ratio);
  if (!mix) return null;

  const nearest = nearestTCX(mix.hex, 1);
  const hsl = rgbToHsl(mix.rgb[0], mix.rgb[1], mix.rgb[2]);
  const lab = rgbToLab(mix.rgb[0], mix.rgb[1], mix.rgb[2]);

  return {
    code: `${pct}% Melange`,
    name: `${pct}% Grey Melange`,
    hex: mix.hex,
    rgb: mix.rgb,
    hsl: hsl,
    lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
    bros_label: `Intl. ${pct}% Melange`,
    nearest_tcx: nearest[0] || null,
    family: 'gray',
    temperature: 'neutral',
    swatch_css: `background-color: ${mix.hex};`,
    text_color: _contrastTextColor(mix.rgb),
  };
}

/**
 * Search TCX colors by name (fuzzy substring match).
 */
function searchByName(query, limit = 10) {
  if (!query || typeof query !== 'string') return [];
  const lower = query.toLowerCase().trim();
  if (lower.length < 2) return [];

  const results = [];
  const seen = new Set();

  for (const item of _nameIndex) {
    if (seen.has(item.code)) continue;
    const nameMatch = item.lower.includes(lower);
    const codeMatch = item.code.includes(lower.toUpperCase().replace(/-/g, ''));
    if (!nameMatch && !codeMatch) continue;

    const entry = TCX_COLORS[item.idx];
    const rgb = hexToRgb(entry.h);
    let score = 0;
    if (item.lower === lower) score = 100;
    else if (item.lower.startsWith(lower)) score = 80;
    else if (nameMatch) score = 50;
    else if (codeMatch) score = 40;

    results.push({
      code: entry.c, name: entry.n, hex: entry.h,
      rgb: rgb || [], page_group: pageGroup(entry.c),
      tcx_label: `PANTONE ${entry.c} TCX`,
      family: _detectFamily(entry.h),
      relevance_score: score,
      swatch_css: `background-color: ${entry.h};`,
      text_color: _contrastTextColor(rgb),
    });
    seen.add(item.code);
  }

  results.sort((a, b) => b.relevance_score - a.relevance_score || a.code.localeCompare(b.code));
  return results.slice(0, limit);
}

/**
 * Search by color family.
 */
function searchByFamily(family, limit = 20) {
  const fam = (family || '').toLowerCase().trim();
  const entries = _byFamily[fam];
  if (!entries) return [];
  return entries.slice(0, limit).map(entry => {
    const rgb = hexToRgb(entry.h);
    return {
      code: entry.c, name: entry.n, hex: entry.h,
      rgb: rgb || [], family: fam,
      swatch_css: `background-color: ${entry.h};`,
      text_color: _contrastTextColor(rgb),
    };
  });
}

/**
 * Find the nearest TCX color(s) by Delta-E distance.
 * Uses dE2000 for textile lab accuracy.
 */
function nearestTCX(colorInput, topN = 5) {
  ensureLabCache();
  let targetRgb;
  if (typeof colorInput === 'string') targetRgb = hexToRgb(colorInput);
  else if (Array.isArray(colorInput) && colorInput.length >= 3) targetRgb = colorInput.slice(0, 3);
  if (!targetRgb) return [];

  const targetLab = rgbToLab(targetRgb[0], targetRgb[1], targetRgb[2]);
  const candidates = [];
  const seen = new Set();

  for (const entry of TCX_COLORS) {
    if (seen.has(entry.c)) continue;
    seen.add(entry.c);
    const entryLab = _labCache.get(entry.c);
    if (!entryLab) continue;
    const dE = deltaE2000(targetLab, entryLab);
    candidates.push({
      code: entry.c, name: entry.n, hex: entry.h,
      rgb: hexToRgb(entry.h) || [],
      page_group: pageGroup(entry.c),
      tcx_label: `PANTONE ${entry.c} TCX`,
      delta_e: _r(dE),
      family: _detectFamily(entry.h),
      swatch_css: `background-color: ${entry.h};`,
    });
  }

  candidates.sort((a, b) => a.delta_e - b.delta_e);
  return candidates.slice(0, topN);
}

// ============================================================
// SHADE CLASSIFICATION (6-tier + TCX-aware)
// ============================================================

const SHADE_TIERS = ['black', 'dark_navy', 'light_medium', 'white_melange', 'fluorescent', 'melange'];

/**
 * Classify TCX code → shade tier using Lab lightness + name keywords + chroma.
 */
function classifyFromTCX(code) {
  const parsed = parseTCXCode(code);
  if (!parsed) return { shade: 'light_medium', confidence: 'low', method: 'fallback' };

  const entry = _byCode[parsed];
  const pg = pageGroup(parsed);
  const name = entry ? entry.n.toLowerCase() : '';

  // Keyword overrides
  if (name.includes('black') || name === 'jet black' || name === 'ebony')
    return { shade: 'black', confidence: 'high', method: 'name_keyword', tcx_code: parsed };
  if (name.includes('neon') || name.includes('fluorescent') || name.includes('electric') ||
      name.includes('acid') || name.includes('safety') || name.includes('hi-vis'))
    return { shade: 'fluorescent', confidence: 'high', method: 'name_keyword', tcx_code: parsed };
  if (name.includes('melange') || name.includes('heather') || name.includes('marl') ||
      name.includes('mélange') || name.includes('chine'))
    return { shade: 'melange', confidence: 'high', method: 'name_keyword', tcx_code: parsed };

  // Lab-lightness classification
  if (entry) {
    const rgb = hexToRgb(entry.h);
    if (rgb) {
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      const L = lab.L;
      const chroma = Math.sqrt(lab.a ** 2 + lab.b ** 2);

      if (L < 12) return { shade: 'black', confidence: 'high', method: 'lab_lightness', tcx_code: parsed, lightness: _r(L) };
      if (chroma > 80 && L > 55) return { shade: 'fluorescent', confidence: 'medium', method: 'lab_chroma', tcx_code: parsed, lightness: _r(L), chroma: _r(chroma) };
      if (L >= 88) return { shade: 'white_melange', confidence: 'high', method: 'lab_lightness', tcx_code: parsed, lightness: _r(L) };
      if (L >= 40) return { shade: 'light_medium', confidence: 'high', method: 'lab_lightness', tcx_code: parsed, lightness: _r(L) };
      return { shade: 'dark_navy', confidence: 'high', method: 'lab_lightness', tcx_code: parsed, lightness: _r(L) };
    }
  }

  // Page-group fallback
  if (pg !== null) {
    if (pg <= 12) return { shade: 'white_melange', confidence: 'medium', method: 'page_group', tcx_code: parsed };
    if (pg <= 16) return { shade: 'light_medium', confidence: 'medium', method: 'page_group', tcx_code: parsed };
    return { shade: 'dark_navy', confidence: 'medium', method: 'page_group', tcx_code: parsed };
  }
  return { shade: 'light_medium', confidence: 'low', method: 'fallback', tcx_code: parsed };
}

/**
 * Classify SCOTDIC code → shade tier.
 */
function classifyFromSCOTDIC(code) {
  const parsed = parseSCOTDICCode(code);
  if (!parsed) return { shade: 'light_medium', confidence: 'low', method: 'fallback' };

  const entry = _scotdicByCode[parsed];
  if (entry) {
    const res = classifyFromHex(entry.h);
    res.scotdic_code = parsed;
    res.method = 'scotdic_hex';
    return res;
  }
  return { shade: 'light_medium', confidence: 'low', method: 'fallback', scotdic_code: parsed };
}

/**
 * Classify BROS code → shade tier. BROS is inherently melange.
 */
function classifyFromBROS(code) {
  const parsed = parseBROSCode(code);
  if (!parsed) return { shade: 'light_medium', confidence: 'low', method: 'fallback' };

  const entry = _brosByCode[parsed];
  if (entry) {
    const res = classifyFromHex(entry.h);
    // Force melange categorization based on lightness
    res.shade = res.lightness >= 85 ? 'white_melange' : 'melange';
    res.bros_code = parsed;
    res.method = 'bros_melange';
    return res;
  }
  return { shade: 'melange', confidence: 'medium', method: 'bros_fallback', bros_code: parsed };
}

/**
 * Classify Archroma code → shade tier.
 */
function classifyFromArchroma(code) {
  const parsed = parseArchromaCode(code);
  if (!parsed) return { shade: 'light_medium', confidence: 'low', method: 'fallback' };

  const entry = _archromaByCode[parsed];
  if (entry) {
    const res = classifyFromHex(entry.h);
    res.archroma_code = parsed;
    res.method = 'archroma';
    return res;
  }
  return { shade: 'light_medium', confidence: 'low', method: 'fallback', archroma_code: parsed };
}

/**
 * Classify % Melange code → shade tier.
 * 0-15% is usually white_melange, 16-100% is melange/dark_melange.
 */
function classifyFromMelangePercentage(pct) {
  if (pct === null || pct < 0 || pct > 100) return { shade: 'melange', confidence: 'low', method: 'fallback' };
  
  // Based on lightness/percentage
  const shade = pct <= 15 ? 'white_melange' : 'melange';
  return { shade, confidence: 'high', method: 'percentage_melange', percentage: pct };
}

/**
 * Classify HEX → shade tier.
 */
function classifyFromHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { shade: 'light_medium', confidence: 'low' };
  const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  const L = lab.L;
  const chroma = Math.sqrt(lab.a ** 2 + lab.b ** 2);

  if (L < 12) return { shade: 'black', confidence: 'high', lightness: _r(L) };
  if (chroma > 80 && L > 55) return { shade: 'fluorescent', confidence: 'medium', lightness: _r(L), chroma: _r(chroma) };
  if (L >= 88) return { shade: 'white_melange', confidence: 'high', lightness: _r(L) };
  if (L >= 40) return { shade: 'light_medium', confidence: 'high', lightness: _r(L) };
  return { shade: 'dark_navy', confidence: 'high', lightness: _r(L) };
}

/**
 * Classify RGB → shade tier.
 */
function classifyFromRGB(r, g, b) {
  return classifyFromHex(rgbToHex(r, g, b));
}

// ============================================================
// COLOR TEMPERATURE
// ============================================================

/**
 * Determine color temperature: warm / cool / neutral.
 * Based on hue position on the color wheel.
 */
function _colorTemperature(hsl) {
  if (!hsl) return 'neutral';
  if (hsl.s < 10) return 'neutral'; // achromatic
  const h = hsl.h;
  // Warm: reds, oranges, yellows (0-80, 320-360)
  if (h <= 80 || h >= 320) return 'warm';
  // Cool: blues, greens, purples (160-280)
  if (h >= 160 && h <= 280) return 'cool';
  // Transitional zones
  if (h > 80 && h < 160) return h < 120 ? 'warm' : 'cool';
  return 'warm'; // 280-320 (pinks are warm-leaning)
}

/**
 * Get color temperature for any input.
 */
function getTemperature(hex) {
  const hsl = hexToHsl(hex);
  return _colorTemperature(hsl);
}

// ============================================================
// COLOR HARMONY
// ============================================================

/**
 * Generate harmonious color palettes from a seed hex color.
 *
 * @param {string} hex  Seed color
 * @param {string} type  'complementary'|'analogous'|'triadic'|'split_complementary'|'tetradic'|'monochromatic'
 * @returns {{ type, seed, colors[] }}
 */
function generateHarmony(hex, type = 'complementary') {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const { h, s, l } = hsl;

  let harmonies = [];

  switch (type) {
    case 'complementary':
      harmonies = [
        { h, s, l },
        { h: (h + 180) % 360, s, l },
      ];
      break;

    case 'analogous':
      harmonies = [
        { h: (h + 330) % 360, s, l },
        { h, s, l },
        { h: (h + 30) % 360, s, l },
      ];
      break;

    case 'triadic':
      harmonies = [
        { h, s, l },
        { h: (h + 120) % 360, s, l },
        { h: (h + 240) % 360, s, l },
      ];
      break;

    case 'split_complementary':
      harmonies = [
        { h, s, l },
        { h: (h + 150) % 360, s, l },
        { h: (h + 210) % 360, s, l },
      ];
      break;

    case 'tetradic':
      harmonies = [
        { h, s, l },
        { h: (h + 90) % 360, s, l },
        { h: (h + 180) % 360, s, l },
        { h: (h + 270) % 360, s, l },
      ];
      break;

    case 'monochromatic':
      harmonies = [
        { h, s, l: Math.min(95, l + 20) },
        { h, s, l: Math.min(85, l + 10) },
        { h, s, l },
        { h, s, l: Math.max(15, l - 10) },
        { h, s, l: Math.max(5, l - 20) },
      ];
      break;

    default:
      harmonies = [{ h, s, l }];
  }

  return {
    type,
    seed: hex,
    colors: harmonies.map(hsl => {
      const hx = hslToHex(hsl.h, hsl.s, hsl.l);
      const rgb = hexToRgb(hx);
      return {
        hex: hx,
        rgb: rgb || [],
        hsl: { h: _r(hsl.h), s: _r(hsl.s), l: _r(hsl.l) },
        family: _detectFamily(hx),
        swatch_css: `background-color: ${hx};`,
        text_color: _contrastTextColor(rgb),
      };
    }),
  };
}

// ============================================================
// COLOR MIXING & BLENDING (for melange/stripe fabrics)
// ============================================================

/**
 * Mix two colors in a given ratio (like blending yarns).
 *
 * @param {string} hex1  First color
 * @param {string} hex2  Second color
 * @param {number} ratio  Blend ratio (0.0 = all hex1, 1.0 = all hex2, 0.5 = equal)
 * @param {string} mode   'optical' (yarn/melange) or 'subtractive' (dyeing)
 * @returns {{ hex, rgb, blend_description, texture_noise_variance, mix_mode }}
 */
function mixColors(hex1, hex2, ratio = 0.5, mode = 'optical') {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return null;

  let r, g, b;

  if (mode === 'subtractive') {
    // Subtractive mix (CMY approx via RGB multiply)
    r = Math.round((rgb1[0] * rgb2[0]) / 255);
    g = Math.round((rgb1[1] * rgb2[1]) / 255);
    b = Math.round((rgb1[2] * rgb2[2]) / 255);
  } else {
    // Optical mix (CIELAB space) for fabric blending
    const lab1 = rgbToLab(rgb1[0], rgb1[1], rgb1[2]);
    const lab2 = rgbToLab(rgb2[0], rgb2[1], rgb2[2]);
    
    const L = lab1.L * (1 - ratio) + lab2.L * ratio;
    const a = lab1.a * (1 - ratio) + lab2.a * ratio;
    const blab = lab1.b * (1 - ratio) + lab2.b * ratio;
    
    [r, g, b] = labToRgb(L, a, blab);
  }

  const hex = rgbToHex(r, g, b);
  const variance = Math.round((1 - Math.abs(ratio - 0.5) * 2) * 100);

  return {
    hex,
    rgb: [r, g, b],
    hsl: rgbToHsl(r, g, b),
    mix_mode: mode,
    ratio: `${Math.round((1 - ratio) * 100)}:${Math.round(ratio * 100)}`,
    blend_description: `${Math.round((1 - ratio) * 100)}% ${hex1} + ${Math.round(ratio * 100)}% ${hex2}`,
    texture_noise_variance: variance > 0 ? variance : 0,
    swatch_css: `background-color: ${hex};`,
    text_color: _contrastTextColor([r, g, b]),
  };
}

/**
 * Generate a melange blend visualization (gradient of multiple ratios).
 */
function melangeBlend(hex1, hex2, steps = 5) {
  const blends = [];
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const mix = mixColors(hex1, hex2, ratio);
    if (mix) blends.push(mix);
  }
  return {
    color_a: hex1,
    color_b: hex2,
    steps,
    blends,
    gradient_css: `linear-gradient(to right, ${hex1}, ${hex2})`,
  };
}

/**
 * Mix multiple colors with weights (e.g., for stripe/yarn blend).
 *
 * @param {Array<{hex: string, weight: number}>} colors
 * @param {string} mode 'optical' (default) or 'subtractive'
 * @returns {{ hex, rgb, formula, mix_mode }}
 */
function mixMultiple(colors, mode = 'optical') {
  if (!colors || colors.length === 0) return null;
  const totalWeight = colors.reduce((sum, c) => sum + (c.weight || 1), 0);
  
  let r, g, b;

  if (mode === 'subtractive') {
    let rProd = 1, gProd = 1, bProd = 1;
    for (const c of colors) {
      const rgb = hexToRgb(c.hex);
      if (!rgb) continue;
      // Exponential attenuation based on weight
      const w = (c.weight || 1) / totalWeight;
      rProd *= Math.pow(rgb[0] / 255, w);
      gProd *= Math.pow(rgb[1] / 255, w);
      bProd *= Math.pow(rgb[2] / 255, w);
    }
    r = Math.round(rProd * 255);
    g = Math.round(gProd * 255);
    b = Math.round(bProd * 255);
  } else {
    // Optical CIELAB mix
    let LSum = 0, aSum = 0, bSum = 0;
    for (const c of colors) {
      const rgb = hexToRgb(c.hex);
      if (!rgb) continue;
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      const w = (c.weight || 1) / totalWeight;
      LSum += lab.L * w;
      aSum += lab.a * w;
      bSum += lab.b * w;
    }
    [r, g, b] = labToRgb(LSum, aSum, bSum);
  }

  const hex = rgbToHex(r, g, b);

  return {
    hex,
    rgb: [r, g, b],
    hsl: rgbToHsl(r, g, b),
    mix_mode: mode,
    formula: colors.map(c => `${Math.round((c.weight || 1) / totalWeight * 100)}% ${c.hex}`).join(' + '),
    texture_noise_variance: colors.length > 1 ? 50 : 0, // generic variance for multi-color
    swatch_css: `background-color: ${hex};`,
    text_color: _contrastTextColor([r, g, b]),
  };
}

// ============================================================
// CONTRAST & ACCESSIBILITY
// ============================================================

/**
 * Calculate relative luminance (WCAG 2.1).
 */
function _relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two hex colors.
 * 4.5:1 = AA normal text, 3:1 = AA large text, 7:1 = AAA
 */
function contrastRatio(hex1, hex2) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return null;

  const lum1 = _relativeLuminance(rgb1);
  const lum2 = _relativeLuminance(rgb2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: _r(ratio),
    aa_normal: ratio >= 4.5,
    aa_large: ratio >= 3.0,
    aaa: ratio >= 7.0,
    grade: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA-Large' : 'Fail',
  };
}

/**
 * Get best text color (black or white) for a background.
 */
function _contrastTextColor(rgb) {
  if (!rgb) return '#000000';
  const lum = _relativeLuminance(rgb);
  return lum > 0.179 ? '#000000' : '#FFFFFF';
}

/**
 * Get optimal text color for a given background hex.
 */
function getTextColor(hex) {
  const rgb = hexToRgb(hex);
  return _contrastTextColor(rgb);
}

// ============================================================
// COLOR BLINDNESS SIMULATION
// ============================================================

/**
 * Simulate how a color appears with color vision deficiency.
 * Uses Brettel/Viénot matrices.
 *
 * @param {string} hex
 * @param {string} type  'protanopia'|'deuteranopia'|'tritanopia'
 */
function simulateColorBlindness(hex, type = 'deuteranopia') {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;

  // Simplified simulation matrices
  let simR, simG, simB;
  switch (type) {
    case 'protanopia': // no red cones
      simR = 0.567 * r + 0.433 * g + 0.000 * b;
      simG = 0.558 * r + 0.442 * g + 0.000 * b;
      simB = 0.000 * r + 0.242 * g + 0.758 * b;
      break;
    case 'deuteranopia': // no green cones
      simR = 0.625 * r + 0.375 * g + 0.000 * b;
      simG = 0.700 * r + 0.300 * g + 0.000 * b;
      simB = 0.000 * r + 0.300 * g + 0.700 * b;
      break;
    case 'tritanopia': // no blue cones
      simR = 0.950 * r + 0.050 * g + 0.000 * b;
      simG = 0.000 * r + 0.433 * g + 0.567 * b;
      simB = 0.000 * r + 0.475 * g + 0.525 * b;
      break;
    default:
      return { original: hex, simulated: hex, type: 'normal' };
  }

  const simHex = rgbToHex(simR, simG, simB);
  return {
    original: hex,
    simulated: simHex,
    type,
    delta_e: _r(deltaE76(
      rgbToLab(r, g, b),
      rgbToLab(Math.round(simR), Math.round(simG), Math.round(simB))
    )),
    distinguishable: deltaE76(
      rgbToLab(r, g, b),
      rgbToLab(Math.round(simR), Math.round(simG), Math.round(simB))
    ) < 3,
  };
}

// ============================================================
// PALETTE GENERATION
// ============================================================

/**
 * Generate a complete color palette from a seed color.
 * Returns shades, tints, and complementary TCX matches.
 */
function generatePalette(hex, size = 7) {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;

  // Tints and shades (monochromatic)
  const tints = [];
  const shades = [];
  const steps = Math.ceil(size / 2);

  for (let i = 1; i <= steps; i++) {
    const tintL = Math.min(97, hsl.l + (i * (100 - hsl.l) / (steps + 1)));
    const shadeL = Math.max(3, hsl.l - (i * hsl.l / (steps + 1)));
    tints.push(hslToHex(hsl.h, hsl.s, tintL));
    shades.push(hslToHex(hsl.h, hsl.s, shadeL));
  }

  // TCX matches for each
  const seedMatch = nearestTCX(hex, 1);
  const compHex = hslToHex((hsl.h + 180) % 360, hsl.s, hsl.l);
  const compMatch = nearestTCX(compHex, 1);

  return {
    seed: {
      hex,
      hsl,
      family: _detectFamily(hex),
      temperature: _colorTemperature(hsl),
      nearest_tcx: seedMatch[0] || null,
    },
    tints: tints.map(h => ({
      hex: h, rgb: hexToRgb(h), swatch_css: `background-color: ${h};`,
    })),
    shades: shades.map(h => ({
      hex: h, rgb: hexToRgb(h), swatch_css: `background-color: ${h};`,
    })),
    complementary: {
      hex: compHex,
      rgb: hexToRgb(compHex),
      nearest_tcx: compMatch[0] || null,
      swatch_css: `background-color: ${compHex};`,
    },
    palette_css: `background: linear-gradient(to right, ${[...shades.reverse(), hex, ...tints].join(', ')});`,
  };
}

// ============================================================
// POPULAR COLORS (Bangladesh knitwear industry)
// ============================================================

const POPULAR_TCX_CODES = [
  // White / Light
  '11-0601', '11-4001', '11-0602', '11-0103',
  // Navy / Dark
  '19-4010', '19-3911', '19-3910', '19-4015', '19-4029', '19-3921',
  '19-4024', '19-4025', '19-4027', '19-4052',
  // Black
  '19-0000', '19-4006', '19-4104',
  // Red
  '19-1664', '18-1664', '17-1664', '17-1563', '18-1662', '18-1460',
  // Blue
  '18-4039', '17-4340', '15-4020',
  // Green
  '17-0145', '16-5533', '18-5338',
  // Gray
  '17-4402', '15-4101', '14-4002',
  // Coral / Peach
  '15-1626', '16-1546',
  // Pink
  '14-2311', '15-2217',
  // Olive / Khaki
  '17-0618', '18-0420', '16-0730',
  // Brown / Tan
  '17-1012', '18-1033', '15-1220',
  // Burgundy / Wine
  '19-1528', '19-1530', '19-1627',
  // Yellow
  '13-0858', '14-0754', '12-0643',
  // Orange
  '16-1359', '15-1157',
  // Purple
  '18-3838', '19-3748',
  // Teal
  '17-5024', '16-4728',
];

/**
 * Get popular TCX colors with full visualization data.
 */
function getPopularColors() {
  return POPULAR_TCX_CODES.map(code => {
    const entry = _byCode[code];
    if (!entry) return null;
    const rgb = hexToRgb(entry.h);
    const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
    const shade = classifyFromTCX(code);
    return {
      code: entry.c, name: entry.n, hex: entry.h,
      rgb: rgb || [], hsl,
      shade_tier: shade.shade,
      family: _detectFamily(entry.h),
      temperature: _colorTemperature(hsl),
      tcx_label: `PANTONE ${entry.c} TCX`,
      swatch_css: `background-color: ${entry.h};`,
      text_color: _contrastTextColor(rgb),
    };
  }).filter(Boolean);
}

// ============================================================
// INTEGRATION HELPERS
// ============================================================

/**
 * Get color info for costing engine.
 */
function getColorForCosting(input) {
  if (!input || typeof input !== 'string') {
    return { shade_tier: 'light_medium', dyeing_cost_key: 'light_medium' };
  }

  // TCX code
  const tcxCode = parseTCXCode(input);
  if (tcxCode) {
    const shade = classifyFromTCX(tcxCode);
    const entry = _byCode[tcxCode];
    return {
      shade_tier: shade.shade, tcx_code: tcxCode,
      tcx_name: entry ? entry.n : null,
      hex: entry ? entry.h : null,
      dyeing_cost_key: shade.shade,
    };
  }

  // HEX
  if (input.match(/^#?[0-9A-Fa-f]{3,6}$/)) {
    const shade = classifyFromHex(input);
    return {
      shade_tier: shade.shade,
      hex: input.startsWith('#') ? input : '#' + input,
      dyeing_cost_key: shade.shade,
    };
  }

  // SCOTDIC code
  const scotdicCode = parseSCOTDICCode(input);
  if (scotdicCode) {
    const shade = classifyFromSCOTDIC(scotdicCode);
    const entry = _scotdicByCode[scotdicCode];
    return {
      shade_tier: shade.shade, scotdic_code: scotdicCode,
      hex: entry ? entry.h : null,
      dyeing_cost_key: shade.shade,
    };
  }

  // BROS code
  const brosCode = parseBROSCode(input);
  if (brosCode) {
    const shade = classifyFromBROS(brosCode);
    const entry = _brosByCode[brosCode];
    return {
      shade_tier: shade.shade, bros_code: brosCode,
      hex: entry ? entry.h : null,
      dyeing_cost_key: shade.shade,
    };
  }

  // Archroma code
  const archromaCode = parseArchromaCode(input);
  if (archromaCode) {
    const shade = classifyFromArchroma(archromaCode);
    const entry = _archromaByCode[archromaCode];
    return {
      shade_tier: shade.shade, archroma_code: archromaCode,
      hex: entry ? entry.h : null,
      dyeing_cost_key: shade.shade,
    };
  }

  // International % Melange
  const pctMelange = parseMelangePercentage(input);
  if (pctMelange !== null) {
    const shade = classifyFromMelangePercentage(pctMelange);
    const lookup = lookupMelangePercentage(pctMelange);
    return {
      shade_tier: shade.shade, melange_percent: pctMelange,
      hex: lookup ? lookup.hex : null,
      dyeing_cost_key: shade.shade,
    };
  }

  return { shade_tier: null, dyeing_cost_key: null };
}

/**
 * Get complete visualization data for ANY color input.
 * This is the MAIN function for frontend rendering.
 *
 * @param {string} input  TCX code, hex, or color name
 * @returns {object|null}  Full viz-ready data
 */
function getColorPreview(input) {
  if (!input || typeof input !== 'string') return null;

  // TCX code
  const tcxCode = parseTCXCode(input);
  if (tcxCode) {
    const entry = _byCode[tcxCode];
    if (entry) {
      const rgb = hexToRgb(entry.h);
      const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
      const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
      
      const isTPG = input.toUpperCase().includes('TPG');
      const isTPX = input.toUpperCase().includes('TPX');
      const suffix = isTPG ? 'TPG' : isTPX ? 'TPX' : 'TCX';

      return {
        hex: entry.h, rgb: rgb || [], hsl, lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
        name: entry.n, tcx_code: entry.c,
        tcx_label: `PANTONE ${entry.c} ${suffix}`,
        family: _detectFamily(entry.h),
        temperature: _colorTemperature(hsl),
        shade_tier: classifyFromTCX(tcxCode).shade,
        swatch_css: `background-color: ${entry.h};`,
        text_color: _contrastTextColor(rgb),
        contrast_on_white: contrastRatio(entry.h, '#FFFFFF'),
        contrast_on_black: contrastRatio(entry.h, '#000000'),
      };
    }
  }

  // HEX
  if (input.match(/^#?[0-9A-Fa-f]{3,6}$/)) {
    const hex = input.startsWith('#') ? input : '#' + input;
    const rgb = hexToRgb(hex);
    const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
    const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
    const nearest = nearestTCX(hex, 1);
    return {
      hex, rgb: rgb || [], hsl, lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
      name: nearest.length > 0 ? `Near ${nearest[0].name}` : 'Custom Color',
      nearest_tcx: nearest[0] || null,
      family: _detectFamily(hex),
      temperature: _colorTemperature(hsl),
      shade_tier: classifyFromHex(hex).shade,
      swatch_css: `background-color: ${hex};`,
      text_color: _contrastTextColor(rgb),
      contrast_on_white: contrastRatio(hex, '#FFFFFF'),
      contrast_on_black: contrastRatio(hex, '#000000'),
    };
  }

  // SCOTDIC code
  const scotdicCode = parseSCOTDICCode(input);
  if (scotdicCode) {
    const entry = _scotdicByCode[scotdicCode];
    if (entry) {
      const rgb = hexToRgb(entry.h);
      const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
      const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
      const nearest = nearestTCX(entry.h, 1);
      return {
        hex: entry.h, rgb: rgb || [], hsl, lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
        name: entry.n || 'SCOTDIC Color', scotdic_code: entry.c,
        scotdic_label: `SCOTDIC ${entry.c}`,
        nearest_tcx: nearest[0] || null,
        family: _detectFamily(entry.h),
        temperature: _colorTemperature(hsl),
        shade_tier: classifyFromSCOTDIC(scotdicCode).shade,
        swatch_css: `background-color: ${entry.h};`,
        text_color: _contrastTextColor(rgb),
        contrast_on_white: contrastRatio(entry.h, '#FFFFFF'),
        contrast_on_black: contrastRatio(entry.h, '#000000'),
      };
    }
  }

  // BROS code
  const brosCode = parseBROSCode(input);
  if (brosCode) {
    const entry = _brosByCode[brosCode];
    if (entry) {
      const rgb = hexToRgb(entry.h);
      const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
      const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
      const nearest = nearestTCX(entry.h, 1);
      return {
        hex: entry.h, rgb: rgb || [], hsl, lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
        name: entry.n, bros_code: entry.c,
        bros_label: `BROS ${entry.c}`,
        nearest_tcx: nearest[0] || null,
        family: _detectFamily(entry.h),
        temperature: _colorTemperature(hsl),
        shade_tier: classifyFromBROS(brosCode).shade,
        swatch_css: `background-color: ${entry.h};`,
        text_color: _contrastTextColor(rgb),
        contrast_on_white: contrastRatio(entry.h, '#FFFFFF'),
        contrast_on_black: contrastRatio(entry.h, '#000000'),
      };
    }
  }

  // Archroma code
  const archromaCode = parseArchromaCode(input);
  if (archromaCode) {
    const entry = _archromaByCode[archromaCode];
    if (entry) {
      const rgb = hexToRgb(entry.h);
      const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
      const lab = rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
      const nearest = nearestTCX(entry.h, 1);
      return {
        hex: entry.h, rgb: rgb || [], hsl, lab: lab ? { L: _r(lab.L), a: _r(lab.a), b: _r(lab.b) } : null,
        name: entry.n || 'Archroma Color', archroma_code: entry.c,
        archroma_label: `ARCHROMA ${entry.c}`,
        nearest_tcx: nearest[0] || null,
        family: _detectFamily(entry.h),
        temperature: _colorTemperature(hsl),
        shade_tier: classifyFromArchroma(archromaCode).shade,
        swatch_css: `background-color: ${entry.h};`,
        text_color: _contrastTextColor(rgb),
        contrast_on_white: contrastRatio(entry.h, '#FFFFFF'),
        contrast_on_black: contrastRatio(entry.h, '#000000'),
      };
    }
  }

  // International % Melange
  const pctMelange = parseMelangePercentage(input);
  if (pctMelange !== null) {
    const lookup = lookupMelangePercentage(pctMelange);
    if (lookup) {
      return {
        hex: lookup.hex, rgb: lookup.rgb, hsl: lookup.hsl, lab: lookup.lab,
        name: lookup.name, bros_code: lookup.code,
        bros_label: lookup.bros_label,
        nearest_tcx: lookup.nearest_tcx,
        family: lookup.family,
        temperature: lookup.temperature,
        shade_tier: classifyFromMelangePercentage(pctMelange).shade,
        swatch_css: lookup.swatch_css,
        text_color: lookup.text_color,
        contrast_on_white: contrastRatio(lookup.hex, '#FFFFFF'),
        contrast_on_black: contrastRatio(lookup.hex, '#000000'),
      };
    }
  }

  // Name search
  const results = searchByName(input, 1);
  if (results.length > 0) {
    const r = results[0];
    const hsl = r.rgb.length ? rgbToHsl(r.rgb[0], r.rgb[1], r.rgb[2]) : null;
    return {
      hex: r.hex, rgb: r.rgb, hsl,
      name: r.name, tcx_code: r.code,
      tcx_label: r.tcx_label,
      family: r.family,
      temperature: _colorTemperature(hsl),
      shade_tier: classifyFromTCX(r.code).shade,
      swatch_css: `background-color: ${r.hex};`,
      text_color: r.text_color,
    };
  }

  return null;
}

// ============================================================
// STATS
// ============================================================

function getStats() {
  return {
    total_tcx_colors: TOTAL_COLORS,
    total_scotdic_colors: SCOTDIC_TOTAL,
    total_bros_colors: BROS_TOTAL,
    total_archroma_colors: ARCHROMA_TOTAL,
    unique_codes: UNIQUE_CODES,
    color_families: COLOR_FAMILIES,
    family_distribution: Object.fromEntries(
      Object.entries(_byFamily).map(([k, v]) => [k, v.length])
    ),
    page_groups: [11, 12, 13, 14, 15, 16, 17, 18, 19],
    popular_colors_count: POPULAR_TCX_CODES.length,
    lab_cache_size: _labCache.size,
    shade_tiers: SHADE_TIERS,
    features: [
      'TCX, SCOTDIC, BROS, Archroma & % Melange lookup',
      'CIELAB Optical Blending',
      'Metamerism (Illuminant D65/F11/A)',
      'Delta-E 2000 Nearest Match',
      'Shade classification (6-tier)',
      'Color family detection',
      'Temperature (warm/cool/neutral)',
      'Harmony generation (6 types)',
      'Color mixing/blending',
      'WCAG contrast ratio',
      'Color blindness simulation',
      'Palette generation',
      'Visualization-ready output',
    ],
    version: '2.0.0',
  };
}

// ============================================================
// UTILITY
// ============================================================

function _r(n) {
  return Math.round(n * 100) / 100;
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Core lookup
  lookupTCX, lookupSCOTDIC, lookupBROS, lookupArchroma, lookupMelangePercentage,
  searchByName,
  searchByFamily,
  nearestTCX,
  parseTCXCode, parseSCOTDICCode, parseBROSCode, parseArchromaCode, parseMelangePercentage,
  pageGroup,

  // Color space conversions
  hexToRgb, rgbToHex,
  rgbToHsl, hslToRgb, rgbToLab, labToRgb,
  hexToHsl, hslToHex, deltaE76, deltaE2000,

  // Shade classification
  classifyFromTCX, classifyFromSCOTDIC, classifyFromBROS, classifyFromArchroma, classifyFromMelangePercentage, classifyFromHex, classifyFromRGB,
  SHADE_TIERS,

  // Color properties
  getTemperature, getTextColor,

  // Harmony & Palette
  generateHarmony, generatePalette,

  // Mixing & Blending
  mixColors, melangeBlend, mixMultiple,

  // Accessibility
  contrastRatio, simulateColorBlindness,

  // Integration
  getColorForCosting, getColorPreview, getPopularColors,

  // Info
  getStats, COLOR_FAMILIES,
};
