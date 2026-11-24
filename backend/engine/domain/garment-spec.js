'use strict';
/**
 * KnitAdvisor — the garment spec sheet reader
 * ===================================================================
 * A buyer's spec sheet (an Excel file, a PDF, a photograph, a CSV, or text pasted from any of them) in; the parts of the garment it names, every
 * measurement with its tolerance and its grading, the fabric, the stitching, the trims and the notes out, and the garment the pattern engine can draw from them.
 *
 *   rows of cells (with their place on the page)  ->  header row (sizes, tolerance, grade ...)  ->  one row per point of measure
 *   -> the catalogue (what each point of measure is called, whether the pattern engine draws it)  ->  the chart  +  the details around it
 *
 * What a sheet gives is kept as it is (its own names, codes, values and unit); what the engine needs is derived from it and says how
 * (a circumference is halved, a sleeve length from the centre back is cut back by half the shoulder). Nothing is invented: a row that is not
 * understood is listed, a figure that was converted is marked, and a tolerance the sheet did not give is marked as assumed.
 *
 * Pure functions on plain data (no files, no OCR: services/spec-reader.js turns a file into rows). Units: the sheet's own, cm in the engine.
 */

const G = require('./garment-pattern');
const SH = require('./garment-shorts');
// what each pattern engine draws: a spec for shorts is read against the shorts' points of measure, a tee's against the tee's
const ENGINE_KEYS = { tee: new Set(G.POM_KEYS), shorts: new Set(SH.POM_KEYS) };
const isDrawn = (key, engine) => !!(key && ENGINE_KEYS[engine || 'tee'] && ENGINE_KEYS[engine || 'tee'].has(key));

const INCH = 2.54;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const clean = (s) => String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

// ── numbers as a sheet writes them ──
function val(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  let s = clean(raw);
  if (!s || /^(n\/?a|na|-+|—|–|tbd|nil|x)$/i.test(s)) return NaN;
  s = s.replace(/\s*(cm|inch(?:es)?|in|"|”|″|'')\s*$/i, '').trim();
  if (/[a-z]/i.test(s)) return NaN;                                          // text: S/M, 12 spi, a remark
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return NaN;               // a date (21-1/2 is twenty-one and a half)
  return G.num(s);
}
const NUMBER = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';
function tolOf(raw) {                                                        // ±0.5, +/- 1/2, +1/-1/2, 0.5, -0.5, MIN, MAX
  if (/^(min|minimum)\.?$/i.test(clean(raw))) return { plus: null, minus: null, limit: 'min' };
  if (/^(max|maximum)\.?$/i.test(clean(raw))) return { plus: null, minus: null, limit: 'max' };
  let s = clean(raw).replace(/±/g, '+/-').replace(/[−–—]/g, '-').replace(/\s+/g, ' ');
  if (!s) return null;
  let m = new RegExp('^\\+\\s*/\\s*-\\s*' + NUMBER + '$').exec(s);
  if (m) { const v = Math.abs(val(m[1])); return Number.isFinite(v) ? { plus: v, minus: v } : null; }
  m = new RegExp('^\\+\\s*' + NUMBER + '\\s*/\\s*-\\s*' + NUMBER + '$').exec(s);
  if (m) { const a = val(m[1]), b = val(m[2]); return Number.isFinite(a) && Number.isFinite(b) ? { plus: a, minus: b } : null; }
  m = new RegExp('^\\(?([+-])?\\)?\\s*' + NUMBER + '$').exec(s);
  if (m) { const v = Math.abs(val(m[2])); if (!Number.isFinite(v)) return null; return m[1] === '-' ? { plus: null, minus: v } : m[1] === '+' ? { plus: v, minus: null } : { plus: v, minus: v }; }
  return null;
}

// ── sizes ──
const SIZE_RE = [/^(xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl|[2-7]\s*xl|[2-3]\s*xs|os|osfa|one\s*size|f|free)$/i, /^(xx?s|xx?l|s|m|l|xl)\s*\/\s*(xx?s|xx?l|s|m|l|xl)$/i, /^\d{1,2}\s*(y|yr|yrs|year|years|m|mth|mths|month|months|t)$/i, /^size\s*\d{1,2}$/i, /^(s|m|l|xl)\s*[-–]\s*(s|m|l|xl)$/i];
const sizeName = (t) => clean(t).replace(/\(.*?\)/g, '').replace(/[*#]/g, '').replace(/\bbase\b|\bsample\b/gi, '').trim().toUpperCase().replace(/[^\w/-]+/g, '');          // a stray bracket or bar from OCR (S)) is not part of the size
const isSizeTok = (t) => { const s = sizeName(t); return !!s && s.length <= 8 && SIZE_RE.some((re) => re.test(s)); };
const baseMark = (t) => /\*|\bbase\b|\bsample\b|\bmaster\b/i.test(t);

// ── column headings ──
function headKind(t) {
  const s = clean(t).toLowerCase().replace(/[:.]/g, '');
  if (!s) return null;
  if (isSizeTok(t)) return 'size';
  if (/^(tol(erance)?\s*\(?\s*\+\s*\)?|\+\s*tol(erance)?|plus|tol\s*\+|\(\+\)|\+ve)$/.test(s)) return 'tol_plus';
  if (/^(tol(erance)?\s*\(?\s*[-−–]\s*\)?|[-−–]\s*tol(erance)?|minus|tol\s*[-−–]|\([-−–]\)|[-−–]ve)$/.test(s)) return 'tol_minus';
  if (/^(tol(erance)?s?|±|\+\/-|\+\/−|(±|\+\/-)\s*tol(erance)?s?|tol(erance)?s?\s*(±|\(?\+\/-\)?)|tol\s*\(\s*\+\/-\s*\))$/.test(s)) return 'tol';
  if (/^(grade|grading|grade\s*rule|grade\s*jump|jump|increment|step|gr)$/.test(s)) return 'grade';
  if (/^(code|pom\s*(code|#|no|id)|#|ref|no|item|id|sr|sl|s\/n|sn|sl\s*no)$/.test(s)) return 'code';
  if (/(point\s*of\s*measure|pom|description|measurement|measure|garment\s*part|part)/.test(s) && s.length < 40) return 'label';
  if (/^(spec|specs|specification|sample|base|std|standard|target|final|finished|actual|measurement|value|size)$/.test(s)) return 'spec';
  if (/(remark|comment|note|how\s*to|method|htm|instruction)/.test(s)) return 'remark';
  return null;
}

// ── what a point of measure is called (specific names first) ──
const E = (key, name, group, re, tol, o) => Object.assign({ key, name, group, re, tol, engine: G.POM_KEYS.includes(key) }, o || {});
const EXTRA = [
  E('eyelet_dist', 'Distance between drawcord eyelets', 'Waistband', /(eyelet|draw\s*cord).*(distance|between|apart|centre\s*to\s*centre|center\s*to\s*center)|distance.*(eyelet|draw\s*cord)/, 0.3),
  E('drawcord_len', 'Visible drawcord length (waistband extended)', 'Waistband', /draw\s*cord|draw\s*string/, 1.0, { note: 'a limit, not a size: kept and used for the drawcord in the bill of materials' }),
  E('pbag_w', 'Pocket bag width', 'Pockets', /pocket\s*bag.*(width|wid)/, 0.5),
  E('pbag_l', 'Pocket bag length', 'Pockets', /pocket\s*bag.*(length|len|depth)/, 0.5),
  E('bwelt_w', 'Back pocket welt width', 'Pockets', /back\s*pocket\s*welt|welt.*back/, 0.5),
  E('fwelt_w', 'Front pocket welt width', 'Pockets', /(slant\w*|front|side)\s*(pocket\s*)?welt/, 0.5),
  E('bpocket_l', 'Back pocket length', 'Pockets', /back\s*pocket.*(length|len|depth|height)/, 0.5),
  E('bpocket_w', 'Back pocket width', 'Pockets', /back\s*pocket.*(width|wid)/, 0.5),
  E('bpocket_pos', 'Back pocket position (below the waistband)', 'Pockets', /back\s*pocket.*(position|from|under|below)/, 0.5),
  E('fpocket_l', 'Front pocket opening, length at the side seam', 'Pockets', /(slant\w*|front|side)\s*pocket.*(length|len|depth|at\s*side)/, 0.5),
  E('fpocket_w', 'Front pocket opening, width across the waistband', 'Pockets', /(slant\w*|front|side)\s*pocket.*(width|wid|across)/, 0.5),
  E('fly_depth', 'Fly depth', 'Fly', /\bfly.*(depth|length|len)/, 0.3),
  E('fly_width', 'Fly width', 'Fly', /\bfly.*(width|wid)/, 0.3),
  E('outseam', 'Outside leg length (top of the waistband to the hem)', 'Bottoms', /outside\s*leg|out\s*seam|outer\s*leg|trouser\s*length|pant\s*length|short\s*length|leg\s*length/, 1.0),
  E('inseam', 'Inside leg length', 'Bottoms', /in\s*seam|inside\s*leg|inner\s*leg/, 1.0),
  E('back_rise', 'Back rise (including the waistband)', 'Bottoms', /back\s*rise|rise.*back/, 0.5),
  E('front_rise', 'Front rise (including the waistband)', 'Bottoms', /front\s*rise|rise.*front|\brise\b/, 0.5),
  E('waist_stretched', 'Waist, stretched (flat)', 'Waistband', /waist.*(stretch|extend|max)|stretched.*waist/, 1.0, { halves: true }),
  E('waist', 'Waist, relaxed (flat)', 'Waistband', /\bwaist(?!\s*band)/, 0.5, { halves: true }),
  E('waistband_h', 'Waistband depth', 'Waistband', /^\s*waist\s*band|waist\s*band\s*(height|ht|depth|wid)/, 0.3),
  E('seat_pos', 'Seat position (down from the top of the waistband)', 'Bottoms', /(seat|hip).*(position|down|depth|from)/, 0.5),
  E('seat_w', 'Seat / hip width (flat)', 'Bottoms', /\b(seat|hips?)\b/, 0.5, { halves: true }),
  E('thigh', 'Thigh width, from the crotch seam (flat)', 'Bottoms', /thigh/, 0.5, { halves: true }),
  E('leg_opening', 'Leg opening / hem width (flat)', 'Bottoms', /leg\s*(opening|hem|bottom)/, 0.5, { halves: true }),
  E('sleeve_cb', 'Sleeve length from centre back', 'Sleeve', /sleeve.*(c\.?\s*b\b|cent(re|er)\s*back|back\s*neck)|(c\.?\s*b\b|cent(re|er)\s*back).*sleeve/, 1.0, { note: 'turned into the sleeve length from the shoulder point: the centre back to the shoulder point is half the shoulder' }),
  E('cb_length', 'Centre-back length (back neck to hem)', 'Body', /(c\.?\s*b\b|cent(re|er)\s*back|back\s*neck\s*point).*(length|hem)|c\.?\s*b\.?\s*length/, 1.0, { note: 'turned into the body length from the shoulder: the back neck sits below it' }),
  E('front_length', 'Front length (high point shoulder to hem)', 'Body', /(front|fr\b)\s*(body\s*)?length|length.*\(?\s*front/, 1.0),
  E('back_length', 'Back length (high point shoulder to hem)', 'Body', /(back|bk\b)\s*(body\s*)?length|length.*\(?\s*back/, 1.0),
  E('across_back', 'Across back', 'Body', /across\s*back|back\s*(width|across)|upper\s*back|back\s*width/, 1.0, { depth: true }),
  E('across_chest', 'Across chest (front)', 'Body', /across\s*(front|chest)|front\s*(width|across)|upper\s*chest|chest\s*across/, 1.0, { depth: true }),
  E('armhole_curve', 'Armhole, curved (along the seam)', 'Armhole', /arm\s*hole.*(curv|round|along|contour|measured|perimeter|circ)|(curv\w*|round)\s*arm\s*hole|armscye.*curv/, 0.5),
  E('armhole_drop', 'Armhole depth (high point shoulder to underarm)', 'Armhole', /arm\s*hole.*(drop|depth|deep)|(hps|shoulder).*(underarm|armpit)|underarm.*(depth|drop)/, 0.5),
  E('neck_stretch', 'Neck opening, stretched', 'Neck', /neck.*(stretch|extend|max|elastic)|(stretch|extend)\w*\s*neck/, 1.0),
  E('neck_circ', 'Neck opening, round the seam', 'Neck', /neck.*(circ|round|around|perimeter)|collar.*circ/, 0.7),
  E('side_length', 'Side seam length (underarm to hem)', 'Body', /side\s*(seam)?\s*(length|len)|underarm.*(to\s*)?hem|inseam\s*side/, 0.7),
  E('elbow', 'Elbow width', 'Sleeve', /elbow/, 0.5),
  E('placket_l', 'Placket length', 'Collar and placket', /placket.*(length|len|drop)|^placket$/, 0.5),
  E('placket_w', 'Placket width', 'Collar and placket', /placket.*(width|wid|w\b)/, 0.3),
  E('collar_h', 'Collar height at back', 'Collar and placket', /collar.*(height|ht|stand|back|depth)|collar\s*(rise|fall)/, 0.3, { note: 'a collar sewn on a polo is not drawn yet; a neck band is' }),
  E('pocket_w', 'Pocket width', 'Pockets', /pocket.*(width|wid|w\b)/, 0.5),
  E('pocket_h', 'Pocket height', 'Pockets', /pocket.*(height|depth|length|drop|ht)/, 0.5),
  E('pocket_pos', 'Pocket position', 'Pockets', /pocket.*(place|position|from|below|apart|distance|pos)/, 0.5),
  E('hood_h', 'Hood height', 'Hood', /hood.*(height|ht|depth)/, 0.7),
  E('hood_w', 'Hood width', 'Hood', /hood.*(width|wid|w\b)/, 0.7),
  E('knee', 'Knee', 'Bottoms', /knee/, 0.5, { halves: true }),
];
// the engine's own points of measure, in the order the engine's aliases name them
const ENGINE = Object.fromEntries(G.POMS.map((p) => [p.key, p]));
const ENGINE_META = {
  chest: { group: 'Body', tol: 1.0, halves: true }, length: { group: 'Body', tol: 1.0 }, shoulder: { group: 'Shoulder', tol: 0.7 }, armhole: { group: 'Armhole', tol: 0.5 }, neck_w: { group: 'Neck', tol: 0.5 },
  neck_df: { group: 'Neck', tol: 0.5 }, neck_db: { group: 'Neck', tol: 0.5 }, sleeve_l: { group: 'Sleeve', tol: 0.7 }, bicep: { group: 'Sleeve', tol: 0.5, halves: true }, sleeve_o: { group: 'Sleeve', tol: 0.5, halves: true },
  hem: { group: 'Hem', tol: 1.0, halves: true }, hem_h: { group: 'Hem', tol: 0.3 }, sleeve_hem_h: { group: 'Sleeve', tol: 0.3 }, rib_w: { group: 'Neck', tol: 0.3 }, slope: { group: 'Shoulder', tol: 0.5 },
};
const CATALOGUE = [].concat(EXTRA.map((e) => Object.assign({ halves: false }, e)), G.POMS.map((p) => Object.assign({ key: p.key, name: p.label, engine: true, re: null, note: '' }, ENGINE_META[p.key])));
const BY_KEY = Object.fromEntries(CATALOGUE.map((c) => [c.key, c]));
const MATCHERS = EXTRA.map((e) => [e.key, e.re]).concat(G.ALIASES);

// the sheet's label -> a point of measure, how it is taken (flat or round) and at what depth
function classify(label) {
  const full = clean(label).toLowerCase();
  const core = full.replace(/\([^)]*\)?/g, ' ').replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  const text = core || full.replace(/[()]/g, ' ');
  const hit = MATCHERS.find(([, re]) => re.test(text)) || MATCHERS.find(([, re]) => re.test(full));
  let basis = null;
  if (/\b(circ|circumference|around|round|total|full)\b|\bx\s*2\b|\b2\s*x\b|\bfull\s*(chest|bust)/.test(full)) basis = 'full';
  else if (/1\s*\/\s*2|\bhalf\b|\bflat\b|\bacross\b|\bwidth\b|\bstraight\b/.test(full)) basis = 'flat';
  const d = /(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)\s*(cm|in|inch|inches|")?\s*(below|from|under|down)\s*(the\s*)?(hps|hsp|shoulder|high\s*point|armhole|neck|nape)/.exec(full);
  return { key: hit ? hit[0] : null, basis, depth: d ? { v: val(d[1]), unit: /cm/.test(d[2] || '') ? 'cm' : /in|"/.test(d[2] || '') ? 'in' : null, from: d[5] } : null };
}

// ── the rows: a cell has its text and its place on the page (a spreadsheet's place is its column) ──
function dense(grid) {
  return (grid || []).map((r) => (r || []).map((t, ci) => ({ t: clean(t), x0: ci * 100, x1: ci * 100 + 90, c: 1 })).filter((c) => c.t !== ''));
}
function transposeGrid(grid) {
  const g = (grid || []).map((r) => (r || []).map(clean)), w = Math.max.apply(null, g.map((r) => r.length).concat([0])), out = [];
  for (let c = 0; c < w; c++) out.push(g.map((r) => r[c] || ''));
  return out;
}
const cx = (c) => (c.x0 + c.x1) / 2;
const rowText = (r) => r.map((c) => c.t).join(' : ');

// a header row: two or more sizes; or a "spec"/"sample" column beside a name column
function headerAt(rows, i) {
  const r = rows[i], kinds = r.map((c) => headKind(c.t));
  const sizes = r.filter((c, k) => kinds[k] === 'size');
  const uniq = new Set(sizes.map((c) => sizeName(c.t)));
  if (sizes.length >= 2 && uniq.size === sizes.length) return { i, kind: 'sizes' };
  if (sizes.length === 1 && r.length <= 3 && /^size$/i.test(clean(r[0].t))) return null;
  if (kinds.includes('spec') && r.some((c, k) => kinds[k] === 'label' || kinds[k] === 'tol' || kinds[k] === 'tol_plus' || kinds[k] === 'grade')) return { i, kind: 'single' };
  return null;
}
// a header of plain numbers (36 38 40 / 2 4 6 8 / 8 10 12): an even climb with names below
function numericHeaderAt(rows, i) {
  const r = rows[i], n = r.map((c) => (/^\d{1,3}$/.test(c.t) ? +c.t : NaN)).filter((v) => Number.isFinite(v));
  if (n.length < 3 || n.length !== r.filter((c) => /^\d{1,3}$/.test(c.t)).length) return null;
  const step = n[1] - n[0]; if (!(step > 0) || n.some((v, k) => k && v - n[k - 1] !== step)) return null;
  const next = rows[i + 1]; if (!next || !next.some((c) => /[a-z]{3}/i.test(c.t))) return null;
  return { i, kind: 'sizes', numeric: true };
}

function columnsOf(rows, h) {
  const r = rows[h.i], cols = [];
  r.forEach((c) => {
    let k = headKind(c.t);
    if (!k && h.numeric && /^\d{1,3}$/.test(c.t)) k = 'size';
    if (k === 'spec' && h.kind === 'sizes') k = null;
    if (!k && !(h.kind === 'sizes' && r.indexOf(c) === 0)) return;
    cols.push({ kind: k || 'label', text: c.t, name: k === 'size' ? sizeName(c.t) : null, x: cx(c), x0: c.x0, x1: c.x1, base: k === 'size' && baseMark(c.t) });
  });
  // a heading written on the line above (Tol / Grade over the numbers)
  for (let up = 1; up <= 2 && h.i - up >= 0; up++) rows[h.i - up].forEach((c) => {
    const k = headKind(c.t); if (!k || !(k.startsWith('tol') || k === 'grade')) return;        // only a tolerance or grade heading may sit on the line above
    const near = cols.find((q) => Math.abs(q.x - cx(c)) < Math.max(14, (q.x1 - q.x0) * 0.6));
    if (near) { if (!near.kind || near.kind === 'spec' || near.kind === 'label') { if (k.startsWith('tol') || k === 'grade') near.kind = k; } return; }
    cols.push({ kind: k, text: c.t, name: null, x: cx(c), x0: c.x0, x1: c.x1, base: false });
  });
  // a "base size" marked on the line above a size
  for (let up = 1; up <= 2 && h.i - up >= 0; up++) rows[h.i - up].forEach((c) => { if (/\b(base|sample|master)\b/i.test(c.t)) { const near = cols.filter((q) => q.kind === 'size').sort((a, b) => Math.abs(a.x - cx(c)) - Math.abs(b.x - cx(c)))[0]; if (near && Math.abs(near.x - cx(c)) < Math.max(20, (near.x1 - near.x0))) near.base = true; } });
  cols.sort((a, b) => a.x - b.x);
  cols.forEach((c, i) => { const gap = Math.min(i ? c.x - cols[i - 1].x : Infinity, i < cols.length - 1 ? cols[i + 1].x - c.x : Infinity); c.lim = Number.isFinite(gap) ? Math.max(gap * 0.62, (c.x1 - c.x0) * 0.55) : Math.max(30, (c.x1 - c.x0)); });
  return cols;
}

const CODE_RE = /^([A-Z]{1,2}\d{0,2}|\d{1,3}\.?|[A-Z]\d?[a-z]?)$/;
function parseTable(rows, h, end, ctx) {
  const cols = columnsOf(rows, h), data = cols.filter((c) => c.kind !== 'label' && c.kind !== 'code');
  if (!data.length) return [];
  const sizeCols = data.filter((c) => c.kind === 'size');
  const firstX = Math.min.apply(null, data.map((c) => c.x0));
  const out = []; let group = '', prev = null, pend = null;
  for (let i = h.i + 1; i < end; i++) {
    const r = rows[i]; if (!r.length) continue;
    const left = r.filter((c) => cx(c) < firstX - 1 || (c.x1 <= firstX + 1 && !data.some((d) => Math.abs(d.x - cx(c)) <= d.lim)));
    const right = r.filter((c) => !left.includes(c));
    const cell = {};
    right.forEach((c) => {
      const near = data.map((d) => ({ d, dx: Math.abs(d.x - cx(c)) })).sort((a, b) => a.dx - b.dx)[0];
      if (near && near.dx <= near.d.lim * 1.25) { const k = near.d.kind + '|' + near.d.x; if (cell[k]) cell[k].t += ' ' + c.t; else cell[k] = { d: near.d, t: c.t, c: c.c }; }
    });
    let code = '', label = '';
    const lt = left.slice().sort((a, b) => a.x0 - b.x0);
    if (pend && Object.keys(cell).length && lt.length) { const first = lt.filter((c) => !CODE_RE.test(c.t) || lt.length === 1); if (first.length && /^[a-z(]/.test(first[0].t)) { lt.splice(lt.indexOf(first[0]), 0, { t: pend, x0: first[0].x0 - 0.5, x1: first[0].x0 - 0.1 }); } }
    pend = null;
    if (!Object.keys(cell).length && lt.length === 1 && rows[i + 1] && /^[a-z(]/.test(((rows[i + 1].filter((c) => cx(c) < firstX - 1 && !CODE_RE.test(c.t))[0]) || { t: '' }).t) && Object.keys(rows[i + 1]).length) { pend = lt[0].t; continue; }
    if (lt.length >= 2 && CODE_RE.test(lt[0].t) && /[a-z]{2}/i.test(lt.slice(1).map((c) => c.t).join(' '))) { code = lt[0].t.replace(/\.$/, ''); label = lt.slice(1).map((c) => c.t).join(' '); }
    else { label = lt.map((c) => c.t).join(' '); const m = /^([A-Z]{1,2}\d?|\d{1,3})[.)]\s+(\S.*)$/.exec(label); if (m && /[a-z]{3}/i.test(m[2])) { code = m[1]; label = m[2]; } }
    const values = {}, conf = {}; let tolP = null, tolM = null, tolB = null, grade = null, remark = '', any = false, low = false;
    Object.keys(cell).forEach((k) => {
      const { d, t, c } = cell[k];
      if (d.kind === 'size' || d.kind === 'spec') { const v = val(t); if (Number.isFinite(v)) { values[d.kind === 'size' ? d.name : '*'] = v; any = true; if (c != null && c < 0.7) low = true; } else if (t) remark += (remark ? '; ' : '') + t; }
      else if (d.kind === 'tol_plus') { const q = tolOf(t) || (Number.isFinite(val(t)) ? { plus: Math.abs(val(t)), minus: null } : null); if (q) tolP = q.plus != null ? q.plus : q.minus; }
      else if (d.kind === 'tol_minus') { const q = tolOf(t) || (Number.isFinite(val(t)) ? { plus: null, minus: Math.abs(val(t)) } : null); if (q) tolM = q.minus != null ? q.minus : q.plus; }
      else if (d.kind === 'tol') { const q = tolOf(t); if (q) tolB = q; }
      else if (d.kind === 'grade') { const v = val(t); if (Number.isFinite(v)) grade = v; }
      else if (d.kind === 'remark' && t) remark += (remark ? '; ' : '') + t;
    });
    if (/please specify|^additional details\b|^styling detail/i.test(label)) { group = clean(label); prev = null; continue; }
    if (label && any) {
      const tol = tolP != null || tolM != null ? { plus: tolP != null ? tolP : tolM, minus: tolM != null ? tolM : tolP, given: true } : tolB && tolB.limit ? { plus: null, minus: null, limit: tolB.limit, given: true } : tolB ? { plus: tolB.plus != null ? tolB.plus : tolB.minus, minus: tolB.minus != null ? tolB.minus : tolB.plus, given: true } : null;
      out.push({ row: i, code, label: clean(label), group, values, tol, grade, remark: clean(remark), check: low });
      prev = out[out.length - 1];
    } else if (label && !any && !Object.keys(cell).length && lt.length <= 2 && label.length < 40 && !/[:;]/.test(label) && !/\d/.test(label)) { group = label; prev = null; }
    else if (prev && label && !any && /^[(a-z]/.test(label) && lt.length === 1 && i - prev.row === 1) { prev.label = clean(prev.label + ' ' + label); prev.row = i; }
  }
  if (h.kind === 'single' || !sizeCols.length) out.forEach((p) => { p.single = true; });
  if (out.length) ctx.tables.push({ header: h.i, sizes: sizeCols.map((c) => ({ name: c.name, base: c.base })), kind: h.kind });
  return out;
}

// ── the details around the table ──
const FIBRES = 'cotton|polyester|viscose|rayon|elastane|spandex|lycra|modal|tencel|lyocell|nylon|polyamide|acrylic|wool|merino|linen|silk|bamboo|hemp|cashmere|polypropylene|cupro|acetate|pima|supima';
const SEAM_WORDS = [
  ['waistband', /waist\s*band/], ['inseam', /in\s*seam|inside\s*leg/], ['rise', /\brise\b|crotch/], ['pocket', /pocket/],
  ['band_end', /band\s*(end|clos|join)|neck\s*(band\s*)?clos/], ['sleeve_hem', /sleeve\s*(hem|bottom|opening|end|cuff)|cuff/], ['underarm', /under\s*arm|sleeve\s*seam|sleeve\s*(underarm|inseam)/],
  ['armhole', /arm\s*hole|sleeve\s*(set|attach|join)|set[- ]?in|\bAH\b/i], ['shoulder', /shoulder/], ['side', /side\s*seam|\bside\b/], ['neck', /neck|collar|binding|rib\s*(attach|join)/], ['hem', /(body|bottom)\s*hem|\bhem\b|bottom\s*(opening|hem)|\bbottom\b/],
];
const STITCH_WORDS = [
  ['607', /flat\s*lock|flatseam|flat\s*seam|607/], ['605', /3[- ]?needle|three[- ]?needle|605|top\s*and\s*bottom\s*cover|triple\s*needle/], ['602', /2[- ]?needle|two[- ]?needle|twin[- ]?needle|cover\s*stitch|coverstitch|cover\s*seam|602|bottom\s*cover/],
  ['516', /5[- ]?thread|five[- ]?thread|safety\s*(stitch|overlock)|516/], ['514', /4[- ]?thread|four[- ]?thread|514/], ['504', /3[- ]?thread|three[- ]?thread|504/], ['401', /chain\s*stitch|chainstitch|401/], ['304', /zig\s*zag|zigzag|304/],
  ['301', /lock\s*stitch|lockstitch|single\s*needle|1[- ]?needle|top\s*stitch|topstitch|301/], ['514', /over\s*lock|overlock|serg(e|ing)/],
];
const STYLES = [
  { id: 'hoodie', name: 'Hoodie / sweatshirt with a hood', re: /\bhood(y|ie|ed)?\b/ }, { id: 'jacket', name: 'Jacket / cardigan', re: /\b(jacket|bomber|cardigan|blazer|coat|windbreaker|zip[- ]?through)\b/ },
  { id: 'trouser', name: 'Shorts / trousers / joggers', re: /\b(trousers?|pants?|joggers?|shorts?(?!\s*sleeve)|leggings?|jeans|inseam|outseam|waistband|outside\s*leg)\b/ }, { id: 'polo', name: 'Polo shirt', re: /\b(polo|placket)\b/ },
  { id: 'henley', name: 'Henley', re: /\bhenley\b/ }, { id: 'tank', name: 'Tank / sleeveless', re: /\b(tank|singlet|sleeveless|vest)\b/ }, { id: 'sweatshirt', name: 'Sweatshirt', re: /\b(sweat\s*shirt|pullover|crew\s*sweat|fleece\s*top)\b/ },
  { id: 'dress', name: 'Dress / skirt', re: /\b(dress|skirt|gown)\b/ }, { id: 'tee', name: 'T-shirt (crew / round neck)', re: /\b(t[- ]?shirt|tee|crew\s*neck|round\s*neck|jersey\s*top)\b/ },
];
const PARTS = [
  { id: 'front', name: 'Front body', re: /\bfront\b/, drawn: true }, { id: 'back', name: 'Back body', re: /\bback\b/, drawn: true }, { id: 'sleeve', name: 'Sleeve', re: /\bsleeve/, drawn: true },
  { id: 'band', name: 'Neck rib / neck band', re: /\b(rib|neck\s*band|neck\s*binding|binding)\b/, drawn: true }, { id: 'facing', name: 'Zipper facing', re: /\bfacing\b/, drawn: 'with a zipper' },
  { id: 'collar', name: 'Collar', re: /\bcollar\b/, drawn: false }, { id: 'placket', name: 'Placket', re: /\bplacket\b/, drawn: 'a quarter-zip placket only' }, { id: 'pocket', name: 'Pocket', re: /\bpocket/, drawn: false },
  { id: 'hood', name: 'Hood', re: /\bhood\b/, drawn: false }, { id: 'cuff', name: 'Cuff / sleeve rib', re: /\b(cuff|sleeve\s*rib)\b/, drawn: false }, { id: 'hemband', name: 'Hem band', re: /\b(hem\s*band|bottom\s*band|waist\s*rib)\b/, drawn: false },
  { id: 'waistband', name: 'Waistband', re: /waist\s*band/, drawn: false }, { id: 'yoke', name: 'Yoke', re: /\byoke\b/, drawn: false }, { id: 'drawcord', name: 'Drawcord', re: /\b(draw\s*cord|drawstring|draw\s*string)\b/, drawn: false },
  { id: 'gusset', name: 'Gusset / side panel', re: /\b(gusset|side\s*panel)\b/, drawn: false }, { id: 'tape', name: 'Neck / shoulder tape', re: /\b(neck\s*tape|shoulder\s*tape|taping|twill\s*tape)\b/, drawn: false },
];
const TRIM_WORDS = [
  ['Main label', /\b(main|brand|woven|neck)\s*label\b/], ['Care label', /\b(care|wash|washing)\s*label|care\s*instruction\s*label\b/], ['Size label', /\bsize\s*label\b/], ['Hang tag', /\b(hang\s*tag|hangtag|swing\s*tag|price\s*tag|barcode|sticker)\b/], ['Label', /\blabel\b/],
  ['Button', /\bbuttons?\b/], ['Snap', /\b(snap|popper|press\s*stud)s?\b/], ['Rivet / eyelet', /\b(rivet|eyelet|grommet)s?\b/], ['Drawcord', /\b(draw\s*cord|drawstring|draw\s*string)\b/], ['Elastic', /\belastic\b/],
  ['Tape', /\b(neck\s*tape|shoulder\s*tape|twill\s*tape|binding\s*tape|taping|tape)\b/], ['Velcro', /\b(velcro|hook\s*and\s*loop)\b/], ['Interlining', /\b(interlining|fusing|interfacing)\b/], ['Polybag', /\b(poly\s*bag|polybag|poly\s*bags)\b/],
  ['Carton', /\b(carton|master\s*carton)\b/], ['Hanger', /\bhanger\b/], ['Tissue paper', /\btissue\b/], ['Silica gel', /\bsilica\b/], ['Sewing thread', /\bthread\b/],
];

function quantityIn(t) {
  const m = /(\d+)\s*(pcs?|nos?|pieces?|ea\b)/i.exec(t) || /\bx\s*(\d+)\b/i.exec(t) || /\bqty[:\s]*(\d+)/i.exec(t) || /\b(\d+)\s*x\b/i.exec(t);
  return m ? Math.max(1, Math.min(99, +m[1])) : 1;
}
function lengthCm(t) {
  const m = /(\d{1,3}(?:\.\d+)?)\s*(cm|mm|in|inch|inches|")/i.exec(t); if (!m) return null;
  const v = +m[1], u = m[2].toLowerCase();
  return r1(u === 'cm' ? v : u === 'mm' ? v / 10 : v * INCH);
}

function conceptsOf(lines, poms) {
  const out = { meta: {}, fabric: {}, seams: {}, zipper: null, trims: [], care: [], packing: [], construction: [], notes: [], found: [] };
  const set = (bucket, key, value, src, conf) => { if (value == null || value === '') return; if (out[bucket][key] != null && out[bucket][key].value != null) return; out[bucket][key] = { value, src: clean(src).slice(0, 160), conf: conf == null ? 0.8 : conf }; };
  const seen = new Set();
  lines.forEach((raw) => {
    const L = clean(raw); if (!L || L.length > 600 || seen.has(L)) return; seen.add(L);
    const low = L.toLowerCase();
    // label: value (or label : value from two cells)
    const kv = /^([^:]{2,32}?)\s*:\s*(.{1,200})$/.exec(L);
    if (kv) {
      const k = kv[1].toLowerCase().replace(/[^a-z #/]/g, '').trim(), v = clean(kv[2]);
      if (/^(style|style\s*(no|#|number|code|ref)|article(\s*(no|#))?|item\s*(no|#)|ref(erence)?|design\s*(no|#)?|sku|model)$/.test(k)) set('meta', 'style_no', v, L);
      else if (/^(description|desc|garment|product|style\s*name|item|item\s*name|name|garment\s*type)$/.test(k)) set('meta', 'name', v, L);
      else if (/^(buyer|customer|client|brand|account|retailer|label)$/.test(k) && !/label/.test(k)) set('meta', 'buyer', v, L);
      else if (/^(season|collection|delivery|drop)$/.test(k)) set('meta', 'season', v, L);
      else if (/^(colou?r|colou?rway|shade)s?$/.test(k)) set('meta', 'colour', v, L);
      else if (/^(fit|silhouette)$/.test(k)) set('meta', 'fit', v, L);
      else if (/^(size\s*range|sizes|size\s*run)$/.test(k)) set('meta', 'size_range', v, L);
      else if (/^(base\s*size|sample\s*size|size\s*(base|sample)|grading\s*base|sample)$/.test(k)) set('meta', 'base_size', sizeName(v), L);
      else if (/^(date|revision|rev|version|issued|updated)$/.test(k)) set('meta', 'revision', v, L);
      else if (/^(unit|units|uom|measurements?\s*in)$/.test(k)) set('meta', 'unit_text', v, L);
      else if (/^(fabric|fabrication|material|main\s*fabric|shell|body\s*fabric|quality|fabric\s*content|composition|content)$/.test(k)) set('fabric', 'text', v, L);
    }
    // the fabric
    const fibres = [...L.matchAll(new RegExp('(\\d{1,3}(?:\\.\\d+)?)\\s*%\\s*((?:organic\\s+|recycled\\s+|combed\\s+|pima\\s+|supima\\s+)?(?:' + FIBRES + ')(?:\\s+(?:cotton|polyester|nylon|yarn))?)', 'gi'))];
    if (fibres.length) { const sum = fibres.reduce((a, m) => a + +m[1], 0); if (sum >= 95 && sum <= 105) set('fabric', 'composition', fibres.map((m) => `${m[1]}% ${m[2].toLowerCase()}`).join(', '), L, 0.9); }
    const gsm = /(\d{2,3})\s*(?:g\s*\.?\s*\/?\s*m\s*[²2]?|gsm)\b/i.exec(L); if (gsm && +gsm[1] >= 60 && +gsm[1] <= 800) set('fabric', 'gsm', +gsm[1], L, 0.9);
    const fabricy = /fabric|material|quality|composition|content|jersey|knit|yarn|gsm|%/i.test(L) && !/refer to|manual|product requirement/i.test(L);   // a line that points at a manual is not the fabric
    const cons = !fabricy ? null : /\b(single\s*jersey|interlock|1\s*x\s*1\s*rib|2\s*x\s*2\s*rib|rib|french\s*terry|fleece|pique|piqué|lacoste|waffle|jacquard|slub|melange|heather|burnout|poplin)\b/i.exec(L); if (cons) set('fabric', 'construction', cons[1].toLowerCase(), L, 0.7);
    const yarn = /\b(\d{1,2}(?:\/\d)?)\s*s\b\s*(combed|carded|ring|compact|open\s*end|oe|cvc|slub)?/i.exec(L) || /\bNe\s*(\d{1,2})/i.exec(L); if (yarn && /yarn|count|cotton|fabric|jersey|ne\b|combed|carded/i.test(L)) set('fabric', 'yarn_count', yarn[0], L, 0.5);
    const wid = /(\d{2,3}(?:\.\d)?)\s*(cm|in|inch|inches|")\s*(?:cuttable|useable|usable|width|wide)/i.exec(L) || /(?:cuttable|useable|usable|fabric)\s*width\W{0,6}(\d{2,3}(?:\.\d)?)\s*(cm|in|inch|inches|")?/i.exec(L);
    if (wid) { const v = +wid[1], u = (wid[2] || (v > 90 ? 'cm' : 'in')).toLowerCase(); set('fabric', 'width_cm', r1(u === 'cm' ? v : v * INCH), L, 0.7); }
    if (/shrink/i.test(L)) {
      const len = /(?:length(?:wise)?|warp|wales?|vertical|\bL\b|\blen\b)\D{0,14}?(-?\d+(?:\.\d+)?)\s*%/i.exec(L), wd = /(?:width(?:wise)?|weft|courses?|crosswise|horizontal|\bW\b|\bwid\b)\D{0,14}?(-?\d+(?:\.\d+)?)\s*%/i.exec(L);
      const pair = /shrink\w*\D{0,24}?(-?\d+(?:\.\d+)?)\s*%?\s*[\/x,&]\s*(-?\d+(?:\.\d+)?)\s*%/i.exec(L);
      if (len || wd) { if (len) set('fabric', 'shrink_len_pct', Math.abs(+len[1]), L, 0.8); if (wd) set('fabric', 'shrink_wid_pct', Math.abs(+wd[1]), L, 0.8); }
      else if (pair) { set('fabric', 'shrink_len_pct', Math.abs(+pair[1]), L + ' (the first figure taken as length)', 0.55); set('fabric', 'shrink_wid_pct', Math.abs(+pair[2]), L + ' (the second figure taken as width)', 0.55); }
    }
    const spi = /(\d{1,2}(?:\.\d+)?)\s*(?:spi\b|stitch(?:es)?\s*(?:per|\/)\s*(?:inch|in\b|"))/i.exec(L); if (spi) set('fabric', 'spi', +spi[1], L, 0.8);
    // the stitching: a seam named with a stitch (per row, then per ';')
    L.split(/;|\s\/\/\s/).forEach((seg) => {
      const sl = seg.toLowerCase(), st = STITCH_WORDS.find(([, re]) => re.test(sl)); if (!st) return;
      // each seam word is taken out of the text once it is claimed, so "sleeve hem" is not also the body hem and "side seam" is not also "underarm"
      let rem = seg; const final = [];
      SEAM_WORDS.forEach(([id, re]) => { const g = new RegExp(re.source, 'gi'); if (g.test(rem)) { final.push(id); rem = rem.replace(new RegExp(re.source, 'gi'), ' '); } });
      final.forEach((id) => { if (!out.seams[id]) out.seams[id] = { type: st[0], src: clean(seg).slice(0, 160), conf: /overlock|sergin/.test(sl) && st[0] === '514' && !/4[- ]?thread|514/.test(sl) ? 0.45 : 0.8 }; });
    });
    // a zipper
    if (/\bzip(per|pers)?\b|\bzipp?er\b|\bykk\b/i.test(L) && !/zip\s*code/i.test(L)) {
      const z = out.zipper || (out.zipper = { src: clean(L).slice(0, 160) });
      if (!z.kind) z.kind = /quarter|1\s*\/\s*4|half|partial|placket|polo|pullover/.test(low) ? 'partial' : /full|front\s*open|separating|open[- ]end|jacket|zip[- ]?through|centre\s*front|center\s*front/.test(low) ? 'full' : null;
      if (!z.type) z.type = /invisible|conceal/.test(low) ? 'invisible' : /closed[- ]?end|close[- ]?end|c\/e/.test(low) ? 'closed_end' : /open[- ]?end|separating|o\/e/.test(low) ? 'open_end' : null;
      if (!z.teeth) z.teeth = /metal|brass|alumin/.test(low) ? 'metal' : /plastic|mould|mold|vislon|resin|moulded/.test(low) ? 'plastic' : /coil|nylon|continuous/.test(low) ? 'coil' : null;
      if (!z.size) { const sz = /#\s*(\d{1,2})|\bno\.?\s*(\d{1,2})\b|\bsize\s*(\d{1,2})\b/i.exec(L); if (sz) z.size = +(sz[1] || sz[2] || sz[3]); }
      if (!z.length_cm) { const len = lengthCm(L.replace(/#\s*\d+/g, '')); if (len && len >= 6 && len <= 120) z.length_cm = len; }
      if (!z.brand) { const b = /\b(ykk|sbs|riri|ideal|talon|coats|ykk\s*natulon)\b/i.exec(L); if (b) z.brand = b[1].toUpperCase(); }
    }
    // trims, labels and packing
    if (!/measure|tolerance|grade/.test(low) || /label|button|tape/.test(low)) {
      const head = low.slice(0, 30), hits = TRIM_WORDS.filter(([, re]) => re.test(head) && !(re.source.includes('thread') && /\d[- ]?(thread|needle)/.test(low)));
      if (hits.length && L.length <= 220 && !(hits.length === 1 && hits[0][0] === 'Sewing thread' && !/(\d|tex|ticket|tkt|col)/.test(low)) && !/zipper|zip\b/.test(low)) {
        const kind = hits[0][0] === 'Label' && hits.length > 1 ? hits[1][0] : hits[0][0];
        const bucket = /polybag|carton|hanger|tissue|silica|sticker/.test(kind.toLowerCase()) ? 'packing' : 'trims';
        const rest = kv ? clean(kv[2]) : L, key0 = kv ? clean(kv[1]) : '', w0 = kind.toLowerCase().split(' ')[0];
        const item = (key0 && key0.toLowerCase().includes(w0) ? `${key0}: ${rest}` : rest.toLowerCase().includes(w0) ? rest : `${kind}: ${rest}`).replace(/\s+x\s*\d+\s*$/i, '').slice(0, 80);
        out[bucket].push({ kind, item, qty: quantityIn(L), src: clean(L).slice(0, 160) });
      }
    }
    if (/\b(wash|tumble|iron|bleach|dry\s*clean|machine\s*wash|do\s*not|cold|30\s*°|40\s*°)\b/i.test(L) && L.length < 200) out.care.push(clean(L));
    if (/\b(stitch|seam|topstitch|bartack|bar\s*tack|hem|binding|taping|stay|tack|label\s*placement|spi|thread)\b/i.test(L) && L.length < 260) out.construction.push(clean(L));
  });
  out.trims = dedupe(out.trims); out.packing = dedupe(out.packing);
  out.care = [...new Set(out.care)].slice(0, 12); out.construction = [...new Set(out.construction)].slice(0, 40);
  return out;
}
const dedupe = (a) => { const s = new Set(); return a.filter((t) => { const k = t.item.toLowerCase(); if (s.has(k)) return false; s.add(k); return true; }).slice(0, 30); };

// ── a spec from rows ──
/**
 * @param rows  [[{t, x0, x1, c?}]]  the cells of each line, left to right (dense(grid) makes them from a grid of strings)
 * @param opt   {unit: 'cm'|'in'|undefined, header_row: number|undefined}  a header row the user picked
 */
function normRows0(rows) {
  return (rows || []).map((r) => (r || []).filter((c) => c && clean(c.t) !== '').map((c) => ({ t: clean(c.t), x0: +c.x0 || 0, x1: Number.isFinite(+c.x1) ? +c.x1 : (+c.x0 || 0) + 10, c: c.c })).sort((a, b) => a.x0 - b.x0)).filter((r) => r.length);
}
function mergeStacked(rows) {
  const out = [], unitRe = /^(yrs?|yr\.?|y|years?|mths?|months?|mos?|m|t)$/i, tolRe = /^\(?\+\/-\)?$|^±$/;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], nx = rows[i + 1];
    if (nx && r.filter((c) => /^\d{1,2}$/.test(c.t)).length >= 3 && nx.filter((c) => unitRe.test(c.t)).length >= 3) {
      const used = new Set();
      const merged = r.map((c) => {
        const near = nx.map((q) => ({ q, d: Math.abs(cx(q) - cx(c)) })).sort((a, b) => a.d - b.d)[0];
        if (near && near.d <= Math.max(14, (c.x1 - c.x0) * 1.2) && (unitRe.test(near.q.t) || tolRe.test(near.q.t))) { used.add(near.q); return Object.assign({}, c, { t: c.t + ' ' + near.q.t, x1: Math.max(c.x1, near.q.x1) }); }
        return c;
      });
      if (nx.every((q) => used.has(q) || tolRe.test(q.t))) { out.push(merged); i++; continue; }
    }
    out.push(r);
  }
  return out;
}
const normRows = (rows) => mergeStacked(normRows0(rows));
function extract(rows, opt) {
  opt = opt || {};
  rows = normRows(rows);
  if (!rows.length) return { success: false, error: 'The file has no readable text.' };
  // headers
  let heads = [];
  if (Number.isInteger(opt.header_row) && rows[opt.header_row]) heads = [{ i: opt.header_row, kind: rows[opt.header_row].filter((c) => isSizeTok(c.t)).length >= 2 || rows[opt.header_row].filter((c) => /^\d{1,3}$/.test(c.t)).length >= 2 ? 'sizes' : 'single', numeric: !rows[opt.header_row].some((c) => isSizeTok(c.t)) }];
  else {
    rows.forEach((_, i) => { const h = headerAt(rows, i); if (h) heads.push(h); });
    if (!heads.length) { for (let i = 0; i < rows.length; i++) { const h = numericHeaderAt(rows, i); if (h) { heads.push(h); break; } } }    // the topmost climb of plain numbers: the rows below it that climb are measurements
  }
  const ctx = { tables: [] }, poms = [], used = new Set();
  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : rows.length;
    parseTable(rows, h, end, ctx).forEach((p) => { poms.push(p); for (let i = p.row; i <= p.row; i++) used.add(i); });
  });
  if (!poms.length) return { success: false, error: 'No table of measurements was found. A measurement table has a row of sizes (S M L XL) and a name and numbers on each row below it. If the sizes are on another row, click that row in the sheet view; if the sizes run down the page, use "Sizes run down the page".', rows: rows.length, rows_text: rows.slice(0, 80).map((r) => r.map((c) => c.t)) };

  // the sizes, in the order the sheet gives them
  const sizes = []; let base = null;
  ctx.tables.forEach((t) => t.sizes.forEach((s) => { if (!sizes.includes(s.name)) sizes.push(s.name); if (s.base && !base) base = s.name; }));
  const single = !sizes.length;
  if (single) sizes.push('M');
  poms.forEach((p) => { if (p.single) { p.values = p.values['*'] != null ? { [sizes[0]]: p.values['*'] } : {}; } });

  // the details: every line that is not a measurement row
  const lines = [];
  rows.forEach((r, i) => {
    if (used.has(i)) return;
    let kvUsed = false;
    for (let k = 0; k < r.length;) { if (/:\s*$/.test(r[k].t) && r[k + 1]) { lines.push(r[k].t + ' ' + r[k + 1].t); k += 2; kvUsed = true; } else { if (r[k].t.length > 3) lines.push(r[k].t); k++; } }
    if (!kvUsed && r.length > 1) lines.push(rowText(r));
  });
  poms.forEach((p) => { if (p.remark) lines.push(`${p.label}: ${p.remark}`); });
  const det = conceptsOf(lines, poms);
  if (!base && det.meta.base_size) base = det.meta.base_size.value;

  // the unit: told by the sheet, else by the size of a chest
  let unit = opt.unit === 'in' || opt.unit === 'cm' ? opt.unit : null, unitHow = unit ? 'chosen' : null;
  if (!unit) {
    const head = rows.slice(0, 14).map(rowText).join(' ').toLowerCase() + ' ' + ((det.meta.unit_text && det.meta.unit_text.value) || '').toLowerCase();
    if (/\b(inch|inches)\b|\bin\.|\(in\)|\bunits?\s*[:=]?\s*in\b|"/.test(head) && !/\bcm\b/.test(head)) { unit = 'in'; unitHow = 'the sheet says inches'; }
    else if (/\bcm\b|centimet|\(cm\)/.test(head) && !/\b(inch|inches)\b/.test(head)) { unit = 'cm'; unitHow = 'the sheet says cm'; }
  }
  const chestRow = poms.map((p) => ({ p, c: classify(p.label) })).filter((x) => x.c.key === 'chest')[0];
  const cvals = chestRow ? Object.values(chestRow.p.values) : [];
  const cmean = cvals.length ? cvals.reduce((a, b) => a + b, 0) / cvals.length : 0;
  if (!unit) { unit = cmean && cmean < 40 ? 'in' : cmean && cmean >= 40 ? 'cm' : 'cm'; unitHow = cmean ? `read from the size of the chest (${r1(cmean)}: ${unit === 'in' ? 'inches' : 'centimetres'})` : 'assumed centimetres'; }
  const flatChest = (size) => { if (!chestRow) return null; const v = chestRow.p.values[size]; if (!(v > 0)) return null; const full = chestRow.c.basis === 'full' || (chestRow.c.basis == null && v > (unit === 'in' ? 32 : 80)); return full ? v / 2 : v; };

  // each row: what it is, how it is taken
  const catalogue = [];
  const mapped = poms.map((p, idx) => {
    const c = classify(p.label); let key = c.key, basis = c.basis, auto = false;
    const ent = key ? BY_KEY[key] : null;
    const first = Object.keys(p.values)[0]; const fc = flatChest(first);
    if (key && ent && ent.halves && !basis && fc) { const v = p.values[first], ratio = v / fc, lim = { chest: unit === 'in' ? 32 : 80, hem: 1.7, bicep: 0.55, sleeve_o: 0.5, waist: 1.6, hip: 1.6, thigh: 1.0, knee: 0.7, leg_opening: 0.55 }[key];
      const full = key === 'chest' ? v > lim : ratio > lim; basis = full ? 'full' : 'flat'; auto = true; }
    if (key === 'neck_w' && fc && p.values[first] / fc > 0.75) { key = 'neck_circ'; auto = true; }
    if (!basis) basis = 'flat';
    const e = key ? BY_KEY[key] : null;
    const tol = p.tol ? (p.tol.limit ? { plus: null, minus: null, limit: p.tol.limit, given: true } : { plus: p.tol.plus, minus: p.tol.minus, given: true }) : e ? { plus: r2(e.tol / (unit === 'in' ? INCH : 1)), minus: r2(e.tol / (unit === 'in' ? INCH : 1)), given: false } : null;
    return {
      id: `p${idx}`, row: p.row, code: p.code, label: p.label, group: p.group || (e && e.group) || '', key, basis, basis_auto: auto, include: !!key, values: p.values, tol, grade: gradeOf(p.values, sizes, p.grade),
      depth: c.depth, remark: p.remark, check: p.check, drawn: !!(e && e.engine), conf: key ? (auto ? 0.7 : 0.9) : 0.2,
    };
  });
  // two rows with one meaning: the first is kept, the second is only recorded
  const taken = new Set();
  mapped.forEach((m) => { if (m.key && taken.has(m.key)) { m.dup = true; m.include = false; } else if (m.key) taken.add(m.key); });

  // the style and the parts named
  const alltext = lines.join(' ').toLowerCase() + ' ' + mapped.map((m) => m.label.toLowerCase()).join(' ') + ' ' + ((det.meta.name && det.meta.name.value) || '').toLowerCase();
  const nameText = ((det.meta.name && det.meta.name.value) || '').toLowerCase();
  const style = STYLES.find((s) => s.re.test(nameText)) || STYLES.find((s) => s.re.test(alltext)) || null;
  if (style && style.id === 'trouser') {                                           // a bottom: a "hem width" is the leg opening, and the points are the bottoms'
    mapped.forEach((m) => { if (m.key === 'hem') { m.key = 'leg_opening'; m.drawn = true; } });
    const seenK = new Set(); mapped.forEach((m) => { if (m.include && m.key) { if (seenK.has(m.key)) { m.dup = true; m.include = false; } else seenK.add(m.key); } });
  }
  const engineId = style && style.id === 'trouser' ? 'shorts' : 'tee';
  mapped.forEach((m) => { m.drawn = isDrawn(m.key, engineId); });
  const parts = PARTS.filter((p) => p.re.test(alltext)).map((p) => ({ id: p.id, name: p.name, drawn: p.drawn }));
  const isShort = style && style.id === 'trouser' && /\bshorts?\b(?!\s*sleeve)/.test(nameText + ' ' + alltext.slice(0, 600));
  const styleOut = style ? { id: style.id === 'trouser' ? (isShort ? 'shorts' : 'trousers') : style.id, name: style.id === 'trouser' ? (isShort ? 'Shorts' : 'Trousers / joggers') : style.name, drawn: style.id === 'tee' || style.id === 'tank' || style.id === 'trouser' ? true : false, engine: style.id === 'trouser' ? 'shorts' : 'tee' } : { id: 'tee', name: 'T-shirt (assumed: the sheet does not name the style)', drawn: true, assumed: true };

  const unmatched = mapped.filter((m) => !m.key).map((m) => m.label);
  const out = {
    success: true, schema: 'ka-garment-spec/1', unit, unit_how: unitHow, sizes, base: base && sizes.includes(base) ? base : null, single,
    meta: Object.fromEntries(Object.entries(det.meta).map(([k, v]) => [k, v.value])), meta_src: Object.fromEntries(Object.entries(det.meta).map(([k, v]) => [k, v.src])),
    fabric: det.fabric, seams: det.seams, zipper: det.zipper, trims: det.trims, packing: det.packing, care: det.care, construction: det.construction,
    poms: mapped, unmatched, style: styleOut, parts, tables: ctx.tables, use_sizes: pickSizes(sizes),
    notes: [],
  };
  if (single) out.notes.push(`The sheet gives one column of measurements (no sizes): they are read as size ${sizes[0]}. ${mapped.some((m) => m.grade && m.grade.step != null) ? 'Its grade column can spread them over the other sizes.' : 'It has no grade column, so the other sizes cannot be made from it.'}`);
  if (styleOut.engine === 'shorts') out.notes.push('This is a bottom (shorts or trousers): the rises, waist, seat, thigh, leg opening and pockets are drawn by the shorts engine; the fly, the yoke and cargo details are kept with the spec.');
  if (!styleOut.drawn) out.notes.push(`This looks like a ${styleOut.name.toLowerCase()}: the pattern engine draws a crew-neck T-shirt, so only the measurements a tee has are drawn; the rest is recorded in the spec and its check.`);
  mapped.filter((m) => m.basis_auto && m.include).forEach((m) => out.notes.push(`"${m.label}" is taken as ${m.basis === 'full' ? 'a circumference (halved for the flat chart)' : 'a flat width'} because its size says so: change it in the table if that is wrong.`));
  if (unmatched.length) out.notes.push(`Not recognised as a point of measure: ${unmatched.slice(0, 8).join('; ')}${unmatched.length > 8 ? ' …' : ''}.`);
  return out;
}

// the engine builds up to 8 sizes at once: a sheet with 14 (3 to 16 yr) is thinned, evenly, from the smallest to the largest
function pickSizes(sizes) {
  if (sizes.length <= 8) return sizes.slice();
  const out = []; for (let i = 0; i < 8; i++) { const v = sizes[Math.round((i * (sizes.length - 1)) / 7)]; if (!out.includes(v)) out.push(v); }
  return out;
}
// the step from size to size, and whether it is even
function gradeOf(values, sizes, given) {
  const vs = sizes.map((s) => values[s]); const steps = [];
  for (let i = 1; i < vs.length; i++) if (Number.isFinite(vs[i]) && Number.isFinite(vs[i - 1])) steps.push(r2(vs[i] - vs[i - 1]));
  const s0 = steps.length ? steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)] : null;
  return { steps, step: given != null ? given : s0, given: given != null, regular: steps.length ? steps.every((s) => Math.abs(s - s0) <= Math.max(0.12, Math.abs(s0) * 0.12)) : true };
}
// the other sizes from a base size and a grade
function grade(spec, sizes, base) {
  const idx = sizes.indexOf(base); if (idx < 0) return { success: false, error: 'The base size is not in the size list.' };
  const poms = spec.poms.map((p) => {
    const b = Object.values(p.values)[0]; if (!Number.isFinite(b)) return p;
    const step = p.grade && p.grade.step != null ? p.grade.step : null;
    const values = {}; sizes.forEach((s, i) => { values[s] = step == null ? (i === idx ? b : undefined) : r2(b + step * (i - idx)); });
    return Object.assign({}, p, { values: Object.fromEntries(Object.entries(values).filter(([, v]) => v != null)), graded: step != null });
  });
  return { success: true, spec: Object.assign({}, spec, { sizes, base, single: false, poms }) };
}

// ── the garment the engine can draw from a spec ──
function toBuild(spec, opt) {
  opt = opt || {};
  const unit = spec.unit === 'in' ? 'in' : 'cm', k = unit === 'in' ? INCH : 1, sizes = (opt.sizes || spec.use_sizes || spec.sizes).slice(0, 8), conv = [];
  const rows = (spec.poms || []).filter((p) => p.include !== false && p.key), eng = spec.style && spec.style.engine === 'shorts' ? 'shorts' : 'tee';
  const chart = {}, tol = {};
  const flat = (p, s) => { const v = p.values[s]; if (!Number.isFinite(+v)) return NaN; return p.basis === 'full' && BY_KEY[p.key] && BY_KEY[p.key].halves ? +v / 2 : +v; };
  const put = (key, s, v) => { if (!Number.isFinite(v)) return; if (!chart[key]) chart[key] = {}; chart[key][s] = String(r2(v)); };
  rows.filter((p) => isDrawn(p.key, eng)).forEach((p) => {
    sizes.forEach((s) => put(p.key, s, flat(p, s)));
    if (p.basis === 'full' && BY_KEY[p.key].halves) conv.push(`${p.label}: a circumference, halved for the flat chart`);
    if (p.tol && p.tol.given && !p.tol.limit) tol[p.key] = { plus: p.tol.plus, minus: p.tol.minus };
  });
  const sub = (key, from, f, text) => { if (chart[key]) return; const p = rows.filter((q) => q.key === from)[0]; if (!p) return; let did = false; sizes.forEach((s) => { const v = f(p, s); if (Number.isFinite(v)) { put(key, s, v); did = true; } }); if (did) conv.push(text); };
  const chartNum = (key, s) => (chart[key] && Number.isFinite(+chart[key][s]) ? +chart[key][s] : NaN);
  const flatChest = (s) => chartNum('chest', s);
  // the length, from the front, the back or the centre back
  if (eng === 'tee') {
  sub('length', 'front_length', (p, s) => flat(p, s), 'Body length: the front length of the sheet');
  sub('length', 'back_length', (p, s) => flat(p, s), 'Body length: the back length of the sheet');
  sub('length', 'cb_length', (p, s) => { const nd = chartNum('neck_db', s); return flat(p, s) + (Number.isFinite(nd) ? nd : 2 / k); }, 'Body length: the centre-back length plus the back neck drop (the back neck sits below the high point of the shoulder)');
  sub('sleeve_l', 'sleeve_cb', (p, s) => { const sh = chartNum('shoulder', s), c = flatChest(s); return flat(p, s) - (Number.isFinite(sh) ? sh : 0.865 * c) / 2; }, 'Sleeve length: the length from the centre back less half the shoulder (an estimate: the sheet does not say how the sleeve sits)');
  }
  const fb = {};
  const f = spec.fabric || {}, fv = (k2) => (f[k2] && f[k2].use !== false && f[k2].value != null && f[k2].value !== '' ? f[k2].value : null);
  if (fv('gsm')) fb.gsm = fv('gsm'); if (fv('width_cm')) fb.width_cm = fv('width_cm');
  if (fv('shrink_len_pct') != null) fb.shrink_len_pct = fv('shrink_len_pct'); if (fv('shrink_wid_pct') != null) fb.shrink_wid_pct = fv('shrink_wid_pct');
  const fabricName = [fv('composition'), fv('construction')].filter(Boolean).join(' ') || fv('text') || '';
  if (fabricName) fb.name = String(fabricName).slice(0, 80);
  const seams = {}; Object.keys(spec.seams || {}).forEach((id) => { if (spec.seams[id] && spec.seams[id].use !== false && spec.seams[id].type) seams[id] = { type: spec.seams[id].type }; });
  let zipper = { on: false };
  if (eng === 'tee' && spec.zipper && spec.zipper.use !== false && (spec.zipper.kind || spec.zipper.length_cm || spec.zipper.type)) {
    const z = spec.zipper, kind = z.kind || 'full';
    zipper = { on: true, kind, type: z.type || (kind === 'partial' ? 'closed_end' : 'open_end'), teeth: z.teeth || 'coil', size: z.size || 5, length_cm: z.length_cm || (kind === 'partial' ? 14 : 22) };
  }
  const trims = (spec.trims || []).concat(spec.packing || []).filter((t) => t.use !== false).map((t) => ({ item: t.item, qty: t.qty || 1, unit: 'pc', note: 'from the spec sheet' }));
  const lead = eng === 'shorts' ? 'seat_w' : 'chest', have = sizes.filter((s) => chart[lead] && chart[lead][s]);
  if (have.length && have.length < sizes.length) { conv.push(`Sizes with no ${eng === 'shorts' ? 'seat width' : 'chest'} in the sheet were left out: ${sizes.filter((s) => !have.includes(s)).join(', ')}`); sizes.splice(0, sizes.length, ...have); }
  const drawn = rows.filter((p) => isDrawn(p.key, eng)).map((p) => p.key);
  const missing = (eng === 'shorts' ? ['outseam', 'front_rise', 'seat_w', 'thigh', 'leg_opening'] : ['chest', 'length']).filter((q) => !chart[q]).concat(eng === 'shorts' && !chart.waist && !chart.waist_stretched ? ['waist'] : []);
  return { unit, sizes, base: opt.base || spec.base || sizes[Math.floor((sizes.length - 1) / 2)], chart, tolerances: tol, fabric: fb, seams, zipper, trims, conversions: conv, drawn, missing, style: eng, recorded: rows.filter((p) => !isDrawn(p.key, eng)).map((p) => p.label) };
}

// ── a spec against the pattern ──
function widthAt(poly, y) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) { const x = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1); if (x < lo) lo = x; if (x > hi) hi = x; }
  }
  return hi > lo ? hi - lo : null;
}
const DERIVE = {
  armhole_curve: (o) => o.derived.armhole_front, armhole_drop: (o) => o.derived.underarm_y, neck_circ: (o) => o.derived.neck_len, cb_length: (o) => o.m.length - o.m.neck_db,
  inseam: (o) => (o.derived && o.derived.inseam != null ? o.derived.inseam : null), front_length: (o) => o.m.length, back_length: (o) => o.m.length, sleeve_cb: (o) => o.m.shoulder / 2 + o.m.sleeve_l, side_length: (o) => o.m.length - o.derived.underarm_y,
  across_chest: (o, i) => widthAt(o.shape.front, i.depth), across_back: (o, i) => widthAt(o.shape.back, i.depth),
};
function compliance(spec, result) {
  if (!spec || !Array.isArray(spec.poms) || !result || !result.success) return null;
  const unit = spec.unit === 'in' ? 'in' : 'cm', k = unit === 'in' ? INCH : 1, rows = [];
  let ok = 0, off = 0, recorded = 0;
  const eng = result.style === 'shorts' ? 'shorts' : 'tee';
  spec.poms.filter((p) => p.include !== false && p.key).slice(0, 80).forEach((p) => {
    const ent = BY_KEY[p.key]; if (!ent) return;
    const per = {}; let how = 'recorded';
    result.by_size.forEach((o) => {
      const sv = +p.values[o.size]; if (!Number.isFinite(sv)) return;
      let spec_cm = sv * k; if (p.basis === 'full' && ent.halves) spec_cm /= 2;
      let pat = null, assumed = null;
      const lim = p.tol && p.tol.limit, tp = lim ? 0 : p.tol && p.tol.plus != null ? p.tol.plus * k : ent.tol, tm = lim ? 0 : p.tol && p.tol.minus != null ? p.tol.minus * k : ent.tol;
      if (isDrawn(p.key, eng)) { const m = (o.measured || []).find((x) => x.key === p.key); if (m) { pat = m.pattern; how = 'drawn'; } }
      else if (DERIVE[p.key]) {
        let depth = null;
        if (ent.depth) { if (p.depth && Number.isFinite(p.depth.v)) { depth = p.depth.v * (p.depth.unit === 'in' ? INCH : p.depth.unit === 'cm' ? 1 : k); if (/arm/.test(p.depth.from || '')) depth += o.derived.underarm_y; } else { depth = 15; assumed = 'taken 15 cm below the high point of the shoulder: the sheet does not say'; } }
        const v = DERIVE[p.key](o, { depth }); if (Number.isFinite(v)) { pat = r2(v); how = 'measured on the pattern'; }
      }
      if (pat == null) { per[o.size] = { spec_cm: r2(spec_cm), status: 'recorded' }; return; }
      const diff = r2(pat - spec_cm), pass = lim === 'min' ? diff >= -0.05 : lim === 'max' ? diff <= 0.05 : diff <= tp + 1e-9 && diff >= -tm - 1e-9;
      per[o.size] = { spec_cm: r2(spec_cm), pattern_cm: r2(pat), diff, tol_plus: r2(tp), tol_minus: r2(tm), limit: lim || null, status: pass ? 'ok' : 'off', assumed };
      if (pass) ok++; else off++;
    });
    if (!Object.keys(per).length) return;
    if (how === 'recorded') recorded++;
    rows.push({ id: p.id, code: p.code || '', label: p.label, key: p.key, name: ent.name, how, tol_given: !!(p.tol && p.tol.given), sizes: per, note: ent.note || '' });
  });
  const gradeNotes = [];
  spec.poms.filter((p) => p.include !== false && p.key && p.grade && p.grade.steps && p.grade.steps.length >= 2 && !p.grade.regular).forEach((p) => gradeNotes.push(`${p.label}: the step between sizes is ${p.grade.steps.join(', ')} ${unit}: not even`));
  return { unit: 'cm', checked: ok + off, ok, off, recorded, rows, grade_notes: gradeNotes };
}

// ── the starting sheets ──
function starters() {
  const T = G.template(['S', 'M', 'L', 'XL'], 'cm');
  return [{ id: 'starter-tee', name: 'Starter: crew-neck T-shirt, S-XL (cm)', note: 'A graded men\'s tee, a size step of 2 cm on the chest: a place to start, not a buyer\'s spec.', state: { unit: 'cm', sizes: T.sizes, base: 'M', chart: T.chart } }];
}

module.exports = { isDrawn, ENGINE_KEYS, pickSizes, normRows, val, tolOf, isSizeTok, sizeName, headKind, classify, dense, transposeGrid, extract, gradeOf, grade, toBuild, compliance, starters, widthAt, CATALOGUE, BY_KEY, STYLES, PARTS, STITCH_WORDS, SEAM_WORDS, TRIM_WORDS, conceptsOf };
