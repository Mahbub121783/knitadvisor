/**
 * KnitAdvisor — Melange engine: from the fibre in the bale to the yarn in the fabric.
 *
 * A melange, marl or heather yarn is a COLOUR made by construction. The engine builds it the way a mill does,
 * stage by stage, and every stage is a law or a stated typical figure — never a lookup of a finished answer:
 *
 *   1  WHAT IT IS      the construction: fibre melange (blow-room or draw-frame blend), Siro marl, folded marl /
 *                      grindle, slub or nep melange, or a cross-dyed heather made in the fabric.
 *   2  THE MASS CHAIN  the shares a buyer reads (conditioned, "90/10") are not the shares in the bale. Fibres hold
 *                      different moisture (cotton 8.5 %, viscose 13 %, polyester 0.4 %) and lose different amounts
 *                      in blow room, card and comb. Label share → dry share → what the mill must WEIGH, and what
 *                      the shade does if the bales are weighed at the nominal ratio.
 *   3  THE COLOUR      the blend colour from the component colours (fibres: absorption on surface-area weights;
 *                      marl: domains of colour, mixed in the eye), the trade shade it is, how steeply it moves
 *                      with a point of share, and the shade variation the route will give.
 *   4  THE MIXING      random-mix statistics: fibres in the section, the binomial spread of the blend ratio, the
 *                      sliver-weight arithmetic of a draw-frame creel (whole slivers only), blow-room feeders.
 *   5  THE YARN        resultant count of plies and Siro strands, diameter, twist, evenness, hairiness, strength
 *                      with what dyed fibre costs (the parts engine plus the melange corrections).
 *   6  THE MARL LOOK   where the colours fall along the yarn against the stitch length (tracking, checking).
 *   7  THE KNITTING    strength against running tension, lubrication, lint, lot discipline.
 *   8  THE WET ROUTE   pre-coloured yarn needs no dyeing (a mild wash and a bio-polish); a cross-dyed heather
 *                      needs the dye class each fibre takes, in the order the chemistry allows.
 *   9  THE DEFECTS     the risks this construction carries, ranked, each with its remedy.
 *
 * Every figure says what it is (the parts-engine convention):
 *   measured   a fibre-property table or a test the mill gives     law       worked out by physics or arithmetic
 *   blend      measured fibre values mixed by the law that applies   typical   an industry default; the test that
 *   estimate   a model not yet calibrated on the mill's own trial              replaces it is named
 *   calibrated the model fitted on the mill's own trial blend
 *
 * No outside source is named in what this returns.
 */
'use strict';

const Y = require('./yarn-engine');
const M = require('./materials');
const U = require('./uster-engine');
const SS = require('./shade-spec');
const SP = require('./spectral');

class MelangeError extends Error {}
const FP = Y.FIBER_PROPERTIES;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);   // user text is never a path into Object.prototype
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value, unit, basis, ...(extra || {}) });

// ═════════════════════════════════════════════════════════════════════════════════════════════
// CATALOGUE
// ═════════════════════════════════════════════════════════════════════════════════════════════
const FIBRES = {
  cotton: 'Cotton', viscose: 'Viscose', modal: 'Modal', tencel: 'Lyocell (Tencel)', bamboo: 'Bamboo viscose',
  polyester: 'Polyester', nylon: 'Nylon', acrylic: 'Acrylic', wool: 'Wool',
};
const CELLULOSIC = new Set(['cotton', 'viscose', 'modal', 'tencel', 'bamboo']);
const NATURAL_STAPLE = new Set(['cotton', 'wool']);
// what a fibre looks like undyed (sRGB) — raw cotton and ecru viscose are not white
const NATURAL_HEX = { cotton: '#EDE9DF', viscose: '#F3F1EA', modal: '#F3F1EA', tencel: '#F3F1EA', bamboo: '#EFEBDD', polyester: '#F5F5F2', nylon: '#F3F2EE', acrylic: '#F4F2EA', wool: '#EDE6D6' };
const DOPE_BLACK = '#1D1D20';
// the commercial regain allowance (% of dry mass); the fibre table's own regain where no allowance is stated
const regainOf = (f) => { const d = FP[f]; if (!d) return 0; const c = d.regain_detail && d.regain_detail.commercial; return c != null ? c : (Array.isArray(d.regain) ? (d.regain[0] + d.regain[1]) / 2 : d.regain); };

const CONSTRUCTIONS = {
  fibre_melange: {
    label: 'Fibre melange (intimate blend)', group: 'fibre', effect: 'diffuse',
    what: 'Coloured and undyed fibres are mixed BEFORE the yarn is spun, so every section of the yarn holds both. The eye sees one heathered tone.',
    stage: 'blow room (tuft blend) or draw frame (sliver blend)', routes: ['blow_room', 'draw_frame'], plies: 1,
  },
  slub_melange: {
    label: 'Slub melange', group: 'fibre', effect: 'diffuse',
    what: 'A fibre melange spun with programmed thick places (slubs): the heather is broken by thick-and-thin bars.',
    stage: 'ring frame with a slub attachment', routes: ['blow_room', 'draw_frame'], plies: 1,
  },
  nep_melange: {
    label: 'Nep (snow / flake) melange', group: 'fibre', effect: 'speckle',
    what: 'Small clusters of coloured or white fibre are left in the yarn as flecks on a base shade.',
    stage: 'card (nep-forming settings) or blow room', routes: ['blow_room'], plies: 1,
  },
  siro_marl: {
    label: 'Siro marl (jaspe, grindle)', group: 'ply', effect: 'two-tone',
    what: 'Two rovings of different colour run through one drafting zone and are twisted together at the front nip: a two-tone yarn with one twist direction, lean and low in hairiness.',
    stage: 'ring frame, two rovings 6–11 mm apart', routes: ['roving'], plies: 2,
  },
  folded_marl: {
    label: 'Folded marl (mouline, grindle)', group: 'ply', effect: 'two-tone',
    what: 'Two or three single yarns of different colour are twisted together (ply twist opposite to the single twist): a crisp barber-pole look that can be untwisted into its plies.',
    stage: 'doubling / two-for-one twister', routes: ['ply'], plies: 3,
  },
  cross_dye_heather: {
    label: 'Cross-dyed heather (piece-dyed)', group: 'cross', effect: 'diffuse',
    what: 'An undyed multi-fibre yarn is knitted, then dyed so that each fibre takes only its own dye class: the heather is made in the dye house, not the spinning mill.',
    stage: 'dye house (fabric stage)', routes: ['piece_dye'], plies: 1,
  },
};
const ROUTES = {
  blow_room: { label: 'Blow-room (tuft) blending', note: 'dyed and undyed fibre are fed to the blending opener in tufts; the best macro-uniformity for dark shades (above about 40 % dyed fibre)' },
  draw_frame: { label: 'Draw-frame (sliver) blending', note: 'carded or combed slivers of each colour are doubled at the draw-frame creel; the most accurate ratio for light shades (below about 40 %), best yarn strength' },
  roving: { label: 'Two rovings at the ring frame (Siro)', note: 'two rovings drafted together: one yarn, two colours' },
  ply: { label: 'Doubling (plying)', note: 'finished single yarns twisted together' },
  piece_dye: { label: 'Cross-dyeing the fabric', note: 'greige multi-fibre fabric, dyed by fibre affinity' },
};
const SPINNING = ['combed', 'compact', 'carded', 'siro', 'siro_compact', 'open_end', 'vortex'];
const METHODS = {
  raw: 'Undyed (raw / ecru)',
  stock_dyed: 'Stock-dyed fibre (loose stock or sliver, before spinning)',
  dope_dyed: 'Spun-dyed / dope-dyed (colour in the polymer or dope)',
  cross_dye: 'Takes its colour in the fabric dye bath',
};
const SHADES = SS.MELANGE_TYPES;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// COLOUR
// ═════════════════════════════════════════════════════════════════════════════════════════════
const hexOk = (h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = (v) => { const c = clamp(v, 0, 1); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
const linToHex = (lin) => '#' + lin.map((v) => toSrgb(v).toString(16).padStart(2, '0')).join('');
function linToLab(lin) {
  const [r, g, b] = lin;
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Yv = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Yv), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const hexToLab = (h) => linToLab(hexToRgb(h).map(toLin));

/** CIEDE2000 colour difference (Sharma, Wu, Dalal). */
function dE00(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const rad = Math.PI / 180, deg = 180 / Math.PI, p7 = Math.pow(25, 7);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + p7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b, a) => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) * deg) + 360) % 360);
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else { hbp = (h1p + h2p) / 2; if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 180 : -180; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + p7));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

// Colour mixing. A fibre blend is NOT an average of reflectances: the dark fibres sit among and under the light
// ones and take part in the light's multiple scattering. Two laws, by the scale of the colour domains:
//
//   fibre blend (domains = single fibres, far below what the eye resolves)
//     single-constant Kubelka–Munk, K/S = (1−R)²/2R added over SURFACE-AREA weights, per channel, with
//       · a surface-reflection floor (no fibre mass is a perfect black: ~5 % of the light is reflected off the
//         fibre surfaces), taken out again at the end so the masstones come out exactly as entered;
//       · a screening constant ω: dark fibres count only ω^darkness of their area (their absorption is partly
//         hidden by the light fibres around them). ω = 1 is the plain area law. ESTIMATE until a trial blend is
//         measured: one trial fits ω.
//   marl (domains = whole plies or strands, visible one by one, mixed by the eye)
//     the area-weighted mean of the linear-light colours (Murray–Davies), no screening.
const MIX_DEFAULT = { omega: 0.35, floor: 0.05 };
const lumOf = (lin) => 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];

function mixFibres(parts, P) {            // parts: [{lin, w}] with w summing to 1 (surface-area weights)
  const omega = P && P.omega != null ? P.omega : MIX_DEFAULT.omega, fl = P && P.floor != null ? P.floor : MIX_DEFAULT.floor;
  const ws = parts.map((p) => p.w * Math.pow(omega, clamp(1 - lumOf(p.lin), 0, 1)));
  const tot = ws.reduce((t, w) => t + w, 0);
  const lin = [0, 1, 2].map((c) => {
    let ks = 0;
    parts.forEach((p, i) => {
      const R = clamp(fl + (1 - fl) * clamp(p.lin[c], 0.002, 1), 0.004, 0.999);
      ks += (ws[i] / tot) * ((1 - R) * (1 - R)) / (2 * R);
    });
    const Rm = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
    return clamp((Rm - fl) / (1 - fl), 0, 1);
  });
  return lin;
}
function mixDomains(parts) {
  return [0, 1, 2].map((c) => parts.reduce((t, p) => t + p.w * p.lin[c], 0));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INPUT
// ═════════════════════════════════════════════════════════════════════════════════════════════
// typical waste by stage, % of the fibre entering that stage. Replaced by the mill's own waste records.
const WASTE = {
  raw_cotton: { blow: 4.5, card: 5.0, comb: 14, spin: 2.5 },
  cellulosic_clean: { blow: 1.0, card: 2.5, comb: 0, spin: 2.5 },
  pre_coloured: { blow: 1.5, card: 2.5, comb: 0, spin: 2.5 },         // stock-dyed or dope-dyed, already open and clean
  polyester: { blow: 0.8, card: 1.5, comb: 0, spin: 2.0 },
  other: { blow: 1.5, card: 3.0, comb: 0, spin: 2.5 },
};
const FIBRE_DTEX = { cotton: 1.65, viscose: 1.3, modal: 1.0, tencel: 1.3, bamboo: 1.3, polyester: 1.4, nylon: 3.3, acrylic: 1.7, wool: 4.4 };

function readComponents(input, cons) {
  const list = Array.isArray(input.components) ? input.components : [];
  if (!list.length) throw new MelangeError('Give the components: each fibre, its share and its colour.');
  if (list.length > 6) throw new MelangeError('At most 6 components.');
  const spin = input.spinning && SPINNING.includes(input.spinning) ? input.spinning : cons.id === 'siro_marl' ? 'siro' : 'combed';
  const combedSystem = ['combed', 'compact', 'siro', 'siro_compact'].includes(spin);
  const comps = list.map((c0, i) => {
    const c = c0 || {};
    const fibre = own(FIBRES, c.fibre) ? c.fibre : null;
    if (!fibre) throw new MelangeError(`Component ${i + 1}: "${c.fibre}" is not a fibre this engine blends (${Object.keys(FIBRES).join(', ')}).`);
    const share = +c.share;
    if (!(share > 0)) throw new MelangeError(`Component ${i + 1} (${FIBRES[fibre]}): give its share, above 0.`);
    const natural = NATURAL_HEX[fibre];
    let method = own(METHODS, c.method) ? c.method : null;
    let hex = hexOk(c.colour) ? c.colour.toLowerCase() : null;
    let spec = null;
    if (c.spectrum != null) {
      try { spec = SP.parse(c.spectrum); } catch (e) { throw new MelangeError(`Component ${i + 1} (${FIBRES[fibre]}): ${e.message}`); }
      hex = linToHex(SP.toLin(spec));                               // the measured curve decides the colour
    }
    const isNatural = !hex || (!spec && hex === natural.toLowerCase());
    if (!method) {
      if (isNatural) method = 'raw';
      else if (cons.group === 'cross') method = 'cross_dye';
      else method = fibre === 'cotton' || fibre === 'wool' ? 'stock_dyed' : 'dope_dyed';   // natural fibres are stock-dyed; regenerated and synthetic are spun-dyed
    }
    if (method === 'raw' && !spec) hex = natural.toLowerCase();                              // undyed: the fibre's own colour
    else if (!hex) hex = (method === 'dope_dyed' ? DOPE_BLACK : '#2b2b30').toLowerCase();
    const coloured = method !== 'raw';
    const variant = c.variant === 'cdp' && fibre === 'polyester' ? 'cdp' : null;
    const dtex = +c.dtex > 0 ? +c.dtex : FIBRE_DTEX[fibre];
    const staple = +c.staple_mm > 0 ? +c.staple_mm : (fibre === 'cotton' ? 28 : fibre === 'wool' ? 75 : 38);
    // waste: the user's figures win; else the typical by what the fibre is when it reaches the blow room
    const kind = fibre === 'cotton' && method === 'raw' ? 'raw_cotton' : coloured && cons.group !== 'cross' ? 'pre_coloured' : fibre === 'polyester' ? 'polyester' : CELLULOSIC.has(fibre) ? 'cellulosic_clean' : 'other';
    const w0 = WASTE[kind];
    const combed = c.combed != null ? !!c.combed : fibre === 'cotton' && method === 'raw' && combedSystem && cons.group !== 'ply';
    const wu = c.waste || {};
    const w = { blow: wu.blow != null ? +wu.blow : w0.blow, card: wu.card != null ? +wu.card : w0.card, comb: combed ? (wu.comb != null ? +wu.comb : (w0.comb || 14)) : 0, spin: wu.spin != null ? +wu.spin : w0.spin };
    const userWaste = !!c.waste;
    return { i, fibre, label: FIBRES[fibre], variant, share, share_basis: c.share_basis === 'dry' ? 'dry' : 'conditioned', method, hex, spec, coloured, dtex, staple, combed, waste: w, waste_basis: userWaste ? 'measured' : 'typical', waste_kind: kind, strand_tex: +c.tex > 0 ? +c.tex : null };
  });
  return { comps, spin };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// MASS CHAIN
// ═════════════════════════════════════════════════════════════════════════════════════════════
function massChain(comps, opts) {
  // share → conditioned shares (the label) and dry shares
  const R = comps.map((c) => regainOf(c.fibre));
  const sumShare = comps.reduce((t, c) => t + c.share, 0);
  const dryRaw = comps.map((c, i) => (c.share_basis === 'dry' ? c.share : c.share / (1 + R[i] / 100)));
  const dryTot = dryRaw.reduce((t, v) => t + v, 0);
  const dry = dryRaw.map((v) => v / dryTot);                         // fractions of dry mass
  // label (conditioned) shares from the dry shares: what the invoice and the garment label would carry
  const condRaw = dry.map((d, i) => d * (1 + R[i] / 100));
  const condTot = condRaw.reduce((t, v) => t + v, 0);
  const label = condRaw.map((v) => v / condTot);
  const blendR = dry.reduce((t, d, i) => t + d * R[i], 0);          // % — the blend's regain
  // realization through the stages
  const real = comps.map((c) => (1 - c.waste.blow / 100) * (1 - c.waste.card / 100) * (1 - c.waste.comb / 100) * (1 - c.waste.spin / 100));
  // the bale issue for 100 kg of conditioned yarn: yarn dry = 100/(1+R); fibre i dry at the yarn = dry_i × that; ÷ realization; × (1+R_i)
  const yarnCond = opts && +opts.yarn_kg > 0 ? +opts.yarn_kg : 100;
  const yarnDry = yarnCond / (1 + blendR / 100);
  const issueDry = dry.map((d, i) => (d * yarnDry) / real[i]);
  const issueCond = issueDry.map((v, i) => v * (1 + R[i] / 100));
  const issueTot = issueCond.reduce((t, v) => t + v, 0);
  // weighed at the nominal ratio instead: the label ratio of bales, no waste correction
  const nominal = label.map((l, i) => l * real[i]);
  const nomTot = nominal.reduce((t, v) => t + v, 0);
  const driftLabel = nominal.map((v) => v / nomTot);                // label share the yarn would really have
  const driftDry = driftLabel.map((l, i) => (l / (1 + R[i] / 100)));
  const dd = driftDry.reduce((t, v) => t + v, 0);
  return {
    R, dry, label, blendR, real, yarnCond, yarnDry, issueDry, issueCond, issueTot, driftLabel, driftDry: driftDry.map((v) => v / dd), sumShare,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════════════════════
function analyse(input) {
  if (!input || typeof input !== 'object') throw new MelangeError('Give the melange: its construction and components.');
  const type = own(CONSTRUCTIONS, input.type) ? input.type : 'fibre_melange';
  const cons = CONSTRUCTIONS[type];
  // a target or a trial blend may be given as a measured curve: its colour is read from it
  const specIn = (o, what) => { if (!o || o.spectrum == null) return null; try { return SP.parse(o.spectrum); } catch (e) { throw new MelangeError(`The ${what} spectrum: ${e.message}`); } };
  const tspec = specIn(input.target, 'target'), rspec = specIn(input.trial, 'trial');
  if (tspec || rspec) input = { ...input, _tspec: tspec, ...(tspec ? { target: { ...input.target, colour: linToHex(SP.toLin(tspec)) } } : {}), ...(rspec ? { trial: { ...input.trial, colour: linToHex(SP.toLin(rspec)) } } : {}) };
  const { comps, spin: spinning } = readComponents(input, cons);
  const route = cons.routes.includes(input.route) ? input.route : cons.routes[0];
  const checks = [];
  const say = (level, text) => checks.push({ level, text });
  if (type === 'folded_marl') {
    // each component is one single yarn of its own count: the plies' mass shares follow their tex, not typed shares
    const ct0 = input.count || {}, u0 = own(NE_FROM, String(ct0.unit || 'ne').toLowerCase()) ? String(ct0.unit || 'ne').toLowerCase() : 'ne';
    comps.forEach((c) => { c.strand_tex = c.strand_tex || (+ct0.value > 0 ? toTex(+ct0.value, u0) : null); });
    if (comps.some((c) => !(c.strand_tex > 0))) throw new MelangeError('Folded marl: give the count of the single yarns (one count for all, or a tex for each component).');
    comps.forEach((c) => { c.share = c.strand_tex; c.share_basis = 'conditioned'; });
  }
  const sum = comps.reduce((t, c) => t + c.share, 0);
  if (type !== 'folded_marl' && Math.abs(sum - 100) > 0.5) say('note', `The shares add to ${r1(sum)} %: they are read as proportions of that total.`);
  if (comps.length < 2) say('warn', 'A melange needs at least two components (a coloured and an undyed fibre, or two colours).');
  const spinKey = cons.group === 'cross' ? 'combed' : spinning;
  const SYS = Y.SPINNING_SYSTEMS[spinKey];

  // ── 2 the mass chain ─────────────────────────────────────────────────────────────────────
  const chain = massChain(comps, { yarn_kg: input.yarn_kg });

  // ── component optics and counts ─────────────────────────────────────────────────────────
  const compOut = comps.map((c, i) => {
    const lin = c.spec ? SP.toLin(c.spec) : hexToRgb(c.hex).map(toLin);
    return { ...c, lin, lab: linToLab(lin), dry: chain.dry[i], label_share: chain.label[i] };
  });
  // surface-area weights: fibres of one mass cover an area ∝ 1/(ρ·d) ∝ 1/√(ρ·dtex)
  const rho = compOut.map((c) => FP[c.fibre].density || 1.4);
  const areaRaw = compOut.map((c, i) => c.dry / Math.sqrt(rho[i] * c.dtex));
  const areaTot = areaRaw.reduce((t, v) => t + v, 0);
  compOut.forEach((c, i) => { c.area = areaRaw[i] / areaTot; c.density = rho[i]; });

  // ── yarn count ──────────────────────────────────────────────────────────────────────────
  const count = readCount(input, cons, compOut, say);
  const tex = count.tex;

  // number of fibres of each component in the yarn section
  compOut.forEach((c) => { c.fibres_in_section = (tex * c.dry) / (c.dtex / 10); });
  const nTot = compOut.reduce((t, c) => t + c.fibres_in_section, 0);
  compOut.forEach((c) => { c.number_share = c.fibres_in_section / nTot; });

  // ── 3 the colour ────────────────────────────────────────────────────────────────────────
  const mixP = { omega: input.calibration && +input.calibration.omega > 0 ? +input.calibration.omega : MIX_DEFAULT.omega, floor: MIX_DEFAULT.floor };
  let calibrated = false;
  if (input.trial && hexOk(input.trial.colour)) {
    const fit = fitOmega(compOut, cons, input.trial, mixP);
    if (fit) { mixP.omega = fit.omega; calibrated = fit; }
  }
  const colour = colourBlock(compOut, cons, mixP, calibrated, chain, input);

  // ── 4 the mixing ────────────────────────────────────────────────────────────────────────
  const mixing = mixingBlock(compOut, cons, route, chain, colour, input, tex, nTot);

  // ── 5 the yarn ──────────────────────────────────────────────────────────────────────────
  const yarn = yarnBlock(compOut, cons, spinKey, SYS, count, chain, nTot, input, say);

  // ── 6 the marl look ─────────────────────────────────────────────────────────────────────
  const marl = cons.group === 'ply' ? marlLook(compOut, cons, count, yarn, input, spinKey) : null;

  // ── 7 the knitting ──────────────────────────────────────────────────────────────────────
  const knitting = knittingBlock(compOut, cons, spinKey, yarn, mixing, input);

  // ── 8 the wet route ─────────────────────────────────────────────────────────────────────
  const wet = wetBlock(compOut, cons, chain, input);

  // ── 9 defects ───────────────────────────────────────────────────────────────────────────
  const defects = defectBlock(compOut, cons, route, spinKey, chain, colour, mixing, yarn, input, marl);

  // checks from the blocks
  if (SYS && !(count.single_ne >= SYS.count_min && count.single_ne <= SYS.count_max) && cons.group !== 'cross') say('warn', `${r1(count.single_ne)}s Ne is outside the ${SYS.label} range (${SYS.count_min}–${SYS.count_max}s).`);
  if (mixing.fibres_in_section < 33 && cons.group === 'fibre') say('warn', `Only ${Math.round(mixing.fibres_in_section)} fibres in the yarn section: too few to spin, and a melange this thin shows every dyed fibre as a fleck.`);
  mixing.warnings.forEach((w) => say(w.level, w.text));
  knitting.checks.forEach((w) => say(w.level, w.text));
  wet.checks.forEach((w) => say(w.level, w.text));
  colour.checks.forEach((w) => say(w.level, w.text));

  const studio_yarn = toStudioYarn(compOut, cons, spinKey, count, chain, input);
  const effect = compOut.filter((c) => c.coloured).sort((a, b) => b.dry - a.dry)[0] || null;
  return {
    success: true,
    construction: { id: type, label: cons.label, group: cons.group, effect: cons.effect, what: cons.what, stage: cons.stage, route: { id: route, ...ROUTES[route] }, spinning: SYS ? { id: spinKey, label: SYS.label } : { id: spinKey } },
    identity: identity(compOut, cons, colour, chain, count, spinKey),
    components: compOut.map((c) => ({
      spectral: !!c.spec, fibre: c.fibre, label: c.label, variant: c.variant, method: c.method, method_label: METHODS[c.method], hex: c.hex, lab: c.lab.map(r1),
      label_share_pct: r1(c.label_share * 100), dry_share_pct: r1(c.dry * 100), area_share_pct: r1(c.area * 100), number_share_pct: r1(c.number_share * 100),
      fibre_dtex: V(c.dtex, 'dtex', input.components[c.i].dtex > 0 ? 'measured' : 'typical'), staple_mm: V(c.staple, 'mm', input.components[c.i].staple_mm > 0 ? 'measured' : 'typical'),
      fibres_in_section: Math.round(c.fibres_in_section), density: V(c.density, 'g/cm³', 'measured'), regain: V(regainOf(c.fibre), '%', 'measured'),
      waste: { ...Object.fromEntries(Object.entries(c.waste).map(([k, v]) => [k, v])), basis: c.waste_basis },
    })),
    mass_chain: massOut(compOut, chain),
    colour: (({ _eff, ...c }) => c)(colour),
    mixing,
    yarn,
    marl,
    knitting: { ...knitting, checks: undefined },
    wet: { ...wet, checks: undefined },
    defects,
    checks,
    studio_yarn,
    composition: compositionOf(compOut, chain),
    trade_shade: colour.trade_shade,
    effect_component: effect ? effect.fibre : null,
  };
}

// ── the count ───────────────────────────────────────────────────────────────────────────────
const NE_FROM = { ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9 };
const toTex = (v, unit) => (own(NE_FROM, unit) ? NE_FROM[unit](v) : null);
function readCount(input, cons, comps, say) {
  const ct = input.count || {};
  const unit = own(NE_FROM, String(ct.unit || 'ne').toLowerCase()) ? String(ct.unit || 'ne').toLowerCase() : 'ne';
  const CONTRACTION = input.ply_contraction != null ? clamp(+input.ply_contraction / 100, 0, 0.08) : 0.02;
  if (input.type === 'folded_marl') {
    // the singles (their own counts) are twisted together: yarn tex = Σ texᵢ ÷ (1 − c), c the take-up of the ply twist
    const t = comps.map((c) => c.strand_tex);
    const sum = t.reduce((a, v) => a + v, 0);
    const resultant = sum / (1 - CONTRACTION);
    return { tex: resultant, single_ne: 590.5 / Math.max(...t), ply: t.length, nominal_ne: 590.5 / sum, resultant_ne: 590.5 / resultant, contraction: CONTRACTION, plies: t, form: 'ply2', basis: 'law' };
  }
  const v = +ct.value;
  if (!(v > 0)) throw new MelangeError('Give the yarn count (value and unit).');
  let tex = toTex(v, unit);
  let slub = null;
  if (input.type === 'slub_melange') {
    const sl = input.slub || {};
    // the count given is the BASE count; the slubs add mass, so the resultant yarn is coarser
    slub = Y.slubEffectiveCount(590.5 / tex, { slub_thickness: +sl.thickness || 1.8, slub_length_cm: +sl.length_cm || 4, slub_spacing_cm: +sl.spacing_cm || 20 });
    tex = 590.5 / slub.resultant_ne;
  }
  return { tex, single_ne: 590.5 / tex, ply: 1, resultant_ne: 590.5 / tex, form: slub ? 'slub' : 'single', slub, strands: cons.id === 'siro_marl' ? comps.length : null, basis: 'measured' };
}

// ── colour block ────────────────────────────────────────────────────────────────────────────
function blendAt(compOut, cons, mixP, areaOverride) {
  const parts = compOut.map((c, i) => ({ lin: c.lin, spec: c.spec, w: areaOverride ? areaOverride[i] : c.area }));
  if (compOut.every((c) => c.spec)) {                                  // every component measured: mix band by band
    const spec = cons.group === 'ply' ? SP.mixLinear(parts) : SP.mixKM(parts, mixP);
    const lin = SP.toLin(spec);
    return { lin, spec, hex: linToHex(lin), lab: linToLab(lin) };
  }
  const lin = cons.group === 'ply' ? mixDomains(parts) : mixFibres(parts, mixP);
  return { lin, hex: linToHex(lin), lab: linToLab(lin) };
}
function withEffectShare(compOut, effIdx, dryShare) {
  // vary the dry share of one component, the others keep their proportions; return new area weights
  const others = compOut.map((c, i) => (i === effIdx ? 0 : c.dry));
  const oT = others.reduce((t, v) => t + v, 0);
  const dry = compOut.map((c, i) => (i === effIdx ? dryShare : (others[i] / oT) * (1 - dryShare)));
  const raw = compOut.map((c, i) => dry[i] / Math.sqrt(c.density * c.dtex));
  const tot = raw.reduce((t, v) => t + v, 0);
  return raw.map((v) => v / tot);
}
/**
 * The inverse problem a colour matcher actually has: "I need THIS grey — how much dark fibre?". Bisects the effect
 * component's dry share until the blend's lightness meets the target's (the blend is monotone in lightness), then reports
 * what remains in chroma (a grey blend cannot be turned blue by changing the share), the share as the label would
 * carry it, and the nearest whole-sliver creel.
 */
function solveTarget(compOut, cons, mixP, effIdx, targetHex, chain, maxD, tspec) {
  const tLab = hexToLab(targetHex);
  const atB = (p) => blendAt(compOut, cons, mixP, withEffectShare(compOut, effIdx, p));
  const at = (p) => atB(p).lab;
  const lo = 0.0005, hi = 0.9995;
  const Lmin = Math.min(at(lo)[0], at(hi)[0]), Lmax = Math.max(at(lo)[0], at(hi)[0]);
  if (tLab[0] < Lmin - 0.05 || tLab[0] > Lmax + 0.05) return { reachable: false, target_hex: targetHex, target_L: r1(tLab[0]), reachable_L: [r1(Lmin), r1(Lmax)], note: `lightness ${r1(tLab[0])} is outside what these components can make (${r1(Lmin)}–${r1(Lmax)}): change a component colour` };
  let a = lo, b = hi;
  const decreasing = at(lo)[0] > at(hi)[0];
  for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if ((at(m)[0] > tLab[0]) === decreasing) a = m; else b = m; }
  const p = (a + b) / 2, solved = atB(p), lab = solved.lab;
  // the dry shares at that point → label shares (conditioned)
  const dryNow = compOut.map((c, i) => (i === effIdx ? p : (c.dry / (1 - compOut[effIdx].dry)) * (1 - p)));
  const R = compOut.map((c) => regainOf(c.fibre));
  const condRaw = dryNow.map((d, i) => d * (1 + R[i] / 100)), cT = condRaw.reduce((t, v) => t + v, 0);
  const labelPct = (condRaw[effIdx] / cT) * 100;
  const dE = dE00(lab, tLab);
  return {
    reachable: true, target_hex: targetHex, target_L: r1(tLab[0]), hex_at: solved.hex, L_at: r1(lab[0]),
    effect_component: compOut[effIdx].fibre, effect_index: effIdx, label_share_pct: r2(labelPct), dry_share_pct: r2(p * 100), remaining_dE: r2(dE),
    remaining_note: dE < 1 ? 'a match within one ΔE' : dE < 3 ? 'a close match; the rest is hue / chroma the components cannot make' : 'lightness matches but the hue or chroma does not: the component colours cannot make this shade',
    ...(tspec && solved.spec ? { metamerism: metamerOut(solved.spec, tspec) } : {}),
    creel: creelOptions(labelPct / 100, maxD || 8), basis: mixP.omega === MIX_DEFAULT.omega ? 'estimate' : 'calibrated',
  };
}
function metamerOut(spec, tspec) {
  const m = SP.metamerism(spec, tspec, dE00);
  const note = { none: 'the colour difference between the two does not change between daylight and a tungsten shop light', slight: 'the difference shifts slightly between daylight and tungsten: usually passes', noticeable: 'the difference shifts noticeably between daylight and tungsten: agree the viewing light with the buyer', strong: 'a metameric pair: the difference in daylight is not the difference under tungsten. Change a dye or fibre (a different absorption curve); moving the share will not cure it' }[m.grade];
  return { dE_daylight: r2(m.dE_daylight), dE_tungsten: r2(m.dE_tungsten), shift: r2(m.shift), grade: m.grade, note, basis: 'law' };
}
function fitOmega(compOut, cons, trial, mixP) {
  // one measured trial blend (its colour) fixes the screening constant ω by bisection on lightness
  if (cons.group === 'ply') return null;
  const tl = hexToLab(trial.colour)[0];
  const f = (om) => blendAt(compOut, cons, { ...mixP, omega: om })[('lab')][0] - tl;
  let lo = 0.02, hi = 1;
  const fl = f(lo), fh = f(hi);
  if (fl * fh > 0) return null;                               // the trial lies outside what ω can reach
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) * f(lo) <= 0) hi = m; else lo = m; }
  const om = (lo + hi) / 2;
  return { omega: om, trial_L: r1(tl), predicted_before_L: r1(blendAt(compOut, cons, { ...mixP, omega: MIX_DEFAULT.omega }).lab[0]) };
}
function colourBlock(compOut, cons, mixP, calibrated, chain, input) {
  const checks = [];
  const blend = blendAt(compOut, cons, mixP);
  const dark = compOut.slice().sort((a, b) => a.lab[0] - b.lab[0])[0];
  const light = compOut.slice().sort((a, b) => b.lab[0] - a.lab[0])[0];
  const eff = compOut.filter((c) => c !== light).sort((a, b) => b.dry - a.dry)[0] || compOut[0];
  const effIdx = compOut.indexOf(eff);
  // the curve: the effect component's dry share from 0 to 100 %
  const curve = [];
  for (const p of [0, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
    const a = withEffectShare(compOut, effIdx, Math.min(0.9999, Math.max(0.0001, p / 100)));
    const b = blendAt(compOut, cons, mixP, a);
    curve.push({ share_pct: p, hex: b.hex, L: r1(b.lab[0]) });
  }
  // sensitivity: ΔE00 for one point of dry share of the effect component, at the recipe
  const p0 = compOut[effIdx].dry;
  const at = (p) => blendAt(compOut, cons, mixP, withEffectShare(compOut, effIdx, clamp(p, 0.0005, 0.9995))).lab;
  const dEpoint = dE00(at(p0), at(p0 + 0.01));
  const dEhalf = dE00(at(p0), at(Math.max(0.0005, p0 - 0.01)));
  const sens = (dEpoint + dEhalf) / 2;
  const contrast = dE00(dark.lab, light.lab);
  // trade shade from the effect component's LABEL share (the figure a buyer reads)
  const effLabel = chain.label[effIdx] * 100;
  const darkLabel = chain.label[compOut.indexOf(dark)] * 100;
  const L = blend.lab[0];
  let trade = null;
  if (cons.group === 'fibre' && dark.lab[0] < 45 && light.lab[0] > 70) {
    const chroma = Math.hypot(dark.lab[1], dark.lab[2]);
    const t = chroma > 12 ? 'color' : darkLabel <= 4 ? 'ecru' : darkLabel <= 20 ? 'grey' : darkLabel <= 45 ? 'anthra' : darkLabel <= 70 ? 'charcoal' : 'black';
    trade = { id: t, label: SHADES[t].label, dark_share_pct: r1(darkLabel), usual_range: [SHADES[t].min, SHADES[t].max], note: SHADES[t].note };
  }
  const target = input.target && hexOk(input.target.colour) ? solveTarget(compOut, cons, mixP, effIdx, input.target.colour.toLowerCase(), chain, +input.max_doublings === 6 ? 6 : 8, input._tspec) : null;
  if (compOut.some((c) => c.spec) && !compOut.every((c) => c.spec)) checks.push({ level: 'note', text: 'Only some components have a measured spectrum, so the blend is mixed from their colours (RGB). Give a spectrum for every component to mix band by band and to check metamerism.' });
  if (!calibrated) checks.push({ level: 'note', text: 'The blend colour is an ESTIMATE from the component colours (screening constant ω = ' + r2(mixP.omega) + '). Spin one trial blend, measure it, and enter its colour: the model is fitted on it and every shade figure here is then calibrated.' });
  if (cons.group === 'ply') checks.push({ level: 'note', text: 'A marl is two (or more) colours the eye mixes at a distance; up close the plies are seen one by one. The colour shown is the distance colour.' });
  return {
    model: cons.group === 'ply' ? { id: 'domain', label: 'Marl: area-weighted linear-light mean of the plies (colour domains visible one by one)', basis: 'law' }
      : { id: 'fibre_km', label: 'Fibre blend: Kubelka–Munk absorption on surface-area weights with a screening constant', basis: calibrated ? 'calibrated' : 'estimate', omega: r3(mixP.omega), floor: mixP.floor },
    calibration: calibrated ? { fitted_omega: r3(calibrated.omega), trial_L: calibrated.trial_L, predicted_before_L: calibrated.predicted_before_L } : null,
    blend: { hex: blend.hex, lab: blend.lab.map(r1), L: r1(L) },
    spectral: blend.spec ? {
      wavelengths_nm: SP.WL, blend: blend.spec.map(r3), target: input._tspec ? input._tspec.map(r3) : null,
      components: compOut.map((c) => ({ fibre: c.fibre, spectrum: c.spec.map(r3) })),
      metamerism: input._tspec ? metamerOut(blend.spec, input._tspec) : null,
      note: 'Mixed band by band (31 bands, 400–700 nm) from the measured curves: a blue and a yellow fibre make the green their absorption curves make, not the green of an RGB average.',
    } : null,
    components: compOut.map((c) => ({ fibre: c.fibre, hex: c.hex, L: r1(c.lab[0]) })),
    contrast_dE: r1(contrast),
    contrast_note: contrast < 8 ? 'low contrast — a quiet, tone-on-tone heather' : contrast < 25 ? 'medium contrast — a visible heather' : 'high contrast — a crisp two-tone / speckled look',
    curve,
    sensitivity: { per_point_dE: r2(sens), at_share_pct: r1(p0 * 100), effect_component: eff.fibre, basis: calibrated ? 'calibrated' : 'estimate', note: `one point (1 %) of ${eff.label.toLowerCase()} in the blend moves the colour by ΔE00 ${r2(sens)}` },
    trade_shade: trade,
    target,
    checks,
    _eff: { idx: effIdx, p0 },
  };
}

// ── mixing block ────────────────────────────────────────────────────────────────────────────
// extra variance of the blend ratio in a yarn section beyond ideal random mixing, by how the blend was made
// (ribbons of one colour still lie side by side after one draw-frame passage; a tuft blend is already random)
const MIX_VARIANCE = { blow_room: 1.15, draw_frame: [2.3, 1.5, 1.2], roving: 1.0, ply: 1.0, piece_dye: 1.0 };
function creelOptions(p, maxD) {
  // whole slivers only: m_e effect slivers and m_b base slivers in one doubling of up to maxD ends
  const out = [];
  for (let D = 2; D <= maxD; D++) for (let me = 1; me < D; me++) {
    const mb = D - me, pe = me / D;
    out.push({ doublings: D, effect_slivers: me, base_slivers: mb, share_equal_weights_pct: r2(pe * 100), error_points: r2((pe - p) * 100), effect_sliver_weight_needed_pct_of_base: r1((p / (1 - p)) * (mb / me) * 100) });
  }
  return out.sort((a, b) => Math.abs(a.error_points) - Math.abs(b.error_points) || a.doublings - b.doublings).slice(0, 4);
}
function mixingBlock(compOut, cons, route, chain, colour, input, tex, nTot) {
  const warnings = [];
  const eff = compOut[colour._eff.idx];
  const p = eff.number_share, pLab = chain.label[colour._eff.idx], pDry = eff.dry;
  // ideal random mixing: the binomial spread of the proportion of the effect fibre in one section
  const cvIdeal = Math.sqrt((1 - p) / (p * nTot)) * 100;
  const mv = route === 'draw_frame' ? MIX_VARIANCE.draw_frame[clamp((+input.passages || 2) - 1, 0, 2)] : MIX_VARIANCE[route] || 1;
  const cvSection = cvIdeal * Math.sqrt(mv);
  // stitch-scale averaging: independent length elements of the yarn are about one staple long
  const sl = +input.stitch_length_mm > 0 ? +input.stitch_length_mm : 2.8;
  const staple = eff.staple;
  // the fibres seen in a window of yarn L long are those whose start lies within (L + staple): n·(1 + L/staple) of them
  const k = 1 + sl / staple;
  const cvStitch = cvSection / Math.sqrt(k), cvStitchIdeal = cvIdeal / Math.sqrt(k);
  // lot-to-lot: the ratio error of the feed (feeders / slivers), long-wave
  let lot = null, creel = null;
  if (route === 'draw_frame' || route === 'blow_room') {
    if (route === 'draw_frame') {
      const maxD = +input.max_doublings === 6 ? 6 : 8;
      const opts = creelOptions(pLab, maxD);
      const best = opts[0];
      const cvW = +input.sliver_cv_pct > 0 ? +input.sliver_cv_pct : 1.0;
      const relCv = (1 - pLab) * Math.sqrt((cvW * cvW) / best.effect_slivers + (cvW * cvW) / best.base_slivers);
      lot = { cv_rel_pct: r2(relCv), sigma_points: r2(relCv * pLab), basis: 'law', rule: 'relative share spread = (1 − p) · √(CV²/mₑ + CV²/m_b), CV = the sliver weight CV per end', sliver_cv_pct: V(cvW, '%', +input.sliver_cv_pct > 0 ? 'measured' : 'typical', { test: 'draw-frame sliver CV (1 m cuts)' }) };
      creel = {
        doublings_max: maxD, options: opts,
        per_pct_weight: r3(pLab * (1 - pLab) * 100), per_pct_note: `a 1 % error in the weight of the coloured sliver moves the share by ${r2(pLab * (1 - pLab) * 100)} points`,
        sliver_weight_shift: input.sliver_weight_gpm > 0 ? (() => { const W = +input.sliver_weight_gpm; const dW = +input.sliver_shift_gpm > 0 ? +input.sliver_shift_gpm : 0.4; return { sliver_g_per_m: W, shift_g_per_m: dW, share_moves_points: r2(pLab * (1 - pLab) * (dW / W) * 100) }; })() : null,
      };
      if (Math.abs(best.error_points) > 0.5) warnings.push({ level: 'warn', text: `With whole slivers the nearest ratio is ${best.effect_slivers}:${best.base_slivers} (${best.share_equal_weights_pct} %), ${Math.abs(best.error_points)} points off ${r1(pLab * 100)} %. Hit the target exactly by making the coloured sliver ${best.effect_sliver_weight_needed_pct_of_base} % of the base sliver's weight.` });
    } else {
      const cvF = +input.feeder_cv_pct > 0 ? +input.feeder_cv_pct : 2.0;
      const relCv = (1 - pLab) * Math.sqrt(2) * cvF;
      lot = { cv_rel_pct: r2(relCv), sigma_points: r2(relCv * pLab), basis: 'law', rule: 'relative share spread = (1 − p) · √2 · CV of the weigh-feeders', feeder_cv_pct: V(cvF, '%', +input.feeder_cv_pct > 0 ? 'measured' : 'typical', { test: 'hopper-feeder / weigh-pan delivery CV' }) };
    }
  }
  // the shade the lot variation gives: ΔE per point × spread, 2σ
  const tol = +input.tolerance_dE > 0 ? +input.tolerance_dE : 1.0;
  let lotShade = null;
  if (lot) {
    const dE2 = 2 * colour.sensitivity.per_point_dE * lot.sigma_points;
    lotShade = { two_sigma_dE: r2(dE2), tolerance_dE: tol, grade: dE2 <= tol * 0.5 ? 'safe' : dE2 <= tol ? 'tight' : 'at risk', basis: colour.sensitivity.basis };
    if (dE2 > tol) warnings.push({ level: 'warn', text: `Lot-to-lot shade spread ΔE00 ±${r2(dE2)} against a tolerance of ${tol}: at ${r1(pLab * 100)} % dyed fibre one point of share is ΔE ${colour.sensitivity.per_point_dE}. ${route === 'blow_room' ? 'A draw-frame sliver blend holds the ratio far tighter at this shade.' : 'Hold the sliver weights to a tighter CV, or use a heavier coloured sliver and fewer base ends.'}` });
  }
  if (route === 'blow_room' && pLab < 0.4) warnings.push({ level: 'note', text: 'Below about 40 % coloured fibre the draw-frame blend holds the ratio more accurately than a blow-room blend.' });
  if (route === 'draw_frame' && pLab > 0.6) warnings.push({ level: 'note', text: 'Above about 40 % coloured fibre a blow-room tuft blend gives the more uniform dark melange.' });
  const pPts = pDry * 100;
  const mottleStitchDE = colour.sensitivity.per_point_dE * (cvStitch / 100) * pPts, mottleIdealDE = colour.sensitivity.per_point_dE * (cvStitchIdeal / 100) * pPts;
  return {
    route: { id: route, ...ROUTES[route] },
    fibres_in_section: r1(nTot),
    effect_component: eff.fibre,
    random_mix: { cv_section_pct: r1(cvSection), ideal_cv_pct: r1(cvIdeal), mixing_factor: r2(mv), basis: 'law', rule: 'CV = √((1−p)/(p·n)); n fibres in the section, p the effect fibres\' share of the NUMBER of fibres' },
    mottle: {
      cv_per_stitch_pct: r1(cvStitch), stitch_length_mm: sl, fibres_seen_factor: r2(k),
      shade_dE_1sigma: r2(mottleStitchDE), unavoidable_dE_1sigma: r2(mottleIdealDE), extra_from_mixing_dE: r2(Math.max(0, mottleStitchDE - mottleIdealDE)),
      basis: 'estimate', rule: 'binomial section spread ÷ √(1 + stitch length ÷ staple): the fibres seen in one stitch. A melange is mottled by nature (the unavoidable part); the route adds to it (the extra part).',
    },
    lot, lot_shade: lotShade, creel, warnings,
  };
}

// ── yarn block ──────────────────────────────────────────────────────────────────────────────
function yarnBlock(compOut, cons, spinKey, SYS, count, chain, nTot, input, say) {
  const comp = {}; compOut.forEach((c) => { comp[c.fibre] = (comp[c.fibre] || 0) + c.dry * 100; });
  const phys = M.yarn({ count: count.tex, unit: 'tex', ply: 1, fibres: comp, spinning: SYS ? spinKey : 'combed' });
  // dyed fibre: the share of each damage class
  const sStock = compOut.filter((c) => c.method === 'stock_dyed').reduce((t, c) => t + c.dry * (NATURAL_STAPLE.has(c.fibre) ? 1 : 0.5), 0);
  const sDope = compOut.filter((c) => c.method === 'dope_dyed').reduce((t, c) => t + c.dry, 0);
  const damage = sStock + 0.1 * sDope;                                   // stock-dyed natural fibre = 1, regenerated stock = 0.5, dope-dyed = 0.1
  const plyEffect = cons.group === 'ply';
  // strength: spinning-system RKM × the blend's index (parts engine), less what dyed fibre costs
  const strengthFactor = plyEffect ? 1 : 1 - 0.17 * damage;
  const rkm0 = phys.strength.rkm ? phys.strength.rkm.value : null;
  const rkm = rkm0 ? rkm0 * strengthFactor * (cons.id === 'siro_marl' ? 1.08 : cons.id === 'folded_marl' ? 1.10 : 1) : null;
  // evenness: Martindale limit with the fibre-area variation of the blend, × the system index, × the dyed-fibre penalty
  const CVa = compOut.reduce((t, c) => t + c.dry * ((FP[c.fibre].variability && FP[c.fibre].variability.fineness) || 20), 0);
  const lim = (100 / Math.sqrt(nTot)) * Math.sqrt(1 + Math.pow(CVa / 100, 2));
  const I0 = (SYS && U.INDEX_OF_IRREGULARITY[spinKey]) || 1.42;
  const I = I0 * (1 + 0.15 * damage);
  const cvm = cons.id === 'slub_melange' ? null : lim * I;
  const ne1 = count.single_ne;
  const ipi = cvm ? U.predictIPI(cvm, ne1) : null;
  const hair = U.predictHairiness(U.INDEX_OF_IRREGULARITY[spinKey] ? spinKey : 'combed', ne1) * (1 + 0.25 * damage) * (cons.id === 'siro_marl' ? 0.8 : cons.id === 'folded_marl' ? 0.85 : 1);
  const perf = cvm && ipi ? U.knittingPerformance(I, ipi.ipi, ne1) : null;
  const breaking = rkm ? (rkm * count.tex) / 100 : null;                   // N
  return {
    count: { tex: V(r2(count.tex), 'tex', count.basis), ne: V(r1(590.5 / count.tex), 'Ne', 'law'), nm: V(r1(1000 / count.tex), 'Nm', 'law'), dtex: V(r1(count.tex * 10), 'dtex', 'law'),
      plies: count.plies ? count.plies.map((t) => ({ tex: r2(t), ne: r1(590.5 / t) })) : null, nominal_ne: count.nominal_ne ? V(r1(count.nominal_ne), 'Ne', 'law', { rule: '1/Ne = Σ 1/Neᵢ' }) : null,
      resultant_ne: V(r1(count.resultant_ne), 'Ne', 'law', count.contraction != null ? { rule: `tex = Σ texᵢ ÷ (1 − c), c = ${r1(count.contraction * 100)} % ply-twist take-up` } : undefined), slub: count.slub || null },
    spinning: SYS ? { id: spinKey, label: SYS.label } : { id: spinKey },
    diameter: phys.diameter, twist: phys.twist, residual_torque: phys.residual_torque,
    fibres_in_section: V(r1(nTot), '', 'law'),
    strength: {
      rkm: rkm ? V(r1(rkm), 'cN/tex', 'typical', { test: 'single-end tensile tester', before_dyed_fibre: r1(rkm0) }) : null,
      breaking_load: breaking ? V(r2(breaking), 'N', 'law') : null,
      dyed_fibre_loss_pct: V(r1((1 - strengthFactor) * 100), '%', 'typical', { range: [r1((1 - strengthFactor) * 60), r1((1 - strengthFactor) * 135)], rule: '17 % loss per unit share of stock-dyed natural fibre (regenerated stock-dyed counts ½, dope-dyed ⅒)', test: 'tensile test of the melange yarn against the same yarn undyed' }),
      elongation: phys.strength.elongation,
    },
    evenness: cvm ? { cvm_pct: V(r1(cvm), '%', 'typical', { test: 'evenness tester' }), limit_pct: V(r1(lim), '%', 'law', { rule: '100/√n × √(1 + CV²fibre-area), n = fibres in the section' }), index: V(r2(I), '', 'typical'), u_pct: V(r1(cvm * 0.8), '%', 'typical'), ipi: ipi } : { note: 'a slub yarn\'s evenness is its programme; test the base yarn' },
    hairiness: V(r1(hair), 'H', 'typical', { test: 'hairiness tester (Uster H, Zweigle S3)' }),
    knitting_performance: perf,
    dyed_fibre_damage_index: r2(damage),
    parts: { friction: phys.friction, bending_rigidity: phys.bending_rigidity },
  };
}

// ── the marl look ───────────────────────────────────────────────────────────────────────────
function marlLook(compOut, cons, count, yarn, input, spinKey) {
  const sl = +input.stitch_length_mm > 0 ? +input.stitch_length_mm : 2.8;
  // folded marl: the colours turn at the PLY twist, about 70 % of the single yarns' own twist (opposite hand);
  // Siro: the two strands wind round each other at the twist of the yarn itself
  const ae = M.ALPHA_E[spinKey] || 3.5;
  const tpmSingle = ae * Math.sqrt(count.single_ne || 590.5 / count.tex) * 39.37;
  const tpmYarn = yarn.twist && yarn.twist.tpm ? yarn.twist.tpm.value : null;
  const plyTwist = +input.ply_twist_tpm > 0 ? +input.ply_twist_tpm : cons.id === 'folded_marl' ? 0.7 * tpmSingle : tpmYarn;
  if (!plyTwist) return null;
  const pitch = 1000 / plyTwist;                          // mm of yarn per colour turn
  const q = sl / pitch;                                   // colour turns per stitch
  const f = q - Math.floor(q);
  const dInt = Math.min(f, 1 - f), dHalf = Math.abs(f - 0.5);
  let look, level = 'note';
  if (dInt < 0.06) { look = 'TRACKING: each stitch lands at the same point of the colour turn, so the colours stack in lines up the wales — vertical stripes'; level = 'warn'; }
  else if (dHalf < 0.06) { look = 'CHECKING: successive stitches meet opposite colours — a fine checker (a pepper-and-salt)'; level = 'note'; }
  else look = 'A random-looking mottle: the colour turn and the stitch drift against each other';
  return {
    ply_twist_tpm: V(r1(plyTwist), 'turns/m', +input.ply_twist_tpm > 0 ? 'measured' : 'typical', { rule: cons.id === 'folded_marl' ? "about 70 % of the single yarns' twist, opposite hand" : 'the twist of the yarn: the strands wind round each other once per turn' }),
    colour_pitch_mm: V(r2(pitch), 'mm', 'law', { rule: '1000 ÷ ply twist: yarn length for one turn of the colours' }),
    stitch_length_mm: sl, turns_per_stitch: r3(q), distance_from_whole_turn: r3(dInt), look, level,
    advice: level === 'warn' ? 'Change the stitch length by ±8–10 % or the ply twist by ±10 % to take the stripes out.' : null,
  };
}

// ── knitting ────────────────────────────────────────────────────────────────────────────────
function knittingBlock(compOut, cons, spinKey, yarn, mixing, input) {
  const checks = [];
  const tension = +input.running_tension_cN > 0 ? +input.running_tension_cN : 4.5;   // the upper end of a knitting yarn's running tension
  const load = yarn.strength.breaking_load ? yarn.strength.breaking_load.value * 100 : null;      // cN
  const margin = load ? load / tension : null;
  if (margin != null && margin < 15) checks.push({ level: 'warn', text: `The yarn breaks at ${r1(load)} cN, only ${r1(margin)}× the ${tension} cN running tension: thin margin. Wax it, lower the feed tension, or spin it stronger (more twist, compact or Siro system).` });
  const stock = compOut.some((c) => c.method === 'stock_dyed');
  const rec = [];
  if (stock) rec.push('Stock-dyed cotton has lost its wax: it needs 0.5–1.5 % spin-finish after dyeing and a waxed cone at the winder — otherwise friction, fly and needle wear rise.');
  rec.push('Clean the tension discs and feeders on a fixed cycle: coloured and white fibre fly pick up each other\'s colour and show as specks.');
  rec.push('One lot per fabric: never mix cones from different spinning dates or blend lots — creel first-in-first-out, one lot to a roll.');
  if (cons.group === 'fibre') rec.push('Barré guard: hold the yarn count to ±0.3 Ne and twist to ±3 % across the cones of one lot.');
  if (cons.group === 'ply') rec.push('A marl shows every stitch-length difference as a colour difference: hold the stitch length constant across feeders and use positive feeding.');
  return {
    running_tension_cN: V(tension, 'cN', +input.running_tension_cN > 0 ? 'measured' : 'typical', { test: 'a tension meter at the feeder outlet' }),
    breaking_load_cN: load ? V(r1(load), 'cN', 'law') : null,
    strength_margin: margin ? V(r1(margin), '×', 'law', { rule: 'breaking load ÷ running tension; 15× or more is comfortable' }) : null,
    recommendations: rec, checks,
  };
}

// ── wet route ───────────────────────────────────────────────────────────────────────────────
// the dye class each fibre takes, and the conditions that class needs
const DYE = {
  cotton: { cls: 'reactive', ph: '10.5–11.5 (soda ash)', temp: '60–80 °C', time: '40–60 min', note: 'salt 20–80 g/L, dosed in steps' },
  viscose: { cls: 'reactive', ph: '10.5–11.5', temp: '60 °C', time: '40–60 min', note: 'lower salt than cotton; wet modulus is low — keep tension out' },
  modal: { cls: 'reactive', ph: '10.5–11.5', temp: '60 °C', time: '40–60 min', note: '' },
  tencel: { cls: 'reactive', ph: '10.5–11.5', temp: '60 °C', time: '40–60 min', note: 'fibrillates in wet processing: enzyme before dyeing' },
  bamboo: { cls: 'reactive', ph: '10.5–11.5', temp: '60 °C', time: '40–60 min', note: '' },
  polyester: { cls: 'disperse', ph: '4.4–4.6 (acetic acid)', temp: '130 °C (HT)', time: '35–45 min', note: 'then reduction clearing' },
  nylon: { cls: 'acid', ph: '4.5–6', temp: '98–100 °C', time: '45–60 min', note: 'weak-acid levelling dyes' },
  acrylic: { cls: 'cationic', ph: '4–5', temp: '100 °C', time: '45–60 min', note: 'heat slowly through 80–100 °C (about 1 °C/min)' },
  wool: { cls: 'acid', ph: '4.5–6', temp: '98–100 °C', time: '45–60 min', note: 'do not exceed 100 °C' },
};
function wetBlock(compOut, cons, chain, input) {
  const checks = [];
  const stages = [];
  const precoloured = compOut.every((c) => c.method !== 'cross_dye');
  const hasStockCot = compOut.some((c) => c.method === 'stock_dyed' && CELLULOSIC.has(c.fibre));
  const dark = compOut.some((c) => c.lab[0] < 30);
  const fibres = [...new Set(compOut.map((c) => c.fibre))];
  let route, title;
  if (precoloured) {
    route = 'A'; title = 'Pre-coloured yarn: no dyeing — wet relaxation and bio-finishing only';
    stages.push({ stage: 'Relaxation wash', conditions: 'non-ionic detergent 0.8–1.0 g/L, sequestrant 1 g/L, anti-crease lubricant 1 g/L, 60–80 °C, 15–20 min, M:L 1:7–1:10', why: 'takes out knitting oil and wax without a hot alkaline boil, which would shift stock-dyed shades and bleed dark fibre onto the white' });
    stages.push({ stage: 'Bio-polish', conditions: `${dark || hasStockCot ? 'neutral cellulase, pH 6–7' : 'acid cellulase, pH 4.5–5.5'}, 50–55 °C, 30–60 min, 0.5–2 % o.w.f.; then 80–90 °C for 1–3 min to stop the enzyme`, why: 'removes the protruding fibre ends and the immature neps that grin white on a dark heather; the neutral enzyme limits back-staining on dark shades' });
    stages.push({ stage: 'Softening', conditions: 'cationic / amino micro-silicone 1–5 g/L, 40–50 °C, pH 5.0–5.5, 15–20 min', why: 'handle and sewability' });
    checks.push({ level: 'note', text: 'No peroxide bleach on a pre-coloured melange: it would bleach the dyed fibre and flatten the contrast the yarn was made for. The undyed fibre stays ecru.' });
    if (hasStockCot) checks.push({ level: 'note', text: 'Stock-dyed cotton: check the dye\'s wash fastness (4 or better on the white component) — a poorly washed fibre stain shows as a grey haze on the ecru fibres.' });
  } else {
    route = 'B'; title = 'Cross-dyed heather: each fibre takes its own dye class, in the order the chemistry allows';
    const dyed = compOut.filter((c) => c.method === 'cross_dye');
    const byClass = {};
    compOut.forEach((c) => {
      const cls = c.variant === 'cdp' ? 'cationic' : DYE[c.fibre].cls;
      (byClass[cls] = byClass[cls] || []).push(c);
    });
    const classes = Object.keys(byClass);
    // staining / selectivity: which classes would also stain a neighbour
    const hasPoly = byClass.disperse && byClass.disperse.length;
    const hasCell = byClass.reactive && byClass.reactive.length;
    stages.push({ stage: 'Preparation', conditions: 'alkaline scour' + (compOut.some((c) => c.method === 'raw' && c.lab[0] > 80) ? ' and peroxide bleach (the cotton must be white where it is to stay white or take a pale tint)' : '') + ', 98 °C, absorbency 95–99 % on the drop test', why: 'every fibre must wet out evenly before any dye class is put on' });
    const order = [];
    if (hasPoly) order.push('disperse');
    if (byClass.cationic) order.push('cationic');
    if (byClass.acid) order.push('acid');
    if (hasCell) order.push('reactive');
    order.forEach((cls) => {
      const f = byClass[cls][0];
      const d = cls === 'cationic' ? { cls, ph: '4–4.5 (acetic acid), Na₂SO₄ 6 g/L', temp: (f.variant === 'cdp' ? '110–120 °C, ramp 0.5 °C/min through 85 °C' : '100 °C'), time: '30–60 min', note: 'cationic dyes bond to the sulphonate sites of cationic-dyeable polyester or acrylic' } : DYE[f.fibre];
      stages.push({ stage: `${cls[0].toUpperCase() + cls.slice(1)} dyeing — ${byClass[cls].map((c) => c.label.toLowerCase() + (c.variant === 'cdp' ? ' (cationic-dyeable)' : '')).join(', ')}`, conditions: `pH ${d.ph}, ${d.temp}, ${d.time}${d.note ? '; ' + d.note : ''}`, why: cls === 'disperse' ? 'polyester goes FIRST: its 130 °C acid bath and the alkaline reduction clear that follows would strip reactive dye already on the cotton' : cls === 'reactive' ? 'cellulose last: the fixation (pH 10.5–11.5, 60 °C) leaves the already-dyed polyester untouched' : 'selective: only this fibre takes this class' });
      if (cls === 'disperse' && hasCell) stages.push({ stage: 'Reduction clear', conditions: 'sodium hydrosulphite 2 g/L + caustic soda 2 g/L, 80 °C, 20 min; rinse and neutralise', why: 'removes disperse dye from the surface of the cotton so the reactive that follows takes cleanly (its colour is unstained)' });
    });
    stages.push({ stage: 'Soaping and finishing', conditions: 'neutral soap 1–3 g/L, 90–95 °C, 15 min; neutralise; softener', why: 'wash fastness and rub fastness' });
    if (hasPoly && hasCell) checks.push({ level: 'note', text: 'Disperse + reactive may be run in ONE bath (alkali-stable disperse dyes first at 130 °C, pH 4.5–5; cool; add soda ash for the reactive) — it saves a bath and the water, but only with dyes chosen for it.' });
    if (classes.length > 2) checks.push({ level: 'warn', text: `${classes.length} dye classes in one fabric: allow a strike-through test on every fibre before the bulk dye — each class stains the others a little.` });
    if (classes.length < 2) checks.push({ level: 'warn', text: 'Every fibre here takes the SAME dye class: dyeing the fabric colours them all alike. A cross-dyed heather needs fibres that differ in dye affinity (cotton with polyester, or regular with cationic-dyeable polyester).' });
    if (compOut.some((c) => c.fibre === 'wool') && compOut.some((c) => c.fibre === 'cotton')) checks.push({ level: 'note', text: 'Wool with cotton: acid dyes colour the wool and leave the cotton white; the hot alkaline reactive step would damage the wool, so a neutral-fixing reactive is needed.' });
    void dyed;
  }
  // water: the share of the mass that has to be dyed in water at all
  const coloured = compOut.filter((c) => c.coloured).reduce((t, c) => t + c.dry, 0);
  const water = precoloured
    ? { route_a_l_per_kg: V(r1(coloured * 65 + 35), 'L/kg', 'typical', { rule: 'stock-dyeing the coloured fibre alone (50–80 L/kg of that fibre) + the wash / bio-polish baths (~35 L/kg)' }), piece_dye_l_per_kg: V(165, 'L/kg', 'typical', { rule: 'piece dyeing the whole fabric (100–150 L/kg) + preparation' }) }
    : { cross_dye_l_per_kg: V(165, 'L/kg', 'typical') };
  return { route, title, stages, fibres, dye_classes: precoloured ? null : Object.fromEntries(Object.entries(compOut.reduce((a, c) => { const k = c.variant === 'cdp' ? 'cationic' : DYE[c.fibre].cls; (a[k] = a[k] || []).push(c.fibre); return a; }, {}))), water, checks };
}

// ── defects ─────────────────────────────────────────────────────────────────────────────────
function defectBlock(compOut, cons, route, spinKey, chain, colour, mixing, yarn, input, marl) {
  const out = [];
  const add = (id, label, risk, why, remedy) => out.push({ id, label, risk: r2(clamp(risk, 0, 1)), level: risk >= 0.66 ? 'high' : risk >= 0.33 ? 'medium' : 'low', why, remedy });
  const pEff = chain.label[colour._eff.idx];
  const sens = colour.sensitivity.per_point_dE;
  const lot = mixing.lot_shade;
  if (cons.group !== 'ply' && cons.group !== 'cross') {
    add('blend_barre', 'Blend barré / lot shade drift',
      (lot ? clamp(lot.two_sigma_dE / (lot.tolerance_dE * 2), 0, 1) : 0.3) + (pEff < 0.15 ? 0.15 : 0),
      lot ? `the share varies ±${lot.two_sigma_dE ? r2(lot.two_sigma_dE / Math.max(sens, 0.01)) : '?'} points between lots (ΔE ±${lot.two_sigma_dE}); a point of share is ΔE ${sens} here` : 'the blend ratio drifts between lots',
      'Weigh the bales on the issue figures (not the nominal ratio), hold the sliver weights, creel one lot per fabric, and test every lot against the standard before knitting.');
    const dM = chain.driftLabel[colour._eff.idx] - chain.label[colour._eff.idx];
    add('nominal_drift', 'Off-shade from weighing at the nominal ratio', clamp(Math.abs(dM) * 100 / 4, 0, 1),
      `weighing the bales at the label ratio gives ${r1(chain.driftLabel[colour._eff.idx] * 100)} % ${compOut[colour._eff.idx].label.toLowerCase()} instead of ${r1(pEff * 100)} % (waste and regain differ between the fibres)`,
      'Issue by the mass-chain figures: each fibre divided by its own realization.');
    const whiteCot = compOut.some((c) => c.fibre === 'cotton' && c.method === 'raw' && !c.combed);
    const darkShare = Math.max(...compOut.filter((c) => c.coloured).map((c) => c.dry), 0);
    add('white_specks', 'White specks (immature cotton neps)', whiteCot && darkShare >= 0.4 ? clamp(0.4 + darkShare * 0.6, 0, 1) : darkShare >= 0.4 ? 0.2 : 0.1,
      whiteCot && darkShare >= 0.4 ? 'uncombed raw cotton in a dark blend: immature fibre refuses dye and forms white neps' : 'low while the white cotton is combed or the shade is light',
      'Use a combed white sliver, not raw bale, above 40 % dark; set card flats and licker-in for nep removal; clear optically at the winder.');
    add('fibre_damage', 'Weak, hairy yarn from dyed fibre', clamp(yarn.dyed_fibre_damage_index * 1.2, 0, 1),
      `stock-dyed fibre in the blend (damage index ${yarn.dyed_fibre_damage_index}): wax stripped, fibre shortened by dyeing and carding`,
      'Re-oil with 0.5–1.5 % spin-finish after dyeing, run the card gentler, compact or Siro-compact spinning, a higher twist multiplier for deep shades.');
  }
  if (cons.group === 'ply') {
    add('ply_tracking', 'Stripes or checks from the colour turn meeting the stitch', marl ? (marl.level === 'warn' ? 0.75 : marl.turns_per_stitch > 0 ? 0.2 : 0) : 0.2,
      marl ? marl.look : 'the colours turn along the yarn at a fixed pitch; the stitch samples it at a fixed length',
      'Move the stitch length by 8–10 % or the ply twist by about 10 %; hold the stitch length identical at every feeder.');
    const bleed = compOut.some((c) => c.method === 'stock_dyed') ? 0.4 : 0.12;
    add('ply_bleed', 'Dark ply staining the light ply in wash', bleed, bleed > 0.3 ? 'stock-dyed yarn against undyed yarn: loose dye in the first washes marks the light ply' : 'spun-dyed colour is in the fibre and does not run',
      'Wash-fastness test (4 or better on the white ply) before bulk; a hot soaping at the end of wet processing.');
    if (cons.id === 'siro_marl') add('strand_break', 'One strand breaks: a single-strand yarn', 0.25, 'if one roving breaks, the frame spins the other strand alone — a thin, one-colour length in the yarn', 'A break-out device at the front rollers; clear it at the winder with the optical clearer.');
    else add('ply_untwist', 'Plies separate or twist unevenly', 0.25, 'a folded yarn can be untwisted into its singles; uneven ply twist shows as bars', 'Hold the doubling tension equal on both ends and the ply twist to ±3 %.');
  }
  if (cons.group === 'cross') {
    add('cross_stain', 'Cross-staining between fibres', 0.5, 'each dye class stains the other fibre a little; deep shades on one fibre show through on the other', 'Reduction clear after disperse; strike-through test; wash-off at 95 °C; choose dyes by their staining on the neighbour fibre.');
    add('shade_repeat', 'Shade reproducibility', 0.45, 'two dyeings that must both be right: either one off moves the heather', 'Dose salt and alkali by programme, hold pH and temperature curves, check the polyester shade alone after carbonising a swatch.');
  }
  if (cons.group !== 'ply') {
    const mf = mixing.random_mix.mixing_factor;
    add('mottle', 'Cloudiness: dyed fibre left in ribbons', (mf - 1) / 1.5, `the blend is ${r2(mf)}× as uneven as a perfectly random mix (the unavoidable melange mottle is ΔE ±${mixing.mottle.unavoidable_dE_1sigma} per stitch; this route adds ±${mixing.mottle.extra_from_mixing_dE})`,
      route === 'draw_frame' ? 'A second and third draw-frame passage after the blend, or a tuft blend; finer fibres; a coarser yarn (more fibres in the section).' : 'Open the tufts finer before the blend; the card does the rest.');
  }
  return out.sort((a, b) => b.risk - a.risk);
}

// ── composition and the Studio's yarn ───────────────────────────────────────────────────────
function compositionOf(compOut, chain) {
  const comp = {};
  compOut.forEach((c, i) => { comp[c.fibre] = (comp[c.fibre] || 0) + chain.label[i] * 100; });
  const dry = {};
  compOut.forEach((c) => { dry[c.fibre] = (dry[c.fibre] || 0) + c.dry * 100; });
  return { label_pct: Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, r1(v)])), dry_pct: Object.fromEntries(Object.entries(dry).map(([k, v]) => [k, r1(v)])), basis: 'law', note: 'label % is on the conditioned (commercial regain) basis; dry % is the bone-dry mass' };
}
function mapStudioFibre(dryPct) {
  const g = (k) => dryPct[k] || 0;
  const cell = g('cotton') + g('viscose') + g('modal') + g('tencel') + g('bamboo');
  if (g('polyester') >= 50) return 'polyester_spun';
  if (g('polyester') >= 20 && g('cotton') >= 30) return 'cvc';
  if (g('polyester') >= 20 && cell >= 30) return 'cvc';
  if (g('modal') + g('tencel') >= 50) return 'modal';
  if (g('viscose') + g('bamboo') >= 50) return 'viscose';
  return 'cotton';
}
function toStudioYarn(compOut, cons, spinKey, count, chain, input) {
  const dry = {}; compOut.forEach((c) => { dry[c.fibre] = (dry[c.fibre] || 0) + c.dry * 100; });
  const fibre = mapStudioFibre(dry);
  const form = count.form === 'slub' ? 'slub' : cons.group === 'ply' && input.type === 'folded_marl' ? 'ply2' : 'single';
  // a folded marl of equal singles is that single ×n plies (the spinning limit is the single's); unequal singles go in
  // as the resultant count, with the finest single as the count the spinning system must reach
  let cnt = r2(count.tex), ply = 1, spinNe = null;
  if (count.plies) {
    const t0 = count.plies[0];
    spinNe = r2(590.5 / Math.min(...count.plies));
    // the yarn's mass per metre includes the ply twist's take-up: each ply carries its share of the RESULTANT tex
    if (count.plies.length <= 4 && count.plies.every((t) => Math.abs(t - t0) / t0 < 0.01)) { ply = count.plies.length; cnt = r2(count.tex / ply); }
  }
  return {
    count: cnt, unit: 'tex', ply, fibre, type: spinKey, form, ...(spinNe ? { spin_ne: spinNe } : {}),
    mix: Object.fromEntries(Object.entries(dry).map(([k, v]) => [k, r2(v)])),
    melange: true,
    note: `the Studio weighs this yarn as ${FIBRES[fibre] || fibre} at its resultant count; its true fibre mix is carried alongside`,
  };
}
function identity(compOut, cons, colour, chain, count, spinKey) {
  const mix = compOut.map((c, i) => `${r1(chain.label[i] * 100)} % ${c.label.toLowerCase()}${c.coloured ? ' (' + (c.method === 'dope_dyed' ? 'spun-dyed' : c.method === 'stock_dyed' ? 'stock-dyed' : 'cross-dyed') + ')' : ''}`).join(' · ');
  const t = colour.trade_shade;
  return {
    title: `${t ? t.label + ' — ' : ''}${cons.label}`,
    detail: `${mix} · ${r1(590.5 / count.tex)}s Ne (${r2(count.tex)} tex) · ${spinKey.replace('_', '-')}${count.form === 'ply2' ? ', ' + count.ply + '-ply' : ''}`,
    blend_hex: colour.blend.hex,
  };
}
function massOut(compOut, chain) {
  const kg = chain.yarnCond;
  return {
    basis_kg_conditioned_yarn: kg,
    blend_regain: V(r2(chain.blendR), '%', 'blend', { rule: 'Σ dry share × regain' }),
    yarn_dry_kg: V(r1(chain.yarnDry), 'kg', 'law', { rule: 'conditioned ÷ (1 + blend regain)' }),
    per_component: compOut.map((c, i) => ({
      fibre: c.fibre, label: c.label,
      label_share_pct: r2(chain.label[i] * 100), dry_share_pct: r2(chain.dry[i] * 100), regain_pct: chain.R[i],
      realization_pct: r2(chain.real[i] * 100), realization_rule: `(1 − blow)(1 − card)(1 − comb)(1 − spin) = (1−${c.waste.blow / 100})(1−${c.waste.card / 100})(1−${c.waste.comb / 100})(1−${c.waste.spin / 100})`,
      waste_basis: c.waste_basis,
      issue_dry_kg: r1(chain.issueDry[i]), issue_conditioned_kg: r1(chain.issueCond[i]), issue_share_pct: r2((chain.issueCond[i] / chain.issueTot) * 100),
      if_weighed_at_label_ratio_pct: r2(chain.driftLabel[i] * 100),
    })),
    issue_total_conditioned_kg: r1(chain.issueTot),
    overall_realization_pct: r1((chain.yarnDry / chain.issueDry.reduce((t, v) => t + v, 0)) * 100),
    note: 'Issue the bales by the issue share, not the label share: each fibre is divided by its own realization. "If weighed at the label ratio" is the shade the yarn would really have.',
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FOR THE STUDIO
// ═════════════════════════════════════════════════════════════════════════════════════════════
/**
 * The Studio carries melange yarns per role (ground / binder / loop / plate). Each role's melange is analysed and
 * its count, fibre family and spinning system replace that role's yarn; the full analysis rides along.
 * Returns { input, results } — input is a shallow copy with the yarns replaced.
 */
function applyToInput(input) {
  const mel = input && input.melange && typeof input.melange === 'object' ? input.melange : null;
  if (!mel) return { input, results: null };
  const next = { ...input, yarns: { ...(input.yarns || {}) } };
  const results = {};
  for (const role of ['ground', 'binder', 'loop', 'plate']) {
    const spec = mel[role];
    if (!spec || typeof spec !== 'object' || spec.enabled === false) continue;
    const res = analyse(spec);
    results[role] = res;
    const y = res.studio_yarn;
    const yarnIn = { count: y.count, unit: y.unit, ply: y.ply || 1, fibre: y.fibre, type: y.type, form: y.form, mix: y.mix, melange: true, spin_ne: y.spin_ne };
    if (role === 'ground') next.yarn = { ...(input.yarn || {}), ...yarnIn };
    else next.yarns[role] = { ...(input.yarns && input.yarns[role] || {}), ...yarnIn };
  }
  return { input: next, results: Object.keys(results).length ? results : null };
}

/** What a user can pick: constructions, fibres, methods, routes, presets. */
function catalogue() {
  return {
    constructions: Object.entries(CONSTRUCTIONS).map(([id, c]) => ({ id, label: c.label, group: c.group, effect: c.effect, what: c.what, stage: c.stage, routes: c.routes.map((r) => ({ id: r, label: ROUTES[r].label, note: ROUTES[r].note })) })),
    fibres: Object.entries(FIBRES).map(([id, label]) => ({ id, label, regain_pct: regainOf(id), natural_hex: NATURAL_HEX[id], dtex: FIBRE_DTEX[id] })),
    methods: Object.entries(METHODS).map(([id, label]) => ({ id, label })),
    spinning: SPINNING.map((id) => ({ id, label: (Y.SPINNING_SYSTEMS[id] || {}).label || id })),
    shades: Object.entries(SHADES).map(([id, s]) => ({ id, label: s.label, min: s.min, max: s.max })),
    presets: PRESETS,
  };
}
const PRESETS = [
  { id: 'grey_90_10', label: 'Grey melange — 90/10 cotton / black viscose', spec: { type: 'fibre_melange', route: 'draw_frame', spinning: 'compact', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 90 }, { fibre: 'viscose', share: 10, colour: '#1d1d20', method: 'dope_dyed' }] } },
  { id: 'grey_85_15', label: 'Medium grey melange — 85/15', spec: { type: 'fibre_melange', route: 'draw_frame', spinning: 'compact', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 85 }, { fibre: 'viscose', share: 15, colour: '#1d1d20', method: 'dope_dyed' }] } },
  { id: 'anthra_70_30', label: 'Anthra melange — 70/30', spec: { type: 'fibre_melange', route: 'blow_room', spinning: 'combed', count: { value: 26, unit: 'ne' }, components: [{ fibre: 'cotton', share: 70 }, { fibre: 'viscose', share: 30, colour: '#1d1d20', method: 'dope_dyed' }] } },
  { id: 'charcoal_45_55', label: 'Charcoal melange — 45/55', spec: { type: 'fibre_melange', route: 'blow_room', spinning: 'combed', count: { value: 24, unit: 'ne' }, components: [{ fibre: 'cotton', share: 45 }, { fibre: 'viscose', share: 55, colour: '#1d1d20', method: 'dope_dyed' }] } },
  { id: 'navy_cotton', label: 'Navy melange — 100 % cotton, stock-dyed navy in raw', spec: { type: 'fibre_melange', route: 'blow_room', spinning: 'combed', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 70 }, { fibre: 'cotton', share: 30, colour: '#1f2f5a', method: 'stock_dyed' }] } },
  { id: 'cvc_heather', label: 'CVC heather — 60/40 cotton / polyester, cross-dyed', spec: { type: 'cross_dye_heather', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 60, colour: '#8a8f99', method: 'cross_dye' }, { fibre: 'polyester', share: 40 }] } },
  { id: 'tri_blend', label: 'Tri-blend — 50 polyester / 25 cotton / 25 viscose', spec: { type: 'cross_dye_heather', count: { value: 32, unit: 'ne' }, components: [{ fibre: 'polyester', share: 50, colour: '#6b7280', method: 'cross_dye' }, { fibre: 'cotton', share: 25 }, { fibre: 'viscose', share: 25, colour: '#6b7280', method: 'cross_dye' }] } },
  { id: 'cdp_heather', label: 'Polyester heather — regular + cationic-dyeable', spec: { type: 'cross_dye_heather', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'polyester', share: 50, colour: '#1f2f5a', method: 'cross_dye', variant: 'cdp' }, { fibre: 'polyester', share: 50, colour: '#c9ccd3', method: 'cross_dye' }] } },
  { id: 'siro_marl', label: 'Siro marl — cotton / black polyester', spec: { type: 'siro_marl', route: 'roving', spinning: 'siro', count: { value: 30, unit: 'ne' }, components: [{ fibre: 'cotton', share: 50 }, { fibre: 'polyester', share: 50, colour: '#1d1d20', method: 'dope_dyed' }] } },
  { id: 'mouline_2ply', label: '2-ply mouline — 30s navy + 30s white', spec: { type: 'folded_marl', route: 'ply', spinning: 'combed', count: { value: 30, unit: 'ne' }, stitch_length_mm: 2.8, components: [{ fibre: 'cotton', share: 50, colour: '#1f2f5a', method: 'stock_dyed' }, { fibre: 'cotton', share: 50 }] } },
];

module.exports = { analyse, applyToInput, catalogue, dE00, hexToLab, mixFibres, mixDomains, creelOptions, massChain, MelangeError, CONSTRUCTIONS, PRESETS, FIBRES };
