/**
 * KnitAdvisor — Jacquard builder: a colour motif painted pixel by pixel becomes the Studio's needle programme.
 *
 * A motif is rows of colour letters (A–F), top to bottom, every row the same width: one letter per needle. The knitting machine can only
 * knit one yarn at a feeder, so a pixel row of n colours is n feeds. At the feed of colour X a needle knits where the motif has X and misses
 * where it has another colour (the miss floats behind, in single jersey, or inside the two layers, in double jersey).
 *
 *   single jersey    feed X: cylinder K where the pixel is X, M elsewhere.
 *   double jersey    (rib gating, electronic jacquard) the cylinder is the same; the dial is chosen by the back:
 *     negative       the dial knits where the pixel is NOT X — the back is the motif with the colours exchanged (two colours only)
 *     same           the dial knits where the pixel is X — the back shows the same motif
 *     plain          the dial knits every needle in one ground colour — a plain back (an extra feed is added to a row without that colour)
 *
 *   interlock      each cylinder needle faces a dial needle and the two never knit at the same feed, so a course takes TWO feeds per colour:
 *                  feed a knits the even cylinder needles and the odd dial needles, feed b the odd cylinder needles and the even dial needles.
 *                  At the feeds of colour X the cylinder knits the even (a) or odd (b) needles whose pixel is X; the dial follows the back
 *                  (same / negative / plain) on its own parity. A pixel row of n colours is 2n feeds; the width must be even.
 *
 * Each colour feed is checked for its longest float and the colours in a row against what circular jacquards carry.
 */
'use strict';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const MAX = 48;

class JacquardError extends Error { constructor(m) { super(m); this.name = 'JacquardError'; } }

// motif presets: strings of letters, row by row
const PRESETS = [
  { id: 'diamond', label: 'Diamond (2 colours, 12 × 12)', colours: ['A', 'B'],
    rows: (() => { const n = 12, out = []; for (let y = 0; y < n; y++) { let s = ''; for (let x = 0; x < n; x++) s += Math.abs(x - 5.5) + Math.abs(y - 5.5) <= 5.5 ? 'B' : 'A'; out.push(s); } return out; })() },
  { id: 'zigzag', label: 'Zigzag (2 colours, 12 × 8)', colours: ['A', 'B'],
    rows: (() => { const out = []; for (let y = 0; y < 8; y++) { let s = ''; const k = y < 4 ? y : 7 - y; for (let x = 0; x < 12; x++) s += ((x + k) % 6) < 2 ? 'B' : 'A'; out.push(s); } return out; })() },
  { id: 'birdseye', label: "Bird's-eye dots (2 colours, 4 × 4)", colours: ['A', 'B'], rows: ['ABAB', 'BBBB', 'ABAB', 'BBBB'] },
  { id: 'checker', label: 'Small check (2 colours, 4 × 4)', colours: ['A', 'B'], rows: ['AABB', 'AABB', 'BBAA', 'BBAA'] },
  { id: 'wale_stripe', label: 'Vertical stripe (2 colours, 6 × 2)', colours: ['A', 'B'], rows: ['AAABBB', 'AAABBB'] },
  { id: 'plaid', label: 'Plaid (3 colours, 12 × 12)', colours: ['A', 'B', 'C'],
    rows: (() => { const out = []; for (let y = 0; y < 12; y++) { let s = ''; for (let x = 0; x < 12; x++) { const a = x < 6 ? 0 : 1, b = y < 6 ? 0 : 1; s += a === 0 && b === 0 ? 'A' : a === 1 && b === 1 ? 'B' : 'C'; } out.push(s); } return out; })() },
];

function readMotif(motif) {
  const rows = (Array.isArray(motif) ? motif : String(motif || '').split(/\r?\n/)).map((r) => String(r).replace(/\s+/g, '').toUpperCase()).filter((r) => r.length);
  if (!rows.length) throw new JacquardError('Paint the motif: at least one row of colours (letters A–F).');
  const W = rows[0].length;
  rows.forEach((r, i) => {
    if (r.length !== W) throw new JacquardError(`Row ${i + 1} is ${r.length} needles wide and row 1 is ${W}: every row of the motif must be the same width.`);
    const bad = r.split('').find((c) => !LETTERS.includes(c));
    if (bad) throw new JacquardError(`Row ${i + 1} has "${bad}": the colours are the letters A to F.`);
  });
  if (W > MAX) throw new JacquardError(`The motif is ${W} needles wide; the Studio holds ${MAX}.`);
  return { rows, W };
}

function build(spec) {
  const { rows, W } = readMotif(spec.motif);
  const gatingIn = spec.bed === 'interlock' ? 'interlock' : spec.bed === 'rib' || spec.bed === 'double' ? 'rib' : 'single';
  const bed = gatingIn === 'single' ? 'single' : 'double';
  const back = bed === 'double' ? (['negative', 'same', 'plain'].includes(spec.back) ? spec.back : 'same') : null;
  const maxFloat = Math.min(12, Math.max(2, +spec.max_float || 6));
  const used = [...new Set(rows.join('').split(''))].sort();
  if (used.length < 2) throw new JacquardError('A motif of one colour is a plain fabric: paint at least two colours.');
  if (gatingIn === 'interlock' && W % 2) throw new JacquardError(`An interlock repeat needs an even number of needles (each feed pair knits the even and the odd ones); this motif is ${W} wide.`);
  if (bed === 'double' && back === 'negative' && used.length !== 2) throw new JacquardError(`The exchanged-colour back needs exactly two colours; this motif has ${used.length}. Choose "same" or "plain" for the back.`);
  let ground = spec.ground_colour && LETTERS.includes(spec.ground_colour) ? spec.ground_colour : used[0];
  if (bed === 'double' && back === 'plain' && !used.includes(ground)) ground = used[0];

  const C = [], D = [], feeds = [], rowOfFeed = [];
  const notes = [], checks = [];
  rows.forEach((row, ri) => {
    const inRow = [...new Set(row.split(''))];
    // a plain back keeps the ground colour's feed last, so the dial knits after the face
    const order = inRow.slice().sort((a, b) => (back === 'plain' ? (a === ground ? 1 : 0) - (b === ground ? 1 : 0) : 0) || a.localeCompare(b));
    const needGround = bed === 'double' && back === 'plain' && !inRow.includes(ground);
    order.forEach((X) => {
      const faceOn = row.split('').map((p) => p === X);
      const dialOn = row.split('').map((p) => {
        if (inRow.length === 1) return true;                         // a solid row: both beds knit it
        if (back === 'negative') return p !== X;
        if (back === 'same') return p === X;
        return X === ground;                                         // plain
      });
      if (gatingIn === 'interlock') {
        [0, 1].forEach((par) => {
          // feed a (par 0): even cylinder needles, odd dial needles; feed b (par 1): odd cylinder, even dial
          const cr = faceOn.map((on, w) => (on && w % 2 === par ? 'K' : 'M')), dr = dialOn.map((on, w) => (on && w % 2 !== par ? 'K' : 'M'));
          if (!cr.includes('K') && !dr.includes('K')) return;          // this colour has no needle of this parity: no feed
          C.push(cr); D.push(dr); feeds.push({ colour: X }); rowOfFeed.push(ri + 1);
        });
        return;
      }
      C.push(faceOn.map((on) => (on ? 'K' : 'M')));
      if (bed === 'double') D.push(dialOn.map((on) => (on ? 'K' : 'M')));
      feeds.push({ colour: X }); rowOfFeed.push(ri + 1);
    });
    if (needGround) {
      if (gatingIn === 'interlock') [0, 1].forEach((par) => { C.push(Array(W).fill('M')); D.push(Array.from({ length: W }, (_, w) => (w % 2 !== par ? 'K' : 'M'))); feeds.push({ colour: ground }); rowOfFeed.push(ri + 1); });
      else { C.push(Array(W).fill('M')); D.push(Array(W).fill('K')); feeds.push({ colour: ground }); rowOfFeed.push(ri + 1); }
    }
  });
  if (C.length > MAX) throw new JacquardError(`This motif needs ${C.length} feeds (${rows.length} pixel rows, ${used.length} colours); the Studio holds ${MAX}. Make the motif shorter, or use fewer colours in a row.`);

  // floats: the longest run of missed needles at each colour feed, round the repeat
  let worst = 0, worstAt = null;
  C.forEach((cr, i) => {
    // the yarn is caught by a needle of either bed: a float is a run of needles where neither bed knits
    const r = cr.map((x, w) => (x === 'K' || (bed === 'double' && D[i][w] === 'K') ? 'K' : 'M'));
    if (!r.includes('K')) return;
    let best = 0, run = 0;
    for (let k = 0; k < 2 * W; k++) { if (r[k % W] === 'M') { run++; best = Math.max(best, Math.min(run, W - 1)); } else run = 0; }
    if (best > worst) { worst = best; worstAt = { feed: i + 1, row: rowOfFeed[i], colour: feeds[i].colour, needles: best }; }
  });
  if (worst > maxFloat) checks.push({ level: 'warn', text: `Row ${worstAt.row}, colour ${worstAt.colour}: a float across ${worst} needles on the back — it snags and pulls the cloth; keep floats to ${maxFloat} needles or fewer (break the long run of one colour with a pixel of the other, or add a tuck).` });
  else checks.push({ level: 'ok', text: `The longest float is ${worst} needle${worst === 1 ? '' : 's'}, inside the ${maxFloat} you allow.` });
  const perRow = Math.max(...rows.map((r) => new Set(r.split('')).size));
  if (perRow > 4) checks.push({ level: 'note', text: `${perRow} colours in one pixel row: most circular jacquards carry 4 yarns per course (some 6); check yours before you commit.` });
  if (bed === 'single') notes.push('Single jersey jacquard: the yarn that does not knit floats behind the face. The back shows the floats, so it is not a reversible cloth.');
  if (bed === 'double' && back === 'negative') notes.push('Exchanged-colour back: the back shows the same motif with the two colours swapped (reversible jacquard).');
  if (bed === 'double' && back === 'same') notes.push('Same-colour back: each dial needle knits in the colour of its face needle, so the back repeats the motif.');
  if (bed === 'double' && back === 'plain') notes.push(`Plain back in colour ${ground}: the dial knits one colour; a row without that colour gets an extra feed for the back.`);
  if (gatingIn === 'interlock') notes.push('Interlock: every colour takes two feeds (even and odd needles), so the face and the back are both closed; the cloth is firmer and heavier than the single-jersey jacquard.');
  notes.push(`${rows.length} pixel rows × ${W} needles → ${C.length} feeds. The Studio picks an electronic jacquard machine for it.`);

  return {
    bed, gating: gatingIn === 'single' ? 'single' : gatingIn, C, D: bed === 'double' ? D : null, feeds,
    motif: { rows, width: W, height: rows.length }, colours: used, feeds_total: C.length, colours_per_row: perRow, back, ground: back === 'plain' ? ground : null,
    longest_float: worst, notes, checks, name: String(spec.name || 'Jacquard').slice(0, 60),
  };
}

function catalogue() {
  return { presets: PRESETS.map((p) => ({ id: p.id, label: p.label, colours: p.colours, rows: p.rows })), backs: [{ id: 'same', label: 'Same motif on the back' }, { id: 'negative', label: 'Back with the two colours exchanged (reversible)' }, { id: 'plain', label: 'Plain back in one colour' }], limits: { max_width: MAX, max_feeds: MAX, letters: LETTERS } };
}

module.exports = { build, catalogue, readMotif, PRESETS, JacquardError };
