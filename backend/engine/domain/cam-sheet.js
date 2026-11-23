/**
 * Cam sheet → needle programme.
 *
 * Knitting floors write a design as a CAM SHEET, not as a drawing of every needle. A sheet says:
 *
 *   - the TRACKS: rows (cam track 1, 2, 3, 4 …), one column per FEEDER, each cell what that track's cam does at that feeder
 *     (knit, tuck, miss);
 *   - the NEEDLE SETTING: a number per needle of the repeat, the track (butt level) its butt rides in ("1 2 3 4 1 2 3 4 3 2 1 4 3 2");
 *   - optionally the yarn (colour) of each feeder, and for a double bed a second set for the dial.
 *
 * A needle knits at a feeder when the cam of ITS track is a knit at that feeder. So the drawing the Studio works on (feeder x needle)
 * is  grid[feeder][needle] = tracks[ level[needle] ][ feeder ].  The Studio already does the reverse (its "Cam & needle set-out"
 * tab); this module is the way in, so a sheet from the floor becomes a design that can be analysed, seen in 3D, set up and costed.
 *
 * Sheets do not agree on symbols: a dash is a miss on one and "no needle" on another, "^" is a knit on one and "=" a miss. The
 * LEGEND says which. Nothing here guesses a legend: the caller (the screen) chooses it and shows what was read.
 */
'use strict';

class CamSheetError extends Error { constructor(m) { super(m); this.name = 'CamSheetError'; } }

// symbol -> K / T / M (miss: the needle rests, the yarn floats behind)
const MISS = ['-', '–', '—', '_', '=', '.', '·', ' ', '0'];
const LEGENDS = {
  letters: { label: 'Letters: K knit, T tuck, M miss; a dash or = is a miss', map: { K: 'K', T: 'T', M: 'M' } },
  cam: { label: 'Cam symbols: ^ knit, V tuck, a dash or = is a miss', map: { '^': 'K', 'Λ': 'K', '∧': 'K', 'A': 'K', 'V': 'T', 'v': 'T', '∨': 'T', 'K': 'K', 'T': 'T', 'M': 'M' } },
  knit_x: { label: 'X knit, O tuck, a dash is a miss', map: { X: 'K', x: 'K', O: 'T', o: 'T', K: 'K', T: 'T', M: 'M' } },
};
const COLOURS = {
  white: '#f4f1ea', black: '#1d1d20', navy: '#1f2f56', blue: '#2f56a6', red: '#c0392b', grey: '#8a8d93', gray: '#8a8d93', beige: '#d9c9a3', cream: '#ece3cc', green: '#3f8a6e', yellow: '#e3b341', orange: '#d9772b', pink: '#e08aa6', brown: '#7a5538', ecru: '#e6dcc3',
};

const cellOf = (ch, map, notes) => {
  if (MISS.includes(ch)) return 'M';
  const v = map[ch];
  if (v) return v;
  notes.add(`"${ch}" is not in the legend: read as a miss`);
  return 'M';
};

/** A track row as an array of symbols: "K--K-KK" (letters) or "K - - K" (spaced); a row may also come as an array. */
function symbolsOf(row) {
  if (Array.isArray(row)) return row.map((x) => String(x == null || x === '' ? ' ' : x).trim() || ' ');
  const s = String(row == null ? '' : row);
  if (/\s/.test(s.trim()) && s.trim().split(/\s+/).every((t) => t.length === 1 || t === '—' || t === '–')) return s.trim().split(/\s+/);
  return [...s.replace(/\s+/g, '')];
}

/** The needle setting: "1 2 3 4 1 2", "123412", or [1, 2, 3 …]. Levels are 1-based track numbers. */
function levelsOf(v, tracks, what) {
  let a;
  if (Array.isArray(v)) a = v.map(Number);
  else {
    const s = String(v == null ? '' : v).trim();
    a = /[\s,;]/.test(s) ? s.split(/[\s,;]+/).filter(Boolean).map(Number) : [...s].map(Number);
  }
  if (!a.length) throw new CamSheetError(`Give the ${what}: the track number of each needle of the repeat, like "1 2 3 4 1 2 3 4".`);
  const bad = a.find((n) => !(Number.isInteger(n) && n >= 1 && n <= tracks));
  if (bad !== undefined) throw new CamSheetError(`The ${what} has a ${Number.isFinite(bad) ? bad : 'non-number'} but the sheet has only ${tracks} track${tracks > 1 ? 's' : ''}: needle numbers go from 1 to ${tracks}.`);
  return a;
}

function bedOf(tracksIn, needlesIn, map, notes, label) {
  const rows = (Array.isArray(tracksIn) ? tracksIn : String(tracksIn || '').split(/\r?\n/)).map((r) => symbolsOf(r)).filter((r) => r.length);
  if (!rows.length) throw new CamSheetError(`Give the ${label} tracks: one line per track, one symbol per feeder.`);
  const feeders = Math.max(...rows.map((r) => r.length));
  const short = rows.map((r, i) => [i + 1, r.length]).filter(([, n]) => n !== feeders);
  if (short.length) throw new CamSheetError(`The ${label} tracks do not have the same number of feeders: ${short.map(([i, n]) => `track ${i} has ${n}`).join(', ')}, the longest has ${feeders}. Every track needs one symbol for every feeder (use a dash for a miss).`);
  const level = levelsOf(needlesIn, rows.length, `${label} needle setting`);
  const grid = Array.from({ length: feeders }, (_, f) => level.map((b) => cellOf(rows[b - 1][f], map, notes)));
  return { grid, feeders, needles: level.length, tracks: rows.length, level };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * build(spec) -> { bed, gating, C, D, feeds, colours, notes, preview, read }
 *   spec: { tracks, needles, legend | map, colours?: "White Black White …" | ["White", …] | "WBWB",
 *           dial_tracks?, dial_needles?, gating?: 'rib' | 'interlock', name? }
 */
function build(spec) {
  const s = spec || {};
  const notes = new Set();
  const legend = s.map ? { map: s.map } : LEGENDS[s.legend || 'letters'];
  if (!legend) throw new CamSheetError(`Unknown legend "${s.legend}". Choose one of: ${Object.keys(LEGENDS).join(', ')}.`);
  const cyl = bedOf(s.tracks, s.needles, legend.map, notes, 'cylinder');
  let C = cyl.grid, D = null, gating;
  const double = s.dial_tracks != null && String(Array.isArray(s.dial_tracks) ? s.dial_tracks.join('') : s.dial_tracks).trim() !== '';
  if (double) {
    const dial = bedOf(s.dial_tracks, s.dial_needles, legend.map, notes, 'dial');
    if (dial.feeders !== cyl.feeders) throw new CamSheetError(`The dial sheet has ${dial.feeders} feeders and the cylinder ${cyl.feeders}: both beds work at the same feeders.`);
    // two settings of different length repeat together
    const n = (cyl.needles * dial.needles) / gcd(cyl.needles, dial.needles);
    if (n > 48) throw new CamSheetError(`The cylinder setting (${cyl.needles} needles) and the dial setting (${dial.needles}) only repeat together every ${n} needles: more than the Studio's 48. Shorten one of them.`);
    const rep = (g, k) => g.map((row) => Array.from({ length: n }, (_, j) => row[j % k]));
    C = rep(cyl.grid, cyl.needles); D = rep(dial.grid, dial.needles);
    gating = s.gating === 'interlock' ? 'interlock' : 'rib';
    if (!s.gating) notes.add('Rib gating assumed for the two beds (the dial needle sits between two cylinder needles). Choose interlock gating if the sheet is an interlock.');
  }
  if (C.length > 48 || C[0].length > 48) throw new CamSheetError(`${C.length} feeders x ${C[0].length} needles is more than the Studio holds (48 x 48).`);
  // colours of the feeders
  let colours = null, feeds = C.map(() => ({ role: 'ground' }));
  const col = s.colours;
  if (col != null && String(Array.isArray(col) ? col.join('') : col).trim() !== '') {
    let names = Array.isArray(col) ? col.map((x) => String(x).trim()) : String(col).trim().split(/[\s,;]+/).filter(Boolean);
    if (names.length === 1 && names[0].length === C.length && /^[A-Za-z]+$/.test(names[0])) names = [...names[0]];
    const short = { w: 'white', b: 'black', n: 'navy', r: 'red', g: 'grey', y: 'yellow', c: 'cream', e: 'ecru' };
    names = names.map((x) => (x.length === 1 && short[x.toLowerCase()] ? short[x.toLowerCase()] : x.toLowerCase()));
    if (names.length !== C.length) throw new CamSheetError(`${names.length} feeder colours were given for ${C.length} feeders: give one colour for each feeder (like "White Black White Black …").`);
    const letters = [], hex = {};
    names.forEach((nm) => { if (!letters.includes(nm)) letters.push(nm); });
    if (letters.length > 6) throw new CamSheetError(`${letters.length} different colours: the Studio holds six yarn colours (A–F).`);
    const L = 'ABCDEF';
    letters.forEach((nm, i) => { hex[L[i]] = COLOURS[nm] || '#808080'; if (!COLOURS[nm]) notes.add(`The colour "${nm}" is not one the Studio names: shown mid-grey, set its real colour in the stripe colours.`); });
    feeds = C.map((_, i) => ({ role: 'ground', colour: L[letters.indexOf(names[i])] }));
    colours = { letters: Object.fromEntries(letters.map((nm, i) => [L[i], nm])), hex };
  }
  const preview = C.map((r, i) => `F${i + 1}${feeds[i].colour ? ' ' + feeds[i].colour : ''}  ${r.join('')}` + (D ? `   |   ${D[i].join('')}` : ''));
  return {
    bed: double ? 'double' : 'single', gating: double ? gating : 'single', C, D, feeds, colours, notes: [...notes], preview,
    read: { feeders: C.length, needles: C[0].length, tracks: cyl.tracks, dial_tracks: double ? true : null, name: s.name || null },
  };
}

/** The reverse, as a sheet (rows of the tracks and the needle setting), from a drawing: used to check a build and to print one. */
function sheetOf(C) {
  const needles = C[0].length, feeders = C.length;
  const colKey = (j) => C.map((r) => (r[j] === 'K' || r[j] === 'T' ? r[j] : '-')).join('');
  const keys = [], level = [];
  for (let j = 0; j < needles; j++) { const k = colKey(j); let i = keys.indexOf(k); if (i < 0) { keys.push(k); i = keys.length - 1; } level.push(i + 1); }
  const tracks = keys.map((_, t) => Array.from({ length: feeders }, (__, f) => keys[t][f]).join(''));
  return { tracks, needles: level };
}

/**
 * A sheet with a cam chart and NO needle setting ("Needle = ", "What is the needle setting?"): the setting is searched for. Every
 * setting of a given length is a way of mixing the tracks across the needles; the ones worth showing are those the machine can knit:
 * every needle knits somewhere, no feeder is left with nothing to do, floats stay short. They are de-duplicated (a setting and its
 * rotation make the same cloth), ranked by how evenly they use the tracks and the knit share, and the best are run through the Studio.
 */
function suggestNeedles(spec, opts) {
  const S = require('./fabric-studio');
  const o = opts || {};
  const notes = new Set();
  const legend = (spec.map ? { map: spec.map } : LEGENDS[spec.legend || 'letters']) || LEGENDS.letters;
  const rows = (Array.isArray(spec.tracks) ? spec.tracks : String(spec.tracks || '').split(/\r?\n/)).map((r) => symbolsOf(r)).filter((r) => r.length);
  if (!rows.length) throw new CamSheetError('Give the cylinder tracks first.');
  const F = rows[0].length, T = rows.length;
  if (rows.some((r) => r.length !== F)) throw new CamSheetError('Every track needs one symbol for every feeder.');
  const cell = rows.map((r) => r.map((ch) => cellOf(ch, legend.map, notes)));
  const maxFloat = o.max_float || 6;
  const L0 = Math.max(T, o.min_length || T), L1 = Math.min(o.max_length || 8, 16);
  // a seeded stream, so the same sheet gives the same answer
  let seed = 2166136261; for (const ch of JSON.stringify(cell)) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const seen = new Set(), found = [];
  const canon = (a) => { let best = null; for (let i = 0; i < a.length; i++) { const r = a.slice(i).concat(a.slice(0, i)).join(''); if (best === null || r < best) best = r; } return best; };
  const test = (seq) => {
    if (new Set(seq).size < Math.min(T, 2)) return null;
    const g = Array.from({ length: F }, (_, f) => seq.map((b) => cell[b - 1][f]));
    for (let j = 0; j < seq.length; j++) if (!g.some((r) => r[j] === 'K')) return null;           // a needle that never knits
    for (const r of g) if (!r.includes('K') && !r.includes('T')) return null;                       // a feeder that catches nothing
    let flo = 0;                                                                                     // longest cyclic float along a feeder
    for (const r of g) { const d = r.concat(r); let run = 0; for (const x of d) { run = x === 'M' ? run + 1 : 0; flo = Math.max(flo, Math.min(run, r.length)); } }
    if (flo > maxFloat) return null;
    const cells = F * seq.length, k = g.reduce((t, r) => t + r.filter((x) => x === 'K').length, 0), tk = g.reduce((t, r) => t + r.filter((x) => x === 'T').length, 0);
    const used = new Set(seq).size / T;
    const score = used - Math.abs(k / cells - 0.62) - 0.02 * seq.length - 0.03 * flo;
    return { g, score, knit: k / cells, tuck: tk / cells, float: flo };
  };
  for (let L = L0; L <= L1 && found.length < 400; L++) {
    const space = Math.pow(T, L);
    const tries = space <= 6000 ? space : 4000;
    for (let i = 0; i < tries; i++) {
      const seq = space <= 6000 ? Array.from({ length: L }, (_, p) => 1 + (Math.floor(i / Math.pow(T, p)) % T)) : Array.from({ length: L }, () => 1 + Math.floor(rnd() * T));
      const key = canon(seq); if (seen.has(key)) continue; seen.add(key);
      const t = test(seq); if (t) found.push({ seq, ...t });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of found.slice(0, 60)) {
    if (out.length >= (o.limit || 8)) break;
    let a = null;
    try { a = S.analyse({ bed: 'single', grid: { C: c.g, D: null }, feeds: c.g.map(() => ({ role: 'ground' })), yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: o.gsm || 200 }, machine: {} }); } catch (_) { a = null; }
    if (!a || !a.success || !a.ok_to_knit) continue;
    out.push({ needles: canon(c.seq).split('').join(' '), length: c.seq.length, knit_pct: Math.round(c.knit * 100), tuck_pct: Math.round(c.tuck * 100), longest_float: c.float, title: a.structure.identity.title, preview: c.g.map((r, i) => `F${i + 1}  ${r.join('')}`) });
  }
  return { tracks: T, feeders: F, considered: found.length, suggestions: out, notes: [...notes],
    basis: 'Every setting here knits as drawn. Which one is the sheet\'s is NOT known from the cam chart alone: compare each with the fabric photo, or knit a short trial.' };
}

// two sheets from the floor with a complete cam chart and needle setting, for the "load an example" list and the tests
const EXAMPLES = [
  {
    id: 'jacquard_2colour', label: '2-colour single-jersey jacquard: 11 feeders, 4 tracks, 14 needles (white / black)',
    spec: { legend: 'letters', tracks: ['K--K-KK--K-', 'K-K--K-K-KK', '-KK-K--KK-K', '-K-KK-K-K--'], needles: '1 2 3 4 1 2 3 4 3 2 1 4 3 2', colours: 'White Black White Black White Black White Black White Black White', name: 'Jacquard 2-colour 14 needles' },
  },
  {
    id: 'crepe_sj', label: 'Crepe single jersey with tucks: 12 feeders, 3 tracks, needle setting 1 2 3 2',
    spec: { legend: 'letters', tracks: ['KKKKTKKKKK--', 'KKKK--KKKKK-', 'KKKK--KKKKKT'], needles: '1 2 3 2', name: 'Crepe single jersey' },
  },
];

module.exports = { build, sheetOf, suggestNeedles, LEGENDS, COLOURS, EXAMPLES, CamSheetError };
