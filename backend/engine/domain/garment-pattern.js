'use strict';
/**
 * KnitAdvisor — Garment pattern engine (crew-neck T-shirt, v1)
 * ===================================================================
 * A measurement chart in, the pattern pieces out: the way a pattern maker drafts a basic tee, with the fabric's own shrinkage put in.
 *
 *   chart (finished flat measures, AFTER wash, by size)   ->   finished outline of each piece   ->   cut outline
 *
 * 1. FINISHED OUTLINES (cm, x across the cloth / courses, y along the wales; y = 0 at the high point of the shoulder).
 *    Front and back: neckline (a cubic Bézier, level at the centre), shoulder, armhole (cubic Bézier, the front scooped deeper), side seam, hem.
 *    Sleeve: cap (two Béziers, symmetric about the sleeve's centre line), underarm seam, hem. The cap is SOLVED, not assumed: its height is found so that
 *    the cap's length equals the armhole's length plus the ease the chart asks for (knit: a little, 0 to +1 cm).
 *    Neck band: a rectangle as long as the neck opening, shortened by the band's stretch.
 * 2. CUT OUTLINES. A flat measure is what the garment must be after washing, so the piece is cut larger by the fabric's shrinkage:
 *    cut = finished / (1 - shrinkage %), across and along separately. Seam allowances are then added to the cut size (they are sewn, not shrunk).
 * 3. MARKER. The pieces of every size (by the ratio) are laid on the fabric's cutting width with the grain along the length, by skyline packing on a
 *    1 cm grid with a gap between pieces. Efficiency = piece area / (marker length x width). A CAD marker maker usually gains a few points on this.
 * 4. CHECKS. Seam lengths that must match, the cap ease, the neck opening against a head, the grading, the widest piece against the fabric.
 *
 * What it does not do: set-in sleeve ease distribution, curved-hem and pocket styles, plaid or stripe matching, the cloth's own drape. It says so.
 * Plain arithmetic, no data store; the page draws what it returns (units: cm).
 */

const STYLE = 'tee';
const INCH = 2.54;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// the points of measure (POM): key, label, the chart's name for it, required, default as a share of the chest (flat), range as a share of the chest
const POMS = [
  { key: 'chest', label: 'Chest, 2.5 cm below armhole (flat)', req: true },
  { key: 'length', label: 'Body length, high point shoulder to hem', req: true },
  { key: 'shoulder', label: 'Shoulder, seam to seam', req: true, share: 0.865, lo: 0.7, hi: 1.0 },
  { key: 'armhole', label: 'Armhole, straight (shoulder point to underarm)', req: true, share: 0.44, lo: 0.36, hi: 0.52 },
  { key: 'neck_w', label: 'Neck width, seam to seam', req: true, share: 0.345, lo: 0.25, hi: 0.5 },
  { key: 'neck_df', label: 'Front neck drop', req: true, share: 0.155, lo: 0.08, hi: 0.26 },
  { key: 'sleeve_l', label: 'Sleeve length, from shoulder point', req: true, share: 0.4, lo: 0.12, hi: 1.3 },
  { key: 'bicep', label: 'Bicep (flat)', req: true, share: 0.355, lo: 0.24, hi: 0.5 },
  { key: 'sleeve_o', label: 'Sleeve opening (flat)', req: true, share: 0.32, lo: 0.2, hi: 0.48 },
  { key: 'neck_db', label: 'Back neck drop', req: false, abs: 2.0 },
  { key: 'hem', label: 'Hem width (flat)', req: false, share: 1.0 },
  { key: 'hem_h', label: 'Body hem height', req: false, abs: 2.5 },
  { key: 'sleeve_hem_h', label: 'Sleeve hem height', req: false, abs: 2.0 },
  { key: 'rib_w', label: 'Neck band height (finished)', req: false, abs: 2.0 },
  { key: 'slope', label: 'Shoulder drop (slope)', req: false, abs: 2.5 },
];
const POM_KEYS = POMS.map((p) => p.key);

// how a chart names them (first match wins: the specific names before the general ones)
const ALIASES = [
  ['neck_df', /front.*neck.*drop|neck.*drop.*front|front\s*neck|neck.*front/],
  ['neck_db', /back.*neck.*drop|neck.*drop.*back|back\s*neck|neck.*back/],
  ['slope', /shoulder.*(drop|slope)|slope/],
  ['hem_h', /(body\s*)?hem\s*(height|depth|band|fold)|bottom\s*hem\s*height/],
  ['sleeve_hem_h', /sleeve.*hem\s*(height|depth)|cuff\s*(height|depth)/],
  ['rib_w', /rib|collar\s*(height|width|band)|neck\s*(band|binding)|binding/],
  ['sleeve_o', /sleeve.*(opening|hem|cuff|end)|cuff.*opening|sleeve\s*o/],
  ['sleeve_l', /sleeve.*length|sleeve\s*l\b|sleeve$|^sleeve\b/],
  ['bicep', /bicep|biceps|muscle|upper\s*arm|sleeve.*(width|muscle)/],
  ['armhole', /arm\s*hole|armhole|\bah\b|armscye/],
  ['neck_w', /neck.*(width|opening|seam|span|across)|^neck$|neck\s*w/],
  ['shoulder', /shoulder/],
  ['hem', /\bhem\b|bottom\s*(width|opening)|sweep|waist.*hem/],
  ['length', /body\s*length|length.*(hps|shoulder|body|back|front)|(hps|shoulder).*length|total\s*length|garment\s*length|^length$|\blength\b/],
  ['chest', /chest|bust|1\/2\s*chest|half\s*chest|across\s*chest/],
];

// ── numbers ──
function num(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/,/g, '.').replace(/[^\d./\s-]/g, '').trim();
  if (!s) return NaN;
  const mix = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s);                  // 20 1/2
  if (mix) return Math.sign(+mix[1] || 1) * (Math.abs(+mix[1]) + +mix[2] / +mix[3]);
  const fr = /^(\d+)\/(\d+)$/.exec(s);                              // 1/2
  if (fr) return +fr[1] / +fr[2];
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

// ── a chart from pasted text (Excel, a PDF table): rows of "point of measure, size, size, ..." ──
function parseChart(text, unitHint) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { success: false, error: 'Paste at least a header line (the sizes) and one measurement line.' };
  const sep = (l) => (l.includes('\t') ? '\t' : (l.match(/;/g) || []).length > (l.match(/,/g) || []).length ? ';' : ',');
  const cells = (l) => {
    const s = sep(l), out = []; let cur = '', q = false;
    // a quote only opens a quoted cell at the start of a cell: an inch mark inside a name (1" below armhole) is just a character
    for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"' && !q && cur === '') q = true; else if (c === '"' && q) q = false; else if (c === s && !q) { out.push(cur.trim()); cur = ''; } else cur += c; }
    out.push(cur.trim()); return out;
  };
  const rows = lines.map(cells);
  // the header is the first line whose cells after the first are not numbers
  let h = rows.findIndex((r) => r.length > 2 && r.slice(1).filter((c) => c && Number.isNaN(num(c))).length >= 2);
  let sizes;
  if (h < 0) { h = -1; sizes = rows[0].slice(1).map((_, i) => `S${i + 1}`); } else sizes = rows[h].slice(1).filter(Boolean);
  if (!sizes.length) return { success: false, error: 'No sizes found in the header line.' };
  const chart = {}, seen = [], unmapped = [];
  rows.slice(h + 1).forEach((r) => {
    const label = r[0] || ''; if (!label) return;
    const core = label.toLowerCase().replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim();     // (1" below armhole), (HPS): remarks, not the name
    const hit = ALIASES.find(([, re]) => re.test(core));
    const vals = sizes.map((_, i) => num(r[i + 1]));
    if (!hit || vals.every(Number.isNaN)) { unmapped.push(label); return; }
    if (chart[hit[0]]) { unmapped.push(`${label} (already has ${hit[0]})`); return; }
    chart[hit[0]] = {}; sizes.forEach((s, i) => { if (Number.isFinite(vals[i])) chart[hit[0]][s] = vals[i]; });
    seen.push({ label, key: hit[0] });
  });
  const unit = unitHint === 'in' || unitHint === 'cm' ? unitHint : (() => {
    const c = chart.chest ? Object.values(chart.chest) : []; const m = c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0;
    return m && m < 40 ? 'in' : 'cm';                                  // a flat chest of 18-30 is inches; 45-65 is cm
  })();
  return { success: true, sizes, chart, unit, mapped: seen, unmapped };
}

// a graded starting chart: a men's crew tee, a size step of 2 cm on the chest
function template(sizes, unit) {
  const S = sizes && sizes.length ? sizes : ['S', 'M', 'L', 'XL'];
  const mid = Math.max(0, S.indexOf('M') >= 0 ? S.indexOf('M') : Math.floor((S.length - 1) / 2));
  const base = { chest: 52, length: 70, shoulder: 45, armhole: 23, neck_w: 18, neck_df: 8, neck_db: 2, sleeve_l: 21, bicep: 18.5, sleeve_o: 16.5, hem: 52, hem_h: 2.5, sleeve_hem_h: 2, rib_w: 2, slope: 2.5 };
  const step = { chest: 2, length: 1.5, shoulder: 1.5, armhole: 1, neck_w: 0.5, neck_df: 0.3, neck_db: 0, sleeve_l: 0.7, bicep: 1, sleeve_o: 0.8, hem: 2, hem_h: 0, sleeve_hem_h: 0, rib_w: 0, slope: 0 };
  const k = unit === 'in' ? 1 / INCH : 1, chart = {};
  POM_KEYS.forEach((key) => { chart[key] = {}; S.forEach((s, i) => { chart[key][s] = r2((base[key] + step[key] * (i - mid)) * k); }); });
  return { sizes: S, unit: unit === 'in' ? 'in' : 'cm', chart };
}

// ── geometry ──
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
function bez(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
const plen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// the armhole, shoulder tip to underarm: down, bowing in by `bulge`, then out to the underarm, which it meets level
function armholeCurve(sw2, slope, cw2, ah, bulge, n, k1) {
  const h = ah - slope, xin = sw2 - bulge;
  const p0 = [sw2, slope], p3 = [cw2, ah];
  const p1 = [xin, slope + (k1 == null ? 0.32 : k1) * h], p2 = [cw2 - 0.46 * (cw2 - xin), ah];
  return bez(p0, p1, p2, p3, n);
}
// the sleeve cap, underarm to apex (right half): a Bézier with a bow factor a
function capHalf(bw2, ch, a, n) { return bez([bw2, ch], [bw2 * a, ch * 0.42], [bw2 * 0.46, 0], [0, 0], n); }

function bisect(f, lo, hi, target, iters) {                                   // f increasing
  let a = lo, b = hi;
  for (let i = 0; i < iters; i++) { const m = (a + b) / 2; if (f(m) < target) a = m; else b = m; }
  return (a + b) / 2;
}

// ── a polygon offset by a distance per edge (a seam allowance): the vertices move to where the offset edges meet ──
function offsetPoly(pts, allow) {
  const n = pts.length, s = Math.sign(area(pts)) || 1, lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
    const nx = (s * dy) / len, ny = (-s * dx) / len;
    lines.push({ px: a[0] + nx * allow[i], py: a[1] + ny * allow[i], dx: dx / len, dy: dy / len, nx, ny, d: allow[i] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i], cr = A.dx * B.dy - A.dy * B.dx, dmax = Math.max(A.d, B.d, 1e-9);
    if (Math.abs(cr) < 1e-6) { out.push([pts[i][0] + (A.nx * A.d + B.nx * B.d) / 2, pts[i][1] + (A.ny * A.d + B.ny * B.d) / 2]); continue; }
    const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / cr;
    let x = A.px + A.dx * t, y = A.py + A.dy * t;
    if (Math.hypot(x - pts[i][0], y - pts[i][1]) > 3 * dmax) { x = pts[i][0] + (A.nx + B.nx) * dmax / 2; y = pts[i][1] + (A.ny + B.ny) * dmax / 2; }   // a sharp corner: bevel
    out.push([x, y]);
  }
  return out;
}

// cut the loops out of an outline (an offset on a tight curve folds over itself): keep the larger part at each crossing
function removeLoops(pts, labels) {
  let P = pts.map((p) => p.slice()), Lb = labels.slice();
  for (let guard = 0; guard < 60; guard++) {
    const n = P.length; let hit = null;
    const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < n && !hit; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n];
      if (o(a, b, c) * o(a, b, d) < -1e-12 && o(c, d, a) * o(c, d, b) < -1e-12) { hit = [i, j]; break; }
    }
    if (!hit) break;
    const [i, j] = hit, a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n];
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / ((b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]));
    const X = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const loop = P.slice(i + 1, j + 1), rest = P.slice(0, i + 1).concat([X], P.slice(j + 1));
    const restL = Lb.slice(0, i + 1).concat([Lb[i]], Lb.slice(j + 1));
    if (Math.abs(area(loop)) > Math.abs(area(rest))) { P = loop.concat([X]); Lb = Lb.slice(i + 1, j + 1).concat([Lb[j]]); } else { P = rest; Lb = restL; }
  }
  return { pts: P, labels: Lb };
}

// is any pair of non-adjacent edges crossing? (a piece that loops over itself is not a piece)
function selfCrossing(p) {
  const n = p.length;
  const cross = (a, b, c, d) => {
    const o = (p1, p2, p3) => (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (cross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true; }
  return false;
}

const bbox = (p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; p.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
const dedupe = (pts) => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-7);

// ── the finished pieces of one size ──
// the underarm's depth below the high point of the shoulder: the straight armhole is the chord from the shoulder point, so its vertical run is what is left
function underarmY(m) { const dx = m.chest / 2 - m.shoulder / 2; return m.slope + Math.sqrt(Math.max(m.armhole * m.armhole - dx * dx, 4)); }

function finishedPieces(m, o) {
  const cw2 = m.chest / 2, hw2 = m.hem / 2, sw2 = m.shoulder / 2, nw2 = m.neck_w / 2, ah = underarmY(m), slope = m.slope, L = m.length;
  const N = 26;
  // neckline, centre to neck point, as a quarter ellipse
  const neck = (drop) => bez([0, drop], [nw2 * 0.55, drop], [nw2 * 0.93, drop * 0.36], [nw2, 0], N);
  const frontNeck = neck(m.neck_df), backNeck = neck(m.neck_db);
  // the front armhole bows in by 8 % of its depth; the back's bow is solved so both armholes are as long (the sleeve cap serves both)
  const depth = ah - slope, bf = 0.085 * depth;
  const aF = armholeCurve(sw2, slope, cw2, ah, bf, 40, 0.4), lenF = plen(aF);
  const bb = bisect((b) => plen(armholeCurve(sw2, slope, cw2, ah, b, 40, 0.26)), 0, 0.3 * depth, lenF, 50);
  const aB = armholeCurve(sw2, slope, cw2, ah, bb, 40, 0.26), lenB = plen(aB);
  const bodyHalf = (neckPts, arm) => {
    const edges = [], pts = [];
    const push = (label, seg) => { seg.forEach((p) => pts.push(p)); edges.push({ label, n: seg.length }); };
    push('neck', neckPts);                                       // centre front/back -> neck point
    push('shoulder', [[nw2, 0], [sw2, slope]].slice(1));           // -> shoulder tip
    push('armhole', arm.slice(1));                                  // -> underarm
    push('side', [[hw2, L]]);                                        // -> hem corner
    push('hemedge', [[hw2, L + m.hem_h]]);                          // -> bottom of the hem allowance
    return { pts, edges };
  };
  const assemble = (half) => {
    // right half as built; the left half is its mirror, walked backwards
    const right = half.pts, left = right.slice().reverse().map(([x, y]) => [-x, y]);
    const lab = [];
    let k = 0; half.edges.forEach((e) => { for (let i = 0; i < e.n; i++) lab.push(e.label); k += e.n; });
    // polygon: centre-top (first neck point), along the right half, then back along the left half (without repeating the ends)
    const polyPts = right.concat(left);
    const edgeLabels = [];
    // edge i runs from polyPts[i] to polyPts[i+1]: the label is that of the point it arrives at, with the mirror's labels reversed
    for (let i = 0; i < right.length - 1; i++) edgeLabels.push(lab[i + 1]);
    edgeLabels.push('hem');                                                   // right bottom corner -> left bottom corner
    for (let i = right.length - 2; i >= 0; i--) edgeLabels.push(lab[i + 1]);   // up the left side
    return { pts: polyPts, labels: edgeLabels.slice(0, polyPts.length) };
  };
  const front = assemble(bodyHalf(frontNeck, aF)), back = assemble(bodyHalf(backNeck, aB));
  // the hem closes across the bottom: the last polygon edge (left bottom -> first neck point) is the left side of the polygon going up; make the closing edge a neckline join
  const fixLabels = (piece) => { const out = []; for (let i = 0; i < piece.pts.length; i++) out.push(piece.labels[i] || 'neck'); piece.labels = out; return piece; };
  fixLabels(front); fixLabels(back);

  // the sleeve: the cap is solved against the armhole
  const bw2 = m.bicep, so2 = m.sleeve_o, SL = m.sleeve_l, capTarget = (lenF + lenB) / 2 + o.ease_cm;
  const capLen = (ch) => plen(capHalf(bw2, ch, 0.92, 40));
  const chMax = Math.max(bw2 * 3, SL);
  const ch = bisect(capLen, 0.5, chMax, capTarget, 60);
  const capR = capHalf(bw2, ch, 0.92, 40), capLenSolved = plen(capR);
  const capOk = Math.abs(capLenSolved - capTarget) < 0.05;
  const sleeveR = capR.slice().reverse();                                   // apex -> underarm along the right half
  const sright = [[0, 0]].concat(sleeveR.slice(1));
  const sleeveEdges = ['cap'];
  const spts = sright.concat([[so2, SL], [so2, SL + m.sleeve_hem_h]]);
  const sleeveLabels = []; for (let i = 0; i < sright.length - 1; i++) sleeveLabels.push('cap'); sleeveLabels.push('underarm'); sleeveLabels.push('hemedge');
  const sleftRev = spts.slice(1).reverse().map(([x, y]) => [-x, y]);
  const sleevePts = spts.concat(sleftRev.slice(0));
  const sl = []; for (let i = 0; i < spts.length - 1; i++) sl.push(sleeveLabels[i] || 'cap'); sl.push('hem');
  for (let i = spts.length - 2; i >= 0; i--) sl.push(sleeveLabels[i] || 'cap');
  void sleeveEdges;

  // the neck band
  const neckFront = plen(frontNeck) * 2, neckBack = plen(backNeck) * 2, neckLen = neckFront + neckBack;
  const bandLen = neckLen / (1 + o.rib_stretch_pct / 100);
  const band = [[0, 0], [bandLen, 0], [bandLen, 2 * m.rib_w], [0, 2 * m.rib_w]];

  return {
    front: { id: 'front', name: 'Front', qty: 1, pts: dedupe2(front), grain: 'y' },
    back: { id: 'back', name: 'Back', qty: 1, pts: dedupe2(back), grain: 'y' },
    sleeve: { id: 'sleeve', name: 'Sleeve', qty: 2, pts: dedupe2({ pts: sleevePts, labels: sl }), grain: 'y' },
    band: { id: 'band', name: 'Neck band', qty: 1, pts: { pts: band, labels: ['neck', 'seam', 'neck', 'seam'] }, grain: 'x', rib: true },
    derived: { armhole_front: lenF, armhole_back: lenB, cap_len: capLenSolved, cap_height: ch, cap_target: capTarget, neck_front: neckFront, neck_back: neckBack, neck_len: neckLen, band_len: bandLen, back_bow: bb, front_bow: bf, cap_ok: capOk, underarm_y: ah },
  };
}
function dedupe2(p) {
  const pts = [], labels = [];
  p.pts.forEach((q, i) => { if (!pts.length || dist(q, pts[pts.length - 1]) > 1e-7) { pts.push(q); labels.push(p.labels[i]); } });
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-7) { pts.pop(); labels.pop(); }
  return { pts, labels };
}

// ── from finished to cut ──
function cutOutline(piece, sx, sy, allow) {
  const scaled = piece.pts.pts.map(([x, y]) => [x * sx, y * sy]);
  const a = piece.pts.labels.map((l) => (l === 'neck' ? allow.neck : l === 'hem' ? 0 : allow.seam));
  const clean = removeLoops(offsetPoly(scaled, a), piece.pts.labels);
  return { nominal: scaled, pts: clean.pts, labels: clean.labels };
}

// ── the marker ──
// A raster nest: 1 cm cells, each piece a bit mask (every cell a piece touches counts), a gap of cells round it, and the piece goes at the first free
// place scanning from the top-left, in both orientations unless one-way. Concave edges (neck, armhole) are filled by the pieces that come after.
const CELL = 1;                                                              // cm
function maskOf(poly) {
  const b = bbox(poly), W = Math.ceil(b.w / CELL) + 1, H = Math.ceil(b.h / CELL) + 1, n = poly.length;
  const rows = Array.from({ length: H }, () => new Uint8Array(W));
  for (let r = 0; r < H; r++) {
    for (const f of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      const y = b.y0 + (r + f) * CELL, xs = [];
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.floor((xs[k] - b.x0) / CELL)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - b.x0 - 1e-9) / CELL));
        for (let c = c0; c <= c1; c++) rows[r][c] = 1;
      }
    }
  }
  return { rows, W, H, b };
}
function dilate(m, g) {
  const W = m.W + 2 * g, H = m.H + 2 * g, hor = Array.from({ length: m.H }, () => new Uint8Array(W));
  m.rows.forEach((row, r) => { for (let c = 0; c < m.W; c++) if (row[c]) for (let d = -g; d <= g; d++) hor[r][c + g + d] = 1; });
  const out = Array.from({ length: H }, () => new Uint8Array(W));
  for (let r = 0; r < m.H; r++) for (let d = -g; d <= g; d++) { const t = out[r + g + d]; if (!t) continue; const s = hor[r]; for (let c = 0; c < W; c++) if (s[c]) t[c] = 1; }
  return { rows: out, W, H };
}
const toWords = (row, nw) => { const w = new Uint32Array(nw); for (let c = 0; c < row.length; c++) if (row[c]) w[c >> 5] |= (1 << (c & 31)) >>> 0; return w; };
function shiftWords(w, s, nw) { const o = new Uint32Array(nw + 1); for (let k = 0; k < w.length; k++) { o[k] |= (w[k] << s) >>> 0; if (s) o[k + 1] |= w[k] >>> (32 - s); } return o; }
const rot180 = (poly) => { const b = bbox(poly); return poly.map(([x, y]) => [b.x0 + b.x1 - x, b.y0 + b.y1 - y]); };

function lay(items, widthCm, o) {
  const g = Math.max(0, Math.round(o.gap_cm / CELL)), cols = Math.floor(widthCm / CELL), OW = Math.ceil(cols / 32) + 4;
  // each piece's masks are made once (a piece is tried in many orders)
  const preps = new Map();
  const prepOf = (poly) => {
    if (preps.has(poly)) return preps.get(poly);
    const vs = (o.one_way ? [poly] : [poly, rot180(poly)]).map((pl, vi) => {
      const m = maskOf(pl), D = dilate(m, g);
      if (D.W > cols) return null;
      const nwD = Math.ceil(D.W / 32), words = D.rows.map((r) => toWords(r, nwD)), live = [];
      for (let r = 0; r < D.H; r++) if (words[r].some((x) => x)) live.push(r);
      return { poly: pl, m, D, nwD, words, live, shifted: [], rot: vi ? 180 : 0 };
    }).filter(Boolean);
    preps.set(poly, vs); return vs;
  };
  const shiftOf = (v, sft) => v.shifted[sft] || (v.shifted[sft] = v.words.map((w) => shiftWords(w, sft, v.nwD)));
  const run = (order, limit) => {
    const occ = [], row = (y) => occ[y] || (occ[y] = new Uint32Array(OW));
    let used = 0; const placed = [];
    for (const it of order) {
      const vs = prepOf(it.poly);
      if (!vs.length) return { ok: false, error: `${it.name} (${r1(bbox(it.poly).w)} cm wide) does not fit the ${r1(widthCm)} cm cutting width.` };
      let best = null;
      vs.forEach((v) => {
        const { D, nwD, live } = v;
        const free = (x0, y) => {
          const S = shiftOf(v, x0 & 31), wo = x0 >> 5;
          for (let q = 0; q < live.length; q++) { const r = live[q], oc = occ[y + r]; if (!oc) continue; const w = S[r]; for (let k = 0; k <= nwD; k++) if (w[k] && (oc[wo + k] & w[k])) return false; }
          return true;
        };
        let found = null;
        for (let y = 0; y < 5000 && !found; y++) {
          if (best && y + D.H > best.end + 1e-9) break;
          for (let x0 = 0; x0 + D.W <= cols; x0++) if (free(x0, y)) { found = { x0, y }; break; }
        }
        if (!found) return;
        const end = found.y + D.H;
        if (!best || end < best.end - 1e-9) best = { end, x0: found.x0, y: found.y, v };
      });
      if (!best) return { ok: false, error: `${it.name} does not fit the ${r1(widthCm)} cm cutting width.` };
      const { x0, y, v } = best, m = v.m;
      for (let r = 0; r < m.H; r++) { const oc = row(y + g + r); for (let c = 0; c < m.W; c++) if (m.rows[r][c]) { const cc = x0 + g + c; oc[cc >> 5] |= (1 << (cc & 31)) >>> 0; } }
      used = Math.max(used, y + g + m.H);
      if (used * CELL + 2 * o.end_loss_cm >= limit) return null;                                // no better than the best marker so far
      const dx = (x0 + g) * CELL - m.b.x0, dy = (y + g) * CELL - m.b.y0 + o.end_loss_cm;
      placed.push({ size: it.size, piece: it.id, name: it.name, n: it.n, rot: v.rot, poly: v.poly.map(([px, py]) => [px + dx, py + dy]), area: it.area });
    }
    return { ok: true, placed, length: used * CELL + 2 * o.end_loss_cm };
  };
  // the orders to try: by area, by length, by width, then seeded shuffles of the area order; the shortest marker wins
  const area0 = items.slice().sort((a, b) => b.area - a.area);
  let best = run(area0, Infinity);
  if (!best || !best.ok) return best || { ok: false, error: 'The marker could not be laid.' };
  const trials = Math.max(1, Math.min(80, Math.round(o.trials || 1)));
  let seed = 12345; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const hOf = (it) => bbox(it.poly).h, wOf = (it) => bbox(it.poly).w;
  for (let t = 1; t < trials; t++) {
    const order = t === 1 ? items.slice().sort((a, b) => hOf(b) - hOf(a) || b.area - a.area)
      : t === 2 ? items.slice().sort((a, b) => wOf(b) - wOf(a) || b.area - a.area)
        : items.map((it) => ({ it, k: it.area * (0.55 + 0.9 * rnd()) })).sort((a, b) => b.k - a.k).map((x) => x.it);
    const r = run(order, best.length - 1e-9);
    if (r && r.ok && r.length < best.length) best = r;
  }
  return best;
}

// ── the chart for one size, filled in ──
function measures(chart, size, unit, notes) {
  const k = unit === 'in' ? INCH : 1, m = {};
  const get = (key) => num(chart && chart[key] ? chart[key][size] : NaN) * k;
  m.chest = get('chest');
  POMS.forEach((p) => {
    let v = get(p.key);
    if (!(v > 0) && !(p.key === 'neck_db' && v === 0)) {
      if (p.req && (p.key === 'chest' || p.key === 'length')) { m[p.key] = v; return; }
      v = p.share != null ? (p.key === 'sleeve_l' ? 0.4 : p.share) * m.chest : p.abs;
      if (p.key === 'hem') v = m.chest;
      if (notes) notes.add(`${size}${p.label}: not in the chart, taken as ${r1(v)} cm for size ${size}`);
    }
    m[p.key] = v;
  });
  return m;
}

// ── build ──
function build(input) {
  const inp = input || {};
  const unit = inp.unit === 'in' ? 'in' : 'cm';
  const sizes = (Array.isArray(inp.sizes) && inp.sizes.length ? inp.sizes : ['M']).map(String).slice(0, 8);
  const chart = inp.chart || {};
  const f = inp.fabric || {}, al = inp.allowance || {};
  const fabric = {
    gsm: +f.gsm > 0 ? +f.gsm : 180,
    width_cm: +f.width_cm > 0 ? +f.width_cm : (+f.width_in > 0 ? +f.width_in * INCH : 170),
    shrink_len_pct: Number.isFinite(+f.shrink_len_pct) ? +f.shrink_len_pct : 5,
    shrink_wid_pct: Number.isFinite(+f.shrink_wid_pct) ? +f.shrink_wid_pct : 5,
    rib_stretch_pct: Number.isFinite(+f.rib_stretch_pct) ? +f.rib_stretch_pct : 25,
    rib_gsm: +f.rib_gsm > 0 ? +f.rib_gsm : 240,
    wpc: +f.wpc > 0 ? +f.wpc : null, cpc: +f.cpc > 0 ? +f.cpc : null,
    colour: /^#[0-9a-f]{6}$/i.test(f.colour || '') ? f.colour : '#3d5a80', name: String(f.name || '').slice(0, 80),
  };
  if (fabric.shrink_len_pct < -15 || fabric.shrink_len_pct > 30 || fabric.shrink_wid_pct < -15 || fabric.shrink_wid_pct > 30) return { success: false, error: 'Shrinkage must be between -15 % and 30 % (negative = the cloth grows).' };
  const allow = { seam: Number.isFinite(+al.seam) ? +al.seam : 1.0, neck: Number.isFinite(+al.neck) ? +al.neck : 0.7 };
  const opt = { ease_cm: Number.isFinite(+inp.ease_cm) ? +inp.ease_cm : 0.5, rib_stretch_pct: fabric.rib_stretch_pct, gap_cm: Number.isFinite(+inp.gap_cm) ? +inp.gap_cm : 1, end_loss_cm: Number.isFinite(+inp.end_loss_cm) ? +inp.end_loss_cm : 2, one_way: inp.orient === 'one_way', trials: Number.isFinite(+inp.marker_trials) ? +inp.marker_trials : 16 };
  const base = sizes.includes(inp.base) ? inp.base : sizes[Math.floor((sizes.length - 1) / 2)];
  const ratio = {}; sizes.forEach((s) => { const r = inp.ratio && +inp.ratio[s]; ratio[s] = Number.isFinite(r) && r >= 0 ? Math.round(r) : 1; });
  if (!sizes.some((s) => ratio[s] > 0)) return { success: false, error: 'The size ratio has no garment in it.' };

  const notes = new Set(), checks = [], per = [];
  const sx = 1 / (1 - fabric.shrink_wid_pct / 100), sy = 1 / (1 - fabric.shrink_len_pct / 100);
  const bad = [];
  sizes.forEach((s) => {
    const m = measures(chart, s, unit, notes);
    if (!(m.chest > 0)) bad.push(`size ${s}: the chest is missing`);
    if (!(m.length > 0)) bad.push(`size ${s}: the body length is missing`);
    per.push({ size: s, m });
  });
  if (bad.length) return { success: false, error: `The chart is not complete: ${bad.join('; ')}.` };

  const add = (level, text, size) => checks.push({ level, text, size: size || null });
  const out = [];
  for (const { size, m } of per) {
    // sanity before drawing
    let broken = false;
    const need = (cond, text) => { if (!cond) { add('error', `Size ${size}: ${text}`, size); broken = true; } };
    need(m.chest >= 20 && m.chest <= 100, `a flat chest of ${r1(m.chest)} cm is outside 20 to 100 cm.`);
    need(m.length >= 25 && m.length <= 130, `a body length of ${r1(m.length)} cm is outside 25 to 130 cm.`);
    if (broken) continue;
    need(m.shoulder < m.chest, `the shoulder (${r1(m.shoulder)}) must be narrower than the chest (${r1(m.chest)}).`);
    need(m.neck_w < m.shoulder - 2, `the neck width (${r1(m.neck_w)}) leaves no shoulder: it must be at least 2 cm less than the shoulder (${r1(m.shoulder)}).`);
    need(m.armhole > Math.abs(m.chest / 2 - m.shoulder / 2) + 2, `the armhole (${r1(m.armhole)}) is shorter than the step from the shoulder point out to the chest line (${r1(Math.abs(m.chest / 2 - m.shoulder / 2))}).`);
    const yu = underarmY(m);
    need(yu < m.length - 8, `the underarm falls ${r1(yu)} cm below the shoulder: it leaves no side seam in a ${r1(m.length)} cm body.`);
    need(m.neck_df > 0 && m.neck_df < yu, `the front neck drop (${r1(m.neck_df)}) must be between 0 and the underarm depth (${r1(yu)}).`);
    need(m.neck_db >= 0 && m.neck_db < yu, `the back neck drop (${r1(m.neck_db)}) must be between 0 and the underarm depth.`);
    need(m.sleeve_l > 3 && m.sleeve_l < 100, `the sleeve length (${r1(m.sleeve_l)}) is outside 3 to 100 cm.`);
    need(m.bicep > 5 && m.sleeve_o > 4, `the bicep and the sleeve opening must be wider than 5 and 4 cm.`);
    need(m.hem > 15 && m.hem < 120, `the hem width (${r1(m.hem)}) is outside 15 to 120 cm.`);
    need(m.slope >= 0 && m.slope < 8, `the shoulder drop (${r1(m.slope)}) must be between 0 and 8 cm.`);
    if (broken) continue;

    const fp = finishedPieces(m, opt);
    const d = fp.derived;
    if (!d.cap_ok || !(d.cap_height > 0) || d.cap_height >= m.sleeve_l - 0.5) { add('error', `Size ${size}: the sleeve (${r1(m.sleeve_l)} cm long, ${r1(m.bicep)} cm bicep) is too short to hold a cap that fits the armhole (${r1(d.armhole_front)} cm): it needs a cap ${r1(d.cap_height)} cm high.`, size); continue; }
    const pieces = ['front', 'back', 'sleeve', 'band'].map((id) => {
      const p = fp[id], cut = cutOutline(p, id === 'band' ? 1 : sx, id === 'band' ? 1 : sy, allow);
      const fin = p.pts.pts, bb = bbox(cut.pts), bf = bbox(fin);
      return {
        id, name: p.name, qty: p.qty, rib: !!p.rib, grain: p.grain,
        finished: fin.map(([x, y]) => [r2(x), r2(y)]), cut: cut.pts.map(([x, y]) => [r2(x), r2(y)]), nominal: cut.nominal.map(([x, y]) => [r2(x), r2(y)]), labels: cut.labels,
        finished_w: r1(bf.w), finished_h: r1(bf.h), cut_w: r1(bb.w), cut_h: r1(bb.h), cut_area_cm2: r1(Math.abs(area(cut.pts))), finished_area_cm2: r1(Math.abs(area(fin))),
        simple: !selfCrossing(cut.pts) && !selfCrossing(fin),
      };
    });
    pieces.forEach((p) => { if (!p.simple) add('error', `Size ${size}: the ${p.name.toLowerCase()} outline crosses itself — the chart gives a shape that cannot be cut.`, size); });
    // checks on this size
    {
      const half = (pc, label) => { let l = 0; pc.pts.pts.forEach((q, i, a) => { const r = a[(i + 1) % a.length]; if (pc.pts.labels[i] === label && q[0] + r[0] > 0) l += Math.hypot((r[0] - q[0]) * sx, (r[1] - q[1]) * sy); }); return l; };
      const armCut = (half(fp.front, 'armhole') + half(fp.back, 'armhole')) / 2, capCut = half(fp.sleeve, 'cap'), easeCut = capCut - armCut;
      if (Math.abs(easeCut - opt.ease_cm) > 1.0) add(Math.abs(easeCut - opt.ease_cm) > 2 ? 'warn' : 'note', `Size ${size}: at the sewing table the cap is ${r1(easeCut)} cm ${easeCut >= 0 ? 'longer' : 'shorter'} than the armhole (${r1(opt.ease_cm)} cm finished): the pieces shrink by different amounts along their curves, so the sleeve has to be eased in at sewing and settles after the wash.`, size);
    }
    add('ok', `Size ${size}: sleeve cap ${r1(d.cap_len)} cm against an armhole of ${r1(d.armhole_front)} cm (front) and ${r1(d.armhole_back)} cm (back): ease ${r1(d.cap_len - (d.armhole_front + d.armhole_back) / 2)} cm, cap ${r1(d.cap_height)} cm high.`, size);
    if (Math.abs(d.armhole_front - d.armhole_back) > 0.6) add('warn', `Size ${size}: the front and back armholes differ by ${r1(Math.abs(d.armhole_front - d.armhole_back))} cm: the sleeve cap cannot be right for both.`, size);
    if (m.chest < 38) add('warn', `Size ${size}: a flat chest of ${r1(m.chest)} cm is a child's size — if the chart is in inches, set the unit to inch.`, size);
    const share = (k) => m[k] / m.chest;
    POMS.filter((p) => p.lo != null).forEach((p) => { const v = share(p.key); if (v < p.lo || v > p.hi) add('warn', `Size ${size}: ${p.label.toLowerCase()} ${r1(m[p.key])} cm is ${r1(v * 100)} % of the chest; a tee is usually ${Math.round(p.lo * 100)}–${Math.round(p.hi * 100)} %.`, size); });
    if (m.sleeve_o > m.bicep) add('warn', `Size ${size}: the sleeve opening (${r1(m.sleeve_o)}) is wider than the bicep (${r1(m.bicep)}): the sleeve flares.`, size);
    if (m.hem > m.chest + 4) add('note', `Size ${size}: the hem (${r1(m.hem)}) flares ${r1(m.hem - m.chest)} cm beyond the chest.`, size);
    const stretched = d.neck_len * (1 + 0.5);
    if (56 / d.neck_len - 1 > 0.35) add('warn', `Size ${size}: the neck opening is ${r1(d.neck_len)} cm round; a head needs about 56 cm, so it must stretch ${Math.round((56 / d.neck_len - 1) * 100)} % to go over: the band will not recover.`, size);
    else if (stretched < 56) add('note', `Size ${size}: the neck opening is ${r1(d.neck_len)} cm round (${r1(stretched)} cm at 50 % stretch): a head needs about 56 cm.`, size);
    out.push({ size, m: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r2(v)])), derived: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, r2(v)])), pieces });
  }
  if (!out.length) return { success: false, error: checks.filter((c) => c.level === 'error').map((c) => c.text).join(' ') || 'No size could be drawn.', checks };

  // grading: a measurement that does not grow with the size
  POM_KEYS.forEach((k) => {
    const vs = out.map((o) => o.m[k]);
    for (let i = 1; i < vs.length; i++) if (vs[i] + 1e-9 < vs[i - 1]) { add('warn', `Grading: ${POMS.find((p) => p.key === k).label.toLowerCase()} gets smaller from size ${out[i - 1].size} (${r1(vs[i - 1])}) to ${out[i].size} (${r1(vs[i])}).`); break; }
  });
  // fabric
  const widest = Math.max.apply(null, out.map((o) => Math.max.apply(null, o.pieces.filter((p) => !p.rib).map((p) => p.cut_w))));
  if (widest > fabric.width_cm) add('error', `The widest piece is ${r1(widest)} cm; the fabric cuts ${r1(fabric.width_cm)} cm wide.`);
  else if (widest > fabric.width_cm * 0.97) add('warn', `The widest piece (${r1(widest)} cm) leaves under 3 % of the ${r1(fabric.width_cm)} cm cutting width.`);
  if (fabric.shrink_len_pct > 8 || fabric.shrink_wid_pct > 8) add('warn', `Shrinkage of ${fabric.shrink_len_pct} % / ${fabric.shrink_wid_pct} % is high: the cut is ${r1((sy - 1) * 100)} % longer and ${r1((sx - 1) * 100)} % wider than the finished garment, and small errors in the shrinkage show in the fit.`);
  if (Math.abs(fabric.shrink_len_pct - fabric.shrink_wid_pct) > 6) add('note', `Length and width shrink by different amounts (${fabric.shrink_len_pct} % / ${fabric.shrink_wid_pct} %): the cut is stretched along the wales and across the courses by different factors.`);
  add('note', `Pieces are cut ${r1((sx - 1) * 100)} % wider and ${r1((sy - 1) * 100)} % longer than the finished measures, then ${allow.seam} cm of seam allowance is added (neck ${allow.neck} cm).`);

  // the marker: every size by its ratio, the main fabric only (the band is cut from the rib)
  const items = [];
  out.forEach((o) => o.pieces.filter((p) => !p.rib).forEach((p) => { { const poly = p.cut.map((q) => q.slice()); for (let i = 0; i < p.qty * (ratio[o.size] || 0); i++) items.push({ size: o.size, id: p.id, name: `${o.size} ${p.name}`, n: i + 1, poly, area: p.cut_area_cm2 }); } }));
  const mk = lay(items, fabric.width_cm, opt);
  if (!mk.ok) return { success: false, error: mk.error, checks };
  const garments = out.reduce((a, o) => a + (ratio[o.size] || 0), 0);
  const net = items.reduce((a, it) => a + it.area, 0);
  const grossArea = mk.length * fabric.width_cm;
  const eff = net / grossArea;
  const kg = (areaCm2, gsm) => (areaCm2 / 10000) * gsm / 1000;
  const ribPer = out.reduce((a, o) => a + (ratio[o.size] || 0) * o.pieces.filter((p) => p.rib).reduce((b, p) => b + p.cut_area_cm2, 0), 0) / garments;
  const consumption = {
    garments_in_marker: garments, marker_length_cm: r1(mk.length), marker_width_cm: r1(fabric.width_cm), efficiency_pct: r1(eff * 100),
    net_area_per_garment_cm2: r1(net / garments), gross_area_per_garment_cm2: r1(grossArea / garments),
    fabric_per_garment_m: r2(mk.length / 100 / garments), net_kg_per_garment: Math.round(kg(net / garments, fabric.gsm) * 1000) / 1000, gross_kg_per_garment: Math.round(kg(grossArea / garments, fabric.gsm) * 1000) / 1000,
    gross_kg_per_dozen: r2((kg(grossArea / garments, fabric.gsm)) * 12), wastage_pct: r1((1 - eff) * 100),
    rib_area_per_garment_cm2: r1(ribPer), rib_kg_per_garment: Math.round(kg(ribPer, fabric.rib_gsm) * 10000) / 10000,
    gsm: fabric.gsm,
  };
  if (eff < 0.7) add('warn', `Marker efficiency is ${consumption.efficiency_pct} %: a 4-piece tee usually reaches 80 % or more. Try another size ratio, or a narrower or wider cutting width.`);
  else add('ok', `Marker: ${garments} garment${garments > 1 ? 's' : ''} in ${r1(mk.length)} cm of ${r1(fabric.width_cm)} cm cloth, efficiency ${consumption.efficiency_pct} %.`);
  if (opt.one_way) add('note', 'One-way cutting: no piece is turned round on the marker.');
  notes.forEach((t) => { const [sz, tx] = t.split(''); add('note', tx, sz); });

  return {
    success: true, style: STYLE, unit_in: unit, sizes: sizes, base, ratio, fabric, allowance: allow, ease_cm: opt.ease_cm,
    cut_factor: { across: r2(sx), along: r2(sy) },
    by_size: out,
    marker: { width_cm: r1(fabric.width_cm), length_cm: r1(mk.length), efficiency_pct: consumption.efficiency_pct, pieces: mk.placed.map((p) => ({ size: p.size, piece: p.piece, name: p.name, n: p.n, rot: p.rot, poly: p.poly.map(([x, y]) => [r2(x), r2(y)]) })) },
    consumption, checks,
    basis: [
      'A pattern maker\'s basic tee, drafted from the chart: the neckline a cubic Bézier, the armholes cubic Béziers (the front bowed in 8 % of its depth, the back solved to the same length), the sleeve cap solved so its length is the armhole\'s plus the ease.',
      'Every chart measure is a FINISHED, flat, after-wash measure; the cut is the finished size divided by (1 − shrinkage), across and along separately.',
      'The marker is skyline packing on a 1 cm grid with the grain along the length, pieces turned 180° unless one-way; the neck band is cut from the rib and is not on this marker.',
      'Not modelled: ease spread along the cap, pockets, curved hems, stripe or check matching, the drape of the cloth.',
    ],
  };
}

module.exports = { STYLE, POMS, POM_KEYS, build, parseChart, template, num, offsetPoly, selfCrossing, removeLoops, bez, plen, area, bbox, maskOf, lay, finishedPieces, underarmY, armholeCurve, capHalf, INCH };
