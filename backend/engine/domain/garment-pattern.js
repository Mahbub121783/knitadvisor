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
function armholeCtl(sw2, slope, cw2, ah, bulge, k1) {
  const h = ah - slope, xin = sw2 - bulge;
  return [[sw2, slope], [xin, slope + (k1 == null ? 0.32 : k1) * h], [cw2 - 0.46 * (cw2 - xin), ah], [cw2, ah]];
}
function armholeCurve(sw2, slope, cw2, ah, bulge, n, k1) { const c = armholeCtl(sw2, slope, cw2, ah, bulge, k1); return bez(c[0], c[1], c[2], c[3], n); }
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

// ── vector pieces: anchors with handles ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A piece is a closed outline of ANCHORS (x, y in cm, finished size) joined by edges that are straight or cubic Béziers: the handle `hout` of an anchor and the
// handle `hin` of the next are the Bézier's control points, relative to their anchor. An edge carries the name of its seam (the label of the anchor it starts at).
// A piece symmetric about x = 0 (front, back, sleeve) is held as its right half, top centre to bottom centre; the left half is the mirror. Moving an anchor or a
// handle is an EDIT on top of the chart's drawing and survives a change of the chart; adding or deleting an anchor takes the piece off the chart (a manual piece).
const anchor = (x, y, label, o) => Object.assign({ x, y, label: label || 'seam', hin: null, hout: null, corner: false, role: null }, o || {});
const cp = (a, b) => {                                                        // the four control points of the edge a -> b, or null for a straight edge
  if (!a.hout && !b.hin) return null;
  return [[a.x, a.y], a.hout ? [a.x + a.hout[0], a.y + a.hout[1]] : [a.x, a.y], b.hin ? [b.x + b.hin[0], b.y + b.hin[1]] : [b.x, b.y], [b.x, b.y]];
};
function sampleEdge(a, b) {                                                   // the points of the edge after a, up to and including b
  const c = cp(a, b);
  if (!c) return [[b.x, b.y]];
  const approx = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
  return bez(c[0], c[1], c[2], c[3], Math.max(8, Math.min(70, Math.round(approx / 0.5)))).slice(1);
}
function edgeLen(a, b) { const c = cp(a, b); if (!c) return dist([a.x, a.y], [b.x, b.y]); return plen(bez(c[0], c[1], c[2], c[3], 200)); }
function sampleChain(an, closed) {                                            // points and the seam label of the edge each point starts
  const pts = [], labels = [], n = an.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = an[i], b = an[(i + 1) % n], seg = sampleEdge(a, b);
    pts.push([a.x, a.y]); labels.push(a.label);
    for (let k = 0; k < seg.length - 1; k++) { pts.push(seg[k]); labels.push(a.label); }
  }
  if (!closed) { pts.push([an[n - 1].x, an[n - 1].y]); labels.push(an[n - 2] ? an[n - 2].label : 'seam'); }
  return { pts, labels };
}
function mirrorFull(half) {                                                   // the right half, top centre to bottom centre -> the whole outline
  const P = half.pts, Lb = half.labels, m = P.length - 1, pts = P.slice(), labels = Lb.slice();
  labels[m] = Lb[m - 1];
  for (let j = m - 1; j >= 1; j--) { pts.push([-P[j][0], P[j][1]]); labels.push(Lb[j - 1]); }
  return { pts, labels };
}
function polyOf(an, sym) {
  const p = sym ? mirrorFull(sampleChain(an, false)) : sampleChain(an, true);
  return dedupe2(p);
}
const cloneAnchors = (an) => an.map((a) => Object.assign({}, a, { hin: a.hin && a.hin.slice(), hout: a.hout && a.hout.slice() }));
function applyEdit(an, ed, sym) {
  const out = cloneAnchors(an);
  if (ed) {
    const mv = ed.move || {}, hi = ed.hin || {}, ho = ed.hout || {};
    out.forEach((a, i) => {
      if (mv[i]) { a.x += +mv[i][0] || 0; a.y += +mv[i][1] || 0; }
      if (hi[i]) a.hin = [(a.hin ? a.hin[0] : 0) + (+hi[i][0] || 0), (a.hin ? a.hin[1] : 0) + (+hi[i][1] || 0)];
      if (ho[i]) a.hout = [(a.hout ? a.hout[0] : 0) + (+ho[i][0] || 0), (a.hout ? a.hout[1] : 0) + (+ho[i][1] || 0)];
    });
  }
  if (sym && out.length > 1) { out[0].x = 0; out[out.length - 1].x = 0; }       // the anchors on the centre line stay on it
  return out;
}
function dedupe2(p) {
  const pts = [], labels = [];
  p.pts.forEach((q, i) => { if (!pts.length || dist(q, pts[pts.length - 1]) > 1e-7) { pts.push(q); labels.push(p.labels[i]); } });
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-7) { pts.pop(); labels.pop(); }
  return { pts, labels };
}
const labelLen = (pc, label) => { let l = 0; const P = pc.pts.pts, Lb = pc.pts.labels, n = P.length; for (let i = 0; i < n; i++) if (Lb[i] === label) l += dist(P[i], P[(i + 1) % n]); return l; };
const roleOf = (pc, role) => pc.anchors.filter((a) => a.role === role)[0] || null;

// ── the finished pieces of one size ──
// the underarm's depth below the high point of the shoulder: the straight armhole is the chord from the shoulder point, so its vertical run is what is left
function underarmY(m) { const dx = m.chest / 2 - m.shoulder / 2; return m.slope + Math.sqrt(Math.max(m.armhole * m.armhole - dx * dx, 4)); }

function finishedPieces(m, o, edits) {
  edits = edits || {};
  const cw2 = m.chest / 2, hw2 = m.hem / 2, sw2 = m.shoulder / 2, nw2 = m.neck_w / 2, ah = underarmY(m), slope = m.slope, L = m.length;
  // the front armhole bows in by 8 % of its depth; the back's bow is solved so both armholes are as long (the sleeve cap serves both)
  const depth = ah - slope, bf = 0.085 * depth;
  const armCtl = (bulge, k1) => armholeCtl(sw2, slope, cw2, ah, bulge, k1);
  const lenF = plen(bez.apply(null, armCtl(bf, 0.4).concat([200])));
  const bb = bisect((b) => plen(bez.apply(null, armCtl(b, 0.26).concat([200]))), 0, 0.3 * depth, lenF, 50);
  const body = (drop, ctl) => [
    anchor(0, drop, 'neck', { hout: [nw2 * 0.55, 0], role: 'cf_neck' }),
    anchor(nw2, 0, 'shoulder', { hin: [nw2 * 0.93 - nw2, drop * 0.36], corner: true, role: 'neck_point' }),
    anchor(sw2, slope, 'armhole', { hout: [ctl[1][0] - ctl[0][0], ctl[1][1] - ctl[0][1]], corner: true, role: 'shoulder_tip' }),
    anchor(cw2, ah, 'side', { hin: [ctl[2][0] - ctl[3][0], ctl[2][1] - ctl[3][1]], corner: true, role: 'underarm' }),
    anchor(hw2, L, 'sidehem', { corner: true, role: 'hem_corner' }),
    anchor(hw2, L + m.hem_h, 'hem', { corner: true, role: 'hem_bottom' }),
    anchor(0, L + m.hem_h, 'hem', { role: 'cf_hem' }),
  ];
  const make = (id, name, qty, base, sym, grain, extra) => {
    const ed = edits[id] || null, manual = !!(ed && ed.manual && Array.isArray(ed.manual.anchors) && ed.manual.anchors.length >= 3);
    const psym = manual ? ed.manual.sym !== false && sym : sym;
    const an = manual ? ed.manual.anchors.map((a) => anchor(+a.x, +a.y, a.label, { hin: a.hin || null, hout: a.hout || null, corner: !!a.corner, role: a.role || null })) : applyEdit(base, ed, sym);
    return Object.assign({ id, name, qty, sym: psym, grain, anchors: an, base: manual ? cloneAnchors(an) : base, manual, pts: polyOf(an, psym) }, extra || {});
  };
  const front = make('front', 'Front', 1, body(m.neck_df, armCtl(bf, 0.4)), true, 'y');
  const back = make('back', 'Back', 1, body(m.neck_db, armCtl(bb, 0.26)), true, 'y');
  const armF = labelLen(front, 'armhole') / 2, armB = labelLen(back, 'armhole') / 2;

  // the sleeve: the cap is solved against the armholes as they are (edited or not)
  const bw2 = m.bicep, so2 = m.sleeve_o, SL = m.sleeve_l, capTarget = (armF + armB) / 2 + o.ease_cm;
  const sleeveAn = (ch) => [
    anchor(0, 0, 'cap', { hout: [bw2 * 0.46, 0], role: 'apex' }),
    anchor(bw2, ch, 'underarm', { hin: [bw2 * 0.92 - bw2, ch * 0.42 - ch], corner: true, role: 'underarm' }),
    anchor(so2, SL, 'underarmhem', { corner: true, role: 'cuff_corner' }),
    anchor(so2, SL + m.sleeve_hem_h, 'shem', { corner: true, role: 'cuff_bottom' }),
    anchor(0, SL + m.sleeve_hem_h, 'shem', { role: 'cuff_centre' }),
  ];
  const capOf = (ch) => { const an = sleeveAn(ch); return edgeLen(an[0], an[1]); };
  const ch = bisect(capOf, 0.5, Math.max(bw2 * 3, SL), capTarget, 60);
  const sleeve = make('sleeve', 'Sleeve', 2, sleeveAn(ch), true, 'y');
  const capHalfLen = labelLen(sleeve, 'cap') / 2, capOk = Math.abs(capOf(ch) - capTarget) < 0.05;

  // the neck band, as long as the neck opening it closes, shortened by the band's stretch
  const neckFront = labelLen(front, 'neck'), neckBack = labelLen(back, 'neck'), neckLen = neckFront + neckBack;
  const bandLen = neckLen / (1 + o.rib_stretch_pct / 100), rw = m.rib_w;
  const band = make('band', 'Neck band', 1, [anchor(0, 0, 'bandneck', { corner: true }), anchor(bandLen, 0, 'bandend', { corner: true }), anchor(bandLen, 2 * rw, 'bandneck', { corner: true }), anchor(0, 2 * rw, 'bandend', { corner: true })], false, 'x', { rib: true });

  return {
    front, back, sleeve, band,
    derived: { armhole_front: armF, armhole_back: armB, cap_len: capHalfLen, cap_height: ch, cap_target: capTarget, neck_front: neckFront, neck_back: neckBack, neck_len: neckLen, band_len: bandLen, back_bow: bb, front_bow: bf, cap_ok: capOk, underarm_y: ah },
  };
}

// what the pieces measure, as the chart names them: the chart says what the garment should be, this says what the drawing is
function measuredOf(fp) {
  const g = (pc, role) => roleOf(pc, role);
  const u = g(fp.front, 'underarm'), s = g(fp.front, 'shoulder_tip'), n = g(fp.front, 'neck_point'), cf = g(fp.front, 'cf_neck'), cb = g(fp.back, 'cf_neck'), hc = g(fp.front, 'hem_corner'), hb = g(fp.front, 'hem_bottom');
  const su = g(fp.sleeve, 'underarm'), sc = g(fp.sleeve, 'cuff_corner'), sb = g(fp.sleeve, 'cuff_bottom');
  const w = (a) => (a ? r2(2 * Math.abs(a.x)) : null), v = (x) => (x == null ? null : r2(x));
  return {
    chest: w(u), length: hc ? v(hc.y) : null, shoulder: w(s), armhole: u && s ? v(dist([u.x, u.y], [s.x, s.y])) : null, neck_w: w(n), neck_df: cf ? v(cf.y) : null, neck_db: cb ? v(cb.y) : null,
    hem: w(hc), hem_h: hc && hb ? v(hb.y - hc.y) : null, slope: s ? v(s.y) : null, sleeve_l: sc ? v(sc.y) : null, bicep: su ? v(Math.abs(su.x)) : null, sleeve_o: sc ? v(Math.abs(sc.x)) : null,
    sleeve_hem_h: sc && sb ? v(sb.y - sc.y) : null, rib_w: v(fp.band && fp.band.anchors.length >= 3 ? (fp.band.anchors[2].y - fp.band.anchors[0].y) / 2 : null),
  };
}

// ── seams and stitches ──
// The edges of a piece carry the name of a seam; a seam has a stitch type (ISO 4915), an allowance and a length, and the stitch type decides the thread.
// Thread ratios are the rules of thumb a thread supplier's calculator is built on (thread length per length of seam): they say how much, not exactly how much.
const STITCH = {
  '301': { name: 'Lockstitch (301)', machine: 'Single-needle lockstitch', ratio: 3.0, spi: '10–14', use: 'topstitch, zipper, labels, closing a band' },
  '304': { name: 'Zigzag (304)', machine: 'Zigzag lockstitch', ratio: 5.5, spi: '8–12', use: 'elastic, stretch seams' },
  '401': { name: 'Chainstitch (401)', machine: 'Chainstitch', ratio: 4.3, spi: '8–12', use: 'a plain seam that must stretch' },
  '504': { name: '3-thread overlock (504)', machine: '3-thread overlock', ratio: 12, spi: '10–14', use: 'seam edges, light knits, hems of facings' },
  '514': { name: '4-thread overlock (514)', machine: '4-thread overlock', ratio: 16, spi: '10–12', use: 'side, armhole and shoulder seams of knits' },
  '516': { name: '5-thread safety stitch (516)', machine: '5-thread safety overlock', ratio: 20, spi: '8–12', use: 'a strong seam in one pass (wovens, heavy knits)' },
  '602': { name: '2-needle cover stitch (602)', machine: '2-needle cover stitch', ratio: 7.5, spi: '8–12', use: 'a flat hem, neck topstitch' },
  '605': { name: '3-needle cover stitch (605)', machine: '3-needle cover stitch', ratio: 11, spi: '8–12', use: 'a wide flat hem' },
  '607': { name: 'Flatseam (607)', machine: '4-needle flatlock', ratio: 16, spi: '8–12', use: 'a flat, decorative or sports seam' },
};
const SEAM_LABELS = {                                                         // an edge's label -> its seam
  neck: 'neck', bandneck: 'neck', shoulder: 'shoulder', armhole: 'armhole', cap: 'armhole', side: 'side', sidehem: 'side', underarm: 'underarm', underarmhem: 'underarm',
  hem: 'hem', shem: 'sleeve_hem', bandend: 'band_end', cf: 'cf', faceend: 'facing_end', faceedge: 'facing_edge', slitedge: 'cf',
};
const SEAM_DEFAULTS = {
  shoulder: { name: 'Shoulder', type: '514', allowance: 1.0 }, side: { name: 'Side seam', type: '514', allowance: 1.0 }, armhole: { name: 'Sleeve set (armhole)', type: '514', allowance: 1.0 },
  underarm: { name: 'Sleeve underarm seam', type: '514', allowance: 1.0 }, neck: { name: 'Neck band attach', type: '514', allowance: 0.7 }, band_end: { name: 'Neck band closing', type: '301', allowance: 1.0 },
  hem: { name: 'Body hem', type: '605', allowance: 0 }, sleeve_hem: { name: 'Sleeve hem', type: '605', allowance: 0 }, cf: { name: 'Zipper (centre front)', type: '301', allowance: 1.5 },
  facing_end: { name: 'Facing ends', type: '504', allowance: 1.0 }, facing_edge: { name: 'Facing free edge', type: '504', allowance: 0.6 },
};
const HEM_SEAMS = new Set(['hem', 'sleeve_hem']);                             // a hem's depth is in the drawing, not in an allowance
function seamConfig(user, legacy) {
  const out = {};
  Object.keys(SEAM_DEFAULTS).forEach((k) => {
    const d = SEAM_DEFAULTS[k], u = (user && user[k]) || {};
    let allowance = Number.isFinite(+u.allowance) && u.allowance !== '' && u.allowance !== null ? +u.allowance : d.allowance;
    if (!(user && user[k] && 'allowance' in user[k])) {                       // the older seam/neck allowance inputs still set the defaults
      if (legacy && k === 'neck' && Number.isFinite(legacy.neck)) allowance = legacy.neck;
      else if (legacy && Number.isFinite(legacy.seam) && ['shoulder', 'side', 'armhole', 'underarm', 'band_end', 'facing_end'].includes(k)) allowance = legacy.seam;
    }
    out[k] = { id: k, name: d.name, type: STITCH[u.type] ? u.type : d.type, allowance: HEM_SEAMS.has(k) ? 0 : Math.max(0, Math.min(5, allowance)) };
  });
  return out;
}

// ── a zipper ──
const ZIP_STANDARD = [10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];   // cm: the steps catalogues usually sell
const ZIP_TYPES = { open_end: 'Open-end (separating): a jacket, a cardigan', closed_end: 'Closed-end: a pocket, a placket, a quarter-zip', invisible: 'Invisible (concealed)' };
function zipperOf(z) {
  if (!z || !z.on) return { on: false };
  const kind = z.kind === 'partial' ? 'partial' : 'full';
  return {
    on: true, kind, type: ZIP_TYPES[z.type] ? z.type : (kind === 'full' ? 'open_end' : 'closed_end'), tape_w: Math.max(1, Math.min(6, Number.isFinite(+z.tape_w) ? +z.tape_w : 2.5)),
    length_cm: +z.length_cm > 0 ? +z.length_cm : null, allow: Math.max(0.5, Math.min(3, Number.isFinite(+z.allow) ? +z.allow : 1.5)), facing_w: Math.max(3, Math.min(10, Number.isFinite(+z.facing_w) ? +z.facing_w : 5.5)),
    teeth: ['coil', 'plastic', 'metal'].includes(z.teeth) ? z.teeth : 'coil', size: Math.max(3, Math.min(10, Math.round(+z.size || 5))),
  };
}

// ── from finished to cut ──
function cutOutline(piece, sx, sy, allowOf) {
  const scaled = piece.pts.pts.map(([x, y]) => [x * sx, y * sy]);
  const a = piece.pts.labels.map((l) => allowOf(l));
  const clean = removeLoops(offsetPoly(scaled, a), piece.pts.labels);
  return { nominal: scaled, pts: clean.pts, labels: clean.labels };
}
// a notch: a tick across the seam allowance at a fraction of an edge's length, on the sewing line (the nominal outline)
function notchesOf(nominal, labels, spec) {
  const out = [], n = nominal.length;
  spec.forEach((s) => {
    const idx = []; for (let i = 0; i < n; i++) if (labels[i] === s.label) idx.push(i);
    if (!idx.length) return;
    // the runs of this label (a symmetric piece has one on each side)
    const runs = []; let cur = [idx[0]];
    for (let k = 1; k < idx.length; k++) { if (idx[k] === idx[k - 1] + 1) cur.push(idx[k]); else { runs.push(cur); cur = [idx[k]]; } }
    runs.push(cur);
    runs.forEach((run) => {
      if (s.side === 'left' && !(run.every((i) => nominal[i][0] <= 1e-6))) return;
      if (s.side === 'right' && !(run.every((i) => nominal[i][0] >= -1e-6))) return;
      let pts = run.map((i) => nominal[i]).concat([nominal[(run[run.length - 1] + 1) % n]]);
      if (s.from === 'bottom' && pts[0][1] < pts[pts.length - 1][1]) pts = pts.slice().reverse();
      const total = plen(pts); let acc = 0;
      s.at.forEach((f) => {
        const target = total * f; acc = 0;
        for (let i = 1; i < pts.length; i++) {
          const seg = dist(pts[i - 1], pts[i]);
          if (acc + seg >= target - 1e-9) { const t = seg ? (target - acc) / seg : 0, x = pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), y = pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]), dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dy) || 1; out.push({ x: r2(x), y: r2(y), nx: r2(dy / l), ny: r2(-dx / l), label: s.label, mark: s.mark || '' }); break; }
          acc += seg;
        }
      });
    });
  });
  return out;
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
  const edits = inp.edits && typeof inp.edits === 'object' ? inp.edits : {};
  const seamCfg = seamConfig(inp.seams, allow);
  const zip = zipperOf(inp.zipper);
  const tol = Number.isFinite(+inp.tolerance_cm) ? Math.max(0.05, +inp.tolerance_cm) : 0.5;
  const allowOf = (l) => { if (l === 'cf') return zip.on ? zip.allow : seamCfg.cf.allowance; const s = SEAM_LABELS[l]; return s && seamCfg[s] ? seamCfg[s].allowance : allow.seam; };
  const NOTCH = {
    front: [{ label: 'shoulder', at: [0.5] }, { label: 'side', at: [0.5] }, { label: 'armhole', at: [0.4], from: 'bottom' }],
    back: [{ label: 'shoulder', at: [0.5] }, { label: 'side', at: [0.5] }, { label: 'armhole', at: [0.4, 0.46], from: 'bottom' }],
    sleeve: [{ label: 'cap', at: [0.4], from: 'bottom', side: 'left' }, { label: 'cap', at: [0.4, 0.46], from: 'bottom', side: 'right' }, { label: 'underarm', at: [0.5] }],
  };
  NOTCH.front_r = NOTCH.front_l = [{ label: 'armhole', at: [0.4], from: 'bottom' }, { label: 'side', at: [0.5] }, { label: 'shoulder', at: [0.5] }];
  const rnd3 = (v) => Math.round(v * 1000) / 1000;
  const anchorOut = (a) => ({ x: rnd3(a.x), y: rnd3(a.y), label: a.label, hin: a.hin ? [rnd3(a.hin[0]), rnd3(a.hin[1])] : null, hout: a.hout ? [rnd3(a.hout[0]), rnd3(a.hout[1])] : null, corner: !!a.corner, role: a.role || null });
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

    const fp = finishedPieces(m, opt, edits[size]);
    const d = fp.derived;
    if (!d.cap_ok || !(d.cap_height > 0) || d.cap_height >= m.sleeve_l - 0.5) { add('error', `Size ${size}: the sleeve (${r1(m.sleeve_l)} cm long, ${r1(m.bicep)} cm bicep) is too short to hold a cap that fits the armhole (${r1(d.armhole_front)} cm): it needs a cap ${r1(d.cap_height)} cm high.`, size); continue; }

    // the pieces that are cut: the chart's four, the front in halves and the facings when there is a zipper
    const src = [fp.front, fp.back, fp.sleeve, fp.band];
    let zinfo = { on: false };
    if (zip.on) {
      if (!fp.front.sym) { add('warn', `Size ${size}: the zipper needs a front that is symmetric about the centre line; the front has been edited into a manual shape, so the zipper is left out.`, size); }
      else {
        const openFull = m.length - m.neck_df, open = zip.kind === 'full' ? openFull : Math.max(6, Math.min(zip.length_cm || 18, openFull - 2));
        const standard = ZIP_STANDARD.find((s) => s >= open - 1e-9) || Math.ceil(open / 5) * 5, len = open + 2;
        zinfo = { on: true, kind: zip.kind, type: zip.type, type_name: ZIP_TYPES[zip.type], teeth: zip.teeth, size: zip.size, tape_w: zip.tape_w, opening_cm: r1(open), standard_cm: standard, trim_cm: r1(standard - open), facing_w: zip.facing_w, allow: zip.allow, neck_drop_cm: r1(m.neck_df) };
        const rect = (id, name, qty, w) => ({ id, name, qty, grain: 'y', pts: { pts: [[0, 0], [w, 0], [w, len], [0, len]], labels: ['faceend', 'faceedge', 'faceend', 'cf'] } });
        if (zip.kind === 'full') {
          const half = sampleChain(fp.front.anchors, false), lab = half.labels.slice(); lab[lab.length - 1] = 'cf';
          src.splice(0, 1,
            { id: 'front_r', name: 'Front (right)', qty: 1, grain: 'y', source: 'front', pts: dedupe2({ pts: half.pts.map((q) => q.slice()), labels: lab }) },
            { id: 'front_l', name: 'Front (left)', qty: 1, grain: 'y', source: 'front', pts: dedupe2({ pts: half.pts.map(([x, y]) => [-x, y]), labels: lab }) });
          src.push(rect('facing', 'Zipper facing', 2, zip.facing_w));
        } else src.push(rect('placket', 'Zipper placket', 1, zip.facing_w * 2));
      }
    }
    const pieces = src.map((p) => {
      const rib = !!p.rib, cut = cutOutline(p, rib ? 1 : sx, rib ? 1 : sy, allowOf), fin = p.pts.pts, bb = bbox(cut.pts), bf = bbox(fin);
      const mk = { id: p.id, name: p.name, qty: p.qty, rib, grain: p.grain, source: p.source || p.id };
      if (p.id === 'front' && zinfo.on && zinfo.kind === 'partial') mk.marks = [{ kind: 'slit', x1: 0, y1: m.neck_df, x2: 0, y2: r2(m.neck_df + zinfo.opening_cm), label: `zipper ${zinfo.standard_cm} cm` }];
      return Object.assign(mk, {
        finished: fin.map(([x, y]) => [r2(x), r2(y)]), cut: cut.pts.map(([x, y]) => [r2(x), r2(y)]), nominal: cut.nominal.map(([x, y]) => [r2(x), r2(y)]), labels: cut.labels, finished_labels: p.pts.labels,
        notches: NOTCH[p.id] ? notchesOf(cut.nominal, p.pts.labels, NOTCH[p.id]) : [],
        finished_w: r1(bf.w), finished_h: r1(bf.h), cut_w: r1(bb.w), cut_h: r1(bb.h), cut_area_cm2: r1(Math.abs(area(cut.pts))), finished_area_cm2: r1(Math.abs(area(fin))),
        simple: !selfCrossing(cut.pts) && !selfCrossing(fin),
      });
    });
    pieces.forEach((p) => { if (!p.simple) add('error', `Size ${size}: the ${p.name.toLowerCase()} outline crosses itself — the shape cannot be cut. Move an anchor back, or reset the piece.`, size); });
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
    if (zinfo.on) add('ok', `Size ${size}: ${zinfo.kind === 'full' ? 'front-opening' : 'quarter'} zipper, ${zinfo.opening_cm} cm of opening from the neck seam: buy ${zinfo.standard_cm} cm${zinfo.trim_cm > 0.4 ? ` and trim ${zinfo.trim_cm} cm` : ''} (${ZIP_TYPES[zinfo.type].split(':')[0].toLowerCase()}, ${zinfo.teeth} teeth, #${zinfo.size}); ${zinfo.kind === 'full' ? `the centre front is cut with ${zinfo.allow} cm of allowance and a ${zinfo.facing_w} cm facing` : `the front is slit and a ${r1(zinfo.facing_w * 2)} cm placket is sewn over it`}.`, size);

    // what the drawing measures against what the chart asks
    const measured = measuredOf(fp), md = [];
    POMS.forEach((p) => {
      const pv = measured[p.key], cv = m[p.key];
      if (pv == null || !(cv >= 0)) return;
      const diff = r2(pv - cv);
      md.push({ key: p.key, label: p.label, chart: r2(cv), pattern: pv, diff, ok: Math.abs(diff) <= tol });
    });
    const off = md.filter((x) => !x.ok);
    if (off.length) add('warn', `Size ${size}: the drawing is off the chart by more than ${tol} cm on ${off.map((x) => `${x.label.split(',')[0].toLowerCase()} (${x.diff > 0 ? '+' : ''}${x.diff})`).join(', ')}. Set the chart from the pattern, or reset the piece.`, size);

    // the seams, the thread and the sewing order
    const sew = sewingOf(fp, zinfo, seamCfg, opt, size, add);
    out.push({
      size, m: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r2(v)])), derived: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, r2(v)])), pieces,
      shape: { front: fp.front.pts.pts.map(([x, y]) => [r2(x), r2(y)]), back: fp.back.pts.pts.map(([x, y]) => [r2(x), r2(y)]), sleeve: fp.sleeve.pts.pts.map(([x, y]) => [r2(x), r2(y)]) },
      zipper: zinfo, measured: md,
      edit: Object.fromEntries(['front', 'back', 'sleeve', 'band'].map((id) => [id, { id, name: fp[id].name, sym: fp[id].sym, manual: fp[id].manual, anchors: fp[id].anchors.map(anchorOut), base: fp[id].base.map(anchorOut), edited: !!(edits[size] && edits[size][id]) }])),
      sewing: sew,
    });
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
  add('note', `Pieces are cut ${r1((sx - 1) * 100)} % wider and ${r1((sy - 1) * 100)} % longer than the finished measures, then the seam allowances of each seam are added (shoulder ${seamCfg.shoulder.allowance} cm, side ${seamCfg.side.allowance} cm, armhole ${seamCfg.armhole.allowance} cm, neck ${seamCfg.neck.allowance} cm).`);

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
  notes.forEach((t) => { const [sz, tx] = t.split('\u0001'); add('note', tx, sz); });

  // the bill of materials for the size shown
  const bs = out.find((o) => o.size === base) || out[0], bom = [
    { item: 'Main fabric', qty: consumption.fabric_per_garment_m, unit: 'm', note: `${fabric.gsm} GSM, ${r1(fabric.width_cm)} cm wide: ${consumption.gross_kg_per_garment} kg a garment` },
    { item: 'Neck rib', qty: consumption.rib_area_per_garment_cm2, unit: 'cm²', note: `${consumption.rib_kg_per_garment} kg at ${fabric.rib_gsm} GSM` },
    { item: 'Sewing thread', qty: r1(bs.sewing.thread_m), unit: 'm', note: `${r1(bs.sewing.thread_m * 12)} m a dozen; a rule of thumb for the stitch types chosen: confirm with the thread supplier` },
  ];
  if (bs.zipper.on) bom.push({ item: `Zipper ${bs.zipper.standard_cm} cm`, qty: 1, unit: 'pc', note: `${bs.zipper.type_name.split(':')[0]}, ${bs.zipper.teeth} teeth #${bs.zipper.size}, tape ${bs.zipper.tape_w} cm; ${bs.zipper.opening_cm} cm of opening${bs.zipper.trim_cm > 0.4 ? `, trim ${bs.zipper.trim_cm} cm` : ''}` });

  return {
    success: true, style: STYLE, unit_in: unit, sizes: sizes, base, ratio, fabric, allowance: allow, ease_cm: opt.ease_cm, tolerance_cm: tol,
    cut_factor: { across: r2(sx), along: r2(sy) },
    by_size: out,
    seams: seamCfg, zipper: zip.on ? { on: true, kind: zip.kind, type: zip.type, tape_w: zip.tape_w, length_cm: zip.length_cm, allow: zip.allow, facing_w: zip.facing_w, teeth: zip.teeth, size: zip.size } : { on: false },
    sewing: bs.sewing, bom,
    catalogue: { stitch: STITCH, zip_types: ZIP_TYPES, zip_standard: ZIP_STANDARD, seam_defaults: SEAM_DEFAULTS },
    marker: { width_cm: r1(fabric.width_cm), length_cm: r1(mk.length), efficiency_pct: consumption.efficiency_pct, pieces: mk.placed.map((p) => ({ size: p.size, piece: p.piece, name: p.name, n: p.n, rot: p.rot, poly: p.poly.map(([x, y]) => [r2(x), r2(y)]) })) },
    consumption, checks,
    basis: [
      'A pattern maker\'s basic tee, drafted from the chart: the neckline a cubic Bézier, the armholes cubic Béziers (the front bowed in 8 % of its depth, the back solved to the same length), the sleeve cap solved so its length is the armhole\'s plus the ease.',
      'Every piece is a closed outline of anchors and Bézier handles. A move of an anchor or a handle is an edit kept on top of the chart (it survives a change of the chart); adding or deleting an anchor makes the piece manual. The sleeve cap and the neck band are re-solved against the edited armholes and neckline.',
      'Every chart measure is a FINISHED, flat, after-wash measure; the cut is the finished size divided by (1 − shrinkage), across and along separately, then the allowance of each seam is added.',
      'Thread is seam length × a ratio per stitch type (rules of thumb); the sewing time is the catalogue benchmark for a basic tee plus an estimate for the zipper, not a measured operation bulletin.',
      'The marker is a raster nest on a 1 cm grid with the grain along the length, pieces turned 180° unless one-way; the neck band is cut from the rib and is not on this marker.',
      'Not modelled: ease spread along the cap, pockets, curved hems, stripe or check matching, the drape of the cloth.',
    ],
  };
}

// the seams of one size, the thread they take and the order they are sewn in
function sewingOf(fp, zinfo, cfg, opt, size, add) {
  const F = fp.front, B = fp.back, S = fp.sleeve, N = fp.band, q = S.qty, d = fp.derived;
  const Ls = (pc, ...ls) => ls.reduce((a, l) => a + labelLen(pc, l), 0);
  const rows = [];
  const row = (id, a, b, sewn, expect) => rows.push({ id, a, b, sewn, expect: expect || 0 });
  row('shoulder', Ls(F, 'shoulder'), Ls(B, 'shoulder'), Ls(F, 'shoulder'));
  row('side', Ls(F, 'side', 'sidehem'), Ls(B, 'side', 'sidehem'), Ls(F, 'side', 'sidehem'));
  const ahA = Ls(F, 'armhole') + Ls(B, 'armhole');
  row('armhole', ahA, Ls(S, 'cap') * q, ahA, 4 * opt.ease_cm);
  const ua = (Ls(S, 'underarm', 'underarmhem') / 2) * q; row('underarm', ua, ua, ua);
  row('neck', Ls(F, 'neck') + Ls(B, 'neck'), Ls(N, 'bandneck') / 2, Ls(F, 'neck') + Ls(B, 'neck'), d.band_len - d.neck_len);
  row('band_end', Ls(N, 'bandend') / 2, Ls(N, 'bandend') / 2, Ls(N, 'bandend') / 2);
  row('hem', Ls(F, 'hem'), Ls(B, 'hem'), Ls(F, 'hem') + Ls(B, 'hem'));
  row('sleeve_hem', Ls(S, 'shem'), Ls(S, 'shem'), Ls(S, 'shem') * q);
  if (zinfo.on) {
    const o2 = zinfo.opening_cm;
    row('cf', 2 * o2, 2 * o2, 4 * o2);                                       // each side attached and topstitched
    row('facing_edge', 2 * (o2 + 2), 2 * (o2 + 2), 2 * (o2 + 2));
  }
  const seams = rows.map((r) => {
    const c = cfg[r.id], st = STITCH[c.type], diff = r.b - r.a, off = Math.abs(diff - r.expect) > 0.4 && !['hem', 'sleeve_hem'].includes(r.id);
    if (off) add('warn', `Size ${size}: the ${c.name.toLowerCase()} joins edges of ${r1(r.a)} and ${r1(r.b)} cm (${diff > 0 ? '+' : ''}${r1(diff)}; ${r.expect ? `${r1(r.expect)} intended` : 'they should be equal'}): ${r.id === 'armhole' ? 'move the armhole or let the cap follow it' : r.id === 'neck' ? 'the band is cut to the opening, so edit the neckline and the band follows' : 'match the two edges'}.`, size);
    return { id: r.id, name: c.name, type: c.type, type_name: st.name, machine: st.machine, allowance: c.allowance, a_len: r1(r.a), b_len: r1(r.b), diff_cm: r1(diff), expected_diff_cm: r1(r.expect), match: !off, sewn_cm: r1(r.sewn), ratio: st.ratio, thread_m: r2((r.sewn * st.ratio) / 100) };
  });
  const byId = Object.fromEntries(seams.map((s) => [s.id, s]));
  const order = zinfo.on ? ['shoulder', 'cf', 'band_end', 'neck', 'armhole', 'side', 'underarm', 'sleeve_hem', 'hem'] : ['shoulder', 'band_end', 'neck', 'armhole', 'side', 'underarm', 'sleeve_hem', 'hem'];
  const ops = order.filter((id) => byId[id]).map((id, i) => ({ n: i + 1, seam: id, name: id === 'cf' ? 'Zipper attach and topstitch (both sides)' : byId[id].name, machine: byId[id].machine, type: byId[id].type, length_cm: byId[id].sewn_cm, thread_m: byId[id].thread_m }));
  const thread = seams.reduce((a, s) => a + s.thread_m, 0);
  let sam = null;
  try {
    const cat = require('../catalog/garment-operations');
    const s0 = cat.buildGarmentSam('basic_tshirt', zinfo.on && zinfo.kind === 'full' ? ['full_zipper'] : []);
    if (s0) {
      const extra = zinfo.on && zinfo.kind === 'partial' ? 1.1 : 0;
      sam = { minutes: r2((s0.basic_minutes_total + extra) * s0.allowance_factor), benchmark_minutes: s0.benchmark_sam, base_minutes: r2(s0.basic_minutes_total * s0.allowance_factor),
        addons: (zinfo.on ? [{ name: zinfo.kind === 'full' ? 'Full-front zipper insertion' : 'Quarter-zip placket and zipper', basic_min: zinfo.kind === 'full' ? 1.8 : 1.1, source: 'ESTIMATED' }] : []),
        note: 'The catalogue\'s basic-tee operation bulletin (a benchmark, not a measured one) plus an estimate for the zipper. A different stitch type does not change the time here.' };
    }
  } catch (_) { sam = null; }
  return { seams, operations: ops, thread_m: r2(thread), thread_per_dozen_m: r1(thread * 12), sam };
}

module.exports = { STYLE, POMS, POM_KEYS, STITCH, ZIP_STANDARD, ZIP_TYPES, SEAM_DEFAULTS, SEAM_LABELS, build, parseChart, template, num, seamConfig, zipperOf, offsetPoly, selfCrossing, removeLoops, bez, plen, area, bbox, maskOf, lay, finishedPieces, measuredOf, sampleChain, polyOf, applyEdit, underarmY, armholeCurve, armholeCtl, capHalf, INCH };
